import type { Host, TabType } from "@/types/ui-types";
import { SessionDashboard } from "@/dashboard/SessionDashboard";

// The upstream dashboard with host widgets, stats bars, drag-and-drop card
// layout etc. has been replaced by a flat tmux session list. See
// SessionDashboard.tsx. The onOpenSingletonTab prop is kept on the public
// interface only because renderTabContent passes it; it is unused here.
export function DashboardTab({
  onOpenTab,
}: {
  onOpenSingletonTab: (type: TabType, pendingEvent?: string) => void;
  onOpenTab: (
    host: Host,
    type: TabType,
    restore?: { instanceId: string; restoredSessionId: string | null },
    options?: { targetTmuxSession?: string | null; label?: string },
  ) => void;
}) {
  return <SessionDashboard onOpenTab={onOpenTab} />;
}
