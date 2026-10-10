// ─── archive-identity-pane.ts ──────────────────────────────────────────────
// Archive the identity behind an open pane: confirm, close the pane, drop
// the sidebar row optimistically, then fire the archive. Shared by the
// identity badge's menu Archive item and the badge drop lane's archive zone
// so both read the same confirmation and roll back the same way.

import { applyIdentityChange } from "@/state/identities-store";
import {
  markPendingArchive,
  clearPendingArchive,
  removeFleetSession,
} from "@/state/conversation-store";
import { archiveIdentity } from "@/api/identity-archive-api";

export function confirmAndArchiveIdentityPane(args: {
  hostId: number;
  identityKey: string;
  /** Sidebar-row label for the confirm copy: task, else displayName, else key. */
  label: string;
  closePane: () => void;
}): void {
  const { hostId, identityKey, label, closePane } = args;
  if (!window.confirm(`archive ${label}? this can't be undone.`)) return;
  // Close the visible pane BEFORE the API call (mirrors the panel's
  // handleArchive).
  closePane();
  // Optimistic sidebar removal — markPendingArchive FIRST so an in-flight
  // fleet-status upsert racing the removes is silent-dropped rather than
  // re-inserting the row.
  markPendingArchive(hostId, identityKey);
  removeFleetSession(hostId, identityKey);
  applyIdentityChange(null, identityKey, hostId);
  void (async () => {
    try {
      await archiveIdentity(hostId, identityKey);
    } catch (err) {
      clearPendingArchive(hostId, identityKey);
      console.warn({
        operation: "identity_archive_failed",
        hostId,
        identityKey,
        errMessage: err instanceof Error ? err.message : String(err),
      });
      window.alert(`archive failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  })();
}
