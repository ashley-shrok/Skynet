---
phase: 39
plan: 01
subsystem: backend/fleet-status
tags: [presence-lifecycle, subscription-registry, subscribe-ctx, phase-39-gate2, path-c]
requirements: [GATE2-01, GATE2-02]
requires: []
provides:
  - Extended SubscriptionRegistry interface with onFirstSubscriber(cb) + onLastUnsubscriber(cb) lifecycle callbacks
  - subscribe(sendFrame, ctx?: { userId }) — ctx-carrying subscribe that fires firstSubCallbacks on the 0 -> 1 subscribers transition
  - MockRegistry in ssh-poll-orchestrator.test.ts satisfies the extended interface (no-op stubs)
affects:
  - src/backend/fleet-status/subscription-registry.ts
  - src/backend/fleet-status/subscription-registry.test.ts
  - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
tech_stack:
  added: []
  patterns:
    - Set-of-callbacks lifecycle emitter (no EventEmitter dep) with per-callback try/catch isolation
    - Structured warn logging with operation tag "fleet_status_lifecycle_cb_failed" for consumer bug diagnostics
    - Optional-ctx backward-compat guard so legacy no-ctx callers do not fire onFirstSubscriber
key_files:
  created: []
  modified:
    - src/backend/fleet-status/subscription-registry.ts
    - src/backend/fleet-status/subscription-registry.test.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
decisions:
  - Set-based callbacks over EventEmitter — Q1 in 39-RESEARCH.md; two lifecycle events do not justify pulling EventEmitter into the registry; existing subscribers Set pattern extends naturally
  - Optional ctx (subscribe(sendFrame, ctx?)) over required ctx — the 7 legacy tests call subscribe with one arg; making ctx optional preserves them verbatim and is documented in the interface JSDoc as a backward-compat guard
  - No-ctx subscribe does NOT fire onFirstSubscriber (Test 13 backward-compat guard) — matches the semantic that Path C explicitly needs a userId to work; a no-ctx call is a legacy caller and must not accidentally trigger the poll lifecycle
  - Per-callback try/catch inside the fire loop (never let a consumer bug break subscribe or disposer) — logged via systemLogger.warn { operation: "fleet_status_lifecycle_cb_failed" } for diagnosability
metrics:
  duration: "~11 minutes"
  completed_date: 2026-08-14
  tasks_completed: 2
  files_modified: 3
  files_created: 0
  tests_added: 7
  tests_passing_targeted: "14/14 subscription-registry + 18/18 ssh-poll-orchestrator"
  tests_passing_full_suite: "2258 pass / 6 skipped / 1 todo / 0 fail across 179 files"
---

# Phase 39 Plan 01: Extend SubscriptionRegistry with Presence-Signal Callbacks — Summary

Foundation layer for Path C presence-driven lifecycle (Ashley 2026-08-13 LOCKED): extends `SubscriptionRegistry` with `onFirstSubscriber(cb: (ctx: { userId }) => void)` and `onLastUnsubscriber(cb: () => void)`, plus threads an optional `{ userId }` context through `subscribe()`, so Plan 02 can wire the SSH-poll orchestrator to start on the first browser subscriber and stop on the last unsubscriber — no runtime coupling introduced in this plan.

## What Got Built

**Task 1 — subscription-registry.ts (commit `cf2db817`)**

Extended `SubscriptionRegistry` interface in `src/backend/fleet-status/subscription-registry.ts`:

- `subscribe(sendFrame: SendFrame, ctx?: { userId: string }): () => void` — the second arg is optional to keep the 7 pre-existing tests passing byte-for-byte. When ctx is present AND `subscribers.size` transitions 0 → 1, every callback registered via `onFirstSubscriber` fires with the ctx.
- `onFirstSubscriber(cb: (ctx: { userId: string }) => void): () => void` — returns a disposer that unregisters the callback via `Set.delete`.
- `onLastUnsubscriber(cb: () => void): () => void` — returns a disposer. Callback fires when the returned disposer of `subscribe` runs AND `subscribers.size === 0` post-delete.

Factory (`createSubscriptionRegistry`) additions:

- Two new `Set` instances at closure scope: `firstSubCallbacks` and `lastUnsubCallbacks`.
- `subscribe` captures `wasEmpty = (subscribers.size === 0)` BEFORE adding, delivers the initial snapshot exactly as today, then if `wasEmpty && ctx` fires each `firstSubCallbacks` entry in a try/catch. Each catch logs via `systemLogger.warn` with `operation: "fleet_status_lifecycle_cb_failed"` — consumer bugs never bubble to `subscribe`.
- The disposer returned from `subscribe` deletes from `subscribers` then, if empty, fires each `lastUnsubCallbacks` entry with the same try/catch pattern.

`publishSessionState`, `publishSessionGone`, `getSnapshot`, `makeKey`, and `fanOut` are byte-untouched. `FRAME_SCHEMA_VERSION` re-export at file bottom preserved. No new imports required (`systemLogger` was already imported at line 9).

**Task 2 — new lifecycle tests + MockRegistry stubs (commit `017c5fc6`)**

Appended Tests 8-14 to `src/backend/fleet-status/subscription-registry.test.ts` (7 new tests, numbering continues cleanly from Test 7):

| # | Name | Coverage |
|---|------|----------|
| 8 | onFirstSubscriber fires with ctx.userId when subscriber joins empty registry | Happy path 0 → 1 |
| 9 | onFirstSubscriber does NOT fire on second subscriber (edge already crossed) | Late registration after subscribe = miss |
| 10 | onFirstSubscriber re-fires after teardown + resubscribe cycle | Presence signal survives full cycles |
| 11 | onLastUnsubscriber fires exactly when last disposer runs (1 → 0 edge) | Multi-subscriber disposer sequencing |
| 12 | Disposer returned by onFirstSubscriber unregisters the callback | Registration API is truly cancellable |
| 13 | subscribe() WITHOUT ctx does NOT fire onFirstSubscriber (backward-compat) | Legacy callers do not accidentally trigger poll lifecycle |
| 14 | Callback throws are caught and logged via systemLogger.warn { operation: "fleet_status_lifecycle_cb_failed" } | Consumer bugs never break subscribe/disposer |

Test 14 imports `systemLogger` and uses `vi.mocked(systemLogger.warn)` against the top-level `vi.mock("../utils/logger.js", ...)` already present at file lines 8-15.

Updated `MockRegistry` class in `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` (~L93-122) with no-op stubs for `onFirstSubscriber` and `onLastUnsubscriber` so the file still compiles against the extended interface. Underscore-prefixed params silence unused-var lint. No existing orchestrator test logic was touched — the orchestrator layer does not exercise lifecycle events (Plan 02 will wire them at the starter.ts layer).

## Verification Results

| Gate | Result |
|------|--------|
| `npm run build:backend` | Exit 0 (verified twice — after Task 1 and after Task 2) |
| `npm run build` (full frontend + backend) | Exit 0 |
| `npx vitest run src/backend/fleet-status/subscription-registry.test.ts` | 14/14 pass (7 legacy + 7 new) |
| `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts` | 18/18 pass (MockRegistry interface satisfaction verified) |
| `npx vitest run` (full suite) | 2258 pass / 6 skipped / 1 todo / 0 fail across 179 test files, ~17 min |
| Grep gates: `onFirstSubscriber` / `onLastUnsubscriber` / `fleet_status_lifecycle_cb_failed` / `ctx?: { userId: string }` in subscription-registry.ts | 7 / 4 / 2 / 2 (all >= plan thresholds of 3/3/2/1) |
| Grep gate: Test 8-14 in subscription-registry.test.ts | 7 (== plan threshold) |
| Grep gate: `onFirstSubscriber|onLastUnsubscriber` in ssh-poll-orchestrator.test.ts | 2 (== plan threshold) |

## Deviations from Plan

**None** — plan executed exactly as written. All acceptance criteria were met without needing Rule 1/2/3 auto-fixes.

## Coordination Notes

Executor 39-03 was running in parallel on the same repo (`/home/ubuntu/skynet-tanya`, no worktrees per fleet rule) touching `src/backend/utils/logger.ts` + a new `logger.test.ts`. Their in-flight edit to `logger.ts` appeared as an unstaged change during my commits — I staged only my three files by name (never used `git add .` / `git add -A`) so their work was not disturbed. Their subsequent commit `4aa8a541 test(39-03): add failing tests for logger.formatMessage generic passthrough` landed cleanly on top of my Task 2 (visible in `git log`). Zero file overlap between 39-01 and 39-03 confirmed via `git diff --stat`.

## Threat Model Compliance

The plan's threat register lists T-39-01 (Information Disclosure via ctx passthrough — mitigated: ctx only carries `{ userId }`, no secret material), T-39-02 (DoS via callback registration explosion — accepted: callbacks registered only by trusted in-tree code, no external caller path), T-39-03 (Supply-Chain — mitigated: no new packages introduced), and T-39-SC (slopcheck — n/a, no installs). All mitigations upheld: no new npm packages installed, ctx type-locked to `{ userId: string }` in the interface signature (no ad-hoc key expansion), and both callback Sets remain private to the factory closure (no export surface).

## What Plan 02 Will Consume

- Import + use `registry.onFirstSubscriber(({ userId }) => { ... orchestrator.start(); })` and `registry.onLastUnsubscriber(() => { ... orchestrator.stop(); ... })` at `src/backend/starter.ts` (replacing the current fire-and-forget `orchestrator.start()` at ~line 340).
- Update the single subscribe call site at `src/backend/fleet-status/fleet-status-server.ts:238` from `registry.subscribe(cb)` to `registry.subscribe(cb, { userId })` — the `userId` is already in scope from JWT verification (`payload.userId` at line 181).
- Thread `userId` from the first-subscriber callback into a rewritten `listIdentityHostingHosts` that calls `resolveHostById(row.id, userId)` per host to route through Skynet's canonical decrypt path.

None of the above happens in this plan — Plan 01 is purely additive foundation.

## Threat Flags

No new security-relevant surface introduced beyond what the threat register already covers. The interface extension is a pure in-memory registry refactor with no new network endpoint, auth path, file access, or trust boundary crossing.

## Self-Check: PASSED

Files:
- FOUND: src/backend/fleet-status/subscription-registry.ts
- FOUND: src/backend/fleet-status/subscription-registry.test.ts
- FOUND: src/backend/fleet-status/ssh-poll-orchestrator.test.ts

Commits (via `git log --format='%h %s' cf2db817^..HEAD`):
- FOUND: cf2db817 feat(39-01): extend SubscriptionRegistry with presence-signal callbacks
- FOUND: 017c5fc6 test(39-01): lifecycle-hook coverage + MockRegistry interface satisfaction
