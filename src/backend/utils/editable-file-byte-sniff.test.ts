/**
 * Phase 40 Plan 40-01 (D-02): Tests for the inline byte-sniff heuristic that
 * is the FALLBACK path when an agent-served tailnet file's extension is not
 * in the EDITABLE_EXTENSIONS whitelist.
 *
 * The heuristic (see editable-file-byte-sniff.ts) implements file(1)-style
 * "text or binary" detection over the first 8192 bytes:
 *   - empty buffer  → true (trivially editable)
 *   - any 0x00 byte → false (null-byte is a hard binary marker)
 *   - printable-byte ratio must be ≥ 0.9
 *   - final gate:   TextDecoder("utf-8", { fatal: true }).decode(sample) must not throw
 *
 * False positives are acceptable per shape lock (see 40-CONTEXT §Eligibility check).
 */

import { describe, it, expect } from "vitest";
import { sniffTextBytes } from "./editable-file-byte-sniff.js";

describe("sniffTextBytes — file(1)-style text/binary detection", () => {
  it("Test 1: empty buffer is trivially editable", () => {
    expect(sniffTextBytes(new Uint8Array())).toBe(true);
  });

  it("Test 2: any null byte in the first 8192 bytes returns false (hard binary marker)", () => {
    // 100 bytes of ASCII 'a' with a single 0x00 at index 50.
    const buf = new Uint8Array(100);
    for (let i = 0; i < 100; i++) buf[i] = 0x61; // 'a'
    buf[50] = 0x00;
    expect(sniffTextBytes(buf)).toBe(false);
  });

  it("Test 3: 'hello world\\n' as UTF-8 bytes returns true", () => {
    const buf = new TextEncoder().encode("hello world\n");
    expect(sniffTextBytes(buf)).toBe(true);
  });

  it("Test 4: 89% printable + 11% non-null non-tab/CR/LF control chars returns false (below 0.9)", () => {
    // 1000-byte buffer. First 890 bytes = printable ASCII 'a' (0x61).
    // Last 110 bytes = 0x01..0x08 non-null control chars (NOT tab/LF/CR/space, NOT in 0x20..0x7e, NOT ≥0x80).
    // Printable count = 890 / 1000 = 0.89 → below the 0.9 threshold → false.
    const buf = new Uint8Array(1000);
    for (let i = 0; i < 890; i++) buf[i] = 0x61;
    for (let i = 890; i < 1000; i++) buf[i] = 0x01 + ((i - 890) % 8);
    // Sanity: none of these are 0x00 (would short-circuit before ratio check).
    expect(Array.from(buf).some((b) => b === 0x00)).toBe(false);
    expect(sniffTextBytes(buf)).toBe(false);
  });

  it("Test 5: valid UTF-8 with 3-byte sequences ('日本語') returns true (TextDecoder fatal:true does not throw)", () => {
    const buf = new TextEncoder().encode("日本語 hello");
    expect(sniffTextBytes(buf)).toBe(true);
  });

  it("Test 6: invalid UTF-8 lead byte 0xC0 followed by 0x41 (not a valid continuation) returns false", () => {
    // 0xC0 is a 2-byte lead requiring a 0x80..0xBF continuation. 0x41 ('A') is not.
    // Pad with printable ASCII so the printable-ratio gate does not short-circuit first.
    const printable = new Uint8Array(200);
    for (let i = 0; i < 200; i++) printable[i] = 0x61;
    const buf = new Uint8Array(202);
    buf.set(printable, 0);
    buf[200] = 0xc0;
    buf[201] = 0x41;
    // No null bytes; ratio ≥ 0.9 (both 0xC0 and 0x41 count as printable by the
    // pre-decode gate — 0xC0 is in 0x80..0xff, 0x41 is in 0x20..0x7e) — so the
    // only rejection path is TextDecoder throwing.
    expect(Array.from(buf).some((b) => b === 0x00)).toBe(false);
    expect(sniffTextBytes(buf)).toBe(false);
  });

  it("Test 7: only the first 8192 bytes are inspected — a null byte at index 10000 does NOT poison the verdict", () => {
    // 20 KB buffer of printable ASCII 'a' with a single 0x00 at index 10000.
    const buf = new Uint8Array(20_000);
    for (let i = 0; i < 20_000; i++) buf[i] = 0x61;
    buf[10_000] = 0x00;
    // Sniff only samples [0..8192), so the null at 10000 is invisible.
    expect(sniffTextBytes(buf)).toBe(true);
  });
});
