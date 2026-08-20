// Phase 47 Plan 02 — LoadMoreOlderButton.
//
// A manual "reveal older messages" affordance for pretty-view. Mounted at
// the top of the message-list scroll container by Plan 04. When the pane
// knows older messages exist behind its current view, this button appears;
// when it doesn't (or when the pane has already walked back to the start
// of the conversation), it renders nothing.
//
// PURITY CONTRACT (mirror AsideBubble.tsx L40-42):
// This is a pure function of props — zero React hooks of any kind. All
// state (in-flight / error / has-older signal) lives in the parent
// (Plan 04 PrettyView.tsx or an extracted hook). Click handling is a
// passed-in `onClick` prop. The component's only job is to translate
// `{ hasOlder, status, error }` into the three visible states described
// in 47-CONTEXT.md § Shape. This posture makes the component trivially
// testable and mount-safe under React.StrictMode.
//
// Three visible states (from 47-CONTEXT.md § Shape):
//   - idle: clickable, sits above the topmost message
//   - in-flight: still visible, disabled, showing the twin-arc spinner
//   - error: visible, telling you the last click could not be completed
//     and inviting a retry
//
// SPINNER GLYPH LOCK — twin-arc, not lucide's spinner (Ashley 2026-08-19
// commit df4d7543 / patch #467): the in-flight state uses the symmetric
// twin-arc SVG copied VERBATIM from ComposeBox.tsx L2551-2564. The lucide
// spinner has a lopsided ~300° arc whose visual centroid orbits during
// spin, reading as wobble. The twin-arc pair is rotationally symmetric
// (two 90° arcs 180° apart) so the centroid stays put — that's the whole
// reason patch #467 landed. Do NOT swap this for a lucide spinner glyph.
//
// SINGLE-REQUEST-IN-FLIGHT (from 47-CONTEXT.md § "What would make it
// wrong"): "If clicking rapidly kicked off multiple concurrent requests
// and the results arrived out of order (or produced duplicates), the
// pane's top would become a mess." The `disabled={status === "in-flight"}`
// attribute is the guard — HTML `disabled` blocks click event dispatch at
// the DOM level, so React never sees the click, so onClick never fires.
//
// RETRY CONTRACT (from 47-CONTEXT.md § Philosophy "Fail visibly"): error
// state remains clickable — the user can retry immediately. The button
// is only `disabled` during in-flight, NEVER during error.
//
// NO-LIE INVARIANT (from 47-CONTEXT.md § "What would make it wrong"): "If
// the button appeared on a conversation that has no older messages behind
// it ... it would be a lie. The button's presence is a promise that
// clicking it will produce something." When `hasOlder === false`, this
// component returns `null` — the parent doesn't have to conditionally
// mount it, the button just quietly gets out of the way.

import { ChevronUp, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/button";

export interface LoadMoreOlderButtonProps {
  /**
   * True when the server has signaled that older messages exist behind
   * the pane's current view. False = component returns null (no-lie
   * invariant). Sourced from the connect-time `session` frame OR a
   * response-time `hasMore` field — Plan 04 wires the source.
   */
  hasOlder: boolean;
  /**
   * The three-state discriminator. "idle" = clickable, spinner absent.
   * "in-flight" = disabled, twin-arc spinner shown. "error" = clickable
   * (retry), error glyph + aria-label carry the failure.
   */
  status: "idle" | "in-flight" | "error";
  /**
   * Error string surfaced into the aria-label when status="error".
   * Interpolated as `Couldn't load older messages — ${error} — tap to
   * retry` so a screen reader announces the failure cause. `null` when
   * status !== "error" (or when status="error" but the error came from
   * a code path that lost the message text — the tri-branch aria-label
   * falls back to "unknown error" in that case).
   */
  error: string | null;
  /**
   * Click handler. Invoked once per click when `status !== "in-flight"`
   * (HTML `disabled` blocks in-flight clicks natively). Not invoked at
   * all when `hasOlder === false` because the component isn't in the
   * DOM in that case.
   */
  onClick: () => void;
  /**
   * Optional class applied to the wrapper — leaves Plan 04 room to
   * override the default `flex justify-center py-2` layout at the mount
   * site without editing this component.
   */
  className?: string;
}

export function LoadMoreOlderButton({
  hasOlder,
  status,
  error,
  onClick,
  className,
}: LoadMoreOlderButtonProps): JSX.Element | null {
  // No-lie invariant — early return BEFORE any other logic so the "button
  // is a promise" property can't be accidentally violated by a later
  // refactor. 47-CONTEXT.md § "What would make it wrong".
  if (!hasOlder) return null;

  const disabled = status === "in-flight";

  // Tri-branch aria-label — screen-reader-visible state maps 1:1 to
  // visual state. Structural copy of DormancyOverlay.tsx L99-105.
  // The `error ?? "unknown error"` fallback keeps the label meaningful
  // when status="error" arrives without a message (defense against a
  // future refactor dropping the error prop plumbing).
  const ariaLabel =
    status === "error"
      ? `Couldn't load older messages — ${error ?? "unknown error"} — tap to retry`
      : status === "in-flight"
        ? "Loading older messages…"
        : "Load older messages";

  return (
    <div
      role="status"
      aria-label={ariaLabel}
      className={cn("flex justify-center py-2", className)}
    >
      <Button
        size="sm"
        variant="secondary"
        className="cursor-pointer"
        disabled={disabled}
        onClick={onClick}
        aria-label={ariaLabel}
      >
        {status === "in-flight" ? (
          // Twin-arc spinner — VERBATIM from ComposeBox.tsx L2552-2564
          // (patch #467 / commit df4d7543). Rotationally symmetric so the
          // visual centroid stays put during spin — do NOT swap for a
          // lucide spinner. Both `d=` path values must match ComposeBox
          // byte-for-byte; the grep gate in 47-02-PLAN.md acceptance
          // criteria § Task 2 verifies both are present.
          <svg
            className="size-6 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12 A9 9 0 0 0 12 3" />
            <path d="M3 12 A9 9 0 0 0 12 21" />
          </svg>
        ) : status === "error" ? (
          <>
            <AlertCircle className="size-3.5" aria-hidden="true" />
            <span>Retry</span>
          </>
        ) : (
          <>
            <ChevronUp className="size-3.5" aria-hidden="true" />
            <span>Load older messages</span>
          </>
        )}
      </Button>
    </div>
  );
}
