---
phase: 89-identity-modal-drop-history-handoff-tabs-add-runbooks-tab-ed
plan: "06"
subsystem: frontend-identity-modal-swap-coordination
tags: [frontend, modal, runbooks, swap-not-stack, react, typescript, testing]
dependency_graph:
  requires: [89-05, 89-04]
  provides: [PrettyView.swap-coordination, IdentityModal.runbooks-swap.test]
  affects: []
tech_stack:
  added: []
  patterns:
    - Swap-not-stack modal coordination via two state setters in same tick (D-06)
    - runbookEditorOpenState {roleName, runbookName} | null pattern mirrors editorOpenState shape
    - Gated modal mount (runbookEditorOpenState && <RunbookEditorModal open={true} ...>)
    - TestHarness pattern for in-process coordination logic tests (avoids full PrettyView mount)
    - vi.mocked(listRunbooks).mockResolvedValue() per-test control for API layer
key_files:
  created:
    - src/ui/features/pretty-view/IdentityModal.runbooks-swap.test.tsx
  modified:
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/IdentityModal.scope-switch.test.tsx
decisions:
  - "D-06 swap-not-stack implemented: handleOpenRunbook calls setIsIdentityModalOpen(false) + setRunbookEditorOpenState({roleName, runbookName}) at the same tick — React batches both state updates so the transition is atomic (one render: identity modal gone, runbook editor visible)"
  - "RunbookEditorModal mount gated on runbookEditorOpenState !== null (not pvIdentity !== null) — the state slot IS the render signal; once open, the modal uses its own resolved props"
  - "RunbookEditorModal has no container prop — portals to document.body (top-level surface per D-06, unlike IdentityModal which portals into chatRegionEl per patch #108)"
  - "TestHarness chosen over full PrettyView mount — PrettyView has too many upstream dependencies (hostTree, WS-store, harness panels); TestHarness proves the coordination SHAPE (same state slot + handler + gated mount) which is the real behavioral contract"
  - "Rule 1 auto-fix applied to IdentityModal.scope-switch.test.tsx S8 — test referenced removed Handoff tab (D-12 Phase 89 Plan 05); updated to use Wakeups tab which still exists in identity scope"
metrics:
  duration: ~20 minutes
  completed: "2026-09-08"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 2
---

# Phase 89 Plan 06: PrettyView swap-not-stack coordination + in-process user-flow test suite

Wave-6 integration: PrettyView wires the D-06 swap-not-stack coordination (runbookEditorOpenState state slot + handleOpenRunbook handler + RunbookEditorModal mount), plus a 470-line vitest suite (S1-S5) that locks the swap invariant by walking the full identity modal → Runbooks tab → click row → editor opens → close editor → identity modal STAYS closed flow.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | PrettyView swap coordination: runbookEditorOpenState + handleOpenRunbook + IdentityModal wiring + RunbookEditorModal mount | dd8fe76e | src/ui/features/pretty-view/PrettyView.tsx, src/ui/features/pretty-view/IdentityModal.scope-switch.test.tsx |
| 2 | Create IdentityModal.runbooks-swap.test.tsx — 5-test in-process suite (S1-S5) | 2b4e6c9d | src/ui/features/pretty-view/IdentityModal.runbooks-swap.test.tsx |

## What Was Built

### src/ui/features/pretty-view/PrettyView.tsx (MODIFIED)

Five coordinated sub-edits:

- **EDIT A:** `import RunbookEditorModal from "./RunbookEditorModal"` added alongside existing IdentityModal import (default export — matches Plan 89-04 output).

- **EDIT B:** New state slot `runbookEditorOpenState: { roleName: string; runbookName: string } | null` added immediately after `isIdentityModalOpen` state. Comment block explains D-06 swap-not-stack semantics and the no-reopen-on-close posture.

- **EDIT C:** New `handleOpenRunbook` useCallback added before `handleStageEditedFile`. Reads `pvIdentity?.role`, guards null (log + return), then fires `setIsIdentityModalOpen(false)` + `setRunbookEditorOpenState({ roleName, runbookName })` at the same tick. Structured debug logs at both the swap boundary and the no-role-guard path.

- **EDIT D:** `onOpenRunbook={handleOpenRunbook}` prop added to the existing `<IdentityModal>` render alongside the existing hostId/hue/container props. One-line comment anchor.

- **EDIT E:** `{runbookEditorOpenState && <RunbookEditorModal ... />}` gated mount added immediately before the existing `{editorOpenState && <EditableFileModal ...>}` block. `onOpenChange(false)` sets state to null only — no `setIsIdentityModalOpen(true)` call anywhere (D-06 swap-not-stack invariant). `container` prop omitted (document.body default, top-level surface).

### src/ui/features/pretty-view/IdentityModal.runbooks-swap.test.tsx (470 lines, NEW)

In-process vitest suite with a TestHarness that mirrors PrettyView's coordination shape:

- **TestHarness:** React component with `isIdModalOpen` + `runbookOpen` state slots + `handleOpenRunbook` callback + gated `<RunbookEditorModal>` mount. Renders `<IdentityModal>` + optionally `<RunbookEditorModal>` — real components, no shallow mocks.

- **S1 (happy path):** mount → switch to Role scope → click Runbooks tab → wait for rows → click "avatar-flow" → assert `Edit runbook: avatar-flow` visible + identity modal scope switch gone (identity modal closed).

- **S2 (D-06 invariant locked):** same setup through S1 → click Close button on RunbookEditorModal → assert editor unmounts + identity modal STILL closed (no scope switch rendered, no dialogs visible). This test is the repudiation gate for the D-06 invariant — future refactors that accidentally add `setIsIdentityModalOpen(true)` to the close handler break this test loud.

- **S3 (null-role fast path):** identity.role=null → switch to Role scope → click Runbooks tab → assert "This role has no runbooks yet." rendered → assert `listRunbooks` NOT called (D-10 fast-path).

- **S4 (empty list):** role='box-maintainer', listRunbooks returns [] → assert empty state copy visible → assert `listRunbooks` WAS called once (role present, fetch fired, folder empty).

- **S5 (alphabetical sort):** listRunbooks returns [{name:'zebra'},{name:'apple'},{name:'mango'}] → assert rows in DOM order are ['apple','mango','zebra'] (D-09 localeCompare sort).

**Mocks:** `@/api/runbooks-api` mocked in full (listRunbooks controlled per-test; enumerateRunbookFiles stubs to [] so RunbookEditorModal renders "no files" without network; all other API functions stubbed). WS mock same shape as coordinator-empty.test.tsx.

## Deviations from Plan

### Auto-fix (Rule 1 — Bug): IdentityModal.scope-switch.test.tsx test S8 updated

**Found during:** Task 1 scoped test run (all pretty-view tests)
**Issue:** S8 referenced a "Handoff" nav button (`b.textContent?.includes("Handoff")`) to find a non-default tab, then asserted `activePanelIdSuffix() === "handoff"`. Handoff tab was removed in Phase 89 Plan 05 (EDIT C.7/C.12 per 89-05-SUMMARY.md). The test file was listed as modified in Plan 05 but the S8 test's Handoff reference was not updated — causing `expect(handoffNavBtn).toBeDefined()` to fail (handoffNavBtn is `undefined`).
**Fix:** Updated S8 to use the "Wakeups" (identity-wakeups) tab instead of "Handoff". Wakeups is still present in the Identity scope post-restructure and is a non-default tab (correct test semantics preserved). Also updated the file header S8 description. Assertion now checks `activePanelIdSuffix() === "identity-wakeups"` before the scope flip and `=== "role"` after.
**Files modified:** `src/ui/features/pretty-view/IdentityModal.scope-switch.test.tsx`
**Commit:** dd8fe76e (bundled with Task 1 since the fix was needed for the scoped test run to pass)

## Known Stubs

None. All data paths are wired: RunbooksTab fetches from real listRunbooks (mocked in tests); RunbookEditorModal calls real enumerateRunbookFiles/readRunbookFile (mocked in tests); PrettyView's swap coordination is wired to IdentityModal's onOpenRunbook prop which is wired to RunbooksTab's row click. No placeholder data paths remain.

## Threat Flags

None. No new network endpoints introduced. The two threat register items are mitigated:
- **T-89-06-01 (Repudiation — swap invariant):** S2 test locks the D-06 invariant. `grep -c 'setIsIdentityModalOpen(true)' PrettyView.tsx` = 1 (pre-existing single call, not in handleOpenRunbook or runbook editor close handler — count unchanged from pre-edit).
- **T-89-06-02 (DoS — null-role guard):** handleOpenRunbook defensive guard implemented (`if (roleName === null) { console.debug(...); return; }`). S3 test exercises the null-role path end-to-end.

## Self-Check: PASSED

- `src/ui/features/pretty-view/PrettyView.tsx` modified — CONFIRMED (dd8fe76e)
- `src/ui/features/pretty-view/IdentityModal.runbooks-swap.test.tsx` exists — FOUND (470 lines)
- `src/ui/features/pretty-view/IdentityModal.scope-switch.test.tsx` updated — CONFIRMED (S8 fixed)
- Commit `dd8fe76e` exists — FOUND (Task 1)
- Commit `2b4e6c9d` exists — FOUND (Task 2)
- All Task 1 grep acceptance criteria — PASSED (all 8 checks)
- All Task 2 grep acceptance criteria — PASSED (all 12 checks)
- `npx tsc --noEmit` — CLEAN
- `npx vitest run IdentityModal.runbooks-swap.test.tsx` — 5/5 PASSED (S1-S5)
- `npx vitest run src/ui/features/pretty-view/` — 78/78 test files passed, 924 tests passed
- NO git push, NO docker command
