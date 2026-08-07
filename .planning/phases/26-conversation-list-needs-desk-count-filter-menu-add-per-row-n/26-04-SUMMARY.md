---
phase: 26-conversation-list-needs-desk-count-filter-menu
plan: "04"
subsystem: ui-panel-filter
tags: [bounty-counts, filter-popover, wave-4, panel-refactor, checkbox-toggles, and-intersection]
dependency_graph:
  requires:
    - 26-03 (PrettyBountyCountBadge combined pill; PrettyConversationRow uses useBountyCounts)
    - 26-02 (useAllBountyCounts returns Map<string, {pinnedCount, needsDeskCount}>)
  provides:
    - Two-toggle Popover filter (pinned + needs-desk) with AND intersection
    - Symmetric active-set exemption for both predicates (Phase 26 D-06)
    - pv-filter-dot indicator when any toggle is on (--pv-hue tinted)
    - testid pv-filter-toggles (rename from pv-filter-pinned-bounties)
    - aria-label "Filter conversations" (hardcoded, not stale i18n key)
  affects:
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/pretty-conversations.css
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx
    - src/ui/features/pretty-view/use-pretty-view-uploads.test.ts (scope-creep test-timeout fixup)
tech_stack:
  added: []
  patterns:
    - shadcn Popover (controlled open state) hosting two Checkbox toggles
    - useMemo-cached matchesFilterForRow predicate keyed to (identities, bountyCounts, pinnedOnly, needsDeskOnly)
    - AND-intersect predicate with symmetric active-set exemption at both tiers (pinned + grouped)
    - --pv-hue-inherited dot indicator (single-hue per D-04, no per-toggle color coding)
key_files:
  created: []
  modified:
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (+96/-42)
    - src/ui/features/pretty-conversations/pretty-conversations.css (+55)
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx (+190/-137)
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx (+1/-1)
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx (+1/-1)
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx (+1/-1)
    - src/ui/features/pretty-view/use-pretty-view-uploads.test.ts (+3/-1)
decisions:
  - Popover mechanism: shadcn Popover + Checkbox (matches existing panel style; no new dep)
  - testid renamed pv-filter-pinned-bounties → pv-filter-toggles (per CONTEXT.md D-05)
  - aria-label hardcoded "Filter conversations" (retire stale filterLabel i18n key that assumed single-toggle semantics)
  - Dot indicator single --pv-hue (not per-toggle color coded — CONTEXT.md D-04)
  - Test 11 in use-pretty-view-uploads (unrelated) timeout raised 20s → 30s under "never leave tests failing" fleet rule
metrics:
  duration: ~2h (background wave-4 landing across 3 commits)
  completed: 2026-08-07
  tasks: 3 (feat + test rewrite + scope-creep test-timeout fix)
  files: 7
---

# Phase 26 Plan 04: Filter-popover with two toggles + AND intersection Summary

Widened the panel-header Filter icon from a single pin-only toggle into a two-toggle Popover (pinned + needs-desk) with AND-intersect filtering. Both predicates carry symmetric active-set exemption. A small `--pv-hue`-tinted dot indicator on the button announces "any filter on" without an icon swap.

## What Shipped

### Filter-popover shape

- **Mechanism:** shadcn `Popover` (imported from `@/components/popover`) with `PopoverTrigger` wrapping the existing Filter button and `PopoverContent` housing two `Checkbox` toggles.
- **State:** four `useState`s — `pinnedOnly`, `needsDeskOnly`, `filterPopoverOpen`, plus derived `anyFilterOn = pinnedOnly || needsDeskOnly`.
- **AND intersection:** `matchesFilterForRow` = `(!pinnedOnly || pair.pinnedCount > 0) && (!needsDeskOnly || pair.needsDeskCount > 0)` — a row must satisfy every active toggle. Both toggles off ⇒ predicate short-circuits (no filtering).
- **Symmetric active-set exemption (Phase 26 D-06):** active-set rows always render regardless of filter state. Applied identically to both pinned and needs-desk predicates.
- **Dot indicator:** small `span.pv-filter-dot` renders inside the button iff `anyFilterOn`. Inherits `--pv-hue` per D-04 (single hue, not per-toggle color coded).
- **testid rename:** `pv-filter-pinned-bounties` → `pv-filter-toggles` on the button; the popover surface itself carries `pv-filter-toggles-popover`.
- **aria-label:** hardcoded `"Filter conversations"` — deliberately not the stale `filterLabel` i18n key that assumed single-toggle semantics.
- **CSS:** new `.pv-filter-dot` (small circle, `--pv-hue` background, absolute-positioned top-right on the button) + `.pv-filter-popover` chrome (spacing, background, border, checkbox row layout) added under the existing `.pv-filter` scope. Mobile-viewport `@media (max-width: 767.98px)` bump for the dot proportional to the existing button-size bump.

### Tests added (in PrettyConversationsPanel.test.tsx)

Describe block renamed to **"bounty-count filter popover (Phase 26)"**. New tests:

| Test | Coverage |
|------|----------|
| Test 23 | Button renders `data-active="false"` + no dot + popover closed by default |
| Test 24 | Click opens popover; both checkboxes unchecked; button still inactive |
| Test 25 | pinned-only filter: rows with `pinnedCount > 0` survive; dot appears; nelly-row hidden |
| **Test 25b** (NEW) | needs-desk-only filter: rows with `needsDeskCount > 0` survive; tina-row hidden |
| **Test 26** (NEW) | Both toggles on → AND intersection; only row with BOTH counts > 0 survives |
| Test 27 | Filter on with no matching rows → no rows rendered (empty-state card retired 2026-08-02) |
| **Test 27b** (NEW) | Group-drop: filter drops groups whose rows are ALL filtered out (no orphan host-divider chip) |
| Test 28 | Active-set tier is exempt from BOTH predicates when both toggles are on |
| **Test 29** (NEW) | Small dot disappears when both toggles are turned back off |
| **Test 30** (NEW) | Popover closes on Escape keydown |

Full mock rewrite: `mockBountyCounts` widened from `Map<string, number>` to `Map<string, {pinnedCount, needsDeskCount}>`; `vi.mock("@/state/bounty-counts-store", ...)` updated to export `useBountyCounts` (plural) and `useAllBountyCounts` returning the widened Map.

### Sibling test-file mock renames (Rule 3 blocker fix)

Same file's sibling suites hoisted the old `useBountyCount` mock name; they broke on the widened store from Plan 26-02. Three companion test files updated to use `useBountyCounts` (plural):

- `PrettyConversationsPanel.chain.test.tsx`
- `PrettyConversationsPanel.clone-dialog.test.tsx`
- `PrettyConversationsPanel.new-role-button.test.tsx`

Each file's one-liner mock changed from:
```typescript
vi.mock("@/state/bounty-counts-store", () => ({
  useBountyCount: () => undefined,
  ...
}));
```
to:
```typescript
vi.mock("@/state/bounty-counts-store", () => ({
  useBountyCounts: () => undefined,
  ...
}));
```
No test logic changes — pure hook-name catch-up to Plan 26-02's renaming.

## Scope Creep (Authorized by Fleet Rule)

### Test 11 timeout in use-pretty-view-uploads

`src/ui/features/pretty-view/use-pretty-view-uploads.test.ts` Test 11 (concurrent upload limit) was hitting 20+ seconds on this instance due to slow environment transform overhead. Pre-existing, unrelated to Plan 26-04 — but the fleet rule "never leave tests failing" required a fix before the plan could commit clean.

Per-test timeout raised from default 20s to 30s. Test logic unchanged. Called out under `[Rule 1 - Bug]` in the commit message.

Note: origin has since landed a duplicate fix for the same test (`f112bd0`) that will conflict on rebase — that's a ship-time concern, not a plan-completion concern.

## Full-Suite Test Results

```
Test Files  122 passed (122)
     Tests  1511 passed | 6 skipped (1517)
  Start at  06:34:29
  Duration  239.64s (transform 7.85s, setup 2.75s, import 58.66s, tests 64.64s, environment 79.74s)
```

Zero failures. The 6 skips are pre-existing (not introduced by Plan 26-04).

## Deviations from Plan

None substantive.

- **Discretion picks (per CONTEXT.md §Claude's Discretion):**
  - Popover mechanism: shadcn Popover + Checkbox (chose to match existing panel style; no new dep introduced)
  - Kept single `useBountyCounts` hook returning the pair (not split into two — matches Plan 26-02's shape)
  - Dot positioned top-right on the button (codebase-standard pattern per CONTEXT.md discretion)
  - testid renamed to `pv-filter-toggles` (plan's suggested target)

## Threat Model Compliance

- T-26-05 (Information Disclosure — rendered numeric counts): accepted per Plan 26-03. No new surface introduced by the filter — panel already had access to the full counts map via the pinned-only filter.
- No new endpoints, no new user input beyond checkbox toggles, no new auth surface.

## Known Stubs

None. All filter logic is fully wired end-to-end (panel → useAllBountyCounts → widened store → useBountyCounts row consumer).

## Threat Flags

None.

## Self-Check

Files exist:
- src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx — FOUND (contains Popover, Checkbox, pinnedOnly, needsDeskOnly, anyFilterOn, matchesFilterForRow, pv-filter-toggles, "Filter conversations")
- src/ui/features/pretty-conversations/pretty-conversations.css — FOUND (contains .pv-filter-dot, .pv-filter-popover)
- src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx — FOUND (contains Tests 23-30, 25b, 27b; "bounty-count filter popover (Phase 26)")
- src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx — FOUND (useBountyCounts plural)
- src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx — FOUND (useBountyCounts plural)
- src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx — FOUND (useBountyCounts plural)
- src/ui/features/pretty-view/use-pretty-view-uploads.test.ts — FOUND (Test 11 timeout 30s)

Commits exist:
- 06c1448: feat(26-04): filter popover with two toggles + AND intersection
- de9dfa4: test(26-04): rewrite panel filter test suite for widened shape
- 21bd66a: fix(26-04): extend Test 11 timeout in use-pretty-view-uploads

Full suite (`npx vitest run`): 122 test files, 1511 pass / 6 skip / 0 fail.

## Self-Check: PASSED
