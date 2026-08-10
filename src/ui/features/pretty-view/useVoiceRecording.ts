/**
 * useVoiceRecording — state machine hook for voice recording + STT transcription.
 *
 * Owns:
 *   - State machine: idle → recording → transcribing → idle
 *   - MediaRecorder lifecycle (getUserMedia, start, stop, cleanup)
 *   - Fetch to POST /voice/transcribe with FormData `file` field
 *   - Transcript-to-text glue rule (single space if currentText does not end in whitespace)
 *   - Audio feedback: 4 sounds at meaningful state transitions (start/stop/cancel/error)
 *
 * Does NOT own:
 *   - The textarea value (caller manages and passes currentText to endAppend/endSend)
 *   - The send action (endSend returns transcript+glued so caller can invoke send)
 *   - Persistence (blob is transient; only transcript enters the textarea)
 *
 * CRITICAL iOS Safari constraint (D-16-02, Nelly warning):
 *   `start()` is a PLAIN FUNCTION (NOT async). Its first non-conditional statement
 *   is `navigator.mediaDevices.getUserMedia({ audio: true })`. Any `await` before
 *   getUserMedia queues a microtask that iOS Safari uses to detect the call is not
 *   from a direct user gesture, silently killing the mic permission prompt.
 *   The hook's `start` calls getUserMedia as its first action, then wires `.then/.catch`
 *   to handle the resolved stream.
 *
 * Return shape:
 *   {
 *     state: "idle" | "recording" | "transcribing"
 *     errorMessage: string | null
 *     start: () => void                                       — call from tap handler (no await)
 *     cancel: () => Promise<void>                             — drops blob, transitions to idle
 *     endAppend: (currentText: string) => Promise<{transcript: string, glued: string} | null>
 *     endSend: (currentText: string) => Promise<{transcript: string, glued: string} | null>
 *   }
 *
 * endAppend and endSend both return Promise<{transcript, glued} | null>.
 *   - On success: { transcript: "<STT text>", glued: "<currentText + glue + transcript>" }
 *   - On STT error or fetch failure: null (errorMessage is set on the hook)
 * The caller decides what to do with glued: endAppend → set textarea value;
 * endSend → set textarea value AND call the existing send handler.
 */

import { useRef, useState } from "react";
import startUrl from "../../assets/sounds/mic/start.mp3?url";
import stopUrl from "../../assets/sounds/mic/stop.mp3?url";
import cancelUrl from "../../assets/sounds/mic/cancel.mp3?url";
import errorUrl from "../../assets/sounds/mic/error.mp3?url";
import { applyIntentTransform } from "./composeIntentTransform";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRANSCRIBE_URL = "/voice/transcribe";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VoiceRecordingState = "idle" | "recording" | "transcribing";

export interface VoiceRecordingResult {
  transcript: string;
  glued: string;
}

export interface UseVoiceRecordingReturn {
  state: VoiceRecordingState;
  errorMessage: string | null;
  start: () => void;
  cancel: () => Promise<void>;
  endAppend: (currentText: string) => Promise<VoiceRecordingResult | null>;
  endSend: (currentText: string) => Promise<VoiceRecordingResult | null>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVoiceRecording(): UseVoiceRecordingReturn {
  const [state, setState] = useState<VoiceRecordingState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Refs hold the mutable recorder state so they survive re-renders without
  // causing additional renders (mirrors the prototype's module-level locals).
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Audio feedback instances — lazy-initialized once on first render via ref.
  // Persists across renders so we don't reconstruct Audio objects on every render.
  const startAudioRef = useRef<HTMLAudioElement | null>(null);
  const stopAudioRef = useRef<HTMLAudioElement | null>(null);
  const cancelAudioRef = useRef<HTMLAudioElement | null>(null);
  const errorAudioRef = useRef<HTMLAudioElement | null>(null);
  if (!startAudioRef.current) startAudioRef.current = new Audio(startUrl);
  if (!stopAudioRef.current) stopAudioRef.current = new Audio(stopUrl);
  if (!cancelAudioRef.current) cancelAudioRef.current = new Audio(cancelUrl);
  if (!errorAudioRef.current) errorAudioRef.current = new Audio(errorUrl);

  // ---------------------------------------------------------------------------
  // Internal: playSound — resets currentTime and plays; swallows any rejection.
  // Audio feedback is UX polish — a failed play() MUST NOT disrupt recording.
  // ---------------------------------------------------------------------------

  function playSound(audio: HTMLAudioElement | null): void {
    if (!audio) return;
    audio.currentTime = 0;
    // Wrap in Promise.resolve — real browsers return a Promise from play(),
    // but jsdom's HTMLMediaElement.play() returns undefined, so a bare
    // .catch() throws in tests that render the full ComposeBox tree without
    // the Audio mock (fixes 5 pre-existing ComposeBox.voice.test.tsx failures
    // in #209's ship; see patch #211).
    Promise.resolve(audio.play()).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Internal: stopRecording — wraps recorder.stop() and resolves on onstop.
  // Returns the assembled Blob, or null if no recorder is active.
  // ---------------------------------------------------------------------------

  function stopRecording(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder) {
        console.warn("[voice-diag] stopRecording: recorderRef null, resolving null");
        resolve(null);
        return;
      }
      // Non-recording guard: on iOS Safari, if a prior stopRecording() hung
      // because the browser's onstop event dropped, subsequent stopRecording()
      // calls would reassign recorder.onstop and call recorder.stop() again
      // on an already-inactive recorder — hanging identically. Bail early
      // when the recorder is not in "recording" state so the caller's null-blob
      // branch (endAppend/endSend line ~294/335) recovers state to idle. This
      // is the fix for the cascade-of-hangs case (presses 2+ after first drop).
      if (recorder.state !== "recording") {
        console.warn(`[voice-diag] stopRecording: recorder.state=${recorder.state} (not recording), resolving null without touching onstop`);
        resolve(null);
        return;
      }
      console.warn(`[voice-diag] stopRecording: calling recorder.stop() (recorder.state=${recorder.state})`);
      // Race between onstop firing (happy path) and an 8s watchdog (iOS Safari
      // dropped-event recovery). Whichever wins flips `resolved`; the loser
      // must no-op so we never double-cleanup or double-resolve.
      let resolved = false;
      let watchdogHandle: ReturnType<typeof setTimeout> | undefined;
      recorder.onstop = () => {
        if (resolved) return;
        resolved = true;
        if (watchdogHandle) clearTimeout(watchdogHandle);
        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        console.warn(`[voice-diag] stopRecording: onstop fired, blob size=${blob.size} type=${type}`);
        chunksRef.current = [];
        // Stop all stream tracks and clear refs.
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
        recorderRef.current = null;
        resolve(blob);
      };
      watchdogHandle = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        console.warn("[voice-diag] stopRecording: WATCHDOG onstop never fired after 8s — forcing cleanup");
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
        recorderRef.current = null;
        chunksRef.current = [];
        resolve(null);
      }, 8000);
      recorder.stop();
    });
  }

  // ---------------------------------------------------------------------------
  // Internal: transcribeBlob — POSTs blob to /voice/transcribe, returns text.
  // Returns null on error (also sets errorMessage).
  // ---------------------------------------------------------------------------

  async function transcribeBlob(blob: Blob): Promise<string | null> {
    // Pick filename extension from blob.type (mirrors prototype ext-picking logic).
    const ext = blob.type.includes("webm")
      ? "webm"
      : blob.type.includes("mp4")
        ? "mp4"
        : blob.type.includes("wav")
          ? "wav"
          : "bin";

    const fd = new FormData();
    fd.append("file", blob, `clip.${ext}`);

    console.warn(`[voice-diag] transcribeBlob: POST ${TRANSCRIBE_URL} blobSize=${blob.size} ext=${ext}`);

    let res: Response;
    try {
      res = await fetch(TRANSCRIBE_URL, { method: "POST", body: fd });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "fetch error";
      console.warn(`[voice-diag] transcribeBlob: fetch threw: ${msg}`);
      playSound(errorAudioRef.current);
      setErrorMessage(`STT error: ${msg}`);
      return null;
    }

    console.warn(`[voice-diag] transcribeBlob: fetch resolved status=${res.status} ok=${res.ok}`);

    if (!res.ok) {
      playSound(errorAudioRef.current);
      setErrorMessage(`STT error: ${res.status}`);
      return null;
    }

    try {
      const json = (await res.json()) as { text?: string };
      console.warn(`[voice-diag] transcribeBlob: parsed json textLen=${(json.text ?? "").length}`);
      return json.text ?? "";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[voice-diag] transcribeBlob: json parse threw: ${msg}`);
      playSound(errorAudioRef.current);
      setErrorMessage("STT error: invalid response");
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: applyGlue — applies the single-space glue rule.
  // "if (cur && !/\s$/.test(cur)) glue = ' '"
  // ---------------------------------------------------------------------------

  function applyGlue(currentText: string, transcript: string): string {
    const glue = currentText && !/\s$/.test(currentText) ? " " : "";
    return currentText + glue + transcript;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * start() — initiates recording.
   *
   * MUST be a plain function (NOT async). Its FIRST non-conditional statement
   * is navigator.mediaDevices.getUserMedia({ audio: true }) — called
   * synchronously inside the user-gesture handler so iOS Safari presents
   * the mic permission prompt (D-16-02 lock, Nelly warning 2026-07-27).
   *
   * No-op if state !== "idle" (gate against rapid-tap, T-16-10).
   */
  function start(): void {
    if (state !== "idle") return;

    // ⚠️ MUST be the first non-conditional statement — NO await before this.
    // iOS Safari requires getUserMedia to be called synchronously in the tap
    // handler. Any microtask (await) before this line kills the permission prompt.
    const streamPromise = navigator.mediaDevices.getUserMedia({ audio: true });

    streamPromise
      .then((stream) => {
        streamRef.current = stream;
        chunksRef.current = [];

        const recorder = new MediaRecorder(stream);
        recorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        recorder.start();
        setState("recording");
        playSound(startAudioRef.current);
        setErrorMessage(null);
      })
      .catch((err: Error) => {
        // Surface mic-denied state — matches prototype's error string.
        // Do NOT play error.mp3 here — permission-denied may happen before any
        // user gesture on Safari, and the errorMessage signal alone is sufficient.
        setErrorMessage(`mic denied: ${err.name || "error"}`);
        // State stays "idle".
      });
  }

  /**
   * cancel() — stops recording, discards blob, returns to idle.
   * No-op if state !== "recording".
   */
  async function cancel(): Promise<void> {
    console.warn(`[voice-diag] cancel: entry state=${state}`);
    if (state !== "recording") {
      console.warn(`[voice-diag] cancel: gate rejected (state !== recording), returning`);
      return;
    }
    // AudioSession-safety: play cancel.mp3 AFTER recorder teardown, not before.
    // iOS Safari shares one AudioSession between MediaRecorder and Audio playback;
    // starting playback while recording is active can drop MediaRecorder.onstop and
    // orphan the buffered audio (bounty voice-recording-audio-feedback-ordering-onstop-drop).
    await stopRecording();
    playSound(cancelAudioRef.current);
    console.warn(`[voice-diag] cancel: stopRecording resolved, setting state=idle`);
    // Blob is discarded — no fetch.
    setState("idle");
  }

  /**
   * endAppend(currentText) — stops recording, transcribes, returns {transcript, glued}.
   * Caller sets textarea.value = glued.
   * Returns null on STT error (errorMessage is set).
   * No-op if state !== "recording".
   */
  async function endAppend(
    currentText: string,
  ): Promise<VoiceRecordingResult | null> {
    console.warn(`[voice-diag] endAppend: entry state=${state} currentTextLen=${currentText.length}`);
    if (state !== "recording") {
      console.warn(`[voice-diag] endAppend: gate rejected (state !== recording), returning null`);
      return null;
    }

    // AudioSession-safety: play stop.mp3 AFTER recorder teardown — see cancel() above.
    const blob = await stopRecording();
    playSound(stopAudioRef.current);
    console.warn(`[voice-diag] endAppend: stopRecording resolved, blob=${blob ? `size=${blob.size}` : "null"}, setting state=transcribing`);
    setState("transcribing");

    if (!blob) {
      console.warn(`[voice-diag] endAppend: blob null, setting state=idle, returning null`);
      setState("idle");
      return null;
    }

    const transcript = await transcribeBlob(blob);
    console.warn(`[voice-diag] endAppend: transcribeBlob resolved, transcript=${transcript === null ? "null" : `"${transcript.slice(0, 40)}..."(${transcript.length}ch)`}, setting state=idle`);
    setState("idle");

    if (transcript === null) return null;

    if (transcript === "") {
      playSound(errorAudioRef.current);
    }

    const transformedTranscript = applyIntentTransform(transcript).transformed;
    const glued = applyGlue(currentText, transformedTranscript);
    return { transcript: transformedTranscript, glued };
  }

  /**
   * endSend(currentText) — stops recording, transcribes, returns {transcript, glued}.
   * Caller sets textarea.value = glued AND calls the existing send handler.
   * Returns null on STT error (errorMessage is set).
   * No-op if state !== "recording".
   */
  async function endSend(
    currentText: string,
  ): Promise<VoiceRecordingResult | null> {
    console.warn(`[voice-diag] endSend: entry state=${state} currentTextLen=${currentText.length}`);
    if (state !== "recording") {
      console.warn(`[voice-diag] endSend: gate rejected (state !== recording), returning null`);
      return null;
    }

    // AudioSession-safety: play stop.mp3 AFTER recorder teardown — see cancel() above.
    const blob = await stopRecording();
    playSound(stopAudioRef.current);
    console.warn(`[voice-diag] endSend: stopRecording resolved, blob=${blob ? `size=${blob.size}` : "null"}, setting state=transcribing`);
    setState("transcribing");

    if (!blob) {
      console.warn(`[voice-diag] endSend: blob null, setting state=idle, returning null`);
      setState("idle");
      return null;
    }

    const transcript = await transcribeBlob(blob);
    console.warn(`[voice-diag] endSend: transcribeBlob resolved, transcript=${transcript === null ? "null" : `"${transcript.slice(0, 40)}..."(${transcript.length}ch)`}, setting state=idle`);
    setState("idle");

    if (transcript === null) return null;

    if (transcript === "") {
      playSound(errorAudioRef.current);
    }

    const transformedTranscript = applyIntentTransform(transcript).transformed;
    const glued = applyGlue(currentText, transformedTranscript);
    return { transcript: transformedTranscript, glued };
  }

  return { state, errorMessage, start, cancel, endAppend, endSend };
}
