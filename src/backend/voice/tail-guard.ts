/**
 * TTS tail guard — stops gpt-4o-mini-tts from swallowing the last sentence.
 *
 * gpt-4o-mini-tts (an LLM-based TTS) intermittently ends the audio early and
 * omits the final sentence of its input — most often a short closing line
 * like "Want me to push?". Measured on real agent messages: ~25% of messages
 * lost their ending. OpenAI has acknowledged the bug with no fix (community
 * thread "gpt-4o-mini-tts-2025-12-15 still truncates final sentences").
 *
 * Workaround: append TAIL_GUARD_FILLER after the real text so that, if the
 * model drops anything, it drops the filler. Then cut the filler off the PCM
 * at the pause the model reliably leaves before it.
 *
 * Cut rule (tuned on 40 real messages, validated on 165 held-out clips across
 * 55 unseen messages and all 13 OpenAI voices — 0 real words lost, 0 filler
 * left audible on a cut):
 *   - a "pause" is a run of samples below -45 dBFS lasting ≥ PAUSE_MIN_SEC
 *   - scanning pauses from the end, cut at the first one whose following
 *     speech lasts FILLER_MIN_SEC..FILLER_MAX_SEC (the filler's spoken length)
 *   - none qualifies → refuse: play untrimmed (filler audible, nothing lost)
 * Pauses inside the filler fail the length test, so they're skipped — but a
 * skipped pause as long as a sentence break means the filler was itself cut
 * short, and the scan refuses rather than reach back into real text.
 *
 * Pure — no I/O. Research harness + data: the investigating identity's
 * workspace `tts-research/` (not in this repo).
 */

/** Plain sentence, no commas — keeps the pauses inside it short. */
export const TAIL_GUARD_FILLER =
  "This is the end of the spoken message and nothing more will follow after this final sentence.";

/** -45 dBFS in 16-bit sample units (ffmpeg silencedetect noise=-45dB). */
const SILENCE_AMPLITUDE = Math.round(32768 * Math.pow(10, -45 / 20));
const PAUSE_MIN_SEC = 0.25;
/** Trailing silence shorter than this still counts as speech end. */
const TRAILING_SILENCE_MIN_SEC = 0.1;
const FILLER_MIN_SEC = 3.2;
const FILLER_MAX_SEC = 6.0;
/** Cut this far into the pause (or mid-pause if shorter) — lands in silence. */
const CUT_INTO_PAUSE_SEC = 0.15;
/**
 * Skipping a pause this long on the way back means the trailing speech is
 * likely a truncated filler, and cutting further back would take real words
 * — refuse instead. Pauses inside a fully spoken filler and the sentence
 * break before it overlap in length; 0.5s refuses ~0.8% of good cuts (filler
 * audible) and catches ~70% of truncated fillers (measured, 244 clips).
 */
const SENTENCE_BREAK_SEC = 0.5;

/**
 * PCM the streaming path must hold back before it can decide the cut: the
 * longest filler + a generous pause before it + trailing silence.
 */
export const TAIL_GUARD_HOLD_SEC = 10;

/** Whether the guard applies to this provider/model (the bug is model-specific). */
export function tailGuardApplies(providerId: string, model: string | null): boolean {
  return providerId === "openai" && (model ?? "").startsWith("gpt-4o-mini-tts");
}

export type TailGuardDecision =
  | { decision: "cut"; cutByte: number; pauseSec: number; fillerSec: number }
  | {
      decision: "refused";
      reason: "no-speech" | "no-qualifying-pause" | "filler-truncated";
      speechEndSec: number;
    };

/**
 * Decide where to cut the filler off `pcm` (mono 16-bit LE). `cutByte` is a
 * frame-aligned byte offset into `pcm`: keep `pcm.subarray(0, cutByte)`.
 * `pcm` may be just the tail of the audio (≥ TAIL_GUARD_HOLD_SEC).
 */
export function findTailGuardCut(pcm: Buffer, sampleRate: number): TailGuardDecision {
  const n = Math.floor(pcm.length / 2);
  const pauseMin = Math.round(PAUSE_MIN_SEC * sampleRate);
  const trailingMin = Math.round(TRAILING_SILENCE_MIN_SEC * sampleRate);

  // Silent runs as [startSample, endSample).
  const runs: Array<[number, number]> = [];
  let runStart = -1;
  for (let i = 0; i < n; i++) {
    const quiet = Math.abs(pcm.readInt16LE(i * 2)) < SILENCE_AMPLITUDE;
    if (quiet && runStart < 0) runStart = i;
    else if (!quiet && runStart >= 0) {
      runs.push([runStart, i]);
      runStart = -1;
    }
  }
  if (runStart >= 0) runs.push([runStart, n]);

  let speechEnd = n;
  const last = runs[runs.length - 1];
  if (last && last[1] === n && last[1] - last[0] >= trailingMin) {
    speechEnd = last[0];
    runs.pop();
  }
  if (speechEnd === 0) return { decision: "refused", reason: "no-speech", speechEndSec: 0 };

  const minTail = FILLER_MIN_SEC * sampleRate;
  const maxTail = FILLER_MAX_SEC * sampleRate;
  const sentenceBreak = Math.round(SENTENCE_BREAK_SEC * sampleRate);
  for (let k = runs.length - 1; k >= 0; k--) {
    const [s, e] = runs[k];
    if (s === 0 || e - s < pauseMin) continue; // a run touching the buffer start may be truncated
    const tail = speechEnd - e;
    if (tail < minTail) {
      if (e - s >= sentenceBreak) {
        return { decision: "refused", reason: "filler-truncated", speechEndSec: speechEnd / sampleRate };
      }
      continue;
    }
    if (tail > maxTail) break; // earlier pauses only have longer tails
    const cutSample = s + Math.min(Math.round(CUT_INTO_PAUSE_SEC * sampleRate), Math.floor((e - s) / 2));
    return {
      decision: "cut",
      cutByte: cutSample * 2,
      pauseSec: (e - s) / sampleRate,
      fillerSec: tail / sampleRate,
    };
  }
  return { decision: "refused", reason: "no-qualifying-pause", speechEndSec: speechEnd / sampleRate };
}
