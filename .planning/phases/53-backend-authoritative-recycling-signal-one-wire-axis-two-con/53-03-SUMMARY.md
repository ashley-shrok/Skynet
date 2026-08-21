---
phase: 53-backend-authoritative-recycling-signal-one-wire-axis-two-con
plan: "03"
subsystem: browser-state
tags:
  - recycling
  - working-store
  - session-state
  - store-retirement
dependency_graph:
  requires:
    - 53-01  # backend wire + poller publish recycling field
    - 53-02  # working-store Axis E + useSessionIsRecycling hook
  provides:
    - PrettyView SessionHoldingOverlay fed from backend-authoritative recycling axis
    - PrettyConversationsPanel row-spinner fed from backend-authoritative recycling axis
    - session-recycling-store retired and deleted
  affects:
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
    - src/ui/state/session-recycling-store.ts (DELETED)
    - src/ui/state/session-recycling-store.test.ts (DELETED)
    - src/ui/state/session-queue-pending-store.ts
    - src/ui/state/session-working-store.ts
tech_stack:
  added: []
  patterns:
    - useSessionIsRecycling(sessionWorkingKey) — backend-authoritative recycling axis
    - working-store Axis E subscription at row-level + overlay-level consumers
key_files:
  created: []
  modified:
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/PrettyView.phase29.test.tsx
    - src/ui/features/pretty-view/PrettyView.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
    - src/ui/state/session-queue-pending-store.ts
    - src/ui/state/session-working-store.ts
decisions:
  - "Phase 53 Plan 03: All three PrettyView recycling consumer sites (overlay + ComposeBox isHolding + ComposeBox recycleActive) sourced from the same isRecycling boolean per CONTEXT.md scope-lock"
  - "Simplified isRecycling={isRecycling === true} to isRecycling={isRecycling} in PrettyConversationsPanel since useSessionIsRecycling returns strict boolean"
  - "Test assertion grep counts accept references in tombstone comments as long as no live imports/calls exist"
metrics:
  duration_minutes: 17
  completed_date: "2026-08-21"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 9
  files_deleted: 2
---

# Phase 53 Plan 03: Consumer Swap + Store Retirement Summary

Both recycling-signal consumers swapped from the retired client-side session-recycling-store bridge to the backend-authoritative useSessionIsRecycling hook (working-store Axis E, Plan 53-02); the bridge store and its test are deleted.

## What Changed

### Task 1 — PrettyView.tsx consumer swap + test updates

**PrettyView.tsx changes:**

| Site | Before | After |
|------|--------|-------|
| Line 58 (import) | `import { publishSessionRecycling } from "@/state/session-recycling-store"` | REMOVED; import REMOVED |
| Lines 59-62 (import block) | `useSessionIsWorking, useSessionIsWorkingRaw` | + `useSessionIsRecycling` added |
| Line ~1075 (hook) | (absent) | `const isRecycling = useSessionIsRecycling(sessionWorkingKey);` added |
| Lines 2431-2441 (useEffect) | `useEffect(() => { publishSessionRecycling(key, renderedState === "holding"); }, [renderedState, hostId, tmuxSession])` | DELETED; replaced with Phase 53 Plan 03 tombstone comment |
| Line 2759 (overlay mount) | `{renderedState === "holding" && <SessionHoldingOverlay />}` | `{isRecycling && <SessionHoldingOverlay />}` |
| Line 3105 (ComposeBox) | `isHolding={renderedState === "holding"}` | `isHolding={isRecycling}` |
| Line 3109 (ComposeBox) | `recycleActive={renderedState === "holding"}` | `recycleActive={isRecycling}` |

**Deleted range:** The `publishSessionRecycling` useEffect block at lines 2415-2425 (11 lines total: 7-line block comment + 4-line useEffect) was replaced with a 5-line tombstone comment.

**PrettyView.phase29.test.tsx changes:**

*Old test (lines 219-223):*
```ts
it("PrettyView.tsx: publishes session-recycling on `renderedState === \"holding\"`...", () => {
  expect(pvSrc).toMatch(
    /publishSessionRecycling\([^)]*key[^)]*,\s*renderedState\s*===\s*"holding"\s*\)/,
  );
});
```

*New test (Phase 53 Plan 03 grep-gate):*
```ts
it("Phase 53 Plan 03: PrettyView consumes useSessionIsRecycling from the working-store (NOT the retired session-recycling-store bridge)", () => {
  expect(pvSrc).not.toMatch(/publishSessionRecycling\(/);
  expect(pvSrc).not.toMatch(/from ["']@\/state\/session-recycling-store["']/);
  expect(pvSrc).toMatch(/useSessionIsRecycling/);
  expect(pvSrc).toMatch(/\{isRecycling && <SessionHoldingOverlay/);
});
```

The overlay mount grep-gate at line 192 (`expect(pvSrc).toMatch(/renderedState === "holding"/)`) was removed from the overlay-gates test and replaced with a comment explaining Phase 53 moved this gate to `isRecycling`.

GROUP 3 Test B, GROUP 4 Test C, GROUP 7 Test F (B5 fix) all updated to seed `publishFleetStatusSessionState("1", { ..., recycling: true })` before asserting SessionHoldingOverlay mount, and `recycling: false` before unmount assertions. Import added: `publishFleetStatusSessionState, __resetForTest as resetWorkingStore` from `@/state/session-working-store`.

**PrettyView.test.tsx changes:**

*Test F fixture change:*
- Before: only fired `session_holding` + `pane_state:holding` WS frames
- After: same WS frames PLUS `await act(async () => { publishFleetStatusSessionState("1", { ..., recycling: true }); })` after the WS frames
- Test H updated with same seed pattern
- Fix B Test F1 updated: seed `recycling: true` for pre-condition, seed `recycling: false` after clear

Import added: `publishFleetStatusSessionState, __resetForTest as resetWorkingStore` from `@/state/session-working-store`.

### Task 2 — PrettyConversationsPanel swap + store deletion + docblock cleanup

**PrettyConversationsPanel.tsx swap (line 219):**
- Before: `const isRecycling = useSessionRecycling(sessionKey);` (from retired bridge)
- After: `const isRecycling = useSessionIsRecycling(sessionKey);` (from working-store Axis E)
- Line 102: `import { useSessionRecycling } from "@/state/session-recycling-store"` REMOVED
- `useSessionIsRecycling` added to working-store import block at lines 85-101
- Line 238: `isRecycling={isRecycling === true}` simplified to `isRecycling={isRecycling}` (strict boolean, coercion redundant)

**session-recycling-store.ts — DELETED (git rm):**
- Prior LOC: 140 lines
- Exports removed: `publishSessionRecycling`, `useSessionRecycling`, `getSessionRecyclingSnapshot`, `__resetForTest`
- Last callers: none (all consumers swapped in Task 1 + Task 2)

**session-recycling-store.test.ts — DELETED (git rm):**
- Prior LOC: ~240 lines
- Covered: publish/hook round-trip, null key, multiple keys, no-op guard, phase29 resolving→holding transition

**PrettyConversationsPanel.test.tsx mock additions:**
```ts
// New spy + map (added after mockIsDormantByKey / useSessionIsDormantSpy):
let mockIsRecyclingByKey: Map<string | null, boolean> = new Map();
const useSessionIsRecyclingSpy = vi.fn((sessionKey: string | null) => {
  if (sessionKey === null) return false;
  return mockIsRecyclingByKey.get(sessionKey) ?? false;
});

// vi.mock block addition:
useSessionIsRecycling: (sessionKey: string | null) => useSessionIsRecyclingSpy(sessionKey),

// mockWorkingSnapshot type extended:
// Before: Map<string, { isWorking: boolean; lastMessageAt: number | null; aiTitle: string | null; dormant: boolean }>
// After:  Map<string, { isWorking: boolean; lastMessageAt: number | null; aiTitle: string | null; dormant: boolean; recycling: boolean }>
```

**mockWorkingSnapshot record sites updated with `recycling: false` (4 total):**
- Line 3889: `{ isWorking: true, lastMessageAt: null, aiTitle: null, dormant: false, recycling: false }`
- Line 3908: `{ isWorking: false, lastMessageAt: null, aiTitle: null, dormant: true, recycling: false }`
- Line 3928: `{ isWorking: false, lastMessageAt: null, aiTitle: null, dormant: false, recycling: false }`
- Line 4032: `{ isWorking: false, lastMessageAt: null, aiTitle: null, dormant: false, recycling: false }`

**session-queue-pending-store.ts docblock cleanup:**

Lines cleaned (before → after):
- Line 24: `session-working-store / session-recycling-store). There is no "unknown"` → `session-working-store). There is no "unknown"`
- Line 34: `session-working-store and session-recycling-store — the three stores` → `session-working-store — the two stores`
- Line 44: `rationale as session-working-store / session-recycling-store: a re-mount` → `rationale as session-working-store: a re-mount`
- Header: Phase 53 Plan 03 tombstone paragraph added at top of docblock

**PrettyConversationsPanel.clone-dialog.test.tsx:**
- `useSessionIsRecycling: () => false` added to working-store mock
- Retired recycling bridge mock removed (that store no longer exists)

## Deviations from Plan

**1. [Rule 2 - Missing coverage] Fix B Tests F1 discovered as needing recycling seed**
- Found during: Task 1 (C2 grep of PrettyView.test.tsx)
- Issue: Test F1 (`session_holding_cleared` clears the overlay) asserted `[role="status"]` is visible before clearing; under Phase 53 the overlay doesn't mount without working-store seed
- Fix: Added `publishFleetStatusSessionState(..., recycling: true)` before pre-condition, `recycling: false` before unmount assertion
- Files modified: `src/ui/features/pretty-view/PrettyView.test.tsx`
- Commit: 6802afd2

**2. [Rule 3 - Blocking issue] clone-dialog test file missing useSessionIsRecycling stub**
- Found during: Task 2 (first Panel test run after panel swap)
- Issue: `PrettyConversationsPanel.clone-dialog.test.tsx` had its own `vi.mock("@/state/session-working-store")` without `useSessionIsRecycling`; threw TypeError on render
- Fix: Added `useSessionIsRecycling: () => false` to the working-store mock block; removed stale recycling bridge mock
- Files modified: `src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx`
- Commit: b9c492f3

**3. [Rule 1 - Bug] PrettyConversationRow.tsx docblock referenced retired hook name**
- Found during: Task 2 acceptance check (`grep -rcw "useSessionRecycling" src/`)
- Issue: A comment at line 257 in PrettyConversationRow.tsx mentioned `useSessionRecycling` (retired hook)
- Fix: Updated comment to reference `useSessionIsRecycling` (Phase 53 Plan 03)
- Files modified: `src/ui/features/pretty-conversations/PrettyConversationRow.tsx`
- Commit: b9c492f3

## Verification Results

```
npx vitest run (phase29 + main PrettyView + Panel suites): 149 passed | 1 skipped | 1 todo
npx tsc --noEmit: 0 errors
npm run build: exit 0 (clean, no dangling imports)
session-recycling-store.ts: DELETED
session-recycling-store.test.ts: DELETED
grep -c "publishSessionRecycling(" PrettyView.tsx: 0
grep -c "useSessionIsRecycling" PrettyView.tsx: 4 (import block mention × 2 + const declaration + comments)
grep -c "const isRecycling = useSessionIsRecycling(sessionWorkingKey)" PrettyView.tsx: 1
grep -c "{isRecycling && <SessionHoldingOverlay" PrettyView.tsx: 1
grep -c "isHolding={isRecycling}" PrettyView.tsx: 1
grep -c "recycleActive={isRecycling}" PrettyView.tsx: 1
grep -cw "useSessionRecycling" src/: 0
```

## Known Stubs

None. All recycling consumers now read from the backend-authoritative working-store axis.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Bug-Fix Confirmation

**UAT scenario:** Start `/id-reset` on identity X while PrettyView for identity X is NOT currently mounted (e.g., Ashley is viewing a different identity's panel and identity X's tab is closed).

**Before Phase 53 (broken):** The row spinner for identity X in the conversation list would NOT show the recycling indicator. The recycling state was only published to the client-side bridge store by PrettyView's `useEffect`, which only ran when PrettyView was mounted. An unmounted row was completely blind to its own session's recycling state.

**After Phase 53 Plan 03 (fixed):** The row spinner for identity X WILL show the recycling indicator. The `useSessionIsRecycling("X:sessionName")` hook in `PrettyConversationRowLive` reads from the working-store's Axis E, which is populated by the fleet-status WebSocket poller (Plan 53-01) every ~2 seconds regardless of what UI is mounted. The caretaker's `.recycled-at` sentinel file is present on the target host during the entire recycle window (minimum 8 seconds), guaranteeing at least 4 poll ticks of coverage. No PrettyView mounting required.

## Self-Check: PASSED

- [x] PrettyView.tsx modifications committed at 6802afd2
- [x] Panel modifications + store deletion committed at b9c492f3
- [x] session-recycling-store.ts deleted from disk and git-tracked
- [x] session-recycling-store.test.ts deleted from disk and git-tracked
- [x] All tests green (149 passed, 1 skipped, 1 todo)
- [x] TypeScript clean (0 errors)
- [x] Build clean (no dangling imports)
