---
phase: 118-first-class-apps-sweep-registry-shape-2
plan: 03
subsystem: fleet-status-wire + fleet-status-registry
tags: [typescript, zod, wire-protocol, subscription-registry, apps, source-c, tdd]
requires:
  - src/backend/fleet-status/wire-protocol.ts (existing outbound-frame discriminated union)
  - src/backend/fleet-status/subscription-registry.ts (existing session + archived-identity fan-out)
  - .planning/phases/118-first-class-apps-sweep-registry-shape-2/118-02-SUMMARY.md (SweepAppLine schema is the source of D-05 field names, snake→camel for the wire)
provides:
  - "AppStateSchema (Zod) mirroring the seven D-05 fields in camelCase (hostId, slug, title, description, port nullable, hasIcon bool, createdAtMs, isHealthy, healthMessage nullable) + `export type AppState = z.infer<...>`"
  - "Three new discriminated-union frame kinds: AppSnapshotFrameSchema (type: 'app-snapshot', apps: AppState[]), AppUpdateFrameSchema (type: 'app-update', app), AppGoneFrameSchema (type: 'app-gone', hostId, slug)"
  - "Three factories: makeAppSnapshotFrame, makeAppUpdateFrame, makeAppGoneFrame — all auto-stamp FRAME_SCHEMA_VERSION"
  - "Sibling `apps: Map<string, AppState>` on the registry (in-memory only per D-10)"
  - "makeAppKey(hostId, slug) helper — distinct from makeKey (T-118-03-KC key-collision defense)"
  - "SubscriptionRegistry.publishAppUpdate (no idempotence guard — D-13 health-flip discipline), publishAppGoneByHostSlug (no-op-if-missing), getAppSnapshot"
  - "subscribe() path now emits one app-snapshot frame unconditionally after the session + archived snapshots (D-16)"
affects:
  - "src/backend/fleet-status/wire-protocol.ts (645 → 782 lines; +137)"
  - "src/backend/fleet-status/wire-protocol.test.ts (792 → 927 lines; +135; 8 new tests)"
  - "src/backend/fleet-status/subscription-registry.ts (377 → 483 lines; +106)"
  - "src/backend/fleet-status/subscription-registry.test.ts (483 → 647 lines; +164; 7 new tests + 1 rippled)"
  - "downstream 118-04: ssh-poll-orchestrator can now call deps.registry.publishAppUpdate(host.id, appState) + publishAppGoneByHostSlug(host.id, slug) and see fan-out end-to-end"
  - "downstream 118-05: greenfield per-user host-visibility filter has a well-defined attach point (both the subscribe-path snapshot emit AND the fanOut calls inside publishApp*)"
tech-stack:
  added: []  # zero new dependencies; zod already imported at top of wire-protocol.ts
  patterns:
    - "additive extension discipline — FRAME_SCHEMA_VERSION NOT bumped (9th iteration of the T-41-03-05 mitigation lineage)"
    - "sibling map + snapshot-on-subscribe (matches the archivedIdentities pattern Phase 115 landed)"
    - "kebab-case type literals (matches identity-archived from Phase 115)"
    - "TDD RED → GREEN with per-task test/feat commits (four commits total)"
    - "makeAppKey helper distinct from makeKey — belt-and-suspenders slug-vs-tmuxSession discipline"
key-files:
  created: []
  modified:
    - src/backend/fleet-status/wire-protocol.ts
    - src/backend/fleet-status/wire-protocol.test.ts
    - src/backend/fleet-status/subscription-registry.ts
    - src/backend/fleet-status/subscription-registry.test.ts
decisions:
  - "extended the FRAME_SCHEMA_VERSION-hold docblock at the head of AppStateSchema with the 9th-iteration lineage entry (Phase 118) so the invariant history remains machine-greppable"
  - "distinct makeAppKey helper over inline `${hostId}:${slug}` template literal — RESEARCH § Q9 flagged the tmuxSession-vs-slug collision risk and the named helper carries the discipline even though the two maps are structurally distinct"
  - "no publishAppSnapshot public method (RESEARCH § Q3) — snapshot delivery is subscribe-driven only; the compose+publish loop 118-04 will add publishes via publishAppUpdate on every tick and that populates the map"
  - "kebab-case frame type literals (app-snapshot / app-update / app-gone) — matches identity-archived precedent from Phase 115 (RESEARCH § Q3 naming delta)"
  - "kept the app-snapshot subscribe-emit UNCONDITIONAL (emits with apps: [] when the map is empty) rather than short-circuit — makes the empty-state contract explicit and matches D-16's snapshot-on-subscribe requirement"
metrics:
  duration_min: ~15
  completed: 2026-09-18
  tasks_completed: 2
  files_touched: 4
  line_count_delta: +137 wire-protocol.ts; +135 wire-protocol.test.ts; +106 subscription-registry.ts; +164 subscription-registry.test.ts
  test_count_delta: +15 (subscription-registry 27 → 34; wire-protocol 303 → 311)
---

# Phase 118 Plan 118-03: wire-protocol app frames + subscription-registry apps map Summary

Delivered the WS-broadcast surface for source-C apps: three new outbound frame kinds (`app-snapshot`, `app-update`, `app-gone`) in `wire-protocol.ts` plus a sibling `apps: Map<string, AppState>` on the subscription registry with three publish/getter methods and a subscribe-path snapshot emit. Additive only — every existing session and archived-identity code path is byte-for-byte untouched. Ships the fan-out surface Plan 118-04's orchestrator adapter will call `publishAppUpdate` / `publishAppGoneByHostSlug` against. TDD executed as two proper RED → GREEN cycles (four commits total).

## What Landed

### Task 1 RED — wire-protocol.test.ts (commit `a9d6c276`)

Extended `src/backend/fleet-status/wire-protocol.test.ts` with a new `describe("Phase 118 app frame schemas", ...)` block carrying the nine `<behavior>` tests:

- Tests 1-4: `AppStateSchema` shape (happy path, missing hostId rejection, nullable port, unhealthy branch with healthMessage).
- Tests 5-7: three factory functions (`makeAppSnapshotFrame`, `makeAppUpdateFrame`, `makeAppGoneFrame`) — each round-trips through `FrontendOutboundFrame.safeParse` to prove both the factory output and the union widening.
- Tests 8-9: `FrontendOutboundFrame` discriminated-union regression guards — empty-apps snapshot accepted (proves the union was widened correctly); unknown `type` value rejected (regression guard on the discriminator).

At the RED gate: 8 tests failed with `TypeError: makeAppXxxFrame is not a function` (as expected — schemas and factories don't exist yet).

### Task 1 GREEN — wire-protocol.ts (commit `184afc66`)

Extended `src/backend/fleet-status/wire-protocol.ts` — pure additive:

- **New `AppStateSchema`** exported at the module level, following the SessionStateSchema convention (frontend-facing camelCase against the sweep wire's snake_case). Ten fields total: `hostId`, `slug`, `title`, `description`, `port: z.number().nullable()`, `hasIcon: z.boolean()`, `createdAtMs: z.number()`, `isHealthy: z.boolean()`, `healthMessage: z.string().nullable()`. Rich JSDoc citing D-01/D-02/D-03/D-05/D-06/D-07/D-08 + the 9th-iteration FRAME_SCHEMA_VERSION-hold lineage.
- **Three new frame schemas** inserted immediately after `FrontendIdentityArchivedFrameSchema` (kebab-case `type` literals mirror `"identity-archived"`):
  - `AppSnapshotFrameSchema` — `type: "app-snapshot"`, `apps: z.array(AppStateSchema)`.
  - `AppUpdateFrameSchema` — `type: "app-update"`, `app: AppStateSchema`.
  - `AppGoneFrameSchema` — `type: "app-gone"`, `hostId: z.string()`, `slug: z.string()`.
- **`FrontendOutboundFrame` discriminated union widened** — appended the three new schemas after `FrontendIdentityArchivedFrameSchema`. Final order (verbatim):
  ```
  [FrontendSnapshotFrameSchema,
   FrontendUpdateFrameSchema,
   FrontendGoneFrameSchema,
   FrontendPongFrameSchema,
   FrontendIdentityArchivedFrameSchema,
   AppSnapshotFrameSchema,
   AppUpdateFrameSchema,
   AppGoneFrameSchema]
  ```
- **Three factories** appended after `makeIdentityArchivedFrame`, each auto-stamping `FRAME_SCHEMA_VERSION`:
  - `makeAppSnapshotFrame(apps: AppState[])`
  - `makeAppUpdateFrame(app: AppState)`
  - `makeAppGoneFrame(hostId: string, slug: string)`
- **`FRAME_SCHEMA_VERSION` unchanged** — verified by `git diff | grep -E '^[+-].*FRAME_SCHEMA_VERSION\s*='` returning zero lines. Additive-optional discipline per RESEARCH § Pitfall 6, 9th iteration of the T-41-03-05 mitigation.

Line count: 645 → 782 (+137). Test count: 303 → 311 (+8). All 311 tests GREEN.

### Task 2 RED — subscription-registry.test.ts (commit `8a6b7afa`)

Extended `src/backend/fleet-status/subscription-registry.test.ts` with a new `describe("Phase 118 apps map + publish surface", ...)` block carrying the seven `<behavior>` tests + a local `makeAppState(hostId, slug, overrides?)` fixture helper.

- Test 1: `publishAppUpdate` insert-into-map + one `app-update` fan-out.
- Test 2: NOT idempotent — repeated identical publishes fan out every time (D-13 health-flip discipline).
- Test 3: `publishAppGoneByHostSlug` for known key → delete + one `app-gone` fan-out.
- Test 4: `publishAppGoneByHostSlug` for unknown key → no-op (no fan-out, no change).
- Test 5: late subscriber gets one `app-snapshot` frame with every previously-published app (order-insensitive check).
- Test 6: subscribe with zero apps still emits an `app-snapshot` with `apps: []`.
- Test 7: shared `fanOut` try/catch discipline — one throwing subscriber does NOT starve others.

At the RED gate: 7 tests failed with `TypeError: registry.publishAppUpdate is not a function`.

### Task 2 GREEN — subscription-registry.ts + test ripple (commit `e7455fac`)

Extended `src/backend/fleet-status/subscription-registry.ts`:

- **Imports widened** — added `AppState` type import + `makeAppGoneFrame`, `makeAppSnapshotFrame`, `makeAppUpdateFrame` from `./wire-protocol.js`.
- **Interface extended** with three new methods (docblocks citing D-09/D-11/D-13/D-14):
  - `publishAppUpdate(hostId: string, app: AppState): void`
  - `publishAppGoneByHostSlug(hostId: string, slug: string): void`
  - `getAppSnapshot(): AppState[]`
- **`makeAppKey(hostId, slug)` helper** added at module scope, distinct from `makeKey` (T-118-03-KC — the two maps are structurally distinct so byte collision is impossible, but the named helper carries the slug-vs-tmuxSession discipline for future readers).
- **Sibling `const apps = new Map<string, AppState>()`** inside `createSubscriptionRegistry`, right after `archivedIdentities`. Docblock cites D-09 (sibling map) + D-10 (in-memory only, no persistence, restart wipes it).
- **`subscribe()` path extended** — after the existing session snapshot + archived-identity re-emit loop, added ONE `try/catch` block that calls `sendFrame(makeAppSnapshotFrame(Array.from(apps.values())))`. Catch logs via `systemLogger.warn` with operation key `fleet_status_app_snapshot_failed`, mirroring the shape of the existing archived-snapshot warn. Emit is UNCONDITIONAL — empty apps map still produces an `app-snapshot` with `apps: []` (D-16 compliance).
- **`publishAppUpdate`** — inserts at `makeAppKey(hostId, app.slug)` and calls `fanOut(subscribers, makeAppUpdateFrame(app))`. NO byte-equality guard (D-13).
- **`publishAppGoneByHostSlug`** — no-op-if-missing guard, then `apps.delete(key)` + `fanOut(subscribers, makeAppGoneFrame(hostId, slug))`. Mirrors `publishIdentityGoneByName`'s shape.
- **`getAppSnapshot`** — small getter returning `Array.from(apps.values())`. Symmetric with the existing `getSnapshot()`.
- **NO `publishAppSnapshot` public method** (per RESEARCH § Q3) — snapshot delivery is subscribe-driven only.
- **Zero DB references introduced** — grep confirms zero `DatabaseSaveTrigger|databaseSaveTrigger|drizzle|sqlite` in the touched file (D-10 in-memory-only regression guard).

Test ripple (same commit): pre-existing `Test 3: Late subscriber receives snapshot frame containing all previously published states` counted total frames received on subscribe (`expect(receivedFrames).toHaveLength(1)`). With the new app-snapshot emit, the count becomes 2. Fixed by switching to a type-filter (`receivedFrames.filter((f) => f.type === "snapshot")`) — no behavioral change to the session path, only test-shape coherence. Rule 3 auto-fix (additive-extension ripple, same class as Plan 118-02's `appLines: []` fix).

Line count: 377 → 483 (+106). Test count: 27 → 34 (+7). All 318 tests in the two touched test files GREEN. All 488 tests across the full fleet-status directory GREEN (no downstream regressions).

## Verification Transcript

### Automated

- `npx vitest related --run src/backend/fleet-status/wire-protocol.ts src/backend/fleet-status/wire-protocol.test.ts` → **311/311 PASS (8 files).**
- `npx vitest related --run src/backend/fleet-status/subscription-registry.ts src/backend/fleet-status/subscription-registry.test.ts src/backend/fleet-status/wire-protocol.ts` → **318/318 PASS (8 files).**
- `npx vitest run src/backend/fleet-status/` (whole-directory regression sweep) → **488/488 PASS (18 files).**
- `npm run build:backend 2>&1 | grep -E "wire-protocol|subscription-registry"` → **zero output** (no new type errors in the four touched files). Pre-existing errors in `src/backend/distributor/catalog.ts` (missing `sourceKind` on ~15 catalog rows) confirmed to exist on the pre-change tree — same set 118-02 flagged as out-of-scope per SCOPE BOUNDARY.

### Acceptance-criteria grep verification

**Task 1 (wire-protocol.ts):**

| Criterion | Actual |
|-----------|--------|
| `grep -c "^export const AppStateSchema" wire-protocol.ts` == 1 | **1** ✓ |
| `grep -c "^export type AppState " wire-protocol.ts` == 1 | **1** ✓ |
| `grep -Ec '(AppSnapshotFrameSchema\|AppUpdateFrameSchema\|AppGoneFrameSchema)' wire-protocol.ts` >= 6 | **6** ✓ |
| `grep -c "^export function makeAppSnapshotFrame" wire-protocol.ts` == 1 | **1** ✓ |
| `grep -c "^export function makeAppUpdateFrame" wire-protocol.ts` == 1 | **1** ✓ |
| `grep -c "^export function makeAppGoneFrame" wire-protocol.ts` == 1 | **1** ✓ |
| Three `z.literal("app-*")` discriminators | **3** ✓ |
| `git diff | grep -E '^[+-].*FRAME_SCHEMA_VERSION\s*='` empty | **0 lines** ✓ (constant unchanged) |

**Task 2 (subscription-registry.ts):**

| Criterion | Actual |
|-----------|--------|
| `grep -c "publishAppUpdate" subscription-registry.ts` >= 2 | **3** ✓ (interface + implementation + docblock ref) |
| `grep -c "publishAppGoneByHostSlug" subscription-registry.ts` >= 2 | **3** ✓ |
| `grep -c "getAppSnapshot" subscription-registry.ts` >= 2 | **2** ✓ |
| `grep -c "const apps = new Map" subscription-registry.ts` == 1 | **1** ✓ |
| `grep -Ec "function makeAppKey\|const makeAppKey" subscription-registry.ts` == 1 | **1** ✓ |
| `grep -c "makeAppSnapshotFrame(Array.from(apps.values()))" subscription-registry.ts` == 1 | **1** ✓ |
| `grep -Ec "DatabaseSaveTrigger\|databaseSaveTrigger\|drizzle\|sqlite" subscription-registry.ts` == 0 | **0** ✓ (D-10 in-memory-only regression guard) |
| `grep -c "publishAppSnapshot" subscription-registry.ts` == 0 | **0** ✓ (RESEARCH § Q3 — no public snapshot publisher) |

### Frame ordering in the discriminated union (per the plan's `<output>` request)

The exact order of the three new members appended to `FrontendOutboundFrame` (positions 6-8 of the union array):

```
1. FrontendSnapshotFrameSchema
2. FrontendUpdateFrameSchema
3. FrontendGoneFrameSchema
4. FrontendPongFrameSchema
5. FrontendIdentityArchivedFrameSchema
6. AppSnapshotFrameSchema     ← NEW (Phase 118)
7. AppUpdateFrameSchema       ← NEW (Phase 118)
8. AppGoneFrameSchema         ← NEW (Phase 118)
```

### `makeAppKey` key format (per the plan's `<output>` request)

```typescript
function makeAppKey(hostId: string, slug: string): string {
  return `${hostId}:${slug}`;
}
```

Single-colon separator; matches the makeKey precedent. Kept as a distinct helper from `makeKey` (T-118-03-KC belt-and-suspenders) even though the two maps are structurally isolated.

## Executor Discretion Choices

1. **Distinct `makeAppKey` helper over inline template literal.** RESEARCH § Q9 flagged the slug-vs-tmuxSession collision risk. The two maps (`state` and `apps`) are structurally distinct — a slug and a tmuxSession that byte-collide live in different Maps — so an inline `` `${hostId}:${slug}` `` would work. Named helper chosen to carry the discipline for future readers and to make it structurally impossible for a refactor to reuse the session key shape for apps.
2. **Unconditional `app-snapshot` emit at subscribe time.** D-16 says "snapshot on subscribe is required." The alternative would be to skip the emit when the apps map is empty — but that would leave the empty state ambiguous (has the app-snapshot arrived yet? Is the pipe healthy?). Emitting `app-snapshot` with `apps: []` makes the empty-state contract explicit and matches the shape of the session-snapshot (which also always fires on subscribe, even when the state map is empty).
3. **No `publishAppSnapshot` public method.** RESEARCH § Q3 was explicit that identity codebase has no sibling. Snapshot delivery lives inside `subscribe()` reading `apps.values()`; the compose+publish loop 118-04 will add will populate the map via `publishAppUpdate` on every tick.
4. **Rule 3 auto-fix on pre-existing Test 3** — changed `.toHaveLength(1)` on `receivedFrames` to `.filter((f) => f.type === "snapshot").toHaveLength(1)`. Reason: subscribe now emits an app-snapshot alongside the session snapshot, so a positional-count assertion breaks. Same class of additive-extension ripple as Plan 118-02's `appLines: []` fix on `parseSweepJsonl` empty-input tests. No behavioral change to the session path.
5. **Frame `type` naming = kebab-case.** `"app-snapshot"` / `"app-update"` / `"app-gone"` match the `"identity-archived"` precedent from Phase 115 (RESEARCH § Q3 naming delta). Consistent with existing verbs.

## Deviations from Plan

### Rule 3 auto-fixes applied

**[Rule 3 - Blocking additive-extension ripple] Updated pre-existing Test 3 to filter frames by type.**
- **Found during:** Task 2 GREEN phase (after adding the subscribe-path app-snapshot emit).
- **Issue:** `Test 3: Late subscriber receives snapshot frame containing all previously published states` counted `receivedFrames.length` and asserted exactly 1. The new app-snapshot emit made the count 2.
- **Fix:** Changed to `receivedFrames.filter((f) => f.type === "snapshot").toHaveLength(1)` + used the filtered slice for the subsequent assertions. Same behavioral coverage on the session-snapshot path.
- **Files modified:** src/backend/fleet-status/subscription-registry.test.ts (1 test block).
- **Commit:** `e7455fac` (same commit as the Task 2 GREEN implementation).
- **Scope:** legitimate additive-extension consequence — subscribe() now emits N snapshot-kind frames unconditionally (session + archived + apps), so positional assertions must switch to type-filtered assertions. This is not a behavioral change, just test-shape coherence — same class of ripple as Plan 118-02's `appLines: []` fix.

### Process deviations to flag

**None.** No `git stash`, no destructive git operations, no full-suite runs from the executor (scoped tests only per fleet directive 2026-09-07). No `--no-verify` flags, no `git add -A` or `git add .` (files staged individually per fleet rule).

## Authentication Gates

None. This plan is pure code — no external services, no credentials, no login flows.

## RESEARCH.md Line-Number Drift

RESEARCH.md and PATTERNS.md cited pre-118-03 line numbers in `wire-protocol.ts` and `subscription-registry.ts`. After the additions:

| File | Symbol | Cited (RESEARCH/PATTERNS) | Actual (post-118-03) |
|---|---|---|---|
| wire-protocol.ts | `FrontendIdentityArchivedFrameSchema` | L577-583 | L577-583 (unchanged — my additions came AFTER) |
| wire-protocol.ts | `FrontendOutboundFrame` discriminated union | L585-591 | L659-668 (widened + moved by AppStateSchema + 3 new frame schemas above it) |
| wire-protocol.ts | `makeIdentityArchivedFrame` | L632-644 | L706-718 (moved by AppStateSchema + 3 new frame schemas above it) |
| subscription-registry.ts | `makeKey` | L136-138 | L136-138 (unchanged) |
| subscription-registry.ts | `fanOut` helper | L140-154 | L152-166 (moved by makeAppKey helper) |
| subscription-registry.ts | `archivedIdentities` map | L175-178 | L187-190 |
| subscription-registry.ts | `subscribe()` archived re-emit | L216-230 | L228-242 (immediately followed by new app-snapshot emit at L244-260) |
| subscription-registry.ts | `publishIdentityArchived` | L292-312 | L316-336 |
| subscription-registry.ts | `publishIdentityGoneByName` | L333-347 | L357-372 (immediately followed by new publishAppUpdate + publishAppGoneByHostSlug + getAppSnapshot at L374-405) |

Drift is exactly +12 in wire-protocol.ts (from the ~62-line AppStateSchema block + docblock added before `FrontendOutboundFrame`, offset by minor formatting differences) and +12/+24 in subscription-registry.ts (from the makeAppKey helper block + apps map declaration + subscribe-path app-snapshot emit stacked upstream of each subsequent symbol). Additive-only, no behavioral impact.

## Downstream Consumer Check

- `grep -rn "createSubscriptionRegistry\|SubscriptionRegistry" src/backend --include="*.ts" | grep -v ".test.ts" | grep -v subscription-registry.ts` returns three consumers:
  - `src/backend/fleet-status/fleet-status-server.ts` — imports the type. Unchanged behavior (subscribe() signature unchanged; new methods added additively).
  - `src/backend/fleet-status/ssh-poll-orchestrator.ts` — imports the type. Unchanged behavior for THIS plan (Plan 118-04 will be the first caller of `publishAppUpdate` / `publishAppGoneByHostSlug`).
  - `src/backend/starter.ts` — calls `createSubscriptionRegistry()`. No API change; the factory still returns a `SubscriptionRegistry` object.
- Full fleet-status regression sweep: `npx vitest run src/backend/fleet-status/` → **488/488 PASS across 18 files**. No downstream regressions.
- Backend typecheck for the four touched files: zero new errors.

## Regression Check

- `npx vitest related --run src/backend/fleet-status/wire-protocol.ts src/backend/fleet-status/wire-protocol.test.ts src/backend/fleet-status/subscription-registry.ts src/backend/fleet-status/subscription-registry.test.ts` — 318/318 PASS.
- Broader sweep `npx vitest run src/backend/fleet-status/` — 488/488 PASS (18 files).
- `git diff HEAD~4 HEAD src/backend/fleet-status/wire-protocol.ts | grep -E "^-" | grep -v "^---"` — every `-` line is a whitespace or block-formatting artifact from adding the new frame schemas above `FrontendOutboundFrame`; zero behavioral removals from any existing frame schema.
- `git diff HEAD~4 HEAD src/backend/fleet-status/subscription-registry.ts | grep -E "^-" | grep -v "^---"` — every `-` line is import-block reordering + the two Rule-3 fixes; zero behavioral removals from any existing publish or subscribe path.
- `FRAME_SCHEMA_VERSION` constant unchanged.

## Threat Flags

None found. Every file created or modified in this plan is already covered by the plan's `<threat_model>`. No new network endpoints, no new auth paths, no new file-access patterns, no schema changes at trust boundaries. The T-118-03-IL info-disclosure gap (unfiltered fan-out) is a KNOWN acceptance in this plan's threat model — see the "Deploy Ordering" section below.

## Deploy Ordering (T-118-03-IL — LOAD-BEARING)

**Plan 118-05 MUST land in the same deploy as 118-03 + 118-04.**

This plan deliberately ships UNFILTERED fan-out. Every subscriber to `/fleet-status/ws` will see every app frame across every box in the intermediate state. The T-118-03-IL threat entry documents this as an accepted gap — it matches the CURRENT identity-frame situation (identity frames are also unfiltered today per RESEARCH § Q4 — grep-verified zero callers of `checkHostAccess` under `src/backend/fleet-status/`). Plan 118-05 lands the first `checkHostAccess` invocation under fleet-status for the app frames and, per D-15, sets the pattern for identity frames to adopt later.

This is a plan-set integrity requirement — do NOT ship 118-03 alone. Roadmap/orchestrator must gate the deploy on 118-05 being in the tree.

## Follow-Ups Handed Off (Out of Scope for This Plan)

- **118-04 (ssh-poll-orchestrator adapter + reconciliation):** hook `parsed.appLines` into a per-host `publishAppUpdate` compose loop + a `lastTickLiveApps: Set<string>` reconciliation block mirroring Phase 115's identity template (67b4a7ef). This plan's registry methods are the target.
- **118-05 (per-user host-visibility filter):** GREENFIELD — the first `checkHostAccess` invocation under `src/backend/fleet-status/` (RESEARCH § Q4 zero-callers finding). Must layer on BOTH the subscribe-path app-snapshot emit AND the `publishApp*` fanOut calls (RESEARCH § Pitfall 2). LOAD-BEARING for deploy safety (T-118-03-IL).

## TDD Gate Compliance

- **Task 1 RED gate:** commit `a9d6c276` — `test(118-03): add failing tests for app frame schemas + factories`. Verified 8 tests failing at commit time.
- **Task 1 GREEN gate:** commit `184afc66` — `feat(118-03): add AppState + three app frame schemas + factories`. Verified 311/311 tests passing at commit time.
- **Task 2 RED gate:** commit `8a6b7afa` — `test(118-03): add failing tests for apps map + publish surface`. Verified 7 tests failing at commit time.
- **Task 2 GREEN gate:** commit `e7455fac` — `feat(118-03): add apps map + publish surface + subscribe-path snapshot`. Verified 318/318 tests passing at commit time.
- **REFACTOR gate:** not needed for either task — the schema surfaces and registry extensions landed clean; no cleanup pass required.

All four gate commits distinct + in order per the plan's per-task `tdd="true"` requirement.

## Self-Check: PASSED

- `src/backend/fleet-status/wire-protocol.ts` — FOUND (782 lines, +137 from 645).
- `src/backend/fleet-status/wire-protocol.test.ts` — FOUND (927 lines, +135 from 792; 311 tests, +8 from 303).
- `src/backend/fleet-status/subscription-registry.ts` — FOUND (483 lines, +106 from 377).
- `src/backend/fleet-status/subscription-registry.test.ts` — FOUND (647 lines, +164 from 483; 34 tests, +7 from 27).
- Commit `a9d6c276` — FOUND (`test(118-03): add failing tests for app frame schemas + factories`).
- Commit `184afc66` — FOUND (`feat(118-03): add AppState + three app frame schemas + factories`).
- Commit `8a6b7afa` — FOUND (`test(118-03): add failing tests for apps map + publish surface`).
- Commit `e7455fac` — FOUND (`feat(118-03): add apps map + publish surface + subscribe-path snapshot`).
