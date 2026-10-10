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
  onSpeakClick: (e: React.MouseEvent) => void;
} {
  const ownerRef = useRef(Symbol(opts.ownerName));
  const [speakState, setSpeakState] = useState<SpeakState>("idle");
  // Paused between pieces: the next piece's playback, held until resume.
  const pausedRef = useRef(false);
  const heldRef = useRef<(() => void) | null>(null);
  // Latest getText/voices without re-creating the click handler every render.
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const tag = `${opts.logPrefix ?? ""}${ownerRef.current.toString()}`;

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
        onCanPlay: () => console.info(`[tts] media-canplay owner=${tag}`),
        onPause: () => console.info(`[tts] media-pause owner=${tag}`),
        onStalled: () => console.warn(`[tts] media-stalled owner=${tag}`),
        onSuspend: () => console.warn(`[tts] media-suspend owner=${tag}`),
      });

      // Install the singleton BEFORE the fetch so a same-tick preempt from
      // another button sees a non-null currentPlayer and can stop us cleanly.
      setCurrentPlayer(player);
      setCurrentOwner(owner);

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
        if (pausedRef.current) {
          heldRef.current = start;
        } else {
          setSpeakState("playing");
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
    [tag],
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
      clearCurrentPlayer();
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
    if (pieces.length === 0) return;

    pausedRef.current = false;
    heldRef.current = null;
    setSpeakState("loading");
    void playPiece(pieces, 0, voices);
  }, [playPiece, tag]);

  const onSpeakClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
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
    [speakState, startSpeak],
  );

  return { speakState, onSpeakClick };
}
