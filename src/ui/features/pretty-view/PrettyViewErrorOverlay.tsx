// phase-29: PrettyViewErrorOverlay — terminal UI for phase === "error"
//
// Full-surface warm-red error card mounted by the unified pane-entry state
// machine (Phase 29) when the pretty-view WS retry ladder terminally fails
// (`wsState === "failed-permanently"`, resolver row → `phase === "error"`).
// Replaces the transient inline "Connection lost" text that SPEC Requirement 2
// retires — Ashley's flicker case (b) from the SPEC background section.
//
// SHAPE (mechanical composition of two existing overlays per PATTERNS.md § 5):
//   * Scrim geometry + iOS Safari backdrop-filter hardening: copied VERBATIM
//     from SessionHoldingOverlay's error=true branch (drop the ternaries,
//     take only the error=true classes). Same `absolute inset-0 z-[99]`,
//     same `backdrop-blur-md bg-black/40`, same
//     `[-webkit-backdrop-filter:blur(12px)]`, same `isolate
//     [transform:translateZ(0)]`. Non-negotiable per patch #333 lesson —
//     without these tokens, iOS Safari silently degrades backdrop-filter
//     rendering on layers currently painting.
//   * Warm-red glass card: warm-red gradient
//     `bg-[linear-gradient(160deg,rgba(85,30,35,0.55),rgba(55,20,25,0.6))]`
//     + text `text-[#f5d0d4]` + warm-red inset glow — verbatim from
//     SessionHoldingOverlay patch #122 error variant. One warm-red across
//     the app; matches ComposeBox meter-well red-band hue
//     `hsla(0,72%,55%,1)`.
//   * `flex-col items-center gap-3 text-sm` container (NOT the single-row
//     `flex items-center gap-3 text-sm` of SessionHoldingOverlay) because
//     the card has TWO children: the glyph+copy row AND the Retry button.
//     Mirrors DormancyOverlay.tsx:127.
//   * STATIC `RefreshCcw` glyph — see GUARDRAIL below.
//   * Retry button: shadcn Button `size="sm" variant="secondary"` — UX shape
//     copied verbatim from DormancyOverlay's Wake button
//     (`DormancyOverlay.tsx:175-187`). D-09 retry semantics are the parent's
//     concern (Plan 29-04 wires `onRetry` to a fresh WS reconnect attempt
//     via retryKey bump).
//
// GUARDRAIL — motion channel (patch #72 lineage, D-07):
//   STATIC RefreshCcw glyph — do NOT add the spin-animation class here.
//   This overlay represents STATE (connection failed permanently), not
//   WORK (surface booting / task in progress). Motion channel across
//   pretty-view is owned by WipBubble (task work) and
//   PrettyViewLoadingOverlay's Loader2 (surface work). A spinner here
//   would blur the semantic between "something is happening" and
//   "connection is permanently down". This invariant is regression-guarded
//   by PrettyViewErrorOverlay.test.tsx. Sibling reference:
//   SessionHoldingOverlay and DormancyOverlay honor the same guardrail.
//   Only PrettyViewLoadingOverlay deviates (documented deviation —
//   surface-work motion channel).
//
// SEMANTICS — alert role (NOT status):
//   Distinct from SessionHoldingOverlay / DormancyOverlay /
//   PrettyViewLoadingOverlay which all carry the status role. Those are
//   in-progress states (recycle underway, session asleep, surface
//   booting). This overlay is a TERMINAL failure — the WS retry ladder
//   has exhausted its attempts and given up. The alert role is the
//   ARIA-correct role for time-sensitive urgent information that requires
//   user acknowledgment; screen readers announce alerts more assertively
//   than statuses.
//
// COPY (D-08): "Connection failed — retry". Em-dash is U+2014, matching
//   the style used in SessionHoldingOverlay ("Session recycle failed —
//   refresh to check") and DormancyOverlay ("Couldn't wake — <error>").
//
// GATING:
//   The parent (`PrettyView.tsx` post Plan 29-04 rewire) decides whether to
//   mount this component: `{phase === "error" && <PrettyViewErrorOverlay
//   onRetry={handleRetry} />}`. This component has no visibility props
//   itself.

import { RefreshCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/button";

export interface PrettyViewErrorOverlayProps {
  // User-gesture recovery callback. Invoked exactly once per Retry click.
  // Parent (PrettyView.tsx post-29-04) wires this to a fresh WS reconnect
  // attempt (D-09 — same UX shape as DormancyOverlay's Wake → onWake).
  onRetry: () => void;
}

export function PrettyViewErrorOverlay({
  onRetry,
}: PrettyViewErrorOverlayProps): JSX.Element {
  return (
    <div
      role="alert"
      aria-label="Connection failed"
      className={cn(
        // Scrim: `absolute inset-0` inherits the box of whichever parent
        // PrettyView mounts this into (post-29-04: chat-region wrapper —
        // same as sibling overlays per quick 260729-j8l geometry). z-[99]
        // sits BELOW IdentityBadge (z-[101]) and BELOW app-modal dialogs
        // (z-[500]) — same z-band as SessionHoldingOverlay + DormancyOverlay
        // + PrettyViewLoadingOverlay. Mutual exclusion is enforced at the
        // parent's mount gate via `phase === "error"`.
        "absolute inset-0 z-[99]",
        "flex items-center justify-center",
        "backdrop-blur-md bg-black/40",
        "[-webkit-backdrop-filter:blur(12px)]",
        // iOS Safari backdrop-filter compositor-churn hardening — patch #333
        // lesson. `isolation: isolate` gives the scrim its own stacking
        // context; `transform: translateZ(0)` forces its own GPU compositing
        // layer. Together they pin a stable reference frame for
        // backdrop-filter that survives sibling compositor churn.
        // Non-negotiable for any new backdrop-filter surface in this fork.
        "isolate [transform:translateZ(0)]",
        // pointer-events-auto: blocks clicks/typing on everything the scrim
        // covers. Also gives the Retry button its own click surface without
        // stray taps flowing through to widgets underneath.
        "pointer-events-auto",
        // Soft entrance. No exit animation — parent unmounts when `phase`
        // transitions away from "error" (e.g. onRetry succeeded → phase
        // returns to resolving → active).
        "animate-in fade-in duration-150",
      )}
    >
      <div
        className={cn(
          // Centered glass card — mirrors SessionHoldingOverlay's error
          // variant geometry verbatim.
          "rounded-[var(--radius-pv-bubble)] px-4 py-3",
          "backdrop-blur-xl saturate-150",
          "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          // Warm-red gradient card body (D-07 non-negotiable) — verbatim
          // from SessionHoldingOverlay error=true branch.
          "bg-[linear-gradient(160deg,rgba(85,30,35,0.55),rgba(55,20,25,0.6))]",
          "text-[#f5d0d4]",
          "border border-white/[0.08]",
          // Warm-red inset glow — verbatim from SessionHoldingOverlay
          // patch #122 error variant. Matches ComposeBox meter-well
          // red-band hue `hsla(0,72%,55%,1)` for one warm-red across app.
          "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,200,200,0.14)_inset,_0_0_18px_hsla(0,72%,55%,0.18)]",
          // `flex-col` (NOT the single-row `flex items-center gap-3`
          // of SessionHoldingOverlay) because the card has TWO children:
          // the glyph+copy row AND the Retry button. Mirrors
          // DormancyOverlay.tsx:127 exactly.
          "flex flex-col items-center gap-3 text-sm",
        )}
      >
        {/* Glyph + copy row: STATIC RefreshCcw + "Connection failed — retry".
            Motion-channel guardrail applies — see file header. */}
        <div className="flex items-center gap-3">
          <RefreshCcw
            className="h-4 w-4 shrink-0 text-[hsl(0,72%,60%)]"
            aria-hidden="true"
          />
          <span>Connection failed — retry</span>
        </div>

        {/* Retry button — UX shape verbatim from DormancyOverlay Wake button
            (D-09). User-gesture recovery path: parent (PrettyView post-29-04)
            handles what onRetry actually does (fresh WS reconnect attempt via
            retryKey bump, per D-09). */}
        <Button
          size="sm"
          variant="secondary"
          className="cursor-pointer"
          onClick={onRetry}
          aria-label="Retry connection"
        >
          Retry
        </Button>
      </div>
    </div>
  );
}
