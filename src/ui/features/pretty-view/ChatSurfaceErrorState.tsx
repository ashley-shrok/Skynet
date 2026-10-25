// A relay room that's no longer available (removed, not found, inactive). The
// message list stays mounted underneath.

import { CircleAlert } from "lucide-react";
import { StatusOverlay } from "./StatusOverlay";

export interface ChatSurfaceErrorStateProps {
  title?: string;
  /** Optional second line, e.g. "You may have been removed from this room." */
  subline?: string;
}

const DEFAULT_TITLE = "This conversation is no longer available.";

export function ChatSurfaceErrorState({
  title = DEFAULT_TITLE,
  subline,
}: ChatSurfaceErrorStateProps) {
  return (
    <StatusOverlay
      tone="danger"
      testId="chat-surface-error-state"
      titleTestId="chat-surface-error-title"
      sublineTestId="chat-surface-error-subline"
      icon={<CircleAlert className="pv-status-icon" aria-hidden="true" />}
      title={title}
      subline={subline}
    />
  );
}
