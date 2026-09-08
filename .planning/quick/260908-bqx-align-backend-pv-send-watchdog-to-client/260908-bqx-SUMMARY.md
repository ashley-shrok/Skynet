---
phase: quick-260908-bqx
plan: "01"
subsystem: claude-session/pv-send-watchdog
tags: [watchdog, pretty-view, send-path, fifo, double-submit-fix]
dependency_graph:
  requires: []
  provides: [pv-send-watchdog FIFO match primitive]
  affects: [claude-session-server pv-send-watchdog arm callsites, onLine tail notify]
tech_stack:
  added: []
  patterns: [per-session FIFO queue with dual-map (pendingByMqid + fifoBySession)]
key_files:
  created: []
  modified:
    - src/backend/claude-session/pv-send-watchdog.ts
    - src/backend/claude-session/pv-send-watchdog.test.ts
    - src/backend/claude-session/claude-session-server.ts
    - src/backend/claude-session/claude-session-server.compose-send.test.ts
decisions:
  - "FIFO head-pop via two-map structure (pendingByMqid for O(1) cancel, fifoBySession for ordered notify) rather than a single ordered Map — preserves clearPvSendWatchdog(mqid) O(1) cancel from any queue position"
  - "reconstructRawSlashCommand left in place (exported, still type-checks) — dead callsite removed without deleting the helper to minimize blast radius"
metrics:
  duration: ~20min
  completed: "2026-09-08"
  tasks_completed: 2
  files_changed: 4
---

# Quick 260908-bqx: Align Backend pv-send-watchdog to Client FIFO Match

One-liner: Replaced hash-keyed pending Map with per-session FIFO (pendingByMqid + fifoBySession); notifyMatched(sessionId) pops the oldest arm rather than searching by content hash, eliminating double-submit for all content-transforming input shapes.

## Before/After Line Counts

| File | Before | After |
|------|--------|-------|
| pv-send-watchdog.ts | 550 lines | 572 lines (+22, two-map structure + updated docs) |
| __applyOnLineNotifyForTests (lines) | 54 lines (L511-564) | 19 lines (guard + single notify) |

## Grep Gate Results

All gates passed post-implementation:

| Gate | Expected | Result |
|------|----------|--------|
| No contentHash in pv-send-watchdog.ts non-comment lines | 0 | 0 |
| No createHash sha256 update(body) at arm callsite | 0 | 0 |
| No createHash sha256 update(nonSplitBody) at arm callsite | 0 | 0 |
| notifyMatched called with 2 args (old shape) | 0 | 0 |
| notifyMatched(sessionIdFromFile) present | >= 1 | 1 |
| No contentHash in pv-send-watchdog.test.ts | 0 | 0 |
| contentHash still in queue-dedup.test.ts (untouched) | >= 1 | 1 |

## Test Counts

| File | Tests | Result |
|------|-------|--------|
| pv-send-watchdog.test.ts | 23 | All pass |
| claude-session-server.compose-send.test.ts | 35 | All pass |
| claude-session-server.queue-dedup.test.ts | 7 | All pass (regression proof) |

New tests added: T-17 (FIFO head-pop: arm two on same session, notify once clears oldest only), T-18 (notifyMatched on empty session queue is a silent no-op).

## Commits

- `e8863e32` — Task 1: pv-send-watchdog.ts + test rewrite (FIFO match primitive)
- `1acd4eaa` — Task 2: claude-session-server.ts arm callsites + __applyOnLineNotifyForTests collapse + compose-send test rewrite

## Callsites Discovered During Implementation

No surprises — all four callsites were exactly where the plan said (~L2820 split-send arm, ~L2874 non-split retry-only arm, L511-564 __applyOnLineNotifyForTests, L4606 onLine tail call). No additional hash consumers found in scope.

## queue-dedup.test.ts

Not touched. The file still has `contentHash` references for the separate queue-dedup mechanism (~L3080 in claude-session-server.ts), which uses sha256 for a different purpose (deduplication, not watchdog matching). That mechanism was explicitly out of scope per plan constraints.

## Deviations from Plan

None. Executed verbatim.

## Self-Check: PASSED

Files confirmed present:
- src/backend/claude-session/pv-send-watchdog.ts — modified, notifyMatched arity 1
- src/backend/claude-session/pv-send-watchdog.test.ts — modified, T-17 + T-18 present
- src/backend/claude-session/claude-session-server.ts — modified, __applyOnLineNotifyForTests collapsed
- src/backend/claude-session/claude-session-server.compose-send.test.ts — modified, dual-hash block replaced

Commits confirmed:
- e8863e32 present in git log
- 1acd4eaa present in git log
