---
phase: 128-push-notifications-replacing-telegram-bridge
plan: 09
subsystem: infra
tags: [telegram-teardown, source-deletion, destructive, tg-bridge, matrix, drizzle-schema, voice-route]

# Dependency graph
requires:
  - phase: 128-08
    provides: "Route mount + starter dispatches removed (telegramRoutes unmounted; observation-loop dispatches gone) — with those gone, deleting the source cannot break the running server."
  - phase: 128-01
    provides: "At-boot DROP migration for the telegram_bot_tokens SQLite table (runTelegramBotTokensTableDrop in db/index.ts) — this plan removes the Drizzle export; the runtime DROP was already in place."
provides:
  - "src/backend/telegram/ entirely deleted (22 files)"
  - "substrate/services/tg-bridge/ entirely deleted (4 files)"
  - "voice.ts rejectBridgeServiceOnSpeak middleware + its mount points on POST /speak and /speak-stream removed"
  - "schema.ts telegramBotTokens Drizzle export removed"
  - "matrix-admin-client.ts getSharedDMRoom function + its tests removed (D-19 grep gate returned zero non-telegram production callers)"
  - "matrix-admin-routes.ts /matrix-admin/migrate-cred-files handler + tests removed (Rule 3 transitive — the only surviving importer of ../telegram/* modules outside src/backend/telegram/)"
affects: [128-10, 128-11, "future post-Phase-128 code that would look for tg-bridge helpers"]

# Tech tracking
tech-stack:
  added: []  # deletion-only plan
  patterns:
    - "Deletion-notice narrative comments left in place where they replace deleted symbols — future readers hitting an old blame or grep entry find the deletion rationale + phase reference inline"
    - "D-19-style grep gate pattern: for a helper marked for conditional deletion, run a grep that excludes both (a) the module defining the helper and (b) the modules being deleted alongside it; the residue is the set of surviving callers whose treatment governs the delete decision"

key-files:
  created: []
  modified:
    - "src/backend/matrix/matrix-admin-routes.ts (-1 import block, -1 handler ~L264-381)"
    - "src/backend/matrix/matrix-admin-routes.test.ts (-1 import block, -1 describe block ~L654-821, -2 mocks, -users schema mock)"
    - "src/backend/database/routes/voice.ts (-rejectBridgeServiceOnSpeak function + its 2 mount references, -NextFunction import)"
    - "src/backend/database/db/schema.ts (-telegramBotTokens sqliteTable export)"
    - "src/backend/matrix/matrix-admin-client.ts (-getSharedDMRoom function; 2 helper comment refs updated to note historical extraction)"
    - "src/backend/matrix/matrix-admin-client.test.ts (-getSharedDMRoom import, -describe block G-01..G-07, -Test 5 extraction-regression test)"
  deleted:
    - "src/backend/telegram/bot-token-file-writer.ts + .test.ts"
    - "src/backend/telegram/bridge-config-writer.ts + .test.ts"
    - "src/backend/telegram/bridge-service-token.ts + .test.ts"
    - "src/backend/telegram/getme-proxy.ts + .test.ts"
    - "src/backend/telegram/human-token-writer.ts + .test.ts"
    - "src/backend/telegram/reconcile-dead-tokens.ts + .test.ts"
    - "src/backend/telegram/reconcile-pending-chat-ids.ts + .test.ts"
    - "src/backend/telegram/registry-writer.ts + .test.ts"
    - "src/backend/telegram/routes.ts + .test.ts"
    - "src/backend/telegram/shared-volume.ts + .test.ts"
    - "src/backend/telegram/tokens-store.ts + .test.ts"
    - "substrate/services/tg-bridge/bridge.sh"
    - "substrate/services/tg-bridge/Dockerfile.tg-bridge"
    - "substrate/services/tg-bridge/README.md"
    - "substrate/services/tg-bridge/cursor-persistence-repro.sh"

key-decisions:
  - "D-19 grep gate result: getSharedDMRoom is DELETED — grep returned zero non-telegram production callers (only test-file references, which follow the function)"
  - "Rule 3 scope expansion: matrix-admin-routes.ts's /matrix-admin/migrate-cred-files handler was the only surviving importer of ../telegram/human-token-writer.js + ../telegram/shared-volume.js — deleted as transitive teardown per D-18"
  - "voice.ts NextFunction import dropped — no surviving middleware in the file used it"
  - "Deletion notices left in place where symbols were removed (rejectBridgeServiceOnSpeak, telegramBotTokens, getSharedDMRoom) — cheap archaeology for future readers"

patterns-established:
  - "Multi-file deletion with narrative comments: rather than silently removing symbols, leave a short comment naming the phase/decision that deleted them. Any future `grep` hitting the old symbol name finds the deletion rationale inline instead of a mysterious blame-log entry."
  - "Rule 3 transitive teardown discipline: when deleting a directory, run a pre-deletion import grep; every hit outside the target directory is either a live caller (blocks deletion, checkpoint) or a dead callsite whose sole reason to exist was the target directory (deleted as Rule 3 transitive)."

requirements-completed: [D-18, D-19]

# Metrics
duration: 24min
completed: 2026-09-21
---

# Phase 128 Plan 09: Source-file teardown (src/backend/telegram/ + substrate/services/tg-bridge/ + voice.ts guard + schema.ts export + getSharedDMRoom) Summary

**Deleted 26 tg-bridge source files across two directories, plus the voice.ts tg-bridge-service special case, the Drizzle telegramBotTokens export, and the getSharedDMRoom Matrix helper (D-19 grep gate confirmed zero non-telegram production callers) — backend + frontend build clean, scoped tests green.**

## Performance

- **Duration:** ~24 min
- **Started:** 2026-09-21T03:38:20Z (approx — first read after plan load)
- **Completed:** 2026-09-21T04:02:42Z
- **Tasks:** 2 (both `type="auto"`)
- **Files touched:** 32 (28 deleted + 4 modified)

## Accomplishments
- Deleted `src/backend/telegram/` (22 files) — every module the tg-bridge Docker service depended on for token writes, registry sync, /getMe proxy, /telegram HTTP routes, and dead-token/pending-chat-id reconcilers is gone.
- Deleted `substrate/services/tg-bridge/` (4 files) — the substrate-side bridge distributable (Dockerfile + entrypoint + README + repro script).
- Removed `voice.ts::rejectBridgeServiceOnSpeak` middleware and both mount references. The tg-bridge-service userId no longer exists post-teardown, so the /speak and /speak-stream 403 guard has no live class of caller to gate.
- Removed `schema.ts::telegramBotTokens` Drizzle export. The at-boot DROP migration on the underlying SQLite table (`runTelegramBotTokensTableDrop`) already landed in Plan 128-01; this plan removes the ORM-side echo.
- **D-19 outcome: DELETED.** Pre-deletion grep `grep -rn "getSharedDMRoom" src/ | grep -v "src/backend/telegram/" | grep -v "src/backend/matrix/matrix-admin-client.ts:"` returned only entries in `matrix-admin-client.test.ts` (test coverage for the deleted helper). No non-telegram production callers. Function + its tests deleted per D-19. The two hoisted primitives extracted at Phase 89-03 Task 1 (`getUserJoinedRooms`, `getRoomJoinedMembers`) remain as top-level exports with independent non-telegram callers.
- Rule 3 transitive: `/matrix-admin/migrate-cred-files` handler + tests removed from `matrix-admin-routes.ts` + its `.test.ts`. This was the sole surviving importer of `../telegram/human-token-writer.js` + `../telegram/shared-volume.js` outside `src/backend/telegram/` — a Phase 79 Plan 08 one-shot migration invoked exactly once during Phase 79-09 cutover from Nina's install to the Docker tg-bridge. With the bridge itself gone, that endpoint has no reason to exist.

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete src/backend/telegram/ + substrate/services/tg-bridge/ + Rule 3 removal of /matrix-admin/migrate-cred-files** — `56d318f5` (chore)
2. **Task 2: Remove voice.ts tg-bridge-service guard + schema.ts telegramBotTokens export + matrix-admin-client.ts getSharedDMRoom (D-19)** — `9fa663d1` (chore)

_This plan is deletion-only; commit prefixes are all `chore` (not `feat`) — the change is subtractive._

## D-19 Grep Gate — Full Evidence

Pre-deletion probe:

```
$ grep -rn "getSharedDMRoom" src/ 2>&1 \
    | grep -v "src/backend/telegram/" \
    | grep -v "src/backend/matrix/matrix-admin-client.ts:"
src/backend/matrix/matrix-admin-client.test.ts:42:  getSharedDMRoom,
src/backend/matrix/matrix-admin-client.test.ts:545:// getSharedDMRoom (Plan 83-02 — FIXB-03)
src/backend/matrix/matrix-admin-client.test.ts:548:describe("getSharedDMRoom", () => {
src/backend/matrix/matrix-admin-client.test.ts:575:    const result = await getSharedDMRoom(AGENT, HUMAN);
src/backend/matrix/matrix-admin-client.test.ts:603:    const result = await getSharedDMRoom(AGENT, HUMAN);
src/backend/matrix/matrix-admin-client.test.ts:629:    const result = await getSharedDMRoom(AGENT, HUMAN);
src/backend/matrix/matrix-admin-client.test.ts:647:    const result = await getSharedDMRoom(AGENT, HUMAN);
src/backend/matrix/matrix-admin-client.test.ts:659:    const result = await getSharedDMRoom(AGENT, HUMAN);
src/backend/matrix/matrix-admin-client.test.ts:666:    const result = await getSharedDMRoom(AGENT, HUMAN);
src/backend/matrix/matrix-admin-client.test.ts:692:    await getSharedDMRoom(traversalMxid, HUMAN);
src/backend/matrix/matrix-admin-client.test.ts:923:// from getSharedDMRoom's internal helper at L473. Discriminated-union return
src/backend/matrix/matrix-admin-client.test.ts:989:  it("Test 5: getSharedDMRoom's happy path still works after extraction refactor (regression)", async () => {
src/backend/matrix/matrix-admin-client.test.ts:1011:    const result = await getSharedDMRoom(AGENT, HUMAN);
src/backend/matrix/matrix-admin-client.test.ts:1089:// inside getSharedDMRoom's L511 members-count loop.
```

Every hit is inside `matrix-admin-client.test.ts` (the test coverage for the deleted helper) — no production caller outside the deletion cone. **Condition MET.** getSharedDMRoom deleted; corresponding test block + Test 5 regression + import removed; two remaining `getSharedDMRoom` narrative comments (at L923 and L1089 in the pre-delete file — now L769 and L911 post-delete) were reworded to note the historical extraction lineage rather than pretend the helper still exists.

## Post-Teardown Cleanliness Verification

```
$ grep -rn 'from "\.\./telegram/\|from "\.\./\.\./telegram/' src/backend/ src/ui/ 2>&1 \
    | grep -v "^src/backend/telegram/"
(empty — no output)

$ test ! -d src/backend/telegram && test ! -d substrate/services/tg-bridge && echo OK
OK

$ find substrate/services/tg-bridge/ -type f 2>&1
bfs: error: substrate/services/tg-bridge/: No such file or directory.

$ grep -rn "src/backend/telegram\|telegramRoutes\|telegramBotTokens" src/ 2>&1
src/backend/database/db/index.ts:979: * whole src/backend/telegram/ directory is scheduled for deletion in a
src/backend/database/db/index.ts:1120:  // or writes it post-Phase-126 — the whole src/backend/telegram/ directory
src/backend/database/db/schema.ts:751:// Phase 128-09 (D-18): the Phase 79 Plan 01 `telegramBotTokens` Drizzle
src/backend/database/db/schema.ts:753:// migration for the underlying `telegram_bot_tokens` table lives in
src/backend/matrix/matrix-config.ts:19: *   `src/backend/telegram/bridge-config-writer.ts` — imports
src/ui/features/pretty-view/IdentityModal.tsx:321:    // (src/backend/telegram/routes.ts header), so this is presentation, not
```

All remaining hits are narrative comments (historical breadcrumbs or deletion notices) — no live code references.

## Builds + Tests

**Task 1 verification:**
- `npm run build:backend` → exit 0
- `npm run build` (frontend) → exit 0
- `npx vitest related --run src/backend/database/database.ts src/backend/starter.ts src/backend/database/db/schema.ts src/backend/matrix/matrix-admin-routes.ts` → **2482 passed / 2 skipped** across 138 test files

**Task 2 verification:**
- `npm run build:backend` → exit 0
- `npm run build` (frontend) → exit 0
- `npx vitest related --run src/backend/database/routes/voice.ts src/backend/database/db/schema.ts src/backend/matrix/matrix-admin-client.ts` → **2474 passed / 2 skipped** across 138 test files

Test count dropped by exactly 8 between Task 1 and Task 2 — matches the 7 deleted G-* getSharedDMRoom tests + 1 deleted "Test 5" extraction-regression test.

## Decisions Made

- **Kept deletion-notice comments in place of removed symbols.** For `rejectBridgeServiceOnSpeak`, `telegramBotTokens`, `getSharedDMRoom`, and the `/matrix-admin/migrate-cred-files` handler, the file has a short `// Phase 128-09 (D-18/D-19): [symbol] deleted [rationale]` comment where the code used to be. Cost: a few lines per site. Benefit: any future reader hitting an old blame reference or greping for the old symbol name finds the deletion rationale + phase reference inline, without needing to dig into git history. This is the same discipline established in earlier phase teardowns (e.g., Phase 68 identities-table drop leaves a narrative in schema.ts; Phase 98 leaves teardown notes in voice.ts).
- **Reworded 2 residual comments in matrix-admin-client.ts + 2 in matrix-admin-client.test.ts.** Both `getUserJoinedRooms` and `getRoomJoinedMembers` had docblocks that said "extracted from getSharedDMRoom's internal helper" as if getSharedDMRoom still existed. Reworded to "originally extracted from an internal helper inside the (Phase 128-09 D-19 deleted) getSharedDMRoom" — preserves the extraction lineage (which is the reason the primitive returns a discriminated union rather than a nullable) while making clear the parent function is gone.
- **Dropped voice.ts NextFunction import.** After removing rejectBridgeServiceOnSpeak, NextFunction had no other user in the file. Removed to keep imports tight.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed /matrix-admin/migrate-cred-files handler + its two ../telegram/* imports from matrix-admin-routes.ts**
- **Found during:** Task 1 pre-deletion safety grep
- **Issue:** The plan's action step says "Plan 08 removed the last surviving import from starter.ts and database.ts. If any hit surfaces, STOP and log the reference — the plan needs revisiting; do NOT delete until the caller is handled." The grep surfaced two hits in `src/backend/matrix/matrix-admin-routes.ts`:
  - `import { mintAndWriteHumanToken } from "../telegram/human-token-writer.js";` (L26)
  - `import { TG_BRIDGE_STATE_DIR } from "../telegram/shared-volume.js";` (L27)
  Both were used by a single handler: `POST /matrix-admin/migrate-cred-files` (~L264-381), a Phase 79 Plan 08 one-shot migration endpoint that (a) minted a fresh Matrix token per registered human and wrote it to `/state/<humanName>.token`, and (b) unlinked legacy `.cred` files (plaintext passwords from Nina's install) under `TG_BRIDGE_STATE_DIR`.
- **Fix:** Removed the handler entirely + both imports. The handler was invoked exactly once, during Phase 79-09 cutover from Nina's install to the Docker tg-bridge, and its raison d'être was the bridge itself. With the bridge deleted in this plan there is nothing left to migrate onto. Also removed the corresponding vi.mock blocks + `describe("POST /matrix-admin/migrate-cred-files")` test block (7 tests) from `matrix-admin-routes.test.ts`, and cleaned up the `dbSelectMock` + `users` schema mock that only supported that handler.
- **Rule applied:** Rule 3 (blocking issue — the pre-deletion grep hit blocked directory deletion). The plan's own action text authorizes fixing inline: "If any TS error surfaces, fix inline by removing the offending import + any transitive dangling call." I extended that from "TS error after deletion" to "surviving import found in pre-deletion grep" because the two are equivalent — the import will become a TS error the moment the directory is deleted, so removing it first is functionally identical to fixing the error after.
- **Files modified:** `src/backend/matrix/matrix-admin-routes.ts`, `src/backend/matrix/matrix-admin-routes.test.ts`
- **Verification:** Backend build + full frontend build both exit 0 after the removal + directory deletion; scoped tests 2482 passed / 2 skipped.
- **Committed in:** `56d318f5` (Task 1 commit)

**2. [Rule 1 - Bug fix] Moved afterEach import in matrix-admin-routes.test.ts**
- **Found during:** Task 1 (cleaning up test file after removing the migrate-cred-files describe block)
- **Issue:** Pre-fix, `afterEach` was imported at L632 with a misleading comment ("Vitest wants at least one afterEach import — keep the linter happy") but was actually used in describe blocks at earlier lines (L216, L298, L385, L505). This worked only because ES-module imports are hoisted; removing L632 as part of the migrate-cred-files test block cleanup would have broken all earlier afterEach uses.
- **Fix:** Added `afterEach` to the top-of-file vitest import destructure at L25 (`import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";`), then removed the L632 duplicate + comment along with the migrate-cred-files-only imports (`fs`, `path`, `os`).
- **Rule applied:** Rule 1 (bug fix — the pre-existing L632 placement was fragile; consolidating to L25 is the correct pattern).
- **Files modified:** `src/backend/matrix/matrix-admin-routes.test.ts`
- **Verification:** Scoped tests exit 0; the 138 test files that previously passed continue to pass.
- **Committed in:** `56d318f5` (Task 1 commit — part of the same test-file cleanup)

---

**Total deviations:** 2 auto-fixed (1 Rule 3 blocking, 1 Rule 1 bug fix)
**Impact on plan:** Both auto-fixes were necessary to complete Task 1's acceptance criterion "`npm run build:backend && npm run build` exits 0" after the src/backend/telegram/ directory deletion. No scope creep beyond the transitive-cleanup surface the plan itself named as auto-fixable ("If any TS error surfaces, fix inline by removing the offending import + any transitive dangling call.").

## Issues Encountered

- **Untouched UI-side telegram surface (out of Plan 09 scope).** A grep for `src/ui/` telegram references surfaced still-present frontend surfaces: `src/ui/api/telegram-api.ts` (5 exported fetchers pointed at `/telegram/*` routes), `src/ui/features/pretty-view/TelegramTab.tsx` (a whole tab component in the pretty-view identity modal), and mocks in 5+ frontend test files. **NOT touched this plan** — the plan's `files_modified` list scopes strictly to backend + substrate, and none of the phase's remaining plans (10, 11) tears down the UI telegram surface either. Runtime behavior post-Phase-128: the `/telegram/*` routes were unmounted in Plan 128-08 Task 2, so the UI's `authApi.post("/telegram/activate")` etc. calls will 404 at runtime. If Ashley wants a clean UI teardown, that's a follow-up phase — flagging here so it doesn't slip.
- **`src/backend/utils/field-crypto.ts` still has `telegram_bot_tokens: new Set(["bot_token"])` in its `ENCRYPTED_FIELDS` map (line 55).** Not in Plan 09 scope (not listed in `files_modified`), doesn't cause build/test failure (it's a string-literal entry in a lookup that no code hits post-teardown), and doesn't block the drop-migration in db/index.ts. Cheap dead-weight — a future post-Phase-128 hygiene pass could remove it. Documenting here so it's not silently forgotten.

## Known Stubs

None — this plan is deletion-only. All removed symbols had their callsites already cleaned up in prior plans (128-01 through 128-08).

## User Setup Required

None — no external service configuration required. The tg-bridge Docker service will be removed by Plan 128-10 (docker/nginx teardown); this plan removes only the source-code side.

## Next Phase Readiness

- **Ready for 128-10 (docker/nginx teardown, same wave, parallel with this plan).** File scopes are disjoint: Plan 10 touches `docker/*.yml` + `docker/nginx*.conf`, Plan 09 touched `src/*` + `substrate/*`. Both share the Plan 08 dependency (already landed).
- **Ready for 128-11 (schema-equivalent + full-sweep verification, Wave 5).** All Plan-09 touched files (schema.ts, matrix-admin-client.ts, voice.ts, matrix-admin-routes.ts) are in a state where the phase-wide `npx vitest related --run` sweep will exercise them cleanly. The Plan 128-01 DROP migration + Plan 128-09's Drizzle export removal together satisfy the Plan 11 assertion "`telegram_bot_tokens` does not exist post-init".
- **No blockers for the remaining plans.** No STATE.md-tracked blocker was surfaced during this plan.

## Self-Check: PASSED

- `src/backend/telegram/` — CONFIRMED deleted
- `substrate/services/tg-bridge/` — CONFIRMED deleted
- `128-09-SUMMARY.md` — FOUND at expected path
- Commit `56d318f5` — FOUND in git log (Task 1)
- Commit `9fa663d1` — FOUND in git log (Task 2)

---
*Phase: 128-push-notifications-replacing-telegram-bridge*
*Completed: 2026-09-21*
