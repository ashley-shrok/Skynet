# Phase 85: User avatars — baseline backend support — Research

**Researched:** 2026-09-07
**Domain:** Skynet backend — Express + Drizzle + AES-encrypted in-memory SQLite; on-disk avatar file lifecycle inside the `skynet-data` docker volume
**Confidence:** HIGH (nearly every finding is a direct file:line read from the current tree, not inference)

## Summary

Phase 85 adds three backend endpoints (extended `POST /users/create`, new avatar-change PUT, new avatar serve GET) and one new nullable column on the `users` table, backed by files on disk in `${DATA_DIR}/user-avatars/`. Every ingredient — multer + memoryStorage + 5MB cap + PNG/JPEG/WebP fileFilter, the multer-error → HTTP-status handler, the `addColumnIfNotExists` migration pattern, the `DatabaseSaveTrigger.forceSave` pairing, the "own-record OR admin" auth check, the multipart test helper — already exists in this codebase and needs to be copy-mirrored, not designed.

The two Skynet-specific traps the shape file called out (in-memory-SQLite save-trigger + nginx-config duplication) both have well-established mirrored patterns to lean on. The nginx `/users` block currently has no `client_max_body_size` directive so it inherits nginx's 1 MB default — the phase MUST bump it to 6M in both `docker/nginx.conf` and `docker/nginx-https.conf`, else 5 MB avatar uploads 413 at the edge before reaching Express.

**Primary recommendation:** Copy the exact patterns from `identity-avatar-batch.ts` (multer config, error handler) and `identities.ts` (serve-bytes-from-disk, ETag) for the byte-work; copy the `mxid` column precedent from Phase 75 (`schema.ts:32` + `db/index.ts:894` `addColumnIfNotExists` + `forceSave`) verbatim for the new column; copy the `session.userId !== userId && !isAdmin` guard shape from `user-session-routes.ts:154` for the change-endpoint authz; use file-then-row ordering with best-effort file-rollback on SQL failure.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Storage location:**
- **D-01:** Avatar bytes live as files on disk on the Skynet EC2 (`t1000`) itself, NOT on any managed host, NOT on a mounted operator-config path, NOT as bytes in a DB column.
- **D-02:** Files sit inside `skynet-data` docker volume (same volume as encrypted SQLite). Path: `${DATA_DIR}/user-avatars/` (planner may pick a differently-named sibling if consistency argues for it).
- **D-03:** Rides existing daily EBS DLM snapshot backup story — no additional plumbing.

**DB schema change:**
- **D-04:** Add one small nullable text column to the `users` table (`src/backend/database/db/schema.ts:4`). Column carries a pointer to the on-disk file — NOT bytes, NOT an absolute path, NOT an external URL.
- **D-05:** Exact column shape (name, contents — a bare filename with extension, or a hash, or the user id with extension) is a planner call. Constraint: choice must be deterministic and reconstructible from `DATA_DIR` alone.
- **D-06:** Column is nullable at the schema level to support existing users (D-13). New rows created via `POST /users/create` MUST have it populated — mandatoriness enforced at the endpoint, not the schema.

**Mandatoriness:**
- **D-07:** Mandatory-at-create is a real BACKEND guarantee. `POST /users/create` refuses to create a user without avatar bytes in the request.
- **D-08:** No pending state / no reservation dance. A user either exists (with an avatar) or does not.

**Endpoint shape:**
- **D-09:** `POST /users/create` extended from `application/json` to `multipart/form-data`, carries `username` + `password` + required `avatar` file part.
- **D-10:** New dedicated endpoint under `/users/…` (planner picks: `PUT /users/:id/avatar` or `POST /users/:id/avatar`) replaces an existing user's avatar file. Auth: user's own credentials or admin.
- **D-11:** New serve endpoint under `/users/…` (planner picks: `GET /users/:id/avatar`) returns bytes with correct `Content-Type`. ETag desirable if trivial (mirror identity-avatar pattern), but not required.
- **D-12:** All three endpoints share ONE small internal helper that does the byte-work (validate → size-cap → write bytes atomically → update row pointer → save trigger).

**Existing users:**
- **D-13:** No migration / no backfill. Existing users keep null pointer until downstream mechanism uses D-10.

**Format + size cap:**
- **D-14:** Accept `image/png`, `image/jpeg`, `image/webp` (mirrors `identity-avatar-batch.ts:406-410`).
- **D-15:** 5 MB byte cap (mirrors `identity-avatar-batch.ts:414`). Rejection → HTTP 413.
- **D-16:** Reject mime-mismatch OR oversize BEFORE bytes touch disk (multer's memoryStorage + limits.fileSize + fileFilter).

**DB write pairing (trap avoidance):**
- **D-17:** Every users-table row mutation MUST be paired with `DatabaseSaveTrigger.forceSave("phase-85-user-avatar")` or `triggerSave()`. Includes the create-path INSERT (currently lacks this — line 213-220 uses the wrapping `saveMemoryDatabaseToFile()` helper) AND the new change-endpoint UPDATE.
- **D-18:** Failure to call save trigger is the crown-jewel invariant this project has been burned by. Not optional.

**Nginx routing (trap avoidance):**
- **D-19:** All three endpoints under `/users/…` — already covered by existing regex block `location ~ ^/users(/.*)?$` in both config files. No new location blocks required.
- **D-20:** BUT the existing `/users` block has NO `client_max_body_size` directive → nginx 1 MB default → 413 at nginx before reaching Express. MUST add `client_max_body_size 6M;` (or similar) to the existing `/users` block. Preferred over adding a more-specific location block.
- **D-21:** BOTH `docker/nginx.conf` AND `docker/nginx-https.conf` MUST get the edit. Missing the second file is the recurring gotcha.

**On-user-delete cleanup:**
- **D-22:** When a user is deleted, that user's avatar file is removed from disk. Wire `fs.unlink` into every user-delete path, tolerant of missing file (ENOENT is not an error).
- **D-23:** No historical retention — replacement via D-10 overwrites in place OR writes new file + unlinks old.

### Claude's Discretion

- Exact column name on the users row (`avatar`, `avatarPath`, `avatarFilename`) — planner picks.
- Exact filename convention on disk (`${userId}.${ext}`, `${sha}.${ext}`) — planner picks per D-05.
- Change-endpoint HTTP verb (PUT vs POST) and exact path shape — planner picks; standard REST leans PUT for replace-in-place.
- Whether serve endpoint sets Cache-Control, ETag, or Content-Disposition beyond Content-Type — planner's call, keep minimal.
- Authorization model on the change endpoint — user changes own, admin changes anyone; planner uses `authenticateJWT` + own-or-admin pattern.
- Whether to reuse existing `manualUpload` multer instance from `identity-avatar-batch.ts:412` or declare a new scoped one — either fine; new scoped one is cleaner separation.

### Deferred Ideas (OUT OF SCOPE)

- Frontend rendering of user avatars anywhere in the UI.
- Self-serve avatar-change UI (modal, form, drag-drop).
- Backfill for existing users — they keep null pointers.
- Image transforms (resize, crop, thumbnail, EXIF-strip, color correction).
- Content moderation on avatar uploads.
- Cache / CDN headers beyond Content-Type on serve path.
- Historical avatar retention / multi-avatar.
- Anything touching the identity-avatar sidecar system (`identities.ts`, agent-side).
- Adding a rendering route "while we're in there."
- Letting users upload avatar before an account exists ("claim on signup").

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| D-04 | New nullable text column on `users` table | § Migration mechanism + § Existing users row conventions |
| D-07/D-09 | `POST /users/create` extended to require multipart avatar | § Multipart handling in existing global-JSON router + § Ordering under partial failure |
| D-10 | Change-avatar endpoint under `/users/…` | § Authorization pattern + § Ordering under partial failure |
| D-11 | Serve-avatar endpoint under `/users/…` | § Content-Type sniffing for serve endpoint |
| D-12 | Shared internal helper | Compose from multer config (§ Byte-work) + `writeFile`/`unlink` |
| D-17/D-18 | `DatabaseSaveTrigger` pairing on every mutation | § Save-trigger pattern references |
| D-20/D-21 | `client_max_body_size` edit in both nginx configs | § Nginx config layout |
| D-22 | Unlink avatar file on every user-delete path | § User-delete pipeline discovery (5 call sites identified) |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Avatar byte storage (write, unlink) | Node.js filesystem (via `fs/promises`) | — | Bytes are files on the Skynet EC2's own `skynet-data` volume per D-01/D-02. Not the DB layer. |
| Avatar pointer persistence | SQLite (users table column) | RAM DB → disk via `DatabaseSaveTrigger` | Pointer is small, indexable, deterministic from `DATA_DIR`. Bytes NOT in DB per D-01. |
| Format + size validation | Express middleware (multer memoryStorage + fileFilter + limits) | — | Multer intercepts the multipart body before it touches disk; format/size fail at the wire, not after write. |
| Auth on create endpoint | Registration gate (`allow_registration` setting) | — | Existing pattern at `users.ts:82-98`; no change. |
| Auth on change endpoint | `authenticateJWT` + own-or-admin guard | — | Mirror `user-session-routes.ts:154` pattern. |
| Auth on serve endpoint | `authenticateJWT` (any logged-in user can request any user's avatar) | — | Mirror `identities.ts:566` — served avatars are semi-public within the deployment. |
| Edge body-size limit | Nginx `client_max_body_size` in the `/users` regex block | — | Nginx 1 MB default 413s before Express sees it. |
| User-delete file cleanup | Wire `fs.unlink` (ENOENT-tolerant) into every user-delete call site | — | 5 call sites identified — see § User-delete pipeline discovery. |

## Standard Stack

### Core (already installed — verified via existing imports in `identity-avatar-batch.ts`)

| Library | Version in project | Purpose | Why Standard |
|---------|--------------------|---------|--------------|
| `express` [VERIFIED: import at `identity-avatar-batch.ts:29`] | already installed | HTTP routing | project framework |
| `multer` [VERIFIED: import at `identity-avatar-batch.ts:31`, `identities.ts:3`] | already installed | multipart parser + memoryStorage + size/mime limits | project already uses it for avatar uploads on the identity side |
| `nanoid` [VERIFIED: import at `users.ts:7`] | already installed | id generation | already used at `users.ts:135` for user id — reuse if planner picks nanoid-based filename convention |
| `drizzle-orm` [VERIFIED: import at `users.ts:5`] | already installed | ORM for schema.ts type mirror | project convention |
| `better-sqlite3` [VERIFIED: import at `db/index.ts:2`] | already installed | in-memory SQLite backend | project convention |
| `node:fs/promises` [VERIFIED: import at `identities.ts:5`] | Node built-in | file write, unlink | standard Node for avatar-on-disk work |
| `node:path` [VERIFIED: import at `identities.ts:6`] | Node built-in | join `DATA_DIR` + filename | standard |
| `node:crypto` [VERIFIED: import at `identities.ts:4`] | Node built-in | ETag hash (if planner opts in) | mirrors identity-avatar ETag pattern |

**No new npm packages needed.** [VERIFIED: every ingredient present in codebase]

### Package Legitimacy Audit

**Not applicable — this phase installs zero new packages.** All required libraries (`multer`, `nanoid`, `drizzle-orm`, `better-sqlite3`, `express`) are already in the codebase and verified via existing production imports. Nothing to slopcheck.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌────────────────────────┐
                    │  Browser (React SPA)   │
                    │  (out of scope — no    │
                    │  frontend surface this │
                    │  phase, per D-13)      │
                    └───────────┬────────────┘
                                │ multipart/form-data
                                │ or GET
                                ▼
                    ┌────────────────────────┐
                    │      Caddy 2 (edge)    │
                    └───────────┬────────────┘
                                │
                                ▼
                    ┌────────────────────────┐
                    │  Nginx (docker)        │
                    │  location ~ ^/users(/.*)?$
                    │  MUST add:             │
                    │  client_max_body_size 6M
                    │  in BOTH nginx.conf +  │
                    │  nginx-https.conf      │
                    └───────────┬────────────┘
                                │ proxy_pass 127.0.0.1:30001
                                ▼
        ┌───────────────────────┴──────────────────────┐
        │           Express (Skynet backend)           │
        │                                              │
        │  Global: bodyParser.json({limit: "1gb"})     │
        │          (only parses application/json —     │
        │           multipart requests bypass it)      │
        │                                              │
        │  app.use("/users", userRoutes) ──────────┐   │
        │                                          │   │
        │  ┌───────────────────────────────────────▼─┐ │
        │  │ users.ts router                        │ │
        │  │                                        │ │
        │  │ POST /users/create                     │ │
        │  │   → allow_registration gate            │ │
        │  │   → multer.single("avatar")            │ │
        │  │   → validate req.file present          │ │
        │  │   → username/password validation       │ │
        │  │   → writeAvatar(id, mime, bytes)  ─┐   │ │
        │  │   → INSERT users row w/ pointer  ──┼─┐ │ │
        │  │   → DatabaseSaveTrigger.forceSave ─┤ │ │ │
        │  │                                    │ │ │ │
        │  │ PUT /users/:id/avatar              │ │ │ │
        │  │   → authenticateJWT                │ │ │ │
        │  │   → own-or-admin guard             │ │ │ │
        │  │   → multer.single("avatar")        │ │ │ │
        │  │   → writeAvatar (same helper) ────┤ │ │ │
        │  │   → unlink old file (best-effort)  │ │ │ │
        │  │   → UPDATE users row pointer ─────┼─┤ │ │
        │  │   → DatabaseSaveTrigger.forceSave ─┤ │ │ │
        │  │                                    │ │ │ │
        │  │ GET /users/:id/avatar              │ │ │ │
        │  │   → authenticateJWT                │ │ │ │
        │  │   → read pointer from users row ◄──┼─┤ │ │
        │  │   → readFile ${DATA_DIR}/user-     │ │ │ │
        │  │       avatars/${filename}          │ │ │ │
        │  │   → 404 if pointer null / file 404 │ │ │ │
        │  │   → set Content-Type from ext      │ │ │ │
        │  │   → send bytes                     │ │ │ │
        │  │                                    │ │ │ │
        │  │ DELETE /users/delete-user          │ │ │ │
        │  │   (+ 4 more delete call sites)     │ │ │ │
        │  │   → unlink avatar file (ENOENT-OK) │ │ │ │
        │  └────────────────────────────────────┘ │ │ │
        │                                         │ │ │
        └─────────────────────────────────────────┼─┼─┘
                                                  │ │
                                                  ▼ ▼
                                     ┌────────────────────────┐
                                     │  skynet-data volume    │
                                     │  (encrypted at rest    │
                                     │   via LUKS/EBS-KMS)    │
                                     │                        │
                                     │  ${DATA_DIR}/          │
                                     │    db.sqlite.encrypted │
                                     │    user-avatars/       │
                                     │      ${filename}       │
                                     │      ...               │
                                     └────────────────────────┘
```

### Recommended Project Structure

No new directories. All new code lands in existing files:

```
src/backend/database/
├── db/
│   ├── schema.ts              # + one users.avatarPath column (D-04)
│   └── index.ts               # + addColumnIfNotExists + forceSave (§ Migration mechanism)
├── routes/
│   ├── users.ts               # extend POST /create; new PUT + GET; call helper
│   ├── delete-user-data.ts    # add fs.unlink call before DELETE FROM users
│   └── user-avatars-helper.ts # NEW — the shared D-12 helper (planner's option:
│                              #   could also live inline in users.ts; but the
│                              #   shape file names "one shared internal helper"
│                              #   which points at a small dedicated module)
docker/
├── nginx.conf                 # bump /users location client_max_body_size to 6M
└── nginx-https.conf           # same edit
```

### Pattern 1: Multer + memoryStorage + fileFilter + limits (VERBATIM COPY)

**What:** The exact upload configuration Phase 85 needs already exists at `identity-avatar-batch.ts:406-422`. Copy-mirror it, do not redesign.

**Source (verbatim from `identity-avatar-batch.ts:406-422`):**
```typescript
const ALLOWED_MANUAL_AVATAR_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const manualUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MANUAL_AVATAR_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Avatar must be PNG, JPEG, or WebP"));
    }
  },
});
```

Planner's choice per CONTEXT.md discretion: either import `manualUpload` from `identity-avatar-batch.ts` and reuse, OR declare a new `userAvatarUpload` in the user-avatars module with identical shape. Recommend the latter — cleaner separation, zero shared state anyway, and if the identity side ever changes its cap/mimes the users side stays pinned.

### Pattern 2: Multer error → HTTP status handler (VERBATIM COPY)

**Source (verbatim from `identity-avatar-batch.ts:453-478`):**
```typescript
router.use(
  "/candidate/manual",
  (
    err: Error & { code?: string },
    _req: Request,
    res: Response,
    _next: NextFunction,
  ): void => {
    if (err?.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "file too large (max 5 MB)" });
      return;
    }
    if (err?.code === "LIMIT_UNEXPECTED_FILE") {
      res.status(400).json({ error: "missing avatar field" });
      return;
    }
    if (
      err instanceof Error &&
      err.message.includes("Avatar must be PNG, JPEG, or WebP")
    ) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: "upload failed" });
  },
);
```

Copy this error-handler onto the users router, scoped to the create + change avatar routes.

### Pattern 3: DatabaseSaveTrigger.forceSave — reference pattern

**Source (`user-admin-routes.ts:349-361` — the closest recent precedent, Phase 75):**
```typescript
try {
  const { saveMemoryDatabaseToFile } = await import("../db/index.js");
  await saveMemoryDatabaseToFile();
} catch (saveError) {
  authLogger.error(
    "Failed to persist mxid registration to disk",
    saveError,
    {
      operation: "mxid_save_failed",
      targetId,
    },
  );
}
```

Note: this pattern uses `saveMemoryDatabaseToFile()` (the debounced helper), not the direct `DatabaseSaveTrigger.forceSave("<reason>")` call CONTEXT.md D-17 references. **Both are acceptable per D-17.** The forceSave variant (used at `db/index.ts:912` and `db/index.ts:1072`) provides a labeled reason for grep-ability. Reference for the labeled variant:

```typescript
try {
  await DatabaseSaveTrigger.forceSave("phase-85-user-avatar-create");
} catch (saveError) {
  databaseLogger.warn(
    "[phase-85] forceSave failed post-avatar-write (non-fatal — retry on next mutation)",
    { operation: "user_avatar_save_failed", userId: id, error: saveError },
  );
}
```

Recommend the `forceSave("phase-85-user-avatar-<create|change>")` variant per the CONTEXT.md D-17 preference for explicit labels.

### Pattern 4: Own-or-admin auth guard (VERBATIM COPY from user-session-routes.ts)

**Source (`user-session-routes.ts:134-158` — the canonical Skynet pattern):**
```typescript
const userId = (req as AuthenticatedRequest).userId;
// ... resolve targetUserId from req.params.id ...
try {
  const user = await db.select().from(users).where(eq(users.id, userId));
  if (!user || user.length === 0) {
    return res.status(404).json({ error: "User not found" });
  }
  const userRecord = user[0];
  // ... resolve session/target ...
  if (!userRecord.isAdmin && session.userId !== userId) {
    return res
      .status(403)
      .json({ error: "Not authorized to revoke this session" });
  }
  // ... proceed ...
} catch { ... }
```

For Phase 85's `PUT /users/:id/avatar`, the exact shape becomes:
```typescript
if (!userRecord.isAdmin && targetUserId !== userId) {
  return res
    .status(403)
    .json({ error: "Not authorized to change this user's avatar" });
}
```

### Anti-Patterns to Avoid

- **Do NOT hand-roll a multipart parser.** Multer + memoryStorage exists — use it. The `identity-avatar-batch.ts:412` config is the reference.
- **Do NOT store bytes in the DB row.** D-01/D-02 lock the file-on-disk model. Storing bytes inflates the AES-encrypted DB dump every save and slows every startup by however-many-MB × user-count.
- **Do NOT skip the save trigger.** This is the crown-jewel invariant. Every users-row mutation pairs with `forceSave()` — no exceptions.
- **Do NOT edit only one nginx config file.** D-21 says both. History says only-one-file is the recurring failure mode.
- **Do NOT delete the file BEFORE updating the DB row** on the change endpoint. Doing it in that order means a mid-operation crash leaves the row pointing at a nonexistent file. See § File-first vs row-first ordering.
- **Do NOT trust `req.file.mimetype` past validation.** Multer's `fileFilter` runs on the browser-declared Content-Type. If the planner picks a filename convention that encodes extension from mime (e.g., `${id}.${mimeToExt(mime)}`), use a whitelist mapping (mirror `identities.ts:22` `MIME_TO_AVATAR_EXT` — a curated Record, not a naive substring split).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multipart body parsing | Custom stream reader | `multer` (already installed) | multer handles boundary parsing, part streaming, mime detection, size limits — all in one config object |
| Buffer-in-memory upload | `multer.diskStorage()` for a temp file then read-back | `multer.memoryStorage()` | 5 MB fits comfortably in RAM; disk-storage adds a temp-file lifecycle for zero win at this size |
| Save-to-disk pairing after row mutation | Direct sqlite `.exec()` call at bottom of handler | `DatabaseSaveTrigger.forceSave("phase-85-...")` | The forceSave helper coordinates with the debounce-save background loop; direct .exec() writes only reach RAM per CLAUDE.md § "In-memory SQLite pattern" |
| Migration script for the new column | `drizzle-kit push` / migration files | Add `addColumnIfNotExists("users", "avatar_path", "TEXT")` to `db/index.ts` + `forceSave` after | Skynet doesn't run drizzle-kit; every prior column addition (`is_admin`, `is_oidc`, `mxid`, `queue_slots`, ...) went via `addColumnIfNotExists`. Idempotent across boots. |
| Content-Type detection on the serve path | libmagic / file-type / sniff bytes | Read the extension off the pointer (or store mime alongside the pointer) | Format was already validated on the write path via multer's fileFilter — the store-time mime is trusted at read time. See § Content-Type sniffing. |
| ENOENT-safe unlink | try/catch around `fs.unlink` | `await fs.unlink(...).catch((err) => { if (err.code !== "ENOENT") throw err; })` | ENOENT during avatar cleanup is a normal state (user never had one, or race with concurrent replace). Only ENOENT is swallowed. |

**Key insight:** Every ingredient exists. The phase is stitching, not synthesis.

## Runtime State Inventory

> Rename/refactor/migration checklist. Phase 85 is greenfield (adding a new column + new files), NOT a rename/migration, so most categories are N/A. Documented explicitly per the checklist rule.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | New: `${DATA_DIR}/user-avatars/*` files. Existing users' rows: new `avatar_path` column stays NULL (per D-13, no backfill). | New files: written on create/change. NULL rows: no action — D-13 explicitly defers. |
| Live service config | None — nothing external to Skynet stores user-avatar state. | None. |
| OS-registered state | None — no systemd unit / cron / Task Scheduler / pm2 name embeds user-avatar concept. | None. |
| Secrets/env vars | `DATA_DIR` env var (already-set, `docker-compose.yml`, value `/app/data`) is read at boot. No new secrets. | None — reuse existing. |
| Build artifacts / installed packages | None — no packages added, no build outputs regenerated. | None. |

**Explicit statement:** The only runtime state Phase 85 creates is (a) the on-disk `user-avatars/` subdir + the files within it (initially empty; populated as new users register or existing users' avatars are set via D-10), and (b) new `avatar_path` column values on new user rows. Both are internal to the Skynet EC2's `skynet-data` volume.

## Common Pitfalls

### Pitfall 1: nginx 1 MB default body size on `/users`

**What goes wrong:** 5 MB avatar upload 413s at the nginx layer, never reaches Express, error message from nginx (not Skynet), user sees a broken create form with no useful signal.

**Why it happens:** The existing `location ~ ^/users(/.*)?$` block (verified at `docker/nginx.conf:166-175` and `docker/nginx-https.conf:177`) has no `client_max_body_size` directive, so nginx inherits its compile-time default of 1 MB.

**How to avoid:** Add `client_max_body_size 6M;` (leaving ~1 MB headroom for multipart framing above the 5 MB byte cap in D-15) to BOTH `docker/nginx.conf:166-175` AND `docker/nginx-https.conf:177`. Model the edit on the `/identities/avatar` block at `docker/nginx.conf:286-296` which already carries `client_max_body_size 8M`.

**Warning signs:** Manual smoke test with a 4 MB PNG upload → 200 OK; then a 5 MB PNG → nginx 413 with a plaintext HTML body (not JSON) before Skynet Express logs any request.

### Pitfall 2: users-row mutation without `forceSave` — write lost across restart

**What goes wrong:** INSERT/UPDATE lands in RAM SQLite. Container restarts before the debounce-save loop flushes. New user row (with its avatar_path) is gone. Meanwhile the file on disk survives — orphan.

**Why it happens:** Skynet's SQLite is `:memory:` per `db/index.ts:22` (`const actualDbPath = ":memory:";`). Only explicit save calls (`saveMemoryDatabaseToFile` or `DatabaseSaveTrigger.forceSave`) push RAM → encrypted disk file.

**How to avoid:** Every users-table mutation on the create/change paths ends with `await DatabaseSaveTrigger.forceSave("phase-85-user-avatar-<create|change>")` — same shape as the Phase 75 mxid handler at `user-admin-routes.ts:349-361`. Wrap in try/catch with a non-fatal warn; the row is durable in RAM and the next debounce flush lands it.

**Warning signs:** After a create, restart the container; log in and query users list — new user row absent OR avatar_path is null when file exists on disk.

### Pitfall 3: File-first, row-first, or wrong order under partial failure

**What goes wrong:** If the file is written but the row-INSERT fails, orphan file. If the row is inserted but the file-write fails, dangling pointer.

**Why it happens:** Two independent resources (filesystem + SQLite) with no distributed transaction.

**How to avoid:** File-then-row ordering with best-effort file rollback on SQL failure. See § File-first vs row-first ordering below for full rationale.

**Warning signs:** Any test that mocks either `fs.writeFile` or the SQL insert to throw and asserts the OTHER resource was cleaned up.

### Pitfall 4: Missing avatar file at serve time — 500 vs 404

**What goes wrong:** Serve endpoint reads pointer from users row, tries `fs.readFile(${DATA_DIR}/user-avatars/${pointer})`, ENOENT throws, unhandled 500.

**Why it happens:** Race with delete, manual disk edit, backup restore of the DB but not the volume — any of these can leave the row pointing at a filename that doesn't exist.

**How to avoid:** Wrap the readFile in try/catch and map ENOENT → 404 with a clean error message. Mirror `identity-avatar-batch.ts:493-503` pattern.

**Warning signs:** DELETE a user's avatar file manually from `${DATA_DIR}/user-avatars/`, then GET the serve endpoint — should be a clean 404, not 500 with stack.

### Pitfall 5: Editing only one nginx config file (recurring codebase bug)

**What goes wrong:** Edit lands in `nginx.conf` (HTTP-inside-Caddy) but not `nginx-https.conf`. Production requests via the HTTPS listener 413 for 5 MB uploads even though dev testing looks fine.

**Why it happens:** Skynet ships two nginx configs — one for HTTP-inside-Caddy and one for direct HTTPS. They must be kept in lockstep. This is called out in CLAUDE.md § Nginx caveat.

**How to avoid:** Every plan task that touches nginx config includes BOTH files in its Files-Changed list. Verification step diffs the two files to assert the target directive is present in both.

**Warning signs:** Diff `docker/nginx.conf` `/users` block against `docker/nginx-https.conf` `/users` block — should differ only in trivial whitespace, never in directives.

### Pitfall 6: Trusting the multer error to reach the router-level error handler when NO error handler is scoped to the create route

**What goes wrong:** POST /users/create currently has no multer error handler (because it's currently JSON). If Phase 85 adds multer but forgets the error handler, LIMIT_FILE_SIZE surfaces as a generic 500 with Express default HTML instead of the clean 413 JSON D-15 promises.

**Why it happens:** Multer errors bubble up asynchronously; without a `router.use((err, req, res, next) => …)` scoped ahead of the general error path, they hit Express's default handler.

**How to avoid:** Add the error handler from `identity-avatar-batch.ts:453-478` (verbatim, adapted path) — see Pattern 2.

**Warning signs:** Manual test uploads a 6 MB image → expects 413 JSON `{error: "file too large (max 5 MB)"}` — getting an HTML "Internal Server Error" instead means the handler is missing or wrongly-scoped.

## Answers to CONTEXT.md's 8 Open Questions

### 1. User-delete pipeline discovery

Every call site that deletes a user row was located via `grep -n "db.delete(users)\|deleteUserAndRelatedData"` — the plan MUST wire an avatar-file `fs.unlink` (ENOENT-tolerant) into each. All 5 sites:

| # | File:line | Context | Wiring recommendation |
|---|-----------|---------|----------------------|
| 1 | `src/backend/database/routes/delete-user-data.ts:91` | The canonical bulk-delete helper called from admin delete-user (site 4) and OIDC-link path (site 5). ONE well-placed unlink here covers those two call sites. | Add `await unlinkAvatarIfExists(userId)` BEFORE the `await db.delete(users).where(eq(users.id, userId))` at line 91. This is the single most-impactful edit. |
| 2 | `src/backend/database/routes/users.ts:198` | Rollback delete inside `POST /users/create` when `authManager.registerUser` throws (encryption setup failed after INSERT). Runs immediately after INSERT before any save. | Also unlink here — but only if the create path wrote the file BEFORE inserting (per § Ordering below). If planner picks file-then-row ordering, this rollback path already handles the file (it was written before INSERT, deleted here). |
| 3 | `src/backend/database/routes/users.ts:1052` | Same rollback shape but in the OIDC callback — `registerOIDCUser` throws. **NOT touched by Phase 85** because OIDC users are created without avatars (D-13 defers backfill; OIDC create path doesn't take avatar bytes — it's the identity-provider that provides identity, no upload UI). Confirm with planner: OIDC path bypasses the D-07 mandatoriness because the whole create flow is different (browser redirect, no upload chance). RECOMMEND explicit no-op with a comment. |
| 4 | `src/backend/database/routes/users.ts:2007` | `DELETE /users/delete-account` — user deletes own account. Does NOT call `deleteUserAndRelatedData`, does a bare `db.delete(users).where(eq(users.id, userId))`. **HAS to be wired directly.** | Add `await unlinkAvatarIfExists(userId)` BEFORE the `db.delete` at line 2007. |
| 5 | `src/backend/database/routes/users.ts:2229` | `DELETE /users/delete-user` — admin deletes another user. Calls `deleteUserAndRelatedData(targetUserId)`. | Automatically covered by site 1's edit. NO separate unlink here — would double-unlink and lose the ENOENT-tolerance handle. |
| — | `src/backend/database/routes/user-oidc-account-routes.ts:178` | Calls `deleteUserAndRelatedData(oidcUserId)` — deleting the merged-away OIDC-only user during link-to-password. | Automatically covered by site 1's edit. NO separate unlink here. |

**Summary:**
- **Edit 1:** `delete-user-data.ts:91` — add unlink BEFORE the delete. Covers admin-delete + OIDC-merge cleanup.
- **Edit 2:** `users.ts:2007` — add unlink BEFORE the delete-account. Self-service delete path.
- **Edit 3:** `users.ts:198` — rollback path unlink (only if planner picks file-then-row ordering on create).
- **Explicit no-op:** OIDC callback at `users.ts:1052` — comment noting OIDC create bypasses avatar upload per D-13.

### 2. Migration mechanism

**Skynet does NOT use `drizzle-kit push`.** Migrations are hand-coded via a bespoke `addColumnIfNotExists` helper at `db/index.ts:668-693`. The Phase 75 mxid precedent is the exact template to follow.

**Exact motion the planner needs (Phase 75 mxid template, applied to Phase 85 avatar_path):**

Step 1 — Add the Drizzle mirror at `src/backend/database/db/schema.ts` immediately after the `mxid` line (line 32) — see § Existing users row conventions for the exact comment block style.

Step 2 — Add the migration line at `src/backend/database/db/index.ts` immediately after line 894 (`addColumnIfNotExists("users", "mxid", "TEXT");`):

```typescript
// Phase 85 — nullable text pointer to the user's on-disk avatar file
// under ${DATA_DIR}/user-avatars/. Nullable at the schema level so
// pre-existing users (who never had an avatar) remain valid; new users
// created via POST /users/create MUST have this populated —
// mandatoriness enforced at the endpoint per D-07, not the schema.
// Idempotent via addColumnIfNotExists (probes SELECT, ALTER on throw).
// The Drizzle mirror lives at schema.ts users.avatarPath.
addColumnIfNotExists("users", "avatar_path", "TEXT");
```

Step 3 — Add a `forceSave` immediately after (or fold into an existing forceSave block if planner prefers), mirroring `db/index.ts:911-922`:

```typescript
try {
  await DatabaseSaveTrigger.forceSave("phase-85-user-avatar-schema");
} catch (saveError) {
  databaseLogger.warn(
    "[phase-85] forceSave failed post-schema (non-fatal — addColumnIfNotExists is idempotent, next boot retries)",
    {
      operation: "schema_migration_force_save_post_add",
      reason: "phase-85-user-avatar-schema",
      error: saveError,
    },
  );
}
```

Step 4 — Add a migration test at `src/backend/database/db/index.migration.test.ts` mirroring the Phase 75 mxid test (`describe("Phase 75-01 migration…" ` at line 523; `it("Test P75-2: users.mxid TEXT column…")` at line 566). The local reproduction helper `addColumnIfNotExistsMxid` at line 466-483 is the exact shape to copy.

**Why NOT to touch `CREATE TABLE IF NOT EXISTS users` at `db/index.ts:150`:** The CREATE TABLE statement is intentionally the "legacy fresh-install shape" — new columns land via `addColumnIfNotExists` on both fresh installs (column absent post-CREATE, added by addColumnIfNotExists) and existing installs (column absent, added same way). Editing the CREATE TABLE breaks the idempotency contract because the ADD runs after the CREATE.

### 3. Existing users row conventions

**Pattern to mirror:** The Phase 75 `mxid` column at `schema.ts:27-32`:

```typescript
// Phase 75 Plan 01 (Q3 locked decision) — mxid mapping for the Matrix
// relay. Nullable: only humans with a registered relay account have one,
// and it's populated via POST /users/:id/mxid (Plan 03) or the one-shot
// import for Ashley/Zoe/Laura. Not a credential; agents' relay identifiers
// live on-disk in ~/.claude/identities/<name>/relay.json per fleet convention.
mxid: text("mxid"),
```

**Convention observed:**
- Column type: `text("snake_case_name")` — the argument is the SQLite column name.
- Nullable: no `.notNull()` chain.
- No default: absent chain (defaults to NULL).
- Comment block: 4-6 lines, describes (1) which phase added it and why, (2) nullability rationale, (3) how it's populated (endpoint reference), (4) where the "other side" of the data lives if applicable.
- Placed at the END of the users table def, not interspersed among older columns.

**Applied to Phase 85 (planner draft — column name is Claude's discretion per D-05):**

```typescript
// Phase 85 (locked decision D-04) — pointer to this user's avatar image
// file on disk under ${DATA_DIR}/user-avatars/. NOT bytes, NOT an
// absolute path, NOT an external URL — just enough to reconstruct the
// file location from the users row (D-05: deterministic + resolvable
// from DATA_DIR alone). Nullable so pre-existing rows (D-13 defers
// backfill) remain valid; mandatoriness on new-row creation is enforced
// at the POST /users/create endpoint per D-07, not the schema.
avatarPath: text("avatar_path"),
```

(Planner may prefer `avatar`, `avatarFilename`, or another name — all fit the convention.)

**On OIDC-fields default-to-empty-string vs null:** The `client_id`, `client_secret`, `issuer_url`, etc. columns at `schema.ts:12-19` do NOT have explicit defaults, but the INSERT statement at `users.ts:144-163` passes `""` (empty string) for them, not `null`. This is legacy — the columns are text-nullable but the code was written to store `""` as a sentinel for "no OIDC config on this user." **DO NOT copy this pattern for the avatar column.** The avatar-path column MUST be genuinely NULL when absent (never `""`) because (a) the serve endpoint distinguishes "no avatar" (404) from "avatar filename is empty string" (500 / bug), and (b) the create-path INSERT will always pass a non-empty string, so there's never a case where empty-string is the right value.

### 4. Multipart handling in an Express router with global JSON parsing

**Verified:** The global body parser is at `src/backend/database/database.ts:251-253`:

```typescript
app.use(bodyParser.json({ limit: "1gb" }));
app.use(bodyParser.urlencoded({ limit: "1gb", extended: true }));
app.use(bodyParser.raw({ limit: "5gb", type: "application/octet-stream" }));
```

**Key insight:** `bodyParser.json()` only parses requests where `Content-Type: application/json`. A `multipart/form-data` request bypasses it entirely because the content-type doesn't match. So the global JSON parser is NOT a blocker — multer runs as expected for multipart requests routed through `app.use("/users", userRoutes)` at `database.ts:1819`.

**Concrete evidence this works:** `identities.ts` uses `router.put("/:identityKey", authenticateJWT, upload.single("avatar"), …)` at line 288-291. That router is mounted at `app.use("/identities", identitiesRoutes)` at `database.ts:1893` — SAME architecture as the users router, and multer works fine there. No special scoping needed.

**However:** The other JSON routes in the users router (login, change-password, oidc-config, etc.) continue to rely on the global JSON parser having already populated `req.body`. That behavior is unchanged.

**Recommendation:** Attach `multer.single("avatar")` per-route (as `identities.ts:291` does), NOT as `router.use(multer.any())`. Per-route is:
- Cleaner (only avatar routes see multer).
- Zero risk of interfering with other users routes.
- Matches the identity-side precedent.

**Do NOT copy the `router.use(express.json())` pattern from `identity-avatar-batch.ts:42`.** That router-scoped JSON parser exists there because the identity-avatar-batch router does NOT go through the global bodyParser (checked: it's mounted at `app.use("/identities/avatar", identityAvatarBatchRoutes)` at `database.ts:1842`, AFTER the global bodyParser, so it inherits it — but the file adds its own defensively). For the users router, the global parser is already in effect for JSON routes, no scoped parser needed.

### 5. File-first vs row-first ordering under partial failure

**Recommendation: file-then-row on create; new-file-then-row-then-old-file-unlink on change.**

**Rationale for CREATE (file-then-row):**
- If the file-write fails (ENOSPC, permission, disk error): abort BEFORE the DB row exists — no cleanup needed.
- If the row-INSERT fails (constraint violation, encryption setup): `fs.unlink` the file we just wrote — reversible, ENOENT-tolerant.
- Alternative (row-then-file) would leave a valid DB row pointing at a missing file if the file-write failed — bad state, requires "delete row on file-write failure" cleanup which is itself failure-prone.

**Rationale for CHANGE (new-file-then-row-then-old-file-unlink):**
- If the new-file-write fails: abort BEFORE any DB or old-file change — nothing corrupted.
- If the row-UPDATE fails after new file written: `fs.unlink` the new file — old row + old file still valid, user's avatar unchanged.
- Only unlink the OLD file AFTER row UPDATE succeeds — otherwise a mid-op crash leaves the user with no avatar at all.

**Precedent in the codebase for this ordering:** `identities.ts:487-513`, the PUT `/:identityKey` handler:
1. Line 487: `writeIdentityFile` (write frontmatter markdown).
2. Line 490-497: `writeAvatarSiblingFile` (write new avatar bytes).
3. Line 498+: best-effort delete of the old avatar sibling (ext-swap cleanup).

Note the identity side writes markdown THEN avatar (opposite direction from the phase-85 SQLite/file case), because for identities the .md file is the "row" (source of truth) and the avatar is the sidecar file. Same principle: source-of-truth first, sidecar after; rollback the sidecar if source-of-truth failed.

**Applied to Phase 85 CREATE:**
```typescript
// (inside POST /users/create, after multer + validation)
const id = nanoid();
const filename = `${id}.${extFromMime(req.file.mimetype)}`;
const filePath = path.join(DATA_DIR, "user-avatars", filename);

// 1. Write file first.
try {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, req.file.buffer);
} catch (writeErr) {
  return res.status(500).json({ error: "avatar write failed" });
}

// 2. INSERT row (existing transaction from line 137).
try {
  const isFirstUser = db.$client.transaction(() => {
    // ... existing count-then-INSERT logic, extended to include avatar_path=?
    return first;
  })();
} catch (sqlErr) {
  // 3a. Rollback file on SQL failure — ENOENT-tolerant.
  await fs.unlink(filePath).catch((e) => { if (e.code !== "ENOENT") throw e; });
  throw sqlErr;
}

// 4. authManager.registerUser — existing (may throw and trigger existing rollback at users.ts:198).
//    Extend that rollback to also unlink the file.

// 5. forceSave.
await DatabaseSaveTrigger.forceSave("phase-85-user-avatar-create");
```

**Applied to Phase 85 CHANGE:**
```typescript
// (inside PUT /users/:id/avatar, after multer + own-or-admin auth)
const oldRow = await db.select({ avatarPath: users.avatarPath }).from(users).where(eq(users.id, targetUserId)).limit(1);
const oldFilename = oldRow[0]?.avatarPath ?? null;

const newFilename = `${targetUserId}.${extFromMime(req.file.mimetype)}`;
const newPath = path.join(DATA_DIR, "user-avatars", newFilename);

// 1. Write new file.
try {
  await fs.mkdir(path.dirname(newPath), { recursive: true });
  await fs.writeFile(newPath, req.file.buffer);
} catch (writeErr) {
  return res.status(500).json({ error: "avatar write failed" });
}

// 2. UPDATE row pointer.
try {
  await db.update(users).set({ avatarPath: newFilename }).where(eq(users.id, targetUserId));
} catch (sqlErr) {
  // 2a. Rollback new file on SQL failure — but only if the new filename
  //     differs from the old (otherwise unlinking would delete the still-in-use file).
  if (newFilename !== oldFilename) {
    await fs.unlink(newPath).catch((e) => { if (e.code !== "ENOENT") throw e; });
  }
  throw sqlErr;
}

// 3. Best-effort unlink the OLD file (skip if same filename — new file overwrote it).
if (oldFilename && oldFilename !== newFilename) {
  await fs.unlink(path.join(DATA_DIR, "user-avatars", oldFilename))
    .catch((e) => { if (e.code !== "ENOENT") throw e; });
}

// 4. forceSave.
await DatabaseSaveTrigger.forceSave("phase-85-user-avatar-change");
```

**Edge case the planner should think through:** If the filename convention includes the mime extension (e.g., `${userId}.png` vs `${userId}.jpg`), a user changing from PNG to JPEG produces a different filename — the old file must be unlinked. If the convention is fixed-extension (e.g., always store as PNG regardless of upload mime), the new file overwrites the old at the same path and no separate unlink is needed. **RECOMMEND** the ext-in-filename convention — matches the identity side (`identities.ts:474`) and preserves the browser's mime hint without an extra column.

### 6. Authorization pattern for change-avatar endpoint

**Verified pattern (mirror `user-session-routes.ts:154`):**

```typescript
router.put("/:id/avatar", authenticateJWT, userAvatarUpload.single("avatar"), async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const targetUserId = req.params.id as string;

  if (!isNonEmptyString(targetUserId)) {
    return res.status(400).json({ error: "user id required in path" });
  }

  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const userRecord = user[0];

    // Own-or-admin: mirror user-session-routes.ts:154.
    if (!userRecord.isAdmin && targetUserId !== userId) {
      return res.status(403).json({ error: "Not authorized to change this user's avatar" });
    }

    // Verify target user exists (so admin can't 500 by targeting a bogus id).
    const targetUser = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
    if (!targetUser || targetUser.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "missing avatar field" });
    }

    // ... proceed with file-then-row change logic ...
  } catch (err) { ... }
});
```

**Note:** For symmetry with existing users routes, the auth-check pattern is:
1. Verify caller (`userId` from JWT) exists in DB.
2. Extract `isAdmin` from caller's row.
3. If NOT admin AND target !== caller → 403.
4. Verify target exists separately (so a legit admin targeting a bogus id gets 404, not 500).

This is exactly what `user-session-routes.ts:124-158` does for `/sessions/:sessionId`. Do not simplify to `if (targetUserId !== userId && !req.user.isAdmin)` shorthand — the pattern reads user role from DB, not from JWT, to catch the case where admin status was revoked mid-session.

### 7. Test infrastructure for multipart routes

**Verified:** `identity-avatar-batch.test.ts:180-254` contains a self-rolled `multipartRequest` helper that emits `multipart/form-data` via Node's `http` module — no external `form-data` npm dep required (that dep is NOT in devDependencies, per the comment at line 181-182).

**Two functions, verbatim:**

```typescript
// identity-avatar-batch.test.ts:184-201
function buildMultipartBody(
  fieldName: string,
  filename: string,
  contentType: string,
  fileBytes: Buffer,
  boundary: string,
): Buffer {
  const parts: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`,
    ),
    fileBytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];
  return Buffer.concat(parts);
}

// identity-avatar-batch.test.ts:203-254
function multipartRequest(
  server: http.Server,
  opts: {
    path: string;
    fieldName: string;
    filename: string;
    fileContentType: string;
    fileBytes: Buffer;
  },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const boundary = "test-boundary-42";
    const body = buildMultipartBody(
      opts.fieldName,
      opts.filename,
      opts.fileContentType,
      opts.fileBytes,
      boundary,
    );

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: "POST",
        path: opts.path,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": String(body.length),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks);
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw.toString());
          } catch {
            parsed = raw.toString();
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
```

**Recommendation for Phase 85 tests:** Copy both helpers into `src/backend/database/routes/user-avatars.test.ts` verbatim. If the planner prefers DRY, extract to `src/backend/utils/test-multipart.ts` — but the identity-side hasn't done that and the copy is 60 lines. Copy is fine.

**Additional Phase 85 test-only concern:** POST /users/create ALSO carries `username` + `password` fields alongside the `avatar` file. `buildMultipartBody` above only handles ONE file field with no accompanying text fields. Extend it (or write a `buildMultipartBodyMixed(fields: Record<string, string>, file: {…})` variant) so a request with `username=foo`, `password=bar`, `avatar=<bytes>` can be built. Shape:

```typescript
function buildMultipartBodyMixed(
  textFields: Record<string, string>,
  file: { fieldName: string; filename: string; contentType: string; bytes: Buffer },
  boundary: string,
): Buffer {
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(textFields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
      value + `\r\n`
    ));
  }
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\n` +
    `Content-Type: ${file.contentType}\r\n\r\n`
  ));
  parts.push(file.bytes);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return Buffer.concat(parts);
}
```

### 8. Content-Type sniffing for the serve endpoint

**Two reference patterns in the codebase:**

**Pattern A: `identity-avatar-batch.ts:511-512` — stored mime alongside the bytes:**
```typescript
res.setHeader("Content-Type", entry.mime);
res.send(entry.bytes);
```
The `entry.mime` field was captured at upload time (`identity-avatar-batch.ts:442`: `mime: req.file.mimetype`) alongside the buffer. Since Phase 85 is disk-backed not memory-cached, there's no natural "entry object" — the mime would have to be stored either as a second DB column OR as the filename extension.

**Pattern B: `identities.ts:631` — mime derived from disk-side readAvatarSiblingFile:**
```typescript
res.setHeader("Content-Type", readResult.mime);
```
The `readAvatarSiblingFile` helper at `identity-artifact-reader.ts` derives mime from the filename extension it found on disk (via `MIME_TO_AVATAR_EXT` reverse-map). The identity-side stores avatars as `${identityKey}.png` / `.jpg` / `.webp` — the extension IS the mime signal.

**Recommendation: Pattern B — encode mime in the filename extension.**

Rationale:
- Zero new DB columns (D-04 says "one small nullable text column" — adding a second mime column bloats scope).
- One less field to keep in sync with the file on disk (change endpoint doesn't have to update a mime column atomically with the file rename).
- Mirrors the identity-side precedent — reader will recognize the pattern immediately.
- Reverse lookup is a 3-entry Record. Trivial:

```typescript
const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
```

**Serve endpoint sketch:**
```typescript
router.get("/:id/avatar", authenticateJWT, async (req, res) => {
  const targetUserId = req.params.id as string;
  const row = await db.select({ avatarPath: users.avatarPath }).from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!row.length || !row[0].avatarPath) {
    return res.status(404).json({ error: "no avatar for this user" });
  }
  const filename = row[0].avatarPath;
  const ext = path.extname(filename).slice(1).toLowerCase();
  const mime = EXT_TO_MIME[ext];
  if (!mime) {
    return res.status(500).json({ error: "avatar file has unrecognized extension" });
  }
  const filePath = path.join(DATA_DIR, "user-avatars", filename);
  try {
    const bytes = await fs.readFile(filePath);
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", String(bytes.byteLength));
    // Optional ETag (planner's discretion — mirrors identities.ts:626-629):
    // const etag = `"${createHash("md5").update(bytes).digest("hex")}"`;
    // if (req.headers["if-none-match"] === etag) return res.status(304).end();
    // res.setHeader("ETag", etag);
    res.send(bytes);
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return res.status(404).json({ error: "no avatar file on disk" });
    }
    return res.status(500).json({ error: "avatar read failed" });
  }
});
```

**Alternative Pattern A (mime column in DB):** If the planner picks a filename convention that does NOT encode extension (e.g., `${userId}` alone, or `${sha}` alone), then a second `avatar_mime` column becomes necessary. This CONTRADICTS D-04 ("one small nullable text column"). Recommend against.

## Code Examples

Verified patterns from the current tree:

### Multer error → HTTP status handler (from `identity-avatar-batch.ts:453-478`)

```typescript
router.use(
  "/:id/avatar",  // adjust to Phase 85 scoping — scoped to the write routes
  (
    err: Error & { code?: string },
    _req: Request,
    res: Response,
    _next: NextFunction,
  ): void => {
    if (err?.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "file too large (max 5 MB)" });
      return;
    }
    if (err?.code === "LIMIT_UNEXPECTED_FILE") {
      res.status(400).json({ error: "missing avatar field" });
      return;
    }
    if (err instanceof Error && err.message.includes("Avatar must be PNG, JPEG, or WebP")) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: "upload failed" });
  },
);
```

### DatabaseSaveTrigger pairing (from `user-admin-routes.ts:349-361`, adapted)

```typescript
try {
  await DatabaseSaveTrigger.forceSave("phase-85-user-avatar-<create|change>");
} catch (saveError) {
  authLogger.error(
    "Failed to persist user avatar change to disk",
    saveError,
    {
      operation: "user_avatar_save_failed",
      userId: targetUserId,
    },
  );
}
```

### addColumnIfNotExists migration line (from `db/index.ts:894`, adapted)

```typescript
addColumnIfNotExists("users", "avatar_path", "TEXT");
```

### ENOENT-tolerant unlink helper (new — Phase 85)

```typescript
async function unlinkAvatarIfExists(filenameOrNull: string | null): Promise<void> {
  if (!filenameOrNull) return;
  const filePath = path.join(DATA_DIR, "user-avatars", filenameOrNull);
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // ENOENT is fine — file already gone, that's the desired state
  }
}
```

## State of the Art

**Not applicable — this is not a technology-choice phase.** Every ingredient exists in the codebase and every choice is locked by CONTEXT.md D-01 through D-23. No industry-comparison or "best-practice as of 2026" question is open.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The OIDC user-create rollback at `users.ts:1052` does NOT need avatar unlink because OIDC users are created without avatars (Phase 85 does not extend the OIDC create path with a mandatoriness gate). | § User-delete pipeline discovery, site 3 | If planner decides OIDC users should also carry mandatory avatars, this call site must also unlink on rollback. Recommend planner confirm scope: is the D-07 mandatoriness gate ONLY on `POST /users/create` (JSON→multipart migration) or also on the OIDC callback create branch? CONTEXT.md D-07 says "POST /users/create refuses…" — literally that one endpoint. So the assumption stands, but flag it. |
| A2 | The filename convention should encode the mime extension (`${userId}.png` / `.jpg` / `.webp`), matching the identity-side precedent. This informs both the Content-Type serve pattern AND whether change-endpoint needs to unlink an old file when the mime changes. | § Content-Type sniffing + § File-first vs row-first ordering | If planner picks a different convention (e.g., always `.bin` extension with mime stored in a second column), the serve endpoint and change endpoint sketches need rework. But this contradicts D-04 ("one small nullable text column"). Assumption is safe unless CONTEXT.md is re-read as allowing two columns. |
| A3 | The 6M `client_max_body_size` value is right (5 MB byte cap + ~1 MB multipart framing headroom). Reference for the sizing: `/identities/avatar` uses `8M` for a 2 MB cap (`identities.ts:40` — `2 * 1024 * 1024`), so it has ~6 MB headroom — very generous. Phase 85's 5 MB + 1 MB headroom is tighter but industry-standard (multipart framing overhead is typically <5% of payload). | § Nginx routing, D-20 | If 6M turns out to be too tight in production (rare, but real files carry EXIF and generous boundary text), planner can bump to 7M or 8M. Zero blast-radius risk — extra headroom is free. Recommend 6M as-written; monitor first-week 413 rate. |
| A4 | The bespoke Skynet `DatabaseMigration` class at `src/backend/utils/database-migration.ts` handles ONLY the legacy JSON→SQLite one-time migration (not column-add operations). Column additions go through `addColumnIfNotExists` in `db/index.ts` during boot, NOT through the migration class. | § Migration mechanism | Verified by grep pattern — `DatabaseMigration` is instantiated only for `migration.checkMigrationStatus()` and `migration.migrateDatabase()` at `db/index.ts:47-51`, both invoked on first boot. Column mgmt goes through the standalone `addColumnIfNotExists` helper. Assumption HIGH-confidence. |
| A5 | `saveMemoryDatabaseToFile()` and `DatabaseSaveTrigger.forceSave("<reason>")` are interchangeable per CONTEXT.md D-17. Verified via reading — both call the same underlying save path (`db/index.ts:1814-1841`), the forceSave variant just adds a labeled reason. | § DatabaseSaveTrigger pattern | If they differ in some edge case (e.g., queuing vs bypass), the forceSave version is preferred anyway. Low risk. |

## Open Questions (RESOLVED)

1. **Should the OIDC user-create branch (`users.ts:981-1008`) ALSO carry a mandatory-avatar gate?**
   - What we know: CONTEXT.md D-07/D-09 explicitly names `POST /users/create` — one endpoint. OIDC create is a separate branch inside `/users/oidc/callback` (line 663). The user redirect flow doesn't offer an upload chance.
   - What's unclear: Whether "mandatoriness" is intended to be a property of "a Skynet user row" (all creation paths) or "the JSON-registration create endpoint" (one path).
   - Recommendation: Treat OIDC create as OUT of Phase 85's mandatoriness scope (matches literal reading of D-09). Add an explicit code comment at the OIDC create site noting "OIDC users created without avatar per Phase 85 scope; downstream mechanism populates via D-10". If Ashley wants OIDC users to also have mandatory avatars, that becomes a Phase 85.1 scope-add — the D-10 change endpoint can be invoked from a first-login flow later.

2. **Should the serve endpoint be publicly accessible (any authenticated user can request any user's avatar) or scoped (only the user themselves + admins)?**
   - What we know: CONTEXT.md D-11 says "Frontend calls it by user id and receives raw image bytes" — implies visible-to-others. The identity-avatar serve at `identities.ts:565-648` uses only `authenticateJWT` (no per-user scoping) — any authenticated user can fetch any identity's avatar. That precedent strongly implies "any authenticated user".
   - What's unclear: Whether user avatars should have stricter privacy than identity avatars.
   - Recommendation: Match the identity-avatar precedent — `authenticateJWT` only, no per-user scoping. Rationale: (1) the whole point of avatars is public-within-deployment recognizability; (2) user usernames are already visible in the picker (`user-admin-routes.ts:118`); an avatar tied to a public username is less sensitive than the username itself. If Ashley wants stricter, add an admin-only gate — but that would break the downstream "show avatars in tab list" use case that this plumbing is intended to enable.

3. **Are the 5 delete call sites the ACTUAL exhaustive set, or are there other delete paths this grep missed?**
   - What we know: `grep -rn "delete.*users.*id\|deleteUser"` returned all 5 sites listed. I re-ran with variants (`db.delete(users)`, `deleteUserAndRelatedData`).
   - What's unclear: Whether any code path deletes via raw SQL (`db.$client.prepare("DELETE FROM users…")`) that wouldn't match the grep. `grep -rn "DELETE FROM users" /home/ubuntu/skynet-tina/src/backend --include="*.ts"` was run and returned no matches — the codebase consistently uses Drizzle for user deletes.
   - Recommendation: Trust the grep. If a raw-SQL delete is added in the future, it MUST also carry the unlink — but that's a general invariant, not a Phase 85 gap. Consider adding a comment above the `users` schema def naming Phase 85 and noting "any code that deletes a users row MUST call unlinkAvatarIfExists first" so future editors see it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js `fs/promises` | avatar write/read/unlink | ✓ | built-in | — |
| Node.js `path` | filename composition | ✓ | built-in | — |
| Node.js `crypto` (createHash) | optional ETag | ✓ | built-in | — |
| `multer` npm package | multipart parsing | ✓ | already installed (see `identity-avatar-batch.ts:31` import) | — |
| `nanoid` npm package | id generation | ✓ | already installed (`users.ts:7`) | — |
| Nginx docker image | edge routing | ✓ | already in `docker-compose.yml` | — |
| `DATA_DIR` env var | resolve avatar storage dir | ✓ | set to `/app/data` in production docker-compose; `./db/data` fallback (`db/index.ts:12`) | — |
| `skynet-data` docker volume mounted at `/app/data` | persistent storage | ✓ | in production compose file | — |
| Filesystem write access to `${DATA_DIR}/user-avatars/` | write avatars | ✓ | container writes to the same dir already (encrypted SQLite lives there) | — |

**All dependencies present.** No missing runtimes, no fallbacks required.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (verified via `import { describe, it, expect, ... } from "vitest"` at `identity-avatar-batch.test.ts:42`) |
| Config file | `vitest.config.ts` (project root — verified via `ls`) |
| Quick run command | `npx vitest run src/backend/database/routes/user-avatars.test.ts` (once written) |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-04 | New `avatar_path` column added exactly once, idempotent across boots, queryable | unit | `npx vitest run src/backend/database/db/index.migration.test.ts -t "Phase 85"` | ❌ Wave 0 — add Phase 85 test to existing migration.test.ts mirroring the Phase 75-2 mxid test at line 566 |
| D-07/D-09 | `POST /users/create` refuses (400) when `avatar` file part is missing | unit (multipart) | `npx vitest run src/backend/database/routes/users.test.ts -t "create refuses missing avatar"` | ❌ Wave 0 — new test file |
| D-07 | `POST /users/create` succeeds (200) with a valid multipart body including avatar; row + file both present | unit (multipart) | same file, different test | ❌ Wave 0 |
| D-10 | `PUT /users/:id/avatar` — own user succeeds | unit (multipart, mocked JWT) | same file | ❌ Wave 0 |
| D-10 | `PUT /users/:id/avatar` — admin can change any user | unit | same file | ❌ Wave 0 |
| D-10 | `PUT /users/:id/avatar` — non-admin user changing OTHER user → 403 | unit | same file | ❌ Wave 0 |
| D-11 | `GET /users/:id/avatar` returns correct Content-Type + bytes | unit | same file | ❌ Wave 0 |
| D-11 | `GET /users/:id/avatar` for user with null pointer → 404 | unit | same file | ❌ Wave 0 |
| D-11 | `GET /users/:id/avatar` for user with pointer but missing file → 404 (not 500) | unit | same file | ❌ Wave 0 |
| D-14/D-15/D-16 | Multer fileFilter rejects `image/gif` → 400 with clean error | unit | same file | ❌ Wave 0 |
| D-14/D-15/D-16 | Multer limits reject 6 MB upload → 413 | unit | same file | ❌ Wave 0 |
| D-17/D-18 | Every mutation path (create + change) calls `DatabaseSaveTrigger.forceSave` — verified via spy | unit | same file | ❌ Wave 0 |
| D-20/D-21 | `client_max_body_size 6M;` present in BOTH nginx configs' `/users` location block | manual (grep) OR unit | `grep -A5 "location.*\\^/users" docker/nginx*.conf \| grep client_max_body_size` | manual smoke check, no test file needed |
| D-22 | `DELETE /users/delete-account` unlinks avatar file (best-effort ENOENT-tolerant) | unit | same file | ❌ Wave 0 |
| D-22 | `DELETE /users/delete-user` (admin) unlinks avatar file via `deleteUserAndRelatedData` | unit | same file | ❌ Wave 0 |
| D-22 | `deleteUserAndRelatedData` unlinks avatar file (tolerant of missing file) | unit | `src/backend/database/routes/delete-user-data.test.ts` | ❌ Wave 0 if file doesn't exist; extend it if it does |

### Sampling Rate
- **Per task commit:** `npx vitest run src/backend/database/routes/user-avatars.test.ts` (once written) — completes in <10s
- **Per wave merge:** `npx vitest run src/backend/database/routes/` (all routes tests) plus migration test
- **Phase gate:** `npx vitest run` (full suite green) + manual smoke test with a real 3 MB PNG upload against a dev container

### Wave 0 Gaps
- [ ] `src/backend/database/routes/user-avatars.test.ts` — new test file, covers create + change + serve + delete + validation. Mirror structure of `identity-avatar-batch.test.ts`.
- [ ] Extend `src/backend/database/db/index.migration.test.ts` with a Phase 85 mxid-style test (mirror lines 523-593).
- [ ] Optional: `src/backend/database/routes/delete-user-data.test.ts` for the D-22 unlink assertion — if this test file doesn't exist yet, may extend the existing `user-admin-routes.test.ts` or add fresh.
- [ ] Multipart helper: copy `buildMultipartBody` + `multipartRequest` from `identity-avatar-batch.test.ts:184-254` verbatim; add `buildMultipartBodyMixed` variant for the create endpoint (which carries text fields alongside the file).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing `authManager.createAuthMiddleware()` at `users.ts:48` for the change + serve endpoints; create endpoint uses `allow_registration` gate + username uniqueness (no auth pre-account) |
| V3 Session Management | no | Existing JWT session handling untouched |
| V4 Access Control | yes | Own-or-admin guard on change endpoint (mirror `user-session-routes.ts:154`) |
| V5 Input Validation | yes | Multer fileFilter (mime whitelist) + fileSize limit; nanoid or userId-based filename convention avoids path traversal by construction |
| V6 Cryptography | no | No new secrets. Existing AES-encrypted SQLite volume + Skynet's LUKS/EBS-KMS at rest covers avatar files transparently |
| V12 File Handling | yes | Filename convention MUST prevent path traversal (never accept user-supplied filename as-is); mime whitelist prevents SVG/HTML upload; size cap prevents disk-fill DoS |

### Known Threat Patterns for `express + multer + fs/promises + SQLite`

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via user-supplied filename (e.g., `../../etc/passwd.png` as multipart filename) | Tampering | NEVER use `req.file.originalname` in the on-disk filename. Compose the filename entirely from server-controlled inputs: `${userId}.${extFromMime(req.file.mimetype)}` where `mimeToExt` is a curated whitelist. `req.file.originalname` may be logged for audit but never touch the filesystem. |
| SVG-with-embedded-script uploaded as `image/png` (browsers ignore Content-Type on cached files → treat as SVG when served) | Tampering / XSS via serve endpoint | fileFilter whitelist strictly `png/jpeg/webp` — SVG is not on the list. Additionally, serve endpoint sets `Content-Type` from the FILENAME EXTENSION (not from a stored mime), so a mislabeled file can't serve as SVG. |
| Zip bomb / decompression bomb uploaded as `image/png` | DoS (memory) | multer `memoryStorage` + 5 MB `fileSize` limit caps input at wire time. NOT decompressing (sharp/image transforms deferred per shape file) means no decompression bomb path. |
| Overwriting another user's avatar file via crafted filename | Tampering / Elevation | Filename derived from `userId` (or `targetUserId` after own-or-admin check); can only affect the target user's file, which is already what the change endpoint intends. |
| Disk-fill DoS by repeatedly uploading avatars via change endpoint | DoS | 5 MB × total-users cap is small (100 users × 5 MB = 500 MB). Change endpoint unlinks the old file, so per-user footprint stays bounded. |
| Missing rate limit on serve endpoint → traffic amplification | DoS | Not addressed this phase — mirror identity-avatar serve which also has no rate limit. If avatar-fetching turns into a hot loop from a downstream misbehaving frontend, revisit in a follow-up. |
| Race between concurrent PUT /users/:id/avatar requests → torn file / stale pointer | Tampering | Single-user path is the only realistic concurrency (user double-clicks upload button). The file-then-row-then-old-unlink ordering leaves the system in a consistent state under any interleaving — worst case, the "older" file wins if writeFile completes second, but pointer remains valid. Acceptable for baseline. |
| Serve endpoint leaks avatar of user with mid-flight-deleted row | Info disclosure | Serve endpoint reads pointer from users row inside the request; if row is gone by then, `WHERE id = ?` returns empty → 404. If row still exists but user was just deleted, next request will 404. No stale bytes leaked from the process. |

## Sources

### Primary (HIGH confidence — direct file:line reads of the current tree)

- `src/backend/database/db/schema.ts:4-33` — users table definition; Phase 75 mxid pattern at line 27-32
- `src/backend/database/db/index.ts:12` — DATA_DIR resolution
- `src/backend/database/db/index.ts:150-168` — CREATE TABLE users legacy shape
- `src/backend/database/db/index.ts:668-693` — `addColumnIfNotExists` helper definition
- `src/backend/database/db/index.ts:889-922` — Phase 75 mxid migration + forceSave precedent (verbatim template)
- `src/backend/database/db/index.ts:1814-1841` — `saveMemoryDatabaseToFile` internals
- `src/backend/database/db/index.migration.test.ts:452-593` — Phase 75 migration test structure
- `src/backend/database/database.ts:251-253` — global body parser (JSON only — multipart bypasses)
- `src/backend/database/database.ts:1819` — `app.use("/users", userRoutes)` mount point
- `src/backend/database/database.ts:1842, 1893` — identity mount points (parallel architecture)
- `src/backend/database/routes/users.ts:82-237` — current POST /users/create handler (to be extended)
- `src/backend/database/routes/users.ts:198` — rollback delete site 2
- `src/backend/database/routes/users.ts:1052` — OIDC rollback delete site 3 (excluded from Phase 85)
- `src/backend/database/routes/users.ts:2007` — DELETE /users/delete-account site 4
- `src/backend/database/routes/users.ts:2229` — DELETE /users/delete-user site 5 (covered by helper edit)
- `src/backend/database/routes/delete-user-data.ts:32-104` — canonical delete pipeline; edit target line 91
- `src/backend/database/routes/user-oidc-account-routes.ts:178` — indirect caller of deleteUserAndRelatedData
- `src/backend/database/routes/user-session-routes.ts:124-177` — own-or-admin auth pattern (line 154 canonical guard)
- `src/backend/database/routes/user-admin-routes.ts:296-381` — Phase 75 mxid endpoint pattern (auth + forceSave + audit log)
- `src/backend/database/routes/user-admin-routes.ts:349-361` — saveMemoryDatabaseToFile pairing pattern
- `src/backend/database/routes/host-autostart-routes.ts:173-181` — `DatabaseSaveTrigger.triggerSave()` reference pattern
- `src/backend/database/routes/identity-avatar-batch.ts:406-422` — multer + memoryStorage + fileFilter + limits (VERBATIM COPY target)
- `src/backend/database/routes/identity-avatar-batch.ts:424-447` — multer.single("avatar") route wiring
- `src/backend/database/routes/identity-avatar-batch.ts:453-478` — multer error handler (VERBATIM COPY target)
- `src/backend/database/routes/identity-avatar-batch.ts:484-514` — serve-cached-bytes pattern (mime from stored entry)
- `src/backend/database/routes/identity-avatar-batch.test.ts:180-254` — `multipartRequest` test helper
- `src/backend/database/routes/identities.ts:38-45` — identity-side multer config (2 MB cap; useful sizing comparison)
- `src/backend/database/routes/identities.ts:288-513` — PUT /:identityKey with file-then-row-then-old-unlink ordering (§ File-first vs row-first precedent)
- `src/backend/database/routes/identities.ts:564-648` — GET /:identityKey/avatar serve-from-disk pattern (mime from disk-read, ETag, 502/404 mapping)
- `docker/nginx.conf:166-175` — existing /users location block (MUST edit)
- `docker/nginx.conf:286-296` — /identities/avatar block with `client_max_body_size 8M;` (sizing precedent)
- `docker/nginx-https.conf:177` — sister /users block (MUST also edit)

### Secondary (MEDIUM confidence — CLAUDE.md documented invariants)

- `CLAUDE.md § Constraints` — in-memory SQLite invariant, nginx-config duplication caveat

### Tertiary (LOW confidence — not applicable)

- None — every claim in this document has a direct file:line source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed and used elsewhere in the codebase
- Architecture: HIGH — all patterns exist as file:line references to mirror
- Pitfalls: HIGH — all 6 pitfalls have direct in-tree evidence (nginx configs read, delete sites grepped, save-trigger pattern verified across 4+ callers)
- User-delete pipeline discovery: HIGH — exhaustive grep completed with alternative patterns tested
- Migration mechanism: HIGH — Phase 75 template read verbatim, currently-shipped and green
- Ordering under partial failure: MEDIUM-HIGH — recommendation derived from principled reasoning + one in-tree precedent (`identities.ts:487-513`); precedent is slightly different (markdown+avatar vs SQL+file) but same principle
- Content-Type sniffing: HIGH — two in-tree patterns compared, recommendation cites both

**Research date:** 2026-09-07
**Valid until:** 2026-10-07 (30 days — codebase is actively evolving but the specific files this research reads are stable Phase 66+/75 shipped code)
