import { LazyFieldEncryption } from "./lazy-field-encryption.js";

/**
 * Reading a user's two-step secret and backup codes from their users row.
 *
 * Both columns are encrypted at rest once the user has signed in (the lazy
 * migration in AuthManager encrypts plaintext sensitive fields on login), so
 * they must never be used as stored — always read them through here. A value
 * still in plaintext (set up but not yet migrated) passes through unchanged.
 */

interface TwoStepRow {
  id: string;
  totpSecret?: string | null;
  totpBackupCodes?: string | null;
}

/** The base32 secret, or "" when there is none or it can't be decrypted. */
export function readTotpSecret(row: TwoStepRow, dataKey: Buffer): string {
  if (!row.totpSecret) return "";
  return LazyFieldEncryption.safeGetFieldValue(
    row.totpSecret,
    dataKey,
    row.id,
    "totpSecret",
  );
}

/** The unused backup codes; [] when there are none or they can't be read. */
export function readBackupCodes(row: TwoStepRow, dataKey: Buffer): string[] {
  if (!row.totpBackupCodes) return [];
  try {
    const plain = LazyFieldEncryption.safeGetFieldValue(
      row.totpBackupCodes,
      dataKey,
      row.id,
      "totpBackupCodes",
    );
    const parsed: unknown = plain ? JSON.parse(plain) : [];
    return Array.isArray(parsed)
      ? parsed.filter((c): c is string => typeof c === "string")
      : [];
  } catch {
    return [];
  }
}
