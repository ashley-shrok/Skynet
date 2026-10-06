/**
 * SQLite file header checks. `.db` is used by other formats too (Thumbs.db,
 * Berkeley DB), so the viewer only opens files with the SQLite signature.
 */

const MAGIC = "SQLite format 3\u0000";

export function isSqliteFile(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 100) return false;
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

/** Header bytes 18/19 (write/read format version) are 2 in WAL mode. */
export function usesWal(bytes: Uint8Array): boolean {
  return bytes[18] === 2 || bytes[19] === 2;
}

/**
 * An in-memory copy can't use write-ahead logging; mark the copy as a
 * rollback-journal database so SQLite opens it. (Changes still only in a
 * `-wal` file next to the original aren't in these bytes either way.)
 */
export function withoutWalFlag(bytes: Uint8Array): Uint8Array {
  if (!usesWal(bytes)) return bytes;
  const copy = bytes.slice();
  copy[18] = 1;
  copy[19] = 1;
  return copy;
}
