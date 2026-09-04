---
phase: 72-feature-02-slice-2-reconcile-loop
plan: 05
subsystem: fleet-status + distributor wire-through
tags:
  - fleet-substrate
  - opt-in-flag
  - drizzle-projection
  - fail-closed
  - phase-72
  - slice-2-final
requires:
  - 72-02 (Drizzle column `runs_fleet_substrate` on hosts table)
  - 72-04 (fleet-substrate sweep hook wired at tryAcquireHostChannel; IdentityHostingHostRecord internal type)
provides:
  - starter.ts projectRunsFleetSubstrate module-scope helper (exported for direct-drive tests)
  - starter.ts listIdentityHostingHosts projects hostsTable.runsFleetSubstrate into each returned record
  - ssh-poll-orchestrator.ts IdentityHostingHostRecord promoted to exported type
  - createSshPollOrchestrator cast tightened to Array<IdentityHostingHostRecord>
  - Plan 04 TODO block removed, replaced with single-line 72-05 pointer
affects:
  - src/backend/starter.ts (helper + wire-through + cast tightening)
  - src/backend/starter.test.ts (8 new tests)
  - src/backend/fleet-status/ssh-poll-orchestrator.ts (export IdentityHostingHostRecord + TODO removal)
tech-stack:
  added: []
  patterns:
    - "Module-scope pure-function extraction discipline (mirrors maybeInstallStopHook + makeSemaphore) — the helper lives above the VITEST-guarded IIFE so tests import it directly without booting the backend"
    - "Fail-closed dispatch table: only strict true or numeric 1 → true; everything else → false"
    - "Drizzle `.select({...})` projection extension as the single wire-through site (no new query, no new dynamic import)"
    - "TypeScript-level compile-check test — inline `import(...)` type annotation on a variable declaration doubles as a structural contract test between starter.ts's returned records and IdentityHostingHostRecord"
key-files:
  created: []
  modified:
    - src/backend/starter.ts
    - src/backend/starter.test.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
decisions:
  - "Extraction discipline: projectRunsFleetSubstrate lives at module scope (starter.ts lines 128–160) so starter.test.ts can drive it directly. Mirrors the maybeInstallStopHook (Phase 39-04) + makeSemaphore (Bounty b31a5c8e) extraction pattern already established in the same file."
  - "IdentityHostingHostRecord narrowed to strict `runsFleetSubstrate: boolean` (was optional `boolean | undefined` under Plan 04) AND extended with `_connDetails: Record<string, unknown>` to match the full projected record shape. The narrowing is safe because projectRunsFleetSubstrate normalizes every legacy input shape into a strict boolean before the field is set."
  - "Cast tightening at createSshPollOrchestrator: changed from `{ id: string; name: string }` to `IdentityHostingHostRecord` via inline `import(...)` — no new top-level import needed and the compiler now catches shape drift between starter.ts's projection and the OrchestratorDeps contract."
  - "Plan 04 TODO block (6 lines of narrative + rationale) replaced with the exact single-line pointer specified in Plan 05: `// Opt-in flag runsFleetSubstrate populated by starter.ts's listIdentityHostingHosts (wired through 72-05).`"
metrics:
  duration: ~15 min
  completed: 2026-09-04
---

# Phase 72 Plan 05: Project runs_fleet_substrate through starter.ts — Summary

Wires the opt-in flag Plan 04 deliberately stubbed. A `projectRunsFleetSubstrate` helper normalizes the Drizzle column into the strict boolean that the sweep hook reads at tryAcquireHostChannel, making Plan 04's fail-closed-inert hook actually fire on opt-in hosts on the next successful channel acquisition per Skynet instance lifetime.

## What landed

### Edit 1 — `src/backend/starter.ts` (64 insertions / 3 deletions)

**New module-scope helper `projectRunsFleetSubstrate`** at lines 128–160 (immediately after the `makeSemaphore` block at 102–124, mirroring the extraction pattern):

- Signature: `(row: { runsFleetSubstrate?: boolean | number | null }) => boolean`
- Dispatch: `raw === true || raw === 1 → true`; everything else → false
- Docblock (30 lines): names Phase 72 Plan 05; explains the fail-closed rule; explains why the wider `boolean | number | null` union is accepted (legacy NULL rows from ALTER TABLE ADD COLUMN + raw-SQL escape hatches); cross-references `IdentityHostingHostRecord.runsFleetSubstrate` in ssh-poll-orchestrator.ts.

**`listIdentityHostingHosts` projection extended** at the IIFE site:

- Line 394 — drizzle select projection extended with `runsFleetSubstrate: hostsTable.runsFleetSubstrate`.
- Line 410 — rows.map callback returns `runsFleetSubstrate: projectRunsFleetSubstrate(row)` alongside `id`, `name`, `_connDetails`.
- Lines 419–427 — type predicate on the filter callback extended to `h is { id: string; name: string; runsFleetSubstrate: boolean; _connDetails: Record<string, unknown> }`.

**`createSshPollOrchestrator` cast tightened** at lines 583–591:

- Was: `listIdentityHostingHosts as unknown as () => Promise<Array<{ id: string; name: string }>>`
- Now: `listIdentityHostingHosts as unknown as () => Promise<Array<import("./fleet-status/ssh-poll-orchestrator.js").IdentityHostingHostRecord>>`

### Edit 2 — `src/backend/starter.test.ts` (82 insertions / 1 deletion)

**Import extended** at line 22–28 to include `projectRunsFleetSubstrate` from `./starter.js` alongside the existing `maybeInstallStopHook` + `makeSemaphore` imports.

**New describe block** at lines 255–330: `"Phase 72 Plan 05 — projectRunsFleetSubstrate helper"` with 8 tests:

| # | Test                                                                        | Line |
| - | --------------------------------------------------------------------------- | ---- |
| 1 | `runsFleetSubstrate=true → true`                                            | 274  |
| 2 | `runsFleetSubstrate=false → false`                                          | 278  |
| 3 | `runsFleetSubstrate=null → false (fail-closed on legacy NULL)`              | 284  |
| 4 | `runsFleetSubstrate=undefined → false (fail-closed on missing field)`       | 288  |
| 5 | `runsFleetSubstrate=1 (raw SQL escape) → true`                              | 292  |
| 6 | `runsFleetSubstrate=0 → false`                                              | 296  |
| 7 | `pure — no logger/fs/db calls`                                              | 300  |
| 8 | `IdentityHostingHostRecord type import compiles (compile-time proof)`       | 315  |

Test 7 reuses the existing `loggerMock` fixture (beforeEach at line 47) and asserts `info/warn/error/debug` were never called after four helper invocations.

Test 8 declares a variable typed via inline `import("./fleet-status/ssh-poll-orchestrator.js").IdentityHostingHostRecord` with all four fields (`id`, `name`, `runsFleetSubstrate`, `_connDetails`). If the imported type is not structurally compatible with the projected record shape, the test file fails to compile — the real assertion is compile-time. A trailing `expect(_typeCheck.runsFleetSubstrate).toBe(true)` prevents lint from flagging an unused declaration.

### Edit 3 — `src/backend/fleet-status/ssh-poll-orchestrator.ts` (17 insertions / 16 deletions)

**`IdentityHostingHostRecord` promoted to `export interface`** at line 209 (was line 204 `interface IdentityHostingHostRecord extends HostRecord`). Field narrowed from `runsFleetSubstrate?: boolean` to `runsFleetSubstrate: boolean` and `_connDetails: Record<string, unknown>` added — the type now reflects the full projected shape.

Updated docblock (lines 191–208): retains Plan 04 attribution + rationale, adds Plan 05 promotion + `_connDetails` explanation.

**Plan 04 TODO block replaced** at line 2095 with the exact single-line pointer specified in Plan 05:

```
// Opt-in flag runsFleetSubstrate populated by starter.ts's listIdentityHostingHosts (wired through 72-05).
```

The removed TODO block (6 lines starting `// TODO(72-05 or follow-up):`) narrated the fail-closed inert-until-wired state that Plan 04 shipped. That state no longer applies — the wire-through lands in this plan.

## Zero-regression proof

`enableSsh` where-clause + `resolveHostById` decrypt path untouched:

```
$ git diff HEAD~1 src/backend/starter.ts | grep -E '^-.*eq\(hostsTable\.enableSsh' | wc -l
0
$ git diff HEAD~1 src/backend/starter.ts | grep -E '^-.*resolveHostById' | wc -l
0
```

Fleet-status poll behavior is byte-identical for `runsFleetSubstrate=false` hosts — the projection is additive; the sweep gate at `extHost.runsFleetSubstrate === true` still evaluates false for every legacy row until an operator flips the column.

## Test results

**Scoped green-gate** (`npx vitest run src/backend/starter.test.ts src/backend/fleet-status/ssh-poll-orchestrator.test.ts src/backend/distributor/`):

```
 Test Files  7 passed (7)
      Tests  190 passed (190)
   Duration  40.10s
```

Per-suite breakdown:

- `src/backend/starter.test.ts` — **18 tests passed** (5 Phase 39-04 maybeInstallStopHook + 5 Bounty b31a5c8e makeSemaphore + 8 new Phase 72 Plan 05 projectRunsFleetSubstrate).
- `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — **128 tests passed** (including the 6 phase-72 sweep-hook tests from Plan 04, which continue to work unchanged — the sweep gate reads the field via `as IdentityHostingHostRecord` cast at the hook site, and the cast semantics are unaffected by promoting the type to `export` or narrowing the field to strict boolean).
- `src/backend/distributor/` — **44 tests passed** across 5 files (regression proof — no distributor file was modified by this plan).

**Type check** (`npx tsc --noEmit`): clean. Zero phase-72 type errors (`grep -E "IdentityHostingHostRecord|runsFleetSubstrate|projectRunsFleetSubstrate"` returns nothing).

## Acceptance-criteria checklist

| Criterion                                                                                       | Result             |
| ----------------------------------------------------------------------------------------------- | ------------------ |
| `grep -c '^export function projectRunsFleetSubstrate' src/backend/starter.ts`                   | 1 ✓                |
| `grep -c 'hostsTable\.runsFleetSubstrate' src/backend/starter.ts`                               | 1 ✓ (≥1)           |
| `grep -c 'projectRunsFleetSubstrate(row)' src/backend/starter.ts`                               | 1 ✓                |
| `grep -c 'runsFleetSubstrate: boolean' src/backend/starter.ts`                                  | 1 ✓ (≥1)           |
| `grep -c 'IdentityHostingHostRecord' src/backend/starter.ts`                                    | 3 ✓ (≥1)           |
| `grep -Ec 'TODO.*runsFleetSubstrate.*starter\.ts...' src/backend/fleet-status/ssh-poll-orchestrator.ts` | 0 ✓         |
| `grep -c 'wired through 72-05' src/backend/fleet-status/ssh-poll-orchestrator.ts`               | 1 ✓                |
| `grep -Ec '^export interface IdentityHostingHostRecord...' ssh-poll-orchestrator.ts`            | 1 ✓                |
| `enableSsh` where-clause preserved (0 lines removed)                                            | 0 ✓                |
| `resolveHostById` decrypt path preserved (0 lines removed)                                      | 0 ✓                |
| All existing starter.test.ts + ssh-poll-orchestrator.test.ts + distributor tests pass           | ✓ (190/190)        |
| Behavior assertion: Test 8 present + passing (structural type compile-check)                    | ✓                  |

## Slice-2 end-to-end reachability

With Plan 05 landed, the shape doc's headline promise now works end-to-end:

1. Operator flips `runs_fleet_substrate = 1` on a host row.
2. On the next Skynet instance start (or on the next 30s host-list refresh that surfaces a newly-added host or a newly-enabled host), that host's `listIdentityHostingHosts` record carries `runsFleetSubstrate: true`.
3. On the next successful `tryAcquireHostChannel(host)`, the hook's guard `extHost.runsFleetSubstrate === true && !sweepedThisInstance.has(host.id)` fires.
4. `runSweepForHost` runs fire-and-forget (queueMicrotask) — Plan 04's composer + Plan 03's push helpers + Plan 03's log-tags module do the actual byte-compare / push / restart-hook / audit-log work.
5. `fleet_substrate_sweep_result` (per-sweep-per-host summary) + `fleet_substrate_item_changed` / `fleet_substrate_item_failed` (per-item, non-current only) log tags land in the console-forward stream where a diagnosing operator can grep by host name.

Fail-closed default remains dominant on every host whose column is 0 / NULL / not-set: the projection helper returns false, the hook gate never fires, and the sweep stays inert on that host. This preserves the shape doc's "the sweep runs when the flag is off" impossibility invariant.

## Deviations from Plan

None. `<action>` block executed as written. Column name on the drizzle side confirmed as `runsFleetSubstrate` per Plan 02's schema.ts line 140 (no substitution needed).

## Commit landed

- `df728e9d` — `feat(72-05): project runs_fleet_substrate through starter.ts + tighten hook cast`

## Self-Check: PASSED

- `[x]` File `src/backend/starter.ts` — modified, staged, committed
- `[x]` File `src/backend/starter.test.ts` — modified, staged, committed
- `[x]` File `src/backend/fleet-status/ssh-poll-orchestrator.ts` — modified, staged, committed
- `[x]` Commit `df728e9d` present in `git log --oneline`
- `[x]` Scoped vitest gate passes (190/190)
- `[x]` `npx tsc --noEmit` clean
