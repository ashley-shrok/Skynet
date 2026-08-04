# Deferred items — Phase 22

## Pre-existing NewSessionDialog test failures (out of Phase 22 scope)

**Discovered during:** Phase 22 Plan 22-02 Task 4 (2026-08-04)

**Symptom:** `src/ui/sidebar/NewSessionDialog.test.tsx` Tests 5-10 fail with
`Unable to find an accessible element with the role "button" and name "/^open$/i"`.

**Root cause:** The tests look up the primary submit button by regex `/^open$/i`,
but the button's rendered label is `"Create"` (from
`t("common.create", { defaultValue: "Create" })` in NewSessionDialog.tsx).
This was already failing on `main` before Phase 22 Task 4 landed — verified
by `git stash` + re-run before starting my changes: baseline was 6 failed
tests (5, 6, 7, 8, 9, 10) and my Task 4 work returned it to the same 6
failed tests.

**Impact:** Pre-existing regression in the test coverage; the component
behavior itself is correct (Create button works when clicked). Zero
production impact.

**Recommended fix (future work):** Update Tests 5-10 to use
`/^(open|create)$/i` (matching the pattern already used by Tests G, R, V,
etc.). Trivial ~10-line diff. Not in scope for SRIC-02 which is about role
scoping, not existing name/host picker tests.

## Pre-existing PrettyConversationsPanel test failures (out of Phase 22 scope)

**Discovered during:** Phase 22 Plan 22-04 Task 2 (2026-08-04)

**Symptom:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`
Tests 5 and 8 fail with `Unable to find an accessible element with the role
"button" and name /new session/i`.

**Root cause:** Both tests look up the pencil button by regex `/new session/i`,
but the button's actual `aria-label` is `"New agent"` (from
`t("nav.newSession", { defaultValue: "New agent" })` at
PrettyConversationsPanel.tsx:611). The label was renamed to "New agent" in a
prior phase but the tests kept the "new session" regex. Baseline before Task 2
(verified via `git stash` + re-run): 2 failed tests (5, 8). Post-Task 2: same
2 failed tests. Zero net regression.

**Impact:** Pre-existing test coverage bug; the panel button chrome and click
behavior are correct in production. Zero production impact.

**Recommended fix (future work):** Update the two tests to use
`/new agent|new session/i` (matching either label). Trivial ~4-line diff.
Not in scope for SRIC-04 which is about the sibling `+ New role` launcher.
Phase 22 Plan 22-04 verified that the new `+ New role` button's test uses
`/new role/i` (correct match against the actual label) — see
PrettyConversationsPanel.new-role-button.test.tsx.

## Pre-existing IdentityModal test failures (out of Phase 22 scope)

**Discovered during:** Phase 22 Plan 22-06 Task 3 (2026-08-04)

**Symptom:** `src/ui/features/pretty-view/IdentityModal.test.tsx` (6 tests)
and `src/ui/features/pretty-view/IdentityModal.voice.test.tsx` (8 tests)
fail with `Unable to find an accessible element with the role "button" and
name /edit identity/i`.

**Root cause:** All 14 tests look up the pencil-toggle button by regex
`/edit identity/i`, but the button's actual `aria-label` was renamed from
"Edit identity" → "Edit agent" in commit `a6a79aa`
("feat(ui-copy): terminology sweep round 1 — 'session'/'conversation' →
'agent'"). See IdentityModal.tsx:989 `aria-label={editing ? "Done editing"
: "Edit agent"}`. Baseline before Task 3 (verified via `git stash` +
re-run): 14 failed tests across both files. Post-Task 3: same 14 failed
tests. Zero net regression from Plan 22-06.

**Impact:** Pre-existing test coverage bug from the earlier terminology
sweep; the modal chrome + pencil-toggle behavior are correct in
production. Zero production impact.

**Recommended fix (future work):** Bulk-replace `/edit identity/i` →
`/edit agent|edit identity/i` (matching either label) across both files.
Trivial ~14-line diff. Not in scope for SRIC-06 which is about the Role
tab wiring; the new Role-tab integration tests
(`IdentityModal.role-tab.test.tsx`, 4 tests) all pass and the RoleFileTab
component tests (`RoleFileTab.test.tsx`, 4 tests) all pass.

