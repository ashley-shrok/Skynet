---
phase: quick-260802-vg6
plan: "01"
subsystem: pretty-view/identity-modal
tags: [ui, identity-modal, pencil-toggle, voice-contrast, color-hue, get-verify]
dependency_graph:
  requires: []
  provides:
    - pencil-toggle-gated edit surface (patch #277-equiv)
    - voice option contrast fix (patch #278-equiv)
    - colorHue picker with GET-verify (patch #279-equiv)
  affects:
    - src/ui/features/pretty-view/IdentityModal.tsx
    - src/ui/features/pretty-view/IdentityModal.test.tsx
    - src/ui/features/pretty-view/IdentityModal.voice.test.tsx
tech_stack:
  added: []
  patterns:
    - pencil toggle using plain button (not Radix controlled) matching close-button glass affordance
    - GET-verify guard: early return with inline error when server echo mismatches sent colorHue
key_files:
  created: []
  modified:
    - src/ui/features/pretty-view/IdentityModal.tsx
    - src/ui/features/pretty-view/IdentityModal.test.tsx
    - src/ui/features/pretty-view/IdentityModal.voice.test.tsx
decisions:
  - Pencil button is a plain <button type="button"> (not DialogClose, not Radix toggle) — matches patch #91 close-button precedent
  - hueDraft falls back to prop `hue` when identity.colorHue is null so slider starts at meaningful position, not 0
  - GET-verify returns early before applyIdentityChange; finally block clears `saving` — no manual setSaving(false) needed
  - Task 1 test suite updated IdentityModal.voice.test.tsx in addition to IdentityModal.test.tsx to fix pencil-gate breakage
  - Test 1 post-save assertion changed from "Save button disabled" to "pencil returns to non-editing state + Save absent from DOM" since setEditing(false) collapses the edit block on save
  - Test 5 (cancel) adds a second pencil click after cancel to re-open and verify title revert
metrics:
  duration: ~25 minutes
  completed: 2026-08-02T22:55:00Z
  tasks_completed: 3
  files_modified: 3
---

# Phase quick-260802-vg6 Plan 01: Identity Modal Pencil Toggle + Voice Contrast + ColorHue Picker

**One-liner:** Pencil-gated identity edit surface with voice option contrast fix and colorHue slider with GET-verify defense against multipart silent no-op.

## Commits

| # | Hash | Subject |
|---|------|---------|
| 1 | `de006dd` | `feat(pv/identity-modal): pencil-toggle-gated edit surface (patch #277-equiv)` |
| 2 | `6b9d25f` | `fix(pv/identity-modal): voice dropdown option contrast (patch #278-equiv)` |
| 3 | `356320e` | `feat(pv/identity-modal): colorHue picker with GET-verify (patch #279-equiv)` |

## Task Summary

### Task 1: Pencil toggle (patch #277-equiv) — `de006dd`

- Added `Pencil` to the lucide-react import.
- Added `const [editing, setEditing] = useState(false)` after `saveError` state.
- Inserted pencil `<button type="button">` immediately before `<DialogClose asChild>` in the `DialogHeader`, matching the existing close button's glass affordance (same `size-9 rounded-full`, same `rgba(255,255,255,0.04)` rest background, hairline border, hue-tinted glow on hover/pressed). When `editing===true` the button renders with pressed-state styles (brighter background, border, box-shadow, color `#f0ebe0`). `aria-label` and `title` toggle between "Edit identity" / "Done editing".
- Wrapped the entire inline edit block in `{editing && (...)}`. `<IdentityFileTab>` remains unconditionally visible.
- `setEditing(false)` called on save success and in `onCancel`.
- Updated `IdentityModal.test.tsx`: all 5 existing tests get pencil-click prelude; test 1 post-save assertion updated to check pencil returns to non-editing state.
- Updated `IdentityModal.voice.test.tsx`: all 8 voice tests get pencil-click prelude.

### Task 2: Voice option contrast (patch #278-equiv) — `6b9d25f`

- Added `style={{ background: "#1a1c26", color: "#f0ebe0" }}` to the default `<option>` and each mapped voice `<option>` inside the Voice `<select>`.
- Native `<select>` unchanged — no shadcn swap.

### Task 3: colorHue picker with GET-verify (patch #279-equiv) — `356320e`

- `IdentityInput.colorHue` confirmed at `identities-api.ts` L22 — no type edit needed.
- Added `hueDraft` and `committedHue` state (both fall back to prop `hue` when `identity.colorHue` is null).
- Extended reset effect to reset both hue state vars; added `identity.colorHue` to dependency array.
- Inserted colorHue picker row between Voice and inline error: full-spectrum range slider (`id="identity-hue-input"`), live 24px circular swatch, numeric `{hueDraft}°` readout.
- Extended Save-disabled condition with `&& hueDraft === committedHue`.
- `onSave`: sets `meta.colorHue = hueDraft` when changed; GET-verify guard returns early with inline error when `updated.colorHue !== meta.colorHue` (the `finally` block clears `saving` — no manual `setSaving(false)` needed in the guard).
- `onSave` success: `setCommittedHue(updated.colorHue ?? hueDraft)`.
- `onCancel`: `setHueDraft(committedHue)`.
- Added hue smoke test (test 6 in `IdentityModal.test.tsx`): pencil click, slider change to 180, `180°` readout assertion, save verified to call `updateIdentity` with `{colorHue: 180}`.

## Test Results

- `npx tsc --noEmit`: passed after each task.
- `npm run build:backend`: passed after each task.
- `npm test -- IdentityModal`:
  - After Task 1: 13 tests passed (5 IdentityModal.test.tsx + 8 IdentityModal.voice.test.tsx). 2 `EnvironmentTeardownError` warnings (async teardown race, not test failures).
  - After Task 3: 14 tests passed (added hue smoke test). Exit code 0.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test 1 post-save Save-button assertion**
- **Found during:** Task 1 test run
- **Issue:** Plan spec said "verify Save button re-disables after save". But `setEditing(false)` is called on save success, collapsing the edit block — so the Save button is gone from DOM. The `waitFor(() => getByRole("button", {name: /Save/i}))` timed out.
- **Fix:** Changed assertion to `waitFor(() => { expect(getByRole("button", {name: /edit identity/i})).toBeTruthy(); expect(queryByRole("button", {name: /Save/i})).toBeNull(); })` — verifies pencil returned to non-editing state and Save is absent (correct behavior).
- **Files modified:** `IdentityModal.test.tsx`
- **Commit:** `de006dd`

**2. [Rule 1 - Bug] Added pencil preludes to IdentityModal.voice.test.tsx**
- **Found during:** Task 1 test run
- **Issue:** `npm test -- IdentityModal` also matches `IdentityModal.voice.test.tsx`. All 8 voice tests failed with "Unable to find role=combobox" because the voice select is inside the pencil-gated edit block.
- **Fix:** Added `fireEvent.click(screen.getByRole("button", { name: /edit identity/i }))` prelude to all 8 voice tests.
- **Files modified:** `IdentityModal.voice.test.tsx`
- **Commit:** `de006dd`

**3. [Rule 1 - Bug] Fixed test 5 (cancel) post-cancel title assertion**
- **Found during:** Task 1 implementation (anticipated from code analysis)
- **Issue:** After clicking Cancel, `setEditing(false)` collapses the edit block. The test tried `getByLabelText("Title")` after cancel to verify title revert — but the Title input is no longer in DOM.
- **Fix:** Added a second pencil click after cancel to re-open the edit block, then assert title reverted to "Original".
- **Files modified:** `IdentityModal.test.tsx`
- **Commit:** `de006dd`

## Key Confirmations

- **GET-verify guard is in place.** The guard at `onSave` between `updateIdentity()` and `applyIdentityChange()` returns early with `setSaveError(...)` if `updated.colorHue !== meta.colorHue`. The `finally { setSaving(false) }` block handles the `saving` flag reset — no redundant `setSaving(false)` in the guard per plan's step 9 note.
- **`IdentityInput.colorHue` did not need adding.** Confirmed at `src/ui/api/identities-api.ts` L22: `colorHue?: number | null;`.
- **Branch:** `feat/tab-title-from-tmux` throughout, no branch switch.
- **No pushes, no deploys, no edits to `skynet-patches.md`.**

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Self-Check: PASSED

- `de006dd` confirmed in git log
- `6b9d25f` confirmed in git log
- `356320e` confirmed in git log
- `src/ui/features/pretty-view/IdentityModal.tsx` modified
- `src/ui/features/pretty-view/IdentityModal.test.tsx` modified
- `src/ui/features/pretty-view/IdentityModal.voice.test.tsx` modified
- Branch: `feat/tab-title-from-tmux`
- 14 tests pass, 2 test files pass
