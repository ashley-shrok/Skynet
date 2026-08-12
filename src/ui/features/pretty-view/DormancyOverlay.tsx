// quick 260808-cd6 — dormancy overlay + wake button.
// quick 260812-ma8 — bubble-in-flow refactor from the original scrim.
// Sibling to PlanPendingBubble now (was sibling to SessionHoldingOverlay);
// motion-channel guardrail preserved verbatim from the original.
//
// Rendered when an identity pane's tmux session has gone dormant
// (supervisor sentinel at ~/.claude/identities/<name>/.dormant, surfaced to
// the frontend via `renderedState === "dormant"`).
//
// Shape (quick 260812-ma8):
//   * IN-FLOW assistant-aligned bubble at the bottom of the message list —
//     mirrors `PlanPendingBubble`'s Phase 4 Glass treatment (identity-hue
//     gradient, warm-cream text, `flex justify-start` outer, capped-width
//     card, `backdrop-blur-xl` on the CARD only, no outer scrim). The old
//     shape was a full-surface scrim (`absolute inset-0` + `backdrop-blur-md
//     bg-black/40`) that blurred and blocked the whole chat region — Ashley
//     could not read the tail of the conversation while a session was asleep,
//     which is exactly the context she needs to decide whether to wake it.
//     The new bubble scrolls with the message list and leaves prior messages
//     readable above.
//   * Three states preserved verbatim (only the outer container geometry +
//     treatment changed):
//       (a) asleep (waking=false, no error) — "This session is asleep" + Wake button.
//       (b) waking (waking=true) — "Waking up…" + progress bar linearly
//           filling to WAKE_ETA_PROGRESS_CAP (0.95) over WAKE_ETA_SECONDS (90).
//           No Wake button. No spinner (motion-channel guardrail — see below).
//       (c) error (showError = !waking && error != null) — warm-red Moon +
//           `Couldn't wake — {error}` + Wake button (retry). Warm-red treatment
//           (patch #122 / SessionHoldingOverlay-style gradient/text/shadow)
//           mapped onto the NEW bubble geometry.
//   * Progress bar (waking, non-error): fills to ~95% over WAKE_ETA_SECONDS so
//     the bubble never looks hung during the supervisor's ≤30s CHECK_INTERVAL +
//     ~30s claude-launch latency window. Expectation-setting only — the bubble
//     unmounts via PrettyView's `renderedState` flip when the pane goes live.
//
// GUARDRAIL — motion channel:
//   The glyph is a STATIC `Moon`. Do NOT add `animate-spin` here.
//   Motion channel across pretty view is owned by `WipBubble` — a spinner
//   here would steal focus from real work-in-progress indicators. Static
//   glyph = STATE, not WORK. PlanPendingBubble applies the same rule for
//   its ClipboardList glyph ("waiting on you", not "working").
//   The patch #72 rule applies to all per-pane state indicators.
//
// GATING:
//   PrettyView.tsx mounts this component when `renderedState === "dormant"`
//   (Phase 30 backend-authoritative gate via `paneState`). Quick 260812-ma8
//   moved the mount site from the chat-region wrapper (sibling of
//   `SessionHoldingOverlay`) INTO the scroll container (sibling of
//   `PlanPendingBubble`) so the bubble scrolls in the message-list flow.
//   The gate itself is unchanged — only the mount site moved.
//
//   ComposeBox still reduces to its dormant treatment via the sibling gate
//   `dormantActive={renderedState === "dormant" || waking}` on the compose
//   mount — unchanged by this refactor.

import { Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/button";

// Empirical wake ETA (Ashley timed ~90s end-to-end on T1000, 2026-08-09).
// Progress bar linearly fills to WAKE_ETA_PROGRESS_CAP over this window; it
// caps below 100% so a slow wake doesn't LOOK done before the live-frame
// dismiss actually fires. Overlay dismisses via PrettyView's live-frame
// auto-dismiss path — this bar is expectation-setting, not truth.
const WAKE_ETA_SECONDS = 90;
const WAKE_ETA_PROGRESS_CAP = 0.95;

interface DormancyOverlayProps {
  // false = "session is asleep" + Wake button; true = "waking…" static state
  waking: boolean;
  // 0 until Wake clicked; PrettyView useEffect ticks this while waking=true.
  // Feeds the progress-bar width (waking && !showError only).
  elapsedSeconds: number;
  // Wake button click handler. Disabled when waking=true.
  onWake: () => void;
  // Optional wake_result error message; renders warm-red variant like
  // SessionHoldingOverlay's error prop. null or undefined = no error.
  error?: string | null;
}

export function DormancyOverlay({
  waking,
  elapsedSeconds,
  onWake,
  error,
}: DormancyOverlayProps): JSX.Element {
  // Error variant: warm-red card (only in asleep state, not during waking).
  // When the wake fails, overlay goes back to asleep (waking=false) with error set.
  const showError = !waking && error != null;

  return (
    // quick 260812-ma8: outer wrapper mirrors PlanPendingBubble line 144
    // (`flex justify-start`) — assistant-aligned in-flow bubble. Wrapper carries
    // no role/aria — those live on the inner card (the visible bubble),
    // exactly like PlanPendingBubble.
    <div className={cn("flex", "justify-start", "animate-in fade-in duration-150")}>
      <div
        role="status"
        aria-label={
          showError
            ? `Wake failed — ${error}`
            : waking
              ? "Waking identity session…"
              : "Session is asleep — tap Wake to restart"
        }
        className={cn(
          // Structural classes — shared across non-error and error branches.
          // Copied verbatim from PlanPendingBubble.tsx lines 164-172 (Phase 4
          // Glass bubble shell). `max-w-[min(720px,80vw)]` caps width so a
          // long error string doesn't push the bubble past the pretty-view
          // content column.
          "leading-relaxed",
          "rounded-[var(--radius-pv-bubble)] px-3 py-2",
          "backdrop-blur-xl saturate-150",
          "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          "flex flex-col gap-2 text-sm max-w-[min(720px,80vw)]",
          // Variant-specific treatment: background, text color, border, shadow.
          // Non-error (asleep + waking) = PlanPendingBubble identity-hue treatment
          // ("identity is waiting on you"). Error = warm-red treatment (patch #122
          // / SessionHoldingOverlay style), preserved verbatim from the old scrim.
          showError
            ? "bg-[linear-gradient(160deg,rgba(85,30,35,0.55),rgba(55,20,25,0.6))]"
            : "bg-[linear-gradient(160deg,hsla(var(--pv-id-hue),50%,38%,0.55),hsla(var(--pv-id-hue),45%,24%,0.6))]",
          showError ? "text-[#f5d0d4]" : "text-[#fbf5e8]",
          showError
            ? "border border-white/[0.08]"
            : "border border-[hsla(var(--pv-id-hue),65%,55%,0.32)]",
          showError
            ? "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,200,200,0.14)_inset,_0_0_18px_hsla(0,72%,55%,0.18)]"
            : "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,220,170,0.18)_inset,_0_0_0_0.5px_hsla(var(--pv-id-hue),70%,55%,0.2),_0_0_32px_hsla(var(--pv-id-hue),70%,52%,0.18)]",
        )}
      >
        {/* Glyph row: Moon icon + main copy on one line. `gap-3` preserved
            from the pre-refactor spacing for glyph-to-copy comfort. */}
        <div className="flex items-center gap-3">
          <Moon
            className={cn(
              "h-4 w-4 shrink-0",
              // GUARDRAIL: STATIC Moon — NO animate-spin. See file header.
              // Error variant: warm-red glyph (verbatim from SessionHoldingOverlay patch #122).
              showError && "text-[hsl(0,72%,60%)]",
            )}
            aria-hidden="true"
          />
          <span>
            {showError
              ? `Couldn't wake — ${error}`
              : waking
                ? "Waking up…"
                : "This session is asleep"}
          </span>
        </div>

        {/* Progress bar (waking, non-error): fills to ~95% over WAKE_ETA_SECONDS.
            Expectation-setting only — overlay dismisses via PrettyView's
            live-frame auto-dismiss when the wake actually completes. */}
        {waking && !showError && (
          <div
            className="w-full h-[3px] rounded-full bg-white/10 overflow-hidden"
            role="progressbar"
            aria-label="Waking progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(
              Math.min(elapsedSeconds / WAKE_ETA_SECONDS, WAKE_ETA_PROGRESS_CAP) * 100,
            )}
          >
            <div
              className="h-full bg-white/60 transition-[width] duration-1000 ease-linear"
              style={{
                width: `${
                  Math.min(elapsedSeconds / WAKE_ETA_SECONDS, WAKE_ETA_PROGRESS_CAP) * 100
                }%`,
              }}
            />
          </div>
        )}

        {/* Wake button: visible only in asleep state (not waking, not waking-error-retry).
            `pt-1` matches PlanPendingBubble's footer-row spacing (line 201). */}
        {!waking && (
          <div className="pt-1">
            <Button
              size="sm"
              variant="secondary"
              className="cursor-pointer"
              onClick={onWake}
              aria-label="Wake identity"
              // Wake button is always enabled in asleep/error state — Ashley can retry.
            >
              Wake
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
