---
phase: 52-convo-list-filter-restyle-popover-add-ready-toggle
plan: "03"
subsystem: pretty-conversations-filter
tags:
  - ui
  - filter
  - react
  - working-store
  - ready-predicate
  - phase-52
dependency_graph:
  requires:
    - phase: 52-01
      provides: useSessionIsDormant hook + getSessionWorkingSnapshot + subscribeSessionWorkingStore exports
    - phase: 52-02
      provides: readyOnly state hook + anyFilterOn extension + filter popover markup
  provides:
    - matchesFilterForRow extended with fail-CLOSED Ready predicate
    - rowSessionStates per-row (isWorking, isDormant) map at Panel scope
    - B-2 vi.mock stubs (getSessionWorkingSnapshot + useSessionIsDormant) in all 4 Panel test files
  affects:
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx
tech_stack:
  added: []
  patterns:
    - "dirty-flag ref cache for useSyncExternalStore getSnapshot stability: prevents infinite re-render from tearing check when getSnapshot builds a new Map on every call"
    - "stable subscribeRowSessionStates wrapper (useCallback) that marks cache dirty on store notify before calling onStoreChange — separates 'store changed' signal from 'rebuild the derived Map' work"
    - "fail-CLOSED default for undefined rowState: rows absent from working-store snapshot are treated as NOT ready when readyOnly is on"
key_files:
  created: []
  modified:
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx
key-decisions:
  - "dirty-flag cache chosen over snapshot-reference cache: the test mock returns new Map() on every call, so cache.snapshot === snapshot would never be true — the snapshot-reference cache would defeat itself. The dirty-flag cache instead tracks whether the store notified (dirty=true) since the last rebuild, guaranteeing React's two consecutive tearing-check calls to getSnapshot return the same Map reference."
  - "subscribeRowSessionStates wrapper (useCallback with empty deps) wraps subscribeSessionWorkingStore to set dirty=true before calling onStoreChange. This is the standard pattern for derived-state useSyncExternalStore: the subscribe function sets a flag then calls the listener."
  - "B-2 stubs extended to all 4 Panel test files (not just PrettyConversationsPanel.test.tsx): the chain, clone-dialog, and new-role-button test files each have their own vi.mock factory for @/state/session-working-store and all three threw TypeError on first render after the Panel imported getSessionWorkingSnapshot."
  - "subscribeSessionWorkingStore was already exported by Plan 01 (session-working-store.ts:137). No new export needed."
metrics:
  duration: ~20 minutes
  completed: 2026-08-21
  tasks_completed: 1
  tasks_total: 1
  files_modified: 5
---

# Phase 52 Plan 03: Ready Predicate + rowSessionStates + B-2 Stubs Summary

**Wire the Ready toggle predicate into matchesFilterForRow via a panel-scope (isWorking, isDormant) map built from the working-store snapshot, with fail-CLOSED default for undefined rowState and B-2 mock stubs extended to all 4 Panel test files.**

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Build per-row {isWorking, isDormant} map + extend matchesFilterForRow + extend vi.mock factories | `77066429` | PrettyConversationsPanel.tsx, PrettyConversationsPanel.test.tsx, .chain.test.tsx, .clone-dialog.test.tsx, .new-role-button.test.tsx |

## rowSessionStates Rebuild Shape (exact as written)

```tsx
const rowSessionStatesCacheRef = useRef<{
  dirty: boolean;
  pinnedRef: typeof pinned;
  middleRef: typeof middle;
  result: Map<string, { isWorking: boolean; isDormant: boolean }>;
}>({ dirty: true, pinnedRef: pinned, middleRef: middle, result: new Map() });

const subscribeRowSessionStates = useCallback(
  (onStoreChange: () => void) => {
    return subscribeSessionWorkingStore(() => {
      rowSessionStatesCacheRef.current.dirty = true;
      onStoreChange();
    });
  },
  [], // stable — subscribeSessionWorkingStore is a module-level export
);

const rowSessionStates = useSyncExternalStore(
  subscribeRowSessionStates,
  () => {
    const cache = rowSessionStatesCacheRef.current;
    // Return cached result when the store has not notified AND input arrays unchanged.
    if (!cache.dirty && cache.pinnedRef === pinned && cache.middleRef === middle) {
      return cache.result;
    }
    const snapshot = getSessionWorkingSnapshot();
    const out = new Map<string, { isWorking: boolean; isDormant: boolean }>();
    for (const row of [...pinned, ...middle]) {
      const matchKey = sessionMatchKey(row.targetTmuxSession);
      if (!matchKey) continue;
      const record = snapshot.get(matchKey);
      if (record === undefined) continue; // absent from working-store — fail-CLOSED default
      out.set(matchKey, {
        isWorking: record.isWorking === true,
        isDormant: record.dormant === true,
      });
    }
    rowSessionStatesCacheRef.current = { dirty: false, pinnedRef: pinned, middleRef: middle, result: out };
    return out;
  },
  () => new Map<string, { isWorking: boolean; isDormant: boolean }>(),
);
```

## subscribeSessionWorkingStore Export Status

`subscribeSessionWorkingStore` was **already exported** by Plan 01 at `src/ui/state/session-working-store.ts:137`. No new export was needed. The symbol was already present in the test mock at `PrettyConversationsPanel.test.tsx:316` before this plan.

## matchesFilterForRow useMemo Dep Array (final shape)

```ts
}, [identitiesByKey, bountyCounts, pinnedOnly, needsDeskOnly, readyOnly, rowSessionStates]);
```

Six deps: the original four from Plan 02 (identitiesByKey, bountyCounts, pinnedOnly, needsDeskOnly) plus the two new ones (readyOnly, rowSessionStates).

## fail-CLOSED Predicate (W-3 fix)

```ts
const rowState = rowSessionStates.get(matchKey);
const readyOk = !readyOnly || (rowState !== undefined && !rowState.isWorking && !rowState.isDormant);
```

The forbidden optional-chaining form `!rowState?.isWorking && !rowState?.isDormant` does NOT appear anywhere in the file. `grep -c "!rowState?" PrettyConversationsPanel.tsx` returns 0.

## vi.mock Factory Shape (B-2 stubs, post-extension)

All 4 Panel test files now carry the extended factory. Shown for the primary test file (`PrettyConversationsPanel.test.tsx`):

```ts
vi.mock("@/state/session-working-store", () => ({
  useSessionIsWorking: () => false,
  useSessionLastMessageAt: () => null,
  getSessionLastMessageAt: () => null,
  subscribeSessionWorkingStore: (_cb: () => void) => () => {},
  useSessionAiTitle: (sessionKey: string | null) =>
    useSessionAiTitleSpy(sessionKey),
  // Phase 52 Plan 03 (plan-checker B-2 fix): Panel.tsx now imports
  // getSessionWorkingSnapshot + useSessionIsDormant. Without these
  // stubs every existing test throws TypeError on render.
  getSessionWorkingSnapshot: () => new Map(),
  useSessionIsDormant: () => false,
}));
```

Identical stub pattern added to:
- `PrettyConversationsPanel.chain.test.tsx` (chain wiring tests 10-13)
- `PrettyConversationsPanel.clone-dialog.test.tsx` (clone dialog tests 16, 16b)
- `PrettyConversationsPanel.new-role-button.test.tsx` (new role button tests 21a-c)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] useSyncExternalStore tearing-check infinite re-render**
- **Found during:** Task 1 — first test run after implementing the plan's naive `useSyncExternalStore` shape.
- **Issue:** The plan's suggested implementation builds a new `Map` object on every `getSnapshot()` call. React's development-mode `useSyncExternalStore` calls `getSnapshot` twice per commit as a tearing check (comparing the two results with `Object.is`). A new Map object each call means `Object.is(result1, result2) === false` → React forces a re-render → `getSnapshot` called again → new Map → infinite loop. Produced "Maximum update depth exceeded" errors causing 90/91 tests to fail.
- **First attempted fix:** Snapshot-reference cache (cache on `getSessionWorkingSnapshot()` return value identity). Failed because the test mock returns `new Map()` on every call, so `cache.snapshot === snapshot` was always false — defeating the cache.
- **Final fix:** dirty-flag cache. A `rowSessionStatesCacheRef` tracks whether the store has notified since the last rebuild (`dirty` flag). The `subscribeRowSessionStates` wrapper sets `dirty = true` before calling `onStoreChange()`. The `getSnapshot` callback only rebuilds the Map when `dirty || pinnedRef !== pinned || middleRef !== middle`. React's two consecutive tearing-check calls both see `dirty: false` after the first rebuild → return the same Map reference → no forced re-render.
- **Files modified:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`
- **Commit:** `77066429`

**2. [Rule 2 - Correctness] B-2 stubs needed in 3 additional test files**
- **Found during:** Task 1 — test run after Part A (extending PrettyConversationsPanel.test.tsx vi.mock).
- **Issue:** The plan's B-2 fix only specified extending the mock in `PrettyConversationsPanel.test.tsx`. But three other test files (chain, clone-dialog, new-role-button) each have their own `vi.mock("@/state/session-working-store", ...)` factory that also needed `getSessionWorkingSnapshot` and `useSessionIsDormant` stubs. All three threw `TypeError: No "getSessionWorkingSnapshot" export is defined on the mock`.
- **Fix:** Extended all three additional vi.mock factories with the same B-2 stubs (`getSessionWorkingSnapshot: () => new Map()`, `useSessionIsDormant: () => false`).
- **Files modified:** PrettyConversationsPanel.chain.test.tsx, .clone-dialog.test.tsx, .new-role-button.test.tsx
- **Commit:** `77066429`

## Acceptance Criteria Verification

| Check | Result |
|-------|--------|
| `grep -c "useSessionIsDormant" PrettyConversationsPanel.tsx` ≥ 1 | 3 |
| `grep -c "getSessionWorkingSnapshot" PrettyConversationsPanel.tsx` ≥ 2 | 3 |
| `grep -c "subscribeSessionWorkingStore" PrettyConversationsPanel.tsx` ≥ 2 | 4 |
| `grep -c "rowSessionStates" PrettyConversationsPanel.tsx` ≥ 3 | 11 |
| `grep -c "readyOk" PrettyConversationsPanel.tsx` ≥ 1 | 2 |
| fail-CLOSED predicate literal present | PRESENT |
| `grep -q "readyOnly" PrettyConversationsPanel.tsx` | PRESENT |
| `grep -q "const displayedRdpGroup = rdpGroup" PrettyConversationsPanel.tsx` | PRESENT |
| **B-2 gate:** `grep -q "getSessionWorkingSnapshot: () => new Map()"` | PRESENT |
| **B-2 gate:** `grep -q "useSessionIsDormant: () => false"` | PRESENT |
| **W-3 gate:** `grep -c "!rowState?"` = 0 | 0 |
| `npx tsc --noEmit` error TS count | 0 |
| Panel test result | 91/91 passed |
| All pretty-conversations test files | 9/9 passed |

## Known Stubs

None — the Ready predicate is fully wired end-to-end. `matchesFilterForRow` now consumes real `rowSessionStates` from the working-store snapshot. The empty-Map default in the test mocks is intentional (Plan 04 will extend the mocks with per-test seeding via a mutable module-scoped mock Map, mirroring the existing `mockAiTitleByKey` pattern).

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes. All changes are pure frontend (React hooks + filter predicate logic).

## Self-Check: PASSED

Verified files exist:
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — modified and committed at `77066429`
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — modified and committed at `77066429`
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx` — modified and committed at `77066429`
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx` — modified and committed at `77066429`
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx` — modified and committed at `77066429`

Verified commit exists:
- `git log --oneline | grep 77066429` — present on `feat/tab-title-from-tmux`

Verified grep gates:
- `grep -c "!rowState?"` → 0 (W-3 fail-OPEN pattern absent)
- `grep -q "getSessionWorkingSnapshot: () => new Map()"` → exits 0 (B-2 stub present)
- `grep -q "useSessionIsDormant: () => false"` → exits 0 (B-2 stub present)
- `grep -q "rowState !== undefined && !rowState.isWorking && !rowState.isDormant"` → exits 0 (fail-CLOSED predicate present)
- `npx vitest run src/ui/features/pretty-conversations`: 9/9 test files, 91 tests passed
- `npx tsc --noEmit`: 0 error TS
