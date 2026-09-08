// Phase 90 Plan 05 Task 1 — RelayRoomErrorState (D-18 friendly error state).
//
// Rendered by RelayRoomPane in place of the badge row + message list + compose
// slot when the pane opens against a room that is no longer available. Two
// paths reach this state:
//   (a) 403/404 from GET /relay-room/:roomId/participants (Plan 04 REST) —
//       viewer has been kicked, or the row references a room that no longer
//       exists.
//   (b) An `inactive` frame from the relay-room WS (Plan 04) — same underlying
//       Matrix conditions; the WS surface catches them mid-session.
//
// D-18 explicit constraints:
//   - Copy: "This conversation is no longer available." (deliberately
//     non-specific — does NOT distinguish "kicked" vs "never a member";
//     backend Plan 04 already returns the same code for both to avoid an
//     existence oracle).
//   - Optional subline (e.g., "You may have been removed from this room.")
//     — RelayRoomPane wires this in for the WS-inactive path.
//   - NO retry button (RESEARCH.md § Open Question 3 RESOLVED — nothing to
//     retry; the row filters itself out on the next observation-loop tick).
//   - Security (T-17-03-01): body content is a React text child, NEVER
//     dangerouslySetInnerHTML. Same discipline as OutboundBubble +
//     RelayRoomInboundBubble.
//
// Visual treatment mirrors `PrettyViewErrorOverlay.tsx` conceptually (dark
// glass card, centered, warm text) but this component renders INSIDE the
// pane's normal flex layout — not as an absolute-positioned scrim overlay.
// The pane's normal mount point sits above the (missing) compose bar; this
// component fills the pane's message area with a centered card.
//
// Font stack matches the pane's inter/mono conventions. No lucide icon — the
// D-18 copy is deliberately quiet ("no longer available" isn't a warning, it's
// a normal transition state).

import { cn } from "@/lib/utils";

export interface RelayRoomErrorStateProps {
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

export function RelayRoomErrorState({
  title = DEFAULT_TITLE,
  subline,
  className,
}: RelayRoomErrorStateProps) {
  return (
    <div
      data-testid="relay-room-error-state"
      role="status"
      aria-label={title}
      className={cn(
        // Fill the parent (pane's message area). `flex-1` so the pane's flex
        // column gives this component the middle area vs. compose bar.
        "flex-1 flex items-center justify-center p-6",
        className,
      )}
    >
      <div
        className={cn(
          // Centered glass card — dark background, warm text; mirrors the
          // relay-room pane's own bubble treatment for visual consistency.
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
          data-testid="relay-room-error-title"
          className="text-center font-medium"
        >
          {title}
        </div>
        {/* Optional subline — omitted from the DOM when not provided so
            layout collapses cleanly. */}
        {subline !== undefined && subline.length > 0 && (
          <div
            data-testid="relay-room-error-subline"
            className="text-center text-[rgba(232,228,216,0.55)] text-xs"
          >
            {subline}
          </div>
        )}
      </div>
    </div>
  );
}
