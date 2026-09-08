---
phase: 85-cosmetics-migrate-to-role
plan: 01
subsystem: identity-artifact-reader + identities-route + identities-api
tags:
  - backend
  - frontend-type
  - role-cosmetics-inheritance
  - avatar-fallback
  - multipart-client
dependency_graph:
  requires: []
  provides:
    - readRoleFileByName(conn, roleName) → {markdown}
    - readAvatarSiblingFileByRole(conn, roleName, avatarFilename) → {bytes, mime, ext} | null
    - publicIdentity(identityKey, hostId, cosmetics, role, roleCosmetics) → publicIdentity+roleDefaults
    - GET /identities per-host role-read memo (parallel-fanout Promise cache)
    - GET /:identityKey/avatar role-folder fallback branch
    - PUT /:identityKey post-write echo includes roleDefaults
    - Identity.roleDefaults?: {title?, colorHue?, voice?, avatar?} | null
    - RoleCosmeticInput type export
    - createRole(input, avatar?) multipart client
  affects:
    - Plan 85-02 backend endpoint contract (POST /roles multipart)
    - Plan 85-03 CreateRoleDialog integration (Wave 2)
    - Plan 85-05 IdentityModal inherit-vs-override affordances (Wave 3)
tech_stack:
  added: []
  patterns:
    - "Promise-valued Map memo (Map<K, Promise<V>>) collapses parallel readers within one Promise.all fanout"
    - "Role-name-keyed reader avoiding identity two-step (readRoleFile → readRoleFileByName)"
    - "Sibling-file reader with role root (mirrors identity-side pattern)"
    - "Multipart FormData with data-JSON + file-part client (mirrors buildUpdateFormData)"
key_files:
  created:
    - src/backend/claude-session/identity-artifact-reader.role-cosmetics.test.ts (13 tests)
    - src/ui/api/identities-api.role-cosmetics.test.ts (5 tests)
    - .planning/phases/85-cosmetics-migrate-to-role-move-title-hue-voice-avatar-from-i/85-01-SUMMARY.md
  modified:
    - src/backend/claude-session/identity-artifact-reader.ts (+2 exports, +1 JSDoc note, +1 import)
    - src/backend/database/routes/identities.ts (publicIdentity extended; GET fanout memo; PUT echo; avatar fallback)
    - src/backend/database/routes/identities.get-disk.test.ts (+11 tests; mock extensions)
    - src/ui/api/identities-api.ts (Identity.roleDefaults field; RoleCosmeticInput type; createRole widened)
decisions:
  - "Per-host role-read memo uses Map<string, Promise<cosmetics>> not Map<string, cosmetics> — storing the in-flight Promise collapses concurrent readers within one Promise.all fanout. Deferred alternative (pre-fetch unique roles serially before per-identity read) would have added a second SSH round-trip when role-count << identity-count."
  - "Avatar URL shape stays identical under role-fallback (/identities/:key/avatar?hostId=N). Backend does the fallback internally; frontend consumers ride on the URL as-is. Alternative would have been a URL query flag ?fallback=role, but that leaks internal state to callers who don't need it."
  - "extractCosmeticsFromFrontmatter reused unchanged on role markdown (not forked into extractCosmeticsFromRoleMarkdown). Both files carry the same YAML frontmatter shape, same field names, same narrowing rules — a fork would drift over time. JSDoc updated to state Phase 85 also calls it against role frontmatter."
  - "Task 3 (createRole multipart client) pulled forward from what would have been Plan 85-02 Task 2 into Wave 1 to resolve the file-ownership conflict on src/ui/api/identities-api.ts. Both plans share the file this wave; 85-01 owns it. Colocated tests mock authApi so they do NOT require the real backend endpoint (which Plan 85-02 provides in parallel)."
metrics:
  duration: 24 minutes (start 2026-09-07 04:42:57 UTC, end 2026-09-07 05:07:46 UTC)
  completed_date: 2026-09-07
  tasks_completed: 3
  tests_added: 29 (13 backend reader + 11 backend route + 5 frontend client)
  tests_passing: 70 (all scoped tests: role-cosmetics + get-disk + put-disk + role-file + api-role-cosmetics)
  files_created: 3
  files_modified: 4
---

# Phase 85 Plan 85-01: Backend role-cosmetics merge + createRole multipart client Summary

Wave-1 backend groundwork for the cosmetics-migrate-to-role inheritance model.
Teaches the backend to read role-file cosmetic frontmatter, merge it under
identity frontmatter per `identity ?? role ?? null` (D-CTX-85-inherit), surface
resolved values + raw role defaults to the frontend, and serve role-folder
avatars as a fallback when the identity has none. Widens the createRole client
to multipart in Task 3 (pulled forward from Plan 85-02 to resolve file-ownership
conflict on identities-api.ts).

## Completed Tasks

| Task | Commit    | Name                                                                            |
| ---- | --------- | ------------------------------------------------------------------------------- |
| 1    | b7a315fc  | Add role-cosmetic extractor + role-by-name readers to identity-artifact-reader  |
| 2    | 9deca934  | Merge role cosmetics into publicIdentity + role-avatar fallback + GET / memo    |
| 3    | 6eec8d09  | Widen createRole() client to multipart with cosmetics + avatar                  |

## What Shipped

### Task 1 — Reader primitives

Three additions to `src/backend/claude-session/identity-artifact-reader.ts`:

1. **`readRoleFileByName(conn, roleName): Promise<{markdown}>`** — role-name-keyed
   role file reader WITHOUT the identity two-step. Byte-shape mirror of the
   existing `readRoleFile` (L539-575) but takes roleName directly. LOCAL branch
   reads from `getLocalRolesRoot()/<roleName>/<roleName>.md` via `fs.readFile`
   (ENOENT → `{markdown: ""}`). REMOTE branch execs
   `cat "$HOME/.claude/roles/${roleName}/${roleName}.md" 2>/dev/null || true`
   via `execWithTimeout`. `ROLE_NAME_PATTERN` gate at function entry
   (T-85-01-01 defense-in-depth against shell interpolation).

2. **`extractCosmeticsFromFrontmatter`** — REUSED unchanged on role markdown.
   Same YAML shape, same narrowing rules (title/voice/avatar: non-empty
   string; colorHue: number in [0, 359]). JSDoc updated to state Phase 85 also
   calls it against role frontmatter — no code change to the function body.

3. **`readAvatarSiblingFileByRole(conn, roleName, avatarFilename): Promise<{bytes, mime, ext} | null>`**
   — role-side avatar sibling reader mirroring `readAvatarSiblingFile`
   (L2179-2290) but rooted at `~/.claude/roles/<roleName>/<avatarFilename>`.
   Takes `avatarFilename` as an explicit arg (already known from role
   frontmatter's `avatar:` field, no re-parse needed). Validates roleName via
   `ROLE_NAME_PATTERN` and avatarFilename via
   `^[a-z0-9-]+\.(webp|png|jpg|gif|svg)$` regex (T-85-01-02). Enforces
   `IDMEDIT_MAX_AVATAR_BYTES` cap on both branches.

`ROLE_NAME_PATTERN` imported from `identity-birth-orchestrator.js` (same
import shape used by `roles-create.ts` L87).

Colocated test file: 13 `it(` blocks covering all 10 spec'd scenarios plus 3
extra gate/edge cases (uppercase names, dots/slashes, invalid ext/roleName).
Scaffolding mirrors `identity-artifact-reader.role-file.test.ts` — mkdtemp
`ROLES_HOST_DIR` for LOCAL branch, `vi.mock('../ssh/tmux-helper.js')` for
REMOTE branch.

### Task 2 — Backend merge + fallback

Extensions in `src/backend/database/routes/identities.ts`:

1. **`publicIdentity()` signature extended** to accept a fifth positional arg
   `roleCosmetics: {title?, colorHue?, voice?, avatar?} | null = null`.
   Per-field merge semantics: `resolved = identity ?? role ?? null` for
   title/colorHue/voice. Response gains new `roleDefaults` field echoing
   `roleCosmetics` verbatim (null when no role; `{}` when role has no cosmetic
   frontmatter — frontend distinguishes via `role` field being non-null).
   `avatarUrl` shape unchanged.

2. **GET `/identities` per-host role-read memo** — new
   `Map<string, Promise<cosmetics>>` inside the per-host `try` block. Storing
   the in-flight Promise (not the resolved value) collapses parallel readers
   within the same `Promise.all` fanout. Two identities of the same role
   trigger AT MOST ONE `readRoleFileByName` call per host (T-85-01-03 DoS
   mitigation). Role read failure → `{}` silent-swallow.

3. **PUT `/:identityKey` post-write echo** grows the same role-cosmetic read
   so the frontend receives identical shape on GET vs PUT. Role-read error in
   the echo path → `{}` (never fails the whole PUT).

4. **GET `/:identityKey/avatar` role-folder fallback branch** — when
   `readAvatarSiblingFile` returns null, resolve the identity's role via its
   markdown frontmatter, read the role file, extract `avatar:`, and call
   `readAvatarSiblingFileByRole`. Only 404 if BOTH branches return null. Any
   error in the role chain → silent (falls through to 404).

Frontend type surface in `src/ui/api/identities-api.ts`:

5. **`Identity.roleDefaults?: {title?, colorHue?, voice?, avatar?} | null`** —
   surfaces role's raw cosmetic values so IdentityModal (Plan 85-05) can
   render inherit-vs-override affordances without a second RPC. Optional
   field; downstream consumers can null-check.

`identities.get-disk.test.ts` extended with 11 new tests (5 PUB-M + 3 GET-M
+ 3 AVATAR-M) alongside the existing 20 tests. Route integration exercises
the Phase 85 merge path end-to-end.

### Task 3 — Multipart createRole client (pulled forward)

Widening in `src/ui/api/identities-api.ts`:

1. **New exported type**
   `RoleCosmeticInput = {title?: string; colorHue?: number; voice?: string}`.
   Avatar filename is derived server-side from the uploaded File's mimetype
   per Plan 85-02 — client does not send `avatar` in the JSON.

2. **Widened `createRole(input, avatar?)` signature** —
   `input: {name, description, hostId, cosmetics?: RoleCosmeticInput}` +
   optional `avatar: File | null`. Returns
   `{name, description, cosmetics: RoleCosmeticInput}` (backend echoes what
   it wrote per Plan 85-02 Task 1 step 8).

3. **Request body rebuilt** as FormData with `data` field carrying
   `{name, description, hostId, cosmetics}` JSON + optional `avatar` File
   part. Explicit `Content-Type: multipart/form-data` header override
   suppresses axios v1's `formDataToJSON` transform (documented trap at
   `postManualAvatarCandidate` L173-196).

4. **409 → `RoleAlreadyExistsError` branch preserved** unchanged.

5. **Backward-compat maintained** — both `cosmetics` and `avatar` are
   optional so `CreateRoleDialog.tsx` L178-182's existing 3-key call site
   keeps typechecking and keeps working (empty cosmetics, no avatar file).

Colocated test file: 5 `it(` blocks covering C-1..C-5 (bare create,
cosmetics-only, cosmetics+avatar, 409 preserved, backward-compat single-arg).
Mocks `authApi.post` so tests do NOT require the real backend endpoint.

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria met on
every task.

Notes on plan-mandated details verified:

- Task 1's plan Test 6 acceptance said "REMOTE: `readRoleFileByName(mockConn,
  "box-maintainer")` execs the exact shell command
  `cat "$HOME/.claude/roles/box-maintainer/box-maintainer.md" 2>/dev/null || true`."
  Test asserts equality with that exact string (not a `contains` check).
- Task 2's per-host memo was initially implemented as
  `Map<string, cosmetics>` populated after `await`, which failed the
  concurrent-reader test because two `Promise.all` legs both saw an empty
  cache before either populated it. Refactored to `Map<string, Promise<cosmetics>>`
  storing the in-flight Promise (the standard Promise cache pattern) so
  concurrent callers await the same promise. This is a plan-consistent
  implementation choice, not a scope deviation — the plan says "per-host
  role-read memo built once per fanout call" and this pattern satisfies that
  invariant even under `Promise.all` concurrency.

## Verification Command

Green under scoped run:

```
npx vitest run \
  src/backend/claude-session/identity-artifact-reader.role-cosmetics.test.ts \
  src/backend/database/routes/identities.get-disk.test.ts \
  src/backend/database/routes/identities.put-disk.test.ts \
  src/backend/claude-session/identity-artifact-reader.role-file.test.ts \
  src/ui/api/identities-api.role-cosmetics.test.ts
```

Result: `Test Files  5 passed (5)  |  Tests  70 passed (70)`.

Additional guards:

- `npx tsc -p tsconfig.node.json --noEmit` — clean (backend TS compiles).
- `npx tsc -p tsconfig.json --noEmit` — clean (frontend TS compiles; the
  widened `createRole` signature is callable from existing single-arg call
  sites without changes; the `Identity.roleDefaults` field is optional so
  every existing consumer that renders Identity objects still typechecks).

## Known Stubs

None. All wired data flows to a real consumer path in a downstream plan of
Wave 2 / Wave 3:

- `Identity.roleDefaults` field is set from the backend merge; consumed by
  Plan 85-05 IdentityModal to render inherit-vs-override affordances.
- `createRole` widening ships alongside Plan 85-02 (backend endpoint) in
  parallel; end-to-end integration happens in Plan 85-03 (CreateRoleDialog
  actually calls the widened client against the widened endpoint).

## Self-Check: PASSED

- File `src/backend/claude-session/identity-artifact-reader.ts` — FOUND
- File `src/backend/claude-session/identity-artifact-reader.role-cosmetics.test.ts` — FOUND
- File `src/backend/database/routes/identities.ts` — FOUND
- File `src/backend/database/routes/identities.get-disk.test.ts` — FOUND
- File `src/ui/api/identities-api.ts` — FOUND
- File `src/ui/api/identities-api.role-cosmetics.test.ts` — FOUND
- Commit `b7a315fc` — FOUND (Task 1)
- Commit `9deca934` — FOUND (Task 2)
- Commit `6eec8d09` — FOUND (Task 3)
- Scoped test bundle exit code 0 — FOUND (70 tests pass across 5 files)
