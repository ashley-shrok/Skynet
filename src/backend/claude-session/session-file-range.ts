import type { Client } from "ssh2";
import { execCommand } from "../ssh/tmux-helper.js";
import { parseSessionLine, type ParsedLine } from "./session-file-parser.js";

/**
 * Two one-shot backend helpers Wave 2's `handleFetchOlder` WS handler calls
 * in sequence to serve the client's `{anchorEventId, count}` fetch-older
 * payload:
 *
 *   1. `resolveEventIdToLine(conn, sessionFile, eventId)` — grep the JSONL
 *      for the anchor line by uuid, returning the 1-based line number.
 *   2. `readSessionFileRange(conn, sessionFile, startLine, endLine)` — sed
 *      the [startLine, endLine] slice out and parse each line via
 *      `parseSessionLine` from `./session-file-parser.js`.
 *
 * Both helpers share discipline with `context-pct-from-jsonl.ts` (the
 * PATTERNS.md § 3 analog):
 *   - one-shot `execCommand` via ../ssh/tmux-helper.js
 *   - `Promise.race` timeout at `EXEC_TIMEOUT_MS = 3000`
 *   - single try/catch around the race → return null on ANY failure
 *     (SSH error, timeout, nonzero exit with empty stdout, etc.)
 *   - single-quote wrap on the path; do NOT sanitize embedded single quotes
 *     (sessionFile is validated upstream by `discoverClaudeSession` — this is
 *     the exact convention `context-pct-from-jsonl.ts:82` uses per L79-82)
 *   - NEVER throw — every error path returns null so the WS handler can
 *     emit a graceful `{ frames: [], error: ... }` shape to the client
 *
 * Wire contract (locked, planner revision): the client sends ONLY
 * `{anchorEventId, count}` in the fetch_older payload. The server must resolve
 * the eventId → line number on demand. That is why BOTH helpers land in one
 * file and are exported separately — the WS handler calls them in a two-step
 * sequence.
 *
 * NEITHER helper is wired into `claude-session-server.ts` in this plan; 43-04
 * (Wave 2) owns the WS handler wiring.
 */

// Same 3s budget as context-pct-from-jsonl.ts L61-63. Duplicated here so this
// file stays self-sufficient (no cross-imports between range read and context
// tail — the two live on the same SSH conn but are independent responsibilities).
const EXEC_TIMEOUT_MS = 3000;

// Guardrail on the caller's range span. 10000 lines is far above any realistic
// fetch_older batch size (client-side default is a screen-worth, ~50; even
// scroll-back-past-cap refetches stay under a few hundred) but low enough to
// reject obvious garbage before it hits the shell.
const MAX_RANGE_SPAN = 10000;

/**
 * Read a bounded [startLine, endLine] slice of a Claude Code JSONL session
 * file via one-shot SSH exec, parse each line through `parseSessionLine`, and
 * return the array of emission-kind ParsedLine variants (message / image /
 * relay_outbound / relay_inbound / malformed). `kind:"skip"` results are
 * filtered out — the caller only cares about frames the client would render.
 *
 * Range validation runs FIRST (before any exec). If the range is invalid
 * (startLine <= 0, endLine < startLine, or the span >= MAX_RANGE_SPAN) the
 * helper returns null WITHOUT invoking `execCommand`.
 *
 * Any exec-side failure — SSH-side error, Promise.race timeout, or the
 * tmux-helper `execCommand` contract's nonzero-exit-with-empty-stdout rejection
 * — resolves to null. NEVER throws.
 *
 * Returning `[]` (empty array, non-null) is distinct from returning null: the
 * former means "exec succeeded but every line was either empty or a skip";
 * the latter means "the read failed and the caller should surface an error".
 */
export async function readSessionFileRange(
  conn: Client,
  sessionFile: string,
  startLine: number,
  endLine: number,
): Promise<ParsedLine[] | null> {
  // Range validation FIRST — no exec call on bad input.
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) return null;
  if (startLine <= 0) return null;
  if (endLine < startLine) return null;
  if (endLine - startLine >= MAX_RANGE_SPAN) return null;

  // Shell primitive: `sed -n 'M,Np' '<path>'`. Single-quote wrap on the path
  // (upstream-validated per discoverClaudeSession) — same convention as
  // context-pct-from-jsonl.ts L82. Embedded single quotes in the path are
  // NOT sanitized; that's a defense-in-depth job for discoverClaudeSession.
  const cmd = `sed -n '${startLine},${endLine}p' '${sessionFile}'`;

  let output: string;
  try {
    output = await Promise.race([
      execCommand(conn, cmd),
      new Promise<string>((_, reject) =>
        setTimeout(
          () => reject(new Error(`range-read timeout after ${EXEC_TIMEOUT_MS}ms`)),
          EXEC_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch {
    // SSH-side failure, timeout, or exec nonzero-exit-with-empty. Caller
    // handles null as a graceful "no batch" signal.
    return null;
  }

  // Split on newline, parse each non-empty line, drop skips.
  const parsed: ParsedLine[] = [];
  for (const rawLine of output.split("\n")) {
    if (rawLine === "") continue;
    const result = parseSessionLine(rawLine);
    if (result.kind === "skip") continue;
    parsed.push(result);
  }
  return parsed;
}

/**
 * Resolve a JSONL event uuid to its 1-based line number via one-shot SSH exec.
 * Used by Wave 2's `handleFetchOlder` to convert `anchorEventId` → line offset
 * before computing the [startLine, endLine] window for `readSessionFileRange`.
 *
 * Shell primitive: `grep -n '"uuid":"<eventId>"' '<path>' | head -1 | cut -d: -f1`.
 * The `head -1` short-circuits grep on the first match (fast even on multi-MB
 * files); `cut -d: -f1` isolates the line-number prefix grep -n emits.
 *
 * EventId validation runs FIRST (before any exec). Empty string returns null.
 * An eventId containing a single quote character (`'`) ALSO returns null
 * WITHOUT invoking exec — the helper does not attempt shell-escape sanitization
 * (mirrors the context-pct-from-jsonl.ts posture: paths are validated upstream,
 * so we don't try to defend against embedded quotes at the escape layer). Any
 * `'` in an eventId is a shell-breakage risk, so we treat that id as
 * unresolvable rather than either throwing or attempting to escape.
 *
 * Not-found (grep matched nothing, empty stdout OR nonzero-exit with empty
 * stdout — the tmux-helper `execCommand` contract's reject-on-nonzero-and-
 * empty path) resolves to null. Timeout / SSH error also resolves to null.
 * NEVER throws.
 */
export async function resolveEventIdToLine(
  conn: Client,
  sessionFile: string,
  eventId: string,
): Promise<number | null> {
  // Guard invalid ids BEFORE exec.
  if (typeof eventId !== "string") return null;
  if (eventId.length === 0) return null;
  // Defense-in-depth: an embedded `'` would break the shell command. Do not
  // sanitize; treat as unresolvable.
  if (eventId.includes("'")) return null;

  const cmd = `grep -n '"uuid":"${eventId}"' '${sessionFile}' | head -1 | cut -d: -f1`;

  let output: string;
  try {
    output = await Promise.race([
      execCommand(conn, cmd),
      new Promise<string>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(`eventId-lookup timeout after ${EXEC_TIMEOUT_MS}ms`),
            ),
          EXEC_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch {
    // grep-no-match (exit 1 + empty stdout) rejects via the tmux-helper
    // execCommand contract — swallowed here as "not found". True SSH errors
    // and timeouts also land here and return null.
    return null;
  }

  const trimmed = output.trim();
  if (trimmed === "") return null;

  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
