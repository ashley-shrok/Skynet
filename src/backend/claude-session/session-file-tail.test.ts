// Vitest coverage for tailSessionFile — the primary ssh2-exec `tail -F`
// helper the WS emission channel uses to stream JSONL frames as they land.
//
// Two responsibility bands live here:
//   1. Command shape (Tests A + B): the string handed to `conn.exec` is a
//      POSIX `sh -c` wrapper that combines three orphan-defense prongs:
//        - trap EXIT/INT/HUP/TERM to kill the backgrounded tail (Prong B),
//        - `read -r _` after backgrounding tail so the wrapper blocks on
//          stdin and notices SSH channel-close via EOF (Prong C, added
//          2026-09-28 — see session-file-tail.ts docblock),
//        - explicit `kill $t; wait $t` after `read` returns so we tear
//          down the tail deterministically without depending on trap
//          firing.
//      Shape is asserted via regex/`toContain` rather than byte-for-byte
//      so future escaping tweaks don't over-constrain.
//   2. Teardown behavior (Tests C-F): `stop()` calls `signal("TERM")`
//      BEFORE `close()`, a throw from `signal` does not skip `close`, the
//      idempotence guard still holds, and the stopped-before-exec-callback
//      path still tears down the fresh stream.
//
// Stream/stdout delivery behavior is exercised by the higher-level
// claude-session-server tests; only shape + teardown are asserted here.

import { describe, it, expect, vi } from "vitest";
import type { Client } from "ssh2";
import { tailSessionFile } from "./session-file-tail.js";

// Minimal ssh2 ClientChannel stub — the exec callback receives an object
// that must expose `on(event, cb)`, `stderr.on(event, cb)`, and optional
// `close`/`end`/`signal`. Callers can pass a shared `order` array to record
// invocation ordering for teardown assertions (Test C), or supply a
// custom `signalImpl` to force a throw (Test D).
function makeStreamStub(opts?: {
  order?: string[];
  signalImpl?: (signal: string) => void;
}): {
  on: ReturnType<typeof vi.fn>;
  stderr: { on: ReturnType<typeof vi.fn> };
  close: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  signal: ReturnType<typeof vi.fn>;
} {
  const order = opts?.order;
  return {
    on: vi.fn(),
    stderr: { on: vi.fn() },
    close: vi.fn(() => {
      if (order) order.push("close");
    }),
    end: vi.fn(),
    signal: vi.fn((sig: string) => {
      if (order) order.push(`signal:${sig}`);
      if (opts?.signalImpl) opts.signalImpl(sig);
    }),
  };
}

// Build a fake ssh2 Client whose `exec` is a spy. By default the spy
// invokes the callback synchronously so the helper's internal wiring runs
// to completion. If `deferCallback` is true, the spy records the callback
// on the returned object and does NOT invoke it — the test drives the
// callback manually to exercise the stopped-before-exec-callback branch.
function makeConnStub(opts?: {
  stream?: ReturnType<typeof makeStreamStub>;
  deferCallback?: boolean;
}): {
  conn: Client;
  execSpy: ReturnType<typeof vi.fn>;
  stream: ReturnType<typeof makeStreamStub>;
  pendingCallback: {
    invoke: (err: Error | null, s?: unknown) => void;
  };
} {
  const stream = opts?.stream ?? makeStreamStub();
  let capturedCb: ((err: Error | null, s: unknown) => void) | null = null;
  const execSpy = vi.fn(
    (_cmd: string, cb: (err: Error | null, s: unknown) => void): void => {
      if (opts?.deferCallback) {
        capturedCb = cb;
        return;
      }
      cb(null, stream);
    },
  );
  const conn = { exec: execSpy } as unknown as Client;
  return {
    conn,
    execSpy,
    stream,
    pendingCallback: {
      invoke: (err, s) => {
        if (!capturedCb) throw new Error("no deferred exec callback captured");
        capturedCb(err, s ?? stream);
      },
    },
  };
}

describe("tailSessionFile — command shape", () => {
  // ── Test A (COMMAND SHAPE — trap-wrapper + stdin blocker) ────────────
  // The 4-arg call MUST invoke a POSIX `sh -c` wrapper around `tail -F`
  // that:
  //   (B) traps EXIT/INT/HUP/TERM so a delivered signal kills tail, AND
  //   (C) blocks on `read -r _` after backgrounding tail so channel-close
  //       EOFs stdin and unblocks even when the JSONL is idle and the
  //       server doesn't propagate SIGHUP (mindrot #1424).
  // Asserted via multiple `toContain`/`toMatch` calls so future escaping
  // tweaks don't over-constrain the shape.
  it("Test A: emits a `sh -c` trap-wrapper with stdin blocker around `tail -F -n +1 <path>`", () => {
    const { conn, execSpy } = makeConnStub();
    const onLine = vi.fn();
    const onError = vi.fn();

    tailSessionFile(conn, "/tmp/session.jsonl", onLine, onError);

    expect(execSpy).toHaveBeenCalledTimes(1);
    const cmd = execSpy.mock.calls[0][0] as string;
    expect(cmd).toContain("sh -c");
    expect(cmd).toContain("trap ");
    expect(cmd).toContain("EXIT INT HUP TERM");
    expect(cmd).toContain("tail -F -n +1 ");
    expect(cmd).toContain("'/tmp/session.jsonl'");
    // Background PID capture — allow any whitespace between the `&` and
    // the `t=$!` assignment.
    expect(cmd).toMatch(/&\s*t=\$!\s*;/);
    // Prong C: `read -r _` blocks on stdin between backgrounding tail
    // and the explicit teardown.
    expect(cmd).toContain("read -r _");
    // After `read` returns (EOF or signal), we kill and reap the tail
    // explicitly rather than relying on the trap alone.
    expect(cmd).toMatch(/kill\s+\$t\b[^;]*;\s*wait\s+\$t/);
    // Ordering: read must come AFTER t=$! (so tail is running before we
    // block) and BEFORE the explicit kill (so we only tear down after
    // stdin has EOFed or a signal has fired). Note: there's a second
    // `kill $t` inside the trap definition — skip past `read -r _` when
    // looking for the standalone teardown kill.
    const tSetIdx = cmd.indexOf("t=$!");
    const readIdx = cmd.indexOf("read -r _");
    const killIdx = cmd.indexOf("kill $t", readIdx);
    expect(tSetIdx).toBeGreaterThan(-1);
    expect(readIdx).toBeGreaterThan(tSetIdx);
    expect(killIdx).toBeGreaterThan(readIdx);
  });

  // ── Test B (PATH ESCAPING preserved) ────────────────────────────────
  // Single-quote in path must remain escaped via the local `shellEscape`
  // helper. The wrapper wraps the escaped path in a new `sh -c` context;
  // the escaped path substring must appear verbatim inside the command.
  it("Test B: path escaping preserved for paths containing a single quote", () => {
    const trickyPath = "/tmp/sess'ion.jsonl";
    // POSIX shellEscape: `'sess'\''ion.jsonl'` — every `'` becomes `'\''`.
    const expectedEscaped = "'/tmp/sess'\\''ion.jsonl'";

    const { conn, execSpy } = makeConnStub();
    tailSessionFile(conn, trickyPath, vi.fn(), vi.fn());
    const cmd = execSpy.mock.calls[0][0] as string;
    expect(cmd).toContain(expectedEscaped);
    // And still inside the trap wrapper.
    expect(cmd).toContain("sh -c");
    expect(cmd).toContain("tail -F -n +1 ");
  });
});

describe("tailSessionFile — teardown", () => {
  // ── Test C (SIGNAL BEFORE CLOSE) ─────────────────────────────────────
  // `stop()` must call `signal("TERM")` before `close()`. Some ssh
  // servers (Tailscale SSH) honor channel-signal requests; OpenSSH does
  // not, but sending it is free and unlocks a fast-teardown path where
  // supported. Ordering is asserted via a shared invocation-order array
  // and via vitest's `mock.invocationCallOrder`.
  it("Test C: stop() calls signal(\"TERM\") before close()", () => {
    const order: string[] = [];
    const stream = makeStreamStub({ order });
    const { conn } = makeConnStub({ stream });

    const handle = tailSessionFile(conn, "/tmp/session.jsonl", vi.fn(), vi.fn());
    handle.stop();

    expect(stream.signal).toHaveBeenCalledTimes(1);
    expect(stream.signal).toHaveBeenCalledWith("TERM");
    expect(stream.close).toHaveBeenCalledTimes(1);
    // Order-array assertion.
    expect(order).toEqual(["signal:TERM", "close"]);
    // Belt-and-suspenders: vitest invocation call order.
    expect(stream.signal.mock.invocationCallOrder[0]).toBeLessThan(
      stream.close.mock.invocationCallOrder[0],
    );
  });

  // ── Test D (SIGNAL THROWS — close still called) ──────────────────────
  // Some ssh2 versions / server combos throw synchronously when the
  // channel does not support the signal request. `stop()` must catch
  // the throw, log it, and still call `close()` — otherwise a broken
  // signal path leaves the channel open and defeats the whole fix.
  it("Test D: stop() catches a throw from signal() and still calls close()", () => {
    const stream = makeStreamStub({
      signalImpl: () => {
        throw new Error("channel signal unsupported");
      },
    });
    const { conn } = makeConnStub({ stream });

    const handle = tailSessionFile(conn, "/tmp/session.jsonl", vi.fn(), vi.fn());
    expect(() => handle.stop()).not.toThrow();
    expect(stream.signal).toHaveBeenCalledTimes(1);
    expect(stream.close).toHaveBeenCalledTimes(1);
  });

  // ── Test E (IDEMPOTENT) ──────────────────────────────────────────────
  // Regression control on the `if (stopped) return;` guard. Two stop()
  // calls in a row must not double-signal or double-close.
  it("Test E: stop() is idempotent — second call is a no-op", () => {
    const stream = makeStreamStub();
    const { conn } = makeConnStub({ stream });

    const handle = tailSessionFile(conn, "/tmp/session.jsonl", vi.fn(), vi.fn());
    handle.stop();
    handle.stop();

    expect(stream.signal.mock.calls.length).toBeLessThanOrEqual(1);
    expect(stream.close.mock.calls.length).toBeLessThanOrEqual(1);
  });

  // ── Test F (STOPPED-BEFORE-EXEC-CALLBACK) ────────────────────────────
  // Regression control on the `if (stopped)` guard inside the exec
  // callback: if the caller stops before the ssh2 exec callback fires,
  // the fresh stream must be closed and NO data listener may be wired.
  it("Test F: stopped before exec callback — fresh stream still torn down, no data listener wired", () => {
    const stream = makeStreamStub();
    const { conn, pendingCallback } = makeConnStub({
      stream,
      deferCallback: true,
    });

    const handle = tailSessionFile(conn, "/tmp/session.jsonl", vi.fn(), vi.fn());
    // Caller stops before the exec callback runs.
    handle.stop();
    // Now the ssh2 exec callback finally fires with the fresh stream.
    pendingCallback.invoke(null, stream);

    // The exec-callback guard must have run: close on the fresh stream,
    // no `on("data", ...)` wired.
    expect(stream.close).toHaveBeenCalledTimes(1);
    expect(stream.on).not.toHaveBeenCalled();
    expect(stream.stderr.on).not.toHaveBeenCalled();
  });
});
