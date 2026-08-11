import type { Client, ClientChannel } from "ssh2";
import { sshLogger } from "../utils/logger.js";

export interface TmuxSessionInfo {
  name: string;
  created: number;
  lastActivity: number;
  windows: number;
  attachedClients: number;
}

export interface TmuxDetectionResult {
  available: boolean;
  sessions: TmuxSessionInfo[];
}

/**
 * Run a command on the remote host via a separate exec channel.
 * Returns stdout as a string. Does not pollute the interactive shell.
 */
export function execCommand(conn: Client, command: string): Promise<string> {
  // [#407 fix] REMOVED per-exec sshLogger.info. Was firing ~30-100/sec on
  // baseline fleet-load (identity polls + tmux list-sessions). Every Phase 31
  // Logger.info call goes through console.log + enqueueBackendLog. Under load,
  // Node's stdout pipe to Docker's json-log driver saturated, console.log
  // blocked synchronously, event loop stalled ~2s. wss.on("connection") and
  // ws.on("message") handlers queued too late — client's connectToHost sent
  // in onopen was dropped before any listener existed. Confirmed by #406
  // bisect logs (CP01 fired ~2s after client onopen; msgdiag only saw a
  // later resize message, never connectToHost). Three same-day prod outages
  // (#392, #394, #396). exec-failed + exec-nonzero kept (fire rarely).
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) {
        sshLogger.error(`[tmux-helper] exec-failed command="${command.slice(0, 80)}"`, err, { operation: "tmux_exec_failed" });
        reject(err);
        return;
      }
      let stdout = "";
      let stderr = "";
      stream.on("data", (data: Buffer) => {
        stdout += data.toString("utf-8");
      });
      stream.stderr.on("data", (data: Buffer) => {
        stderr += data.toString("utf-8");
      });
      stream.on("error", (err: Error) => {
        sshLogger.error(`[tmux-helper] exec-failed command="${command.slice(0, 80)}"`, err, { operation: "tmux_exec_failed" });
        reject(err);
      });
      stream.on("close", (code: number) => {
        if (code !== 0 && stdout === "") {
          sshLogger.warn(`[tmux-helper] exec-nonzero command="${command.slice(0, 80)}" code=${code} stderrLen=${stderr.length}`, { operation: "tmux_exec_nonzero" });
          reject(
            new Error(stderr.trim() || `Command exited with code ${code}`),
          );
        } else {
          resolve(stdout.trim());
        }
      });
    });
  });
}

/**
 * Detect whether tmux is installed and list all existing sessions with details.
 */
export async function detectTmux(conn: Client): Promise<TmuxDetectionResult> {
  try {
    await execCommand(conn, "command -v tmux");
  } catch {
    return { available: false, sessions: [] };
  }

  let sessions: TmuxSessionInfo[] = [];
  try {
    const output = await execCommand(
      conn,
      `tmux list-sessions -F "#{session_name}|#{session_created}|#{session_activity}|#{session_windows}|#{session_attached}" 2>/dev/null`,
    );
    if (output) {
      sessions = output
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => {
          const [name, created, activity, windows, attached] = line.split("|");
          return {
            name,
            created: parseInt(created, 10) || 0,
            lastActivity: parseInt(activity, 10) || 0,
            windows: parseInt(windows, 10) || 0,
            attachedClients: parseInt(attached, 10) || 0,
          };
        });
    }
  } catch {
    // tmux server not running yet -- no sessions exist
  }

  return { available: true, sessions };
}

// tmux options applied on every attach/create:
// - mouse on: enables mouse wheel / touch scrollback through tmux history
// - history-limit: deep scrollback buffer on the remote host
// - set-clipboard on: use OSC 52 to sync tmux selections to the client clipboard
// - mode-keys vi: use vi-style keys in copy mode
// - MouseDragEnd: stop the selection but keep it highlighted so the user can
//   adjust and press Enter to copy (or drag again)
// - Enter: copy the (possibly adjusted) selection and exit copy mode
// - pane-mode-changed hook: on copy-mode entry, show a brief hint so users
//   know to press Enter to copy the selection
// - copy-mode WheelUp/Down: 2 lines per tick (tmux default is 5) for more
//   control while reading through scrollback. Deliberately NOT touching the
//   root WheelUp binding — tmux's default already correctly enters copy mode
//   at the shell prompt and passes wheel events through inside fullscreen
//   apps (less/vim/htop) via alternate_on detection.
// Using -q on set/set-hook to suppress errors on older tmux versions that don't support
// a particular option (e.g. set-clipboard on tmux < 2.5). Note: set-hook doesn't support -q.
const TMUX_OPTS =
  `set -gq mouse on` +
  ` \\; set -gq history-limit 50000` +
  ` \\; set -gq set-clipboard on` +
  ` \\; set -gq aggressive-resize on` +
  ` \\; set -gq mode-keys vi` +
  ` \\; bind-key -T copy-mode-vi MouseDragEnd1Pane send-keys -X stop-selection` +
  ` \\; bind-key -T copy-mode-vi Enter send-keys -X copy-selection-and-cancel` +
  ` \\; bind-key -T copy-mode-vi WheelUpPane send-keys -X -N 2 scroll-up` +
  ` \\; bind-key -T copy-mode-vi WheelDownPane send-keys -X -N 2 scroll-down` +
  ` \\; bind-key -T copy-mode WheelUpPane send-keys -X -N 2 scroll-up` +
  ` \\; bind-key -T copy-mode WheelDownPane send-keys -X -N 2 scroll-down` +
  ` \\; set-hook -g pane-mode-changed` +
  ` 'if -F "#{pane_in_mode}"` +
  ` "display-message -d 2500 \\"Adjust selection and press Enter to copy\\""'`;

/**
 * Wait for a tmux session to appear by polling via exec channel.
 * Returns the session name once found, or null on timeout.
 */
export async function waitForTmuxSession(
  conn: Client,
  sessionName: string,
  timeoutMs = 5000,
  intervalMs = 100,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await execCommand(
        conn,
        `tmux has-session -t ${shellEscape(sessionName)} 2>/dev/null`,
      );
      return sessionName;
    } catch {
      // session not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

/**
 * Write tmux attach or new-session command to the interactive shell stream.
 * Uses && exit so the shell only closes if tmux started successfully.
 */
export function attachOrCreateTmuxSession(
  stream: ClientChannel,
  existingSessionName?: string,
  newSessionName?: string,
): void {
  let command: string;
  if (existingSessionName) {
    command = `tmux ${TMUX_OPTS} \\; attach-session -t ${shellEscape(existingSessionName)} && exit\r`;
  } else {
    // -A requires -s; only add when a name is supplied so it attaches
    // to an existing session of that name instead of erroring out.
    const nameFlag = newSessionName
      ? ` -A -s ${shellEscape(newSessionName)}`
      : "";
    command = `tmux ${TMUX_OPTS} \\; new-session${nameFlag} && exit\r`;
  }

  sshLogger.info("Writing tmux command to shell", {
    operation: "tmux_attach_or_create",
    sessionName: existingSessionName || "(auto)",
    isReattach: !!existingSessionName,
  });

  stream.write(command);
}

/**
 * Query the foreground command running in the first pane of a tmux session.
 * Used to gate idle-pulse to Claude Code sessions only.
 * Returns null on any failure (session gone, tmux unavailable, etc.).
 */
export async function queryPaneCurrentCommand(
  conn: Client,
  sessionName: string,
): Promise<string | null> {
  try {
    const output = await execCommand(
      conn,
      `tmux display-message -p -t ${shellEscape(sessionName)} '#{pane_current_command}' 2>/dev/null`,
    );
    return output || null;
  } catch {
    return null;
  }
}

/**
 * Query the PID of the foreground process running in the first pane of a
 * tmux session. Used by claude-session discovery to walk /proc/<pid>/fd
 * for open JSONL session files.
 *
 * Two-case contract (Fix A, 2026-07-30):
 *   - Returns null when execCommand succeeds but the output is unparseable
 *     (empty string, non-integer, or ≤ 0). Callers treat null the same as
 *     "no tmux session" — a benign, expected signal.
 *   - THROWS (re-throws execCommand's error) on SSH-side failures so the
 *     discovery layer can classify these as exec_error rather than
 *     misreading a transient SSH failure as no_tmux_session. This is the
 *     critical distinction: "couldn't ask" (throw) vs "asked and got no"
 *     (null). The discovery layer wraps this call in try/catch and returns
 *     { status: "inactive", reason: "exec_error" } on throw, which the
 *     repoll branch treats as a silent tick (no overlay arm).
 *
 * Note: queryNewestTmuxSession's catch is left with its null-return posture —
 * its callers depend on silent-null and do not need the exec_error distinction.
 */
export async function queryPanePid(
  conn: Client,
  sessionName: string,
): Promise<number | null> {
  // Let execCommand throws propagate to the caller (SSH-side failure).
  // Only swallow the "unparseable output" case by returning null.
  const output = await execCommand(
    conn,
    `tmux display-message -p -t ${shellEscape(sessionName)} '#{pane_pid}' 2>/dev/null`,
  );
  const pid = parseInt(output, 10);
  if (Number.isNaN(pid) || pid <= 0) return null;
  return pid;
}

/**
 * Query the name of the most recently created tmux session via exec channel.
 */
export async function queryNewestTmuxSession(
  conn: Client,
): Promise<string | null> {
  try {
    const output = await execCommand(
      conn,
      `tmux list-sessions -F "#{session_created}:#{session_name}" 2>/dev/null | sort -rn | head -1 | cut -d: -f2-`,
    );
    return output || null;
  } catch {
    return null;
  }
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
