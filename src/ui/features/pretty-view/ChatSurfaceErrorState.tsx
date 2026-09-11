// Phase 93 Slice 3 — ported from Slice D's standalone relay-source error
// state per D-10 (retirement moved this out of the now-retired standalone
// tree; Slice 4 deleted the source). Reshaped in Phase 93 Slice 6 (post-close
// fix) to match the existing chat-surface overlay pattern (scrim + centered
// glass card + static glyph + z-band) that PrettyViewErrorOverlay and
// SessionHoldingOverlay share — Alice's close-out ask: "matches existing
// overlays = endorsed drift; new-type screen = unsanctioned."
//
// The V8 no-existence-oracle discipline (D-20) — same title regardless of the
// underlying reason — is preserved verbatim.
//
// ---
//
// Friendly overlay (D-18/D-20). Rendered by the shared chat surface
// (PrettyView) as an overlay over the message list when a relay room is no
// longer available. Two paths reach this state:
//   (a) 403/404 from GET /relay-room/:roomId/participants (Plan 04 REST) —
//       viewer has been kicked, or the row references a room that no longer
//       exists.
//   (b) An `inactive` frame from the relay-room WS (Plan 04) — same underlying
//       Matrix conditions; the WS surface catches them mid-session.
//
// D-18/D-20 explicit constraints:
//   - Copy: "This conversation is no longer available." (deliberately
//     non-specific — does NOT distinguish "kicked" vs "never a member";
//     backend Plan 04 already returns the same code for both to avoid an
//     existence oracle).
//   - Optional subline (e.g., "You may have been removed from this room.")
//     — the surface wires this in for the WS-inactive path.
//   - NO retry button (RESEARCH.md § Open Question 3 RESOLVED — nothing to
//     retry; the row filters itself out on the next observation-loop tick).
//     Distinguishes this overlay from PrettyViewErrorOverlay (which does have
//     Retry because a WS retry ladder is recoverable).
//   - Security (T-17-03-01): body content is a React text child, NEVER
//     rendered via dangerous-inner-HTML APIs. Same discipline as
//     OutboundBubble + RelayInboundBubble.
//
// SHAPE (mirrors PrettyViewErrorOverlay / SessionHoldingOverlay error variant):
//   * Scrim geometry + iOS Safari backdrop-filter hardening: same
//     `absolute inset-0 z-[99] flex items-center justify-center` + full
//     `backdrop-blur-md bg-black/40` + `[-webkit-backdrop-filter:blur(12px)]`
//     + `isolate [transform:translateZ(0)]` + `pointer-events-auto` +
//     `animate-in fade-in duration-150`. Non-negotiable iOS Safari tokens
//     per patch #333 lesson (documented in PrettyViewErrorOverlay header).
//   * Warm-red glass card treatment: same warm-red gradient + text color +
//     shadow as PrettyViewErrorOverlay. "This conversation is no longer
//     available." is a terminal error, semantically closer to PrettyView's
//     "Connection failed" than to SessionHoldingOverlay's neutral "Session
//     recycling…" — one warm-red across the app matches
//     ComposeBox meter-well red-band hue `hsla(0,72%,55%,1)`.
//   * STATIC `RefreshCcw` glyph — motion-channel guardrail per file headers
//     of the sibling overlays. This overlay represents STATE (room gone),
//     not WORK; a spinner here would blur semantics.
//
// SEMANTICS — status role (NOT alert):
//   Distinct from PrettyViewErrorOverlay's `alert` role. "Room no longer
//   available" is informational — the user is being told the conversation is
//   gone, but there's no acknowledgment expected (no button to click, no
//   retry). Screen readers announce status less assertively than alert, which
//   matches the terminal informational nature.
//
// GATING:
//   The parent (`PrettyView.tsx`) mounts this component as a sibling to the
//   message-list container, at the same z-band, when
//   `source.kind === "relay" && chatSurfaceAdapter.error !== null`. The
//   message-list container stays mounted underneath — this is an overlay,
//   not a replacement — matching the pattern the harness case uses for
//   PrettyViewErrorOverlay + SessionHoldingOverlay.

import { RefreshCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChatSurfaceErrorStateProps {
  /**
   * Primary copy. Defaults to D-18's "This conversation is no longer
   * available." Custom titles are used for adjacent error paths (e.g.,
   * "Session expired") that still need the same visual treatment.
   */
  title?: string;
  /**
   * Optional secondary line. When present, rendered below the title with a
   * lighter treatment. Typical use: "You may have been removed from this
   * room." for the WS-inactive path.
   */
  subline?: string;
}

const DEFAULT_TITLE = "This conversation is no longer available.";

export function ChatSurfaceErrorState({
  title = DEFAULT_TITLE,
  subline,
}: ChatSurfaceErrorStateProps) {
  return (
    <div
      data-testid="chat-surface-error-state"
      role="status"
      aria-label={title}
      className={cn(
        // Scrim geometry — verbatim from PrettyViewErrorOverlay /
        // SessionHoldingOverlay. z-[99] sits BELOW IdentityBadge (z-[101])
        // and BELOW app-modal dialogs (z-[500]) — same z-band as sibling
        // overlays. pointer-events-auto blocks clicks/typing on what the
        // scrim covers.
        "absolute inset-0 z-[99]",
        "flex items-center justify-center",
        "backdrop-blur-md bg-black/40",
        "[-webkit-backdrop-filter:blur(12px)]",
        // iOS Safari backdrop-filter compositor-churn hardening — patch #333
        // lesson. Non-negotiable for any new backdrop-filter surface in this
        // fork. `isolation: isolate` gives the scrim its own stacking
        // context; `transform: translateZ(0)` forces its own GPU compositing
        // layer. Together they pin a stable reference frame for
        // backdrop-filter that survives sibling compositor churn.
        "isolate [transform:translateZ(0)]",
        "pointer-events-auto",
        // Soft entrance. No exit animation — parent unmounts when the
        // adapter's error state clears (unlikely — this is terminal — but
        // matches sibling overlays).
        "animate-in fade-in duration-150",
      )}
    >
      <div
        className={cn(
          // Centered glass card — mirrors PrettyViewErrorOverlay's error
          // variant geometry verbatim.
          "rounded-[var(--radius-pv-bubble)] px-4 py-3",
          "backdrop-blur-xl saturate-150",
          "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          // Warm-red gradient card body — verbatim from
          // PrettyViewErrorOverlay + SessionHoldingOverlay error variant. One
          // warm-red across the app; matches ComposeBox meter-well red-band
          // hue.
          "bg-[linear-gradient(160deg,rgba(85,30,35,0.55),rgba(55,20,25,0.6))]",
          "text-[#f5d0d4]",
          "border border-white/[0.08]",
          // Warm-red inset glow — verbatim from sibling overlays. Matches
          // ComposeBox meter-well red-band hue `hsla(0,72%,55%,1)` for one
          // warm-red across the app.
          "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,200,200,0.14)_inset,_0_0_18px_hsla(0,72%,55%,0.18)]",
          // `flex-col` because the card may render TWO children: the
          // glyph+title row AND the optional subline. Mirrors
          // PrettyViewErrorOverlay.tsx:134 (which uses flex-col for
          // glyph+copy + Retry button).
          "flex flex-col items-center gap-2 text-sm",
          "max-w-[420px]",
        )}
      >
        {/* Glyph + title row: STATIC RefreshCcw + title copy.
            Motion-channel guardrail applies — see file header. */}
        <div className="flex items-center gap-3">
          <RefreshCcw
            className="h-4 w-4 shrink-0 text-[hsl(0,72%,60%)]"
            aria-hidden="true"
          />
          <span
            data-testid="chat-surface-error-title"
            className="text-center font-medium"
          >
            {title}
          </span>
        </div>
        {/* Optional subline — omitted from the DOM when not provided so
            layout collapses cleanly. */}
        {subline !== undefined && subline.length > 0 && (
          <div
            data-testid="chat-surface-error-subline"
            className="text-center text-[rgba(245,208,212,0.7)] text-xs"
          >
            {subline}
          </div>
        )}
      </div>
    </div>
  );
}
