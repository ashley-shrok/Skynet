/**
 * pid-to-tmux.ts — PID → tmux session correlation via /proc/<pid>/environ.
 *
 * DEPENDENCY-INJECTED: This module contains no SSH calls and no /proc reads.
 * The two injected callbacks in `resolvePidToTmuxSession` are provided by
 * Plan 04's ssh-poll-orchestrator.ts which wraps the Skynet SSH exec channel:
 *
 *   readEnviron:    (pid) => execCommand(conn, `cat /proc/${pid}/environ`)
 *   resolveTmuxName:(pane) => execCommand(conn, `tmux display-message -p -t '${pane}' '#{session_name}'`)
 *
 * That split means this module never touches the network or /proc, and is
 * fully testable without a real box, real SSH, or a running tmux.
 *
 * CORRELATION CHAIN (RESEARCH §5 — verified live on 5 processes):
 *   1. Read /proc/<pid>/environ (NUL-separated key=value pairs)
 *   2. Extract TMUX_PANE=%N (e.g. %2, %13)
 *   3. Run: tmux display-message -p -t '%N' '#{session_name}'
 *   4. The trimmed output is the tmux session name (e.g. "tina", "nelly")
 *
 * SECURITY: isValidTmuxPaneId is a MANDATORY gate before ANY downstream
 * tmux-exec call. Even if a compromised host writes garbage into
 * /proc/<pid>/environ, only pane IDs matching the strict percent-digit pattern can reach the injected
 * resolveTmuxName callback. This prevents shell metacharacter injection into
 * the tmux command that Plan 04 constructs.
 *
 * NULL RETURN SEMANTICS: A null return from resolvePidToTmuxSession means
 * the tmuxSession is unknown for this PID. SessionState publishers (Plan 04)
 * should record tmuxSession: null and continue — the session JSON is still
 * authoritative for the working signal; tmux correlation is a nice-to-have
 * for the row key.
 */
import { systemLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// extractTmuxPaneFromEnviron
// ---------------------------------------------------------------------------

/**
 * Extract the TMUX_PANE value from a /proc/<pid>/environ buffer.
 *
 * The environ file is a sequence of NUL-terminated key=value strings.
 * We split on NUL, find the FIRST entry that starts EXACTLY with "TMUX_PANE="
 * (not "TMUX_PANE_SOMETHING=" — the startsWith check is strict), and return
 * the value portion. Returns null if TMUX_PANE is absent or its value is empty.
 *
 * Accepts both Buffer and string because SSH-exec callers often hold stdout
 * as a string; the function normalises to utf8 before splitting.
 */
export function extractTmuxPaneFromEnviron(
  environ: Buffer | string,
): string | null {
  const raw = Buffer.isBuffer(environ)
    ? environ.toString("utf8")
    : environ;

  const entries = raw.split("\0");

  for (const entry of entries) {
    // Strict startsWith — "TMUX_PANE_SOMETHING=" must NOT match
    if (entry.startsWith("TMUX_PANE=")) {
      const value = entry.slice("TMUX_PANE=".length);
      return value.length > 0 ? value : null;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// isValidTmuxPaneId
// ---------------------------------------------------------------------------

/**
 * Validate a tmux pane ID: must be '%' followed by one or more digits only.
 *
 * Examples: "%0" ✓, "%2" ✓, "%13" ✓
 *           "2" ✗ (missing %), "%abc" ✗ (not digits), "$(rm -rf /)" ✗
 *
 * This is a SECURITY GATE — applied before ANY downstream tmux-exec call to
 * prevent shell metacharacter injection from a compromised /proc read.
 */
export function isValidTmuxPaneId(pane: string): boolean {
  return /^%\d+$/.test(pane);
}

// ---------------------------------------------------------------------------
// resolvePidToTmuxSession
// ---------------------------------------------------------------------------

/**
 * Resolve a Claude Code process PID to its tmux session name.
 *
 * This is a pure orchestrator: it calls injected callbacks for all I/O and
 * applies structured logging at every failure branch.
 *
 * @param pid - The Claude Code process PID from the session JSON
 * @param deps.readEnviron - Reads /proc/<pid>/environ for the given PID; returns
 *   null on failure (SSH exec error, /proc ENOENT, etc.)
 * @param deps.resolveTmuxName - Runs tmux display-message for the given pane ID;
 *   returns the raw stdout (including potential trailing newline) or null on failure
 * @returns The trimmed tmux session name on success, null on any failure
 */
export async function resolvePidToTmuxSession(
  pid: number,
  deps: {
    readEnviron: (pid: number) => Promise<Buffer | string | null>;
    resolveTmuxName: (pane: string) => Promise<string | null>;
  },
): Promise<string | null> {
  // Step 1: Read /proc/<pid>/environ
  const environ = await deps.readEnviron(pid);
  if (environ === null) {
    systemLogger.warn(
      "Fleet-status: failed to read /proc/<pid>/environ for PID",
      {
        operation: "fleet_status_environ_read_failed",
        pid,
      },
    );
    return null;
  }

  // Step 2: Extract TMUX_PANE from environ
  const pane = extractTmuxPaneFromEnviron(environ);
  if (pane === null) {
    systemLogger.warn(
      "Fleet-status: TMUX_PANE absent from environ — process may not be in tmux",
      {
        operation: "fleet_status_tmux_pane_absent",
        pid,
      },
    );
    return null;
  }

  // Step 3: Validate pane ID before passing to tmux exec (defense-in-depth)
  if (!isValidTmuxPaneId(pane)) {
    systemLogger.warn(
      "Fleet-status: extracted TMUX_PANE failed validation — rejecting to prevent injection",
      {
        operation: "fleet_status_tmux_pane_invalid",
        pid,
        pane: pane.slice(0, 40),
      },
    );
    return null;
  }

  // Step 4: Resolve pane ID to session name via tmux
  const name = await deps.resolveTmuxName(pane);
  if (name === null) {
    systemLogger.warn(
      "Fleet-status: tmux could not resolve pane to session name",
      {
        operation: "fleet_status_tmux_name_unresolved",
        pid,
        pane,
      },
    );
    return null;
  }

  // Step 5: Trim and validate the resolved name
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    systemLogger.warn(
      "Fleet-status: tmux returned empty session name for pane",
      {
        operation: "fleet_status_tmux_name_unresolved",
        pid,
        pane,
      },
    );
    return null;
  }

  return trimmed;
}
