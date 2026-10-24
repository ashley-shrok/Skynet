/**
 * voice-mode-cues — every sound hands-free voice mode makes, played through
 * the voice mode's own AudioContext.
 *
 * Why the AudioContext and not `new Audio()`: voice mode creates its context
 * inside the start tap, so it is unlocked; iOS Safari blocks or misroutes
 * HTMLAudioElement playback started outside a gesture while getUserMedia holds
 * the mic, which is why v1's send cue was never heard on iPhone.
 *
 * The sounds of the round trip (shape-voice-mode-v2):
 *   sent     — the compose-box mic's stop sound, when a message is sent
 *   yourTurn — the compose-box mic's start sound, when the agent is done
 *   error    — the mic's error sound (a reply couldn't be spoken, etc.)
 *   off      — the auto-speak "off" chime, when voice mode ends
 *   alarm    — synthesized, deliberately unpleasant: voice mode bailed
 *   ticking  — synthesized soft wooden tick twice a second while the agent
 *              works (the tasted "soft ticking" variant)
 */

import startUrl from "../../assets/sounds/mic/start.mp3?url";
import stopUrl from "../../assets/sounds/mic/stop.mp3?url";
import errorUrl from "../../assets/sounds/mic/error.mp3?url";
import offUrl from "../../assets/sounds/auto-speak/off.mp3?url";

export type VoiceModeCue = "sent" | "yourTurn" | "error" | "off" | "alarm";

export interface VoiceModeCues {
  /** Play a cue; false when it couldn't be (sample not loaded, disposed, error). */
  play: (cue: VoiceModeCue) => boolean;
  startTicking: () => void;
  stopTicking: () => void;
  isTicking: () => boolean;
  dispose: () => void;
}

const SAMPLE_URLS: Record<Exclude<VoiceModeCue, "alarm">, string> = {
  sent: stopUrl,
  yourTurn: startUrl,
  error: errorUrl,
  off: offUrl,
};

/** Seconds between ticks, and how far ahead ticks are scheduled. */
const TICK_INTERVAL_S = 0.5;
const TICK_LOOKAHEAD_S = 0.4;
const TICK_SCHEDULER_MS = 100;
/** Overall ticking loudness (the tasting's default volume × tick peak). */
const TICK_GAIN = 0.12;
const ALARM_GAIN = 0.35;

export function createVoiceModeCues(ctx: AudioContext, log: (msg: string) => void): VoiceModeCues {
  const buffers = new Map<VoiceModeCue, AudioBuffer>();
  let disposed = false;

  // Decode the samples up front so a cue never waits on the network.
  for (const [cue, url] of Object.entries(SAMPLE_URLS) as Array<[VoiceModeCue, string]>) {
    void fetch(url)
      .then((r) => r.arrayBuffer())
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => {
        if (!disposed) buffers.set(cue, buf);
      })
      .catch((err) => {
        log(`cue-decode-failed cue=${cue} errMessage="${err instanceof Error ? err.message : String(err)}"`);
      });
  }

  const wake = () => {
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
  };

  const playAlarm = () => {
    const out = ctx.createGain();
    out.gain.value = ALARM_GAIN;
    out.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.02;
    for (let i = 0; i < 3; i += 1) {
      const t = t0 + i * 0.32;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.setValueAtTime(880, t);
      o.frequency.exponentialRampToValueAtTime(220, t + 0.26);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(1, t + 0.01);
      g.gain.setValueAtTime(1, t + 0.22);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.27);
      o.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + 0.3);
    }
  };

  const play = (cue: VoiceModeCue): boolean => {
    if (disposed) return false;
    wake();
    try {
      if (cue === "alarm") {
        playAlarm();
        return true;
      }
      const buf = buffers.get(cue);
      if (!buf) {
        log(`cue-not-ready cue=${cue}`);
        return false;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
      return true;
    } catch (err) {
      log(`cue-play-failed cue=${cue} errMessage="${err instanceof Error ? err.message : String(err)}"`);
      return false;
    }
  };

  // ---- Ticking --------------------------------------------------------------

  let tickOut: GainNode | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;

  const tick = (out: GainNode, t: number, freq: number) => {
    const o = ctx.createOscillator();
    const bp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = freq;
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = 4;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.8, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(bp);
    bp.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.06);
  };

  const startTicking = () => {
    if (disposed || tickOut) return;
    wake();
    try {
      const out = ctx.createGain();
      out.gain.value = TICK_GAIN;
      out.connect(ctx.destination);
      tickOut = out;
      let next = ctx.currentTime + 0.05;
      let n = 0;
      const schedule = () => {
        if (tickOut !== out) return;
        // After a suspension the clock may have jumped; never backfill.
        if (next < ctx.currentTime) next = ctx.currentTime + 0.05;
        while (next < ctx.currentTime + TICK_LOOKAHEAD_S) {
          tick(out, next, n % 2 ? 1400 : 1150);
          n += 1;
          next += TICK_INTERVAL_S;
        }
      };
      schedule();
      tickTimer = setInterval(schedule, TICK_SCHEDULER_MS);
    } catch (err) {
      tickOut = null;
      log(`ticking-start-failed errMessage="${err instanceof Error ? err.message : String(err)}"`);
    }
  };

  const stopTicking = () => {
    if (tickTimer !== null) clearInterval(tickTimer);
    tickTimer = null;
    // Disconnecting the bus silences already-scheduled ticks at once.
    try {
      tickOut?.disconnect();
    } catch {
      /* already gone */
    }
    tickOut = null;
  };

  return {
    play,
    startTicking,
    stopTicking,
    isTicking: () => tickOut !== null,
    dispose: () => {
      stopTicking();
      disposed = true;
      buffers.clear();
    },
  };
}
