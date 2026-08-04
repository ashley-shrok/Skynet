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

