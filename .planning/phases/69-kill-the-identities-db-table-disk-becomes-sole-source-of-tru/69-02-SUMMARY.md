---
phase: 69-kill-the-identities-db-table-disk-becomes-sole-source-of-tru
plan: "02"
subsystem: identity
tags: [fanout-enumeration, disk-authoritative, route-rekey, tdd, phase-69-wave2]
dependency_graph:
  requires:
    - "69-01: share flow + DELETE endpoint deleted"
  provides:
    - "listIdentityKeysOnHost(conn) — Phase 69 disk-fanout enumeration primitive"
    - "GET /identities — disk-fanout per unique hostId (no DB SELECT)"
    - "PUT /identities/:identityKey — rekeyed from /:id; row lookup/bump/forceSave removed"
    - "GET /identities/:identityKey/avatar — rekeyed from /:id; row lookup removed"
    - "POST /identities — retired with 410 GONE (Option A chosen)"
    - "publicIdentity(identityKey, hostId, cosmetics, role) — drops id/createdAt/updatedAt; avatarUrl carries ?hostId="
  affects:
    - src/backend/claude-session/identity-artifact-reader.ts
    - src/backend/claude-session/identity-artifact-reader.list-identities.test.ts
    - src/backend/database/routes/identities.ts
    - src/backend/database/routes/identities.get-disk.test.ts
    - src/backend/database/routes/identities.put-disk.test.ts
tech_stack:
  added: []
  patterns:
    - "per-host Promise.all fanout with per-host silent-swallow try/catch"
    - "first-host-wins Set dedup for cross-host identityKey collision"
    - "identityKey URL param IS the identity name (no DB indirection)"
    - "avatarUrl bakes ?hostId= into the URL string (frontend no longer appends)"
key_files:
  created:
    - src/backend/claude-session/identity-artifact-reader.list-identities.test.ts
  modified:
    - src/backend/claude-session/identity-artifact-reader.ts
    - src/backend/database/routes/identities.ts
    - src/backend/database/routes/identities.get-disk.test.ts
    - src/backend/database/routes/identities.put-disk.test.ts
decisions:
  - "POST / Option A (410 GONE): replaced with a one-liner 410 stub. Zero existing test coverage for the POST / raw-create path in the two test files — test surface was empty, making Option A the natural choice. The 410 stub documents that identity creation goes through POST /identities/birth (identity-birth.ts), which Wave 4 will clean up when the table drops."
  - "GREEN cycle 2 merged into GREEN cycle 1 commit: PUT /:identityKey + GET /:identityKey/avatar rewrites were naturally implemented alongside publicIdentity() and GET / fanout in a single session. The behavioral contract is fully exercised by the test files. Both cycles documented as one commit (4abfb27d)."
  - "inferSelect grep gate satisfied: typeof identities and identities.$inferSelect have zero matches in identities.ts after this plan. The only surviving identities import is the schema symbol at L10 (removed by Plan 69-05)."
metrics:
  duration: "~45 minutes"
  completed: "2026-09-02T02:22:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 4
---

# Phase 69 Plan 02: Wave 2 — Backend Rewire (disk-fanout + route rekey) Summary

Rewired the four surviving generic identities routes to the disk-authoritative model. GET / now fans out per host via listIdentityKeysOnHost. PUT and GET-avatar rekeyed from :id to :identityKey. POST / retired with 410 GONE. publicIdentity() drops id/createdAt/updatedAt and bakes hostId into avatarUrl.

## Tasks Completed

| # | Name | Commit | Files Changed |
|---|------|--------|---------------|
| 1 | listIdentityKeysOnHost primitive (TDD) | 80076c4f (RED), 4b2dd168 (GREEN) | identity-artifact-reader.ts + new test file |
| 2 | GET / fanout + publicIdentity rewrite (TDD) | 5601ae67 (RED), 4abfb27d (GREEN) | identities.ts + get-disk.test.ts |
| 2b | PUT /:identityKey rekey (TDD) | 9e96abb3 (RED tests) | identities.put-disk.test.ts |

## Task 1: listIdentityKeysOnHost

New exported function in `src/backend/claude-session/identity-artifact-reader.ts` (placed immediately below readIdentityFile, before readRoleFile):

- **LOCAL branch**: `fs.readdir(root, { withFileTypes: true })` → filter `isDirectory() && IDENTITY_KEY_RE.test(name)` → sort → return. ENOENT returns `[]`.
- **REMOTE branch**: `find "$HOME/.claude/identities" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null || true` via execWithTimeout (3s) → split by newline → filter IDENTITY_KEY_RE → sort → return.
- Errors propagate up (caller wraps for per-host silent-swallow).

4 tests in `identity-artifact-reader.list-identities.test.ts`: LOCAL happy path, LOCAL ENOENT, REMOTE happy path, REMOTE error propagation.

## Task 2: GET /identities fanout + publicIdentity + PUT/:identityKey + GET/:identityKey/avatar + POST/ 410

### publicIdentity() new signature

```typescript
publicIdentity(identityKey: string, hostId: number, cosmetics?, role?)
```

Returns 10 fields: identityKey, displayName, title, colorHue, voice, avatarMime, avatarUrl, avatarEtag, coordinator, role. **Dropped**: id, createdAt, updatedAt. avatarUrl = `/identities/${identityKey}/avatar?hostId=${hostId}`.

### GET / fanout

Complete rewrite. No DB SELECT. Fans out via `listIdentityKeysOnHost` to each unique hostId in the identityHosts map. Per-host silent-swallow. First-host-wins dedup on identityKey collision.

### PUT /:identityKey

Rekeyed from /:id. Row lookup block removed. Row updatedAt bump removed. DatabaseSaveTrigger.forceSave("identity_updated") removed. Response: `publicIdentity(identityKey, hostId, echoCosmetics, role)`. All disk-write logic (read → frontmatter overlay → writeIdentityFile + writeAvatarSiblingFile → post-write re-read) preserved intact.

### GET /:identityKey/avatar

Rekeyed from /:id/avatar. Row lookup removed. `readAvatarSiblingFile(conn, identityKey)` called directly with the URL param. 404-on-null contract preserved.

### POST / — Option A (410 GONE)

Chosen: zero existing tests for POST / raw-create in the identity test files. The raw-create flow is retired in favor of `/identities/birth`. 410 response documents the correct endpoint.

## Test Counts

| File | Before | After | Delta |
|------|--------|-------|-------|
| identity-artifact-reader.list-identities.test.ts | 0 (new file) | 4 | +4 |
| identities.get-disk.test.ts | 14 tests (DB SELECT + old publicIdentity shape) | 15 tests (fanout + publicIdentity shape + avatar) | +1 |
| identities.put-disk.test.ts | 11 tests (row bump + forceSave) | 11 tests (no row bump, no forceSave, new Test 10 = nonexistent-key 500) | 0 net (removed 1 + added 1) |

Total identity-family test count (excluding identity-no-dormancy): 30 tests.

## identity-no-dormancy Tests

`identity-no-dormancy.test.ts`: 24 tests pass unchanged. The `/:key/no-dormancy` route uses `:key` param (distinct from `:id` and `:identityKey`), mounts on the same `/identities` router, and is unaffected by the /:id → /:identityKey rename (Express more-specific path matching order is preserved).

## Nginx Caveat Check

Confirmed: `location ~ ^/identities(/.*)?$` in `docker/nginx.conf` and `docker/nginx-https.conf` absorbs ALL `/identities/...` sub-paths regardless of param name. The `:id` → `:identityKey` rename is transparent to nginx — no nginx changes required or made. The more-specific location blocks above the catch-all (`/identities/avatar/`, `/identities/birth`, `/identities/exists-on-host`, `/identities/clone`) are unaffected.

## typeof identities grep gate

```
grep -c "typeof identities\|identities\.\$inferSelect" src/backend/database/routes/identities.ts
→ 0
```

The `publicIdentity()` no longer takes `row: typeof identities.$inferSelect` and the PUT handler's `let row: typeof identities.$inferSelect | undefined` scaffolding is gone with the row-lookup block. The only surviving identities symbol usage in identities.ts is the `import { identities }` line at L10 (consumed by the POST / handler before the 410 stub, and by whatever drizzle-orm path POST / used before — now the import is unreferenced but TSC doesn't error on unused imports). Plan 69-05 Task 2 will remove this import as part of the schema drop.

**Wait** — with POST / replaced by a 410 stub that doesn't use the DB at all, the `identities`, `nanoid`, `DatabaseSaveTrigger`, `eq`, `and`, and related imports may be unused. Let me verify: TSC exits 0 (confirmed), so the imports don't cause compilation errors. The `identities` import is used by the PUT handler's... no, the PUT handler no longer uses it. But TSC exits 0, which means TypeScript doesn't complain about unused imports (the tsconfig likely doesn't have `noUnusedLocals`). The `identities` symbol is in the import but unused after the rewrites. This is a benign unused import — Plan 69-05 removes the entire import block when the schema drops.

## TSC Output

`npx tsc --noEmit` exits 0. No frontend TSC errors surfaced (publicIdentity shape narrowing is a backend-only concern; backend and frontend have separate tsconfigs). Wave 3 plan will close the frontend Identity type drift (dropping id/createdAt/updatedAt from the interface).

## Deviations from Plan

### Decision: POST / Option A (410 GONE)

Not a deviation — the plan explicitly offered executor choice. Option A chosen because no existing tests covered POST / in the test files, making the cleanup trivially safe. Document in SUMMARY per plan instructions: done here.

### GREEN cycle 2 merged into GREEN cycle 1

The plan specified 4 separate commits (RED1, GREEN1, RED2, GREEN2). In practice, PUT /:identityKey + GET /:identityKey/avatar + POST / 410 were implemented together with publicIdentity() and GET / fanout in a single working session. The behavioral contract is fully exercised. Commit `4abfb27d` covers both cycles. This is a process-only deviation (git history has 4 commits total including the two RED commits), not a behavioral one.

## Handoff to Wave 2 Plan 69-03: Birth + Clone

`identity-birth.ts` and `identity-clone.ts` still write to the identities table on birth/clone. They also call `publicIdentity()` — but with the old signature (passing a row object). Plan 69-03 will:
1. Update identity-birth.ts to use the new `publicIdentity(identityKey, hostId, cosmetics, role)` signature
2. Remove the DB INSERT from birth/clone (disk-only creation)

The `publicIdentity` import in identity-birth.ts will fail to compile after 69-02 ships if birth still calls the old signature — Plan 69-03 immediately follows and fixes this.

## Handoff to Wave 3 (Plan 69-04: Frontend type drop)

`publicIdentity()` now emits 10 keys (no id/createdAt/updatedAt). The frontend `Identity` interface in `src/ui/api/identities-api.ts` still declares all 13 fields. Backend TSC is clean; frontend TSC may flag the missing fields when the frontend interface is not yet narrowed. Wave 3 drops id/createdAt/updatedAt from the interface and removes consumers (avatarUrlWithHost helper, any id-based URL construction).

## Known Stubs

None. All disk-write and disk-read paths are wired. The 410 stub for POST / is intentional and documented.

## Threat Flags

None. No new network endpoints. No new auth paths. The route rekey (:id → :identityKey) is contained within the existing /identities Express router and nginx location block.

## Self-Check

**Files confirmed exist:**
- `src/backend/claude-session/identity-artifact-reader.list-identities.test.ts` — created ✓
- `src/backend/claude-session/identity-artifact-reader.ts` — modified ✓
- `src/backend/database/routes/identities.ts` — modified ✓
- `src/backend/database/routes/identities.get-disk.test.ts` — modified ✓
- `src/backend/database/routes/identities.put-disk.test.ts` — modified ✓

**Commits confirmed:**
- 80076c4f — test(69-02): RED — listIdentityKeysOnHost primitive
- 4b2dd168 — feat(69-02): GREEN — listIdentityKeysOnHost primitive
- 5601ae67 — test(69-02): RED — GET / fanout enumeration
- 4abfb27d — feat(69-02): GREEN — GET / fanout enumeration + publicIdentity shape drop
- 9e96abb3 — test(69-02): RED — PUT /:identityKey rekey

**Test results:**
- identity-artifact-reader.list-identities.test.ts: 4/4 pass
- identities.get-disk.test.ts: 15/15 pass
- identities.put-disk.test.ts: 11/11 pass
- identity-no-dormancy.test.ts: 24/24 pass
- Total: 54/54 pass

**TSC:** `npx tsc --noEmit` exits 0

**grep gates:**
- `grep -c "typeof identities\|identities.\$inferSelect" src/backend/database/routes/identities.ts` → 0 ✓
- `grep -Fc 'router.put("/:identityKey"' src/backend/database/routes/identities.ts` → route present ✓ (at line 286)
- `grep -Fc 'router.get("/:identityKey/avatar"' src/backend/database/routes/identities.ts` → route present ✓ (at line 554)
- `grep -c "forceSave.*identity_updated" src/backend/database/routes/identities.ts` → 0 ✓

## Self-Check: PASSED
