import type { Client } from "ssh2";
import { execCommand, queryPanePid } from "../ssh/tmux-helper.js";
import { shellSingleQuote } from "./discover-identity-session-file.js";
import {
  buildAgentHistoryScript,
  findAgentHistoryFiles,
  parseAgentHistoryStdout,
  pickNewestOwned,
} from "./agent-history-file.js";

/** Separates the terminal check's output from the history lookup's. */
const HISTORY_MARKER = "---AGENT-HISTORY-LOOKUP---";

// Bumped 3000 → 15000ms (2026-09-02) after patch 260902-3ll's per-connection
// SSH exec semaphore (cap 8, unbounded FIFO wait queue) went live in prod.
// The old 3s was calibrated when "slow exec" meant "SSH is having trouble."
// Post-semaphore, "slow exec" often just means "you're queued behind
// fleet-status's work" — legitimate backpressure, not failure. 15s gives
// generous headroom for realistic queue-wait during a full-refresh burst
// while still detecting genuine SSH death within reasonable UX bounds.
// The visible symptom: on the first post-ship refresh with 3+ workstation
// pretty-view sessions, discovery hit the 3s timeout under transient
// sshd-session pressure, returned `{status:"inactive", reason:"exec_error"}`,
// and the attach path's dormancy probe (then gated on `not_claude` only; now
// isDormancyCandidateReason) skipped it → blank surfaces.
const DISCOVERY_EXEC_TIMEOUT_MS = 15000;

// Retry ladder for a single discovery call (2026-09-25). The mainScript and
// testScript are both idempotent read-only shell probes, so retrying on
// timeout is safe. Under a rapid multi-pane reload, N concurrent discoveries
// pile onto the same host's SSH channel queue on a busy target (workstation
// load 47, 1500+ shells); a single 15s attempt was hitting the ceiling and
// returning {status:inactive}, which strands the pane in a state PrettyView
// cannot render a ComposeBox for (see PrettyView.tsx L4496 mount gate — the
// gate requires renderedState ∈ {active,dormant,error}; inactive matches none).
// Split the same 15s budget into 3 × 5s attempts so a first-attempt loser
// gets 2 more chances to succeed before we give up. Short backoff between
// attempts to let the queue drain.
const DISCOVERY_ATTEMPT_TIMEOUT_MS = 5000;
const DISCOVERY_MAX_ATTEMPTS = 3;
const DISCOVERY_RETRY_BACKOFF_MS = 250;

/**
 * Run an idempotent SSH exec with a per-attempt timeout and bounded retry.
 * Returns the exec output on the first successful attempt, or null if all
 * attempts timed out or threw. Total worst-case latency:
 *   DISCOVERY_MAX_ATTEMPTS × DISCOVERY_ATTEMPT_TIMEOUT_MS
 *   + (DISCOVERY_MAX_ATTEMPTS - 1) × DISCOVERY_RETRY_BACKOFF_MS
 */
async function execWithRetryOnTimeout(
  conn: Client,
  script: string,
): Promise<string | null> {
  for (let attempt = 1; attempt <= DISCOVERY_MAX_ATTEMPTS; attempt++) {
    try {
      return await Promise.race([
        execCommand(conn, script),
        new Promise<string>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `discovery-exec attempt ${attempt}/${DISCOVERY_MAX_ATTEMPTS} timeout after ${DISCOVERY_ATTEMPT_TIMEOUT_MS}ms`,
                ),
              ),
            DISCOVERY_ATTEMPT_TIMEOUT_MS,
          ),
        ),
      ]);
    } catch {
      if (attempt < DISCOVERY_MAX_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, DISCOVERY_RETRY_BACKOFF_MS),
        );
      }
    }
  }
  return null;
}

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

/** Optional inputs to discovery. */
export type ClaudeSessionDiscoveryOptions = {
  /**
   * The history file the caller is already showing. When given, discovery
   * only answers "is Claude running in this agent's terminal?" and returns
   * this file unchanged — the agent's history doesn't move once found
   * (Condense: one file for life), so there is no ongoing re-lookup.
   */
  knownHistoryFile?: string | null;
};

/**
 * Is Claude running in this agent's terminal, and which file is its history?
 *
 * The two questions are answered separately:
 *   - RUNNING comes from the terminal: tmux pane_pid, then a descendant walk
 *     (`ps -eo pid=,ppid=,comm=` + awk BFS) for a process named `claude`.
 *     The walk handles pty wrappers of any depth (e.g. kiro-cli-term:
 *     pane_pid → kiro-cli-term → bash → claude). No pane → no_tmux_session;
 *     no claude → not_claude; timeout/error → exec_error.
 *   - HISTORY comes from the agent's own history folder (agent-history-file.ts),
 *     never from the Claude process: newest file there whose first real user
 *     turn is `/id <sessionName>`. None yet (launch window) →
 *     no_open_session_file.
 *
 * `sessionName` is the tmux session, which for every chat-view pane is the
 * identity name.
 *
 * `no_pid_session_file` / `pid_unavailable` stay in the reason union for
 * log-scraping backcompat but are no longer emitted.
 */
export async function discoverClaudeSession(
  conn: Client,
  sessionName: string,
  opts: ClaudeSessionDiscoveryOptions = {},
): Promise<ClaudeSessionDiscoveryResult> {
  let panePid: number | null;
  try {
    panePid = await queryPanePid(conn, sessionName);
  } catch {
    return { status: "inactive", reason: "exec_error" };
  }
  if (panePid === null || panePid <= 0) {
    return { status: "inactive", reason: "no_tmux_session" };
  }

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

  if (walkOutput === "") {
    return { status: "inactive", reason: "not_claude" };
  }

  const claudePid = parseInt(walkOutput, 10);
  if (Number.isNaN(claudePid) || claudePid <= 0) {
    return { status: "inactive", reason: "exec_error" };
  }

  if (opts.knownHistoryFile) {
    return { status: "active", pid: claudePid, sessionFile: opts.knownHistoryFile };
  }

  let historyFile: string | null;
  try {
    historyFile =
      (await findAgentHistoryFiles(conn, [sessionName])).get(sessionName) ?? null;
  } catch {
    return { status: "inactive", reason: "exec_error" };
  }
  if (historyFile === null) {
    return { status: "inactive", reason: "no_open_session_file" };
  }
  return { status: "active", pid: claudePid, sessionFile: historyFile };
}

/**
 * One-round-trip variant of discoverClaudeSession for cold attach. Same two
 * questions, one exec: the terminal check (tmux pane_pid → its process
 * session → a `claude` in it) and, when Claude is running, the agent-folder
 * history lookup appended to the same script.
 *
 * Failure taxonomy (same reason strings as discoverClaudeSession):
 *   no_tmux_session      — no pane for this tmux session
 *   not_claude           — no process named claude in the pane's session
 *   no_open_session_file — Claude running, but no `/id <name>` history yet
 *   exec_error           — SSH exec threw / every attempt timed out
 *
 * LOAD-BEARING: JS `+` joins these strings on ONE shell line — every shell
 * statement MUST be terminated with `;`.
 */
export async function discoverClaudeSessionBatched(
  conn: Client,
  sessionName: string,
  opts: ClaudeSessionDiscoveryOptions = {},
): Promise<ClaudeSessionDiscoveryResult> {
  const mainScript =
    `TMUX_SESSION=${shellSingleQuote(sessionName)}; ` +
    `PANE_PID=$(tmux display-message -p -t "$TMUX_SESSION" '#{pane_pid}' 2>/dev/null); ` +
    `if [ -z "$PANE_PID" ] || ! [ "$PANE_PID" -gt 0 ] 2>/dev/null; then ` +
    `echo NO_TMUX_SESSION; exit 0; ` +
    `fi; ` +
    // Step 2: session-scoped descendant walk. tmux calls setsid() when creating
    // a pane, so the pane's shell gets a fresh session ID (SID) that all its
    // descendants inherit unless they setsid themselves. claude does NOT
    // setsid (it needs TTY control), so ps --sid filtered by the pane's SID
    // returns exactly this pane's process tree — typically 2-4 rows. This
    // replaces the pre-2026-09-25 `ps -eo pid,ppid,comm | awk BFS` full-box
    // scan that on workstation (150 tmux sessions, thousands of processes)
    // hit ~12s per pane and serialized N-pane reloads into 12N-second
    // stalls on cold boot. Cost is now O(N_processes_in_pane_session)
    // regardless of how many other sessions the box hosts.
    `PANE_SID=$(ps -o sid= -p "$PANE_PID" 2>/dev/null | tr -d ' '); ` +
    `if [ -z "$PANE_SID" ]; then echo NOT_CLAUDE; exit 0; fi; ` +
    `CLAUDE_PID=$(ps --sid "$PANE_SID" -o pid=,comm= 2>/dev/null | awk '$2=="claude" {print $1; exit}'); ` +
    `if [ -z "$CLAUDE_PID" ]; then echo NOT_CLAUDE; exit 0; fi; ` +
    `echo OK; ` +
    `echo "$CLAUDE_PID"; ` +
    `echo "${HISTORY_MARKER}"; ` +
    (opts.knownHistoryFile ? "true" : buildAgentHistoryScript([sessionName]));

  const mainRaw = await execWithRetryOnTimeout(conn, mainScript);
  if (mainRaw === null) {
    return { status: "inactive", reason: "exec_error" };
  }
  const mainOutput = mainRaw.trim();

  if (mainOutput === "NO_TMUX_SESSION") {
    return { status: "inactive", reason: "no_tmux_session" };
  }
  if (mainOutput === "NOT_CLAUDE") {
    return { status: "inactive", reason: "not_claude" };
  }
  if (!mainOutput.startsWith("OK\n")) {
    return { status: "inactive", reason: "exec_error" };
  }

  const markerIdx = mainOutput.indexOf(`\n${HISTORY_MARKER}`);
  if (markerIdx === -1) {
    return { status: "inactive", reason: "exec_error" };
  }
  const claudePid = parseInt(mainOutput.slice(3, markerIdx).trim(), 10);
  if (Number.isNaN(claudePid) || claudePid <= 0) {
    return { status: "inactive", reason: "exec_error" };
  }

  if (opts.knownHistoryFile) {
    return { status: "active", pid: claudePid, sessionFile: opts.knownHistoryFile };
  }

  const historyStdout = mainRaw.slice(
    mainRaw.indexOf(HISTORY_MARKER) + HISTORY_MARKER.length + 1,
  );
  const historyFile =
    pickNewestOwned([sessionName], parseAgentHistoryStdout(historyStdout)).get(sessionName) ?? null;
  if (historyFile === null) {
    return { status: "inactive", reason: "no_open_session_file" };
  }
  return { status: "active", pid: claudePid, sessionFile: historyFile };
}
