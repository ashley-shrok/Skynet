/**
 * mic-level-monitor — watches a dictation mic stream's input level so a mic
 * that is live but delivering silence (wrong input device, OS/hardware mute,
 * another app holding the mic) is caught instead of silently producing an
 * empty transcript.
 *
 * The AudioContext MUST be created inside the user gesture (iOS starts a
 * context created outside one "suspended", which would read as silence) — so
 * callers create it with `createLevelContext()` synchronously in their tap
 * handler and hand it to `createMicLevelMonitor()` once the stream arrives.
 * Samples are only counted while the context is "running"; when it never
 * runs, the verdict is "unknown" and no warning fires.
 *
 * A feed of exact digital zeros also means "unknown", not "silent": a real mic
 * — even a muted room or the wrong input — always carries a noise floor
 * (≈ −70 dBFS). Pure zeros mean the analyser isn't receiving the stream at
 * all (seen on iPhone Safari: the context runs but reads zeros while the
 * recording itself transcribes fine), so the meter can't judge the mic.
 */

/** Windowed RMS below this (≈ −50 dBFS) counts as silence. Speech sits well above −35. */
export const SILENT_RMS = 0.003;
/** How much measured audio without HEARD_MIN_MS of input before warning. */
export const SILENT_WARN_AFTER_MS = 3000;
/**
 * Audio above SILENT_RMS must add up to at least this before the mic counts
 * as heard. A lone transient (the click/pop as a headset mic opens, then
 * digital silence) must not mask a dead mic; even one short word clears it.
 */
export const HEARD_MIN_MS = 300;
/** Less measured audio than this and the end-of-recording verdict is "unknown". */
const MIN_VERDICT_MS = 1000;
const SAMPLE_INTERVAL_MS = 100;

export interface MicLevelSummary {
  /** Milliseconds of audio actually sampled (context running). */
  measuredMs: number;
  /** Loudest 100 ms window, as dBFS (−Infinity when nothing was measured). */
  peakDb: number;
  /** Milliseconds of measured audio at or above SILENT_RMS. */
  heardMs: number;
  /** true = under HEARD_MIN_MS of input; false = heard input; null = couldn't tell. */
  silent: boolean | null;
  /** Every measured sample was exactly 0 — the analyser never saw the stream. */
  allZero: boolean;
  ctxState: string;
}

export interface MicLevelMonitor {
  /**
   * Current input level (windowed RMS, 0–1) read fresh from the analyser, or
   * null when it can't be read (no context, context not running, stopped).
   * Drives the live waveform.
   */
  read: () => number | null;
  stop: () => MicLevelSummary;
}

export function rmsToDb(rms: number): number {
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

/** Create (and resume) the analyser context. Call synchronously in the gesture. */
export function createLevelContext(): AudioContext | null {
  try {
    if (typeof AudioContext === "undefined") return null;
    const ctx = new AudioContext();
    void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

export function closeLevelContext(ctx: AudioContext | null): void {
  if (!ctx || ctx.state === "closed") return;
  void ctx.close().catch(() => {});
}

/**
 * Start sampling `stream` through `ctx`. `onSilentChange(true)` fires once
 * SILENT_WARN_AFTER_MS of measured audio has passed with under HEARD_MIN_MS
 * above SILENT_RMS; `onSilentChange(false)` fires once input reaches it.
 * `stop()` ends sampling, closes the context, and returns the summary.
 */
export function createMicLevelMonitor(
  ctx: AudioContext | null,
  stream: MediaStream,
  onSilentChange: (silent: boolean) => void,
): MicLevelMonitor {
  let measuredMs = 0;
  let peakRms = 0;
  let heardMs = 0;
  let warned = false;
  let stopped = false;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  if (ctx) {
    try {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
    } catch {
      analyser = null;
      source = null;
    }
  }

  const buf = analyser ? new Float32Array(analyser.fftSize) : null;
  const sampleRms = (): number | null => {
    if (stopped || !ctx || !analyser || !buf || ctx.state !== "running") return null;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  };

  if (ctx && analyser) {
    let last = Date.now();
    timer = setInterval(() => {
      const now = Date.now();
      const elapsed = now - last;
      last = now;
      const rms = sampleRms();
      if (rms === null) return;
      measuredMs += elapsed;
      if (rms > peakRms) peakRms = rms;
      if (rms >= SILENT_RMS) heardMs += elapsed;
      if (!warned && measuredMs >= SILENT_WARN_AFTER_MS && peakRms > 0 && heardMs < HEARD_MIN_MS) {
        warned = true;
        onSilentChange(true);
      } else if (warned && heardMs >= HEARD_MIN_MS) {
        warned = false;
        onSilentChange(false);
      }
    }, SAMPLE_INTERVAL_MS);
  }

  return {
    read: sampleRms,
    stop: () => {
      const ctxState = ctx ? ctx.state : "none";
      if (!stopped) {
        stopped = true;
        if (timer) clearInterval(timer);
        try {
          source?.disconnect();
        } catch {
          // already disconnected
        }
        closeLevelContext(ctx);
      }
      const allZero = measuredMs > 0 && peakRms === 0;
      return {
        measuredMs,
        peakDb: rmsToDb(peakRms),
        heardMs,
        silent: measuredMs >= MIN_VERDICT_MS && !allZero ? heardMs < HEARD_MIN_MS : null,
        allZero,
        ctxState,
      };
    },
  };
}

/** The stream's audio tracks (empty for stubs without getAudioTracks). */
export function micTracks(stream: MediaStream): MediaStreamTrack[] {
  return typeof stream.getAudioTracks === "function" ? stream.getAudioTracks() : [];
}

/** Mic track identity + state for logs: which device, and is it muted/live. */
export function describeMicTrack(stream: MediaStream): string {
  const tracks = micTracks(stream);
  if (tracks.length === 0) return "tracks=0";
  return tracks
    .map((t) => {
      let settings: MediaTrackSettings = {};
      try {
        settings = t.getSettings?.() ?? {};
      } catch {
        // getSettings unsupported
      }
      const deviceId = typeof settings.deviceId === "string" ? settings.deviceId.slice(0, 8) : "n/a";
      return (
        `label="${t.label}" deviceId=${deviceId} readyState=${t.readyState} muted=${t.muted} enabled=${t.enabled} ` +
        `sampleRate=${settings.sampleRate ?? "n/a"} channels=${settings.channelCount ?? "n/a"} ` +
        `agc=${settings.autoGainControl ?? "n/a"} ns=${settings.noiseSuppression ?? "n/a"}`
      );
    })
    .join(" | ");
}
