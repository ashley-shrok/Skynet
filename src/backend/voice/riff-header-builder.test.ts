import { describe, it, expect } from "vitest";
import { buildRiffHeader } from "./riff-header-builder.js";

/**
 * Phase 98 plan 02 — riff-header-builder truth-table test suite.
 *
 * Locks the 44-byte RIFF+PCM header layout that the frontend's
 * `src/ui/features/pretty-view/riffPcmDecode.ts` (Phase 19) consumes.
 * The client-side decoder is unchanged in Phase 98; this builder MUST
 * emit bytes the decoder will parse without error.
 *
 * Coverage rationale:
 *
 * - Byte-length invariant (always 44) — the decoder assumes standard
 *   fmt-chunk layout with `pcmDataOffset = 44`.
 *
 * - ASCII markers at fixed offsets ("RIFF", "WAVE", "fmt ", "data") —
 *   the decoder validates the RIFF and WAVE markers by name at bytes
 *   0-3 and 8-11 respectively; missing or misspelled markers cause it
 *   to throw.
 *
 * - Numeric fields: format code (1 = PCM), channels, sample rate,
 *   byte rate = sampleRate * channels * (bitDepth/8), block align =
 *   channels * (bitDepth/8), bit depth, and dataSize. Two different
 *   {channels, sampleRate, bitDepth} combinations sanity-check the math.
 *
 * - dataSize default is 0xFFFFFFFF (streaming sentinel matching
 *   riffPcmDecode.ts's "gotcha #2" comment — decoder intentionally
 *   ignores this field). A custom dataSize argument reflects into
 *   bytes 40-43.
 */

describe("buildRiffHeader — length + magic markers (Polly PCM defaults: mono, 16kHz, 16-bit)", () => {
  const header = buildRiffHeader({ channels: 1, sampleRate: 16000, bitDepth: 16 });

  it("returns a Buffer of length exactly 44", () => {
    expect(Buffer.isBuffer(header)).toBe(true);
    expect(header.length).toBe(44);
  });

  it("bytes 0-3 spell 'RIFF' (ASCII)", () => {
    expect(header.toString("ascii", 0, 4)).toBe("RIFF");
  });

  it("bytes 8-11 spell 'WAVE' (ASCII)", () => {
    expect(header.toString("ascii", 8, 12)).toBe("WAVE");
  });

  it("bytes 12-15 spell 'fmt ' (ASCII, note trailing space)", () => {
    expect(header.toString("ascii", 12, 16)).toBe("fmt ");
  });

  it("bytes 36-39 spell 'data' (ASCII)", () => {
    expect(header.toString("ascii", 36, 40)).toBe("data");
  });
});

describe("buildRiffHeader — fmt subchunk numeric fields (Polly PCM defaults)", () => {
  const header = buildRiffHeader({ channels: 1, sampleRate: 16000, bitDepth: 16 });

  it("bytes 16-19 encode 16 (LE uint32) — Subchunk1Size for PCM", () => {
    expect(header.readUInt32LE(16)).toBe(16);
  });

  it("bytes 20-21 encode 1 (LE uint16) — AudioFormat = 1 (PCM)", () => {
    expect(header.readUInt16LE(20)).toBe(1);
  });

  it("bytes 22-23 encode channels (LE uint16) — 1 for mono", () => {
    expect(header.readUInt16LE(22)).toBe(1);
  });

  it("bytes 24-27 encode sampleRate (LE uint32) — 16000", () => {
    expect(header.readUInt32LE(24)).toBe(16000);
  });

  it("bytes 28-31 encode byteRate (LE uint32) = sampleRate * channels * bitDepth/8 = 32000", () => {
    // 16000 * 1 * 2 = 32000
    expect(header.readUInt32LE(28)).toBe(32000);
  });

  it("bytes 32-33 encode blockAlign (LE uint16) = channels * bitDepth/8 = 2", () => {
    // 1 * 2 = 2
    expect(header.readUInt16LE(32)).toBe(2);
  });

  it("bytes 34-35 encode bitDepth (LE uint16) — 16", () => {
    expect(header.readUInt16LE(34)).toBe(16);
  });
});

describe("buildRiffHeader — dataSize default (streaming sentinel) + custom override", () => {
  it("default dataSize is 0xFFFFFFFF (streaming sentinel — matches Nelly's gotcha #2 in riffPcmDecode)", () => {
    const header = buildRiffHeader({ channels: 1, sampleRate: 16000, bitDepth: 16 });
    expect(header.readUInt32LE(40)).toBe(0xffffffff);
  });

  it("custom dataSize reflects in bytes 40-43", () => {
    const header = buildRiffHeader({
      channels: 1,
      sampleRate: 16000,
      bitDepth: 16,
      dataSize: 1024,
    });
    expect(header.readUInt32LE(40)).toBe(1024);
  });
});

describe("buildRiffHeader — different {channels, sampleRate, bitDepth} combinations", () => {
  it("stereo 48kHz 24-bit: byteRate = 48000*2*3 = 288000, blockAlign = 2*3 = 6", () => {
    const header = buildRiffHeader({ channels: 2, sampleRate: 48000, bitDepth: 24 });
    expect(header.length).toBe(44);
    expect(header.readUInt16LE(22)).toBe(2); // channels
    expect(header.readUInt32LE(24)).toBe(48000); // sampleRate
    expect(header.readUInt32LE(28)).toBe(288000); // byteRate
    expect(header.readUInt16LE(32)).toBe(6); // blockAlign
    expect(header.readUInt16LE(34)).toBe(24); // bitDepth
    // ASCII markers still correct
    expect(header.toString("ascii", 0, 4)).toBe("RIFF");
    expect(header.toString("ascii", 8, 12)).toBe("WAVE");
  });

  it("mono 44100Hz 16-bit: byteRate = 44100*1*2 = 88200, blockAlign = 1*2 = 2", () => {
    const header = buildRiffHeader({ channels: 1, sampleRate: 44100, bitDepth: 16 });
    expect(header.length).toBe(44);
    expect(header.readUInt16LE(22)).toBe(1); // channels
    expect(header.readUInt32LE(24)).toBe(44100); // sampleRate
    expect(header.readUInt32LE(28)).toBe(88200); // byteRate
    expect(header.readUInt16LE(32)).toBe(2); // blockAlign
    expect(header.readUInt16LE(34)).toBe(16); // bitDepth
  });
});
