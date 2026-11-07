import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";

vi.mock("./logger.js", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() };
  return { databaseLogger: l, authLogger: l };
});

import { LazyFieldEncryption } from "./lazy-field-encryption.js";
import { readBackupCodes, readTotpSecret } from "./two-step-secrets.js";

const KEY = crypto.randomBytes(32);

/** The users row as a sign-in's lazy migration leaves it. */
function encrypted(secret: string, codes: string[]) {
  const { updatedRecord } = LazyFieldEncryption.migrateRecordSensitiveFields(
    { id: "u1", totp_secret: secret, totp_backup_codes: JSON.stringify(codes) },
    LazyFieldEncryption.getSensitiveFieldsForTable("users"),
    KEY,
    "u1",
  );
  return {
    id: "u1",
    totpSecret: updatedRecord.totp_secret as string,
    totpBackupCodes: updatedRecord.totp_backup_codes as string,
  };
}

describe("two-step secrets", () => {
  it("decrypts a secret and backup codes encrypted at sign-in", () => {
    const row = encrypted("JBSWY3DPEHPK3PXP", ["AAAA1111", "BBBB2222"]);
    expect(row.totpSecret).not.toBe("JBSWY3DPEHPK3PXP");
    expect(readTotpSecret(row, KEY)).toBe("JBSWY3DPEHPK3PXP");
    expect(readBackupCodes(row, KEY)).toEqual(["AAAA1111", "BBBB2222"]);
  });

  it("passes plaintext (set up, not yet migrated) through", () => {
    const row = { id: "u1", totpSecret: "JBSWY3DPEHPK3PXP", totpBackupCodes: '["AAAA1111"]' };
    expect(readTotpSecret(row, KEY)).toBe("JBSWY3DPEHPK3PXP");
    expect(readBackupCodes(row, KEY)).toEqual(["AAAA1111"]);
  });

  it("reads nothing under the wrong key, and nothing from empty columns", () => {
    const row = encrypted("JBSWY3DPEHPK3PXP", ["AAAA1111"]);
    const other = crypto.randomBytes(32);
    expect(readTotpSecret(row, other)).toBe("");
    expect(readBackupCodes(row, other)).toEqual([]);
    expect(readTotpSecret({ id: "u1", totpSecret: null }, KEY)).toBe("");
    expect(readBackupCodes({ id: "u1", totpBackupCodes: null }, KEY)).toEqual([]);
  });
});
