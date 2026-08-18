---
phase: 44-fix-convo-list-recency-signal-switch-dormant-live-paths-to-i
plan: 02
subsystem: backend/fleet-status (orchestrator) + backend/claude-session (helper exports)
tags: [fleet-status, recency, orchestrator, jsonl-discovery, phase-32-mechanism, cache-invalidation, rediscovery-on-stale, no-history-no-churn]
requires:
  - src/backend/claude-session/discover-identity-session-file.ts (Phase 32 byte-pattern mechanism — consumed via new export additions + SshChannel adapter)
  - src/backend/claude-session/session-file-parser.ts (parseSessionLine + MESSAGE_BEARING_KINDS-eligible kinds — unchanged consumer)
  - src/backend/fleet-status/pid-to-tmux.ts (resolvePidToTmuxSession — unchanged consumer, moved earlier in processPid ordering)
provides:
  - "ssh-poll-orchestrator processPid derives its JSONL path via discoverIdentityJsonlPathViaChannel (Phase 32 mechanism + SshChannel adapter) instead of the pre-Phase-44 jsonlPathForSession(cwd, sessionId) construction"
  - "PidCacheEntry.jsonlPath field caches the resolved discovery path — discovery fires ONCE per PID at cold cache, reused every tick"
  - "PidCacheEntry.staleTailTickCount field + STALE_TAIL_REDISCOVERY_THRESHOLD=5 constant defend against JSONL rotation mid-session via re-discovery on threshold"
  - "TIGHTENED stale-tick condition — no-history sessions (null cached lastMessageAt) do NOT tick the counter and therefore never trigger re-discovery churn; only sessions that HAD a signal AND lost it increment"
  - "New helper discoverIdentityJsonlPathViaChannel(channel, identityName) — SshChannel-abstraction adapter for Phase 32 discovery; reuses buildDiscoveryScript / parseDiscoveryStdout / __matchesIdentityFirstTurnForTests without logic duplication"
  - "5 new orchestrator tests locking cache reuse (G), rediscovery-on-stale (H), discovery-null-fallback (I), tmuxSession-null-skip (J), and the load-bearing no-history-no-churn contract (K)"
affects:
  - src/backend/fleet-status/ssh-poll-orchestrator.ts (processPid pipeline: tmuxSession resolution moved earlier; JSONL path derivation swapped; PidCacheEntry extended)
  - src/backend/claude-session/discover-identity-session-file.ts (export-keyword-only additions — no logic changes; primary discoverIdentitySessionFile(conn, ...) surface unchanged)
tech-stack:
  added: []
  patterns:
    - "SshChannel-adapter for a Phase 32 module — reuse the byte-pattern classifier + shell script + parser without touching the primary Client-based entry point (satisfies 44-CONTEXT.md scope_fence)"
    - "TIGHTENED stale-tick condition — three mutually-exclusive branches (advance / no-history / stale) evaluated in order; only the stale branch increments; no-history branch is a rotation-defense guard against permanent-cycle re-discovery churn"
    - "MockSshChannel substring-routing for a multi-command test scenario — distinct substrings (IDENTITY= for discovery script vs. discovered.jsonl for tail) route to distinct fixtures without cross-command false positives"
key-files:
  created: []
  modified:
    - src/backend/claude-session/discover-identity-session-file.ts (5 export-keyword additions, zero logic changes)
    - src/backend/fleet-status/ssh-poll-orchestrator.ts (PidCacheEntry extension + STALE_TAIL_REDISCOVERY_THRESHOLD + discoverIdentityJsonlPathViaChannel helper + processPid restructure + jsonlPathForSession deletion)
    - src/backend/fleet-status/ssh-poll-orchestrator.test.ts (wireBaseResponses reshape + buildDiscoveryFixture helper + 5 new tests G/H/I/J/K; pre-existing D/E/F fixture updates)
key-decisions:
  - "Extended Phase 32 module's export surface (5 keyword additions) rather than copy-pasting the byte-pattern classifier into the orchestrator. Scope_fence forbids LOGIC changes to discover-identity-session-file.ts; adding `export` is metadata-only and does not alter the module's runtime behavior. Enforced by a diff-filter acceptance criterion permitting only export-keyword additions."
  - "TIGHTENED stale-tick condition (revised from pre-plan draft) — increment ONLY when derivedLastMessageAt !== null AND scanned <= derivedLastMessageAt. The prior draft (`jsonlPath !== null && tailRaw !== null` alone) would have created permanent-cycle re-discovery churn every 10s (5 ticks × 2s cadence) for identities with no message history. Fresh sessions pre-first-turn, identities that never invoke /id, identities whose entire history is tool_use/thinking/lifecycle events all fall into the no-history class and MUST NOT churn. Test K is the load-bearing lock on this condition (10 ticks, empty tail, expects exactly 1 discovery call)."
  - "Deleted the dead jsonlPathForSession helper entirely rather than leaving it declared with a @deprecated annotation. The plan permitted either; deletion satisfies the acceptance criterion `grep -c 'jsonlPathForSession(' == 0` strictly AND removes ~15 lines of dead code + docblock. The removal comment above the deletion site retains grep-ability of the swap history."
  - "Moved tmuxSession resolution EARLIER in processPid (right after parseSessionJson bailout) so the resolved identity name is available for the discovery call. Preserved the `needsTmuxResolution = isNew || cached?.tmuxSession === null` gate — cached-non-null tmuxSession still skips the environ + tmux round-trips."
  - "Test H uses 7 ticks (not 6) to lock the 2-discovery-calls contract. Threshold trip on tick 6 nulls jsonlPath in cache; re-discovery fires the FOLLOWING tick. The plan explicitly permitted adjusting the tick count to match implementation semantics."
  - "MockSshChannel substring routing chose `IDENTITY=` (opening statement of buildDiscoveryScript) + `discovered.jsonl` (mocked discovery result path fragment) as mutually distinct patterns. Iteration order is insertion order per Map semantics, but the patterns don't collide across the two command shapes, so ordering doesn't matter."

patterns-established:
  - "SshChannel-adapter helper pattern for Phase 32 modules — reuse the byte-pattern classifier + shell script + stdout parser without cloning; the ssh2-Client-based primary entry point stays unchanged for the original Phase 32 caller"
  - "TIGHTENED stale-tick condition with three mutually-exclusive branches (advance / no-history / stale) evaluated in order — a template for any cache-invalidation-on-stale mechanism that must NOT churn cold-cache no-history entries"
  - "Test-fixture pattern for multi-command SSH scenarios: use substring routing with mutually distinct patterns per command shape, and register the discovery-script response BEFORE the tail response (though iteration order is insertion order, the substrings don't overlap so ordering is defensive rather than load-bearing)"

requirements-completed: []

metrics:
  duration: ~65min (Tasks 1-3 implementation + tests + full-suite green x2)
  completed: 2026-08-18
---

# Phase 44 Plan 02: ssh-poll-orchestrator JSONL path swap — Summary

**Live-identity JSONL path derivation swapped from fragile `jsonlPathForSession(cwd, sessionId)` construction to the Phase 32 `discoverIdentityJsonlPathViaChannel` byte-pattern mechanism (via SshChannel adapter), with per-PID cache in `PidCacheEntry.jsonlPath`, rediscovery on stale-tail threshold, and a TIGHTENED stale-tick condition that prevents permanent-cycle re-discovery churn on no-history sessions.**

## Performance

- **Duration:** ~65 min (Tasks 1-3 implementation + Task 4 verification + full-suite green x2)
- **Started:** 2026-08-18T20:53:00Z (approx)
- **Completed:** 2026-08-18T21:36:00Z (approx)
- **Tasks:** 4 (3 code tasks + 1 verification-only task)
- **Files modified:** 3 (2 backend source + 1 test)

## Accomplishments

- **Discovery swap landed** — `processPid` no longer builds JSONL paths from `sessionJson.cwd + sessionJson.sessionId` (fragile against cwd drift + Claude Code sessionId rotation on compaction/resume). Live sessions now derive their JSONL path via `discoverIdentityJsonlPathViaChannel(channel, tmuxSession)`, which walks `~/.claude/projects/*/` mtime-descending and returns the newest JSONL whose first user-role line matches `/id <tmuxSession>` — stable across compaction + resume events.
- **Per-PID discovery caching** — `PidCacheEntry.jsonlPath` caches the resolved path; discovery fires ONCE per PID on the first tick where `tmuxSession` resolves and is reused every subsequent tick until the stale-threshold trips. Cost bound: one extra SSH round-trip per PID per PID-lifetime (not per tick), consistent with 44-CONTEXT.md § ssh-poll-orchestrator.ts swap.
- **Rediscovery on stale-tail threshold** — `STALE_TAIL_REDISCOVERY_THRESHOLD = 5`. At the default 2s cadence, ~10s of "cached path returned no fresher signal against a non-null cached lastMessageAt" before invalidating the cached path and re-scanning. Defense against Claude Code JSONL rotation mid-session (a resume/compaction event can rotate the active file, leaving the cached path pointing at a stale JSONL that has stopped growing).
- **TIGHTENED stale-tick condition (load-bearing revision)** — three mutually-exclusive branches, evaluated in order:
  1. **Advance branch** (scanned > derivedLastMessageAt): reset counter to 0.
  2. **No-history branch** (derivedLastMessageAt === null): leave counter at whatever cache had — do NOT tick. Rationale: the stale threshold is a rotation-defense for sessions that once had a signal and lost it, NOT a "kick discovery when we haven't seen a message yet" mechanism. The pre-revision draft would have created permanent-cycle re-discovery churn every 10s for identities with no message history.
  3. **Stale branch** (HAD a signal, tail failed to advance): the ONLY increment path.
- **Test K is the load-bearing lock** for the tightened condition — 10 consecutive ticks with an empty tail (derivedLastMessageAt stays null forever) yield EXACTLY 1 discovery call (the initial cold-cache invocation). Under the pre-revision condition this test would fail (counter would tick 1→5 → invalidate → tick 7 rediscovery → total ≥ 2). Under the tightened condition, counter stays at 0 forever → total = 1.
- **Zero wire-protocol change, zero PID-enumeration change** — status/waitingFor/backgroundTasks/reaping axes all preserved verbatim per 44-CONTEXT.md scope. Only JSONL path derivation swapped.

## Task Commits

Each task was committed atomically:

1. **Task 1: Adapt discoverIdentitySessionFile for the orchestrator's SshChannel abstraction** — `087336d5` (feat)
2. **Task 2: Swap processPid JSONL path derivation to discovery-based + cache jsonlPath in PidCacheEntry with rediscovery-on-stale** — `636c0a8f` (feat)
3. **Task 3: Update ssh-poll-orchestrator.test.ts fixtures for discovery-based path + add coverage for caching + rediscovery-on-stale + no-history-no-churn** — `bc965d9b` (test)
4. **Task 4: Backend build verification for orchestrator changes** — *(no code change — verification only)* — `npm run build:backend` exit 0, `npm run build` exit 0, `npx vitest run src/backend/fleet-status/` exit 0 (10 files, 130 tests), full-suite `npx vitest run` exit 0 (198 files, 2514 pass / 9 skip / 1 todo / 0 fail).

## Files Created/Modified

- **`src/backend/claude-session/discover-identity-session-file.ts`** (modified) — 5 export-keyword additions: `export const RECORD_SEPARATOR`, `export function buildDiscoveryScript`, `export function shellSingleQuote`, `export function parseDiscoveryStdout`, `export type DiscoveryRecord`. Zero logic changes; primary `discoverIdentitySessionFile(conn, ...)` surface unchanged (Phase 32 Client-based caller still consumes as-is).
- **`src/backend/fleet-status/ssh-poll-orchestrator.ts`** (modified) — three concern-clusters:
  1. **Import block** (near line 44): added named-import of the 5 discovery helpers from `../claude-session/discover-identity-session-file.js`.
  2. **PidCacheEntry + constants** (near lines 109–170): added `jsonlPath: string | null` + `staleTailTickCount: number` fields to `PidCacheEntry` (with load-bearing docblocks citing the no-history-no-churn rationale); added `const STALE_TAIL_REDISCOVERY_THRESHOLD = 5;`; deleted the old `jsonlPathForSession` helper + docblock (dead code post-swap; retained a removal-note comment for grep-ability of history).
  3. **New helper + processPid restructure** (lines ~275–540): added `async function discoverIdentityJsonlPathViaChannel(channel, identityName)` (SshChannel adapter for Phase 32 discovery, fail-safe null on any error, zero log lines); restructured `processPid` to (a) resolve `tmuxSession` EARLIER (right after `parseSessionJson` bailout), (b) fire discovery if `tmuxSession !== null && jsonlPath === null`, (c) tail-scan via the resolved path, (d) apply the TIGHTENED stale-tick condition with the three-branch dispatch, (e) threshold-check invalidates `jsonlPath` without wiping `derivedLastMessageAt`, (f) extended both `livenessMap.set` writes with `jsonlPath` + `staleTailTickCount: nextStaleTailTickCount` alongside existing fields.
- **`src/backend/fleet-status/ssh-poll-orchestrator.test.ts`** (modified) — three concern-clusters:
  1. **Fixture reshape** — added `buildDiscoveryFixture(identityName, discoveredPath, matchesIdentity?)` helper that emits the RECORD_SEPARATOR-delimited stdout blob `parseDiscoveryStdout` expects; reshaped `wireBaseResponses` to (a) register the discovery script response on substring `IDENTITY=` (opening statement of `buildDiscoveryScript`), (b) rename tail-key from `test-session-id.jsonl` → `discovered.jsonl` (post-swap discovered-path substring). Zero references to the pre-swap `test-session-id.jsonl` key remain.
  2. **Pre-existing Tests D/E/F updated** — fixture wiring only; assertions on `lastMessageAt` values unchanged. Pipeline is byte-equivalent, only the path source differs.
  3. **New describe block "Phase 44 Plan 02"** with 5 new tests (G/H/I/J/K):
     - **Test G** — cold-cache discovery + cache reuse: discovery fires ONCE across 2 ticks; tail fires every tick.
     - **Test H** — rediscovery on stale-tail threshold with a session that HAD a signal: 7 ticks with identical tail contents yields exactly 2 discovery calls (threshold trip on tick 6 → invalidation → rediscovery on tick 7).
     - **Test I** — discovery returns null (no matching first-user-line): tail SKIPPED for the PID, `lastMessageAt` is null, `IDENTITY=` count = 1 (cold cache), `tail -n 200` count = 0.
     - **Test J** — `tmuxSession` null → discovery skipped entirely: `IDENTITY=` count = 0, `tail -n 200` count = 0, `lastMessageAt` is null.
     - **Test K (load-bearing lock)** — NO-HISTORY session does NOT churn: 10 consecutive ticks with an empty tail (derivedLastMessageAt stays null forever) yield EXACTLY 1 discovery call. Comment cites 44-CONTEXT.md § ssh-poll-orchestrator.ts swap.

## Decisions Made

See `key-decisions` in the frontmatter for the full list. Summary:

1. **Extend Phase 32 module's export surface (metadata-only)** rather than copy-paste the byte-pattern classifier into the orchestrator. Scope_fence permits export-keyword additions.
2. **TIGHTENED stale-tick condition** — increment ONLY when `derivedLastMessageAt !== null AND scanned <= derivedLastMessageAt`. Load-bearing revision that prevents permanent-cycle re-discovery churn on no-history sessions.
3. **Deleted `jsonlPathForSession` entirely** rather than leaving a `@deprecated` declaration. Satisfies `grep -c 'jsonlPathForSession(' == 0` acceptance criterion strictly and removes dead code.
4. **Moved `tmuxSession` resolution earlier in `processPid`** so the resolved identity name feeds the discovery call without an extra tick of latency.
5. **Test H uses 7 ticks (not 6)** because threshold trip on tick 6 nulls `jsonlPath` in cache; re-discovery fires the FOLLOWING tick. Plan explicitly permitted adjusting.
6. **MockSshChannel substring routing** — `IDENTITY=` for the discovery script + `discovered.jsonl` for the tail command. Mutually distinct substrings across command shapes.

## Deviations from Plan

**None — plan executed exactly as written.** Three minor formatting/execution choices worth noting (not deviations):

1. **Deleted `jsonlPathForSession` entirely** rather than leaving it declared with a `@deprecated` annotation. The plan step 3a permitted either ("The function itself can stay declared... or [be] not called from processPid"). Deletion satisfies the acceptance criterion `grep -c 'jsonlPathForSession(' == 0` strictly and removes ~15 lines of dead code. A removal-note comment above the deletion site retains grep-ability of the swap history.

2. **Test H tick count = 7 (not 6)** to lock the 2-discovery-calls contract. Under my implementation, threshold trip on tick 6 nulls `jsonlPath` in cache; re-discovery fires the FOLLOWING tick. The plan explicitly noted "adjust the test to match implementation semantics" if the count differed from the initial reading. Comment in Test H documents the tick-by-tick counter progression.

3. **Fixture helpers `jsonlMessageLine` and `buildDiscoveryFixture`/`wireBaseResponses` are duplicated across the Phase 41 Plan 03 describe block and the new Phase 44 Plan 02 describe block** (rather than hoisted to module scope). Kept local to each describe block for readability and to avoid cross-scope dependencies. Not a deviation — the plan didn't specify scope; both blocks self-contained is the more legible option.

---

**Total deviations:** 0 auto-fixed. All work fell inside the plan's explicit `<action>` steps.

## Issues Encountered

**Pre-existing timing-flake in full-suite run under CPU contention.** The first `npx vitest run` (1098s / 18min duration under parallel worker contention) surfaced 2 test failures in unrelated frontend UI files:
- `src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx > Test 6` — timeout at 5000ms
- `src/ui/features/pretty-view/IdentityModal.test.tsx` — EnvironmentTeardownError (unhandled rejection during teardown)

Both files pass cleanly in isolation:
- `npx vitest run src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx` — 11/11 pass, 16.57s duration.
- `npx vitest run src/ui/features/pretty-view/IdentityModal.test.tsx` — 6/6 pass, 10.06s duration.

Re-ran the full suite: **198 files / 2514 pass / 9 skipped / 1 todo / 0 fail**, exit 0, 683.93s duration (35% faster than the flake run, consistent with reduced contention). These are pre-existing flakes unrelated to Phase 44 Plan 02 — the ssh-poll-orchestrator changes do not touch either failing file's test surface or dependencies.

## User Setup Required

None — no external service configuration required.

## Verification Results

- `npm run build:backend` — exit 0.
- `npm run build` — exit 0.
- `npx vitest run src/backend/fleet-status/` — **10 files, 130 tests, all pass**, exit 0, 6.59s.
- `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — **1 file, 26 tests, all pass**, exit 0 (was 21 pre-plan → +5 new tests + 3 updated fixtures = 26).
- Full-suite `npx vitest run` (second run, clean) — **198 files, 2514 pass / 9 skipped / 1 todo / 0 fail**, exit 0, 683.93s.
- `git diff HEAD~3 HEAD -- src/backend/fleet-status/ssh-poll-orchestrator.ts | grep -c 'as any\|@ts-expect-error'` — 0.

## Acceptance Criteria Grep Verification

| Criterion | Result |
|---|---|
| `grep -n "^export function buildDiscoveryScript" ...discover-identity-session-file.ts` == 1 line | 1 hit (L170) ✓ |
| `grep -n "^export function parseDiscoveryStdout" ...discover-identity-session-file.ts` == 1 line | 1 hit (L233) ✓ |
| `grep -n "^export function shellSingleQuote" ...discover-identity-session-file.ts` == 1 line | 1 hit (L213) ✓ |
| `grep -n "^export const RECORD_SEPARATOR" ...discover-identity-session-file.ts` == 1 line | 1 hit (L87) ✓ |
| `grep -n "discoverIdentityJsonlPathViaChannel" ...ssh-poll-orchestrator.ts` >= 1 declaration | 6 hits (declaration + call site + docblock refs) ✓ |
| `grep -n 'from "../claude-session/discover-identity-session-file' ...ssh-poll-orchestrator.ts` == 1 import | 1 hit (import block) ✓ |
| Scope-fence diff filter (only export-keyword additions permitted) | 0 non-conforming content lines ✓ (2 lines are diff header metadata) |
| `grep -c "jsonlPath" ssh-poll-orchestrator.ts` >= 8 | 14 hits ✓ |
| `grep -c "staleTailTickCount" ssh-poll-orchestrator.ts` >= 5 | 9 hits ✓ |
| `grep -c "STALE_TAIL_REDISCOVERY_THRESHOLD" ssh-poll-orchestrator.ts` >= 2 | 3 hits ✓ |
| `grep -c "jsonlPathForSession(" ssh-poll-orchestrator.ts` == 0 | 0 hits ✓ (dead helper deleted) |
| `grep -n "discoverIdentityJsonlPathViaChannel(channel" ssh-poll-orchestrator.ts` == 1 call site | 1 hit ✓ |
| `grep -c 'derivedLastMessageAt === null' ssh-poll-orchestrator.ts` >= 1 | 3 hits ✓ (no-history branch check + comments) |
| axes preserved (isStaleFromStat/filterAmbientTasks/parseStopHookPayload/parseSessionJson/resolvePidToTmuxSession) | 12 hits ✓ |
| `grep -c "IDENTITY=" ssh-poll-orchestrator.test.ts` >= 6 | 12 hits ✓ |
| `grep -c "buildDiscoveryFixture" ssh-poll-orchestrator.test.ts` >= 6 | 7 hits ✓ |
| `grep -c "STALE_TAIL_REDISCOVERY_THRESHOLD\|rediscovery\|no-history\|no-churn" ssh-poll-orchestrator.test.ts` >= 2 | 11 hits ✓ |
| `grep -c 'test-session-id.jsonl' ssh-poll-orchestrator.test.ts` == 0 | 0 hits ✓ (tail-key renamed to `discovered.jsonl`) |
| `describe("Phase 44 Plan 02` block with >= 5 `it(...)` cases | 5 tests (G/H/I/J/K) present ✓ |
| Test K's `countCallsMatching("IDENTITY=")` == 1 across 10 ticks | Passing ✓ (load-bearing lock) |
| `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts` exit 0 | 26/26 pass ✓ |
| `git diff` for `as any` / `@ts-expect-error` == 0 | 0 hits ✓ |

## Known Stubs

None. All new fields (`jsonlPath`, `staleTailTickCount`) are fully wired through `processPid` and the `livenessMap.set` sites; both new tests G/H/I/J/K plus updated D/E/F pass end-to-end via the injected `MockSshChannel`. The dead `jsonlPathForSession` helper was deleted rather than stubbed.

## Downstream Blockers Unblocked

Plan 44-03 (session-working-store reconciliation chokepoint + max-wins seeding) can now consume the live-side `lastMessageAt` values from the fleet-status WS payload with confidence that the underlying JSONL path is stable across Claude Code compaction/resume events. Combined with Plan 44-01's `/sessions/list` payload extension (already shipped), both feeds (dormant `/sessions/list` seed + live WS publish) now derive from the SAME `/id`-first-turn discovery mechanism — max-wins reconciliation will work correctly because both sources are eventually consistent on the same file.

## Self-Check: PASSED

- **Files present:**
  - `src/backend/claude-session/discover-identity-session-file.ts` — modified, present.
  - `src/backend/fleet-status/ssh-poll-orchestrator.ts` — modified, present.
  - `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — modified, present.
  - `.planning/phases/44-fix-convo-list-recency-signal-switch-dormant-live-paths-to-i/44-02-SUMMARY.md` — created, present.
- **Commits present in git log:** `087336d5` (Task 1), `636c0a8f` (Task 2), `bc965d9b` (Task 3). Task 4 was verification-only per plan.
- **Full-suite green:** `npx vitest run` → 2514 pass / 9 skipped / 1 todo / 0 fail / exit 0 (second-run confirmed the earlier 2 failures were pre-existing timing flakes in unrelated UI test files that pass in isolation).
- **Backend build green:** `npm run build:backend && npm run build` → both exit 0.
- **Scope fence honored:** only `src/backend/fleet-status/ssh-poll-orchestrator.ts` + its test file + the 5 export-keyword additions to `src/backend/claude-session/discover-identity-session-file.ts` (all listed in Task 1 Part A). No edits to `wire-protocol.ts`, `pid-to-tmux.ts`, `liveness-check.js`, `subscription-registry.ts`, or any UI file.
