/**
 * useVoiceMode — hands-free, back-and-forth voice conversation with a session.
 *
 * Toggled by the voice-mode button in the ComposeBox aux row. Once on, the loop is:
 *
 *   listening ──(speech)──▶ hearing ──(turn ends)──▶ transcribing ──▶ send(draft)
 *       ▲                                                                 │
 *       └──── speaking ◀── new assistant messages (identity voice TTS) ◀──┘
 *
 * v2 (shape-voice-mode-v2, 2026-10-10) — "let me take my time":
 *   - Pieces. A short pause (PIECE_GAP_MS) closes the current piece of audio and
 *     a fresh recorder starts at once (the user is silent, so nothing falls in
 *     the gap). Each closed piece is transcribed in the background and joins
 *     the draft in spoken order. A piece with no words (sneeze, cough, bump) is
 *     dropped silently — no cue, nothing sent.
 *   - Turn end is the user's preference (voice-mode-settings.ts):
 *       timed  — TIMED_END_MS of silence after a draft exists sends it;
 *       phrase — silence never sends; a piece ending in the send phrase does
 *                (phrase stripped). The phrase only works in this mode.
 *     Either way the draft goes only once every earlier piece has resolved.
 *   - A piece ending in "stop voice mode" (or a variant) turns voice mode off
 *     and throws the draft away.
 *   - A piece whose transcription keeps failing is retried for
 *     TRANSCRIBE_RETRY_WINDOW_MS; then voice mode bails: off, draft thrown
 *     away, alarm cue. Nothing half-finished ever reaches the agent.
 *   - While a draft is in progress, replies wait and the working ticks stay
 *     quiet.
 *   - Cues (voice-mode-cues.ts) play through this hook's AudioContext, which
 *     start() unlocks inside the tap — so they work on iOS with the mic open.
 *
 * Standing design rules (user 2026-10-06: "the voice mode doesn't take over
 * anything it doesn't have to"):
 *   - Owns its OWN MediaStream + MediaRecorders. It never touches the compose
 *     textarea, attachments, queue slots or the tap-to-record `useVoiceRecording`
 *     instance, so typing / pasting / Send keep working while voice mode is on.
 *     Replies to typed sends are spoken too.
 *   - One mic listener at a time: while voice mode is on, ComposeBox disables
 *     every mic (voice-mode-registry.ts). `suspended` (manual mic in use →
 *     listening pauses) is kept as a fallback.
 *   - Half-duplex: the recorder is stopped while TTS plays (iOS Safari shares one
 *     AudioSession between MediaRecorder and playback — see the AudioSession-
 *     safety notes in useVoiceRecording.ts) and so the agent never hears itself.
 *     The MediaStream itself stays open for the whole session so the mic never
 *     needs another user gesture.
 *   - Holds a screen wake lock: mobile browsers suspend the page (and kill the
 *     mic) when the screen locks, so "phone in pocket" needs the screen kept on.
 *
 * start() is called from the button's click, so the VAD/cue AudioContext and
 * the "on" chime are unlocked inside a user gesture.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { stampedFetch } from "@/lib/stamped-fetch";
import { postSpeakStream } from "../../api/voice-api";
import { playAutoSpeakOff, playAutoSpeakOn } from "../../audio/auto-speak-cue";
import { createWebAudioStreamPlayer } from "./webAudioStreamPlayer";
import {
  clearCurrentPlayer,
  getCurrentOwner,
  getCurrentPlayer,
  setCurrentOwner,
  setCurrentPlayer,
} from "./speak-singleton";
import { registerVoiceModeActive } from "./voice-mode-registry";
import { createVoiceModeCues, type VoiceModeCue, type VoiceModeCues } from "./voice-mode-cues";
import { getVoiceModeSettings } from "./voice-mode-settings";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** VAD poll cadence. */
const VAD_TICK_MS = 50;
/** Voiced time needed before a piece counts as speech (filters clicks/bumps). */
const SPEECH_START_MS = 200;
/** A pause this long closes the current piece and starts the next. */
export const PIECE_GAP_MS = 1500;
/** Timed mode: silence this long after a draft exists ends the turn. */
export const TIMED_END_MS = 3000;
/** Safety cap on one piece of unbroken speech (the message itself has no cap). */
export const MAX_PIECE_MS = 5 * 60 * 1000;
/** Rotate the idle recorder so a quiet stretch never builds a huge clip. */
const IDLE_ROTATE_MS = 30 * 1000;
/** Keep retrying a failed piece this long before bailing. */
export const TRANSCRIBE_RETRY_WINDOW_MS = 30 * 1000;
const TRANSCRIBE_RETRY_FIRST_DELAY_MS = 1000;
/** Floor on one attempt's timeout (a long piece can take a while to transcribe). */
const TRANSCRIBE_ATTEMPT_MIN_TIMEOUT_MS = 15 * 1000;
/** Debounce on "your turn" after the agent goes idle — the last reply may still be landing. */
const YOUR_TURN_SETTLE_MS = 700;
/** RMS floor below which nothing counts as speech, regardless of noise floor. */
const MIN_SPEECH_RMS = 0.012;
/** Speech must be this many times louder than the tracked noise floor. */
const NOISE_MULTIPLIER = 3;
/** History frames older than voice-mode start (minus slack) are never spoken. */
const HISTORY_SLACK_MS = 60 * 1000;
/** Let the bail alarm finish before the AudioContext is closed. */
const ALARM_TAIL_MS = 1500;
/** Let the "off" chime finish before the AudioContext is closed. */
const OFF_TAIL_MS = 1000;

const TRANSCRIBE_URL = "/voice/transcribe";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VoiceModePhase =
  | "off"
  | "starting"
  | "listening"
  | "hearing"
  | "transcribing"
  | "speaking"
  | "paused";

/** Structural subset of PrettyView's StreamEvent that voice mode reads. */
export interface VoiceModeMessage {
  type: string;
  eventId?: string;
  role?: string;
  content?: unknown;
  ts?: number;
}

export interface UseVoiceModeArgs {
  hostId: number;
  tmuxSession?: string | null;
  /** Voice candidates for replies (identity → role → fallback); [] = provider default. */
  voices: readonly string[];
  /** Agent-working signal (session-working-store). */
  isWorking: boolean;
  /** The pane's message stream; new assistant messages are spoken. */
  messages: ReadonlyArray<VoiceModeMessage>;
  /** True while the manual tap-to-record mic is busy — listening pauses. */
  suspended: boolean;
  /** Dispatch a transcript. Return false if it could not be sent. */
  send: (text: string) => boolean;
  /** A transcript could not be sent — caller keeps it somewhere visible. */
  onUndelivered: (text: string) => void;
}

export interface UseVoiceModeReturn {
  active: boolean;
  phase: VoiceModePhase;
  errorMessage: string | null;
  /** Call synchronously inside a user gesture (getUserMedia + audio unlock). */
  start: () => void;
  stop: () => void;
  /** Stop the reply currently being read out and drop the queued ones. */
  skipSpeech: () => void;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

function normalizeSpeech(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EXIT_PHRASE_AT_END =
  /(?:^| )(?:please )?(?:stop|end|exit|quit|close|turn off|cancel) (?:the )?voice mode(?: please)?$/;

/** True when a transcript ends with a spoken request to leave voice mode. */
export function endsWithExitPhrase(transcript: string): boolean {
  return EXIT_PHRASE_AT_END.test(normalizeSpeech(transcript));
}

/**
 * If `transcript` ends with `phrase` (ignoring capitals and punctuation),
 * return the transcript with the phrase removed; otherwise null.
 */
export function stripSendPhrase(transcript: string, phrase: string): string | null {
  const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const target = phrase.split(/\s+/).map(norm).filter(Boolean);
  if (target.length === 0) return null;
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  let i = words.length - 1;
  for (let k = target.length - 1; k >= 0; k -= 1) {
    while (i >= 0 && norm(words[i]) === "") i -= 1; // stray punctuation
    if (i < 0 || norm(words[i]) !== target[k]) return null;
    i -= 1;
  }
  return words
    .slice(0, i + 1)
    .join(" ")
    .replace(/[\s,;:–—-]+$/u, "")
    .trim();
}

/**
 * Markdown → something pleasant to hear. Code blocks are announced rather than
 * read symbol by symbol; links read their label; formatting marks are dropped.
 */
export function toSpeakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, " (code block omitted) ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\|?[-:\s|]+\|[-:\s|]*$/gm, "")
    .replace(/\|/g, ", ")
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([^*_~]*?\S)\1/g, "$2")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type WakeLockSentinelLike = { release: () => Promise<void>; released?: boolean };

/** One closed piece of the draft. */
interface Piece {
  id: number;
  status: "pending" | "done";
  text: string;
  /** The turn ends after this piece (send it and everything before it). */
  endsTurn?: "timed" | "phrase";
}

/** A live recorder plus the chunks it has produced. */
interface RecorderSlot {
  recorder: MediaRecorder;
  chunks: Blob[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVoiceMode(args: UseVoiceModeArgs): UseVoiceModeReturn {
  const [phase, setPhaseState] = useState<VoiceModePhase>("off");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Latest args, read from async callbacks without re-binding them.
  const argsRef = useRef(args);
  argsRef.current = args;

  const activeRef = useRef(false);
  /** Bumped on every start/teardown so stale async work can tell it's stale. */
  const sessionRef = useRef(0);
  const phaseRef = useRef<VoiceModePhase>("off");
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const cuesRef = useRef<VoiceModeCues | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const slotRef = useRef<RecorderSlot | null>(null);
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  const seenIdsRef = useRef<Set<string>>(new Set());
  const startedAtRef = useRef(0);
  const queueRef = useRef<string[]>([]);
  const speakingRef = useRef<{ owner: symbol; finish: () => void } | null>(null);
  const acquiringRef = useRef(false); // getUserMedia in flight

  // Draft state.
  const piecesRef = useRef<Piece[]>([]);
  const nextPieceIdRef = useRef(1);
  /** Speech detected in the piece currently being recorded. */
  const pieceSpeechRef = useRef(false);
  /** performance.now() of the last voiced VAD frame (any loud frame). */
  const lastVoiceAtRef = useRef(0);
  /** performance.now() of the last frame of real speech (spans pieces) — timed turn end. */
  const lastSpeechAtRef = useRef(0);
  const yourTurnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tag = `hostId=${args.hostId} tmuxSession=${args.tmuxSession ?? "null"}`;
  const tagRef = useRef(tag);
  tagRef.current = tag;
  const log = useCallback((msg: string) => console.info(`[voice-mode] ${msg} ${tagRef.current}`), []);

  const playCue = useCallback((cue: VoiceModeCue): boolean => {
    return cuesRef.current?.play(cue) ?? false;
  }, []);

  const setPhase = useCallback((p: VoiceModePhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  /** The user is mid-turn: speaking now, or holding an unsent draft. */
  const isComposing = () => pieceSpeechRef.current || piecesRef.current.length > 0;
  const turnHasEnded = () => piecesRef.current.some((p) => p.endsTurn !== undefined);

  /** While listening, show where the turn stands. */
  const refreshListeningPhase = () => {
    if (!activeRef.current || vadTimerRef.current === null) return;
    const next: VoiceModePhase = turnHasEnded()
      ? "transcribing"
      : isComposing()
        ? "hearing"
        : "listening";
    if (phaseRef.current !== next) setPhase(next);
  };

  /** Working ticks: agent working, nothing playing, user not mid-turn. */
  const updateTickingRef = useRef<() => void>(() => {});
  updateTickingRef.current = () => {
    const cues = cuesRef.current;
    if (!cues) return;
    const should =
      activeRef.current &&
      argsRef.current.isWorking &&
      !argsRef.current.suspended &&
      speakingRef.current === null &&
      queueRef.current.length === 0 &&
      !isComposing() &&
      streamRef.current !== null;
    if (should && !cues.isTicking()) {
      log("ticking-start");
      cues.startTicking();
    } else if (!should && cues.isTicking()) {
      log("ticking-stop");
      cues.stopTicking();
    }
  };

  // ---- Recorder / VAD ----------------------------------------------------

  const stopVad = useCallback(() => {
    if (vadTimerRef.current !== null) {
      clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
  }, []);

  /** Stop a recorder; resolve its clip (or null when discarding). */
  const stopSlot = useCallback((slot: RecorderSlot | null, keep: boolean): Promise<Blob | null> => {
    if (!slot || slot.recorder.state === "inactive") return Promise.resolve(null);
    const { recorder, chunks } = slot;
    return new Promise((resolve) => {
      let done = false;
      const finish = (blob: Blob | null) => {
        if (done) return;
        done = true;
        resolve(blob);
      };
      recorder.onstop = () => {
        finish(keep ? new Blob(chunks, { type: recorder.mimeType || "audio/webm" }) : null);
      };
      // iOS occasionally drops onstop (see useVoiceRecording.stopRecording).
      setTimeout(() => {
        if (!done) {
          console.warn(`[voice-mode] recorder-onstop-watchdog ${tagRef.current}`);
          finish(keep && chunks.length > 0 ? new Blob(chunks, { type: recorder.mimeType || "audio/webm" }) : null);
        }
      }, 8000);
      try {
        recorder.stop();
      } catch {
        finish(null);
      }
    });
  }, []);

  const startRecorder = useCallback((): boolean => {
    const stream = streamRef.current;
    if (!stream) return false;
    try {
      const recorder = new MediaRecorder(stream);
      const slot: RecorderSlot = { recorder, chunks: [] };
      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) slot.chunks.push(e.data);
      };
      recorder.start();
      slotRef.current = slot;
      return true;
    } catch (err) {
      console.error(`[voice-mode] recorder-start-failed errMessage="${err instanceof Error ? err.message : String(err)}" ${tagRef.current}`);
      return false;
    }
  }, []);

  /**
   * Swap the live recorder for a fresh one; returns the old one's clip and
   * whether the new one started. The old one is stopped first — Safari has
   * had bugs with two recorders on one track, and the user is silent here.
   */
  const rotateRecorder = useCallback(
    (keep: boolean): { clip: Promise<Blob | null>; started: boolean } => {
      const old = slotRef.current;
      slotRef.current = null;
      const clip = stopSlot(old, keep);
      const started = startRecorder();
      return { clip, started };
    },
    [startRecorder, stopSlot],
  );

  // Forward refs so the scheduler / VAD / speaker / pieces can call each other.
  const pumpRef = useRef<() => void>(() => {});
  const closePieceRef = useRef<() => void>(() => {});
  const endTurnRef = useRef<(reason: "timed" | "phrase", piece: Piece) => void>(() => {});
  const bailRef = useRef<(reason: string) => void>(() => {});

  const beginListening = useCallback(() => {
    if (!activeRef.current || !streamRef.current) return;
    const ctx = ctxRef.current;
    if (ctx && ctx.state !== "running") void ctx.resume().catch(() => {});
    if (!startRecorder()) {
      setErrorMessage("Voice mode: microphone unavailable");
      return;
    }

    const analyser = analyserRef.current;
    const buf = analyser ? new Float32Array(analyser.fftSize) : null;
    let noiseFloor = MIN_SPEECH_RMS / NOISE_MULTIPLIER;
    let voicedMs = 0;
    let speechStartAt = 0;
    let pieceStartAt = performance.now();
    pieceSpeechRef.current = false;

    stopVad();
    vadTimerRef.current = setInterval(() => {
      if (!activeRef.current || !analyser || !buf) return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      const threshold = Math.max(MIN_SPEECH_RMS, noiseFloor * NOISE_MULTIPLIER);

      if (rms > threshold) {
        lastVoiceAtRef.current = now;
        if (pieceSpeechRef.current) lastSpeechAtRef.current = now;
        else {
          voicedMs += VAD_TICK_MS;
          if (voicedMs >= SPEECH_START_MS) {
            pieceSpeechRef.current = true;
            speechStartAt = now;
            lastSpeechAtRef.current = now;
            // Timed mode: talking again before the draft went out means the
            // turn isn't over after all — fold this into the same message.
            const last = piecesRef.current[piecesRef.current.length - 1];
            if (last?.endsTurn === "timed") {
              log(`turn-end-cancelled-by-speech pieceId=${last.id}`);
              last.endsTurn = undefined;
            }
            updateTickingRef.current();
            refreshListeningPhase();
          }
        }
      } else if (!pieceSpeechRef.current) {
        voicedMs = Math.max(0, voicedMs - VAD_TICK_MS / 2);
        // Track ambient noise only while nobody is talking.
        noiseFloor = noiseFloor * 0.97 + rms * 0.03;
      }

      if (pieceSpeechRef.current) {
        const paused = now - lastVoiceAtRef.current >= PIECE_GAP_MS;
        if (paused || now - speechStartAt >= MAX_PIECE_MS) {
          if (!paused) log("piece-max-length");
          pieceSpeechRef.current = false;
          voicedMs = 0;
          pieceStartAt = now;
          closePieceRef.current();
        }
        return;
      }

      // No speech in the current piece. Timed turn end counts from the last
      // real speech, so short noises (keys, a door) can't postpone it.
      const last = piecesRef.current[piecesRef.current.length - 1];
      if (
        getVoiceModeSettings().endOfTurn === "timed" &&
        last !== undefined &&
        last.endsTurn === undefined &&
        now - lastSpeechAtRef.current >= TIMED_END_MS
      ) {
        endTurnRef.current("timed", last);
      }
      // Nothing said for a while — drop the clip and start a fresh one (but
      // not while something may be starting, or its first word is lost).
      if (now - pieceStartAt >= IDLE_ROTATE_MS && voicedMs === 0) {
        pieceStartAt = now;
        const { clip, started } = rotateRecorder(false);
        void clip;
        if (!started) bailRef.current("recorder-restart-failed");
      }
    }, VAD_TICK_MS);
    refreshListeningPhase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log, rotateRecorder, startRecorder, stopVad]);

  /** Stop listening without keeping what the live recorder captured. */
  const stopListening = useCallback(() => {
    stopVad();
    pieceSpeechRef.current = false;
    const slot = slotRef.current;
    slotRef.current = null;
    void stopSlot(slot, false);
  }, [stopSlot, stopVad]);

  // ---- Transcription -----------------------------------------------------

  /**
   * One attempt, bounded by `timeoutMs`. Resolves the text ("" = no words) or
   * null on failure/timeout. `withHost` lets the server apply its "slash …"
   * command rewrite — only for the first piece of a draft, since that rewrite
   * is anchored at the start of a message.
   */
  const transcribeOnce = useCallback(
    async (blob: Blob, withHost: boolean, timeoutMs: number): Promise<string | null> => {
      const ext = blob.type.includes("webm") ? "webm" : blob.type.includes("mp4") ? "mp4" : blob.type.includes("wav") ? "wav" : "bin";
      const fd = new FormData();
      fd.append("file", blob, `clip.${ext}`);
      const { hostId, tmuxSession } = argsRef.current;
      if (withHost) {
        fd.append("hostId", String(hostId));
        if (tmuxSession != null) fd.append("tmuxSession", tmuxSession);
      }
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timedOut = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[voice-mode] transcribe-timeout timeoutMs=${timeoutMs} ${tagRef.current}`);
          controller.abort();
          resolve(null);
        }, timeoutMs);
      });
      const attempt = (async (): Promise<string | null> => {
        try {
          const res = await stampedFetch(TRANSCRIBE_URL, { method: "POST", body: fd, signal: controller.signal });
          if (!res.ok) {
            console.warn(`[voice-mode] transcribe-not-ok status=${res.status} ${tagRef.current}`);
            return null;
          }
          const json = (await res.json()) as { text?: string };
          return (json.text ?? "").trim();
        } catch (err) {
          console.error(`[voice-mode] transcribe-threw errMessage="${err instanceof Error ? err.message : String(err)}" ${tagRef.current}`);
          return null;
        }
      })();
      try {
        return await Promise.race([attempt, timedOut]);
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
    },
    [],
  );

  /**
   * Transcribe with retries for TRANSCRIBE_RETRY_WINDOW_MS. Resolves the text,
   * null when it finally gave up, or undefined when the session ended first.
   */
  const transcribeWithRetry = useCallback(
    async (blob: Blob, pieceId: number, withHost: boolean, session: number): Promise<string | null | undefined> => {
      const deadline = Date.now() + TRANSCRIBE_RETRY_WINDOW_MS;
      let delay = TRANSCRIBE_RETRY_FIRST_DELAY_MS;
      for (let attempt = 1; ; attempt += 1) {
        const timeoutMs = Math.max(TRANSCRIBE_ATTEMPT_MIN_TIMEOUT_MS, deadline - Date.now());
        const text = await transcribeOnce(blob, withHost, timeoutMs);
        if (sessionRef.current !== session) return undefined;
        if (text !== null) return text;
        if (Date.now() + delay > deadline) {
          console.error(`[voice-mode] piece-transcribe-gave-up pieceId=${pieceId} attempts=${attempt} ${tagRef.current}`);
          return null;
        }
        log(`piece-transcribe-retry pieceId=${pieceId} attempt=${attempt} delayMs=${delay}`);
        await new Promise((r) => setTimeout(r, delay));
        if (sessionRef.current !== session) return undefined;
        delay *= 2;
      }
    },
    [log, transcribeOnce],
  );

  // ---- Lifecycle helpers (declared early: pieces + speaker need them) ----

  const releaseWakeLock = useCallback(() => {
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    if (lock && !lock.released) void lock.release().catch(() => {});
  }, []);

  /** Tear everything down. `closeAfterMs` lets a final cue finish playing. */
  const teardown = useCallback(
    (closeAfterMs = 0) => {
      activeRef.current = false;
      sessionRef.current += 1;
      queueRef.current = [];
      piecesRef.current = [];
      pieceSpeechRef.current = false;
      acquiringRef.current = false;
      if (yourTurnTimerRef.current !== null) clearTimeout(yourTurnTimerRef.current);
      yourTurnTimerRef.current = null;
      stopVad();
      const slot = slotRef.current;
      slotRef.current = null;
      void stopSlot(slot, false);
      const speaking = speakingRef.current;
      speakingRef.current = null;
      if (speaking && getCurrentOwner() === speaking.owner) {
        getCurrentPlayer()?.stop();
        clearCurrentPlayer();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      analyserRef.current = null;
      const cues = cuesRef.current;
      const ctx = ctxRef.current;
      cuesRef.current = null;
      ctxRef.current = null;
      cues?.stopTicking();
      const close = () => {
        cues?.dispose();
        void ctx?.close().catch(() => {});
      };
      if (closeAfterMs > 0) setTimeout(close, closeAfterMs);
      else close();
      releaseWakeLock();
    },
    [releaseWakeLock, stopSlot, stopVad],
  );

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    const dropped = piecesRef.current.length;
    log(`stop draftPiecesDropped=${dropped}`);
    // The off chime goes through the unlocked context (iOS: stop may come from
    // a spoken exit phrase, outside any tap); fall back if there is none.
    if (playCue("off")) {
      teardown(OFF_TAIL_MS);
    } else {
      teardown();
      playAutoSpeakOff();
    }
    setPhase("off");
  }, [log, playCue, teardown, setPhase]);
  const stopRef = useRef(stop);
  stopRef.current = stop;

  /** Something went badly wrong mid-turn: off, draft gone, alarm. */
  const bail = useCallback(
    (reason: string, what = "couldn't transcribe what you said") => {
      if (!activeRef.current) return;
      console.error(`[voice-mode] bail reason=${reason} draftPiecesDropped=${piecesRef.current.length} ${tagRef.current}`);
      playCue("alarm");
      teardown(ALARM_TAIL_MS);
      setPhase("off");
      setErrorMessage(`Voice mode stopped: ${what} — nothing was sent`);
    },
    [playCue, teardown, setPhase],
  );
  bailRef.current = (reason: string) => bail(reason, "the microphone stopped recording");

  // ---- Pieces + turn end -------------------------------------------------

  /**
   * Send every finished turn whose pieces have all resolved, oldest first. A
   * turn is the pieces up to and including one marked `endsTurn`.
   */
  const tryFinishTurn = () => {
    while (activeRef.current) {
      const pieces = piecesRef.current;
      const endIdx = pieces.findIndex((p) => p.endsTurn !== undefined);
      if (endIdx < 0) return;
      const included = pieces.slice(0, endIdx + 1);
      if (included.some((p) => p.status === "pending")) return;
      const reason = included[endIdx].endsTurn;
      piecesRef.current = pieces.slice(endIdx + 1);
      const text = included
        .map((p) => p.text)
        .filter(Boolean)
        .join(" ")
        .trim();
      if (!text) {
        log(`turn-end-empty reason=${reason} pieces=${included.length}`);
        continue;
      }
      setErrorMessage(null);
      const sent = argsRef.current.send(text);
      log(`draft-sent reason=${reason} pieces=${included.length} len=${text.length} dispatched=${sent}`);
      if (sent) {
        playCue("sent");
      } else {
        playCue("error");
        argsRef.current.onUndelivered(text);
      }
    }
  };

  endTurnRef.current = (reason, piece) => {
    log(`turn-end reason=${reason} pieceId=${piece.id}`);
    piece.endsTurn = reason;
    tryFinishTurn();
    refreshListeningPhase();
    pumpRef.current();
  };

  const onPieceResult = (piece: Piece, text: string | null | undefined, session: number) => {
    // Session over (stopped, or stopped and restarted) — ignore stale pieces.
    if (text === undefined || !activeRef.current || sessionRef.current !== session) return;
    if (text === null) {
      bail(`piece-transcribe-failed pieceId=${piece.id}`);
      return;
    }
    if (endsWithExitPhrase(text)) {
      log(`exit-phrase pieceId=${piece.id}`);
      stopRef.current();
      return;
    }
    piece.status = "done";
    piece.text = text;
    if (!text) {
      // Sneeze, cough, bump: drop it without a trace. (A timed turn end on
      // it moves to the piece before, so earlier words still go.)
      log(`piece-empty pieceId=${piece.id}`);
      const idx = piecesRef.current.indexOf(piece);
      if (piece.endsTurn && idx > 0) {
        const prev = piecesRef.current[idx - 1];
        if (!prev.endsTurn) prev.endsTurn = piece.endsTurn;
      }
      piecesRef.current = piecesRef.current.filter((p) => p !== piece);
    } else {
      log(`piece-done pieceId=${piece.id} len=${text.length}`);
      const settings = getVoiceModeSettings();
      if (settings.endOfTurn === "phrase") {
        const stripped = stripSendPhrase(text, settings.sendPhrase);
        if (stripped !== null) {
          piece.text = stripped;
          endTurnRef.current("phrase", piece);
          return;
        }
      }
    }
    tryFinishTurn();
    refreshListeningPhase();
    pumpRef.current();
  };

  closePieceRef.current = () => {
    const session = sessionRef.current;
    // Only the first piece of a draft gets the server's "slash …" rewrite.
    const withHost = piecesRef.current.length === 0;
    const piece: Piece = { id: nextPieceIdRef.current, status: "pending", text: "" };
    nextPieceIdRef.current += 1;
    piecesRef.current.push(piece);
    refreshListeningPhase();
    const { clip, started } = rotateRecorder(true);
    if (!started) {
      bail(`recorder-restart-failed pieceId=${piece.id}`, "the microphone stopped recording");
      return;
    }
    void (async () => {
      const blob = await clip;
      if (!activeRef.current || sessionRef.current !== session) return;
      log(`piece-closed pieceId=${piece.id} bytes=${blob?.size ?? 0}`);
      // A closed piece always held detected speech — no audio means the
      // recorder lost it, not silence. Never send around the gap.
      if (!blob || blob.size === 0) {
        bail(`piece-audio-missing pieceId=${piece.id}`, "the recording of what you said was lost");
        return;
      }
      const text = await transcribeWithRetry(blob, piece.id, withHost, session);
      onPieceResult(piece, text, session);
    })();
  };

  // ---- Speaking ----------------------------------------------------------

  const speakNext = useCallback(() => {
    const text = queueRef.current.shift();
    if (!text) return;
    const owner = Symbol("voice-mode");
    let finished = false;
    let watchdog: ReturnType<typeof setInterval> | null = null;

    const finish = () => {
      if (finished) return;
      finished = true;
      if (watchdog !== null) clearInterval(watchdog);
      if (getCurrentOwner() === owner) clearCurrentPlayer();
      if (speakingRef.current?.owner === owner) speakingRef.current = null;
      if (!activeRef.current) return;
      // Reply finished and the agent is done → "your turn".
      if (queueRef.current.length === 0 && !argsRef.current.isWorking) playCue("yourTurn");
      pumpRef.current();
    };

    speakingRef.current = { owner, finish };
    cuesRef.current?.stopTicking();
    setPhase("speaking");

    // Cross-bubble preempt, same as ChatMessage.startSpeak.
    const prev = getCurrentPlayer();
    if (prev) {
      prev.stop();
      clearCurrentPlayer();
    }
    // Never fail silently: the provider may be down or out of credits, and
    // the server never falls back to another one. Reported once per reply
    // whether the failure hits before audio starts or mid-stream.
    let reported = false;
    const reportFailure = () => {
      if (reported || !activeRef.current) return;
      reported = true;
      playCue("error");
      setErrorMessage("Voice mode: couldn't speak that reply");
    };
    const player = createWebAudioStreamPlayer({
      onEnded: finish,
      onError: () => {
        reportFailure();
        finish();
      },
    });
    setCurrentPlayer(player);
    setCurrentOwner(owner);
    // External stop() (a bubble speak tap, skipSpeech) fires no callback —
    // notice that ownership moved and move on.
    watchdog = setInterval(() => {
      if (getCurrentOwner() !== owner) finish();
    }, 400);

    log(`speak-start textLen=${text.length} voices=[${argsRef.current.voices.join(",")}]`);
    void (async () => {
      try {
        const res = await postSpeakStream(text, argsRef.current.voices);
        if (getCurrentOwner() !== owner) return finish();
        if (!res.ok) throw new Error(`postSpeakStream returned ${res.status}`);
        await player.play(res);
      } catch (err) {
        console.error(`[voice-mode] speak-failed errMessage="${err instanceof Error ? err.message : String(err)}" ${tagRef.current}`);
        if (getCurrentOwner() === owner) player.stop();
        reportFailure();
        finish();
      }
    })();
  }, [log, playCue, setPhase]);

  // ---- Scheduler ---------------------------------------------------------

  const acquireStreamRef = useRef<() => void>(() => {});

  pumpRef.current = () => {
    if (!activeRef.current) return;
    if (speakingRef.current) return;
    // Manual mic took over — drop the piece being recorded so the same words
    // aren't captured twice. The draft so far is kept; replies wait.
    if (argsRef.current.suspended) {
      if (vadTimerRef.current !== null) stopListening();
      if (phaseRef.current !== "paused") setPhase("paused");
      updateTickingRef.current();
      return;
    }
    // Never talk over the user mid-turn: replies wait until the draft is sent.
    if (queueRef.current.length > 0 && !isComposing()) {
      if (vadTimerRef.current !== null) stopListening();
      speakNext();
      return;
    }
    // Mic track lost (iOS ends a page's older capture when the manual mic
    // opens a new one) — take a fresh stream once the manual mic is done.
    if (!streamRef.current) {
      if (!acquiringRef.current) acquireStreamRef.current();
      return;
    }
    if (vadTimerRef.current === null) beginListening();
    else refreshListeningPhase();
    updateTickingRef.current();
  };

  // ---- Lifecycle ---------------------------------------------------------

  const acquireWakeLock = useCallback(async () => {
    const wl = (navigator as Navigator & {
      wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinelLike> };
    }).wakeLock;
    if (!wl || (wakeLockRef.current && !wakeLockRef.current.released)) return;
    try {
      wakeLockRef.current = await wl.request("screen");
      if (!activeRef.current) releaseWakeLock();
    } catch (err) {
      console.warn(`[voice-mode] wake-lock-failed errMessage="${err instanceof Error ? err.message : String(err)}" ${tagRef.current}`);
    }
  }, [releaseWakeLock]);

  const failAcquireRef = useRef<(err: unknown) => void>(() => {});
  failAcquireRef.current = (err: unknown) => {
    acquiringRef.current = false;
    if (!activeRef.current) return;
    console.error(`[voice-mode] getUserMedia-failed errMessage="${err instanceof Error ? err.message : String(err)}" ${tagRef.current}`);
    playCue("error");
    setErrorMessage("Voice mode: microphone unavailable or permission denied");
    teardown(ALARM_TAIL_MS);
    setPhase("off");
  };

  /** Forget the current stream (and its recorder/VAD) without leaving voice mode. */
  function dropStream() {
    stopListening();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
  }

  const attachStreamRef = useRef<(stream: MediaStream) => void>(() => {});
  attachStreamRef.current = (stream: MediaStream) => {
    acquiringRef.current = false;
    if (!activeRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;
    for (const track of stream.getAudioTracks()) {
      track.onended = () => {
        if (!activeRef.current || streamRef.current !== stream) return;
        // Not fatal: drop the dead stream and re-acquire on the next pump
        // (after the manual mic, if that is what took it, is released).
        console.warn(`[voice-mode] mic-track-ended ${tagRef.current}`);
        dropStream();
        if (phaseRef.current !== "speaking") setPhase("paused");
        pumpRef.current();
      };
    }
    const ctx = ctxRef.current;
    if (ctx) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;
    }
    void acquireWakeLock();
    pumpRef.current();
  };

  /** Re-acquire the mic outside a gesture (permission already granted). */
  acquireStreamRef.current = () => {
    acquiringRef.current = true;
    log("reacquire-mic");
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then(attachStreamRef.current, failAcquireRef.current);
  };

  const start = useCallback(() => {
    if (activeRef.current) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setErrorMessage("Voice mode needs microphone access");
      return;
    }
    const streamPromise = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    activeRef.current = true;
    sessionRef.current += 1;
    piecesRef.current = [];
    pieceSpeechRef.current = false;
    setErrorMessage(null);
    setPhase("starting");
    const settings = getVoiceModeSettings();
    log(`start endOfTurn=${settings.endOfTurn}`);
    // VAD analyser + cue context — created here, inside the start gesture, so
    // cues can play later with the mic open (iOS).
    try {
      const ctx = new AudioContext();
      void ctx.resume().catch(() => {});
      ctxRef.current = ctx;
      cuesRef.current = createVoiceModeCues(ctx, log);
    } catch {
      ctxRef.current = null;
      cuesRef.current = null;
    }
    // Only messages that arrive from here on are spoken.
    startedAtRef.current = Date.now();
    seenIdsRef.current = new Set(
      argsRef.current.messages.map((m) => m.eventId).filter((id): id is string => typeof id === "string"),
    );
    queueRef.current = [];
    playAutoSpeakOn();

    acquiringRef.current = true;
    streamPromise.then(attachStreamRef.current, failAcquireRef.current);
  }, [log, setPhase]);

  const skipSpeech = useCallback(() => {
    queueRef.current = [];
    const speaking = speakingRef.current;
    if (speaking && getCurrentOwner() === speaking.owner) getCurrentPlayer()?.stop();
    speaking?.finish();
  }, []);

  // New assistant messages → speech queue.
  useEffect(() => {
    if (!activeRef.current) return;
    const seen = seenIdsRef.current;
    let added = false;
    for (const m of args.messages) {
      if (typeof m.eventId !== "string" || seen.has(m.eventId)) continue;
      seen.add(m.eventId);
      if (m.type !== "message" || m.role !== "assistant" || typeof m.content !== "string") continue;
      if (typeof m.ts === "number" && m.ts < startedAtRef.current - HISTORY_SLACK_MS) continue;
      const text = toSpeakableText(m.content);
      if (text) {
        queueRef.current.push(text);
        added = true;
      }
    }
    if (added) pumpRef.current();
  }, [args.messages]);

  // Manual mic in use → pause; released → resume.
  useEffect(() => {
    // Don't play a reply into the user's dictation: cut the current one short
    // (queued replies wait until the manual mic is released).
    const speaking = speakingRef.current;
    if (args.suspended && speaking) {
      log("speech-cut-by-manual-mic");
      if (getCurrentOwner() === speaking.owner) getCurrentPlayer()?.stop();
      speaking.finish();
    }
    if (!args.suspended && activeRef.current && streamRef.current) {
      const dead = streamRef.current
        .getAudioTracks()
        .some((t) => t.readyState === "ended" || t.muted);
      if (dead) {
        log("mic-track-dead-after-manual-mic");
        dropStream();
      }
    }
    pumpRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.suspended]);

  // Agent working/finished → ticking follows it; finished while idle → "your turn".
  const prevWorkingRef = useRef(args.isWorking);
  useEffect(() => {
    const was = prevWorkingRef.current;
    prevWorkingRef.current = args.isWorking;
    updateTickingRef.current();
    if (yourTurnTimerRef.current !== null) {
      clearTimeout(yourTurnTimerRef.current);
      yourTurnTimerRef.current = null;
    }
    if (!activeRef.current || !was || args.isWorking) return;
    // The final reply can land just after the agent goes idle; wait a beat so
    // "your turn" isn't played here AND again when that reply finishes.
    yourTurnTimerRef.current = setTimeout(() => {
      yourTurnTimerRef.current = null;
      if (
        activeRef.current &&
        !argsRef.current.isWorking &&
        speakingRef.current === null &&
        queueRef.current.length === 0 &&
        !isComposing() &&
        phaseRef.current === "listening"
      ) {
        playCue("yourTurn");
      }
    }, YOUR_TURN_SETTLE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.isWorking]);

  // Coming back to the foreground: re-take the wake lock (the browser drops it
  // when hidden) and wake the analyser's AudioContext.
  useEffect(() => {
    const onVisibility = () => {
      if (!activeRef.current || document.visibilityState !== "visible") return;
      void acquireWakeLock();
      const ctx = ctxRef.current;
      if (ctx && ctx.state !== "running") void ctx.resume().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [acquireWakeLock]);

  // App-wide flag: while on, every other mic / voice-mode button is disabled.
  const isOn = phase !== "off";
  useEffect(() => {
    if (!isOn) return;
    return registerVoiceModeActive(Symbol("voice-mode"));
  }, [isOn]);

  // Unmount → release the mic, player and wake lock.
  useEffect(
    () => () => {
      teardown();
    },
    [teardown],
  );

  return { active: phase !== "off", phase, errorMessage, start, stop, skipSpeech };
}
