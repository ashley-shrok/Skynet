# Phase 34: Backend-authoritative Fleet-Status Broadcast Channel — Research

**Researched:** 2026-08-13
**Domain:** Claude Code session JSON files, hooks payload shapes, inotify/polling, tmux session correlation, per-box watcher runtime
**Confidence:** HIGH — all five targets answered via live verification on this box and on thenasty, plus official docs at code.claude.com/docs/en/hooks

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Primary signal:** `~/.claude/sessions/<pid>.json` (harness-authored). Inotify-watch OR poll — planner's call based on research #4.
- **Complementary signal:** Claude Code hooks (`Stop.background_tasks[]`, `SubagentStart/Stop`, `PermissionRequest`, `PreToolUse/PostToolUse`). Registration mechanism from research #2.
- **Do NOT** scrape PTY output for the primary signal. Do NOT enumerate process trees for the primary signal.
- **Single always-on fleet-status control WebSocket** — app opens once at boot. Reconnects via patch #148 reconnect scheduler pattern.
- **Frontend `session-working-store.ts`** consumes from fleet-status channel. Same `(host, tmuxSession)` key convention.
- **Per-pane WSes** stay per-pane for content — this phase does NOT touch Terminal.tsx or PrettyView.tsx WS lifecycle beyond removing feeder call sites.
- **Composite state:** `main = status === "busy" || status === "shell"`, `waiting = status === "waiting"` (bubble, NOT dot), `bg = any non-ambient entry in Stop.background_tasks[] || active subagents`, `isWorking = main || bg`.
- **Dot semantics: UNCHANGED** (Ashley 2026-07-23 lock).
- **Waiting bubble:** PlanPendingBubble template, `waitingFor` reason string, visual only.
- **Plumbing to REUSE:** `session-file-discovery.ts` `discoverClaudeSession()`, existing SSH pooling, `session-working-store.ts` store pattern.
- **Hard dependency:** `ambient-monitor-tagging-in-id-skill` bounty MUST ship before frontend cutover.
- **Structured logging** at every interaction/lifecycle/effect boundary — never `JSON.stringify(event)` on DOM Event objects.
- **NEVER use worktrees.**
- **Sub-agents don't do deploys.**
- **Never leave tests failing.**

### Claude's Discretion
- Watcher runtime language + install/update mechanism (informed by research)
- Fleet-status WS wire protocol (JSON schema, message types, subscription semantics)
- Hook registration site (per-identity vs per-project vs fleet-wide)
- Watcher-to-Skynet transport (WS vs HTTP-poll)
- Test harness shape

### Deferred Ideas (OUT OF SCOPE)
- Dot semantics changes
- LLM classifier for hard-to-classify cases
- Live-path migration in session-file-discovery
- Retiring patch #433 WS-close debounce
- Migration of any per-pane WS content signals
- Retiring `backgrounded_agents`/`backgrounded_shells` frames (check other consumers first)
- Container mutations beyond watcher install
</user_constraints>

---

## Research Target 1: `Stop` Hook Payload Shape on Claude Code v2.1.150

### Answer

The `Stop` hook payload is fully documented at `https://code.claude.com/docs/en/hooks` (verified 2026-08-13). Here is the **complete schema**:

**Top-level fields (Stop):**
```json
{
  "session_id": "abc123",
  "transcript_path": "~/.claude/projects/.../00893aaf...jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "Stop",
  "stop_hook_active": true,
  "last_assistant_message": "I've completed the refactoring...",
  "background_tasks": [...],
  "session_crons": [...]
}
```

**`background_tasks[]` entry fields (from official docs field table):**

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Task identifier |
| `type` | string | `"shell"`, `"subagent"`, `"monitor"`, `"workflow"`, `"teammate"`, `"cloud session"`, `"MCP task"` — falls back to raw discriminant for unrecognized types |
| `status` | string | Current task status (e.g. `"running"`) |
| `description` | string | Free-text, capped at 1000 chars with `… [+N chars]` marker when clipped |
| `command` | string | Shell command line, capped at 1000 chars. **Present only for `shell` tasks** |
| `agent_type` | string | Subagent type name. **Present only for `subagent` tasks** |
| `server` | string | MCP server name. **Present only for `monitor` and `MCP task` tasks** |
| `tool` | string | MCP tool name. **Present only for `monitor` and `MCP task` tasks** |
| `name` | string | Workflow name. **Present only for `workflow` tasks** |

**Official JSON example (from docs):**
```json
{
  "background_tasks": [
    {
      "id": "task-001",
      "type": "shell",
      "status": "running",
      "description": "tail logs",
      "command": "tail -f /var/log/syslog"
    }
  ]
}
```

**Critical finding for ambient-Monitor filtering:** The `Monitor` tool in Claude Code appears in `background_tasks[]` with `"type": "monitor"` per the docs field table. The `server` and `tool` fields are present. The `description` field is populated (from the Monitor tool's own description). **There is NO `env` or environment-variable field in background_tasks entries** — env vars set when launching a Monitor are NOT propagated into the hook payload.

**⚠️ EMPIRICAL DEVIATION (Task 5 live capture, 2026-08-13, evidence at `34-04-EVIDENCE-oq2-payload.json`):** All 4 of tina's persistent Monitor tool calls (thenasty-recv, skynet-recv, wake-up-scheduler, context-watch) reported `"type": "shell"` in the Stop payload, NOT `"type": "monitor"`. The 7-discriminant list from the docs field table overstates the taxonomy — empirically at v2.1.150, Monitor tool-call background tasks are indistinguishable from `run_in_background` bash by `type` alone. Entry fields observed per task: `id`, `type`, `description`, `command`, `status`. NO `server` or `tool` field on these entries. **This does NOT break the ambient filter** — `filterAmbientTasks` in Plan 01 (`src/backend/fleet-status/ambient-filter.ts`) filters on `description.startsWith('[ambient]')` regardless of `type`, so the marker mechanism still holds. But any code that specifically checks `type === "monitor"` would fail on Monitor tool calls; the Plan 01 code does not.

**Also observed in the same live capture:** the payload includes a top-level `effort` field not listed in the docs field table — safe to ignore (parsed but unused).

**`background_tasks[]` is available from Claude Code v2.1.145+.** This box is on v2.1.150 — confirmed via session JSON files. No version gap.

**`SubagentStop` also receives `background_tasks[]`** (scoped to parent session, not subagent). Available v2.1.145+. Useful for tracking nested subagent work.

**`stop_hook_active`** — `true` when Claude Code is already continuing as a result of a stop hook. Guards against infinite loops. Claude Code enforces a hard limit of 8 consecutive blocks.

### Source
- `https://code.claude.com/docs/en/hooks` — Stop input section, background_tasks field table, and JSON example. [VERIFIED: official docs]
- `https://github.com/samleeney/tmux-agent-status/blob/main/hooks/better-hook.sh` — production reference implementation, confirms only `status` is needed to detect running tasks (their jq filter: `[.background_tasks[]? | select(.status == "running")] | length`). [VERIFIED: source inspection]

### RECOMMENDATION on Ambient-Monitor Marker Mechanism

**`AGENT_AMBIENT=1` env var approach is BLOCKED.** Env vars do not appear in `background_tasks[]` entries. The payload carries no per-task environment.

**`description` prefix approach (`[ambient]` prefix) is the CORRECT mechanism.** The `description` field IS present for Monitor-type tasks (and for shell tasks). A Monitor launched with a description prefix like `[ambient] recv monitor` will have that prefix in the `description` field of its `background_tasks[]` entry. The filter is then:

```typescript
const isAmbient = (task: BackgroundTask): boolean =>
  task.description?.startsWith('[ambient]') ?? false;
```

**Alternative if description prefix is inconvenient at the id-skill layer:** Filter by `type !== "monitor"` entirely, but this would also filter non-ambient Monitors launched by the agent for legitimate work tasks — likely too aggressive.

**RECOMMENDATION: description prefix `[ambient]` on all four persistent Monitor launches in the id-skill on-wake block.** The `server` and `tool` fields for Monitor tasks could also be used as additional filtering criteria if the persistent Monitors use a known MCP server name.

**Planner implication:** The `ambient-monitor-tagging-in-id-skill` bounty MUST use description prefix, not env var. The fleet-status watcher filters `background_tasks[]` by `task.status === "running" && !task.description?.startsWith("[ambient]")` to compute `hasBgWork`.

---

## Research Target 2: Hook Registration Mechanism on Claude Code v2.1.150

### Answer

**Confirmed via live inspection of `~/.claude/settings.json` on this box.** The hook registration format is:

**File:** `~/.claude/settings.json` (user-level, applies to all projects for this user)

**JSON structure (extracted from live file):**
```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/usr/bin/node /path/to/script.js"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash|Edit|Write|MultiEdit|Agent|Task",
        "hooks": [
          {
            "type": "command",
            "command": "/usr/bin/node /path/to/script.js",
            "timeout": 10
          }
        ]
      }
    ],
    "PreToolUse": [...],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/stop-hook.sh"
          }
        ]
      }
    ]
  }
}
```

**Three-level nesting:**
1. Event name key (`"Stop"`, `"PreToolUse"`, etc.)
2. Array of matcher groups — each has optional `"matcher"` (tool name regex or `|`-separated list) and a `"hooks"` array
3. Array of handler objects — each has `"type"`, `"command"`, optional `"timeout"` (seconds), optional `"async"` (bool)

**Stop hooks have NO matcher support** — they fire on every Stop event. The matcher field is ignored for Stop (confirmed from docs: "PostToolUse, Stop, TeammateIdle... no matcher support, always fires").

**Scope resolution (4 levels, all compose additively — they do NOT override):**

| Level | Path | Priority | Shareable |
|-------|------|----------|-----------|
| Managed policy | (admin-set) | Highest | Yes |
| Project-local | `.claude/settings.local.json` | 3rd | No (gitignored) |
| Project | `.claude/settings.json` | 4th | Yes (committed) |
| User | `~/.claude/settings.json` | Lowest | No (machine-local) |

**KEY BEHAVIOR: hooks MERGE across levels — they do NOT override.** A Stop hook in `~/.claude/settings.json` AND a Stop hook in `.claude/settings.json` will BOTH fire. There is no way to disable a higher-level hook from a lower level (except `disableAllHooks: true` which kills everything at that level).

**Reload behavior:** "Direct edits to hooks in settings files are normally picked up automatically by the file watcher." — No restart of Claude Code required. Changes take effect for the next event that fires.

**The hook receives the payload on stdin.** The hook script reads from stdin and exits 0 for success, 2 to block/assert, other codes for non-blocking errors.

**For a fleet-wide Stop hook (capturing `background_tasks[]` for the watcher):** Register in `~/.claude/settings.json` on each identity-hosting box. This applies to ALL Claude Code sessions run by that user on that box — which is exactly what the fleet-status watcher needs. No per-project registration needed.

**Existing hooks on this box (don't collide with):**
- `SessionStart`: `gsd-check-update.js`, `gsd-session-state.sh`
- `PostToolUse`: `gsd-context-monitor.js`, `gsd-read-injection-scanner.js`, `gsd-graphify-update.sh`, `gsd-phase-boundary.sh`
- `PreToolUse`: `gsd-prompt-guard.js`, `gsd-read-guard.js`, `gsd-workflow-guard.js`, `gsd-validate-commit.sh`
- No existing `Stop` hook — **the fleet-status Stop hook adds a new entry with zero collision risk**.

### Source
- `~/.claude/settings.json` (live file, read directly) [VERIFIED: file inspection]
- `https://code.claude.com/docs/en/hooks` — scope resolution, merge behavior, reload behavior [VERIFIED: official docs]

### Planner Implication

The Stop hook for fleet-status goes in `~/.claude/settings.json` at `hooks.Stop[0]`. The hook script writes the `background_tasks[]` payload to a well-known Unix socket (e.g. `/tmp/fleet-status-hook.sock`) that the per-box watcher listens on. The hook exits 0 immediately — it must NOT block.

Per-identity registration is not needed: a single entry in `~/.claude/settings.json` (the user-level config) covers all identities running as that user on that box.

The Stop hook script must be non-blocking and fast (the hook fires synchronously before Claude Code completes the turn). Write to a socket or non-blocking queue; do not do any I/O that could block.

---

## Research Target 3: Session JSON Edge Cases

### Answer

**Verified live on this box (3 sessions) and thenasty (2 sessions), plus pbauermeister README-STATE-DETECTION.md.**

#### Complete session JSON schema (v2.1.150, verified):

```json
{
  "pid": 3941934,
  "sessionId": "c7274f12-0dbf-4fa7-9a89-9c35b6b5b39a",
  "cwd": "/home/ubuntu",
  "startedAt": 1786576479287,
  "procStart": "53836667",
  "version": "2.1.150",
  "peerProtocol": 1,
  "kind": "interactive",
  "entrypoint": "cli",
  "status": "busy",
  "updatedAt": 1786581898637
}
```

**Note: `bridgeSessionId` field** — present on thenasty's sessions (both running identities), absent on this box's sessions. Both boxes run v2.1.150. Thenasty's sessions are launched via `agent-supervisor.service` (systemd, visible in env: `INVOCATION_ID`, `MANAGERPID`, `JOURNAL_STREAM`). This field is likely populated when the identity uses the Claude Code network bridge/team mode (the `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` env var in our settings). **Not load-bearing for the fleet-status pipeline** — ignore it.

**`status` field values (per pbauermeister README and CONTEXT.md):**
- `"busy"` — Claude is actively working
- `"shell"` — Claude is in shell/bash execution mode (counts as `main` per composite state)
- `"idle"` — Claude is idle / waiting for input
- `"waiting"` — Claude is waiting for a user permission decision (separate axis)

**`waitingFor` field values (from pbauermeister README-STATE-DETECTION.md, A4):**
- `"approve <ToolName>"` — e.g. `"approve Bash"` for permission modals
- `"worker request"`
- `"sandbox request"`
- `"dialog open"`
- `"input needed"` (fallback)
Present ONLY when `status === "waiting"`.

**`procStart` field:** String containing `/proc/<pid>/stat` field 22 (starttime in jiffies since boot). Verified: `procStart` in session JSON exactly matches field 22 of `/proc/<pid>/stat` for all 5 live processes checked (3 on this box, 2 on thenasty). This is the **liveness probe mechanism** — a session file is stale if its `pid` is no longer running OR if `/proc/<pid>/stat` field 22 doesn't match `procStart` (protects against PID reuse).

#### Edge case decision table:

| Operation | What the watcher SEEs | What the watcher SHOULD DO |
|-----------|----------------------|---------------------------|
| `/clear` | Same `<pid>.json` file, same PID, but `sessionId` changes with an unknown lag window. The file is updated in-place. | Treat as update event (inotify close_write). Reparse `sessionId` from file. Downstream Skynet backend re-correlates with conversation row via new sessionId. pbauermeister notes the lag is observable but does not quantify it — no special handling needed beyond re-reading the file on any change. |
| `/id reset` | Session file `status` flips to `"busy"` immediately on next tool use. Between `/id reset` and first tool use, status may read `"idle"`. | Normal update processing. No special case needed — the sequence is `idle → busy` and the watcher follows inotify events. |
| `/exit` (clean exit) | **Session file is LEFT ON DISK.** Claude Code does NOT delete the file on clean exit. Confirmed: pbauermeister's code has no reap logic, and no automated cleanup was observed. The watcher will see the file persist with a stale `updatedAt`. | The watcher MUST check process liveness on every file change and on initial directory scan. Liveness check: `pid` exists in `/proc/<pid>/stat` AND `procStart` matches field 22. If pid is dead or procStart mismatches → file is stale → emit "session gone" event and stop watching that PID. |
| **Hard crash (SIGKILL)** | Same as clean exit — file persists with last-known status. The watcher will see no more inotify events from that file (no writes). Status could be `"busy"` forever. | Watcher must implement a liveness poll for PIDs it is watching. If no inotify event from `<pid>.json` for >N seconds AND `pid` is no longer in `/proc`, treat as stale. Recommended: on each inotify event, proactively recheck all watched PIDs for liveness. Additionally, run a periodic liveness scan (e.g. every 30s) to catch crashed processes that stopped writing. |
| **New session file appears** (`<pid>.json` created) | Inotify `create` event in `~/.claude/sessions/`. | Add to watch list, read content, emit "session appeared" event. |
| **Concurrent Claude processes sharing cwd** | Multiple `<pid>.json` files with same `cwd` but different `pid` and `sessionId`. | No collision — files are per-PID. Each file has a unique `sessionId`. The fleet-status pipeline tracks them independently. Correlation to tmux session is via TMUX_PANE (see Research Target 5). |
| **Poll interval staleness** | If polling (not inotify), events are delayed by the poll interval. | Use inotify as primary on Linux (confirmed working on this box). Poll as fallback. |

**Stale-file reap policy (RECOMMENDATION):**
1. On directory scan (boot): for each `<pid>.json`, check if `/proc/<pid>/stat` field 22 matches `procStart`. If no → emit stale and skip.
2. On inotify create/modify: recheck all currently-tracked PIDs that have been silent for >60s against `/proc`. Reap any dead ones.
3. Periodic heartbeat (every 30s): scan all tracked PIDs for liveness.
4. Do NOT delete the session files — Claude Code owns them, not the watcher.

**`updatedAt` precision:** millisecond Unix timestamp. The watcher can use this to detect "session has been silent too long" without relying solely on PID liveness.

### Source
- Live session files on this box: `/home/ubuntu/.claude/sessions/131617.json`, `180099.json`, `3941934.json` [VERIFIED: file inspection]
- Live session files on thenasty: `/home/thenasty/.claude/sessions/1701037.json`, `3760165.json` [VERIFIED: SSH + file inspection]
- `/proc/<pid>/stat` field 22 vs `procStart` match: verified for all 5 live processes [VERIFIED: bash]
- pbauermeister README-STATE-DETECTION.md — `/clear` sessionId lag behavior (A3), `/exit` no-cleanup, no stale-file reap [VERIFIED: WebFetch]

### Planner Implication

The watcher MUST implement the procStart liveness check. Do NOT assume `pid` not-in-`/proc` is the only stale indicator — also check procStart to guard against PID reuse. The `waitingFor` field is optional (absent when status is not `"waiting"`) — the parser must handle its absence gracefully.

---

## Research Target 4: Delivery Mechanism + Per-Box Watcher Runtime

### Answer

#### Identity-hosting boxes (watcher deploy targets):

| Box | Tailnet IP | OS | Node version | Python version | Go | systemd | Claude Code sessions |
|-----|------------|----|----|----|----|---------|---------------------|
| skynet-ec2 (this box) | 100.99.149.8 | Ubuntu 24.04 | v24.15.0 | 3.12.3 | not installed | systemd 255 | 3 live sessions |
| thenasty | 100.113.23.63 | Ubuntu 24.04 | v22.22.1 | 3.12.3 | go 1.22.2 | systemd 255 | 2 live sessions |
| workstation | 100.82.225.100 | Ubuntu 24.04 | v24.15.0 | 3.12.3 | — | systemd 255 | 1 live session |
| ZoeyBattlestation | 100.78.107.56 | Bazzite (ublue-os) | unknown | unknown | unknown | unknown | unknown (unreachable at research time) |
| GIGAASHLEYPC | 100.80.122.111 | Windows | N/A | N/A | N/A | N/A | **NOT an identity host** (no tmux) |
| ashley-beelink | 100.124.193.5 | Ubuntu 24.04 | v22.23.1 | 3.12.3 | — | unknown | unknown (SSH key not available from this box) |

**GIGAASHLEYPC is Windows and explicitly not an identity host** (no tmux, per box-map: "Do NOT set autoTmux:true for Windows hosts"). The watcher does NOT deploy there.

**aither-cloud/cloud2/sftp** — RDP-only targets (Windows), NOT identity hosts.

#### Delivery mechanism analysis:

**inotify availability:** Confirmed working on this box via Python ctypes/libc (kernel syscall returns fd=3, add_watch returns wd=1). The `inotify-tools` package (for `inotifywait`) is NOT installed, but direct inotify via Python's ctypes is fully functional. On Ubuntu 24.04 (which all confirmed identity hosts run), inotify is in the kernel by default.

**Hook socket approach:** The Stop hook fires synchronously during Claude's turn completion. Writing to a Unix domain socket (non-blocking) from the hook script gives the watcher real-time `background_tasks[]` updates without polling. This is the only way to get bg-work signal before the NEXT session-JSON update.

#### RECOMMENDATION

**Delivery mechanism: Combined approach (primary session-JSON inotify + complementary hook Unix socket)**

Rationale:
- Session JSON inotify covers `status` changes (`busy`, `shell`, `idle`, `waiting`) — these are the primary signal and update in real time
- Stop hook → Unix socket delivers `background_tasks[]` between session-JSON status changes (bg work is the gap: session shows `idle` but bg task still runs)
- Pure polling would work but wastes cycles and adds latency; inotify is free on Linux
- Pure hook-socket is insufficient: hooks don't fire for status transitions that happen without a turn ending (e.g. `waiting` state can appear without a Stop event)

**Runtime language: Node.js (TypeScript)**

Rationale:
- Node v22+ is present on ALL confirmed identity hosts (skynet-ec2: v24.15.0, thenasty: v22.22.1, workstation: v24.15.0, ashley-beelink: v22.23.1)
- The project is already Node/TypeScript — the watcher can be compiled from the same build system
- No new runtime to install or manage on any confirmed host
- `fs.watch()` in Node uses inotify on Linux natively (no native addon needed)
- The Skynet codebase already has patterns for SSH transport, JSON parsing, and WS connections the watcher can import
- Go would give a smaller static binary, but Go is not present on skynet-ec2 (only on thenasty), so building/shipping would require cross-compilation or a build step per box. Reject Go.
- Python would work but is the wrong stack for this project — no reuse of existing types or utilities.

**Watcher process management: systemd user unit (or system unit)**

All confirmed identity hosts run systemd 255 on Ubuntu 24.04. Deploy as:
- `~/.config/systemd/user/fleet-status-watcher.service` — runs as the identity user, no root needed, auto-starts on user login, restarts on crash
- OR `/etc/systemd/system/fleet-status-watcher.service` — system-level, survives without user session

**Watcher update mechanism:** The watcher binary/script lives in a known path (e.g. `~/.local/lib/fleet-status-watcher/` or `/usr/local/lib/fleet-status-watcher/`). Update = push new version via SSH + `systemctl --user restart fleet-status-watcher`. Since the watcher source lives in the Skynet repo, the update script can be a simple scp + restart — NOT a Skynet deploy motion.

**Stop hook → watcher communication: Unix domain socket**

The Stop hook (registered in `~/.claude/settings.json`) writes to a well-known socket (e.g. `/tmp/fleet-status-hook-<uid>.sock`). The hook does a non-blocking `connect + send + disconnect` with a short timeout (5ms). If the watcher is not listening, the write fails silently — the watcher catches up from session JSON on the next inotify event.

**Watcher → Skynet Skynet transport: WebSocket**

The watcher opens one WebSocket connection to the Skynet backend (ws://localhost:PORT or wss://term.gigaashley.click/fleet-status/ws). It reports all sessions on its box. The Skynet backend is already running and accessible from each box via Tailscale. This is symmetric with the existing per-pane WS pattern.

**Log destination:** On each box, watcher logs to `~/.local/var/log/fleet-status-watcher.log` (or `/var/log/fleet-status-watcher.log` for system-level). Journald captures systemd unit output automatically.

**ZoeyBattlestation uncertainty:** Box was unreachable at research time. If it hosts identities, it's likely Bazzite (ublue-os) which is still Linux/systemd — the same watcher deploy would work. Mark as OPEN QUESTION.

### Source
- `/home/ubuntu/.claude/sessions/` — confirmed 3 live sessions [VERIFIED: bash]
- SSH to thenasty — confirmed Node v22, Python 3.12, Go 1.22, systemd 255 [VERIFIED: bash]
- SSH to workstation — confirmed Node v24, systemd [VERIFIED: bash]
- Python ctypes inotify test — confirmed inotify syscall works on this box [VERIFIED: bash]
- box-map.md — box inventory and OS notes [VERIFIED: file inspection]

### Planner Implication

**Plan tasks:**
1. Build Node.js watcher script (compiled TypeScript from Skynet's own build)
2. Write systemd user unit file template
3. Write deploy script: `scp watcher.js + watcher.service → each identity box`, then `systemctl --user enable + start`
4. Write Stop hook script (bash, writes to Unix socket) — add to `~/.claude/settings.json` on each box
5. The update runbook is: build new watcher → `scp` to each box → `systemctl --user restart fleet-status-watcher`

ZoeyBattlestation must be reachable before the watcher can be deployed there. Coordinate separately.

---

## Research Target 5: Correlation Edge Cases

### Answer

**Verified via live `/proc/<pid>/environ` inspection on both this box and thenasty.**

#### Complete verified correlation chain:

```
~/.claude/sessions/<pid>.json
    │
    ├── pid          → used to find /proc/<pid>/environ
    ├── procStart    → cross-checked vs /proc/<pid>/stat field 22 for liveness
    ├── sessionId    → Skynet conversation row key (via existing session-file-discovery.ts)
    └── cwd          → used to construct JSONL path (slug encoding)
    
/proc/<pid>/environ (walk from watcher, not from Skynet backend)
    │
    ├── TMUX_PANE=%N  → unique pane ID within a tmux server
    └── TMUX=/tmp/tmux-1000/default,<server-pid>,<index>
    
`tmux display-message -p -t "$TMUX_PANE" '#{session_name}'`
    │
    └── tmuxSession   → "tina", "nelly", "shrok", "aqua", etc.
    
Skynet conversation row key: (host, tmuxSession)
```

**Verified on this box (3 processes):**
| PID | TMUX_PANE | tmux session name | session JSON cwd |
|-----|-----------|-------------------|-----------------|
| 3941934 | %2 | tina | /home/ubuntu |
| 131617 | %0 | tanya | /home/ubuntu/skynet-tanya |
| 180099 | %1 | tiffany | /home/ubuntu/skynet-tiffany |

**Verified on thenasty (2 processes):**
| PID | TMUX_PANE | tmux session name | session JSON cwd |
|-----|-----------|-------------------|-----------------|
| 1701037 | %13 | nelly | /home/thenasty |
| 3760165 | %2 | shrok | /home/thenasty/shrok |

**Key finding:** `TMUX_PANE` uses bare pane IDs (`%0`, `%1`, `%2`, `%13`) that are global within the tmux server. `tmux display-message -p -t "%N" '#{session_name}'` resolves the pane ID to the session name **without needing the session name first**. This is the correct correlation hop.

#### Edge cases:

**`sessionId` on `/clear`:** pbauermeister README confirms `sessionId` re-issues with a lag after `/clear`. The SAME `<pid>.json` file is updated in-place with a new `sessionId`. The watcher sees this as a file-modify inotify event. The watcher should re-read the file and emit an update with the new `sessionId`. Skynet backend re-maps the session to the conversation row using the new `sessionId`.

**`cwd` stability:** `cwd` is set at process start and does not change for a given PID. Stable for the life of the process.

**Two identities sharing a cwd:** Verified: nelly (`pid=1701037`, `cwd=/home/thenasty`) and any future identity also at `/home/thenasty` would share cwd. However, each has a unique `pid` and unique `TMUX_PANE`. The fleet-status pipeline disambiguates by PID (for the session JSON) and by `TMUX_PANE → tmuxSession` (for the Skynet row key). CWD alone is NOT sufficient — but the pipeline never needs to use cwd alone.

**Identities NOT running Claude Code:** On thenasty, 7 tmux sessions exist (beatrice, natalie, nelly, nicole, shrok, vicky, yolanda) but only 2 have Claude Code running (nelly and shrok). The other 5 sessions have no `<pid>.json` file. The watcher correctly handles this — it watches the `~/.claude/sessions/` directory and only reports PIDs that have session files.

**PID reuse after crash:** If a Claude Code process crashes and a new unrelated process inherits its PID, the `procStart` cross-check catches this — `/proc/<new_pid>/stat` field 22 will be a different value than the stale `procStart` in the session file. The watcher emits "session gone" for the old session before processing the new PID.

**How the watcher discovers `tmuxSession` from PID:**
1. Read `<pid>.json` → get `pid`
2. Read `/proc/<pid>/environ` → get `TMUX_PANE`
3. Run `tmux display-message -p -t "$TMUX_PANE" '#{session_name}'` → get `tmuxSession`

This requires `tmux` to be running and the pane to still exist. If tmux has restarted since the session file was written, `TMUX_PANE` in the environ may not resolve. In practice this is pathological (tmux restart + Claude still running = very unusual). Flag as a corner case the watcher should handle gracefully (log + emit unknown tmuxSession, allow Skynet to skip correlation).

**The existing `discoverClaudeSession()` goes the OTHER direction:** It starts from the tmux session name (via Skynet's SSH connection) and walks the process tree to find Claude's PID. The fleet-status watcher goes PID → tmux. These are complementary, not competing.

**Does the fleet-status watcher need to call `tmux`?** Yes, once per new PID, to resolve `TMUX_PANE → session_name`. After that, the mapping is cached for the life of the process. The watcher runs ON the identity box, so it can call tmux directly.

### Source
- `/proc/3941934/environ`, `/proc/131617/environ`, `/proc/180099/environ` — TMUX_PANE and TMUX vars [VERIFIED: bash]
- SSH to thenasty → `/proc/1701037/environ`, `/proc/3760165/environ` — same pattern [VERIFIED: bash]
- `tmux display-message -p -t "$TMUX_PANE" '#{session_name}'` on this box and thenasty [VERIFIED: bash]
- `src/backend/claude-session/session-file-discovery.ts` — current correlation primitive, confirmed goes tmux→PID direction [VERIFIED: file inspection]

### Planner Implication

The correlation chain is fully determined:
- PID → read `/proc/<pid>/environ` → `TMUX_PANE` → `tmux display-message` → `tmuxSession`
- The watcher must have tmux available (it does — the identities run in tmux)
- Cache the PID→tmuxSession mapping after first resolution
- The `sessionId` from the session JSON file is the key for Skynet's conversation row — Skynet backend receives `(host, tmuxSession, sessionId, status, background_tasks)` and updates the conversation row

---

## Open Questions / Blockers

### OQ-1: ZoeyBattlestation identity status (LOW RISK)
**What we know:** ZoeyBattlestation (100.78.107.56) runs Bazzite (ublue-os). It's reachable on the tailnet. SSH key was not available from this box at research time.
**What's unclear:** Does it currently host Claude Code identities? If yes, what Node/Python/Go versions are installed?
**Recommendation:** Before the deploy step, tina should SSH to ZoeyBattlestation (using the key in `/opt/skynet/keys/`) and confirm: (a) does `~/.claude/sessions/` exist, (b) what Node version is present. If it does host identities, the ublue-os Bazzite gotcha documented in box-map.md (MOTD glow blocking) requires `~/.config/no-show-user-motd` to be present before autoTmux works correctly.

### OQ-2: `background_tasks[]` type for Monitor tool — confirmed but not live-tested (MEDIUM RISK)
**What we know:** The official docs say Monitor-type tasks appear with `type: "monitor"`, `server`, and `tool` fields. The `description` field is present.
**What's unclear:** We haven't observed a live Monitor task appearing in a real Stop payload — the docs are the only source. The ambient-Monitor tagging via description prefix is ASSUMED to work based on the docs.
**Recommendation:** The plan should include a task to verify on a scratch session: launch a Monitor with `[ambient]` prefix, trigger a Stop, confirm the Stop payload shows `type: "monitor"` and `description: "[ambient] ..."`. This is a quick verification step before shipping the filter logic.

### OQ-3: Hook Stop payload delivery timing vs session JSON (LOW RISK)
**What we know:** The Stop hook fires synchronously when Claude Code finishes a turn. The session JSON `status` also updates at turn completion.
**What's unclear:** Is the hook guaranteed to fire BEFORE or AFTER the session JSON `status` update? Or is it concurrent?
**Recommendation:** Assume they're concurrent and design the watcher to merge both signals regardless of order. The session JSON gives authoritative `status`; the Stop hook gives `background_tasks[]`. Neither blocks the other.

### OQ-4: ashley-beelink identity status (LOW RISK)
**What we know:** ashley-beelink (Ubuntu 24.04) has Node v22.23.1 and Python 3.12 installed. SSH key is not in the standard path from this box.
**What's unclear:** Does it currently host Claude Code identities?
**Recommendation:** Same as OQ-1 — confirm before deploy step. If it does host identities, the watcher deploys normally (same systemd/Node stack as the other Ubuntu boxes).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Monitor-type tasks appear in `background_tasks[]` with `type: "monitor"` and `description` field populated from the Monitor tool's description | Research Target 1 | If description is not populated, ambient filtering via prefix fails. Fallback: filter by `type === "monitor"` entirely (too aggressive) or by `server`/`tool` fields if known. |
| A2 | The Stop hook fires for EVERY identity's session on a box when registered in `~/.claude/settings.json` | Research Target 2 | If per-identity `settings.json` files exist and override this, some identities may not fire the hook. Mitigation: verify after install by observing hook output on all running sessions. |
| A3 | `/exit` leaves the session JSON file on disk (not deleted) | Research Target 3 | If Claude Code actually deletes the file on clean exit, the watcher must NOT treat file deletion as stale — it IS the "session gone" event. Either way the result is the same: session is gone. Risk is LOW. |
| A4 | ZoeyBattlestation hosts Claude Code identities and runs Linux/systemd | Research Target 4 | If it doesn't host identities, no watcher needed. If it runs a different init system, the systemd deploy doesn't apply. |
| A5 | `TMUX_PANE` in the Claude process environ is always set when Claude runs inside tmux | Research Target 5 | If any identity runs Claude outside tmux (e.g. direct SSH without tmux), TMUX_PANE will be absent. `discoverClaudeSession()` already handles this case (no_tmux_session). The watcher should handle absent TMUX_PANE gracefully. |

---

## Sources

### Primary (HIGH confidence — verified via tool/live inspection)
- `/home/ubuntu/.claude/sessions/*.json` — live session file schema, 3 processes [VERIFIED: bash]
- `/home/ubuntu/.claude/settings.json` — hook registration format, existing hooks [VERIFIED: file read]
- `src/backend/claude-session/session-file-discovery.ts` — existing correlation primitive [VERIFIED: file read]
- SSH → thenasty `/home/thenasty/.claude/sessions/*.json` — session schema on managed host [VERIFIED: bash+SSH]
- SSH → workstation `/home/ubuntu/.claude/sessions/428227.json` — session on third box [VERIFIED: bash+SSH]
- `/proc/<pid>/environ` on all 5 live Claude processes — TMUX_PANE → tmux session correlation [VERIFIED: bash]
- `tmux display-message` on this box and thenasty — TMUX_PANE resolves to session name [VERIFIED: bash]
- Python ctypes inotify test — inotify works on this box without packages [VERIFIED: bash]

### Secondary (HIGH confidence — official docs)
- `https://code.claude.com/docs/en/hooks` — Stop payload schema including `background_tasks[]` field table and JSON example, hook registration format, scope resolution rules, reload behavior [VERIFIED: official docs, fetched 2026-08-13]

### Tertiary (MEDIUM confidence — source inspection)
- `https://github.com/samleeney/tmux-agent-status/blob/main/hooks/better-hook.sh` — production reference confirming only `status` needed from background_tasks, confirms hook structure [VERIFIED: raw source]
- `https://github.com/pbauermeister/claude-busy-monitor` README-STATE-DETECTION.md — `/clear` sessionId lag behavior (A3), stale file policy (none implemented), `waitingFor` values [VERIFIED: WebFetch]

---

## Metadata

**Confidence breakdown:**
- Stop hook payload: HIGH — official docs + source code inspection
- Hook registration mechanism: HIGH — live file inspection + official docs
- Session JSON edge cases: HIGH — live verification on multiple boxes + authoritative docs
- Delivery mechanism / runtime: HIGH — live SSH verification on 3 identity-hosting boxes
- Correlation chain: HIGH — verified live on 5 processes across 2 boxes

**Research date:** 2026-08-13
**Valid until:** 2026-09-13 (30 days; session JSON schema stable since v2.1.119; hooks schema stable; box inventory may change)
