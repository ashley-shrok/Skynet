/**
 * Phase 98 plan 02 — 44-byte RIFF+PCM header synthesizer (pure kernel).
 *
 * This module ships as a partner to `polly-adapter.ts` (Phase 98 Plan 04).
 * Polly's PCM output format is raw signed-16-bit little-endian mono PCM at
 * 16000 Hz — no container, no header. The client-side player at
 * `src/ui/features/pretty-view/riffPcmDecode.ts` (Phase 19) parses a
 * standard 44-byte RIFF+PCM header before decoding the PCM sample stream.
 *
 * This builder synthesizes exactly the header layout that `riffPcmDecode.ts`
 * expects. The 44-byte layout is prepended to the FIRST chunk of PCM in a
 * `handleSpeakStream` response; subsequent Polly chunks in the same stream
 * emit raw PCM only. Coordination happens in the handler.
 *
 * DO NOT drift this header layout without also updating the client-side
 * parser in the same commit — the two are a tightly-coupled pair and the
 * parser has field-position assumptions baked in (e.g. `pcmDataOffset = 44`
 * at line 88 of riffPcmDecode.ts).
 *
 * Header byte layout (see WAVE/RIFF spec + riffPcmDecode.ts for reader):
 *   bytes  0-3    "RIFF" (ASCII)
 *   bytes  4-7    chunkSize = dataSize + 36 (LE uint32; streaming sentinel
 *                 overflows harmlessly — decoder ignores this field, per
 *                 riffPcmDecode.ts gotcha #2)
 *   bytes  8-11   "WAVE" (ASCII)
 *   bytes 12-15   "fmt " (ASCII, trailing space is intentional)
 *   bytes 16-19   Subchunk1Size = 16 (LE uint32; PCM fmt chunk size)
 *   bytes 20-21   AudioFormat = 1 (LE uint16; 1 = PCM)
 *   bytes 22-23   NumChannels (LE uint16)
 *   bytes 24-27   SampleRate (LE uint32)
 *   bytes 28-31   ByteRate = SampleRate * NumChannels * BitsPerSample/8 (LE uint32)
 *   bytes 32-33   BlockAlign = NumChannels * BitsPerSample/8 (LE uint16)
 *   bytes 34-35   BitsPerSample (LE uint16)
 *   bytes 36-39   "data" (ASCII)
 *   bytes 40-43   dataSize (LE uint32; default 0xFFFFFFFF streaming sentinel)
 *
 * This module is pure — no imports (Buffer is a Node global), no async,
 * no I/O, no side effects. Safe to call on hot-path per-request from
 * handleSpeakStream.
 */

/**
 * Build a 44-byte standard RIFF+PCM header for streaming PCM audio.
 *
 * @param channels - Number of audio channels (1 for mono; Polly emits 1).
 * @param sampleRate - Sample rate in Hz (16000 for Polly PCM at 16kHz).
 * @param bitDepth - Bits per sample (16 for Polly PCM — signed 16-bit LE).
 * @param dataSize - PCM data byte count. Defaults to 0xFFFFFFFF (streaming
 *                   sentinel: total size unknown at header-write time). The
 *                   consumer (riffPcmDecode.ts) intentionally does not read
 *                   this field for streaming input.
 * @returns A `Buffer` of length exactly 44 containing the header bytes.
 */
export function buildRiffHeader({
  channels,
  sampleRate,
  bitDepth,
  dataSize = 0xffffffff,
}: {
  channels: number;
  sampleRate: number;
  bitDepth: number;
  dataSize?: number;
}): Buffer {
  const buf = Buffer.alloc(44);
  const byteRate = sampleRate * channels * (bitDepth / 8);
  const blockAlign = channels * (bitDepth / 8);

  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE((dataSize + 36) >>> 0, 4); // ChunkSize = data + 36 (unsigned)
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // Subchunk1Size for PCM
  buf.writeUInt16LE(1, 20); // AudioFormat = 1 (PCM)
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitDepth, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);

  return buf;
}
