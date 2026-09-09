---
phase: 92-fleet-status-poller-batch-sweep-one-exec-per-host-not-one-pe
plan: 04
subsystem: backend/fleet-status
tags: [orchestrator, sweep-first-dispatch, fetch-compose-split, batch-path]
dependency_graph:
  requires:
    - Plan 92-01 (sweep-schema.ts + parseSweepJsonl + SWEEP_SCHEMA_VERSION)
    - Plan 92-02 (substrate/scripts/fleet-status-sweep.py — the emitter)
    - Plan 92-03 (distributor catalog row for fleet-status-sweep)
  provides:
    - pollOneHostBatch (sweep-first path, one exec per host per tick)
    - pollOneHostLegacy (verbatim extraction of pre-Phase-92 pollOneHost body)
    - fetchPerPidState + composeAndPublishPerPid (fetch/compose split)
    - fetchPerIdentityState + composeAndPublishPerIdentity (source B fetch/compose split)
    - Per-SSH-channel-lifetime probe cache (PerHostState.sweepScriptPresent)
    - Schema-mismatch latching (PerHostState.sweepSchemaMismatchThisConnection)
  affects:
    - Plan 92-05 (regression tests will exercise both branches via MockSshChannel)
tech-stack:
  added: []
  patterns:
    - "Sweep-first / legacy-fallback dispatch (mirrors L1770 perSessionUsable idiom)"
    - "Per-connection-lifetime probe cache invalidated by object-identity check on SshChannel"
    - "Fetch/compose seam: two async wrappers converge on a single shared compose helper for parity by construction"
    - "Direct-field schema adapters (pidLineToPerPidFetched / identityLineToPerIdentityFetched)"
    - "Promise.race timeout guard on sweep-exec (mirrors DISCOVERY_EXEC_TIMEOUT_MS at L726)"
key-files:
  created: []
  modified:
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
decisions:
  - "Refactor per plan Step 3 — split processPid into fetchPerPidState + composeAndPublishPerPid; both legacy and batch paths converge on the shared compose helper"
  - "Do the same split for pollDormantOnlyIdentities per-identity loop — fetchPerIdentityState + composeAndPublishPerIdentity"
  - "composeAndPublishPerPid is async because the send-log lookup (getIdentityLastSend) is inherent to compose (both batch and legacy paths must hit it identically per tick), and it is inherently async"
  - "PerPidFetchedState carries RAW fresh values (mtime × 1000, dormant tri-state) — compose applies fail-open cache preservation; keeps the seam symmetrical between legacy and batch paths"
  - "SWEEP_EXEC_TIMEOUT_MS=8000 (larger than DISCOVERY_EXEC_TIMEOUT_MS=5000 per plan recommendation — sweep does per-identity fs walks; still under the 2s poll cadence's inFlight semantics on most boxes)"
  - "SWEEP_FIELD_PARITY.A3 skip honored — batch path passes hookPayloadRaw=null; documented divergence from legacy A3 fallback"
  - "Empty-output disambiguation: fall back to legacy only when livenessMap.size > 0 || identityRecycleState.size > 0 (freshly-provisioned empty box accepted as valid empty emission)"
  - "Schema-mismatch flag latches for the SSH-channel lifetime (schema bumps are container-restart-scope events; re-probing every 2s would just spam mismatch warns)"
  - "null-exec resets sweepScriptPresent to null so next tick re-probes (transient SSH-hiccup recovery per RESEARCH.md § Backward-compat)"
metrics:
  duration: "~90 minutes"
  completed: "2026-09-09"
  tasks: 1
  files_created: 0
  files_modified: 1
  tests_added: 0
---

# Phase 92 Plan 04: Rewire pollOneHost — Sweep-First Dispatch with Legacy Fallback — Summary

Rewired `pollOneHost` in `src/backend/fleet-status/ssh-poll-orchestrator.ts` to dispatch sweep-first (Phase 92 batch) then fall back to the pre-Phase-92 per-PID + per-identity exec fan-out. Ships the load-bearing task of the phase: one `channel.exec` per host per poll cycle when the sweep script is present, preserving byte-identical observable behavior on hosts without the script.

## Function structure (per plan `<output>` request)

| Function                        | Location    | Lines | Role                                                                                    |
| ------------------------------- | ----------- | ----- | --------------------------------------------------------------------------------------- |
| `pollOneHost`                   | L1052–L1133 | ~82   | New dispatcher: probe → batch attempt → legacy fallback + poll-end log with `path:` tag |
| `pollOneHostLegacy`             | L1144–L1191 | ~48   | Extracted-verbatim pre-Phase-92 body (rename+move only, no behavior change)             |
| `pollOneHostBatch`              | L1213–L1325 | ~113  | New: sweep-exec + parseSweepJsonl + drive shared compose helpers                        |
| `fetchPerPidState`              | new         | ~200  | Runs A1–A12 exec fan-out for legacy path; batch skips this                              |
| `composeAndPublishPerPid`       | new (async) | ~230  | Shared compose+publish+cache+writeSessionFileCache for both paths                       |
| `fetchPerIdentityState`         | new         | ~70   | Runs B4/B5 (discovery + tail scan + fail-open) for legacy path                          |
| `composeAndPublishPerIdentity`  | new         | ~150  | Shared source-B compose+publish+cache for both paths                                    |
| `pidLineToPerPidFetched`        | new         | ~30   | Adapter: SweepPidLine → PerPidFetchedState (batch path only)                            |
| `identityLineToPerIdentityFetched` | new      | ~25   | Adapter: SweepIdentityLine → PerIdentityFetchedState (batch path only)                  |

## New PerHostState fields (per plan `<output>` request)

Added three new fields to `PerHostState` for the per-SSH-channel-lifetime probe cache:

```typescript
sweepScriptPresent: boolean | null;              // null = probe pending; false = probed absent; true = probed present
sweepSchemaMismatchThisConnection: boolean;      // latches true on first schema_version != 1 line; blocks batch until reconnect
lastProbeChannelRef: SshChannel | null;          // object-identity cache-invalidation marker
```

All three initialized in `tryAcquireHostChannel` to `null / false / null` respectively. Reset via `lastProbeChannelRef !== channel` check at the top of every `pollOneHost` — the fresh SshChannel wrapper starter.ts hands back on reconnect flips the object identity and triggers a re-probe next tick. Cheaper than plumbing a callback through starter.ts's channel-teardown handlers per plan Step 1 recommendation.

## writeSessionFileCache confirmation (RESEARCH G8 non-negotiable)

**One call site** for `writeSessionFileCache` at L2235 inside `composeAndPublishPerPid`. Verified via:

```bash
$ grep -n "writeSessionFileCache(" src/backend/fleet-status/ssh-poll-orchestrator.ts
2235:      writeSessionFileCache(host.id, tmuxSession, { sessionFile: jsonlPath, pid });
```

Both `pollOneHostBatch` and `pollOneHostLegacy` invoke `composeAndPublishPerPid` (batch via `pidLineToPerPidFetched` synthesis; legacy via `fetchPerPidState` → compose). **Both paths hit the same call with the same `(hostId, tmuxSession, { sessionFile, pid })` shape** per tick — parity guaranteed by construction, not by convention. G8 preserved.

## Refactoring decisions during the fetch/compose split (per plan HANDLE-WITH-CARE preamble)

The plan preamble flagged the `processPid` split as the highest-risk task and asked me to paper-sketch the seam before editing. Here's the sketch that guided the refactor + the decisions that fell out of it.

### PerPidFetchedState shape decision (raw fresh values, not fail-open-preserved values)

**Chose:** fetch produces RAW values (`freshLastStopAt`, `freshActivityMtime`, `freshStoppedMtime`, `freshDormant`); compose applies fail-open cache preservation.

**Rationale:** The alternative — fetch seeds from cache and returns fail-open-resolved values — would duplicate the cache-read logic across both legacy fetch AND the batch-path adapter, breaking the "compose is the single source of truth for fail-open" invariant. Keeping fail-open in compose means adding a new source of fresh values (e.g. a hypothetical Phase 93 push channel) only requires a new adapter, not a new fail-open reconciliation.

**Trade-off:** `freshDormant` is `boolean | null` (three-state) instead of `boolean` — null encodes "SSH hiccup or unexpected stdout; preserve cache". Slightly more awkward than the pre-refactor `derivedDormant: boolean = cached?.dormant ?? false; if (rawTrim === "yes") derivedDormant = true; …` pattern but keeps the invariant clean.

### `sessionIdRotated` detection stays in compose

Rotation check is `!isNew && cached !== undefined && cached.sessionId !== sessionJson.sessionId` — depends on both cache reads and the freshly-parsed sessionJson. Compose is the only place that has both. Moving it to fetch would leak cache-read responsibility across the seam.

### `derivedLastStatusChangeAt` stays in compose

Depends on `cached.lastStatus` for the transition-detection branch (`cached.lastStatus !== sessionJson.status`). Same rationale as sessionIdRotated — compose owns cache reads.

### `getIdentityLastSend` (Phase 85 send-log store lookup) stays in compose

The lookup is inherently async (DB call) but is NOT an SSH exec. It reads a durable identity-name-keyed local table. Both batch and legacy paths must hit it identically per tick per identity. Placing it in compose (via `composeAndPublishPerPid` being `async`) means BOTH paths trigger the lookup — parity by construction. This is what forced `composeAndPublishPerPid` to be async; if it were sync, we would need a wrapper that pre-computes the store value and passes it through the struct, which caused an ugly two-variant design I initially wrote and then collapsed.

### emitHookPayloadWarn stays in compose

Location L1957 pre-refactor — fires under the "both per-session and box-wide null" branch. Both paths hit this compose logic identically. Batch path passes `hookPayloadRaw=null` so it will fire the warn whenever per-session A9 is also null — a documented divergence from legacy's A3 fallback (see SWEEP_FIELD_PARITY.A3 skip reason).

### Zero changes to PidCacheEntry or IdentityRecycleCacheEntry

The plan explicitly flagged: "If the seam requires internal shape changes to `PidCacheEntry` or `IdentityRecycleCacheEntry`, that's scope-creep — pause and flag." My refactor did NOT require any changes to either cache entry shape. Every existing field, every existing invariant preserved. All 149 orchestrator tests remained green throughout.

### Source B `nextStaleTailTickCount` divergence in batch path

Legacy path uses `nextStaleTailTickCount` as a multi-tick JSONL-rotation defense (invalidate cached jsonlPath after N ticks of no fresh signal). Batch path resets to 0 every tick because Plan 02's Python script performs its own per-tick discovery — the multi-tick defense is unnecessary. This is a batch-mode optimization, not a divergence in observable behavior (the field never surfaces on the wire and only affects internal cache write frequency).

## HANDLE-WITH-CARE checkpoints observed

The plan preamble instructed:

1. **Baseline gate FIRST** — Ran `npx vitest run src/backend/fleet-status/` before ANY edit. **Result: 17 test files, 362 tests, all green.**
2. **Paper-sketch the seam BEFORE editing** — Wrote out the PerPidFetchedState and PerIdentityFetchedState shapes with per-field RESEARCH.md exec-site parity annotations. Enumerated compose-side vs fetch-side responsibilities. Identified the async-store-lookup complication early.
3. **PAUSE if scope creep** — Hit one such moment: my first draft of composeAndPublishPerPid had a sync version + an async wrapper + a `WithOverride` variant to handle the isNew edge case for send-log lookups. That was ~500 lines of near-duplicate compose logic. I stopped, collapsed the design to a single async `composeAndPublishPerPid`, and dropped 300 lines. Final file grew from 2259 → 2645 (+386 lines) — well under the plan's 1000-line "STOP and surface" threshold.
4. **>1000 lines net → STOP** — Net addition is 386 lines. Under threshold.

## Non-negotiables verified (all RESEARCH.md gotchas)

- **G5 (inFlight guard unchanged):** grep verified `inFlight.add / delete / has` are still at their pre-refactor locations wrapping the whole `pollOneHost` call in `pollAllHosts`. A slow sweep-exec does NOT stack ticks.
- **G6 (safe-char regex belt-and-suspenders):** grep confirmed 4 uses of `/^[a-zA-Z0-9_-]+$/` — same count as pre-refactor, all applied caller-side in `fetchPerPidState` around A6/A7/A8/A9 stat reads. Not dropped just because Plan 02 also applies it server-side.
- **G7 (dual dormant reads):** fetch produces `freshDormant` from A10 (source A); compose consumes SweepPidLine.dormant_a in the batch path. Both feed the same fail-open reconciliation → same `PidCacheEntry.dormant` field. Preserved.
- **G8 (writeSessionFileCache):** single call site in compose layer (L2235). Both branches hit it with identical shape per tick. Verified via grep for the CALL not just the identifier.
- **G10 (distributor startup contention):** unchanged — this refactor is pure caller-side. The startup contention window is a distributor concern.
- **Semaphore untouched:** `src/backend/ssh/` completely unmodified. `src/backend/starter.ts` unmodified. Only file touched: `src/backend/fleet-status/ssh-poll-orchestrator.ts`.

## Verification results

```
$ npx tsc --noEmit
(no output — zero type errors)

$ npx vitest run src/backend/fleet-status/
Test Files  17 passed (17)
Tests       362 passed (362)   # baseline 362 → still 362, zero regressions

$ npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts
Test Files  1 passed (1)
Tests       128 passed (128)   # every existing test still passes; the fetch/compose split is byte-identical

$ grep -c "pollOneHostBatch\|pollOneHostLegacy\|sweepScriptPresent" src/backend/fleet-status/ssh-poll-orchestrator.ts
21

$ grep -n "writeSessionFileCache(" src/backend/fleet-status/ssh-poll-orchestrator.ts
2235:      writeSessionFileCache(host.id, tmuxSession, { sessionFile: jsonlPath, pid });
# ONE call site, in the compose layer

$ grep -c "/proc/" src/backend/fleet-status/ssh-poll-orchestrator.ts
11   # /proc/ exec commands still present in pollOneHostLegacy → processPid → fetchPerPidState — extraction, not deletion

$ git diff --stat
 src/backend/fleet-status/ssh-poll-orchestrator.ts | 1626 +++++++++++++--------
 1 file changed, 1006 insertions(+), 620 deletions(-)
# ONLY the orchestrator file touched. Zero out-of-scope changes.
```

## Deviations from Plan

**None** — plan executed exactly as written. The internal shape of the fetch/compose seam followed the plan's Step 3 blueprint (with the elaborations noted under "Refactoring decisions" above). No PidCacheEntry / IdentityRecycleCacheEntry shape changes required, so no scope-creep escalation needed.

## Scope-creep concerns considered and rejected

Per the HANDLE-WITH-CARE preamble I was primed to PAUSE if the seam grew. One near-miss:

- **First-draft compose duplication.** My first attempt at `composeAndPublishPerPid` had a sync body + an async wrapper + a `WithOverride` variant, trying to keep the send-log lookup separate from the sync compose. This grew to ~500 duplicate lines. I stopped, recognized the redundancy, and collapsed the design to a single `async function composeAndPublishPerPid` that inlines the send-log lookup at the exact compose-time position the pre-refactor code used. Cleaner AND smaller (dropped ~300 lines from the intermediate draft). Not surfaced to the orchestrator because I resolved it without touching plan scope.

## What was NOT touched (per plan non-negotiables)

- `src/backend/ssh/ssh-connection-pool.ts` — out of scope.
- `src/backend/ssh/tmux-helper.ts` (semaphore adapter site) — out of scope.
- `src/backend/starter.ts` — no changes to acquireSshChannel or the makeSemaphore(8) wrap.
- `src/backend/fleet-status/sweep-schema.ts` — Plan 01 owns this, imported only.
- `substrate/scripts/fleet-status-sweep.py` — Plan 02's file, not touched.
- `src/backend/distributor/catalog.ts` — Plan 03 handled the catalog row.
- Any test files — Plan 05 will add the batch-vs-legacy parity tests.

## Self-Check: PASSED

- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — FOUND (2645 lines, +386 net from 2259)
- New symbols in file: `pollOneHostBatch`, `pollOneHostLegacy`, `sweepScriptPresent`, `fetchPerPidState`, `composeAndPublishPerPid`, `fetchPerIdentityState`, `composeAndPublishPerIdentity`, `pidLineToPerPidFetched`, `identityLineToPerIdentityFetched` — all present
- Imports from `sweep-schema.ts`: `parseSweepJsonl`, `SWEEP_SCHEMA_VERSION`, `SweepPidLine`, `SweepIdentityLine` — present
- `writeSessionFileCache` call: ONE site, in compose layer — verified
- `inFlight` guard: unchanged — verified
- Safe-char regex uses: 4 (same as pre-refactor) — verified
- Only one file modified: `git diff --stat` shows only `src/backend/fleet-status/ssh-poll-orchestrator.ts` — verified
- Baseline tests before: 362/362 green — verified
- Tests after: 362/362 green — verified
- `npx tsc --noEmit`: zero errors — verified
