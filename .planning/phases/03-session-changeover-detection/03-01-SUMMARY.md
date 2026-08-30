---
phase: 03-session-changeover-detection
plan: 01
subsystem: backend
tags: [pretty-view, node, websocket, ssh, typescript, session-changeover]

# Dependency graph
requires:
  - phase: 01-live-session-stream-to-browser-read-only-pretty-view
    provides: "Backend session-file discovery, tail loop, WebSocket bridge on port 30011, and per-connection 3s ticker for context-% + harness-tasks (patch #43 + #52c)"
provides:
  - "Backend state machine (active | holding | dead) per pane WebSocket for detecting Claude session changeovers driven by /id reset or supervisor recycle"
  - "Layer 1 raw-line /exit scan in tail's onLine handler — edge-triggered sub-second latency in the graceful-recycle case (~80% of recycles per empirical check)"
  - "Layer 2 full discoverClaudeSession repoll on the existing 3s ticker as a THIRD independent setInterval — catches SIGTERM-fallback and recover-in-different-cwd cases"
  - "setupHarnessTasksPoller(uuid) helper extraction — rebinds the harness-tasks poller on session_changed so the new session's tasks dir is actually queried (BLOCKER fix per plan-checker)"
  - "Three new/updated WS event types on the claude-session bridge: {type:'session_holding'}, {type:'session_changed', newSessionFile}, {type:'inactive', reason:'holding_timeout'}"
affects: [phase-03-wave-2-frontend, future-pretty-view-patches]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-connection state machine with idempotent transition helpers (transitionToHolding, transitionToActiveNew, transitionToDead) defined inside the WS connection callback"
    - "Extracted setInterval body into a named helper (setupHarnessTasksPoller) that can be re-invoked on session change with a new UUID, preserving the poller callback body byte-for-byte"
    - "Third independent poller (discoveryRepollTimer) alongside existing context-% and harness-tasks pollers — same 3s interval, same in-flight guard pattern"
    - "Raw-line detection at the tail layer (BEFORE parser) for edge-triggered signals — matches patch #61 precedent for ExitPlanMode"

key-files:
  modified:
    - src/backend/claude-session/claude-session-server.ts

key-decisions:
  - "HOLDING_TIMEOUT_TICKS = 15 (45s) — Nelly's timing note: new .jsonl within ~5s, fully-loaded identity 30-70s later; 45s catches truly-dead recycles without prematurely giving up on a slow one"
  - "Full discoverClaudeSession per tick, NOT cached ls -t $projects_dir/*.jsonl — Nelly's recover-in-different-cwd case (2026-07-15) means the same session UUID can move projects subdirs, and cached-dir shortcut would miss it"
  - "Layer 1 /exit scan FALLS THROUGH (no return after transitionToHolding) so the parser still emits the /exit turn as a chat bubble — Ashley HARD LOCK: slash commands must remain visible in pretty view"
  - "setupHarnessTasksPoller is idempotent — safe to call with the same UUID (recover case) as a no-op restart; simplifies transitionToActiveNew (no guard needed on whether the UUID actually changed)"
  - "sessionIdChanged boolean added to claude_session_changed log line — distinguishes recycle (new UUID) from recover-in-different-cwd (same UUID) for post-deploy debugging"
  - "W1 canonical hoisting order committed unconditionally: state vars → teardownPane → const onLine → const onError → setupHarnessTasksPoller → transitionToHolding → transitionToActiveNew → transitionToDead → ws message handler body"
  - "W2 comment explicitly notes holdingTicks++ fires on EVERY holding tick including the same-file-active branch — intentional timeout pressure so a stuck same-file result during holding still counts against the 45s timeout"

patterns-established:
  - "Extract-and-parameterize pattern for poller rebind on session change (setupHarnessTasksPoller(newSessionIdFromFile))"
  - "State machine transition helpers inside WS connection callback body (colocated with per-connection let state, closes over shared references)"

requirements-covered:
  - CHANGEOVER-01 (partial — backend detection half; frontend surfacing in Wave 2)
  - CHANGEOVER-02 (both layers of two-layer detection)
  - CHANGEOVER-04 (partial — backend rebind of tasks poller + state buffered clear; frontend state reset in Wave 2)
  - CHANGEOVER-05 (recover-in-different-cwd via fresh discovery each tick)

# Ship notes
commit: 99f1837
build-verified: "npm run build clean in ~7s; npx tsc --noEmit and npx tsc -p tsconfig.node.json --noEmit both exit 0"
deploy-status: "Not deployed — batching with pending patches #61/#62/#63 per bounty pending-patch-batch-post-60"
