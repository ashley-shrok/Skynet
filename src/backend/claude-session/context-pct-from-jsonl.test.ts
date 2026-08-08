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

import { execCommand } from "../ssh/tmux-helper.js";

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
  // present → no assistant turn with usage found → return null.
  it("CASE b: no assistant turn in tail → null", async () => {
    const tail = buildTail([
      { type: "user", message: { content: "hello" } },
      { type: "tool_result", tool_use_id: "abc", content: "result" },
    ]);
    vi.mocked(execCommand).mockResolvedValue(tail);

    const result = await readContextPctFromJsonl(fakeConn, FAKE_SESSION_FILE);
    expect(result).toBeNull();
  });

  // ── Case (c) ASSISTANT WITHOUT USAGE ────────────────────────────────────
  // Reverse-scan must NOT count a usage-less assistant turn as a match.
  it("CASE c: assistant turn without message.usage → null", async () => {
    const tail = buildTail([
      { type: "assistant", message: { content: "hi" } },
    ]);
    vi.mocked(execCommand).mockResolvedValue(tail);

    const result = await readContextPctFromJsonl(fakeConn, FAKE_SESSION_FILE);
    expect(result).toBeNull();
  });

  // ── Case (d) EXEC THROWS ────────────────────────────────────────────────
  // SSH exec rejects — helper must swallow and return null, no throw
  // escapes.
  it("CASE d: execCommand rejects (SSH exec channel error) → null", async () => {
    vi.mocked(execCommand).mockRejectedValue(
      new Error("SSH exec channel error"),
    );

    const result = await readContextPctFromJsonl(fakeConn, FAKE_SESSION_FILE);
    expect(result).toBeNull();
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
});
