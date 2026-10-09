/**
 * avatar-normalize.ts — shrink avatar bytes to a sane on-disk / on-wire size.
 *
 * Avatars arrive as 1024px gpt-image-1 PNGs or arbitrary user uploads
 * (hundreds of KB to MBs) but render in UI slots from a ~30px sidebar disc
 * up to the identity modal's large preview. 512px fits every slot at 2x DPR
 * while landing in the tens of KB as WebP.
 *
 * Applied at every write entry point (avatar candidates, identity/role/user
 * avatar uploads) and at serve time for legacy oversized files on disk.
 *
 * Only raster formats are touched — SVG stays vector, GIF may be animated.
 * Never throws: an undecodable input passes through unchanged so a
 * normalization failure can never break a save.
 */

import sharp from "sharp";
import { systemLogger } from "./logger.js";

export const AVATAR_MAX_PX = 512;
const WEBP_QUALITY = 85;

/** Logging must never break an avatar save (and some route test suites mock
 *  the logger module without systemLogger, where touching it throws). */
function log(level: "info" | "warn", msg: string, meta: Record<string, unknown>): void {
  try {
    systemLogger[level](msg, meta);
  } catch {
    /* ignore */
  }
}

const NORMALIZABLE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function normalizeAvatar(
  bytes: Buffer,
  mime: string,
): Promise<{ bytes: Buffer; mime: string }> {
  if (!NORMALIZABLE_MIMES.has(mime)) return { bytes, mime };
  try {
    const out = await sharp(bytes)
      .rotate()
      .resize({
        width: AVATAR_MAX_PX,
        height: AVATAR_MAX_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    // An already-small input can come out larger after re-encoding; keep the
    // original in that case.
    if (out.byteLength >= bytes.byteLength) return { bytes, mime };
    return { bytes: out, mime: "image/webp" };
  } catch (err) {
    log("warn", "Avatar normalize failed — keeping original bytes", {
      operation: "avatar_normalize_failed",
      mime,
      inBytes: bytes.byteLength,
      error: err instanceof Error ? err.message : String(err),
    });
    return { bytes, mime };
  }
}

/**
 * Normalize a multer `req.file` avatar in place (buffer, mimetype, size), so
 * the route's existing mime→ext mapping and write call pick up the result.
 * No-op when there is no file.
 */
export async function normalizeUploadedAvatar(
  file: Express.Multer.File | undefined,
): Promise<void> {
  if (!file) return;
  const before = file.buffer.byteLength;
  const out = await normalizeAvatar(file.buffer, file.mimetype);
  file.buffer = out.bytes;
  file.mimetype = out.mime;
  file.size = out.bytes.byteLength;
  if (out.bytes.byteLength !== before) {
    log("info", "Avatar upload normalized", {
      operation: "avatar_upload_normalized",
      inBytes: before,
      outBytes: out.bytes.byteLength,
      mime: out.mime,
    });
  }
}
