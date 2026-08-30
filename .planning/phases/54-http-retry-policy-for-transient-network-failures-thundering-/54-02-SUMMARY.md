---
phase: 54-http-retry-policy-for-transient-network-failures-thundering-
plan: 02
subsystem: websocket-reconnect
tags: [jitter, thundering-herd, websocket, reconnect, fleet-status, pretty-view, terminal]
dependency_graph:
  requires: []
  provides: [R-54-07]
  affects:
    - src/ui/api/fleet-status-client.ts
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/terminal/Terminal.tsx
tech_stack:
  added: []
  patterns: [full-jitter, uniform-random-draw, Math.floor(Math.random()*capMs)]
key_files:
  modified:
    - src/ui/api/fleet-status-client.ts
    - src/ui/api/fleet-status-client.test.ts
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/terminal/Terminal.tsx
decisions:
  - "Full-jitter formula `Math.floor(Math.random() * capMs)` applied uniformly across all three WS reconnect sites"
  - "BACKOFF_SCHEDULE_MS [2000,4000,6000,8000,8000] values unchanged — now serve as caps"
  - "No test harness added for PrettyView or Terminal due to high mount cost; grep-verifiable assertions serve as acceptance"
metrics:
  duration: "~7 minutes"
  completed: "2026-08-23T02:31:27Z"
  tasks_completed: 2
  files_modified: 4
---

# Phase 54 Plan 02: WS Reconnect Jitter Injection (fleet-status + PrettyView + Terminal) Summary

**One-liner:** Full-jitter (`Math.floor(Math.random() * capMs)`) injected into all three WS reconnect schedulers so 10-tab Chrome-restore no longer re-clumps into a synchronized retry herd on the backoff ladder.

## What Changed

### Task 1: fleet-status-client.ts + test extension

**File:** `src/ui/api/fleet-status-client.ts` (line 198-201)

BEFORE:
```ts
const delayMs = BACKOFF_SCHEDULE_MS[
  Math.min(reconnectAttempts, BACKOFF_SCHEDULE_MS.length - 1)
];
```

AFTER:
```ts
// R-54-07: full-jitter — uniform random draw in [0, capMs) prevents 10-tab restore from re-clumping the herd on the reconnect ladder.
const capMs = BACKOFF_SCHEDULE_MS[
  Math.min(reconnectAttempts, BACKOFF_SCHEDULE_MS.length - 1)
];
const delayMs = Math.floor(Math.random() * capMs);
```

**File:** `src/ui/api/fleet-status-client.test.ts` — added Test 9 describe block with 4 `it()` cases:
1. Deterministic mid-point: `Math.random() = 0.5` → `delay = 1000` (not 2000)
2. 100-sample uniform distribution: all samples in `[0, 2000)`, mean in `[800, 1200]`
3. Attempt-2 range: jittered delay in `[0, 4000)`
4. Cap regression: after 5 closes logs `fleet_status_client_gave_up`, no further `setTimeout`

**Commit:** `8eb546db`

### Task 2: PrettyView.tsx + Terminal.tsx

**File:** `src/ui/features/pretty-view/PrettyView.tsx` (around line 2080)

BEFORE:
```ts
const delay = Math.min(2000 * (reconnectAttemptsRef.current + 1), 8000);
```

AFTER:
```ts
// R-54-07: full-jitter — random draw in [0, capMs) prevents the 10-tab Chrome-restore herd from re-clumping on the reconnect ladder. Cap and initial-delay scale unchanged (patch #148 linear-with-cap contract preserved).
const capMs = Math.min(2000 * (reconnectAttemptsRef.current + 1), 8000);
const delay = Math.floor(Math.random() * capMs);
```

**File:** `src/ui/features/terminal/Terminal.tsx` (lines 1164-1167)

BEFORE:
```ts
const delay = Math.min(
  2000 * Math.pow(2, reconnectAttempts.current - 1),
  8000,
);
```

AFTER:
```ts
// R-54-07: full-jitter — random draw in [0, capMs) prevents the 10-tab Chrome-restore herd from re-clumping on the reconnect ladder. Cap (8s) and exponential base (2s * 2^(attempt-1)) unchanged.
const capMs = Math.min(
  2000 * Math.pow(2, reconnectAttempts.current - 1),
  8000,
);
const delay = Math.floor(Math.random() * capMs);
```

**Commit:** `6e3c0f7f`

## Test Results

### Fleet-status-client (scoped — `npx vitest run src/ui/api/fleet-status-client.test.ts`)

```
Tests  14 passed (14)
```
- Tests 1-8 (pre-existing): all pass
- Test 9 (new jitter assertions): all 4 `it()` cases pass
- RED confirmed before GREEN: 3 tests were failing against the fixed-delay source

### PrettyView + Terminal regression (scoped)

```
npx vitest run src/ui/features/pretty-view/PrettyView.test.tsx \
  src/ui/features/pretty-view/PrettyView.phase29.test.tsx \
  src/ui/features/terminal/Terminal.instrumentation.test.tsx

Tests  77 passed | 1 skipped | 1 todo (79)
```
No regressions.

## TypeScript Clean

```
npx tsc --noEmit -p tsconfig.json | grep "fleet-status-client" → 0
npx tsc --noEmit -p tsconfig.json | grep -E "PrettyView\.tsx|Terminal\.tsx" → 0
```

## Grep Assertions Passing

All three sites carry both `R-54-07` and `Math.floor(Math.random()`:

```
=== src/ui/api/fleet-status-client.ts ===
R-54-07:                    1
Math.floor(Math.random():   1
=== src/ui/features/pretty-view/PrettyView.tsx ===
R-54-07:                    1
Math.floor(Math.random():   1
=== src/ui/features/terminal/Terminal.tsx ===
R-54-07:                    1
Math.floor(Math.random():   1
```

Additional source-invariant assertions:
- `BACKOFF_SCHEDULE_MS = [2000, 4000, 6000, 8000, 8000]` → 1 (values unchanged, serve as caps)
- `MAX_RECONNECT_ATTEMPTS = 5` → 1 (fleet-status cap unchanged)
- `MAX_RECONNECT_ATTEMPTS` references in PrettyView.tsx → 7 (still used — cap logic intact)
- `maxReconnectAttempts = 8` in Terminal.tsx → 1 (cap unchanged)
- `2000 * (reconnectAttemptsRef.current + 1)` in PrettyView.tsx → 1 (base formula preserved)
- `2000 * Math.pow(2, reconnectAttempts.current - 1)` in Terminal.tsx → 1 (base formula preserved)
- Import count: PrettyView.tsx = 38 (unchanged), Terminal.tsx = 40 (unchanged) — no new imports

## Audit Finding (R-54-07)

Confirmed at kickoff via grep that all three WS clients used fixed-ladder backoff with NO jitter:
- `fleet-status-client.ts:198-200`: `delayMs = BACKOFF_SCHEDULE_MS[i]` — fixed value
- `PrettyView.tsx:2080`: `delay = Math.min(2000 * (attempts + 1), 8000)` — fixed value
- `Terminal.tsx:1164-1167`: `delay = Math.min(2000 * Math.pow(2, attempts - 1), 8000)` — fixed value

All three now use full-jitter. Verdict: "Fixed ladder — add jitter" (not "already jittered").

## Deviations from Plan

None — plan executed exactly as written. All minimum-touch constraints honored:
- Attempt caps unchanged (fleet-status: 5, PrettyView: MAX_RECONNECT_ATTEMPTS, Terminal: 8)
- Termination conditions unchanged
- Visibility-change handlers untouched
- INACTIVE short-circuit in PrettyView untouched
- shouldNotReconnectRef / wasDisconnectedBySSH guards in Terminal untouched
- No new imports in any file

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced. Edits are purely in WS reconnect scheduling math.

## Self-Check

### Files exist:
- /home/ubuntu/skynet-tanya/src/ui/api/fleet-status-client.ts: FOUND
- /home/ubuntu/skynet-tanya/src/ui/api/fleet-status-client.test.ts: FOUND
- /home/ubuntu/skynet-tanya/src/ui/features/pretty-view/PrettyView.tsx: FOUND
- /home/ubuntu/skynet-tanya/src/ui/features/terminal/Terminal.tsx: FOUND

### Commits exist:
- 8eb546db: FOUND
- 6e3c0f7f: FOUND

## Self-Check: PASSED
