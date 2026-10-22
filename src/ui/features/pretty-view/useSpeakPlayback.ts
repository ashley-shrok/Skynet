import { useCallback, useEffect, useRef, useState } from "react";
import { postSpeakStream } from "@/api/voice-api";
import { notifySpeakFailed, speakErrorStatus } from "./speak-errors";
import { createWebAudioStreamPlayer } from "./webAudioStreamPlayer";
import {
  getCurrentPlayer,
  setCurrentPlayer,
  getCurrentOwner,
  setCurrentOwner,
  clearCurrentPlayer,
  setButtonSpeechState,
  subscribeSpeech,
  takeOverForButton,
} from "./speak-singleton";

export type SpeakState = "idle" | "loading" | "playing" | "paused";

/**
 * useSpeakPlayback — the speak-button apparatus shared by every surface with a
 * speak button (assistant bubbles, relay bubbles, the file viewer).
 *
 * Owns the per-button state (idle → loading → playing ⇄ paused) and the
 * app-wide "one thing speaks at a time" invariant via ./speak-singleton:
 * starting here stops whoever owns the singleton (playing, loading or paused);
 * unmounting stops it if this button owns it.
 *
 * `getText` is read at click time and may return several pieces; they are
 * spoken back to back under one ownership (one request each — used for files
 * longer than one speak request allows). Pause/resume act on the piece
 * currently playing.
 *
 * The state is published on the singleton (voice mode treats a talking speak
 * button as its own "speaking"). Losing ownership to anyone else — another
 * button, a voice-mode reply, voice mode's skip — puts this button back to idle.
 *
 * `logFields` adds fields to the speak-start log line (default: pieces=N).
 * `logPrefix` is prepended to the owner in `[tts]` log lines (e.g. "relay:").
 */
export function useSpeakPlayback(opts: {
  ownerName: string;
  logPrefix?: string;
  getText: () => string | readonly string[];
  /** Extra `key=value` fields for the speak-start log line, read after getText. */
  logFields?: () => string;
  /** Voice candidates; a function is read at click time. */
  voices: readonly string[] | (() => readonly string[]);
}): {
  speakState: SpeakState;
  /** No event when started from a menu item. */
  onSpeakClick: (e?: React.MouseEvent) => void;
} {
  const ownerRef = useRef(Symbol(opts.ownerName));
  const [speakState, setSpeakStateRaw] = useState<SpeakState>("idle");
  const speakStateRef = useRef<SpeakState>("idle");
  /** This button has taken ownership of the singleton and not yet lost it. */
  const ownedRef = useRef(false);
  const setSpeakState = useCallback((s: SpeakState) => {
    speakStateRef.current = s;
    setSpeakStateRaw(s);
    if (s !== "idle") setButtonSpeechState(ownerRef.current, s);
  }, []);
  // Paused between pieces: the next piece's playback, held until resume.
  const pausedRef = useRef(false);
  const heldRef = useRef<(() => void) | null>(null);
  // Latest getText/voices without re-creating the click handler every render.
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const tag = `${opts.logPrefix ?? ""}${ownerRef.current.toString()}`;

  // Ownership moved elsewhere (or was released) → idle.
  useEffect(() => {
    const owner = ownerRef.current;
    return subscribeSpeech(() => {
      if (!ownedRef.current || getCurrentOwner() === owner) return;
      ownedRef.current = false;
      pausedRef.current = false;
      heldRef.current = null;
      if (speakStateRef.current !== "idle") {
        // Own release (end, error, unmount) clears to null — only log a takeover.
        const newOwner = getCurrentOwner();
        if (newOwner !== null) console.info(`[tts] lost-ownership owner=${tag} newOwner=${newOwner.toString()}`);
        setSpeakState("idle");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup: stop player on unmount if this button owns it.
  useEffect(() => {
    const owner = ownerRef.current;
    return () => {
      if (getCurrentOwner() === owner) {
        console.info(`[tts] stop-current owner=${tag} trigger=unmount`);
        getCurrentPlayer()?.stop();
        clearCurrentPlayer();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch + play one piece; on its natural end, chain to the next piece.
  const playPiece = useCallback(
    async (
      pieces: readonly string[],
      index: number,
      voices: readonly string[],
    ) => {
      const owner = ownerRef.current;
      const text = pieces[index];
      const isLast = index === pieces.length - 1;

      const player = createWebAudioStreamPlayer({
        onEnded: () => {
          // Only act if this button still owns the singleton — guard against
          // a race where a NEW speak-click already replaced the singleton
          // (setSpeakState on the OLD button would flash "idle" briefly and
          // race the new button's "loading" render).
          if (getCurrentOwner() !== owner) return;
          if (!isLast) {
            console.info(
              `[tts] piece-ended owner=${tag} piece=${index + 1}/${pieces.length}`,
            );
            const next = () => void playPiece(pieces, index + 1, voices);
            if (pausedRef.current) heldRef.current = next;
            else next();
            return;
          }
          console.info(`[tts] media-ended owner=${tag}`);
          clearCurrentPlayer();
          setSpeakState("idle");
        },
        onError: (err) => {
          // UI returns to idle so the user can retry, and a notice says speech
          // stopped — with selectable TTS providers a failing provider must
          // never look like silence. Extract err fields explicitly — never
          // JSON.stringify(event).
          const errName = err instanceof Error ? err.name : "unknown";
          const errMessage = err instanceof Error ? err.message : String(err);
          console.error(
            `[tts] player-error owner=${tag} errName="${errName}" errMessage="${errMessage}"`,
          );
          if (getCurrentOwner() === owner) {
            clearCurrentPlayer();
            setSpeakState("idle");
            notifySpeakFailed();
          }
        },
        onPlaying: () => console.info(`[tts] media-playing owner=${tag}`),
        onCanPlay: () => {
          console.info(`[tts] media-canplay owner=${tag}`);
          // The first piece stays "loading" until audio is actually queued;
          // a 200 alone doesn't mean anything will be heard.
          if (index === 0 && getCurrentOwner() === owner && !pausedRef.current) {
            setSpeakState("playing");
          }
        },
        onPause: () => console.info(`[tts] media-pause owner=${tag}`),
        onStalled: () => console.warn(`[tts] media-stalled owner=${tag}`),
        onSuspend: () => console.warn(`[tts] media-suspend owner=${tag}`),
      });

      // Install the singleton BEFORE the fetch so a same-tick preempt from
      // another button sees a non-null currentPlayer and can stop us cleanly.
      setCurrentPlayer(player);
      setCurrentOwner(owner);
      ownedRef.current = true;

      try {
        console.info(
          `[tts] fetch-start owner=${tag} url=/voice/speak-stream textLen=${text.length} piece=${index + 1}/${pieces.length}`,
        );
        const response = await postSpeakStream(text, voices);
        // Race check: if another button preempted us during the fetch,
        // currentOwner has changed. Bail out before scheduling any audio.
        if (getCurrentOwner() !== owner) {
          console.warn(
            `[tts] preempt-during-fetch owner=${tag} newOwner=${getCurrentOwner()?.toString() ?? "null"}`,
          );
          return;
        }
        console.info(
          `[tts] fetch-resolved status=${response.status} ok=${response.ok} owner=${tag}`,
        );
        if (!response.ok) {
          console.error(
            `[tts] fetch-error owner=${tag} status=${response.status} statusText="${response.statusText}"`,
          );
          throw new Error(`postSpeakStream returned ${response.status}`);
        }
        const start = () => {
          console.info(`[tts] play-attempt owner=${tag} src=stream`);
          // Fire-and-forget: play() drives its own read loop; we hear back via callbacks.
          void player
            .play(response)
            .then(() => {
              console.info(`[tts] play-attempt owner=${tag} result=success`);
            })
            .catch((err: unknown) => {
              // DOMException does not extend Error in all environments (JSDOM,
              // older Safari) — read .name/.message off any object.
              const rec = err as Record<string, unknown> | null;
              const errName =
                err instanceof Error
                  ? err.name
                  : typeof rec?.name === "string"
                    ? rec.name
                    : "unknown";
              const errMessage =
                err instanceof Error
                  ? err.message
                  : typeof rec?.message === "string"
                    ? rec.message
                    : String(err);
              if (errName === "NotAllowedError") {
                console.warn(
                  `[tts] play-attempt owner=${tag} result=blocked errName="NotAllowedError" errMessage="${errMessage}"`,
                );
              } else {
                console.error(
                  `[tts] play-attempt owner=${tag} result=error errName="${errName}" errMessage="${errMessage}"`,
                );
              }
            });
        };
        // A later piece fetched while the user has paused waits for resume.
        // Later pieces keep the button as it is ("playing" from the piece
        // before); the first piece flips to "playing" on canplay above.
        if (pausedRef.current) {
          heldRef.current = start;
        } else {
          start();
        }
      } catch (err) {
        const errName = err instanceof Error ? err.name : "unknown";
        const errMessage = err instanceof Error ? err.message : String(err);
        console.error(
          `[tts] fetch-error owner=${tag} errName="${errName}" errMessage="${errMessage}"`,
        );
        if (getCurrentOwner() === owner) {
          clearCurrentPlayer();
          setSpeakState("idle");
          notifySpeakFailed(speakErrorStatus(err));
        }
      }
    },
    [setSpeakState, tag],
  );

  const startSpeak = useCallback(() => {
    // If anything else is playing (or loading, or paused), stop it first
    // (cross-button preempt). This is also the only cancel-from-paused path.
    const preemptTarget = getCurrentPlayer();
    if (preemptTarget) {
      console.info(
        `[tts] stop-current owner=${getCurrentOwner()?.toString() ?? "null"} trigger=new-bubble`,
      );
      preemptTarget.stop();
    }

    const { getText } = optsRef.current;
    const voices =
      typeof optsRef.current.voices === "function"
        ? optsRef.current.voices()
        : optsRef.current.voices;
    const raw = getText();
    const pieces = (typeof raw === "string" ? [raw] : [...raw]).filter(
      (p) => p.trim().length > 0,
    );
    const totalLen = pieces.reduce((n, p) => n + p.length, 0);
    console.info(
      `[tts] speak-start owner=${tag} textLen=${totalLen} ${optsRef.current.logFields?.() ?? `pieces=${pieces.length}`} voices=[${voices.join(",")}] trigger=user-click`,
    );
    if (pieces.length === 0) {
      if (preemptTarget) clearCurrentPlayer();
      return;
    }

    pausedRef.current = false;
    heldRef.current = null;
    // Hand over in one step so voice mode never sees a gap between bubbles.
    takeOverForButton(ownerRef.current);
    ownedRef.current = true;
    setSpeakState("loading");
    void playPiece(pieces, 0, voices);
  }, [playPiece, setSpeakState, tag]);

  const onSpeakClick = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      const owns = getCurrentOwner() === ownerRef.current;

      // Same-button click while playing: pause. AudioContext.suspend() freezes
      // the context clock — already-scheduled sources and any that arrive from
      // the read loop during the pause naturally queue up until resume.
      if (speakState === "playing" && owns) {
        pausedRef.current = true;
        void getCurrentPlayer()?.pause();
        setSpeakState("paused");
        return;
      }

      // Same-button click while paused: resume. If the browser killed the
      // AudioContext under us (long background suspension), the player fires
      // onError → the handler flips speakState back to idle.
      if (speakState === "paused" && owns) {
        pausedRef.current = false;
        const held = heldRef.current;
        heldRef.current = null;
        if (held) held();
        else void getCurrentPlayer()?.resume();
        setSpeakState("playing");
        return;
      }

      startSpeak();
    },
    [setSpeakState, speakState, startSpeak],
  );

  return { speakState, onSpeakClick };
}
