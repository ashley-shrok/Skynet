/**
 * useVoiceMode — hands-free, back-and-forth voice conversation with a session.
 *
 * Toggled by the voice-mode button in the ComposeBox aux row. Once on, the loop is:
 *
 *   listening ──(speech detected)──▶ hearing ──(trailing silence)──▶ transcribing
 *       ▲                                                                │
 *       │                                         send(transcript) ◀─────┘
 *       └──── speaking ◀── new assistant messages (identity voice TTS)
 *
 * Design rules (user 2026-10-06: "the voice mode doesn't take over anything it
 * doesn't have to"):
 *   - Owns its OWN MediaStream + MediaRecorder. It never touches the compose
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
 * start() is called from the button's click, so the VAD AudioContext and the
 * "on" chime are unlocked inside a user gesture.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import stopUrl from "../../assets/sounds/mic/stop.mp3?url";
import errorUrl from "../../assets/sounds/mic/error.mp3?url";
import { stampedFetch } from "@/lib/stamped-fetch";
import { postSpeakStream } from "../../api/voice-api";
import { playAutoSpeakOff, playAutoSpeakOn } from "../../audio/auto-speak-cue";
import { playTink } from "../../audio/ready-cue";
import { createWebAudioStreamPlayer } from "./webAudioStreamPlayer";
import {
  clearCurrentPlayer,
  getCurrentOwner,
  getCurrentPlayer,
  setCurrentOwner,
  setCurrentPlayer,
} from "./speak-singleton";
import { registerVoiceModeActive } from "./voice-mode-registry";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** VAD poll cadence. */
const VAD_TICK_MS = 50;
/** Voiced time needed before an utterance counts as started (filters clicks/bumps). */
const SPEECH_START_MS = 200;
/** Trailing silence that ends an utterance. Long enough for walking-pace pauses. */
export const SILENCE_END_MS = 1800;
/** Hard cap on a single utterance. */
const MAX_UTTERANCE_MS = 5 * 60 * 1000;
/** Rotate the idle recorder so a quiet stretch never builds a huge clip. */
const IDLE_ROTATE_MS = 30 * 1000;
/** RMS floor below which nothing counts as speech, regardless of noise floor. */
const MIN_SPEECH_RMS = 0.012;
/** Speech must be this many times louder than the tracked noise floor. */
const NOISE_MULTIPLIER = 3;
/** History frames older than voice-mode start (minus slack) are never spoken. */
const HISTORY_SLACK_MS = 60 * 1000;

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

const EXIT_PHRASE =
  /^(?:please )?(?:stop|end|exit|quit|close|turn off|cancel) (?:the )?voice mode(?: please)?$/;

/** True when a transcript is a spoken request to leave voice mode. */
export function isExitPhrase(transcript: string): boolean {
  const norm = transcript
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return EXIT_PHRASE.test(norm);
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

// ---------------------------------------------------------------------------
// Module-level cue audio (same pattern as useVoiceRecording / auto-speak-cue)
// ---------------------------------------------------------------------------

let stopAudio: HTMLAudioElement | null = null;
let errorAudio: HTMLAudioElement | null = null;

function playCue(kind: "stop" | "error"): void {
  if (kind === "stop") {
    if (!stopAudio) stopAudio = new Audio(stopUrl);
    stopAudio.currentTime = 0;
    Promise.resolve(stopAudio.play()).catch(() => {});
  } else {
    if (!errorAudio) errorAudio = new Audio(errorUrl);
    errorAudio.currentTime = 0;
    Promise.resolve(errorAudio.play()).catch(() => {});
  }
}

type WakeLockSentinelLike = { release: () => Promise<void>; released?: boolean };

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
  const phaseRef = useRef<VoiceModePhase>("off");
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  const seenIdsRef = useRef<Set<string>>(new Set());
  const startedAtRef = useRef(0);
  const queueRef = useRef<string[]>([]);
  const speakingRef = useRef<{ owner: symbol; finish: () => void } | null>(null);
  const busyRef = useRef(false); // transcribing / sending
  const acquiringRef = useRef(false); // getUserMedia in flight

  const tag = `hostId=${args.hostId} tmuxSession=${args.tmuxSession ?? "null"}`;
  const tagRef = useRef(tag);
  tagRef.current = tag;
  const log = (msg: string) => console.info(`[voice-mode] ${msg} ${tagRef.current}`);

  const setPhase = useCallback((p: VoiceModePhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  // ---- Recorder / VAD ----------------------------------------------------

  const stopVad = useCallback(() => {
    if (vadTimerRef.current !== null) {
      clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
  }, []);

  /** Stop the current recorder; resolve its clip (or null when discarding). */
  const stopRecorder = useCallback((keep: boolean): Promise<Blob | null> => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder || recorder.state === "inactive") {
      chunksRef.current = [];
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      let done = false;
      const finish = (blob: Blob | null) => {
        if (done) return;
        done = true;
        resolve(blob);
      };
      recorder.onstop = () => {
        const blob = keep
          ? new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" })
          : null;
        chunksRef.current = [];
        finish(blob);
      };
      // iOS occasionally drops onstop (see useVoiceRecording.stopRecording).
      setTimeout(() => {
        if (!done) {
          console.warn(`[voice-mode] recorder-onstop-watchdog ${tagRef.current}`);
          chunksRef.current = [];
          finish(null);
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
      chunksRef.current = [];
      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start();
      recorderRef.current = recorder;
      return true;
    } catch (err) {
      console.error(`[voice-mode] recorder-start-failed errMessage="${err instanceof Error ? err.message : String(err)}" ${tagRef.current}`);
      return false;
    }
  }, []);

  // Forward refs so the scheduler / VAD / speaker can call each other.
  const pumpRef = useRef<() => void>(() => {});
  const finishUtteranceRef = useRef<() => void>(() => {});

  const beginListening = useCallback(() => {
    if (!activeRef.current || !streamRef.current) return;
    const ctx = ctxRef.current;
    if (ctx && ctx.state !== "running") void ctx.resume().catch(() => {});
    if (!startRecorder()) {
      setErrorMessage("Voice mode: microphone unavailable");
      return;
    }
    setPhase("listening");

    const analyser = analyserRef.current;
    const buf = analyser ? new Float32Array(analyser.fftSize) : null;
    let noiseFloor = MIN_SPEECH_RMS / NOISE_MULTIPLIER;
    let voicedMs = 0;
    let speechStarted = false;
    let speechStartAt = 0;
    let lastVoiceAt = 0;
    let recorderStartAt = performance.now();

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
        lastVoiceAt = now;
        if (!speechStarted) {
          voicedMs += VAD_TICK_MS;
          if (voicedMs >= SPEECH_START_MS) {
            speechStarted = true;
            speechStartAt = now;
            setPhase("hearing");
          }
        }
      } else {
        if (!speechStarted) {
          voicedMs = Math.max(0, voicedMs - VAD_TICK_MS / 2);
          // Track ambient noise only while nobody is talking.
          noiseFloor = noiseFloor * 0.97 + rms * 0.03;
        }
      }

      if (speechStarted) {
        if (now - lastVoiceAt >= SILENCE_END_MS || now - speechStartAt >= MAX_UTTERANCE_MS) {
          stopVad();
          finishUtteranceRef.current();
        }
      } else if (now - recorderStartAt >= IDLE_ROTATE_MS) {
        // Nothing said for a while — drop the clip and start a fresh one.
        recorderStartAt = now;
        void stopRecorder(false).then(() => {
          if (activeRef.current && phaseRef.current === "listening") startRecorder();
        });
      }
    }, VAD_TICK_MS);
  }, [setPhase, startRecorder, stopRecorder, stopVad]);

  /** Stop listening without keeping what was captured. */
  const stopListening = useCallback(() => {
    stopVad();
    void stopRecorder(false);
  }, [stopRecorder, stopVad]);

  // ---- Transcribe + send -------------------------------------------------

  const transcribe = useCallback(async (blob: Blob): Promise<string | null> => {
    const ext = blob.type.includes("webm") ? "webm" : blob.type.includes("mp4") ? "mp4" : blob.type.includes("wav") ? "wav" : "bin";
    const fd = new FormData();
    fd.append("file", blob, `clip.${ext}`);
    const { hostId, tmuxSession } = argsRef.current;
    fd.append("hostId", String(hostId));
    if (tmuxSession != null) fd.append("tmuxSession", tmuxSession);
    try {
      const res = await stampedFetch(TRANSCRIBE_URL, { method: "POST", body: fd });
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
  }, []);

  const stopRef = useRef<() => void>(() => {});

  finishUtteranceRef.current = () => {
    busyRef.current = true;
    setPhase("transcribing");
    void (async () => {
      const blob = await stopRecorder(true);
      if (!activeRef.current) return;
      playCue("stop");
      const transcript = blob && blob.size > 0 ? await transcribe(blob) : "";
      if (!activeRef.current) {
        // Voice mode was turned off mid-transcription — don't lose the words.
        if (transcript) argsRef.current.onUndelivered(transcript);
        return;
      }
      busyRef.current = false;
      if (transcript === null) {
        playCue("error");
        setErrorMessage("Voice mode: couldn't transcribe that — try again");
      } else if (transcript === "") {
        log("utterance-empty");
      } else if (isExitPhrase(transcript)) {
        log("exit-phrase");
        stopRef.current();
        return;
      } else {
        setErrorMessage(null);
        const sent = argsRef.current.send(transcript);
        log(`utterance-sent len=${transcript.length} dispatched=${sent}`);
        if (!sent) {
          playCue("error");
          argsRef.current.onUndelivered(transcript);
        }
      }
      pumpRef.current();
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
      // Reply finished and the agent is done → "your turn" chime.
      if (queueRef.current.length === 0 && !argsRef.current.isWorking) playTink();
      pumpRef.current();
    };

    speakingRef.current = { owner, finish };
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
  }, [setPhase]);

  // ---- Scheduler ---------------------------------------------------------

  const acquireStreamRef = useRef<() => void>(() => {});

  pumpRef.current = () => {
    if (!activeRef.current) return;
    if (busyRef.current || speakingRef.current) return;
    const current = phaseRef.current;
    // Manual mic took over — drop whatever we were capturing so the same words
    // aren't sent twice. Replies wait until it is released.
    if (argsRef.current.suspended) {
      if (current === "listening" || current === "hearing") stopListening();
      setPhase("paused");
      return;
    }
    // Never talk over the user mid-utterance; replies wait their turn.
    if (current === "hearing") return;
    if (queueRef.current.length > 0) {
      if (current === "listening") stopListening();
      speakNext();
      return;
    }
    // Mic track lost (iOS ends a page's older capture when the manual mic
    // opens a new one) — take a fresh stream once the manual mic is done.
    if (!streamRef.current) {
      if (!acquiringRef.current) acquireStreamRef.current();
      return;
    }
    if (current !== "listening") beginListening();
  };

  // ---- Lifecycle ---------------------------------------------------------

  const releaseWakeLock = useCallback(() => {
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    if (lock && !lock.released) void lock.release().catch(() => {});
  }, []);

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

  const teardown = useCallback(() => {
    activeRef.current = false;
    busyRef.current = false;
    queueRef.current = [];
    acquiringRef.current = false;
    stopVad();
    void stopRecorder(false);
    const speaking = speakingRef.current;
    speakingRef.current = null;
    if (speaking && getCurrentOwner() === speaking.owner) {
      getCurrentPlayer()?.stop();
      clearCurrentPlayer();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    releaseWakeLock();
  }, [releaseWakeLock, stopRecorder, stopVad]);

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    log("stop");
    teardown();
    setPhase("off");
    playAutoSpeakOff();
  }, [teardown, setPhase]);
  stopRef.current = stop;

  const failAcquireRef = useRef<(err: unknown) => void>(() => {});
  failAcquireRef.current = (err: unknown) => {
    acquiringRef.current = false;
    if (!activeRef.current) return;
    console.error(`[voice-mode] getUserMedia-failed errMessage="${err instanceof Error ? err.message : String(err)}" ${tagRef.current}`);
    playCue("error");
    setErrorMessage("Voice mode: microphone unavailable or permission denied");
    teardown();
    setPhase("off");
  };

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
        if (phaseRef.current === "listening" || phaseRef.current === "hearing") setPhase("paused");
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

  /** Forget the current stream (and its recorder/VAD) without leaving voice mode. */
  function dropStream() {
    stopVad();
    void stopRecorder(false);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
  }

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
    setErrorMessage(null);
    setPhase("starting");
    log("start");
    // VAD analyser context — created here, inside the start gesture.
    try {
      const ctx = new AudioContext();
      void ctx.resume().catch(() => {});
      ctxRef.current = ctx;
    } catch {
      ctxRef.current = null;
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
  }, [setPhase]);

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

  // Agent finished while we were just listening → "your turn" chime.
  const prevWorkingRef = useRef(args.isWorking);
  useEffect(() => {
    const was = prevWorkingRef.current;
    prevWorkingRef.current = args.isWorking;
    if (!activeRef.current || !was || args.isWorking) return;
    if (phaseRef.current === "listening" && queueRef.current.length === 0) playTink();
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
