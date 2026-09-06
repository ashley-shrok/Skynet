# Phase 75: Telegram bridge Phase A — Matrix admin integration — Pattern Map

**Mapped:** 2026-09-06
**Files analyzed:** 11 new/modified files
**Analogs found:** 11 / 11 (all files have strong in-tree analogs)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/backend/matrix/matrix-admin-client.ts` (NEW) | service (outbound HTTP wrapper) | request-response | `src/backend/database/routes/voice.ts` (handleSpeak fetch pattern, L200-275) | exact (fetch reverse-proxy shape) |
| `src/backend/matrix/matrix-admin-client.test.ts` (NEW) | test (unit) | request-response | `src/backend/utils/field-crypto.test.ts` + `identity-birth-orchestrator.test.ts` (vi.mock injection) | exact (Vitest + fetch mocking) |
| `src/backend/matrix/matrix-admin-client.integration.test.ts` (NEW) | test (integration, gated) | request-response | No perfect analog — closest is `identity-birth-orchestrator.test.ts` shape with env-flag gate | role-match |
| `src/backend/matrix/matrix-admin-creds-store.ts` (NEW) | service (persistent store) | CRUD | `src/backend/utils/shared-credential-manager.ts` (SystemCrypto + FieldCrypto load/save) | role-match (encrypted-secret store) |
| `src/backend/matrix/matrix-admin-creds-store.test.ts` (NEW) | test (unit) | CRUD | `src/backend/utils/field-crypto.test.ts` | exact (in-memory better-sqlite3 + FieldCrypto roundtrip) |
| `src/backend/utils/field-crypto.ts` (MODIFIED) | config (encryption declaration) | CRUD | Self — extend the `ENCRYPTED_FIELDS` map in place | exact |
| `src/backend/database/db/schema.ts` (MODIFIED) | model (Drizzle schema) | CRUD | Self — extend `users` table + add `matrixAdminCreds` mirroring `ssh_credentials` shape | exact |
| `src/backend/database/db/index.ts` (MODIFIED) | migration (schema DDL + boot migration) | batch (boot-time) | Self — `CREATE TABLE IF NOT EXISTS` block L150-540 + `addColumnIfNotExists` sweep L823-853 | exact |
| `src/backend/database/db/index.migration.test.ts` (MODIFIED) | test (migration) | batch | Self — extend existing file with new cases | exact |
| `src/backend/database/routes/user-admin-routes.ts` (MODIFIED) | controller (admin route) | request-response | Self — `POST /make-admin` handler L137-212 | exact |
| `src/backend/database/routes/identity-birth-orchestrator.ts` (MODIFIED) | service (multi-step orchestrator over SSH/SFTP) | streaming (SSE via emit callback) | Self — existing 5-step orchestrator, extend with steps 6-8 | exact |
| `src/backend/database/routes/identity-birth.ts` (MODIFIED) | controller (SSE glue + dep injection) | streaming (SSE) | Self — extend `BirthDeps` with matrix client + writeRelayJson | exact |
| `src/backend/database/routes/identity-birth-orchestrator.test.ts` (MODIFIED) | test (unit, injected deps) | streaming | Self — mirror existing Test 1..N shape with new mocks | exact |
| `src/backend/database/routes/user-admin-routes.test.ts` (NEW or MODIFIED) | test (supertest) | request-response | `src/backend/database/routes/identities.put-disk.test.ts` (nearest supertest+in-memory-DB analog) | role-match |
| `src/backend/database/routes/matrix-admin-routes.ts` (OPTIONAL NEW — retry endpoint) | controller (admin route) | request-response | `src/backend/database/routes/user-admin-routes.ts` `POST /make-admin` L137-212 | exact |

## Pattern Assignments

### `src/backend/matrix/matrix-admin-client.ts` (NEW — service, request-response)

**Analog:** `src/backend/database/routes/voice.ts` `handleSpeak` (L200-275) — native `fetch` + `AbortController` + non-2xx as `{error, status}` + no upstream body leak.

**Imports pattern** — mirror voice.ts:
```typescript
import { databaseLogger } from "../utils/logger.js";
// No express types needed — this is a pure module, not a route handler.
```

**Core fetch pattern** (voice.ts:226-274 — copy literally, swap TTS_URL for Synapse admin URL):
```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 30_000);
try {
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${creds.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password, admin: false, deactivated: false }),
    signal: controller.signal,
  });
  clearTimeout(timeoutId);
  if (!response.ok) {
    return { ok: false, status: response.status, error: "admin_api_non_2xx" };
  }
  return { ok: true, data: await response.json() };
} catch (err) {
  clearTimeout(timeoutId);
  if (err instanceof DOMException && err.name === "AbortError") {
    return { ok: false, status: 504, error: "admin_api_timeout" };
  }
  databaseLogger.error("matrix admin proxy error", err, { operation: "matrix_admin_..." });
  return { ok: false, status: 502, error: "admin_api_proxy_error" };
}
```

**Error-shape contract** (voice.ts:247-251, 264-273):
- Non-2xx → `{ ok:false, status: response.status, error: "<stable_code>" }` — NEVER leak upstream body.
- Timeout (AbortError) → `{ ok:false, status:504, error:"admin_api_timeout" }`.
- Network/parse error → `{ ok:false, status:502, error:"admin_api_proxy_error" }`.
- Log status + operation code only; NEVER log the token or its prefix.

**Security-critical pattern**: `encodeURIComponent(mxid)` in every URL that interpolates mxid (Pitfall 2 in RESEARCH.md). Precedent: `identity-clone.ts:119` validate-then-interpolate discipline (called out in orchestrator L474-476).

**Free-function module style** (matches voice.ts): export `createOrUpdateUser`, `loginAsUser`, `joinRoom`, `makeRoomAdmin`, `listRooms` as free async functions. No class. All 5 primitives share the fetch-wrapper shape above.

---

### `src/backend/matrix/matrix-admin-creds-store.ts` (NEW — service, CRUD)

**Analog:** `src/backend/utils/field-crypto.ts` API + `src/backend/utils/system-crypto.ts` singleton getter + existing FieldCrypto callers.

**FieldCrypto API surface** (field-crypto.ts:48-116):
```typescript
FieldCrypto.encryptField(plaintext, masterKey, recordId, fieldName)
  → returns JSON-stringified {data, iv, tag, salt, recordId}
FieldCrypto.decryptField(encryptedValue, masterKey, recordId, fieldName)
  → returns plaintext
FieldCrypto.shouldEncryptField(tableName, fieldName)
  → boolean (drives the LazyFieldEncryption sweeper)
```

**Master-key acquisition pattern** (auth-manager.ts:61 + 217):
```typescript
const systemCrypto = SystemCrypto.getInstance();
const encryptionKey = await systemCrypto.getEncryptionKey();  // Buffer
```

**Store shape**: single-row table `matrix_admin_creds` (id = 1 by convention). Load path: `SELECT * FROM matrix_admin_creds WHERE id = 1` → decrypt `accessToken` and `password` columns via FieldCrypto with `recordId = String(row.id)`. Save path: encrypt via FieldCrypto BEFORE Drizzle UPDATE, OR write plaintext + let LazyFieldEncryption sweep (see field-crypto.ts:17-46 `ENCRYPTED_FIELDS` map — declaring the columns is what triggers the sweeper).

**Recommended:** eager encrypt on write (avoids plaintext-on-disk window on first-boot ingestion). Precedent: check `credential-system-encryption-migration.ts:45-63` for `FieldCrypto.decryptField` call sites — same pattern in reverse.

---

### `src/backend/utils/field-crypto.ts` (MODIFIED — config)

**Analog:** self — add one entry to the existing `ENCRYPTED_FIELDS` map.

**Exact excerpt to modify** (field-crypto.ts:17-46):
```typescript
private static readonly ENCRYPTED_FIELDS = {
  users: new Set([
    "passwordHash", "clientSecret", "totpSecret", "totpBackupCodes", "oidcIdentifier",
  ]),
  ssh_data: new Set([
    "password", "key", "keyPassword", "sudoPassword",
    "autostartPassword", "autostartKey", "autostartKeyPassword",
    "socks5Password", "rdpPassword", "vncPassword", "telnetPassword",
  ]),
  ssh_credentials: new Set([
    "password", "privateKey", "keyPassword", "key", "publicKey",
  ]),
  opkssh_tokens: new Set(["sshCert", "privateKey"]),
  // NEW for Phase 75:
  matrix_admin_creds: new Set(["access_token", "password"]),
};
```

**Note on column-name casing:** the `ENCRYPTED_FIELDS` map uses the *snake_case DB column names* for `ssh_data` (see `sudoPassword` vs schema — actually mixed; check the write-path caller). Verify at implementation time by running `FieldCrypto.shouldEncryptField("matrix_admin_creds", "access_token")` from a repl.

---

### `src/backend/database/db/schema.ts` (MODIFIED — model)

**Analog:** self — `users` table (L4-26) for `.mxid` column addition; `ssh_credentials` (research names L263-296) for `matrixAdminCreds` singleton table.

**Excerpt — `users.mxid` addition** (schema.ts:4-26 style):
```typescript
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  // ...existing columns unchanged...
  totpBackupCodes: text("totp_backup_codes"),
  mxid: text("mxid"),   // NEW — Phase 75 Q3 decision, alongside totp/password
});
```

**Excerpt — `matrixAdminCreds` new table** (mirroring the field-crypto Pattern 5 recommendation from RESEARCH.md:388-397, using `sql\`CURRENT_TIMESTAMP\`` per existing tables):
```typescript
export const matrixAdminCreds = sqliteTable("matrix_admin_creds", {
  id: integer("id").primaryKey(),
  homeserverBase: text("homeserver_base").notNull(),
  userId: text("user_id").notNull(),
  accessToken: text("access_token").notNull(),   // FieldCrypto-encrypted
  password: text("password").notNull(),          // FieldCrypto-encrypted
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
```
Precedent for `default(sql\`CURRENT_TIMESTAMP\`)`: schema.ts:41-47 (`sessions.createdAt`).

---

### `src/backend/database/db/index.ts` (MODIFIED — migration + DDL)

**Analog:** self — two patterns coexist for boot-time schema.

**Pattern A: `CREATE TABLE IF NOT EXISTS` block** (index.ts:149-540 — this is the DDL executed once at boot on `sqlite.exec(...)`). Add the new table here:
```typescript
// Insert alongside ssh_credentials block (index.ts:292-310):
CREATE TABLE IF NOT EXISTS matrix_admin_creds (
    id INTEGER PRIMARY KEY,
    homeserver_base TEXT NOT NULL,
    user_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    password TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

**Pattern B: `addColumnIfNotExists` sweep for existing tables** (index.ts:634-659 helper; L823-853 call-site block). Add ONE line for `users.mxid`:
```typescript
// Insert in the users-column sweep, alongside totp_backup_codes (index.ts:853):
addColumnIfNotExists("users", "mxid", "TEXT");
```

**Post-migration persist pattern** (index.ts:810-821 — DROP wrapper) — apply if we choose to force-save after the DDL runs. Not strictly required for `CREATE TABLE IF NOT EXISTS` (idempotent), but shown here as the precedent for wrapping:
```typescript
try {
  await DatabaseSaveTrigger.forceSave("phase-75-matrix-admin-schema");
} catch (saveError) {
  databaseLogger.warn(
    "[phase-75] forceSave failed post-schema (non-fatal — CREATE IF NOT EXISTS is idempotent, next boot retries)",
    { operation: "schema_migration_force_save", error: saveError },
  );
}
```

**Idempotency contract:** every DDL statement above tolerates repeat execution. The `addColumnIfNotExists` helper (index.ts:634-659) probes existence via `SELECT "${column}" FROM ${table} LIMIT 1` inside try/catch; the CREATE block uses `IF NOT EXISTS`. No `DROP` needed for Phase 75.

---

### `src/backend/database/routes/user-admin-routes.ts` (MODIFIED — controller, request-response)

**Analog:** self — `POST /make-admin` handler L137-212 is the exact shape to mirror.

**Imports pattern** (user-admin-routes.ts:1-6):
```typescript
import type { AuthenticatedRequest } from "../../../types/index.js";
import type { RequestHandler, Router } from "express";
import { eq, ne } from "drizzle-orm";
import { authLogger } from "../../utils/logger.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
```

**Registration pattern** (user-admin-routes.ts:12-15) — this file exports `registerUserAdminRoutes(router, authenticateJWT)` which is called from `users.ts:2153`. Add the new handler INSIDE that function so it mounts under `/users/:id/mxid` when `users.ts` mounts at `/users` (database.ts:1813).

**Handler body — mirror `POST /make-admin` (L137-212) with the modifications from RESEARCH.md Example 5:**
```typescript
const MXID_RE = /^@[a-z0-9._=/+-]{1,255}:[a-z0-9.-]{1,255}$/;

router.post("/:id/mxid", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const targetId = req.params.id;
  const { mxid } = req.body;

  if (typeof mxid !== "string" || !MXID_RE.test(mxid)) {
    return res.status(400).json({ error: "mxid must match @localpart:server_name" });
  }

  try {
    // Admin gate (mirror make-admin L152-158)
    const adminUser = await db.select().from(users).where(eq(users.id, userId));
    if (!adminUser || adminUser.length === 0 || !adminUser[0].isAdmin) {
      return res.status(403).json({ error: "Not authorized" });
    }

    // Target existence (mirror make-admin L160-171)
    const targetUser = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
    if (!targetUser || targetUser.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    // Update (mirror make-admin L177-184)
    await db.update(users).set({ mxid }).where(eq(users.id, targetId));

    // Persist RAM→disk (mirror make-admin L186-199 — try/catch, non-fatal warn)
    try {
      const { saveMemoryDatabaseToFile } = await import("../db/index.js");
      await saveMemoryDatabaseToFile();
    } catch (saveError) {
      authLogger.error("Failed to persist mxid registration to disk", saveError, {
        operation: "mxid_save_failed",
        userId: targetUser[0].id,
      });
    }

    // Audit log (mirror make-admin L201-206)
    authLogger.info("mxid registered for user", {
      operation: "mxid_register",
      adminId: userId,
      targetUserId: targetUser[0].id,
      mxid,
    });
    res.json({ ok: true });
  } catch (err) {
    authLogger.error("Failed to register mxid", err);
    res.status(500).json({ error: "Failed to register mxid" });
  }
});
```

**Admin-gate pattern** — DEFENSE IN DEPTH. `authenticateJWT` middleware verifies the token; the in-handler `.isAdmin` check is required because `authenticateJWT` (auth-manager.ts:806) does NOT enforce admin — only `createAdminMiddleware` (auth-manager.ts:969) does. The `registerUserAdminRoutes(router, authenticateJWT)` wiring passes the auth middleware; admin enforcement is per-handler DB lookup. Consistent with `make-admin`, `remove-admin` in the same file.

**Nginx pass-through:** `POST /users/:id/mxid` inherits the existing `location ~ ^/users(/.*)?$` block in `docker/nginx.conf` and `docker/nginx-https.conf` — NO nginx changes required (RESEARCH.md Pitfall 1).

---

### `src/backend/database/routes/identity-birth-orchestrator.ts` (MODIFIED — service, streaming)

**Analog:** self — the existing 5-step orchestrator with its `emit` callback and `runStep` helper (L327-627).

**Extension shape:**
1. Widen `BirthEvent` type union at L102-104 to include step numbers 6, 7, 8:
   ```typescript
   export type BirthEvent =
     | { type: "step"; n: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8; phase: "started" | "completed" | "failed"; reason?: string }
     | { type: "ended"; ok: boolean; failedStep?: number; identityId?: string; sessionName?: string };
   ```
   Also widen `runStep` signature at L382-383 to accept the new step numbers.

2. Widen `BirthDeps` interface (L127-182) with 3 new deps:
   ```typescript
   /** Phase 75: Matrix admin client — mints the relay account for the agent. */
   matrixCreateOrUpdateUser: (mxid: string, password: string) =>
     Promise<{ ok: true; mxid: string; password: string } | { ok: false; status: number; error: string }>;
   /** Phase 75: Homeserver base to build the mxid (server_name suffix). */
   matrixHomeserver: string;   // e.g. "thenasty.taild9b663.ts.net"
   /** Phase 75: relay.json builder — pure function, given mxid+pw returns JSON body per agent-relay convention. */
   buildRelayJsonBody: (opts: { mxid: string; password: string; accessToken: string; homeserverBase: string }) => string;
   ```
   Reuse the existing `writeMarkdownFileAtomic` dep (L162-166) for the step-8 write — the helper is content-agnostic per its prologue at `identity-artifact-reader.ts:1849-1903` ("filename ends .json but writeMarkdownFileAtomic is content-agnostic — its name reflects historical caller, not a format constraint" — quoted in RESEARCH.md).

3. Insert steps 6-8 in `birthIdentity` AFTER step 2.5 (avatar write) and BEFORE the synthetic 4/5 emit at L623-626, wrapped in the existing `runStep` helper. Steps 6 and 7-8 run only in the remote branch (`!useLocal && conn`) — mirror the Q3 recommendation in RESEARCH.md (local-branch self-birth stays out of scope).

**Failure-mode contract — Q2 partial-tolerated:**
- Steps 6, 7, 8 use `runStep` which emits `step:N:failed` + `ended{ok:false, failedStep:N}` on throw (existing L387-396 behavior).
- CRITICAL: DO NOT add any `rm -rf` / folder-cleanup logic in a catch block. Precedent Pitfall 6 in RESEARCH.md: agent-supervisor race means rollback is worse than partial state.
- The existing `try { ... } finally { conn.end() }` at L435 covers SSH cleanup; no other cleanup.

**Emit callback pattern** (L387-396 `runStep` — copy verbatim):
```typescript
async function runStep(n: 1|2|3|4|5|6|7|8, fn: () => Promise<void>, failReasonOverride?: string): Promise<void> {
  emit({ type: "step", n, phase: "started" });
  try {
    await fn();
    emit({ type: "step", n, phase: "completed" });
  } catch (e) {
    const reason = failReasonOverride ?? sanitizeError(e);
    emit({ type: "step", n, phase: "failed", reason });
    emit({ type: "ended", ok: false, failedStep: n });
    throw new BirthAborted(n);
  }
}
```

**Step 6 body** (mint via admin):
```typescript
await runStep(6, async () => {
  const agentPassword = generateAgentPassword();  // crypto.randomBytes → hex
  const mxid = `@${opts.name}:${deps.matrixHomeserver}`;
  const result = await deps.matrixCreateOrUpdateUser(mxid, agentPassword);
  if (!result.ok) {
    throw new Error(`admin_mint_failed: ${result.error} (${result.status})`);
  }
  // Stash mxid + password + accessToken in a closure-scoped var for step 8
  mintedMxid = mxid;
  mintedPassword = agentPassword;
  mintedAccessToken = result.data?.access_token ?? "";  // may be empty; recv.sh will relogin
});
```

**Step 8 body** (write relay.json via existing SFTP helper — copy the pattern from Step 2.5 at L523-593):
```typescript
await runStep(8, async () => {
  if (useLocal || !conn) return;  // local-branch skip (mirror pre-write skip at L507-509)
  const relayJsonPath = `$HOME/.claude/identities/${opts.name}/relay.json`;
  const body = deps.buildRelayJsonBody({
    mxid: mintedMxid,
    password: mintedPassword,
    accessToken: mintedAccessToken,
    homeserverBase: deps.matrixHomeserver,
  });
  await deps.writeMarkdownFileAtomic(conn, relayJsonPath, body);
});
```

**relay.json shape** (from RESEARCH.md Example 4 — verified against `~/.claude/skills/agent-relay/recv.sh:25-32, 49-59, 82-91`):
```json
{
  "base": "http://100.113.23.63:8008/_matrix/client/v3",
  "user_id": "@<name>:thenasty.taild9b663.ts.net",
  "password": "<agent-password-generated-by-Skynet>",
  "token": "<access-token-from-admin-mint>",
  "access_token": "<access-token-from-admin-mint>"
}
```
Constraints: `base` MUST end in `/_matrix/client/v3`; both `token` and `access_token` set to same value (defensive); `password` REQUIRED for recv.sh `relogin()` self-heal (recv.sh:49-59); file mode 0o644 (writeMarkdownFileAtomic default at L1870).

---

### `src/backend/database/routes/identity-birth.ts` (MODIFIED — controller, streaming)

**Analog:** self — the existing SSE glue + `BirthDeps` assembly at L156-177.

**Extension:** add 3 new deps to the object at L156, wired to the new `matrix-admin-client.ts` free functions + creds store:
```typescript
import { createOrUpdateUser as matrixCreateOrUpdateUser } from "../../matrix/matrix-admin-client.js";
import { getMatrixAdminCreds } from "../../matrix/matrix-admin-creds-store.js";

// ... inside the handler, alongside existing deps:
const deps: BirthDeps = {
  connectOneShot,
  execCommand,
  // ...existing deps unchanged...
  writeMarkdownFileAtomic: async (conn, targetPath, contents) =>
    writeMarkdownFileAtomic(conn, targetPath, contents),
  writeAvatarSiblingFile: async (conn, identityKey, ext, bytes) =>
    writeAvatarSiblingFile(conn, identityKey, ext, bytes),
  // NEW Phase 75:
  matrixCreateOrUpdateUser: (mxid, password) => matrixCreateOrUpdateUser(mxid, password),
  matrixHomeserver: "thenasty.taild9b663.ts.net",  // TODO: read from matrix-admin-creds-store
  buildRelayJsonBody: buildRelayJsonBodyImpl,   // pure function, likely lives in matrix-admin-client.ts
};
```

**SSE framing (unchanged from L141-143):**
```typescript
const emit = (e: BirthEvent): void => {
  res.write(`event: birth\ndata: ${JSON.stringify(e)}\n\n`);
};
```

**No new route, no new mount:** `POST /identities/birth` remains at the same URL; the frontend BirthProgress checklist gains events for steps 6-8 automatically via the widened `BirthEvent.n` union (frontend widening is a Phase B concern — RESEARCH.md Assumption A4).

---

### `src/backend/database/routes/matrix-admin-routes.ts` (OPTIONAL NEW — retry endpoint, controller)

**Analog:** `user-admin-routes.ts` `POST /make-admin` handler (L137-212) — same admin-gate + audit-log discipline.

**Route shape** (RESEARCH.md Open Question 1 Option A — recommended):
- Path: `POST /identities/:key/relay-retry` mounted under existing `/identities` block (inherits nginx coverage).
- Body: `{ hostId: number }`.
- Behavior: re-runs steps 6 + 8 as a shared helper extracted from the birth orchestrator. Idempotent because `PUT /_synapse/admin/v2/users/<uid>` is idempotent.

**Alternative mount:** if the retry lives under a NEW base path (`/matrix-admin/...`), new nginx `location` blocks are required in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf` (CLAUDE.md nginx caveat). Recommend mounting under `/identities` to avoid this.

---

### Test files — mirror in-tree Vitest patterns

**`matrix-admin-client.test.ts`** — mock global `fetch` via `vi.stubGlobal("fetch", vi.fn())`. Assert on returned `{ok, status, error}` tuples. Precedent: `field-crypto.test.ts` uses Vitest with pure-function assertions.

**`matrix-admin-creds-store.test.ts`** — use an in-memory better-sqlite3 database (mirror pattern from `identities.get-disk.test.ts`, `identities.put-disk.test.ts`, `users-list-basic.test.ts` — RESEARCH.md § Test infrastructure verified in-tree). Round-trip: write plaintext creds → read back → assert decrypted match.

**`identity-birth-orchestrator.test.ts`** — extend existing file. Precedent shape (from grep):
```typescript
vi.mock("../../ssh/ssh-one-shot.js", () => ({ ... }));
vi.mock("../../ssh/tmux-helper.js", () => ({ ... }));
vi.mock("../../claude-session/identity-artifact-reader.js", () => ({ ... }));
vi.mock("node:child_process", () => ({ ... }));
vi.mock("node:fs/promises", () => ({ ... }));
```
Add: `vi.mock("../../matrix/matrix-admin-client.js", () => ({ createOrUpdateUser: vi.fn() }))`. New test cases (per RESEARCH.md § Wave 0 Gaps):
- Happy path — steps 1-8 emit in order.
- Step-6 admin-mint failure → orchestrator emits `step:6:failed`, `ended{ok:false, failedStep:6}`, DOES NOT delete the folder from step 1 (assert no `rm -rf` in exec log).
- Step-8 SFTP failure → same partial-tolerated shape with `failedStep:8`.

**`db/index.migration.test.ts`** — extend existing file with two new cases:
- `addColumnIfNotExists("users", "mxid", "TEXT")` idempotent across two boots.
- `CREATE TABLE IF NOT EXISTS matrix_admin_creds` idempotent — schema matches expected columns.

**`user-admin-routes.test.ts`** — CREATE if absent (grep shows no existing file at this path — the existing `identities.put-disk.test.ts` at `src/backend/database/routes/` is the nearest supertest precedent). Cases: admin-gated (403 for non-admin), mxid regex validation (400 on bad shape), successful update calls `saveMemoryDatabaseToFile`, 404 on missing target user.

---

## Shared Patterns

### Authentication (all admin routes)
**Source:** `src/backend/utils/auth-manager.ts:806` (`createAuthMiddleware`) + `L969` (`createAdminMiddleware`)
**Apply to:** `POST /users/:id/mxid` and optional `POST /identities/:key/relay-retry`.

Two options:
1. **In-handler admin-check (recommended for `/users/:id/mxid`)** — matches sibling `POST /make-admin` at `user-admin-routes.ts:152-158`:
   ```typescript
   const adminUser = await db.select().from(users).where(eq(users.id, userId));
   if (!adminUser || adminUser.length === 0 || !adminUser[0].isAdmin) {
     return res.status(403).json({ error: "Not authorized" });
   }
   ```
2. **Middleware admin-gate** — use `authManager.createAdminMiddleware()` (auth-manager.ts:969-1046) — combines JWT verify + `pendingTOTP` block + `.isAdmin` lookup + audit log. Cleaner for a fresh route.

Pick #1 for `user-admin-routes.ts` (consistency with sibling handlers), #2 for a new `matrix-admin-routes.ts` file.

### FieldCrypto for at-rest column encryption
**Source:** `src/backend/utils/field-crypto.ts:17-46` (declaration map), `L48-116` (encrypt/decrypt API), `src/backend/utils/system-crypto.ts:151` (`getEncryptionKey`)
**Apply to:** `matrix_admin_creds.access_token`, `matrix_admin_creds.password`.

Two write-side patterns exist:
- **Eager**: caller runs `FieldCrypto.encryptField(plaintext, masterKey, recordId, fieldName)` BEFORE Drizzle UPDATE (precedent: `credential-system-encryption-migration.ts:45-63`).
- **Lazy**: caller writes plaintext; `LazyFieldEncryption` background-sweeps and encrypts on next tick (precedent: `lazy-field-encryption.ts` — declared in `ENCRYPTED_FIELDS` triggers the sweeper).

Recommend eager encryption on the initial ingestion (avoids plaintext-on-disk window) but declare in `ENCRYPTED_FIELDS` regardless (belt-and-suspenders: the sweeper covers any missed write).

### Persistence trigger after DB writes
**Source:** `src/backend/utils/database-save-trigger.ts` + `src/backend/database/routes/host-autostart-routes.ts:173-181`
**Apply to:** All DB writes in Phase 75 (mxid update, creds ingestion).

Two flavors:
- `DatabaseSaveTrigger.triggerSave(reason)` — 2s debounced; use for row updates.
- `DatabaseSaveTrigger.forceSave(reason)` — immediate; use after schema DDL.

Alternative for row updates: dynamic `import` of `saveMemoryDatabaseToFile` (user-admin-routes.ts:187-188 pattern) — same effect, matches sibling handlers.

Wrap ALL calls in try/catch, log-warn on failure (precedent: `host-autostart-routes.ts:174-181`, `index.ts:810-821`). Non-fatal because the trigger no-ops safely on uninitialized-first-boot.

### SFTP atomic write for on-target-host file mutations
**Source:** `src/backend/claude-session/identity-artifact-reader.ts:1849-1903` (`writeMarkdownFileAtomic`)
**Apply to:** Step 8 write of `~/.claude/identities/<name>/relay.json`.

The helper is content-agnostic per its prologue — the "Markdown" in the name reflects historical caller, not a format constraint. Use verbatim:
```typescript
await writeMarkdownFileAtomic(conn, `$HOME/.claude/identities/${opts.name}/relay.json`, JSON.stringify(body));
```
Uses `sftp.ext_openssh_rename` (posix-rename@openssh.com) for atomic-overwrite — plain `sftp.rename` cannot overwrite existing files on OpenSSH per quick 260802-qrw (prologue at L1824-1837).

### Input validation before shell/URL/SQL interpolation
**Source:** `src/backend/database/routes/identity-birth-orchestrator.ts:233-234` (`IDENTITY_KEY_RE`) + validate-then-interpolate at L474-486
**Apply to:** mxid on `POST /users/:id/mxid`, agent name in step 6 mxid construction.

**MXID regex** (RESEARCH.md Pitfall 2):
```typescript
const MXID_RE = /^@[a-z0-9._=/+-]{1,255}:[a-z0-9.-]{1,255}$/;
```
Gate at handler entry BEFORE DB update or URL construction. Additionally, `encodeURIComponent(mxid)` at every fetch-URL interpolation site (matrix-admin-client.ts).

### Structured logging + audit trail
**Source:** `src/backend/utils/logger.ts` (`authLogger`, `databaseLogger`, `sshLogger`) + `user-admin-routes.ts:201-206` audit-log pattern
**Apply to:** All admin actions (mxid registration, admin-mint attempts, relay-retry invocations).

Log shape (user-admin-routes.ts:201-206):
```typescript
authLogger.info("mxid registered for user", {
  operation: "mxid_register",
  adminId: userId,
  targetUserId: targetUser[0].id,
  mxid,   // safe to log — this is the mapping we WANT to audit
});
```
NEVER log: Matrix admin token, admin password, agent-mint password, response bodies from Synapse. RESEARCH.md § Security Domain — Info Disclosure controls.

---

## No Analog Found

All Phase 75 files have strong in-tree analogs. No file falls into this bucket.

## Metadata

**Analog search scope:**
- `src/backend/utils/` (field-crypto, auth-manager, database-save-trigger, system-crypto, logger, shared-credential-manager, credential-system-encryption-migration)
- `src/backend/database/db/` (index.ts, schema.ts, index.migration.test.ts)
- `src/backend/database/routes/` (user-admin-routes.ts, users.ts, identity-birth.ts, identity-birth-orchestrator.ts, voice.ts, host-autostart-routes.ts)
- `src/backend/claude-session/` (identity-artifact-reader.ts writeMarkdownFileAtomic)
- `src/backend/ssh/` (tmux-helper.ts execCommand, ssh-one-shot.ts connectOneShot)
- Existing test infrastructure (identity-birth-orchestrator.test.ts shape)

**Files scanned:** ~30 in-tree source files verified via Read/Grep 2026-09-06.

**Pattern extraction date:** 2026-09-06

**Key insight (echoed from RESEARCH.md):** Almost every piece of Phase 75 is composition of existing Skynet primitives — the only genuinely new code is the ~150-line matrix-admin-client (a thin fetch wrapper mirroring voice.ts) and the ~50-line orchestrator extension for steps 6-8 (mirroring the existing `runStep` + `writeMarkdownFileAtomic` pattern already used by step 2.5). Nothing warrants a subsystem-scale build.
