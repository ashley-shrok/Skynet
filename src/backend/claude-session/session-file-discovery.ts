import type { Client } from "ssh2";
import { execCommand, queryPanePid } from "../ssh/tmux-helper.js";

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
 * Why use a descendant-tree walk instead of pane_current_command:
 * AWS Kiro CLI (bounty: kiro-cli-wrapper-defeats-claude-detection) wraps the
 * shell it launches with a pty wrapper named `kiro-cli-term`. The wrapper sets
 * argv[0]='bash' on the child shell, so tmux's pane_current_command reads
 * 'bash' — the previous strict `=== "claude"` check returned inactive/not_claude
 * even though claude was running as a grandchild of pane_pid:
 *   pane_pid → kiro-cli-term → bash --login → claude
 * All 5 thenasty identities (beatrice, nelly, shrok, vicky, yolanda) were
 * affected. The walk handles wrappers of any depth without hardcoding wrapper
 * names (Kiro today, whatever tomorrow).
 *
 * Flow:
 *   1. queryPanePid → pane_pid (null → no_tmux_session)
 *   2. Walk pane_pid descendants via `ps -eo pid=,ppid=,comm=` + awk BFS;
 *      first pid with comm='claude' is the effective claude PID. Walk includes
 *      pane_pid itself as a candidate (backcompat: pane IS claude directly).
 *      No match → not_claude. Timeout/error → exec_error.
 *   3. CWD/JSONL discovery script runs with the claude PID. Derives the
 *      ~/.claude/projects/<slug>/*.jsonl session file by readlink /proc/<pid>/cwd
 *      + slug transform + ls -t. Empty output → no_open_session_file.
 *      Active result carries the claude PID (more useful for downstream logging
 *      than pane_pid was).
 *
 * Note on `pid_unavailable` reason: it is kept in the type union for backcompat
 * with any log-scraping downstream but is no longer emitted. Missing pane_pid
 * now returns no_tmux_session (same semantic: no usable tmux session/pane).
 */
export async function discoverClaudeSession(
  conn: Client,
  sessionName: string,
): Promise<ClaudeSessionDiscoveryResult> {
  // Step 1: get pane_pid as the walk root
  const panePid = await queryPanePid(conn, sessionName);
  if (panePid === null || panePid <= 0) {
    return { status: "inactive", reason: "no_tmux_session" };
  }

  // Step 2: walk pane_pid's descendant tree to find the first pid with comm='claude'.
  // The awk pass marks pane_pid as valid (BEGIN), then does fixed-point BFS to mark
  // all descendants valid, then emits the first pid with comm='claude'. pane_pid
  // itself is included as a candidate (no `pid[i] != root` guard) so the backcompat
  // case where tmux IS directly running claude still works.
  const walkScript =
    `PID=${panePid}; ps -eo pid=,ppid=,comm= 2>/dev/null | awk -v root="$PID" '` +
    `BEGIN { valid[root] = 1 }` +
    `{ pid[NR] = $1; ppid[NR] = $2; comm[NR] = $3; n = NR }` +
    `END {` +
    `  changed = 1` +
    `  while (changed) {` +
    `    changed = 0` +
    `    for (i = 1; i <= n; i++) {` +
    `      if (!valid[pid[i]] && valid[ppid[i]]) {` +
    `        valid[pid[i]] = 1` +
    `        changed = 1` +
    `      }` +
    `    }` +
    `  }` +
    `  for (i = 1; i <= n; i++) {` +
    `    if (valid[pid[i]] && comm[i] == "claude") {` +
    `      print pid[i]; exit` +
    `    }` +
    `  }` +
    `}'`;

  let walkOutput: string;
  try {
    const raced = await Promise.race([
      execCommand(conn, walkScript),
      new Promise<string>((_, reject) =>
        setTimeout(
          () =>
            reject(new Error(`walk timeout after ${DISCOVERY_EXEC_TIMEOUT_MS}ms`)),
          DISCOVERY_EXEC_TIMEOUT_MS,
        ),
      ),
    ]);
    walkOutput = raced.trim();
  } catch {
    return { status: "inactive", reason: "exec_error" };
  }

  // Step 3: no claude anywhere in the descendant tree
  if (walkOutput === "") {
    return { status: "inactive", reason: "not_claude" };
  }

  // Step 4: parse the walk output as the claude PID
  const claudePid = parseInt(walkOutput, 10);
  if (Number.isNaN(claudePid) || claudePid <= 0) {
    return { status: "inactive", reason: "exec_error" };
  }

  // Step 5: derive the session file from the claude process's CWD, then pick the
  // newest matching .jsonl. Claude Code does NOT keep the JSONL fd open across
  // the process lifetime — it opens, appends, closes per event.
  //
  //   1. Read /proc/<claude pid>/cwd (fall back to the first child if the parent
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
    `PID=${claudePid}; ` +
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

  return { status: "active", pid: claudePid, sessionFile };
}
