/**
 * Backup TTS provider support for /voice/speak-stream (TTS_FALLBACK_PROVIDER,
 * resolved in tts-provider.ts).
 *
 *   - Bench: once a provider fails or stalls, messages try the other one
 *     first for BENCH_MS. A benched provider is still used when the other
 *     one fails. In memory only; a restart forgets it.
 *   - Resume point: where the backup picks up a message the selected provider
 *     stopped partway through. Errs early — a repeated sentence is fine, a
 *     skipped one is not.
 *   - Resampler: the response's RIFF header fixes one sample rate up front,
 *     so a backup at a different rate is converted to match.
 */

import { databaseLogger } from "../utils/logger.js";
import { splitIntoSentences } from "./chunk-and-stitch.js";
import type { TtsProviderId } from "./tts-provider.js";

// --- Bench -------------------------------------------------------------------

export const BENCH_MS = 15 * 60_000;

const benchedUntil = new Map<TtsProviderId, number>();

/** Try the other provider first for BENCH_MS after `providerId` failed. */
export function benchProvider(providerId: TtsProviderId, reqId: string, reason: string, now: number = Date.now()): void {
  const already = (benchedUntil.get(providerId) ?? 0) > now;
  benchedUntil.set(providerId, now + BENCH_MS);
  databaseLogger.warn(
    `[voice-server] speak-bench-start reqId=${reqId} provider=${providerId} reason=${reason} benchMin=${BENCH_MS / 60_000} extended=${already}`,
    { operation: "voice_speak_bench_start", reqId, provider: providerId, reason },
  );
}

/** True while `providerId` is benched. Logs (once) when a bench runs out. */
export function isProviderBenched(providerId: TtsProviderId, reqId: string, now: number = Date.now()): boolean {
  const until = benchedUntil.get(providerId);
  if (until === undefined) return false;
  if (until > now) return true;
  benchedUntil.delete(providerId);
  databaseLogger.info(
    `[voice-server] speak-bench-end reqId=${reqId} provider=${providerId} action=try-primary`,
    { operation: "voice_speak_bench_end", reqId, provider: providerId },
  );
  return false;
}

/** Test hook: forget every bench. */
export function clearProviderBench(): void {
  benchedUntil.clear();
}

// --- Resume point --------------------------------------------------------------

/**
 * Speaking rate used to guess how far into the text the played audio got.
 * Deliberately below typical speech (~15-17 chars/sec observed) so the guess
 * lands early.
 */
export const RESUME_CHARS_PER_SEC = 12;

/** Sentences longer than this are also split at clause breaks for resuming. */
const RESUME_UNIT_MAX_CHARS = 200;

/**
 * Resume units: sentences, with long ones (lists, run-ons) further split at
 * commas, semicolons, colons and line breaks so a resume doesn't repeat
 * minutes of audio.
 */
function resumeUnits(text: string): string[] {
  const units: string[] = [];
  for (const sentence of splitIntoSentences(text)) {
    if (sentence.length <= RESUME_UNIT_MAX_CHARS) {
      units.push(sentence);
      continue;
    }
    units.push(...sentence.split(/(?<=[,;:])\s+|\s*\n+\s*/).filter((u) => u.length > 0));
  }
  return units;
}

/**
 * The text still to speak after the selected provider stopped.
 *
 * `chunks` are the message's chunk texts (without tail-guard filler),
 * `failedChunk` the one that stopped, `playedSec` how much of THAT chunk's
 * audio reached the listener. Later chunks are always unplayed. Within the
 * failed chunk the guess backs up to the start of the unit BEFORE the one it
 * falls in — text read slower than the estimate (numbers, codes, pauses)
 * can't push the resume past what was heard. A guess past the chunk's end
 * still repeats its last units, since the audio stopped before the provider
 * finished.
 */
export function resumeText(chunks: readonly string[], failedChunk: number, playedSec: number): string {
  const later = chunks.slice(failedChunk + 1);
  const current = chunks[failedChunk] ?? "";
  if (playedSec <= 0) return [current, ...later].filter(Boolean).join(" ");

  const units = resumeUnits(current);
  const spoken = playedSec * RESUME_CHARS_PER_SEC;
  let at = units.length - 1;
  let offset = 0;
  for (let j = 0; j < units.length; j++) {
    const end = offset + units[j].length;
    if (end > spoken) {
      at = j;
      break;
    }
    offset = end + 1;
  }
  const from = Math.max(at - 1, 0);
  return [units.slice(from).join(" "), ...later].filter(Boolean).join(" ");
}

// --- Resampler -----------------------------------------------------------------

/**
 * Streaming linear-interpolation resampler for signed 16-bit LE mono PCM.
 * Buffers may split a sample or arrive at any size; state carries across
 * push() calls so the output is continuous.
 */
export class PcmResampler {
  private readonly step: number;
  private carry: number | null = null; // odd trailing byte from the last push
  private prev: number | null = null; // last input sample from the last push
  private pos = 0; // next output position, in input samples (prev = index 0 once set)

  constructor(
    readonly inRate: number,
    readonly outRate: number,
  ) {
    this.step = inRate / outRate;
  }

  push(chunk: Buffer): Buffer {
    let buf = chunk;
    if (this.carry !== null) {
      buf = Buffer.concat([Buffer.from([this.carry]), chunk]);
      this.carry = null;
    }
    if (buf.length % 2 === 1) {
      this.carry = buf[buf.length - 1];
      buf = buf.subarray(0, buf.length - 1);
    }
    const n = buf.length / 2;
    if (n === 0) return Buffer.alloc(0);
    if (this.inRate === this.outRate) return Buffer.from(buf);

    const lead = this.prev === null ? 0 : 1;
    const len = n + lead;
    const sample = (k: number) => (k < lead ? (this.prev as number) : buf.readInt16LE((k - lead) * 2));

    const out: number[] = [];
    while (Math.floor(this.pos) + 1 < len) {
      const k = Math.floor(this.pos);
      const a = sample(k);
      const b = sample(k + 1);
      out.push(Math.round(a + (b - a) * (this.pos - k)));
      this.pos += this.step;
    }
    this.prev = sample(len - 1);
    this.pos -= len - 1;

    const outBuf = Buffer.alloc(out.length * 2);
    for (let k = 0; k < out.length; k++) outBuf.writeInt16LE(Math.max(-32768, Math.min(32767, out[k])), k * 2);
    return outBuf;
  }
}
