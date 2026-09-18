---
phase: 119-first-class-apps-campaign-shape-3-sidebar-apps-surface-new-c
plan: 01
subsystem: frontend-ws-types
tags:
  - frontend
  - websocket
  - types
  - tdd
dependency-graph:
  requires:
    - "Phase 118 backend app-registry channel (wire-protocol.ts:632-663 AppStateSchema + AppSnapshotFrame/AppUpdateFrame/AppGoneFrame — already deployed)"
  provides:
    - "AppState + FrontendAppSnapshotFrame + FrontendAppUpdateFrame + FrontendAppGoneFrame TS types in ui/api/fleet-status-types.ts"
    - "onAppSnapshot / onAppUpdate / onAppGone optional callbacks on FleetStatusClientOptions"
    - "Three new dispatch cases in fleet-status-client.ts onmessage switch that fire the callbacks with parsed AppState payloads"
  affects:
    - "Every downstream 117-* plan — 119-02 (app-tiles store slice) wires publishAppSnapshot / publishAppUpdate / publishAppGone to these callbacks; 119-03 (AppShell wiring) mounts the callbacks; 119-04/05/06 (component + backend icon route + tests) sit above the store"
tech-stack:
  added: []
  patterns:
    - "TDD RED/GREEN cycle (test-first, verified failing, then implementation)"
    - "Structured console.info logging with grep-discoverable operation keys (`fleet_status_client_app_*`)"
    - "Optional discriminated-union callback dispatch matching existing identity-archived pattern"
    - "Field-for-field hand-maintained frontend mirror of backend Zod schema (Pitfall 1 lockstep discipline)"
key-files:
  created: []
  modified:
    - src/ui/api/fleet-status-types.ts
    - src/ui/api/fleet-status-client.ts
    - src/ui/api/fleet-status-client.test.ts
decisions:
  - "Mirrored wire-protocol.ts:632-663 field-for-field — hostId + slug are STRINGS on the wire (not numbers) per backend AppStateSchema contract"
  - "Placed AppState immediately after the AppState-adjacent block comment and BEFORE SessionState (semantic locality: it's an application-registry type, not a session type) rather than 'immediately after SessionState' as PLAN.md §Task 1 suggested — same file, small structural nit, easier to read grouped with its own header comment; still ahead of every consuming type"
  - "Added realistic sample AppState payloads to the test file (including one unhealthy variant with a non-null healthMessage) rather than minimal stubs — future 119-02/03/04 test files can reuse the same shape as a template"
  - "Kept the `default:` branch untouched — regression-tested that unknown frame types still fall through silently (forward-compat for future frame kinds)"
metrics:
  duration_minutes: 12
  completed: "2026-09-18"
  tasks_completed: 2
  files_touched: 3
  commits: 2
---

# Phase 119 Plan 01: Extend frontend WS type mirror + client dispatch for app frames Summary

Closed the load-bearing Pitfall 1 gap from `117-RESEARCH.md`: Phase 118 shipped the backend `AppStateSchema` + three app-frame schemas at `src/backend/fleet-status/wire-protocol.ts:632-663`, but the frontend hand-maintained mirror at `src/ui/api/fleet-status-types.ts` never gained the corresponding arms, and the `fleet-status-client.ts` onmessage switch was silently dropping every app frame into its `default:` branch. This plan widens the mirror, adds three optional callbacks + three switch cases, and adds five scoped tests that would fail if the silent-drop regression ever reappeared.

## What Was Built

### Task 1: Type mirror widened (`src/ui/api/fleet-status-types.ts`)

- Added `AppState` interface — nine fields, field-for-field verbatim from `AppStateSchema` (wire-protocol.ts:632-644): `hostId: string`, `slug: string`, `title: string`, `description: string`, `port: number | null`, `hasIcon: boolean`, `createdAtMs: number`, `isHealthy: boolean`, `healthMessage: string | null`.
- Added three new frame interfaces after `FrontendIdentityArchivedFrame`:
  - `FrontendAppSnapshotFrame` — `{ schemaVersion, type: "app-snapshot", apps: AppState[] }`
  - `FrontendAppUpdateFrame` — `{ schemaVersion, type: "app-update", app: AppState }`
  - `FrontendAppGoneFrame` — `{ schemaVersion, type: "app-gone", hostId: string, slug: string }`
- Widened `FrontendOutboundFrame` union to include all three new arms in backend-declaration order.
- Zero touch to `SessionState`, `IdentityAppearance`, `FrontendSnapshotFrame`, `FrontendUpdateFrame`, `FrontendGoneFrame`, `FrontendPongFrame`, `FrontendIdentityArchivedFrame`, `FrontendInboundFrame`.

Task 1 commit: `dc242c89`.

### Task 2: Client dispatch + tests (`src/ui/api/fleet-status-client.ts` + `.test.ts`)

- Imported `AppState` alongside existing type imports from `./fleet-status-types.js`.
- Extended `FleetStatusClientOptions` with three optional callbacks:
  - `onAppSnapshot?: (apps: AppState[]) => void`
  - `onAppUpdate?: (app: AppState) => void`
  - `onAppGone?: (hostId: string, slug: string) => void`
  - Optional so this task lands standalone ahead of the store slice (119-02) and AppShell wiring (119-03).
- Destructured all three from `opts` alongside `url`, `onSnapshot`, `onUpdate`, `onGone`, `onIdentityArchived`.
- Added three new `case` blocks in the onmessage switch — placed after `case "identity-archived":` and before `default:`. Each follows the identity-archived pattern (structured `console.info` with a grep-discoverable `operation` key, then optional-chained callback invocation):
  - `case "app-snapshot":` → logs `fleet_status_client_app_snapshot` + `appCount`, invokes `onAppSnapshot?.(parsed.apps)`
  - `case "app-update":` → logs `fleet_status_client_app_update` + `hostId` + `slug` + `isHealthy`, invokes `onAppUpdate?.(parsed.app)`
  - `case "app-gone":` → logs `fleet_status_client_app_gone` + `hostId` + `slug`, invokes `onAppGone?.(parsed.hostId, parsed.slug)`
- Zero touch to existing snapshot / update / gone / identity-archived / pong cases; zero touch to the `default:` branch (forward-compat preserved).
- Added a fifth `describe("fleet-status-client: app-frame dispatch (Phase 119 Plan 119-01)")` block to `fleet-status-client.test.ts` with five tests:
  1. `app-snapshot` frame dispatched to `onAppSnapshot` with the full `apps: AppState[]` array + operation log emitted.
  2. `app-update` frame dispatched to `onAppUpdate` with the parsed `AppState` + operation log emitted (unhealthy sample used to prove `isHealthy: false` + `healthMessage` propagates).
  3. `app-gone` frame dispatched to `onAppGone` with `(hostId, slug)` positional arguments + operation log emitted.
  4. Constructing the client with all three callbacks omitted — delivering one of each frame arm does NOT throw (proves optionality; regression-guards against a future non-null assertion).
  5. Unknown frame type still hits the `default:` branch — no callback of any kind fires, no throw, connection stays open (proves widening the union did not break the forward-compat drop-silently behavior).

Task 2 commit: `6e43879f`.

## Verification

- **TDD RED gate** (Task 2): `npx vitest related --run src/ui/api/fleet-status-client.ts src/ui/api/fleet-status-client.test.ts src/ui/api/fleet-status-types.ts` — 3 dispatch tests failed as expected against the pre-implementation client (`/tmp/119-01-vitest-red.log`). The two no-throw / regression-guard tests already passed pre-implementation (they exercise the existing default-branch behavior, which is exactly what they assert is preserved).
- **TDD GREEN gate** (Task 2 post-implementation): same scoped run — **544 passed / 9 skipped / 1 todo / 0 failed** across 33 test files including all 5 new Phase 119 tests (`/tmp/119-01-vitest.log`).
- **Type-check** (both tasks): `npm run type-check` (root `tsc --noEmit`) exits 0 — no errors originating from `fleet-status-types.ts` or `fleet-status-client.ts`.

Note: the Task 1 `<automated>` verify grep of `grep -c "fleet-status-types.ts" /tmp/119-01-tsc.log == 0` matches because `tsc --noEmit` printed no output at all (clean run). Post-Task-2 rerun in `/tmp/119-01-tsc2.log` is likewise empty.

## Acceptance Criteria Traceability

### Task 1

| Criterion | Result |
|-----------|--------|
| `grep -c "export interface AppState" src/ui/api/fleet-status-types.ts` == 1 | 1 |
| `grep -c "FrontendAppSnapshotFrame" ...` >= 2 | 2 (declaration + union entry) |
| `grep -c "FrontendAppUpdateFrame" ...` >= 2 | 2 |
| `grep -c "FrontendAppGoneFrame" ...` >= 2 | 2 |
| `grep -E '^\s*hostId: string;' ... | wc -l` >= 2 | 5 (AppState + FrontendGoneFrame + FrontendIdentityArchivedFrame + FrontendAppGoneFrame + SessionState — every hostId-carrying interface on the file) |
| `grep -c "healthMessage: string | null" ...` == 1 | 1 |
| Zero `npm run type-check` errors from the file | 0 |

### Task 2

| Criterion | Result |
|-----------|--------|
| `grep -c "onAppSnapshot" src/ui/api/fleet-status-client.ts` >= 3 | 3 (interface field + destructure + switch invocation) |
| `grep -c "onAppUpdate" ...` >= 3 | 3 |
| `grep -c "onAppGone" ...` >= 3 | 3 |
| `grep -c 'case "app-snapshot":'` == 1 | 1 |
| `grep -c 'case "app-update":'` == 1 | 1 |
| `grep -c 'case "app-gone":'` == 1 | 1 |
| `grep -c "fleet_status_client_app_snapshot"` == 1 | 1 |
| `grep -c "fleet_status_client_app_update"` == 1 | 1 |
| `grep -c "fleet_status_client_app_gone"` == 1 | 1 |
| Scoped `npx vitest related --run ...` exit 0 with all Phase 119 tests passing | 544/544 pass, 0 fail |
| Optional-callback no-throw behavior | Verified (Test 4) |
| Per-frame callback fires exactly once with parsed payload | Verified (Tests 1-3) |

## Deviations from Plan

**One minor placement nit — not a functional change:**

**1. [Rule 3 - Placement] `AppState` interface placed BEFORE `SessionState` rather than "immediately after `SessionState`" as Task 1's `<action>` suggested.**
- **Found during:** Task 1
- **Why:** Grouped `AppState` with its own header comment block (`// AppState — mirror of backend AppStateSchema`) that mirrors the existing block-comment convention for `IdentityAppearance` and `SessionState` in the file. Placing it before `SessionState` puts it adjacent to its own doc-comment header rather than orphaning the comment mid-file. Zero downstream effect — TypeScript union types are order-independent for lookup; both grep counts and `tsc --noEmit` accept either placement.
- **Files modified:** src/ui/api/fleet-status-types.ts
- **Commit:** `dc242c89`

**Everything else executed exactly as written.** No auth gates. No architectural questions. No package installs. No bugs found. No missing critical functionality discovered. Zero backend files touched.

## Known Stubs

None. Both tasks implement real end-to-end behavior — Task 1 declares types that are exercised at runtime by Task 2's switch narrowing, and Task 2's callbacks are wired to real console-logged frame dispatch. The callbacks are OPTIONAL (not stubs) — they're the seam that 119-02 will attach the store slice to; the client itself does the full frame parse + operation log + narrowed callback invocation on every frame arrival regardless of whether the callback is present.

## Threat Model Coverage

| Threat ID | Category | Disposition | Where mitigated |
|-----------|----------|-------------|-----------------|
| T-119-01-01 | Tampering (frontend mirror drift) | mitigate | Task 1 field-for-field mirror vs wire-protocol.ts:632-663; Task 2 tests deliver real frame shapes and assert dispatch — future drift breaks the tests. |
| T-119-01-02 | DoS (malformed app frame → client crash) | mitigate | Existing `JSON.parse` try/catch in `ws.onmessage` (unchanged) already drops malformed frames. New cases only fire after `parsed.type` narrows to a valid arm. Test 5 asserts unknown types still fall through the default branch without crashing. |
| T-119-01-03 | Info Disclosure (unauthorized hostId reaches client) | accept | Backend `app-frame-filter.ts` (Phase 118 D-15) filters at the wire boundary. Client does NOT re-check (D-14 authority split). |
| T-119-01-SC | Tampering (supply-chain / package install) | accept | Zero package installs in this plan. |

## Threat Flags

None. This plan introduces no new network endpoints, no new auth paths, no new file access, and no new schema at any trust boundary — it consumes an existing WS connection with existing auth already handled at the fleet-status server.

## Downstream (What 119-02+ picks up)

The dispatch primitive is now in place. Plan 119-02 will land the `app-tiles-store.ts` module and export `publishAppSnapshot(apps)` / `publishAppUpdate(app)` / `publishAppGone(hostId, slug)`. Plan 119-03 will wire those publish fns into the `createFleetStatusClient({...})` call at `AppShell.tsx:626-667`:

```typescript
onAppSnapshot: (apps) => publishAppSnapshot(apps),
onAppUpdate:   (app)  => publishAppUpdate(app),
onAppGone:     (hostId, slug) => publishAppGone(hostId, slug),
```

No code change to `fleet-status-client.ts` should be needed to accommodate that wiring — the callback surface is stable.

## Commits

- `dc242c89` — feat(119-01): mirror app-frame arms into fleet-status-types.ts
- `6e43879f` — feat(119-01): dispatch app-frame arms in fleet-status-client

## Self-Check: PASSED

- src/ui/api/fleet-status-types.ts FOUND — modified with AppState + 3 frame arms + widened union
- src/ui/api/fleet-status-client.ts FOUND — modified with 3 optional callbacks + 3 switch cases
- src/ui/api/fleet-status-client.test.ts FOUND — extended with 5 new Phase 119 tests
- Commit `dc242c89` FOUND in `git log --oneline`
- Commit `6e43879f` FOUND in `git log --oneline`
- Scoped vitest: 544 passing (up from 539 pre-plan)
- `npm run type-check` exits 0
