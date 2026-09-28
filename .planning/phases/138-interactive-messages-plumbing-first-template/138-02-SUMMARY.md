---
phase: 137-interactive-messages-plumbing-first-template
plan: "02"
subsystem: fleet-status-registry + ssh-poll-orchestrator
tags: [widgets, registry, orchestrator, sweep-adapter, reconciliation]
dependency_graph:
  requires:
    - 138-01 (SweepInteractiveMessageLine interface + interactiveMessageLines bucket)
  provides:
    - WidgetStateSchema + WidgetState type (wire-protocol.ts)
    - registry.getWidgetSnapshot() / publishWidgetUpdate() / publishWidgetGoneByHostSlug()
    - orchestrator adaptWidgetLineToState + per-tick publish + reconciliation
  affects:
    - src/backend/fleet-status/wire-protocol.ts
    - src/backend/fleet-status/subscription-registry.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
tech_stack:
  added: []
  patterns:
    - separate-registry-lane (widget Map distinct from apps Map — RESEARCH Pitfall 1)
    - registry-only-no-fanout (publishWidgetUpdate does NOT call fanOut — widgets off sidebar)
    - reconciliation-on-success (same pattern as app reconciliation in Phase 118-04)
    - tdd-red-green (RED commits → GREEN commits per task)
key_files:
  created: []
  modified:
    - src/backend/fleet-status/wire-protocol.ts
    - src/backend/fleet-status/subscription-registry.ts
    - src/backend/fleet-status/subscription-registry.test.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
decisions:
  - WidgetState uses makeAppKey compound-key in widget Map (same shape as apps key but separate Map)
  - publishWidgetUpdate has NO fanOut call — registry-only, widgets never appear in sidebar frames
  - empty-output disambiguation guard widened to include interactiveMessageLines (Rule 1 auto-fix)
  - __adaptWidgetLineToStateForTests exported for direct unit test (mirrors scan tail helper pattern)
  - Test W6 includes an identity line to avoid short-circuiting the empty-output guard
metrics:
  duration: ~35 minutes
  completed: "2026-09-27"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 5
---

# Phase 138 Plan 02: Widget Registry Lane + Orchestrator Adapter Summary

One-liner: Added WidgetStateSchema + a separate widget Map in the SubscriptionRegistry (no frame fan-out), and wired the orchestrator to adapt SweepInteractiveMessageLine → WidgetState with per-tick reconciliation via lastTickLiveWidgets.

## What Shipped

**Task 1 — WidgetState schema + registry widget lane**

`src/backend/fleet-status/wire-protocol.ts` (+36 lines):

- **`WidgetStateSchema`** added after `AppGoneFrameSchema` block with a design-invariant comment block explaining why no widget frames are added to `FrontendOutboundFrame`.
- **`WidgetState`** type exported (`z.infer<typeof WidgetStateSchema>`).
- **`FrontendOutboundFrame` union UNCHANGED** — no `WidgetSnapshotFrame`, `WidgetUpdateFrame`, or `WidgetGoneFrame` added. Widgets are registry-only in Phase 138.
- Fields: `hostId: string`, `slug: string`, `port: number | null`, `isHealthy: boolean`, `createdAtMs: number`.

`src/backend/fleet-status/subscription-registry.ts` (+70 lines):

- **Import** of `WidgetState` from wire-protocol.
- **`const widgets = new Map<string, WidgetState>()`** declared after the `apps` map, with a comment documenting the Pitfall 1 separation rationale.
- **Interface additions**: `publishWidgetUpdate`, `publishWidgetGoneByHostSlug`, `getWidgetSnapshot` in the `SubscriptionRegistry` interface.
- **Implementations**: all three methods use `makeAppKey` for the compound key (same shape as apps, different Map). `publishWidgetUpdate` has NO `fanOut`/`fanOutApp` call — widgets never reach sidebar subscribers.

`src/backend/fleet-status/subscription-registry.test.ts` (+151 lines):

- 9 new tests in a new `describe("Phase 138 Plan 02 — WidgetState schema + widget registry lane")` block.
- Tests 1-2: WidgetStateSchema Zod parse success for port+isHealthy=true and port=null+isHealthy=false.
- Tests 3-7: getWidgetSnapshot/publishWidgetUpdate map semantics (empty, insert, replace, multi-slug, gone + idempotent).
- Test 8: app and widget maps are SEPARATE even for same-slug same-host entries.
- Test 9: `publishWidgetUpdate` does NOT invoke subscriber callbacks (spy asserts NOT called).

**Task 2 — Orchestrator adapter + per-tick reconciliation**

`src/backend/fleet-status/ssh-poll-orchestrator.ts` (+70 lines):

- **Import** `WidgetState` from wire-protocol, `SweepInteractiveMessageLine` from sweep-schema.
- **`lastTickLiveWidgets: Set<string>`** added to the per-host state type with a docblock noting parity with `lastTickLiveApps`.
- **Initialized** `lastTickLiveWidgets: new Set<string>()` at the host-state creation site.
- **`adaptWidgetLineToState(hostId, line)`** pure function added immediately after `adaptAppLineToState`. Maps 5 snake_case fields → camelCase WidgetState (no title/description/hasIcon/healthMessage/users — per D-20).
- **`__adaptWidgetLineToStateForTests`** exported for direct unit test.
- **Widget publish+reconciliation block** added in the successful-sweep loop (after the app reconciliation block, visually separate). Iterates `parsed.interactiveMessageLines`, calls `publishWidgetUpdate` per line, then reconciles `lastTickLiveWidgets` via `publishWidgetGoneByHostSlug` for dropped slugs.
- **Empty-output disambiguation guard widened** (Rule 1 auto-fix): added `&& parsed.interactiveMessageLines.length === 0` to the early-return condition, and added `|| hostState.lastTickLiveWidgets.size > 0` to `hasPriorContent`.

`src/backend/fleet-status/ssh-poll-orchestrator.test.ts` (+183 lines):

- Import `__adaptWidgetLineToStateForTests` + `SweepInteractiveMessageLine` + `WidgetState`.
- `MockRegistry` extended with `publishedWidgetUpdates`, `publishedWidgetGone`, and three new stubs.
- `makeSweepJsonl` extended with `widgets?: Array<Partial<SweepInteractiveMessageLine> & { slug: string }>` input array.
- New `describe("Phase 138 Plan 02")` block at end of file with 6 tests (W1-W6).

## New Exports

| Symbol | File | Shape |
|--------|------|-------|
| `WidgetStateSchema` | wire-protocol.ts | Zod schema |
| `WidgetState` | wire-protocol.ts | `z.infer<typeof WidgetStateSchema>` |
| `publishWidgetUpdate(hostId, widget)` | subscription-registry.ts (interface + impl) | void, NO fanOut |
| `publishWidgetGoneByHostSlug(hostId, slug)` | subscription-registry.ts (interface + impl) | void, idempotent |
| `getWidgetSnapshot()` | subscription-registry.ts (interface + impl) | `WidgetState[]` |
| `adaptWidgetLineToState` (private) | ssh-poll-orchestrator.ts | pure snake→camel adapter |
| `__adaptWidgetLineToStateForTests` | ssh-poll-orchestrator.ts | test-only export |

## FrontendOutboundFrame Unchanged

```
$ grep -n "WidgetSnapshot\|WidgetUpdate\|WidgetGone\|widget-snapshot\|widget-update\|widget-gone" src/backend/fleet-status/wire-protocol.ts
740:// synchronously via registry.getWidgetSnapshot() rather than subscribing to
741:// widget-snapshot frames. Widgets are DELIBERATELY kept off the outbound frame
```

Only comments — no widget frame types added to the union. Invariant confirmed.

## Tests Passing

```
Test Files  11 passed (11)
Tests  491 passed (491)
```

- 9 new subscription-registry tests
- 6 new orchestrator tests
- 15 new tests total across both tasks
- Backend typecheck (`npm run build:backend`) clean

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Empty-output disambiguation guard not widened for widget-only sweeps**

- **Found during:** Task 2 GREEN implementation (Test W2 failing)
- **Issue:** The empty-output guard at `pollOneHostBatch` checked `identityLines.length === 0 && pidLines.length === 0 && appLines.length === 0` — a sweep with ONLY widget lines (no identities, no PIDs, no apps) would short-circuit here and return early, bypassing the widget processing block entirely. This caused Tests W2/W3/W4 to receive zero publishWidgetUpdate calls even though the sweep returned valid widget lines.
- **Fix:** Added `&& parsed.interactiveMessageLines.length === 0` to the three-way early-return condition (now four-way). Added `|| hostState.lastTickLiveWidgets.size > 0` to the `hasPriorContent` check. Both changes mirror the Phase 118 Plan 118-04 precedent that added `appLines` to the same guard.
- **Files modified:** `src/backend/fleet-status/ssh-poll-orchestrator.ts`
- **Commit:** `7617c914`

**2. [Rule 1 - Test design] Test W6 setup adjusted to avoid empty-output short-circuit**

- **Found during:** Task 2 GREEN implementation (Test W6 failing after the empty-output fix above)
- **Issue:** Test W6 used `identities: [], pids: [], widgets: []` on tick 2. After fixing the empty-output guard to include `lastTickLiveWidgets.size > 0` in `hasPriorContent`, a tick-2 sweep with zero content on a host with prior widgets correctly returns `{ok: false}` (as intended — a truly-empty sweep on a box with prior content is suspicious). This prevented the reconciliation from firing.
- **Fix:** Added `identities: [{ identity: "sparrow" }]` to both tick 1 and tick 2 sweeps in Test W6. This makes the sweep non-empty (passes the guard), and tick 2 has a successful non-empty sweep with zero widget lines — correctly triggering reconciliation to zero.
- **Files modified:** `src/backend/fleet-status/ssh-poll-orchestrator.test.ts`
- **Commit:** `7617c914`

## Known Stubs

None — no stubs or placeholder values introduced.

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns. The registry widget Map is in-memory only (no DB persistence). The orchestrator reads `parsed.interactiveMessageLines` which was already validated by `parseSweepJsonl`'s shape gate. All threat mitigations from the plan's threat register are implemented:

| Threat ID | Mitigation | Implemented |
|-----------|------------|-------------|
| T-138-02-SC | Separate Map (widget vs app slug collision prevention) | widgets Map distinct from apps Map |
| T-138-02-IL | No widget frames on FrontendOutboundFrame | FrontendOutboundFrame union unchanged |
| T-138-02-Rec | Reconciliation gated on sweep success | widget block inside same success scope as apps |
| T-138-02-Adapt | adaptWidgetLineToState trusts validated SweepInteractiveMessageLine | no defensive checks added |

## TDD Gate Compliance

- Task 1 RED commit (`49938c74`): 9 failing tests for WidgetState schema + registry lane
- Task 1 GREEN commit (`927455a6`): implementation passing all tests
- Task 2 RED commit (`954f2d07`): 6 failing tests for orchestrator adapter + reconciliation
- Task 2 GREEN commit (`7617c914`): implementation passing all 491 tests

Both TDD gate commit pairs present.

## Self-Check: PASSED

- [x] `src/backend/fleet-status/wire-protocol.ts` — contains `WidgetStateSchema` and `WidgetState`; NO `WidgetSnapshotFrame`/`WidgetUpdateFrame`/`WidgetGoneFrame`
- [x] `src/backend/fleet-status/subscription-registry.ts` — contains `getWidgetSnapshot`, `publishWidgetUpdate`, `publishWidgetGoneByHostSlug`
- [x] `src/backend/fleet-status/ssh-poll-orchestrator.ts` — contains `adaptWidgetLineToState`, `lastTickLiveWidgets`
- [x] FrontendOutboundFrame union unchanged (grep confirmed)
- [x] All 491 tests pass
- [x] Backend typecheck clean
- [x] Commits: `49938c74` (T1 RED), `927455a6` (T1 GREEN), `954f2d07` (T2 RED), `7617c914` (T2 GREEN)
