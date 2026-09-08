---
phase: 89-identity-modal-drop-history-handoff-tabs-add-runbooks-tab-ed
verified: 2026-09-08T19:54:35Z
status: human_needed
score: 10/10
overrides_applied: 0
human_verification:
  - test: "Open identity modal for a coordinator identity (e.g. box-maintainer role), switch to Role scope, click Runbooks tab, verify runbook slugs appear as a bare list (no mtime, no file count), click a runbook, verify identity modal closes and runbook editor modal opens."
    expected: "Identity modal disappears. RunbookEditorModal opens with header 'Edit runbook: <slug>'. Files from the runbook folder enumerate in bottom tab strip with full relative paths. No host picker, no runbook picker selects in the header."
    why_human: "Requires live SSH connection to ~/.claude/roles/<role>/runbooks/ on a managed host. Cannot verify SSH roundtrip or actual file enumeration without a running deployment."
  - test: "In the runbook editor modal, click the X (close) button. Observe whether the identity modal reopens."
    expected: "Runbook editor closes. Identity modal does NOT reopen (D-06 swap-not-stack v1 posture)."
    why_human: "The swap-not-stack behavor is tested with a TestHarness in S1/S2 (not full PrettyView). Visual confirmation in the deployed app that PrettyView's handleOpenRunbook + setRunbookEditorOpenState(null) path does not reopen the identity modal."
  - test: "Edit a runbook file in the editor, save, verify the mtime-409 conflict UX. Open two browser tabs, edit the same file in both, save from the first tab, then save from the second tab."
    expected: "Second save returns a conflict dialog offering 'Reload from disk and lose local edits?' Accepting reloads the server version. The tab's content and mtime update to the server-authoritative values."
    why_human: "Requires live SSH write path, real mtime tracking, and concurrent-session setup."
  - test: "Delete a runbook via the Trash2 button in the editor modal header. Confirm in the DeleteConfirmDialog, then verify the runbook folder is gone from the host."
    expected: "DeleteConfirmDialog shows with copy 'This removes the runbook folder and every file inside it. This can't be undone.' Confirming removes the folder. Modal closes."
    why_human: "Requires live SSH connection and destructive operation on real filesystem."
  - test: "Navigate to a Runbooks tab for an identity whose role has no runbooks folder. Verify the empty state renders."
    expected: "Tab body shows 'This role has no runbooks yet.' No error, no spinner."
    why_human: "Requires live backend returning empty list or 200 [] from listRunbooks for that role."
---

# Phase 89: Identity Modal Tab Restructure — Verification Report

**Phase Goal:** Restructure identity modal tab set (drop History + Handoff, add Runbooks launcher tab); add new runbook-editor modal cloning the skills-editor pattern for role-scoped runbooks at `~/.claude/roles/<role>/runbooks/`; update id-skill body to codify `runbook.md` as the going-forward main-file naming convention.

**Verified:** 2026-09-08T19:54:35Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Runbook editing works end-to-end (GB-01) | VERIFIED | Full chain traced: RunbooksTab → onOpenRunbook prop → PrettyView.handleOpenRunbook → setRunbookEditorOpenState → RunbookEditorModal open → runbooks-api.ts 7 helpers → /runbooks-editor backend 7 routes → SSH to `~/.claude/roles/<role>/runbooks/`. No missing links found. |
| 2 | History + Handoff tabs are GONE (GB-02, D-12) | VERIFIED | `HistoryTab.tsx` and `HandoffTab.tsx` files do not exist. No live code in IdentityModal.tsx references `history`, `handoff`, badge/count logic, or lazy-load effects for those tabs. Only comments document their removal. Wire types removed from `claude-session-api.ts`. TelegramTab.tsx L10 is a legitimate historical analog comment (not a live import). |
| 3 | Runbooks tab in right place in NAV_SECTIONS_ROLE (GB-03, D-08, D-11, D-13-alt) | VERIFIED | `NAV_SECTIONS_ROLE` = [role, **runbooks**, bounties, role-wakeups]. Runbooks is second (peer to Role file, before Bounties). TabsContent renders `<RunbooksTab>` with bare list body. Empty state copy "This role has no runbooks yet." present in RunbooksTab.tsx L86. Alphabetical sort at RunbooksTab.tsx L95. |
| 4 | Runbook editor modal is skills-parity (GB-04, D-01, D-02) | VERIFIED | Header shows "Edit runbook: {runbookName}" (L357-358). No `<select>` elements (grep returns 0). Bottom horizontal-scroll tab strip with full relative paths (L510-511). mtime-409 conflict UX (L200-224). Auto-select first tab on open (L119). Delete-runbook uses DeleteConfirmDialog (L554-580). Delete-file uses DeleteConfirmDialog (L525-549). |
| 5 | Swap-not-stack semantic works (GB-05, D-06) | VERIFIED | PrettyView.tsx L1635-1644: `handleOpenRunbook` calls `setIsIdentityModalOpen(false)` + `setRunbookEditorOpenState({roleName, runbookName})` atomically. Runbook editor's `onOpenChange(false)` handler sets `setRunbookEditorOpenState(null)` with NO reopen of identity modal (L3252-3256). 5 test cases S1-S5 in `IdentityModal.runbooks-swap.test.tsx` cover the full flow. |
| 6 | Backend routes are role-scoped and safe (GB-06, D-14–D-18) | VERIFIED | Routes carry `(hostId, roleName, runbookName, [path])`. `ROLE_NAME_RE` + `RUNBOOK_NAME_RE` regex gates + `isSafeRelativePath` + `shellEscape` + `echo $HOME` two-step present (runbooks-editor.ts L107-115, L150-194). Role existence 404 validation at L335 (`role not found`). Same SSH lifecycle (`connectOneShot`, `execWithTimeout`). SEC-1 through SEC-14 labeled path-traversal tests in runbooks-editor.test.ts (14 SEC tests, exceeds ≥ 8 requirement). |
| 7 | id-skill body codifies `runbook.md` convention (GB-07, D-19, D-20) | VERIFIED | `substrate/skills/id/SKILL.md` L1295 says "The main markdown MUST be named `runbook.md`". No grandfather migration rule added. |
| 8 | `onOpenRunbook` prop wired in all 10 test files (GB-08, W-03 sweep) | VERIFIED | All 10 IdentityModal.*.test.tsx files pass `onOpenRunbook={vi.fn()}` or `onOpenRunbook={handleOpenRunbook}` to render helpers: confirmed by grep across all files. |
| 9 | Ship discipline honored (GB-09, D-21) | VERIFIED | No `git push`, `docker build`, `docker compose up`, `docker cp` in any executor commit per SUMMARY files. Wave 6 summary mentions only scoped test runs (`npx vitest run IdentityModal.runbooks-swap.test.tsx`, `npx vitest run src/ui/features/pretty-view/`) — neither is a full-project-suite run. D-21 satisfied. |
| 10 | Fleet standing rules honored (GB-10) | VERIFIED | No worktrees used. `AlarmClock` icon preserved at IdentityModal.tsx L6 and NAV_SECTIONS_ROLE/IDENTITY (L360, L364). Structured `console.debug` logs at key lifecycle boundaries in RunbookEditorModal, RunbooksTab, and PrettyView swap handler (14 debug log calls across the three components). |

**Score:** 10/10 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/ui/features/pretty-view/RunbooksTab.tsx` | Bare list body, 60+ lines | VERIFIED | 113 lines. Fetches via `listRunbooks`, renders sorted rows, empty state, row-click fires `onOpenRunbook`. |
| `src/ui/features/pretty-view/RunbookEditorModal.tsx` | Skills-parity editor modal, 584 lines | VERIFIED | 584 lines. Byte-shape clone of SkillsEditorModal adapted for role-scoped runbooks. |
| `src/ui/api/runbooks-api.ts` | 7 helpers + 2 error classes + 5 types | VERIFIED | All 7 helpers (`listRunbooks`, `enumerateRunbookFiles`, `readRunbookFile`, `writeRunbookFile`, `createRunbookFile`, `deleteRunbookFile`, `deleteRunbook`) present. `RunbookFileMtimeConflictError` and `RunbookFileAlreadyExistsError` present. |
| `src/backend/database/routes/runbooks-editor.ts` | 7 endpoints, role-scoped, path-safe | VERIFIED | 1534 lines. 7 endpoints mounted. Triple-layer path safety. Role validation 404. Same SSH lifecycle. |
| `src/backend/database/routes/runbooks-editor.test.ts` | ≥ 8 SEC tests | VERIFIED | 1217 lines. SEC-1 through SEC-14 (14 labeled SEC tests, plus additional traversal tests). |
| `src/ui/features/pretty-view/IdentityModal.tsx` | History+Handoff removed, Runbooks added, onOpenRunbook prop | VERIFIED | 2612 lines. NAV_SECTIONS_ROLE has [role, runbooks, bounties, role-wakeups]. NAV_SECTIONS_IDENTITY has [identity, identity-wakeups, telegram]. `onOpenRunbook` required prop present. No History/Handoff remnants. |
| `src/ui/features/pretty-view/IdentityModal.runbooks-swap.test.tsx` | 5 swap tests (S1-S5) | VERIFIED | 470 lines. S1-S5 cover full swap flow, close-no-reopen, null-role fast-path, empty-list, alphabetical sort. |
| `substrate/skills/id/SKILL.md` | `runbook.md` naming convention | VERIFIED | L1295 states "MUST be named `runbook.md`". |
| `docker/nginx.conf` + `docker/nginx-https.conf` | `location ~ ^/runbooks-editor(/.*)?$` blocks | VERIFIED | Both nginx confs have the `/runbooks-editor` regex location blocks. |
| `src/backend/database/database.ts` | `app.use("/runbooks-editor", runbooksEditorRoutes)` | VERIFIED | L1902 mounts the router. |
| `src/ui/features/pretty-view/HistoryTab.tsx` | DELETED | VERIFIED | File does not exist. |
| `src/ui/features/pretty-view/HandoffTab.tsx` | DELETED | VERIFIED | File does not exist. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `RunbooksTab.tsx` | `runbooks-api.ts listRunbooks` | `useEffect` on-mount fetch | WIRED | RunbooksTab.tsx L42: `listRunbooks(hostId, roleName)` in effect with cleanup |
| `RunbooksTab.tsx` row click | `props.onOpenRunbook(slug)` | single call site | WIRED | RunbooksTab.tsx L102-104: onClick fires `onOpenRunbook(entry.name)` |
| `IdentityModal.tsx` `onOpenRunbook` prop | `RunbooksTab` | threaded prop | WIRED | IdentityModal.tsx L2195: `<RunbooksTab ... onOpenRunbook={onOpenRunbook}>` |
| `PrettyView.tsx handleOpenRunbook` | `IdentityModal onOpenRunbook` | prop pass | WIRED | PrettyView.tsx L3227: `onOpenRunbook={handleOpenRunbook}` |
| `PrettyView.tsx handleOpenRunbook` | `setIsIdentityModalOpen(false)` + `setRunbookEditorOpenState({...})` | atomic state update | WIRED | PrettyView.tsx L1642-1643 |
| `RunbookEditorModal` | `runbooks-api.ts enumerateRunbookFiles` | `useEffect` on open | WIRED | RunbookEditorModal.tsx L113 |
| `RunbookEditorModal` | `runbooks-api.ts readRunbookFile` | `useEffect` on activeTab | WIRED | RunbookEditorModal.tsx L142 |
| `RunbookEditorModal handleSave` | `runbooks-api.ts writeRunbookFile` | async call | WIRED | RunbookEditorModal.tsx L180 |
| `runbooks-api.ts` | `/runbooks-editor/runbooks` (backend) | `authApi.get` | WIRED | runbooks-api.ts L80 |
| `runbooks-editor.ts` | SSH via `connectOneShot` | `~/.claude/roles/<role>/runbooks/` | WIRED | runbooks-editor.ts L74 import, L283-288 usage |
| `database.ts` | `runbooksEditorRoutes` | `app.use("/runbooks-editor", ...)` | WIRED | database.ts L1902 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `RunbooksTab.tsx` | `runbooks` state (`TabState<RunbookEntry[]>`) | `listRunbooks(hostId, roleName)` → GET `/runbooks-editor/runbooks` → SSH `find ~/.claude/roles/<role>/runbooks/ -mindepth 1 -maxdepth 1 -type d` | Yes — SSH find command returns actual folder names | FLOWING |
| `RunbookEditorModal.tsx` | `files` state (`TabState<RunbookFileEntry[]>`) | `enumerateRunbookFiles(hostId, roleName, runbookName)` → GET `/runbooks-editor/files` → SSH `find <runbookRoot> -type f -printf '%P\n' \| sort` | Yes — SSH find returns actual files | FLOWING |
| `RunbookEditorModal.tsx` | `tabData` map (file content) | `readRunbookFile(hostId, roleName, runbookName, activeTab)` → POST `/runbooks-editor/read` → SSH cat | Yes — SSH cat returns actual file content with mtime | FLOWING |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED — app requires live SSH connections to managed hosts. No runnable entry points available in isolation that exercise the SSH path. Covered by human verification items instead.

---

### Probe Execution

Step 7c: No probes declared in PLAN files and no `scripts/*/tests/probe-*.sh` found for this phase.

---

### Requirements Coverage

No `requirements:` field in any of the 6 PLAN files (all set to `[]`). Phase 89 was planned without explicit REQUIREMENTS.md IDs. No orphaned requirements to check.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `runbooks-editor.ts` L554 | `// placeholder branch` | Comment (legitimate) | Info | Describes UI placeholder behavior for binary files (`!isText` → content = ""). Not a stub — intentional design per D-03. No action required. |
| `runbooks-api.ts` L114 | `// frontend renders placeholder` | Comment (legitimate) | Info | Same `!isText` documentation. Not a stub. |

No `TBD`, `FIXME`, or `XXX` markers found in any of the 4 new/modified source files. No unreferenced debt markers. No stub implementations. No hardcoded empty arrays flowing to rendering without real data.

---

### Human Verification Required

#### 1. Runbooks Tab Live Enumeration

**Test:** Open identity modal for an identity whose role has a populated `~/.claude/roles/<role>/runbooks/` directory. Switch to Role scope, click the Runbooks tab. Observe the rendered list.
**Expected:** Runbook slug rows appear as a bare clickable list (no peek info, no mtime, no file count). Rows appear in alphabetical order. Tab renders immediately with the list, no indefinite spinner.
**Why human:** Requires a live SSH connection to a managed host with actual runbook folders. Cannot verify SSH enumeration path without a running deployment.

#### 2. Swap-not-Stack Visual Confirmation in PrettyView

**Test:** In the full PrettyView (not the TestHarness), click a runbook row in the Runbooks tab. Observe the identity modal close and the runbook editor open. Then close the runbook editor with the X button. Observe whether the identity modal reopens.
**Expected:** Identity modal disappears at the moment the runbook editor opens (one frame — no flicker of both visible). Closing the runbook editor does NOT reopen the identity modal.
**Why human:** The TestHarness (S1/S2) validates the coordination shape. The visual/timing behavior in actual PrettyView (with real WS connections, portal targets, z-index layers) needs eyeball confirmation.

#### 3. mtime-409 Conflict Dialog UX

**Test:** Open the same runbook file in two separate browser sessions. Edit in session A, save. Then attempt to save in session B (which has a stale mtime).
**Expected:** Session B's save shows a browser `confirm()` dialog: "The file changed on disk since you started editing. Reload from disk and lose your local edits?" Accepting reloads with the server version. The mtime updates and the next save succeeds.
**Why human:** Requires two concurrent live SSH sessions and real mtime tracking.

#### 4. Delete Runbook Flow

**Test:** Click the Trash2 icon in the runbook editor header. Observe the DeleteConfirmDialog. Confirm deletion.
**Expected:** Dialog shows heading "Delete runbook?" with body text "This removes the runbook folder and every file inside it. This can't be undone." Confirming sends DELETE `/runbooks-editor/runbook`. The runbook folder is removed from the host. The modal closes.
**Why human:** Requires live SSH and is destructive — cannot exercise safely without a real host.

#### 5. Empty Runbooks State

**Test:** Open identity modal for an identity whose role has no runbooks folder (or an empty one). Switch to Role scope, click Runbooks tab.
**Expected:** Tab body shows "This role has no runbooks yet." with no error, no spinner, no affordance to create a runbook.
**Why human:** Requires a live host state where the runbooks folder is absent.

---

## Gaps Summary

No gaps identified. All 10 must-have truths are VERIFIED by codebase inspection. The phase delivered:

- History and Handoff tabs fully removed (files deleted, state/handlers/wire-types purged)
- Runbooks tab added as second entry in NAV_SECTIONS_ROLE with correct bare-list body
- RunbookEditorModal at 584 lines with skills-parity feature set (no host/runbook pickers, full relative path tab labels, mtime-409 UX, delete-runbook/delete-file via DeleteConfirmDialog, auto-select first tab)
- Swap-not-stack coordination wired in PrettyView with 5 in-process tests (S1-S5)
- Backend 7-endpoint router with 14 SEC-labeled path-traversal tests mounted in database.ts and both nginx confs
- Frontend 7-helper API client mirroring skills-api.ts shape
- id-skill body updated to `runbook.md` sentinel convention
- All 10 IdentityModal test files updated with `onOpenRunbook={vi.fn()}`

The 5 human verification items all require a live SSH-connected deployment to exercise the actual data path. They are end-to-end behavioral tests, not indicators of incomplete implementation.

---

_Verified: 2026-09-08T19:54:35Z_
_Verifier: Claude (gsd-verifier)_
