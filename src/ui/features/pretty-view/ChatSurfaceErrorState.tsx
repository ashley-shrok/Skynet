// Phase 93 Slice 3 — ported from Slice D's standalone relay-source error
// state per D-10 (retirement moved this out of the now-retired standalone
// tree; Slice 4 deleted the source). Byte-for-behavior port; only the
// export name, testid values, and this header changed. The V8 no-existence-
// oracle discipline (D-20) — same title regardless of the underlying reason
// — is preserved verbatim.
//
// ---
//
// Friendly error state (D-18/D-20). Rendered by the shared chat surface
// (PrettyView) in place of the message list when a relay room is no longer
// available. Two paths reach this state:
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
//   - Security (T-17-03-01): body content is a React text child, NEVER
//     rendered via dangerous-inner-HTML APIs. Same discipline as
//     OutboundBubble + RelayInboundBubble.

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
  /**
   * Optional class applied to the wrapper so consumers can override the
   * default fill-the-parent layout at the mount site without editing this
   * component.
   */
  className?: string;
}

const DEFAULT_TITLE = "This conversation is no longer available.";

export function ChatSurfaceErrorState({
  title = DEFAULT_TITLE,
  subline,
  className,
}: ChatSurfaceErrorStateProps) {
  return (
    <div
      data-testid="chat-surface-error-state"
      role="status"
      aria-label={title}
      className={cn(
        // Fill the parent (surface's message area). `flex-1` so the surface's
        // flex column gives this component the middle area vs. compose bar.
        "flex-1 flex items-center justify-center p-6",
        className,
      )}
    >
      <div
        className={cn(
          // Centered glass card — dark background, warm text; mirrors the
          // pretty-view surface's own bubble treatment for visual consistency.
          "rounded-[var(--radius-pv-bubble,12px)] px-5 py-4",
          "backdrop-blur-xl saturate-150",
          "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          "bg-[linear-gradient(160deg,rgba(35,40,55,0.55),rgba(20,25,40,0.6))]",
          "text-[#e8e4d8]",
          "border border-white/[0.08]",
          "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,255,255,0.08)_inset]",
          "flex flex-col items-center gap-2 text-sm",
          "max-w-[420px]",
        )}
      >
        {/* Primary copy — React text child (T-17-03-01). */}
        <div
          data-testid="chat-surface-error-title"
          className="text-center font-medium"
        >
          {title}
        </div>
        {/* Optional subline — omitted from the DOM when not provided so
            layout collapses cleanly. */}
        {subline !== undefined && subline.length > 0 && (
          <div
            data-testid="chat-surface-error-subline"
            className="text-center text-[rgba(232,228,216,0.55)] text-xs"
          >
            {subline}
          </div>
        )}
      </div>
    </div>
  );
}
