---
phase: 89-identity-modal-drop-history-handoff-tabs-add-runbooks-tab-ed
plan: "05"
subsystem: frontend-identity-modal-tab-restructure
tags: [frontend, modal, runbooks, tab-removal, react, typescript]
dependency_graph:
  requires: [89-04]
  provides: [RunbooksTab, IdentityModal.onOpenRunbook]
  affects: [PrettyView-wave-6]
tech_stack:
  added: []
  patterns:
    - TabState<T> discriminated union for loading/error/ready branches (mirrors IdentityFileTab)
    - listRunbooks HTTP fetch with cancellation flag (same race-safety as role-tab fetches)
    - Required prop contract (no fail-closed default) for Wave-6 coordination
    - vi.mock('@/api/runbooks-api') stub pattern in all 10 IdentityModal test files
key_files:
  created:
    - src/ui/features/pretty-view/RunbooksTab.tsx
  modified:
    - src/ui/features/pretty-view/IdentityModal.tsx
    - src/ui/api/claude-session-api.ts
    - src/ui/features/pretty-view/IdentityModal.coordinator-empty.test.tsx
    - src/ui/features/pretty-view/IdentityModal.role-tab.test.tsx
    - src/ui/features/pretty-view/IdentityModal.test.tsx
    - src/ui/features/pretty-view/IdentityModal.scope-switch.test.tsx
    - src/ui/features/pretty-view/IdentityModal.wakeup-crud.test.tsx
    - src/ui/features/pretty-view/IdentityModal.bounties-filter.test.tsx
    - src/ui/features/pretty-view/IdentityModal.stays-awake.test.tsx
    - src/ui/features/pretty-view/IdentityModal.inherit-override.test.tsx
    - src/ui/features/pretty-view/IdentityModal.lazy-archive.test.tsx
    - src/ui/features/pretty-view/IdentityModal.voice.test.tsx
    - src/ui/features/pretty-view/IdentityModal.wakeup-crud.test.tsx
decisions:
  - "Role scope tab order post-Phase-89: [role, runbooks, bounties, role-wakeups] — Runbooks is second per D-13 spirit; D-13's literal flat order requires a Phase-72-Plan-03 scope-regrouping (own bounty)"
  - "Identity scope tab order post-Phase-89: [identity, identity-wakeups, telegram] — Handoff removed per D-12"
  - "onOpenRunbook has no default — TypeScript enforces required-prop contract; Wave 6 PrettyView supplies the swap-not-stack implementation"
  - "vi.mock('@/api/runbooks-api') added to all 10 IdentityModal test files (Rule 2 auto-fix) so RunbooksTab's HTTP fetch doesn't error in jsdom environment"
  - "role-tab.test.tsx tests 22a + 22b updated for new tab counts: Role scope = 4 (unchanged count, Runbooks replaces History at position 2), Identity scope = 3 (was 4, Handoff removed)"
metrics:
  duration: ~25 minutes
  completed: "2026-09-08"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 14
---

# Phase 89 Plan 05: Identity Modal Tab Restructure — Remove History+Handoff, Add Runbooks

Wave-5 identity modal integration: remove History and Handoff tabs entirely, add Runbooks tab body (bare list launcher), wire onOpenRunbook required prop through to Wave-6 PrettyView coordination.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create RunbooksTab.tsx bare-list body per D-08 through D-11 | c4eb2f1e | src/ui/features/pretty-view/RunbooksTab.tsx |
| 2 | Update IdentityModal.tsx — remove History+Handoff, add Runbooks; delete HistoryTab.tsx + HandoffTab.tsx; prune claude-session-api.ts; update tests | c6741e60 | 14 files (2 deleted, 12 modified) |

## What Was Built

### src/ui/features/pretty-view/RunbooksTab.tsx (113 lines, NEW)

Bare-list Runbooks tab body per D-08 through D-11.

**Props:** `hostId: number`, `roleName: string | null`, `onOpenRunbook: (runbookName: string) => void` (required, no default).

**Behavior:**
- `roleName === null` fast-paths to empty state (D-11: tab always renders even for coord identities with no role)
- Fetches `listRunbooks(hostId, roleName)` on mount + dep change with cancellation flag
- Loading: 3 Skeleton placeholder rows
- Error: red text with error message
- Empty: "This role has no runbooks yet." (D-10 exact copy, no create affordance)
- List: alphabetically sorted via `localeCompare` (D-09), button rows, click fires `onOpenRunbook(entry.name)` — only interaction per D-08

**Structured logging:** `[RunbooksTab]` prefix at fetch / fetch-ready / fetch-error / row-click boundaries.

### src/ui/features/pretty-view/IdentityModal.tsx (MODIFIED)

13 coordinated sub-edits per plan EDIT C:

- **C.1:** lucide-react import: `Clock` + `Handshake` removed, `BookOpen` added
- **C.2+C.3:** 8 history+handoff WS type imports removed from claude-session-api import block
- **C.4:** `HistoryTab` + `HandoffTab` component imports removed; `RunbooksTab` import added
- **C.5:** New required prop: `onOpenRunbook: (runbookName: string) => void` with JSDoc in props interface
- **C.6:** `NAV_SECTIONS_ROLE` = `[role, runbooks(NEW), bounties, role-wakeups]` — History removed, Runbooks inserted at position 2
- **C.7:** `NAV_SECTIONS_IDENTITY` = `[identity, identity-wakeups, telegram]` — Handoff removed
- **C.8:** `historyState` + `handoffState` useState slots deleted
- **C.9:** `setHistoryState` + `setHandoffState` calls removed from reset-on-open effect
- **C.10:** `openOneShot` blocks for `identity:get-history` + `identity:get-handoff` removed
- **C.11:** `updateHistory` + `updateHandoff` save handler functions deleted
- **C.12:** `<TabsContent value="history">` + `<TabsContent value="handoff">` removed; new `<TabsContent value="runbooks">` inserted after Role tab with `<RunbooksTab hostId={hostId} roleName={identity.role} onOpenRunbook={onOpenRunbook} />`
- **C.13:** Historical comment block rewritten — HistoryTab/HandoffTab attributions replaced with RunbooksTab + Phase 89 Plan 05 bread-crumb

### src/ui/api/claude-session-api.ts (MODIFIED)

Deleted 8 history+handoff frontend wire type exports (D.1 + D.2):
- `IdentityGetHistoryPayload`, `IdentityHistoryEvent`
- `IdentityGetHandoffPayload`, `IdentityHandoffEvent`
- `IdentityUpdateHistoryPayload`, `IdentityHistoryUpdatedEvent`
- `IdentityUpdateHandoffPayload`, `IdentityHandoffUpdatedEvent`

Also removed `IdentityHistoryEvent | IdentityHandoffEvent` union entries from the discriminated union export (D.3). Rewrote the docblock comment to remove history+handoff wire references (D.4). Backend WS handlers for these types are intentionally preserved per D-12 scope.

### src/ui/features/pretty-view/HistoryTab.tsx + HandoffTab.tsx (DELETED)

Both files deleted via `git rm` — no other consumers in `src/ui/` (verified by B-02 grep gate).

### IdentityModal test files (10 FILES MODIFIED)

- **coordinator-empty.test.tsx:** C2 test + `deliverHandoff` helper deleted; C2 line removed from file header comment; `onOpenRunbook={vi.fn()}` added to `renderModal`; `vi.mock('@/api/runbooks-api')` added
- **role-tab.test.tsx:** Tests 22a + 22b updated for new tab counts/order; `onOpenRunbook={vi.fn()}` + `vi.mock('@/api/runbooks-api')` added
- **All other 8 test files:** `onOpenRunbook={vi.fn()}` added to renderModal; `vi.mock('@/api/runbooks-api')` added

## Deviations from Plan

### Auto-fix (Rule 2): vi.mock('@/api/runbooks-api') added to all 10 test files

**Found during:** Task 2 implementation
**Issue:** RunbooksTab calls `listRunbooks` via HTTP (`authApi.get`). The IdentityModal tests don't mock `@/api/runbooks-api`, which would cause network errors in jsdom. The plan's W-03 sweep gate required all 10 test files to pass `onOpenRunbook` but didn't explicitly specify the API mock.
**Fix:** Added `vi.mock("@/api/runbooks-api", () => ({ listRunbooks: vi.fn().mockResolvedValue([]) }))` to all 10 test files before their late imports section.
**Files modified:** All 10 IdentityModal test files
**Commits:** c6741e60

### Auto-fix (Rule 2): role-tab.test.tsx tests 22a + 22b updated for new tab counts

**Found during:** Task 2 scoped vitest run
**Issue:** Tests 22a and 22b had hardcoded expectations from pre-Phase-89 tab counts. Test 22a expected `navButtons[1]` to be "Bounties" (now it's "Runbooks"). Test 22b expected 4 Identity-scope tabs including Handoff (now 3).
**Fix:** Updated assertions to match new tab structure: Role scope = 4 tabs (role, runbooks, bounties, wakeups); Identity scope = 3 tabs (identity, identity-wakeups, telegram).
**Files modified:** `src/ui/features/pretty-view/IdentityModal.role-tab.test.tsx`
**Commits:** c6741e60

## Known Stubs

None. RunbooksTab fetches real data and renders it. The empty state is intended behavior per D-10. Wave 6 (PrettyView) still needs to supply the `onOpenRunbook` implementation — that is not a stub in this component (it's a required prop contract).

## Threat Flags

None. No new network endpoints introduced. The `onOpenRunbook` trust boundary (identity modal fires runbookName up to PrettyView) is documented in the plan's threat model at T-89-05-01 / T-89-05-02. Both mitigations are applied: T-89-05-01 — all history/handoff fetch effects removed (grep gates return 0); T-89-05-02 — C2 test deleted alongside the deleted feature.

## Self-Check: PASSED

- `src/ui/features/pretty-view/RunbooksTab.tsx` exists: FOUND (113 lines)
- `src/ui/features/pretty-view/HistoryTab.tsx` does NOT exist: CONFIRMED
- `src/ui/features/pretty-view/HandoffTab.tsx` does NOT exist: CONFIRMED
- Commit `c4eb2f1e` exists: FOUND (Task 1)
- Commit `c6741e60` exists: FOUND (Task 2)
- All grep acceptance criteria: PASSED (verified by automated verify script)
- `npx tsc --noEmit`: CLEAN
- `npx vitest run coordinator-empty + role-tab`: 11/11 PASSED
