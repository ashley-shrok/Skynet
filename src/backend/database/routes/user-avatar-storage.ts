/**
 * Phase 85 — user-avatar-storage.ts
 *
 * Shared internal helper module (D-12) for user avatar byte-work.
 * All three Phase 85 endpoints (POST /users/create, PUT /users/:id/avatar,
 * GET /users/:id/avatar) share this module so the mime whitelist, size cap,
 * filename convention, and file-I/O primitives are a single source of truth.
 *
 * Exports:
 *   USER_AVATARS_DIR           — the on-disk directory (D-02)
 *   userAvatarUpload           — multer instance (memoryStorage + 5MB + png/jpeg/webp)
 *   userAvatarMulterErrorHandler — Express error handler for multer errors
 *   writeUserAvatar            — mkdir + writeFile; returns bare filename (D-05)
 *   unlinkUserAvatar           — ENOENT-tolerant file removal (D-22)
 *   readUserAvatar             — readFile + derive mime from extension
 *
 * NOTE: DATA_DIR is captured at module-load time from process.env.DATA_DIR.
 * Tests that need a different DATA_DIR MUST set process.env.DATA_DIR and then
 * import this module via vi.resetModules() + await import(...) so they get a
 * fresh module with the test's DATA_DIR. See user-avatar-storage.test.ts.
 *
 * No imports from identity-avatar-batch or identity-artifact-reader — Phase 85
 * uses its own locally-scoped maps covering only the 3 whitelisted mimes
 * (png/jpeg/webp) per RESEARCH.md § 8. SVG and GIF explicitly excluded (D-14).
 */

import multer from "multer";
import type { Request, Response, NextFunction } from "express";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Mirrors db/index.ts:12 — DATA_DIR resolution. Captured at module-load time.
const DATA_DIR = process.env.DATA_DIR || "./db/data";

// D-02: exact directory name; must match the string used by Plans 03/04/05/06/07.
export const USER_AVATARS_DIR = path.join(DATA_DIR, "user-avatars");

// D-14: strict whitelist — exactly {image/png, image/jpeg, image/webp}. NO gif, NO svg.
const ALLOWED_USER_AVATAR_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

// LOCAL scoped map per RESEARCH.md § 8 — do NOT import identity-artifact-reader's map.
// Note: "image/jpeg" maps to "jpg" (not "jpeg") — standard browser/HTTP convention.
const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

// Reverse map. Note "jpeg" also maps to image/jpeg for defensive legacy-file handling.
const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

// ---------------------------------------------------------------------------
// Path-traversal defense — assertSafeFilename (M1, defense-in-depth)
// ---------------------------------------------------------------------------

/**
 * Throws if `name` looks like a path-traversal attempt.
 *
 * Checks (defense-in-depth):
 *  1. Fast deny-list: reject names containing `/`, `\`, or `..`
 *  2. Structural: path.resolve(USER_AVATARS_DIR + name) must start with
 *     path.resolve(USER_AVATARS_DIR) + path.sep — catches encoded separators
 *     and other tricks that survive the fast check.
 *
 * Called at the very top of unlinkUserAvatar and readUserAvatar before any
 * filesystem operation.
 */
function assertSafeFilename(name: string): void {
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new Error(`avatar filename contains disallowed characters: ${name}`);
  }
  const resolvedBase = path.resolve(USER_AVATARS_DIR) + path.sep;
  const resolvedTarget = path.resolve(path.join(USER_AVATARS_DIR, name));
  if (!resolvedTarget.startsWith(resolvedBase)) {
    throw new Error(`avatar filename escapes the avatar directory: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Multer instance — VERBATIM shape from identity-avatar-batch.ts:406-422
// ---------------------------------------------------------------------------

// D-16: memoryStorage means bytes never touch disk before validation.
// D-15: 5 MB size cap.
// D-14: fileFilter enforces the 3-mime whitelist.
export const userAvatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_USER_AVATAR_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Avatar must be PNG, JPEG, or WebP"));
    }
  },
});

// ---------------------------------------------------------------------------
// Multer error handler — VERBATIM shape from identity-avatar-batch.ts:453-478
// ---------------------------------------------------------------------------

// Express error handler that maps multer errors to appropriate HTTP status codes.
// Wire this AFTER the write routes in users.ts so it only catches errors from those routes.
export function userAvatarMulterErrorHandler(
  err: Error & { code?: string },
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err?.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "file too large (max 5 MB)" });
    return;
  }
  if (err?.code === "LIMIT_UNEXPECTED_FILE") {
    res.status(400).json({ error: "missing avatar field" });
    return;
  }
  if (
    err instanceof Error &&
    err.message.includes("Avatar must be PNG, JPEG, or WebP")
  ) {
    res.status(400).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: "upload failed" });
}

// ---------------------------------------------------------------------------
// Magic-byte MIME sniffing — sniffAvatarMime (M4)
// ---------------------------------------------------------------------------

/**
 * Inspect the leading bytes of an avatar buffer to determine its true MIME type.
 * Returns the sniffed MIME string, or null if the bytes do not match any of the
 * three whitelisted formats.
 *
 * Byte signatures:
 *   PNG:  bytes[0..7] === \x89PNG\r\n\x1a\n
 *   JPEG: bytes[0..2] === \xff\xd8\xff
 *   WebP: bytes[0..3] === "RIFF"  AND  bytes[8..11] === "WEBP"
 *
 * Called by writeUserAvatar to detect client-declared-mime spoofing (T-87-M4).
 */
export function sniffAvatarMime(
  bytes: Buffer,
): "image/png" | "image/jpeg" | "image/webp" | null {
  // PNG — 8-byte magic: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG — 3-byte SOI marker: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // WebP — "RIFF" at bytes 0-3 and "WEBP" at bytes 8-11
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50    // P
  ) {
    return "image/webp";
  }

  return null;
}

// ---------------------------------------------------------------------------
// writeUserAvatar — mkdir + writeFile; returns bare filename (D-05)
// ---------------------------------------------------------------------------

/**
 * Write avatar bytes to disk under USER_AVATARS_DIR.
 *
 * Filename convention (D-05): `${userId}.${ext}` — deterministic and
 * resolvable from DATA_DIR alone. The bare filename is returned so the caller
 * can store it in users.avatar_path.
 *
 * mkdir is called with { recursive: true } for first-call bootstrap and is
 * safe on subsequent calls.
 *
 * @param userId  The user's id (used as the filename base).
 * @param mime    The validated mime type (must be in MIME_TO_EXT; multer fileFilter
 *                has already enforced this before writeUserAvatar is called).
 * @param bytes   The avatar bytes buffer.
 * @returns       The bare filename, e.g. "abc123.png".
 * @throws        Error if mime is not in the whitelist (defensive — should never happen
 *                after multer validation, but the helper is safe when called directly).
 */
export async function writeUserAvatar(
  userId: string,
  mime: string,
  bytes: Buffer,
): Promise<string> {
  const ext = MIME_TO_EXT[mime];
  if (!ext) {
    throw new Error(`writeUserAvatar called with un-whitelisted mime: ${mime}`);
  }

  // M4: magic-byte MIME sniffing — defend against client-declared-mime spoofing.
  // If the bytes do not match the declared MIME, reject with a distinct error
  // so the endpoint can map it to HTTP 400.
  const sniffedMime = sniffAvatarMime(bytes);
  if (sniffedMime !== mime) {
    throw new Error(
      `avatar mime mismatch: declared ${mime}, sniffed ${sniffedMime ?? "unknown"}`,
    );
  }

  // D-05: deterministic filename — userId + whitelisted-mime-derived ext.
  // req.file.originalname is NEVER used (T-85-02 path-traversal mitigation).
  const filename = `${userId}.${ext}`;
  const filePath = path.join(USER_AVATARS_DIR, filename);

  // First-call bootstrap — safe to call on subsequent calls (no-op if exists).
  await fs.mkdir(USER_AVATARS_DIR, { recursive: true });
  await fs.writeFile(filePath, bytes);

  return filename;
}

// ---------------------------------------------------------------------------
// unlinkUserAvatar — ENOENT-tolerant file removal (D-22)
// ---------------------------------------------------------------------------

/**
 * Remove an avatar file from disk. ENOENT-tolerant per D-22 — a missing file
 * is not an error (handles users with no avatar, races with concurrent replace,
 * backup-restore scenarios).
 *
 * @param filenameOrNull  Bare filename (e.g. "abc123.png"), or null/undefined/""
 *                        for users with no avatar — returns silently in that case.
 */
export async function unlinkUserAvatar(
  filenameOrNull: string | null | undefined,
): Promise<void> {
  if (!filenameOrNull) return;
  // M1: path-traversal defense — throws on suspicious filenames.
  assertSafeFilename(filenameOrNull);
  const filePath = path.join(USER_AVATARS_DIR, filenameOrNull);
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // ENOENT is swallowed — file is already gone, which is the desired end state.
  }
}

// ---------------------------------------------------------------------------
// readUserAvatar — readFile + derive mime from extension
// ---------------------------------------------------------------------------

/**
 * Read avatar bytes from disk and derive the mime type from the file extension.
 *
 * ENOENT propagates — the serve endpoint (Plan 05) must see err.code === "ENOENT"
 * to map to a clean 404 (Pitfall 4 from RESEARCH.md). Do NOT catch here.
 *
 * Throws on unrecognized extension — only whitelisted mimes ever live in
 * USER_AVATARS_DIR (invariant enforced by writeUserAvatar). A rogue file with
 * an unknown extension is a disk-corruption scenario, not a 404.
 *
 * @param filename  Bare filename stored in users.avatar_path (e.g. "abc123.png").
 * @returns         { bytes: Buffer, mime: string } — the raw bytes and the
 *                  Content-Type string for the serve endpoint.
 */
export async function readUserAvatar(
  filename: string,
): Promise<{ bytes: Buffer; mime: string }> {
  // M1: path-traversal defense — throws on suspicious filenames.
  assertSafeFilename(filename);
  const filePath = path.join(USER_AVATARS_DIR, filename);

  // Derive mime from extension — extension encodes the mime (RESEARCH.md § 8).
  const ext = path.extname(filename).slice(1).toLowerCase();
  const mime = EXT_TO_MIME[ext];
  if (!mime) {
    throw new Error(`unrecognized avatar file extension: ${ext}`);
  }

  // ENOENT propagates intentionally — serve endpoint maps to 404.
  const bytes = await fs.readFile(filePath);
  return { bytes, mime };
}
