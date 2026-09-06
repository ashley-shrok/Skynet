/**
 * substrate-credential-migration.ts
 *
 * Phase 75-08: One-shot operator-run migration that transitions existing
 * substrate-host credentials from per-user-DEK-only to CSKEK-wrapped.
 *
 * Invoked by the operator CLI script (scripts/migrate-substrate-credentials.ts)
 * after ship, before the Phase 75 runtime code goes live.
 *
 * Security discipline (threat model T-75-08-01 through T-75-08-09):
 * - Never logs plaintext passwords, keys, or passphrases
 * - Never logs the CSKEK or any derived DEK
 * - Only structured metadata (userId, credentialId, hostId, err.message)
 * - DEK zeroed in a finally block after each user's batch
 * - Passwords are NOT retained across users
 *
 * FIELDNAME CRITICAL NOTE (T-75-08-04):
 * The passphrase field uses DIFFERENT fieldName strings on the two sides:
 *   DECRYPT (user-DEK → plaintext):  camelCase keyPassword  ← matches production line 67
 *   ENCRYPT (plaintext → CSKEK):     snake_case key_password ← matches production line 94
 * This asymmetry is EXISTING production behavior. Test H0 verifies the full chain.
 * DO NOT unify these — any "fix" would silently corrupt production ciphertext.
 */

import { getDb } from "../database/db/index.js";
import { sshCredentials, hosts } from "../database/db/schema.js";
import { eq, and, isNull } from "drizzle-orm";
import { SystemCrypto } from "./system-crypto.js";
import { FieldCrypto } from "./field-crypto.js";
import { UserCrypto } from "./user-crypto.js";
import { DatabaseSaveTrigger } from "./database-save-trigger.js";
import { databaseLogger } from "./logger.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MigrationInput {
  userId: string;
  password: string;
}

export interface PerHostResult {
  hostId: number;
  credentialId: number;
  status: "migrated" | "failed" | "skipped";
}

export interface PerUserResult {
  userId: string;
  migrated: number;
  failed: number;
  skipped: number;
  hosts: PerHostResult[];
  error?: string;
}

export interface MigrationResult {
  preCheck: {
    inlineCredentialSubstrateHosts: number[];
  };
  perUser: PerUserResult[];
  aborted: boolean;
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

/**
 * Migrates existing substrate-host credentials from per-user-DEK-only to
 * CSKEK-wrapped. Should be run once by the operator (Ashley) after Phase 75
 * ships, on each live instance.
 *
 * Input: array of {userId, password} for each owner of substrate hosts.
 * Output: structured MigrationResult with per-user counts and host statuses.
 *
 * Pre-check: aborts loudly if any substrate host has credentialId=null (inline
 * credential row predating the Phase 75-04 guard).
 *
 * Per-host atomicity (D-14): each credential UPDATE is a single drizzle call.
 * If it throws, that host is counted as failed; others continue.
 *
 * After each user's batch: calls DatabaseSaveTrigger.forceSave to flush the
 * in-memory SQLite to disk (standing directive — in-memory crown jewel).
 */
export async function migrateSubstrateCredentials(
  input: MigrationInput[],
): Promise<MigrationResult> {
  // -------------------------------------------------------------------------
  // Step 1: Pre-check — abort loudly if any substrate host has credentialId=null
  // -------------------------------------------------------------------------

  const precheckRows = await getDb()
    .select({ hostId: hosts.id })
    .from(hosts)
    .where(
      and(
        eq(hosts.runsFleetSubstrate, true),
        isNull(hosts.credentialId),
      ),
    );

  const inlineCredentialSubstrateHosts = precheckRows.map(r => r.hostId as number);

  if (inlineCredentialSubstrateHosts.length > 0) {
    databaseLogger.warn(
      "Substrate credential migration aborted — inline-credential substrate hosts found",
      {
        operation: "substrate_migration_precheck_aborted",
        inlineCredentialHostIds: inlineCredentialSubstrateHosts,
        count: inlineCredentialSubstrateHosts.length,
      },
    );
    return {
      preCheck: { inlineCredentialSubstrateHosts },
      perUser: [],
      aborted: true,
    };
  }

  // -------------------------------------------------------------------------
  // Step 2: Load CSKEK once — reused across all users
  // -------------------------------------------------------------------------

  const CSKEK = await SystemCrypto.getInstance().getCredentialSharingKey();
  const userCrypto = UserCrypto.getInstance();

  // -------------------------------------------------------------------------
  // Step 3: Per-user loop
  // -------------------------------------------------------------------------

  const perUser: PerUserResult[] = [];

  for (const { userId, password } of input) {
    const perUserEntry: PerUserResult = {
      userId,
      migrated: 0,
      failed: 0,
      skipped: 0,
      hosts: [],
    };

    let userDEK: Buffer | null = null;

    try {
      // Derive the user's DEK sessionlessly — throws on wrong password or unknown user
      userDEK = await userCrypto.deriveDekForMigration(userId, password);

      // Query substrate hosts that belong to this user
      const rows = await getDb()
        .select({
          credId: sshCredentials.id,
          credPassword: sshCredentials.password,
          credKey: sshCredentials.key,
          credKeyPassword: sshCredentials.keyPassword,
          hostId: hosts.id,
        })
        .from(sshCredentials)
        .innerJoin(hosts, eq(hosts.credentialId, sshCredentials.id))
        .where(
          and(
            eq(sshCredentials.userId, userId),
            eq(hosts.runsFleetSubstrate, true),
          ),
        );

      // Per-row loop — each row wrapped in its own try/catch (D-14 atomicity)
      for (const row of rows) {
        const credIdStr = String(row.credId);
        const hostId = row.hostId as number;
        const credId = row.credId as number;

        try {
          // ------------------------------------------------------------------
          // DECRYPT with user DEK
          // FIELDNAME CRITICAL: passphrase field uses camelCase keyPassword
          // on the DECRYPT side — matches production write path (line 67).
          // DO NOT change to snake_case — would silently corrupt all passphrase
          // ciphertext in production. Test H0 catches any drift here.
          // ------------------------------------------------------------------
          const plainPassword = row.credPassword
            ? FieldCrypto.decryptField(row.credPassword, userDEK, credIdStr, "password")
            : null;
          const plainKey = row.credKey
            ? FieldCrypto.decryptField(row.credKey, userDEK, credIdStr, "key")
            : null;
          const plainKeyPassword = row.credKeyPassword
            ? FieldCrypto.decryptField(row.credKeyPassword, userDEK, credIdStr, "keyPassword") // camelCase
            : null;

          // ------------------------------------------------------------------
          // RE-ENCRYPT with CSKEK
          // FIELDNAME CRITICAL: passphrase field uses snake_case key_password
          // on the CSKEK-ENCRYPT side — matches production CSKEK write path (line 94).
          // This deliberate asymmetry with the DECRYPT side is EXISTING production
          // behavior. Test H0 verifies both sides round-trip correctly.
          // ------------------------------------------------------------------
          const systemPassword = plainPassword
            ? FieldCrypto.encryptField(plainPassword, CSKEK, credIdStr, "password")
            : null;
          const systemKey = plainKey
            ? FieldCrypto.encryptField(plainKey, CSKEK, credIdStr, "key")
            : null;
          const systemKeyPassword = plainKeyPassword
            ? FieldCrypto.encryptField(plainKeyPassword, CSKEK, credIdStr, "key_password") // snake_case
            : null;

          // Atomic per-credential update (D-14)
          await getDb()
            .update(sshCredentials)
            .set({
              systemPassword,
              systemKey,
              systemKeyPassword,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(sshCredentials.id, credId));

          perUserEntry.migrated += 1;
          perUserEntry.hosts.push({ hostId, credentialId: credId, status: "migrated" });
        } catch (rowErr) {
          // Per-row failure: log metadata only, never plaintext
          perUserEntry.failed += 1;
          perUserEntry.hosts.push({ hostId, credentialId: credId, status: "failed" });
          databaseLogger.warn("Substrate migration failed for credential", {
            operation: "substrate_migration_host_failed",
            userId,
            credentialId: credId,
            hostId,
            error: rowErr instanceof Error ? rowErr.message : "Unknown error",
          });
        }
      }

      // After user's batch: flush in-memory SQLite to disk
      try {
        await DatabaseSaveTrigger.forceSave(`substrate-cred-migration-${userId}`);
      } catch (saveError) {
        databaseLogger.warn("Substrate migration DB save failed after user batch", {
          operation: "substrate_migration_db_save_failed",
          userId,
          error: saveError instanceof Error ? saveError.message : "Unknown error",
        });
      }
    } catch (outerErr) {
      // DEK derivation or query failure
      perUserEntry.error = outerErr instanceof Error ? outerErr.message : "Unknown error";
      databaseLogger.warn("Substrate migration failed for user", {
        operation: "substrate_migration_user_failed",
        userId,
        error: perUserEntry.error,
      });
    } finally {
      // Zero the DEK regardless of success/failure (T-75-08-02)
      if (userDEK) {
        userDEK.fill(0);
      }
    }

    perUser.push(perUserEntry);
  }

  return {
    preCheck: { inlineCredentialSubstrateHosts: [] },
    perUser,
    aborted: false,
  };
}
