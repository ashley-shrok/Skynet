import path from "node:path";
import type { Client } from "ssh2";
import { execCommand } from "../ssh/tmux-helper.js";
import { sshLogger } from "../utils/logger.js";

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

// Iterative expansion — start small (cheap common case), fall back to
// larger tails when the small window doesn't contain an assistant usage
// turn (long tool_result tails, /exit echoes, sequential user messages,
// etc). 512 KB is the bounded ceiling — even multi-MB JSONLs are covered
// in ≤ 4 exec round-trips, and 512 KB pathological cases still fit inside
// one SSH exec well under the 3s dormant-poll interval.
//
// WHY 512 KB CEILING (not "just keep expanding")
// ─────────────────────────────────────────────────────────────────────
// Over-a-few-MB JSONLs are already unusual (Ashley's fleet median is
// well under 1 MB); the pathological case (>512 KB tail with no
// assistant usage turn) is a genuine bug in Claude Code write patterns
// worth surfacing via the `no_asst_usage` warn rather than expanding
// the tail infinitely. If Ashley later reports 512 KB isn't enough,
// bump the top of the schedule — do NOT add another expansion step.
//
// EMPIRICAL BACKGROUND
// ─────────────────────────────────────────────────────────────────────
// 2026-08-30 Ashley UAT verified 4-for-4: for 3 of 4 dormant identities
// (Terry 1.16 MB / Pixie 1.29 MB / Holly 2.27 MB JSONLs), the previous
// fixed 10 KB tail contained ZERO assistant usage turns → helper
// returned null → context_pct frame never emitted → meter stayed blank.
// Midna's 302 KB JSONL had an assistant usage turn in its last 10 KB
// → her meter worked. Iterative expansion resolves all four.
const TAIL_EXPANSION_STEPS = [10_000, 50_000, 200_000, 512_000] as const;
const MAX_TAIL_BYTES = TAIL_EXPANSION_STEPS[TAIL_EXPANSION_STEPS.length - 1];

// Matches session-file-discovery.ts's DISCOVERY_EXEC_TIMEOUT_MS — uniform
// error handling across the two poll callbacks that share this SSH conn.
// Bumped 3000 → 15000ms (2026-09-02) alongside its sibling — see the full
// rationale in session-file-discovery.ts (semaphore backpressure vs failure).
const EXEC_TIMEOUT_MS = 15000;

/**
 * Reverse-scan a tail buffer for the last assistant turn with `usage` and
 * return the summed input+cache_creation+cache_read token count, or null
 * if no such turn is present in the buffer. Extracted so the iterative
 * tail-expansion loop in readContextPctFromJsonl can reuse it without
 * re-parsing.
 */
function reverseScanForAssistantUsageSum(tailOutput: string): number | null {
  const lines = tailOutput.split("\n");
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

    return input + cc + cr;
  }
  return null;
}

/**
 * Tail the JSONL session file, reverse-scan for the last assistant turn
 * with usage, and return the autocompact-normalized displayed pct. Returns
 * null on any error, timeout, empty tail, no-assistant-turn-with-usage,
 * or exec failure — the caller falls back to parseContextPct(tmux
 * capture-pane) in that case.
 *
 * ITERATIVE TAIL EXPANSION (quick-260830-f1e)
 * ─────────────────────────────────────────────────────────────────────
 * Tries progressively larger tails from TAIL_EXPANSION_STEPS. Small tail
 * hits the common case cheaply; when the small window contains no
 * assistant usage turn (long tool_result tails, /exit echoes, sequential
 * user messages), expand to the next step. Bounded by MAX_TAIL_BYTES
 * (512 KB) — beyond that we `warn` and return null so pathological cases
 * are visible in logs rather than silently masking a real Claude Code
 * write-pattern bug.
 *
 * LOUD NULL-RETURN (quick-260830-f1e)
 * ─────────────────────────────────────────────────────────────────────
 * Emits one `sshLogger.warn` per distinguishable null-return path (
 * exec_fail / empty_tail / no_asst_usage / exec_throw) so Ashley can
 * grep and correlate the blank-meter class next session. Meta always
 * carries `sessionFileBasename` (basename only — no full path, mirrors
 * the T-32-05 mitigation shape used by adjacent code; the JSONL's
 * session UUID is discoverable via existing session-scoped logs).
 *
 * NEVER THROWS — all error paths return null.
 */
export async function readContextPctFromJsonl(
  conn: Client,
  sessionFile: string,
): Promise<number | null> {
  const sessionFileBasename = path.basename(sessionFile);
  let sum: number | null = null;

  for (const tailStepBytes of TAIL_EXPANSION_STEPS) {
    // Single-quote wrap for the path. sessionFile is validated upstream by
    // discoverClaudeSession (it's the exact path Claude Code's PID file
    // points to), so single-quote escape is sufficient. Same convention as
    // session-file-discovery.ts:228-230.
    const tailCmd = `tail -c ${tailStepBytes} '${sessionFile}'`;

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
    } catch (err) {
      // SSH-side failure, timeout, or exec error. Bail — retrying wider
      // won't fix a broken exec channel; caller falls back to
      // parseContextPct(tmux capture-pane) in the poll callback.
      sshLogger.warn("context-pct: exec threw", {
        operation: "context_pct_exec_throw",
        sessionFileBasename,
        tailStepBytes,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    // execCommand may resolve to a falsy value (null / undefined) on SSH
    // channel error — treat that as a hard bail (same reasoning as throw).
    if (tailOutput === null || tailOutput === undefined) {
      sshLogger.warn(
        "context-pct: exec returned null (SSH failure or timeout)",
        {
          operation: "context_pct_exec_fail",
          sessionFileBasename,
          tailStepBytes,
        },
      );
      return null;
    }

    // Empty tail = file is genuinely empty or truncated. Retrying with a
    // wider `-c N` cannot recover bytes that aren't there — bail with a
    // distinct warn so this class is visible in logs.
    if (tailOutput.trim() === "") {
      sshLogger.warn("context-pct: exec succeeded but tail is empty", {
        operation: "context_pct_empty_tail",
        sessionFileBasename,
        tailStepBytes,
      });
      return null;
    }

    sum = reverseScanForAssistantUsageSum(tailOutput);
    if (sum !== null) break; // found a usage turn — stop expanding.
    // No usage turn in this window; try the next larger step.
  }

  if (sum === null) {
    // Exhausted the schedule without finding an assistant usage turn.
    // Pathological JSONL (>512 KB with no usage) or a genuine
    // Claude-Code write-pattern bug — surface via warn.
    sshLogger.warn(
      "context-pct: no assistant usage turn found within max tail bytes",
      {
        operation: "context_pct_no_asst_usage",
        sessionFileBasename,
        maxTailBytes: MAX_TAIL_BYTES,
      },
    );
    return null;
  }

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
