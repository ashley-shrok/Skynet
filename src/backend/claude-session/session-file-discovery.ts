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
        | "no_pid_session_file"
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
 *   3. Read $HOME/.claude/sessions/<PID>.json (Claude Code v2.1.150+), parse
 *      sessionId + cwd, slugify cwd (every `/` and `.` → `-`), construct
 *      $HOME/.claude/projects/<slug>/<sessionId>.jsonl, verify it exists.
 *      WHY: the old mtime-based approach picked by mtime and raced between two
 *      Claude sessions that shared a cwd on the same box — e.g. clicking Aqua
 *      on Workstation showed Wilma's bubbles (bounty:
 *      pretty-view-shows-wrong-session-jsonl). PID-file lookup is
 *      correct-first-time: each agent's PID file records its own sessionId,
 *      so two agents sharing a cwd can never collide.
 *      PID-file missing → no_pid_session_file.
 *      JSON invalid / missing sessionId/cwd → no_pid_session_file.
 *      sessionId resolved but JSONL not on disk → no_open_session_file.
 *      Timeout/error → exec_error.
 *
 * Note on `pid_unavailable` reason: it is kept in the type union for backcompat
 * with any log-scraping downstream but is no longer emitted. Missing pane_pid
 * now returns no_tmux_session (same semantic: no usable tmux session/pane).
 */
export async function discoverClaudeSession(
  conn: Client,
  sessionName: string,
): Promise<ClaudeSessionDiscoveryResult> {
  // Step 1: get pane_pid as the walk root.
  //
  // Fix A (2026-07-30): queryPanePid now THROWS on SSH-side failure (rethrow
  // contract) and returns null only on unparseable/empty pane_pid output. Wrap
  // in try/catch here so the entire discovery chain can return exec_error
  // without exposing the throw to the repoll timer's .then() callback.
  //
  // exec_error is the categorical "we couldn't reliably ask" signal covering
  // all four SSH-throw sites (queryPanePid, descendant walk, PID-file read,
  // JSONL test). It is distinct from the real-inactive reasons
  // (not_claude, no_pid_session_file, no_open_session_file, no_tmux_session)
  // which mean "we asked and got a definitive no." The repoll branch in
  // claude-session-server.ts switches on reason: exec_error ticks are silent
  // (no overlay arm, no holdingTicks increment); the others behave as before.
  let panePid: number | null;
  try {
    panePid = await queryPanePid(conn, sessionName);
  } catch {
    return { status: "inactive", reason: "exec_error" };
  }
  if (panePid === null || panePid <= 0) {
    return { status: "inactive", reason: "no_tmux_session" };
  }

  // Step 2: walk pane_pid's descendant tree to find the first pid with comm='claude'.
  // The awk pass marks pane_pid as valid (BEGIN), then does fixed-point BFS to mark
  // all descendants valid, then emits the first pid with comm='claude'. pane_pid
  // itself is included as a candidate (no `pid[i] != root` guard) so the backcompat
  // case where tmux IS directly running claude still works.
  // NB: JS `+` concatenation joins these strings on ONE line — awk statements
  // MUST be terminated with `;`, not just closing braces or line breaks. The
  // initial ship of this patch shipped without separators, which awk parsed as
  // one broken line and silently returned empty for every session ("no active
  // Claude session" fleet-wide). Do not remove any `;` below — each one is
  // load-bearing at the boundary between what would otherwise be two adjacent
  // statements collapsed onto the same line.
  const walkScript =
    `PID=${panePid}; ps -eo pid=,ppid=,comm= 2>/dev/null | awk -v root="$PID" '` +
    `BEGIN { valid[root] = 1 } ` +
    `{ pid[NR] = $1; ppid[NR] = $2; comm[NR] = $3; n = NR } ` +
    `END { ` +
    `  changed = 1; ` +
    `  while (changed) { ` +
    `    changed = 0; ` +
    `    for (i = 1; i <= n; i++) { ` +
    `      if (!valid[pid[i]] && valid[ppid[i]]) { ` +
    `        valid[pid[i]] = 1; ` +
    `        changed = 1; ` +
    `      } ` +
    `    } ` +
    `  } ` +
    `  for (i = 1; i <= n; i++) { ` +
    `    if (valid[pid[i]] && comm[i] == "claude") { ` +
    `      print pid[i]; exit; ` +
    `    } ` +
    `  } ` +
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

  // Step 5: read $HOME/.claude/sessions/<claudePid>.json to get the sessionId and cwd,
  // then construct the exact JSONL path. This replaces the old mtime-based approach
  // which raced between two Claude sessions sharing a cwd
  // (bounty: pretty-view-shows-wrong-session-jsonl).
  //
  // Failure taxonomy:
  //   - PID file missing or empty output → no_pid_session_file
  //   - JSON parse error / missing sessionId or cwd / non-string fields → no_pid_session_file
  //   - sessionId resolved but JSONL not on disk → no_open_session_file
  //   - SSH exec throws / times out → exec_error
  //
  // LOAD-BEARING: same JS `+` concatenation hazard as the walkScript above — see
  // walk-script comment above. Every shell statement MUST be terminated with `;`.
  // Do not remove or rely on newlines inside the template: JS `+` joins these onto
  // ONE line, and the shell needs explicit statement separators.
  // See walk-script comment above — same JS-concat hazard applies.
  const pidFileScript =
    `PID=${claudePid}; ` +
    `F=$HOME/.claude/sessions/$PID.json; ` +
    `if [ ! -f "$F" ]; then exit 10; fi; ` +
    `cat "$F"; ` +
    `printf '\\n---HOME---\\n'; ` +
    `printf '%s' "$HOME"`;

  let pidFileOutput: string;
  try {
    const raced = await Promise.race([
      execCommand(conn, pidFileScript),
      new Promise<string>((_, reject) =>
        setTimeout(
          () =>
            reject(new Error(`pid-file lookup timeout after ${DISCOVERY_EXEC_TIMEOUT_MS}ms`)),
          DISCOVERY_EXEC_TIMEOUT_MS,
        ),
      ),
    ]);
    pidFileOutput = raced;
  } catch {
    return { status: "inactive", reason: "exec_error" };
  }

  // Check for the delimiter — its absence means the PID file was not found or
  // the script exited early (exit 10 path above).
  const delimiterIndex = pidFileOutput.indexOf("---HOME---");
  if (delimiterIndex === -1) {
    return { status: "inactive", reason: "no_pid_session_file" };
  }

  const jsonPart = pidFileOutput.slice(0, delimiterIndex).trim();
  const homePart = pidFileOutput.slice(delimiterIndex + "---HOME---".length).trim();

  // Parse the PID file JSON and extract sessionId + cwd
  let sessionId: string;
  let cwd: string;
  try {
    const parsed: unknown = JSON.parse(jsonPart);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).sessionId !== "string" ||
      !(parsed as Record<string, unknown>).sessionId ||
      typeof (parsed as Record<string, unknown>).cwd !== "string" ||
      !(parsed as Record<string, unknown>).cwd
    ) {
      return { status: "inactive", reason: "no_pid_session_file" };
    }
    sessionId = (parsed as Record<string, string>).sessionId;
    cwd = (parsed as Record<string, string>).cwd;
  } catch {
    return { status: "inactive", reason: "no_pid_session_file" };
  }

  // Slugify cwd: replace every `/`, `.`, and `~` with `-`.
  // Matches Claude Code's own project-dir naming — it escapes `~` too, so any
  // cwd containing a tilde diverges here if we don't (Stacy 2026-08-08 on T800).
  const slug = cwd.replace(/[./~]/g, "-");
  const constructedPath = `${homePart}/.claude/projects/${slug}/${sessionId}.jsonl`;

  // Verify the JSONL file exists on disk (second SSH round trip — test -f)
  // LOAD-BEARING: same JS `+` hazard — see walk-script comment above.
  const testScript =
    `if [ -f "${constructedPath}" ]; then ` +
    `printf '%s' "${constructedPath}"; ` +
    `fi`;

  let testOutput: string;
  try {
    const raced = await Promise.race([
      execCommand(conn, testScript),
      new Promise<string>((_, reject) =>
        setTimeout(
          () =>
            reject(new Error(`jsonl-test timeout after ${DISCOVERY_EXEC_TIMEOUT_MS}ms`)),
          DISCOVERY_EXEC_TIMEOUT_MS,
        ),
      ),
    ]);
    testOutput = raced.trim();
  } catch {
    return { status: "inactive", reason: "exec_error" };
  }

  if (testOutput === "") {
    return { status: "inactive", reason: "no_open_session_file" };
  }

  return { status: "active", pid: claudePid, sessionFile: testOutput };
}
