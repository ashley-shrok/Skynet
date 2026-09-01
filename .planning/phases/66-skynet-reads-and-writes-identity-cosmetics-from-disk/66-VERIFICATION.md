---
phase: 66-skynet-reads-and-writes-identity-cosmetics-from-disk
verified: 2026-09-01T04:35:00Z
status: passed
score: 9/9 must-haves verified
overrides_applied: 0
---

# Phase 66: Skynet reads and writes identity cosmetics from disk — Verification Report

**Phase Goal:** Flip Skynet from reading/writing identity cosmetics via its own encrypted store to reading/writing them from the identity's home folder on its home box via the existing artifact-reader plumbing. Users see NO visible difference; the storage moves + Skynet becomes an observer of on-disk truth.

**Verified:** 2026-09-01
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement — Acceptance-Floor Must-Haves

### Observable Truths (from shape file's "What Would Make It Wrong" + CONTEXT open-questions)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Storage moved — 7 cosmetic columns physically gone from `identities` table; migration idempotent; SQLite version preflight in place | VERIFIED | `schema.ts:660-672` narrows identities table to `{ id, userId, identityKey, createdAt, updatedAt }`. `db/index.ts:471-479` CREATE TABLE has only 5 columns. `db/index.ts:742-751` `runIdentitiesCosmeticDrops()` calls `dropColumnIfExists` for all 7 columns, gated by `assertSqliteSupportsDropColumn` (throws when SQLite < 3.35, per test 4 in `db/index.migration.test.ts`). `dropColumnIfExists` uses check-then-mutate pattern (idempotent no-op on fresh installs). |
| 2 | No cache reintroduced — every render reaches into the box; no server-side cache of disk values | VERIFIED | `identities.ts:189-223` GET / uses `Promise.all` with per-row `readIdentityFile(conn, identityKey)` on every request; no in-memory map or Redis cache; connection is opened + closed per request. `identities.ts:707-730` GET /:id/avatar calls `readAvatarSiblingFile` per request. The only `Cache-Control` is HTTP browser-side (max-age=300 on avatar), and the ETag is computed per-response via `createHash("md5")` — not stored (documented at L715-720 as compatible with the shape rule). |
| 3 | On-disk creation renders identical — an agent creating an identity by writing files renders in Skynet with cosmetics | VERIFIED via code-path trace | GET / handler `identities.ts:189-223`: reads all rows for userId, then for each row **if identityKey is in the caller's identityHosts map**, opens SSH → `readIdentityFile` → `extractCosmeticsFromFrontmatter` → overlays via `publicIdentity(row, cosmetics)`. The row's existence in the identities table is all that's required — cosmetics come exclusively from disk. Nadia's out-of-band `commander-zoey` folder-rename + Phase-A frontmatter+avatar apply confirms this path works for a disk-first creation. |
| 4 | Identity can self-edit its own face — edits to `~/.claude/identities/<key>/<key>.md` frontmatter picked up on next render | VERIFIED via code-path trace | GET / re-reads `readIdentityFile` on every request (no cache — see #2). `extractCosmeticsFromFrontmatter` (`identity-artifact-reader.ts`) parses the current frontmatter block via `yaml.load`. Any edit to the .md file lands in the very next GET response with no propagation delay. |
| 5 | No offline-box special fallback — unreachable box returns error state, no degraded caches | VERIFIED | GET /:id/avatar (`identities.ts:700-704, 731-736`): SSH connect failure → `502 "identity home box unreachable"`. GET / (`identities.ts:216-221`) scopes per-row failure to that row's safe-defaults (no cache/fallback bytes served) — Ashley-greenlit "accept the ugly render." PUT /:id (`identities.ts:427-439`): SSH connect failure → `502` with same canned message. No "last-known-good" branch anywhere in the flipped handlers. |
| 6 | Role not duplicated — `role:` frontmatter pointer stays; no parallel roles-table cosmetic column | VERIFIED | Birth-orchestrator `identity-birth-orchestrator.ts:307` emits `role` FIRST in the frontmatter. `schema.ts` `roles` table (L525) is the pre-existing RBAC roles table (used by users.roleId FK + userRoles junction) — completely unrelated to identity `role:` frontmatter. No new column added on `identities` (only ownership fields remain). |
| 7 | TSC + tests green | VERIFIED | `npx tsc --noEmit` runs clean (zero output, exit 0). Scoped backend tests: 10 files / 125 tests pass. Scoped frontend tests: 9 files / 157 tests pass. |
| 8 | Ship-motion still orchestrator-only — no "ship" or "deploy" task in any plan | VERIFIED | Grep across all 5 plans + summaries for `deploy` / `docker` / `push` / `ship-motion`: only appears in documentation of the orchestrator-owned rule, never as an executor task. Every plan's `<verify>` block ends at scoped test green; no plan schedules `docker compose` or `git push`. |
| 9 | DatabaseSaveTrigger.forceSave discipline preserved on all surviving mutations | VERIFIED | `identities.ts` retains 3 `forceSave` calls (POST identity_created L307 area, PUT identity_updated L581, DELETE identity_deleted L633). `identity-birth.ts:96` retains `forceSave("identity_birth")` on the surviving insert. `identity-clone.ts` + `identity-share.ts` never had forceSave calls (pre-existing gap since first commits `6f631beb`/`f097b394` — not introduced by phase 66; out-of-scope pre-existing pattern). All surviving `.run()` calls I inspected have either try/catch+forceSave companion or the pre-existing no-forceSave pattern that predates this phase. |

**Score:** 9/9 truths verified

---

### Required Artifacts (per-plan must_haves rolled up)

| Artifact | Expected | Status | Evidence |
|----------|----------|--------|----------|
| `schema.ts` identities table narrowed | 5 columns only | VERIFIED | L660-672 confirms `{ id, userId, identityKey, createdAt, updatedAt }` |
| `db/index.ts` CREATE TABLE narrowed + drop migration | idempotent + preflight | VERIFIED | CREATE TABLE L471-479 = 5 cols; `runIdentitiesCosmeticDrops` L742-751; `assertSqliteSupportsDropColumn` L676-695 throws on < 3.35 |
| `identity-artifact-reader.ts` new APIs | writeAvatarSiblingFile, readAvatarSiblingFile, extractCosmeticsFromFrontmatter, MIME_TO_AVATAR_EXT, AVATAR_MIME_FROM_EXT, IDMEDIT_MAX_AVATAR_BYTES | VERIFIED | All 6 symbols exported and grep-referenced |
| `identity-birth-orchestrator.ts` Step 2.5 grown | full cosmetics frontmatter + avatar sibling write | VERIFIED | `buildIdentityFileBody` L299-334 (role first, absent-⇒-omit); `writeAvatarSiblingFile` call L630 AFTER `writeMarkdownFileAtomic` L621 (graceful partial recovery ordering) |
| `identity-birth.ts` narrow insert | 5 columns only, return `{ id }` | VERIFIED | L85-93 insert has only 5 fields; L117 return type = `Promise<{ id: string }>` |
| `identity-clone.ts` narrow insert + safe-defaults publicIdentity | 5 cols + capitalizeFirst pattern | VERIFIED | L637-643 insertRow narrow; L198-215 publicIdentity uses `capitalizeFirst` + null/empty-string safe-defaults (duplicated to avoid circular import per Plan 04 decision) |
| `identity-share.ts` narrow insert | 5 cols; no publicIdentity to change | VERIFIED | L212-218 insertRow narrow; response is `{identityId, shared}` per code inspection |
| `identities.ts` PUT flip | disk-write via read-overlay-write | VERIFIED | L442-563 read → yaml.load → overlay (present/absent/null-remove semantics) → yaml.dump → writeIdentityFile + writeAvatarSiblingFile + ext-swap rm cleanup |
| `identities.ts` GET / flip | per-request lazy disk-fetch | VERIFIED | L174-233 Promise.all lazy fetch; safe-defaults for rows not in identityHosts map |
| `identities.ts` GET /:id/avatar flip | disk-read via readAvatarSiblingFile | VERIFIED | L658-751 hostId required (400 missing); 404 on null; 502 on SSH-fail; per-response md5 ETag |
| `identities.ts` publicIdentity safe-defaults | non-null strings for displayName/avatarMime/avatarEtag; null for title/colorHue/voice | VERIFIED | L108-139 uses capitalizeFirst + empty-string defaults per B2 co-location |
| `identities-store.ts` frontend enrichment | fetchOnce constructs identityHosts from fleetSessions | VERIFIED | L74 buildIdentityHostsFromFleet; L91-100 ensureFleetSubscription; L107, 119-122 fetchOnce wired |
| `conversation-store.ts` accessors | getFleetSessionsSnapshot + subscribeConversationStore (no sessionMatchKey re-export) | VERIFIED | L1556-1559 both exports present; L54 sessionMatchKey stays as direct import (not re-exported per W4) |
| `IdentityModal.tsx` L1264+L1396 hostId threading | avatarUrlWithHost + etag guard | VERIFIED | L1274-1275 (header) and L1414-1415 (edit-drawer) both use avatarUrlWithHost with etag conditional |
| IdentityBadge / PrettyConversationRow / SessionRow / CloneAgentDialog | threaded or guarded fallback | VERIFIED | All 4 consumers use avatarUrlWithHost when hostId in scope; guarded ternary fallbacks documented with Phase 66 Plan 05 comments |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| GET /identities | `enriched` (Identity[]) | `db.select().from(identities)` rows + per-row `readIdentityFile → extractCosmeticsFromFrontmatter` from disk | Yes — real DB + real disk read | FLOWING |
| GET /identities/:id/avatar | `readResult.bytes` | `readAvatarSiblingFile(conn, identityKey)` — SFTP or LOCAL fs read | Yes — bytes come from disk file | FLOWING |
| PUT /identities/:id | on-disk .md frontmatter | `writeIdentityFile(conn, identityKey, newBody)` where `newBody` is `yaml.dump` of read-overlay-write cycle | Yes — writes to real disk | FLOWING |
| identity-birth Step 2.5 | on-disk .md + sibling avatar | `writeMarkdownFileAtomic` + `writeAvatarSiblingFile` on target host | Yes — SFTP writes to identity's home folder | FLOWING |
| identities-store.fetchOnce | `identityHosts` | `getFleetSessionsSnapshot()` + `buildIdentityHostsFromFleet()` — real conversation-store state | Yes — populated when fleet-sessions loaded, empty otherwise (auto-refresh) | FLOWING |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| identities.ts | 596 | TODO comment referencing Plan 03 stale-response window | Info | Stale documentation — Plan 03 has landed AND Plan 04 dropped the columns; `freshRow` no longer has stale cosmetic columns because publicIdentity emits safe-defaults from disk-overlay. Comment is obsolete but harmless. References Phase 66 Plan 03 (formal work), so passes debt-marker gate. Recommended cleanup in a follow-up quick. |

No FIXME/XXX/TBD/HACK/PLACEHOLDER anti-patterns in any phase-touched file.

### Behavioral Spot-Checks

Skipped for this phase — the code is server-side + requires a live Skynet container + SSH to fleet hosts. TSC + scoped test suite exercise the code paths. Deploy-time verification via Ashley's rendering + interaction is the natural UAT — but that's orchestrator-ship-motion, out of executor scope per the phase constraints.

### Probe Execution

No project-standard probes discovered under `scripts/*/tests/probe-*.sh`. No PLAN/SUMMARY declared probes. Skipped.

### Requirements Coverage

No `requirements:` field populated across any of the 5 plans (all show `requirements: []`). No `.planning/REQUIREMENTS.md` mapping to Phase 66 rows to cross-reference. Coverage check N/A.

### Test Results

**Backend scoped tests (10 files):**
```
Test Files  10 passed (10)
     Tests  125 passed (125)
```
Files run: `db/index.migration.test.ts`, `identities.put-disk.test.ts`, `identities.get-disk.test.ts`, `identity-birth.test.ts`, `identity-birth-orchestrator.test.ts`, `identity-birth-orchestrator.role-frontmatter.test.ts`, `identity-clone.test.ts`, `identity-share.test.ts`, `identity-artifact-reader.avatar-read.test.ts`, `identity-artifact-reader.remote-writes.test.ts`.

**Frontend scoped tests (9 files):**
```
Test Files  9 passed (9)
     Tests  157 passed (157)
```
Files run: `identities-store.enrichment.test.ts`, `conversation-store.test.ts`, and all 7 `IdentityModal.*.test.tsx` files.

**TSC repo-wide:** clean (zero errors, exit 0).

### Human Verification Required

None from automated verification. **Ashley-driven UAT recommended on ship** (per phase constraints — Skynet is her gateway; visual verification of "users see NO visible difference" is inherently human):

1. **Render parity check** — page loads with identityHosts populated; every identity in the fleet shows displayName/title/colorHue/voice/avatar matching pre-phase-66 render.
2. **Self-edit round-trip** — an identity edits its own `~/.claude/identities/<key>/<key>.md` frontmatter (e.g. Nyla changes her `title:`); the next Skynet render picks it up.
3. **PUT round-trip** — edit an identity's cosmetics via IdentityModal; the .md frontmatter on the target box reflects the change; next GET / returns updated values.
4. **commander-zoey render** — after Nadia's out-of-band folder-rename fix, commander-zoey renders with cosmetics (not degraded).

These are orchestrator-ship-motion-scoped, out of executor's remit per CONTEXT.md § Reference constraints.

### Gaps Summary

**None material.** One stale TODO comment (identities.ts:596) references Plan 03 as the resolver for a concern that Plan 03 + Plan 04 have architecturally resolved (publicIdentity emits safe-defaults from disk-overlay; the "stale store cosmetic columns" concern is moot because the columns don't exist). Recommended cleanup in a follow-up quick, not a blocker.

### Recommended Follow-ups (Non-Blocking)

- **Follow-up quick:** Remove the obsolete TODO comment at `src/backend/database/routes/identities.ts:596-600`. The referenced Plan 03 has landed; publicIdentity now emits safe-defaults from disk-overlay; the stale-store concern is architecturally moot.

---

_Verified: 2026-09-01T04:35:00Z_
_Verifier: Claude (gsd-verifier)_
