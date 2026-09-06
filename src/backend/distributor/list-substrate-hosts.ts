/**
 * list-substrate-hosts.ts — Session-less substrate-host enumerator with CSKEK credential decrypt.
 *
 * This module is the input side of the server-context startup pass (75-02 orchestrator).
 * It replaces the browser-session-scoped `listIdentityHostingHosts` (starter.ts:378-442)
 * for the substrate-sweep use case: that function requires `currentSubscriberUserId` which
 * is a browser-session concept unavailable at container boot.
 *
 * DESIGN CHOICE — Dependency injection for DB:
 *   The module accepts `deps: ListSubstrateHostsDeps` with `getDb` as the sole injection
 *   point. The crypto singletons (SystemCrypto, FieldCrypto) are imported at module scope
 *   and tested via vi.mock — this is consistent with every other distributor module and
 *   avoids an explosion of injection surface. The DB is injected because the distributor
 *   modules are designed as leaf utilities that don't call `getDb()` at import time (no
 *   side effects on module load).
 *
 * SECURITY INVARIANT — D-08 (load-bearing):
 *   This module NEVER calls DataCrypto.getUserDataKey() or any per-user DEK path.
 *   All credential decryption goes through SystemCrypto.getInstance().getCredentialSharingKey()
 *   (CSKEK). This is enforced by a grep gate in the acceptance criteria.
 *
 * SECURITY INVARIANT — Secret hygiene:
 *   - CSKEK Buffer value is NEVER passed to any log call
 *   - Plaintext credential fields are NEVER passed to any log call
 *   - Per-host catch blocks log only err.message, never err.stack or ciphertext
 */
import { eq, and } from "drizzle-orm";
import { hosts, sshCredentials } from "../database/db/schema.js";
import { SystemCrypto } from "../utils/system-crypto.js";
import { FieldCrypto } from "../utils/field-crypto.js";
import { systemLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The shape returned by listSubstrateHosts — matches what the server-context
 * orchestrator (75-02) expects and what connectOneShot consumes.
 * Mirrors the record shape from starter.ts:412-424 for fleet-status hosts.
 */
export type SubstrateHostRecord = {
  id: string;
  name: string;
  _connDetails: Record<string, unknown>;
};

/**
 * Dependency injection interface.
 * Caller (e.g. starter.ts) passes `{ getDb }` so the module can be fully
 * unit-tested with a stubbed drizzle chain without touching the real DB.
 */
export type ListSubstrateHostsDeps = {
  getDb: () => ReturnType<typeof import("../database/db/index.js").getDb>;
};

// ---------------------------------------------------------------------------
// Enumerator
// ---------------------------------------------------------------------------

/**
 * List every host with `enableSsh=true AND runsFleetSubstrate=true`, decrypt
 * its SSH credentials using the system CSKEK, and return an array of
 * SubstrateHostRecord suitable for passing to runSweepForHost/connectOneShot.
 *
 * Never throws — outer catch returns [] and logs `fleet_substrate_host_list_failed`.
 * Per-host errors are caught, logged at `fleet_substrate_host_decrypt_failed`, and
 * do not empty the rest of the list.
 */
export async function listSubstrateHosts(
  deps: ListSubstrateHostsDeps,
): Promise<SubstrateHostRecord[]> {
  // Outer never-throw wrapper — mirrors starter.ts:436-441
  try {
    // 1. Acquire CSKEK up front so failures here are caught by the outer catch.
    const CSKEK = await SystemCrypto.getInstance().getCredentialSharingKey();

    // 2. Query substrate hosts with their credential rows via left-join.
    //    LEFT JOIN (not INNER) so that hosts with credentialId=null are
    //    returned as rows (cred_id will be null) — this lets the
    //    defense-in-depth filter below warn and skip them rather than
    //    silently dropping them.
    const db = deps.getDb();
    const rows = await db
      .select({
        id: hosts.id,
        name: hosts.name,
        credentialId: hosts.credentialId,
        ip: hosts.ip,
        port: hosts.port,
        username: hosts.username,
        authType: hosts.authType,
        cred_id: sshCredentials.id,
        cred_userId: sshCredentials.userId,
        cred_systemPassword: sshCredentials.systemPassword,
        cred_systemKey: sshCredentials.systemKey,
        cred_systemKeyPassword: sshCredentials.systemKeyPassword,
        cred_keyType: sshCredentials.keyType,
        cred_username: sshCredentials.username,
      })
      .from(hosts)
      .leftJoin(sshCredentials, eq(hosts.credentialId, sshCredentials.id))
      .where(
        and(
          eq(hosts.enableSsh, true),
          eq(hosts.runsFleetSubstrate, true),
        ),
      );

    // 3. Per-host processing with defense-in-depth filters.
    const results: SubstrateHostRecord[] = [];

    for (const row of rows) {
      // Defense-in-depth F1: host with no credentialId (should have been blocked
      // at the API layer by 75-04, but guard here for pre-existing data).
      if (row.credentialId == null || row.cred_id == null) {
        systemLogger.warn(
          "Fleet-substrate: substrate host has no credential — skipping",
          {
            operation: "fleet_substrate_host_no_credential_id",
            hostId: row.id,
            hostName: row.name,
          },
        );
        continue;
      }

      // Defense-in-depth F2: credential row exists but has never been migrated
      // to CSKEK wrapping (both system_* columns are null).
      if (row.cred_systemPassword == null && row.cred_systemKey == null) {
        systemLogger.warn(
          "Fleet-substrate: substrate host credential has no system-encrypted fields (unmigrated) — skipping",
          {
            operation: "fleet_substrate_host_unmigrated_credential",
            hostId: row.id,
            hostName: row.name,
            credentialId: row.cred_id,
          },
        );
        continue;
      }

      // Per-host decrypt with its own try/catch so one bad host never empties
      // the entire returned list.
      try {
        const credIdStr = row.cred_id.toString();

        // Decrypt password if present.
        const password = row.cred_systemPassword
          ? FieldCrypto.decryptField(row.cred_systemPassword, CSKEK, credIdStr, "password")
          : null;

        // Decrypt private key if present.
        const key = row.cred_systemKey
          ? FieldCrypto.decryptField(row.cred_systemKey, CSKEK, credIdStr, "key")
          : null;

        // Decrypt key passphrase if present.
        // Field name is "key_password" (snake_case) per credential-system-encryption-migration.ts:93.
        const keyPassword = row.cred_systemKeyPassword
          ? FieldCrypto.decryptField(row.cred_systemKeyPassword, CSKEK, credIdStr, "key_password")
          : null;

        // Prefer credential-level username over host-level username (matches
        // the pattern in sessions.ts and starter.ts for identity hosting).
        const username = row.cred_username || row.username;

        const _connDetails: Record<string, unknown> = {
          ip: row.ip,
          port: row.port,
          username,
          password,
          key,
          keyPassword,
          keyType: row.cred_keyType,
          authType: row.authType,
        };

        results.push({
          id: String(row.id),
          name: row.name ?? String(row.id),
          _connDetails,
        });
      } catch (err) {
        // Log only err.message — never the ciphertext or the CSKEK Buffer.
        systemLogger.warn(
          "Fleet-substrate: failed to decrypt credential for substrate host — skipping",
          {
            operation: "fleet_substrate_host_decrypt_failed",
            hostId: row.id,
            hostName: row.name,
            credentialId: row.cred_id,
            error: err instanceof Error ? err.message : "unknown",
          },
        );
      }
    }

    return results;
  } catch (err) {
    // Outer never-throw catch — mirrors starter.ts:436-441.
    systemLogger.warn(
      "Fleet-substrate: substrate-host list query failed",
      {
        operation: "fleet_substrate_host_list_failed",
        error: err instanceof Error ? err.message : "unknown",
      },
    );
    return [];
  }
}
