/**
 * Phase 75 Plan 01 Task 2 — @skynet-admin Matrix relay credentials store.
 *
 * Encapsulates the single-row `matrix_admin_creds` table (id=1 singleton
 * by convention) with eager encrypt-on-write and decrypt-on-read of the
 * two secret columns (access_token, password) via FieldCrypto.
 *
 * These are the ONLY relay credentials that live in Skynet's own storage
 * (per CONTEXT.md § Storage). Every consumer of the Matrix admin API — the
 * admin client in Plan 02, the birth orchestrator extension in Plan 04, and
 * the retry endpoint in Plan 05 — imports the two functions below to load
 * the plaintext creds on demand.
 *
 * Security invariants (per plan.md <threat_model>):
 *   T-75-01: Never log the plaintext accessToken or password. Log operation
 *            names only. `databaseLogger.warn` calls here take no secrets.
 *   T-75-02: All writes go through Drizzle's parameterized queries. No SQL
 *            string concatenation. All mutations pass through
 *            setMatrixAdminCreds which encrypts before writing.
 *
 * No new npm dependencies — reuses FieldCrypto, SystemCrypto, Drizzle,
 * DatabaseSaveTrigger, and databaseLogger, all already in the tree.
 */
import { eq } from "drizzle-orm";
import { db } from "../database/db/index.js";
import { matrixAdminCreds } from "../database/db/schema.js";
import { FieldCrypto } from "../utils/field-crypto.js";
import { SystemCrypto } from "../utils/system-crypto.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";
import { databaseLogger } from "../utils/logger.js";

/**
 * Plaintext shape of the @skynet-admin credentials. Consumers hold this
 * only in RAM (function-local scope); it is never returned by any public
 * route or written to any log.
 */
export interface MatrixAdminCreds {
  homeserverBase: string;
  userId: string;
  accessToken: string;
  password: string;
  // Optional override for the Matrix server_name portion of newly-minted mxids.
  // null on legacy rows (falls back to deriving server_name from homeserverBase's
  // URL host). Split into its own column so the URL can stay as a raw IP for
  // container-DNS reachability while the mxid server_name is a hostname Synapse
  // recognizes. Populated via PATCH /matrix-admin/creds/server-name.
  serverName: string | null;
  // 2026-09-11: Optional override for the host-reachable URL written into
  // per-identity relay.json's `base` field. null on legacy rows (consumers
  // fall back to homeserverBase). Split into its own column because
  // homeserverBase is the URL Skynet uses to reach synapse from INSIDE its
  // container (possibly a docker-internal alias like `http://synapse:8008`)
  // while relay.json is consumed by recv.sh on the identity's host, which
  // may require a different (tailnet-reachable) URL. Populated via
  // PATCH /matrix-admin/creds/host-side-base.
  hostSideBase: string | null;
}

/**
 * Singleton row id — the table holds exactly one row per Skynet instance.
 * Written as a string when passed to FieldCrypto (recordId in the HKDF
 * context is a string per field-crypto.ts:57).
 */
const SINGLETON_ID = 1;
const SINGLETON_ID_STR = String(SINGLETON_ID);

// Column names must match the DB column names (snake_case) — FieldCrypto's
// HKDF context includes fieldName, so the same value must be used at
// encrypt and decrypt time. Also matches the ENCRYPTED_FIELDS entry in
// field-crypto.ts:47.
const FIELD_ACCESS_TOKEN = "access_token";
const FIELD_PASSWORD = "password";

/**
 * Load the @skynet-admin credentials, decrypting the two secret columns
 * on the way out. Returns null when the singleton row does not exist
 * (fresh Skynet install with no admin creds ingested yet).
 */
export async function getMatrixAdminCreds(): Promise<MatrixAdminCreds | null> {
  const rows = await db
    .select()
    .from(matrixAdminCreds)
    .where(eq(matrixAdminCreds.id, SINGLETON_ID))
    .limit(1);

  if (!rows || rows.length === 0) {
    return null;
  }

  const row = rows[0];
  const masterKey = await SystemCrypto.getInstance().getEncryptionKey();

  const accessToken = FieldCrypto.decryptField(
    row.accessToken,
    masterKey,
    SINGLETON_ID_STR,
    FIELD_ACCESS_TOKEN,
  );
  const password = FieldCrypto.decryptField(
    row.password,
    masterKey,
    SINGLETON_ID_STR,
    FIELD_PASSWORD,
  );

  return {
    homeserverBase: row.homeserverBase,
    userId: row.userId,
    accessToken,
    password,
    serverName: row.serverName ?? null,
    hostSideBase: row.hostSideBase ?? null,
  };
}

/**
 * Update only the `server_name` override column on the singleton row without
 * touching the encrypted secrets. Returns true when the singleton row exists
 * and the update applied, false when no row is present yet (caller must
 * ingest full creds first via setMatrixAdminCreds).
 *
 * Split from setMatrixAdminCreds so an operator can rotate the override
 * without re-supplying the accessToken/password — the whole point of the
 * split is that server_name and homeserverBase are decoupled and either
 * can move without disturbing the other.
 */
export async function setMatrixAdminServerName(
  serverName: string | null,
): Promise<boolean> {
  const existing = await db
    .select({ id: matrixAdminCreds.id })
    .from(matrixAdminCreds)
    .where(eq(matrixAdminCreds.id, SINGLETON_ID))
    .limit(1);

  if (!existing || existing.length === 0) {
    return false;
  }

  await db
    .update(matrixAdminCreds)
    .set({
      serverName,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(matrixAdminCreds.id, SINGLETON_ID));

  try {
    await DatabaseSaveTrigger.triggerSave("matrix_admin_creds_server_name_save");
  } catch (saveError) {
    databaseLogger.warn(
      "matrix_admin_creds server_name triggerSave failed (non-fatal — write is in RAM, next save fires it)",
      {
        operation: "matrix_admin_creds_server_name_save_failed",
        error: saveError,
      },
    );
  }

  return true;
}

/**
 * 2026-09-11: Update only the `host_side_base` override column on the
 * singleton row without touching the encrypted secrets. Returns true when
 * the singleton row exists and the update applied, false when no row is
 * present yet (caller must ingest full creds first via setMatrixAdminCreds).
 *
 * Split from setMatrixAdminCreds — same discipline as setMatrixAdminServerName
 * — so an operator can rotate the host-reachable relay.json base URL without
 * re-supplying the accessToken/password. The whole point of this split is
 * that homeserverBase (container-internal, used for Skynet's admin API) and
 * hostSideBase (host-external, written into per-identity relay.json) are
 * decoupled and either can move without disturbing the other.
 */
export async function setMatrixAdminHostSideBase(
  hostSideBase: string | null,
): Promise<boolean> {
  const existing = await db
    .select({ id: matrixAdminCreds.id })
    .from(matrixAdminCreds)
    .where(eq(matrixAdminCreds.id, SINGLETON_ID))
    .limit(1);

  if (!existing || existing.length === 0) {
    return false;
  }

  await db
    .update(matrixAdminCreds)
    .set({
      hostSideBase,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(matrixAdminCreds.id, SINGLETON_ID));

  try {
    await DatabaseSaveTrigger.triggerSave("matrix_admin_creds_host_side_base_save");
  } catch (saveError) {
    databaseLogger.warn(
      "matrix_admin_creds host_side_base triggerSave failed (non-fatal — write is in RAM, next save fires it)",
      {
        operation: "matrix_admin_creds_host_side_base_save_failed",
        error: saveError,
      },
    );
  }

  return true;
}

/**
 * Persist the @skynet-admin credentials, eagerly encrypting the two secret
 * columns BEFORE the INSERT/UPDATE so no plaintext window exists on disk.
 *
 * Semantics: if the singleton (id=1) row exists, UPDATE it; else INSERT
 * with id=1. Called from the initial-ingestion runbook once at deploy
 * time, and (later) from any admin-driven rotation flow.
 *
 * After the write lands in RAM SQLite, triggerSave persists to the
 * encrypted file. Wrapped in try/catch with a non-fatal warn per the
 * host-autostart-routes.ts:173-181 precedent — the write is already in
 * RAM and next boot's initial load will pick it up if the save happens
 * later (or if a subsequent write's debounced save fires first).
 */
export async function setMatrixAdminCreds(
  creds: Omit<MatrixAdminCreds, "serverName" | "hostSideBase">,
): Promise<void> {
  const masterKey = await SystemCrypto.getInstance().getEncryptionKey();

  const encryptedAccessToken = FieldCrypto.encryptField(
    creds.accessToken,
    masterKey,
    SINGLETON_ID_STR,
    FIELD_ACCESS_TOKEN,
  );
  const encryptedPassword = FieldCrypto.encryptField(
    creds.password,
    masterKey,
    SINGLETON_ID_STR,
    FIELD_PASSWORD,
  );

  // Check whether the singleton row already exists. If yes → UPDATE,
  // preserving id=1 and created_at. If no → INSERT with explicit id=1.
  const existing = await db
    .select({ id: matrixAdminCreds.id })
    .from(matrixAdminCreds)
    .where(eq(matrixAdminCreds.id, SINGLETON_ID))
    .limit(1);

  const nowIso = new Date().toISOString();

  if (existing && existing.length > 0) {
    await db
      .update(matrixAdminCreds)
      .set({
        homeserverBase: creds.homeserverBase,
        userId: creds.userId,
        accessToken: encryptedAccessToken,
        password: encryptedPassword,
        updatedAt: nowIso,
      })
      .where(eq(matrixAdminCreds.id, SINGLETON_ID));
  } else {
    await db.insert(matrixAdminCreds).values({
      id: SINGLETON_ID,
      homeserverBase: creds.homeserverBase,
      userId: creds.userId,
      accessToken: encryptedAccessToken,
      password: encryptedPassword,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  // Persist RAM SQLite → encrypted file. Non-fatal on failure per the
  // DatabaseSaveTrigger uninitialized-first-boot race (see index.ts L810-821
  // and host-autostart-routes.ts:173-181 for the established shape).
  try {
    await DatabaseSaveTrigger.triggerSave("matrix_admin_creds_save");
  } catch (saveError) {
    databaseLogger.warn(
      "[phase-75] matrix_admin_creds triggerSave failed (non-fatal — write is in RAM, next save fires it)",
      {
        operation: "matrix_admin_creds_save_failed",
        error: saveError,
      },
    );
  }
}
