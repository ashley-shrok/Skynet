// ─── archive-identity-pane.ts ──────────────────────────────────────────────
// Archive the identity behind an open pane: confirm, close the pane, drop
// the sidebar row optimistically, then fire the archive. Shared by the
// identity badge's menu Archive item and the badge drop lane's archive zone
// so both read the same confirmation and roll back the same way. The agent's
// active wake-ups are looked up while the confirm is open — Archive waits for
// them — so it can name the ones that would stop (archive-wakeup-check.ts).

import { announceAgentArchived } from "@/features/archived-view/archived-identity";
import { applyIdentityChange } from "@/state/identities-store";
import {
  markPendingArchive,
  clearPendingArchive,
  removeFleetSession,
} from "@/state/conversation-store";
import { archiveIdentity } from "@/api/identity-archive-api";
import { kitAlert, kitConfirm } from "@/components/kit";
import {
  ARCHIVE_AGENT_BODY,
  checkActiveWakeups,
  claimArchivePrompt,
  releaseArchivePrompt,
  singleAgentArchiveBody,
} from "./archive-wakeup-check";

export function confirmAndArchiveIdentityPane(args: {
  hostId: number;
  identityKey: string;
  /** Sidebar-row label for the confirm copy: task, else displayName, else key. */
  label: string;
  closePane: () => void;
}): void {
  void confirmThenArchive(args);
}

async function confirmThenArchive(args: {
  hostId: number;
  identityKey: string;
  label: string;
  closePane: () => void;
}): Promise<void> {
  const { hostId, identityKey, label, closePane } = args;
  if (!claimArchivePrompt(hostId, identityKey)) return;
  let ok: boolean;
  try {
    // The confirm opens at once; Archive waits for the check, which then
    // fills in the wake-up warning.
    ok = await kitConfirm({
      title: `Archive "${label}"?`,
      body: ARCHIVE_AGENT_BODY,
      ready: checkActiveWakeups(hostId, identityKey).then((check) => ({ body: singleAgentArchiveBody(check) })),
      confirmLabel: "Archive",
      destructive: true,
    });
  } finally {
    releaseArchivePrompt(hostId, identityKey);
  }
  if (!ok) return;
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
      // Archived: every other open copy in this window closes too.
      announceAgentArchived(hostId, identityKey);
    } catch (err) {
      clearPendingArchive(hostId, identityKey);
      console.warn({
        operation: "identity_archive_failed",
        hostId,
        identityKey,
        errMessage: err instanceof Error ? err.message : String(err),
      });
      void kitAlert({
        title: "Couldn't archive",
        body: err instanceof Error ? err.message : String(err),
      });
    }
  })();
}
