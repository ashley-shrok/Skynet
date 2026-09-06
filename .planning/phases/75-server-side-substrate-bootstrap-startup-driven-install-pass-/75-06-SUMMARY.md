---
phase: 75-server-side-substrate-bootstrap-startup-driven-install-pass-
plan: "06"
subsystem: host-routes
tags:
  - substrate
  - fire-and-forget
  - queueMicrotask
  - sweep-trigger
  - tdd
dependency_graph:
  requires:
    - 75-02 (ServerSubstrateOrchestrator + sweepOneHost + never-reject contract)
    - 75-04 (credentialId-required guard on POST + PUT)
    - 75-05 (getSubstrateOrchestrator singleton)
  provides:
    - POST /host/db/host on-add fire-and-forget sweep trigger
    - PUT /host/db/host/:id flag-flip-on + credential-rotation sweep trigger
  affects:
    - src/backend/database/routes/host.ts
    - src/backend/database/routes/host.test.ts
tech_stack:
  added: []
  patterns:
    - queueMicrotask fire-and-forget (WARN-3 discipline)
    - null-check on singleton before orchestrator call
    - defense-in-depth try/catch inside microtask body
    - before-state change detection on PUT (extend existing select)
key_files:
  created: []
  modified:
    - src/backend/database/routes/host.ts
    - src/backend/database/routes/host.test.ts
decisions:
  - "Extended existing hostRecord db.select to include runsFleetSubstrate instead of adding a second query — avoids extra DB roundtrip, cleaner sequencing"
  - "queueMicrotask chosen over setImmediate per WARN-3 discipline (drainable in tests via await Promise.resolve())"
  - "Reused fleet_substrate_on_add_no_orchestrator tag on PUT as well as POST — both converge on the same 'orchestrator not available' case; reason field discriminates"
metrics:
  duration: "~20 minutes"
  completed: "2026-09-06"
  tasks_completed: 2
  files_changed: 2
---

# Phase 75 Plan 06: On-add and On-update Substrate Sweep Triggers Summary

Wire the on-add and flag-flip/credential-change fire-and-forget sweep triggers into POST and PUT host route handlers, with 10 new tests proving timing, null-safety, and defense-in-depth error containment.

## What Was Built

**Task 1 (POST on-add trigger):** After `res.json(resolvedHost)` and `notifyStatsHostUpdated(...)`, the POST handler queues a `queueMicrotask` that calls `getSubstrateOrchestrator()?.sweepOneHost({id, name})` when `effectiveRunsFleetSubstrate && effectiveConnectionType === "ssh"`. The microtask null-checks the singleton (logs `fleet_substrate_on_add_no_orchestrator` and returns), wraps the `sweepOneHost` call in try/catch (logs `fleet_substrate_on_add_sweep_error`). The HTTP response is always resolved before the sweep starts.

**Task 2 (PUT flag-flip + credential-rotation trigger):** The existing `hostRecord` db.select was extended to also fetch `runsFleetSubstrate` (before-state), enabling change detection without a second DB roundtrip. After `res.json + notifyStatsHostUpdated`, the PUT handler evaluates two trigger conditions:
- `flagFlippedOn`: `!wasSubstrate && nowIsSubstrate`
- `credentialChangedOnSubstrate`: `wasSubstrate && nowIsSubstrate && previousCredentialId !== currentCredentialId`

If either condition is true, the same `queueMicrotask` fire-and-forget shape fires. Metadata-only edits and flag-flip-off correctly do NOT trigger.

## Commits

| Hash | Message |
|------|---------|
| `471c719d` | test(75-06): add failing on-add trigger tests (RED phase) |
| `f9d4c9b8` | feat(75-06): add on-add fire-and-forget install-pass trigger to POST /host/db/host |
| `d52d4cf9` | test(75-06): add failing PUT flag-flip + credentialId-change trigger tests (RED phase) |
| `b73e7771` | feat(75-06): add on-update flag-flip + credential-change triggers to PUT /host/db/host |

## Tests (21 total — 11 from 75-04 + 10 new)

| Test | Assertion |
|------|-----------|
| T1 | POST substrate host → sweepOneHost called once; response resolves in <200ms (before 500ms sweep) |
| T2 | POST non-substrate → sweepOneHost NOT called |
| T3 | POST + null singleton → response 200; systemLogger.warn with fleet_substrate_on_add_no_orchestrator |
| T4 | POST + sweepOneHost throws sync → response 200; error swallowed |
| T5 | POST + sweepOneHost returns rejected promise → response 200; no unhandledRejection |
| T6 | PUT flag-flip-on (false→true) → sweepOneHost called; response <200ms |
| T7 | PUT flag stays true + credentialId changes → sweepOneHost called |
| T8 | PUT flag stays true + credentialId unchanged (name edit) → sweepOneHost NOT called |
| T9 | PUT flag-flip-off (true→false) → sweepOneHost NOT called |
| T10 | PUT never-substrate stays never-substrate → sweepOneHost NOT called |

## Acceptance Criteria Verification

- `grep -c "getSubstrateOrchestrator" host.ts` → 3 (1 import + 2 call sites in POST + PUT): PASS
- `grep -c "queueMicrotask(async" host.ts` → 2 (POST + PUT): PASS
- `grep -c "setImmediate" host.ts` → 2 (both in comments explaining WARN-3, no actual calls): PASS (no production setImmediate usage)
- `grep -c "sweepOneHost" host.ts` → 3 (POST + PUT + comment reference): PASS (>= 2 call sites)
- `grep -c "fleet_substrate_on_add_no_orchestrator|fleet_substrate_on_add_sweep_error" host.ts` → 4 (POST + PUT each have both tags): PASS
- `grep -c "flagFlippedOn|credentialChangedOnSubstrate|runsFleetSubstrate.*hostRecord|wasSubstrate" host.ts` → 6: PASS (>= 3)
- `grep -c "it(" host.test.ts` → 21 (>= 21): PASS
- `npx vitest run host.test.ts` → 21/21 pass: PASS
- `npx tsc --noEmit` → clean: PASS

## Deviations from Plan

### Minor Structural Deviation

**Before-state load method:** The plan's Step A for Task 2 specified adding a **new, separate** `beforeState` db.select query immediately before the D-08 guard. Instead, the existing `hostRecord` db.select (which already fetched `userId`, `credentialId`, `authType`) was extended to also include `runsFleetSubstrate`. This avoids an extra DB roundtrip (the plan itself noted the before-state fetch adds a roundtrip to every PUT — extending the existing query eliminates this cost entirely). The observable behavior is identical: before-state is available when the trigger tail evaluates `flagFlippedOn` and `credentialChangedOnSubstrate`.

Variable naming follows the same semantics as the plan (wasSubstrate, nowIsSubstrate, previousCredentialId, currentCredentialId, flagFlippedOn, credentialChangedOnSubstrate) — the plan's trigger conditions and comments were preserved verbatim.

## Threat Model Coverage

All T-75-06-xx threats addressed:
- **T-75-06-01** (error surfaces to HTTP response): Enforced by microtask ordering (runs after res.json) + null-check + try/catch. Tests T3/T4/T5 prove all three defenses.
- **T-75-06-04** (concurrent POST+PUT race): Mitigated by 75-02's sweepInFlight Set (second sweepOneHost call for same host is a no-op).
- **T-75-06-06** (unhandledPromiseRejection crash): Mitigated by try/catch inside the async microtask body. Test T5 asserts no unhandledRejection fires.

## Security Invariant

The load-bearing invariant "fire-and-forget install-pass errors must NEVER surface to the host-create HTTP response" is satisfied by three independent defenses:
1. `queueMicrotask` runs AFTER `res.json()` has resolved (microtask ordering)
2. `getSubstrateOrchestrator()` null-check exits early without error propagation
3. `try/catch` around `sweepOneHost` swallows any exception

## Self-Check: PASSED

- `b73e7771` exists in git log: CONFIRMED
- `f9d4c9b8` exists in git log: CONFIRMED
- `471c719d` exists in git log: CONFIRMED
- `d52d4cf9` exists in git log: CONFIRMED
- `/home/ubuntu/skynet-tabitha/src/backend/database/routes/host.ts` modified: CONFIRMED
- `/home/ubuntu/skynet-tabitha/src/backend/database/routes/host.test.ts` modified: CONFIRMED
- 21 tests pass: CONFIRMED
