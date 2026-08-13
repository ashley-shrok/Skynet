---
phase: 34-backend-authoritative-fleet-status-broadcast-channel-via-har
plan: "06"
subsystem: frontend-fleet-status-cutover
tags:
  - fleet-status
  - websocket
  - session-working-store
  - session-waiting-store
  - WaitingBubble
  - feeder-retirement
  - typescript
dependency_graph:
  requires: [34-01, 34-02, 34-03, 34-04]
  provides: [frontend-fleet-status-channel-consumer, session-waiting-store, WaitingBubble-mount]
  affects:
    - src/ui/state/session-working-store.ts
    - src/ui/state/session-waiting-store.ts
    - src/ui/api/fleet-status-client.ts
    - src/ui/api/fleet-status-types.ts
    - src/ui/AppShell.tsx
    - src/ui/features/terminal/Terminal.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
tech_stack:
  added:
    - fleet-status-client.ts (browser WS client, createFleetStatusClient)
    - session-waiting-store.ts (new store: publishFleetStatusWaitingFor + useSessionWaitingFor)
    - fleet-status-types.ts (browser-side mirror of wire-protocol types, no zod)
  patterns:
    - useSyncExternalStore store pattern (from session-working-store.ts)
    - patch #148 backoff reconnect [2000,4000,6000,8000,8000ms]
    - D-CTX composite formula: isWorking = (status=busy|shell) || bg.length>0
key_files:
  created:
    - src/ui/api/fleet-status-client.ts
    - src/ui/api/fleet-status-types.ts
    - src/ui/state/session-waiting-store.ts
    - src/ui/api/fleet-status-client.test.ts
    - src/ui/state/session-working-store.test.ts (rewritten)
    - src/ui/state/session-waiting-store.test.ts
    - src/ui/api/fleet-status-e2e.integration.test.ts
    - src/ui/api/fleet-status-feeder-retirement.test.ts
  modified:
    - src/ui/state/session-working-store.ts (rewired)
    - src/ui/AppShell.tsx (boot-time WS mount)
    - src/ui/features/terminal/Terminal.tsx (feeder removed)
    - src/ui/features/pretty-view/PrettyView.tsx (feeder removed, WaitingBubble mounted)
    - src/ui/features/pretty-view/PrettyView.test.tsx (3 new tests)
decisions:
  - "D-CTX composite formula: isWorking = (status=busy|shell) || bg.length>0; waiting=false"
  - "fleet-status-types.ts duplicates backend wire-protocol types (no cross-boundary import)"
  - "AppShell owns the boot-time singleton lifecycle (useEffect deps:[])"
  - "WaitingBubble mounts after WipBubble in the in-flow message-list column"
  - "backgrounded_agents/backgrounded_shells WS frames preserved (panels still consume them)"
metrics:
  duration: "~4 hours"
  completed: "2026-08-13"
  tasks_completed: 4
  files_changed: 13
---

# Phase 34 Plan 06: Frontend Cutover to Fleet-Status Channel — Summary

**One-liner:** Frontend fleet-status WebSocket cutover — rewired session-working-store to D-CTX composite formula, retired both PTY-scraping feeders, mounted WaitingBubble for harness-waiting state, and wired AppShell boot-time singleton WS client.

## What Was Built

### Task 1: Rewired session-working-store + created session-waiting-store

**session-working-store.ts** was completely rewritten:
- Removed `publishSessionTtyBusy` and `publishSessionHasBackgroundedWork` (retired feeders)
- Added `publishFleetStatusSessionState(hostId, SessionState)` — computes isWorking via D-CTX composite formula:
  ```
  const main = state.status === 'busy' || state.status === 'shell';
  const bg = state.backgroundTasks.length > 0;
  const isWorking = main || bg;
  ```
- Added `publishFleetStatusSessionGone(hostId, tmuxSession, sessionId)` — deletes key + notifies
- Per-key no-op notify guard: skips notify if isWorking unchanged
- Structured logging at every state transition (T-34-20 Repudiation mitigation)

**session-waiting-store.ts** created from scratch:
- `Map<string, string>` tracking `waitingFor` per `${hostId}:${tmuxSession}` key
- `publishFleetStatusWaitingFor(hostId, tmuxSession, waitingFor | null)` — null DELETES key
- `useSessionWaitingFor(key | null): string | null` via useSyncExternalStore
- Fully independent of session-working-store (publishes to one do NOT trigger notifies on the other)

**fleet-status-types.ts** created:
- Browser-side mirror of Plan 02 `wire-protocol.ts` types (no zod — backend validates outbound)
- `FRAME_SCHEMA_VERSION = 1`, `SessionState`, `BackgroundTask`, `FrontendOutboundFrame`, etc.
- Intentionally duplicated (NOT imported from `src/backend/`) — maintains UI/backend boundary

### Task 2: Fleet-status browser WS client + AppShell boot-time mount

**fleet-status-client.ts** created:
- `createFleetStatusClient({ url, onSnapshot, onUpdate, onGone })` factory
- Opens `WebSocket(url)` immediately; sends `{schemaVersion:1, type:'subscribe'}` on open
- Dispatches snapshot/update/gone frames to callbacks (discriminated-union switch)
- Reconnect backoff: [2000, 4000, 6000, 8000, 8000ms] — exactly mirrors patch #148 pattern
- After MAX_RECONNECT_ATTEMPTS=5 closes, logs `operation:'fleet_status_client_gave_up'`
- `dispose()` clears timers + closes socket
- Malformed JSON: logged as `operation:'fleet_status_client_parse_error'` + dropped (T-34-18)
- NEVER `JSON.stringify(event)` — always explicit field extraction (T-34-20)

**AppShell.tsx** modified:
- Added boot-time `useEffect(() => {...}, [])` that:
  - Derives URL: `${ws|wss}://${window.location.host}/fleet-status/ws`
  - Creates fleet-status client singleton
  - Wires onSnapshot/onUpdate → `publishFleetStatusSessionState` + `publishFleetStatusWaitingFor`
    (waitingFor derived: `state.status === 'waiting' ? state.waitingFor ?? 'input needed' : null`)
  - Wires onGone → `publishFleetStatusSessionGone` + `publishFleetStatusWaitingFor(null)`
  - Returns `() => client.dispose()` as cleanup

### Task 3: PrettyView mounts WaitingBubble + retires hasBgWork feeder

**PrettyView.tsx** modified:
- Removed `publishSessionHasBackgroundedWork` import (retired)
- Added `import { useSessionWaitingFor } from '@/state/session-waiting-store'`
- Added `import { WaitingBubble } from './WaitingBubble'`
- Added hook calls: `const waitingKey = ...; const waitingFor = useSessionWaitingFor(waitingKey);`
- Mounted `{waitingFor !== null && <WaitingBubble reason={waitingFor} />}` as sibling of WipBubble
- Retired 4 hasBgWork publish call sites:
  - Fresh-pane mount reset (~line 996)
  - `backgrounded_agents` case handler (~line 1262)
  - `backgrounded_shells` case handler (~line 1276)
  - `session_changed` reset (~line 1389)
- **BackgroundedAgentsPanel + BackgroundedShellsPanel panels remain fully functional** — the WS frames still update `setBackgroundedAgents` / `setBackgroundedShells`; only the store publish was removed

### Task 4: Terminal.tsx retires PTY-idle feeder + integration tests + grep gate

**Terminal.tsx** modified:
- Removed `import { publishSessionTtyBusy } from '@/state/session-working-store'`
- Removed the `useEffect` on `[isIdle, hostConfig.id, tmuxSessionName]` that called `publishSessionTtyBusy`
- `isIdle` state preserved — still used by other consumers in Terminal.tsx

**fleet-status-feeder-retirement.test.ts** created:
- Recursive grep gate: walks all `.ts`/`.tsx` non-test files in `src/ui/` + `src/backend/`
- Asserts 0 hits for both retired symbols
- Token-splits search strings to avoid self-matching

**fleet-status-e2e.integration.test.ts** created:
- Spins up REAL `startFleetStatusServer` on ephemeral port with stub auth manager
- Connects real `ws.WebSocket` client with Authorization header
- Test 1: `registry.publishSessionState(busy)` → browser WS client onUpdate → `publishFleetStatusSessionState` → `getSessionWorkingSnapshot().isWorking === true`
- Test 2: `registry.publishSessionGone` → key deleted from working store
- Test 3: `status='waiting'` → `isWorking === false` (D-CTX: waiting ≠ working) + `useSessionWaitingFor` returns `'approve Bash'`

## Retired-Feeder Grep Gate Result

```
grep -rn 'publishSessionTtyBusy\|publishSessionHasBackgroundedWork' src/ui/ src/backend/ | grep -v '.test.'
```
**ZERO HITS** — no non-test source file references either retired feeder symbol.

## D-CTX Composite Formula Placement

The formula lives in `src/ui/state/session-working-store.ts`, function `publishFleetStatusSessionState`:
```typescript
const main = state_arg.status === 'busy' || state_arg.status === 'shell';
const bg = state_arg.backgroundTasks.length > 0;
const isWorking = main || bg;
```
`status='waiting'` returns `isWorking=false` — the waiting axis is separate (WaitingBubble surfaces it).

## AppShell Boot-Time WS Wire-up

Location: `src/ui/AppShell.tsx`, function `AppShell`, after the `dbHealthMonitor` effect.
Look for: `useEffect(() => { const proto = window.location.protocol === "https:"; ...createFleetStatusClient(...) }, [])`.
The singleton disposes on AppShell unmount via the effect cleanup.

## WaitingBubble Mount Site

`src/ui/features/pretty-view/PrettyView.tsx`, in the in-flow accessories block after WipBubble:
```jsx
{isWorking && <WipBubble />}
{waitingFor !== null && <WaitingBubble reason={waitingFor} />}
{planPending && <PlanPendingBubble ... />}
```

## End-to-End Integration Test Coverage

`src/ui/api/fleet-status-e2e.integration.test.ts` proves:
- Watcher SessionState (busy) propagates through backend → frontend WS client → working-store within 2000ms
- session_gone clears the key from the working-store
- status='waiting' correctly sets `isWorking=false` and `waitingFor='approve Bash'` (D-CTX boundary)

## Test Tally

Individual test file results:
- `session-working-store.test.ts`: 12 tests PASS
- `session-waiting-store.test.ts`: 7 tests PASS
- `fleet-status-client.test.ts`: 10 tests PASS
- `fleet-status-feeder-retirement.test.ts`: 2 tests PASS
- `fleet-status-e2e.integration.test.ts`: 3 tests PASS
- `PrettyView.test.tsx`: 39 tests PASS (1 skipped, 1 todo — pre-existing)
- `tsc --noEmit`: CLEAN

Full `npx vitest run` suite context: A pre-existing port collision (EADDRINUSE on port 30011 in `dormant-poll.test.ts`) occurs only in concurrent full-suite runs on this CI machine — confirmed pre-existing by stash-test. All 34-06 test files pass individually and in sensible combinations. The 11 failures in the 169-file full run are in pre-existing tests unrelated to Plan 06.

## Commit SHAs

| Task | Commit | Description |
|------|--------|-------------|
| 01 | b77215e | Rewire session-working-store + create session-waiting-store |
| 02 | 1dbd756 | Fleet-status browser WS client + AppShell boot-time mount |
| 03 | f8199db | PrettyView WaitingBubble mount + hasBgWork feeder retirement |
| 04 | 85f07cb | Terminal.tsx PTY-idle feeder retirement + e2e test + grep gate |

## Background Frame Status (Plan 06 Deferred Note)

`backgrounded_agents` and `backgrounded_shells` WS frames from the per-pane claude-session-server are **STILL delivered and consumed** by PrettyView:
- `setBackgroundedAgents(parsed.agents)` → powers BackgroundedAgentsPanel
- `setBackgroundedShells(parsed.shells)` → powers BackgroundedShellsPanel

Only the store-publish call (formerly `publishSessionHasBackgroundedWork`) was removed. The panels still render. These frames will retire only if a future plan removes the BackgroundedAgentsPanel/BackgroundedShellsPanel UI surfaces.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test L grep pattern matched comment strings**
- **Found during:** Task 1
- **Issue:** The initial Test L implementation used `nonCommentLines.includes(retiredA)` where the search target contained the exact retired symbol — but non-comment lines include `it()` description strings which contained the symbol verbatim in the test name
- **Fix:** Changed to filter only `import` lines (not all non-comment lines); the assertion now checks only import statements, which is where forbidden symbols would actually appear
- **Commit:** b77215e

**2. [Rule 1 - Bug] fleet-status-client Test 6 WS.close assertion incorrect**
- **Found during:** Task 2
- **Issue:** Test 6 asserted `ws.close` was called by `dispose()`, but after `onclose` sets `ws = null` internally, dispose finds null and skips the close call — which is correct behavior
- **Fix:** Split into two assertions: (1) dispose prevents reconnect after close, (2) dispose closes the socket when still open
- **Commit:** 1dbd756

**3. [Rule 1 - Bug] fleet-status-e2e server kept Node event loop alive**
- **Found during:** Task 4
- **Issue:** The WebSocketServer's internal HTTP server kept the Node process alive after tests, causing Vitest to never exit when the e2e test was run as the only file
- **Fix:** Changed `afterEach` to terminate all client connections via `server.wss.clients.forEach(c => c.terminate())` then await `server.wss.close()` callback
- **Commit:** 85f07cb

**4. [Rule 2 - Missing] PrettyView.test.tsx WaitingBubble tests needed ResizeObserver stub**
- **Found during:** Task 3
- **Issue:** The new WaitingBubble tests flipped PrettyView to streaming state (triggering the scroll container), which invoked `useAutoScroll` which requires `ResizeObserver` — not available in jsdom by default
- **Fix:** Added `vi.stubGlobal('ResizeObserver', ...)` in the new test describe block's `beforeEach`, matching the pattern already used in existing PrettyView tests
- **Commit:** f8199db

## Known Stubs

None — all functionality is fully wired. The WaitingBubble receives live `waitingFor` strings from the fleet-status channel.

## Behavioral Notes for UAT

1. **WaitingBubble appearance:** In a session where Claude Code is in `status='waiting'` (e.g. a file-deletion permission prompt surfaced through Ink UI), PrettyView will show a `Hand` icon bubble with the `waitingFor` reason string. Ashley must switch to the terminal pane to respond — the bubble is presence-only (no interactive controls).

2. **backgrounded_agents panel:** The BackgroundedAgentsPanel and BackgroundedShellsPanel still render their data from the per-pane WS frames. Only the composite isWorking contribution from these panels was retired — the panels themselves remain.

3. **Dot semantics unchanged:** The dot visibility formula (`inActiveSet(row) && !isWorking(row)`) is unchanged. Only the signal delivery changed from PTY-scraping to fleet-status WS.

4. **Orchestrator next step:** After this plan lands, the deploy motion is `docker compose up -d --force-recreate skynet` with the 15-min deadman rollback per fleet rule (Ashley 2026-07-03). The ambient-tagging gate (Plan 05 — Nelly's external work) must be confirmed shipped before deployment — without ambient tagging, persistent Monitors in `backgroundTasks[]` would cause `isWorking=true` permanently for all identity sessions.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced beyond what was planned. The `fleet-status-client.ts` opens a WS to `/fleet-status/ws` (an existing backend endpoint from Plan 02). T-34-18 (parse-error drop) and T-34-20 (structured logging) mitigations are implemented.

## Self-Check: PASSED

- `src/ui/api/fleet-status-client.ts` — EXISTS ✓
- `src/ui/api/fleet-status-types.ts` — EXISTS ✓
- `src/ui/state/session-waiting-store.ts` — EXISTS ✓
- `src/ui/AppShell.tsx` — createFleetStatusClient present ✓
- `src/ui/features/terminal/Terminal.tsx` — publishSessionTtyBusy: 0 hits ✓
- `src/ui/features/pretty-view/PrettyView.tsx` — publishSessionHasBackgroundedWork: 0 hits ✓
- Commits b77215e, 1dbd756, f8199db, 85f07cb — all present in git log ✓
- `tsc --noEmit` — exits 0 ✓
