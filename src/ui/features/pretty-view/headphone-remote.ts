/**
 * headphone-remote — headphone / lock-screen buttons for "press to talk" voice
 * mode (voiceModeListen = "press").
 *
 * What iOS allows (measured on an iPhone + AirPods, home-screen app, 2026-10-22):
 *   - While the page holds an open mic, iOS treats the AirPods like a phone
 *     call: a stem press plays iOS's own call-mute tones and never reaches the
 *     page. So the mic must be fully closed between turns.
 *   - With the mic closed, presses reach the page as Media Session actions —
 *     single press = play/pause, double press = nexttrack — but only while the
 *     page is the phone's "now playing" app. Web Audio alone doesn't make it
 *     that; a playing <audio> element does, so a near-silent loop runs for the
 *     whole session.
 *   - Each press is delivered twice within a millisecond — debounced here.
 *   - getUserMedia works from inside a press handler (no tap needed), and the
 *     mic takes 2-3 s to open while the AirPods switch to headset mode.
 *   - After the mic closes, iOS stays in call mode unless the page says it is
 *     back to playback (navigator.audioSession.type) AND the mic's
 *     AudioContext is closed AND the loop is restarted to re-claim "now
 *     playing". useVoiceMode does the first two; reclaim() does the third.
 *
 * Create inside a user gesture (the voice-mode start tap): the loop's first
 * play() needs one.
 */

/** Presses closer together than this are one press. */
export const PRESS_DEBOUNCE_MS = 700;
/** Let iOS finish switching the AirPods out of headset mode before re-claiming. */
export const RECLAIM_DELAY_MS = 400;

export interface HeadphoneRemote {
  /** Restart the loop and handlers so presses come back here (after the mic closes). */
  reclaim: () => void;
  dispose: () => void;
}

export interface HeadphoneRemoteOptions {
  /** Single press (play / pause / toggle-microphone). */
  onPress: () => void;
  /** Double press (next track / seek forward). */
  onSkip: () => void;
  log: (msg: string) => void;
}

type AudioSessionType = "auto" | "playback" | "play-and-record" | "transient" | "transient-solo" | "ambient";

/**
 * Tell the phone what kind of audio the page is doing (WebKit's Audio Session
 * API; a no-op where it's missing). "playback" after the mic closes is what
 * lets the AirPods leave call mode.
 */
export function setAudioSessionType(type: AudioSessionType, log: (msg: string) => void): void {
  const session = (navigator as Navigator & { audioSession?: { type: AudioSessionType } }).audioSession;
  if (!session) return;
  try {
    session.type = type;
    log(`audio-session-type ${session.type}`);
  } catch (err) {
    log(`audio-session-type-failed type=${type} errMessage="${err instanceof Error ? err.message : String(err)}"`);
  }
}

/** Two seconds of barely-there noise as a 16-bit mono WAV (silence can be dropped as "not playing"). */
function nearSilentWavUrl(): string {
  const rate = 22050;
  const n = rate * 2;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const ascii = (o: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) v.setUint8(o + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  ascii(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i += 1) v.setInt16(44 + i * 2, Math.round((Math.random() - 0.5) * 12), true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

const PRESS_ACTIONS = ["play", "pause", "togglemicrophone"] as const;
const SKIP_ACTIONS = ["nexttrack", "seekforward"] as const;

/** Returns null where there is no Media Session API (nothing to listen to). */
export function createHeadphoneRemote(opts: HeadphoneRemoteOptions): HeadphoneRemote | null {
  const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
  if (!ms || typeof Audio === "undefined") {
    opts.log("headphone-remote-unavailable");
    return null;
  }

  let disposed = false;
  let lastPressAt = -Infinity;
  const url = nearSilentWavUrl();
  const loop = new Audio(url);
  loop.loop = true;
  // The phone may pause the loop (another app took "now playing", a call).
  loop.onpause = () => {
    if (!disposed) opts.log("headphone-remote-loop-paused");
  };

  const handle = (kind: "press" | "skip", action: string) => () => {
    if (disposed) return;
    const now = performance.now();
    if (now - lastPressAt < PRESS_DEBOUNCE_MS) {
      opts.log(`headphone-${kind}-duplicate action=${action}`);
      return;
    }
    lastPressAt = now;
    opts.log(`headphone-${kind} action=${action}`);
    // Pressing "pause" pauses the loop on some phones — keep it going.
    if (loop.paused) void loop.play().catch(() => {});
    ms.playbackState = "playing";
    if (kind === "press") opts.onPress();
    else opts.onSkip();
  };

  const register = () => {
    try {
      ms.metadata = new MediaMetadata({ title: "Voice mode", artist: "Skynet" });
    } catch {
      /* MediaMetadata missing — buttons still work */
    }
    for (const a of PRESS_ACTIONS) {
      try {
        ms.setActionHandler(a as MediaSessionAction, handle("press", a));
      } catch {
        /* action not supported here */
      }
    }
    for (const a of SKIP_ACTIONS) {
      try {
        ms.setActionHandler(a, handle("skip", a));
      } catch {
        /* action not supported here */
      }
    }
    ms.playbackState = "playing";
  };

  const play = (why: string) => {
    void loop
      .play()
      .then(() => opts.log(`headphone-remote-loop-playing via=${why}`))
      .catch((err) =>
        opts.log(`headphone-remote-loop-failed via=${why} errMessage="${err instanceof Error ? err.message : String(err)}"`),
      );
  };

  play("start");
  register();

  return {
    reclaim: () => {
      if (disposed) return;
      loop.pause();
      play("reclaim");
      register();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      loop.onpause = null;
      loop.pause();
      loop.removeAttribute("src");
      URL.revokeObjectURL(url);
      for (const a of [...PRESS_ACTIONS, ...SKIP_ACTIONS]) {
        try {
          ms.setActionHandler(a as MediaSessionAction, null);
        } catch {
          /* not supported */
        }
      }
      try {
        ms.metadata = null;
        ms.playbackState = "none";
      } catch {
        /* ignore */
      }
      opts.log("headphone-remote-disposed");
    },
  };
}
