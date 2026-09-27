---
phase: 137-preferences-modal-from-sidebar-gear-voice-fallback-notificat
plan: "05"
subsystem: preferences-modal
tags:
  - about-you
  - global-files
  - markdown-editor
  - tdd
  - mtime-concurrency
dependency_graph:
  requires:
    - "137-02"
    - "137-04"
  provides:
    - "PreferencesAboutYouPane — full folded-in About-you editor"
    - "GlobalFilesModal retired (D-29)"
  affects:
    - "src/ui/features/pretty-view/PreferencesAboutYouPane.tsx"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
tech_stack:
  added: []
  patterns:
    - "TDD RED/GREEN cycle"
    - "mtime-optimistic-concurrency with 409 conflict UX"
    - "shared MarkdownEditor wrapper (not raw textarea)"
    - "multi-host/multi-file fallback fences"
key_files:
  created:
    - "src/ui/features/pretty-view/PreferencesAboutYouPane.tsx"
    - "src/ui/features/pretty-view/PreferencesAboutYouPane.test.tsx"
  modified:
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.send-feedback-button.test.tsx"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.role-management-flow.test.tsx"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.scheduled-agents-button.test.tsx"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.relay-room.test.tsx"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.projects.test.tsx"
    - "src/ui/features/pretty-conversations/NewConversationModal.flow.test.tsx"
    - "src/ui/sidebar/NewSessionDialog.test.tsx"
  deleted:
    - "src/ui/features/pretty-view/GlobalFilesModal.tsx"
    - "src/ui/features/pretty-view/GlobalFilesModal.test.tsx"
decisions:
  - "PreferencesAboutYouPane uses MarkdownEditor wrapper per D-24 — not raw textarea or direct MDXEditor mount"
  - "mtime-optimistic-concurrency save flow copied verbatim from GlobalFilesModal per D-26"
  - "Host picker shown only when flatHosts.length > 1 (D-27); tab strip only when files.data.length > 1 (D-28)"
  - "Comment-only references to GlobalFilesModal in SkillsEditorModal, EditableFileModal, etc. preserved as archaeology — only active importers removed"
metrics:
  duration: "~15 minutes"
  completed: "2026-09-27"
  tasks_completed: 2
  files_created: 2
  files_deleted: 2
  files_modified: 11
  tests_added: 8
  tests_passing: 8
---

# Phase 137 Plan 05: About-you Pane Fold-in + Globe Retirement Summary

PreferencesAboutYouPane fully implemented with host picker + tab strip + MarkdownEditor + mtime-optimistic-concurrency save flow; GlobalFilesModal.tsx and its test deleted; Globe button retired from sidebar footer.

## Task 1: Populate PreferencesAboutYouPane

### What was built

`src/ui/features/pretty-view/PreferencesAboutYouPane.tsx` (254 lines) — full fold-in of GlobalFilesModal interior into the About-you pane:

- **State atoms** copied verbatim from GlobalFilesModal: `selectedHostId`, `files`, `activeTab`, `tabData`
- **Host auto-select useEffect** (verbatim from GlobalFilesModal L78-94): prefers `defaultHostId` if valid, else auto-selects sole host
- **Files fetch useEffect** (verbatim from GlobalFilesModal L97-119): calls `listGlobalFiles`, sets active tab to first entry
- **Lazy per-tab content load useEffect** (verbatim from GlobalFilesModal L121-155): includes intentional exhaustive-deps suppression to avoid race condition
- **handleSave useCallback** (verbatim from GlobalFilesModal L157-189): calls `writeGlobalFile`, updates tab with server-authoritative mtime, 409 conflict UX with `window.confirm` + reload or rethrow
- **D-22 blurb**: "Tell your agents anything you want them to know about you — how you work, your preferences, anything." rendered verbatim
- **D-24**: `<MarkdownEditor>` wrapper used; zero raw `<textarea>` or direct `MDXEditor` mounts
- **D-25**: Explicit Save button disabled when `draft === activeTabState.data.content || saving`
- **D-26**: 409 mtime conflict UX preserved verbatim with `window.confirm`
- **D-27**: `{showHostPicker && <div data-testid="preferences-about-you-host-picker">...}` — only when `flatHosts.length > 1`
- **D-28**: Tab strip only when `files.data.length > 1`; first tab labeled "About you" when path matches `IMPLICIT_ABOUT_YOU_PATH` (`~/.claude/CLAUDE.md`)
- **Pitfall 4 fix**: `<div className="flex-1 min-h-0">` wrapping `<MarkdownEditor>` for height cascade

### Tests: 8/8 passing

`src/ui/features/pretty-view/PreferencesAboutYouPane.test.tsx`:

| # | Test | Status |
|---|------|--------|
| 1 | single-host single-file: content loads, Save calls writeGlobalFile | PASS |
| 2 | multi-host: picker renders, changing selection refetches files | PASS |
| 3 | multi-file: tab strip renders, first tab "About you", switching lazy-loads | PASS |
| 4 | 409 conflict on confirm: editor resets to server content | PASS |
| 4b | 409 conflict on cancel: inline error shown | PASS |
| 5 | single-host: NO host picker rendered | PASS |
| 6 | single-file: NO tab strip rendered | PASS |
| blurb | D-22 blurb verbatim | PASS |

### TDD Gate Compliance

RED phase committed at `057467b5` — all 8 tests failing against stub.
GREEN phase committed at `75a878a7` — all 8 tests passing after full implementation.

## Task 2: Retire Globe button + GlobalFilesModal

### Deletions

- `src/ui/features/pretty-view/GlobalFilesModal.tsx` — deleted via `git rm` ✓
- `src/ui/features/pretty-view/GlobalFilesModal.test.tsx` — deleted via `git rm` ✓

### PrettyConversationsPanel.tsx changes

- Removed `import GlobalFilesModal from "@/features/pretty-view/GlobalFilesModal"` (line 66)
- Removed `Globe` from lucide-react imports (only used by the Globe button)
- Removed `const [globalFilesModalOpen, setGlobalFilesModalOpen] = useState(false)` state atom
- Removed `<button data-testid="pv-footer-global-files-button">` Globe button block (D-29)
- Removed `<GlobalFilesModal ...>` portal mount

### Stale mock cleanup

9 test files that had `vi.mock("@/features/pretty-view/GlobalFilesModal", ...)` stubs were cleaned up — those mocks prevented loading the real module dep tree in tests that rendered PrettyConversationsPanel. Since the panel no longer imports GlobalFilesModal, the mocks were orphaned.

Files cleaned:
- `PrettyConversationsPanel.test.tsx`
- `PrettyConversationsPanel.send-feedback-button.test.tsx`
- `PrettyConversationsPanel.role-management-flow.test.tsx`
- `PrettyConversationsPanel.scheduled-agents-button.test.tsx`
- `PrettyConversationsPanel.new-role-button.test.tsx`
- `PrettyConversationsPanel.relay-room.test.tsx`
- `PrettyConversationsPanel.projects.test.tsx`
- `NewConversationModal.flow.test.tsx`
- `NewSessionDialog.test.tsx`

### Grep verification

```
grep -rn "^import.*GlobalFilesModal|<GlobalFilesModal" src/  → 0 matches
grep -c "globalFilesModalOpen" PrettyConversationsPanel.tsx   → 0
grep -c 'pv-footer-global-files-button' PrettyConversationsPanel.tsx → 0
```

Note: Historical comment references remain in `SkillsEditorModal.tsx`, `EditableFileModal.tsx`, `GlobalFileTab.tsx`, etc. where they cite GlobalFilesModal as the provenance source. These are documentation/archaeology and not active importers. Cleaning them would be out-of-scope for this task (deviation guard: touches unrelated files not in the task's files list).

## Deviations from Plan

### Auto-fixed Issues

None.

### Documented Deviations

**1. [Comment-only GlobalFilesModal references survive grep]**
- **Found during:** Task 2 verification
- **Issue:** The plan acceptance criteria states `grep -rn "GlobalFilesModal" src/` returns 0, but historical provenance comments in SkillsEditorModal.tsx, EditableFileModal.tsx, GlobalFileTab.tsx, DeleteConfirmDialog.tsx, RolesListModal.tsx, and others cite GlobalFilesModal as the code source. These are passive documentation, not active importers.
- **Resolution:** All active importers removed (zero `import GlobalFilesModal` or `<GlobalFilesModal` references). Comment-only references preserved as archaeology per scope boundary rule. Documented here.
- **Files with comment-only references:** SkillsEditorModal.tsx (pattern source comments), EditableFileModal.tsx (verbatim-copy notes), GlobalFileTab.tsx (original module context), DeleteConfirmDialog.tsx, RolesListModal.tsx, PrettyConversationsPanel.tsx (updated to past tense)

**2. [test assertion `toBeDisabled` unavailable]**
- **Found during:** Task 1 RED → GREEN
- **Issue:** `@testing-library/jest-dom`'s `toBeDisabled` matcher not available in this test config
- **Fix:** Changed to `(saveBtn as HTMLButtonElement).disabled === false` — equivalent assertion

## 409 Mtime Conflict UX Regression Test

Test case 4 in `PreferencesAboutYouPane.test.tsx`:
- `writeGlobalFile` rejects with `GlobalFileMtimeConflictError`
- `window.confirm` is called with "The file changed on disk..."
- On `confirm()` returning `true`: editor resets to `err.currentContent` (server version)
- On `confirm()` returning `false`: inline error displayed via `data-testid="preferences-about-you-save-error"`

Both branches tested and **passing**.

## Self-Check

### Files exist:

- `/home/ubuntu/fleet/identities/fable-box-maintainer/workspace/skynet/src/ui/features/pretty-view/PreferencesAboutYouPane.tsx` — EXISTS
- `/home/ubuntu/fleet/identities/fable-box-maintainer/workspace/skynet/src/ui/features/pretty-view/PreferencesAboutYouPane.test.tsx` — EXISTS
- `GlobalFilesModal.tsx` — DELETED (PASS)
- `GlobalFilesModal.test.tsx` — DELETED (PASS)

### Commits:

- `057467b5`: test(137-05): TDD RED
- `75a878a7`: feat(137-05): TDD GREEN
- `79278c8f`: feat(137-05): retire Globe button + GlobalFilesModal
- `f6d63bde`: fix(137-05): update comment mentioning retired pv-footer-global-files-button

## Self-Check: PASSED
