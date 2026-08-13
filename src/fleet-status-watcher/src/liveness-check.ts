/**
 * Liveness check for Claude Code sessions via /proc/<pid>/stat field 22.
 *
 * procStart field in the session JSON is field 22 of /proc/<pid>/stat
 * (starttime in jiffies since boot). Comparing this value against the live
 * /proc file guards against PID reuse — a new process that inherits a dead
 * PID will have a different starttime.
 *
 * Security: lastIndexOf(')') anchoring prevents comm-field parenthesis
 * smuggling (STRIDE T-34-02). The comm value is never forwarded downstream.
 */

import fs from "node:fs/promises";
import { watcherLogger, extractErrorFields } from "./logger.js";

/**
 * Read field 22 (starttime/procStart) from /proc/<pid>/stat.
 *
 * The stat file format is: `<pid> (<comm>) <state> <ppid> ...`
 * The comm field can contain spaces and parentheses, so we anchor on
 * lastIndexOf(')') to find the end of the comm field before splitting.
 *
 * Returns the starttime string (field 22, index 19 in the post-comm fields)
 * or null if the file does not exist (dead PID) or is malformed.
 */
export async function readProcStart(pid: number): Promise<string | null> {
  const statPath = `/proc/${pid}/stat`;
  let content: string;
  try {
    content = await fs.readFile(statPath, "utf-8");
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return null; // PID is dead
    }
    watcherLogger.warn("readProcStart_error", {
      pid,
      statPath,
      err: extractErrorFields(e),
    });
    return null;
  }

  // Find the end of the parenthesised comm field (last ')' in the line)
  // This guards against comm values like "(bash with (parens))"
  const lastParen = content.lastIndexOf(")");
  if (lastParen === -1) {
    watcherLogger.warn("readProcStart_malformed", { pid, statPath });
    return null;
  }

  // Everything after the closing ')' is: " <state> <ppid> <pgrp> <session> <tty_nr>
  //   <tpgid> <flags> <minflt> <cminflt> <majflt> <cmajflt> <utime> <stime>
  //   <cutime> <cstime> <priority> <nice> <num_threads> <itrealvalue> <starttime> ..."
  // Splitting on whitespace: index 0 = empty/state, index 1 = state char, ...
  // After lastParen: " S 1 12345 12345 0 -1 4194560 100 0 0 0 0 0 0 0 20 0 1 0 53836667 ..."
  // field positions (0-based after split, skipping empty from leading space):
  //   0 = state, 1 = ppid, 2 = pgrp, 3 = session, 4 = tty_nr,
  //   5 = tpgid, 6 = flags, 7 = minflt, 8 = cminflt, 9 = majflt, 10 = cmajflt,
  //   11 = utime, 12 = stime, 13 = cutime, 14 = cstime, 15 = priority,
  //   16 = nice, 17 = num_threads, 18 = itrealvalue, 19 = starttime
  const afterComm = content.slice(lastParen + 1).trim();
  const fields = afterComm.split(/\s+/);

  // starttime is at index 19 (0-based)
  const starttime = fields[19];
  if (!starttime) {
    watcherLogger.warn("readProcStart_short_stat", { pid, fieldCount: fields.length });
    return null;
  }

  return starttime;
}

/**
 * Check if a PID is alive and the procStart matches (guards against PID reuse).
 *
 * Returns true only when /proc/<pid>/stat field 22 exactly equals procStart.
 * Returns false if the PID is dead (ENOENT), if procStart mismatches, or if
 * stat cannot be read.
 */
export async function isPidAlive(
  pid: number,
  procStart: string,
): Promise<boolean> {
  const actual = await readProcStart(pid);
  if (actual === null) {
    return false; // Dead PID
  }
  return actual === procStart;
}
