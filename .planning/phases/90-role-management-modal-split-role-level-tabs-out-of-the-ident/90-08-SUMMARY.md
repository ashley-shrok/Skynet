---
phase: 90-role-management-modal-split
plan: 08
subsystem: backend
tags: [role-avatar, upload-endpoint, multipart, frontmatter-round-trip, wave-5]
requires:
  - Plan 90-02 (readRoleFileByName + GET /roles/:name/avatar)
  - Plan 90-03 (writeRoleFileByName full-overwrite writer)
  - Plan 90-06 (unbiased code review — closes HIGH-severity "avatar file bytes discarded")
provides:
  - POST /roles/:name/avatar multipart upload endpoint
  - writeRoleAvatarByName(conn, roleName, filename, bytes) backend helper
  - Frontmatter round-trip (readRoleFileByName → yaml overlay → writeRoleFileByName)
affects:
  - src/backend/claude-session/identity-artifact-reader.ts (added writeRoleAvatarByName + ROLE_AVATAR_FILENAME_RE)
  - src/backend/database/routes/roles.ts (added POST /:name/avatar handler + multer config)
  - src/backend/database/routes/roles.avatar-write.test.ts (new test file, 10 cases)
tech-stack:
  patterns:
    - multer memoryStorage for multipart upload (identity-side pattern from identities.ts:42-49)
    - MIME allowlist + fileFilter + LIMIT_FILE_SIZE handling
    - Two-step atomicity: bytes-first, frontmatter-second
    - Server-side filename derivation (`<roleName>.<ext>` from MIME) — client filename DISCARDED per T-90-08-01
    - yaml.load overlay pattern (identities.ts:522-632 PUT overlay) for frontmatter round-trip
    - Loud-fail on malformed existing frontmatter (matches identities.ts:543-563 defensive branch)
key-files:
  created:
    - src/backend/database/routes/roles.avatar-write.test.ts
  modified:
    - src/backend/claude-session/identity-artifact-reader.ts (added writeRoleAvatarByName + ROLE_AVATAR_FILENAME_RE regex, ~100 lines)
    - src/backend/database/routes/roles.ts (multer config, POST handler, error handling, ~200 lines)
decisions:
  - "ROLE_AVATAR_FILENAME_RE excludes svg — writer rejects svg (script-injection risk) even though reader (readAvatarSiblingFileByRole) tolerates svg for legacy on-disk files"
  - "5MB upload cap (ROLE_AVATAR_MAX_BYTES) — larger than identity 2MB (identities.ts:44) because role avatars can be manually-picked art shared across identities"
  - "Two-step atomicity: worst-case failure leaves orphaned avatar bytes with stale frontmatter — self-heals via re-upload (matches roles-create.ts:565-587 inline pattern)"
  - "Pre-multer middleware chain: roleName + hostId gates fire BEFORE multer body-parse (plan requirement — 400 must NOT require parsing multipart body)"
  - "Filename derived server-side as <roleName>.<ext> from MIME (T-90-08-01) — client-supplied multipart filename intentionally discarded to prevent path-traversal"
  - "Multer LIMIT_FILE_SIZE + fileFilter errors are trapped in a dedicated middleware to emit correct 413/415 semantics (LIMIT_FILE_SIZE default surfaces as 500 without trap)"
metrics:
  duration: ~30min
  tasks: 3
  files_created: 1
  files_modified: 2
  tests_added: 10
  tests_scoped_run: 79 (10 new + 10 existing roles.test.ts + 22 identity-artifact-reader adjacent + 37 roles-create/list adjacent)
  completed_date: 2026-09-09
---

# Phase 90 Plan 90-08: POST /roles/:name/avatar Upload Endpoint Summary

Backend counterpart to Plan 90-02's GET serve — closes the HIGH-severity "avatar file bytes discarded" gap from the Phase 90 unbiased code review by adding a multipart upload endpoint with server-side filename derivation and frontmatter round-trip.

## Objective

Add the missing role avatar upload endpoint. The identity-modal cosmetic edit flow can already persist a picked/generated avatar via `PUT /identities/:identityKey` (identities.ts:410+); the role modal's cosmetic edit block previously had no such backend counterpart — uploaded bytes were silently discarded. This plan closes the loop.

## Tasks Completed

### Task 1: `writeRoleAvatarByName` backend helper

Added exported function to `src/backend/claude-session/identity-artifact-reader.ts`:

```ts
export async function writeRoleAvatarByName(
  conn: SSHClientType | null,
  roleName: string,
  filename: string,
  bytes: Buffer,
): Promise<void>
```

Guards (in order):
1. `ROLE_NAME_PATTERN.test(roleName)` — shell-safety gate.
2. `ROLE_AVATAR_FILENAME_RE.test(filename)` — new local regex `^[a-z0-9-]+\.(webp|png|jpg|gif)$` (canonical basename + one of 4 raster exts; forbids path-traversal, uppercase, non-canonical exts, shell metachars).
3. `Buffer.isBuffer(bytes)` — reject non-Buffer inputs at boundary.
4. `bytes.byteLength <= IDMEDIT_MAX_AVATAR_BYTES` — 5MB DoS cap BEFORE any I/O.

Branches:
- LOCAL (conn=null): `mkdir -p` + tmp+rename via Node `fs.writeFile` + `fs.rename` (mirrors `writeRoleFileByName` LOCAL pattern at L2693-2704, minus utf-8 encoding).
- REMOTE: defensive `mkdir -p "$HOME/.claude/roles/<roleName>"` via `execWithTimeout`, then SFTP tmp+rename via `sftpWriteBinaryAtomic` (same `ext_openssh_rename` discipline as `writeAvatarSiblingFile` for atomic overwrite).

**Commit:** `305a9343`

### Task 2: `POST /roles/:name/avatar` handler

Added handler to `src/backend/database/routes/roles.ts`:

```
POST /roles/:name/avatar?hostId=<n>
  Content-Type: multipart/form-data
  Field: avatar (image bytes, MIME in allowlist, <= 5MB)
```

**Multer config** (mirrors identities.ts:42-49):
- `storage: memoryStorage()` — bytes in `req.file.buffer`.
- `limits.fileSize: 5 * 1024 * 1024` (ROLE_AVATAR_MAX_BYTES).
- `fileFilter`: reject anything outside `image/webp|png|jpeg|gif`.

**Validation order** (fail-fast per plan):
1. Pre-multer middleware: roleName ROLE_NAME_PATTERN → 400; hostId integer/positive → 400.
2. Multer parse: LIMIT_FILE_SIZE → 413 with `{error, maxBytes}`; fileFilter reject → 415 with `{error, allowed[]}`; other multer error → 400.
3. Post-multer: `!req.file` → 400 `{error: "no avatar file"}`.
4. Defensive: mimetype re-check (belt+suspenders), MIME_TO_AVATAR_EXT lookup → 415 if not resolvable.
5. LOCAL vs REMOTE branch via `isLocalHostId(hostIdNum)`; REMOTE failure → 502 `{error: "host unreachable"}`.
6. Wrap steps 1-2 (write bytes, round-trip frontmatter) in try/catch → any throw → 502 with generic message.

**Two-step atomicity** (per plan spec):
1. `writeRoleAvatarByName(conn, name, filename, req.file.buffer)` writes bytes to `~/.claude/roles/<name>/<name>.<ext>`.
2. `readRoleFileByName(conn, name)` reads role markdown; `yaml.load` on frontmatter block; overlay `avatar` key with new filename; `yaml.dump` + splice with body; `writeRoleFileByName(conn, name, newBody)` writes back.

**Malformed frontmatter defensive branch**: if `yaml.load` throws on existing frontmatter, refuse to overwrite (mirrors identities.ts:543-563 — silently resetting to `{}` would drop other cosmetic keys, e.g. `role:` in identity case, and break downstream readers).

**Response 201**: `{filename: "<roleName>.<ext>", avatarUrl: "/roles/<name>/avatar?hostId=<n>"}`.

**Commit:** `305a9343`

### Task 3: Vitest coverage — 10 cases in `roles.avatar-write.test.ts`

All 10 cases passing on first run.

| Case | Behavior | Status |
|------|----------|--------|
| A    | Happy path — 201 with `{filename, avatarUrl}`; writeRoleAvatarByName called with (MOCK_CONN, "box-maintainer", "box-maintainer.png", buffer); readRoleFileByName + writeRoleFileByName round-trip splices `avatar:` key into rewritten frontmatter | pass |
| B    | Invalid roleName (`UPPERCASE_INVALID`) → 400 before multer or writers | pass |
| C    | Missing hostId → 400 before writers | pass |
| D    | Empty multipart body → 400 `{error: "no avatar file"}` | pass |
| E    | Unsupported MIME (`image/bmp`) → 415 with `allowed` list | pass |
| F    | Oversize (6MB > 5MB cap) → 413 with `maxBytes: 5242880` | pass |
| G    | `resolveHostById` returns null → 502 | pass |
| H    | `writeRoleAvatarByName` throws → 502 with generic error, no upstream leak (no "simulated" in body) | pass |
| I    | Frontmatter WITHOUT `avatar:` key gains it; other keys preserved; only one avatar line | pass |
| J    | Frontmatter WITH prior `avatar: old-value.png` gets overwritten to `avatar: box-maintainer.webp`; other keys preserved; only one avatar line | pass |

**Test scaffolding notes:**
- Multipart uploads use Node 18+ built-in `FormData` + `Blob` + `fetch` — no manual boundary string handling.
- `vi.mock` on `identity-artifact-reader.js` intercepts `readRoleFileByName`, `writeRoleAvatarByName`, `writeRoleFileByName` to capture call args; recorded arrays reset per-test.
- `mockWriteRoleAvatarShouldThrow` toggle simulates SSH-layer failures for the leakage test.

## Verification

**Acceptance criteria** (from plan):

- Task 1: `grep -c "export async function writeRoleAvatarByName" ...` = 1
- Task 2: `grep -c "'/:name/avatar'" ...` = 2 (GET + POST, using double-quote strings — spec used single-quote grep but intent is >=2 registrations)
  - `grep -c "writeRoleAvatarByName" src/backend/database/routes/roles.ts` = 1
  - `grep -c "writeRoleFileByName" src/backend/database/routes/roles.ts` = 1
- Task 3: `npx vitest run src/backend/database/routes/roles.avatar-write.test.ts` — 10/10 pass
  - `npx vitest run src/backend/database/routes/roles.test.ts` — 10/10 pass (no regression)

**Build gates:**
- `npm run build:backend` — exit 0
- `npm run build` — exit 0

**Scoped regression sweep (79 tests, all green):**
- 10 new (roles.avatar-write.test.ts)
- 10 existing (roles.test.ts — Plan 90-02 GET serve)
- 22 identity-artifact-reader adjacent (write-role-file-by-name, role-file, remote-writes)
- 37 roles-create/list adjacent (roles-create.test.ts, roles-list-for-host.test.ts)

## Deviations from Plan

None — plan executed exactly as written.

Minor grep-syntax note: plan spec's `grep -c "'/:name/avatar'"` uses single-quote string literal syntax; the actual file uses double-quote string literals. Intent (>=2 registrations of `/:name/avatar`) is satisfied.

## Frontend Follow-up (out of scope for 90-08)

The frontend's role-modal cosmetic edit block needs to be wired to POST to this new endpoint. That is out of scope for 90-08 — Wave 6 (Plan 90-09) or a later plan will handle the UI half. The endpoint contract is stable:

```
POST /roles/:name/avatar?hostId=<n>
  Content-Type: multipart/form-data
  Field: avatar (image/webp | image/png | image/jpeg | image/gif; ≤ 5MB)
→ 201 { filename: "<roleName>.<ext>", avatarUrl: "/roles/<name>/avatar?hostId=<n>" }
```

## Self-Check: PASSED

Verified:
- File `src/backend/database/routes/roles.avatar-write.test.ts` exists.
- File `src/backend/claude-session/identity-artifact-reader.ts` modified (contains `writeRoleAvatarByName`).
- File `src/backend/database/routes/roles.ts` modified (contains `router.post("/:name/avatar", ...)`).
- Commit `305a9343` exists in `git log`.
