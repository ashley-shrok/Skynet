/**
 * liveness-check.ts — Pure liveness probe for Claude Code sessions.
 *
 * INTENTIONALLY PURE: This module contains no filesystem access, no SSH calls,
 * and no child process execution. The actual `/proc/<pid>/stat` read happens
 * in Plan 04's ssh-poll-orchestrator.ts (via the Skynet SSH exec channel), and
 * the raw string content is passed into these functions as parameters.
 *
 * That split — pure library + injected transport — means these functions are
 * fully testable without a real box, real /proc, or real SSH.
 *
 * LIVENESS CHECK RATIONALE (RESEARCH §3):
 *   A session file can be stale in two ways:
 *   1. ENOENT: /proc/<pid>/stat does not exist → PID is dead (clean exit or crash).
 *   2. MISMATCH: /proc/<pid>/stat field 22 (starttime) differs from procStart
 *      stored in the session JSON → PID was reused by an unrelated process.
 *      Both conditions mean the session is STALE and the file should be reaped.
 *
 * WHY STRING EQUALITY (NOT NUMERIC): procStart is a decimal string of jiffies.
 *   PID reuse is detected either way, and string comparison is deterministic
 *   across any formatting differences. Numeric comparison would require radix
 *   decisions and offers no correctness advantage.
 *
 * COMM-FIELD PAREN SMUGGLING GUARD:
 *   /proc/<pid>/stat has the format:
 *     <pid> (<comm>) <state> <ppid> ...
 *   The comm field may itself contain spaces or parentheses (e.g. "(bash with
 *   (nested) parens)"). A naive split on the first ')' would land at the wrong
 *   field offset. The anchor is the CLOSING paren of the
 *   comm field and correctly finds field 22 regardless of comm content.
 */
import { systemLogger } from "../utils/logger.js";

/**
 * Parse /proc/<pid>/stat field 22 (starttime in jiffies since boot).
 *
 * The /proc/<pid>/stat format is:
 *   <pid> (<comm>) <state> <ppid> <pgrp> <session> <tty_nr> <tpgid> <flags>
 *   <minflt> <cminflt> <majflt> <cmajflt> <utime> <stime> <cutime> <cstime>
 *   <priority> <nice> <num_threads> <itrealvalue> <starttime> ...
 *
 * Field 22 (1-indexed, per procfs docs) = starttime = the 20th token AFTER
 * the closing ')' of the comm field (0-indexed: index 19 in the post-comm
 * array, because field 3 = state = index 0).
 *
 * @param statContents - The full string content of /proc/<pid>/stat
 * @returns The starttime value as a decimal string, or null if unparseable
 */
export function readProcStartField22(statContents: string): string | null {
  const closeParen = statContents.lastIndexOf(")");
  if (closeParen === -1) {
    return null;
  }

  const afterComm = statContents.slice(closeParen + 1).trim();
  const fields = afterComm.split(/\s+/);

  // After the ')': field 3=state (index 0), field 4=ppid (index 1), ...,
  // field 22=starttime (index 19). Need at least 20 fields.
  if (fields.length < 20) {
    return null;
  }

  const starttime = fields[19];
  // Sanity: must be a non-empty token
  if (!starttime) {
    return null;
  }

  return starttime;
}

/**
 * Determine whether a session is stale by comparing the session JSON's
 * procStart field against the current /proc/<pid>/stat field 22.
 *
 * @param procStart - The procStart string from the session JSON file
 * @param statContents - The raw content of /proc/<pid>/stat, or null if the
 *   file could not be read (ENOENT = PID dead)
 * @returns true if the session is STALE, false if LIVE
 */
export function isStaleFromStat(
  procStart: string,
  statContents: string | null,
): boolean {
  // ENOENT branch: PID is dead
  if (statContents === null) {
    return true;
  }

  const field22 = readProcStartField22(statContents);

  // Unparseable stat = treat as stale (defensive — log for post-mortem)
  if (field22 === null) {
    systemLogger.warn(
      "Fleet-status: /proc/<pid>/stat contents unparseable — treating session as stale",
      {
        operation: "fleet_status_stat_unparseable",
        procStart,
      },
    );
    return true;
  }

  // String equality: match = live, mismatch = PID reused = stale
  return field22 !== procStart;
}
