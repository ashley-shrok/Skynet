# Phase 69 — CONTEXT

Seeded from the shape file at `.planning/shapes/shape-kill-identities-table.md` (opened + locked 2026-09-02 via `/build` → `/open`, greenlit same session). The shape captures the conceptual why/what/scope; this file supplements it with the code-level consumer inventory produced during shape discovery so the planner doesn't have to re-elicit it.

Per the build-skill CONTEXT-from-shape convention (Phase 66/67 precedent): discuss-phase skipped.

---

## Shape (from `shape-kill-identities-table.md`)

### What this is

Skynet currently keeps a roster of every fleet identity in its own database — a row per identity, holding an internal identifier, a name, an owning user, and two timestamps. This phase eliminates that roster entirely. Skynet learns which identities exist by asking every reachable fleet host what identities live on its disk, on every request. The identity IS its disk folder on some host, full stop; nothing about it lives inside Skynet's database anymore.

### Shape

- **Roster elimination.** Skynet keeps no local list. When the frontend asks "give me the fleet," Skynet fans out to every host the logged-in user has access to, reads what identities live on each host's disk, and returns the merged view. Every request, every time.
- **Name is the key.** The internal database identifier disappears. Everywhere the current system uses "the identity in slot X," the new system uses "the identity named X." The lowercase name is already fleet-unique by convention and is already how the frontend indexes identities internally.
- **No cache.** Enumeration is synchronous per request. The list waits for reachable hosts (or their timeouts) before rendering.
- **Birth flow survives.** Backend does the disk-side work (create folder, write frontmatter, save avatar) instead of also inserting a row.
- **Clone flow survives.** Cloned identities land on the SAME host as source, with source cosmetics copied.
- **Share flow dissolves** entirely (obsolete now that disk is universal).
- **Delete flow dissolves** — dead endpoint anyway.
- **Migration** physically drops the roster table. Identifier, owning user, name, both timestamps — all gone.

### Philosophy

Disk is truth. Skynet is a reader, not a bookkeeper. Deliberately NOT doing: caching, cross-host coordination, same-name-across-hosts collision handling, deriving timestamps from mtimes.

### What would make it wrong

- Any user-visible flow (birth, clone, picker, badge, conversation row, edit modal, avatars) regresses observably.
- The motivating bug doesn't actually close — a fresh on-disk identity still doesn't appear in the list.
- Mobile experience degrades beyond "the list takes a moment to load."

### Scope edges

**In:** drop the table; per-request fanout enumeration; migrate URL patterns from identifier to name; clean up the wire type; rewire birth + clone to disk-only; delete the share + delete endpoints; migration drops the table.

**Out:** caching / background poll; cross-host name-collision detection; cross-host cosmetics-write-race; preserving anything from existing rows.

**Deferred:** if cellular enumeration hurts, revisit caching later; if cross-host collisions start biting, dedicated future session.

---

## Current-state code inventory (from Explore agent survey, 2026-09-02)

### 1. Current schema (post-Phase 66)

**File:** `src/backend/database/db/schema.ts` (L660–672)

Table has 5 columns remaining after Phase 66-04's cosmetics drop:

| Column | Type | Notes |
|--------|------|-------|
| `id` | text | PRIMARY KEY; nanoid-generated |
| `userId` | text | FK → users.id (CASCADE on delete) |
| `identityKey` | text | Lowercase identity name; NOT NULL |
| `createdAt` | text | ISO 8601; NOT NULL; DEFAULT CURRENT_TIMESTAMP |
| `updatedAt` | text | ISO 8601; NOT NULL; DEFAULT CURRENT_TIMESTAMP |

No indexes beyond the PK. No unique constraint on identityKey (app-level check only).

### 2. Backend files that import the `identities` schema symbol

- `src/backend/database/routes/identities.ts` (L10) — main routes
- `src/backend/database/routes/identity-birth.ts`
- `src/backend/database/routes/identity-birth-orchestrator.ts`
- `src/backend/database/routes/identity-clone.ts` (L102)
- `src/backend/database/routes/identity-share.ts` (**deleted entirely by this phase**)

**Read paths in identities.ts:**
- L187–191: SELECT all rows for userId (GET /)
- L313–317: SELECT by id (POST response)
- L402–410: SELECT by id + userId (PUT lookup)
- L619–623: SELECT fresh row after update (PUT response)
- L671–673: DELETE by id + userId

**Write paths:**
- L303–311: INSERT new row (POST /)
- L596–599: UPDATE `updatedAt` only (PUT disk-write bump)
- L671–673: DELETE row (endpoint being deleted)
- `identity-birth.ts`: INSERT via createIdentityRecord
- `identity-clone.ts`: INSERT cloned row (fresh id, same identityKey)
- `identity-share.ts`: INSERT shared row (**endpoint being deleted**)

### 3. API surface today

| Method | Path | Purpose | Status post-phase |
|--------|------|---------|-------------------|
| GET | `/identities` | List authenticated user's identities | Rewired to fanout enumeration |
| POST | `/identities` | Create identity (multipart: data + avatar) | Kept; no row insert, disk-only work |
| PUT | `/identities/:id` | Update cosmetics (disk write + row updatedAt bump) | Rekey to `/:identityKey`; drop the row bump |
| DELETE | `/identities/:id` | Delete row | **Deleted** (unwired dead code) |
| GET | `/identities/:id/avatar?hostId=...` | Serve avatar sibling file | Rekey to `/:identityKey/avatar` |
| POST/PUT `/identities/:id/share` | Share identity to another user | **Deleted** (all of `identity-share.ts` gone) |

### 4. `publicIdentity()` response shape (identities.ts L112–149)

Fields emitted today:
```
id, identityKey, displayName, title, colorHue, voice, role,
avatarMime, avatarUrl, avatarEtag, coordinator, createdAt, updatedAt
```

**Post-phase shape** — drop `id`, `createdAt`, `updatedAt`. `avatarUrl` becomes `/identities/${identityKey}/avatar?hostId=...`. Everything else stays.

### 5. Timestamp usage

- **`createdAt`** — written at insert, never read anywhere in the codebase.
- **`updatedAt`** — bumped on PUT cosmetic updates as a "write happened" signal; never read by the frontend.

Both fields safe to drop with no user-visible effect.

### 6. `identity.id` consumers

**Frontend uses identity.id only as URL segment plumbing** (see `src/ui/api/identities-api.ts` L4 — id emitted in Identity type). All logical keying is on `identityKey`:

- `src/ui/state/identities-store.ts` L53: `byKey: new Map(normalized.map((i) => [i.identityKey.toLowerCase(), i]))` — store index is identityKey
- `src/ui/features/pretty-view/IdentityModal.tsx`: all useEffect dependencies and lookups key off `identity.identityKey`
- `src/ui/state/bounty-counts-store.ts` L152: `compositeKey(c.identityKey, c.hostId)`
- `src/ui/sidebar/CloneAgentDialog.tsx` (L1741, L1870): React keys on avatar candidate `b.id` (a different `.id`, not identity.id)
- `src/ui/features/pretty-view/ShareIdentityPicker.tsx` — **entire component deleted** with share endpoint

**URL usage of identity.id (backend):**
- `/identities/${row.id}/avatar` construction in publicIdentity (identities.ts L137) → rekey to identityKey
- `identities.ts` L349, L405, L598, L622, L669, L673: PUT/DELETE param lookups → rekey / delete

### 7. `identityKey` origin & consistency

- **On-disk folder name is authoritative source** — `~/.claude/identities/<key>/<key>.md`
- Backend currently mirrors folder name into DB row on birth/clone; artifact-reader always reads `~/.claude/identities/${identityKey}/${identityKey}.md`
- Frontend `identities-store.ts` L53, L79, L81–84 uses identityKey (lowercased) for all store indexes
- **Guarantee:** identityKey in DB == folder name on disk == the key everywhere. Post-phase, only the folder name remains as the truth-holder.

### 8. Frontend UI consumers

| Component | Location | What it consumes | Change post-phase |
|-----------|----------|-------------------|-------------------|
| Identity picker/list | sidebar rows | identityKey (primary), displayName, avatarUrl, colorHue | No logical change (already keys on identityKey) |
| Identity badge | chat bubbles, session row | identityKey, displayName, avatarUrl, coordinator | Avatar URL rekeys |
| Chat session header | IdentitySessionPane | identityKey, displayName | No change |
| **IdentityModal** | pretty-view/IdentityModal.tsx | identityKey (keying), id (API mutations), title, colorHue, voice, avatarUrl, coordinator | Mutations use identityKey; drop id from type |
| **CloneAgentDialog** | sidebar/CloneAgentDialog.tsx | sourceIdentityKey, colorHue (LOCKED), title, voice | No logical change (already identityKey) |
| **ShareIdentityPicker** | pretty-view/ShareIdentityPicker.tsx | identity.id → shareIdentity(id) call | **Deleted entirely** |
| Conversation row | PrettyConversationRow.tsx | identityKey, hostId | No change |
| Avatar renders | IdentityBadge.tsx, IdentityModal.tsx | id (URL construction), coordinator | URL rekeys |

### 9. Recent phases touching this area

- **Phase 66** (`.planning/phases/66-skynet-reads-and-writes-identity-cosmetics-from-disk/`) — moved cosmetics (title, colorHue, voice, avatarMime, avatarData, avatarEtag, displayName) from DB to disk. Plan 66-04 physically dropped those 7 columns via boot-time ALTER TABLE. Left `id + userId + identityKey + createdAt + updatedAt` as the ownership anchor. Established the per-request identityHosts-map fanout pattern that Phase 69 extends into load-bearing enumeration.
- **Phase 67** (`.planning/phases/67-mark-coordinators-in-skynet-right-side-mdhub-watermark-on-id/`) — added the `coordinator` cosmetic field (disk-read only, no DB column). Reinforces the disk-authoritative pattern.

---

## Notes for the planner

1. **The migration should physically drop the whole table**, not just the remaining columns. Precedent: Phase 66-04 used boot-time `runIdentitiesCosmeticDrops()` for column drops; the equivalent here is a full-table drop at boot with a marker to prevent re-runs. Ashley's rule: table drops are one-way (no roll-back needed for a milestone-scoped deploy).
2. **The share endpoint is coming out wholesale** — file, tests, frontend picker component, share API in identities-api.ts, everywhere. Don't leave dead references.
3. **The delete endpoint is dead code** — no UI wiring today. Same wholesale removal.
4. **Wire-type cleanup is a breaking change** on the `Identity` frontend type — drop `id`, `createdAt`, `updatedAt`. TypeScript will catch consumers; verify none use them at runtime.
5. **Fanout enumeration reuses Phase 66-03's identityHosts / artifact-reader plumbing** — same 5s connect timeout, safe-defaults on host error. Load-bearing difference: an unreachable host now means "no identities from that host" rather than "safe-default cosmetics for a known identity." Both scenarios produce a merged list that just omits identities from unreachable hosts.
6. **URL migration** — the three surviving `:id` paths (PUT cosmetics, DELETE, GET avatar) collapse to two (`PUT /:identityKey`, `GET /:identityKey/avatar`) since DELETE goes away. IdentityKey is URL-safe (lowercase letters + digits + hyphens per fleet convention).
7. **Ashley pre-authorized** the phase via `/build`. Standing directive from role file: greenlight at push, not at recreate. Ship-gate = full vitest suite green.
8. **Bounty tracker**: `~/.claude/roles/box-maintainer/bounties/kill-identities-table-phase-68/` — holds the original ship-day premise and pre-shape call-site list.
