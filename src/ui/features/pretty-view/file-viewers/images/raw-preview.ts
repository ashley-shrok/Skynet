/**
 * Camera RAW files (.dng, .cr2, .cr3, .nef, .arw, .raf, ...) almost always
 * embed a JPEG preview — usually full size — that the camera rendered.
 * Rather than parse each maker's container, find every complete JPEG
 * stream in the file and take the largest: it works the same for
 * TIFF-based RAWs and Canon's ISO-media CR3.
 */

export interface EmbeddedJpeg {
  offset: number;
  length: number;
}

/** End (exclusive) of the JPEG starting at `start`, or -1 if it isn't a complete one. */
export function jpegEnd(bytes: Uint8Array, start: number): number {
  if (bytes[start] !== 0xff || bytes[start + 1] !== 0xd8) return -1;
  let i = start + 2;
  const n = bytes.length;
  // Marker segments up to Start Of Scan.
  while (i + 4 <= n) {
    if (bytes[i] !== 0xff) return -1;
    let marker = bytes[i + 1];
    while (marker === 0xff && i + 2 < n) {
      i++; // fill bytes
      marker = bytes[i + 1];
    }
    if (marker === 0xd9) return i + 2; // EOI with no scan
    if (marker >= 0xd0 && marker <= 0xd7) {
      i += 2;
      continue;
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) return -1;
    const next = i + 2 + len;
    if (marker === 0xda) {
      // Entropy-coded data: runs until a marker other than stuffing / restart.
      let j = next;
      while (j + 1 < n) {
        if (bytes[j] === 0xff) {
          const m = bytes[j + 1];
          if (m === 0x00 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) {
            j += m === 0xff ? 1 : 2;
            continue;
          }
          if (m === 0xd9) return j + 2;
          // Another segment (progressive JPEGs have several scans).
          i = j;
          break;
        }
        j++;
      }
      if (j + 1 >= n) return -1;
      continue;
    }
    i = next;
  }
  return -1;
}

/** All complete embedded JPEGs, largest first. */
export function findEmbeddedJpegs(bytes: Uint8Array, minLength = 4096): EmbeddedJpeg[] {
  const found: EmbeddedJpeg[] = [];
  const n = bytes.length;
  for (let i = 0; i + 3 < n; i++) {
    if (bytes[i] !== 0xff || bytes[i + 1] !== 0xd8 || bytes[i + 2] !== 0xff) continue;
    const end = jpegEnd(bytes, i);
    if (end < 0) continue;
    const length = end - i;
    if (length >= minLength) found.push({ offset: i, length });
    // Skip past this stream: thumbnails nested inside it aren't separate previews.
    i = end - 1;
  }
  return found.sort((a, b) => b.length - a.length);
}
