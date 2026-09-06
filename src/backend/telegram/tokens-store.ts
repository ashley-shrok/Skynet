/**
 * Phase 79 Plan 01 Task 2 — per-identity Telegram bot tokens store.
 *
 * Encapsulates the `telegram_bot_tokens` table (one row per identity,
 * `identity_key` PRIMARY KEY) with eager encrypt-on-write and
 * decrypt-on-read of the `bot_token` column via FieldCrypto.
 *
 * Mirrors src/backend/matrix/matrix-admin-creds-store.ts exactly except:
 *   - Not singleton — pk is `identityKey: string`; each row's FieldCrypto
 *     HKDF context uses `recordId = String(identityKey)` (not a shared
 *     SINGLETON_ID_STR). Rotating an identity's key or renaming the
 *     identity would require a re-encrypt (out of Phase 79 scope).
 *   - Single encrypted column: `bot_token` (not access_token + password).
 *   - UPSERT semantics — set is idempotent per identity_key, preserving
 *     createdAt across UPDATE.
 *   - listTelegramBotTokens() returns ALL rows, each decrypted; used by
 *     the reconcile pass (Plan 08) and the bridge-config writer (Plan 04).
 *
 * Security invariants (per plan.md <threat_model>):
 *   T-79-01-01: Never log the plaintext botToken. Only log `operation`
 *               and `botUsername` (display-safe) and `identityKey`.
 *   T-79-01-02: bot_token column is FieldCrypto-encrypted before every
 *               INSERT/UPDATE; decrypted only in this module's public
 *               get/list functions and returned to trusted callers.
 *   T-79-01-03: field-crypto.ts ENCRYPTED_FIELDS registers
 *               `telegram_bot_tokens: ["bot_token"]` (Task 1). Without
 *               that registration, FieldCrypto middleware would ship
 *               plaintext to disk.
 *
 * No new npm dependencies — reuses FieldCrypto, SystemCrypto, Drizzle,
 * DatabaseSaveTrigger, and databaseLogger, all already in the tree.
 */
import { eq } from "drizzle-orm";
import { db } from "../database/db/index.js";
import { telegramBotTokens } from "../database/db/schema.js";
import { FieldCrypto } from "../utils/field-crypto.js";
import { SystemCrypto } from "../utils/system-crypto.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";
import { databaseLogger } from "../utils/logger.js";

/**
 * Plaintext shape of a per-identity Telegram bot binding. Consumers hold
 * this only in RAM (function-local scope); it is never returned by any
 * public route without stripping `botToken` first.
 */
export interface TelegramBotToken {
  identityKey: string;
  botToken: string;
  botUsername: string;
  humanUserId: string;
  telegramChatId: string | null;
  createdAt: string;
  updatedAt: string;
}

// Column name used in FieldCrypto HKDF context — must match the DB column
// (snake_case) AND the field-crypto.ts ENCRYPTED_FIELDS entry for
// `telegram_bot_tokens`. Do not rename without touching field-crypto.ts.
const FIELD_BOT_TOKEN = "bot_token";

/**
 * Load a single identity's Telegram bot binding, decrypting bot_token on
 * the way out. Returns null when no row exists for that identityKey.
 */
export async function getTelegramBotToken(
  identityKey: string,
): Promise<TelegramBotToken | null> {
  const rows = await db
    .select()
    .from(telegramBotTokens)
    .where(eq(telegramBotTokens.identityKey, identityKey))
    .limit(1);

  if (!rows || rows.length === 0) {
    databaseLogger.debug("telegram_bot_tokens get: no row", {
      operation: "telegram_bot_tokens_get",
      identityKey,
    });
    return null;
  }

  const row = rows[0];
  const masterKey = await SystemCrypto.getInstance().getEncryptionKey();

  const decryptedToken = FieldCrypto.decryptField(
    row.botToken,
    masterKey,
    String(row.identityKey),
    FIELD_BOT_TOKEN,
  );

  return {
    identityKey: row.identityKey,
    botToken: decryptedToken,
    botUsername: row.botUsername,
    humanUserId: row.humanUserId,
    telegramChatId: row.telegramChatId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * UPSERT a Telegram bot binding for the given identity. Eagerly encrypts
 * botToken BEFORE the INSERT/UPDATE so no plaintext ever lives on disk.
 *
 * Semantics:
 *   - If the row exists (identity_key match), UPDATE and preserve createdAt.
 *   - If absent, INSERT with a fresh createdAt/updatedAt.
 *
 * After the write lands in RAM SQLite, triggerSave persists to the
 * encrypted file. Wrapped in try/catch with a non-fatal warn per the
 * matrix-admin-creds-store.ts:162-175 precedent — the write is already
 * in RAM and next save fires it if this one fails.
 */
export async function setTelegramBotToken(
  identityKey: string,
  input: {
    botToken: string;
    botUsername: string;
    humanUserId: string;
    telegramChatId: string | null;
  },
): Promise<void> {
  const masterKey = await SystemCrypto.getInstance().getEncryptionKey();

  const encryptedToken = FieldCrypto.encryptField(
    input.botToken,
    masterKey,
    String(identityKey),
    FIELD_BOT_TOKEN,
  );

  const existing = await db
    .select({ identityKey: telegramBotTokens.identityKey })
    .from(telegramBotTokens)
    .where(eq(telegramBotTokens.identityKey, identityKey))
    .limit(1);

  const nowIso = new Date().toISOString();

  if (existing && existing.length > 0) {
    await db
      .update(telegramBotTokens)
      .set({
        botToken: encryptedToken,
        botUsername: input.botUsername,
        humanUserId: input.humanUserId,
        telegramChatId: input.telegramChatId,
        updatedAt: nowIso,
      })
      .where(eq(telegramBotTokens.identityKey, identityKey));

    databaseLogger.info("telegram_bot_tokens updated", {
      operation: "telegram_bot_tokens_set",
      identityKey,
      botUsername: input.botUsername,
      rotation: true,
    });
  } else {
    await db.insert(telegramBotTokens).values({
      identityKey,
      botToken: encryptedToken,
      botUsername: input.botUsername,
      humanUserId: input.humanUserId,
      telegramChatId: input.telegramChatId,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    databaseLogger.info("telegram_bot_tokens inserted", {
      operation: "telegram_bot_tokens_set",
      identityKey,
      botUsername: input.botUsername,
      rotation: false,
    });
  }

  try {
    await DatabaseSaveTrigger.triggerSave("telegram_bot_tokens_save");
  } catch (saveError) {
    databaseLogger.warn(
      "[phase-79] telegram_bot_tokens triggerSave failed (non-fatal — write is in RAM, next save fires it)",
      {
        operation: "telegram_bot_tokens_save_failed",
        error: saveError,
      },
    );
  }
}

/**
 * Delete the Telegram bot binding for the given identity. Silent no-op if
 * the row does not exist (matches Phase 79 § 3D "Disconnect + click again
 * shouldn't error out" recovery ergonomics).
 */
export async function deleteTelegramBotToken(
  identityKey: string,
): Promise<void> {
  await db
    .delete(telegramBotTokens)
    .where(eq(telegramBotTokens.identityKey, identityKey));

  databaseLogger.info("telegram_bot_tokens deleted (idempotent)", {
    operation: "telegram_bot_tokens_delete",
    identityKey,
  });

  try {
    await DatabaseSaveTrigger.triggerSave("telegram_bot_tokens_save");
  } catch (saveError) {
    databaseLogger.warn(
      "[phase-79] telegram_bot_tokens triggerSave failed on delete (non-fatal — write is in RAM, next save fires it)",
      {
        operation: "telegram_bot_tokens_save_failed",
        error: saveError,
      },
    );
  }
}

/**
 * Return ALL Telegram bot bindings, each decrypted. Used by the reconcile
 * pass (Plan 08) and the bridge-config writer (Plan 04) which needs the
 * full set to rebuild `registry.json` from source-of-truth on every mutation.
 *
 * Load cost: proportional to identity count; every row triggers one HKDF
 * derivation + one AES-GCM decrypt. Fine at the O(few dozen identities per
 * Skynet) scale Phase 79 targets. If we grow to O(hundreds), add a decrypt
 * cache layer.
 */
export async function listTelegramBotTokens(): Promise<TelegramBotToken[]> {
  const rows = await db.select().from(telegramBotTokens);

  const masterKey = await SystemCrypto.getInstance().getEncryptionKey();

  const decrypted: TelegramBotToken[] = rows.map((row) => ({
    identityKey: row.identityKey,
    botToken: FieldCrypto.decryptField(
      row.botToken,
      masterKey,
      String(row.identityKey),
      FIELD_BOT_TOKEN,
    ),
    botUsername: row.botUsername,
    humanUserId: row.humanUserId,
    telegramChatId: row.telegramChatId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  databaseLogger.debug("telegram_bot_tokens listed", {
    operation: "telegram_bot_tokens_list",
    count: decrypted.length,
  });

  return decrypted;
}
