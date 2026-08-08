// quick 260808-ho2 — full-surface loading overlay for pretty-view.
//
// Mounted by PrettyView inside the chat-region wrapper as a sibling of
// SessionHoldingOverlay + DormancyOverlay. Sole visibility gate is the
// parent's mount conditional (`{showLoadingOverlay && <PrettyViewLoadingOverlay />}`)
// — this component has NO props and NO variants. Mirrors the sibling
// overlays' default-variant posture.
//
// PURPOSE:
//   Covers the ~5s window between a fresh pane mount (typically triggered
//   by tapping a conversation-list row) and the first user-visible WS frame
//   arriving. Blocks stray taps, provides feedback that the tap registered,
//   and preserves the ComposeBox as typeable (peer sibling of the chat-region
//   wrapper, so the scrim's `absolute inset-0` does NOT cover it — same
//   patch #275 posture inherited from SessionHoldingOverlay/DormancyOverlay).
//
// GUARDRAIL — MOTION-CHANNEL DEVIATION (READ BEFORE "FIXING"):
//   Deviates from the SessionHoldingOverlay / DormancyOverlay static-glyph
//   guardrail established in patch #72 (and reiterated in the file headers
//   of both sibling overlays). Those overlays use a STATIC glyph because
//   they represent STATE — the surface is temporarily unavailable but no
//   active work is happening; a spinner would steal the motion channel
//   owned by WipBubble.
//
//   This overlay is different: LOADING is genuinely WORK-in-progress. The
//   surface IS actively mounting, fetching JSONL history, and completing
//   the WS handshake. A spinner is semantically correct here — WipBubble
//   owns the motion channel for TASK work; this overlay owns the motion
//   channel for SURFACE work. The two NEVER co-render (this overlay is
//   only up before any bubbles render — first user-visible frame dismisses
//   the overlay and starts populating the bubble stream). A future refactor
//   that silently "fixes" this into a static glyph would remove the sole
//   feedback affordance during a boot with legitimate perceptible latency;
//   the regression test (Test 5 in PrettyViewLoadingOverlay.test.tsx) locks
//   the deviation in place.
//
// MUTUAL EXCLUSION:
//   Dormancy > Holding > Loading. Enforced at the parent's mount gate
//   (`showLoadingOverlay = isBooting && !dormant && !showOverlay`). This
//   overlay does not carry the exclusion logic — the parent is the sole
//   decider, mirroring how SessionHoldingOverlay/DormancyOverlay work.
//
// iOS SAFARI BACKDROP-FILTER HARDENING:
//   Scrim carries `isolate [transform:translateZ(0)]` per the patch #333
//   lesson banked in the role file. Non-negotiable for any new backdrop-
//   filter surface in this fork — without these, opening a MediaStream or
//   similar compositor state change silently degrades backdrop-filter
//   rendering on layers currently painting. Verbatim from the sibling
//   overlays' scrim class list.

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function PrettyViewLoadingOverlay(): JSX.Element {
  return (
    <div
      role="status"
      aria-label="Loading conversation…"
      className={cn(
        // Scrim geometry: absolute inset-0 inherits the chat-region wrapper's
        // box — messages / tasks / shells are covered, ComposeBox (peer
        // sibling BELOW the wrapper) stays UNCOVERED so Ashley can pre-draft
        // the next message during the boot window (patch #275 posture).
        // z-[99] sits BELOW IdentityBadge (z-[101]) and BELOW app-modal
        // dialogs (z-[500]) — same z-band as SessionHoldingOverlay + DormancyOverlay.
        // Mutual exclusion is enforced at the parent's mount gate, not by
        // stacking order — all three overlays share z-[99] and cannot co-render.
        "absolute inset-0 z-[99]",
        "flex items-center justify-center",
        "backdrop-blur-md bg-black/40",
        "[-webkit-backdrop-filter:blur(12px)]",
        // iOS Safari backdrop-filter compositor-churn hardening. Verbatim
        // from SessionHoldingOverlay + DormancyOverlay — patch #333 lesson.
        // `isolation: isolate` gives the scrim its own stacking context;
        // `transform: translateZ(0)` forces its own GPU compositing layer.
        // Standard iOS Safari fix for the "backdrop-filter randomly stops
        // rendering" class of bugs.
        "isolate [transform:translateZ(0)]",
        // pointer-events-auto: blocks clicks/taps on everything the scrim
        // covers. This is Ashley's ask verbatim ("block everything else
        // from being touched") — the loading window used to be a silent
        // dead zone where re-taps would double-fire; the scrim eats them.
        "pointer-events-auto",
        // Soft entrance. No exit animation — parent unmounts the DOM the
        // moment showLoadingOverlay flips false (first-frame dismiss, 10s
        // timeout, dormancy/holding takeover). Matches SessionHoldingOverlay
        // + DormancyOverlay behavior exactly.
        "animate-in fade-in duration-150",
      )}
    >
      <div
        className={cn(
          // Centered glass card — mirrors SessionHoldingOverlay's neutral
          // variant verbatim: px-4 py-3 gap-3 for slightly more presence
          // than PlanPendingBubble. Single row (spinner + text), NO
          // flex-col (contrast with DormancyOverlay which has the wake-
          // button + elapsed-hint stacked underneath).
          "rounded-[var(--radius-pv-bubble)] px-4 py-3",
          "backdrop-blur-xl saturate-150",
          "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          "bg-[linear-gradient(160deg,rgba(45,55,80,0.5),rgba(28,35,55,0.55))]",
          "text-[#dfe3ee]",
          "border border-white/[0.08]",
          "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,255,255,0.12)_inset,_0_0_0_0.5px_rgba(255,255,255,0.05)]",
          "flex items-center gap-3 text-sm",
        )}
      >
        {/* Loader2 with animate-spin — see file header for motion-channel
            deviation rationale. Test 5 in PrettyViewLoadingOverlay.test.tsx
            locks this in place as an intentional deviation. */}
        <Loader2
          className="h-4 w-4 shrink-0 animate-spin"
          aria-hidden="true"
        />
        <span>Loading…</span>
      </div>
    </div>
  );
}
