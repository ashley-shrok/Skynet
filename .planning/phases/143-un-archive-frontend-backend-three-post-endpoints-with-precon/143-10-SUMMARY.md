---
phase: 143-un-archive-frontend-backend-three-post-endpoints-with-precon
plan: 10
subsystem: frontend-tests
tags: [test-migration, kebab-menu, un-archive, endpoint-first-sequence, D-23, D-26, D-27]
dependency_graph:
  requires: [143-07, 143-08]
  provides: [test-coverage-D-23-D-26-D-27]
  affects: []
tech_stack:
  added: []
  patterns:
    - "never-resolving-mock mid-flight assertion pattern (endpoint-first sequence lock)"
    - "ResizeObserver stub for Radix DropdownMenu portals in jsdom"
key_files:
  created: []
  modified:
    - src/ui/features/pretty-view/RolesListModal.test.tsx
    - src/ui/features/pretty-conversations/ConversationSearchModal.test.tsx
decisions:
  - "Breadcrumbs in comments necessarily contain the retired test language (e.g. 'coming soon') because D-27 requires naming the retired test verbatim; the grep-==0 acceptance criteria refers to the absence of live test assertions, not comments"
  - "Test J updated from .disabled assertion to aria-disabled check — row is now <div role='button'> per 143-07 (no .disabled property)"
  - "ResizeObserver stub added to ConversationSearchModal tests to support Radix DropdownMenu portals"
metrics:
  duration: "~25 minutes"
  completed: "2026-09-30"
  tasks_completed: 2
  files_modified: 2
---

# Phase 143 Plan 10: Test Migration (D-23/D-26/D-27) Summary

Tests for phase-143 kebab-menu Archive/Un-archive surfaces fully migrated — retired right-click invariants removed with breadcrumbs, new endpoint-first sequence locks in place.

## What Was Done

### Task 1: RolesListModal test migration

**Retired (D-27):** The `describe("Phase 133 D-01/D-02/D-03/D-04 — archive role context menu")` block (13 tests) that pinned the right-click Archive invocation path was removed. Replaced with a breadcrumb comment naming `.planning/campaigns/un-archiving/shape-unarchive-frontend-backend.md`.

**Added — kebab-menu Archive describe (8 tests, D-26):**
1. Two roles render two kebab triggers (`roles-list-row-kebab-*`)
2. Clicking kebab opens menu with Archive item
3. Archive fires double-confirm (`window.confirm` × 2)
4. Cancel on first confirm → no API call
5. Happy path → `archiveRole(hostId, roleName)` called correctly
6. Optimistic-remove: row disappears immediately on Archive (pre-existing archive behavior)
7. Modal stays open after Archive (no `onOpenChange(false)`)
8. Kebab stop-propagation: clicking kebab does NOT fire `onSelectRole` (D-14)

**Added — archived-roles collapsed section describe (9 tests, D-10/D-18/D-19):**
1. Section header always visible even with zero archived roles (D-18)
2. No fetch on initial render (lazy-load lock)
3. Click header → expands + fires `listArchivedRoles(hostId)` + shows empty state
4. Two archived entries → two kebab rows render
5. **Endpoint-first sequence lock:** never-resolving mock → MID-FLIGHT: row present + alert not called; post-resolve: row gone + alert fires with "Un-archiving role"
6. `name_collision` failure → row stays + alert matches `/live role.*already exists/`
7. Generic failure → row stays + alert matches `/try again in a moment/`
8. Section stays expanded after un-archive (D-19)
9. Host-switch collapses section + resets fetch state (D-07)

**Also fixed:** Test J updated to assert `aria-disabled === null` instead of `.disabled === false` — row is now `<div role="button">` per plan 143-07 (nested `<button>` inside `<button>` is invalid HTML).

**Added mocks:** `listArchivedRoles` and `unarchiveRole` module mocks added to the test file.

### Task 2: ConversationSearchModal test migration

**Retired (D-27):** The T-08 test asserting "clicking archived row → window.alert('coming soon')" removed. Breadcrumb comment added naming the shape file. T-08 entry in the file-header test catalog updated to "RETIRED — see breadcrumb".

**Added — kebab-menu Un-archive describe (12 tests, D-11/D-16/D-17/D-19):**
1. Archived row renders `conversation-search-archived-row-kebab-*` trigger
2. Live row has no kebab (D-11 boundary)
3. Kebab stop-propagation → modal NOT closed (D-14)
4. Un-archive item → `unarchiveIdentity(hostId, identityKey)` called with correct args
5. **Endpoint-first sequence lock:** never-resolving mock → MID-FLIGHT: row present + alert not called; post-resolve: row gone + alert fires matching `/Un-archiving/`
6. Modal stays open after successful Un-archive (D-19)
7. `missing_roles` single role → row stays + alert matches D-17 verbatim: `"Un-archive role ops-oncall first — this conversation depends on it."`
8. `missing_roles` multiple roles → row stays + both names in alert
9. `name_collision` → row stays + alert matches `/live conversation.*already exists/`
10. `archive_not_found` → row stays + alert matches `/already been reactivated/`
11. Generic Error → row stays + alert matches `/try again in a moment/`
12. Left-click on archived row is a no-op (D-11): no `onOpenActiveConversation`, no `onOpenChange(false)`, no alert

**Added mocks:** `unarchiveIdentityMock` for `@/api/identity-unarchive-api`. Added ResizeObserver stub for Radix DropdownMenu portal support in jsdom.

## Test Results

- `RolesListModal.test.tsx`: **32 tests — all green**
- `ConversationSearchModal.test.tsx`: **24 tests — all green**
- Combined: **56 tests — all green**
- `npm run build`: exits 0 (no TypeScript errors)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test J used `.disabled` on a `<div role="button">`**
- **Found during:** Task 1 implementation review
- **Issue:** Plan 143-07 changed live-role rows from `<button>` to `<div role="button">` (to allow the kebab `<button>` as a sibling without invalid HTML nesting). Test J asserted `(row as HTMLButtonElement).disabled === false` which doesn't apply to a div.
- **Fix:** Changed to `expect(row.getAttribute("aria-disabled")).toBeNull()` — semantically equivalent for a `<div role="button">` with no disabled state.
- **Files modified:** `src/ui/features/pretty-view/RolesListModal.test.tsx`
- **Commit:** c77e8275

**2. [Rule 2 - Missing stub] ResizeObserver not stubbed in ConversationSearchModal tests**
- **Found during:** Task 2 implementation
- **Issue:** `RowKebabMenu` uses Radix DropdownMenu which requires ResizeObserver. Not present in jsdom by default.
- **Fix:** Added `window.ResizeObserver = class { observe(){} ... }` stub in ConversationSearchModal.test.tsx (matching the pattern from RowKebabMenu.test.tsx).
- **Files modified:** `src/ui/features/pretty-conversations/ConversationSearchModal.test.tsx`
- **Commit:** a58b8244

### Plan/Criteria Tension (documented, not a deviation)

The breadcrumb comments mandated by D-27 necessarily contain the retired test language (e.g., "the T-08 test that pinned the 'coming soon' left-click alert"). The acceptance criterion `grep -c 'coming soon' == 0` technically conflicts with D-27's breadcrumb requirement. Resolution: breadcrumbs take precedence (they're comments, not test assertions); the live assertion `alertSpy.toHaveBeenCalledWith(expect.stringMatching(/coming soon/))` is confirmed absent. Same applies to the "Phase 133" string in RolesListModal.test.tsx.

## Threat Flags

None — test-only files, no production trust boundaries introduced.

## Known Stubs

None — all tests exercise real component behavior with explicit mocks.

## Self-Check: PASSED

Files confirmed present:
- `/home/ubuntu/fleet/identities/cypher-box-maintainer-2/workspace/skynet/src/ui/features/pretty-view/RolesListModal.test.tsx` ✓
- `/home/ubuntu/fleet/identities/cypher-box-maintainer-2/workspace/skynet/src/ui/features/pretty-conversations/ConversationSearchModal.test.tsx` ✓

Commits confirmed:
- `c77e8275` — RolesListModal test migration ✓
- `a58b8244` — ConversationSearchModal test migration ✓
