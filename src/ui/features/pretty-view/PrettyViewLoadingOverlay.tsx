// Loading: covers the message area from a fresh pane mount until the first
// frame arrives. The working orb is the motion — the surface is genuinely
// busy. PrettyView decides when it shows (dormancy > holding > loading).

import { StatusOrb, StatusOverlay } from "./StatusOverlay";

export function PrettyViewLoadingOverlay() {
  return (
    <StatusOverlay
      ariaLabel="Loading conversation…"
      icon={<StatusOrb />}
      title="Loading…"
    />
  );
}
