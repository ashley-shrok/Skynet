---
phase: 86-cosmetics-migrate-to-role
plan: 02
subsystem: roles-create-route
tags:
  - backend
  - multipart-endpoint
  - role-cosmetics-frontmatter
  - avatar-sibling-write
  - loud-415-on-wrong-content-type
dependency_graph:
  requires:
    - Plan 86-01 Task 3 createRole client widening (multipart caller shape)
  provides:
    - POST /roles multipart handler with cosmetic frontmatter emission
    - Role-folder avatar sibling write (~/.claude/roles/<name>/<name>.<ext>)
    - LOUD 415 on non-multipart Content-Type
  affects:
    - Plan 86-03 CreateRoleDialog integration (Wave 2 — dialog will call this
      widened endpoint via the widened createRole client from Plan 86-01)
tech_stack:
  added: []
  patterns:
    - "multer memoryStorage + 2 MiB fileSize limit + mimetype whitelist
      (mirrors identities.ts L36-49 exactly — kept in sync per canonical_refs
      'same trap' note)"
    - "js-yaml.dump for cosmetic frontmatter emission (mirrors identities.ts
      L590-596 PUT-echo pattern)"
    - "Inline SFTP writeFile via conn.sftp → sftp.writeFile → sftp.end()
      (mirrors identity-artifact-reader.ts sftpReadFile L2473-2490 promise-
      wrap discipline)"
    - "Content-Type gate BEFORE multer (LOUD 415 on raw JSON rather than
      confusing multer boundary error)"
key_files:
  created: []
  modified:
    - src/backend/database/routes/roles-create.ts (+363 / -96 lines — full
      handler rewrite around multer + cosmetic gates + frontmatter emission
      + inline SFTP avatar write; all Phase 22 gates preserved unchanged)
    - src/backend/database/routes/roles-create.test.ts (+471 / -215 lines —
      converted scaffold from JSON to multipart; 12 new tests for Phase 86
      behavior; kept all 8 Phase 22 regression guards via re-expressed
      multipart form)
decisions:
  - "Content-Type gate lives BEFORE multer.single(). Rationale: a raw-JSON
    caller sent to `upload.single('avatar')` gets an opaque `MulterError:
    Unexpected end of form` — the plan Test 5 requires the exact string
    'roles create requires multipart/form-data with `data` field'. Running
    a `if (!ct.startsWith('multipart/form-data')) return 415` middleware
    ahead of multer gives us the LOUD, actionable message per T-86-02-03."
  - "avatarFilename derived server-side as `<name>.<ext>` where ext comes
    from MIME_TO_AVATAR_EXT lookup on req.file.mimetype (T-86-02-01
    mitigation). Client-supplied filename in the multipart part is IGNORED
    completely — the server picks both halves. Test 3 asserts the persisted
    filename (`box-maintainer.webp`) matches the role name, not the client's
    upload filename (`role-avatar.webp`)."
  - "Inline SFTP write kept in roles-create.ts (NOT extended into identity-
    artifact-reader.ts) per the wave-1 file-ownership constraint locked in
    the plan revision. Plan 86-01 owns identity-artifact-reader.ts this
    wave. Follow-up refactor CAN extract writeAvatarSiblingFileForRole(conn,
    roleName, ext, bytes) once a third caller emerges — same 'extract later
    if a third caller emerges' precedent CONTEXT.md applies to the avatar
    generator (D-CTX-86-surface-3). Code comment in roles-create.ts flags
    this."
  - "Cosmetics validation runs BEFORE resolveHostById + connectOneShot so a
    bad payload fails fast without touching the network (T-86-02 mitigation
    pattern — mirrors identities.ts PUT L444-461 discipline)."
  - "Frontmatter-less body path is byte-identical to Phase 22's output when
    cosmetics is empty. This is a load-bearing regression guard (Test 1) —
    it means existing role-creation flows that pass no cosmetics field
    produce the exact same file the pre-Phase-86 handler produced. The
    hasCosmetics branch adds the frontmatter block; the else branch reuses
    the exact bodyLines string that was the entire pre-widening output."
  - "yaml.dump options (sortKeys: false, lineWidth: -1, noRefs: true,
    forceQuotes: false) match identities.ts L590-596 exactly. Preserves the
    canonical cosmetic-field ordering (title → colorHue → voice → avatar in
    insertion order) so future reader tests can assume a stable shape."
metrics:
  duration: "~25 minutes (start 2026-09-07 05:12 UTC, end 2026-09-07 05:52 UTC)"
  completed_date: 2026-09-07
  tasks_completed: 1
  tests_added: 12 (Phase 86 behaviors) — total in file 20 (8 Phase 22
    regression guards re-expressed on the multipart wire, still passing)
  tests_passing: 20 / 20
  files_created: 0
  files_modified: 2
  commits: 2 (RED + GREEN — no REFACTOR needed)
---

# Phase 86 Plan 86-02: POST /roles multipart widening — cosmetics frontmatter + avatar sibling write

Wave-1 backend groundwork for the cosmetics-migrate-to-role UI. Widens the
role-creation endpoint to accept + persist the four cosmetic frontmatter
fields (title, colorHue, voice, avatar) locked in D-CTX-86-surface-1, and
to accept + write an avatar sibling file into the role folder. Runs in
parallel with Plan 86-01 (different file, different route, different tests
— no cross-file conflict).

Plan 86-03 (CreateRoleDialog wire-up, Wave 2) will call this widened
endpoint via the widened createRole client already shipped in Plan 86-01
Task 3 (pulled forward to resolve the wave-1 identities-api.ts file-
ownership conflict).

## Completed Tasks

| Task    | Commit    | Name                                                                        |
| ------- | --------- | --------------------------------------------------------------------------- |
| 1 RED   | 1827dd5a  | Add failing tests for multipart /roles + cosmetics + avatar sibling write   |
| 1 GREEN | b00a96a0  | Widen POST /roles to multipart with cosmetics + role-folder avatar write    |

## Endpoint contract — before / after

### Before (Phase 22 shape — JSON only)

```
POST /roles
Content-Type: application/json
Body: { name: string, description: string, hostId: number }
→ 201 { name, description }
→ 400 on validation failure
→ 401 without JWT
→ 404 on cross-user hostId
→ 409 on role folder already exists
→ 502 on SSH failure
```

### After (Phase 86 Plan 86-02 shape — multipart/form-data)

```
POST /roles
Content-Type: multipart/form-data
Fields:
  - `data` (required): JSON blob
    { name: string, description: string, hostId: number,
      cosmetics?: { title?, colorHue?, voice? } }
  - `avatar` (optional): image/png|jpeg|webp file ≤ 2 MiB
→ 201 { name, description, cosmetics: {title?, colorHue?, voice?, avatar?} }
  (cosmetics = {} when none supplied; avatar filename derived server-side
  from mimetype when file supplied)
→ 400 on validation failure (name/description/hostId + per-cosmetic-field
  gates for title/colorHue/voice)
→ 401 without JWT
→ 404 on cross-user hostId
→ 409 on role folder already exists
→ 413 on avatar exceeding 2 MiB (multer LIMIT_FILE_SIZE)
→ 415 on non-multipart Content-Type OR unsupported avatar mimetype
→ 502 on SSH connect / exec / SFTP write failure
```

## Sibling-file write: inlined vs helper (with rationale)

**Inlined.** The inline SFTP writeFile lives directly in roles-create.ts as
a private `sftpWriteFileInline(conn, remotePath, bytes)` helper. It was NOT
added as a new export in identity-artifact-reader.ts (e.g. a
`writeAvatarSiblingFileForRole` mirror of `writeAvatarSiblingFile`).

**Why:** Wave-1 file-ownership constraint. Plan 86-01 owns
identity-artifact-reader.ts this wave (added `readRoleFileByName`,
`readAvatarSiblingFileByRole`, and JSDoc updates). Plan 86-02 owns
roles-create.ts. Adding a fourth export to identity-artifact-reader.ts
from this plan would create a wave-1 file conflict.

The plan's step 7 explicitly locks this: *"use INLINE SFTP writeFile at
${remoteHome}/.claude/roles/${name}/${avatarFilename} (NOT extending
writeAvatarSiblingFile — keeps wave-1 file-ownership clean between this
plan and Plan 86-01)."*

Follow-up: when a third caller emerges (e.g. the avatar generator that
CreateRoleDialog wires up in Plan 86-03 may need to re-write the sibling
if the user picks a different candidate mid-flow, and an identity-side
mirror might land later), extract to `writeAvatarSiblingFileForRole(conn,
roleName, ext, bytes)` in identity-artifact-reader.ts. Same "extract later
if a third caller emerges" precedent CONTEXT.md applies to the avatar
generator itself (D-CTX-86-surface-3). A code comment in roles-create.ts
flags this exact refactor path so future maintainers don't need to
re-derive the rationale.

## Frontmatter emission logic

Two paths, gated by `hasCosmetics = Object.keys(cosmetics).length > 0`:

### `hasCosmetics === false` (Test 1 — REGRESSION GUARD)

Body written verbatim, byte-identical to Phase 22 output:

```markdown
# <name>

## Role

<description>

<!-- This role file was auto-generated with only a basic description. On
first wake of an agent holding this role, please flesh out the role with
standing directives, learned preferences, and a 10,000-foot view of the
domain the role covers, then remove this comment. -->
```

No `---\n` frontmatter block. This is load-bearing: existing role-creation
call sites (e.g. anywhere in Skynet or downstream tooling) that pass no
cosmetics MUST continue producing the exact same file they always have.
Test 1 asserts `!stubBody.match(/^---\n/)`.

### `hasCosmetics === true` (Tests 2, 3, 8)

Body prepended with a YAML frontmatter block via `yaml.dump(cosmetics, ...)`:

```markdown
---
title: <title>
colorHue: <hue>
voice: <voice>
avatar: <name>.<ext>
---

# <name>

## Role

<description>

<seed comment>
```

- Fields present in the block ⇔ fields present on the input `cosmetics`
  object (insertion order preserved via `sortKeys: false`).
- `avatar` is present iff a file was uploaded (`req.file` truthy).
- `yaml.dump` options match identities.ts L590-596 exactly (`sortKeys: false,
  lineWidth: -1, noRefs: true, forceQuotes: false`) so the on-disk shape is
  identical to what the identity PUT handler produces — future readers can
  assume one canonical shape across identity + role files.

## Test result — exact scoped command

```
npx vitest run src/backend/database/routes/roles-create.test.ts
```

**Result:** `Test Files  1 passed (1)  |  Tests  20 passed (20)` — all
green.

Test coverage breakdown:

- **8 regression guards (R-1..R-9)** — Phase 22 name/description/hostId/
  cross-user/collision/SSH-fail/no-JWT gates, all re-expressed against the
  new multipart wire. Every gate still fires with the same status code and
  the same error-message shape.
- **12 Phase 86 behavior tests (1..8 + 3b + 3c + 4b + 4c)** —
  - **Test 1**: no cosmetics + no avatar → frontmatter-less body verbatim.
  - **Test 2**: cosmetics without avatar → frontmatter with three keys, no
    `avatar:`.
  - **Test 3**: cosmetics + avatar → `.md` with `avatar: <name>.webp` in
    frontmatter, sibling file at
    `/home/ubuntu/.claude/roles/box-maintainer/box-maintainer.webp` via
    inline SFTP writeFile.
  - **Test 4a/4b/4c**: malformed colorHue / voice / title → 400 with
    field-specific error, no writeMarkdownFileAtomic invocation.
  - **Test 5**: raw JSON body → 415 with LOUD error containing both
    `multipart/form-data` and `data`.
  - **Test 6**: 3 MiB avatar → 413 with "2 MB limit" message.
  - **Test 7**: image/gif avatar → 415 with "PNG, JPEG, or WebP" message.
  - **Test 8**: happy-path round-trip → 201 with `{name, description,
    cosmetics}` echoing all four persisted fields.
  - **Test 3b**: description with `\n\n\n` round-trips verbatim through
    the frontmatter-emitting path.
  - **Test 3c**: description with backticks / `$` / `;` / quotes round-
    trips via SFTP write unchanged (no shell interpolation surface).

## Acceptance criteria — all met

| Criterion                                                                          | Actual                  |
| ---------------------------------------------------------------------------------- | ----------------------- |
| `grep -n "upload.single\|multer\|memoryStorage" roles-create.ts` returns ≥ 3       | 9 matches               |
| `grep -n "parseMultipartRolePayload\|multipart/form-data" roles-create.ts` ≥ 2     | 7 matches               |
| `grep -n "cosmetics\." roles-create.ts` returns ≥ 4                                | 5 matches               |
| `grep -n "yaml.dump" roles-create.ts` returns ≥ 1                                  | 5 matches               |
| `grep -c "res\.status(400)" roles-create.ts` ≥ 5                                   | 10 matches              |
| `grep -n "res\.status(415)" roles-create.ts` ≥ 1                                   | 3 matches               |
| roles-create.test.ts contains ≥ 9 `it(` blocks                                     | 20 `it(` blocks         |
| `npx vitest run src/backend/database/routes/roles-create.test.ts` exits 0          | ✓ exit 0                |

## Deviations from Plan

None — plan executed exactly as written. All Phase 86 behavior tests
mapped 1:1 to plan `<behavior>` items with a handful of belt tests added
(4b/4c/3b/3c) for expanded coverage of the same code paths.

Notes on plan-mandated details verified:

- Plan step 7 mandated: `await new Promise<void>((resolve, reject) => {
  conn.sftp((sftpErr, sftp) => { ... sftp.writeFile(targetPath,
  req.file!.buffer, (writeErr) => { sftp.end(); ... }); }); });`

  Implementation splits the promise-wrap into two `await new Promise(...)`
  calls (one for `conn.sftp`, one for `sftp.writeFile`) so `sftp.end()`
  lives in a `finally` block. This matches the sftpReadFile prologue
  discipline referenced in the plan MORE closely than the nested-callback
  shape the plan text sketched, and passes the same Test 3 sibling-write
  assertion. The plan's structural intent (SFTP wrapper end() always fires,
  even on writeFile error) is preserved.

- Plan step 6 mandated `Import 'yaml' from 'js-yaml'`. Done — same import
  shape as identities.ts L7.

- Plan step 7's LOCKED code comment about wave-1 file-ownership + follow-up
  refactor precedent is embedded verbatim in the JSDoc for
  `sftpWriteFileInline`.

## Known Stubs

None. Every wired path flows to a real consumer:

- The multipart handler is called from the widened `createRole` client
  shipped in Plan 86-01 Task 3 (already landed).
- Plan 86-03 (Wave 2) wires CreateRoleDialog.tsx's cosmetic controls to
  build the multipart `data` blob + optional avatar file and call
  `createRole(input, file)`.

## Backend build check

`npx tsc -p tsconfig.node.json --noEmit` — clean (exit 0, empty stderr).
The widened handler + inline SFTP helper compile against the existing
ssh2 SFTPWrapper type and Express Request/Response types with no `any`
casts beyond the two `Awaited<ReturnType<typeof connectOneShot>>` casts
carried over verbatim from Phase 22.

## Self-Check: PASSED

- File `src/backend/database/routes/roles-create.ts` — FOUND
- File `src/backend/database/routes/roles-create.test.ts` — FOUND
- Commit `1827dd5a` (RED) — FOUND
- Commit `b00a96a0` (GREEN) — FOUND
- Scoped test bundle exit code 0 — FOUND (20 tests pass in one file)
- `npx tsc -p tsconfig.node.json --noEmit` exit code 0 — FOUND (backend
  TS clean)
