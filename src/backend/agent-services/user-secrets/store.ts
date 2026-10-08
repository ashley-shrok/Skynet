/**
 * agent-services/user-secrets/store.ts — per-user secrets for agent
 * services, encrypted at rest.
 *
 * Values are FieldCrypto ciphertext under the system ENCRYPTION_KEY, the
 * same key matrix-admin-creds-store.ts uses, rather than the user's
 * session-derived data key: an agent can make a request at 3am while its
 * user is logged out, and the backend still has to be able to read the key.
 * The HKDF context binds each ciphertext to its (user, service, name), so a
 * value copied to another row will not decrypt.
 *
 * Write-only by design: nothing here is exposed by a route that returns a
 * value. Routes only see `listUserSecretStatus`.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "../../database/db/index.js";
import { agentServiceUserSecrets } from "../../database/db/schema.js";
import { FieldCrypto } from "../../utils/field-crypto.js";
import { SystemCrypto } from "../../utils/system-crypto.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import { databaseLogger } from "../../utils/logger.js";

export interface UserSecretStatus {
  service: string;
  name: string;
  updatedAt: string;
}

const recordIdFor = (userId: string, service: string) =>
  `agent-service:${userId}:${service}`;

const byKey = (userId: string, service: string, name: string) =>
  and(
    eq(agentServiceUserSecrets.userId, userId),
    eq(agentServiceUserSecrets.service, service),
    eq(agentServiceUserSecrets.name, name),
  );

async function persist(reason: string): Promise<void> {
  try {
    await DatabaseSaveTrigger.triggerSave(reason);
  } catch (err) {
    // Non-fatal: the write is in RAM and lands on disk with the next save.
    databaseLogger.warn("agent-service user secret save failed (non-fatal)", {
      operation: "agent_service_user_secret_save_failed",
      reason,
      error: err,
    });
  }
}

/** The decrypted value, or null when nothing is stored. */
export async function getUserSecret(
  userId: string,
  service: string,
  name: string,
): Promise<string | null> {
  const rows = await getDb()
    .select({ value: agentServiceUserSecrets.value })
    .from(agentServiceUserSecrets)
    .where(byKey(userId, service, name))
    .limit(1);
  const stored = rows[0]?.value;
  if (!stored) return null;

  const recordId = recordIdFor(userId, service);
  // FieldCrypto derives the key from the recordId stored inside the blob;
  // check it matches this row so a blob moved between rows is refused.
  const embedded = (JSON.parse(stored) as { recordId?: string }).recordId;
  if (embedded !== recordId) {
    throw new Error(
      `stored secret ${service}/${name} does not belong to this user`,
    );
  }
  const key = await SystemCrypto.getInstance().getEncryptionKey();
  return FieldCrypto.decryptField(stored, key, recordId, name);
}

export async function setUserSecret(
  userId: string,
  service: string,
  name: string,
  value: string,
  updatedBy: string,
): Promise<void> {
  const key = await SystemCrypto.getInstance().getEncryptionKey();
  const ciphertext = FieldCrypto.encryptField(
    value,
    key,
    recordIdFor(userId, service),
    name,
  );
  const updatedAt = new Date().toISOString();
  await getDb()
    .insert(agentServiceUserSecrets)
    .values({ userId, service, name, value: ciphertext, updatedAt, updatedBy })
    .onConflictDoUpdate({
      target: [
        agentServiceUserSecrets.userId,
        agentServiceUserSecrets.service,
        agentServiceUserSecrets.name,
      ],
      set: { value: ciphertext, updatedAt, updatedBy },
    });
  await persist("agent_service_user_secret_set");
}

/** Returns true if a value was removed. */
export async function clearUserSecret(
  userId: string,
  service: string,
  name: string,
): Promise<boolean> {
  const deleted = await getDb()
    .delete(agentServiceUserSecrets)
    .where(byKey(userId, service, name))
    .returning({ id: agentServiceUserSecrets.id });
  if (deleted.length > 0) await persist("agent_service_user_secret_clear");
  return deleted.length > 0;
}

/** Which secrets a user has stored, without values. */
export async function listUserSecretStatus(
  userId: string,
): Promise<UserSecretStatus[]> {
  return getDb()
    .select({
      service: agentServiceUserSecrets.service,
      name: agentServiceUserSecrets.name,
      updatedAt: agentServiceUserSecrets.updatedAt,
    })
    .from(agentServiceUserSecrets)
    .where(eq(agentServiceUserSecrets.userId, userId));
}
