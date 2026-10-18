// Harness-waiting state indicator for PrettyView.
//
// Shown while fleet-status reports the agent's harness as waiting on the user
// (status === "waiting"). Two forms:
//
//   - Permission prompt form: when the backend could read a Yes/No tool
//     permission prompt off the agent's screen (use-permission-prompt.ts +
//     permission-prompt-screen.ts), the bubble says in plain words what the
//     agent wants to do and why Claude Code is asking, with Allow / Deny
//     buttons. A click sends {type:"permission_answer"}; the backend types the
//     option's digit into the pane only if the same prompt is still on screen.
//     Claude Code auto-denies unattended prompts after a countdown; the bubble
//     shows it and the caller stops rendering the bubble once it runs out.
//
//   - Presence form: anything else (folder-trust dialog, unknown layout, the
//     moment before the first probe answers) — a single line naming what the
//     harness reported, to be answered in the terminal.
//
// SECURITY: every string from the pane is rendered as a React text node
// (never dangerouslySetInnerHTML).

import { useState } from "react";
import { Hand } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PermissionPromptInfo } from "../../api/claude-session-api";
import type { PermissionAnswerState } from "./use-permission-prompt";

export interface WaitingBubbleProps {
  /**
   * The `waitingFor` string as the harness reports it (e.g. "permission
   * prompt", "dialog open"). Null or empty → "Waiting on you".
   */
  reason: string | null;
  /** Parsed on-screen permission prompt; null → presence form. */
  prompt?: PermissionPromptInfo | null;
  /** Whole seconds until Claude Code auto-denies, when it shows a countdown. */
  secondsLeft?: number | null;
  answer?: PermissionAnswerState | null;
  onAnswer?: (choice: "allow" | "deny") => void;
  /** Agent's display name for the headline; falls back to "The agent". */
  agentName?: string | null;
}

const bubbleClass = cn(
  "leading-relaxed",
  "rounded-[var(--radius-pv-bubble)] px-3 py-2",
  "pv-hue-surface",
  "bg-[linear-gradient(160deg,hsla(var(--pv-id-hue),50%,38%,0.55),hsla(var(--pv-id-hue),45%,24%,0.6))]",
  "text-[#fbf5e8]",
  "border border-[hsla(var(--pv-id-hue),65%,55%,0.32)]",
  "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,220,170,0.18)_inset,_0_0_0_0.5px_hsla(var(--pv-id-hue),70%,55%,0.2),_0_0_32px_hsla(var(--pv-id-hue),70%,52%,0.18)]",
  "text-sm",
);

/** "wants to run a command" etc., from the prompt's title line. */
export function describeAction(title: string): string {
  if (/^bash\b/i.test(title)) return "wants to run a command";
  if (/edit/i.test(title)) return "wants to edit a file";
  if (/(create|write)/i.test(title)) return "wants to create a file";
  if (/(fetch|web)/i.test(title)) return "wants to fetch a web page";
  return `wants to use a tool (${title})`;
}

/** Plain-words explanation of why Claude Code is asking. */
export function describeReason(reason: string | null): string {
  if (reason === null) return "Claude Code wants your OK before it goes ahead.";
  if (/^dangerous rm\b/i.test(reason)) {
    return "Claude Code flagged it as a possibly risky delete and wants your OK.";
  }
  if (/^hook pretooluse/i.test(reason)) {
    return "A safety check on this machine asked for your OK.";
  }
  return "Claude Code flagged it as possibly risky and wants your OK.";
}

function formatCountdown(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function answerText(answer: PermissionAnswerState): string {
  switch (answer.status) {
    case "sending":
      return answer.choice === "allow" ? "Allowing…" : "Denying…";
    case "sent":
      return answer.choice === "allow"
        ? "Allowed."
        : "Denied. The agent has stopped and is waiting for you to say what to do instead.";
    case "gone":
      return "This prompt had already closed.";
    case "error":
      return "Couldn't send that. Try again.";
  }
}

export function WaitingBubble({
  reason,
  prompt = null,
  secondsLeft = null,
  answer = null,
  onAnswer,
  agentName = null,
}: WaitingBubbleProps) {
  const [showDetails, setShowDetails] = useState(false);
  const displayReason = reason && reason.length > 0 ? reason : "Waiting on you";

  if (prompt === null || !onAnswer) {
    return (
      <div className={cn("flex", "justify-start")}>
        <div
          role="status"
          aria-label={`Harness waiting on you: ${displayReason}`}
          className={cn(bubbleClass, "flex items-center gap-2")}
        >
          {/* STATIC Hand — motion is WipBubble's channel. */}
          <Hand className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{displayReason}</span>
        </div>
      </div>
    );
  }

  const who = agentName && agentName.length > 0 ? agentName : "The agent";
  const headline = `${who} ${describeAction(prompt.title)}`;
  const locked = answer !== null && answer.status !== "error";

  return (
    <div className={cn("flex", "justify-start")}>
      <div
        role="group"
        aria-label={`Permission needed: ${headline}`}
        className={cn(bubbleClass, "max-w-[min(720px,80vw)] flex flex-col gap-2")}
      >
        <div className="flex items-start gap-2">
          <Hand className="h-4 w-4 shrink-0 mt-[3px]" aria-hidden="true" />
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="font-medium">{headline}</span>
            {prompt.description && (
              <span className="break-words">“{prompt.description}”</span>
            )}
            <span className="opacity-80">{describeReason(prompt.reason)}</span>
          </div>
        </div>

        {showDetails && (
          <div className="flex flex-col gap-1 min-w-0">
            {prompt.body.length > 0 && (
              <pre
                data-testid="permission-prompt-body"
                className="whitespace-pre-wrap break-all font-mono text-xs bg-black/30 rounded px-2 py-1"
              >
                {prompt.body}
              </pre>
            )}
            {prompt.reason && (
              <span className="text-xs opacity-80 break-words">{prompt.reason}</span>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={locked}
            onClick={() => onAnswer("allow")}
            className="rounded-md px-3 py-1 font-medium bg-[#fbf5e8] text-[#2a1a10] disabled:opacity-40"
          >
            Allow
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => onAnswer("deny")}
            className="rounded-md px-3 py-1 font-medium border border-[#fbf5e8]/60 disabled:opacity-40"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="text-xs underline opacity-80"
          >
            {showDetails ? "Hide details" : "Show details"}
          </button>
          {secondsLeft !== null && !locked && (
            <span className="text-xs opacity-80 ml-auto" aria-live="off">
              Auto-denies in {formatCountdown(secondsLeft)}
            </span>
          )}
        </div>

        {answer !== null && (
          <span role="status" className="text-xs">
            {answerText(answer)}
          </span>
        )}
      </div>
    </div>
  );
}
