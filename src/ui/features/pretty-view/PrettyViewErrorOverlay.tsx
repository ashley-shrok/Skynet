// Connection failed: the reconnect ladder ran out. Retry starts a fresh
// connection attempt (PrettyView owns what that means).

import { RefreshCcw } from "lucide-react";
import { KitButton } from "@/components/kit";
import { StatusOverlay } from "./StatusOverlay";

export interface PrettyViewErrorOverlayProps {
  onRetry: () => void;
}

export function PrettyViewErrorOverlay({
  onRetry,
}: PrettyViewErrorOverlayProps) {
  return (
    <StatusOverlay
      role="alert"
      tone="danger"
      ariaLabel="Connection failed"
      icon={<RefreshCcw className="pv-status-icon" aria-hidden="true" />}
      title="Connection failed"
    >
      <KitButton size="sm" onClick={onRetry} aria-label="Retry connection">
        Retry
      </KitButton>
    </StatusOverlay>
  );
}
