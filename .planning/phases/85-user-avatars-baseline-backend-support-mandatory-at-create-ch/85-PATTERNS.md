# Phase 85: User avatars — baseline backend support — Pattern Map

**Mapped:** 2026-09-07
**Files analyzed:** 11 (7 modify, 4 create incl. sibling test files)
**Analogs found:** 11 / 11 — every ingredient exists in-tree

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/backend/database/db/schema.ts` (MODIFY) | schema (Drizzle) | schema decl | `schema.ts:27-32` (Phase 75 `mxid` column) | exact — same file, same table, same one-nullable-text-column pattern |
| `src/backend/database/db/index.ts` (MODIFY) | migration | boot-time DDL | `db/index.ts:889-922` (Phase 75 `mxid` block: `addColumnIfNotExists` + `forceSave`) | exact — same helper, same forceSave-with-labeled-reason shape |
| `src/backend/database/db/index.migration.test.ts` (MODIFY) | test (unit) | migration verification | `index.migration.test.ts:466-591` (Phase 75-2 mxid test w/ local `addColumnIfNotExistsMxid` reproduction + `USERS_CREATE_SQL_PRE_MXID` fixture) | exact — copy the test shape, swap `mxid` → `avatar_path` |
| `src/backend/database/routes/users.ts` — extend `POST /users/create` (MODIFY) | controller (Express route) | request-response, multipart-in | `identity-avatar-batch.ts:424-447` (multer.single + req.file guard) + `users.ts:82-237` (existing handler w/ transaction + saveMemoryDatabaseToFile) | exact — multer wiring pattern; graft onto existing handler |
| `src/backend/database/routes/users.ts` — new `PUT /users/:id/avatar` (MODIFY) | controller (Express route) | request-response, multipart-in | `user-session-routes.ts:124-177` (own-or-admin guard) + `identities.ts:288-513` (file-then-row-then-old-unlink ordering) + `identity-avatar-batch.ts:424-447` (multer wiring) | exact — three canonical patterns cleanly compose |
| `src/backend/database/routes/users.ts` — new `GET /users/:id/avatar` (MODIFY) | controller (Express route) | request-response, file-I/O out | `identities.ts:564-648` (readAvatarSiblingFile → Content-Type + ETag + 404 mapping) | exact — mime-from-ext pattern via `AVATAR_MIME_FROM_EXT` |
| `src/backend/database/routes/users.test.ts` (CREATE) | test (unit) | multipart + JWT harness | `identity-avatar-batch.test.ts:180-254` (`buildMultipartBody` + `multipartRequest`) | exact — copy verbatim, extend `buildMultipartBody` with mixed-field variant for username+password+avatar |
| `src/backend/database/routes/delete-user-data.ts` (MODIFY) | service (helper) | side-effect (row + file delete) | `delete-user-data.ts:32-104` (self-analog — extending the existing helper) | exact — insert unlink call BEFORE `db.delete(users)` at line 91 |
| `src/backend/database/routes/delete-user-data.test.ts` (CREATE) | test (unit) | unlink verification | *no direct analog — no existing test file for delete-user-data* | new — test creates a fake avatar file, calls helper, asserts file absent |
| `src/backend/database/routes/user-avatar-storage.ts` (CREATE) | service (internal helper) | file-I/O + validation | `identity-avatar-batch.ts:406-478` (mime whitelist + multer config + error handler) + `identities.ts:38-45` (multer scoping) | role-match — same byte-work responsibilities, wrapped in a named module |
| `src/backend/database/routes/user-avatar-storage.test.ts` (CREATE) | test (unit) | helper unit tests | `identity-avatar-batch.test.ts` (patterns for fake avatar bytes fixtures) | role-match — unit-test the helper functions in isolation |
| `docker/nginx.conf` (MODIFY) | config (edge) | request routing | `docker/nginx.conf:286-296` (`/identities/avatar` block w/ `client_max_body_size 8M;`) | exact — same directive at the same nesting depth; target the existing `/users` block at line 166-175 |
| `docker/nginx-https.conf` (MODIFY) | config (edge) | request routing | `docker/nginx.conf:286-296` (same block, sister file) | exact — same edit applied to sister file's `/users` block at line 177-186 |

---

## Pattern Assignments

### `src/backend/database/db/schema.ts` — add `avatarPath` column

**Analog:** `src/backend/database/db/schema.ts:27-32` (Phase 75 mxid column, self-analog inside the same file)

**Column-add pattern** (lines 27-32, VERBATIM shape):
```typescript
  // Phase 75 Plan 01 (Q3 locked decision) — mxid mapping for the Matrix
  // relay. Nullable: only humans with a registered relay account have one,
  // and it's populated via POST /users/:id/mxid (Plan 03) or the one-shot
  // import for Ashley/Zoe/Laura. Not a credential; agents' relay identifiers
  // live on-disk in ~/.claude/identities/<name>/relay.json per fleet convention.
  mxid: text("mxid"),
```

**Conventions to mirror:**
- Placed at the END of the `users` table def (immediately after `mxid` at line 32, INSIDE the closing `});`).
- Column type: `text("snake_case_column_name")` — Drizzle field name camelCase, arg is on-disk snake_case.
- Nullable — no `.notNull()` chain, no default. Genuinely NULL (per RESEARCH.md § 3, do NOT copy the OIDC empty-string sentinel pattern from lines 12-19).
- Comment block: 4-6 lines describing (1) which phase + locked decision added it, (2) nullability rationale referencing D-13 backfill defer, (3) how it's populated (endpoint refs D-07/D-09/D-10), (4) where the "other side" (the file bytes) lives.

**Draft (planner may swap `avatarPath` → `avatar`, `avatarFilename`, etc. per D-05):**
```typescript
  // Phase 85 (locked decision D-04) — pointer to this user's avatar image
  // file on disk under ${DATA_DIR}/user-avatars/. NOT bytes, NOT an absolute
  // path, NOT an external URL — just the filename (userId + ext) so the row
  // is enough to reconstruct the file location given DATA_DIR (D-05).
  // Nullable: pre-existing users keep null until a downstream mechanism
  // populates via PUT /users/:id/avatar (D-13 defers backfill). Mandatoriness
  // on new-user create is enforced at POST /users/create per D-07.
  avatarPath: text("avatar_path"),
```

---

### `src/backend/database/db/index.ts` — add `addColumnIfNotExists` + `forceSave`

**Analog:** `src/backend/database/db/index.ts:889-922` (Phase 75 mxid migration block)

**Migration pattern** (lines 889-922, VERBATIM shape):
```typescript
  // Phase 75 Plan 01 (Q3 locked decision) — mxid column for the Matrix
  // relay mapping. Nullable: populated via POST /users/:id/mxid (Plan 03)
  // for humans; agents' mxids live on-disk in relay.json per fleet
  // convention. Idempotent via addColumnIfNotExists (probes SELECT, ALTER
  // on throw). The Drizzle mirror lives at schema.ts users.mxid.
  addColumnIfNotExists("users", "mxid", "TEXT");

  // Phase 75 Plan 01 — persist the new matrix_admin_creds table + users.mxid
  // column to the encrypted SQLite file. [...]
  try {
    await DatabaseSaveTrigger.forceSave("phase-75-matrix-admin-schema");
  } catch (saveError) {
    databaseLogger.warn(
      "[phase-75] forceSave failed post-schema (non-fatal — CREATE IF NOT EXISTS + addColumnIfNotExists are idempotent, next boot retries)",
      {
        operation: "schema_migration_force_save_post_add",
        reason: "phase-75-matrix-admin-schema",
        error: saveError,
      },
    );
  }
```

**Helper definition** (`db/index.ts:668-693`, already in place — no need to add):
```typescript
const addColumnIfNotExists = (
  table: string,
  column: string,
  definition: string,
) => {
  try {
    sqlite
      .prepare(`SELECT "${column}" FROM ${table} LIMIT 1`)
      .get();
  } catch {
    try {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN "${column}" ${definition};`);
    } catch (alterError) { ... }
  }
};
```

**Placement:** Add the new `addColumnIfNotExists("users", "avatar_path", "TEXT");` line RIGHT AFTER line 894 (the mxid line), and fold into the same forceSave block by extending the labeled reason (e.g., `"phase-85-user-avatar-schema"`) or adding a separate forceSave block.

**Do NOT edit the `CREATE TABLE IF NOT EXISTS users` at `db/index.ts:150-168`.** New columns land via `addColumnIfNotExists` only — RESEARCH.md § 2 explains why.

---

### `src/backend/database/db/index.migration.test.ts` — Phase 85 migration test

**Analog:** `src/backend/database/db/index.migration.test.ts:466-591` (Phase 75-2 mxid test)

**Local `addColumnIfNotExists` reproduction** (lines 466-481, VERBATIM):
```typescript
function addColumnIfNotExistsMxid(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  try {
    db.prepare(`SELECT "${column}" FROM ${table} LIMIT 1`).get();
  } catch {
    db.exec(`ALTER TABLE ${table} ADD COLUMN "${column}" ${definition};`);
  }
}
```

**Users CREATE TABLE fixture (pre-mxid)** — at line 486-506 (add a new `USERS_CREATE_SQL_PRE_AVATAR` variant that INCLUDES `mxid TEXT` in the def since Phase 75 has already shipped by Phase 85).

**Test shape** (lines 566-591, VERBATIM):
```typescript
it("Test P75-2: users.mxid TEXT column added exactly once across two boots and is queryable without throwing", () => {
  const db = new Database(":memory:");
  db.exec(USERS_CREATE_SQL_PRE_MXID);

  // Sanity: mxid absent pre-migration.
  const preCols = columnNames(db, "users");
  expect(preCols).not.toContain("mxid");

  // Boot 1 — add the column.
  addColumnIfNotExistsMxid(db, "users", "mxid", "TEXT");
  const postBoot1Cols = columnNames(db, "users");
  expect(postBoot1Cols).toContain("mxid");

  // Boot 2 — re-run; addColumnIfNotExists is idempotent, no throw.
  expect(() =>
    addColumnIfNotExistsMxid(db, "users", "mxid", "TEXT"),
  ).not.toThrow();

  // Exactly one mxid column post-boot-2 (no duplicate).
  const postBoot2Cols = columnNames(db, "users");
  const mxidMatches = postBoot2Cols.filter((c) => c === "mxid");
  expect(mxidMatches.length).toBe(1);

  // Column is queryable — `SELECT mxid FROM users LIMIT 1` does not throw.
  expect(() => db.prepare("SELECT mxid FROM users LIMIT 1").get()).not.toThrow();
});
```

**Copy-mirror to Phase 85:** Add a new `describe("Phase 85-01 migration — users.avatar_path column", () => { ... })` block using the same local helper and swapping `mxid` → `avatar_path`.

---

### `src/backend/database/routes/user-avatar-storage.ts` (CREATE) — the shared byte-work helper

**Analog:** `identity-avatar-batch.ts:406-478` (multer + validation + error handler) + `identities.ts:38-45` (multer scoping style)

**Multer config VERBATIM** (`identity-avatar-batch.ts:406-422`):
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

**Multer error handler VERBATIM** (`identity-avatar-batch.ts:453-478`):
```typescript
router.use(
  "/candidate/manual",  // scope to the write routes in Phase 85
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

**MIME ↔ ext maps to reuse** (`identity-artifact-reader.ts:1798-1804` + `identity-artifact-reader.ts:2070-2076`):
```typescript
export const MIME_TO_AVATAR_EXT: Record<string, AvatarExt> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

export const AVATAR_MIME_FROM_EXT: Record<AvatarExt, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
};
```

**Planner note:** The Phase 85 mime whitelist is a STRICT SUBSET (png/jpeg/webp — no gif, no svg). Either:
- (a) Reuse `MIME_TO_AVATAR_EXT` directly and filter through `ALLOWED_USER_AVATAR_MIMES` before lookup (safer — never emit gif/svg accidentally), OR
- (b) Define local `USER_AVATAR_MIME_TO_EXT` covering only the 3 mimes.

Recommend (b) — local map keeps the whitelist and the ext-derivation in ONE grep-able place, no cross-file coupling to the identity system.

**ENOENT-tolerant unlink pattern** (new, from `identities.ts:508-510`):
```typescript
await fs.unlink(oldPath).catch(() => {
  /* best-effort */
});
```

For Phase 85's stricter shape (RESEARCH.md § 1):
```typescript
async function unlinkAvatarIfExists(filenameOrNull: string | null): Promise<void> {
  if (!filenameOrNull) return;
  const filePath = path.join(DATA_DIR, "user-avatars", filenameOrNull);
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
```

**Imports pattern** (from `identities.ts:1-26`):
```typescript
import multer from "multer";
import { createHash } from "crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
```

**DATA_DIR resolution** (`db/index.ts:12`):
```typescript
const dataDir = process.env.DATA_DIR || "./db/data";
```
Helper module should import or replicate this pattern:
```typescript
const DATA_DIR = process.env.DATA_DIR || "./db/data";
const USER_AVATARS_DIR = path.join(DATA_DIR, "user-avatars");
```

**Recommended helper module exports:**
- `userAvatarUpload` — the scoped multer instance (memoryStorage + 5MB + png/jpeg/webp filter).
- `userAvatarMulterErrorHandler(err, req, res, next)` — the express error handler (copy of `identity-avatar-batch.ts:453-478`).
- `writeUserAvatar(userId: string, mime: string, bytes: Buffer): Promise<string>` — mkdir + writeFile; returns the filename (e.g., `${userId}.png`).
- `unlinkUserAvatar(filenameOrNull: string | null): Promise<void>` — ENOENT-tolerant.
- `readUserAvatar(filename: string): Promise<{ bytes: Buffer; mime: string }>` — readFile + derive mime from extension via local map; throws with `.code === "ENOENT"` propagated for the serve endpoint to map to 404.
- `USER_AVATARS_DIR` constant for use in tests.

---

### `src/backend/database/routes/users.ts` — extend `POST /users/create`

**Analogs:**
- `users.ts:82-237` (existing handler — self-analog to extend, don't rewrite)
- `identity-avatar-batch.ts:424-447` (multer wiring pattern)

**Existing transaction pattern** (`users.ts:137-165`, VERBATIM — do NOT switch to Drizzle-ORM for this insert):
```typescript
const isFirstUser = db.$client.transaction(() => {
  const countResult = db.$client
    .prepare("SELECT COUNT(*) as count FROM users")
    .get() as { count?: number };
  const first = (countResult?.count || 0) === 0;
  db.$client
    .prepare(
      "INSERT INTO users (id, username, password_hash, is_admin, is_oidc, client_id, client_secret, issuer_url, authorization_url, token_url, identifier_path, name_path, scopes, totp_secret, totp_enabled, totp_backup_codes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      id, username, password_hash, first ? 1 : 0, 0,
      "", "", "", "", "", "", "",
      "openid email profile", null, 0, null,
    );
  return first;
})();
```

**Change to make:** Extend the INSERT column list to include `avatar_path`, extend the values-tuple to bind the new filename. Follow the raw-SQL prepared-statement pattern established here (CONTEXT.md § Established Patterns explicitly locks this).

**Existing save-trigger pattern** (`users.ts:212-220`, currently in the handler):
```typescript
try {
  const { saveMemoryDatabaseToFile } = await import("../db/index.js");
  await saveMemoryDatabaseToFile();
} catch (saveError) {
  authLogger.error("Failed to persist user to disk", saveError, {
    operation: "user_create_save_failed",
    userId: id,
  });
}
```

Either keep as-is (D-17 accepts both), OR upgrade to the labeled variant per RESEARCH.md § 3:
```typescript
try {
  await DatabaseSaveTrigger.forceSave("phase-85-user-avatar-create");
} catch (saveError) {
  authLogger.error("Failed to persist user creation to disk", saveError, {
    operation: "user_create_save_failed",
    userId: id,
  });
}
```

**Existing rollback pattern** (`users.ts:195-210`) — extend to also `unlinkUserAvatar(filename)`:
```typescript
try {
  await authManager.registerUser(id, password);
} catch (encryptionError) {
  await db.delete(users).where(eq(users.id, id));
  // ← Phase 85: also unlink the avatar file we wrote before the INSERT
  authLogger.error(
    "Failed to setup user encryption, user creation rolled back",
    encryptionError,
    { operation: "user_create_encryption_failed", userId: id },
  );
  return res.status(500).json({ error: "..." });
}
```

**Multer wiring for the create route** — the route currently has no middleware slots:
```typescript
router.post("/create", async (req, res) => { ... });
```
Extend to:
```typescript
router.post("/create", userAvatarUpload.single("avatar"), async (req, res) => {
  // early: if (!req.file) return res.status(400).json({ error: "avatar is required" });
  // ... existing allow_registration + username/password checks ...
  // ... file-then-row-then-forceSave per RESEARCH.md § 5 ...
});
```

Attach the multer error handler AFTER the route registration, scoped to `/create` (mirror `identity-avatar-batch.ts:453-478`).

---

### `src/backend/database/routes/users.ts` — new `PUT /users/:id/avatar`

**Composite analog:** `user-session-routes.ts:124-177` (own-or-admin) + `identities.ts:480-520` (file-then-row-then-old-unlink) + `identity-avatar-batch.ts:424-447` (multer wiring)

**Own-or-admin guard VERBATIM** (`user-session-routes.ts:134-158`):
```typescript
try {
  const user = await db.select().from(users).where(eq(users.id, userId));
  if (!user || user.length === 0) {
    return res.status(404).json({ error: "User not found" });
  }

  const userRecord = user[0];

  const sessionRecords = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (sessionRecords.length === 0) {
    return res.status(404).json({ error: "Session not found" });
  }

  const session = sessionRecords[0];

  if (!userRecord.isAdmin && session.userId !== userId) {
    return res
      .status(403)
      .json({ error: "Not authorized to revoke this session" });
  }
```

**Adapted for Phase 85:**
```typescript
router.put(
  "/:id/avatar",
  authenticateJWT,
  userAvatarUpload.single("avatar"),
  async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const targetUserId = String(req.params.id);
    if (!isNonEmptyString(targetUserId)) {
      return res.status(400).json({ error: "user id required in path" });
    }
    try {
      const user = await db.select().from(users).where(eq(users.id, userId));
      if (!user || user.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }
      const userRecord = user[0];

      // Own-or-admin — mirror user-session-routes.ts:154.
      if (!userRecord.isAdmin && targetUserId !== userId) {
        return res
          .status(403)
          .json({ error: "Not authorized to change this user's avatar" });
      }

      const targetUser = await db.select()
        .from(users).where(eq(users.id, targetUserId)).limit(1);
      if (!targetUser || targetUser.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "missing avatar field" });
      }

      // ... file-then-row-then-old-unlink (see below) ...
    } catch (err) { ... }
  },
);
```

**File-then-row-then-old-unlink ordering VERBATIM** (`identities.ts:487-520`):
```typescript
// ---- Write markdown ----
await writeIdentityFile(conn, identityKey, newBody);

// ---- Write avatar sibling (if new bytes) ----
if (req.file && newExt) {
  await writeAvatarSiblingFile(
    conn,
    identityKey,
    newExt as import("...").AvatarExt,
    req.file.buffer,
  );

  // Ext-swap cleanup: hard-delete the old sibling file. Best-effort
  // (missing-file is fine — this is opportunistic hygiene, not a
  // correctness guarantee).
  if (oldExt && oldExt !== newExt) {
    if (local) {
      const oldPath = path.join(
        getLocalIdentitiesRoot(),
        identityKey,
        `${identityKey}.${oldExt}`,
      );
      await fs.unlink(oldPath).catch(() => {
        /* best-effort */
      });
    }
    // ...
  }
}
```

**Adapted for Phase 85 (SQL-based, not markdown):**
```typescript
// 1. Load old filename (for unlink after row-update succeeds).
const oldFilename = targetUser[0].avatarPath;  // may be null

// 2. Write NEW file first (via helper).
const newFilename = await writeUserAvatar(
  targetUserId, req.file.mimetype, req.file.buffer,
);  // returns e.g. `${targetUserId}.png`

// 3. UPDATE row pointer.
try {
  await db.update(users)
    .set({ avatarPath: newFilename })
    .where(eq(users.id, targetUserId));
} catch (sqlErr) {
  // Rollback new file if it's actually new (different filename).
  if (newFilename !== oldFilename) {
    await unlinkUserAvatar(newFilename);
  }
  throw sqlErr;
}

// 4. Unlink OLD file if different (ext-swap or first-time change).
if (oldFilename && oldFilename !== newFilename) {
  await unlinkUserAvatar(oldFilename);
}

// 5. forceSave.
try {
  await DatabaseSaveTrigger.forceSave("phase-85-user-avatar-change");
} catch (saveError) { ... }
```

---

### `src/backend/database/routes/users.ts` — new `GET /users/:id/avatar`

**Analog:** `identities.ts:564-648` (serve-from-disk with mime + ETag + 404 mapping)

**Serve pattern VERBATIM** (`identities.ts:613-646`):
```typescript
try {
  const readResult = await readAvatarSiblingFile(conn, identityKey);
  if (readResult === null) {
    return res
      .status(404)
      .json({ error: "no avatar on disk for this identity" });
  }

  // ETag is per-response, not stored server-side [...]
  const etag = `"disk-${createHash("md5").update(readResult.bytes).digest("hex")}"`;
  const ifNoneMatch = req.headers["if-none-match"];
  if (ifNoneMatch && ifNoneMatch === etag) {
    return res.status(304).end();
  }
  res.setHeader("Content-Type", readResult.mime);
  res.setHeader("Content-Length", String(readResult.bytes.byteLength));
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "no-store");
  return res.send(readResult.bytes);
} catch {
  return res
    .status(502)
    .json({ error: "identity home box unreachable" });
}
```

**Adapted for Phase 85:**
```typescript
router.get(
  "/:id/avatar",
  authenticateJWT,
  async (req, res) => {
    const targetUserId = String(req.params.id);
    if (!isNonEmptyString(targetUserId)) {
      return res.status(400).json({ error: "user id required in path" });
    }

    const row = await db.select({ avatarPath: users.avatarPath })
      .from(users).where(eq(users.id, targetUserId)).limit(1);
    if (row.length === 0 || !row[0].avatarPath) {
      return res.status(404).json({ error: "no avatar for this user" });
    }

    try {
      const { bytes, mime } = await readUserAvatar(row[0].avatarPath);
      // Optional ETag (planner's discretion — mirror identities.ts:626-629):
      // const etag = `"disk-${createHash("md5").update(bytes).digest("hex")}"`;
      // const ifNoneMatch = req.headers["if-none-match"];
      // if (ifNoneMatch === etag) return res.status(304).end();
      // res.setHeader("ETag", etag);
      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Length", String(bytes.byteLength));
      res.setHeader("Cache-Control", "no-store");
      return res.send(bytes);
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        return res.status(404).json({ error: "no avatar file on disk" });
      }
      return res.status(500).json({ error: "avatar read failed" });
    }
  },
);
```

**Auth model:** `authenticateJWT` only (no per-user scoping) — mirrors identity-avatar serve, per RESEARCH.md § Open Question 2 recommendation.

---

### `src/backend/database/routes/delete-user-data.ts` — wire avatar unlink

**Analog:** the file itself (`delete-user-data.ts:32-104`) — extending existing helper.

**Insertion point** — line 91, IMMEDIATELY BEFORE `await db.delete(users).where(eq(users.id, userId));`:
```typescript
    await db.delete(userPreferences).where(eq(userPreferences.userId, userId));

    db.$client
      .prepare("DELETE FROM settings WHERE key LIKE ?")
      .run(`user_%_${userId}`);

    // ← PHASE 85 INSERTION POINT: fetch avatar_path BEFORE the row is gone,
    // then unlink the file (best-effort, ENOENT-tolerant) BEFORE the DELETE.
    // If unlink throws non-ENOENT (permission, EBUSY), the delete short-circuits
    // and the try/catch at the top of the fn surfaces the error.
    const avatarRow = await db.select({ avatarPath: users.avatarPath })
      .from(users).where(eq(users.id, userId)).limit(1);
    if (avatarRow.length > 0) {
      await unlinkUserAvatar(avatarRow[0].avatarPath);
    }

    await db.delete(users).where(eq(users.id, userId));
```

**Also wire in `users.ts:2007`** (`DELETE /users/delete-account` — self-delete). Same pattern: fetch avatar_path, unlink, then delete. RESEARCH.md § 1 identifies this as an INDEPENDENT delete path that does NOT call `deleteUserAndRelatedData`.

**Also wire in `users.ts:198`** (rollback delete inside `POST /users/create`). If file-then-row ordering is picked, the rollback path needs to unlink the file we wrote before the failed INSERT.

**Explicit no-op at `users.ts:1052`** (OIDC callback rollback) with a comment noting OIDC create bypasses avatar upload per Phase 85 scope (RESEARCH.md § 1 Assumption A1).

---

### `docker/nginx.conf` — bump `client_max_body_size` on `/users`

**Analog:** `docker/nginx.conf:286-296` (identity avatar block — the sizing precedent)

**Sizing precedent** (lines 286-296, VERBATIM):
```nginx
        # Phase 20 (IDUI-04): identity avatar batch generation — kept ABOVE /identities to win regex match for /identities/avatar/*.
        location ~ ^/identities/avatar(/.*)?$ {
            proxy_pass http://127.0.0.1:30001;
            proxy_http_version 1.1;
            proxy_set_header Host $http_host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            client_max_body_size 8M;
            client_body_timeout 60s;
            proxy_read_timeout 120s;
        }
```

**Edit target** (`docker/nginx.conf:166-175`, current shape):
```nginx
        location ~ ^/users(/.*)?$ {
            proxy_pass http://127.0.0.1:30001;
            proxy_http_version 1.1;
            proxy_set_header Host $http_host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $proxy_x_forwarded_proto;
            proxy_set_header X-Forwarded-Port $proxy_x_forwarded_port;
            proxy_set_header X-Forwarded-Host $proxy_x_forwarded_host;
        }
```

**Post-edit shape:**
```nginx
        location ~ ^/users(/.*)?$ {
            proxy_pass http://127.0.0.1:30001;
            proxy_http_version 1.1;
            proxy_set_header Host $http_host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $proxy_x_forwarded_proto;
            proxy_set_header X-Forwarded-Port $proxy_x_forwarded_port;
            proxy_set_header X-Forwarded-Host $proxy_x_forwarded_host;
            # Phase 85 — POST /users/create + PUT /users/:id/avatar carry up
            # to 5 MB avatar payloads (D-15). 6M leaves ~1 MB headroom for
            # multipart framing overhead. See docker/nginx-https.conf for
            # the sister edit (D-21).
            client_max_body_size 6M;
        }
```

---

### `docker/nginx-https.conf` — SAME edit on the sister file

**Edit target** (`docker/nginx-https.conf:177-186`) — identical shape, apply the same `client_max_body_size 6M;` directive with the same comment.

**Critical:** Both files MUST be edited in the same commit. RESEARCH.md § Pitfall 5 documents that only-one-file is the recurring failure mode.

---

## Shared Patterns

### Authentication

**Source:** `src/backend/database/routes/users.ts:48-49`
**Apply to:** New `PUT /users/:id/avatar`, new `GET /users/:id/avatar`. NOT applied to `POST /users/create` (that gates on `allow_registration` at lines 84-91).
```typescript
const authenticateJWT = authManager.createAuthMiddleware();
const requireAdmin = authManager.createAdminMiddleware();  // not used for Phase 85; own-or-admin is a per-handler check
```

### Own-or-admin authorization

**Source:** `src/backend/database/routes/user-session-routes.ts:134-158`
**Apply to:** `PUT /users/:id/avatar` only. (Serve endpoint is authenticateJWT-only — see RESEARCH.md Open Question 2.)
```typescript
const user = await db.select().from(users).where(eq(users.id, userId));
if (!user || user.length === 0) {
  return res.status(404).json({ error: "User not found" });
}
const userRecord = user[0];
if (!userRecord.isAdmin && targetId !== userId) {
  return res.status(403).json({ error: "Not authorized ..." });
}
```
**Do NOT simplify** to reading `isAdmin` off the JWT — the pattern reads role from DB to catch mid-session role revocation. RESEARCH.md § 6 explains.

### Save-trigger pairing (crown-jewel invariant)

**Source:** `src/backend/database/db/index.ts:911-922` (labeled variant) or `src/backend/database/routes/users.ts:212-220` (import-then-call variant)
**Apply to:** Every mutation on the `users` table (create INSERT, change UPDATE, delete-account DELETE, deleteUserAndRelatedData DELETE).
```typescript
try {
  await DatabaseSaveTrigger.forceSave("phase-85-user-avatar-<create|change>");
} catch (saveError) {
  <logger>.error("Failed to persist user avatar mutation to disk", saveError, {
    operation: "user_avatar_save_failed",
    userId,
  });
}
```
**D-17/D-18:** This is not optional. RESEARCH.md § Pitfall 2 documents the invariant.

### Multer + memoryStorage + fileFilter + limits

**Source:** `src/backend/database/routes/identity-avatar-batch.ts:406-422`
**Apply to:** `POST /users/create` and `PUT /users/:id/avatar` (both write paths). Extract into `user-avatar-storage.ts` as `userAvatarUpload`.

### Multer error → HTTP status handler

**Source:** `src/backend/database/routes/identity-avatar-batch.ts:453-478`
**Apply to:** Scoped to both write routes (`/create` and `/:id/avatar`). Register AFTER the routes so it only catches errors from them.

### File-then-row-then-old-unlink ordering

**Source:** `src/backend/database/routes/identities.ts:487-520`
**Apply to:** `POST /users/create` (file-then-row, unlink file on SQL rollback) and `PUT /users/:id/avatar` (new-file-then-row-then-old-unlink). RESEARCH.md § 5 has the full sketch.

### ENOENT-tolerant unlink

**Source:** `src/backend/database/routes/identities.ts:508-510` (best-effort catch-all form) and `identities.ts:498` (comment: "hard-delete the old sibling file. Best-effort (missing-file is fine — this is opportunistic hygiene, not a correctness guarantee)").
**Apply to:** All 4 delete-avatar-file call sites (delete-user-data.ts insertion, users.ts:198 rollback, users.ts:2007 self-delete, PUT change endpoint old-file cleanup). Encapsulate in `unlinkUserAvatar(filenameOrNull)` helper.

### MIME derivation from filename extension

**Source:** `src/backend/claude-session/identity-artifact-reader.ts:1798-1804` + `identity-artifact-reader.ts:2070-2076` (`MIME_TO_AVATAR_EXT` + `AVATAR_MIME_FROM_EXT`)
**Apply to:** `writeUserAvatar` (mime → ext for filename composition), `readUserAvatar` (ext → mime for Content-Type header). Local scoped map recommended over cross-file import (RESEARCH.md § 8).

### Multipart test helper

**Source:** `src/backend/database/routes/identity-avatar-batch.test.ts:184-254`
**Apply to:** `users.test.ts` and `user-avatar-storage.test.ts`. Copy `buildMultipartBody` + `multipartRequest` VERBATIM; add a `buildMultipartBodyMixed(textFields, file, boundary)` variant for the create endpoint which carries `username` + `password` alongside the `avatar` file (sketch in RESEARCH.md § 7).

### Nginx config duplication (crown-jewel invariant)

**Source:** CLAUDE.md § Nginx caveat; historical bounties documented in RESEARCH.md § Pitfall 5.
**Apply to:** `docker/nginx.conf` AND `docker/nginx-https.conf` in the SAME commit. Every plan task touching nginx MUST include both files in its Files-Changed list.

---

## No Analog Found

None. Every ingredient exists in-tree. Even the least-clear-fit file (`user-avatar-storage.ts` — new module) has role-matching analogs (`identity-avatar-batch.ts` for the multer + validation + error handler; `identities.ts:38-45` for the multer scoping style). The composition is new, but every constituent pattern is battle-tested.

The delete-user-data.test.ts file is a "create-new" but does not need a novel test pattern — it will use the same vitest + tmp-DATA_DIR fixture shape as `identity-avatar-batch.test.ts` (`tmpdir` prep, write a fake avatar file, invoke helper, assert file absence).

---

## Metadata

**Analog search scope:**
- `src/backend/database/routes/` — Express handlers and helpers (users, identities, identity-avatar-batch, user-session-routes, delete-user-data, user-admin-routes)
- `src/backend/database/db/` — schema, migration mechanism, migration tests
- `src/backend/claude-session/identity-artifact-reader.ts` — MIME/ext canonical maps
- `docker/nginx.conf`, `docker/nginx-https.conf` — edge routing

**Files scanned:** 12 primary + 4 confirmatory (test files, DATA_DIR resolution, identity-artifact-reader exports)

**Pattern extraction date:** 2026-09-07

**Confidence:** HIGH — every excerpt is a verbatim read from a shipped-and-green production file. All line numbers verified against current tree state.
