// Drives WaitingBubble's Allow / Deny form.
//
// While fleet-status reports the pane as waiting, polls the backend with
// {type:"permission_probe"} every PROBE_INTERVAL_MS. The backend captures the
// pane and replies with the parsed prompt (or null). Answering sends
// {type:"permission_answer", choice, fingerprint}; the backend re-checks that
// the same prompt is still on screen before typing the digit.
//
// Countdown: Claude Code auto-denies unattended prompts after a variable
// window (seen 0:20 and 0:50). Each probe reply re-anchors the deadline from
// the on-screen countdown; once it passes, `hidden` turns true and stays true
// until a different prompt appears or the pane stops waiting — the bubble
// never lingers past the timer. If the pane is still waiting a few seconds
// later with nothing readable on screen (some other dialog), the presence
// form comes back so the user is never left with no bubble at all.
//
// Same-looking prompts: a retry of the identical command has the same
// fingerprint. A prompt counts as a NEW one when the screen showed no prompt
// in between, or when its countdown jumped back up.

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PermissionAnswerResultEvent,
  PermissionPromptInfo,
  PermissionPromptStateEvent,
} from "../../api/claude-session-api";

export const PROBE_INTERVAL_MS = 2000;
/** After the countdown runs out, how long a blank screen keeps the bubble hidden. */
export const EXPIRY_GRACE_MS = 5000;
/** A probe with no reply for this long no longer blocks the next one. */
const PROBE_STALE_MS = 6000;
/** Countdown rising by more than this between probes = a new prompt. */
const COUNTDOWN_JUMP_MS = 3000;
const TICK_MS = 250;

export type PermissionAnswerState = {
  fingerprint: string;
  choice: "allow" | "deny";
  status: "sending" | "sent" | "gone" | "error";
};

export interface UsePermissionPromptResult {
  prompt: PermissionPromptInfo | null;
  /** Whole seconds until auto-deny, or null when no countdown is shown. */
  secondsLeft: number | null;
  /** True once the auto-deny deadline has passed for the current prompt. */
  hidden: boolean;
  answer: PermissionAnswerState | null;
  onAnswer: (choice: "allow" | "deny") => void;
  handleFrame: (
    frame: PermissionPromptStateEvent | PermissionAnswerResultEvent,
  ) => void;
}

export function usePermissionPrompt(
  waiting: boolean,
  send: (frame: Record<string, unknown>) => boolean,
): UsePermissionPromptResult {
  const [prompt, setPrompt] = useState<PermissionPromptInfo | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [expiredFingerprint, setExpiredFingerprint] = useState<string | null>(
    null,
  );
  const [answer, setAnswer] = useState<PermissionAnswerState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [graceOver, setGraceOver] = useState(false);

  const sendRef = useRef(send);
  sendRef.current = send;
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  const answerRef = useRef(answer);
  answerRef.current = answer;
  const deadlineRef = useRef(deadline);
  deadlineRef.current = deadline;
  // True once a probe saw no prompt since the current one was shown.
  const closedSinceShownRef = useRef(false);
  const probeSentAtRef = useRef<number | null>(null);

  // Reset everything when the pane stops waiting.
  useEffect(() => {
    if (waiting) return;
    setPrompt(null);
    setDeadline(null);
    setExpiredFingerprint(null);
    setAnswer(null);
    closedSinceShownRef.current = false;
    probeSentAtRef.current = null;
  }, [waiting]);

  // Probe loop.
  useEffect(() => {
    if (!waiting) return;
    const probe = () => {
      // One probe in flight at a time, so slow hosts don't pile up captures
      // whose replies arrive out of order.
      const sentAt = probeSentAtRef.current;
      if (sentAt !== null && Date.now() - sentAt < PROBE_STALE_MS) return;
      if (sendRef.current({ type: "permission_probe" })) {
        probeSentAtRef.current = Date.now();
      }
    };
    probe();
    const id = window.setInterval(probe, PROBE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [waiting]);

  // Countdown tick.
  useEffect(() => {
    if (deadline === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [deadline]);

  useEffect(() => {
    if (deadline === null || prompt === null) return;
    if (now >= deadline && expiredFingerprint !== prompt.fingerprint) {
      console.info({
        operation: "permission_prompt_countdown_expired",
        fingerprint: prompt.fingerprint,
      });
      setExpiredFingerprint(prompt.fingerprint);
    }
  }, [now, deadline, prompt, expiredFingerprint]);

  // Grace window after expiry.
  useEffect(() => {
    setGraceOver(false);
    if (expiredFingerprint === null) return;
    const id = window.setTimeout(() => setGraceOver(true), EXPIRY_GRACE_MS);
    return () => window.clearTimeout(id);
  }, [expiredFingerprint]);

  const handleFrame = useCallback(
    (frame: PermissionPromptStateEvent | PermissionAnswerResultEvent) => {
      if (frame.type === "permission_answer_result") {
        const current = answerRef.current;
        if (!current || current.fingerprint !== frame.fingerprint) return;
        console.info({
          operation: "permission_answer_result",
          choice: frame.choice,
          status: frame.status,
          fingerprint: frame.fingerprint,
        });
        setAnswer({ ...current, status: frame.status });
        return;
      }
      probeSentAtRef.current = null;
      const next = frame.prompt;
      const current = promptRef.current;
      if (next === null) {
        closedSinceShownRef.current = true;
        // Keep the answered prompt on screen (showing "Allowed"/"Denied")
        // until fleet-status clears the waiting state.
        if (answerRef.current !== null) return;
        if (current !== null) setPrompt(null);
        setDeadline(null);
        return;
      }
      const prevDeadline = deadlineRef.current;
      const countdownJumped =
        next.autoDenySeconds !== null &&
        prevDeadline !== null &&
        next.autoDenySeconds * 1000 > prevDeadline - Date.now() + COUNTDOWN_JUMP_MS;
      if (
        current === null ||
        current.fingerprint !== next.fingerprint ||
        closedSinceShownRef.current ||
        countdownJumped
      ) {
        console.info({
          operation: "permission_prompt_seen",
          fingerprint: next.fingerprint,
          title: next.title,
          autoDenySeconds: next.autoDenySeconds,
          reason: current === null ? "first" : current.fingerprint !== next.fingerprint ? "changed" : closedSinceShownRef.current ? "reappeared" : "countdown_reset",
        });
        setAnswer(null);
        setExpiredFingerprint(null);
      }
      closedSinceShownRef.current = false;
      setPrompt(next);
      setDeadline(
        next.autoDenySeconds === null
          ? null
          : Date.now() + next.autoDenySeconds * 1000,
      );
    },
    [],
  );

  const onAnswer = useCallback((choice: "allow" | "deny") => {
    const current = promptRef.current;
    const prior = answerRef.current;
    if (!current || (prior !== null && prior.status !== "error")) return;
    const ok = sendRef.current({
      type: "permission_answer",
      choice,
      fingerprint: current.fingerprint,
    });
    setAnswer({
      fingerprint: current.fingerprint,
      choice,
      status: ok ? "sending" : "error",
    });
  }, []);

  const hidden =
    expiredFingerprint !== null &&
    (prompt === null ? !graceOver : prompt.fingerprint === expiredFingerprint);

  const secondsLeft =
    deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));

  return { prompt, secondsLeft, hidden, answer, onAnswer, handleFrame };
}
