/**
 * Pure RIFF/WAV header parser and PCM chunk decoder.
 *
 * Reference implementation: Nelly's streaming Chatterbox demo
 * (https://gigaashley.click/tts-demo/ — view-source, lifted wholesale per
 * Nelly's permission). See 19-CONTEXT.md § Frontend player and
 * § Nelly's endpoint spec for the streaming-WAV specifics.
 *
 * Both functions are PURE — no Web Audio API dependency, no side effects,
 * deterministic output for a given input. This makes them independently
 * unit-testable without a mocked audio context.
 *
 * Patch #237 (Phase 19 Plan 04).
 */

/**
 * Fields extracted from the 44-byte standard RIFF/WAV header.
 *
 * The `pcmDataOffset` is the byte index where raw PCM sample data begins
 * (44 for the standard fmt-chunk layout used by Chatterbox streaming output).
 *
 * STREAMING SENTINEL NOTE (Nelly's gotcha #2): Chatterbox streaming WAV sets
 * the file-size field (bytes 4-7) AND the data-chunk-size field (bytes 40-43)
 * to 0xFFFFFFFF (unknown length at synthesis time). Neither field is read or
 * validated here — only the RIFF/WAVE magic bytes and the fmt subchunk fields
 * are parsed.
 */
export interface RiffHeader {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  formatCode: number;
  pcmDataOffset: number;
}

/**
 * Parse the first 44 bytes of a streamed RIFF/WAV response into a RiffHeader.
 *
 * STREAMING SENTINEL NOTE (Nelly's gotcha #2, per 19-CONTEXT.md § Nelly's
 * endpoint spec): The file-size field (bytes 4-7) is 0xFFFFFFFF for streaming
 * WAV output because the total length is unknown at synthesis time. This field
 * is intentionally SKIPPED without validation — do NOT add a size check.
 *
 * @throws Error if input is < 44 bytes, if "RIFF" magic is missing at bytes
 *   0-3, or if "WAVE" magic is missing at bytes 8-11.
 *
 * Reference: https://gigaashley.click/tts-demo/ (Nelly's Chatterbox streaming demo)
 * and .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-CONTEXT.md
 * § Frontend player.
 */
export function parseRiffHeader(bytes: Uint8Array): RiffHeader {
  if (bytes.byteLength < 44) {
    throw new Error(
      `RIFF header requires at least 44 bytes; got ${bytes.byteLength} (too short)`,
    );
  }

  // Validate "RIFF" magic at bytes 0-3.
  const riffMagic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (riffMagic !== "RIFF") {
    throw new Error(
      `Not a RIFF file (missing RIFF magic; got "${riffMagic}")`,
    );
  }

  // bytes 4-7: file size — intentionally NOT validated.
  // The streaming sentinel 0xFFFFFFFF is normal for Chatterbox streaming WAV.
  // (Nelly's gotcha #2 — a naive parser rejects this sentinel.)

  // Validate "WAVE" magic at bytes 8-11.
  const waveMagic = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (waveMagic !== "WAVE") {
    throw new Error(
      `Not a WAVE file (missing WAVE magic; got "${waveMagic}")`,
    );
  }

  // Extract fmt subchunk fields using little-endian DataView reads.
  // The second arg `true` to getUint16/getUint32 selects little-endian byte order.
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const formatCode = dv.getUint16(20, true);
  const channels = dv.getUint16(22, true);
  const sampleRate = dv.getUint32(24, true);
  const bitDepth = dv.getUint16(34, true);

  // v1 assumes a standard 44-byte header (fmt chunk size = 16, no extension fields).
  // Chatterbox streaming output conforms to this standard layout.
  const pcmDataOffset = 44;

  return { sampleRate, channels, bitDepth, formatCode, pcmDataOffset };
}

/**
 * Decode a chunk of raw PCM bytes into one Float32Array per audio channel.
 *
 * Samples are normalized from signed Int16 range [-32768, +32767] to Float32
 * range [-1.0, +1.0) by dividing by 32768. (The maximum positive value
 * 32767/32768 ≈ 0.99997 — not quite 1.0 — which is the standard PCM convention.)
 *
 * For stereo, samples are interleaved in the input (ch0, ch1, ch0, ch1, …);
 * the output is deinterleaved (one Float32Array per channel).
 *
 * Partial trailing frames (byte count not evenly divisible by frameSize) are
 * silently truncated — a partial chunk mid-stream is a normal streaming case
 * and must NOT throw.
 *
 * @param bytes - Raw PCM bytes from the streaming body reader.
 * @param header - Channel + bit-depth fields from parseRiffHeader (or equivalent).
 * @returns One Float32Array per channel, each of length frameCount.
 * @throws Error for unsupported bit depths (only 16-bit PCM is implemented;
 *   Chatterbox streaming output is always 16-bit).
 *
 * Reference: https://gigaashley.click/tts-demo/ (Nelly's Chatterbox streaming demo)
 * and .planning/phases/19-streaming-tts-output-via-chatterbox-tts-endpoint/19-CONTEXT.md
 * § Frontend player.
 */
export function decodePcmChunk(
  bytes: Uint8Array,
  header: Pick<RiffHeader, "channels" | "bitDepth">,
): Float32Array[] {
  if (header.bitDepth !== 16) {
    throw new Error(
      `Unsupported bit depth: only 16-bit PCM is implemented; got ${header.bitDepth}`,
    );
  }

  const bytesPerSample = header.bitDepth / 8; // = 2 for 16-bit
  const frameBytes = header.channels * bytesPerSample;
  const frameCount = Math.floor(bytes.byteLength / frameBytes);

  // Allocate one Float32Array per channel.
  const channelArrays = Array.from(
    { length: header.channels },
    () => new Float32Array(frameCount),
  );

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let frame = 0; frame < frameCount; frame++) {
    for (let ch = 0; ch < header.channels; ch++) {
      const sampleByteOffset = frame * frameBytes + ch * bytesPerSample;
      // Little-endian signed 16-bit read (second arg `true` = LE).
      const int16 = dv.getInt16(sampleByteOffset, true);
      // Normalize to [-1.0, 1.0): divide by 32768 (not 32767) per PCM convention.
      channelArrays[ch][frame] = int16 / 32768;
    }
  }

  return channelArrays;
}
