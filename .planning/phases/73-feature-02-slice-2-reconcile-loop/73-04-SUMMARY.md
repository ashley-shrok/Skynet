---
phase: 72-feature-02-slice-2-reconcile-loop
plan: 04
subsystem: backend/distributor + backend/fleet-status
tags: [sweep-hook, ssh-push, byte-compare, mode-mirror, restart-hook, fire-and-forget, tdd, load-bearing-integration]
requires:
  - src/backend/distributor/catalog.ts (Plan 01)
  - src/backend/distributor/sweep-logic.ts (Plan 03 pure decision layer)
  - src/backend/distributor/log-tags.ts (Plan 03 log helpers)
  - src/backend/fleet-status/ssh-poll-orchestrator.ts (LOAD-BEARING integration site)
provides:
  - src/backend/distributor/ssh-push.ts (readInstalledBytes, writeInstalledBytesWithMode, restartUserUnit + InstalledReadResult type)
  - src/backend/distributor/run-sweep.ts (runSweepForHost + SweepDeps type)
  - src/backend/fleet-status/ssh-poll-orchestrator.ts hook (sweepedThisInstance Set + bundledReaderFromDisk + queueMicrotask sweep-hook + stop() cleanup)
affects:
  - src/backend/fleet-status/ssh-poll-orchestrator.ts tryAcquireHostChannel path (additive only; existing paths unchanged)
tech-stack:
  added: []
  patterns:
    - Sentinel-based transport-vs-ENOENT parsing (mirrors readStatWithSentinel:107–178)
    - pure-lib + injected-transport composer (mirrors liveness-check.ts)
    - fire-and-forget with defense-in-depth .catch (WARN-2: routes through logSweepHookError)
    - queueMicrotask scheduling for hook (WARN-3: NOT setImmediate — drainable in tests via `await Promise.resolve()`)
    - once-per-host-per-instance in-memory Set gating (dies with the closure on container restart)
    - opt-in flag gating (host.runsFleetSubstrate === true; default undefined → fail-closed)
    - zero OrchestratorDeps additions (WARN-4: sweep is not a Skynet-user-visible surface)
key-files:
  created:
    - src/backend/distributor/ssh-push.ts
    - src/backend/distributor/ssh-push.test.ts
    - src/backend/distributor/run-sweep.ts
    - src/backend/distributor/run-sweep.test.ts
  modified:
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
decisions:
  - queueMicrotask (NOT setImmediate) — WARN-3 fix pinned deterministic microtask draining for the tests
  - Defense-in-depth .catch routes through logSweepHookError from log-tags.ts — WARN-2 fix unifies the log surface with Plan 03
  - Zero OrchestratorDeps additions — WARN-4 fix keeps the sweep off the Skynet-user-visible surface; the flag is picked up via an internal IdentityHostingHostRecord type-narrow cast at the hook site
  - bundledReaderFromDisk is a private adapter inside createSshPollOrchestrator closure (fs.readFile + fs.stat) — injected as SweepDeps.readBundledBytes so the sweep composer stays testable
  - The atomic write command is a single exec (mkdir -p && base64 -d && chmod && echo __WRITE_OK__) — no partial-write states across exec boundaries
  - Fail-closed on read transport error (installed-read-failed → skip); mirrors sweep-logic.ts's Plan 03 invariant
  - Sequential per-item iteration (no Promise.all) — keeps the channel unloaded, mirrors the poll's fire-once-not-parallel discipline
  - Test fixture correction in Test 9 (run-sweep): keyed readBundledBytes on bundledPath (not slug) after initial test drop caught the default template collision — no signature drift
metrics:
  duration: ~15 minutes
  tests_added: 27 (11 ssh-push + 10 run-sweep + 6 orchestrator sweep-hook)
  tests_total_scoped: 172 (128 orchestrator + 44 distributor)
  files_created: 4
  files_modified: 2
  completed: 2026-09-04
---

# Phase 73 Plan 04: Wire the SSH-channel-backed push helpers + sweep composer + orchestrator hook Summary

Landed the full transport + composer + integration for the fleet-substrate reconcile loop. The sweep now fires once per opt-in identity-hosting host per Skynet instance lifetime, piggybacking on the natural moment `tryAcquireHostChannel` first succeeds for that host — no new timer, no new SSH pool, zero OrchestratorDeps additions, zero degradation of the 2s fleet-status poll.

## What was built

### `src/backend/distributor/ssh-push.ts` (Task 1)

Three async SSH-channel-backed helpers, each taking an injected `channel: SshChannel` and performing exactly one `channel.exec` per invocation:

- **`readInstalledBytes(channel, installPath): Promise<InstalledReadResult>`** — `base64 -w0 '<path>' 2>/dev/null && echo __READ_OK__ || echo __READ_ENOENT__`. Sentinel-based parsing mirrors `readStatWithSentinel` at ssh-poll-orchestrator.ts:107–178.
- **`writeInstalledBytesWithMode(channel, installPath, bytes, modeOctal)`** — single atomic exec: `mkdir -p '<parent>' && echo '<b64>' | base64 -d > '<path>' && chmod <mode> '<path>' && echo __WRITE_OK__ || echo __WRITE_FAIL__`.
- **`restartUserUnit(channel, unitName)`** — `systemctl --user restart '<unit>' && echo __RESTART_OK__ || echo __RESTART_FAIL__`.

Every helper wraps its body in try/catch and returns a discriminated-union result rather than throwing (never-throw fire-and-forget contract required by the orchestrator hook). Only two runtime imports: type-only `SshChannel` from ssh-poll-orchestrator.js + `shellSingleQuote` from discover-identity-session-file.js. Zero coupling to `src/backend/ssh/*`.

### `src/backend/distributor/run-sweep.ts` (Task 2)

`runSweepForHost(channel, host, catalog, deps): Promise<void>` — the fire-and-forget composer:

1. Sequential for-of loop over the catalog (no Promise.all — keeps the channel unloaded).
2. Per entry: read bundled bytes (via injected `deps.readBundledBytes`) + installed bytes (via `readInstalledBytes`) → feed both to `decideItemAction` (Plan 03 pure decision).
3. On push decision: `writeInstalledBytesWithMode` with mode from `computeInstallMode(bundledStat.mode)`; if `decision.restartHookToFire !== null`, fire `restartUserUnit`.
4. Per-item errors → `logItemFailed` with a stage tag; changes → `logItemChanged` with `changeKind` and `restartHookFired`.
5. Final `logSweepResult` with counters (itemsChecked/itemsChanged/itemsFailed + durationMs).

Never rejects. Two `try {` boundaries: outer per-item catch-all + inner reads block (defense-in-depth). `SweepDeps.readBundledBytes` is injected so unit tests never touch disk — mirrors the pure-lib + injected-transport pattern in `liveness-check.ts`.

### `src/backend/fleet-status/ssh-poll-orchestrator.ts` (Task 3 — the load-bearing edit)

**Exact line ranges of the additions (post-edit line numbers):**

| Section                              | Lines    | Purpose                                                                 |
| ------------------------------------ | -------- | ----------------------------------------------------------------------- |
| Import additions                     | 56–62    | `readFile`, `stat`, `runSweepForHost`, `FLEET_SUBSTRATE_CATALOG`, `logSweepHookError` |
| `IdentityHostingHostRecord` narrow   | 188–205  | Internal type extension for the `runsFleetSubstrate?: boolean` flag     |
| `sweepedThisInstance` declaration    | 815–820  | New Set alongside `inFlight` and `skipCount`                            |
| `bundledReaderFromDisk` helper       | 2020–2048| Pure adapter: `fs.readFile + fs.stat`, never throws                     |
| Sweep hook (inside tryAcquireHostChannel success branch) | 2070–2129 | `queueMicrotask` + `runSweepForHost().catch(logSweepHookError)` guarded by flag + Set |
| `stop()` clears `sweepedThisInstance`| 2276–2286| Symmetric with `perHostState.clear()`                                   |

**Total: 111 additions, 0 deletions.** All existing paths (poll cadence, in-flight guard, evict-branch, 30s stale sweep, source A + source B poll logic) are byte-identical.

## Zero OrchestratorDeps additions (WARN-4 fix proof)

```
$ git diff src/backend/fleet-status/ssh-poll-orchestrator.ts \
    | sed -n '/export interface OrchestratorDeps/,/^}/p' \
    | grep -c '^+'
0
```

The `runsFleetSubstrate?: boolean` flag lives on the internal `IdentityHostingHostRecord` extension type; the hook picks it up via `const extHost = host as IdentityHostingHostRecord;` at the hook site. This keeps the sweep off the Skynet-user-visible OrchestratorDeps surface, per the shape doc's "the sweep is not a Skynet-user-visible surface" invariant.

## Zero existing operation-string removals (regression proof)

```
$ git diff src/backend/fleet-status/ssh-poll-orchestrator.ts \
    | grep -E '^-.*operation: "fleet_status_' | wc -l
0
```

No deleted lines containing existing `fleet_status_*` operation strings. The trail's grep-anchors stay stable.

## Zero setImmediate additions (WARN-3 fix proof)

```
$ git diff src/backend/fleet-status/ssh-poll-orchestrator.ts \
    | grep -cE '^\+.*setImmediate\('
0
```

The primitive is `queueMicrotask` exclusively — drainable in tests via `await Promise.resolve()`, avoiding the `vi.useFakeTimers` → `tick()` drain gap that could produce false-green tests with `setImmediate`.

## TODO for starter.ts wire-through (present, single line)

```
// TODO(73-05 or follow-up): wire runsFleetSubstrate through starter.ts's
// listIdentityHostingHosts Drizzle projection so the flag reaches this
// hook site as a truthy value on opt-in hosts. Until then, every host
// sees runsFleetSubstrate=undefined and the sweep is inert — intentional
// fail-closed behavior consistent with the shape doc's "default off"
// invariant. See src/backend/starter.ts listIdentityHostingHosts.
```

## Test results (scoped gate)

```
$ npx vitest run src/backend/distributor/ src/backend/fleet-status/ssh-poll-orchestrator.test.ts

 Test Files  6 passed (6)
      Tests  172 passed (172)
   Duration  26.90s
```

Breakdown:
- **ssh-poll-orchestrator.test.ts:** 128/128 — 125 pre-existing tests (zero-regression proof) + 6 new phase-73 sweep-hook tests (A–F)
- **distributor:** 44/44 — 7 catalog + 11 sweep-logic + 5 log-tags + 11 ssh-push + 10 run-sweep

`npx tsc --noEmit 2>&1 | grep -E "distributor|IdentityHostingHostRecord|runsFleetSubstrate" | wc -l` = 0 (zero phase-73 type errors). Full `tsc --noEmit` also runs clean.

## Commits (6 atomic per-task RED/GREEN)

| Task | Phase | Commit    | Message                                                                    |
| ---- | ----- | --------- | -------------------------------------------------------------------------- |
| 1    | RED   | 7a0e780a  | test(73-04): add failing tests for SSH-channel-backed push helpers        |
| 1    | GREEN | c10118db  | feat(73-04): implement SSH-channel-backed push helpers (never-throw)      |
| 2    | RED   | 498a3c0b  | test(73-04): add failing tests for runSweepForHost composer               |
| 2    | GREEN | a35b46c5  | feat(73-04): implement runSweepForHost composer (fire-and-forget)         |
| 3    | RED   | fb611054  | test(73-04): add failing phase-73 sweep-hook regression tests (A–F)       |
| 3    | GREEN | ca1a5a38  | feat(73-04): hook runSweepForHost into tryAcquireHostChannel (fire-and-forget) |

## Deviations from Plan

**One test-fixture correction in Task 2, no signature drift:**

- **[Rule 1 — Bug] Test 9 (run-sweep mode-mirror) fixture keyed on wrong path**
  - **Found during:** Task 2 GREEN — initial vitest run showed Test 9 failing because both catalog entries used the default `bundledPath` from the `catalogEntry()` factory template, so the `readBundledBytes` stub's `path.includes("exec-bit")` branch never matched and both writes chmod'd to 755.
  - **Fix:** Distinct `bundledPath` values (`/app/exec-bit` vs `/app/no-exec`) per entry + stub keyed on the exact bundledPath.
  - **Files modified:** `src/backend/distributor/run-sweep.test.ts` (test-fixture-only, no production drift)
  - **Committed as part of:** GREEN commit a35b46c5 (test-fixture bug caught during GREEN, fixed alongside implementation)

Otherwise: **plan executed exactly as written.** No auto-fixes triggered on production code (Rules 1–3), no architectural questions raised (Rule 4). The plan-checker's WARN-2 (logSweepHookError routing), WARN-3 (queueMicrotask NOT setImmediate), and WARN-4 (zero OrchestratorDeps additions) were followed verbatim.

## Downstream contract for follow-up

The sweep is currently **inert in production** because starter.ts's `listIdentityHostingHosts` does not yet project the `runs_fleet_substrate` Drizzle column into the returned records. Every host arrives with `runsFleetSubstrate=undefined`, the opt-in check `extHost.runsFleetSubstrate === true` returns false, and `runSweepForHost` never fires. This is intentional fail-closed behavior — the shape doc's "default off" invariant. Plan 73-05 (or a follow-up) wires the projection through.

Once the projection lands, an operator sets `runs_fleet_substrate=1` on a host row and the sweep fires on next successful channel acquisition (which happens within one poll tick for hosts already in the list, or on next host-refresh for newly-added hosts). The sweep runs sequentially against the 19-entry FLEET_SUBSTRATE_CATALOG, pushes stale bytes over the orchestrator's existing channel, restarts `agent-supervisor.service` on the one entry that carries a restart hook, and emits the four `fleet_substrate_*` log tags for the operator's grep story.

## Self-Check: PASSED

- File `src/backend/distributor/ssh-push.ts` — FOUND
- File `src/backend/distributor/ssh-push.test.ts` — FOUND
- File `src/backend/distributor/run-sweep.ts` — FOUND
- File `src/backend/distributor/run-sweep.test.ts` — FOUND
- File `src/backend/fleet-status/ssh-poll-orchestrator.ts` — MODIFIED (111 additions, 0 deletions)
- File `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — MODIFIED (+6 phase-73 sweep-hook tests + top-level vi.mock for run-sweep/log-tags)
- Commit `7a0e780a` (RED test-1) — FOUND
- Commit `c10118db` (GREEN feat-1) — FOUND
- Commit `498a3c0b` (RED test-2) — FOUND
- Commit `a35b46c5` (GREEN feat-2) — FOUND
- Commit `fb611054` (RED test-3) — FOUND
- Commit `ca1a5a38` (GREEN feat-3) — FOUND
- Scoped test run `npx vitest run src/backend/distributor/ src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — 172/172 green
- OrchestratorDeps interface diff-additions: 0 (WARN-4 fix)
- setImmediate diff-additions: 0 (WARN-3 fix)
- existing fleet_status_* operation-string removals: 0 (zero-regression proof)
- TODO(starter.ts) present: 1 single-line reference
- tsc phase-73 errors: 0
