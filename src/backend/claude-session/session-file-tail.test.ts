// Vitest coverage for tailSessionFile — the primary ssh2-exec `tail -F`
// helper the WS emission channel uses to stream JSONL frames as they land.
//
// Phase 43 introduces an optional `initialLines` parameter so callers can
// opt into a bounded-initial-slice (`tail -F -n N`) while every existing
// caller that does NOT opt in continues to get the current unbounded
// `tail -F -n +1` behavior byte-for-byte (backcompat mandated by
// .planning/phases/43-.../43-CONTEXT.md § "Backcompat / migration").
//
// These tests exercise the SHELL COMMAND STRING handed to `conn.exec` — not
// stdout delivery — because the tail semantic (start-at-line-1 vs
// start-at-last-N) is entirely encoded in that command's `-n` argument.
// Stream/stdout behavior is unchanged by Phase 43 and is not re-covered
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
  // Legacy 4-arg call site (no initialLines override) MUST continue to
  // invoke `tail -F -n +1 <escaped-path>` byte-for-byte. CONTEXT.md
  // `<decisions>` § "Backcompat / migration": legacy callers get the
  // current unbounded initial replay.
  it("Test 1: backcompat — no initialLines override emits `tail -F -n +1 <path>`", () => {
    const { conn, execSpy } = makeConnStub();
    const onLine = vi.fn();
    const onError = vi.fn();

    tailSessionFile(conn, "/tmp/session.jsonl", onLine, onError);

    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(execSpy.mock.calls[0][0]).toBe(
      "tail -F -n +1 '/tmp/session.jsonl'",
    );
  });

  // ── Test 2 (OVERRIDE HAPPY PATH) ─────────────────────────────────────
  // Opt-in override — planner picks 50 as the canonical mid-range value
  // (initial window `N` from CONTEXT.md is planner-picked ≥ ~50). The
  // command MUST use `-n 50` (no `+`, no other chars) so tail treats it
  // as "last 50 lines from end of file, then follow" instead of
  // "start at file line 50, then follow".
  it("Test 2: override — initialLines=50 emits `tail -F -n 50 <path>` (no `+`)", () => {
    const { conn, execSpy } = makeConnStub();
    const onLine = vi.fn();
    const onError = vi.fn();

    // Cast to `any` because Task 1 (RED) intentionally calls a signature
    // that does not yet exist on the source. Task 2 (GREEN) adds the
    // 5th optional parameter and the cast becomes redundant but harmless.
    (
      tailSessionFile as unknown as (
        c: Client,
        p: string,
        l: (s: string) => void,
        e: (err: Error) => void,
        n: number,
      ) => void
    )(conn, "/tmp/session.jsonl", onLine, onError, 50);

    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(execSpy.mock.calls[0][0]).toBe(
      "tail -F -n 50 '/tmp/session.jsonl'",
    );
  });

  // ── Test 3 (INVALID OVERRIDE COERCES TO DEFAULT) ─────────────────────
  // 0, negative, NaN, and absurdly-huge values MUST fall back to the
  // backcompat `-n +1` shape rather than passing a nonsense shell arg.
  // This mirrors the defense-in-depth already in place at the
  // parseInt/Number.isFinite validation for `historyWindow` documented in
  // 43-PATTERNS.md § 2 (backend WS handshake validator).
  it("Test 3: invalid initialLines (0, negative, NaN, huge) falls back to `-n +1`", () => {
    const invalidCases: Array<number> = [0, -5, Number.NaN, 1e12];

    for (const invalid of invalidCases) {
      const { conn, execSpy } = makeConnStub();
      const onLine = vi.fn();
      const onError = vi.fn();

      (
        tailSessionFile as unknown as (
          c: Client,
          p: string,
          l: (s: string) => void,
          e: (err: Error) => void,
          n: number,
        ) => void
      )(conn, "/tmp/session.jsonl", onLine, onError, invalid);

      expect(
        execSpy.mock.calls[0][0],
        `initialLines=${String(invalid)} should coerce to -n +1 default`,
      ).toBe("tail -F -n +1 '/tmp/session.jsonl'");
    }
  });

  // ── Test 4 (PATH ESCAPING PRESERVED) ─────────────────────────────────
  // Single-quote in path must be escaped identically in both the default
  // and override branches (via the same local `shellEscape` helper). The
  // Phase 43 parameterization must not regress escaping — asserting the
  // exact byte-for-byte command locks the shape.
  it("Test 4: path escaping preserved for paths containing a single quote", () => {
    const trickyPath = "/tmp/sess'ion.jsonl";
    // POSIX shellEscape: 'sess'\''ion.jsonl' pattern — every `'` becomes
    // `'\''`. See session-file-tail.ts:27-29.
    const expectedEscaped = "'/tmp/sess'\\''ion.jsonl'";

    // Default branch (no override) — must escape.
    {
      const { conn, execSpy } = makeConnStub();
      tailSessionFile(conn, trickyPath, vi.fn(), vi.fn());
      expect(execSpy.mock.calls[0][0]).toBe(
        `tail -F -n +1 ${expectedEscaped}`,
      );
    }

    // Override branch (initialLines=50) — must use IDENTICAL escaped path.
    {
      const { conn, execSpy } = makeConnStub();
      (
        tailSessionFile as unknown as (
          c: Client,
          p: string,
          l: (s: string) => void,
          e: (err: Error) => void,
          n: number,
        ) => void
      )(conn, trickyPath, vi.fn(), vi.fn(), 50);
      expect(execSpy.mock.calls[0][0]).toBe(
        `tail -F -n 50 ${expectedEscaped}`,
      );
    }
  });
});
