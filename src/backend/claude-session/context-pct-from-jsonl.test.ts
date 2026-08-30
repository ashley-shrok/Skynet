// Vitest coverage for readContextPctFromJsonl — the new PRIMARY context-%
// source (JSONL session file read, authoritative). It replaces the tmux
// capture-pane scrape (context-pct-parser.ts) as the primary path because
// pane-scrape becomes unreliable at narrow pane widths on mobile PWA (bar
// glyphs get truncated → parseContextPct returns null → meter freezes).
// parseContextPct is preserved as the fallback path when no sessionFile is
// resolved yet or the JSONL has no assistant turn yet.

import { describe, it, expect, vi, afterEach } from "vitest";
import { readContextPctFromJsonl } from "./context-pct-from-jsonl.js";

// Mock the tmux-helper module. queryPanePid and queryPaneCurrentCommand are
// included in the factory to match the module contract used elsewhere; only
// execCommand is exercised by this helper.
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
  queryPanePid: vi.fn(),
  queryPaneCurrentCommand: vi.fn(),
}));

// quick-260830-f1e — mock sshLogger so the new warn paths are silent and
// assertable. Full logger surface mocked (mirrors adjacent test files) so
// transitive imports don't blow up.
vi.mock("../utils/logger.js", () => {
  const makeLogger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  });
  const systemLogger = makeLogger();
  return {
    sshLogger: makeLogger(),
    authLogger: makeLogger(),
    databaseLogger: makeLogger(),
    apiLogger: makeLogger(),
    systemLogger,
    fileLogger: makeLogger(),
    statsLogger: makeLogger(),
    tunnelLogger: makeLogger(),
    dashboardLogger: makeLogger(),
    guacLogger: makeLogger(),
    versionLogger: makeLogger(),
    logger: systemLogger,
    setGlobalLogLevel: vi.fn(),
    getGlobalLogLevel: vi.fn(() => "info"),
  };
});

import { execCommand } from "../ssh/tmux-helper.js";
import { sshLogger } from "../utils/logger.js";

// Stub ssh2 Client — execCommand is mocked so conn is never accessed.
const fakeConn = {} as import("ssh2").Client;

const FAKE_SESSION_FILE =
  "/home/ubuntu/.claude/projects/-fake-slug/fake-session.jsonl";

// Build a single JSONL "tail" string from an array of line objects/strings.
// Objects are JSON.stringify'd; strings are inserted verbatim (used for
// malformed-line coverage). Joined with \n.
function buildTail(lines: Array<Record<string, unknown> | string>): string {
  return lines
    .map((l) => (typeof l === "string" ? l : JSON.stringify(l)))
    .join("\n");
}

describe("readContextPctFromJsonl", () => {
  afterEach(() => {
    vi.mocked(execCommand).mockReset();
    vi.mocked(sshLogger.warn).mockReset();
  });

  // ── Case (a) HAPPY PATH ─────────────────────────────────────────────────
  // Empirical measurement for session e222905c (2026-08-08):
  //   sum = input(1) + cc(2182) + cr(196359) + out is NOT in sum here
  //       (the helper spec uses input + cache_creation + cache_read only —
  //        output_tokens is not included per gsd-statusline.js). sum = 198542.
  //   remaining_pct = 100 - 198542/1_000_000 * 100 = 80.1458
  //   usable_remaining = max(0, (80.1458 - 16.5) / (100 - 16.5) * 100)
  //                    = (63.6458 / 83.5) * 100 = 76.2225…
  //   displayed = round(100 - 76.2225…) = round(23.7774…) = 24
  it("CASE a: HAPPY PATH — single assistant turn with usage → 24", async () => {
    const tail = buildTail([
      {
        type: "assistant",
        message: {
          usage: {
            input_tokens: 1,
            cache_creation_input_tokens: 2182,
            cache_read_input_tokens: 196359,
            output_tokens: 1599,
          },
        },
      },
    ]);
    vi.mocked(execCommand).mockResolvedValue(tail);

    const result = await readContextPctFromJsonl(fakeConn, FAKE_SESSION_FILE);
    expect(result).toBe(24);
  });

  // ── Case (b) NO ASSISTANT TURN ─────────────────────────────────────────
  // Reverse-scan iterates the full tail. Only user / tool_result lines
  // present → no assistant turn with usage found → iterative expansion
  // exhausts all 4 steps → return null with `no_asst_usage` warn.
  it("CASE b: no assistant turn in tail → null (schedule exhausted, no_asst_usage warn)", async () => {
    const tail = buildTail([
      { type: "user", message: { content: "hello" } },
      { type: "tool_result", tool_use_id: "abc", content: "result" },
    ]);
    vi.mocked(execCommand).mockResolvedValue(tail);

    const result = await readContextPctFromJsonl(fakeConn, FAKE_SESSION_FILE);
    expect(result).toBeNull();
    // quick-260830-f1e — schedule exhausts to MAX_TAIL_BYTES (512_000).
    expect(vi.mocked(execCommand)).toHaveBeenCalledTimes(4);
    expect(sshLogger.warn).toHaveBeenCalledWith(
      "context-pct: no assistant usage turn found within max tail bytes",
      expect.objectContaining({
        operation: "context_pct_no_asst_usage",
        maxTailBytes: 512_000,
      }),
    );
  });

  // ── Case (c) ASSISTANT WITHOUT USAGE ────────────────────────────────────
  // Reverse-scan must NOT count a usage-less assistant turn as a match.
  // Same iterative behavior as case b — exhaust schedule + no_asst_usage warn.
  it("CASE c: assistant turn without message.usage → null (schedule exhausted)", async () => {
    const tail = buildTail([
      { type: "assistant", message: { content: "hi" } },
    ]);
    vi.mocked(execCommand).mockResolvedValue(tail);

    const result = await readContextPctFromJsonl(fakeConn, FAKE_SESSION_FILE);
    expect(result).toBeNull();
    expect(vi.mocked(execCommand)).toHaveBeenCalledTimes(4);
  });

  // ── Case (d) EXEC THROWS ────────────────────────────────────────────────
  // SSH exec rejects — helper must swallow, warn (`exec_throw`), return null.
  // Bails on first throw — retrying wider won't fix a broken exec channel.
  it("CASE d: execCommand rejects (SSH exec channel error) → null (exec_throw warn, no retry)", async () => {
    vi.mocked(execCommand).mockRejectedValue(
      new Error("SSH exec channel error"),
    );

    const result = await readContextPctFromJsonl(fakeConn, FAKE_SESSION_FILE);
    expect(result).toBeNull();
    // quick-260830-f1e — exec throw is a hard bail (no retry with wider tail).
    expect(vi.mocked(execCommand)).toHaveBeenCalledTimes(1);
    expect(sshLogger.warn).toHaveBeenCalledWith(
      "context-pct: exec threw",
      expect.objectContaining({
        operation: "context_pct_exec_throw",
        tailStepBytes: 10_000,
      }),
    );
  });

  // ── Case (e) BOUNDARY AT 16.5% ──────────────────────────────────────────
  // sum = 835_000 → remaining_pct = 100 - 83.5 = 16.5 exactly.
  // usable_remaining = max(0, ((16.5 - 16.5) / 83.5) * 100) = 0
  // displayed = round(100 - 0) = 100
  it("CASE e: boundary at 16.5% autocompact buffer → 100", async () => {
    const tail = buildTail([
      {
        type: "assistant",
        message: {
          usage: {
            input_tokens: 835_000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
    ]);
    vi.mocked(execCommand).mockResolvedValue(tail);

    const result = await readContextPctFromJsonl(fakeConn, FAKE_SESSION_FILE);
    expect(result).toBe(100);
  });

  // ── Case (f) OVER-FULL CLAMP ────────────────────────────────────────────
  // sum = 1_500_000 → remaining_pct = -50 → (before clamp)
  // usable_remaining = ((-50 - 16.5) / 83.5) * 100 = -79.64…
  // Math.max(0, ...) clamps to 0 → displayed = round(100 - 0) = 100
  it("CASE f: over-full context (sum > 1M tokens) clamped → 100", async () => {
    const tail = buildTail([
      {
        type: "assistant",
        message: {
          usage: {
            input_tokens: 1_500_000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
    ]);
    vi.mocked(execCommand).mockResolvedValue(tail);

    const result = await readContextPctFromJsonl(fakeConn, FAKE_SESSION_FILE);
    expect(result).toBe(100);
  });

  // ── Case (g) MULTIPLE ASSISTANT TURNS — LAST WINS ───────────────────────
  // First (older) assistant sum=100_000 (would give different pct).
  // Second (newer) assistant with the case-a numbers (sum=198_542) → 24.
  // Reverse-scan must short-circuit on FIRST match from the end.
  it("CASE g: multiple assistant turns — last one wins → 24", async () => {
    const tail = buildTail([
      {
        type: "assistant",
        message: {
          usage: {
            input_tokens: 100_000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
      { type: "user", message: { content: "next turn" } },
      {
        type: "assistant",
        message: {
          usage: {
            input_tokens: 1,
            cache_creation_input_tokens: 2182,
            cache_read_input_tokens: 196359,
            output_tokens: 1599,
          },
        },
      },
    ]);
    vi.mocked(execCommand).mockResolvedValue(tail);

    const result = await readContextPctFromJsonl(fakeConn, FAKE_SESSION_FILE);
    expect(result).toBe(24);
  });

  // ── Case (h) MALFORMED JSON LINES DON'T BREAK PARSING ───────────────────
  // Reverse iteration must skip garbage via try/catch on JSON.parse and
  // land on the newer valid assistant turn (case-a numbers) → 24.
  it("CASE h: malformed JSON lines are skipped, reverse-scan continues → 24", async () => {
    const tail = buildTail([
      {
        type: "assistant",
        message: {
          usage: {
            input_tokens: 100_000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
      "{not valid json",
      {
        type: "assistant",
        message: {
          usage: {
            input_tokens: 1,
            cache_creation_input_tokens: 2182,
            cache_read_input_tokens: 196359,
            output_tokens: 1599,
          },
        },
      },
    ]);
    vi.mocked(execCommand).mockResolvedValue(tail);

    const result = await readContextPctFromJsonl(fakeConn, FAKE_SESSION_FILE);
    expect(result).toBe(24);
  });

  // ── quick-260830-f1e — iterative tail expansion + loud null-return ─────
  //
  // Empirical root cause of blank context meter on dormant identities with
  // large JSONLs (Ashley UAT 2026-08-30): fixed 10 KB tail misses last
  // assistant usage turn when recent activity is dominated by tool_results
  // / long user messages / /exit echoes. Verified 4-for-4 on workstation
  // (Terry 1.16 MB, Pixie 1.29 MB, Holly 2.27 MB all had ZERO usage turns
  // in their last 10 KB).

  // Common case (unchanged from case a): 10 KB tail contains usage → ONE
  // exec call, no expansion, no warn.
  it("f1e CASE 1: 10 KB tail hits usage on first exec — one call, no warn", async () => {
    const tail = buildTail([
      {
        type: "assistant",
        message: {
          usage: {
            input_tokens: 1,
            cache_creation_input_tokens: 2182,
            cache_read_input_tokens: 196359,
          },
        },
      },
    ]);
    vi.mocked(execCommand).mockResolvedValue(tail);

    const result = await readContextPctFromJsonl(fakeConn, FAKE_SESSION_FILE);
    expect(result).toBe(24);
    expect(vi.mocked(execCommand)).toHaveBeenCalledTimes(1);
    // First call was `tail -c 10000 '…'`
    expect(vi.mocked(execCommand).mock.calls[0][1]).toContain("tail -c 10000");
    // No warn — happy path.
    expect(sshLogger.warn).not.toHaveBeenCalled();
  });

  // Iterative expansion succeeds at step 2 (50 KB): first call returns
  // usage-free tail, second call returns bytes with usage. TWO exec calls
  // with distinct `-c` sizes; no warn (function succeeded).
  it("f1e CASE 2: expansion succeeds at step 2 — two exec calls with 10k then 50k", async () => {
    const noUsageTail = buildTail([
      { type: "user", message: { content: "hello" } },
      { type: "tool_result", tool_use_id: "abc", content: "long result…" },
    ]);
    const usageTail = buildTail([
      {
        type: "assistant",
        message: {
          usage: {
            input_tokens: 1,
            cache_creation_input_tokens: 2182,
            cache_read_input_tokens: 196359,
          },
        },
      },
    ]);
    vi.mocked(execCommand)
      .mockResolvedValueOnce(noUsageTail)
      .mockResolvedValueOnce(usageTail);

    const result = await readContextPctFromJsonl(fakeConn, FAKE_SESSION_FILE);
    expect(result).toBe(24);
    expect(vi.mocked(execCommand)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(execCommand).mock.calls[0][1]).toContain("tail -c 10000");
    expect(vi.mocked(execCommand).mock.calls[1][1]).toContain("tail -c 50000");
    // No warn — expansion is silent success.
    expect(sshLogger.warn).not.toHaveBeenCalled();
  });

  // All 4 steps exhausted (each returns bytes but no usage turn) →
  // null + no_asst_usage warn. Verifies the ceiling meta.
  it("f1e CASE 3: all 4 steps exhausted — null returned + no_asst_usage warn with maxTailBytes:512_000", async () => {
    const noUsageTail = buildTail([
      { type: "user", message: { content: "hello" } },
      { type: "tool_result", tool_use_id: "abc", content: "result" },
    ]);
    vi.mocked(execCommand).mockResolvedValue(noUsageTail);

    const result = await readContextPctFromJsonl(fakeConn, FAKE_SESSION_FILE);
    expect(result).toBeNull();
    expect(vi.mocked(execCommand)).toHaveBeenCalledTimes(4);
    // Four distinct `-c` sizes fired in order.
    expect(vi.mocked(execCommand).mock.calls[0][1]).toContain("tail -c 10000");
    expect(vi.mocked(execCommand).mock.calls[1][1]).toContain("tail -c 50000");
    expect(vi.mocked(execCommand).mock.calls[2][1]).toContain("tail -c 200000");
    expect(vi.mocked(execCommand).mock.calls[3][1]).toContain("tail -c 512000");
    expect(sshLogger.warn).toHaveBeenCalledWith(
      "context-pct: no assistant usage turn found within max tail bytes",
      expect.objectContaining({
        operation: "context_pct_no_asst_usage",
        maxTailBytes: 512_000,
        sessionFileBasename: "fake-session.jsonl",
      }),
    );
  });

  // Exec fail (helper resolves null — SSH channel error) → single warn
  // (exec_fail) + return null. Does NOT proceed to next step: a null
  // return from exec means SSH failure, retrying with a wider tail won't
  // help.
  it("f1e CASE 4: exec resolves null (SSH failure) — one call, exec_fail warn, no retry", async () => {
    // @ts-expect-error — deliberately returning null to simulate SSH channel error
    vi.mocked(execCommand).mockResolvedValue(null);

    const result = await readContextPctFromJsonl(fakeConn, FAKE_SESSION_FILE);
    expect(result).toBeNull();
    expect(vi.mocked(execCommand)).toHaveBeenCalledTimes(1);
    expect(sshLogger.warn).toHaveBeenCalledWith(
      "context-pct: exec returned null (SSH failure or timeout)",
      expect.objectContaining({
        operation: "context_pct_exec_fail",
        tailStepBytes: 10_000,
        sessionFileBasename: "fake-session.jsonl",
      }),
    );
  });

  // Exec throw (rejects) → exec_throw warn + return null. Already covered
  // by updated CASE d, this test asserts the meta shape (err field carries
  // the error message).
  it("f1e CASE 5: exec throws — exec_throw warn carries err message in meta", async () => {
    vi.mocked(execCommand).mockRejectedValue(new Error("boom"));

    const result = await readContextPctFromJsonl(fakeConn, FAKE_SESSION_FILE);
    expect(result).toBeNull();
    expect(sshLogger.warn).toHaveBeenCalledWith(
      "context-pct: exec threw",
      expect.objectContaining({
        operation: "context_pct_exec_throw",
        tailStepBytes: 10_000,
        sessionFileBasename: "fake-session.jsonl",
        err: "boom",
      }),
    );
  });

  // Empty tail on first step → bail with empty_tail warn (no retry).
  // Rationale: `tail -c N` returning empty means the file is genuinely
  // empty or truncated; retrying with a wider N cannot recover bytes that
  // aren't there.
  it("f1e CASE 6: first step returns empty tail — bail with empty_tail warn (no retry)", async () => {
    vi.mocked(execCommand).mockResolvedValue("");

    const result = await readContextPctFromJsonl(fakeConn, FAKE_SESSION_FILE);
    expect(result).toBeNull();
    expect(vi.mocked(execCommand)).toHaveBeenCalledTimes(1);
    expect(sshLogger.warn).toHaveBeenCalledWith(
      "context-pct: exec succeeded but tail is empty",
      expect.objectContaining({
        operation: "context_pct_empty_tail",
        tailStepBytes: 10_000,
        sessionFileBasename: "fake-session.jsonl",
      }),
    );
  });
});
