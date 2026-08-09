// quick 260808-cd6 — dormancy overlay + wake button.
// Sibling to SessionHoldingOverlay pattern; motion-channel guardrail
// inherited verbatim from that component.
//
// Replaces the unusable pretty-view surface when an identity pane's
// tmux session has gone dormant (supervisor sentinel at
// ~/.claude/identities/<name>/.dormant). Shape:
//   * Full-surface scrim (`absolute inset-0`) with backdrop-blur-md + bg-black/40,
//     same geometry as SessionHoldingOverlay — covers the chat region while
//     leaving the ComposeBox (sibling, below the wrapper) intentionally uncovered
//     so Ashley can pre-draft.
//   * Centered glass card: "session is asleep" copy + Wake button (asleep state)
//     OR "waking…" static-glyph copy (waking state). No spinner — same motion-
//     channel guardrail as SessionHoldingOverlay (STATIC Moon glyph always;
//     NO animate-spin).
//   * Progress bar (waking, non-error): fills to ~95% over WAKE_ETA_SECONDS so
//     the overlay never looks hung during the supervisor's ≤30s CHECK_INTERVAL +
//     ~30s claude-launch latency window. Expectation-setting only — overlay
//     dismisses via PrettyView's live-frame auto-dismiss when wake completes.
//   * Error variant (warm-red card) when wake failed — mirrors the SessionHoldingOverlay
//     patch #122 error-variant classes verbatim.
//
// GUARDRAIL — motion channel:
//   The glyph is a STATIC `Moon`. Do NOT add `animate-spin` here.
//   See SessionHoldingOverlay file header for the full rationale: the motion
//   channel across pretty view is owned by `WipBubble` — a spinner here would
//   steal focus from real work-in-progress indicators. Static glyph = STATE,
//   not WORK. The patch #72 rule applies to all per-pane overlay components.
//
// GATING:
//   PrettyView.tsx mounts this component when `dormant === true` (set by the
//   WS `{type:"dormant", dormant:true}` frame handler). This component has no
//   visibility props — the parent gate is the sole mount decider.
//
//   Co-exists with SessionHoldingOverlay: the two overlays cannot both be true
//   at once by supervisor invariant (dormant-only-when-alive — the supervisor
//   only sets the sentinel when Claude is alive in the pane; a session recycle
//   would clear the dormant state first). But the mounts are independent so
//   no explicit gate needed here.

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
        // Scrim: absolute inset-0 inherits the chat-region wrapper box, same
        // as SessionHoldingOverlay (quick 260729-j8l mount-point geometry).
        // z-[99] sits BELOW IdentityBadge (z-[101]) — badge stays visible and
        // clickable while the overlay is up. Below app-modal dialogs (z-[500]).
        // pointer-events-auto: blocks clicks/typing on everything the scrim covers.
        "absolute inset-0 z-[99]",
        "flex items-center justify-center",
        "backdrop-blur-md bg-black/40",
        "[-webkit-backdrop-filter:blur(12px)]",
        // iOS Safari backdrop-filter compositor-churn hardening. Without these,
        // opening a MediaStream (mic recording) or similar compositor state change
        // silently degrades backdrop-filter rendering. `isolation: isolate` gives
        // the scrim its own stacking context; `transform: translateZ(0)` forces
        // its own GPU compositing layer. Standard iOS Safari fix. Verbatim from
        // SessionHoldingOverlay.
        "isolate [transform:translateZ(0)]",
        "pointer-events-auto",
        "animate-in fade-in duration-150",
      )}
    >
      <div
        className={cn(
          // Centered glass card — mirrors SessionHoldingOverlay verbatim:
          // px-4 py-3 gap-3 for slightly more presence than PlanPendingBubble.
          "rounded-[var(--radius-pv-bubble)] px-4 py-3",
          "backdrop-blur-xl saturate-150",
          "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          // Error variant: warm-red-tinted gradient + text (patch #127 / #122 style).
          // Warm-red stops match ComposeBox.tsx line ~981 hsla(0,72%,55%,1) — one
          // warm-red across the app. Verbatim from SessionHoldingOverlay.
          // Non-error: neutral navy card (same as SessionHoldingOverlay default).
          showError
            ? "bg-[linear-gradient(160deg,rgba(85,30,35,0.55),rgba(55,20,25,0.6))]"
            : "bg-[linear-gradient(160deg,rgba(45,55,80,0.5),rgba(28,35,55,0.55))]",
          showError ? "text-[#f5d0d4]" : "text-[#dfe3ee]",
          "border border-white/[0.08]",
          // Error variant: warm-red inset glow (patch #122 style). Non-error: standard shadow.
          showError
            ? "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,200,200,0.14)_inset,_0_0_18px_hsla(0,72%,55%,0.18)]"
            : "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,255,255,0.12)_inset,_0_0_0_0.5px_rgba(255,255,255,0.05)]",
          "flex flex-col items-center gap-3 text-sm",
        )}
      >
        {/* Glyph row: Moon icon + main copy on one line */}
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

        {/* Wake button: visible only in asleep state (not waking, not waking-error-retry) */}
        {!waking && (
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
        )}
      </div>
    </div>
  );
}
