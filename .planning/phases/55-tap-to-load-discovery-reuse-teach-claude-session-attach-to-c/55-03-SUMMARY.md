---
phase: 55-tap-to-load-discovery-reuse-teach-claude-session-attach-to-c
plan: "03"
subsystem: claude-session/discovery
tags: [cache, session-file, discovery, batched-ssh, observability, tdd, backend-only]
dependency_graph:
  requires:
    - "55-01: session-file-cache module (readSessionFileCache)"
    - "55-02: fleet-status writer (writeSessionFileCache in processPid)"
  provides:
    - "discoverClaudeSessionBatched(conn, sessionName) — 2-round-trip fresh discovery"
    - "Cache-hit shim in connectToPane at L6777-6835 of claude-session-server.ts"
    - "Observability log per attach: path=shared-hit|batched-fresh + durationMs"
  affects:
    - src/backend/claude-session/session-file-discovery.ts
    - src/backend/claude-session/session-file-discovery.test.ts
    - src/backend/claude-session/claude-session-server.ts
tech_stack:
  added: []
  patterns:
    - "Additive export: discoverClaudeSessionBatched appended after existing discoverClaudeSession"
    - "Same JS-concat + semicolon-terminator discipline as walkScript (LOAD-BEARING)"
    - "Cache-hit early-return after startActiveSessionFlow — aside subsystem runs inside closure"
    - "Two-branch observability log: exactly one path log per attach"
key_files:
  created: []
  modified:
    - src/backend/claude-session/session-file-discovery.ts
    - src/backend/claude-session/session-file-discovery.test.ts
    - src/backend/claude-session/claude-session-server.ts
decisions:
  - "discoverClaudeSessionBatched delivers 2 round-trips (main batched script + test-f existence check) — not 1 as the original CONTEXT.md figure suggested; RESEARCH confirmed the existence check is load-bearing to avoid active-status on nonexistent JSONL"
  - "Aside subsystem confirmed ALL inside startActiveSessionFlow (verified L7192-7198 comment + code read); cache-hit return statement placed AFTER startActiveSessionFlow call, so aside registration runs unchanged on both branches"
  - "Dormant-poll seam at L6930 intentionally unchanged — still calls legacy serial discoverClaudeSession; dormant polling has different concurrency semantics (dormantPollInFlight guard, 3s cadence)"
  - "Integration tests placed in session-file-discovery.test.ts (not a new file) to reuse the existing vi.mock setup for execCommand — avoids spinning up the full WS server"
metrics:
  duration: "~18 minutes"
  completed: "2026-08-23"
  tasks_completed: 2
  tasks_total: 2
  files_created: 0
  files_modified: 3
---

# Phase 55 Plan 03: Cache-hit Shim + Batched Discovery Summary

**One-liner:** discoverClaudeSessionBatched compresses 4 serial SSH round-trips into 2; cache-hit shim in connectToPane at L6777-6835 skips discovery entirely on cache hit and emits one observability log per attach.

## What Was Built

### Task 1: discoverClaudeSessionBatched (session-file-discovery.ts)

Appended `discoverClaudeSessionBatched(conn: Client, sessionName: string): Promise<ClaudeSessionDiscoveryResult>` after the existing `discoverClaudeSession` function. The original function is UNCHANGED.

| Round-trip | What it does |
|---|---|
| 1 (main script) | tmux display-message → awk BFS walk → PID-file read → structured stdout emit |
| 2 (test-f) | `if [ -f "<constructedPath>" ]` — verifies JSONL exists before returning active |

**Round-trip count actually delivered: 2** (main script + test-f). On early-exit branches (no_tmux_session / not_claude / no_pid_session_file), only 1 round-trip fires; the test-f is skipped.

Stdout format from main script on success:
```
OK
<CLAUDE_PID>
<HOME_VAL>
---SESSION-JSON---
<raw SESSION_JSON blob>
```

Slug construction (`cwd.replace(/[./~]/g, "-")`) stays in JS — same fragile-across-versions reasoning as L224 of the existing helper (Stacy 2026-08-08 on T800).

### Task 2: Cache-hit shim in connectToPane (claude-session-server.ts)

**Shim insertion point: L6777-6835** (replacing the original single `discoverClaudeSession` call at L6776).

**New imports added at L10-11:**
- Combined: `import { discoverClaudeSession, discoverClaudeSessionBatched } from "./session-file-discovery.js";`
- New: `import { readSessionFileCache } from "../fleet-status/session-file-cache.js";`

**Cache-hit path (L6800-6812):**
1. `const discoveryT0 = Date.now();`
2. `const cached = readSessionFileCache(hostId, tmuxSession);`
3. If `cached !== null`: emit `sshLogger.info("Claude session discovery path", { ..., path: "shared-hit", durationMs })` → call `startActiveSessionFlow({ pid: cached.pid, sessionFile: cached.sessionFile, ... })` → `return;`

**Cache-miss path (L6816-6835):**
1. `const result = await discoverClaudeSessionBatched(conn, tmuxSession);`
2. Emit `sshLogger.info("Claude session discovery path", { ..., path: "batched-fresh", durationMs })`
3. Preserve pre-existing `sshLogger.info("Claude session discovery result", { ..., status: result.status })` exactly as before
4. Falls through to existing `if (result.status === "inactive")` branch (unchanged)

**Aside subsystem verification — L7192-7198 verbatim:**
```
// Initial active discovery path: call startActiveSessionFlow now.
// The aside subsystem (fan-out registration, connect-time probe,
// extraction poller, harness-tasks poller, discovery-repoll timer,
// tail start) is ALL inside startActiveSessionFlow and runs here.
// The dormant-poll wake path calls startActiveSessionFlow() too,
// then does a guarded aside fan-out registration (see startActiveFlow
// callback in the dormant-poll block above).
```

Assumption A2 confirmed: the aside block is ALL inside `startActiveSessionFlow`. The cache-hit `return;` at L6812 skips only the inactive-branch handling and the now-redundant L7199 call — the aside registration runs unchanged via the `startActiveSessionFlow` closure.

## Test Results

### Task 1: discoverClaudeSessionBatched tests (10 new)

`npx vitest run src/backend/claude-session/session-file-discovery.test.ts -t "discoverClaudeSessionBatched"` — **10/10 green**

| Test | Name | Exec count | Result |
|------|------|-----------|--------|
| batched-1 | happy path — full success | 2 | PASS |
| batched-2 | no pane_pid → no_tmux_session | 1 | PASS |
| batched-3 | no claude in tree → not_claude | 1 | PASS |
| batched-4 | PID file missing → no_pid_session_file | 1 | PASS |
| batched-5 | PID JSON malformed → no_pid_session_file | 1 | PASS |
| batched-6 | PID JSON missing sessionId → no_pid_session_file | 1 | PASS |
| batched-7 | JSONL not on disk → no_open_session_file | 2 | PASS |
| batched-8 | main exec throws → exec_error | — | PASS |
| batched-9 | test-f exec throws → exec_error | — | PASS |
| batched-10 | main exec times out → exec_error | — | PASS |

### Task 2: Phase 55 integration tests (3 new)

`npx vitest run src/backend/claude-session/session-file-discovery.test.ts -t "Phase 55"` — **3/3 green**

| Test | Name | Result |
|------|------|--------|
| integration-1 | cache-hit cross-type coercion (string writer, number reader) | PASS |
| integration-2 | batched-fresh path returns active on well-formed data | PASS |
| integration-3 | cache-miss falls through immediately; no fleet-status coupling | PASS |

**Total new tests: 13** (10 batched + 3 integration)

**Full directory run:** `npx vitest run src/backend/claude-session/` — **541/541 green** (37 test files, 1 skipped from fake-timers context)

**Pre-existing session-file-discovery tests:** 14 original tests still green (all 28 tests in the file pass)

## Acceptance Criteria Verification

### Task 1

| Criterion | Result |
|-----------|--------|
| `grep -c "^export.*discoverClaudeSessionBatched" session-file-discovery.ts` = 1 | **1** |
| `grep -c "^export.*discoverClaudeSession\b" session-file-discovery.ts` = 2 | **2** (original + batched) |
| `tmux display-message` only in batched script (non-comment lines) | PASS — 1 non-comment match, inside batched script |
| `shellSingleQuote` used in non-comment lines (≥1) | **2** matches |
| All 10 batched-* tests green | PASS |
| Pre-existing 14 tests still green | PASS |
| `npm run build:backend` exit 0 | PASS |

### Task 2

| Criterion | Result |
|-----------|--------|
| `grep -n "readSessionFileCache" claude-session-server.ts` = 2 lines (import + call) | **2**: L11 + L6800 |
| `grep -n "discoverClaudeSessionBatched" claude-session-server.ts` = 2 lines | **2**: L10 + L6816 |
| `grep -n "discoverClaudeSession\b"` — legacy still referenced at dormant-poll seam | PASS — L6930 |
| `grep -c 'sshLogger.info("Claude session discovery path"'` = 2 | **2** |
| `grep -c 'sshLogger.info("Claude session discovery result"'` = 1 | **1** |
| `grep -c 'path: "shared-hit"'` = 1 | **1** |
| `grep -c 'path: "batched-fresh"'` = 1 | **1** |
| All 3 integration tests green | PASS |
| All pre-existing claude-session tests green (541 total) | PASS |
| `npm run build:backend && npm run build` exit 0 | PASS |
| `git diff src/ui/` shows zero changes | PASS (0 bytes diff) |
| Added `startActiveSessionFlow` refs ≤ 1 | **1** (cache-hit branch only) |

## Threat Model Compliance

| Threat | Disposition | Status |
|--------|-------------|--------|
| T-55-07 Shell injection via tmuxSession | mitigate | `shellSingleQuote(sessionName)` wraps the single interpolation point in batched script; upstream WS-attach validator restricts tmuxSession |
| T-55-08 Stale cache serves wrong session | accept | Downstream recovery (repoll ticker + lastKnownSessionFileRef rotation-reset) handles within ~2-3s; trade-off intentional |
| T-55-09 Observability log leaks path/tmuxSession | accept | Same fields already in pre-existing "Claude session discovery result" log |
| T-55-10 Aside registration skipped on cache-hit | mitigate | Verified L7192-7198: aside ALL inside startActiveSessionFlow; cache-hit return placed AFTER startActiveSessionFlow call |

## Deviations from Plan

None — plan executed exactly as written. Round-trip count is 2 (not 1) as the plan's `<action>` block explicitly documented after plan-check: "Effective round-trip count: 2 for cache-miss vs 4 today."

## Known Stubs

None. This plan wires the reader side of a production performance optimization.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes. All changes are server-side within the existing WebSocket handler.

## Self-Check: PASSED

- `src/backend/claude-session/session-file-discovery.ts` modified (discoverClaudeSessionBatched added): VERIFIED
- `src/backend/claude-session/session-file-discovery.test.ts` modified (13 new tests): VERIFIED
- `src/backend/claude-session/claude-session-server.ts` modified (shim at L6777-6835): VERIFIED
- Task 1 commit `6ad90842` exists: VERIFIED
- Task 2 commit `c5c67fa2` exists: VERIFIED
- All 28 session-file-discovery tests: GREEN
- All 541 claude-session tests: GREEN
- Backend build: EXIT 0
- Frontend build: EXIT 0
- Frontend untouched: `git diff src/ui/` = 0 bytes
- Dormant-poll seam L6930: still uses legacy discoverClaudeSession (verified by grep)
