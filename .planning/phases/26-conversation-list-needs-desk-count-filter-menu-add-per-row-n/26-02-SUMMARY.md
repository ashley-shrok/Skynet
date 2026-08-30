---
phase: 26-conversation-list-needs-desk-count-filter-menu
plan: "02"
subsystem: frontend-store
tags: [bounty-counts, useSyncExternalStore, wave-2, pair-widening]
dependency_graph:
  requires:
    - 26-01 (BountyCountResult.needsDeskCount on WS wire + frontend API type)
  provides:
    - useBountyCounts(identityKey, hostId) -> {pinnedCount, needsDeskCount} | undefined
    - useAllBountyCounts() -> ReadonlyMap<string, {pinnedCount, needsDeskCount}>
    - bounty-counts-store internal Map keyed to pair values
  affects:
    - src/ui/state/bounty-counts-store.ts
    - src/ui/state/bounty-counts-store.test.ts
tech_stack:
  added: []
  patterns:
    - pair change-detection (mutated=true iff either half of pair changes)
    - last-known pair preservation on per-target error (both halves preserved)
key_files:
  created: []
  modified:
    - src/ui/state/bounty-counts-store.ts
    - src/ui/state/bounty-counts-store.test.ts
decisions:
  - Widened single hook to return pair rather than splitting into two hooks (CONTEXT.md D-07 discretion)
  - CountsPair local type alias avoids verbose inline repeat throughout file
metrics:
  duration: ~15 minutes
  completed: 2026-08-07
  tasks: 1
  files: 2
---

# Phase 26 Plan 02: Frontend bounty-counts-store widening to pair values Summary

Widened `bounty-counts-store.ts` so every stored value is `{pinnedCount, needsDeskCount}` rather than a bare integer. The public hook is renamed `useBountyCounts` (plural) and returns the pair. `useAllBountyCounts` return type widens accordingly. All existing store semantics (poller, focus listener, invalidate piggyback, per-target error preservation) are unchanged.

## What Shipped

### Exact new useBountyCounts signature

```typescript
export function useBountyCounts(
  identityKey: string | null,
  hostId: number | null,
): { pinnedCount: number; needsDeskCount: number } | undefined
```

### Internal Map value type

```typescript
type CountsPair = { pinnedCount: number; needsDeskCount: number };
type State = { counts: Map<string, CountsPair> };
```

### useAllBountyCounts widened return type

```typescript
export function useAllBountyCounts(): ReadonlyMap<
  string,
  { pinnedCount: number; needsDeskCount: number }
>
```

### refreshBountyCounts pair change-detection

```typescript
const prev = next.get(key);
const changed =
  !prev ||
  prev.pinnedCount !== c.pinnedCount ||
  prev.needsDeskCount !== c.needsDeskCount;
if (changed) {
  next.set(key, { pinnedCount: c.pinnedCount, needsDeskCount: c.needsDeskCount });
  mutated = true;
}
```

## Test Run Output

```
Test Files  1 passed (1)
     Tests  10 passed (10)
  Start at  03:25:36
  Duration  17.38s
```

All 10 tests pass including:

**Test 5 (error preserves full pair):**
```
expect(result.current).toEqual({ pinnedCount: 4, needsDeskCount: 2 });
// after errored second fetch — BOTH halves preserved
expect(result.current).toEqual({ pinnedCount: 4, needsDeskCount: 2 });
```

**Test 7 (identical-pair no-op):**
- First refresh: `{pinnedCount:2, needsDeskCount:1}` — populates store (notifies)
- Second refresh: `{pinnedCount:3, needsDeskCount:1}` — pinnedCount changed → notifies → re-renders
- Third refresh: `{pinnedCount:3, needsDeskCount:1}` — identical → `mutated=false` → no notify → no extra re-render

## Wave-3 Consumer Files (intentionally typecheck-red)

These four files still call the OLD `useBountyCount` (singular) or reference the old `number` shape. Their type errors are the expected wave-2 boundary state; Plans 26-03 and 26-04 close them:

1. `src/ui/components/PrettyBountyCountBadge.tsx`
2. `src/ui/components/PrettyConversationRow.tsx`
3. `src/ui/components/PrettyConversationsPanel.tsx`
4. `src/ui/components/IdentityModal.tsx` (imports `invalidateIdentity` only — may not actually error; listed per plan spec)

## Deviations from Plan

None — plan executed exactly as written. All 10 action steps applied verbatim.

## Threat Model Compliance

- T-26-04 (Tampering — missing needsDeskCount on malformed response): TypeScript compile-time check at `BountyCountResult.needsDeskCount: number` boundary mitigates at the API-type layer. No additional runtime guard added (per plan spec: single-tenant Skynet, trust boundary already validated at WS handler layer).

## Self-Check

Files exist:
- src/ui/state/bounty-counts-store.ts — FOUND (contains useBountyCounts, needsDeskCount x14)
- src/ui/state/bounty-counts-store.test.ts — FOUND (contains needsDeskCount x22, Test 6, Test 7)

Commits exist:
- 823eb1a: feat(26-02): widen bounty-counts-store to pair values

## Self-Check: PASSED
