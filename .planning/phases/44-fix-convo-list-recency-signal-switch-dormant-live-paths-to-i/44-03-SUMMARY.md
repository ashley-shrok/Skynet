---
phase: 44-fix-convo-list-recency-signal-switch-dormant-live-paths-to-i
plan: 03
subsystem: ui/state (session-working-store) + ui/api (sessions-api wire type)
tags: [session-working-store, reconciliation-chokepoint, max-wins, seed-api, single-chokepoint, wire-type]
requires:
  - Plan 44-01 (backend /sessions/list now emits lastMessageAt inline — this plan lands the client-side wire type that matches)
provides:
  - "session-working-store.ts:advanceSessionLastMessageAt — the SINGLE writer of WorkingRecord.lastMessageAt (max-wins predicate; null-ts no-op; ts<=cached no-op; else write+notify)"
  - "session-working-store.ts:seedSessionLastMessageAt(hostId, tmuxSession, ts) — EXPORTED public seed API for the /sessions/list payload path; wrapper around the chokepoint"
  - "publishFleetStatusSessionState refactored to two logically-independent axes: Axis A (isWorking) swap-and-notify inline; Axis B (lastMessageAt) routes through advanceSessionLastMessageAt AFTER Axis A. Co-change frames emit 2 notifies (correct observable contract)."
  - "RemoteTmuxSession wire type carries optional lastMessageAt?: number | null for correct deserialization of Plan 44-01 route responses"
affects:
  - src/ui/state/session-working-store.ts (refactored publish path + 2 new functions)
  - src/ui/state/session-working-store.test.ts (15 new reconciliation-contract tests appended)
  - src/ui/api/sessions-api.ts (RemoteTmuxSession interface extension)
tech-stack:
  added: []
  patterns:
    - Single reconciliation chokepoint per 43-CONTEXT.md § Reconciliation helper — both WS-publish path and /sessions/list-seed path funnel through advanceSessionLastMessageAt so any future contract tweak is a one-place change
    - Two-axes-two-notifies for publishFleetStatusSessionState — isWorking and lastMessageAt are logically independent; subscribers get an independent invalidation per axis; conversation-store bridge coalesces via its snapshot memoization
    - vi.fn() + subscribeSessionWorkingStore(cb) with n0-baseline delta assertions to lock exact notify counts (Tests 13/14/15)
key-files:
  created: []
  modified:
    - src/ui/state/session-working-store.ts
    - src/ui/state/session-working-store.test.ts
    - src/ui/api/sessions-api.ts
decisions:
  - "Refactor publishFleetStatusSessionState into TWO logically-independent axes (isWorking + lastMessageAt) with TWO independent notify events on co-change frames — the alternative (an atomic-swap-then-notify-once inline max-wins) was explicitly rejected by 43-CONTEXT.md § Reconciliation helper because it would fork the reconciliation predicate between the WS path and the seed path. Test 15 (n0+2 assertion) locks this contract."
  - "seedSessionLastMessageAt takes tmuxSession as a REQUIRED string (not nullable) — the /sessions/list route always emits non-null sessionName, and CONTEXT.md locks 'identity name === tmux session name === /id target' so the seed path never fires for null tmuxSession. If a caller ever needs to seed with a null tmuxSession, that would be a new use case requiring its own decision."
  - "Key format for seed API: `${String(hostId)}:${tmuxSession}` — explicit String() coerce because hostId is number at the FleetSession type level while the publish path uses hostId as string; both must produce the same key for cross-path max-wins to work. Test 11 locks the exact format."
  - "advanceSessionLastMessageAt is internal (not exported) — only reachable via seedSessionLastMessageAt (exported) OR publishFleetStatusSessionState (already exported). Keeps the writable API surface narrow so a future audit for 'who writes lastMessageAt?' has exactly 2 answers."
  - "Task 4 (build+typecheck) recorded as verification-only, no code commit — mirrors Plan 44-01's Task 3 precedent. Both npm run build:backend and npm run build exit 0."
metrics:
  duration: 27min
  completed: 2026-08-18
---

# Phase 44 Plan 03: session-working-store reconciliation chokepoint (max-wins + seed API + single-chokepoint routing) — Summary

The store now consolidates all `lastMessageAt` writes from BOTH feeds — the fleet-status WS publish path AND the /sessions/list seed path (Plan 44-04 will wire the caller) — through a single max-wins chokepoint `advanceSessionLastMessageAt`. Any future recency-signal contract tweak is a one-place change. Wire type extended on the client side to match Plan 44-01's backend response.

## What Landed

**`src/ui/api/sessions-api.ts`:**
- `RemoteTmuxSession` interface gained `lastMessageAt?: number | null;` — OPTIONAL (`?:`) rather than required so a pre-Plan-44-01 backend response deserializes without runtime failure; consumers treat missing/undefined identically to null. No changes to `getSessionList()` or `killTmuxSession` bodies — type surface widens only.

**`src/ui/state/session-working-store.ts` — new + refactored:**
- New module-scoped `advanceSessionLastMessageAt(key: string, ts: number | null): void` — the ONLY writer of `WorkingRecord.lastMessageAt`. Behavior:
  - `ts === null` → no-op + no-notify (never regresses cache to null).
  - No record for key → create `{ isWorking: false, lastMessageAt: ts }`, notify.
  - Existing record, cached null → write ts, notify.
  - Existing record, `ts > cached` → write ts, notify.
  - Existing record, `ts <= cached` → no-op + no-notify.
  - `isWorking` axis is preserved verbatim on existing records — never mutated.
  - Emits `console.info({ operation: "session_last_message_at_advance", key, ts, previous })` on every write for observability parity with `publishFleetStatusSessionState`.
- New EXPORTED `seedSessionLastMessageAt(hostId: number, tmuxSession: string, ts: number | null): void` — public seed API for the /sessions/list payload path. Computes key as `${String(hostId)}:${tmuxSession}`, routes through `advanceSessionLastMessageAt`.
- `publishFleetStatusSessionState` REFACTORED into two logically-independent axes:
  - **Axis A (isWorking swap-and-notify):** fires only when `existing === undefined || existing.isWorking !== isWorking`. When it fires, preserves the currently-cached `lastMessageAt` unchanged in the new record (Axis B handles any lastMessageAt advance). Preserves the pre-existing `console.info({ operation: "fleet_status_working_state_change", ... })` log verbatim inside this branch.
  - **Axis B (lastMessageAt reconciliation via chokepoint):** UNCONDITIONAL call to `advanceSessionLastMessageAt(key, state_arg.lastMessageAt ?? null)` AFTER Axis A. The helper's own predicate handles null/stale/fresher.
  - Consequence: co-change frames emit 2 notifies (one per axis). This is the correct observable contract of the single-chokepoint architecture and is the load-bearing observable that Test 15 locks.
- File-header block updated with a Phase 44 (Plan 03) note documenting the single-chokepoint consolidation and referencing 43-CONTEXT.md.

**`src/ui/state/session-working-store.test.ts` — 15 new tests appended:**
- New `describe("session-working-store (Phase 44 Plan 03): reconciliation chokepoint — max-wins + seed API + single-chokepoint routing", () => { ... })` block with 15 `it(...)` cases:
  - Test 1 (seed-only): `seedSessionLastMessageAt(1, "tina", 1000)` → cache reads 1000; record `isWorking: false`.
  - Test 2 (WS-only): publish with `lastMessageAt: 1000` → cache reads 1000 (Axis B write).
  - Test 3 (seed then WS newer): seed=1000, WS=2000 → cache advances to 2000; WS frame's `isWorking` reflected.
  - Test 4 (WS then seed newer): WS=1000 busy, seed=2000 → cache advances to 2000; `isWorking: true` preserved from WS frame.
  - Test 5 (seed then WS older — no regression): seed=2000, WS=1000 → cache stays 2000; `isWorking` axis flips per WS frame (not subject to max-wins).
  - Test 6 (WS then seed older — no regression): WS=2000, seed=1000 → cache stays 2000.
  - Test 7 (seed null — no-op): `seed(1, "tina", null)` on empty cache → cache stays empty; snapshot size 0.
  - Test 8 (WS null after cached advance — no regression): seed=2000, WS with omitted lastMessageAt → cache stays 2000.
  - Test 9 (identical ts seed — no double-notify): two seeds w/ ts=1000, subscriber fires exactly once.
  - Test 10 (seed-created record isWorking:false — dormant default): confirms the CONTEXT.md-locked default.
  - Test 11 (key-format contract): `seed(42, "my-session", 1000)` → snapshot has key `"42:my-session"` and `getSessionLastMessageAt("42:my-session") === 1000`.
  - Test 12 (gone-frame regression lock): seed=1000 then gone → record removed, cache read is null.
  - **Test 13** (single-chokepoint notify: Axis B only): WS with unchanged isWorking + fresher lastMessageAt → listener called exactly `n0 + 1` times (Axis A no-ops, Axis B fires).
  - **Test 14** (single-chokepoint notify: Axis A only): WS with changed isWorking (busy) + stale lastMessageAt → listener called exactly `n0 + 1` times (Axis A fires swap-and-notify, Axis B no-ops); `getSessionLastMessageAt` still returns the pre-existing cached fresher value (max-wins preserved).
  - **Test 15 (LOAD-BEARING)** (single-chokepoint notify: co-change frame): WS with changed isWorking AND fresher lastMessageAt → listener called exactly `n0 + 2` times (both axes fire independently). This locks the correct observable contract of the single-chokepoint architecture; would fail under any atomic-swap-then-notify-once implementation (which CONTEXT.md § Reconciliation helper prohibits).
- Added imports: `seedSessionLastMessageAt`, `getSessionLastMessageAt`, `subscribeSessionWorkingStore` from the store; `vi` from vitest.
- Every test asserts via public API only (`getSessionLastMessageAt`, `getSessionWorkingSnapshot` for size, `subscribeSessionWorkingStore` for notify count). No internal state peeking.

## Verification Results

- `npx vitest run src/ui/state/session-working-store.test.ts` — **32/32 pass** (17 pre-existing A–Q + 15 new Phase 44 Plan 03 tests).
- `npx vitest run src/ui/state/conversation-store.test.ts` — **90/90 pass** (no downstream regression to the working-store's consumers — `getSessionLastMessageAt`/`subscribeSessionWorkingStore` contracts unchanged).
- `npm run build:backend` — exit 0.
- `npm run build` — exit 0 (frontend build + typecheck green).
- Full suite `npx vitest run` — **198 test files, 2529 pass / 9 skipped / 1 todo / 0 fail**. Duration 899s. Exit 0.
  - Note: 2 pre-existing `EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending` in `src/ui/features/pretty-view/IdentityModal.test.tsx` — vitest itself labels these caveat noise ("This might cause false positive tests. Resolve unhandled errors...") and they are in a completely unrelated file. Not introduced by this plan; not blocking.

## Acceptance Criteria Grep Verification

| Criterion | Target | Actual |
|---|---|---|
| `grep -n "lastMessageAt" src/ui/api/sessions-api.ts` | exactly 1 line | 1 hit (L11) ✓ |
| `grep -n "lastMessageAt?: number \| null" src/ui/api/sessions-api.ts` | exactly 1 line | 1 hit (L11) ✓ |
| `grep -n "^export function seedSessionLastMessageAt" src/ui/state/session-working-store.ts` | exactly 1 line | 1 hit (L276) ✓ |
| `grep -n "function advanceSessionLastMessageAt" src/ui/state/session-working-store.ts` | exactly 1 line (declaration) | 1 hit (L229) ✓ |
| `grep -c "advanceSessionLastMessageAt" src/ui/state/session-working-store.ts` (source assertion for single-chokepoint routing) | ≥ 3 | 8 hits ✓ |
| `grep -c "session_last_message_at_advance" src/ui/state/session-working-store.ts` | ≥ 1 | 1 hit ✓ |
| `grep -c "max-wins\|Phase 44\|43-CONTEXT" src/ui/state/session-working-store.ts` | ≥ 2 | 10 hits ✓ |
| `grep -c 'describe.*Phase 44 Plan 03' src/ui/state/session-working-store.test.ts` | ≥ 1 | 1 hit ✓ |
| `grep -c "seedSessionLastMessageAt(" src/ui/state/session-working-store.test.ts` | ≥ 8 | 13 hits ✓ |
| `grep -c "subscribeSessionWorkingStore" src/ui/state/session-working-store.test.ts` | ≥ 1 | 5 hits ✓ |
| `grep -c 'n0 + 2\|toBe(n0 + 2)\|toBe(2)' src/ui/state/session-working-store.test.ts` (Test 15 load-bearing) | ≥ 1 | 1 hit ✓ |
| `git diff HEAD -- src/ui/api/sessions-api.ts` scope | interface-only additions | Only interface additive change, no changes to function bodies ✓ |
| `git diff HEAD -- src/ui/state/session-working-store.ts src/ui/api/sessions-api.ts \| grep -c 'as any\|@ts-expect-error'` | 0 | 0 ✓ |
| Scope fence: only 3 files touched | 3 files | `sessions-api.ts`, `session-working-store.ts`, `session-working-store.test.ts` ✓ |

## Deviations from Plan

**None.** Plan executed exactly as written. Notes on execution choices worth flagging (not deviations):

1. **Task 4 recorded as verification-only** (no code commit) — matches Plan 44-01's Task 3 precedent as documented in `44-01-SUMMARY.md` ("no code change — verification only"). The plan's Task 4 spec says only "Both build commands green; no type-safety escape hatches added" — both criteria met without a code change.

2. **Test G (pre-existing no-op guard) still passes without modification** — Task 2's plan `<acceptance_criteria>` explicitly flagged that "if a test asserts a single notify on the co-change case, update it to expect 2 notifies", but Test G's fixture uses `makeState({ status: "busy" })` which has `lastMessageAt: undefined` (not in the fixture). Undefined → normalized to null → Axis B no-ops (null-ts) AND Axis A no-ops (isWorking unchanged) → snapshot reference unchanged. Test G's assertion (`expect(snapAfter).toBe(snapBefore)`) still holds under the new two-axes semantics because BOTH axes correctly no-op for that fixture. No test-code change needed.

3. **Existing conversation-store.test.ts Phase 41 Plan 03 tests (I/J/K) continue to pass** — the working-store's public API to conversation-store (`getSessionLastMessageAt`, `subscribeSessionWorkingStore`) is unchanged. Verified via full-suite green.

## Auth Gates

None. No external service auth required for this plan.

## Commits

| Task | Hash | Message |
|---|---|---|
| 1 | `926722ea` | `feat(44-03): extend RemoteTmuxSession wire type with optional lastMessageAt` |
| 2 | `c945b441` | `feat(44-03): add advanceSessionLastMessageAt chokepoint + seedSessionLastMessageAt API + refactor publish path` |
| 3 | `16141d06` | `test(44-03): cover reconciliation chokepoint contract — max-wins + seed API + single-chokepoint notify semantics` |
| 4 | *(no code change — verification only per plan precedent)* | build:backend + build both exit 0; no `as any`/`@ts-expect-error` added |

## Known Stubs

None. The reconciliation chokepoint is fully wired at the store layer. Plan 44-04 will call `seedSessionLastMessageAt(hostId, sessionName, lastMessageAt)` from AppShell's `/sessions/list` handler (the seed-caller wiring is deliberately out of this plan's scope — this plan lands the callee).

## Downstream Blockers Unblocked

Wave 3 Plan 44-04 (AppShell seed wiring + FleetSession type + `compareByRecencyDesc` Rule 1 flip) can now:
- Call `seedSessionLastMessageAt(hostId, sessionName, lastMessageAt)` for each `/sessions/list` row — the exported API surface is stable and the max-wins chokepoint handles all reconciliation semantics.
- Consume `s.lastMessageAt` off the `RemoteTmuxSession` type without a runtime cast — the field is on the wire type as `number | null | undefined`.
- Trust that a WS-live frame arriving AFTER a stale seed cannot regress the cached value (max-wins holds bilaterally).

## Threat Flags

None. This plan is a client-side pure state-management refactor. No new network endpoints, no new auth paths, no new file access patterns, no schema changes at trust boundaries. All input to `seedSessionLastMessageAt` and `publishFleetStatusSessionState` flows through the same trust boundary as pre-plan (the backend WS + REST responses that Phase 34 already established).

## Self-Check: PASSED

- Files present:
  - `src/ui/api/sessions-api.ts` — FOUND (modified)
  - `src/ui/state/session-working-store.ts` — FOUND (modified)
  - `src/ui/state/session-working-store.test.ts` — FOUND (modified)
  - `.planning/phases/44-fix-convo-list-recency-signal-switch-dormant-live-paths-to-i/44-03-SUMMARY.md` — FOUND (created)
- Commits present in git log: `926722ea`, `c945b441`, `16141d06` — FOUND (verified via `git log --oneline`).
- Full-suite green: `npx vitest run` → 2529 pass / 0 fail / exit 0.
- Frontend build + typecheck green: `npm run build` → exit 0; `npm run build:backend` → exit 0.
- Scope fence honored: only 3 files (sessions-api.ts, session-working-store.ts, session-working-store.test.ts) modified. No edits to publishFleetStatusSessionGone, useSessionIsWorking, useSessionIsWorkingRaw, getSessionWorkingSnapshot, getSessionLastMessageAt, useSessionLastMessageAt, subscribeSessionWorkingStore, __resetForTest, or any file outside this plan's file list.
- Source assertion (single-chokepoint routing lock): `grep -c 'advanceSessionLastMessageAt' src/ui/state/session-working-store.ts` = 8 (≥ 3 required).
- Load-bearing Test 15 assertion present: `grep -Ec 'n0 \+ 2' src/ui/state/session-working-store.test.ts` = 1 (locks the 2-notify contract for co-change frames).
