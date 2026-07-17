import type { Client } from "ssh2";
import {
  execCommand,
  queryPaneCurrentCommand,
  queryPanePid,
} from "../ssh/tmux-helper.js";

const DISCOVERY_EXEC_TIMEOUT_MS = 3000;

export type ClaudeSessionDiscoveryResult =
  | { status: "active"; pid: number; sessionFile: string }
  | {
      status: "inactive";
      reason:
        | "no_tmux_session"
        | "not_claude"
        | "pid_unavailable"
        | "no_open_session_file"
        | "exec_error";
    };

/**
 * Locate the JSONL session file the pane's Claude Code process is writing to,
 * via the existing SSH exec channel. Returns an active result with pid +
 * absolute file path, or an inactive result classifying why not.
 *
 * Why walk the pane's descendants + self: Claude Code sometimes buffers session
 * file writes through a child process — the JSONL fd lives on a child, not the
 * top-level `claude` PID that tmux reports as pane_current_command. So we
 * readlink /proc/<p>/fd/* for the pane PID AND each direct child, and pick the
 * first match under ~/.claude/projects/*.jsonl. `head -n 1` intentionally picks
 * the first hit: if a pane somehow hosts multiple claude sessions with multiple
 * open JSONLs, later plans can revisit — v1 discovery is one file per pane.
 */
export async function discoverClaudeSession(
  conn: Client,
  sessionName: string,
): Promise<ClaudeSessionDiscoveryResult> {
  // Step 1: pane foreground command
  const currentCommand = await queryPaneCurrentCommand(conn, sessionName);
  if (currentCommand === null) {
    return { status: "inactive", reason: "no_tmux_session" };
  }

  // Step 2: literal "claude" match, matching patch #13's identity-check style.
  // No substring, no "claude-code", no wrapper scripts — deliberately narrow.
  const trimmedCommand = currentCommand.trim();
  const isClaude = trimmedCommand === "claude";
  if (!isClaude) {
    return { status: "inactive", reason: "not_claude" };
  }

  // Step 3: pane PID
  const pid = await queryPanePid(conn, sessionName);
  if (pid === null || pid <= 0) {
    return { status: "inactive", reason: "pid_unavailable" };
  }

  // Step 4: walk pgrep descendants + the pane PID itself for an open JSONL
  // under ~/.claude/projects/. The regex sees `\.` (literal dot) — the double
  // backslash in the template literal produces a single backslash for grep.
  const fdWalkCommand =
    `for p in $(pgrep -P ${pid}; echo ${pid}); do ` +
    `readlink -f /proc/$p/fd/* 2>/dev/null; ` +
    `done | grep -E '/\\.claude/projects/.*\\.jsonl$' | head -n 1`;

  let sessionFile: string;
  try {
    const raced = await Promise.race([
      execCommand(conn, fdWalkCommand),
      new Promise<string>((_, reject) =>
        setTimeout(
          () =>
            reject(new Error(`fd-walk timeout after ${DISCOVERY_EXEC_TIMEOUT_MS}ms`)),
          DISCOVERY_EXEC_TIMEOUT_MS,
        ),
      ),
    ]);
    sessionFile = raced.trim();
  } catch {
    return { status: "inactive", reason: "exec_error" };
  }

  if (sessionFile === "") {
    return { status: "inactive", reason: "no_open_session_file" };
  }

  return { status: "active", pid, sessionFile };
}
