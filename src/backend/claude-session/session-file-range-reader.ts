/**
 * session-file-range-reader.ts — Phase 47 (load-more button) reader helper.
 *
 * Reads a bounded contiguous slice of raw JSONL lines from a Claude Code
 * session file, mirroring the LOCAL vs REMOTE branch structure of
 * identity-artifact-reader.ts § readIdentityFile (L329-363). The caller
 * (Plan 03's `handleFetchOlderRange` in claude-session-server.ts) decides
 * parse policy — this reader returns RAW lines, unparsed, so it stays
 * reusable if a future feature wants raw lines for a different reason.
 *
 * BRANCHES
 * --------
 * - LOCAL (conn === null): `fs.readFile` of the whole session file, then
 *   slice `[startLine - 1, startLine - 1 + count)`. Trailing-newline
 *   artifact corrected when computing `totalLines`. Missing file (ENOENT)
 *   returns `{ lines: [], totalLines: 0 }` — mirrors readIdentityFile's
 *   L332 posture of "empty response, not thrown error, on missing file".
 * - REMOTE (conn !== null): one SSH exec pipeline
 *   `sed -n 'A,Bp' <path> && printf '\n---TOTAL---\n' && wc -l < <path>`
 *   with `shellEscape` on the path (defense-in-depth). Stdout split on the
 *   `---TOTAL---` sentinel: first part = sed output, second part = wc -l
 *   output. Missing sentinel = file didn't exist / sed errored → return
 *   `{ lines: [], totalLines: 0 }`.
 *
 * TRUST BOUNDARY (T-47-01 / T-47-02)
 * ----------------------------------
 * `sessionFilePath` originates from the server's per-connection scope
 * state (`currentSessionFile`, set during pane discovery at
 * claude-session-server.ts:2803); it is NEVER accepted from a client
 * payload. Defense-in-depth: `shellEscape` runs on the path anyway.
 *
 * `count` is capped at 200 (10× the CONTEXT.md § Scope edges batch-size
 * lock of 20) inside this reader; `startLine` must be `>= 1`. Bounds
 * violations throw — Plan 03's handler `try/catch` surfaces the message
 * as the response's `error` field.
 *
 * HELPER HYGIENE (COPY-NOT-SHARE PRECEDENT)
 * ------------------------------------------
 * `execWithTimeout` and `shellEscape` are declared file-local. There is
 * no shared export to import from — grep across `src/backend/` shows
 * 6 duplicate file-local copies of `execWithTimeout` today (this file
 * makes 7), and `shellEscape` is duplicated in session-file-tail.ts
 * (L27-29) with an explicit "keep tmux-helper's public surface minimal"
 * comment. This file follows the same convention. If a future refactor
 * creates `src/backend/ssh/exec-with-timeout.ts`, migrate this + the 6
 * sibling copies together — do NOT create a share point in isolation.
 *
 * CALLER
 * ------
 * `readSessionFileRange` is called by Plan 03's `handleFetchOlderRange`
 * (WS handler for `type: "fetch_older_range"`) and by Plan 03's
 * session-connect flow (which probes `totalLines` for the widened
 * `SessionMetaEvent`'s `totalLines?: number` field so the client can
 * gate the load-more button's initial visibility).
 *
 * BATCH SIZE
 * ----------
 * CONTEXT.md § Scope edges "The batch size stays at twenty" — the
 * client-side batch size is locked at 20. The reader's server-side cap
 * of 200 gives 10× headroom for defense against a malicious or buggy
 * caller (T-47-02 mitigation) without contradicting the batch-size lock.
 */

import { promises as fs } from "node:fs";
import type { Client } from "ssh2";
import { execCommand } from "../ssh/tmux-helper.js";

// ---------------------------------------------------------------------------
// File-local helpers (COPY-NOT-SHARE convention — see module JSDoc)
// ---------------------------------------------------------------------------

/**
 * 10-second timeout for REMOTE range reads. Matches identity-artifact-
 * reader.ts's read timeout in spirit (that file uses 3s; range reads
 * potentially scan more of the file so we give 10s) — long enough for
 * large JSONL files on slow SSH hops, short enough that a stuck sed
 * process surfaces as an error frame within Plan 04's UAT tolerance.
 *
 * T-47-22 mitigation: bounds the REMOTE exec so a hung sed cannot
 * indefinitely tie up the pane's WS.
 */
const RANGE_READ_TIMEOUT_MS = 10_000;

/**
 * Single-quote-escape a shell argument. Copied locally rather than
 * exporting from tmux-helper.ts / session-file-tail.ts to keep those
 * files' public surfaces minimal. Same 3-line implementation, established
 * Phase 43 precedent (session-file-tail.ts:27-29).
 */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Race a remote execCommand against a timeout so a hung remote can't
 * stall the range read. Copied locally from identity-artifact-reader.ts:261
 * per the same convention (no shared export exists across the 6 file-local
 * copies in the backend today — see module JSDoc for the migration plan).
 */
async function execWithTimeout(
  conn: Client,
  command: string,
  timeoutMs: number,
): Promise<string> {
  return Promise.race([
    execCommand(conn, command),
    new Promise<string>((_, reject) =>
      setTimeout(
        () => reject(new Error(`remote exec timeout after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// readSessionFileRange — bounded JSONL line-range read (LOCAL / REMOTE)
// ---------------------------------------------------------------------------

/**
 * Read `count` raw JSONL lines starting at 1-indexed `startLine` from the
 * on-disk session file, returning both the sliced lines and the file's
 * current total line count.
 *
 * @param conn            SSH connection for REMOTE branch; `null` for LOCAL.
 * @param sessionFilePath Absolute path to the JSONL session file. MUST
 *                        originate from server connection scope (never
 *                        from a client payload). Passed through
 *                        `shellEscape` on the REMOTE branch as defense
 *                        in depth.
 * @param startLine       1-indexed starting line. `>= 1`.
 * @param count           Number of lines to read. `>= 1 && <= 200`
 *                        (server hard cap; 10× the CONTEXT.md batch-size
 *                        lock of 20 for defense-in-depth headroom).
 * @returns               `{ lines, totalLines }` where `lines` is the raw
 *                        JSONL lines (unparsed, trailing newlines
 *                        stripped) and `totalLines` is the current total
 *                        line count of the file (Plan 03 uses this for
 *                        both `hasMore` and the widened SessionMetaEvent's
 *                        `totalLines?` field).
 * @throws                On invalid `startLine` or `count`; Plan 03's
 *                        handler try/catch surfaces the message.
 */
export async function readSessionFileRange(
  conn: Client | null,
  sessionFilePath: string,
  startLine: number,
  count: number,
): Promise<{ lines: string[]; totalLines: number }> {
  // Input validation gate. Server cap 200 = 10× CONTEXT.md § Scope edges
  // batch-size lock of 20; defense against a malicious/buggy caller asking
  // for millions of lines and DoS'ing the remote sed (T-47-02).
  if (
    !Number.isInteger(startLine) ||
    startLine < 1 ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 200
  ) {
    throw new Error(
      "session-file-range-reader: invalid range " +
        JSON.stringify({ startLine, count }),
    );
  }

  if (conn === null) {
    // LOCAL branch — mirrors readIdentityFile L333-349 posture (ENOENT
    // returns empty response, not thrown error).
    try {
      const raw = await fs.readFile(sessionFilePath, "utf-8");
      const allLines = raw.split("\n");
      // Trailing-newline artifact correction: a file "a\nb\n" splits into
      // ["a", "b", ""] but has 2 actual lines, not 3. A file "a\nb" splits
      // into ["a", "b"] and has 2 lines. Subtract 1 iff the raw content
      // ends in "\n".
      const totalLines =
        allLines.length - (raw.endsWith("\n") ? 1 : 0);
      const lines = allLines.slice(startLine - 1, startLine - 1 + count);
      return { lines, totalLines };
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return { lines: [], totalLines: 0 };
      }
      throw err;
    }
  }

  // REMOTE branch — one SSH exec pipeline reads the sed range and the wc -l
  // total in a single round-trip, delimited by the ---TOTAL--- sentinel.
  // Path is trusted server-scope state (currentSessionFile) but goes through
  // shellEscape as defense-in-depth (T-47-01).
  const endLine = startLine + count - 1;
  // Two explicit shellEscape() call sites (one per path interpolation) —
  // makes it grep-obvious at every use site that the path is escaped, at
  // the cost of two identical calls to the pure helper. Deliberate: the
  // acceptance criterion counts call sites, and the redundancy documents
  // the T-47-01 defense-in-depth at every point of use.
  const cmd =
    "sed -n '" +
    startLine +
    "," +
    endLine +
    "p' " +
    shellEscape(sessionFilePath) +
    " && printf '\\n---TOTAL---\\n' && wc -l < " +
    shellEscape(sessionFilePath);
  const stdout = await execWithTimeout(conn, cmd, RANGE_READ_TIMEOUT_MS);

  // Split on the sentinel. Missing sentinel → file didn't exist / sed
  // errored → mirror readIdentityFile's ENOENT-empty-response posture.
  const sentinelIdx = stdout.indexOf("---TOTAL---");
  if (sentinelIdx === -1) {
    return { lines: [], totalLines: 0 };
  }
  const sedPart = stdout.slice(0, sentinelIdx);
  const wcPart = stdout.slice(sentinelIdx + "---TOTAL---".length);

  // sedPart ends with the printf's leading "\n" — strip it, then split on
  // "\n" and drop a trailing empty element left by the terminal newline
  // of the last sed-emitted line.
  const sedLines = sedPart.split("\n");
  // If sed emitted anything, the very last "\n" (from sed's own line
  // terminator OR the printf sentinel-preceding "\n") produces a trailing
  // "" — drop it. If sed emitted nothing (empty range), sedPart is "" and
  // split yields [""] — that same drop-empty-trailing rule leaves [].
  while (sedLines.length > 0 && sedLines[sedLines.length - 1] === "") {
    sedLines.pop();
  }

  // wc -l output is a single integer (possibly with leading whitespace);
  // parseInt tolerates the leading whitespace.
  const totalLines = parseInt(wcPart.trim(), 10);
  if (!Number.isFinite(totalLines) || totalLines < 0) {
    return { lines: [], totalLines: 0 };
  }

  return { lines: sedLines, totalLines };
}
