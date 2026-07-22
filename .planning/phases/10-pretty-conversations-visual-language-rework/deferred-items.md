# Deferred items — Phase 10 pretty-conversations-visual-language-rework

Items discovered during phase execution that are OUT of scope for the current
plan/wave. Not fixed here; captured so future phases can address.

## ComposeBox.test.tsx — 4 failing tests (discovered Wave 3, pre-existing)

**Discovered:** 2026-07-22 during Wave 3 full-suite regression check.

**Symptom:** 4 tests in `src/ui/features/pretty-view/ComposeBox.test.tsx` fail
with `getByLabelText(/send 'yes'/i)` / `getByLabelText(/send 'no'/i)` returning
no matching element. Test file structure at line 373:

```
const thumbsUp = screen.getByLabelText(/send 'yes'/i);
const row1 = closestFlexRowAncestor(thumbsUp, /flex items-center g…
```

**Root cause hypothesis (not verified — out-of-scope for Wave 3):** likely a
i18n key rename OR an aria-label refactor in ComposeBox.tsx that decoupled
the `send 'yes'` / `send 'no'` label strings the tests assert against.
Introduced BEFORE Wave 3 — verified by stashing Wave 3 edits and re-running:
still 4 failing / 11 passing on the pre-Wave-3 tip (Wave 2 head at `65c572c`
after Wave 3 Task 2 stash).

**Scope:** Wave 3 only touches `src/ui/AppShell.tsx` +
`src/ui/sidebar/NewSessionDialog.test.tsx`. ComposeBox.test.tsx failures are
inherited from an earlier phase / patch — likely patch #123 (last touching
ComposeBox) or Phase 9 Plan 03 (last touching ComposeBox.test.tsx). Fixing
belongs in a Phase 11 test-hygiene sweep OR a fork-patch-fix PR against the
patch that broke the labels.

**Impact:** Zero on production behavior — this is test-only breakage. The
ComposeBox component works in the running app.
