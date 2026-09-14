---
phase: quick-260914-liu
plan: "01"
subsystem: pretty-conversations
tags: [ui, ux, header-chrome, information-architecture]
dependency_graph:
  requires: []
  provides: [pv-header-new-agent-button, pv-header-edit-roles-button, pv-header-global-files-button]
  affects: [PrettyConversationsPanel, pretty-conversations.css]
tech_stack:
  added: [Drama, Globe, SquarePen (lucide-react icons)]
  patterns: [single-showPencilButton-guard, pv-pencil-reuse]
key_files:
  created: []
  modified:
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/pretty-conversations.css
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.role-management-flow.test.tsx
    - tests/e2e/golden-create-agent.spec.ts
    - tests/e2e/feature-sweep.spec.ts
decisions:
  - "Retain Ready-filter dead code (readyOnly, anyFilterOn, rowSessionStates, matchesFilterForRow, displayedPinned/displayedMiddle) per Ashley's explicit decision"
  - "Icons SquarePen/Drama/Globe locked by user after rendered preview — do not substitute"
  - "All four header buttons share single showPencilButton guard via JSX fragment"
  - "Delete Phase 26 and Phase 52 filter-popover describe blocks; module-level mock scaffolding retained"
metrics:
  duration: "~25 minutes"
  completed: "2026-09-14T15:56:16Z"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 7
---

# Quick Task 260914-liu: Conversation List Header Chrome — Drop Filter, Promote Icons

Removed the header Filter icon and its popover; promoted New agent (SquarePen), Edit roles (Drama), and Edit global files (Globe) from the kebab into dedicated header icon buttons. Kebab now holds two items: New group conversation and Edit global skills.

## What Was Built

**Task 1 — Delete Filter popover and prune CSS**
- Removed `Filter` from lucide-react import and deleted the `Popover`/`PopoverTrigger`/`PopoverContent` import (required: unused-imports/no-unused-imports is an eslint error)
- Deleted `filterPopoverOpen` useState; retained `readyOnly`/`anyFilterOn` as deliberate dead code
- Deleted the entire Filter Popover JSX block (~70 lines) from `pv-header-actions`
- Pruned all 23 `.pv-filter*` CSS rules from `pretty-conversations.css`
- Surgically removed `.pv-filter` from two shared mobile-bump selector lists; `.pv-pencil` halves kept intact
- Updated `pv-header-actions` comment and context-menu-item comment to remove `.pv-filter` references

**Task 2 — Promote three icons to header buttons**
- Added `Drama`, `Globe`, `SquarePen` to lucide-react import (alphabetical)
- Wrapped all four header buttons in single `showPencilButton` JSX fragment
- Added `pv-header-new-agent-button`, `pv-header-edit-roles-button`, `pv-header-global-files-button` before the kebab; all use `className="pv-pencil"` for existing chrome
- Trimmed kebab to two survivors: "New group conversation" and "Edit global skills…"
- Updated KEEP ORDER comment to describe the new two-item reality

**Task 3 — Repoint tests, retire dead coverage, green gate**
- `npm ci` completed (1124 packages, native builds)
- Deleted Phase 26 filter-popover describe block (Tests 23/24/30)
- Deleted Phase 52 Ready-toggle describe block (P50-1 through P50-8)
- Module-level mock scaffolding retained (`mockWorkingSnapshot`, `getSessionWorkingSnapshotSpy`, etc.)
- Test 5 repointed: one-click `pv-header-new-agent-button` → NewSessionDialog
- Test 6 extended: all four header buttons absent when `onCreateSession` is undefined
- Test 4 (NewConversationModal describe) rewritten: two-item kebab assertion
- `new-role-button.test.tsx`: Tests 21a/21b/21c repointed at `pv-header-edit-roles-button`
- `role-management-flow.test.tsx`: all four flow preambles replaced with single header button click
- `golden-create-agent.spec.ts`: kebab→New agent replaced with direct `pv-header-new-agent-button` click; `hasNot` filter extended to exclude all four header buttons
- `feature-sweep.spec.ts`: kebab→Edit global files replaced with `pv-header-global-files-button`
- `npx tsc --noEmit` clean; `npx vitest run src/ui/features/pretty-conversations/` green (313 tests passed)

## Commits

| Hash | Message |
|------|---------|
| `95859ae5` | `refactor(pretty-conversations): remove the header Filter icon and its popover` |
| `d47a7567` | `feat(pretty-conversations): promote New agent, Edit roles, Edit global files to header icons` |
| `0e957c64` | `test(pretty-conversations): repoint header-action coverage at promoted icon buttons` |

## Deviations from Plan

None — plan executed exactly as written.

The only deviation from the literal plan text: the comment added in Task 1 to explain the dead code was initially worded with "anyFilterOn" in it (which would have pushed the count above the expected 3). This was caught by the gate check before commit and corrected. The fix was within-task and did not require a separate commit.

## Known Stubs

None. All promoted actions call the same `useState` setters they called as kebab items. No data stubs or placeholder text introduced.

## Threat Flags

None. This change adds no new input surface, no new network calls, no new props. The three promoted buttons call existing local state setters with the literal `true`. Authorization for the underlying modals is unchanged.

## Self-Check: PASSED

All 7 modified source files exist on disk. All 3 task commits exist in git history. No `.planning/` files were committed by the executor. Nothing was pushed.
