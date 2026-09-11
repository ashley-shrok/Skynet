# Deferred Items — Phase 92 (pin-sentinel-migration)

Out-of-scope findings surfaced during plan execution. Not fixed here per
executor scope-boundary rules (only fix issues DIRECTLY caused by the current
task's changes).

## Pre-existing test failures (not caused by Phase 92)

### `src/backend/database/routes/relay-room-create.test.ts` — 8 tests fail
- **Discovered during:** Plan 92-02 verification pass
- **Status:** Confirmed pre-existing via `git stash` verification — the same
  8 tests fail on `main` (the checkout state before any Phase 92-02 changes)
  with identical `expected 201, got 500` shape.
- **Not related to:** identity-birth, per-identity-file primitive, publicIdentity,
  user-preferences, identities.ts — this is a relay-room-create failure surface.
- **Action:** Belongs to a separate bounty/phase (likely relay-room-create's
  own maintainer). Not fixed here to preserve scope discipline.

### `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — Test 4 menu order
- **Discovered during:** Plan 92-04 Task 2 verification pass
- **Status:** Confirmed pre-existing via `git stash` verification — the test
  fails on the pre-Plan-92-04 codebase with the identical assertion
  `expected -1 to be greater than 1` at line 4921 (`roleIdx` is -1, meaning
  the "New role" menu item is not being found by `getAllByRole('menuitem')`).
- **Not related to:** pin-sentinel migration, identityHosts derivation,
  deriveDiskPinnedIds, hydrate effect. This is a Phase 91 menu-order test
  that has been red on this branch pre-Phase-92.
- **Action:** Belongs to whoever owns the header three-dot menu (Phase 91 /
  Phase 90 boundary). Not fixed here to preserve scope discipline.
