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
 */

/** Windowed RMS below this (≈ −50 dBFS) counts as silence. Speech sits well above −35. */
export const SILENT_RMS = 0.003;
/** How much measured audio with no window above SILENT_RMS before warning. */
export const SILENT_WARN_AFTER_MS = 3000;
/** Less measured audio than this and the end-of-recording verdict is "unknown". */
const MIN_VERDICT_MS = 1000;
const SAMPLE_INTERVAL_MS = 100;

export interface MicLevelSummary {
  /** Milliseconds of audio actually sampled (context running). */
  measuredMs: number;
  /** Loudest 100 ms window, as dBFS (−Infinity when nothing was measured). */
  peakDb: number;
  /** true = silent the whole time; false = heard input; null = couldn't tell. */
  silent: boolean | null;
  ctxState: string;
}

export interface MicLevelMonitor {
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
 * SILENT_WARN_AFTER_MS of measured audio has passed with nothing above
 * SILENT_RMS; `onSilentChange(false)` fires if input shows up after that.
 * `stop()` ends sampling, closes the context, and returns the summary.
 */
export function createMicLevelMonitor(
  ctx: AudioContext | null,
  stream: MediaStream,
  onSilentChange: (silent: boolean) => void,
): MicLevelMonitor {
  let measuredMs = 0;
  let peakRms = 0;
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

  if (ctx && analyser) {
    const buf = new Float32Array(analyser.fftSize);
    let last = Date.now();
    timer = setInterval(() => {
      const now = Date.now();
      const elapsed = now - last;
      last = now;
      if (ctx.state !== "running" || !analyser) return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      measuredMs += elapsed;
      if (rms > peakRms) peakRms = rms;
      if (!warned && measuredMs >= SILENT_WARN_AFTER_MS && peakRms < SILENT_RMS) {
        warned = true;
        onSilentChange(true);
      } else if (warned && rms >= SILENT_RMS) {
        warned = false;
        onSilentChange(false);
      }
    }, SAMPLE_INTERVAL_MS);
  }

  return {
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
      return {
        measuredMs,
        peakDb: rmsToDb(peakRms),
        silent: measuredMs >= MIN_VERDICT_MS ? peakRms < SILENT_RMS : null,
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
