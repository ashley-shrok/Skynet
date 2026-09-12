---
phase: 107-hide-identity-rows-via-disk-sentinel
plan: 03
subsystem: backend
tags: [hidden-sentinel, schema-drop, migration, D-02, SC-4, drizzle-mirror, forceSave, phase-107-hidden-sentinel-migration]

requires:
  - phase: 107-02
    provides: every reader/writer of user_preferences.hiddenConversationIds retired in src/ — disk is authoritative for the hidden slice; column is dead code

provides:
  - runHiddenColumnDrop(sqliteDb) — exported idempotent probe-then-drop for hidden_conversation_ids, byte-mirror of runPinColumnDrop
  - migrateSchema wiring: runHiddenColumnDrop → addColumnIfNotExists sweep → labeled forceSave `phase-107-hidden-sentinel-migration`
  - drizzle mirror in schema.ts with hiddenConversationIds field removed (pinnedConversationIds already absent from Phase 92 Plan 03)
  - Migration test contract locked: P107-01 (OLD schema → drop → column absent + sibling VALUES preserved + post-drop SELECT throws) + P107-02 (NEW schema idempotent no-op)

affects: [107-04-frontend]

tech-stack:
  added: []
  patterns:
    - "Column-drop migration mirrors Phase 92 Plan 03 shape byte-for-byte: assertSqliteSupportsDropColumn preflight → dropColumnIfExists probe-then-drop → labeled forceSave with try/catch non-fatal warn"
    - "Drop runs BEFORE the addColumnIfNotExists sweep in migrateSchema — drops-before-adds discipline prevents a stale install from briefly re-adding the column in the same boot cycle"
    - "Single forceSave label phase-107-hidden-sentinel-migration covers BOTH drops (pin + hidden) AND the user_preferences addColumnIfNotExists sweep in one atomic file write — latest-label batches all prior mutations per Phase 92 Plan 03 precedent"
    - "P107-03/P107-04 regression traps inline in P107-01: VALUE preservation + post-drop SELECT throws — guards future refactors that might over-eagerly bundle drops or missequence ALTER operations"

key-files:
  created: []
  modified:
    - src/backend/database/db/index.ts
    - src/backend/database/db/schema.ts
    - src/backend/database/db/index.migration.test.ts

key-decisions:
  - "forceSave label locked at literal `phase-107-hidden-sentinel-migration` (CONTEXT.md § Schema migration quality-gate; presence-grepped by done-step: >= 3 occurrences in index.ts)"
  - "runHiddenColumnDrop placed IMMEDIATELY BELOW runPinColumnDrop in db/index.ts source order (chronological migration ordering — grep for run.*Drop yields phase-number sequence)"
  - "Preflight throws fatal (T-66-04-04 precedent: boot aborts before schema corruption); forceSave failure wraps in non-fatal warn (idempotent drop retries next boot)"
  - "Single forceSave label is always the LATEST migration — phase-92 label retired, phase-107 label takes over, semantically batching both drops + the remaining addColumnIfNotExists sweep"
  - "addColumnIfNotExists line for hidden_conversation_ids deleted from sweep — fresh installs post-Phase-107 never create the dead column (D-02 no-dormant-column invariant)"

requirements-completed: [D-02, SC-4]

duration: ~3 min
completed: 2026-09-12T15:00:14Z
---

# Phase 107 Plan 107-03: Drop hidden_conversation_ids from user_preferences Summary

**Physical schema drop closes the two-sources-of-truth window at the hidden slice: `runHiddenColumnDrop()` (byte-mirror of `runPinColumnDrop`) drops the dead `hidden_conversation_ids` column from `user_preferences` on boot, the drizzle mirror field is deleted from `schema.ts`, and the mutation persists via labeled `forceSave("phase-107-hidden-sentinel-migration")` after the addColumnIfNotExists sweep.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-09-12T14:56:58Z
- **Completed:** 2026-09-12T15:00:14Z
- **Tasks:** 1 (TDD RED → GREEN across test + implementation)
- **Files modified:** 3 (0 created, 3 modified)

## Accomplishments

### `runHiddenColumnDrop()` exported (GREEN)

Added immediately below `runPinColumnDrop` in `db/index.ts`. Shape is exact byte-mirror of Phase 92 Plan 03's `runPinColumnDrop` — only the column name differs:

```ts
export function runHiddenColumnDrop(sqliteDb: Database.Database): void {
  assertSqliteSupportsDropColumn(sqliteDb);
  dropColumnIfExists(sqliteDb, "user_preferences", "hidden_conversation_ids");
}
```

Idempotent via `dropColumnIfExists` (probes `SELECT hidden_conversation_ids FROM user_preferences LIMIT 1` — on throw the column is absent → silent return; on success → `ALTER TABLE ... DROP COLUMN`). Fully documented with the Phase 107 D-02 context in the docblock.

### migrateSchema wiring landed (GREEN)

`runHiddenColumnDrop(sqlite)` invocation added AFTER the `runPinColumnDrop` preflight try/catch AND BEFORE the `addColumnIfNotExists` sweep, wrapped in a preflight try/catch that rethrows on failure (mirrors runPinColumnDrop at L978-987 — T-66-04-04 "boot aborts before schema corruption" precedent). The `addColumnIfNotExists("user_preferences", "hidden_conversation_ids", "TEXT")` line was deleted from the sweep (fresh installs no longer create the column per D-02 "no dormant column").

**Migration ordering in boot sequence:**
1. `runIdentitiesCosmeticDrops` (Phase 66)
2. `runIdentitiesTableDrop` + forceSave `phase-68-drop-identities-table` (Phase 68)
3. `runPinColumnDrop` preflight try/catch (Phase 92)
4. `runHiddenColumnDrop` preflight try/catch (Phase 107 — THIS PLAN)
5. `addColumnIfNotExists` sweep (theme, font_size, accent_color, language — WITHOUT hidden_conversation_ids)
6. Labeled forceSave `phase-107-hidden-sentinel-migration` (batches both drops + sweep in one atomic write)

### forceSave label swapped `phase-92-pin-sentinel-migration` → `phase-107-hidden-sentinel-migration` (GREEN)

The single labeled forceSave after the addColumnIfNotExists sweep now covers:
- The pin column drop (still fires every boot — idempotent, silent no-op after first boot)
- The hidden column drop (new — Phase 107 addition)
- The remaining addColumnIfNotExists sweep (theme, font_size, accent_color, language)

All three mutations flush to the encrypted SQLite file in ONE atomic write. This is the Phase 92 Plan 03 pattern applied to the next phase — the forceSave label is always the LATEST migration touching this file.

### Drizzle mirror field removed (GREEN)

Deleted `hiddenConversationIds: text("hidden_conversation_ids"),` from `userPreferences` in `schema.ts`. `pinnedConversationIds` already absent (Phase 92 Plan 03). Both conversation-ids fields are now gone from the drizzle mirror — the `userPreferences` sqliteTable has no conversation-ids fields at all, both slices fully migrated to disk sentinels.

### Migration test contract locked (RED → GREEN)

Two new `it(...)` bodies inside a `Phase 107 migration — drop hidden_conversation_ids from user_preferences` describe block appended to `db/index.migration.test.ts`:

- **Test P107-01 (OLD schema → drop → column absent, siblings intact, row data preserved):** Seeds an in-memory SQLite with `OLD_USER_PREFERENCES_WITH_HIDDEN_CREATE_SQL` (post-Phase-92 shape: `pinned_conversation_ids` already gone, `hidden_conversation_ids` present), inserts one row with real values (`"dark"` theme, `"en"` language, hidden ids JSON). Runs `runHiddenColumnDrop(db)`. Asserts: `hidden_conversation_ids` absent from PRAGMA post-drop; `theme`, `language`, `updated_at`, `reopen_tabs_on_login`, `user_id`, `font_size`, `accent_color` still present; the surviving row's `theme` reads back as `"dark"` AND `language` reads back as `"en"` byte-for-byte (Test P107-03 inline — sibling-VALUE-preserved regression trap); a raw `SELECT hidden_conversation_ids FROM user_preferences` throws (Test P107-04 inline — proves physical absence, not just PRAGMA hiding).

- **Test P107-02 (NEW schema idempotent no-op):** Seeds with `NEW_USER_PREFERENCES_POST_HIDDEN_DROP_CREATE_SQL` (post-Phase-107 shape: BOTH pin AND hidden columns absent), asserts sanity (neither column present), runs `runHiddenColumnDrop(db)`, asserts no-throw AND PRAGMA shape unchanged AND all sibling columns still present.

`runHiddenColumnDrop` added to the destructured import at the top of the file.

**Result:** 24/24 tests green (22 pre-existing + 2 new P107-01 + P107-02 tests). All Phase 66/68/72/75/79/85/92 tests pass verbatim — no regressions.

## Task Commits

1. `012e49e6` (test) — RED: 2 failing tests (P107-01, P107-02); `runHiddenColumnDrop` not yet exported → `TypeError: runHiddenColumnDrop is not a function`; 22 existing tests still pass
2. `b11ac8e0` (feat) — GREEN: `runHiddenColumnDrop` exported + migrateSchema wired + addColumnIfNotExists line deleted + forceSave label swapped + schema.ts drizzle field removed; 24/24 tests green; `npm run build:backend` exits 0

## runHiddenColumnDrop / runPinColumnDrop Byte-Mirror Relationship

The only structural difference between the two exported functions:

```
runPinColumnDrop:    dropColumnIfExists(sqliteDb, "user_preferences", "pinned_conversation_ids");
runHiddenColumnDrop: dropColumnIfExists(sqliteDb, "user_preferences", "hidden_conversation_ids");
```

Same `assertSqliteSupportsDropColumn` preflight. Same `dropColumnIfExists` helper. Same preflight-rethrows-fatal / forceSave-wraps-non-fatal asymmetry. Same export pattern for testability. Future migrations can grep `run.*Drop` in db/index.ts to see the full drop sequence in phase-number order.

## forceSave Label Swap (Phase 92 → Phase 107)

The forceSave label is always the LATEST migration touching the user_preferences section of migrateSchema. `phase-92-pin-sentinel-migration` captured: (a) the pin column drop + (b) the addColumnIfNotExists sweep. `phase-107-hidden-sentinel-migration` now captures: (a) the pin column drop + (b) the hidden column drop + (c) the reduced addColumnIfNotExists sweep (theme/font_size/accent_color/language). On a fresh install post-Phase-107, the forceSave fires once with the latest label. On a previously-Phase-92-migrated install, the forceSave fires again with the new label — idempotent, but ensures the hidden column drop is flushed to disk atomically.

## P107-03 / P107-04 Regression Traps

**P107-03 (sibling VALUE preservation, inline in P107-01):** The seeded row's `theme` and `language` values survive the drop byte-for-byte. Any future refactor that accidentally bundles both column drops together in a broader ALTER TABLE (or drops the wrong column) fails this test loudly.

**P107-04 (post-drop SELECT throws, inline in P107-01):** A raw `SELECT hidden_conversation_ids FROM user_preferences` throws after the drop. Proves the column is physically absent — not merely absent from PRAGMA output (which SQLite's cached schema could theoretically stale-report). Guards against a misfiring `dropColumnIfExists` that only clears the schema cache but doesn't execute the ALTER.

## Deploy-Race Note

This Plan ships BEFORE Plan 04 (frontend rewire). Between deploy of Plan 03 and deploy of Plan 04:
- The DB column is physically gone
- The disk sentinels are authoritative (Plan 02)
- A pre-Plan-04 frontend tab still calling `putHiddenIds` without `identityHosts` receives a 400 (Plan 02's `HID-107-PUT-07d` validation)

This is the expected single-user window — Alice's deploy motion is quick; a mid-deploy tab-open surfaces as a browser console 400, not data loss. Next remount post-Plan-04 wires the correct call signature.

## Grep-Hygiene Snapshot

| Check | Result | Requirement |
|-------|--------|-------------|
| `grep -c 'runHiddenColumnDrop\|phase-107-hidden-sentinel-migration' db/index.ts` | 5 | >= 3 |
| `grep -c 'hiddenConversationIds' db/schema.ts` | 0 | 0 |
| `grep -c 'addColumnIfNotExists.*hidden_conversation_ids' db/index.ts` | 0 | 0 |
| `grep -c 'runHiddenColumnDrop' index.migration.test.ts` | 6 | >= 3 |
| `grep -c 'pinnedConversationIds' db/schema.ts` | 0 | 0 (Phase 92 regression trap) |
| `grep -c 'phase-92-pin-sentinel-migration' db/index.ts` | 0 | 0 (label replaced) |
| `grep -rn 'row\.hiddenConversationIds\|updates\.hiddenConversationIds' src/backend/ (non-test)` | 0 | 0 |

## Deviations from Plan

### None — plan executed exactly as written

The TDD flow followed the plan's prescribed order (RED test commit → GREEN implementation commit). The `row.hiddenConversationIds` reference in `user-preferences.test.ts` (Plan 02's HID-107-DB-01 test) is a test mock object assertion (not a drizzle query on the live DB) — excluded from the grep-hygiene check as expected per the plan's intent (production code = 0 hits).

## Known Stubs

None — the migration is wired end-to-end. `runHiddenColumnDrop` executes a real `ALTER TABLE DROP COLUMN` via `dropColumnIfExists`. `forceSave` is the live `DatabaseSaveTrigger.forceSave`. No hardcoded empty values or placeholder text introduced.

## Threat Flags

None — no new network endpoints, no new auth paths, no new external dependencies. The drop reduces the attack surface by eliminating dead storage. Trust boundary at migrateSchema → sqlite driver is unchanged from Phase 92.

## Self-Check: PASSED

- Modified files (verified):
  - `src/backend/database/db/index.ts` — FOUND (`runHiddenColumnDrop` export + migrateSchema wire + forceSave label `phase-107-hidden-sentinel-migration` + `addColumnIfNotExists.*hidden_conversation_ids` absent)
  - `src/backend/database/db/schema.ts` — FOUND (`hiddenConversationIds` field absent; `pinnedConversationIds` still absent from Phase 92)
  - `src/backend/database/db/index.migration.test.ts` — FOUND (`runHiddenColumnDrop` in import + `OLD_USER_PREFERENCES_WITH_HIDDEN_CREATE_SQL` + `NEW_USER_PREFERENCES_POST_HIDDEN_DROP_CREATE_SQL` + Phase 107 describe block with two `it(...)` bodies)
- Commits (both hashes exist on `feat/tab-title-from-tmux`):
  - `012e49e6` — FOUND (test RED)
  - `b11ac8e0` — FOUND (feat GREEN)
- Scoped-test result: 24/24 tests green in `db/index.migration.test.ts` (22 pre-existing + 2 new P107-* tests)
- Backend build: `npm run build:backend` exits 0 — no type errors

---

*Phase: 107-hide-identity-rows-via-disk-sentinel*
*Completed: 2026-09-12*
