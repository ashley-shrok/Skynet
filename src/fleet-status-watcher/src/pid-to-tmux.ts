/**
 * PID → tmux session name resolver.
 *
 * Correlation chain:
 *   /proc/<pid>/environ → TMUX_PANE (e.g. %2)
 *   → `tmux display-message -p -t "%2" '#{session_name}'`
 *   → tmuxSession name (e.g. "tina")
 *
 * Security (STRIDE T-34-03 + T-34-04):
 *   - Only TMUX_PANE is extracted; the full environ buffer is discarded immediately
 *   - TMUX_PANE is validated against /^%\d+$/ before being passed to tmux
 *   - execFile (NOT exec) is used — no shell interpolation
 */

import fs from "node:fs/promises";
import { execFile as execFileCb } from "node:child_process";
import { watcherLogger, extractErrorFields } from "./logger.js";

/** Promisify execFile at call time to ensure mocks are respected in tests. */
function execFileProm(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileCb(cmd, args, (err, stdout, stderr) => {
      if (err) {
        reject(err);
      } else {
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
      }
    });
  });
}

// TMUX_PANE format: %<decimal> (e.g. %0, %2, %13)
const TMUX_PANE_REGEX = /^%\d+$/;

// Per-PID cache: pid → tmuxSession name (string) or null (no TMUX_PANE in environ)
const pidCache = new Map<number, string | null>();

/**
 * Resolve a PID to its tmux session name by:
 *   1. Reading /proc/<pid>/environ for TMUX_PANE
 *   2. Running `tmux display-message -p -t "$TMUX_PANE" '#{session_name}'`
 *
 * Returns the trimmed session name, or null if:
 *   - TMUX_PANE is absent (process not running in tmux)
 *   - /proc/<pid>/environ cannot be read
 *   - tmux display-message fails
 *
 * Result is cached per PID for the lifetime of the process.
 */
export async function resolveTmuxSessionForPid(
  pid: number,
): Promise<string | null> {
  // Return cached value (including null sentinel)
  if (pidCache.has(pid)) {
    return pidCache.get(pid) ?? null;
  }

  // Read /proc/<pid>/environ — null-byte delimited entries
  let tmuxPane: string | null = null;
  try {
    const environBuf = await fs.readFile(`/proc/${pid}/environ`);
    // Split on null bytes to get individual environment entries
    const entries = environBuf.toString("utf-8").split("\0");
    for (const entry of entries) {
      if (entry.startsWith("TMUX_PANE=")) {
        tmuxPane = entry.slice("TMUX_PANE=".length);
        break;
      }
    }
  } catch (e: unknown) {
    watcherLogger.warn("pid_to_tmux_environ_error", {
      pid,
      err: extractErrorFields(e),
    });
    pidCache.set(pid, null);
    return null;
  }

  if (tmuxPane === null) {
    // Process is not running inside tmux — cache and return null
    watcherLogger.warn("pid_to_tmux_no_pane", { pid });
    pidCache.set(pid, null);
    return null;
  }

  // Validate TMUX_PANE format before passing to tmux (T-34-03)
  if (!TMUX_PANE_REGEX.test(tmuxPane)) {
    watcherLogger.warn("pid_to_tmux_invalid_pane", { pid, tmuxPane });
    pidCache.set(pid, null);
    return null;
  }

  // Resolve TMUX_PANE → session name via tmux display-message
  // Using execFile (NOT exec) — argv passthrough, no shell interpolation
  let sessionName: string;
  try {
    const { stdout } = await execFileProm("tmux", [
      "display-message",
      "-p",
      "-t",
      tmuxPane,
      "#{session_name}",
    ]);
    sessionName = stdout.trim();
  } catch (e: unknown) {
    watcherLogger.warn("pid_to_tmux_exec_error", {
      pid,
      tmuxPane,
      err: extractErrorFields(e),
    });
    pidCache.set(pid, null);
    return null;
  }

  if (!sessionName) {
    watcherLogger.warn("pid_to_tmux_empty_result", { pid, tmuxPane });
    pidCache.set(pid, null);
    return null;
  }

  pidCache.set(pid, sessionName);
  return sessionName;
}

/**
 * Clear the cached tmux session name for a given PID.
 * Called when a PID is reaped so the cache doesn't grow unbounded.
 */
export function clearPidCache(pid: number): void {
  pidCache.delete(pid);
}
