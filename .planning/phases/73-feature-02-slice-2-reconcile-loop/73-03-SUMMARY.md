---
phase: 72-feature-02-slice-2-reconcile-loop
plan: 03
subsystem: backend/distributor
tags: [pure-lib, sweep-decision, log-tags, byte-compare, fail-closed, tdd]
requires:
  - src/backend/distributor/catalog.ts (Plan 01 — CatalogEntry type)
  - src/backend/utils/logger.ts (systemLogger)
provides:
  - src/backend/distributor/sweep-logic.ts (decideItemAction, computeInstallMode, chooseRestartHook + ItemInputs, ItemDecision)
  - src/backend/distributor/log-tags.ts (logSweepResult, logItemChanged, logItemFailed, logSweepHookError)
  - src/backend/distributor/sweep-logic.test.ts (11 tests, 100% branch coverage of decideItemAction)
  - src/backend/distributor/log-tags.test.ts (5 tests, exact operation-string + payload-shape enforcement)
affects: []
tech-stack:
  added: []
  patterns:
    - pure-lib + injected transport (mirrors src/backend/fleet-status/liveness-check.ts)
    - readOk-sentinel discriminated union (mirrors readStatWithSentinel in ssh-poll-orchestrator.ts:107–178)
    - fail-closed on transport error (byte-compare gate never fires on unknown installed state)
    - operation-field naming discipline (mirrors fleet_status_* tags in ssh-poll-orchestrator.ts)
key-files:
  created:
    - src/backend/distributor/sweep-logic.ts
    - src/backend/distributor/sweep-logic.test.ts
    - src/backend/distributor/log-tags.ts
    - src/backend/distributor/log-tags.test.ts
  modified: []
decisions:
  - Buffer.equals is the sole byte-compare primitive (mirrors cmp -s semantics from the Nicole-battle-tested feature-02 pattern)
  - Fail-closed on installed-read transport error is a first-class design choice, not a defensive afterthought — Test 6 asserts it
  - chooseRestartHook is exported as a peer to decideItemAction (redundant with restartHookToFire on push decisions) so Plan 04's log-line sites can resolve the hook name without destructuring the decision union
  - computeInstallMode masks to 0o777 (not 0o7777) — no current catalog entry needs setuid/setgid/sticky; narrower mask makes intent obvious
  - log-tags.ts has exactly ONE import (systemLogger); zero coupling to catalog/sweep-logic/transport keeps the two modules as peers composed only in Plan 04
  - Added a Test 6b (readOk:false "unknown" reason) beyond the plan's 10 spec'd tests — covers the second variant of the fail-closed union branch that the original 10 tests didn't exercise. No signature drift; strictly additive coverage.
metrics:
  duration: ~5 minutes
  tests_added: 16 (11 sweep-logic + 5 log-tags)
  files_created: 4
  completed: 2026-09-04
---

# Phase 73 Plan 03: Pure sweep-decision logic + log-tag helpers Summary

Landed the pure decision layer (byte-compare + mode-mirroring + restart-hook selection) and the log-tag layer (four thin systemLogger wrappers with grep-anchor operation strings) for the fleet-substrate sweep — Plan 04 composes both with real SshChannel.exec.

## What was built

Two peer modules under `src/backend/distributor/` following the pure-lib + injected-transport pattern from `src/backend/fleet-status/liveness-check.ts`:

### `sweep-logic.ts` — Pure decision layer

Three exported functions + two exported types:

- **`decideItemAction(inputs: ItemInputs): ItemDecision`** — 5-precedence decision fn (bundled-null → skip; installed readOk-false → skip; installed absent → push; bytes equal → skip; else push). Fail-closed on transport error is the load-bearing invariant.
- **`computeInstallMode(bundledStatMode: number): number`** — masks `fs.statSync().mode` to `& 0o777` (strips S_IFREG file-type high bits).
- **`chooseRestartHook(decision, entry): string | null`** — resolves the systemd unit name for the log-line site; returns null for all skip decisions and for push decisions on entries without a restart hook.
- **`ItemInputs`** — discriminated-union input type; `installedRead` is `{ readOk: true; bytes: Buffer | null } | { readOk: false; reason: "transport" | "unknown" }`.
- **`ItemDecision`** — discriminated-union output type; push shape carries `restartHookToFire`, skip shape carries `reason: "bytes-match" | "installed-read-failed" | "bundled-read-failed"`.

Zero imports beyond `CatalogEntry` from `./catalog.js`. No fs, no SSH, no process, no logger.

### `log-tags.ts` — Log-tag helpers

Four exported functions, all thin wrappers around `systemLogger.info` / `systemLogger.warn`:

| Helper                | Level | Operation string                        | When emitted                                                     |
| --------------------- | ----- | --------------------------------------- | ---------------------------------------------------------------- |
| `logSweepResult`      | info  | `fleet_substrate_sweep_result`          | Once per sweep-per-host, regardless of outcome                   |
| `logItemChanged`      | info  | `fleet_substrate_item_changed`          | Per-item, only when the sweep outcome is non-current             |
| `logItemFailed`       | warn  | `fleet_substrate_item_failed`           | Per-item failure (read/write/chmod/restart stage)                |
| `logSweepHookError`   | warn  | `fleet_substrate_sweep_hook_error`      | Per-sweep-invocation, from Plan 04's orchestrator-scoped `.catch` |

Exactly ONE import (`systemLogger`). Zero coupling to `./catalog`, `./sweep-logic`, or any transport module — composition with the decision layer happens in Plan 04's hook code.

## Fail-closed invariant (Test 6 of Task 1)

The shape doc's "sweep runs when flag is off" failure mode and "bundled bytes reach the wrong host" concerns both point to fail-closed. **Test 6 asserts** that when `installedRead.readOk === false` (transport error), `decideItemAction` returns `{ action: "skip", reason: "installed-read-failed" }` — **not push**. Added Test 6b covers the `reason: "unknown"` variant of the same union branch. Together they proof that no readOk-false input can ever cross into the push path.

## Test results

Both files exercised via scoped `npx vitest run src/backend/distributor/`:

```
 Test Files  3 passed (3)
      Tests  23 passed (23)
   Start at  07:33:49
   Duration  8.29s (transform 1.19s, setup 558ms, import 1.38s, tests 491ms, environment 3ms)
```

Break-down: 7 pre-existing catalog tests + 11 new sweep-logic tests + 5 new log-tags tests = 23. All green.

## Cross-reference: the four log-tag operation strings

Plan 04 must call these helpers with these exact strings (grep-anchors for a diagnosing operator tailing `console-forward.log`):

1. `fleet_substrate_sweep_result` — always emitted
2. `fleet_substrate_item_changed` — non-current outcomes only
3. `fleet_substrate_item_failed` — per-item failures
4. `fleet_substrate_sweep_hook_error` — orchestrator-scoped `.catch` defense-in-depth (WARN-2 fix from the plan-checker revision)

## Signature drift from `<behavior>` spec

**None.** All 10 spec'd sweep-logic behaviors implemented exactly as written; all 5 spec'd log-tag behaviors implemented exactly as written. The one additive test (`Test 6b`) covers a second variant of the `readOk: false` union branch and does not alter any function signature.

## Deviations from Plan

**None.** Plan executed exactly as written. No auto-fixes triggered (Rules 1–3), no architectural questions (Rule 4). The plan's TDD discipline (RED test-commit → GREEN feat-commit per task) was followed for both tasks, producing 4 atomic commits in strict RED/GREEN sequence.

## Commits

| Task | Phase | Commit    | Message                                                                    |
| ---- | ----- | --------- | -------------------------------------------------------------------------- |
| 1    | RED   | 08d0cd7c  | test(73-03): add failing tests for pure sweep-decision logic               |
| 1    | GREEN | 924a8e9d  | feat(73-03): implement pure sweep-decision logic (byte-compare + mode + hook) |
| 2    | RED   | 194917d9  | test(73-03): add failing tests for 4 log-tag helpers with exact operation values |
| 2    | GREEN | d23e1f31  | feat(73-03): implement 4 log-tag helpers with exact operation strings      |

## Downstream contract for Plan 04

Plan 04's hook code (in `ssh-poll-orchestrator.ts` or a new `sweep-runner.ts`) will:

1. For each catalog entry, `SshChannel.exec` to fetch installed-side bytes + mode → build an `ItemInputs`.
2. Call `decideItemAction(inputs)` — get an `ItemDecision`.
3. If `action === "push"`: `SshChannel.exec` to write bytes + chmod to `computeInstallMode(bundledStatMode)`; then if `chooseRestartHook(decision, entry) !== null`, exec `systemctl --user restart <hook>`.
4. Emit `logItemChanged` (on success) or `logItemFailed` (on stage failure) per item.
5. After the walk, emit `logSweepResult` once.
6. Wrap the whole `runSweepForHost` promise in `.catch(err => logSweepHookError(...))` at the orchestrator hook site (defense-in-depth for the fire-and-forget promise contract).

## Self-Check: PASSED

- File `src/backend/distributor/sweep-logic.ts` — FOUND
- File `src/backend/distributor/sweep-logic.test.ts` — FOUND
- File `src/backend/distributor/log-tags.ts` — FOUND
- File `src/backend/distributor/log-tags.test.ts` — FOUND
- Commit `08d0cd7c` (RED test-1) — FOUND
- Commit `924a8e9d` (GREEN feat-1) — FOUND
- Commit `194917d9` (RED test-2) — FOUND
- Commit `d23e1f31` (GREEN feat-2) — FOUND
- Scoped test run `npx vitest run src/backend/distributor/` — 23/23 passed
- Fan-out check (no fleet-status/ssh-connection/child_process/node:fs imports in non-test distributor source) — 0 matches
