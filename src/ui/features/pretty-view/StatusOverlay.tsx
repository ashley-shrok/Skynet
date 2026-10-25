import type { ReactNode } from "react";

// The conversation view's status overlay: a solid darkening over the message
// area with one card in the middle (styles: .pv-status in conversation.css).
// Mounted inside the chat region, so the composer below stays usable.
// Loading, session recycling, connection failed, room gone and drop files all
// use it — a new state of the conversation surface should too.

export interface StatusOverlayProps {
  /** Leading mark — an icon (gets .pv-status-icon) or the working orb. */
  icon: ReactNode;
  title: string;
  subline?: string;
  tone?: "neutral" | "danger" | "warn";
  role?: "status" | "alert";
  ariaLabel?: string;
  /** Visual only: lets pointer events through and sits under the others. */
  passive?: boolean;
  testId?: string;
  titleTestId?: string;
  sublineTestId?: string;
  /** Something under the card's text, e.g. a Retry button. */
  children?: ReactNode;
  /** Something drawn on the darkening itself, behind the card. */
  backdrop?: ReactNode;
}

export function StatusOverlay({
  icon,
  title,
  subline,
  tone = "neutral",
  role = "status",
  ariaLabel,
  passive,
  testId,
  titleTestId,
  sublineTestId,
  children,
  backdrop,
}: StatusOverlayProps) {
  return (
    <div
      role={role}
      aria-label={ariaLabel ?? title}
      data-testid={testId}
      data-tone={tone}
      data-passive={passive ? "true" : undefined}
      className="pv-status"
    >
      {backdrop}
      <div className="pv-status-card pv-float">
        <div className="pv-status-row">
          {icon}
          <span className="pv-status-title" data-testid={titleTestId}>
            {title}
          </span>
        </div>
        {subline ? (
          <div className="pv-status-sub" data-testid={sublineTestId}>
            {subline}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/** The working orb, sized for the status card. */
export function StatusOrb() {
  return (
    <span className="pv-wip-orb" aria-hidden="true">
      <i />
    </span>
  );
}
