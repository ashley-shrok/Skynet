// Session recycling: the agent's session is restarting, so the message area is
// unusable for a few seconds. PrettyView mounts this (after a short delay, so
// instant recycles never flash it) and flips `error` after a 120s timeout or a
// backend holding_timeout. The glyph stays still — this is a state, not work.

import { RefreshCcw } from "lucide-react";
import { StatusOverlay } from "./StatusOverlay";

interface SessionHoldingOverlayProps {
  error?: boolean;
}

export function SessionHoldingOverlay({
  error = false,
}: SessionHoldingOverlayProps) {
  return (
    <StatusOverlay
      tone={error ? "danger" : "neutral"}
      ariaLabel={
        error
          ? "Session recycle failed — refresh the browser to check"
          : "Session recycling — pretty view temporarily unavailable"
      }
      icon={<RefreshCcw className="pv-status-icon" aria-hidden="true" />}
      title={
        error ? "Session recycle failed — refresh to check" : "Session recycling…"
      }
    />
  );
}
