---
phase: 92-pin-sentinel-migration
plan: 03
subsystem: backend
tags: [pin-sentinel, user-preferences, schema-drop, migration, D-02, drizzle-mirror, forceSave, phase-92-pin-sentinel-migration]

requires:
  - phase: 92-02
    provides: every reader/writer of user_preferences.pinnedConversationIds retired in src/ (grep-hygiene verified in 92-02-SUMMARY)
provides:
  - runPinColumnDrop(sqliteDb) — exported idempotent probe-then-drop for the pinned_conversation_ids column, byte-mirror of runIdentitiesTableDrop's shape
  - migrateSchema wiring: runPinColumnDrop → addColumnIfNotExists sweep → labeled forceSave `phase-92-pin-sentinel-migration`
  - drizzle mirror in schema.ts with pinnedConversationIds field removed (hiddenConversationIds untouched per D-02)
  - Migration test contract locked at test-owned in-memory DB level: Test P92-01 (OLD schema → drop → column absent + sibling VALUE preserved + post-drop SELECT throws) + Test P92-02 (NEW schema idempotent no-op)
affects: [92-04-frontend]

tech-stack:
  added: []
  patterns:
    - "Column-drop migration mirrors Phase 66-04 / Phase 68-05 shape byte-for-byte: assertSqliteSupportsDropColumn preflight → dropColumnIfExists probe-then-drop → labeled forceSave with try/catch non-fatal warn (idempotent-so-next-boot-retries)"
    - "Drop runs BEFORE the addColumnIfNotExists sweep in migrateSchema — same ordering rationale as runIdentitiesCosmeticDrops at L901 (drops before adds so a stale install cannot briefly re-add the column in the same boot cycle)"
    - "Sibling-column preservation via test-level regression trap (Test P92-04 inline in P92-01): PRAGMA lists hidden_conversation_ids post-drop AND its seeded value is byte-for-byte preserved (guards against a future refactor bundling both drops)"

key-files:
  created: []
  modified:
    - src/backend/database/db/index.ts
    - src/backend/database/db/schema.ts
    - src/backend/database/db/index.migration.test.ts

key-decisions:
  - "forceSave label locked at literal `phase-92-pin-sentinel-migration` (quality-gate — mitigation for T-92-03-03 mislabel-breaks-ops-grep; presence-grepped by Task 1 verify step and threaded through the plan's frontmatter contains-regex)"
  - "runPinColumnDrop placed AFTER runIdentitiesTableDrop in db/index.ts source order (chronological migration ordering — reader can grep for `run.*Drop` and see the migration sequence in phase-number order)"
  - "Preflight failure rethrows loudly (T-66-04-04 precedent — boot aborts before schema corruption); forceSave failure wrapped in non-fatal warn (idempotent drop retries next boot)"
  - "Single labeled forceSave covers BOTH the pin-column drop AND the user_preferences addColumnIfNotExists sweep in one atomic file write — no separate forceSave for the sweep needed since the phase-92 label captures both mutations"

requirements-completed: [D-02, D-08-migration-sequencing]

duration: 3min
completed: 2026-09-09
---

# Phase 92 Plan 92-03: Drop pinned_conversation_ids from user_preferences Summary

**Physical schema drop closes the two-sources-of-truth window: `runPinColumnDrop()` (byte-mirror of `runIdentitiesTableDrop`) drops the dead `pinned_conversation_ids` column from `user_preferences` on boot, the drizzle mirror field is deleted from `schema.ts`, and the mutation persists via labeled `forceSave("phase-92-pin-sentinel-migration")` after the addColumnIfNotExists sweep.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-09-09T19:07:33Z
- **Completed:** 2026-09-09T19:10:49Z
- **Tasks:** 2 (Task 1 implementation; Task 2 migration test — executed TDD RED→GREEN across both)
- **Files modified:** 3 (0 created, 3 modified)

## Accomplishments

- **`runPinColumnDrop()` exported (Task 1 GREEN):** Added below `runIdentitiesTableDrop` in `db/index.ts`. Shape is byte-mirror of `runIdentitiesCosmeticDrops`'s pattern:
  ```ts
  export function runPinColumnDrop(sqliteDb: Database.Database): void {
    assertSqliteSupportsDropColumn(sqliteDb);
    dropColumnIfExists(sqliteDb, "user_preferences", "pinned_conversation_ids");
  }
  ```
  Idempotent via `dropColumnIfExists`'s probe-then-drop (probes `SELECT pinned_conversation_ids FROM user_preferences LIMIT 1` — on throw the column is absent → silent return; on success → `ALTER TABLE ... DROP COLUMN`). Fully documented with the Phase 92 D-02 context in the docblock (points at Plan 92-01's `.pinned` sentinel convention + Plan 92-02's reader/writer retirement + the T-92-03-04 sibling-preservation regression trap in the migration test).

- **migrateSchema wiring landed (Task 1 GREEN):** `runPinColumnDrop(sqlite)` invocation added BEFORE the `addColumnIfNotExists` sweep at L941+, wrapped in a preflight try/catch that rethrows on failure (mirrors runIdentitiesCosmeticDrops at L901-913 — T-66-04-04 "boot aborts before schema corruption" precedent). The `addColumnIfNotExists("user_preferences", "pinned_conversation_ids", "TEXT")` line was deleted from the sweep (fresh installs no longer create the column per D-02 "no dormant column"). The `hidden_conversation_ids` addColumnIfNotExists line remains verbatim (D-02 out-of-scope invariant).

- **Labeled `forceSave` persists the mutation (Task 1 GREEN):** Added `await DatabaseSaveTrigger.forceSave("phase-92-pin-sentinel-migration")` immediately after the user_preferences addColumnIfNotExists sweep completes. Wrapped in try/catch with a non-fatal `databaseLogger.warn` — mirrors phase-68 (L928-939) / phase-75 (L995-1006) / phase-85 (L1024-1035) precedent (dropColumnIfExists is idempotent, so a save failure retries on next boot; first-ever boot uninitialized-trigger race tolerated). The label is literal (locked by the plan's threat-model mitigation T-92-03-03 against mislabeled forceSave breaking future ops-grep).

- **Drizzle mirror field removed (Task 1 GREEN):** Deleted `pinnedConversationIds: text("pinned_conversation_ids"),` from `userPreferences` in `schema.ts:838`. `hiddenConversationIds` field on L839 untouched. Verified compile parity: `tsc --noEmit -p .` clean across `src/` — Plan 92-02 already retired every drizzle-mirror consumer, so this deletion produces zero compile errors.

- **Migration test contract locked (Task 2 GREEN):** Two new `it(...)` bodies inside a `Phase 92 migration — drop pinned_conversation_ids from user_preferences` describe block appended to `db/index.migration.test.ts`:
  - **Test P92-01 (OLD schema → drop → column absent, siblings intact, row data preserved):** Seeds an in-memory SQLite with `OLD_USER_PREFERENCES_CREATE_SQL` (includes BOTH pin AND hide columns), inserts one row with real values for both (`'["fleet::1::alice"]'` pin, `'["fleet::2::bob"]'` hide, `"dark"` theme). Runs `runPinColumnDrop(db)`. Asserts: `pinned_conversation_ids` absent from PRAGMA post-drop; `hidden_conversation_ids` still present; the surviving row's `theme` reads back as `"dark"` AND its `hidden_conversation_ids` reads back as `'["fleet::2::bob"]'` byte-for-byte (Test P92-04 inline — T-92-03-04 sibling-preservation regression trap); a raw `SELECT pinned_conversation_ids FROM user_preferences` throws (Test P92-03 inline — proves physical absence, not just PRAGMA hiding).
  - **Test P92-02 (NEW schema idempotent no-op):** Seeds with `NEW_USER_PREFERENCES_CREATE_SQL` (pinned_conversation_ids absent), asserts sanity, runs `runPinColumnDrop(db)`, asserts no-throw AND PRAGMA shape unchanged AND `hidden_conversation_ids` still present.
  - `runPinColumnDrop` added to the destructured import at the top of the file alongside the phase-66/68 exports.

- **Adjacent tests unregressed:** All 20 pre-existing tests in `db/index.migration.test.ts` (Phase 66-04 cosmetic drops, Phase 68-05 table drop, Phase 72-02 ssh_data.runs_fleet_substrate, Phase 75-01 matrix_admin_creds + users.mxid, Phase 79 identity_send_log, Phase 85-01 users.avatar_path) pass verbatim after the two new Phase 92 tests were added → 22/22 green. Adjacent `user-preferences.test.ts` route tests → 33/33 green.

## Task Commits

Task 2 (TDD RED, mixed with Task 1's implementation order — see Deviations):
1. `0a88c7c0` (test) — RED: 2 failing tests (P92-01, P92-02) for `runPinColumnDrop` import + OLD/NEW schema behavior + inline P92-03/P92-04 regression traps. Test file `index.migration.test.ts` gains a new `Phase 92 migration` describe block + `OLD_USER_PREFERENCES_CREATE_SQL` / `NEW_USER_PREFERENCES_CREATE_SQL` const literals + import destructuring for `runPinColumnDrop`. Fails with `TypeError: runPinColumnDrop is not a function` — expected RED.

Task 1 (GREEN):
2. `2f6e75e2` (feat) — GREEN: `runPinColumnDrop` exported from `db/index.ts` (byte-mirror of `runIdentitiesTableDrop` shape); migrateSchema wire (preflight-throws + labeled forceSave post-add-sweep); addColumnIfNotExists("user_preferences", "pinned_conversation_ids", "TEXT") deleted from the sweep; drizzle `pinnedConversationIds` field deleted from `schema.ts` userPreferences mirror. Turns P92-01 + P92-02 GREEN; 22/22 in-file tests green; tsc --noEmit clean.

## Files Modified

- **`src/backend/database/db/index.ts`** (modified, +54 -1) —
  - Added `runPinColumnDrop(sqliteDb)` export below `runIdentitiesTableDrop` at L892+ with the full Phase 92 D-02 docblock (references `.pinned` sentinel convention, Plan 92-02 retirement, sibling preservation invariant).
  - Wired `try { runPinColumnDrop(sqlite); } catch (preflightErr) { ... rethrow }` block inside `migrateSchema` immediately after the phase-68 `forceSave` block and BEFORE the addColumnIfNotExists sweep.
  - Deleted `addColumnIfNotExists("user_preferences", "pinned_conversation_ids", "TEXT");` from the sweep.
  - Added `try { await DatabaseSaveTrigger.forceSave("phase-92-pin-sentinel-migration"); } catch (saveError) { ... warn }` block after the user_preferences addColumnIfNotExists sweep completes.
- **`src/backend/database/db/schema.ts`** (modified, +0 -1) — Deleted `pinnedConversationIds: text("pinned_conversation_ids"),` from the `userPreferences` sqliteTable. `hiddenConversationIds` field untouched.
- **`src/backend/database/db/index.migration.test.ts`** (modified, +140 -0) —
  - Added `runPinColumnDrop` to the destructured import from `./index.js`.
  - Appended a new `Phase 92 migration — drop pinned_conversation_ids from user_preferences` describe block with two `it(...)` bodies (P92-01, P92-02) exercising OLD/NEW schema paths + inline P92-03/P92-04 regression traps. Two new SQL const literals `OLD_USER_PREFERENCES_CREATE_SQL` + `NEW_USER_PREFERENCES_CREATE_SQL` declared above the describe block, matching the existing OLD/NEW const style used by Phase 66/72/75/85.

## Decisions Made

- **Byte-mirror of `runIdentitiesCosmeticDrops` shape (not a bespoke drop helper):** The plan's threat model (T-92-03-01) and the pre-Phase-92 precedent (Phase 66-04 cosmetic drops, Phase 68-05 table drop) both point at the same 3-line shape: assert SQLite supports DROP COLUMN → probe-then-drop the specific column. Introducing a new abstraction (e.g. a "runUserPreferencesDrops" that batches multiple future drops) would over-engineer for a single-column drop and diverge from the audit shape future migrations follow. Same shape, same file, same location relative to the other run*Drop helpers.

- **Preflight throws fatal, forceSave failure warns non-fatal:** This asymmetry is inherited from phase-66/68/75/85 precedent and preserves the two invariants: (a) an unsupported SQLite version MUST abort boot — a "partially-migrated" schema where the ALTER runs against a >3.35 engine but silently no-ops on <3.35 would leave inconsistent state (T-66-04-04); (b) a `forceSave` failure on first-ever boot (before `DatabaseSaveTrigger` is fully initialized by `handlePostInitFileEncryption`) is expected and recoverable — the drop is idempotent, so the next boot re-fires the drop and forceSave together. Rethrowing on forceSave failure would fail every fresh install on the first boot.

- **Single forceSave label covers both the drop AND the addColumnIfNotExists sweep:** The plan explicitly instructs adding the forceSave AFTER the user_preferences addColumnIfNotExists sweep completes. This means the label `phase-92-pin-sentinel-migration` semantically captures both the pin-column drop AND whatever add-columns still lived in the sweep. Since the sweep was reduced by the deletion of the pin line, and the remaining add-columns (theme, font_size, accent_color, language, hidden_conversation_ids) are also idempotent-no-op on already-migrated installs, one forceSave batches all these mutations in one atomic file write. No separate forceSave for the sweep needed.

- **Drop placed BEFORE the addColumnIfNotExists sweep (not after):** Same ordering rationale as `runIdentitiesCosmeticDrops` at L901-913: on a legacy install where the addColumnIfNotExists line for the dropped column somehow survived a partial rollback (e.g. from a botched deploy), placing the drop AFTER the sweep would briefly re-add the column in-flight before the drop retired it — a wasted ALTER pair. Drop-first is defensive against that class of surprise. In this specific plan the sweep line was deleted in the same commit, so the theoretical re-add can't happen from THIS codebase — but the ordering discipline is worth preserving for future refactors that might reintroduce the line by mistake.

- **Test file: extend existing `db/index.migration.test.ts`, don't create a new file:** The plan explicitly names this file as the target, and Phase 66/68/72/75/79/85 tests all live in the same file. A new file would fragment the migration-test audit surface (a future reader searching for "how does Skynet test migrations?" should find one file with N describe blocks, not N files).

- **P92-04 (sibling preservation) collapsed inline into P92-01, not a separate `it(...)`:** The plan's `<behavior>` section names four sub-tests (P92-01 through P92-04), but P92-01 and P92-04 both need the same seeded row with both pin AND hide values populated. Splitting into two `it(...)` bodies would duplicate the seed setup, and vitest's `it` isolation means each body opens its own `new Database(":memory:")` — the duplication is pure. Rolling P92-04 into P92-01 as an additional assertion pair keeps the seed reuse and preserves the "one describe block, two it bodies" structure the plan's `<action>` explicitly asks for.

## Deviations from Plan

### None (Rule 1/2/3 clean)

No auto-fix deviations needed. The plan's `<action>` sections gave a precise implementation blueprint; execution followed it directly. The one flow adjustment worth noting (not a deviation, just an ordering choice within TDD-mode's RED→GREEN→REFACTOR structure):

**RED committed as `test(92-03-task2)` before Task 1's implementation.** The plan lists Task 1 (implementation) first and Task 2 (tests) second, but marks both as `tdd="true"`. The pragmatic ordering to honor TDD's "test drives implementation" invariant is: append the failing tests first (Task 2 RED), then implement the function to turn them green (Task 1 GREEN). This yields the same final state but produces a proper RED commit before the GREEN commit — matching the Phase 66 / Phase 68 / Phase 92-01 / Phase 92-02 precedent commit topology.

**Note on the plan's `<done>` grep expectation for `pinned_conversation_ids` in db/index.ts:** The plan says `grep -c "pinned_conversation_ids" src/backend/database/db/index.ts` returns 0. Post-implementation this grep returns 4: (1) the docblock comment in `runPinColumnDrop`, (2) the `dropColumnIfExists(..., "user_preferences", "pinned_conversation_ids")` call — the entire POINT of the function, (3) two migrateSchema block comments referencing the drop. The plan's literal `= 0` expectation is inconsistent with the function needing to name the column it drops. The spirit of the grep — no CALLSITE READS/WRITES to the column outside the drop path — is satisfied: the `addColumnIfNotExists` line is gone, the CREATE TABLE block never referenced it, and no query builds on `user_preferences.pinned_conversation_ids`. The 4 remaining refs are all inside the drop plumbing itself.

## Threat Flags

None. The threat surface is REDUCED by this plan:
- **T-92-03-01 (DoS on old SQLite):** Mitigated — `assertSqliteSupportsDropColumn` preflight runs first, throws loudly on SQLite <3.35 rather than silently continuing with a partially-migrated schema. Same shape as phase-66 mitigation.
- **T-92-03-02 (data loss on pin history):** Accepted per D-08. Migration order per box: (1) query `pinnedConversationIds` before deploy, (2) `touch ~/.claude/identities/<name>/.pinned` on the host, (3) deploy new code. No code participates. Alice + Stacy each handle their own box per D-07.
- **T-92-03-03 (forceSave mislabel breaks ops-grep):** Mitigated — literal label `"phase-92-pin-sentinel-migration"` locked by both this SUMMARY's grep-hygiene and the plan's frontmatter contains-regex.
- **T-92-03-04 (drop bundles hidden_conversation_ids as scope creep):** Mitigated — Test P92-04 regression trap (inline in P92-01) explicitly asserts `hidden_conversation_ids` survives the drop with its seeded VALUE intact. Any future refactor that over-eagerly bundles both drops fails this test loudly.
- **T-92-03-05 (migration failure invisible in logs):** Accepted — existing `databaseLogger.error/warn` shape at L907-912 / L1042-1053 preserved verbatim; log tag `schema_migration_force_save_post_drop` grepable by ops.

No new network endpoints. No new auth paths. No new external dependencies. Trust boundary at migrateSchema → sqlite driver is unchanged.

## Issues Encountered

None — no blockers, no auth gates, no architectural surprises, no unrelated pre-existing test failures re-surfaced. The plan's `<action>` sections gave a precise implementation blueprint; execution followed it directly. `npx tsc --noEmit -p .` runs clean across `src/` post-changes.

## User Setup Required

None — pure backend schema-migration commit. No new dependencies, no new env vars, no new external service configuration, no nginx changes (routes unchanged). Deploy motion is out of scope per fleet rules (executor scope stops at code + commit + tests-green; orchestrator handles per-box deploy sequencing per D-07 / D-08).

## Next Phase Readiness

- **Plan 92-04 (frontend) is unblocked:** With the DB column physically dropped and the drizzle mirror field gone, Plan 92-04 can freely rewire `conversation-store` pin derivation to consume the `identity.pinned` field on the `publicIdentity` response object (Plan 92-02's read path) without any risk of a stale DB-column code path re-surfacing. The two-sources-of-truth window is closed at the schema level.
- **Confirmation of migration sequencing:** This is the LAST plumbing step. Plan 92-01 shipped the primitive, Plan 92-02 rewired the read/write paths, Plan 92-03 dropped the dead storage. Plan 92-04 is UI-only (frontend consumers of `getPinnedIds` shift from `user-preferences-api` DB read to the new identity-metadata projection).
- **Manual per-box migration is orchestrator-owned:** Per D-07 / D-08, each box maintainer (Alice for t1000, Stacy for T800) runs the pre-deploy `touch ~/.claude/identities/<name>/.pinned` sequence before their container recreate. The executor scope ends here; the orchestrator wires the deploy motion around this commit.

## Self-Check: PASSED

- Modified files (verified at git-diff level):
  - `src/backend/database/db/index.ts` — FOUND (verified `runPinColumnDrop` export at L906-914, migrateSchema wire at L946+, forceSave label + try/catch at L1000+, addColumnIfNotExists pin line absent)
  - `src/backend/database/db/schema.ts` — FOUND (verified `pinnedConversationIds` field absent from `userPreferences` mirror, `hiddenConversationIds` field intact)
  - `src/backend/database/db/index.migration.test.ts` — FOUND (verified `runPinColumnDrop` in import, `OLD_USER_PREFERENCES_CREATE_SQL` + `NEW_USER_PREFERENCES_CREATE_SQL` declared, `Phase 92 migration` describe block appended with two `it(...)` bodies)
- Commits (all short hashes exist on `feat/tab-title-from-tmux`):
  - `0a88c7c0` — FOUND (test RED)
  - `2f6e75e2` — FOUND (feat GREEN)
- Scoped-test result: 22/22 tests green in `db/index.migration.test.ts` (20 pre-existing + 2 new P92-* tests). 33/33 in `user-preferences.test.ts` (adjacent route tests). `tsc --noEmit -p .` clean across `src/`.
- Grep-hygiene:
  - `runPinColumnDrop|phase-92-pin-sentinel-migration` in `db/index.ts` → 5 refs (>= 3 required by plan) ✓
  - `pinnedConversationIds` in `db/schema.ts` → 0 refs (drizzle mirror field removed) ✓
  - `userPreferences.pinnedConversationIds` or `userPreferences['pinnedConversationIds']` in `src/**` → 0 hits (no drizzle-mirror consumers) ✓
  - `addColumnIfNotExists.*pinned_conversation_ids` in `db/index.ts` → 0 hits (sweep line deleted) ✓
  - `runPinColumnDrop` in `index.migration.test.ts` → 3 refs (import + P92-01 body + P92-02 body) ✓

---

*Phase: 92-pin-sentinel-migration*
*Completed: 2026-09-09*
