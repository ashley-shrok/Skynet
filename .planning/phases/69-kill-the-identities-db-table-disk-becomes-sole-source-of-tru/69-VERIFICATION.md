---
phase: 69-kill-the-identities-db-table-disk-becomes-sole-source-of-tru
verified: 2026-09-02T04:53:25Z
status: passed
score: 10/10
overrides_applied: 0
re_verification: false
---

# Phase 69: Kill the Identities DB Table — Verification Report

**Phase Goal:** Kill the Skynet `identities` DB table entirely. Post-phase, an identity IS its disk folder on some host. Skynet builds the fleet roster by fanning out per-request to each enabled host's disk. Frontend already keys internally on identityKey; the internal `id` was only ever a URL segment. Delete share endpoint + DELETE endpoint (obsolete/dead). Drop timestamps (dead weight). Drop `userId` (obsolete once cosmetics are on disk).

**Verified:** 2026-09-02T04:53:25Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Table dropped: `sqliteTable("identities"` absent from schema.ts | VERIFIED | `grep -c 'sqliteTable.*identities' src/backend/database/db/schema.ts` → 0; comment at L654-655 confirms Phase 69 dropped it |
| 2 | No live DB writers: no `db.insert/update/delete` against identities | VERIFIED | `grep -n 'db\.insert\|db\.update\|db\.delete\|db\.select' src/backend/database/routes/identities.ts` → 0 hits |
| 3 | URL rekey landed: no `/:id` route definitions in identities.ts | VERIFIED | All surviving route definitions use `/:identityKey` — confirmed by reading all 4 `router.*` calls: `router.get("/")`, `router.post("/")`, `router.put("/:identityKey")`, `router.get("/:identityKey/avatar")` |
| 4 | publicIdentity shape: emits 10 fields, no `id`/`createdAt`/`updatedAt` | VERIFIED | Lines 109–143 of identities.ts: return object contains exactly `identityKey, displayName, title, colorHue, voice, avatarMime, avatarUrl, avatarEtag, coordinator, role` — no `id`, `createdAt`, or `updatedAt` present |
| 5 | Frontend Identity type: 10 fields, no `id`/`createdAt`/`updatedAt` | VERIFIED | `src/ui/api/identities-api.ts` lines 3–23: Identity interface has `identityKey, displayName, title, colorHue, voice, role, avatarMime, avatarUrl, avatarEtag, coordinator` — exactly 10 fields; comment on L14 explicitly states "id/createdAt/updatedAt removed" |
| 6 | Share endpoint gone: `identity-share.ts` deleted, `identityShareRoutes` = 0 hits | VERIFIED | `ls src/backend/database/routes/identity-share.ts` → "No such file or directory"; `grep -rn 'identityShareRoutes' src/` → 0 hits |
| 7 | DELETE endpoint gone: `router.delete` = 0 in identities.ts | VERIFIED | `grep -n 'router\.delete' src/backend/database/routes/identities.ts` → 0 hits |
| 8 | Migration wired: `runIdentitiesTableDrop` exported + called in `migrateSchema` | VERIFIED | `export function runIdentitiesTableDrop` at index.ts L755; called from `migrateSchema()` at L809; `await DatabaseSaveTrigger.forceSave("phase-69-drop-identities-table")` at L811 with try/catch null-safety wrapper; `migrateSchema = async () =>` at L774; awaited at L558 |
| 9 | Security fix landed: `IDENTITY_KEY_RE.test(identityKey)` in PUT and GET-avatar handlers | VERIFIED | PUT handler gate at identities.ts L290: `if (!IDENTITY_KEY_RE.test(identityKey))`; GET-avatar gate at L564: `if (!IDENTITY_KEY_RE.test(identityKey))`; `IDENTITY_KEY_RE` imported from `identity-artifact-reader.js` (strict `/^[a-z0-9_-]{1,64}$/`); local stale constant also removed (I2 from REVIEW resolved) |
| 10 | Migration tests (Tests 5, 6, 7) exist in index.migration.test.ts | VERIFIED | index.migration.test.ts L211: "Test 5: runIdentitiesTableDrop drops the table when present"; L243: "Test 6: runIdentitiesTableDrop is idempotent on absent table"; L258: "Test 7: runIdentitiesCosmeticDrops then runIdentitiesTableDrop on legacy 5-column schema leaves no identities table" |

**Score:** 10/10 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/backend/database/db/schema.ts` | identities table export deleted | VERIFIED | `export const identities` → 0; Phase 69 comment at L654 replaces the block |
| `src/backend/database/db/index.ts` | runIdentitiesTableDrop exported + called in migrateSchema; CREATE TABLE identities deleted | VERIFIED | Function at L755; called at L809; `CREATE TABLE IF NOT EXISTS identities` → 0; a comment at L466-468 replaces the old CREATE TABLE block explaining the Phase 69 drop |
| `src/backend/database/db/index.migration.test.ts` | Tests 5, 6, 7 added for runIdentitiesTableDrop | VERIFIED | All three tests present |
| `src/backend/database/routes/identity-share.ts` | DELETED | VERIFIED | File does not exist |
| `src/backend/database/routes/identity-share.test.ts` | DELETED | VERIFIED | Not checked separately; identityShareRoutes grep → 0 confirms no residue |
| `src/ui/features/pretty-view/ShareIdentityPicker.tsx` | DELETED | VERIFIED | ShareIdentityPicker grep across src/ → 0 hits |
| `src/ui/features/pretty-view/ShareIdentityPicker.test.tsx` | DELETED | VERIFIED | ShareIdentityPicker grep → 0 |
| `src/ui/features/pretty-view/IdentityModal.share.test.tsx` | DELETED | VERIFIED | ShareIdentityPicker grep → 0; identity-share grep → 0 |
| `src/backend/database/routes/identities.ts` | DELETE handler gone; schema import gone; POST / is 410 GONE; PUT/GET rekeyed | VERIFIED | router.delete → 0; schema import gone; POST / returns 410 at L271; routes use /:identityKey |
| `src/ui/api/identities-api.ts` | Identity type: 10 fields, no id/createdAt/updatedAt; shareIdentity + deleteIdentity gone | VERIFIED | Interface confirmed; shareIdentity/deleteIdentity grep → 0 |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `db/index.ts migrateSchema()` | identities table DROP | `runIdentitiesTableDrop(sqlite)` at L809 | WIRED | Called after `runIdentitiesCosmeticDrops`; followed by `forceSave` with null-safety try/catch |
| `migrateSchema` | `DatabaseSaveTrigger.forceSave` | `await DatabaseSaveTrigger.forceSave("phase-69-drop-identities-table")` at L811 | WIRED | Wrapped in try/catch; non-fatal warn on failure (first-boot race handled) |
| `database.ts` | `identitiesRoutes` | `app.use("/identities", identitiesRoutes)` at L1866 | WIRED | identityShareRoutes mount is gone; identitiesRoutes mounts survive |
| PUT `/:identityKey` handler | `IDENTITY_KEY_RE` validation | `if (!IDENTITY_KEY_RE.test(identityKey))` at L290 | WIRED | Imported strict regex from identity-artifact-reader.js |
| GET `/:identityKey/avatar` handler | `IDENTITY_KEY_RE` validation | `if (!IDENTITY_KEY_RE.test(identityKey))` at L564 | WIRED | Same strict regex import |

---

## Behavioral Spot-Checks

Step 7b skipped — no runnable entry point available without starting the server. All behavioral verification done via grep/read.

---

## Probe Execution

Step 7c: No probe scripts declared in plans. No conventional probe scripts found for this phase.

---

## Requirements Coverage

Phase 69 has no mapped REQ-IDs (requirements: [] in all plan frontmatter). Requirements coverage check not applicable.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/backend/database/database.ts` | 1820, 1835 | Stale comment refers to `/identities/:id/*` routes (old URL pattern) | INFO | Documentation drift only — no functional impact. Express routing uses `:identityKey`; the comment is holdover from before the rekey. Not a blocker. |

No TBD, FIXME, or XXX markers found in phase-modified files.

---

## Human Verification Required

None — all must-haves are verifiable through static analysis.

---

## Gaps Summary

No gaps found. All 10 must-have truths are VERIFIED.

**Security fix (W1 from REVIEW) confirmed landed:**
- Commit `9d20e8f0` added `IDENTITY_KEY_RE.test(identityKey)` gates to both PUT and GET-avatar handlers before any disk/shell interpolation.
- The imported regex is the strict `/^[a-z0-9_-]{1,64}$/` from `identity-artifact-reader.ts` (not the old permissive local constant).
- The stale local `IDENTITY_KEY_RE` constant that allowed `.`, `/`, `+`, `=` (enabling path traversal) was also removed (INFO I2 from REVIEW resolved alongside W1).

**Stale comment (INFO):** `database.ts` lines 1820 and 1835 still reference `/identities/:id/*` routes in documentation comments. This is dead documentation — the actual route parameter is now `:identityKey`. Not a blocker; candidate for a future comment cleanup commit.

---

_Verified: 2026-09-02T04:53:25Z_
_Verifier: Claude (gsd-verifier)_
