---
phase: 143-un-archive-frontend-backend-three-post-endpoints-with-precon
plan: "06"
subsystem: frontend
tags: [archived-apps, modal, sidebar, un-archive, D-09, D-16, D-17, D-18, D-19]
dependency_graph:
  requires: [143-05]
  provides: [ArchivedAppsModal, apps-section-archived-trigger]
  affects:
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
tech_stack:
  added: []
  patterns:
    - Modal primitive (modal.tsx) with hue=40 archive tone
    - RowKebabMenu always-visible kebab affordance per D-12/D-13
    - Endpoint-first un-archive sequence (Risk Summary invariant)
    - Sibling-button pattern (div role=button wrapper) per PrettyProjectSectionHeader
key_files:
  created:
    - src/ui/features/pretty-conversations/ArchivedAppsModal.tsx
    - src/ui/features/pretty-conversations/ArchivedAppsModal.test.tsx
  modified:
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
decisions:
  - Outer Apps section header `<button>` replaced with `<div role="button">` to enable a sibling button (nested button-in-button is invalid HTML and breaks inner button clicks on many browsers)
  - hue=40 (archive tone) chosen for ArchivedAppsModal to be visually distinct from RolesListModal (hue 190) and identity-hue modals
  - onOpenChange(false) never called in handleUnarchive — D-19 modal-stays-open enforced by construction, not by conditional guard
metrics:
  duration: "~15 minutes"
  completed: "2026-09-30T21:44:41Z"
  tasks_completed: 2
  files_count: 3
---

# Phase 143 Plan 06: ArchivedAppsModal + sidebar Apps-header archived-box-icon trigger Summary

Fleet-wide ArchivedAppsModal with rounded-square avatars, kebab Un-archive, endpoint-first removal sequence, and the Apps section header archived-box trigger. Implements D-09/D-16/D-17/D-18/D-19.

## What Was Built

### Task 1 — ArchivedAppsModal component + 7 tests

**`ArchivedAppsModal.tsx`** — new modal component using the shared `Modal` primitive (hue=40, size=list). On every open it fetches `listArchivedApps()` (fleet-wide per D-07) and renders four states: loading, error, empty (D-18), and the row list.

Row shape: 40px rounded-square (8px border-radius, NOT circle — D-09 verbatim) avatar with icon-url image or slug-initial fallback; no host label per row; always-visible `RowKebabMenu` with single "Un-archive" item.

`handleUnarchive` implements the **endpoint-first sequence** from the CONTEXT.md Risk Summary:
1. Call `unarchiveApp(hostId, slug)` — row stays in DOM during flight
2. On 200: `setState` removes the row, then `window.alert` fires success copy (D-16)
3. On reject: row stays by construction (never removed), `window.alert` fires D-17 copy:
   - `name_collision` → distinct wording: "a live app with the same slug already exists"
   - all other reasons → generic: "Couldn't un-archive [label] — try again in a moment."
4. `onOpenChange(false)` never called — modal stays open (D-19)

**`ArchivedAppsModal.test.tsx`** — 7 tests, all passing:
- Test 1: Loading… while fetch pending
- Test 2: "No archived apps." empty state (D-18)
- Test 3: Row list renders slugs + kebab testIds
- Test 4: **Risk Summary invariant** — row present mid-flight + row gone after 200 (manually-controlled never-resolving promise)
- Test 5: Row stays on failure (D-17)
- Test 6: name_collision distinct alert copy (D-17)
- Test 7: onOpenChange(false) never called after success (D-19)

### Task 2 — Apps section header trigger + modal mount

**`PrettyConversationsPanel.tsx`** edits:
- Added `Archive as ArchivedBoxIcon` import from lucide-react
- Added `ArchivedAppsModal` import from `./ArchivedAppsModal`
- Added `archivedAppsModalOpen` / `setArchivedAppsModalOpen` state hook after `rolesListModalOpen`
- **Restructured Apps section header**: replaced outer `<button>` with `<div role="button">` (nesting button-in-button is invalid HTML; the sibling-button pattern from `PrettyProjectSectionHeader.tsx:353-357` requires a wrapper div)
- Inserted archived-box icon-button (`ArchivedBoxIcon` glyph, D-12 visual tokens, `data-testid="pretty-conversations-archived-apps-trigger"`) as a SIBLING of ChevronDown, LEFT of it; `stopPropagation` on click/keyDown so collapse-toggle is unaffected
- Mounted `<ArchivedAppsModal>` as portal-mounted sibling immediately before `<RolesListModal>`

## Verification

- `npx tsc --noEmit` exits 0 (clean TS compile)
- `npx vitest run ArchivedAppsModal.test.tsx` — 7/7 pass
- `npx vitest run src/ui/features/pretty-conversations/` — 491/491 pass (25 test files, zero regressions in existing panel tests)

## Deviations from Plan

None — plan executed exactly as written.

The `<button>` → `<div role="button">` restructure was required by the plan itself (Task 2 action block instructs this change), not an improvised deviation.

## Known Stubs

None. `listArchivedApps()` is wired to the real fleet-wide GET endpoint from plan 143-05. `unarchiveApp()` calls the real POST endpoint from plan 143-05.

## Threat Flags

No new security surface beyond what the plan's threat model covers. React text-node rendering (XSS mitigation T-143-06-01) confirmed — no `dangerouslySetInnerHTML` anywhere in the new files.

## Self-Check

- `src/ui/features/pretty-conversations/ArchivedAppsModal.tsx` — FOUND
- `src/ui/features/pretty-conversations/ArchivedAppsModal.test.tsx` — FOUND
- Commit 237f6d0f — Task 1 (ArchivedAppsModal component + tests)
- Commit 163c1562 — Task 2 (PrettyConversationsPanel header + modal mount)

## Self-Check: PASSED
