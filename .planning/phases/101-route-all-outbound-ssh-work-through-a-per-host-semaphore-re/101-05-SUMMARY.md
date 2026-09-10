---
phase: 101
plan: 05
subsystem: ssh
tags: [semaphore, ssh-cap, server-stats, file-manager, producer-wrap]
dependency_graph:
  requires: [101-01]
  provides: [SSH-CAP-PRODUCERS-C]
  affects:
    - src/backend/ssh/server-stats.ts
    - src/backend/ssh/file-manager.ts
    - src/backend/ssh/file-manager-session.ts
tech_stack:
  added: []
  patterns:
    - "getHostSemaphore(hostId).run(...) outer wrap over channelOpener.run for exec producers"
key_files:
  modified:
    - src/backend/ssh/server-stats.ts
    - src/backend/ssh/file-manager.ts
    - src/backend/ssh/file-manager-session.ts
decisions:
  - "D-05: wrap at collectMetrics (widget fanout entry point), not at system-collector.ts primitives — single slot for entire 8+ widget batch per host"
  - "D-06: wrap at openDedicatedTransferSession (connect motion only, not session lifetime) — covers all 10 host-transfer.ts caller sites"
  - "file-manager-session execChannel: two-branch pattern — hostId-set branch adds semaphore wrap; hostId-null branch falls through to channelOpener alone"
  - "getSessionSftp left unwrapped — SFTP channel type is out of scope for Phase 101 exec-channel focus; documented as future work"
metrics:
  duration: "~15 minutes"
  completed: "2026-09-10"
  tasks_completed: 3
  files_modified: 3
---

# Phase 101 Plan 05: Wrap Session-Managed SSH Producers — Summary

Three session-managed SSH producers wrapped against the shared per-host slot pool via `getHostSemaphore` from `host-semaphore-registry.ts`.

## Tasks Completed

### Task 1 — server-stats.ts::collectMetrics widget fanout (D-05)

Added import of `getHostSemaphore`. Wrapped `requestQueue.queueRequest(host.id, ...)` inside `getHostSemaphore(host.id).run(async () => { ... })` so the entire widget batch (cpu, memory, disk, network, uptime, processes, system, login_stats, ports, firewall — 8+ collectors) holds ONE slot in the per-host registry for the duration of the fanout.

Early-return guards (`supportsMetrics`, `authFailureTracker.shouldSkip`, `metricsCache.get`) remain OUTSIDE the wrap — they are cheap synchronous checks with no SSH work and return before any slot is acquired.

`system-collector.ts` and all other widget primitives in `widgets/` are byte-identical — they inherit the slot from `collectMetrics`.

### Task 2 — file-manager.ts::openDedicatedTransferSession (D-06)

Added import of `getHostSemaphore`. Wrapped the `new Promise<void>((resolve, reject) => { ... })` connect-and-ready block (the `startDedicatedTransferConnect + client.once("ready")` sequence) inside `getHostSemaphore(hostId).run(async () => { ... })`.

The wrap is intentionally NARROW — it covers only the SSH connect motion (the moment a new ssh2 Client is negotiated, which consumes an OpenSSH MaxSessions slot). The `SSHSession` construction and hand-off to callers happen AFTER the wrap resolves, so the slot is released before the long-lived transfer session begins.

Pre-SSH setup (browseSession lookup, ownership verification, hostId resolution, `resolveHostById`, `attachDedicatedKeyboardInteractive`, `buildDedicatedTransferConnectConfig`) stays OUTSIDE the wrap.

`host-transfer.ts` is UNTOUCHED — all 10 of its caller sites acquire dedicated sessions through this resolver, so coverage is automatic.

**Specific Promise block wrapped:** `src/backend/ssh/file-manager.ts` lines ~379-399 (the `new Promise<void>` containing `setTimeout connectTimeout`, `client.once("ready")`, `client.once("error")`, and `startDedicatedTransferConnect` call).

### Task 3 — file-manager-session.ts::execChannel exec paths (hostId available)

Added import of `getHostSemaphore`. Restructured `execChannel` into a two-branch pattern:

- **hostId-set branch:** `getHostSemaphore(session.hostId).run(() => session.channelOpener.run(() => new Promise<ClientChannel>(...))`  
  Two-layer stack: registry caps concurrent outstanding exec channels per host; channelOpener serializes channel opens on this specific session client.

- **hostId-null branch:** `session.channelOpener.run(...)` alone — existing behavior preserved for legacy or pre-migration sessions.

`execWithSudoBuffer` is covered transitively — it calls `execChannel` at L83 and does not open its own channel.

`getSessionSftp` is NOT wrapped — SFTP uses a different channel type. Phase 101 scope is exec-channel producers. See future work below.

## Known Gaps / Future Work

**hostId-null fall-through in execChannel:** Sessions where `session.hostId` is undefined still route through `channelOpener` alone without semaphore capping. Plan 101-06's grep pass will surface any call sites that create `SSHSession` objects without setting `hostId` — those sites can be patched to set `hostId` to bring the sessions into scope.

**getSessionSftp unwrapped:** SFTP channel opens in `file-manager-session.ts::getSessionSftp` are not capped by the semaphore in this plan. SFTP is a different channel type and less likely to hit the MaxSessions=10 wilma-incident mode (SFTP subsystem opens on an existing channel, not a new exec), but it is a residual uncovered exec-equivalent path. Document for future phase.

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `npm run type-check` clean (all 3 files).
- `grep -c "getHostSemaphore"` returns 2 for each file (import + usage).
- `git diff --stat -- src/backend/ssh/widgets/system-collector.ts` empty.
- `git diff --stat -- src/backend/ssh/host-transfer.ts` empty.
- `build:backend` has a pre-existing syntax error in `src/backend/database/routes/global-files-read-write.ts` (unstaged change from a different in-flight plan, stash@{0} from 101-04). This error existed before 101-05 and is unrelated to our 3 files; confirmed by `git diff HEAD -- <our-3-files>` returning empty after commit.

## Self-Check

- [x] `src/backend/ssh/server-stats.ts` modified — `getHostSemaphore` wrap at `collectMetrics`
- [x] `src/backend/ssh/file-manager.ts` modified — `getHostSemaphore` wrap at `openDedicatedTransferSession` connect block
- [x] `src/backend/ssh/file-manager-session.ts` modified — `getHostSemaphore` conditional wrap in `execChannel`
- [x] 3 commits at `dd019919`, `4acaf293`, `2a8c831d`
- [x] `system-collector.ts` and `host-transfer.ts` untouched

## Self-Check: PASSED
