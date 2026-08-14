/**
 * Phase 40 Plan 40-01 (D-02): Inline byte-sniff heuristic for text/binary
 * classification of agent-served tailnet files.
 *
 * This is the FALLBACK path when a file's extension is not in the
 * EDITABLE_EXTENSIONS whitelist (see editable-file-whitelist.ts). Runs on the
 * bytes returned from POST /pretty-view/fetch-tailnet-url; the caller
 * (frontend eligibility hook) discards the bytes after classification per D-04.
 *
 * Heuristic (file(1)-style):
 *   1. Sample the first 8192 bytes only (bound cost; body may be up to 2 MB).
 *   2. Empty buffer → true (trivially editable).
 *   3. Any 0x00 byte in the sample → false (null-byte is a hard binary marker).
 *   4. Printable-byte ratio must be ≥ 0.9. Printable = 0x09/0x0A/0x0D, 0x20..0x7E,
 *      or 0x80..0xFF (UTF-8 continuation bytes; validity is checked in step 5).
 *   5. new TextDecoder("utf-8", { fatal: true }).decode(sample) must not throw.
 *
 * False positives are ACCEPTABLE per shape lock — the return trip goes through
 * Ashley reviewing an editor before saving, and the agent judges the received
 * attachment. Worst case: editor shows garbage, Ashley doesn't save.
 *
 * No external dependencies. Rejected libraries (`isbinaryfile`, `istextorbinary`)
 * would earn zero benefit for ~30 LoC saved and add slopcheck/install drag.
 */

/**
 * Returns true if the buffer looks like text (per file(1)-style heuristic).
 *
 * @param buf raw bytes (typically from a fetched file body)
 * @returns true if bytes look like text, false if they look like binary
 */
export function sniffTextBytes(buf: Uint8Array): boolean {
  const sample = buf.length > 8192 ? buf.subarray(0, 8192) : buf;
  if (sample.length === 0) return true; // empty is trivially editable

  let printableCount = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    // Null byte is the hard binary marker — file(1) uses the same rule.
    if (b === 0x00) return false;
    // Printable: tab, LF, CR; 0x20..0x7E (printable ASCII); 0x80..0xFF
    // (candidate UTF-8 continuation bytes — validity is checked below).
    if (
      b === 0x09 ||
      b === 0x0a ||
      b === 0x0d ||
      (b >= 0x20 && b <= 0x7e) ||
      (b >= 0x80 && b <= 0xff)
    ) {
      printableCount++;
    }
  }

  // ≥ 90% printable — same threshold `file(1)` uses in "ascii" mode.
  const ratio = printableCount / sample.length;
  if (ratio < 0.9) return false;

  // UTF-8 validity check: catches "printable-looking" binary that happens to
  // avoid null bytes (e.g. a gzip stream whose compressed bytes dodge 0x00).
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}
