---
phase: 75-telegram-bridge-phase-a-skynet-matrix-admin-integration-foun
plan: 01
subsystem: database
tags: [matrix, encryption, schema-migration, drizzle, field-crypto, tdd]

# Dependency graph
requires:
  - phase: 68
    provides: DatabaseSaveTrigger.forceSave precedent + boot-time DDL pattern
  - phase: 66
    provides: addColumnIfNotExists probe-then-ALTER idempotency pattern
provides:
  - matrix_admin_creds singleton table with FieldCrypto-encrypted access_token + password columns
  - users.mxid TEXT column for the human mxid mapping (Q3 locked decision)
  - matrix-admin-creds-store module — free-function API (getMatrixAdminCreds, setMatrixAdminCreds) for eager encrypt-on-write + decrypt-on-read
  - FieldCrypto ENCRYPTED_FIELDS["matrix_admin_creds"] declaration
  - Idempotent boot-time DDL + DatabaseSaveTrigger.forceSave("phase-75-matrix-admin-schema") persist
affects: [77-02, 77-03, 77-04, 77-05, matrix-admin-client, identity-birth-orchestrator, telegram-bridge]

# Tech tracking
tech-stack:
  added: []  # zero new npm packages per RESEARCH.md § Package Legitimacy Audit
  patterns: [FieldCrypto column-encryption declaration, addColumnIfNotExists + CREATE TABLE IF NOT EXISTS idempotency, DatabaseSaveTrigger.forceSave wrapped in try/catch]

key-files:
  created:
    - src/backend/matrix/matrix-admin-creds-store.ts (176 lines)
    - src/backend/matrix/matrix-admin-creds-store.test.ts (220 lines)
  modified:
    - src/backend/database/db/schema.ts (users.mxid + matrixAdminCreds Drizzle table)
    - src/backend/database/db/index.ts (CREATE TABLE + addColumnIfNotExists + forceSave)
    - src/backend/utils/field-crypto.ts (ENCRYPTED_FIELDS entry)
    - src/backend/database/db/index.migration.test.ts (3 new test cases)

key-decisions:
  - "matrix_admin_creds is a dedicated singleton table (id=1 by convention), NOT a settings row or attached to users — the credential is Skynet-instance-wide, not user-scoped. Matches RESEARCH.md's storage recommendation."
  - "Column names in FieldCrypto ENCRYPTED_FIELDS use snake_case (access_token, password) to match the DB column names, since matrix-admin-creds-store calls encryptField/decryptField with fieldName in that same casing at the read/write boundary."
  - "The DatabaseSaveTrigger.forceSave('phase-75-matrix-admin-schema') call sits AFTER both DDLs (the CREATE TABLE at the top-level exec block AND the addColumnIfNotExists in the users sweep). One call covers both — matches the L810-821 phase-68 precedent shape."
  - "matrix-admin-creds-store is a free-function module (getMatrixAdminCreds + setMatrixAdminCreds), NOT a class-singleton. Matches voice.ts + the Task-2 plan explicitly. State lives in the DB row + the SystemCrypto master key; no in-store state to manage."

patterns-established:
  - "Pattern: eager-encrypt-on-write for FieldCrypto-declared columns — call encryptField before Drizzle INSERT/UPDATE, so no plaintext-on-disk window exists (matches credential-system-encryption-migration.ts:45-63 in reverse)."
  - "Pattern: singleton-row (id=1 by convention) with probe-then-UPDATE-else-INSERT — clearer than SQLite ON CONFLICT for a table where id is not autoincrement."
  - "Pattern: post-DDL DatabaseSaveTrigger.forceSave wrapped in try/catch + non-fatal warn — mirrors L810-821, tolerant of the uninitialized-trigger race on first boot."

requirements-completed: [MXA-02]

# Metrics
duration: 25min
completed: 2026-09-06
---

# Phase 77 Plan 01: Matrix admin schema substrate Summary

**Landed the storage substrate for the @skynet-admin Matrix relay credentials — new encrypted `matrix_admin_creds` singleton table + `users.mxid` column + a two-function store module that eagerly encrypts on write and decrypts on read via the existing FieldCrypto pattern.**

## Performance

- **Duration:** 25 minutes
- **Started:** 2026-09-06T06:30:40Z
- **Completed:** 2026-09-06T06:55:42Z
- **Tasks:** 2 completed (both TDD, both RED→GREEN, no REFACTOR needed)
- **Files created:** 2
- **Files modified:** 4
- **Test cases added:** 7 (3 migration + 4 store round-trip)
- **New npm dependencies:** 0

## Accomplishments

- `matrix_admin_creds` singleton table lands at boot via idempotent DDL — the table exists exactly once, its schema matches the Drizzle mirror in schema.ts, and re-runs on subsequent boots are no-ops (CREATE TABLE IF NOT EXISTS).
- `users.mxid TEXT` column lands via `addColumnIfNotExists` — nullable, ready to accept externally-created mxids from the Plan 03 endpoint (POST /users/:id/mxid) for the three pre-existing hand-made accounts (Ashley, Zoe, Laura) and any future users.
- Post-DDL `DatabaseSaveTrigger.forceSave("phase-75-matrix-admin-schema")` persists both new schema mutations to the encrypted SQLite file immediately — schema no longer lives in RAM only until an unrelated write fires the debounced save (CLAUDE.md DB-in-RAM invariant).
- `matrix-admin-creds-store.ts` provides the two-function API (`getMatrixAdminCreds`, `setMatrixAdminCreds`) that Plans 02–05 all import — eager encryption, singleton-row UPDATE-else-INSERT semantics, null-on-empty read.
- FieldCrypto declares both secret columns as encrypted; the ciphertext blob shape is verified in Test P75-2 (data/iv/tag/salt/recordId keys, recordId="1").

## Task Commits

Each task committed atomically per TDD (RED test-commit, then GREEN feat-commit):

1. **Task 1 RED — failing tests for schema + FieldCrypto:** `0e9493a4` (test)
2. **Task 1 GREEN — schema + DDL + forceSave + FieldCrypto entry:** `8ace009c` (feat)
3. **Task 2 RED — failing tests for store round-trip:** `674ecae2` (test)
4. **Task 2 GREEN — matrix-admin-creds-store implementation:** `dc7c03ac` (feat)

_TDD REFACTOR step: not applicable — both GREEN implementations were minimal-and-final on the first pass; no cleanup pass would produce useful diff._

## Files Created/Modified

### Created (Task 2)

- `src/backend/matrix/matrix-admin-creds-store.ts` (176 lines) — free-function module exporting `MatrixAdminCreds` interface + `getMatrixAdminCreds()` + `setMatrixAdminCreds()`. Owns the singleton (id=1) row and the encrypt/decrypt boundary.
- `src/backend/matrix/matrix-admin-creds-store.test.ts` (220 lines) — 4 Vitest cases against in-memory better-sqlite3 with SystemCrypto mocked to a deterministic 32-byte key.

### Modified (Task 1)

- `src/backend/database/db/schema.ts` — added `mxid: text("mxid")` to `users` (nullable) and a new `matrixAdminCreds` sqliteTable with 7 columns (id, homeserverBase, userId, accessToken, password, createdAt, updatedAt). Both column names carry Phase-75 comments.
- `src/backend/database/db/index.ts` — added `CREATE TABLE IF NOT EXISTS matrix_admin_creds` in the top-level exec block (near ssh_credential_usage at L312), one `addColumnIfNotExists("users", "mxid", "TEXT")` in the users column sweep (alongside totp_backup_codes), and a `DatabaseSaveTrigger.forceSave("phase-75-matrix-admin-schema")` call wrapped in try/catch + `databaseLogger.warn`. Mirrors L810-821 phase-68 shape exactly.
- `src/backend/utils/field-crypto.ts` — added `matrix_admin_creds: new Set(["access_token", "password"])` to `ENCRYPTED_FIELDS`.
- `src/backend/database/db/index.migration.test.ts` — appended `FieldCrypto` import and a new `describe("Phase 77-01 migration — ...")` block with three cases (P75-1, P75-2, P75-3).

## Exact schema+DDL diffs applied (per plan.md § Output item 1)

### schema.ts — `users.mxid`

```typescript
export const users = sqliteTable("users", {
  // ...existing columns unchanged...
  totpBackupCodes: text("totp_backup_codes"),

  // Phase 77 Plan 01 (Q3 locked decision) — mxid mapping for the Matrix
  // relay. Nullable: only humans with a registered relay account have one,
  // and it's populated via POST /users/:id/mxid (Plan 03) or the one-shot
  // import for Ashley/Zoe/Laura. Not a credential; agents' relay identifiers
  // live on-disk in ~/.claude/identities/<name>/relay.json per fleet convention.
  mxid: text("mxid"),
});
```

### schema.ts — `matrixAdminCreds`

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

### db/index.ts — top-level exec block (near L312, after ssh_credential_usage)

```sql
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

### db/index.ts — users column sweep (alongside totp_backup_codes at L869)

```typescript
addColumnIfNotExists("users", "totp_backup_codes", "TEXT");
addColumnIfNotExists("users", "mxid", "TEXT");   // ← Phase 77 Plan 01
```

## FieldCrypto ENCRYPTED_FIELDS entry (per plan.md § Output item 2)

```typescript
// src/backend/utils/field-crypto.ts:46-51
opkssh_tokens: new Set(["sshCert", "privateKey"]),
// Phase 77 Plan 01 — @skynet-admin Matrix relay credentials, encrypted
// at rest via FieldCrypto. Column names use snake_case (DB column form)
// because matrix-admin-creds-store.ts calls encryptField/decryptField
// with fieldName="access_token" / "password" against the DB rows.
matrix_admin_creds: new Set(["access_token", "password"]),
```

The `access_token` and `password` column names are the **snake_case DB column names** — matches the fieldName argument used by `matrix-admin-creds-store.ts` at both encrypt and decrypt time (FieldCrypto's HKDF context includes fieldName, so consistency at both ends is required).

## DatabaseSaveTrigger.forceSave placement (per plan.md § Output item 3)

Immediately AFTER `addColumnIfNotExists("users", "mxid", "TEXT")` in `migrateSchema()` at L880+, wrapped in try/catch + `databaseLogger.warn`:

```typescript
addColumnIfNotExists("users", "mxid", "TEXT");

// Phase 77 Plan 01 — persist the new matrix_admin_creds table + users.mxid
// column to the encrypted SQLite file. Both DDLs (CREATE TABLE IF NOT
// EXISTS matrix_admin_creds in the top-level exec block, and the
// addColumnIfNotExists above) execute against the RAM SQLite; without an
// explicit forceSave the new schema lives only in memory until an unrelated
// write fires the debounced save trigger. A restart before that first
// unrelated write loses the schema and re-runs the DDL on next boot.
//
// Wrapped in try/catch with a non-fatal warn: DatabaseSaveTrigger may not
// yet be initialized on the first-ever boot (handlePostInitFileEncryption
// wires it AFTER migrateSchema returns per index.ts init order). Both the
// CREATE TABLE IF NOT EXISTS and the addColumnIfNotExists probe-then-ALTER
// are idempotent, so a save failure retries on the next boot cycle.
// Mirrors the precedent at L810-821 (phase-68 drop) — same shape, same
// reason, same tolerance for uninitialized-trigger races.
try {
  await DatabaseSaveTrigger.forceSave("phase-75-matrix-admin-schema");
} catch (saveError) {
  databaseLogger.warn(
    "[phase-77] forceSave failed post-schema (non-fatal — CREATE IF NOT EXISTS + addColumnIfNotExists are idempotent, next boot retries)",
    {
      operation: "schema_migration_force_save_post_add",
      reason: "phase-75-matrix-admin-schema",
      error: saveError,
    },
  );
}
```

**Why one call, not two:** The forceSave persists everything currently in RAM. Since both the `CREATE TABLE` and the `addColumnIfNotExists` DDLs execute in `migrateSchema()` (the top-level exec block runs at initialization, and both DDLs live under the same singleton `sqlite` handle), a single post-`addColumnIfNotExists` forceSave anchors both mutations to disk in one go. Placement matches the L810-821 phase-68 precedent: forceSave AFTER the mutation, wrapped in try/catch + warn.

## Store function signatures (per plan.md § Output item 4)

```typescript
// src/backend/matrix/matrix-admin-creds-store.ts

export interface MatrixAdminCreds {
  homeserverBase: string;
  userId: string;
  accessToken: string;
  password: string;
}

export async function getMatrixAdminCreds(): Promise<MatrixAdminCreds | null>;
export async function setMatrixAdminCreds(creds: MatrixAdminCreds): Promise<void>;
```

- `getMatrixAdminCreds` — SELECT the id=1 row via Drizzle; if absent return null; if present, decrypt `accessToken` and `password` via `FieldCrypto.decryptField(row.value, masterKey, "1", fieldName)` and return the plaintext `MatrixAdminCreds`.
- `setMatrixAdminCreds` — acquire the masterKey via `SystemCrypto.getInstance().getEncryptionKey()`, encrypt `accessToken` and `password` eagerly via `FieldCrypto.encryptField(plaintext, masterKey, "1", fieldName)`, then UPDATE the id=1 row (probe first) or INSERT with explicit id=1. Persist via `DatabaseSaveTrigger.triggerSave("matrix_admin_creds_save")` wrapped in try/catch + non-fatal warn.

## Test counts + green status (per plan.md § Output item 5)

- **Migration tests (index.migration.test.ts):** 14/14 green (11 pre-existing + 3 new P75 cases)
- **Store tests (matrix-admin-creds-store.test.ts):** 4/4 green
- **Total new cases in Plan 77-01:** 7
- **Typecheck:** `npx tsc --noEmit` → exit 0 (clean)
- **Combined verification command:** `npx vitest run src/backend/database/db/index.migration.test.ts src/backend/matrix/ --reporter=default` → 18/18 green (both files)

## Pitfalls hit + resolutions (per plan.md § Output item 6)

**No pitfalls hit inside the plan itself.** Everything landed on the first RED→GREEN pass, no REFACTOR needed. Both GREEN implementations passed `npx tsc --noEmit` on the first attempt.

Column-name casing note (per plan.md's callout): The `ENCRYPTED_FIELDS["matrix_admin_creds"]` entry uses **snake_case** (`access_token`, `password`) rather than camelCase (`accessToken`, `password`) — this matches the DB column names and the `fieldName` argument the store passes at encrypt/decrypt time. Consistency at both ends is required because FieldCrypto's HKDF context is `${recordId}:${fieldName}`; a mismatch between encrypt-time and decrypt-time fieldName would fail the GCM auth-tag check.

## Deviations from Plan

None — plan executed exactly as written. No auto-fix rules triggered (no bugs, no missing critical functionality, no blocking issues). Zero package installs (all deps already in `package.json` per RESEARCH.md § Package Legitimacy Audit).

Worktree setup note (out-of-scope for the plan, adjacent to it): The worktree was spawned pointing at an old commit on `main` that predated the phase 75 planning artifacts by 2354 commits. I reset the worktree branch to `feat/tab-title-from-tmux` (the actual working branch) so the phase 75 planning files were available and the codebase state matched the plan's assumptions. This is a spawn-time environment fix, not a plan deviation.

## Verification

- `npx vitest run src/backend/database/db/index.migration.test.ts src/backend/matrix/` → 18/18 green ✓
- `npx tsc --noEmit` → exit 0, clean ✓
- `grep -c "matrix_admin_creds" src/backend/utils/field-crypto.ts src/backend/database/db/index.ts src/backend/database/db/schema.ts` → 1/3/2 (all ≥1) ✓
- Fresh boot via `npm run build && node dist/backend/index.js` — **not exercised in the executor** per plan.md's "verify manually before merging" phrasing. Left for the manual pre-merge check.

## Follow-ups for the next plans in the wave

- **Plan 77-02** can `import { getMatrixAdminCreds } from "../matrix/matrix-admin-creds-store.js"` without any runtime "table does not exist" errors on a fresh boot.
- **Plan 77-03** (POST /users/:id/mxid) can `set({ mxid })` on the users table via Drizzle — the column exists after boot.
- **Plan 77-04** (birth orchestrator extension) can call `setMatrixAdminCreds` for the initial one-shot ingestion of the parked `credentials.txt`, OR that ingestion may happen via a separate runbook step per plan 77-04's exact spec.
- **Plan 77-05** (retry endpoint) has the store to load admin creds from.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries beyond what the plan's `<threat_model>` already itemizes (T-75-01, T-75-02, T-75-03, T-75-04, T-75-27, T-75-SC). All threat-register `mitigate` dispositions honored in the implementation.

## Self-Check: PASSED

Verified:
- `src/backend/matrix/matrix-admin-creds-store.ts` exists ✓
- `src/backend/matrix/matrix-admin-creds-store.test.ts` exists ✓
- `src/backend/database/db/schema.ts` modified (contains `mxid` and `matrixAdminCreds`) ✓
- `src/backend/database/db/index.ts` modified (contains `matrix_admin_creds` DDL + `phase-75-matrix-admin-schema` forceSave) ✓
- `src/backend/utils/field-crypto.ts` modified (contains `matrix_admin_creds` ENCRYPTED_FIELDS entry) ✓
- `src/backend/database/db/index.migration.test.ts` modified (contains 3 new P75 cases) ✓
- Commits present: `0e9493a4`, `8ace009c`, `674ecae2`, `dc7c03ac` — all found in `git log` ✓
