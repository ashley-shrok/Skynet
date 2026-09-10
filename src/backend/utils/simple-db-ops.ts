import { getDb, DatabaseSaveTrigger } from "../database/db/index.js";
import { DataCrypto } from "./data-crypto.js";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";

type TableName =
  | "users"
  | "ssh_data"
  | "ssh_credentials"
  | "recent_activity"
  | "socks5_proxy_presets";

// Authoritative sensitive-field set per table — mirrors LazyFieldEncryption.getSensitiveFieldsForTable()
// at src/backend/utils/lazy-field-encryption.ts:301-327. Keep in sync manually — no import
// to avoid a utils/utils circular-dependency shape.
const SENSITIVE_FIELDS_BY_TABLE: Record<TableName, ReadonlySet<string>> = {
  users: new Set(["totpSecret", "totpBackupCodes"]),
  ssh_data: new Set([
    "password", "key", "keyPassword", "sudoPassword",
    "autostartPassword", "autostartKey", "autostartKeyPassword",
    "socks5Password", "rdpPassword", "vncPassword", "telnetPassword",
  ]),
  ssh_credentials: new Set(["password", "key", "keyPassword", "privateKey", "publicKey"]),
  recent_activity: new Set(),
  socks5_proxy_presets: new Set(),
};

class SimpleDBOps {
  static async insert<T extends Record<string, unknown>>(
    table: SQLiteTable,
    tableName: TableName,
    data: T,
    userId: string,
  ): Promise<T> {
    const userDataKey = DataCrypto.validateUserAccess(userId);

    const tempId = data.id || `temp-${userId}-${Date.now()}`;
    const dataWithTempId = { ...data, id: tempId };

    const encryptedData = DataCrypto.encryptRecord(
      tableName,
      dataWithTempId,
      userId,
      userDataKey,
    );

    if (tableName === "ssh_credentials") {
      const { SystemCrypto } = await import("./system-crypto.js");
      const systemCrypto = SystemCrypto.getInstance();
      const systemKey = await systemCrypto.getCredentialSharingKey();

      const systemEncrypted = await DataCrypto.encryptRecordWithSystemKey(
        tableName,
        dataWithTempId,
        systemKey,
      );

      Object.assign(encryptedData, systemEncrypted);
    }

    if (!data.id) {
      delete encryptedData.id;
    }

    const result = await getDb()
      .insert(table)
      .values(encryptedData)
      .returning();

    DatabaseSaveTrigger.triggerSave(`insert_${tableName}`);

    const decryptedResult = DataCrypto.decryptRecord(
      tableName,
      result[0],
      userId,
      userDataKey,
    );

    return decryptedResult as T;
  }

  static async select<T extends Record<string, unknown>>(
    query: unknown,
    tableName: TableName,
    userId: string,
  ): Promise<T[]> {
    const userDataKey = DataCrypto.getUserDataKey(userId);
    if (!userDataKey) {
      return [];
    }

    const results = await query;

    const decryptedResults = DataCrypto.decryptRecords<T>(
      tableName,
      results as T[],
      userId,
      userDataKey,
    );

    return decryptedResults;
  }

  static async selectOne<T extends Record<string, unknown>>(
    query: unknown,
    tableName: TableName,
    userId: string,
  ): Promise<T | undefined> {
    const userDataKey = DataCrypto.getUserDataKey(userId);
    if (!userDataKey) {
      return undefined;
    }

    const result = await query;
    if (!result) return undefined;

    const decryptedResult = DataCrypto.decryptRecord<T>(
      tableName,
      result as T,
      userId,
      userDataKey,
    );

    return decryptedResult;
  }

  static async update<T extends Record<string, unknown>>(
    table: SQLiteTable,
    tableName: TableName,
    where: unknown,
    data: Partial<T>,
    userId: string,
  ): Promise<T[]> {
    const userDataKey = DataCrypto.validateUserAccess(userId);

    const encryptedData = DataCrypto.encryptRecord(
      tableName,
      data,
      userId,
      userDataKey,
    );

    if (tableName === "ssh_credentials") {
      const { SystemCrypto } = await import("./system-crypto.js");
      const systemCrypto = SystemCrypto.getInstance();
      const systemKey = await systemCrypto.getCredentialSharingKey();

      const systemEncrypted = await DataCrypto.encryptRecordWithSystemKey(
        tableName,
        data,
        systemKey,
      );

      Object.assign(encryptedData, systemEncrypted);
    }

    const result = await getDb()
      .update(table)
      .set(encryptedData)
      .where(where as SQL | undefined)
      .returning();

    DatabaseSaveTrigger.triggerSave(`update_${tableName}`);

    const decryptedResults = DataCrypto.decryptRecords(
      tableName,
      result,
      userId,
      userDataKey,
    );

    return decryptedResults as T[];
  }

  static async delete(
    table: SQLiteTable,
    tableName: TableName,
    where: unknown,
  ): Promise<unknown[]> {
    const result = await getDb()
      .delete(table)
      .where(where as SQL | undefined)
      .returning();

    DatabaseSaveTrigger.triggerSave(`delete_${tableName}`);

    return result;
  }

  /**
   * Update non-sensitive (cleartext-at-rest) fields for a row without requiring the target
   * user's data key. Intended for admin cross-user writes only — must be gated by
   * callerIsAdmin at the call site. The sensitive-field guard below is defense-in-depth.
   *
   * @throws if any key in `data` is in SENSITIVE_FIELDS_BY_TABLE[tableName]
   */
  static async updateNonSensitive<T extends Record<string, unknown>>(
    table: SQLiteTable,
    tableName: TableName,
    where: unknown,
    data: Partial<T>,
  ): Promise<T[]> {
    for (const key of Object.keys(data)) {
      if (SENSITIVE_FIELDS_BY_TABLE[tableName]?.has(key)) {
        throw new Error(
          `updateNonSensitive called with sensitive field: ${key} — use SimpleDBOps.update instead`,
        );
      }
    }

    const result = await getDb()
      .update(table)
      .set(data)
      .where(where as SQL | undefined)
      .returning();

    DatabaseSaveTrigger.triggerSave(`update_nonsensitive_${tableName}`);

    return result as T[];
  }

  /**
   * Insert non-sensitive (cleartext-at-rest) fields for a new row without requiring the
   * target user's data key. Intended for admin cross-user writes only — must be gated by
   * callerIsAdmin at the call site. Returns an array (raw .returning() shape); caller
   * should index with [0] or .at(0) for a single row.
   *
   * @throws if any key in `data` is in SENSITIVE_FIELDS_BY_TABLE[tableName]
   */
  static async insertNonSensitive<T extends Record<string, unknown>>(
    table: SQLiteTable,
    tableName: TableName,
    data: T,
  ): Promise<T[]> {
    for (const key of Object.keys(data)) {
      if (SENSITIVE_FIELDS_BY_TABLE[tableName]?.has(key)) {
        throw new Error(
          `insertNonSensitive called with sensitive field: ${key} — use SimpleDBOps.insert instead`,
        );
      }
    }

    const result = await getDb()
      .insert(table)
      .values(data)
      .returning();

    DatabaseSaveTrigger.triggerSave(`insert_nonsensitive_${tableName}`);

    return result as T[];
  }

  static async healthCheck(userId: string): Promise<boolean> {
    return DataCrypto.canUserAccessData(userId);
  }

  static isUserDataUnlocked(userId: string): boolean {
    return DataCrypto.getUserDataKey(userId) !== null;
  }

  static async selectEncrypted(query: unknown): Promise<unknown[]> {
    const results = await query;

    return results as unknown[];
  }
}

export { SimpleDBOps, type TableName };
