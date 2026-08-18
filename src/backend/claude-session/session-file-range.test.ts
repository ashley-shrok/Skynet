// Vitest coverage for readSessionFileRange + resolveEventIdToLine — the two
// new one-shot backend helpers Wave 2's `handleFetchOlder` WS handler will call
// in sequence (a) resolve anchorEventId → line number via grep, (b) compute
// [startLine, endLine], (c) read the line slice via sed.
//
// Wire contract locked (planner revision): the client sends ONLY
// `{anchorEventId, count}` — no anchorLine field. The server does the
// eventId→line lookup on demand, so BOTH helpers must land in 43-02 as
// separate exports.
//
// Both helpers mirror the shape of `context-pct-from-jsonl.ts` exactly:
//   - one-shot execCommand via ../ssh/tmux-helper.js
//   - Promise.race timeout at 3000ms
//   - try/catch → return null on any failure (never throw)
//   - single-quote wrap the path (upstream-validated sessionFile per
//     discoverClaudeSession)
//
// Eleven documented behaviors (six for readSessionFileRange, five for
// resolveEventIdToLine) — each `it` block MUST fail against the missing
// source module (module-resolution error counts as red until Task 2 lands).

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  readSessionFileRange,
  resolveEventIdToLine,
} from "./session-file-range.js";

// Mock the tmux-helper module — same pattern as context-pct-from-jsonl.test.ts.
// queryPanePid + queryPaneCurrentCommand + queryNewestTmuxSession included in
// the factory to match the module contract used elsewhere; only execCommand
// is exercised by the range helpers.
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
  queryPanePid: vi.fn(),
  queryPaneCurrentCommand: vi.fn(),
  queryNewestTmuxSession: vi.fn(),
}));

import { execCommand } from "../ssh/tmux-helper.js";

// Stub ssh2 Client — execCommand is mocked, so conn is never accessed.
const fakeConn = {} as import("ssh2").Client;

const FAKE_SESSION_FILE =
  "/home/ubuntu/.claude/projects/-fake-slug/fake-session.jsonl";

// Build a JSONL "output" string from an array of line objects/strings.
// Objects are JSON.stringified; strings are inserted verbatim (for
// malformed-line coverage). Joined with \n — mirrors the shape sed would
// return.
function buildLines(lines: Array<Record<string, unknown> | string>): string {
  return lines
    .map((l) => (typeof l === "string" ? l : JSON.stringify(l)))
    .join("\n");
}

// A minimal valid user-turn line — parseSessionLine returns kind:"message".
function validUserLine(uuid: string): Record<string, unknown> {
  return {
    type: "user",
    uuid,
    timestamp: "2026-08-18T00:00:00.000Z",
    message: { content: "hello from user" },
  };
}

// A skip-kind line — `type:"summary"` is not user/assistant/attachment, so
// parseSessionLine returns { kind: "skip", why: "summary" }.
function skipLine(): Record<string, unknown> {
  return { type: "summary", summary: "conversation summary" };
}

describe("readSessionFileRange", () => {
  afterEach(() => {
    vi.mocked(execCommand).mockReset();
  });

  // ── Test 1 (command shape) ─────────────────────────────────────────────
  // Calling readSessionFileRange with a bounded [100, 149] range invokes
  // execCommand with the exact `sed -n '100,149p' '<path>'` shell command.
  it("Test 1: constructs `sed -n 'M,Np' '<path>'` shell command exactly", async () => {
    vi.mocked(execCommand).mockResolvedValue("");
    await readSessionFileRange(fakeConn, "/tmp/session.jsonl", 100, 149);
    expect(execCommand).toHaveBeenCalledTimes(1);
    expect(vi.mocked(execCommand).mock.calls[0][1]).toBe(
      "sed -n '100,149p' '/tmp/session.jsonl'",
    );
  });

  // ── Test 2 (parse + skip filter) ────────────────────────────────────────
  // Three JSONL lines: valid message, skip-kind, malformed. Expected return
  // array has length 2 (skip dropped, malformed retained as kind:"malformed").
  it("Test 2: parses each line through parseSessionLine and drops kind='skip'", async () => {
    const output = buildLines([
      validUserLine("uuid-1"),
      skipLine(),
      "{not valid json",
    ]);
    vi.mocked(execCommand).mockResolvedValue(output);

    const result = await readSessionFileRange(
      fakeConn,
      FAKE_SESSION_FILE,
      1,
      3,
    );
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    // Kinds present: message + malformed. Skip filtered out.
    const kinds = result!.map((p) => p.kind).sort();
    expect(kinds).toEqual(["malformed", "message"]);
    // Explicit: no skip kind survived.
    expect(result!.some((p) => p.kind === "skip")).toBe(false);
  });

  // ── Test 3 (invalid range → null WITHOUT exec) ──────────────────────────
  // startLine <= 0, endLine < startLine, and (endLine - startLine) >= 10000
  // all return null. execCommand call count MUST stay at 0 across all three.
  it("Test 3: rejects invalid ranges (start<=0, end<start, span >= 10000) with null and NO exec", async () => {
    vi.mocked(execCommand).mockResolvedValue("");

    const r1 = await readSessionFileRange(fakeConn, FAKE_SESSION_FILE, 0, 10);
    expect(r1).toBeNull();

    const r2 = await readSessionFileRange(
      fakeConn,
      FAKE_SESSION_FILE,
      100,
      50,
    );
    expect(r2).toBeNull();

    const r3 = await readSessionFileRange(
      fakeConn,
      FAKE_SESSION_FILE,
      1,
      20000,
    );
    expect(r3).toBeNull();

    // Also cover negative start explicitly.
    const r4 = await readSessionFileRange(
      fakeConn,
      FAKE_SESSION_FILE,
      -5,
      10,
    );
    expect(r4).toBeNull();

    expect(execCommand).toHaveBeenCalledTimes(0);
  });

  // ── Test 4 (timeout → null) ─────────────────────────────────────────────
  // execCommand returns a Promise that never resolves. The helper must
  // resolve to null after the internal 3000ms Promise.race timeout. Use
  // vi.useFakeTimers + vi.advanceTimersByTimeAsync to drive the clock.
  it("Test 4: returns null on Promise.race timeout (3000ms)", async () => {
    vi.useFakeTimers();
    try {
      // Never-resolving promise so the timeout branch wins.
      vi.mocked(execCommand).mockReturnValue(new Promise<string>(() => {}));

      const pending = readSessionFileRange(
        fakeConn,
        FAKE_SESSION_FILE,
        1,
        50,
      );
      // Advance past the timeout budget + a small buffer.
      await vi.advanceTimersByTimeAsync(3100);
      const result = await pending;
      expect(result).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Test 5 (exec rejects → null) ────────────────────────────────────────
  // SSH-side error propagates as a rejected promise; helper swallows and
  // returns null — no throw escapes.
  it("Test 5: returns null when execCommand rejects (SSH exec error)", async () => {
    vi.mocked(execCommand).mockRejectedValue(new Error("ssh dropped"));

    const result = await readSessionFileRange(
      fakeConn,
      FAKE_SESSION_FILE,
      1,
      50,
    );
    expect(result).toBeNull();
  });

  // ── Test 6 (path escaping — single-quote wrap, no embedded-quote sanitize) ─
  // Same convention as context-pct-from-jsonl.ts L82: single-quote wrap the
  // path without sanitizing embedded single quotes. sessionFile is validated
  // upstream by discoverClaudeSession, so this is sufficient. Assert the
  // constructed command contains `'/tmp/sess'ion.jsonl'` literally.
  it("Test 6: single-quote wraps the path (no embedded-quote sanitization — upstream-validated)", async () => {
    vi.mocked(execCommand).mockResolvedValue("");
    await readSessionFileRange(
      fakeConn,
      "/tmp/sess'ion.jsonl",
      10,
      20,
    );
    expect(execCommand).toHaveBeenCalledTimes(1);
    const cmd = vi.mocked(execCommand).mock.calls[0][1];
    expect(cmd).toBe("sed -n '10,20p' '/tmp/sess'ion.jsonl'");
    // Defense-in-depth: the wrap literal is present verbatim.
    expect(cmd).toContain("'/tmp/sess'ion.jsonl'");
  });
});

describe("resolveEventIdToLine", () => {
  afterEach(() => {
    vi.mocked(execCommand).mockReset();
  });

  // ── Test 7 (command shape) ──────────────────────────────────────────────
  // Calling resolveEventIdToLine with a normal uuid invokes execCommand with
  // the exact `grep -n '"uuid":"<eventId>"' '<path>' | head -1 | cut -d: -f1`
  // shell command.
  it("Test 7: constructs `grep -n '\"uuid\":\"<id>\"' '<path>' | head -1 | cut -d: -f1` exactly", async () => {
    vi.mocked(execCommand).mockResolvedValue("");
    await resolveEventIdToLine(
      fakeConn,
      "/tmp/session.jsonl",
      "abc-123-uuid",
    );
    expect(execCommand).toHaveBeenCalledTimes(1);
    expect(vi.mocked(execCommand).mock.calls[0][1]).toBe(
      `grep -n '"uuid":"abc-123-uuid"' '/tmp/session.jsonl' | head -1 | cut -d: -f1`,
    );
  });

  // ── Test 8 (happy path — parse integer line number) ─────────────────────
  // grep-then-cut returns a trailing-newline integer. Helper parses via
  // Number.parseInt(trimmed, 10) and returns the positive int.
  it("Test 8: parses '1234\\n' from grep-then-cut into integer 1234", async () => {
    vi.mocked(execCommand).mockResolvedValue("1234\n");

    const result = await resolveEventIdToLine(
      fakeConn,
      FAKE_SESSION_FILE,
      "some-uuid",
    );
    expect(result).toBe(1234);
  });

  // ── Test 9 (not-found → null; also nonzero-exit-with-empty-stdout → null) ─
  // grep matched nothing → head-1 empty → cut empty → helper returns null,
  // NOT throw. Also cover the nonzero-exit / empty-stdout case (grep returns
  // 1 on no match; the tmux-helper execCommand contract rejects on nonzero
  // exit only when stdout is empty — the helper's try/catch swallows the
  // rejection and returns null just as it does in the happy-empty case).
  it("Test 9: returns null when grep found nothing (empty stdout OR nonzero-exit-with-empty)", async () => {
    // Sub-case: exec succeeded with empty stdout.
    vi.mocked(execCommand).mockResolvedValueOnce("");
    const r1 = await resolveEventIdToLine(
      fakeConn,
      FAKE_SESSION_FILE,
      "not-in-file",
    );
    expect(r1).toBeNull();

    // Sub-case: exec rejected because grep exited nonzero + stdout empty
    // (the execCommand contract on L43-46 of tmux-helper.ts). Helper swallows.
    vi.mocked(execCommand).mockRejectedValueOnce(
      new Error("Command exited with code 1"),
    );
    const r2 = await resolveEventIdToLine(
      fakeConn,
      FAKE_SESSION_FILE,
      "not-in-file",
    );
    expect(r2).toBeNull();
  });

  // ── Test 10 (invalid eventId rejects WITHOUT exec) ──────────────────────
  // Empty-string eventId returns null with zero exec calls. Also — defense
  // in depth for shell-injection: eventId containing `'` returns null WITHOUT
  // exec (the helper does NOT sanitize; it treats the id as unresolvable).
  it("Test 10: rejects invalid eventIds (empty, single-quote) with null and NO exec", async () => {
    vi.mocked(execCommand).mockResolvedValue("");

    const r1 = await resolveEventIdToLine(
      fakeConn,
      FAKE_SESSION_FILE,
      "",
    );
    expect(r1).toBeNull();

    const r2 = await resolveEventIdToLine(
      fakeConn,
      FAKE_SESSION_FILE,
      "abc'123",
    );
    expect(r2).toBeNull();

    expect(execCommand).toHaveBeenCalledTimes(0);
  });

  // ── Test 11 (timeout / exec error → null; same posture) ─────────────────
  // Both the Promise.race timeout branch and an execCommand rejection lead
  // to null — never throw. Fake-timer path drives the timeout deterministically.
  it("Test 11: returns null on Promise.race timeout AND on execCommand rejection", async () => {
    // Sub-case A: rejection.
    vi.mocked(execCommand).mockRejectedValueOnce(
      new Error("ssh connection dropped"),
    );
    const rReject = await resolveEventIdToLine(
      fakeConn,
      FAKE_SESSION_FILE,
      "some-uuid",
    );
    expect(rReject).toBeNull();

    // Sub-case B: timeout via fake timers + never-resolving exec.
    vi.useFakeTimers();
    try {
      vi.mocked(execCommand).mockReturnValueOnce(
        new Promise<string>(() => {}),
      );
      const pending = resolveEventIdToLine(
        fakeConn,
        FAKE_SESSION_FILE,
        "some-uuid",
      );
      await vi.advanceTimersByTimeAsync(3100);
      const rTimeout = await pending;
      expect(rTimeout).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
