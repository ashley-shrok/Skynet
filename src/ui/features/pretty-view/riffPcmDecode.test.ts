/**
 * Unit tests for riffPcmDecode.ts — pure RIFF/WAV header parser and PCM decoder.
 *
 * Reference: Nelly's streaming Chatterbox demo pattern
 * (https://gigaashley.click/tts-demo/ view-source) lifted per her permission.
 * See 19-CONTEXT.md § Frontend player and § Nelly's endpoint spec.
 *
 * Phase 19, Plan 04 (patch #237).
 */
import { describe, it, expect } from "vitest";
import { parseRiffHeader, decodePcmChunk } from "./riffPcmDecode";

/**
 * Helper: build a minimal valid 44-byte RIFF/WAV header.
 * fileSize can be set to 0xFFFFFFFF to test the streaming sentinel.
 */
function makeHeader(opts: {
  channels?: number;
  sampleRate?: number;
  bitDepth?: number;
  fileSize?: number;
  riffMagic?: string;
  waveMagic?: string;
}): Uint8Array {
  const {
    channels = 1,
    sampleRate = 24000,
    bitDepth = 16,
    fileSize = 0x00000100,
    riffMagic = "RIFF",
    waveMagic = "WAVE",
  } = opts;

  const buf = new Uint8Array(44);
  const dv = new DataView(buf.buffer);

  // Bytes 0-3: "RIFF" magic
  for (let i = 0; i < 4; i++) buf[i] = riffMagic.charCodeAt(i);
  // Bytes 4-7: file size (can be 0xFFFFFFFF sentinel when streaming)
  dv.setUint32(4, fileSize, true);
  // Bytes 8-11: "WAVE" magic
  for (let i = 0; i < 4; i++) buf[8 + i] = waveMagic.charCodeAt(i);
  // Bytes 12-15: "fmt " subchunk marker
  buf.set([0x66, 0x6d, 0x74, 0x20], 12);
  // Bytes 16-19: fmt chunk size = 16 (standard PCM)
  dv.setUint32(16, 16, true);
  // Bytes 20-21: format code = 1 (PCM)
  dv.setUint16(20, 1, true);
  // Bytes 22-23: channels
  dv.setUint16(22, channels, true);
  // Bytes 24-27: sample rate
  dv.setUint32(24, sampleRate, true);
  // Bytes 28-31: byte rate = sampleRate * channels * bitDepth/8
  dv.setUint32(28, sampleRate * channels * (bitDepth / 8), true);
  // Bytes 32-33: block align = channels * bitDepth/8
  dv.setUint16(32, channels * (bitDepth / 8), true);
  // Bytes 34-35: bits per sample
  dv.setUint16(34, bitDepth, true);
  // Bytes 36-39: "data" subchunk marker
  buf.set([0x64, 0x61, 0x74, 0x61], 36);
  // Bytes 40-43: data chunk size (0 for the base header, or 0xFFFFFFFF streaming sentinel)
  dv.setUint32(40, 0, true);

  return buf;
}

describe("parseRiffHeader", () => {
  it("Test 1 — happy path: extracts sampleRate, channels, bitDepth, formatCode, pcmDataOffset", () => {
    const header = makeHeader({ channels: 1, sampleRate: 24000, bitDepth: 16 });
    const result = parseRiffHeader(header);
    expect(result.sampleRate).toBe(24000);
    expect(result.channels).toBe(1);
    expect(result.bitDepth).toBe(16);
    expect(result.formatCode).toBe(1);
    expect(result.pcmDataOffset).toBe(44);
  });

  it("Test 2 — streaming sentinel (0xFFFFFFFF file size) does NOT throw", () => {
    // Nelly's gotcha #2: streaming WAV uses 0xFFFFFFFF in bytes 4-7 for the
    // file-size field (unknown length at synthesis time). A naive parser
    // that validates this field would reject valid streaming audio.
    const header = makeHeader({ fileSize: 0xffffffff });
    // Must not throw — the sentinel is normal per 19-CONTEXT.md § Nelly's endpoint spec.
    expect(() => parseRiffHeader(header)).not.toThrow();
    const result = parseRiffHeader(header);
    expect(result.sampleRate).toBe(24000);
    expect(result.channels).toBe(1);
  });

  it("Test 3 — stereo 48kHz 16-bit: correct extraction", () => {
    const header = makeHeader({ channels: 2, sampleRate: 48000, bitDepth: 16 });
    const result = parseRiffHeader(header);
    expect(result.channels).toBe(2);
    expect(result.sampleRate).toBe(48000);
    expect(result.bitDepth).toBe(16);
  });

  it("Test 4 — missing RIFF magic throws with /RIFF/i", () => {
    const header = makeHeader({ riffMagic: "\x00\x00\x00\x00" });
    expect(() => parseRiffHeader(header)).toThrow(/RIFF/i);
  });

  it("Test 5 — missing WAVE magic throws with /WAVE/i", () => {
    const header = makeHeader({ waveMagic: "XYZW" });
    expect(() => parseRiffHeader(header)).toThrow(/WAVE/i);
  });

  it("Test 6 — input shorter than 44 bytes throws with /44 bytes|too short/i", () => {
    const short = new Uint8Array(30);
    expect(() => parseRiffHeader(short)).toThrow(/44 bytes|too short/i);
  });
});

describe("decodePcmChunk", () => {
  it("Test 7 — mono Int16: decodes three samples to Float32 correctly", () => {
    // Three 16-bit little-endian samples: 0x0000=0, 0x7FFF=+32767, 0x8000=-32768
    const input = new Uint8Array([
      0x00, 0x00, // 0
      0xff, 0x7f, // +32767
      0x00, 0x80, // -32768
    ]);
    const result = decodePcmChunk(input, { channels: 1, bitDepth: 16 });
    expect(result).toHaveLength(1); // one channel
    expect(result[0]).toHaveLength(3); // three frames
    expect(result[0][0]).toBeCloseTo(0 / 32768, 6);
    expect(result[0][1]).toBeCloseTo(32767 / 32768, 6);
    expect(result[0][2]).toBeCloseTo(-32768 / 32768, 6);
  });

  it("Test 8 — stereo Int16 deinterleave: ch0 and ch1 correctly split", () => {
    // 2 stereo frames: [ch0=0, ch1=+32767, ch0=-32768, ch1=+16384]
    // Each sample is 2 bytes LE.
    const input = new Uint8Array([
      0x00, 0x00, // frame0, ch0 = 0
      0xff, 0x7f, // frame0, ch1 = +32767
      0x00, 0x80, // frame1, ch0 = -32768
      0x00, 0x40, // frame1, ch1 = +16384
    ]);
    const result = decodePcmChunk(input, { channels: 2, bitDepth: 16 });
    expect(result).toHaveLength(2); // two channels
    expect(result[0]).toHaveLength(2); // two frames
    expect(result[1]).toHaveLength(2);
    // ch0: [0, -32768/32768]
    expect(result[0][0]).toBeCloseTo(0 / 32768, 6);
    expect(result[0][1]).toBeCloseTo(-32768 / 32768, 6);
    // ch1: [32767/32768, 16384/32768]
    expect(result[1][0]).toBeCloseTo(32767 / 32768, 6);
    expect(result[1][1]).toBeCloseTo(16384 / 32768, 6);
  });

  it("Test 9 — partial frame truncation: 5-byte mono input yields 2 frames (not 2.5)", () => {
    // 5 bytes / 2 bytes-per-frame = 2.5 → floor to 2 frames; orphan byte discarded
    const input = new Uint8Array(5);
    const result = decodePcmChunk(input, { channels: 1, bitDepth: 16 });
    expect(result[0]).toHaveLength(2);
  });

  it("Test 10 — unsupported bit depth (8-bit) throws /bit depth|unsupported/i", () => {
    const input = new Uint8Array([0x80]);
    expect(() => decodePcmChunk(input, { channels: 1, bitDepth: 8 })).toThrow(
      /bit depth|unsupported/i,
    );
  });
});
