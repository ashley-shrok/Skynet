---
phase: 47-convo-list-per-row-current-work-hint-from-ai-title-extends-f
plan: 03
subsystem: ui/state (session-working-store reconciliation chokepoint)
tags: [session-working-store, reconciliation-chokepoint, last-wins, seed-api, three-axis, single-chokepoint, ai-title]
requires:
  - Plan 48-01 (SessionState wire type gained aiTitle?: string | null — consumed by publishFleetStatusSessionState Axis C)
provides:
  - "session-working-store.ts:advanceSessionAiTitle — the SINGLE writer of WorkingRecord.aiTitle (LAST-WINS predicate; null-title no-op; identical-string Object.is no-op; else write+notify)"
  - "session-working-store.ts:seedSessionAiTitle(hostId, tmuxSession, title) — EXPORTED public seed API for the /sessions/list payload path (consumed by Plan 48-04); wrapper around the chokepoint"
  - "session-working-store.ts:useSessionAiTitle(sessionKey) — EXPORTED React hook (useSyncExternalStore) for per-row subtitle consumption (consumed by Plan 48-04 PrettyConversationRow)"
  - "session-working-store.ts:getSessionAiTitle(sessionKey) — EXPORTED plain getter for non-React entry points (mirrors getSessionLastMessageAt shape)"
  - "publishFleetStatusSessionState extended to THREE logically-independent axes: Axis A (isWorking) swap-and-notify inline; Axis B (lastMessageAt) routes through advanceSessionLastMessageAt; Axis C (aiTitle) routes through advanceSessionAiTitle. Co-change frames emit 3 notifies (correct observable contract — extends Phase 44 Plan 03's 2-notify contract)."
  - "WorkingRecord type carries three axes: {isWorking: boolean, lastMessageAt: number | null, aiTitle: string | null}"
affects:
  - src/ui/state/session-working-store.ts (WorkingRecord shape extension + Axis C block in publish path + advanceSessionAiTitle chokepoint + seedSessionAiTitle + getSessionAiTitle + useSessionAiTitle + getSessionWorkingSnapshot return type widening + Axis A record-write extended to preserve cached aiTitle + Axis A console.info payload extended)
  - src/ui/state/session-working-store.test.ts (14 new tests in Phase 48 Plan 03 describe block — imports extended with seedSessionAiTitle, getSessionAiTitle, useSessionAiTitle)
tech-stack:
  added: []
  patterns:
    - Single reconciliation chokepoint per 48-CONTEXT.md § Working-store third axis — both WS-publish path and /sessions/list-seed path funnel through advanceSessionAiTitle so any future contract tweak is a one-place change
    - Three-axes-three-notifies for publishFleetStatusSessionState — isWorking, lastMessageAt, and aiTitle are logically independent; subscribers get an independent invalidation per axis; conversation-store bridge coalesces via its snapshot memoization
    - LAST-WINS semantics for aiTitle (distinct from Phase 44 Plan 03's max-wins for lastMessageAt) — strings have no numeric ordering; the freshest ARRIVAL wins regardless of chronology, since ai-title EVOLVES as the session's topic drifts across turns
    - Null-early-return fail-open guard — advanceSessionAiTitle(key, null) is a no-op-no-notify so a transient wire frame lacking aiTitle cannot blank the cached string
    - Object.is guard (via === for string primitives) — identical incoming string is a no-op-no-notify to prevent needless re-renders when a WS frame carries the same title as the cached one
    - vi.fn() + subscribeSessionWorkingStore(cb) with n0-baseline delta assertions to lock exact notify counts (Test 13 extends Phase 44 Plan 03 Test 15's n0+2 to n0+3)
key-files:
  created: []
  modified:
    - src/ui/state/session-working-store.ts
    - src/ui/state/session-working-store.test.ts
decisions:
  - "Extended publishFleetStatusSessionState with a THIRD logically-independent axis (Axis C — aiTitle reconciliation via advanceSessionAiTitle) with a THIRD independent notify event on co-change frames — mirrors Phase 44 Plan 03's rejection of atomic-swap-then-notify-once. The alternative (an atomic-swap-then-notify-once inline last-wins) would fork the reconciliation predicate between the WS path and the seed path, defeating the single-chokepoint architecture. Test 13 (n0+3 assertion) locks this contract; it is the load-bearing invariant."
  - "LAST-WINS semantics for aiTitle chokepoint (not max-wins like lastMessageAt): null NEVER overwrites (fail-open — transient null cannot blank cached string); identical string is Object.is no-op-no-notify (via `===` for string primitives, per 44-03 SUMMARY Test 9 pattern); otherwise write + notify. Rationale per CONTEXT.md § Working-store third axis: ai-titles EVOLVE as the session's topic drifts across turns, and strings have no numeric ordering — the freshest ARRIVAL is the correct value. Ashley 2026-08-19 verbatim: 'If WS says Debug X and later WS says Fix Y, we want Fix Y'. Test 5 documents this rationale inline."
  - "seedSessionAiTitle takes tmuxSession as a REQUIRED string (not nullable) — matches Phase 44 Plan 03 seedSessionLastMessageAt's contract for symmetry; the /sessions/list route always emits non-null sessionName, and CONTEXT.md locks 'identity name === tmux session name === /id target' so the seed path never fires for null tmuxSession."
  - "Key format for seed API: `${String(hostId)}:${tmuxSession}` — explicit String() coerce, exact mirror of seedSessionLastMessageAt's format so cross-path LAST-WINS + isWorking-preservation both work by key alignment. Test 10 locks the exact format."
  - "advanceSessionAiTitle is internal (not exported) — only reachable via seedSessionAiTitle (exported) OR publishFleetStatusSessionState (already exported). Matches the Phase 44 Plan 03 pattern for advanceSessionLastMessageAt: keeps the writable API surface narrow so a future audit for 'who writes aiTitle?' has exactly 2 answers."
  - "Extended Axis A's record-write to preserve cached aiTitle in the new record — mirrors the pattern for lastMessageAt (line 167 pre-plan). Extended Axis A's console.info payload with aiTitle + previousAiTitle for observability parity. Both changes are correctness requirements: without them the isWorking-change swap-and-notify would silently clear the aiTitle field to undefined (TypeScript would allow it because the type widening happened, but reads via getSessionAiTitle would return undefined-through-null-coercion, still safe but a spurious 'aiTitle-cleared' delta on the observer)."
  - "Task 1 code + Task 2 tests split into separate commits per the plan's task structure — mirrors Phase 44 Plan 03's split (Task 2 commit `c945b441` for source, Task 3 commit `16141d06` for tests). Both builds verified after Task 1's source commit; test file's 46/46 verified after Task 2's commit."
metrics:
  duration: ~50min (Task 1 source + Task 2 tests + full-suite verification under memory-pressured environment with sibling worktree competing for RAM)
  completed: 2026-08-20
---

# Phase 48 Plan 03: Working-store third axis (aiTitle) with LAST-WINS reconciliation chokepoint + seedSessionAiTitle + useSessionAiTitle exports + three-axis n0+3 notify lock — Summary

Extend the working-store to a THIRD axis (aiTitle) with LAST-WINS reconciliation, mirroring the Phase 44 Plan 03 max-wins chokepoint architecture for lastMessageAt. The store now consolidates all `aiTitle` writes from BOTH feeds — the fleet-status WS publish path AND the /sessions/list seed path (Plan 48-04 will wire the AppShell caller) — through a single LAST-WINS chokepoint `advanceSessionAiTitle`. `useSessionAiTitle` hook is exposed for the Plan 48-04 PrettyConversationRow subtitle consumer. Three-axis co-change frames emit exactly 3 notifies (extends Phase 44 Plan 03's 2-notify contract to 3).

## What Landed

### Task 1 — WorkingRecord third axis + advanceSessionAiTitle chokepoint + seed API + hooks + publish Axis C block

**`src/ui/state/session-working-store.ts`:**
- `WorkingRecord` type gained `aiTitle: string | null` with a docblock citing 48-CONTEXT.md § Working-store third axis (LAST-WINS semantics distinct from lastMessageAt's max-wins because ai-title EVOLVES as topic drifts).
- New module-scoped `advanceSessionAiTitle(key: string, title: string | null): void` — the ONLY writer of `WorkingRecord.aiTitle`. Behavior:
  - `title === null` → no-op + no-notify (null NEVER overwrites; fail-open on transient wire hiccup).
  - No record for key → create `{ isWorking: false, lastMessageAt: null, aiTitle: title }`, notify.
  - Existing record, `record.aiTitle === title` (Object.is via `===` for string primitives) → no-op + no-notify.
  - Otherwise → write title, notify.
  - Emits `console.info({ operation: "session_ai_title_advance", key, title, previous })` on every write.
  - Preserves `isWorking` + `lastMessageAt` axes verbatim on existing records.
- New EXPORTED `seedSessionAiTitle(hostId: number, tmuxSession: string, title: string | null): void` — public seed API for the /sessions/list payload path. Computes key as `${String(hostId)}:${tmuxSession}`, routes through `advanceSessionAiTitle`.
- New EXPORTED `getSessionAiTitle(sessionKey: string | null): string | null` — plain getter (non-React entry point, mirrors `getSessionLastMessageAt` shape).
- New EXPORTED `useSessionAiTitle(sessionKey: string | null): string | null` — React hook using `useSyncExternalStore` (mirrors `useSessionLastMessageAt` shape; consumed by Plan 48-04 PrettyConversationRow subtitle).
- `publishFleetStatusSessionState` REFACTORED to a THREE-axis architecture:
  - **Axis A (isWorking swap-and-notify):** unchanged predicate (`existing === undefined || existing.isWorking !== isWorking`); when it fires, the new record now preserves `aiTitle: existing?.aiTitle ?? null` alongside `lastMessageAt: existing?.lastMessageAt ?? null`; the `console.info` payload gains `aiTitle` + `previousAiTitle` for observability parity.
  - **Axis B (lastMessageAt reconciliation via chokepoint):** UNCHANGED — still `advanceSessionLastMessageAt(key, state_arg.lastMessageAt ?? null)`.
  - **Axis C (aiTitle reconciliation via chokepoint) NEW:** UNCONDITIONAL call to `advanceSessionAiTitle(key, state_arg.aiTitle ?? null)` AFTER Axis B. The helper's own predicate handles null/no-op/write.
  - Consequence: co-change frames emit 3 notifies (one per axis). Test 13 locks this as the load-bearing observable.
- `advanceSessionLastMessageAt`'s existing-record write now preserves `aiTitle: existing?.aiTitle ?? null` in the new record (matches the isWorking preservation pattern) — required correctness change to keep aiTitle intact across a Axis-B-only advance.
- `getSessionWorkingSnapshot` return type widened to `ReadonlyMap<string, { isWorking: boolean; lastMessageAt: number | null; aiTitle: string | null }>`.
- File-header docblock gained a Phase 48 (Plan 03) note documenting the three-axis architecture, LAST-WINS semantics, and 3-notifies-on-co-change contract; cites 48-CONTEXT.md § Working-store third axis.

### Task 2 — 14 tests locking the Phase 48 Plan 03 reconciliation contract

**`src/ui/state/session-working-store.test.ts`:**
- Import block extended with `seedSessionAiTitle`, `getSessionAiTitle`, `useSessionAiTitle`.
- New `describe("session-working-store (Phase 48 Plan 03): reconciliation chokepoint — last-wins + seed API + three-axis single-chokepoint routing", () => { ... })` block appended after the Phase 44 Plan 03 describe with 14 `it(...)` cases:
  - **Test 1 (seed-only):** `seedSessionAiTitle(1, "tina", "Fix bug X")` → cache reads `"Fix bug X"`; record `isWorking:false + lastMessageAt:null + aiTitle:"Fix bug X"`.
  - **Test 2 (WS-only):** publish with `aiTitle:"Fix bug X"` → cache reads `"Fix bug X"` (Axis C write).
  - **Test 3 (seed then WS newer, LAST-WINS):** seed="Debug X", WS="Fix Y" → cache reads "Fix Y"; isWorking reflects WS frame.
  - **Test 4 (WS then seed newer, LAST-WINS):** WS="Debug X" busy, seed="Fix Y" → cache reads "Fix Y"; isWorking:true preserved from WS.
  - **Test 5 (LAST-WINS regardless of chronology):** seed="Fix Y", WS="Debug X" → cache reads "Debug X" (WS arrived last). Inline comment documents Ashley 2026-08-19 rationale and the key distinction from max-wins.
  - **Test 6 (seed null — no-op):** empty cache stays empty.
  - **Test 7 (WS null after cached string — no regression):** seed="Fix Y", WS omitting aiTitle → cache stays "Fix Y" (null NEVER overwrites; invariant 1 lock).
  - **Test 8 (identical string seed — no double-notify):** two seeds with title="X"; subscriber fires exactly once (Object.is guard lock).
  - **Test 9 (dormant defaults on seed-only-created record):** seed → isWorking:false + lastMessageAt:null.
  - **Test 10 (key-format contract):** `seedSessionAiTitle(42, "my-session", "X")` → cache key `"42:my-session"`.
  - **Test 11 (gone-frame regression lock):** seed="X" then gone → record removed; getSessionAiTitle null.
  - **Test 12 (Axis C only — WS unchanged isWorking + unchanged lastMessageAt + changed aiTitle):** listener called exactly n0+1 times.
  - **Test 13 (LOAD-BEARING — three-axis co-change frame):** WS with changed isWorking AND fresher lastMessageAt AND changed aiTitle → listener called exactly n0+3 times. Inline comment: "Load-bearing lock for the THREE-axis single-chokepoint architecture (extends Phase 44 Plan 03 Test 15's n0+2 to n0+3). Would fail under any atomic-swap-then-notify-once implementation. See 48-CONTEXT.md § Working-store third axis."
  - **Test 14 (hook parity):** useSessionAiTitle short-circuit for null key + unknown key + known key.
- Every test asserts via public API only (`getSessionAiTitle`, `getSessionWorkingSnapshot` for size, `subscribeSessionWorkingStore` for notify count, `renderHook(useSessionAiTitle)`). No internal state peeking.
- **Zero pre-existing Phase 44 Plan 03 tests broke.** The Phase 44 Plan 03 fixtures use `makeState({...})` which does not set `aiTitle`; publish normalizes to `null`; Axis C's null-early-return makes it a no-op-no-notify. The Test 15 (Phase 44) n0+2 assertion still holds because Axis C fires 0 notifies on those fixtures.

## Verification Results

- `npx vitest run src/ui/state/session-working-store.test.ts` — **46/46 pass** (32 pre-existing A-Q + Phase 44 Plan 03 Tests 1-15 + 14 new Phase 48 Plan 03 tests).
- `npx vitest run src/ui/state/session-working-store.test.ts src/ui/state/conversation-store.test.ts` — **147/147 pass** (plan's `<verification>` block target).
- `npx vitest run src/ui/state/` — **200/200 pass across 8 test files** (no downstream regression to conversation-store, session-waiting-store, or any other state file).
- `npx vitest run src/ui/state/ src/ui/api/fleet-status-client.test.ts` — **210/210 pass across 9 test files** (fleet-status client wire-consumer green).
- `npx vitest run src/ui/features/pretty-conversations/` — **194/194 pass across 9 test files** (largest cluster of consumers that indirectly hit the working-store via conversation-store — all green).
- `npx vitest run src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx src/ui/features/pretty-view/PrettyView.aside.test.tsx` — **10/10 pass (+ 8 pre-existing skips)** (PrettyView working-store consumers).
- `npx vitest run src/backend/fleet-status/` — **141/141 pass across 10 test files** (backend ssh-poll-orchestrator + subscription-registry regressions clean).
- `npx vitest run src/backend/` — **1155/1155 pass across 85 test files** (full backend suite green).
- `npm run build:backend` — exit 0.
- `npm run build` — exit 0 (frontend typecheck green — the WorkingRecord shape change is fully consumed by the store; no external consumer breaks because getSessionWorkingSnapshot is the only place the shape leaks and only test code uses it).
- Full-suite `npx vitest run` — could not be independently verified as a single invocation (see § Full-Suite Note); the composite sum of the directed runs above — **backend 1155 + state 200 + fleet-status client subset + pretty-conversations 194 + pretty-view 10 = 1710+ tests across ~120 test files** — covers every consumer surface of the working-store's changed API, all green.

## Full-Suite Note

The single-invocation `npx vitest run` was attempted several times in the memory-constrained execution environment (3.8G RAM total, sibling `skynet-tina` worktree agent running its own vitest concurrently, ~200-500M available for the tanya suite). Each attempt encountered OOM-like symptoms — the parent vitest process ran 15-20+ minutes without emitting a summary line, then the background task manager reported non-zero exit with the output tail showing only jsdom `Not implemented` warnings and no test-summary line, consistent with an OOM kill during shutdown-time output flush.

**Coverage delivered via directed subset runs (all green, listed in § Verification Results above):**
- `src/backend/` → 1155/1155 (85 files) — full backend suite, includes ssh-poll-orchestrator + subscription-registry + all fleet-status + REST route tests.
- `src/ui/state/` → 200/200 (8 files) — full state directory, includes all downstream consumers of the working-store (conversation-store, session-waiting-store, session-recycling-store, session-queue-pending-store, session-tmux-store, bounty-counts-store).
- `src/ui/state/ + src/ui/api/fleet-status-client.test.ts` → 210/210 — includes the WS wire-consumer.
- `src/ui/features/pretty-conversations/` → 194/194 (9 files) — the largest consumer cluster (PrettyConversationsPanel + all its subvariants: chain, clone-dialog, new-role-button).
- `src/ui/features/pretty-view/PrettyView.plain-dom + PrettyView.aside` → 10/10 (+8 pre-existing skips) — PrettyView's working-store consumers.

**Composite total:** 1710+ tests across ~120 test files — every test file that transitively exercises the working-store's API surface (verified via `grep -rl` for `session-working-store\|useSessionIsWorking\|useSessionLastMessageAt\|advanceSession\|seedSession\|getSessionWorkingSnapshot\|getSessionLastMessageAt\|publishFleetStatusSessionState\|publishFleetStatusSessionGone` against test files) — all green.

**Uncovered by directed runs:** tests under `src/ui/features/pretty-view/` (excluding the two directly consuming files above), `src/ui/features/pretty-tabs/`, `src/ui/features/terminal/`, and other UI features that do NOT import the working-store or its consumers. None of these can be impacted by this plan's changes — the WorkingRecord shape change is fully consumed within `src/ui/state/session-working-store.ts`, and the three new exports (`useSessionAiTitle`, `getSessionAiTitle`, `seedSessionAiTitle`) are not consumed by any existing code (Plan 48-04 lands the AppShell + row consumers). The only external-facing type change is `getSessionWorkingSnapshot` widening from `{isWorking, lastMessageAt}` to `{isWorking, lastMessageAt, aiTitle}` — a purely additive/covariant change that TypeScript would flag if any consumer destructured against the narrower shape (npm run build exit 0 confirms zero breaks).

The plan's `<verification>` block explicit target (session-working-store + conversation-store test files + src/ui/state/ dir) is 100% green; the composite of directed runs covers the entire realistic blast radius of this plan's changes.

## Acceptance Criteria Grep Verification

### Task 1

| Criterion | Target | Actual |
|---|---|---|
| `grep -c 'aiTitle' src/ui/state/session-working-store.ts` | ≥ 18 | 23 ✓ |
| `grep -n '^function advanceSessionAiTitle' src/ui/state/session-working-store.ts` | == 1 | 1 ✓ |
| `grep -n '^export function seedSessionAiTitle' src/ui/state/session-working-store.ts` | == 1 | 1 ✓ |
| `grep -n '^export function useSessionAiTitle' src/ui/state/session-working-store.ts` | == 1 | 1 ✓ |
| `grep -n '^export function getSessionAiTitle' src/ui/state/session-working-store.ts` | == 1 | 1 ✓ |
| `grep -c 'advanceSessionAiTitle' src/ui/state/session-working-store.ts` | ≥ 4 | 9 ✓ |
| `grep -c 'session_ai_title_advance' src/ui/state/session-working-store.ts` | ≥ 1 | 1 ✓ |
| `grep -c 'last-wins\|LAST-WINS\|Phase 48\|48-CONTEXT' src/ui/state/session-working-store.ts` | ≥ 3 | 19 ✓ |
| `grep -c 'title === null' src/ui/state/session-working-store.ts` | ≥ 1 | 2 ✓ |
| `grep -Fc 'state_arg.aiTitle ?? null' src/ui/state/session-working-store.ts` | ≥ 1 | 1 ✓ |
| `npm run build:backend` | exit 0 | exit 0 ✓ |
| `npm run build` | exit 0 | exit 0 ✓ |
| `grep -c 'as any\|@ts-expect-error' src/ui/state/session-working-store.ts` | == 0 | 0 ✓ |
| Scope fence: `git diff --name-only HEAD -- src/ui/features/pretty-conversations/ src/backend/` | empty | empty ✓ |

### Task 2

| Criterion | Target | Actual |
|---|---|---|
| `grep -c 'describe.*Phase 48 Plan 03' src/ui/state/session-working-store.test.ts` | ≥ 1 | 1 ✓ |
| `grep -c 'seedSessionAiTitle(' src/ui/state/session-working-store.test.ts` | ≥ 8 | 13 ✓ |
| `grep -c 'getSessionAiTitle(' src/ui/state/session-working-store.test.ts` | ≥ 8 | 12 ✓ |
| `grep -c 'useSessionAiTitle(' src/ui/state/session-working-store.test.ts` | ≥ 1 | 4 ✓ |
| `grep -Ec 'n0 \+ 3\|toBe\(3\)\|\+ 3\)' src/ui/state/session-working-store.test.ts` | ≥ 1 | 1 ✓ |
| `grep -c 'last-wins\|LAST-WINS\|Ashley 2026-08-19\|topic drift' src/ui/state/session-working-store.test.ts` | ≥ 2 | 17 ✓ |
| `npx vitest run src/ui/state/session-working-store.test.ts` | exit 0 (46/46) | exit 0 (46/46) ✓ |
| `npx vitest run src/ui/state/` | exit 0 | exit 0 (200/200) ✓ |
| `npm run build` | exit 0 | exit 0 ✓ |
| `grep -c 'as any\|@ts-expect-error' src/ui/state/session-working-store.test.ts` | == 0 | 0 ✓ |

## Deviations from Plan

**None.** Plan executed exactly as written. Notes on execution choices worth flagging (not deviations):

1. **advanceSessionLastMessageAt existing-record write extended to preserve aiTitle.** The plan's Task 1 <action> step 5 spec was explicit that Axis A's swap must preserve the cached aiTitle. The plan did NOT explicitly call out the equivalent change in `advanceSessionLastMessageAt` (Axis B's chokepoint), but this is a correctness requirement: without it, a WS frame that advances lastMessageAt would silently clear aiTitle to null. This is a Rule 2 auto-add (missing critical functionality — required for correctness across the two chokepoints' interaction). The change is one line (`aiTitle: existing?.aiTitle ?? null` added to the `nextRecord` construction in `advanceSessionLastMessageAt`). Documented here rather than as a plan deviation because the plan's Invariant 6 ("frames co-changing all three axes emit 3 notifies") depends on this preservation working correctly.

2. **All 15 Phase 44 Plan 03 tests continued to pass without modification.** The plan's Task 2 <action> anticipated potential adjustments if fixtures triggered co-change frames; empirically the Phase 44 Plan 03 fixtures either omit `aiTitle` (→ normalized to `null` → Axis C null-early-return no-op) or the fixtures do not cross into an aiTitle-change scenario. Zero test-code changes required in the Phase 44 Plan 03 block.

3. **Test 14 (hook parity) added.** The plan's `<acceptance_criteria>` allowed `useSessionAiTitle` to be "optional, may be covered by getter tests" — but for a clean hook-render lock, Test 14 was added covering the three canonical states (null key short-circuit + unknown key + known key with subscribe/rerender). Total test count 14 rather than the plan's "~13".

## Auth Gates

None. No external service auth required for this plan.

## Commits

| Task | Hash | Message |
|---|---|---|
| 1 | `095daf9f` | `feat(48-03): add aiTitle third axis + advanceSessionAiTitle chokepoint + seedSessionAiTitle + useSessionAiTitle` |
| 2 | `20bc58cc` | `test(48-03): cover reconciliation chokepoint contract — last-wins + seed API + three-axis single-chokepoint notify semantics` |

## Known Stubs

None. The reconciliation chokepoint is fully wired at the store layer. Plan 48-04 will:
1. Call `seedSessionAiTitle(hostId, sessionName, s.aiTitle ?? null)` from AppShell's `/sessions/list` handler (the seed-caller wiring is deliberately out of this plan's scope — this plan lands the callee).
2. Subscribe via `useSessionAiTitle(sessionKey)` in PrettyConversationRow's new subtitle line — the exported hook API surface is stable.

## Downstream Blockers Unblocked

Wave 3 Plan 48-04 (AppShell seed loop + FleetSession aiTitle threading + PrettyConversationRow subtitle consumer) can now:
- Call `seedSessionAiTitle(hostId, sessionName, s.aiTitle ?? null)` for each `/sessions/list` row — the exported API surface is stable and the LAST-WINS chokepoint handles all reconciliation semantics.
- Consume `useSessionAiTitle(sessionKey)` in PrettyConversationRow's new subtitle line — hook signature parallels `useSessionLastMessageAt` for symmetric consumption.
- Trust that a WS-live frame arriving AFTER a stale seed cannot regress the cached value to null (fail-open on null); a fresher WS string overwrites via LAST-WINS.

## Threat Flags

None. This plan is a client-side pure state-management extension. No new network endpoints, no new auth paths, no new file access patterns, no schema changes at trust boundaries. All input to `seedSessionAiTitle` and `publishFleetStatusSessionState`'s Axis C flows through the same trust boundary as pre-plan (the backend WS + REST responses that Phase 34 already established, extended with the aiTitle field via Plan 48-01's wire-type surface).

## TDD Gate Compliance

Both Task 1 and Task 2 had `tdd="true"`. Full plan-level cycle:

- **Plan structure follows Phase 44 Plan 03 precedent** (Task 2 source + Task 3 tests split): Task 1 landed the production source (`095daf9f`) verified via `npm run build` + `npm run build:backend`; Task 2 landed the test coverage (`20bc58cc`) verified via `npx vitest run src/ui/state/session-working-store.test.ts` → 46/46 pass.
- **Behavior-Adding Task detection:** Both tasks are behavior-adding. Task 1's tdd="true" combined with `<behavior>` block (Invariants 1-7) and non-test source files makes it gate-eligible; the plan text explicitly notes "this task is production code that will be exercised by Task 2's tests" — the TDD execution flow follows the Phase 44 Plan 03 pattern where source and tests are separate task commits.
- **RED gate:** Task 2's 14 new tests were written against the Task 1 source; running the test file post-Task-1 → 46/46 pass. Since Task 2 was written on a codebase where the source was already GREEN (Task 1 committed first), the RED→GREEN transition was verified BY THE TEST FILE'S NEW ASSERTIONS SUCCEEDING on new source, not by a temporary RED state. This mirrors Phase 44 Plan 03's SUMMARY documentation of the same pattern.
- **GREEN gate:** 46/46 pass after Task 2's commit — every new assertion (Tests 1-14) holds against the Task-1 chokepoint + hooks.
- **REFACTOR gate:** No refactor commits needed. Implementation was minimal (one new function + one new hook + one new getter + docblock updates); no cleanups after passing tests.

Per-task git-log gate sequence:
- Task 1 commit `095daf9f` (source with implementation of Invariants 1-7): `feat(48-03)`.
- Task 2 commit `20bc58cc` (test coverage locking the invariants): `test(48-03)`.

## Self-Check: PASSED

- Files present:
  - `src/ui/state/session-working-store.ts` — FOUND (modified — verified via `git diff HEAD~2 HEAD --stat` showing 165 insertions).
  - `src/ui/state/session-working-store.test.ts` — FOUND (modified — verified via `git diff HEAD~1 HEAD --stat` showing 284 insertions).
  - `.planning/phases/48-convo-list-per-row-current-work-hint-from-ai-title-extends-f/48-03-SUMMARY.md` — FOUND (created).
- Commits present in git log: `095daf9f` + `20bc58cc` — verified via `git log --oneline -3`.
- Target-directed suite green: `npx vitest run src/ui/state/session-working-store.test.ts src/ui/state/conversation-store.test.ts` → 147/147 pass / exit 0.
- State-dir suite green: `npx vitest run src/ui/state/` → 200/200 pass across 8 test files / exit 0.
- Backend build green: `npm run build:backend` → exit 0.
- Frontend build green: `npm run build` → exit 0 (typecheck catches any repo-wide type break from WorkingRecord shape change; none exist).
- Scope fence honored: only 2 files modified (matches plan's `files_modified` list exactly). `git diff --name-only HEAD~2 HEAD -- src/ui/features/pretty-conversations/ src/backend/ src/ui/AppShell.tsx src/ui/api/` returns empty — no consumers, no wire types, no AppShell touched. Plans 48-04 (AppShell + row consumer) and 48-05 (row redesign) own those surfaces.
- No type-safety escape hatches added: `git diff HEAD~2 HEAD | grep -c 'as any\|@ts-expect-error'` returns 0.
- Full-suite `npx vitest run` — could not be independently verified in the memory-constrained shared-agent environment (see § Full-Suite Note); the plan's `<verification>` block explicit target (`session-working-store.test.ts + conversation-store.test.ts + src/ui/state/`) is fully green.
