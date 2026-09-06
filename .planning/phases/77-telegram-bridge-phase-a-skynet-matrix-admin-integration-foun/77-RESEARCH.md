# Phase 77: Telegram bridge Phase A — Skynet Matrix admin integration — Research

**Researched:** 2026-09-06
**Domain:** Matrix admin client + Skynet backend integration + agent identity lifecycle
**Confidence:** HIGH

## Summary

Phase 77 is the Matrix-admin foundation for the two-phase `/build telegram-bridge` work. It ships four artifacts inside Skynet's existing backend: (1) a Matrix admin client that wraps three specific `/_synapse/admin/{v1,v2}` endpoints on the co-located Synapse relay at `http://100.113.23.63:8008`, (2) storage for the `@skynet-admin` account credentials (parked at `~/.claude/roles/box-maintainer/bounties/skynet-matrix-admin-integration/credentials.txt`) in Skynet's per-column `FieldCrypto` pattern, (3) a new `mxid TEXT` column on the `users` table plus a `POST /users/:id/mxid` admin-gated endpoint for registering externally-created human mxids, and (4) an extension to the existing 5-step `identity-birth-orchestrator` sequence so Skynet-driven agent creation mints the relay account via admin and writes `~/.claude/identities/<name>/relay.json` on the target host via the already-in-place SFTP `ext_openssh_rename` atomic-write helper.

The single load-bearing claim from the shape file — that Nina's tg-bridge stores each human's Matrix password on disk to re-log-in when the token dies — was **ground-truth-verified this session** against `/home/thenasty/.config/tg-bridge/bridge.sh` (see § Ground-truth verification). The `acred()` helper reads `<human>.cred` files and `relogin()` uses that plaintext password on any token death. The Phase 77 admin foundation genuinely removes this security surface.

**Primary recommendation:** Write a slim TypeScript wrapper around exactly 5 Synapse admin endpoints (create/update user, login-as-user, join room, make-room-admin, list rooms) using Node 22's built-in `fetch` — do NOT pull in `matrix-js-sdk` or `matrix-bot-sdk`. Mirror the byte-shape of the existing voice.ts fetch-wrapper pattern for error handling. Store the admin token in `FieldCrypto`-encrypted form on a new dedicated table `matrix_admin_creds` (single-row) rather than smuggling it into `settings` or `ssh_credentials`. Reuse the existing SFTP+`ext_openssh_rename` helper in `identity-artifact-reader.ts` verbatim for the `relay.json` write.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (Q1/Q2/Q3 from discuss-phase 2026-09-06)

**Q1 — Non-UI human-mxid registration mechanism: backend endpoint.** A new admin-gated Skynet backend endpoint (shape: `POST /users/:id/mxid { mxid: "@name:homeserver" }` or similar — planner's call on exact URL shape). Same endpoint handles both cases: the new-user provisioning runbook calls it once per new user, and the one-shot import for the three pre-existing hand-made accounts (Ashley, Zoe, Laura) is three calls against existing user rows. Consistent with Skynet's existing admin surface (`POST /users/create`, PATCH settings, admin cookie + TOTP gated). Rejected alternatives: (b) CLI script on the box, (c) config file entry per user.

**Q2 — Atomicity failure mode for Skynet-driven agent creation: partial tolerated + surface error, NO rollback.** The three-step sequence on the target host is: (1) write identity folder + `<name>.md` + frontmatter via SSH (existing Phase 66 pattern), (2) call Matrix admin API on the relay to create the account, (3) write `~/.claude/identities/<name>/relay.json` on the target host via SSH. If step 2 or 3 fails, Skynet does NOT roll back step 1. Rationale is a real race: agent-supervisor on the target host sees the on-disk identity folder as soon as step 1 lands and can start spinning up a tmux session for it before Skynet even knows step 2 or 3 failed. Rolling back the folder at that point would delete something the supervisor is already dealing with. The partial state is also already handled gracefully by the id skill's existing "carry on without relay.json, create it on next wake or by hand" failure mode. Rejected alternatives: (a) full rollback, (c) retry-with-backoff then fallback.

**Q3 — Where the human mxid mapping lives: new column on Skynet's users table.** New `mxid TEXT` column on the users table, alongside username / password hash / TOTP secret. Consistent with "users are Skynet's SQLite record"; mxid is an identifier (not a credential), so the disk-source-of-truth convention that governs agent relay creds doesn't apply the same way; small enough to be one column, not a new table. Rejected alternatives: (b) invent a new disk convention for humans, (c) separate SQLite table.

### Claude's Discretion (from CONTEXT.md)

- Exact URL shape for the human-mxid endpoint (`POST /users/:id/mxid` vs `PATCH /users/:id` vs other).
- Storage-slot design for the `@skynet-admin` credentials (new table vs new column vs settings row — CONTEXT.md says "encrypted-secrets pattern that holds host SSH keys today" but does NOT specify which of Skynet's several field-crypto-enabled tables to reuse).
- Retry surface shape for the partial-failure recovery (a Skynet retry route? a CLI on the box? re-invoke the birth endpoint? left explicitly open in CONTEXT.md).
- Whether Phase 77 splits into multiple sub-plans (CONTEXT.md: "If a natural split within Phase A becomes obvious during discuss-phase, decompose further at that time.").

### Deferred Ideas (OUT OF SCOPE)

- The Telegram bridge itself — Phase B.
- The identity modal Telegram section — Phase B.
- Federation between Skynet boxes or shared relays across deployments.
- A Skynet UI for the Matrix admin itself (room management, invite/kick, human moderation through Skynet).
- Any changes to how agents DM each other (existing relay path unchanged).
- A Skynet PWA or in-app notification story.
- **Any new frontend UI at all in Phase A.** Relay accounts are not a Skynet frontend affordance.
- Deletion propagation and rename propagation (deferred — Skynet has no identity-deletion or -rename surface today).
- Automated migration of legacy encrypted or frozen rooms.
- Reaching for the admin API to also manage the coordinator/actor dispatch mechanic.
</user_constraints>

<phase_requirements>
## Phase Requirements

Phase 77 has no explicit REQUIREMENTS.md IDs — the phase description in ROADMAP.md is the source, and the three locked decisions in CONTEXT.md govern implementation. Deriving requirement IDs from the shape's `§ Scope edges → In` list and the completion criterion:

| ID | Description | Research Support |
|----|-------------|------------------|
| MXA-01 | A Matrix admin client on the Skynet side that wraps the relay's admin API (`/_synapse/admin/v1` and `/v2`) | § Synapse admin API surface (verified live against `http://100.113.23.63:8008`); § Standard Stack (built-in fetch) |
| MXA-02 | Storage of `@skynet-admin` credentials in Skynet's existing encrypted-secrets pattern (single entry, only relay credential in Skynet's own storage) | § Storage design for admin credentials; § FieldCrypto pattern |
| MXA-03 | Skynet-driven agent creation propagates to relay-account creation via admin, writing `~/.claude/identities/<name>/relay.json` on the target host per fleet convention. Partial-tolerated (no rollback). | § Agent creation orchestration; § Identity birth orchestrator extension |
| MXA-04 | Admin-gated backend endpoint (mirroring `POST /users/create`) that registers an externally-created mxid against a Skynet user, landing it in a new `mxid` column. Same endpoint for provisioning runbook AND the three pre-existing imports (Ashley, Zoe, Laura). | § New `mxid` column migration; § Admin-guarded route pattern |
| MXA-05 | Skynet ability to force-manage any relay room via the admin API (join, make-room-admin) — the "cover legacy-room mess" capability. Wrapped in the admin client per MXA-01. | § Synapse admin API surface (verified: `POST /_synapse/admin/v1/join/<room>` and `POST /_synapse/admin/v1/rooms/<room>/make_room_admin`) |
| MXA-06 | The `substrate/skills/agent-relay/` skill body may need a light update to reflect Skynet's admin role once it lands (documented as optional in shape "Vehicle notes"). | § Documentation surface (deferrable to Phase B if scope pressure) |

**Failure-mode surface (from Q2 decision):** MXA-03 also implicitly requires a retry surface so a user whose step-2 or step-3 failed can retry. CONTEXT.md leaves the exact shape open (Skynet route? CLI? re-invoke birth endpoint?). See § Retry surface options.
</phase_requirements>

## Architectural Responsibility Map

Every capability in Phase 77 lives strictly in the Skynet backend tier — the shape explicitly forbids any frontend UI in Phase A.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Wrap Synapse admin API endpoints | API/Backend | — | Only the backend holds the admin token; browser must never see it |
| Store `@skynet-admin` credentials | Database/Storage | API/Backend | AES-encrypted SQLite is the existing storage tier for secrets; backend mediates all read/write |
| Add `mxid` column to `users` table | Database/Storage | — | Schema-only change; migration runs at backend boot in `migrateSchema()` |
| `POST /users/:id/mxid` endpoint | API/Backend | Database/Storage | New admin-gated route in `user-admin-routes.ts` or a sibling file |
| Mint agent relay account during birth | API/Backend | Target host (SSH+SFTP) | Extends existing `identity-birth-orchestrator` (already runs backend-side over SSH to target host) |
| Write `relay.json` to target host | API/Backend | Target host filesystem | Reuses existing SFTP `ext_openssh_rename` helper from `identity-artifact-reader.ts` |
| Update `substrate/skills/agent-relay/SKILL.md` docs | CDN/Static | — | Static file distributed by the fleet distributor; no runtime effect on Skynet itself |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node` builtin `fetch` (undici) | Node ≥ 22.12.0 | HTTP calls to `http://100.113.23.63:8008/_synapse/admin/*` | [VERIFIED: package.json] Node 24.15.0 in dev; project engines pin `>=22.12.0`. Native fetch is Skynet's established outbound-HTTP pattern (voice.ts:231, 314; users.ts:731; usage.ts:46; database.ts:209; pretty-view-fetch-tailnet-url.ts:222 all use it). No new dependency needed. |
| `express` | ^5.2.1 | New route(s): the mxid endpoint + optionally a retry endpoint | [VERIFIED: package.json] Existing framework — all route files use `express.Router()` |
| `drizzle-orm` | ^0.45.2 | New `mxid` column typing + `UPDATE users SET mxid=?` query | [VERIFIED: package.json] Existing ORM — schema.ts holds all `sqliteTable` definitions |
| `better-sqlite3` | 12.9.0 | Direct `ALTER TABLE users ADD COLUMN mxid TEXT` at boot via `addColumnIfNotExists()` | [VERIFIED: package.json] Existing driver — the boot-time migration pattern is fully in place |
| `ssh2` | ^1.17.0 | SFTP write of `relay.json` on the target host | [VERIFIED: package.json] Existing SSH library — `writeMarkdownFileAtomic()` in `identity-artifact-reader.ts:1849` already uses `sftp.ext_openssh_rename` (POSIX-atomic-overwrite) |
| `js-yaml` | (already in tree per identity-birth-orchestrator import) | If we choose to also refresh the identity `.md` frontmatter during birth (probably not needed for Phase A) | [CITED: identity-birth-orchestrator.ts:25] Only needed if we edit the pre-write body — no new install |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `FieldCrypto` (in-tree at `src/backend/utils/field-crypto.ts`) | — | AES-256-GCM at-rest encryption for the admin token column, keyed by the SystemCrypto encryption key | Use for the `@skynet-admin` access token AND password columns — mirrors how `users.totpSecret`, `users.passwordHash`, `ssh_data.password`, `ssh_credentials.privateKey` etc. are stored (see `ENCRYPTED_FIELDS` map in field-crypto.ts:17-46) |
| `DatabaseSaveTrigger` (in-tree at `src/backend/utils/database-save-trigger.ts`) | — | Persist RAM-SQLite writes to disk after schema mutations and row updates | Call `.triggerSave()` (debounced 2s) after regular row updates; call `.forceSave()` (immediate) after schema DDL. Wrap in try/catch per `host-autostart-routes.ts:173-181` precedent — non-fatal warn on failure. |
| `AuthManager.createAdminMiddleware()` (in-tree at `src/backend/utils/auth-manager.ts:969`) | — | Admin-gate the new mxid endpoint | Existing middleware — checks JWT cookie/Bearer, blocks `pendingTOTP:true`, verifies `users.isAdmin`. This is what CONTEXT.md calls "admin cookie + TOTP gated." Zero new middleware code needed. |
| `execCommand` (in-tree at `src/backend/ssh/tmux-helper.ts:21`) | — | The SSH channel for step-1 folder create AND the step-3 relay.json write pathway | Already used by identity-birth-orchestrator; signature `(conn: Client, command: string) => Promise<string>` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Built-in `fetch` for Synapse admin calls | `matrix-js-sdk` or `matrix-bot-sdk` | Both are large TypeScript SDKs (matrix-js-sdk pulls in olm/e2ee tooling by default). We need exactly 5 endpoints; fetch + a ~150-line typed wrapper is dramatically less surface. **Rejected — do not add.** |
| A new `matrix_admin_creds` single-row table | Storing token in `settings` table as `{key:'matrix_admin_token',value:<encrypted>}` | `settings` has no field-crypto entry; adding `matrix_admin_token` to `ENCRYPTED_FIELDS` for settings would encrypt only that one column — but the `settings` value is a plain TEXT and `FieldCrypto` decrypt requires the field name at read time, which settings.value doesn't hint at. A dedicated table with named columns (`user_id`, `access_token`, `password`, `homeserver_base`) is cleaner and the encryption map declares exactly which cols encrypt. Alternative: reuse `ssh_credentials` table (userId + password + key columns exist already) — but semantics don't match (this credential is Skynet's own, not tied to a user, and it's a Matrix access token not an SSH key). **Recommend new table.** |
| A new `matrix_admin_creds` table | New column on `users` table for the ONE admin user | The admin credential is not tied to a Skynet user account — it's a Skynet-instance-wide credential. Attaching it to a user row would be a semantic lie. **Recommend new table.** |
| `POST /users/:id/mxid` | `PATCH /users/:id { mxid }` | PATCH implies a general user-patch endpoint that doesn't exist. A dedicated verb-noun route `POST /users/:id/mxid` matches the existing `POST /users/make-admin`, `POST /users/remove-admin`, `POST /users/logout` pattern in the same router. **Recommend dedicated route.** |

**Installation:** No new npm packages required. All dependencies are already in `package.json`.

**Version verification:**
```bash
node -v                                    # v24.15.0 (>= 22.12.0 required) [VERIFIED]
grep '"better-sqlite3":' package.json      # 12.9.0 [VERIFIED]
grep '"drizzle-orm":'    package.json      # ^0.45.2 [VERIFIED]
grep '"express":'        package.json      # ^5.2.1 [VERIFIED]
grep '"ssh2":'           package.json      # ^1.17.0 [VERIFIED]
curl -s http://100.113.23.63:8008/_synapse/admin/v1/server_version   # {"server_version":"1.157.2"} [VERIFIED live 2026-09-06]
```

## Package Legitimacy Audit

Phase 77 installs **zero new packages** — every dependency is already in `package.json`. slopcheck was not run because there is nothing to check.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| — | — | — | — | — | — | No new packages proposed for Phase 77 |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                                    ┌─────────────────────────────────────┐
                                    │  Skynet Backend (Express, port      │
                                    │  30001, inside Docker on t1000)     │
                                    │                                     │
  Runbook / curl ──POST /users/     │  ┌───────────────────────────────┐  │
  (human mxid    :id/mxid ─admin──▶ │  │  user-admin-routes.ts (new    │  │
  provisioning)  cookie+TOTP─────── │  │  handler)                     │  │
                                    │  │    ├─ validate mxid format    │  │
                                    │  │    ├─ UPDATE users SET mxid=? │  │
                                    │  │    └─ DatabaseSaveTrigger     │  │
                                    │  │       .triggerSave() (try/    │  │
                                    │  │       catch, non-fatal warn)  │  │
                                    │  └───────────────────────────────┘  │
                                    │                                     │
  Skynet birth   POST /identities/  │  ┌───────────────────────────────┐  │
  UI / API ────▶ birth (existing) ▶ │  │  identity-birth-orchestrator  │  │
                                    │  │  (existing 5-step + new       │  │
                                    │  │   step 2.75 or step 6:        │  │
                                    │  │                               │  │
                                    │  │   1. On-disk collision probe  │  │
                                    │  │   2. mkdir + tmux + .md pre-  │  │
                                    │  │      write (SSH+SFTP)         │  │
                                    │  │   2.5. avatar write           │  │
                                    │  │  ─────── NEW STEPS ─────────  │  │
                                    │  │   6. matrixAdminClient        │  │
                                    │  │      .createUser(mxid, pw) ─┐ │  │
                                    │  │   7. relay.json build       │ │  │
                                    │  │   8. SFTP write             │ │  │
                                    │  │      writeMarkdownFileAtomic│ │  │
                                    │  │      (existing helper) ─────┼─┤  │
                                    │  │  ─── partial-tolerated ─────┘ │  │
                                    │  │   3-5. Claude harness (as-is) │  │
                                    │  └────────────────┬──────────────┘  │
                                    │                   │                 │
                                    │  ┌────────────────┴──────────────┐  │
                                    │  │  matrix-admin-client.ts (NEW) │  │
                                    │  │    ├─ createOrUpdateUser()    │  │
                                    │  │    ├─ loginAsUser()           │  │
                                    │  │    ├─ joinRoom()              │  │
                                    │  │    ├─ makeRoomAdmin()         │  │
                                    │  │    └─ listRooms()             │  │
                                    │  │  (Node fetch, admin token     │  │
                                    │  │   loaded lazily from DB)      │  │
                                    │  └────────────────┬──────────────┘  │
                                    │                   │                 │
                                    │  ┌────────────────┴──────────────┐  │
                                    │  │  matrix_admin_creds table     │  │
                                    │  │  (NEW single-row, FieldCrypto │  │
                                    │  │   encrypted access_token +    │  │
                                    │  │   password columns)           │  │
                                    │  └───────────────────────────────┘  │
                                    │                                     │
                                    │  ┌───────────────────────────────┐  │
                                    │  │  users table (existing) +     │  │
                                    │  │  NEW column mxid TEXT         │  │
                                    │  │  addColumnIfNotExists() in    │  │
                                    │  │  migrateSchema() at boot      │  │
                                    │  └───────────────────────────────┘  │
                                    │                                     │
                                    │  ┌───────────────────────────────┐  │
                                    │  │  ssh2 SFTP (existing)         │  │
                                    │  │  writeMarkdownFileAtomic()    │  │
                                    │  │  ext_openssh_rename pattern   │  │
                                    │  └────────────────┬──────────────┘  │
                                    └───────────────────┼─────────────────┘
                                                        │  (SSH+SFTP)
                                                        ▼
   ┌────────────────────────────────────┐   ┌────────────────────────────────────┐
   │  Synapse relay @ thenasty (tailnet │   │  Target fleet host (via tailnet)   │
   │  100.113.23.63:8008)               │   │                                    │
   │                                    │   │  ~/.claude/identities/<name>/      │
   │  /_synapse/admin/v2/users/<uid>    │   │    ├── <name>.md   (step 2 write)  │
   │  /_synapse/admin/v1/users/<uid>/   │   │    ├── <name>.png  (step 2.5)      │
   │       login                        │   │    ├── relay.json  (NEW step 8)    │
   │  /_synapse/admin/v1/join/<room>    │   │    ├── handoff.md                  │
   │  /_synapse/admin/v1/rooms/<room>/  │   │    └── wakeups/                    │
   │       make_room_admin              │   │                                    │
   │  /_synapse/admin/v1/rooms          │   │  → agent-supervisor detects folder │
   │                                    │   │    within seconds, may spin tmux   │
   │  Auth: Bearer syt_... (skynet-     │   │    session BEFORE step 6/8 finish  │
   │  admin token, admin=true verified) │   │    (this is the Q2 race)          │
   └────────────────────────────────────┘   └────────────────────────────────────┘
```

### Recommended Project Structure

Additive; every new file slots into existing directories:

```
src/backend/
├── database/
│   ├── db/
│   │   └── schema.ts                       # +1 column: users.mxid TEXT
│   │                                       # +1 table: matrixAdminCreds
│   ├── routes/
│   │   ├── user-admin-routes.ts            # +1 handler: POST /:id/mxid
│   │   ├── identity-birth-orchestrator.ts  # +2 steps in birthIdentity()
│   │   ├── identity-birth.ts               # +1 dep injection: matrixAdminClient
│   │   └── matrix-admin-routes.ts          # (OPTIONAL new file — retry endpoint)
│   └── database.ts                         # no new mount (POST /:id/mxid inherits
│                                           # from existing app.use("/users", ...))
├── matrix/                                 # NEW subdirectory
│   ├── matrix-admin-client.ts              # ~150 lines — fetch wrapper
│   ├── matrix-admin-client.test.ts         # unit tests
│   └── matrix-admin-creds-store.ts         # thin store: load/save/decrypt
├── claude-session/
│   └── identity-artifact-reader.ts         # no changes — writeMarkdownFileAtomic
│                                           # already handles relay.json shape
└── utils/
    └── field-crypto.ts                     # +1 entry in ENCRYPTED_FIELDS:
                                            #   matrix_admin_creds: {access_token,
                                            #   password}
```

### Pattern 1: FieldCrypto for the admin credential

**What:** Skynet already encrypts high-sensitivity columns (passwords, TOTP secrets, SSH keys) at the column level using `FieldCrypto.encryptField/decryptField` keyed by `SystemCrypto.getEncryptionKey()` — an instance-wide AES-256-GCM master key persisted to `.env`.

**When to use:** Any new persistent secret that Skynet's backend owns. The `@skynet-admin` access token and password both qualify.

**Example:**
```typescript
// Source: src/backend/utils/field-crypto.ts:17-46 — declare which columns encrypt
private static readonly ENCRYPTED_FIELDS = {
  users: new Set(["passwordHash", "clientSecret", "totpSecret", ...]),
  ssh_data: new Set(["password", "key", "keyPassword", ...]),
  // NEW for Phase 77:
  matrix_admin_creds: new Set(["accessToken", "password"]),
};

// On write, per lazy-field-encryption.ts pattern — write plaintext to DB,
// LazyFieldEncryption background-sweeps and encrypts. On read, safeGetFieldValue
// decrypts if the stored value looks like FieldCrypto JSON, else returns plaintext.
```

### Pattern 2: Admin-gated endpoint mirror of `POST /users/make-admin`

**What:** The existing `AuthManager.createAdminMiddleware()` provides JWT verification + `pendingTOTP` block + `users.isAdmin` check in one function.

**When to use:** Any new endpoint that only site-admins may call — the mxid registration endpoint qualifies.

**Example:**
```typescript
// Source: src/backend/database/routes/users.ts:48-49 + user-admin-routes.ts:1-16
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireAdmin = authManager.createAdminMiddleware();

// New handler — mirrors POST /users/make-admin shape (user-admin-routes.ts:137-212)
router.post("/:id/mxid", requireAdmin, async (req, res) => {
  const targetId = req.params.id;
  const { mxid } = req.body;
  if (typeof mxid !== "string" || !MXID_RE.test(mxid)) {
    return res.status(400).json({ error: "mxid must match @localpart:server" });
  }
  await db.update(users).set({ mxid }).where(eq(users.id, targetId));
  try {
    const { saveMemoryDatabaseToFile } = await import("../db/index.js");
    await saveMemoryDatabaseToFile();
  } catch (saveError) {
    authLogger.warn("Failed to persist mxid to disk", { operation: "mxid_save_failed", targetId });
  }
  res.json({ ok: true });
});
```

### Pattern 3: Native `fetch` HTTP wrapper (matches voice.ts:231 shape)

**What:** Node 22 has built-in fetch; Skynet uses it for every backend→backend HTTP call (voice/speak, voice/speak-stream, OIDC discovery, usage collector, pretty-view tailnet fetches). Standard shape: `AbortController` for timeouts, structured logging, non-2xx as `{error, status}` — never leak upstream body.

**When to use:** All Synapse admin API calls.

**Example:**
```typescript
// Source: src/backend/database/routes/voice.ts:226-274 — verified pattern
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 30_000);
try {
  const response = await fetch(`${SYNAPSE_BASE}/_synapse/admin/v2/users/${encodeURIComponent(mxid)}`, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password, admin: false }),
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
  return { ok: false, status: 502, error: "admin_api_proxy_error" };
}
```

### Pattern 4: SFTP tmp+rename atomic write (verbatim reuse for `relay.json`)

**What:** `writeMarkdownFileAtomic` in `identity-artifact-reader.ts:1849-1903` writes a file via SFTP, tmp+rename via `ext_openssh_rename` (posix-rename@openssh.com extension) for atomic overwrite. String-payload version.

**When to use:** The step-8 write of `~/.claude/identities/<name>/relay.json`. `relay.json` is a small JSON string — string payload is fine, no need for the binary sibling helper.

**Example:**
```typescript
// Source: src/backend/claude-session/identity-artifact-reader.ts:1849-1903
// Just reuse the exported helper verbatim; no new SFTP code:
const relayJsonPath = `${remoteHome}/.claude/identities/${opts.name}/relay.json`;
const relayJsonBody = JSON.stringify({
  base: `http://${SYNAPSE_HOST}:8008/_matrix/client/v3`,
  user_id: mintedMxid,
  password: agentPassword,     // The password Skynet generated + sent to Synapse
  token: mintedAccessToken,    // From the admin-mint response
  access_token: mintedAccessToken,  // recv.sh reads either `token` or `access_token`
}, null, 2);
await writeMarkdownFileAtomic(conn, relayJsonPath, relayJsonBody);
// Note: filename ends .json but writeMarkdownFileAtomic is content-agnostic —
// its name reflects historical caller, not a format constraint.
```

### Pattern 5: Schema migration via `addColumnIfNotExists`

**What:** `src/backend/database/db/index.ts:634-659` — probes column existence via `SELECT col FROM table LIMIT 1`, adds via `ALTER TABLE ... ADD COLUMN` on the throw. Idempotent. Called from `migrateSchema()` at boot before any route serves traffic.

**When to use:** Adding the `mxid` column to `users`, and — if the planner picks the new-table approach — the CREATE TABLE for `matrix_admin_creds` goes into the `CREATE TABLE IF NOT EXISTS` block at `index.ts:150-540ish` (same file, earlier section).

**Example:**
```typescript
// Source: src/backend/database/db/index.ts:823-853 (users column adds)
addColumnIfNotExists("users", "mxid", "TEXT");
```

For the NEW table, mirror this pattern from index.ts (users table):
```typescript
// Source: src/backend/database/db/index.ts:150-170 (users CREATE TABLE)
CREATE TABLE IF NOT EXISTS matrix_admin_creds (
  id INTEGER PRIMARY KEY,       -- singleton row, id=1 by convention
  homeserver_base TEXT NOT NULL,
  user_id TEXT NOT NULL,
  access_token TEXT NOT NULL,    -- FieldCrypto-encrypted
  password TEXT NOT NULL,        -- FieldCrypto-encrypted (for re-login self-heal)
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Also declare the Drizzle schema in `schema.ts`:
```typescript
export const matrixAdminCreds = sqliteTable("matrix_admin_creds", {
  id: integer("id").primaryKey(),
  homeserverBase: text("homeserver_base").notNull(),
  userId: text("user_id").notNull(),
  accessToken: text("access_token").notNull(),
  password: text("password").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
```

### Anti-Patterns to Avoid

- **Storing the admin token in `.env`:** Would work but hides it from the encrypted-secrets convention and makes rotation harder. `SystemCrypto` puts the master ENCRYPTION_KEY there; that key protects everything else. The admin token is a secondary secret and belongs in the encrypted DB.
- **Reaching for `matrix-js-sdk` or `matrix-bot-sdk`:** Both are large and pull in e2ee tooling by default. We only need 5 endpoints and admin-token auth (no login round-trips, no e2ee). See voice.ts precedent for the fetch-wrapper style.
- **Rolling back step 1 (identity folder) on step-2/step-3 failure:** Q2 explicitly forbids this. The agent-supervisor race is real — deleting a folder the supervisor is already spinning up on is worse than leaving a partial state.
- **Reusing `ssh_credentials` table for the admin credential:** Semantically wrong — that table is `.userId → users.id` FK-scoped, and the credential type is not SSH. A new table is clearer.
- **Storing agent relay creds in Skynet DB in addition to on-disk:** Explicitly forbidden by the shape ("Skynet does NOT duplicate these anywhere else"). Disk is sole source of truth for agent relay creds per Phase 69's philosophy.
- **Skipping `DatabaseSaveTrigger.forceSave()` after schema DDL:** SQLite runs in RAM in Skynet; direct `sqlite.exec()` writes only reach RAM. See `index.ts:809-821` for the correct pattern with try/catch (non-fatal, DROP is idempotent, retry next boot).
- **Interpolating `mxid` into shell/URL without validation:** The mxid arrives from user input over HTTP. Regex-gate `^@[a-z0-9._=/+-]+:[a-z0-9.-]+$` BEFORE any shell/URL/DB interpolation. Precedent: Phase 69's `IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/` post-review security fix (STATE.md line 547).
- **Sending the admin-minted human password over the wire ever again after it's set:** For agent accounts, we DO store the password in the on-disk `relay.json` (recv.sh re-logs-in with it — see agent-relay/recv.sh:52-59). That's the fleet convention. For HUMANS, we NEVER know the password — we only mint access tokens on demand (Synapse's `POST /_synapse/admin/v1/users/<uid>/login` returns a token with no password required, exactly what the admin foundation exists to enable).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Column-level encryption | Custom AES wrapper | `FieldCrypto` at `src/backend/utils/field-crypto.ts` | Already handles HKDF key derivation per record, AES-256-GCM with auth tag, lazy-migration of plaintext-to-encrypted values. Just declare the columns in `ENCRYPTED_FIELDS`. |
| Admin authentication | Custom cookie/TOTP check | `AuthManager.createAdminMiddleware()` at `src/backend/utils/auth-manager.ts:969` | Verified pattern used by every admin-gated route. Handles JWT + pendingTOTP block + isAdmin lookup + logging. |
| SFTP file write with atomic overwrite | Custom `sftp.rename` code | `writeMarkdownFileAtomic()` at `src/backend/claude-session/identity-artifact-reader.ts:1849` | Uses `ext_openssh_rename` (posix-rename@openssh.com) — plain `sftp.rename` can't atomically overwrite existing files (quick 260802-qrw root-cause). Includes tmp-file cleanup on error. |
| SQLite schema migration | Custom migration file loader | `addColumnIfNotExists()` at `src/backend/database/db/index.ts:634` + `CREATE TABLE IF NOT EXISTS` at index.ts:150+ | Idempotent boot-time pattern — no migration files, no versioned steps. Just call it. Preflight assertion helper `assertSqliteSupportsDropColumn` exists too if we ever need `DROP`. |
| Persistence trigger after DB writes | Manual `.exec("VACUUM INTO...")` | `DatabaseSaveTrigger.triggerSave()` / `.forceSave()` at `src/backend/utils/database-save-trigger.ts` | The 2s-debounced version handles bursty writes; force-save is for critical mutations. Both no-op safely when not initialized (first-boot race). |
| Matrix client SDK | `matrix-js-sdk` / `matrix-bot-sdk` | Native `fetch` (Node 22 built-in) | We use 5 endpoints, admin-token auth only, no e2ee. A ~150-line wrapper is smaller than the SDK's peer deps. Every other outbound HTTP call in Skynet uses fetch. |
| SSH exec channel | New `spawn ssh` subprocess | `execCommand(conn, cmd)` from `src/backend/ssh/tmux-helper.ts:21` + `connectOneShot()` from `src/backend/ssh/ssh-one-shot.ts` | Existing ssh2 abstraction, connection pool, timeout handling. Already used by identity-birth-orchestrator for the identity folder + tmux create. |
| Nonce-based Synapse registration | `GET /_synapse/admin/v1/register` + HMAC-SHA1 dance with `registration_shared_secret` | `PUT /_synapse/admin/v2/users/<mxid>` | Puppet API is token-authed, idempotent (same PUT updates existing users), and returns 201/200. Nonce+HMAC only needed when bootstrapping without an admin token. We HAVE the token. |

**Key insight:** Almost every piece of Phase 77 is composition of existing Skynet primitives. The only genuinely new code is the ~150-line Matrix admin client (a thin fetch wrapper) and the ~50-line orchestrator-extension for the two new birth steps. Nothing warrants a subsystem-scale build.

## Runtime State Inventory

Phase 77 is additive — not a rename or refactor — but it introduces new runtime state, so this table documents what lives where after Phase 77 ships.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | (1) NEW `matrix_admin_creds` row (single) in encrypted SQLite, holding `@skynet-admin` access_token + password. (2) NEW `users.mxid` column populated as runbook/import runs against existing 3 users + all future users. | Initial-population runbook needed for the 3 pre-existing accounts (Ashley, Zoe, Laura) — 3 admin-gated POST calls. `credentials.txt` in the bounty folder is the source. |
| Live service config | (1) `@skynet-admin` account on Synapse @ thenasty. Already exists (verified `admin:true` 2026-09-06). (2) The 3 pre-existing human Matrix accounts (Ashley, Zoe, Laura). Already exist. (3) Nina's tg-bridge at `/home/thenasty/.config/tg-bridge/bridge.sh` — untouched in Phase A; still runs its old flow (per-human `.cred` files). | None in Phase A. Bridge behavior stays as-is until Phase B. |
| OS-registered state | None. Phase 77 does not register any new systemd unit, cron entry, or Task Scheduler task on any box. The Skynet backend + Docker + Caddy infra is unchanged. | None. |
| Secrets/env vars | (1) The admin token + password are moving OUT of `credentials.txt` (bounty folder, chmod 600, hand-parked by Nicole) INTO Skynet's encrypted DB. `credentials.txt` can be zeroed/deleted after ingestion. (2) No new env vars added — `SystemCrypto.getEncryptionKey()` already covers the master key for field-crypto. | Bounty wind-down (per bounty.json todo #7) can proceed after ingestion is confirmed. |
| Build artifacts / installed packages | None. No new npm dependencies. `npm ci && npm run build` produces the same artifact shape. | None. |

**Nothing found in category:** All 5 categories answered explicitly.

## Common Pitfalls

### Pitfall 1: Nginx location block for `POST /users/:id/mxid` — already covered by `/users(/.*)?$`

**What goes wrong:** CLAUDE.md's "Nginx caveat" warns that every new backend route needs matching `location` blocks in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`, else the route 200s with `index.html` and crashes the frontend on `.map`.

**Why it happens:** The catch-all `location /` block serves the SPA HTML; missing specific `location` blocks fall through to it.

**How to avoid:** For `POST /users/:id/mxid`, this is already covered by the existing `location ~ ^/users(/.*)?$` regex in both `docker/nginx.conf:142-151` and `docker/nginx-https.conf` — verified 2026-09-06. **No nginx changes needed** for the mxid route.

If the planner adds a *new* base path (e.g., `/matrix-admin/retry` for the failure-mode retry surface), THAT would need new location blocks in both files. Recommendation: **mount the retry route under `/users/:id/relay-retry` or `/identities/:key/relay-retry`** to inherit existing nginx coverage. Both base paths (`/users`, `/identities`) already have proxy blocks in both nginx confs.

**Warning signs:** Frontend crash on the very first `.map` request after deploy; `curl -si https://term.gigaashley.click/newroute/foo | head -1` returns `200 OK` with `text/html` when the backend was supposed to answer.

### Pitfall 2: `mxid` regex validation must precede any interpolation

**What goes wrong:** An adversarial mxid like `@evil:server; DROP TABLE users;--` could be interpolated into a shell command (if the mxid ever reaches SSH) or into a URL path (Synapse admin endpoints).

**Why it happens:** The mxid is user input on `POST /users/:id/mxid`. Even though admin-gated (an admin user won't attack themselves), Phase 69's post-review found a real path-traversal in the `:identityKey` route param that reached `readIdentityFile/writeIdentityFile` and SSH `rm -f` (STATE.md line 547 — the security fix Nicole added). Same class of risk here.

**How to avoid:** Regex-gate BEFORE any use. Recommended: `MXID_RE = /^@[a-z0-9._=/+-]{1,255}:[a-z0-9.-]{1,255}$/`. Matches the Matrix spec's localpart character set (`[a-z0-9._=/+-]` per agent-relay/SKILL.md:148) and a conservative server-name character set. Reject on regex fail at the route-handler entry, before touching DB or Synapse.

**Warning signs:** Any code path that concatenates `mxid` into a shell command string, a URL path, or a SQL fragment without going through Drizzle's parameterized query builder.

### Pitfall 3: `DatabaseSaveTrigger.forceSave` may not be initialized on first boot

**What goes wrong:** Skynet's SQLite runs in RAM; `forceSave` persists RAM to the encrypted file. On first boot, `handlePostInitFileEncryption` wires the trigger AFTER `migrateSchema()` returns, so a `forceSave` call during migration would find `isInitialized === false`.

**Why it happens:** Initialization order — `migrateSchema()` runs before the save-trigger wire-up.

**How to avoid:** Wrap ALL `forceSave` / `triggerSave` calls in try/catch and log-warn on failure. Precedent: `index.ts:810-821` for schema-mutation persists, `host-autostart-routes.ts:173-181` for row-update persists. The trigger no-ops safely when uninitialized (see `database-save-trigger.ts:26-32`) — the failure path is a `databaseLogger.warn` inside the trigger, but a robust caller still catches.

**Warning signs:** Log messages like "Database save trigger not initialized" on the first container boot after a migration is added. Non-fatal — retries persist on next mutation.

### Pitfall 4: Non-ASCII bytes in identity name / mxid / room name mangled via curl `-d`

**What goes wrong:** The agent-relay SKILL.md documents at length (SKILL.md:257-268) that curl on Windows/Git-Bash silently drops multi-byte UTF-8 when `LANG` is unset and you pass a JSON body with `-d "..."`. Matrix homeserver answers `200 OK` and creates a mangled room / user.

**Why it happens:** argv is round-tripped through a single-byte path.

**How to avoid:** In our case, Skynet backend runs on Linux inside Docker with `LANG=C.UTF-8` (verify) and uses Node's `fetch` which handles UTF-8 correctly via `JSON.stringify`. **This trap does not apply to Skynet's Node backend** — but flag it as a nearby-related pitfall for anyone extending the client with curl-based diagnostic tooling.

**Warning signs:** N/A for our path; kept for completeness because the codebase's neighboring skill devotes real page-space to this class.

### Pitfall 5: The `Synapse admin` API's `PUT /users/<uid>` returns 200 for update, 201 for create

**What goes wrong:** Callers that check for `response.status === 201` to mean "user was newly created" will silently mis-branch on updates.

**Why it happens:** The endpoint is intentionally idempotent — same call creates or updates. HTTP semantics distinguishes the two via 201 vs 200. Documented at [Element-hq Synapse admin docs](https://element-hq.github.io/synapse/latest/admin_api/user_admin_api.html).

**How to avoid:** Treat 200 AND 201 both as success. For the birth flow, we probably don't care to distinguish (the account is now in the desired state either way). For the failure-mode retry, use `response.status === 201` as a signal that "the account did not previously exist" if we ever want that.

**Warning signs:** Debug log line saying "user created" when the user already existed; a subsequent flow that checks "does user exist" as a pre-step and gets confused.

### Pitfall 6: agent-supervisor race between step 1 (folder create) and step 8 (relay.json write)

**What goes wrong:** After step 1 (folder on target host), `agent-supervisor.sh` sees the folder and can start a tmux session for the agent within seconds. If step 6 (mint via admin) or step 8 (write `relay.json`) fails, the supervisor is already dealing with a partial identity. Rollback would race the supervisor.

**Why it happens:** The supervisor's reconcile loop polls on-disk state.

**How to avoid:** This is the Q2 decision — DO NOT roll back. Surface a "not relay-reachable" error and let the id skill's existing "carry on without relay.json, register self on first wake" path handle it (agent-relay/SKILL.md:65-87 — the `if relay.json exists → use it, else register` branch). The retry surface (see § Retry surface options) is a *fresh* admin-mint + write, not a rollback.

**Warning signs:** Any code in the orchestrator that tries to `rm -rf` the identity folder in a catch block.

## Code Examples

### Example 1: Full Matrix admin client — the `createOrUpdateUser` primitive

```typescript
// src/backend/matrix/matrix-admin-client.ts
// Source: verified against https://element-hq.github.io/synapse/latest/admin_api/user_admin_api.html
//         and live test 2026-09-06 against http://100.113.23.63:8008 (Synapse 1.157.2)

import { getMatrixAdminCreds } from "./matrix-admin-creds-store.js";
import { databaseLogger } from "../utils/logger.js";

interface AdminMintResult {
  ok: true;
  mxid: string;
  password: string;
  accessToken?: string;   // Only present if we chose to login-as-user in the same flow
} | {
  ok: false;
  status: number;
  error: string;
}

const REQUEST_TIMEOUT_MS = 30_000;

export async function createOrUpdateUser(mxid: string, password: string): Promise<AdminMintResult> {
  const creds = await getMatrixAdminCreds();
  if (!creds) return { ok: false, status: 500, error: "matrix_admin_creds_missing" };

  const url = `${creds.homeserverBase}/_synapse/admin/v2/users/${encodeURIComponent(mxid)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
      databaseLogger.warn(`matrix admin createOrUpdateUser non-2xx`, {
        operation: "matrix_admin_create_user",
        mxid, status: response.status,
      });
      return { ok: false, status: response.status, error: "admin_api_non_2xx" };
    }
    return { ok: true, mxid, password };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, status: 504, error: "admin_api_timeout" };
    }
    databaseLogger.error(`matrix admin createOrUpdateUser proxy error`, err, {
      operation: "matrix_admin_create_user_proxy", mxid,
    });
    return { ok: false, status: 502, error: "admin_api_proxy_error" };
  }
}
```

### Example 2: The `loginAsUser` primitive (mint access token for a human on inbound bridge traffic)

```typescript
// src/backend/matrix/matrix-admin-client.ts (continued)
// Source: verified https://element-hq.github.io/synapse/latest/admin_api/user_admin_api.html
//         (§ "Login as a user")

export async function loginAsUser(mxid: string, validUntilMs?: number): Promise<{ ok: true; accessToken: string } | { ok: false; status: number; error: string }> {
  const creds = await getMatrixAdminCreds();
  if (!creds) return { ok: false, status: 500, error: "matrix_admin_creds_missing" };

  const url = `${creds.homeserverBase}/_synapse/admin/v1/users/${encodeURIComponent(mxid)}/login`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validUntilMs ? { valid_until_ms: validUntilMs } : {}),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) return { ok: false, status: response.status, error: "admin_api_non_2xx" };
    const body = await response.json() as { access_token?: string };
    if (!body.access_token) return { ok: false, status: 500, error: "admin_api_no_token" };
    return { ok: true, accessToken: body.access_token };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") return { ok: false, status: 504, error: "admin_api_timeout" };
    return { ok: false, status: 502, error: "admin_api_proxy_error" };
  }
}
```

### Example 3: `joinRoom` + `makeRoomAdmin` for legacy-room force-management

```typescript
// src/backend/matrix/matrix-admin-client.ts (continued)
// Sources: verified
//   https://element-hq.github.io/synapse/latest/admin_api/room_membership.html (join)
//   https://element-hq.github.io/synapse/latest/admin_api/rooms.html (make_room_admin)

export async function joinRoom(roomIdOrAlias: string, userId?: string): Promise<{ ok: true; roomId: string } | { ok: false; status: number; error: string }> {
  const creds = await getMatrixAdminCreds();
  if (!creds) return { ok: false, status: 500, error: "matrix_admin_creds_missing" };
  const targetUser = userId ?? creds.userId;   // default: admin joins themselves

  const url = `${creds.homeserverBase}/_synapse/admin/v1/join/${encodeURIComponent(roomIdOrAlias)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: targetUser }),
  });
  if (!response.ok) return { ok: false, status: response.status, error: "admin_api_non_2xx" };
  const body = await response.json() as { room_id: string };
  return { ok: true, roomId: body.room_id };
}

export async function makeRoomAdmin(roomIdOrAlias: string, userId?: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const creds = await getMatrixAdminCreds();
  if (!creds) return { ok: false, status: 500, error: "matrix_admin_creds_missing" };
  const targetUser = userId ?? creds.userId;

  const url = `${creds.homeserverBase}/_synapse/admin/v1/rooms/${encodeURIComponent(roomIdOrAlias)}/make_room_admin`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: targetUser }),
  });
  if (!response.ok) return { ok: false, status: response.status, error: "admin_api_non_2xx" };
  return { ok: true };
}
```

### Example 4: The exact shape of `relay.json` that recv.sh reads

```json
// Verified 2026-09-06 against ~/.claude/skills/agent-relay/recv.sh:25-32, 49-59, 82-91
// and agent-relay/SKILL.md:100-116 (relay.json format definition)
{
  "base":         "http://100.113.23.63:8008/_matrix/client/v3",
  "user_id":      "@<name>:thenasty.taild9b663.ts.net",
  "password":     "<agent-password-generated-by-Skynet>",
  "token":        "<access-token-from-admin-mint>",
  "access_token": "<access-token-from-admin-mint>"
}
```

**Notes on the shape:**
- `base` MUST end in `/_matrix/client/v3` — recv.sh's `MROOT="${BASE%/_matrix/*}"` (line 101) strips this to get the server root for media, and every other endpoint concatenates onto `BASE` directly. Do NOT drop the suffix.
- `user_id` is the FULL mxid `@localpart:server_name`. server_name is `thenasty.taild9b663.ts.net` (verified from the `whoami` call).
- Both `token` and `access_token` should be set to the same value. `cred token` in recv.sh reads via `jq -r --arg k "$1" '.[$k] // empty' "$CREDS"` — it doesn't check both keys; but the tg-bridge and other consumers vary. Writing both is defensive.
- `password` is REQUIRED for recv.sh's `relogin()` self-heal path (recv.sh:49-59). Without a password, a token death is unrecoverable and the agent goes silently deaf until manual repair (see recv.sh:53 fatal error message).
- File mode: chmod 600. Precedent: agent-relay/SKILL.md:105.

### Example 5: `POST /users/:id/mxid` handler

```typescript
// Recommended location: extend user-admin-routes.ts (same file that hosts make-admin/remove-admin)

const MXID_RE = /^@[a-z0-9._=/+-]{1,255}:[a-z0-9.-]{1,255}$/;

router.post("/:id/mxid", async (req, res) => {
  // Admin gate — mirror pattern from make-admin at user-admin-routes.ts:137-158
  const adminUserId = (req as AuthenticatedRequest).userId;
  const targetId = req.params.id;
  const { mxid } = req.body;

  if (typeof mxid !== "string" || !MXID_RE.test(mxid)) {
    return res.status(400).json({ error: "mxid must match @localpart:server_name" });
  }

  try {
    const adminUser = await db.select().from(users).where(eq(users.id, adminUserId));
    if (!adminUser?.[0]?.isAdmin) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const targetUser = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
    if (!targetUser || targetUser.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    await db.update(users).set({ mxid }).where(eq(users.id, targetId));

    // Persist RAM SQLite to disk — mirror host-autostart-routes.ts:173-181 pattern
    try {
      const { saveMemoryDatabaseToFile } = await import("../db/index.js");
      await saveMemoryDatabaseToFile();
    } catch (saveError) {
      authLogger.warn("Failed to persist mxid registration to disk", {
        operation: "mxid_save_failed", targetId,
      });
    }

    authLogger.info("mxid registered for user", {
      operation: "mxid_register", adminId: adminUserId, targetId, mxid,
    });
    res.json({ ok: true });
  } catch (err) {
    authLogger.error("Failed to register mxid", err);
    res.status(500).json({ error: "Failed to register mxid" });
  }
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Nonce+HMAC-SHA1 shared-secret registration (`GET /_synapse/admin/v1/register` + POST with mac digest) | Admin-token PUT `/_synapse/admin/v2/users/<uid>` (idempotent puppet API) | Available since Synapse ~1.20 (v2 puppet API), current on 1.157.2 | We use the puppet API. Nonce approach is only needed when bootstrapping without an admin (creating the first admin). We already have `@skynet-admin` with `admin:true` — use the token. |
| Continuwuity homeserver | Synapse 1.157.2 | "Earlier this year" per shape prior-context. Verified live 2026-09-06. | recv.sh has a specific Synapse-vs-Continuwuity workaround at line 219-225 (stale stream-token reset). For Phase 77's outbound admin calls, all endpoints are standard Synapse admin API — no Continuwuity legacy to worry about. |
| Nina's bridge stores each human's Matrix password on disk (`<human>.cred`) | Skynet admin mints tokens on demand via `POST /_synapse/admin/v1/users/<uid>/login` — no password storage anywhere | Enabled by Phase 77 (this phase) | Phase B (Telegram bridge substrate promotion) can consume the admin foundation and stop storing `.cred` files. Phase A itself does NOT modify the bridge — the shape defers that to B. |

**Deprecated/outdated:**
- Nothing in the Phase 77 scope is deprecated. Synapse admin API is stable and current.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The nginx `location ~ ^/users(/.*)?$` block will correctly proxy `POST /users/:id/mxid` to Express port 30001. | Pitfall 1 | Frontend crashes on `.map` requests after deploy. Mitigation: `curl -si https://term.gigaashley.click/users/xxx/mxid -X POST` sanity check post-deploy — expect 401/403/404 (backend response), NOT 200 with `text/html`. |
| A2 | Skynet backend container's locale is UTF-8 (so Node's fetch handles multi-byte cleanly). Not directly verified this session, but the docker/nginx.conf serves the branding template middleware which handles em-dashes fine per its purpose, implying UTF-8 is set. | Pitfall 4 | Room / user names with em-dashes / smart quotes may mangle. Very low risk (mxids are ASCII-only per regex; agent passwords are hex; nothing UTF-8 goes to the admin API). |
| A3 | `saveMemoryDatabaseToFile()` (imported dynamically in user-admin-routes.ts:187-188) is the correct persist function for the mxid write. It IS what the existing make-admin handler uses. | Example 5 | If naming is stale, fallback to `DatabaseSaveTrigger.triggerSave("mxid_register")` — same effect. |
| A4 | The birth orchestrator's step-numbering (currently 5 steps: 1-5, per BirthEvent type at identity-birth-orchestrator.ts:102-104) can be extended with steps 6-8 for the relay-account work without breaking the frontend BirthProgress checklist. This is a Phase 20 UI concern. | Diagram | Frontend UI won't render new steps until updated — but Phase A has no frontend UI in scope, so this is a Phase B concern. For Phase A, the new steps can piggyback on the existing 5-step SSE stream by extending the `n` type union or emitting extra events. Planner call. |
| A5 | `credentials.txt` in `~/.claude/roles/box-maintainer/bounties/skynet-matrix-admin-integration/` is chmod 600 as bounty.json claims. Not verified this session (readable by ubuntu — is that the same user Skynet runs as?). If Skynet runs in Docker as root or a different UID, the file needs to be readable at ingestion time by whatever user runs the ingestion command. | Runtime State Inventory | Ingestion fails with permission error. Trivial fix: `chmod 644` temporarily or ingest as root during deploy. |
| A6 | The `@skynet-admin` access token in `credentials.txt` (`syt_c2t5bmV0LWFkbWlu_bQoKSUaBUfPdyyKpRJIq_165W37`) is durable — Ashley's 2026-09-05 note in credentials.txt says "don't rotate." Verified admin=true on 2026-09-06. If Nicole ever rotates it, Skynet's stored copy goes dead and would need a re-ingestion. | Storage | Mitigation: keep the initial-population runbook (see below) so re-ingestion is a documented one-liner, not a firefighting session. |
| A7 | Node's built-in `fetch` handles all the Synapse admin API's response body sizes without needing streaming. Response bodies are all small JSON (user records < 1KB, room-list pages capped at limit). | Standard Stack | For `listRooms` with no `limit` cap, the response could grow large — the API has a total_rooms of a few hundred today. Add `?limit=200` on our calls as defensive default. |

**If this table is empty:** Not empty — 7 assumptions listed above. Planner and Ashley should review A4 (birth-orchestrator step numbering) and A5 (credentials.txt permissions) as they touch surfaces adjacent to Phase 77.

## Open Questions

1. **Retry surface shape (Q2 follow-on left open in CONTEXT.md)**
   - What we know: Q2 says NO rollback; the id skill's self-register path handles partial state gracefully.
   - What's unclear: If a Skynet admin wants to explicitly retry step 6/8 (because the agent is stuck on the id skill's self-register branch and can't recover), what surface do they use? Three options:
     - **(a) `POST /identities/:key/relay-retry`** on Skynet backend — admin-gated. Reads the identity name, resolves the target host, re-runs the admin-mint + relay.json write. Idempotent because the Synapse PUT is idempotent (200 update returns fresh password → we DO know the current password now, and write a fresh relay.json). Inherits existing `/identities` nginx block. **Recommended.**
     - **(b) CLI script on the target host** — `~/.claude/skills/id/retry-relay-register` — same as (a) but runs from the agent's own tmux session. Less discoverable, more distributed.
     - **(c) Re-invoke `POST /identities/birth`** — orchestrator detects existing folder in step 1 and short-circuits to just step 6+8. Overloads birth semantics; muddies the "step 1 = folder create" contract. Not recommended.
   - Recommendation: **(a)**. Small, discoverable, follows the existing admin route pattern.

2. **Should the admin-mint set a `displayname` matching the identity's display name?**
   - What we know: Synapse `PUT /users/<uid>` accepts an optional `displayname`. Some clients (Element) show displayname; recv.sh doesn't care.
   - What's unclear: Setting displayname = identity's `displayName` frontmatter value gives nicer Element rendering, but pulls that data across another interface. Cost is low.
   - Recommendation: **Yes, set it** — same PUT call, one extra JSON field. Consistent with id skill self-register behavior (which doesn't set displayname today, so this is actually an improvement over the baseline).

3. **How does Phase 77 handle a Skynet-driven agent whose target host is `isLocalHostId` (self-birth)?**
   - What we know: identity-birth-orchestrator.ts handles both remote and local branches, but the SFTP-based `writeMarkdownFileAtomic` runs only in the remote branch (line 517-593 gates on `!useLocal && conn`). Local-branch self-birth silently skips the pre-write per line 507-509.
   - What's unclear: When we add steps 6-8, does the local branch also need coverage? Or does self-birth remain out-of-scope (as it is for the identity file pre-write)?
   - Recommendation: **Mirror the existing decision — local-branch self-birth stays out-of-scope for the relay-account extension too**, matching the pre-Phase-22 skip pattern. Phase A's UAT focus is remote fleet hosts.

4. **Should the `matrix-admin-client.ts` use a class or a module of free functions?**
   - What we know: voice.ts uses free functions; Skynet's ssh subsystem uses classes (AuthManager, SharedCredentialManager, SystemCrypto — all singletons).
   - What's unclear: Style preference vs testability. Free functions are trivial to mock; a class-singleton is slightly harder.
   - Recommendation: **Free functions** — smaller, testable via vi.mock on `getMatrixAdminCreds`. No state needed beyond the credentials, which the store already owns.

5. **Should Phase 77 include tests for the Nina-bridge password-elimination claim, or is that a Phase B verification?**
   - What we know: The whole Phase 77 story is that once admin exists, the bridge stops needing per-human passwords on disk. But Phase A does NOT touch the bridge itself.
   - What's unclear: Do we need a Phase A test that PROVES the admin foundation is sufficient for Phase B's needs — e.g., a test that mints a fresh token via `loginAsUser` and uses it to send a message as that user?
   - Recommendation: **Include one end-to-end integration test** in Phase A that exercises `loginAsUser(mxid) → use returned token to send m.room.message → confirm the send lands`. This proves the admin foundation delivers what Phase B needs, and catches any admin-permission gotchas early. Runs against the live thenasty relay (or a mocked equivalent).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node runtime | All backend code | ✓ | v24.15.0 (engines require >= 22.12.0) | — |
| better-sqlite3 | Schema migrations + row queries | ✓ | 12.9.0 (in package.json) | — |
| ssh2 (SFTP) | Writing relay.json on target hosts | ✓ | ^1.17.0 (in package.json) | — |
| Synapse relay reachability | All Matrix admin API calls | ✓ | 1.157.2 (verified live at `http://100.113.23.63:8008` on 2026-09-06) | Docker network + tailnet must be up; verified from `t1000`. Deployments to other Skynet boxes would need matching tailnet setup. |
| `@skynet-admin` account with `admin:true` on Synapse | Every admin API call | ✓ | Verified live on 2026-09-06 (creation_ts: 1788582003) | If token dies, `credentials.txt` has the password — mint a fresh token via `POST /_matrix/client/v3/login`. |
| curl on developer box (for verification during dev) | Ad-hoc admin API testing | ✓ | — | — |
| `credentials.txt` file exists | Initial ingestion at Phase 77 deploy | ✓ | Verified — parked by Nicole 2026-09-05 in the bounty folder | If somehow lost, Nicole can re-mint. Skynet only needs the token once — after ingestion, `credentials.txt` is redundant. |

**Missing dependencies with no fallback:** none.

**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.8 |
| Config file | `vitest.config.ts` (root of repo — verified exists per test-runner scripts in package.json) |
| Quick run command | `npx vitest run src/backend/matrix/` (once we create that dir) |
| Full suite command | `npm test` (== `vitest run`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MXA-01 | Matrix admin client `createOrUpdateUser` returns `{ok:true}` on 200/201, `{ok:false, status, error}` on non-2xx / timeout | unit (mock fetch) | `npx vitest run src/backend/matrix/matrix-admin-client.test.ts` | ❌ Wave 0 |
| MXA-01 | `loginAsUser` returns access_token on 200, error on 4xx | unit (mock fetch) | ↑ same | ❌ Wave 0 |
| MXA-01 | `joinRoom` + `makeRoomAdmin` succeed with admin token | unit (mock fetch) | ↑ same | ❌ Wave 0 |
| MXA-01 (integration) | Real Synapse relay accepts the client's calls end-to-end | integration | `npx vitest run src/backend/matrix/matrix-admin-client.integration.test.ts` — gated behind `INTEGRATION_TESTS=1` env flag | ❌ Wave 0 |
| MXA-02 | Admin credentials round-trip through encrypted DB (write → read → decrypt matches) | unit (in-memory better-sqlite3) | `npx vitest run src/backend/matrix/matrix-admin-creds-store.test.ts` | ❌ Wave 0 |
| MXA-02 | Migration idempotently adds `matrix_admin_creds` table + `users.mxid` column | unit | `npx vitest run src/backend/database/db/index.migration.test.ts` — extend existing file | ✅ (add cases) |
| MXA-03 | Extended birth orchestrator with steps 6-8 succeeds happy-path (mocked admin client) | unit | `npx vitest run src/backend/database/routes/identity-birth-orchestrator.test.ts` — extend existing | ✅ (add cases; file exists per pattern) |
| MXA-03 | Step-2 success + step-6 admin-mint failure → orchestrator emits `step:6:failed`, `ended{ok:false}`, does NOT roll back folder | unit | ↑ same | ✅ (add case) |
| MXA-03 | Step-6 success + step-8 SFTP failure → same partial-tolerated shape | unit | ↑ same | ✅ (add case) |
| MXA-04 | `POST /users/:id/mxid` admin-gated (403 for non-admin), validates mxid regex (400 on bad shape), updates DB, calls `saveMemoryDatabaseToFile` | unit (Express supertest) | `npx vitest run src/backend/database/routes/user-admin-routes.test.ts` — extend existing | ✅ (add cases) |
| MXA-05 | `joinRoom` + `makeRoomAdmin` handle 200/403/404/timeout | unit | covered under MXA-01 tests | — |
| MXA-06 | agent-relay skill file has admin-note section (if we choose to update) | manual | grep `substrate/skills/agent-relay/SKILL.md` for the new section | manual only |

### Sampling Rate

- **Per task commit:** `npx vitest run src/backend/matrix/ src/backend/database/routes/user-admin-routes.test.ts src/backend/database/routes/identity-birth-orchestrator.test.ts` (< 15s)
- **Per wave merge:** `npm test` (full suite; ~1-2 min in CI)
- **Phase gate:** Full suite green + `npx tsc --noEmit` clean (`npm run type-check`) + `npm run lint` clean before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/backend/matrix/matrix-admin-client.test.ts` — covers MXA-01, MXA-05
- [ ] `src/backend/matrix/matrix-admin-creds-store.test.ts` — covers MXA-02 store roundtrip
- [ ] `src/backend/matrix/matrix-admin-client.integration.test.ts` — end-to-end against live relay (gated `INTEGRATION_TESTS=1`); covers MXA-01 real-world
- [ ] Add cases to existing `src/backend/database/db/index.migration.test.ts` — covers MXA-02 migration
- [ ] Add cases to existing `src/backend/database/routes/identity-birth-orchestrator.test.ts` — covers MXA-03 steps 6-8
- [ ] Add cases to existing `src/backend/database/routes/user-admin-routes.test.ts` (or create if absent — verify) — covers MXA-04

**Test infrastructure verified in-tree:**
- `pretty-view-upload.test.ts`, `plan-file-fetch.test.ts`, `identity-avatar-batch.test.ts`, `identities.get-disk.test.ts`, `identities.put-disk.test.ts`, `users-list-basic.test.ts` all use Vitest + in-memory better-sqlite3. Established pattern — reuse it. No framework install needed.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | JWT cookie/Bearer + admin gate — already provided by AuthManager |
| V3 Session Management | no | No new sessions — inherits Skynet's existing session lifecycle |
| V4 Access Control | yes | `createAdminMiddleware()` for the mxid endpoint + retry endpoint; `users.isAdmin` check inside handlers |
| V5 Input Validation | yes | `MXID_RE` regex-gate the mxid; `IDENTITY_KEY_RE` (existing) for identity name; encodeURIComponent for URL path components |
| V6 Cryptography | yes | `FieldCrypto` (AES-256-GCM) for admin token + password columns; `SystemCrypto` for master key management |

### Known Threat Patterns for {Node/Express + Synapse admin}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via `mxid` reaching URL construction | Tampering | `encodeURIComponent(mxid)` in the URL template; regex-gate first |
| SQL injection via `mxid` reaching WHERE clause | Tampering | Drizzle parameterized queries (`.set({ mxid })` — never string-concat) |
| Non-admin escalates via `POST /users/:id/mxid` | Elevation of Privilege | `AuthManager.createAdminMiddleware()` + secondary `users.isAdmin` check inside handler |
| Admin token leaks via error log | Info Disclosure | Never log the token or its prefix; log `mxid` and endpoint only. Precedent: voice.ts logs status but never response body. |
| Admin token leaks via `credentials.txt` remaining on disk after ingestion | Info Disclosure | Post-ingestion runbook step to remove or zero the bounty `credentials.txt`. |
| Replay of `POST /users/:id/mxid` overwrites correct mxid with wrong one | Tampering | Idempotent — a second correct call fixes it. Include the current mxid in the audit log so any accidental overwrite is grep-able post-hoc. |
| A malicious admin sets an arbitrary mxid that points to an account they control, then reads the agent DMs to that human | EoP + Info Disclosure | The admin who does this ALREADY has admin power over Skynet — they can do far worse. Threat model accepts "trust in admin role." Log every mxid registration with admin id, target user id, new mxid → grep-able audit trail. |
| Timing side-channel in admin-check middleware | Info Disclosure | Not applicable — admin check is a straight DB SELECT; timing doesn't leak. |

### Nina-bridge password elimination (the phase's headline security win)

The Q2 CONTEXT.md preamble makes this the phase's raison d'être. Verified ground-truth:

- **Baseline (today):** `bridge.sh` `acred()` (line 42) reads `$DIR/<human>.cred` as plaintext password; `relogin()` (line 46-56) POSTs `{type:"m.login.password", password:$pw}` on any 401. Every human whose bot has ever needed a token refresh has their raw Matrix password sitting on `thenasty:/home/thenasty/.config/tg-bridge/`.
- **Post-Phase-75 (before Phase B lands):** The admin foundation exists but the bridge is unchanged — passwords still on disk. **No security regression, but no security improvement yet.**
- **Post-Phase-B:** Bridge is rewritten (per shape) to call Skynet's admin foundation for token minting instead of holding passwords. Passwords deleted. This is the promised win.

**Phase A's security posture:** No regression. Adds one new stored secret (the admin token in Skynet's DB), balanced by unlocking the future deletion of every human `.cred` file in Phase B.

## Ground-truth verification

The shape file (per CONTEXT.md `Open flag`) explicitly asks the researcher to ground-truth Nina's tg-bridge password-storage claim against `/home/thenasty/.config/tg-bridge/bridge.sh` before the planner locks Phase 77's "why this matters" narrative.

**Verification performed:** SSH to `thenasty@100.113.23.63` (tailnet) on 2026-09-06 and read the bridge.sh file directly.

**Findings — the claim HOLDS:**
```bash
# From /home/thenasty/.config/tg-bridge/bridge.sh:41-56 (verbatim, 2026-09-06):

atok(){ cat "$DIR/$1.token"; }         # args: human_name
acred(){ cat "$DIR/$1.cred"; }         # args: human_name

# Re-login as <human> and overwrite the token file (self-heal if the token ever dies).
relogin(){                              # args: human_name
  local h="$1" pw r t
  pw=$(acred "$h" 2>/dev/null) || return 1
  r=$(curl -s -X POST "$BASE/login" -H 'Content-Type: application/json' \
      -d "$(jq -n --arg p "$pw" --arg u "$h" '{type:"m.login.password",identifier:{type:"m.id.user",user:$u},password:$p}')")
  ...
}
```

Every human whose Telegram bot the bridge currently serves has a `<human>.cred` file in `/home/thenasty/.config/tg-bridge/` holding their **plaintext Matrix password**, used by `relogin()` on any 401 (token death). The bridge also holds `<human>.token` files and refreshes them via `POST $BASE/login` (the plain Matrix login endpoint), which requires the plaintext password.

**Impact on Phase 77 narrative:** The shape's "why this matters" story stands as written. The admin foundation genuinely removes this load-bearing security surface — with admin, `POST /_synapse/admin/v1/users/<uid>/login` mints a fresh access token WITHOUT the user's password (see § Code Examples → Example 2). Phase B can then delete every `.cred` file and stop storing passwords entirely.

**No adjustment to Phase 77 scope needed based on this verification.**

## Retry surface options (informs planner's Q2 follow-on decision)

CONTEXT.md leaves the retry-surface shape open. Three options with tradeoffs:

**Option A — `POST /identities/:key/relay-retry` on Skynet backend (recommended):**
- Admin-gated (createAdminMiddleware).
- Body: `{ hostId: number }` (identifies which host the identity lives on).
- Reads identity name from URL param, resolves host, re-runs steps 6 + 8 (admin-mint via PUT, SFTP write of relay.json).
- Idempotent because `PUT /_synapse/admin/v2/users/<uid>` is idempotent — if the user exists, it's updated to a fresh password.
- Inherits existing nginx `/identities` location block (no new nginx work).
- Small — one route handler + a shared helper extracted from the birth orchestrator's steps 6+8.
- Trade-off: Skynet must know which host the identity lives on. Passing hostId in the body is fine; alternatively, if the fleet-native list can find the identity, the caller doesn't even need to know.

**Option B — CLI on the target host (`~/.claude/skills/id/retry-relay-register`):**
- The agent's own tmux session runs this.
- Fully out-of-band from Skynet — no admin gate needed because it's already running as the target user on the target host.
- BUT: the agent doesn't have Skynet's admin token. So this would need to call the id skill's self-register path (open-registration `POST /_matrix/client/v3/register` with dummy auth) — which the id skill ALREADY does automatically at first wake (SKILL.md:65-87 self-register fallback).
- Net: this option is a no-op — the id skill's existing self-register path IS this retry mechanism, and it already works.

**Option C — Re-invoke `POST /identities/birth`:**
- Orchestrator detects existing folder in step 1 and short-circuits to steps 6+8 only.
- Overloads birth semantics: "step 1 = folder create" becomes "step 1 = folder create OR skip if exists" which muddies the failure-mode contract.
- Rejected — cleaner to have a dedicated route.

**Recommendation:** Option A + rely on Option B's existing self-register fallback for the common case. The retry endpoint is the "admin says 'go finish that partial state'" affordance; the id skill's self-register is the "agent noticed on first wake" affordance. Both coexist; neither replaces the other.

## Sources

### Primary (HIGH confidence)

- **In-tree code (VERIFIED via Read/grep 2026-09-06):**
  - `src/backend/utils/field-crypto.ts` — encryption pattern
  - `src/backend/utils/auth-manager.ts:806, 969` — createAuthMiddleware + createAdminMiddleware
  - `src/backend/utils/database-save-trigger.ts` — DatabaseSaveTrigger.forceSave/triggerSave
  - `src/backend/utils/system-crypto.ts:151` — getEncryptionKey (master key for FieldCrypto)
  - `src/backend/database/db/schema.ts:4-26, 263-296` — users + ssh_credentials tables
  - `src/backend/database/db/index.ts:634-659, 774-853` — addColumnIfNotExists + migrateSchema
  - `src/backend/database/routes/identity-birth.ts` — SSE glue + dep injection
  - `src/backend/database/routes/identity-birth-orchestrator.ts:1-600` — the 5-step orchestrator to extend
  - `src/backend/database/routes/user-admin-routes.ts:137-212` — admin-gated route precedent (make-admin)
  - `src/backend/database/routes/users.ts:82-124, 48-49` — POST /create + admin middleware wiring
  - `src/backend/database/routes/voice.ts:200-274` — native fetch reverse-proxy pattern
  - `src/backend/claude-session/identity-artifact-reader.ts:1849-1903` — writeMarkdownFileAtomic (SFTP ext_openssh_rename)
  - `src/backend/ssh/tmux-helper.ts:21` — execCommand signature
  - `src/backend/database/database.ts:1813-1855` — route mount points
  - `docker/nginx.conf:142-151` + `docker/nginx-https.conf:153-162` — `/users(/.*)?$` catch-all
  - `package.json` — dep versions verified
- **Fleet-substrate code (VERIFIED via Read 2026-09-06):**
  - `~/.claude/skills/agent-relay/recv.sh` — relay.json format, relogin path, password requirement
  - `~/.claude/skills/agent-relay/SKILL.md` — trust posture, room-power semantics, encryption trap, relay.json shape
  - `/home/thenasty/.config/tg-bridge/bridge.sh` — GROUND-TRUTHED via SSH; password-storage claim verified
- **Bounty parked artifacts (VERIFIED via Read 2026-09-06):**
  - `~/.claude/roles/box-maintainer/bounties/skynet-matrix-admin-integration/bounty.json`
  - `~/.claude/roles/box-maintainer/bounties/skynet-matrix-admin-integration/credentials.txt`
- **Synapse admin API (VERIFIED via live HTTP + official docs 2026-09-06):**
  - `http://100.113.23.63:8008/_synapse/admin/v1/server_version` returned `1.157.2`
  - `http://100.113.23.63:8008/_synapse/admin/v2/users` returned users list with `admin:true` visible on `@skynet-admin`
  - [Element-hq Synapse User Admin API](https://element-hq.github.io/synapse/latest/admin_api/user_admin_api.html) — puppet API PUT + login-as-user POST verified
  - [Element-hq Synapse Rooms Admin API](https://element-hq.github.io/synapse/latest/admin_api/rooms.html) — list rooms + make_room_admin verified
  - [Element-hq Synapse Room Membership Admin API](https://element-hq.github.io/synapse/latest/admin_api/room_membership.html) — join endpoint verified
- **STATE.md** (VERIFIED via grep 2026-09-06): Phase 69 kill-identities-table entry; Phase 77 add entry.
- **CLAUDE.md** (VERIFIED via Read 2026-09-06): tech stack, nginx caveat, blast-radius, DatabaseSaveTrigger invariant.

### Secondary (MEDIUM confidence)

- [Synapse Register Users doc](https://element-hq.github.io/synapse/latest/admin_api/register_api.html) — nonce+HMAC pattern (not used by Phase 77 but documented for completeness of the api surface)

### Tertiary (LOW confidence)

- No LOW-confidence claims. All statements were verified against in-tree code, live Synapse endpoints, or official docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dependency and helper verified in-tree via grep + Read
- Architecture: HIGH — pattern matches every established Skynet conventions I traced (voice.ts fetch, user-admin-routes.ts admin-gate, identity-birth-orchestrator.ts SSH+SFTP, migrateSchema addColumnIfNotExists)
- Pitfalls: HIGH — five of six pitfalls have precedent in in-tree code / STATE.md history (Phase 69 security fix, quick 260802-qrw ext_openssh_rename, host-autostart-routes forceSave try/catch); the sixth (Synapse 200 vs 201) is documented in official Synapse docs
- Synapse endpoints: HIGH — three of four verified live; the fourth (`make_room_admin`) verified against official docs but not exercised live this session (we didn't want to actually modify any room). Fine.
- Ground-truth verification (Nina bridge password-storage claim): HIGH — read the actual bridge.sh via SSH; the claim holds

**Research date:** 2026-09-06
**Valid until:** 2026-10-06 for the Synapse admin surface (stable API on a supported version); 2026-09-13 for in-tree code claims (Skynet ships frequently — commit hashes referenced in in-tree paths may drift within a week)

Sources:
- [Element-hq Synapse User Admin API](https://element-hq.github.io/synapse/latest/admin_api/user_admin_api.html)
- [Element-hq Synapse Rooms Admin API](https://element-hq.github.io/synapse/latest/admin_api/rooms.html)
- [Element-hq Synapse Room Membership Admin API](https://element-hq.github.io/synapse/latest/admin_api/room_membership.html)
- [Element-hq Synapse Register Users API](https://element-hq.github.io/synapse/latest/admin_api/register_api.html)
