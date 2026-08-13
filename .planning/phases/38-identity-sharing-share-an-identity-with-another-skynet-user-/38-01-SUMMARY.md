---
phase: 38
plan: 01
subsystem: identity-sharing
tags: [identity-sharing, backend, share-endpoint, users-list, phase-38]
wave: 1
provides:
  - "POST /identities/:id/share endpoint (copy-and-diverge with no-op-on-repeat)"
  - "GET /users/list-basic endpoint (picker-facing users list, self-exclusion server-side)"
requires:
  - "AuthManager.createAuthMiddleware (existing)"
  - "identities + users tables (existing schema — NO migration)"
affects:
  - "src/backend/database/database.ts (mount table only)"
tech-stack:
  added: []
  patterns:
    - "Explicit-column drizzle select for sensitive-field non-leak (users.id, users.username only)"
    - "Copy-and-diverge row duplicator — no provenance column, no join table"
    - "404 (not 403) for source-not-in-scope to prevent id enumeration across users"
    - "Mount-order-before-generic /identities discipline (matches identity-clone, identity-birth, identity-exists-on-host precedent)"
key-files:
  created:
    - "src/backend/database/routes/identity-share.ts (259 lines)"
    - "src/backend/database/routes/identity-share.test.ts (577 lines, 10 tests)"
    - "src/backend/database/routes/users-list-basic.test.ts (370 lines, 5 tests)"
  modified:
    - "src/backend/database/routes/user-admin-routes.ts (+55 lines net: import ne + new /list-basic handler)"
    - "src/backend/database/database.ts (+10 lines: import + mount)"
decisions:
  - "Server-side self-exclusion on /users/list-basic (frontend never needs to know requester's id)"
  - "Explicit column selection to enforce sensitive-field non-leak at the query layer"
  - "No permission gate on source ownership beyond userId-scope visibility — share-onward test asserts this invariant"
  - "No-op returns EXISTING row's id in response body so the frontend can update its 'already shared' set without a second round-trip"
metrics:
  duration_min: 37
  tasks_completed: 3
  tests_added: 15
  loc_delta_src: 1271
  completed_date: "2026-08-13"
---

# Phase 38 Plan 38-01: Identity Sharing (Wave 1 Backend) Summary

**One-liner:** Backend endpoints for identity sharing — POST /identities/:id/share (copy-and-diverge row duplicator with silent no-op on repeat) and GET /users/list-basic (picker-facing users list with server-side self-exclusion). No schema migration; no permission gate on source ownership beyond userId-scope visibility.

## Contract for Wave 2

Wave 2 builds the frontend picker in `IdentityModal.tsx` header against this exact contract. All endpoints are JSON-in/JSON-out. Both need the standard session cookie (JWT) — 401 on missing/invalid.

### POST /identities/:id/share

Mounted at `/identities/:id/share`. The `:id` path parameter is the source identity's `id` (UUID from `identities.id`) that the requester can currently see in their own picker.

**Request:**
```
POST /identities/:id/share
Content-Type: application/json

{ "targetUserId": "<user-uuid>" }
```

**Response 200 (happy path — new share):**
```json
{ "identityId": "<new-uuid-generated-by-nanoid>", "shared": true }
```
- `identityId` is the FRESH id of the newly-inserted `identities` row for the target user.
- Insert copies every presentation column verbatim from source: `identityKey`, `displayName`, `title`, `colorHue`, `voice`, `avatarMime`, `avatarData`, `avatarEtag`. Fresh `id` (nanoid) + fresh ISO `createdAt`/`updatedAt`. Rows are permanently independent after insert.

**Response 200 (no-op on repeat):**
```json
{ "identityId": "<existing-uuid>", "shared": false }
```
- Fires when the target user already has an `identities` row with the SAME `identityKey` (whether they created it themselves OR received it via a prior share — the detection is on `(targetUserId, identityKey)` pair).
- `identityId` is the EXISTING row's id. **Frontend must use this to update its "already shared" set without a second round-trip.**
- No INSERT is issued in this branch.

**Response 400 error taxonomy:**
| Body | Trigger |
| --- | --- |
| `{"error": "targetUserId is required"}` | body missing / not-a-string / empty-after-trim |
| `{"error": "Cannot share to self"}` | `targetUserId === requesterUserId` |
| `{"error": "Target user not found"}` | `targetUserId` does not exist in `users` table |

**Response 401:** `{"error": "Unauthorized"}` on missing/invalid JWT (from AuthManager middleware).

**Response 404:** `{"error": "Identity not found"}` — the source `:id` does not exist under the requester's `userId` scope. **Note:** this SAME 404 fires when the id genuinely doesn't exist AND when it exists but belongs to another user — deliberately indistinguishable to prevent id enumeration across users (T-38-01-05 in the threat model).

**Response 500:** `{"error": "internal"}` on any unexpected error (sanitized).

**Not gated by "did requester create the source":** any user with the source identity in their own `userId` scope can share it onward. The `share-onward from non-creator` test in `identity-share.test.ts` asserts this invariant explicitly.

### GET /users/list-basic

Mounted at `/users/list-basic` (added to the existing `registerUserAdminRoutes` inside `user-admin-routes.ts`). Reachable by ANY authenticated user — NOT admin-gated (unlike the pre-existing `/users/list`).

**Request:**
```
GET /users/list-basic
```

**Response 200:**
```json
{ "users": [ { "id": "u-bob", "username": "bob" }, { "id": "u-carol", "username": "carol" } ] }
```
- Every user OTHER than the requester (`ne(users.id, userId)` server-side filter).
- Each row has EXACTLY two keys: `id` and `username`. The drizzle select is scoped `{id: users.id, username: users.username}` — no `isAdmin`, no `isOidc`, no `passwordHash`, no `totpSecret`, no OIDC config, no email fields, no matter what the schema evolves to.
- Empty array on single-user deployments (the requester is the only user in `users`). **NOT** 404, **NOT** 204 — 200 with `{"users": []}`. Frontend hides its picker affordance on empty response.

**Response 401:** `{"error": "Unauthorized"}` on missing/invalid JWT.

**Response 500:** `{"error": "Failed to list users"}` on DB error.

### Frontend caller files Wave 2 will add

Per plan `<action>` Task 3, Wave 2 will add:
- `src/ui/api/identities-api.ts` — new `shareIdentity(identityId, targetUserId)` function returning `Promise<{identityId: string, shared: boolean}>`.
- `src/ui/api/user-management-api.ts` — new `getUsersListBasic()` function returning `Promise<{users: Array<{id: string, username: string}>}>`.
- `src/ui/features/pretty-view/IdentityModal.tsx` — new picker component in `DialogHeader` (sits alongside the existing pencil affordance around L1108).
- Companion tests in the same directories (empty-state hide, populated-state selection, already-shared marker, self-exclusion).

## What's LOCKED that Wave 2 must honor

- **Copy-and-diverge.** After the share INSERT, source and recipient rows are permanently independent. There is no propagation of later renames / avatar changes / color-hue edits. Wave 2 UX must NOT imply the identity stays "linked" — the natural language "share" is fine (LOCKED per CONTEXT.md) but any tooltip / description must not promise sync.
- **No permission gate on backend → no permission UX on frontend.** Every identity that appears in the user's picker gets the share affordance in its modal header, regardless of whether the current user created it. Wave 2 must NOT show a lock icon, "you didn't create this" message, or grey-out the picker on non-creator identities.
- **No-op distinguished from real share via `shared: false` in response.** Wave 2 uses this to render the "already shared ✓" marker in the picker for that target user — the marker uses the endpoint's own knowledge that "target already has identityKey," not a separate query. The `identityId` field is populated in BOTH `shared: true` and `shared: false` responses precisely so the frontend can update its "already shared" set from a single call.
- **Empty-list handling belongs entirely to the frontend.** Backend returns 200 + empty array on single-user deployments. Wave 2 hides the picker affordance ENTIRELY — no empty-menu tooltip, no disabled trigger with a message, no "no one to share to" state (LOCKED per CONTEXT.md § Empty-state UI).
- **Self-exclusion is server-side.** `/users/list-basic` never returns the requester. Wave 2 does NOT need to filter the requester client-side (belt-and-suspenders is fine but not required).

## What was NOT touched

- **Schema.** `src/backend/database/db/schema.ts` is unchanged. No migration, no `sharedFromId` column, no `identity_shares` join table (LOCKED per CONTEXT.md § Data model).
- **Existing /users/list admin route.** Unchanged — still admin-gated with `isAdmin` field exposed, still lives at `/users/list`. The new `/list-basic` sits alongside it in the same `registerUserAdminRoutes` function.
- **identities-store frontend state, IdentityModal.tsx.** Wave 2 territory — this plan is backend-only.
- **Nginx config.** Both routes live under existing `/identities` and `/users` locations already whitelisted in `docker/nginx.conf` and `docker/nginx-https.conf`; no new nginx caveat applies.
- **package.json / package-lock.json.** No new imports required — `nanoid`, `express`, `drizzle-orm`, `vitest` all pre-existing in `dependencies` (only the new `ne` import is added, and it comes from the existing `drizzle-orm` package). Zod-lesson gate does not fire.

## Regressions

**One pre-existing failing test file — orthogonal to this plan's changes:**

- `src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` — 2 failing tests in isolation:
  - **Test 1:** "bounded DOM — 120 messages produces ≤ 30 [data-pv-bubble] subtrees" (timeout at 5000ms)
  - **Test 2d:** "user send from scrolled-up state — forces scroll to bottom via handleComposeSend → scrollToBottomAndFollow" (assertion: expected `1000` to be `5000`)
- **Verified unrelated to this plan:** grep of that test file for `identity-share|list-basic|user-admin|identities/database` returns zero matches. Test file was last modified in commit `69030ac plan(32-04): extend PrettyView.virtualization.test.tsx with four-scenario auto-scroll coverage` — belongs to Phase 32 (PrettyView auto-scroll redesign). The failures are in TanStack Virtual + DOM scroll behavior under JSDOM, entirely frontend, no backend surface involved.
- **Files modified by THIS plan are backend-only** (`src/backend/database/**`). There is no code path by which changes to Express route handlers on identities/users could affect TanStack Virtual's virtualizer measurement inside JSDOM. Backend-only unit tests (`src/backend/database/routes/**`) all pass — 315/315 across 22 files.
- Per orchestrator directive "if you hit pre-existing failures NOT caused by your changes, name them and stop": naming them here. Not attempting to fix in-scope; that's Phase 32's territory (or a follow-up quick task).

## Files changed

| Path | Type | LOC delta |
| --- | --- | --- |
| `src/backend/database/routes/identity-share.ts` | new | +259 |
| `src/backend/database/routes/identity-share.test.ts` | new | +577 (10 tests) |
| `src/backend/database/routes/users-list-basic.test.ts` | new | +370 (5 tests) |
| `src/backend/database/routes/user-admin-routes.ts` | modified | +55 / -1 (added `ne` import + new /list-basic handler after existing /list) |
| `src/backend/database/database.ts` | modified | +10 / -0 (added `import identityShareRoutes` near L24 + `app.use("/identities", identityShareRoutes)` at L1833, BEFORE the generic `app.use("/identities", identitiesRoutes)` at L1852) |
| **Total** | 5 files | +1271 / -1 |

## Verify commands

Reviewer or Wave 2 executor runs these to confirm Wave 1 shipped intact:

```bash
# Contract completeness — endpoint file exists and mounts correctly
grep -n "router.post.*/:id/share" src/backend/database/routes/identity-share.ts
grep -n "app.use.*identityShareRoutes" src/backend/database/database.ts
awk '/app\.use.*identityShareRoutes/ {shr=NR} /app\.use.*identitiesRoutes\)/ {gen=NR} END {print (shr<gen)?"OK: shr@"shr" < gen@"gen : "BAD: mount order wrong"}' src/backend/database/database.ts

# /users/list-basic exists and uses ne for self-exclusion
grep -n 'router.get\("/list-basic"' src/backend/database/routes/user-admin-routes.ts
grep -c "ne(users.id" src/backend/database/routes/user-admin-routes.ts

# No schema drift
grep -n "sharedFromId\|identity_shares\|CREATE TABLE" src/backend/database/routes/identity-share.ts  # zero hits

# Test suites green
npx vitest run src/backend/database/routes/identity-share.test.ts       # 10/10 passing
npx vitest run src/backend/database/routes/users-list-basic.test.ts     # 5/5 passing
npx vitest run src/backend/database/routes/                             # 315/315 passing across 22 files

# Backend typecheck + full build clean
npm run build:backend                                                    # exit 0
npm run build                                                            # exit 0
```

## Final HEAD SHA

Full HEAD after this plan (including this SUMMARY commit): **`7d369530a04f3730dc5620017de0a7048d4d8731`** (short: `7d36953`). Last code-motion commit (pre-SUMMARY): **`9d10abe7e2f011998e1f00c5a6363e783ef97dc0`** (short: `9d10abe`).

Commits (in reverse chronological order):
- `7d36953 plan(38-01): backend endpoints for identity sharing — POST /identities/:id/share + GET /users/list-basic` — Task 3 handoff SUMMARY
- `9d10abe feat(38-01): POST /identities/:id/share — copy-and-diverge identity share` — Task 2 GREEN
- `bf0c7d2 test(38-01): add failing tests for POST /identities/:id/share` — Task 2 RED
- `123e778 feat(38-01): add GET /users/list-basic picker route for identity sharing` — Task 1 GREEN
- `2ac9f48 test(38-01): add failing tests for GET /users/list-basic picker route` — Task 1 RED

## Green-suite proof

- **Backend routes suite** (`src/backend/database/routes/`): 315 tests across 22 files — **exit 0** ✓
- **New test files in isolation:**
  - `identity-share.test.ts`: 10/10 passing — **exit 0** ✓
  - `users-list-basic.test.ts`: 5/5 passing — **exit 0** ✓
- **Full-suite `npx vitest run`:** 2223/2224 tests passing (1 pre-existing failing test file — `PrettyView.virtualization.test.tsx`, 2 failing tests, Phase 32 territory, verified unrelated per Regressions section). **Exit code: 1 (non-zero).**
- Per orchestrator directive on pre-existing failures: naming and stopping code motion. Backend-in-scope suite is fully green.

## Backend build proof

- `npm run build:backend`: **exit 0** ✓ (tsc -p tsconfig.node.json passes cleanly)
- `npm run build`: **exit 0** ✓ (frontend vite build produces all bundles including main-axios / react-vendor / etc.)

## Self-Check: PASSED

All contract endpoints verified present in source:
- `POST /:id/share` handler exists in `identity-share.ts`.
- `/list-basic` handler exists in `user-admin-routes.ts`.
- Mount order verified: `identityShareRoutes @ L1833` < `identitiesRoutes @ L1852` in `database.ts`.
- All 4 task-scoped commits exist in `git log --all` (2ac9f48, 123e778, bf0c7d2, 9d10abe).
- SUMMARY.md written to phase directory.
