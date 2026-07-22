// Patch #74: full-surface session-recycle overlay for the pretty view.
//
// Replaces the previous `SessionHoldingBanner.tsx` sticky top-of-scroll
// pill. Ashley's live 2026-07-19 design read: the old top-bar treatment
// was "too subtle for how significant the state actually is" — a session
// recycle means the pretty-view surface is genuinely unusable for the
// next few seconds, and the UI should communicate that with a scrim +
// centered card, not a thin pill at the top edge that can be missed.
//
// Shape:
//   * Full-surface scrim (`absolute inset-0`) with backdrop-blur-md +
//     bg-black/40 dims and blurs everything under it (messages, WIP /
//     plan bubbles, compose box, ambient panels, jump-to-latest pill).
//   * `pointer-events-auto` on the scrim catches mouse/keyboard input
//     that would otherwise flow through to widgets underneath — this
//     is a UX affordance ("wait, this is unavailable"), not a security
//     boundary (see threat model T-260719-5ym-02).
//   * A centered glass card sits inside the scrim, mirroring
//     `PlanPendingBubble` / `WipBubble` treatment but with slightly
//     more prominent padding (px-4 py-3 vs. px-3 py-2, gap-3 vs. gap-2)
//     since it is the sole focal element on the surface.
//   * `animate-in fade-in duration-150` (tw-animate-css, already
//     imported in `src/ui/index.css`) gives a soft entrance. There is
//     no exit animation — the parent unmounts and the DOM disappears
//     the moment `isHolding` flips false, which reads as clean and
//     appropriate for "the state resolved."
//
// GUARDRAIL — motion channel:
//   The glyph is a STATIC `RefreshCcw`. Do NOT add `animate-spin` here.
//   Patch #72 established the rule that the motion channel across pretty
//   view is owned by `WipBubble` — a spinner in this overlay would steal
//   focus from real work-in-progress indicators and blur the semantic
//   between "Claude is doing something" (WipBubble) and "the surface is
//   temporarily unavailable" (this overlay). Static glyph = STATE, not
//   WORK. The original `SessionHoldingBanner` honored the same guardrail
//   and this patch inherits it.
//
// GATING:
//   The parent (`PrettyView.tsx`) decides whether to mount this
//   component. When mounted, the overlay renders. The parent gates on a
//   `showOverlay` state that is delay-armed (~350ms) after `isHolding`
//   goes true, so genuinely-instant recycles never flash the overlay.
//   This component itself has no visibility props.
//
// Patch #122 — error variant:
//   Accepts an optional `error` prop. When true, the card renders the
//   same geometry with a warm-red glyph and copy: "Session recycle
//   failed — refresh to check." Trigger is a 120s timeout without
//   `session_changed` OR a backend `inactive { reason: 'holding_timeout' }`
//   frame. The motion-channel guardrail above (STATIC RefreshCcw — NO
//   animate-spin) still applies — error state ≠ work state. Warm-red
//   hue matches the fork's existing meter-well red-band palette
//   (ComposeBox.tsx line 981 `hsla(0,72%,55%,1)`) to keep one warm-red
//   across the app.

import { RefreshCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface SessionHoldingOverlayProps {
  // Patch #122: when true, render the warm-red "recycle failed — refresh
  // to check" variant instead of the neutral "Session recycling…"
  // variant. PrettyView flips this after 120s without session_changed
  // OR on `inactive { reason: 'holding_timeout' }` from the backend.
  // Motion channel guardrail (see file header) is unchanged: static
  // glyph in both variants — NO spinner even on error.
  error?: boolean;
}

export function SessionHoldingOverlay({
  error = false,
}: SessionHoldingOverlayProps) {
  return (
    <div
      role="status"
      aria-label={
        error
          ? "Session recycle failed — refresh the browser to check"
          : "Session recycling — pretty view temporarily unavailable"
      }
      className={cn(
        // Full-surface scrim: absolute inside PrettyView's relative
        // `data-pv-root`. z-[110] sits above IdentityBadge (z-[101]) but
        // below app-modal dialogs (z-[500]) — this is a component-local
        // overlay, not an app-modal event. pointer-events-auto blocks
        // clicks and typing on everything underneath.
        "absolute inset-0 z-[110]",
        "flex items-center justify-center",
        "backdrop-blur-md bg-black/40",
        "[-webkit-backdrop-filter:blur(12px)]",
        "pointer-events-auto",
        "animate-in fade-in duration-150",
      )}
    >
      <div
        className={cn(
          // Centered glass card — mirrors PlanPendingBubble aesthetic
          // with slightly more presence (px-4 py-3 vs. px-3 py-2,
          // gap-3 vs. gap-2) since it is the surface's sole focal
          // element while the overlay is up.
          "rounded-[var(--radius-pv-bubble)] px-4 py-3",
          "backdrop-blur-xl saturate-150",
          "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          "bg-[linear-gradient(160deg,rgba(45,55,80,0.5),rgba(28,35,55,0.55))]",
          "text-[#dfe3ee]",
          "border border-white/[0.08]",
          // Patch #122: warm-red inset glow on error matches the fork's
          // existing meter-well red-band palette (ComposeBox.tsx line
          // 981 `hsla(0,72%,55%,1)`). Subtle red warmth on the card
          // edge, not a warning-banner blare.
          error
            ? "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,200,200,0.14)_inset,_0_0_18px_hsla(0,72%,55%,0.18)]"
            : "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,255,255,0.12)_inset,_0_0_0_0.5px_rgba(255,255,255,0.05)]",
          "flex items-center gap-3 text-sm",
        )}
      >
        <RefreshCcw
          className={cn(
            "h-4 w-4 shrink-0",
            // Patch #122: warm-red on error, matches the fork's existing
            // meter-well red-band hue (ComposeBox.tsx line 981) so the
            // whole app reads with one warm-red palette rather than a
            // clash of destructive-reds.
            error && "text-[hsl(0,72%,60%)]",
          )}
          aria-hidden="true"
        />
        <span>
          {error
            ? "Session recycle failed — refresh to check"
            : "Session recycling…"}
        </span>
      </div>
    </div>
  );
}
