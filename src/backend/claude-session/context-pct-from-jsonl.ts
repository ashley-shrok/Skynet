import type { Client } from "ssh2";
import { execCommand } from "../ssh/tmux-helper.js";

/**
 * Read Claude Code's context-usage % directly from the JSONL session file
 * — the authoritative source Claude Code itself writes token usage to.
 *
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────
 * The tmux capture-pane scrape path (parseContextPct in
 * context-pct-parser.ts) becomes unreliable on Ashley's mobile PWA when
 * the browser collapses the pane to ~2 chars wide — the statusline pct
 * chars survive but the AND-anchored bar glyphs (█/░) get truncated so
 * parseContextPct returns null and the pretty-view meter freezes on the
 * last-known value. Reading directly from the JSONL is pane-width-
 * independent and future-proofs the meter against any statusline-format
 * changes upstream (JSONL is Claude Code's own wire format for token
 * accounting; pane scrape is a display-surface hack).
 *
 * NORMALIZATION (mirrors ~/.claude/hooks/gsd-statusline.js:306-318)
 * ─────────────────────────────────────────────────────────────────────
 * Claude Code reserves the last 16.5% of the context window as an
 * autocompact buffer. The displayed pct in the statusline is normalized
 * against the *usable* window, not the raw window. This helper applies
 * the same 16.5% normalization so the two meters stay aligned.
 *
 * MODEL WINDOW
 * ─────────────────────────────────────────────────────────────────────
 * 2026-08-08 Ashley lock: every model in the harness is 1M-token window.
 * We do NOT read CLAUDE_CODE_AUTO_COMPACT_WINDOW here — that's the hook's
 * concern; the helper stays on the fleet default.
 *
 * ROUNDING NOTE
 * ─────────────────────────────────────────────────────────────────────
 * This helper normalizes floats first then rounds only at display. Claude
 * Code's statusline rounds `remaining_percentage` to integer *before*
 * normalizing — so the two can differ by ±1 in the last digit. Empirical
 * 2026-08-08 = 5/8 exact + 3/8 off-by-1 across 8 live Opus-4.7 sessions.
 * Sub-1% precision is well below the 80% context-watch nudge threshold,
 * so the discrepancy is acceptable.
 *
 * FALLBACK PATH
 * ─────────────────────────────────────────────────────────────────────
 * context-pct-parser.ts remains the fallback path in the poll callback
 * for (a) hosts with no resolved sessionFile yet (before
 * discoverClaudeSession lands) and (b) fresh sessions where the JSONL
 * exists but contains no assistant turn yet (returns null → falls
 * through to pane-scrape).
 */

// Mirrors the same default in ~/.claude/hooks/gsd-statusline.js:312-314.
const AUTO_COMPACT_BUFFER_PCT = 16.5;

// 2026-08-08 fleet lock: every model in the harness is 1M-token window.
const MODEL_CONTEXT_WINDOW = 1_000_000;

// 10KB tail is plenty for the last few turns; small enough to keep the
// SSH round-trip fast (well under the 3s poll interval).
const TAIL_BYTES = 10_000;

// Matches session-file-discovery.ts's DISCOVERY_EXEC_TIMEOUT_MS — uniform
// error handling across the two poll callbacks that share this SSH conn.
const EXEC_TIMEOUT_MS = 3000;

/**
 * Tail the JSONL session file, reverse-scan for the last assistant turn
 * with usage, and return the autocompact-normalized displayed pct. Returns
 * null on any error, timeout, empty tail, no-assistant-turn-with-usage,
 * or exec failure — the caller falls back to parseContextPct(tmux
 * capture-pane) in that case.
 *
 * NEVER THROWS — all error paths return null.
 */
export async function readContextPctFromJsonl(
  conn: Client,
  sessionFile: string,
): Promise<number | null> {
  // Single-quote wrap for the path. sessionFile is validated upstream by
  // discoverClaudeSession (it's the exact path Claude Code's PID file
  // points to), so single-quote escape is sufficient. Same convention as
  // session-file-discovery.ts:228-230.
  const tailCmd = `tail -c ${TAIL_BYTES} '${sessionFile}'`;

  let tailOutput: string;
  try {
    tailOutput = await Promise.race([
      execCommand(conn, tailCmd),
      new Promise<string>((_, reject) =>
        setTimeout(
          () => reject(new Error(`tail timeout after ${EXEC_TIMEOUT_MS}ms`)),
          EXEC_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch {
    // SSH-side failure, timeout, or exec error. Caller falls back to
    // parseContextPct(tmux capture-pane) in the poll callback.
    return null;
  }

  if (tailOutput.trim() === "") return null;

  const lines = tailOutput.split("\n");

  // Reverse-scan for the last assistant turn with usage. Short-circuit on
  // the first match encountered iterating from the end — cases g/h both
  // rely on last-wins == first-match-in-reverse.
  let sum: number | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || line.trim() === "") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Malformed line — skip and continue scanning (case h).
      continue;
    }

    if (typeof parsed !== "object" || parsed === null) continue;

    const obj = parsed as Record<string, unknown>;
    if (obj.type !== "assistant") continue;

    const message = obj.message;
    if (typeof message !== "object" || message === null) continue;

    const usage = (message as Record<string, unknown>).usage;
    if (typeof usage !== "object" || usage === null) continue;

    const u = usage as Record<string, unknown>;
    const input = Number(u.input_tokens) || 0;
    const cc = Number(u.cache_creation_input_tokens) || 0;
    const cr = Number(u.cache_read_input_tokens) || 0;

    sum = input + cc + cr;
    break; // short-circuit on first (reverse) match — last-wins semantic.
  }

  // No assistant turn with usage anywhere in the tail (case b).
  if (sum === null) return null;

  // Normalize against the usable window (100% - autocompact buffer).
  const remaining_pct = 100 - (sum / MODEL_CONTEXT_WINDOW) * 100;
  const usable_remaining = Math.max(
    0,
    ((remaining_pct - AUTO_COMPACT_BUFFER_PCT) /
      (100 - AUTO_COMPACT_BUFFER_PCT)) *
      100,
  );
  const displayed = Math.round(100 - usable_remaining);

  // Defensive range clamp against float edge cases.
  return Math.max(0, Math.min(100, displayed));
}
