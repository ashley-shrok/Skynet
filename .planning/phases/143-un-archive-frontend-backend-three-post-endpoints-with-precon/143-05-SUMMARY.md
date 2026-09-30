---
phase: 143-un-archive-frontend-backend-three-post-endpoints-with-precon
plan: "05"
subsystem: frontend-api-clients
tags:
  - api-client
  - unarchive
  - archived-list
  - kebab-menu
  - phase-143
dependency_graph:
  requires:
    - 143-04 (backend POST un-archive endpoints)
    - 143-03 (backend GET archived-list endpoints)
  provides:
    - unarchiveIdentity / unarchiveRole / unarchiveApp (POST clients)
    - listArchivedIdentities / listArchivedRoles / listArchivedApps (GET clients)
    - UnarchiveError + UnarchiveFailureReason (typed error contract)
    - RowKebabMenu (shared presentational component)
  affects:
    - 143-06 (archived-apps modal surface)
    - 143-07 (archived-roles collapsed section)
    - 143-08 (conversation search modal un-archive)
tech_stack:
  added:
    - RowKebabMenu (new shared component, Radix DropdownMenu)
  patterns:
    - authApi.post/get thin wrapper (mirrors identity-archive-api.ts)
    - Typed error subclass (UnarchiveError extends Error, reason union)
    - Single-definition + re-export (UnarchiveError defined once, imported by siblings)
    - asChild + dual stop-propagation (D-14 belt-and-suspenders pattern)
key_files:
  created:
    - src/ui/api/identity-unarchive-api.ts
    - src/ui/api/identity-unarchive-api.test.ts
    - src/ui/api/role-unarchive-api.ts
    - src/ui/api/role-unarchive-api.test.ts
    - src/ui/api/apps-unarchive-api.ts
    - src/ui/api/apps-unarchive-api.test.ts
    - src/ui/api/identities-archive-list-api.ts
    - src/ui/api/identities-archive-list-api.test.ts
    - src/ui/api/roles-archive-list-api.ts
    - src/ui/api/roles-archive-list-api.test.ts
    - src/ui/api/apps-archive-list-api.ts
    - src/ui/api/apps-archive-list-api.test.ts
    - src/ui/features/pretty-conversations/RowKebabMenu.tsx
    - src/ui/features/pretty-conversations/RowKebabMenu.test.tsx
  modified: []
decisions:
  - "UnarchiveError defined exactly once in identity-unarchive-api.ts; role/apps siblings import+re-export it (single source of truth per plan spec)"
  - "apps-unarchive-api.ts omits POST body (hostId in path, matching apps-archive-api.ts:33 convention)"
  - "RowKebabMenu tests use @testing-library/user-event for trigger click — userEvent dispatches full pointer event sequence that Radix DropdownMenu requires to open; fireEvent.click alone does not trigger Radix state transition"
  - "parseUnarchive409OrRethrow helper isolates 409 parsing from handleApiError dispatch; keeps the outer try/catch readable and avoids instanceof checks on the outer catch"
metrics:
  duration: "~8 minutes"
  completed: "2026-09-30T21:07:20Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 14
  files_modified: 0
  tests_added: 20
---

# Phase 143 Plan 05: Frontend API clients + RowKebabMenu Summary

**One-liner:** Six thin `authApi` wrappers (three POST un-archive with typed UnarchiveError + three GET archived-list) and the shared RowKebabMenu component with D-12 visual tokens and D-14 stop-propagation.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Three POST un-archive API clients + tests | `1cbee818` | identity/role/apps -unarchive-api.ts + .test.ts (6 files) |
| 2 | Three GET archived-list API clients + tests | `49d3605f` | identities/roles/apps -archive-list-api.ts + .test.ts (6 files) |
| 3 | RowKebabMenu shared component + test | `396b6342` | RowKebabMenu.tsx + RowKebabMenu.test.tsx (2 files) |

## Test Results

All 20 tests green (7 test files):
- `identity-unarchive-api.test.ts` — 4 tests (happy, missing_roles, name_collision, 500)
- `role-unarchive-api.test.ts` — 3 tests (happy, name_collision, 500)
- `apps-unarchive-api.test.ts` — 3 tests (happy, name_collision, 500)
- `identities-archive-list-api.test.ts` — 2 tests (happy, error)
- `roles-archive-list-api.test.ts` — 2 tests (happy with ?hostId=42, error)
- `apps-archive-list-api.test.ts` — 2 tests (happy, error)
- `RowKebabMenu.test.tsx` — 4 tests (D-12 tokens, D-13 popover, callback, D-14 stop-prop)

TypeScript: `npx tsc --noEmit` passes with zero errors introduced.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

### Implementation Notes (not deviations)

**1. userEvent vs fireEvent for Radix DropdownMenu tests**

The plan's `<action>` described using `fireEvent` for Tests 2-4 of RowKebabMenu.
During Test 2 execution, `fireEvent.click` on the trigger did not open the Radix
DropdownMenu (Radix requires the full pointer event sequence: pointerdown → pointerup
→ click). Switched to `@testing-library/user-event`'s `userEvent.setup().click()` which
properly dispatches all pointer events. Tests 2-4 pass. This is consistent with
how other Radix-based component tests work in this codebase (see ChatMessage.test.tsx).

**2. `DropdownMenuTrigger asChild` stop-propagation placement**

With `asChild`, Radix forwards the `<button>`'s own event handlers. Both
`onMouseDown` and `onClick` on the `<button>` call `e.stopPropagation()`. Test 4
confirms the parent div's onClick spy is never called.

## Known Stubs

None — all six API clients wire to real endpoints; RowKebabMenu is a complete
component with working callback dispatch. No placeholder text or hardcoded empty values.

## Threat Flags

No new threat surface beyond what was planned:
- T-143-05-01 (encodeURIComponent on path segments) — mitigated in all three POST clients.
- T-143-05-02 (rogue 409 reason) — accepted per plan; runtime reason constrained to union type.
- T-143-05-03 (no frontend audit trail) — accepted per plan; backend logs the action.

## Self-Check: PASSED

All 14 created files exist on disk. All 3 task commits found in git log.
- `1cbee818` — feat(143-05): three POST un-archive API clients
- `49d3605f` — feat(143-05): three GET archived-list API clients
- `396b6342` — feat(143-05): RowKebabMenu shared component
