// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";

vi.mock("../utils/logger.js", () => {
  const l = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() };
  return { sshLogger: l };
});

import { hangUpChannel, stopOnInputEof, HANGUP_GRACE_MS } from "./channel-hangup.js";

function makeChannel(opts: { closesOnTerm?: boolean; signalThrows?: boolean } = {}) {
  const ch = Object.assign(new EventEmitter(), {
    order: [] as string[],
    end: vi.fn(() => {
      ch.order.push("end");
    }),
    signal: vi.fn((name: string) => {
      ch.order.push(`signal:${name}`);
      if (opts.signalThrows) throw new Error("unsupported");
      if (opts.closesOnTerm) queueMicrotask(() => ch.emit("close"));
    }),
    close: vi.fn(() => {
      ch.order.push("close");
    }),
    resume: vi.fn(() => {
      ch.order.push("resume");
    }),
  });
  return ch;
}

describe("hangUpChannel", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("server ends the channel on TERM (Tailscale SSH) — never closes from our side", async () => {
    const ch = makeChannel({ closesOnTerm: true });
    hangUpChannel(ch);
    expect(ch.signal).toHaveBeenCalledWith("TERM");
    await vi.advanceTimersByTimeAsync(HANGUP_GRACE_MS * 2);
    expect(ch.close).not.toHaveBeenCalled();
  });

  it("server ignores TERM (OpenSSH) — closes once the grace period is up", () => {
    const ch = makeChannel();
    hangUpChannel(ch);
    vi.advanceTimersByTime(HANGUP_GRACE_MS - 1);
    expect(ch.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(ch.close).toHaveBeenCalledTimes(1);
    expect(ch.order).toEqual(["resume", "end", "signal:TERM", "close"]);
  });

  it("a throwing signal still ends in a close", () => {
    const ch = makeChannel({ signalThrows: true });
    expect(() => hangUpChannel(ch)).not.toThrow();
    vi.advanceTimersByTime(HANGUP_GRACE_MS);
    expect(ch.close).toHaveBeenCalledTimes(1);
  });

  it("is idempotent and tolerates a missing channel", () => {
    const ch = makeChannel();
    hangUpChannel(ch);
    hangUpChannel(ch);
    hangUpChannel(null);
    hangUpChannel(undefined);
    vi.advanceTimersByTime(HANGUP_GRACE_MS);
    expect(ch.signal).toHaveBeenCalledTimes(1);
    expect(ch.close).toHaveBeenCalledTimes(1);
  });
});

/** Run `script` under sh with stdin held open; resolves with its exit code and stdout. */
function runSh(script: string, onStdout?: (chunk: Buffer, endStdin: () => void) => void) {
  const child = spawn("/bin/sh", ["-c", script], { stdio: ["pipe", "pipe", "ignore"] });
  let out = "";
  const endStdin = () => child.stdin.end();
  child.stdout.on("data", (b: Buffer) => {
    if (out.length < 1000) out += b.toString();
    onStdout?.(b, endStdin);
  });
  return new Promise<{ code: number | null; out: string }>((resolve) =>
    child.on("close", (code) => resolve({ code, out })),
  );
}

describe("stopOnInputEof", () => {
  it("a pipeline that finishes on its own ends the command, output and status intact", async () => {
    const r = await runSh(`${stopOnInputEof("seq 1 3")}; echo "status=$?"`);
    expect(r.out).toBe("1\n2\n3\nstatus=0\n");
    expect(r.code).toBe(0);
  });

  it("keeps the pipeline's own failure status without exiting the script", async () => {
    const r = await runSh(`${stopOnInputEof("sh -c 'exit 7'")}; echo "status=$?"`);
    expect(r.out).toBe("status=7\n");
  });

  it("EOF on stdin stops a pipeline that is still writing", async () => {
    const t0 = Date.now();
    let ended = false;
    const r = await runSh(`${stopOnInputEof("seq 1 2000000000 | cat")}; echo "status=$?" >&2`, (_b, endStdin) => {
      if (!ended) {
        ended = true;
        endStdin();
      }
    });
    expect(r.code).toBe(0);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});
