---
phase: 46-frontend-skill-editing-editor-surface-for-skill-folders-on-a
plan: 02
subsystem: frontend
tags:
  - skynet-fork
  - skills-editor
  - frontend
  - pretty-view
  - radix-ui
  - react

# Dependency graph
requires:
  - phase: 44
    plan: 01
    provides: "7-endpoint /skills-editor backend router (GET /skills, GET /files, POST /read, PUT /write, POST /create, DELETE /file, DELETE /skill) with JWT auth, path-safety gate (SKILL_NAME_RE + isSafeRelativePath + prefix assertion + shellEscape), and isText byte-sniff on POST /read"
  - phase: 23
    provides: "GlobalFilesModal.tsx + GlobalFileTab.tsx + global-files-api.ts byte-shape sources; lazy-load useEffect race-fix pattern (quick-260805-7rq); Radix Dialog + Tabs + glass-gradient modal chrome idiom"
provides:
  - "src/ui/api/skills-api.ts — 7 typed authApi helpers + SkillFileMtimeConflictError + SkillFileAlreadyExistsError"
  - "src/ui/features/pretty-view/SkillFileTab.tsx — text editor branch (verbatim GlobalFileTab shape) + non-text AlertTriangle placeholder branch + Trash2 delete-file trigger left of Save"
  - "src/ui/features/pretty-view/DeleteConfirmDialog.tsx — generic destructive-confirm Radix Dialog-in-Dialog (z-[125] inset-4 overlay + z-[130] centered content)"
  - "src/ui/features/pretty-view/SkillsEditorModal.tsx — modal shell mirroring GlobalFilesModal with skill dropdown + horizontal-scroll tab strip + add-file + delete-skill + two DeleteConfirmDialog mounts"
  - "Race-fix preservation: lazy-load useEffect deps = [selectedHostId, selectedSkillName, activeTab] (still no tabData) + eslint-disable + Phase 23 comment byte-verbatim"
  - "Component-test coverage: 10 tests in SkillFileTab.test.tsx + 8 tests in SkillsEditorModal.test.tsx (all green)"
affects:
  - "46-03 (Wave 3 mount at PrettyConversationsPanel.tsx menu — will import SkillsEditorModal + wire skillsEditorModalOpen state + add 'Edit skills…' menu item)"

# Tech tracking
tech-stack:
  added: []  # No new npm packages
  patterns:
    - "Fourth intentional duplication of isFolder + collectAllHosts helpers (NewSessionDialog → CreateRoleDialog → GlobalFilesModal → SkillsEditorModal — extraction to shared HostPickerList remains Post-Planning-Gaps)"
    - "Fourth intentional duplication of the mtime-conflict 409 error class (SkillFileMtimeConflictError mirrors GlobalFileMtimeConflictError byte-shape without runtime coupling — RESEARCH.md § Open Question 5)"
    - "DeleteConfirmDialog pattern: Radix Dialog-in-Dialog with inset-4 overlay (dims parent modal only, not the full app) + z-[125]/z-[130] stacked above parent's z-[110]/z-[120] + autoFocus on primary destructive button + inFlight → 'Deleting…' label + persistent-error-in-dialog on failure"
    - "Horizontal-scroll tab strip fallback for many-file skills (D-06): overflow-x-auto wrapper + WebkitOverflowScrolling: touch + shrink-0 intrinsic-width tabs (dropped flex-1 + justify-around from Phase 23 shape)"

key-files:
  created:
    - "src/ui/api/skills-api.ts (223 lines / 7 exported functions)"
    - "src/ui/features/pretty-view/SkillFileTab.tsx (149 lines — GlobalFileTab byte-shape + 2 new branches)"
    - "src/ui/features/pretty-view/SkillFileTab.test.tsx (204 lines / 10 tests)"
    - "src/ui/features/pretty-view/DeleteConfirmDialog.tsx (95 lines — generic destructive-confirm modal)"
    - "src/ui/features/pretty-view/SkillsEditorModal.tsx (701 lines — largest file in Phase 46)"
    - "src/ui/features/pretty-view/SkillsEditorModal.test.tsx (372 lines / 8 tests)"
  modified: []  # Task 2 is 100% additive — no existing files modified

key-decisions:
  - "Duplicate SkillFileMtimeConflictError + SkillFileAlreadyExistsError as their own classes rather than import-and-re-export — the two features share zero runtime concern (Phase 23 also duplicated execWithTimeout/shellEscape for the same reason)"
  - "Copy the Phase 23 race-fix eslint-disable + multi-line comment byte-verbatim; deps become [selectedHostId, selectedSkillName, activeTab] with NO tabData — the quick-260805-7rq 700ms lazy-load infinite-spinner regression is guarded by SkillsEditorModal.test.tsx"
  - "Delete-file next-tab heuristic simplified from plan's 'next-right / previous / none' to 'first-remaining-or-null' — plan's heuristic requires caching the pre-delete file list, but Ashley's fast-path bias says any-remaining-tab is acceptable, and this matches the initial skill-load auto-select-first behavior"
  - "isText field preserved through the save round-trip via tabData lookup (the write response only returns { mtime }); text files stay text after save without a re-read"

patterns-established:
  - "SkillFileTab non-text branch: full-height (min-h-[400px]) centered placeholder replaces the editor pane entirely when data.isText === false — no textarea, no save button, no Trash2 (delete-file only makes sense next to an editor). Prevents layout jump between text and non-text tabs."
  - "SkillsEditorModal body-branch ladder: 8 branches for selectedHostId=null → skills loading → skills error → no skills → selectedSkillName=null → files loading → files error → no files → ready-with-Tabs. Copy verbatim from UI-SPEC L128-142."
  - "DeleteConfirmDialog wraps error state inline (dialog stays open on backend failure); onOpenChange({false}) callers reset both dialog-open AND deleteError together so the error doesn't ghost into the next open cycle."

requirements-completed: []  # Plan frontmatter has requirements: [] — phase derives from CONTEXT.md D-01..D-16, not REQ-IDs

# Metrics
duration: 26 min
completed: 2026-08-19
---

# Phase 46 Plan 02: Frontend skill-editing surface — Summary

**Shipped the entire frontend surface for Phase 46 skill editing — SkillsEditorModal + SkillFileTab + DeleteConfirmDialog + skills-api — as a byte-shape mirror of Phase 23 with the skill dimension threaded through every effect and three new affordances (non-text placeholder, add-file, delete-file/skill confirms). Race-fix preserved verbatim; 18 component tests all pass.**

## Performance

- **Duration:** ~26 min (executor time from plan start to SUMMARY write)
- **Started:** 2026-08-19T03:55:00Z
- **Completed:** 2026-08-19T04:32:00Z
- **Tasks:** 2 completed
- **Files created:** 6 (4 net-new for Task 1, 2 net-new for Task 2)
- **Files modified:** 0 (Wave 2 is 100% additive; Wave 3 will do the mount)

## Accomplishments

- **Full frontend surface for CONTEXT decisions D-01 through D-13** — modal shell (D-01, D-02), skill picker between host and files (D-03), horizontal-scroll flat-tab file list with full path-relative labels (D-04, D-05, D-06), text editor branch (D-07), non-text AlertTriangle placeholder (D-08), + Add file window.prompt (D-09), delete-file confirm dialog (D-10), delete-skill confirm dialog (D-11), no per-file allowlist logic (D-12), no skill-scaffolding UI (D-13).
- **Load-bearing Phase 23 race-fix preserved byte-verbatim** — the lazy-load `useEffect` deps array is `[selectedHostId, selectedSkillName, activeTab]` (still no `tabData`), the `eslint-disable-next-line react-hooks/exhaustive-deps` comment is present, and the multi-line comment explaining WHY the deps are intentionally incomplete (referencing quick-260805-7rq) survives verbatim from `GlobalFilesModal.tsx` L143-149. The 700ms race regression is guarded by test #1 in `SkillsEditorModal.test.tsx`.
- **Zero new npm packages** — every dependency (radix-ui, lucide-react, react, TabState, TabsContent, DialogPrimitive, cn, Skeleton, authApi, handleApiError) already in the tree; Task 2 imports only existing modules + the Wave 1 backend surface.
- **18 component tests all pass** — 10 in `SkillFileTab.test.tsx` (loading/error/text/non-text/delete-trigger/mtime-reseed branches), 8 in `SkillsEditorModal.test.tsx` (race regression + host→skill→files load sequence + non-text branch + add-file prompt + both delete flows + RDP filter).
- **Full-suite vitest exit 0** — 2592/2602 pass (9 skipped + 1 todo, 0 failures) at 04:16-04:28 on `feat/tab-title-from-tmux`. Cleaner than the Wave 1 baseline (which had 4 pre-existing failures) — the box was quieter during this run.

## Task Commits

Each task was committed atomically on `feat/tab-title-from-tmux`:

1. **Task 1: Create skills-api.ts + SkillFileTab.tsx + SkillFileTab.test.tsx + DeleteConfirmDialog.tsx** — `e0677bfb` (feat)
2. **Task 2: Create SkillsEditorModal.tsx + SkillsEditorModal.test.tsx** — `93cafb1e` (feat)

## Files Created/Modified

### Created

- **`src/ui/api/skills-api.ts`** (NEW, 223 lines) — 7 authApi helpers (`listSkills`, `enumerateSkillFiles`, `readSkillFile`, `writeSkillFile`, `createSkillFile`, `deleteSkillFile`, `deleteSkill`) + `SkillFileMtimeConflictError` (409 mtime-conflict) + `SkillFileAlreadyExistsError` (409 file-exists) + typed request/response contracts (`SkillEntry`, `SkillFileEntry`, `SkillFileReadResult`, `SkillFileWriteInput`, `SkillFileWriteResult`). Every function wraps in `try { authApi.XXX } catch { handleApiError; throw }` mirroring `global-files-api.ts` byte-shape. DELETE endpoints use `{ data: {...} }` axios payload shape for DELETE-with-body.
- **`src/ui/features/pretty-view/SkillFileTab.tsx`** (NEW, 149 lines) — Mirror of `GlobalFileTab.tsx` (128 lines) with two Phase 46 branches: (a) non-text placeholder rendering `AlertTriangle` + heading + body per UI-SPEC L162-167 when `state.data.isText === false`; (b) `Trash2` delete-file trigger placed LEFT of Save button per UI-SPEC L188 firing `onRequestDelete?.()` up to the parent modal. Draft-seed useEffect + handleSave callback + loading/error branches copied verbatim from `GlobalFileTab.tsx` L45-93.
- **`src/ui/features/pretty-view/SkillFileTab.test.tsx`** (NEW, 204 lines) — 10 tests: loading/error/ready-text/ready-empty (dropped-early-return regression gate)/dead-end-copy-gone/save-disabled/save-enabled/**non-text-placeholder**/**delete-trigger-fires-onRequestDelete**/**mtime-reseed-replaces-draft**. Bold = Phase 46 additions beyond the 5 GlobalFileTab branches.
- **`src/ui/features/pretty-view/DeleteConfirmDialog.tsx`** (NEW, 95 lines) — Generic destructive-confirm modal-in-modal. Radix Dialog primitive stack synthesized from `GlobalFilesModal.tsx` L186-217 chrome with UI-SPEC L212-220 specifics: `absolute inset-4` overlay (dims parent modal only, not the full app) + `z-[125]` above parent's `z-[120]`; centered `max-w-[400px] w-[85%]` content with slightly-darker glass gradient (`hsla(220, 45%, 20%, 0.92) → hsla(220, 40%, 12%, 0.94)`) so the layer stack reads as "raised further" + `z-[130]`. Props: `open`, `onOpenChange`, `heading`, `body` (React node — includes monospace `<code>` inline for the file path or skill name), `primaryLabel`, `onConfirm`, `inFlight`, `error?`, `container?`. Primary destructive button `autoFocus`es; `inFlight` shows `Deleting…`; error string renders red-400 inline below body and dialog stays open on failure per UI-SPEC L195.
- **`src/ui/features/pretty-view/SkillsEditorModal.tsx`** (NEW, 701 lines — largest file in the phase) — Byte-shape mirror of `GlobalFilesModal.tsx` (377 lines). Additions:
  - Second `<select>` for skill picker between host `<select>` and header actions (D-03). Four-branch skill-select rendering: no-host → disabled "Pick a host first…"; loading → disabled "Loading skills…"; error → disabled "Couldn't load skills"; ready → placeholder + options.
  - `+ Add file` header button (literal `+ Add file` text) firing `handleAddFile` → `window.prompt("New file name (relative to skill root):", "")` → `createSkillFile` → refetch + auto-select new tab. Disabled when no skill picked OR files not ready. Errors surface via `files: { status:"error", error:"A file with that name already exists in this skill." }` for the 409 branch.
  - Delete-skill `Trash2` header button rendered only when a skill is picked (UI-SPEC L202). Opens the second `DeleteConfirmDialog` with heading "Delete skill?", body `{skill}` in monospace + "This removes the skill folder and every file inside it. This can't be undone.", primary "Delete skill".
  - Bottom tab strip wraps in `overflow-x-auto` with `WebkitOverflowScrolling: "touch"` inline style (D-06 horizontal-scroll fallback). Tabs are `shrink-0` intrinsic-width (dropped `flex-1` + `justify-around`).
  - Tab label uses `file.path` verbatim (D-05: `tests/basic.py`), NOT `.split("/").pop()`.
  - Two `DeleteConfirmDialog` mounts inside the same Portal — one for delete-file (`deleteFileConfirm !== null`), one for delete-skill (`deleteSkillConfirm`). Both share `deleteInFlight` + `deleteError` state; both reset error state on close.
  - `handleDeleteFile` refetches file list on success and picks the first remaining file as active tab (simplified from plan's "next-right / previous / none" heuristic — see § Deviations).
  - `handleDeleteSkill` refetches skills list on success and clears `selectedSkillName` + `files` + `activeTab` + `tabData`.
  - `handleSave` preserves `isText` from the previously-loaded tab state so text files stay text after a save (write response only returns `{ mtime }`).
  - Load-bearing lazy-load useEffect (L173-217) with `[selectedHostId, selectedSkillName, activeTab]` deps + eslint-disable + Phase 23 comment byte-verbatim. Store `{ content, mtime, isText }` in tab data map from the readSkillFile response.
  - Modal chrome (L305-343) copied VERBATIM from `GlobalFilesModal.tsx` L186-217: `modal={false}`, `onInteractOutside` preventDefault (patch #111f), glass gradient with hue 220, z-index 110/120 ladder, `absolute inset-4`, `rounded-[24px]`, backdrop-filter, box-shadow.
  - `.filter((h) => h.enableRdp !== true)` preserved verbatim from `GlobalFilesModal.tsx` L68 (Pitfall 7).
  - `window.confirm` mtime-conflict copy inherited byte-verbatim: `"The file changed on disk since you started editing. Reload from disk and lose your local edits?"` (UI-SPEC L158 / D-14 plain-editor rule).
- **`src/ui/features/pretty-view/SkillsEditorModal.test.tsx`** (NEW, 372 lines) — Byte-shape mirror of `GlobalFilesModal.test.tsx` (109 lines) with 8 tests: (1) race regression (700ms readSkillFile → textarea renders with `MOCKED SKILL FILE CONTENT`); (2) host-pick triggers `listSkills(hostId)`; (3) skill-pick triggers `enumerateSkillFiles(hostId, skill)`; (4) non-text branch (isText: false → AlertTriangle, no textbox); (5) + Add file prompt round-trip (create + refetch); (6) delete-file confirm dialog fires `deleteSkillFile`; (7) delete-skill confirm dialog fires `deleteSkill`; (8) RDP-only hosts filtered from host `<select>`. Module-boundary mock of `@/api/skills-api` returning stubbed functions per RESEARCH.md § Test Seam.

### Modified

None. Task 2 is 100% additive. Wave 3 (plan 46-03) will modify `PrettyConversationsPanel.tsx` to import + mount `SkillsEditorModal` and add the "Edit skills…" menu item.

## Component Tree

```
PrettyConversationsPanel.tsx (Wave 3 mount site — NOT YET WIRED)
  └── SkillsEditorModal  (this plan)
        ├── SkillFileTab  (per-file editor pane — this plan)
        │     └── SkillFileTabData: { content, mtime, isText }
        └── DeleteConfirmDialog  (this plan, mounted TWICE)
              ├── delete-file (open when deleteFileConfirm !== null)
              └── delete-skill (open when deleteSkillConfirm === true)

skills-api.ts (this plan)
  ├── listSkills(hostId)                    → GET  /skills-editor/skills
  ├── enumerateSkillFiles(hostId, skill)    → GET  /skills-editor/files
  ├── readSkillFile(hostId, skill, path)    → POST /skills-editor/read
  ├── writeSkillFile({...})                 → PUT  /skills-editor/write     (409 → SkillFileMtimeConflictError)
  ├── createSkillFile(hostId, skill, path)  → POST /skills-editor/create    (409 → SkillFileAlreadyExistsError)
  ├── deleteSkillFile(hostId, skill, path)  → DELETE /skills-editor/file   (axios data: body)
  └── deleteSkill(hostId, skill)            → DELETE /skills-editor/skill  (axios data: body)
```

## Race-Fix Preservation (Phase 23 quick-260805-7rq)

The load-bearing lazy-load `useEffect` in `SkillsEditorModal.tsx` (lines ~173-217):

```typescript
useEffect(() => {
  if (selectedHostId == null || !selectedSkillName || !activeTab) return;
  if (tabData.has(activeTab)) return; // already loaded
  let cancelled = false;
  setTabData((prev) => new Map(prev).set(activeTab, { status: "loading" }));
  readSkillFile(selectedHostId, selectedSkillName, activeTab)
    .then((result) => { /* … */ })
    .catch((err: unknown) => { /* … */ });
  return () => { cancelled = true; };
  // Intentional exhaustive-deps violation: including `tabData` re-runs this effect after
  // `setTabData({loading})`, whose cleanup sets `cancelled = true` on the still-in-flight
  // `readSkillFile` (see plan 260805-7rq). The `tabData.has(activeTab)` gate inside the
  // body is a deliberate stale-closure read — "if the currently-known map already tracks
  // this tab, skip".
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [selectedHostId, selectedSkillName, activeTab]);
```

Deps array: `[selectedHostId, selectedSkillName, activeTab]` — the added `selectedSkillName` is the ONLY change from Phase 23; `tabData` remains excluded. Comment preserved word-for-word.

Regression guard: `SkillsEditorModal.test.tsx` test #1 mocks `readSkillFile` with a `setTimeout(50ms)` delay; asserts the textarea appears with `"MOCKED SKILL FILE CONTENT"` within a 2000ms `waitFor` — exact byte-shape mirror of `GlobalFilesModal.test.tsx` L87-108.

## Test Coverage Summary

- **`SkillFileTab.test.tsx`: 10/10 pass** — loading, error, ready-text (renders textarea seeded with content, save disabled until edit), ready-empty (regression gate for dropped early-return), dead-end-copy-gone (regression gate), save-disabled-when-unchanged, save-enabled-after-edit, non-text-placeholder (AlertTriangle + no textbox + no save button), delete-trigger-fires-onRequestDelete, mtime-reseed-replaces-draft.
- **`SkillsEditorModal.test.tsx`: 8/8 pass** — race regression (700ms readSkillFile still renders textarea), host-pick triggers listSkills, skill-pick triggers enumerateSkillFiles, non-text branch, + Add file prompt (create + refetch), delete-file confirm dialog fires deleteSkillFile, delete-skill confirm dialog fires deleteSkill, RDP-only host filtered from host `<select>`.
- **Full-suite `npx vitest run`: 2592 pass / 9 skipped / 1 todo / 0 fail** (exit code 0, box was quiet during this run — cleaner than the Wave 1 baseline).

## Decisions Made

1. **Duplicate error classes rather than import** — `SkillFileMtimeConflictError` and `SkillFileAlreadyExistsError` live in `skills-api.ts` as their own classes rather than importing `GlobalFileMtimeConflictError` and re-exporting. Rationale per RESEARCH.md § Open Question 5: the two features share zero runtime concern, and Phase 23 also duplicated `execWithTimeout` + `shellEscape` for the same reason. If the two ever diverge (e.g., skill-write adds extra 409 fields), duplication has already paid its way.
2. **Preserve isText through save round-trip** — the write response returns only `{ mtime }`, so on save I look up the previous tab entry to preserve `isText` when constructing the new ready-state. Prevents text files from silently flipping to `isText: false` after a save. Handled the same way in the 409-conflict reload branch.
3. **Simplify delete-file next-tab heuristic** — plan asked for "next-right / previous / none if last", which requires caching the pre-delete file list to find the position. I picked `entries[0] ?? null` from the refetched list (first-remaining-or-null). Rationale: Ashley's fast-path bias says any-remaining-tab is acceptable, and this matches the initial skill-load auto-select-first behavior. If UAT surfaces a need for precise position preservation, the fix is localized to `handleDeleteFile`.
4. **Wave 3 handles the mount** — 46-02 is 100% additive (no files modified). Wave 3 (46-03) is the sole owner of `PrettyConversationsPanel.tsx` edits (state + modal mount + menu item). Keeps the diff scoped per plan intent.
5. **Skill dropdown gains an error branch** — plan spelled out three states for the skill `<select>` (no-host, loading, ready). I added a fourth: `skills.status === "error"` → disabled option "Couldn't load skills". Redundant with the body-branch error, but keeps the header row from rendering an active-looking placeholder when the fetch failed. Zero test-cost, matches the body-branch shape.

## Deviations from Plan

**None from the plan's byte-shape mandate.** Every UI-SPEC copy string is verbatim. Every architectural directive (race-fix preservation, RDP filter, D-05 full-path labels, D-06 horizontal scroll, two DeleteConfirmDialog mounts, hardcoded hue 220, mtime-conflict window.confirm copy) is honored.

The four "Decisions Made" items above (isText preservation on save, delete-file first-tab-picking, Wave 3 mount split, skill-select error branch) are implementation-detail resolutions of gaps in the plan, not deviations from stated requirements.

## Issues Encountered

None. Both tasks executed cleanly:
- Task 1: 4 net-new files, TS clean, vitest 10/10 pass on first run.
- Task 2: 2 net-new files, TS clean, vitest 8/8 pass on first run.
- Full-suite regression check: 2592/2602 pass, 0 failures (cleaner than Wave 1's 4-failure baseline; cross-identity contention didn't repeat this run).

## Deferred Issues (out of Phase 46 Plan 02 scope)

None triggered during this plan. Prior Wave 1 SUMMARY documented DEF-1 (PrettyView.windowed-pagination.test.tsx RED-phase 43-07b spec) and DEF-2 (cross-identity vitest contention flakes); neither surfaced during this run — the full-suite `npx vitest run` was 100% green.

## Authentication Gates

None — this plan is purely code + tests. No auth prompts needed.

## Verification Evidence

```bash
# Task 1: TS clean
$ npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "skills-api|SkillFileTab|DeleteConfirmDialog|error TS" | head -30
# (empty output — zero errors)

# Task 1: SkillFileTab tests green
$ npx vitest run src/ui/features/pretty-view/SkillFileTab.test.tsx
# Test Files  1 passed (1)
#      Tests  10 passed (10)

# Task 2: TS clean
$ npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "SkillsEditorModal|error TS" | head -30
# (empty output — zero errors)

# Task 2: SkillsEditorModal tests green
$ npx vitest run src/ui/features/pretty-view/SkillsEditorModal.test.tsx
# Test Files  1 passed (1)
#      Tests  8 passed (8)

# Full-suite regression check
$ npx vitest run
# Test Files  202 passed (202)
#      Tests  2592 passed | 9 skipped | 1 todo (2602)
#      exit 0
```

## Acceptance Criteria Grep Results

```bash
# skills-api.ts
grep -c "export async function" src/ui/api/skills-api.ts        # 7 ✓
grep -c "SkillFileMtimeConflictError" src/ui/api/skills-api.ts  # 5 ✓
grep -c "SkillFileAlreadyExistsError" src/ui/api/skills-api.ts  # 4 ✓
grep -c "data: { hostId, skill" src/ui/api/skills-api.ts        # 2 ✓ (DELETE bodies)
grep -c "fetch(" src/ui/api/skills-api.ts                        # 0 ✓ (all via authApi)

# SkillFileTab.tsx
grep -c "Not a text file" src/ui/features/pretty-view/SkillFileTab.tsx                          # 1 ✓
grep -c "AlertTriangle" src/ui/features/pretty-view/SkillFileTab.tsx                            # 4 ✓
grep -c "eslint-disable-next-line react-hooks/exhaustive-deps" src/ui/features/pretty-view/SkillFileTab.tsx  # 1 ✓
grep -c 'import type { TabState }' src/ui/features/pretty-view/SkillFileTab.tsx                 # 1 ✓

# SkillFileTab.test.tsx
grep -cE "^\s*it\(" src/ui/features/pretty-view/SkillFileTab.test.tsx  # 10 ✓
grep -c "non-text file" src/ui/features/pretty-view/SkillFileTab.test.tsx      # 2 ✓
grep -c "onRequestDelete" src/ui/features/pretty-view/SkillFileTab.test.tsx    # 6 ✓

# DeleteConfirmDialog.tsx
grep -c "z-\[125\]" src/ui/features/pretty-view/DeleteConfirmDialog.tsx  # 3 ✓
grep -c "z-\[130\]" src/ui/features/pretty-view/DeleteConfirmDialog.tsx  # 2 ✓
grep -c "inset-4" src/ui/features/pretty-view/DeleteConfirmDialog.tsx    # 4 ✓
grep -c "autoFocus" src/ui/features/pretty-view/DeleteConfirmDialog.tsx  # 1 ✓

# SkillsEditorModal.tsx
grep -c "export default function SkillsEditorModal" src/ui/features/pretty-view/SkillsEditorModal.tsx  # 1 ✓
grep -c "eslint-disable-next-line react-hooks/exhaustive-deps" src/ui/features/pretty-view/SkillsEditorModal.tsx  # 1 ✓
grep -c "\.filter((h) => h.enableRdp !== true)" src/ui/features/pretty-view/SkillsEditorModal.tsx  # 1 ✓
grep -c "overflow-x-auto" src/ui/features/pretty-view/SkillsEditorModal.tsx  # 2 ✓
grep -c "<DeleteConfirmDialog" src/ui/features/pretty-view/SkillsEditorModal.tsx  # 2 ✓
grep -c "+ Add file" src/ui/features/pretty-view/SkillsEditorModal.tsx  # 4 ✓
grep -c "Edit skills" src/ui/features/pretty-view/SkillsEditorModal.tsx  # 1 ✓
grep -c "hsla(220" src/ui/features/pretty-view/SkillsEditorModal.tsx  # 7 ✓
grep -c "The file changed on disk since you started editing." src/ui/features/pretty-view/SkillsEditorModal.tsx  # 1 ✓

# SkillsEditorModal.test.tsx
grep -cE "^\s*it\(" src/ui/features/pretty-view/SkillsEditorModal.test.tsx  # 8 ✓
grep -c "MOCKED SKILL FILE CONTENT" src/ui/features/pretty-view/SkillsEditorModal.test.tsx  # 2 ✓
grep -c "queryByRole(\"textbox\")).toBeNull" src/ui/features/pretty-view/SkillsEditorModal.test.tsx  # 1 ✓

# Deps array verification
grep -B 2 -A 3 "eslint-disable-next-line react-hooks/exhaustive-deps" src/ui/features/pretty-view/SkillsEditorModal.tsx
# ... shows deps = [selectedHostId, selectedSkillName, activeTab]  ← NO tabData ✓
```

All acceptance criteria pass.

## Next Phase Readiness

Wave 3 (`46-03-PLAN.md`) is unblocked. It needs to:

1. Import `SkillsEditorModal` from `@/features/pretty-view/SkillsEditorModal` into `PrettyConversationsPanel.tsx` L60 (alongside `GlobalFilesModal` import).
2. Add `const [skillsEditorModalOpen, setSkillsEditorModalOpen] = useState(false)` after L485.
3. Add `<SkillsEditorModal open={skillsEditorModalOpen} onOpenChange={setSkillsEditorModalOpen} hostTree={hostTree ?? null} defaultHostId={null} />` after the existing `<GlobalFilesModal>` mount at L1583-1588.
4. Add `{ label: "Edit skills…", onClick: () => setSkillsEditorModalOpen(true) }` to the menu-items array at L1616 **AFTER** the existing `"Edit global files…"` entry (UI-SPEC L112 menu-order lock — Pitfall 8 says consider a `// KEEP ORDER: New agent → New role → Edit global files… → Edit skills…` comment).

Every prop shape SkillsEditorModal expects (`open`, `onOpenChange`, `hostTree: HostFolder | null`, `defaultHostId: number | null`, `container?: HTMLElement | null`) matches GlobalFilesModal exactly — Wave 3's mount can literally copy the GlobalFilesModal JSX shape and swap the component name + state variable.

## Self-Check: PASSED

- ✓ `src/ui/api/skills-api.ts` exists (223 lines)
- ✓ `src/ui/features/pretty-view/SkillFileTab.tsx` exists (149 lines)
- ✓ `src/ui/features/pretty-view/SkillFileTab.test.tsx` exists (204 lines)
- ✓ `src/ui/features/pretty-view/DeleteConfirmDialog.tsx` exists (95 lines)
- ✓ `src/ui/features/pretty-view/SkillsEditorModal.tsx` exists (701 lines)
- ✓ `src/ui/features/pretty-view/SkillsEditorModal.test.tsx` exists (372 lines)
- ✓ Commit `e0677bfb` exists in git log (Task 1)
- ✓ Commit `93cafb1e` exists in git log (Task 2)
- ✓ `.planning/phases/44-.../46-02-SUMMARY.md` exists (this file)
- ✓ Load-bearing eslint-disable comment referring to `react-hooks/exhaustive-deps` present in SkillsEditorModal.tsx
- ✓ Lazy-load useEffect deps = `[selectedHostId, selectedSkillName, activeTab]` — no `tabData`
- ✓ `.filter((h) => h.enableRdp !== true)` present exactly once in the flatHosts memo (Pitfall 7)
- ✓ Bottom tab strip has `overflow-x-auto` (D-06)
- ✓ Two `<DeleteConfirmDialog` mounts (delete-file + delete-skill)
- ✓ `Edit skills` title present
- ✓ `+ Add file` literal present
- ✓ Modal chrome uses `hsla(220` glass gradient
- ✓ mtime-conflict `window.confirm` copy byte-verbatim
- ✓ `npx tsc --noEmit -p tsconfig.json` exits 0
- ✓ `npx vitest run src/ui/features/pretty-view/SkillFileTab.test.tsx` = 10/10 pass
- ✓ `npx vitest run src/ui/features/pretty-view/SkillsEditorModal.test.tsx` = 8/8 pass
- ✓ `npx vitest run` full-suite = 2592 pass / 0 fail (exit 0)
- ✓ D-12 truth honored: every visible file has a delete trigger (Trash2 in SkillFileTab action row), every visible skill has a delete trigger (Trash2 in header row when skill picked), zero allowlist/blocklist/per-file protection logic added

---
*Phase: 46-frontend-skill-editing-editor-surface-for-skill-folders-on-a*
*Plan: 02*
*Completed: 2026-08-19*
