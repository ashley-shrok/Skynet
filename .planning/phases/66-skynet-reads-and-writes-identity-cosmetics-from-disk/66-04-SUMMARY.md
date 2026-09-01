---
phase: 66-skynet-reads-and-writes-identity-cosmetics-from-disk
plan: 04
subsystem: identities-migration
tags: [migration, drop-column, cosmetics, sqlite, alter-table, publicIdentity, safe-defaults]
dependency_graph:
  requires:
    - 66-01 (BIRTH — grew birth-orchestrator frontmatter + Step 2.5 avatar sibling write)
    - 66-02 (UPDATE — flipped PUT to disk-write via writeIdentityFile + writeAvatarSiblingFile)
    - 66-03 (READ backend — flipped GET / to per-request disk-derived cosmetics + publicIdentity safe-defaults contract + GET /:id/avatar via readAvatarSiblingFile)
    - 66-05 (READ frontend — identityHosts populated from fleetSessions + avatarUrlWithHost threaded through UI consumers)
    - assertSqliteSupportsDropColumn (this plan)
    - dropColumnIfExists (this plan)
    - runIdentitiesCosmeticDrops (this plan)
  provides:
    - Physically-narrowed identities table (5 columns: id, userId, identityKey, createdAt, updatedAt)
    - Drizzle schema shrink (schema.ts identities table typing)
    - Idempotent boot-time drop migration for upgraded installs
    - Fresh-install CREATE TABLE narrows to 5 columns
    - SQLite version preflight (throws on < 3.35) — boot aborts before schema corruption
    - Narrower createIdentityRecord / getIdentityRecord return-shape (Promise<{ id }>)
    - Row-existence GET-verify sentinel (replaces colorHue/voice/avatarEtag round-trip)
    - identity-clone.ts publicIdentity() safe-defaults contract (Plan 03 pattern duplicated here)
  affects:
    - Any future code that tries to INSERT into identities with a cosmetic column will fail TSC (drizzle type narrower)
    - Any future code that tries to SELECT a cosmetic column from identities will throw at runtime (column absent)
    - `/close identity-prettiness-on-disk` closes the two-phase arc (per CONTEXT.md § Vehicle notes)
tech_stack:
  added: []
  patterns:
    - Idempotent DDL migration via check-then-mutate (try SELECT → column exists → DROP; catch → absent → no-op)
    - Boot-time schema preflight (fail loudly on unsupported runtime)
    - Return-shape narrowing across DI dependency chain (BirthDeps types) — TSC-enforced
    - publicIdentity safe-defaults contract preservation across all identity-family constructors (identities.ts + identity-clone.ts)
    - Test-shim narrowing: IdentityRow type shrink + schema-column mock shrink + row-seed shrink cascades through in-memory DB stubs
key_files:
  created:
    - src/backend/database/db/index.migration.test.ts
    - .planning/phases/66-skynet-reads-and-writes-identity-cosmetics-from-disk/66-04-SUMMARY.md
  modified:
    - src/backend/database/db/schema.ts
    - src/backend/database/db/index.ts
    - src/backend/database/routes/identities.ts
    - src/backend/database/routes/identity-birth.ts
    - src/backend/database/routes/identity-birth-orchestrator.ts
    - src/backend/database/routes/identity-clone.ts
    - src/backend/database/routes/identity-share.ts
    - src/backend/database/routes/identity-birth-orchestrator.test.ts
    - src/backend/database/routes/identity-clone.test.ts
    - src/backend/database/routes/identity-share.test.ts
    - src/backend/database/routes/identities.get-disk.test.ts
    - src/backend/database/routes/identities.put-disk.test.ts
decisions:
  - assertSqliteSupportsDropColumn hoisted OUT of dropColumnIfExists — called ONCE at the top of runIdentitiesCosmeticDrops rather than 7× (one per column). Trades one micro-optimization for a cleaner failure surface: the whole drop block aborts atomically if the preflight fires, never leaves a half-dropped table.
  - dropColumnIfExists is best-effort per T-66-04-01 — a mid-drop failure warns via databaseLogger but does NOT throw. Rationale from the plan's threat model — remaining columns are deadweight, not corruption; next boot re-tries the failed drop, and code paths from Plans 01-03+05 already don't reference the columns. Trading loud-fail for graceful-partial-drop.
  - assertSqliteSupportsDropColumn on the OTHER hand IS loud-fail — if the preflight itself fires (SQLite < 3.35), the whole migrateSchema() rethrows and container aborts. Reasoning — a runtime that can't DROP COLUMN cannot host Phase 66's contract at all; silently continuing would let addColumnIfNotExists re-add or other pretend-normal behaviors mask the real incompatibility. per T-66-04-04.
  - createIdentityRecord + getIdentityRecord DI return types narrowed to Promise<{ id }> — the wire between the orchestrator and DB helpers gets tighter, which TSC uses to enforce the narrowing everywhere. The `void meta; void avatarBytes;` in the DB helper preserves BirthDeps signature stability while dropping the persistence.
  - identity-clone.ts publicIdentity() DUPLICATES the capitalizeFirst helper rather than importing from identities.ts. Importing would introduce a static import cycle (both routes are mounted from database.ts; both files ARE routes). Duplication is ~5 lines and both copies carry identical comments pointing at the frontend withDisplayCap pattern. When we consolidate identity-family shared helpers into a common module (out of scope for Phase 66), both duplicates get de-duped there.
  - identity-share.ts insertRow narrowed WITHOUT a publicIdentity constructor change — this file has never had one (response body is {identityId, shared:bool}, verified at L193/L261/L274). The plan's earlier iterations mis-referenced L208-213 as a publicIdentity return-shape; the third-iteration corrected it.
  - identity-clone.ts source-verbatim avatar-reuse branch simplified. sourceRow.avatarData no longer exists on the drizzle type post-drop, so the "fall back to source's Buffer" branch was collapsed to "no avatarBytes captured for reuse". Cosmetics travel with the disk file, which is copied via the orthogonal on-disk id-skill workflow (out of Phase 66 scope). Test 9 rewrote from "asserts new row's avatarData equals source's buffer" to "asserts new row is narrow (no cosmetic keys)".
metrics:
  duration_min: 24
  completed_date: 2026-09-01
requirements: []
---

# Phase 66 Plan 66-04: MIGRATION — drop 7 cosmetic columns from identities table Summary

**One-liner:** Physically dropped displayName/title/colorHue/voice/avatarMime/avatarData/avatarEtag from the identities table via boot-time idempotent ALTER TABLE DROP COLUMN (SQLite 3.35+); narrowed drizzle schema, POST/birth/clone/share insert paths, and BirthDeps return types to the 5 surviving columns; preserved Plan 03's publicIdentity safe-defaults contract across identities.ts + identity-clone.ts (duplicating capitalizeFirst locally to avoid circular import); collapsed the birth orchestrator's Step 1 GET-verify block to a row-existence sentinel now that colorHue/voice/avatarEtag no longer live in the store to round-trip.

## SQLite version confirmation

- **Runtime:** better-sqlite3 v12.9.0 bundles SQLite 3.45.x (well above the 3.35 minimum for native `ALTER TABLE DROP COLUMN`).
- **Preflight:** `assertSqliteSupportsDropColumn(sqliteDb)` reads `sqlite_version()` PRAGMA, parses semver-triple, throws with explicit `Runtime version: X.Y.Z. Verify better-sqlite3 bundle version.` when major<3 or (major===3 && minor<35). Hoisted to the top of `runIdentitiesCosmeticDrops` — called once, not per-column.
- **Coverage:** Test 4 in `db/index.migration.test.ts` exercises both branches — bundled version passes (no-throw); monkey-patched `prepare("SELECT sqlite_version() AS v").get()` returning `{ v: "3.34.0" }` throws with error message containing both `3.35` and `3.34.0`.

## The graceful-partial-drop rationale

`dropColumnIfExists` is loud-fail on the SELECT probe (`try SELECT col FROM table LIMIT 1`) — if that throws, we know the column is absent and no-op. But the actual DROP is wrapped in try/catch with `databaseLogger.warn` on failure, NOT throw. This is deliberate per T-66-04-01:

- **What could fail:** a DROP mid-way (e.g. a stray CREATE INDEX referencing the column, or better-sqlite3 wrapping a rare SQLite edge-case).
- **What happens if it fails:** the remaining columns are still dropped in-sequence (the try/catch is per-column). Worst case is some columns dropped, some not.
- **Why not fatal:** Plans 01-03+05 already stopped READING and WRITING those columns from all runtime code paths. A lingering column is deadweight (occupies a bit of storage; TypeScript sees nothing; ALTER TABLE will retry on next boot).
- **What DOES abort loudly:** the SQLite version preflight (`assertSqliteSupportsDropColumn`). A runtime that can't do DROP COLUMN at all cannot host Phase 66's contract, and silently proceeding would leave every following boot in the same broken-preflight state. That throw propagates via `migrateSchema()` → container startup abort (T-66-04-04).

## Test-file adjustments

All identity-family tests carried in-memory DB shims that hardcoded the pre-Plan-04 IdentityRow shape (12 columns) + schema-column mocks + seed rows with cosmetic values. Every one had to shrink:

- **identity-birth-orchestrator.test.ts** — createIdentityRecord + getIdentityRecord mock returns shrunk to `{ id }`. Test 4 rewritten from "colorHue-null mismatch → silent-no-op" to "id mismatch → row-existence sentinel throws with 'silent-no-op: identity row not found post-insert'" (same failure semantic, new implementation).
- **identity-clone.test.ts** — IdentityRow narrowed, stubSourceRow seed narrowed, `sourceAvatarBytes` const removed (no longer referenced). Test 8 rewritten to assert publicIdentity safe-defaults (`displayName: "Tina-2"` via capitalizeFirst, title/colorHue/voice null, avatarMime/avatarEtag ""); DB assertions check surviving 5 columns + explicitly `expect(...avatarData).toBeUndefined()` on the row shim. Test 9 similar rewrite — asserts narrow insertRow, drops the "avatarData equals source's buffer" assertion (source doesn't have avatarData anymore).
- **identity-share.test.ts** — IdentityRow narrowed, schema-column mock narrowed to 5 cols, makeSourceIdentity narrowed. Test 8 rewritten to assert every cosmetic key undefined on the target row (share copies only ownership + timestamps; cosmetics disk-authoritative). Tests 9/10/11 pruned of cosmetic-value overrides in seed rows.
- **identities.get-disk.test.ts** — IdentityRow narrowed, schema mock narrowed, seedThreeRows narrowed (stale-store cosmetic values that used to prove "GET ignores store cosmetics" are now trivially proved because the fields don't exist on the shim).
- **identities.put-disk.test.ts** — IdentityRow narrowed, schema mock narrowed, seedRow narrowed. Test 1's `.set-keys-are-only-updatedAt` invariant preserved; the direct-row inspection assertions now check cosmetic keys are undefined on the row instead of "unchanged from seed".

Why the tests didn't have to change more radically: Plans 01-03+05 had already flipped ALL the runtime read/write paths for cosmetics to disk. Plan 04 physically removes the columns, which mechanically ripples through the TypeScript type surface (drizzle infers the narrower row type) — the tests are only updating their shims to reflect that same narrower type.

## Arc-closure confirmation

Post-Plan-04, the arc from the shape file's philosophy is complete:

- **BIRTH** — identity-birth-orchestrator writes cosmetic frontmatter + avatar sibling file at Step 2.5. Store row holds only ownership + timestamps. (Plan 01)
- **UPDATE** — PUT /identities/:id writes disk-side (frontmatter mutate + avatar file swap). Store row bumps only `updatedAt`. (Plan 02)
- **READ** — GET / lazy-derives cosmetics from disk via identity-artifact-reader (per-request identityHosts map, 5s connectOneShot timeout per row, silent-swallow safe-defaults on per-row failure). GET /:id/avatar reads sibling avatar file. (Plan 03)
- **FRONTEND** — identities-store.fetchOnce passes populated identityHosts derived from fleetSessions; avatarUrlWithHost threaded through IdentityBadge / IdentityModal / SessionRow / chat surfaces so browser hits work with disk-side reads. (Plan 05)
- **STORE PRUNING (this plan)** — 7 cosmetic columns physically dropped. Store rows contain only ownership + timestamps. The disk-authoritative model is now structurally enforced — even accidentally introducing a store-side cosmetic read/write would fail TSC compilation because the drizzle types no longer have those keys.

Every render surface flows through disk. The store is what the shape file promised: an ownership + user-scoping + timestamp anchor. Nothing more.

## Note to orchestrator

After Plan 66-04 ships (via the standard container-update motion + full-suite green ship-gate), the next step is `/close identity-prettiness-on-disk` — closes the two-phase arc per CONTEXT.md § Vehicle notes (Phase A shipped 2026-08-31 via Nelly; Phase B lands with this plan).

## Environmental note (build tools)

The sandbox this executor ran in did not initially have `build-essential` installed, so `better-sqlite3`'s native binary was missing. Installed `apt-get install -y build-essential` and ran `npm rebuild better-sqlite3` before the migration test would boot the in-memory sqlite. This is a per-sandbox artifact; production Skynet container image (Dockerfile.skynet) already bundles build-essential + Python for native module compilation at image-build time. No production impact.

## Deviations from Plan

**None.** Plan 04's third revision (which preserves Plan 03's safe-defaults contract in publicIdentity constructors and drops the wide-return-shape assertions from the identity-clone publicIdentity path) executed cleanly. Notes:

- capitalizeFirst was **duplicated locally in identity-clone.ts** rather than imported from identities.ts (documented in Decisions above — circular-import avoidance).
- The identity-clone.ts source-verbatim avatar-reuse branch was **simplified beyond mechanical field-drop** — `sourceRow.avatarData` no longer exists on the drizzle type, so `avatarBytes = sourceRow.avatarData as Buffer` was replaced with `avatarBytes = null` (and Test 9 was rewritten accordingly). This is a natural consequence of the schema shrink, not a deviation from the plan's letter — the plan said "prune the seven fields from .values()", the removal of the read-side echo naturally follows.

## Authentication gates

None. Fully autonomous scoped execution.

## Commits

- `fa62cfb0` test(66-04): RED — migration test for dropping 7 cosmetic columns from identities
- `36a5f3c7` feat(66-04): GREEN — physically drop 7 cosmetic columns from identities table
- `fc12831f` test(66-04): RED — narrow test shims + assertions to post-drop identities row
- `a669c9da` feat(66-04): GREEN — prune insert paths + narrow return shapes across identity family

TDD gate compliance: each task's RED (test-only) commit precedes its GREEN (feat) commit; two RED/GREEN cycles land in strict alternating order.

## Scoped test result (final)

```
Test Files  42 passed (42)
     Tests  615 passed | 1 skipped (616)
```

TSC repo-wide: clean (exit 0).

## Self-Check: PASSED

Files verified present on disk:

- FOUND: /home/ubuntu/skynet-tina/src/backend/database/db/index.migration.test.ts
- FOUND: /home/ubuntu/skynet-tina/src/backend/database/db/schema.ts (identities table narrows to 5 cols)
- FOUND: /home/ubuntu/skynet-tina/src/backend/database/db/index.ts (assertSqliteSupportsDropColumn / dropColumnIfExists / runIdentitiesCosmeticDrops exported)
- FOUND: /home/ubuntu/skynet-tina/src/backend/database/routes/identities.ts (POST inserts 5 cols only)
- FOUND: /home/ubuntu/skynet-tina/src/backend/database/routes/identity-birth.ts (createIdentityRecord return-shape { id })
- FOUND: /home/ubuntu/skynet-tina/src/backend/database/routes/identity-birth-orchestrator.ts (BirthDeps return types { id }; GET-verify row-existence sentinel)
- FOUND: /home/ubuntu/skynet-tina/src/backend/database/routes/identity-clone.ts (publicIdentity safe-defaults; narrow insertRow)
- FOUND: /home/ubuntu/skynet-tina/src/backend/database/routes/identity-share.ts (narrow insertRow)

Commits verified in git log:

- FOUND: fa62cfb0
- FOUND: 36a5f3c7
- FOUND: fc12831f
- FOUND: a669c9da
