/**
 * useVoiceRecording — state machine hook for voice recording + STT transcription.
 *
 * Canonical golden-copy for the [subsystem] event key=value log-line shape used
 * across the app (D-11). All structured logs in this hook use the `[voice]` prefix
 * (per D-13 taxonomy), template-literal-composed `msg` strings, explicit field
 * extraction from DOM events (D-05), and level semantics per D-14: `info` for
 * expected transitions, `warn` for unexpected-but-not-fatal paths, `error` for
 * real failures. Future patches MUST follow this file's shape (D-04 going-forward
 * rule — see box-maintainer.md § Standing directives).
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

/** Optional context passed by the caller so log lines carry hostId/sessionId per D-12. */
export interface VoiceLogContext {
  hostId?: number;
  sessionId?: string;
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

export function useVoiceRecording(
  logContext?: VoiceLogContext,
): UseVoiceRecordingReturn {
  const [state, setState] = useState<VoiceRecordingState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Refs hold the mutable recorder state so they survive re-renders without
  // causing additional renders (mirrors the prototype's module-level locals).
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Defensive: set true if cancel() is called while getUserMedia is still
  // resolving. Consumed by the streamPromise.then() callback in start() to
  // abort the recording setup before MediaRecorder is constructed. Prevents
  // a race where a short-tap on hold-send lands during the mic-permission
  // grant window and would otherwise leave the mic hot indefinitely.
  const pendingCancelRef = useRef<boolean>(false);

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

  // Convenience: log-line suffix carrying D-12 standard fields (best-effort).
  const ctxSuffix = `hostId=${logContext?.hostId ?? "n/a"} sessionId=${logContext?.sessionId ?? "n/a"}`;

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
        console.warn(`[voice] stop-recording recorder-null resolving=null ${ctxSuffix}`);
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
        console.warn(`[voice] stop-recording recorder-state-not-recording state=${recorder.state} resolving=null ${ctxSuffix}`);
        resolve(null);
        return;
      }
      console.info(`[voice] stop-recording calling-stop recorderState=${recorder.state} ${ctxSuffix}`);
      // Race between onstop firing (happy path) and an 8s watchdog (iOS Safari
      // dropped-event recovery). Whichever wins flips `resolved`; the loser
      // must no-op so we never double-cleanup or double-resolve.
      let resolved = false;
      let watchdogHandle: ReturnType<typeof setTimeout> | undefined;

      // D-05: explicitly extract fields from MediaRecorder events.
      recorder.onerror = (event: MediaRecorderErrorEvent) => {
        const err = event.error;
        console.error(`[voice] recorder-error errName="${err?.name ?? "unknown"}" errMessage="${err?.message ?? "no message"}" recorderState=${recorder.state} ${ctxSuffix}`);
      };

      recorder.onstop = () => {
        if (resolved) return;
        resolved = true;
        if (watchdogHandle) clearTimeout(watchdogHandle);
        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        console.info(`[voice] stop-recording onstop-fired blobSize=${blob.size} blobType=${type} ${ctxSuffix}`);
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
        console.warn(`[voice] stop-recording watchdog-fired onstopNeverFiredAfter=8s forcing-cleanup ${ctxSuffix}`);
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
    // Phase 34: pass target-pane context so the backend can SSH-fetch the
    // skill catalog and apply the server-side slash-command transform when
    // the transcript begins with the "slash <content>" wake-word. Server
    // fail-opens (returns raw transcript) if either field is absent.
    if (logContext?.hostId !== undefined) {
      fd.append("hostId", String(logContext.hostId));
    }
    if (logContext?.sessionId !== undefined) {
      fd.append("tmuxSession", logContext.sessionId);
    }

    console.info(`[voice] transcribe-post url=${TRANSCRIBE_URL} blobSize=${blob.size} ext=${ext} ${ctxSuffix}`);

    let res: Response;
    try {
      res = await fetch(TRANSCRIBE_URL, { method: "POST", body: fd });
    } catch (err) {
      const errName = err instanceof Error ? err.name : "unknown";
      const errMessage = err instanceof Error ? err.message : String(err);
      console.error(`[voice] transcribe-fetch-threw errName="${errName}" errMessage="${errMessage}" ${ctxSuffix}`);
      playSound(errorAudioRef.current);
      setErrorMessage(`STT error: ${errMessage}`);
      return null;
    }

    if (res.ok) {
      console.info(`[voice] transcribe-fetch-resolved status=${res.status} ok=${res.ok} ${ctxSuffix}`);
    } else {
      console.warn(`[voice] transcribe-fetch-not-ok status=${res.status} ok=${res.ok} ${ctxSuffix}`);
      playSound(errorAudioRef.current);
      setErrorMessage(`STT error: ${res.status}`);
      return null;
    }

    try {
      const json = (await res.json()) as { text?: string };
      console.info(`[voice] transcribe-json-parsed textLen=${(json.text ?? "").length} ${ctxSuffix}`);
      return json.text ?? "";
    } catch (err) {
      const errName = err instanceof Error ? err.name : "unknown";
      const errMessage = err instanceof Error ? err.message : String(err);
      console.error(`[voice] transcribe-json-parse-threw errName="${errName}" errMessage="${errMessage}" ${ctxSuffix}`);
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
   *
   * Pending-cancel race defense: cancel() may be invoked BEFORE the
   * streamPromise.then() callback runs (short-tap on hold-send during a slow
   * mic-permission grant). In that window the state guard in cancel() would
   * previously turn cancel into a no-op, and the mic would stay hot. This
   * function's .then() callback now checks pendingCancelRef and tears down the
   * arriving stream before constructing MediaRecorder — see Task 1 of Plan 32-01.
   */
  function start(): void {
    // Clear stale pending-cancel flag so a prior cancel cannot kill this fresh start.
    pendingCancelRef.current = false;

    if (state !== "idle") return;

    // ⚠️ MUST be the first non-conditional statement — NO await before this.
    // iOS Safari requires getUserMedia to be called synchronously in the tap
    // handler. Any microtask (await) before this line kills the permission prompt.
    const streamPromise = navigator.mediaDevices.getUserMedia({ audio: true });

    streamPromise
      .then((stream) => {
        // Pending-cancel check: if cancel() was called while getUserMedia was
        // resolving, tear down the just-arrived stream and short-circuit before
        // any recorder / state / audio side effects.
        if (pendingCancelRef.current) {
          pendingCancelRef.current = false;
          stream.getTracks().forEach((t) => t.stop());
          // Do NOT setState (stays "idle"), do NOT play start sound, do NOT
          // construct MediaRecorder. Nothing to clean up in refs — the pre-.then()
          // path did not touch streamRef / chunksRef / recorderRef.
          return;
        }

        streamRef.current = stream;
        chunksRef.current = [];

        const recorder = new MediaRecorder(stream);
        recorderRef.current = recorder;

        // D-05: explicitly extract data from MediaRecorder events.
        recorder.onstart = () => {
          console.info(`[voice] recorder-start mimeType=${recorder.mimeType} state=${recorder.state} ${ctxSuffix}`);
        };

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunksRef.current.push(e.data);
            console.info(`[voice] recorder-data-available size=${e.data.size} type=${e.data.type} ${ctxSuffix}`);
          }
        };

        recorder.start();
        console.info(`[voice] recording-started state=recording ${ctxSuffix}`);
        setState("recording");
        playSound(startAudioRef.current);
        setErrorMessage(null);
      })
      .catch((err: Error) => {
        // Surface mic-denied state — matches prototype's error string.
        // Do NOT play error.mp3 here — permission-denied may happen before any
        // user gesture on Safari, and the errorMessage signal alone is sufficient.
        const errName = err instanceof Error ? err.name : "unknown";
        const errMessage = err instanceof Error ? err.message : String(err);
        console.error(`[voice] mic-denied errName="${errName}" errMessage="${errMessage}" ${ctxSuffix}`);
        setErrorMessage(`mic denied: ${err.name || "error"}`);
        // State stays "idle".
      });
  }

  /**
   * cancel() — stops recording, discards blob, returns to idle.
   * No-op if state !== "recording".
   */
  async function cancel(): Promise<void> {
    console.info(`[voice] cancel-entry state=${state} ${ctxSuffix}`);
    if (state !== "recording") {
      // Defensive: mark a pending cancel so an in-flight start()'s
      // streamPromise.then() will tear down the resolved stream before
      // constructing MediaRecorder. This closes the race where a caller
      // (e.g., useHoldToRecord short-tap) calls cancel() before
      // getUserMedia has resolved.
      pendingCancelRef.current = true;
      console.warn(`[voice] cancel-gate-rejected state=${state} expected=recording pending-cancel-armed=true ${ctxSuffix}`);
      return;
    }
    // Belt-and-suspenders: proactively clear pendingCancelRef in the
    // state === "recording" branch. It should already be false here, but if
    // the caller sequence was cancel → start → (getUserMedia resolves) →
    // recording → cancel, the second cancel must not leave a stale true flag.
    pendingCancelRef.current = false;
    // AudioSession-safety: play cancel.mp3 AFTER recorder teardown, not before.
    // iOS Safari shares one AudioSession between MediaRecorder and Audio playback;
    // starting playback while recording is active can drop MediaRecorder.onstop and
    // orphan the buffered audio (bounty voice-recording-audio-feedback-ordering-onstop-drop).
    //
    // D-07 boundary logs: if AudioSession bug re-appears (onstop stops firing after
    // audio.play), the phase progression in logs reveals whether feedback fired
    // BEFORE or AFTER teardown — immediately narrowing the diagnosis.
    console.info(`[voice] feedback-playback-order phase=before-teardown ${ctxSuffix}`);
    await stopRecording();
    console.info(`[voice] feedback-playback-order phase=after-teardown-before-feedback ${ctxSuffix}`);
    const cancelAudio = cancelAudioRef.current;
    if (cancelAudio) {
      cancelAudio.currentTime = 0;
      Promise.resolve(cancelAudio.play()).then(() => {
        console.info(`[voice] feedback-playback-order phase=feedback-play-resolved sound=cancel ${ctxSuffix}`);
      }).catch((err: unknown) => {
        console.warn(`[voice] feedback-playback-order phase=feedback-play-rejected sound=cancel errName="${err instanceof Error ? err.name : "unknown"}" errMessage="${err instanceof Error ? err.message : String(err)}" ${ctxSuffix}`);
      });
    }
    console.info(`[voice] cancel-exit stopRecording-resolved setting-state=idle ${ctxSuffix}`);
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
    console.info(`[voice] end-append-entry state=${state} currentTextLen=${currentText.length} ${ctxSuffix}`);
    if (state !== "recording") {
      console.warn(`[voice] end-append-gate-rejected state=${state} expected=recording ${ctxSuffix}`);
      return null;
    }

    // AudioSession-safety: play stop.mp3 AFTER recorder teardown — see cancel() above.
    // D-07 boundary logs for feedback-playback ordering (patch #382 regression guard).
    console.info(`[voice] feedback-playback-order phase=before-teardown ${ctxSuffix}`);
    const blob = await stopRecording();
    console.info(`[voice] feedback-playback-order phase=after-teardown-before-feedback ${ctxSuffix}`);
    const stopAudio = stopAudioRef.current;
    if (stopAudio) {
      stopAudio.currentTime = 0;
      Promise.resolve(stopAudio.play()).then(() => {
        console.info(`[voice] feedback-playback-order phase=feedback-play-resolved sound=stop ${ctxSuffix}`);
      }).catch((err: unknown) => {
        console.warn(`[voice] feedback-playback-order phase=feedback-play-rejected sound=stop errName="${err instanceof Error ? err.name : "unknown"}" errMessage="${err instanceof Error ? err.message : String(err)}" ${ctxSuffix}`);
      });
    }
    console.info(`[voice] end-append-stop-resolved blob=${blob ? `size=${blob.size}` : "null"} setting-state=transcribing ${ctxSuffix}`);
    setState("transcribing");

    if (!blob) {
      console.warn(`[voice] end-append-blob-null setting-state=idle returning=null ${ctxSuffix}`);
      setState("idle");
      return null;
    }

    const transcript = await transcribeBlob(blob);
    console.info(`[voice] end-append-transcribe-resolved transcript=${transcript === null ? "null" : `len=${transcript.length}`} setting-state=idle ${ctxSuffix}`);
    setState("idle");

    if (transcript === null) return null;

    if (transcript === "") {
      playSound(errorAudioRef.current);
    }

    const glued = applyGlue(currentText, transcript);
    return { transcript, glued };
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
    console.info(`[voice] end-send-entry state=${state} currentTextLen=${currentText.length} ${ctxSuffix}`);
    if (state !== "recording") {
      console.warn(`[voice] end-send-gate-rejected state=${state} expected=recording ${ctxSuffix}`);
      return null;
    }

    // AudioSession-safety: play stop.mp3 AFTER recorder teardown — see cancel() above.
    // D-07 boundary logs for feedback-playback ordering (patch #382 regression guard).
    console.info(`[voice] feedback-playback-order phase=before-teardown ${ctxSuffix}`);
    const blob = await stopRecording();
    console.info(`[voice] feedback-playback-order phase=after-teardown-before-feedback ${ctxSuffix}`);
    const stopAudio2 = stopAudioRef.current;
    if (stopAudio2) {
      stopAudio2.currentTime = 0;
      Promise.resolve(stopAudio2.play()).then(() => {
        console.info(`[voice] feedback-playback-order phase=feedback-play-resolved sound=stop ${ctxSuffix}`);
      }).catch((err: unknown) => {
        console.warn(`[voice] feedback-playback-order phase=feedback-play-rejected sound=stop errName="${err instanceof Error ? err.name : "unknown"}" errMessage="${err instanceof Error ? err.message : String(err)}" ${ctxSuffix}`);
      });
    }
    console.info(`[voice] end-send-stop-resolved blob=${blob ? `size=${blob.size}` : "null"} setting-state=transcribing ${ctxSuffix}`);
    setState("transcribing");

    if (!blob) {
      console.warn(`[voice] end-send-blob-null setting-state=idle returning=null ${ctxSuffix}`);
      setState("idle");
      return null;
    }

    const transcript = await transcribeBlob(blob);
    console.info(`[voice] end-send-transcribe-resolved transcript=${transcript === null ? "null" : `len=${transcript.length}`} setting-state=idle ${ctxSuffix}`);
    setState("idle");

    if (transcript === null) return null;

    if (transcript === "") {
      playSound(errorAudioRef.current);
    }

    const glued = applyGlue(currentText, transcript);
    return { transcript, glued };
  }

  return { state, errorMessage, start, cancel, endAppend, endSend };
}
