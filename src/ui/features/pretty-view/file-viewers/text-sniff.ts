/**
 * Client-side text/binary classification shared by every file-view surface.
 *
 * Same file(1)-style heuristic as the backend's `sniffTextBytes`
 * (src/backend/utils/editable-file-byte-sniff.ts) so a file classifies the
 * same way whether the server or the browser looked at it:
 *   1. Sample the first 8192 bytes.
 *   2. Empty → text.
 *   3. Any 0x00 byte → binary.
 *   4. ≥ 90% printable bytes (tab/LF/CR, 0x20..0x7E, 0x80..0xFF).
 *   5. Sample decodes as UTF-8. Decoded with `stream: true` so a multi-byte
 *      character cut in half by the 8 KiB boundary doesn't read as binary.
 */

const SAMPLE_BYTES = 8192;

export function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.length > SAMPLE_BYTES ? bytes.subarray(0, SAMPLE_BYTES) : bytes;
  if (sample.length === 0) return true;

  let printable = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    if (b === 0x00) return false;
    if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e) || b >= 0x80) {
      printable++;
    }
  }
  if (printable / sample.length < 0.9) return false;

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample, {
      stream: sample.length < bytes.length,
    });
    return true;
  } catch {
    return false;
  }
}

/** base64 → raw bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Raw bytes → UTF-8 string (lenient: invalid sequences become U+FFFD). */
export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}
