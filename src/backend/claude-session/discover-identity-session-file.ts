/**
 * Identity-first-turn session-file discovery — Phase 32, Plan 32-01.
 *
 * WHY THIS EXISTS:
 *
 * The dormancy-bubble-in-flow quick task (patch #422, 2026-08-12) ships a
 * wake-bubble frame when a dormant identity pane comes back to life, but
 * the messages behind that bubble never appear — the dormant branch has no
 * tail open, so the JSONL history is never streamed to the UI. Ashley's
 * verbatim direction: *"the bubble looks good, but unfortunately, the
 * rest of the messages that would be in that session are not showing up."*
 *
 * This helper closes that gap by locating the JSONL file the identity was
 * last active in, so the Wave 2 dormant-branch wiring can open a tail on
 * it and replay history through the existing session pipeline.
 *
 * Full context and the locked D-01..D-09 decisions live at:
 *   .planning/phases/32-identity-first-turn-session-discovery-wake-bubble-message-hi/32-CONTEXT.md
 *
 * WHY BYTE-PATTERN NOT JSON-PARSE (D-01):
 *
 * Mirrors the shape used by the Layer 1 recycle detector at
 * `layer1-detect.ts:82-106` (isUserTurn + isIdResetUserTurn) —
 * production-proven, ~40× cheaper than JSON.parse per line, and tolerant
 * to the minor byte-shape drift Claude Code has historically shipped. If
 * the assumption ever breaks, this file is the SINGLE source of truth for
 * identity-first-turn detection — fix here, not scattered across the
 * dormant-branch wiring.
 *
 * The predicate uses `line.includes` for the two literal-string checks
 * (`"type":"user"`, `<command-name>/id</command-name>`) plus a single
 * character-index check for the delimiter guard after `<command-args>`.
 * ZERO JSON.parse anywhere in this module — enforced by inspection
 * (see plan 32-01 verification step 4).
 *
 * WHY ONE-ROUND-TRIP SHELL SCRIPT (D-07):
 *
 * The cost bound in D-07 is ~4 project dirs × dozens of JSONLs × a
 * `head -c 4096`-bounded grep = well under 100ms per lookup. A single
 * exec channel with a shell script that enumerates + reads + emits is
 * cheaper (one round-trip instead of N) AND has fewer failure surfaces
 * (one timeout, one stdout to parse) than the N-round-trip alternative.
 * We keep the byte-pattern match in JS (not in shell) so the predicate
 * is unit-testable in isolation and so the identity name never leaks
 * into a shell-side grep pattern (T-32-01: identity name is only ever
 * used in a single-quote-wrapped shell literal for defense-in-depth).
 *
 * CALL-SITE SCOPE (D-09):
 *
 * This helper is called from EXACTLY ONE production site: the dormant
 * branch of `claude-session-server.ts` (immediately after the
 * `dormantPollTimer = setInterval(...)` block and before
 * `enteredDormantPoll = true;`). The active-flow discovery at
 * `startActiveSessionFlow` stays on `discoverClaudeSession` — migrating
 * that path is explicitly out of scope per Phase 32.
 *
 * LOG EMISSION IS THE CALLER'S RESPONSIBILITY:
 *
 * This module emits ZERO log lines directly (Phase 32 invariant 5).
 * On SSH throw or timeout, the helper returns null (fail-safe: the
 * dormant branch treats null as "no discovery" and falls back to today's
 * behavior). The CALLER is responsible for emitting a single structured
 * `sshLogger.warn` in the null-return path — this module's throw-catch
 * produces the null return only. Similarly the caller MUST log the
 * happy-path discovery via the Phase 31 `[session]`/`[ws]` prefix
 * taxonomy.
 */

import type { Client } from "ssh2";
import { execCommand } from "../ssh/tmux-helper.js";

/**
 * Hard ceiling on the discovery exec call. Matches the 3000ms budget the
 * active-flow discovery uses at `session-file-discovery.ts:4` — kept in
 * sync intentionally. Re-declared here (not imported) to preserve this
 * module's independence from `session-file-discovery.ts` (they own
 * different mechanisms and evolve independently per D-09).
 */
export const DISCOVERY_EXEC_TIMEOUT_MS = 3000;

/**
 * Fixed sentinel that separates per-file records in the shell script's
 * stdout. Chosen to be extremely unlikely to appear in any legitimate
 * JSONL line's first-user-role content (starts with three dashes, contains
 * `GSDR-32` — plan 32-01 discovery marker).
 */
export const RECORD_SEPARATOR = "---GSDR-32---";

/**
 * The four delimiter characters that MAY appear immediately after the
 * identity name inside `<command-args>` per D-01:
 *   - `<` : the empirical case (closes with `</command-args>`).
 *   - ` ` (space) : hypothetical multi-token args (`<command-args>tanya extra>`).
 *   - `\r` : Windows-line-ending edge case.
 *   - end-of-line : the JSONL line ends immediately after the identity name.
 *
 * The guard REFUSES partial-name matches: `<command-args>tiff<` MUST NOT
 * match identity `tiffany`. This is the load-bearing correctness property
 * of D-01.
 */
const DELIMITER_SET = new Set(["<", " ", "\r"]);

/**
 * Byte-pattern predicate: returns true iff `line` represents a REAL Claude
 * Code first user turn that invoked `/id <identityName>` (with a strict
 * delimiter check refusing partial-name matches per D-01).
 *
 * Load-bearing checks (in order):
 *   1. Line contains `"type":"user"` AND does NOT contain `"tool_result"`
 *      (mirrors `isUserTurn` in `layer1-detect.ts:82` — NOT imported here
 *      to keep this module independent per D-09).
 *   2. Line contains `<command-name>/id</command-name>` (literal).
 *   3. Line contains `<command-args><identityName>` where the character
 *      immediately after the identity name is one of `<`, ` `, `\r`, or
 *      end-of-line.
 *
 * All checks are `line.includes` or single-index char checks. ZERO
 * JSON.parse — the byte-shape assumption is captured entirely here.
 *
 * Exported for unit testing under the established `__forTests` convention
 * (see `layer1-detect.ts:199`, `claude-session-server.ts` seams).
 *
 * @param line — one raw JSONL line (the first user-role line of a file).
 * @param identityName — the identity to match (e.g. `tanya`, `tiffany`).
 */
export function __matchesIdentityFirstTurnForTests(
  line: string,
  identityName: string,
): boolean {
  // 1. Outer shape must be a real user-role turn.
  if (!line.includes('"type":"user"')) return false;
  if (line.includes('"tool_result"')) return false;
  // 2. Must be the /id slash-command.
  if (!line.includes("<command-name>/id</command-name>")) return false;
  // 3. Must be `<command-args><identityName>` followed by a valid delimiter.
  const argsTag = "<command-args>";
  const argsIdx = line.indexOf(argsTag);
  if (argsIdx === -1) return false;
  const nameStart = argsIdx + argsTag.length;
  // Verify the identity name literally appears at nameStart.
  // Using startsWith on a slice is a single scan and avoids a regex.
  const nameEnd = nameStart + identityName.length;
  if (line.slice(nameStart, nameEnd) !== identityName) return false;
  // Delimiter check: char at nameEnd must be `<`, ` `, `\r`, or line-end.
  // EOL is expressed as "nameEnd >= line.length" (no character exists at
  // that position — the identity name is the last thing on the line).
  if (nameEnd >= line.length) return true;
  const delimiter = line[nameEnd];
  return DELIMITER_SET.has(delimiter);
}

/**
 * The one-round-trip shell script. For each JSONL under
 * `~/.claude/projects/*​/`, emits:
 *   `MTIME\tPATH\n<first-user-role-line>\n---GSDR-32---\n`
 *
 * The `grep -m 1` bails out on the first `"role":"user"` line — well
 * before `head -c 4096`'s ceiling for any realistic JSONL. Files with no
 * user-role line in the first 4096 bytes emit an empty line where the
 * first-user-role line would be (the RECORD_SEPARATOR still terminates
 * the record cleanly).
 *
 * Sorted by mtime DESCENDING so the JS parser gets records already in
 * newest-first order (D-03 tiebreak — first match wins).
 *
 * The identity name is single-quote-wrapped when interpolated (T-32-01
 * defense-in-depth) even though it is NEVER used in a shell-side grep
 * pattern — the byte-pattern match happens in JS after parsing stdout.
 */
export function buildDiscoveryScript(escapedIdentityName: string): string {
  // Note on escapedIdentityName: single-quote wrapping is applied at the
  // call site (identity name is validated to a safe subset upstream at the
  // WS-attach layer; this is defense-in-depth per T-32-01). The name is
  // interpolated as a shell literal ONLY — never into a grep pattern.
  //
  // Shell strategy per statement:
  //   1. `find` enumerates JSONLs under ~/.claude/projects/*/, emits
  //      "mtime path" pairs (space-separated; mtime is float-valued).
  //   2. `sort -rn` orders them mtime-descending.
  //   3. `while read` iterates each pair; for each file:
  //        a. print "MTIME\tPATH"
  //        b. print the first user-role line (or empty if none in 4096B)
  //        c. print the RECORD_SEPARATOR sentinel
  //   4. All emitted via `printf` so the byte layout is exact.
  //
  // The identity name is embedded as a shell comment for grep-ability of
  // audit logs (`ps aux | grep <name>` would find the exec) but NOT used
  // inside any shell primitive that would treat it as a pattern.
  //
  // LOAD-BEARING (matches session-file-discovery.ts:100 pattern): JS `+`
  // joins these strings on ONE line — every shell statement MUST be
  // terminated with `;`. Do not remove any `;` below.
  return (
    // Purely documentary — the identity name appears in the script for
    // audit-log grep-ability but is not consumed by any shell primitive.
    `IDENTITY=${escapedIdentityName}; ` +
    `find ~/.claude/projects/ -maxdepth 2 -type f -name '*.jsonl' -printf '%T@ %p\\n' 2>/dev/null ` +
    `| sort -rn ` +
    `| while IFS=' ' read -r mtime path; do ` +
    `  printf '%s\\t%s\\n' "$mtime" "$path"; ` +
    `  head -c 4096 "$path" 2>/dev/null | grep -m 1 '"role":"user"' || printf '\\n'; ` +
    `  printf '%s\\n' '${RECORD_SEPARATOR}'; ` +
    `done`
  );
}

/**
 * Single-quote-wrap a string for use as a shell literal. Same pattern used
 * at `session-file-tail.ts:27` and `claude-session-server.ts:4660-4664`.
 * The identity name is already validated to a safe subset upstream at the
 * WS-attach layer; this is defense-in-depth per T-32-01.
 */
export function shellSingleQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Parse the shell script's stdout into per-file records. Each record has
 * mtime (float, seconds), path (absolute), and firstUserLine (string; may
 * be empty if the file had no user-role line in the first 4096 bytes).
 *
 * The parser is intentionally forgiving of trailing empty lines / partial
 * records — a malformed final record is dropped silently rather than
 * throwing (fail-safe: better to miss one candidate than to crash the
 * dormant branch).
 */
export type DiscoveryRecord = {
  mtime: number;
  path: string;
  firstUserLine: string;
};

export function parseDiscoveryStdout(stdout: string): DiscoveryRecord[] {
  const records: DiscoveryRecord[] = [];
  if (stdout.length === 0) return records;
  // Split on the record separator; each chunk is:
  //   `MTIME\tPATH\n<first-user-line>\n`
  // The first chunk starts at the beginning; subsequent chunks start after
  // `\n` following the separator. Handle both by splitting on `\n${SEP}\n`
  // and processing any trailing `\n${SEP}` boundary as an EOF marker.
  const chunks = stdout.split(`\n${RECORD_SEPARATOR}`);
  for (const rawChunk of chunks) {
    // Strip a leading `\n` if present (leftover from the previous separator's
    // trailing newline) and any leading whitespace-only artifacts.
    const chunk = rawChunk.startsWith("\n") ? rawChunk.slice(1) : rawChunk;
    if (chunk.length === 0) continue;
    // The first line is `MTIME\tPATH`. The remainder (may be empty) is the
    // first user-role line.
    const firstNL = chunk.indexOf("\n");
    if (firstNL === -1) continue; // malformed — no first-user-line line at all
    const header = chunk.slice(0, firstNL);
    const remainder = chunk.slice(firstNL + 1);
    // firstUserLine may include a trailing `\n` if the grep emitted one;
    // strip a single trailing `\n` to normalize.
    const firstUserLine = remainder.endsWith("\n")
      ? remainder.slice(0, -1)
      : remainder;
    const tabIdx = header.indexOf("\t");
    if (tabIdx === -1) continue; // malformed — no mtime/path split
    const mtimeStr = header.slice(0, tabIdx);
    const path = header.slice(tabIdx + 1);
    const mtime = parseFloat(mtimeStr);
    if (!Number.isFinite(mtime) || path.length === 0) continue;
    records.push({ mtime, path, firstUserLine });
  }
  return records;
}

/**
 * Locate the JSONL file that carries the identity's first `/id <name>`
 * turn. Returns the mtime-latest absolute path across
 * `~/.claude/projects/*​/`, or `null` if no such file exists.
 *
 * Fail-safe contract (D-05, invariant 1 in 32-CONTEXT.md):
 *   - Empty projects dir → null (no throw).
 *   - No matching JSONL → null (no throw).
 *   - SSH exec throws → null (no throw propagates).
 *   - Exec exceeds DISCOVERY_EXEC_TIMEOUT_MS → treated as throw → null.
 *
 * The CALLER is responsible for emitting a `sshLogger.warn` in the
 * null-return path (this module emits ZERO log lines per Phase 32
 * invariant 5 + T-32-02).
 *
 * @param conn — an open SSH client (the pane's connection).
 * @param identityName — the identity to discover (e.g. `tanya`, `tiffany`).
 */
export async function discoverIdentitySessionFile(
  conn: Client,
  identityName: string,
): Promise<string | null> {
  const escaped = shellSingleQuote(identityName);
  const script = buildDiscoveryScript(escaped);

  let stdout: string;
  try {
    stdout = await Promise.race([
      execCommand(conn, script),
      new Promise<string>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `discoverIdentitySessionFile timeout after ${DISCOVERY_EXEC_TIMEOUT_MS}ms`,
              ),
            ),
          DISCOVERY_EXEC_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch {
    // Fail-safe: any SSH throw / timeout → null. Caller logs.
    return null;
  }

  const records = parseDiscoveryStdout(stdout);
  // Records are already mtime-desc from the shell's `sort -rn`. Belt-and-
  // suspenders: sort again defensively in case the shell's sort locale ever
  // deviates from strict numeric-descending. This is O(n log n) on a set
  // bounded by D-07 (~dozens of JSONLs) — negligible.
  records.sort((a, b) => b.mtime - a.mtime);

  for (const rec of records) {
    if (__matchesIdentityFirstTurnForTests(rec.firstUserLine, identityName)) {
      return rec.path;
    }
  }
  return null;
}
