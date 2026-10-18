import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { Client } from "ssh2";
import {
  HOSTD_COMMAND,
  HostdChannelLostError,
  enableHostd,
  hostdAllowedForPeer,
  hostdChannelFor,
} from "./hostd-channel.js";
import { ExecTimeoutError, execCommand, execCommandWithStdin } from "./tmux-helper.js";

// The real helper, run locally — the fake client below stands in for ssh2 by
// spawning processes instead of opening exec channels, so these tests drive
// the actual protocol end to end.
const HOSTD_SCRIPT = path.resolve(__dirname, "../../../substrate/scripts/skynet-hostd.py");

class FakeStream extends EventEmitter {
  stderr = new EventEmitter();
  constructor(readonly child: ChildProcess) {
    super();
    child.stdout!.on("data", (d: Buffer) => this.emit("data", d));
    child.stderr!.on("data", (d: Buffer) => this.stderr.emit("data", d));
    child.on("close", (code) => this.emit("close", code ?? undefined));
    child.stdin!.on("error", () => {});
  }
  write(d: string | Buffer) {
    return this.child.stdin!.write(d);
  }
  end(d?: Buffer) {
    this.child.stdin!.end(d);
  }
  close() {
    this.child.stdin!.end();
  }
}

interface FakeClient extends EventEmitter {
  execs: string[];
  helpers: ChildProcess[];
  _sock: { remoteAddress: string; remotePort: number };
}

function makeClient(opts: { helperCmd?: string[] } = {}): FakeClient & Client {
  const ee = new EventEmitter() as FakeClient;
  ee.execs = [];
  ee.helpers = [];
  ee._sock = { remoteAddress: "100.64.0.9", remotePort: 22 };
  (ee as unknown as { exec: unknown }).exec = (
    cmd: string,
    cb: (err: Error | null, stream: FakeStream) => void,
  ) => {
    ee.execs.push(cmd);
    const argv =
      cmd === HOSTD_COMMAND
        ? (opts.helperCmd ?? ["python3", HOSTD_SCRIPT])
        : ["bash", "-c", cmd];
    const child = spawn(argv[0], argv.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
    if (cmd === HOSTD_COMMAND) ee.helpers.push(child);
    queueMicrotask(() => cb(null, new FakeStream(child)));
  };
  return ee as FakeClient & Client;
}

const legacyExecs = (c: FakeClient) => c.execs.filter((e) => e !== HOSTD_COMMAND);
const helperExecs = (c: FakeClient) => c.execs.filter((e) => e === HOSTD_COMMAND);

describe("hostdAllowedForPeer", () => {
  it("is off when unset or empty", () => {
    expect(hostdAllowedForPeer("100.1.1.1", {})).toBe(false);
    expect(hostdAllowedForPeer("100.1.1.1", { SKYNET_HOSTD_PEERS: " " })).toBe(false);
  });
  it("'*' turns it on for every peer", () => {
    expect(hostdAllowedForPeer("100.1.1.1", { SKYNET_HOSTD_PEERS: "*" })).toBe(true);
  });
  it("matches a listed IP, including the IPv4-mapped form", () => {
    const env = { SKYNET_HOSTD_PEERS: "100.2.2.2, 100.1.1.1" };
    expect(hostdAllowedForPeer("100.1.1.1", env)).toBe(true);
    expect(hostdAllowedForPeer("::ffff:100.1.1.1", env)).toBe(true);
    expect(hostdAllowedForPeer("100.3.3.3", env)).toBe(false);
  });
});

describe("execCommand through skynet-hostd", () => {
  const saved = process.env.SKYNET_HOSTD_PEERS;
  const clients: FakeClient[] = [];
  const track = (c: FakeClient & Client) => {
    clients.push(c);
    return c;
  };

  beforeEach(() => {
    process.env.SKYNET_HOSTD_PEERS = "*";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.SKYNET_HOSTD_PEERS;
    else process.env.SKYNET_HOSTD_PEERS = saved;
    for (const c of clients.splice(0)) {
      c.emit("close");
      for (const h of c.helpers) h.kill("SIGKILL");
    }
  });

  it("sends many commands over ONE helper channel", async () => {
    const c = track(makeClient());
    enableHostd(c);
    const outs = await Promise.all(
      Array.from({ length: 10 }, (_, i) => execCommand(c, `echo n${i}`)),
    );
    expect(outs).toEqual(Array.from({ length: 10 }, (_, i) => `n${i}`));
    expect(helperExecs(c)).toHaveLength(1);
    expect(legacyExecs(c)).toHaveLength(0);
  });

  it("keeps execCommand's error contract", async () => {
    const c = track(makeClient());
    enableHostd(c);
    await expect(execCommand(c, "echo bad >&2; exit 4")).rejects.toThrow("bad");
    await expect(execCommand(c, "exit 5")).rejects.toThrow("Command exited with code 5");
    // Non-zero WITH stdout resolves, same as the plain exec path.
    await expect(execCommand(c, "echo partial; exit 1")).resolves.toBe("partial");
  });

  it("feeds stdin for execCommandWithStdin", async () => {
    const c = track(makeClient());
    enableHostd(c);
    const body = Buffer.from("x".repeat(200_000));
    await expect(execCommandWithStdin(c, "wc -c", body)).resolves.toBe("200000");
    expect(legacyExecs(c)).toHaveLength(0);
  });

  it("turns a helper-side timeout into ExecTimeoutError", async () => {
    const c = track(makeClient());
    enableHostd(c);
    const err = await execCommand(c, "sleep 10", { timeoutMs: 300 }).catch((e) => e);
    expect(err).toBeInstanceOf(ExecTimeoutError);
    expect((err as ExecTimeoutError).phase).toBe("run");
  });

  it("uses plain execs when the connection was never enabled", async () => {
    const c = track(makeClient());
    await expect(execCommand(c, "echo plain")).resolves.toBe("plain");
    expect(helperExecs(c)).toHaveLength(0);
    expect(legacyExecs(c)).toEqual(["echo plain"]);
  });

  it("uses plain execs when the peer isn't switched on", async () => {
    process.env.SKYNET_HOSTD_PEERS = "100.9.9.9";
    const c = track(makeClient());
    enableHostd(c);
    await expect(execCommand(c, "echo plain")).resolves.toBe("plain");
    expect(helperExecs(c)).toHaveLength(0);
  });

  it("falls back to plain execs when the helper is missing, and stops retrying it", async () => {
    const c = track(makeClient({ helperCmd: ["bash", "-c", "echo 'skynet-hostd: not found' >&2; exit 127"] }));
    enableHostd(c);
    await expect(execCommand(c, "echo one")).resolves.toBe("one");
    await expect(execCommand(c, "echo two")).resolves.toBe("two");
    expect(helperExecs(c)).toHaveLength(1);
    expect(legacyExecs(c)).toEqual(["echo one", "echo two"]);
  });

  it("falls back when the helper speaks another protocol version", async () => {
    const c = track(
      makeClient({ helperCmd: ["bash", "-c", `echo '{"t":"hello","v":99}'; cat >/dev/null`] }),
    );
    enableHostd(c);
    await expect(execCommand(c, "echo ok")).resolves.toBe("ok");
    expect(legacyExecs(c)).toEqual(["echo ok"]);
  });

  it("fails an in-flight command when the channel dies, without re-running it", async () => {
    const c = track(makeClient());
    enableHostd(c);
    await execCommand(c, "true"); // channel up
    const inflight = execCommand(c, "sleep 10");
    await new Promise((r) => setTimeout(r, 200));
    c.helpers[0].kill("SIGKILL");
    await expect(inflight).rejects.toBeInstanceOf(HostdChannelLostError);
    expect(legacyExecs(c)).toHaveLength(0);
    // Next command opens a fresh helper channel.
    await expect(execCommand(c, "echo again")).resolves.toBe("again");
    expect(helperExecs(c)).toHaveLength(2);
  });

  it("closes the helper when the connection closes", async () => {
    const c = track(makeClient());
    enableHostd(c);
    await execCommand(c, "true");
    const helper = c.helpers[0];
    const exited = new Promise<void>((r) => helper.on("exit", () => r()));
    c.emit("close");
    await exited;
    expect(hostdChannelFor(c)).toBeNull();
  });
});
