import { describe, it, expect, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import type { Client } from "ssh2";
import {
  HostdChannelLostError,
  HostdUnavailableError,
  enableHostd,
  hostdChannelFor,
  hostdCommand,
  hostdEnabled,
} from "./hostd-channel.js";
import { ExecTimeoutError, execCommand, execCommandWithStdin } from "./tmux-helper.js";

// The fake client stands in for ssh2 by running each exec through a local
// `bash -c`, the way a remote login shell would — including the real helper
// start command (`exec python3 -c '<source>'`). So these tests drive the
// actual helper over the actual protocol.

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

/** `helperCmd` replaces what a helper start runs (simulate a broken host). */
function makeClient(opts: { helperCmd?: string } = {}): FakeClient & Client {
  const ee = new EventEmitter() as FakeClient;
  ee.execs = [];
  ee.helpers = [];
  ee._sock = { remoteAddress: "::ffff:100.64.0.9", remotePort: 22 };
  (ee as unknown as { exec: unknown }).exec = (
    cmd: string,
    cb: (err: Error | null, stream: FakeStream) => void,
  ) => {
    ee.execs.push(cmd);
    const isHelper = cmd === hostdCommand();
    const run = isHelper && opts.helperCmd ? opts.helperCmd : cmd;
    const child = spawn("bash", ["-c", run], { stdio: ["pipe", "pipe", "pipe"] });
    if (isHelper) ee.helpers.push(child);
    queueMicrotask(() => cb(null, new FakeStream(child)));
  };
  return ee as FakeClient & Client;
}

const plainExecs = (c: FakeClient) => c.execs.filter((e) => e !== hostdCommand());
const helperExecs = (c: FakeClient) => c.execs.filter((e) => e === hostdCommand());

describe("hostdCommand", () => {
  it("carries the helper source inline as one quoted argument", () => {
    const cmd = hostdCommand();
    expect(cmd.startsWith("exec python3 -c '")).toBe(true);
    expect(cmd).toContain("PROTOCOL_VERSION = 1");
    expect(cmd.length).toBeLessThan(128 * 1024);
  });
});

describe("execCommand through skynet-hostd", () => {
  const clients: FakeClient[] = [];
  const track = (c: FakeClient & Client) => {
    clients.push(c);
    return c;
  };
  afterEach(() => {
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
    expect(plainExecs(c)).toHaveLength(0);
  });

  it("keeps execCommand's error contract", async () => {
    const c = track(makeClient());
    enableHostd(c);
    await expect(execCommand(c, "echo bad >&2; exit 4")).rejects.toThrow("bad");
    await expect(execCommand(c, "exit 5")).rejects.toThrow("Command exited with code 5");
    // Non-zero WITH stdout resolves, same as the plain exec path.
    await expect(execCommand(c, "echo partial; exit 1")).resolves.toBe("partial");
  });

  it("handles quotes and shell syntax in commands", async () => {
    const c = track(makeClient());
    enableHostd(c);
    await expect(execCommand(c, `printf '%s|' "a b" 'c'\\''d'`)).resolves.toBe("a b|c'd|");
  });

  it("feeds stdin for execCommandWithStdin", async () => {
    const c = track(makeClient());
    enableHostd(c);
    const body = Buffer.from("x".repeat(200_000));
    await expect(execCommandWithStdin(c, "wc -c", body)).resolves.toBe("200000");
    expect(plainExecs(c)).toHaveLength(0);
  });

  it("turns a helper-side timeout into ExecTimeoutError", async () => {
    const c = track(makeClient());
    enableHostd(c);
    const err = await execCommand(c, "sleep 10", { timeoutMs: 300 }).catch((e) => e);
    expect(err).toBeInstanceOf(ExecTimeoutError);
    expect((err as ExecTimeoutError).phase).toBe("run");
  });

  it("uses plain execs only for connections that were never enabled", async () => {
    const c = track(makeClient());
    expect(hostdEnabled(c)).toBe(false);
    await expect(execCommand(c, "echo plain")).resolves.toBe("plain");
    expect(helperExecs(c)).toHaveLength(0);
    expect(plainExecs(c)).toEqual(["echo plain"]);
  });

  it("fails clearly — with no plain-exec fallback — when the helper can't start", async () => {
    const c = track(makeClient({ helperCmd: "echo 'python3: command not found' >&2; exit 127" }));
    enableHostd(c);
    const err = await execCommand(c, "echo one").catch((e) => e);
    expect(err).toBeInstanceOf(HostdUnavailableError);
    expect(String(err.message)).toContain("code=127");
    // One retry on a fresh channel, then the error — never a plain exec.
    expect(helperExecs(c)).toHaveLength(2);
    expect(plainExecs(c)).toHaveLength(0);
  });

  it("fails fast after repeated helper failures instead of reopening", async () => {
    const c = track(makeClient({ helperCmd: "exit 127" }));
    enableHostd(c);
    await execCommand(c, "true").catch(() => {});
    await execCommand(c, "true").catch(() => {});
    const opened = helperExecs(c).length;
    expect(opened).toBeGreaterThanOrEqual(3);
    expect(() => hostdChannelFor(c)).toThrow(HostdUnavailableError);
    await execCommand(c, "true").catch(() => {});
    expect(helperExecs(c).length).toBe(opened);
  });

  it("rejects a helper speaking another protocol version", async () => {
    const c = track(makeClient({ helperCmd: `echo '{"t":"hello","v":99}'; cat >/dev/null` }));
    enableHostd(c);
    const err = await execCommand(c, "echo ok").catch((e) => e);
    expect(err).toBeInstanceOf(HostdUnavailableError);
    expect(String(err.message)).toContain("protocol v99");
    expect(plainExecs(c)).toHaveLength(0);
  });

  it("fails an in-flight command when the channel dies, without re-running it", async () => {
    const c = track(makeClient());
    enableHostd(c);
    await execCommand(c, "true"); // channel up
    const inflight = execCommand(c, "sleep 10");
    await new Promise((r) => setTimeout(r, 200));
    c.helpers[0].kill("SIGKILL");
    await expect(inflight).rejects.toBeInstanceOf(HostdChannelLostError);
    expect(plainExecs(c)).toHaveLength(0);
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
    expect(hostdEnabled(c)).toBe(false);
    expect(hostdChannelFor(c)).toBeNull();
  });
});
