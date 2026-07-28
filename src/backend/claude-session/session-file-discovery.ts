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

  // Step 4: derive the session file from the pane's Claude CWD, then pick the
  // newest matching .jsonl. Claude Code does NOT keep the JSONL fd open across
  // the process lifetime — it opens, appends, closes per event. The initial
  // fd-walk approach silently found nothing on every pane. Instead:
  //
  //   1. Read /proc/<pane pid>/cwd (fall back to the first child if the parent
  //      proc doesn't expose it — some launchers exec the real claude in a
  //      child that owns the cwd).
  //   2. Slugify the CWD to a project-dir name: replace every `/` and `.` with
  //      `-`. So /home/ubuntu/.claude/identities/poppy/... becomes
  //      -home-ubuntu--claude-identities-poppy-... (the `--` around `.claude`
  //      is the correct output of the transform, verified on live Claude
  //      Code layouts).
  //   3. Pick the newest .jsonl in ~/.claude/projects/<slug>/. If multiple
  //      claude sessions have run in the same CWD, mtime is the mental-model-
  //      correct pick (v1 shape: one file per pane, the "current" one).
  //
  // If neither the parent nor a child pid exposes /proc/*/cwd, or the slug
  // dir has no .jsonl files, return inactive.
  const discoveryScript =
    `PID=${pid}; ` +
    `CWD=$(readlink -f /proc/$PID/cwd 2>/dev/null); ` +
    `if [ -z "$CWD" ]; then ` +
    `  KID=$(pgrep -P $PID | head -n 1); ` +
    `  [ -n "$KID" ] && CWD=$(readlink -f /proc/$KID/cwd 2>/dev/null); ` +
    `fi; ` +
    `[ -z "$CWD" ] && exit 0; ` +
    `SLUG=$(printf '%s' "$CWD" | sed 's|[./]|-|g'); ` +
    `ls -t "$HOME/.claude/projects/$SLUG"/*.jsonl 2>/dev/null | head -n 1`;

  let sessionFile: string;
  try {
    const raced = await Promise.race([
      execCommand(conn, discoveryScript),
      new Promise<string>((_, reject) =>
        setTimeout(
          () =>
            reject(new Error(`discovery timeout after ${DISCOVERY_EXEC_TIMEOUT_MS}ms`)),
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
