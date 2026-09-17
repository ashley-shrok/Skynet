---
phase: 113-skill-creation-in-the-edit-skills-modal
plan: 04
subsystem: pretty-view/SkillsEditorModal
tags:
  - rtl-tests
  - frontend-green-gate
  - companion-edits
  - d-28-coverage
requires:
  - 113-01 (backend POST /skills-editor/skill + SKILL.md guard)
  - 113-02 (frontend createSkill + SkillAlreadyExistsError + SkillFileTab Trash2 guard)
  - 113-03 (SkillsEditorModal.tsx handleNewSkill + header restructure + tab-strip hoist)
provides:
  - Full frontend RTL coverage of every D-28 test case
  - Companion edits to 3 pre-existing tests broken by 113-03's DOM restructure
  - Green scoped-test gate for the phase (`vitest related --run` on SkillsEditorModal.test.tsx)
affects:
  - src/ui/features/pretty-view/SkillsEditorModal.test.tsx
tech-stack:
  added: []
  patterns:
    - Extended `vi.mock("@/api/skills-api")` hoisted block with `createSkill: vi.fn().mockResolvedValue(...)`
    - `vi.spyOn(window, "prompt").mockReturnValueOnce(...)` chained-prompt spies
    - `screen.getByRole("combobox", { name: /skill/i })` value-transition assertion for auto-select verification
    - `@testing-library/jest-dom/vitest` import for `.toBeInTheDocument()` matcher
    - Multi-SSH-host fixture extension (`HOST_TREE_WITH_RDP` + `id: "3"` second SSH host) to survive `flatHosts.length > 1` picker-hide
key-files:
  created: []
  modified:
    - src/ui/features/pretty-view/SkillsEditorModal.test.tsx (+411 lines net across three commits)
decisions:
  - Auto-select verification (test A) asserts BOTH `listSkills` called twice AND skill combobox value transitions to new slug — WARN 3 fix
  - `+ New skill` disabled-visibility test (test B) uses multi-host tree with `defaultHostId={null}` so auto-select effect skips and button stays disabled (D-01 unambiguous)
  - Empty-file-list test (test H) uses `getByText(/no files/i)` after adding `@testing-library/jest-dom/vitest` import (matches plan spec verbatim)
  - Companion edit 3 chose fixture-extension over assertion-rewrite (plan-recommended preferred approach) — cleanest diff, keeps test intent identical
metrics:
  duration: ~35 minutes
  completed: 2026-09-17
  tasks: 3
  files_modified: 1
  commits: 3
---

# Phase 113 Plan 04: Frontend Test Extension Summary

Extended `SkillsEditorModal.test.tsx` with 12 new RTL test cases covering
every D-28 dimension, plus 3 companion edits to pre-existing tests broken
by plan 113-03's DOM restructure. `it(...)` count went from 8 → 20; all
20 tests pass under `npx vitest related --run`.

## Deviations from Plan

**1. [Rule 3 - Blocking issue] Added `@testing-library/jest-dom/vitest` import**

- **Found during:** Task 3, running test H (`+ New file tab renders in
  empty-file-list state`).
- **Issue:** Plan specified `.toBeInTheDocument()` assertions for test H,
  but the SkillsEditorModal.test.tsx file did not import `jest-dom` — the
  `expect(...).toBeInTheDocument` matcher was unregistered and threw
  `Invalid Chai property: toBeInTheDocument`.
- **Fix:** Added `import "@testing-library/jest-dom/vitest";` right after
  the vitest imports at L20. Follows the exact same pattern used in 5
  sibling test files under `src/ui/features/pretty-view/` (e.g.
  `ChatSurfaceErrorState.test.tsx:16`,
  `RelayInboundBubble.speak.test.tsx:14`,
  `RelayOutboundBubble.test.tsx:12`) — zero-risk import that only adds
  matcher augmentations. No behavior change to any existing test.
- **Files modified:** `src/ui/features/pretty-view/SkillsEditorModal.test.tsx`
- **Commit:** `7f0c6390` (folded into Task 3 commit alongside the seven
  new tests + three companion edits)

## Task Log

### Task 1 (commit `b8e86f2f`)

- Extended the `vi.mock("@/api/skills-api", ...)` hoisted block at
  L46-51 to add `createSkill: vi.fn().mockResolvedValue({ slug: "new-skill", mtime: 1_700_000_200 })`.
- Preserved the `...orig` spread that keeps `SkillAlreadyExistsError`
  accessible from the real named export in `skills-api.ts`.
- Preserved all 8 pre-existing mocked functions verbatim.

**Verification:**
- `grep -c "createSkill: vi.fn" ...` → 1 ✓
- `grep -c "listSkills: vi.fn" ...` → 1 ✓
- `grep -c "createSkillFile: vi.fn" ...` → 1 ✓
- `grep -c "deleteSkill: vi.fn" ...` → 1 ✓
- `grep -c "importOriginal" ...` → 2 ✓ (unchanged from pre-edit)
- `tsc --noEmit` clean on the test file ✓

### Task 2 (commit `42c57216`)

Added five new `it(...)` cases for `+ New skill` behavior at L326-538
(after the `+ Add file` test, before the delete-file test):

- **(A)** `+ New skill: chained prompt (name → description) calls
  createSkill and auto-selects` — spies `window.prompt` for
  `"My Cool Skill"` then `"A cool skill."`, overrides `createSkill` to
  return `{ slug: "my-cool-skill", mtime: ... }`, sequences
  `listSkills` for two calls (initial + post-create). Asserts:
  - `createSkill` called with `(1, "my-cool-skill", "A cool skill.")`
    (slugified name + trimmed description).
  - `listSkills` called twice (post-create refetch fired) — WARN 3 fix.
  - Skill combobox value transitions to `"my-cool-skill"`
    (`setSelectedSkillName(result.slug)` auto-selected the new skill) —
    WARN 3 fix.
- **(B)** `+ New skill button is disabled when defaultHostId is null` —
  synthesizes a multi-host tree so the auto-select effect skips (since
  `flatHosts.length > 1`), then asserts the button's `.disabled === true`.
- **(C)** `+ New skill: cancel on name prompt → no createSkill call` —
  `mockReturnValueOnce(null)` on the first prompt; asserts exactly one
  prompt fires and `createSkill` never gets called.
- **(D)** `+ New skill: cancel on description prompt → no createSkill
  call` — `mockReturnValueOnce("My Skill").mockReturnValueOnce(null)`;
  asserts exactly two prompts fire and `createSkill` never gets called.
- **(E)** `+ New skill: empty description re-prompts description ONLY;
  name is retained` — `mockReturnValueOnce("My Skill")` then `"   "`
  then `"Fine desc"`; asserts:
  - `createSkill` called with `(1, "my-skill", "Fine desc")` (name
    retained across description re-prompt via D-04 two-loop closure).
  - Prompt-call filter on `/skill name/i` → exactly 1 hit.
  - Prompt-call filter on `/Description/` → exactly 2 hits.
  - `window.alert` called with `/description is required/i`.

**Verification:**
- All 5 grep counts from acceptance criteria → passing ✓
- `npx vitest related --run ... --testNamePattern='+ New skill'` →
  5 tests pass, 0 fail ✓
- `tsc --noEmit` clean ✓

### Task 3 (commit `7f0c6390`)

Added seven new `it(...)` cases for `+ New file` / single-host /
`SKILL.md` no-delete + three companion edits + one deviation-driven
import.

**Seven new `it(...)` cases (L540-724):**

- **(A)** `+ New file tab is the LAST child of the tab strip` — filters
  `getAllByRole("button")` to those whose text matches
  `/new file|SKILL\.md|tests\/basic\.py/i`; asserts the last-indexed one
  matches `/new file/i`.
- **(B)** `+ New file tab click does NOT change activeTab (existing file
  tab stays selected)` — spies `window.prompt`, clicks the `+ New file`
  button, waits for `createSkillFile` to fire (proving `handleAddFile`
  ran), then asserts the button's `className` does NOT include
  `font-semibold` (proving it was never selected as the active tab).
- **(C)** `single-host: host picker <select> is hidden entirely` —
  `HOST_TREE` has exactly one SSH host; asserts
  `queryAllByRole("combobox").length === 1` (only the skill picker) and
  `queryByRole("combobox", { name: /host/i })` returns null.
- **(D)** `multi-host (2+ SSH hosts): host picker <select> is visible` —
  synthesizes a two-SSH-host fixture; asserts
  `queryByRole("combobox", { name: /host/i })` is truthy.
- **(E)** `SKILL.md tab has NO delete (Trash2) affordance` — waits for
  the textbox (SKILL.md auto-selected as first tab); asserts
  `queryByTitle(/delete this file/i)` returns null.
- **(F)** `Non-SKILL.md tab retains delete affordance` — clicks the
  `tests/basic.py` tab; waits for `queryByTitle(/delete this file/i)`
  to become truthy.
- **(H)** `+ New file tab renders in empty-file-list state and empty-
  state copy points at it` — WARN 4 fix. Overrides
  `enumerateSkillFiles` to return `[]`, waits for `/no files/i` copy,
  asserts:
  - Empty-state "no files" copy renders.
  - Repointed copy `/Use the .+ New file. tab below/i` renders.
  - The `+ New file` action-tab button renders (proving D-15 tab-strip
    hoist on the empty branch).

**Three companion edits to pre-existing tests:**

1. **`+ Add file prompt creates a file and refetches` (L284-324 pre-edit
   → L287-330 post-edit)** — retargeted the button selector from
   `/\+ add file/i` (removed in 113-03 D-12) to `/new file/i` (the
   tab-strip action-tab from 113-03 D-13). Removed the disabled-wait
   (the new-file tab has no `disabled` prop) in favor of a
   button-exists wait. All other assertions preserved verbatim.

2. **`delete-file confirm dialog opens and DELETE fires on confirm`
   (L527-559 pre-edit → L557-598 post-edit)** — added a tab-switch
   prelude (click `/tests\/basic\.py/i` and wait for
   `/delete this file/i` title to appear) BEFORE triggering the delete
   flow. Updated the final assertion from
   `deleteSkillFile(1, "build", "SKILL.md")` to
   `deleteSkillFile(1, "build", "tests/basic.py")`.

3. **`RDP-only hosts are filtered from the host <select>` (L392-408
   pre-edit → L618-641 post-edit)** — extended the
   `HOST_TREE_WITH_RDP` fixture at L145-181 to include a second SSH
   host (`id: "3"`, `name: "second-ssh-host"`, spread of
   `HOST_TREE.children[0]` with new `id`/`name`/`ip`) so
   `flatHosts.length` becomes 2 after the RDP filter and the picker
   actually renders. Assertion set extended to also assert
   `"second-ssh-host"` is present.

**Deviation-driven import (see Deviations section):**
Added `import "@testing-library/jest-dom/vitest";` at L20 to register
the `.toBeInTheDocument()` matcher used by test H.

**Verification:**
- All 10 grep counts from Task 3 acceptance criteria → passing ✓
- Post-edit `grep -c "^  it("` returns 20 (pre-edit was 8; delta = 12 =
  5 from Task 2 + 7 from Task 3) ✓
- `npx vitest related --run src/ui/features/pretty-view/SkillsEditorModal.test.tsx` →
  20 tests pass, 0 fail ✓
- `tsc --noEmit` clean ✓

## Test Count Delta

| | Pre-edit | Post-edit | Delta |
|---|---|---|---|
| `grep -c "^  it("` | 8 | 20 | **+12** |
| Passing under `vitest related --run` | 5 | 20 | **+15** |
| Failing under `vitest related --run` | 3 | 0 | **-3** |

The 3-test failure delta comes from the companion edits — pre-113-04
those 3 tests were failing due to plan 113-03's DOM restructure
(documented in `113-03-SUMMARY.md`). Post-113-04 all three pass because
they now target the correct post-restructure DOM.

## Companion Edit Before/After Diffs

### Companion edit 1: `+ Add file prompt creates a file and refetches`

**Before (113-03 broken):**
```typescript
// Wait for + Add file to enable (skill picked + files ready).
await waitFor(() => {
  const btn = screen.getByRole("button", { name: /\+ add file/i }) as HTMLButtonElement;
  expect(btn.disabled).toBe(false);
});
fireEvent.click(screen.getByRole("button", { name: /\+ add file/i }));
```

**After (113-04 landed):**
```typescript
// Wait for the tab strip to render its "+ New file" action-tab (only
// present once a skill is picked and the file list resolves).
await waitFor(() =>
  expect(screen.getByRole("button", { name: /new file/i })).toBeTruthy(),
);
fireEvent.click(screen.getByRole("button", { name: /new file/i }));
```

### Companion edit 2: `delete-file confirm dialog ...`

**Before (113-03 broken):**
```typescript
await selectSkill("build");
await waitFor(() => expect(screen.queryByRole("textbox")).toBeTruthy(), { timeout: 2000 });

// Click the delete-file Trash2 trigger (title="Delete this file") inside the tab pane.
fireEvent.click(screen.getByTitle(/delete this file/i));
// ...
await waitFor(() => {
  expect(skillsApi.deleteSkillFile).toHaveBeenCalledWith(1, "build", "SKILL.md");
});
```

**After (113-04 landed):**
```typescript
await selectSkill("build");
await waitFor(() => expect(screen.queryByRole("textbox")).toBeTruthy(), { timeout: 2000 });

// D-10 companion edit: switch to tests/basic.py — SKILL.md's Trash2 is hidden.
fireEvent.click(screen.getByRole("button", { name: /tests\/basic\.py/i }));
await waitFor(() => expect(screen.queryByTitle(/delete this file/i)).toBeTruthy());

fireEvent.click(screen.getByTitle(/delete this file/i));
// ...
await waitFor(() => {
  expect(skillsApi.deleteSkillFile).toHaveBeenCalledWith(1, "build", "tests/basic.py");
});
```

### Companion edit 3: `RDP-only hosts are filtered from the host <select>`

**Before (113-03 broken):**
```typescript
const HOST_TREE_WITH_RDP: HostFolder = {
  name: "root",
  children: [
    HOST_TREE.children[0], // 1 SSH host
    { id: "2", name: "windows-box", enableRdp: true, enableSsh: false, ... }, // filtered
  ],
};
// After filter → flatHosts.length === 1 → picker hidden → test throws.
```

**After (113-04 landed):**
```typescript
const HOST_TREE_WITH_RDP: HostFolder = {
  name: "root",
  children: [
    HOST_TREE.children[0], // 1 SSH host (thenasty)
    { ...HOST_TREE.children[0], id: "3", name: "second-ssh-host", ip: "10.0.0.2" }, // 2nd SSH
    { id: "2", name: "windows-box", enableRdp: true, enableSsh: false, ... }, // filtered
  ],
};
// After filter → flatHosts.length === 2 → picker renders → assertion runs.
```

## Files Touched (line-count deltas)

| File | Before | After | Delta | Commits |
|------|--------|-------|-------|---------|
| `src/ui/features/pretty-view/SkillsEditorModal.test.tsx` | 409 | 820 | **+411** | `b8e86f2f`, `42c57216`, `7f0c6390` |

- Task 1 (`b8e86f2f`): +1 line (`createSkill: vi.fn(...)` mock entry)
- Task 2 (`42c57216`): +201 lines (5 new `+ New skill` tests + section comment)
- Task 3 (`7f0c6390`): +218 / −9 lines (7 new tests + 3 companion edits + jest-dom import; net +209 lines)

## Phase-Level Verification

All grep counts from PLAN `<verification>` section pass:

- `grep -c 'createSkill: vi.fn' ...` → **1** ✓
- `grep -c '"+ New skill:' ...` → **4** (≥4 required) ✓
- `grep -c '"+ New file tab' ...` → **3** (≥2 required) ✓
- `grep -c '"single-host: host picker' ...` → **1** ✓
- `grep -c '"SKILL.md tab has NO delete' ...` → **1** ✓
- `grep -c '"build", "SKILL.md"' ...` → **0** ✓ (companion edit landed)
- `npx vitest related --run src/ui/features/pretty-view/SkillsEditorModal.test.tsx` → exit code 0 ✓
- `npx tsc --noEmit` → 0 errors on test file ✓

## Commit Log

- `b8e86f2f test(113-04): extend vi.mock('@/api/skills-api') with createSkill`
- `42c57216 test(113-04): add + New skill behavior tests (visibility, chained-prompt, cancels, empty-desc re-prompt)`
- `7f0c6390 test(113-04): add + New file / single-host / SKILL.md no-delete tests + companion edits`

## Self-Check: PASSED

- File `/home/ubuntu/skynet-apollo/src/ui/features/pretty-view/SkillsEditorModal.test.tsx` exists and is 820 lines.
- Commit `b8e86f2f` present in `git log`.
- Commit `42c57216` present in `git log`.
- Commit `7f0c6390` present in `git log`.
- `npx vitest related --run` on the test file passes all 20 tests.
