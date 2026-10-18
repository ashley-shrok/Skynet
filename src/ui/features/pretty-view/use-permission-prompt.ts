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
// never lingers past the timer.

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PermissionAnswerResultEvent,
  PermissionPromptInfo,
  PermissionPromptStateEvent,
} from "../../api/claude-session-api";

export const PROBE_INTERVAL_MS = 2000;
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

  const sendRef = useRef(send);
  sendRef.current = send;
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  const answerRef = useRef(answer);
  answerRef.current = answer;

  // Reset everything when the pane stops waiting.
  useEffect(() => {
    if (waiting) return;
    setPrompt(null);
    setDeadline(null);
    setExpiredFingerprint(null);
    setAnswer(null);
  }, [waiting]);

  // Probe loop.
  useEffect(() => {
    if (!waiting) return;
    const probe = () => {
      sendRef.current({ type: "permission_probe" });
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
      const next = frame.prompt;
      const current = promptRef.current;
      if (next === null) {
        // Keep the answered prompt on screen (showing "Allowed"/"Denied")
        // until fleet-status clears the waiting state.
        if (answerRef.current !== null) return;
        if (current !== null) setPrompt(null);
        setDeadline(null);
        return;
      }
      if (current === null || current.fingerprint !== next.fingerprint) {
        console.info({
          operation: "permission_prompt_seen",
          fingerprint: next.fingerprint,
          title: next.title,
          autoDenySeconds: next.autoDenySeconds,
        });
        setAnswer(null);
      }
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
    (prompt === null || prompt.fingerprint === expiredFingerprint);

  const secondsLeft =
    deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));

  return { prompt, secondsLeft, hidden, answer, onAnswer, handleFrame };
}
