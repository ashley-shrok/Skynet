import { describe, it, expect } from "vitest";
import { base64ToBytes, decodeUtf8, looksLikeText } from "./text-sniff";

const enc = (s: string) => new TextEncoder().encode(s);

describe("looksLikeText", () => {
  it("empty is text", () => {
    expect(looksLikeText(new Uint8Array())).toBe(true);
  });

  it("ASCII and UTF-8 prose is text", () => {
    expect(looksLikeText(enc("hello\nworld\t✓ café"))).toBe(true);
  });

  it("a NUL byte means binary", () => {
    expect(looksLikeText(new Uint8Array([0x68, 0x00, 0x69]))).toBe(false);
  });

  it("mostly control bytes means binary", () => {
    expect(looksLikeText(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 0x41]))).toBe(false);
  });

  it("invalid UTF-8 means binary", () => {
    expect(looksLikeText(new Uint8Array([0x41, 0xc3, 0x28, 0x41]))).toBe(false);
  });

  it("a multi-byte character split by the 8 KiB sample boundary is still text", () => {
    const head = "a".repeat(8191);
    const bytes = enc(head + "é" + "tail");
    expect(bytes[8191]).toBe(0xc3); // first byte of é is the last sampled byte
    expect(looksLikeText(bytes)).toBe(true);
  });
});

describe("base64ToBytes / decodeUtf8", () => {
  it("round-trips UTF-8 text", () => {
    const b64 = btoa(String.fromCharCode(...enc("naïve ✓")));
    expect(decodeUtf8(base64ToBytes(b64))).toBe("naïve ✓");
  });
});
