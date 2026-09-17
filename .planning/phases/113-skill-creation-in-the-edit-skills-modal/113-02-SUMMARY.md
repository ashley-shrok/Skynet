---
phase: 113-skill-creation-in-the-edit-skills-modal
plan: 02
subsystem: skills-editor-frontend
tags: [frontend, api-client, react, skills-editor, SKILL.md-invariant]
dependency_graph:
  requires:
    - "Phase 44 SKILLED-05: SkillFileAlreadyExistsError shape at skills-api.ts:57-62 (byte-shape analog)"
    - "Phase 44 SKILLED-05: createSkillFile function at skills-api.ts:169-197 (call-shape analog)"
    - "Phase 44 SKILLED-05: SkillFileTab.tsx filename prop already threaded (L64-66)"
    - "Phase 113 plan 01 (Wave 0): POST /skills-editor/skill backend endpoint — the target this API client calls"
  provides:
    - "src/ui/api/skills-api.ts::createSkill(hostId, name, description) → Promise<{ slug: string; mtime: number }>"
    - "src/ui/api/skills-api.ts::SkillAlreadyExistsError (extends Error, name='SkillAlreadyExistsError', message='skill exists')"
    - "src/ui/features/pretty-view/SkillFileTab.tsx: SKILL.md tab hides its Trash2 delete affordance (D-10 frontend layer)"
  affects:
    - "src/ui/features/pretty-view/SkillsEditorModal.tsx (plan 113-03 will import both new exports for handleNewSkill)"
tech_stack:
  added: []
  patterns:
    - "typed 409 error-class recognition (mirror of SkillFileAlreadyExistsError / SkillFileMtimeConflictError)"
    - "authApi.post + handleApiError fallthrough (mirror of createSkillFile)"
    - "conditional JSX wrap for invariant enforcement (D-10 frontend layer)"
key_files:
  created: []
  modified:
    - "src/ui/api/skills-api.ts (+48 lines, 0 deletions — pure tail-append)"
    - "src/ui/features/pretty-view/SkillFileTab.tsx (+10 / -8 — conditional wrap around Trash2 button)"
decisions:
  - "D-24 realized: createSkill signature is (hostId: number, name: string, description: string) returning Promise<{ slug: string; mtime: number }>; parameter `name` is mapped to backend field `skill` (the already-slugified string)"
  - "D-24 realized: SkillAlreadyExistsError only recognizes the exact 409 { error: 'skill exists' } shape; any other error goes through handleApiError('create skill')"
  - "D-10 frontend realized: the Trash2 <button> is wrapped in {filename !== \"SKILL.md\" && (…)}; container div and Save button are unchanged"
  - "Both new exports appended at end of skills-api.ts (after deleteSkill at L226-238) — clean tail-append, zero modifications to existing exports"
metrics:
  duration: "~15 minutes (2 tasks, both single-touch)"
  completed_date: "2026-09-17"
  tasks_completed: 2
  files_modified: 2
  commits:
    - "a818b1b0 — Task 1: feat(113-02): add createSkill + SkillAlreadyExistsError to skills-api"
    - "cb7838de — Task 2: feat(113-02): guard SkillFileTab delete affordance behind filename !== \"SKILL.md\""
---

# Phase 113 Plan 02: Frontend API Client + SKILL.md Delete-Affordance Guard Summary

Wired `skills-api.ts` up to the new POST `/skills-editor/skill` backend contract from plan 113-01 (adding `createSkill` + `SkillAlreadyExistsError` mirroring the existing `createSkillFile` / `SkillFileAlreadyExistsError` shape), and enforced the frontend layer of the D-10 SKILL.md invariant by hiding the Trash2 delete button on the `SKILL.md` tab in `SkillFileTab.tsx`.

## What Landed

### 1. `src/ui/api/skills-api.ts` (+48 lines, tail-append)

Two new exports appended after the existing `deleteSkill` (L226-238):

**`SkillAlreadyExistsError`** — byte-shape mirror of `SkillFileAlreadyExistsError` (L57-62):

```typescript
export class SkillAlreadyExistsError extends Error {
  constructor() {
    super("skill exists");
    this.name = "SkillAlreadyExistsError";
  }
}
```

**`createSkill(hostId, name, description)`** — POSTs to `/skills-editor/skill`, returns `Promise<{ slug: string; mtime: number }>`:

```typescript
export async function createSkill(
  hostId: number,
  name: string,
  description: string,
): Promise<{ slug: string; mtime: number }> {
  try {
    const response = await authApi.post("/skills-editor/skill", {
      hostId,
      skill: name,      // NB: param `name` → backend field `skill` (already-slugified)
      description,
    });
    return response.data as { slug: string; mtime: number };
  } catch (error) {
    const err = error as {
      response?: { status?: number; data?: { error?: string } };
    };
    if (
      err?.response?.status === 409 &&
      err.response.data?.error === "skill exists"
    ) {
      throw new SkillAlreadyExistsError();
    }
    handleApiError(error, "create skill");
    throw error; // unreachable
  }
}
```

**Call-site consumers:** plan 113-03's `handleNewSkill` in `SkillsEditorModal.tsx` will `await createSkill(selectedHostId, name, description)` inside a try/catch that recognizes `SkillAlreadyExistsError` for the "skill named X already exists" alert.

**Baseline export count:** 14 → **16** (delta +2, no existing exports modified).

### 2. `src/ui/features/pretty-view/SkillFileTab.tsx` (+10 / -8, conditional wrap)

The Trash2 delete `<button>` at L151-158 is now wrapped in `{filename !== "SKILL.md" && (…)}`:

- **When `filename === "SKILL.md"`:** the delete button does NOT render — the DOM contains no `title="Delete this file"` element on the SKILL.md tab.
- **When `filename !== "SKILL.md"`** (`README.md`, `tests/basic.py`, `SKILL.md.bak`, etc.): the delete button renders exactly as before — same classes, same `onClick={() => onRequestDelete?.()}`, same `<Trash2 size={16} />`.
- **Save button** (sibling in the same `<div className="flex justify-end gap-2 shrink-0 items-center">`): UNCHANGED — same classes, same handler, same layout regardless of `filename`.
- **No prop changes, no state changes, no import changes.** The `filename` prop was already threaded through the component at L64-66 (used by `MarkdownEditor` at L142).

**D-10 posture recap:** the backend guard from plan 113-01 task 2 (DELETE `/skills-editor/file` returns 400 `{ error: "cannot delete SKILL.md" }` when `path === "SKILL.md"`) is the load-bearing authoritative enforcement. This frontend layer is UX polish so users never see a button that would 400 server-side.

## Verification Results

- `grep -c "export class SkillAlreadyExistsError extends Error" src/ui/api/skills-api.ts` → **1** ✓
- `grep -cE '^export async function createSkill\(' src/ui/api/skills-api.ts` → **1** ✓ (anchored to avoid `createSkillFile` overlap)
- `grep -c 'this.name = "SkillAlreadyExistsError"'` → **1** ✓
- `grep -c 'super("skill exists")'` → **1** ✓
- `grep -c 'authApi.post("/skills-editor/skill"'` → **1** ✓
- Param mapping `hostId, skill: name, description` present (multi-line per PATTERNS.md snippet form) ✓
- `grep -c 'data?.error === "skill exists"'` → **1** ✓
- `grep -c 'handleApiError(error, "create skill")'` → **1** ✓
- Order: `SkillAlreadyExistsError` line (L245) > `deleteSkill` line (L226) ✓
- Total exports 14 → 16 (delta exactly +2) ✓
- `grep -c 'filename !== "SKILL.md"' src/ui/features/pretty-view/SkillFileTab.tsx` → **1** ✓
- `grep -c 'title="Delete this file"'` → **1** (button preserved, conditionally rendered) ✓
- `grep -c "<Trash2"` → **1** (icon preserved) ✓
- Conditional line (L151) < Trash2 line (L158) — guard wraps the button ✓
- `grep -c "onRequestDelete"` count unchanged (baseline 4, post-edit 4) — prop usage identical ✓
- `tsc --noEmit` clean on both touched files ✓
- `vitest related --run src/ui/api/skills-api.ts` → **182 tests / 8 files passed** ✓
- `vitest run src/ui/features/pretty-view/SkillFileTab.test.tsx` → **12 tests / 1 file passed** ✓

## Deviations from Plan

**None on the intended scope** — plan executed exactly as written. Both tasks landed byte-for-byte per PATTERNS.md snippets.

### Rule 3 blocking issue auto-fixed (infra, not code)

- **[Rule 3 — Missing dev deps]** `node_modules/` was empty when execution started; `npm ci` failed on `better-sqlite3` native-rebuild (pre-existing infra issue unrelated to plan scope). Ran `npm install --ignore-scripts vitest` to sidestep the native rebuild; JS-only deps installed successfully and both `vitest` + `tsc` became runnable. No code change caused by this fix; `node_modules/` is gitignored so nothing landed in a commit.

## Deferred Issues

### `src/ui/features/pretty-view/SkillsEditorModal.test.tsx:325-357` — pre-existing test breaks under D-10 frontend

The pre-existing "delete-file confirm dialog opens and DELETE fires on confirm" test at L325-357 targets the auto-selected `SKILL.md` tab and calls `screen.getByTitle(/delete this file/i)`. After this plan's D-10 frontend guard lands, that Trash2 button no longer renders on the `SKILL.md` tab, so the test fails.

**Scope decision:** `SkillsEditorModal.test.tsx` is NOT in plan 113-02's `files_modified` frontmatter list. `113-PATTERNS.md` line 941 explicitly assigns this companion edit to plan 113-04:

> "the existing delete-file confirm test at L325-357 targets `SKILL.md`. After D-10 frontend lands, that Trash2 button is never rendered on the `SKILL.md` tab — the test must switch to a non-SKILL.md tab first (e.g., `fireEvent.click(screen.getByRole("button", { name: /tests\/basic\.py/i }))` before the delete trigger click), and update the assertion to `deleteSkillFile(1, "build", "tests/basic.py")`."

**Owner:** plan 113-04 (frontend test extensions). Logged to `deferred-items.md` in the phase directory. The failure is a known-transitive-fallout of the correct D-10 change, not a regression.

## Known Stubs

None. Both new exports are fully wired to the backend contract from plan 113-01; the guard change is a pure JSX conditional with no placeholder data path.

## Threat Flags

None. This plan introduces no new network surface (the endpoint itself is added by plan 113-01 with its own threat register), no new auth path, no schema change. The `SkillAlreadyExistsError` recognition is a compile-time typing wrapper on a backend contract already in the phase's threat register (T-113-11, T-113-12, T-113-13).

## Files Touched (line-count deltas)

| File | + | - | Net |
|------|---|---|-----|
| `src/ui/api/skills-api.ts` | 48 | 0 | +48 |
| `src/ui/features/pretty-view/SkillFileTab.tsx` | 10 | 8 | +2 |

## Commits

| Task | Hash | Message |
|------|------|---------|
| 1 | `a818b1b0` | `feat(113-02): add createSkill + SkillAlreadyExistsError to skills-api` |
| 2 | `cb7838de` | `feat(113-02): guard SkillFileTab delete affordance behind filename !== "SKILL.md"` |

## Self-Check: PASSED

- File `src/ui/api/skills-api.ts` exists and contains `SkillAlreadyExistsError` + `createSkill` at end ✓
- File `src/ui/features/pretty-view/SkillFileTab.tsx` exists and contains the `filename !== "SKILL.md"` conditional ✓
- Commit `a818b1b0` exists in `git log` ✓
- Commit `cb7838de` exists in `git log` ✓
- `deferred-items.md` created in phase directory documenting plan-04-owned companion edit ✓
