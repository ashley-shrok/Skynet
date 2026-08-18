// Vitest coverage for tailSessionFile — the primary ssh2-exec `tail -F`
// helper the WS emission channel uses to stream JSONL frames as they land.
//
// The tail command shape is fixed at `tail -F -n +1 <escaped-path>` for
// every caller — no parameterization, no bounded-initial-slice branch.
// These tests lock:
//   1. The exact shell command string handed to `conn.exec` (byte-for-byte).
//   2. Path escaping via the local `shellEscape` helper (single-quote path).
//
// Stream/stdout delivery behavior is exercised by the higher-level
// claude-session-server tests; only the command-string shape is asserted
// here.

import { describe, it, expect, vi } from "vitest";
import type { Client } from "ssh2";
import { tailSessionFile } from "./session-file-tail.js";

// Minimal ssh2 ClientChannel stub — the exec callback receives an object
// that must expose `on(event, cb)`, `stderr.on(event, cb)`, and optional
// `close`/`end`/`signal`. The tests never drive stdout; they only assert on
// the command string passed to exec.
function makeStreamStub(): {
  on: ReturnType<typeof vi.fn>;
  stderr: { on: ReturnType<typeof vi.fn> };
  close: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  signal: ReturnType<typeof vi.fn>;
} {
  return {
    on: vi.fn(),
    stderr: { on: vi.fn() },
    close: vi.fn(),
    end: vi.fn(),
    signal: vi.fn(),
  };
}

// Build a fake ssh2 Client whose `exec` is a spy. The spy records the
// command string and immediately invokes the callback with (null, stream)
// so the helper's internal wiring runs to completion.
function makeConnStub(): {
  conn: Client;
  execSpy: ReturnType<typeof vi.fn>;
} {
  const stream = makeStreamStub();
  const execSpy = vi.fn(
    (
      _cmd: string,
      cb: (err: Error | null, stream: unknown) => void,
    ): void => {
      cb(null, stream);
    },
  );
  const conn = { exec: execSpy } as unknown as Client;
  return { conn, execSpy };
}

describe("tailSessionFile — command shape", () => {
  // ── Test 1 (BACKCOMPAT) ──────────────────────────────────────────────
  // The 4-arg call MUST invoke `tail -F -n +1 <escaped-path>` byte-for-byte.
  // Every caller passes exactly these 4 args; there is no override.
  it("Test 1: emits `tail -F -n +1 <path>` for a simple path", () => {
    const { conn, execSpy } = makeConnStub();
    const onLine = vi.fn();
    const onError = vi.fn();

    tailSessionFile(conn, "/tmp/session.jsonl", onLine, onError);

    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(execSpy.mock.calls[0][0]).toBe(
      "tail -F -n +1 '/tmp/session.jsonl'",
    );
  });

  // ── Test 2 (PATH ESCAPING) ───────────────────────────────────────────
  // Single-quote in path must be escaped via the local `shellEscape` helper.
  // The exact byte-for-byte assertion locks both the command shape AND the
  // escape sequence.
  it("Test 2: path escaping preserved for paths containing a single quote", () => {
    const trickyPath = "/tmp/sess'ion.jsonl";
    // POSIX shellEscape: 'sess'\''ion.jsonl' pattern — every `'` becomes
    // `'\''`. See session-file-tail.ts:27-29.
    const expectedEscaped = "'/tmp/sess'\\''ion.jsonl'";

    const { conn, execSpy } = makeConnStub();
    tailSessionFile(conn, trickyPath, vi.fn(), vi.fn());
    expect(execSpy.mock.calls[0][0]).toBe(
      `tail -F -n +1 ${expectedEscaped}`,
    );
  });
});
