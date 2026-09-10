// Phase 34 Plan 03: harness-waiting state indicator for PrettyView.
//
// PURPOSE: Surfaces when the Claude Code harness is blocked on a user
// decision that PrettyView cannot render interactively. Concrete
// examples: a file-deletion permission prompt that slips past
// dangerously-skip-permissions, a sandbox request, a worker auth
// dialog. The harness cannot proceed until Ashley answers; this
// bubble tells her to switch to the tmux pane.
//
// WHY NO INTERACTIVE CONTROLS (LOCKED — D-CTX § Waiting bubble):
//   The "waiting" state is a modal permission prompt rendered
//   inside the harness' Ink UI. There is no Skynet-owned WS path
//   that can synthesise a click on an arbitrary Ink modal. Ashley
//   MUST switch to the tmux pane (Ctrl+Shift+O) to answer.
//   Adding buttons here would be misleading and broken —
//   see patch #67 retraction for a historical example of this class
//   of error.
//
// DESIGN:
//   Presence-only (Hand glyph = "stop — I need you here").
//   Uses the identity-hue Phase 4 Glass treatment ("identity is
//   speaking to you") and lives in the scroll container slot as
//   assistant-aligned in-flow bubbles, sibling of WipBubble at
//   the tail of the scroll container.
//
// MOUNT SITE (PLAN 06):
//   Plan 06 (frontend cutover) wires WaitingBubble into
//   PrettyView.tsx alongside the fleet-status WebSocket
//   subscription. Mount condition: `status === 'waiting'` for
//   the current session. `justify-start` aligned.
//
// SECURITY (T-34-11 — Injection):
//   `reason` is rendered exclusively as a React text node (never
//   via dangerouslySetInnerHTML). React auto-escapes the string.
//   grep guard: `grep -rn 'dangerouslySetInnerHTML' WaitingBubble.tsx`
//   MUST return 0 matches.

import { Hand } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WaitingBubbleProps {
  /**
   * The `waitingFor` string exactly as the harness reports it.
   * Examples: "approve Bash" / "sandbox request" / "worker request"
   * / "dialog open" / "input needed". Passed through verbatim to the
   * bubble text — no transformation, no truncation.
   *
   * Null or empty string → falls back to "Waiting on you".
   *
   * Plan 06 maps SessionState.waitingFor → this prop directly.
   * The harness-authored field is user-facing tool names only;
   * no secret leakage risk (T-34-12 accepted).
   */
  reason: string | null;
}

/**
 * Presentational bubble that surfaces the harness-waiting state inside
 * PrettyView. In-flow, assistant-aligned, Phase 4 Glass identity-hue
 * Phase 4 Glass identity-hue treatment. Presence-only: NO buttons.
 *
 * See file header for full rationale. Mount site: Plan 06.
 */
export function WaitingBubble({ reason }: WaitingBubbleProps) {
  const displayReason = reason && reason.length > 0 ? reason : "Waiting on you";

  return (
    <div className={cn("flex", "justify-start")}>
      <div
        role="status"
        aria-label={`Harness waiting on you: ${displayReason}`}
        className={cn(
          // Phase 4 Glass: identity-hue assistant-bubble treatment.
          // Intentionally omits `max-w-[min(720px,80vw)]` — the waiting
          // bubble is a single-line presence indicator.
          "leading-relaxed",
          "rounded-[var(--radius-pv-bubble)] px-3 py-2",
          "backdrop-blur-xl saturate-150",
          "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          "bg-[linear-gradient(160deg,hsla(var(--pv-id-hue),50%,38%,0.55),hsla(var(--pv-id-hue),45%,24%,0.6))]",
          "text-[#fbf5e8]",
          "border border-[hsla(var(--pv-id-hue),65%,55%,0.32)]",
          "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,220,170,0.18)_inset,_0_0_0_0.5px_hsla(var(--pv-id-hue),70%,55%,0.2),_0_0_32px_hsla(var(--pv-id-hue),70%,52%,0.18)]",
          "flex items-center gap-2 text-sm",
        )}
      >
        {/* GUARDRAIL: STATIC Hand — NO animate-spin. Motion channel
            across pretty view is owned by WipBubble. Static glyph =
            STATE, not WORK. Same rule as DormancyOverlay's Moon. */}
        <Hand className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{displayReason}</span>
      </div>
    </div>
  );
}
