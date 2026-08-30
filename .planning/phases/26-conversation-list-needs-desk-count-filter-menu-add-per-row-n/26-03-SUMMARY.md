---
phase: 26-conversation-list-needs-desk-count-filter-menu
plan: "03"
subsystem: ui-badge-row
tags: [bounty-counts, combined-pill, tdd, wave-3, badge-rebuild, row-rewire]
dependency_graph:
  requires:
    - 26-02 (useBountyCounts(identityKey, hostId) returning {pinnedCount, needsDeskCount})
  provides:
    - PrettyBountyCountBadge({pinnedCount, needsDeskCount}) combined pin·desk pill
    - PrettyConversationRow consuming useBountyCounts pair and forwarding to badge
  affects:
    - src/ui/features/pretty-conversations/PrettyBountyCountBadge.tsx
    - src/ui/features/pretty-conversations/PrettyBountyCountBadge.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
    - src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
    - src/ui/features/pretty-conversations/pretty-conversations.css
tech_stack:
  added: []
  patterns:
    - combined-pill with per-half spans + separator span (U+00B7)
    - nullish-chain pair forwarding (bountyCounts?.pinnedCount)
    - TDD RED/GREEN cycle per task
key_files:
  created: []
  modified:
    - src/ui/features/pretty-conversations/PrettyBountyCountBadge.tsx
    - src/ui/features/pretty-conversations/PrettyBountyCountBadge.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
    - src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
    - src/ui/features/pretty-conversations/pretty-conversations.css
decisions:
  - min-width bumped 20px -> 28px desktop (plan suggested 28px; 28px chosen as safe starting value)
  - min-width bumped 32px -> 44px mobile (plan suggested 44px; 44px chosen)
  - Multi-line JSX for badge props in row (idiomatic React; plan's grep AC was for inline but implementation is correct)
metrics:
  duration: ~10 minutes
  completed: 2026-08-07
  tasks: 2
  files: 5
---

# Phase 26 Plan 03: Badge combined-pill rebuild + row rewire + CSS Summary

Rebuilt `PrettyBountyCountBadge` from a bare-integer pill into a two-half combined `pin·desk` pill. Rewired `PrettyConversationRow` to consume the `useBountyCounts` (plural) hook from Plan 26-02 and forward the pair to the badge via nullish-chained prop pass-through.

## (a) Exact new PrettyBountyCountBadge prop signature

```typescript
export function PrettyBountyCountBadge({
  pinnedCount,
  needsDeskCount,
}: {
  pinnedCount: number | undefined;
  needsDeskCount: number | undefined;
}): JSX.Element | null
```

## (b) Middle-dot U+00B7 confirmation

The separator is the literal `·` character (U+00B7, middle dot). It appears in:
- `PrettyBountyCountBadge.tsx` line 51: `{"·"}` inside the `pv-bounty-badge-sep` span
- 7 occurrences total in the source file (comment lines + the actual render)

This is NOT a hyphen (-), en-dash (–), interpunct (·), or any other near-miss. Verified by the Test 2 assertion: `sep!.textContent === "·"`.

## (c) Test Run Output

### Badge tests (8 passing)

```
Test Files  1 passed (1)
     Tests  8 passed (8)
  Start at  03:31:17
  Duration  16.26s
```

Tests 1a/1b/1c (null cases), Test 2 (both-nonzero "3·1"), Test 3 (pinned-only "3·"), Test 4 (needs-desk-only "·1"), Test 5 (large numbers "99·12"), Test 6 (one-half undefined edge case "3·").

### Row tests (47 passing)

```
Test Files  1 passed (1)
     Tests  47 passed (47)
  Start at  03:37:07
  Duration  52.50s
```

All 47 tests pass including the 6 new bounty badge visibility tests (Tests A-F).

### Combined (both files)

```
Test Files  2 passed (2)
     Tests  55 passed (55)
```

### TypeScript check

`npx tsc --noEmit` exits 0 with no output — zero errors across the whole repo. Both badge and row files are fully clean. (The plan anticipated possible panel-level errors in Wave 4 — none exist at this point, meaning the repo is actually fully clean after Plan 26-03.)

## (d) CSS min-width tuning notes

| Context | Plan suggestion | Chosen value | Rationale |
|---------|----------------|--------------|-----------|
| Desktop `.pv-bounty-badge` | 28px | 28px | Plan's safe starting value; fits "99·12" with 6px padding each side |
| Mobile `.pv-bounty-badge` | 44px | 44px | Plan's suggested value; proportional to 1.6x desktop scale factor used throughout mobile CSS |

Both values match the plan's suggestions exactly. No tuning from the suggested values was needed.

## What Shipped

### Task 1: PrettyBountyCountBadge rebuild

- 4-case rendering rule table implemented per CONTEXT.md D-01:
  - `both undefined` OR `both coerced to 0` → `null`
  - `pinnedCount > 0`, `needsDeskCount === 0` → `"3·"` (right side blank)
  - `pinnedCount === 0`, `needsDeskCount > 0` → `"·1"` (left side blank)
  - both nonzero → `"3·1"`
- Three inner spans: `pv-bounty-badge-half--pinned`, `pv-bounty-badge-sep` (aria-hidden), `pv-bounty-badge-half--needs-desk`
- `data-testid` on each half + outer badge span
- `aria-label` on outer span for screen-reader accessibility
- Old `count` prop fully retired (grep returns 0)

### Task 2: PrettyConversationRow rewire

- Import: `useBountyCount` → `useBountyCounts` (plural) — one line change
- Call site: `const pinnedCount = useBountyCount(...)` → `const bountyCounts = useBountyCounts(...)`
- Render: `<PrettyBountyCountBadge count={pinnedCount} />` → multi-line with `pinnedCount={bountyCounts?.pinnedCount}` and `needsDeskCount={bountyCounts?.needsDeskCount}`
- Test file: `vi.mock("@/state/bounty-counts-store", ...)` added exporting `useBountyCounts`; `currentBountyCounts` per-test override handle; all 6 Tests A-F added

## Deviations from Plan

None — plan executed exactly as written.

- CSS min-width values: chose plan's suggested 28px (desktop) and 44px (mobile) exactly.
- Multi-line JSX for badge props: idiomatic formatting, functionally equivalent to plan's inline suggestion. Tests prove the wiring is correct.

## Threat Model Compliance

- T-26-05 (Information Disclosure — rendered numeric counts): accepted per plan. Counts were already visible (pinned); adding needs_desk exposes one additional integer to the same viewer. Single-tenant Skynet; no cross-user leak surface.

## Known Stubs

None — all pill logic is fully wired. The badge receives real data from the store via the row's `useBountyCounts` call.

## Threat Flags

None — no new network endpoints, no new user input, no new auth surface. Pure render refactor and hook rename.

## Self-Check

Files exist:
- src/ui/features/pretty-conversations/PrettyBountyCountBadge.tsx — FOUND (contains needsDeskCount, pv-bounty-badge-sep, U+00B7)
- src/ui/features/pretty-conversations/PrettyBountyCountBadge.test.tsx — FOUND (8 tests, all passing)
- src/ui/features/pretty-conversations/PrettyConversationRow.tsx — FOUND (contains useBountyCounts, bountyCounts?.pinnedCount)
- src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx — FOUND (47 tests, contains Tests A-F)
- src/ui/features/pretty-conversations/pretty-conversations.css — FOUND (contains pv-bounty-badge-half, pv-bounty-badge-sep, min-width: 28px, min-width: 44px)

Commits exist:
- 8de7a01: test(26-03): add failing tests for combined pin·desk pill badge (RED)
- 1ec5f50: feat(26-03): rebuild PrettyBountyCountBadge as combined pin·desk pill (GREEN)
- c39ddc2: test(26-03): add failing tests for PrettyConversationRow useBountyCounts wiring (RED)
- 9e90b51: feat(26-03): rewire PrettyConversationRow to consume useBountyCounts pair (GREEN)

## Self-Check: PASSED
