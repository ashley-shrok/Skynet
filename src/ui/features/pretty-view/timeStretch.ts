/**
 * Streaming pitch-preserving time-stretch (WSOLA) for spoken audio.
 *
 * Speeding playback up by raising an AudioBufferSourceNode's playbackRate
 * also raises the pitch (the "chipmunk" effect). WSOLA instead cuts the input
 * into short overlapping frames and lays them down closer together (speed-up)
 * or further apart (slow-down), nudging each frame within a small search
 * window so its waveform lines up with the previous one. Duration changes,
 * pitch doesn't — the method podcast players use, and good on speech up to
 * roughly 2×.
 *
 * Streaming: feed decoded chunks as they arrive with process(); call flush()
 * once at the end for the tail. Chunk boundaries don't matter — the stretcher
 * keeps its own input history and overlap state. Output length is
 * round(totalInput / rate) samples overall.
 *
 * Pure — no Web Audio dependency — so it unit-tests without an AudioContext.
 */

export interface TimeStretcher {
  /** Stretch the next chunk (one Float32Array per channel). May return 0 samples. */
  process(channels: Float32Array[]): Float32Array[];
  /** Drain everything still buffered. Call once, after the last process(). */
  flush(): Float32Array[];
}

/** Frame length. ~30ms covers a couple of pitch periods of any speaking voice. */
const FRAME_SECONDS = 0.03;
/** How far each frame may slide to line up with the previous one. ~10ms ≥ one pitch period. */
const SEARCH_SECONDS = 0.01;

/**
 * Create a stretcher that plays `rate`× as fast (rate 1.3 → 1/1.3 the
 * duration). `rate` 1 passes audio through untouched.
 */
export function createTimeStretcher(sampleRate: number, channelCount: number, rate: number): TimeStretcher {
  if (rate === 1) {
    return { process: (channels) => channels, flush: () => emptyChannels(channelCount, 0) };
  }

  // Frame of N samples laid down every hopOut samples (50% overlap); read from
  // the input every hopIn = hopOut × rate samples.
  const hopOut = Math.max(1, Math.round((FRAME_SECONDS * sampleRate) / 2));
  const frameLen = hopOut * 2;
  const hopIn = hopOut * rate;
  const search = Math.max(1, Math.round(SEARCH_SECONDS * sampleRate));

  // Periodic Hann: two windows at 50% overlap sum to exactly 1, so
  // overlap-add needs no normalisation.
  const win = new Float32Array(frameLen);
  for (let i = 0; i < frameLen; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frameLen);

  // Input history: buf[ch][i] is absolute input sample bufStart + i.
  let buf = emptyChannels(channelCount, 0);
  let bufStart = 0;
  let totalIn = 0;
  let totalOut = 0;
  /** Finished output held back so the total never passes round(totalIn / rate). */
  let held = emptyChannels(channelCount, 0);
  /** Index of the next output frame. */
  let frame = 0;
  /** Absolute input position of the last frame laid down. */
  let prevPos = 0;
  /** Overlap-add accumulator, one frame long. */
  const acc = emptyChannels(channelCount, frameLen);

  function bufEnd(): number {
    return bufStart + (buf[0]?.length ?? 0);
  }

  function append(channels: Float32Array[]): void {
    const add = channels[0]?.length ?? 0;
    if (add === 0) return;
    buf = buf.map((old, ch) => {
      const out = new Float32Array(old.length + add);
      out.set(old, 0);
      out.set(channels[ch] ?? channels[0], old.length);
      return out;
    });
    totalIn += add;
  }

  /** Mono copy (channel mix) of `len` input samples from absolute `abs`, for the alignment search. */
  function mono(abs: number, len: number): Float32Array {
    const i = abs - bufStart;
    if (channelCount === 1) return buf[0].subarray(i, i + len);
    const out = new Float32Array(len);
    for (let ch = 0; ch < channelCount; ch++) {
      const src = buf[ch];
      for (let k = 0; k < len; k++) out[k] += src[i + k];
    }
    return out;
  }

  /**
   * Offset in [-search, search] that best lines the frame at `ideal` up with
   * the natural continuation of the previous frame (normalised
   * cross-correlation over the overlapping half).
   */
  function bestOffset(ideal: number): number {
    const lo = Math.max(-search, bufStart - ideal);
    const ref = mono(prevPos + hopOut, hopOut);
    const cand = mono(ideal + lo, search - lo + hopOut);
    const score = (d: number, step: number): number => {
      let dot = 0;
      let energy = 0;
      for (let i = 0, j = d - lo; i < hopOut; i += step, j += step) {
        const c = cand[j];
        dot += c * ref[i];
        energy += c * c;
      }
      return dot / Math.sqrt(energy + 1e-9);
    };
    // Coarse pass (every 3rd offset, every 2nd sample), then refine around
    // the winner — about a fifth of the cost of a full search.
    let best = lo;
    let bestScore = -Infinity;
    for (let d = lo; d <= search; d += 3) {
      const sc = score(d, 2);
      if (sc > bestScore) {
        bestScore = sc;
        best = d;
      }
    }
    const center = best;
    bestScore = -Infinity;
    for (let d = Math.max(lo, center - 2); d <= Math.min(search, center + 2); d++) {
      const sc = score(d, 1);
      if (sc > bestScore) {
        bestScore = sc;
        best = d;
      }
    }
    return best;
  }

  /** Lay down every frame the buffered input allows; return the finished output. */
  function run(): Float32Array[] {
    const chunks: Float32Array[][] = [];
    for (;;) {
      const ideal = Math.round(frame * hopIn);
      if (ideal + search + frameLen > bufEnd()) break;
      const pos = frame === 0 ? ideal : ideal + bestOffset(ideal);
      const out = emptyChannels(channelCount, hopOut);
      for (let ch = 0; ch < channelCount; ch++) {
        const a = acc[ch];
        const src = buf[ch];
        const base = pos - bufStart;
        // The first frame has nothing to overlap its first half, so it isn't faded in.
        const w0 = frame === 0 ? hopOut : 0;
        for (let i = 0; i < w0; i++) a[i] += src[base + i];
        for (let i = w0; i < frameLen; i++) a[i] += src[base + i] * win[i];
        // The first half can't receive any more overlap: it's final.
        out[ch].set(a.subarray(0, hopOut));
        a.copyWithin(0, hopOut);
        a.fill(0, frameLen - hopOut);
      }
      chunks.push(out);
      prevPos = pos;
      frame++;
    }
    // Drop input no later frame or alignment reference can reach.
    const keepFrom = Math.min(Math.round(frame * hopIn) - search, prevPos + hopOut);
    if (keepFrom > bufStart) {
      const drop = Math.min(keepFrom - bufStart, buf[0].length);
      buf = buf.map((b) => b.slice(drop));
      bufStart += drop;
    }
    return concatChannels(chunks, channelCount);
  }

  /** Emit up to `limit` total samples of held + `out`; hold back the rest. */
  function emit(out: Float32Array[], limit: number): Float32Array[] {
    const all = concatChannels([held, out], channelCount);
    const len = all[0]?.length ?? 0;
    const n = Math.max(0, Math.min(len, limit - totalOut));
    totalOut += n;
    held = all.map((c) => c.slice(n));
    return all.map((c) => c.subarray(0, n));
  }

  return {
    process(channels) {
      append(channels);
      // At high rates a frame can carry output past what the input so far
      // will finally map to; that part waits for more input (or flush's trim).
      return emit(run(), Math.floor(totalIn / rate));
    },
    flush() {
      const target = Math.round(totalIn / rate);
      // Silence past the end lets the last frames be laid down; the excess is trimmed.
      const padLen = frameLen + 2 * search + Math.ceil(hopIn) * 2;
      const realIn = totalIn;
      append(emptyChannels(channelCount, padLen));
      totalIn = realIn;
      const out = run();
      const tail = acc.map((a) => a.slice(0, hopOut));
      return emit(concatChannels([out, tail], channelCount), target);
    },
  };
}

function emptyChannels(channelCount: number, length: number): Float32Array[] {
  return Array.from({ length: channelCount }, () => new Float32Array(length));
}

function concatChannels(parts: Float32Array[][], channelCount: number): Float32Array[] {
  const total = parts.reduce((n, p) => n + (p[0]?.length ?? 0), 0);
  const out = emptyChannels(channelCount, total);
  let off = 0;
  for (const p of parts) {
    for (let ch = 0; ch < channelCount; ch++) out[ch].set(p[ch], off);
    off += p[0]?.length ?? 0;
  }
  return out;
}
