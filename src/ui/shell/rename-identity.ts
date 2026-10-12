// ─── rename-identity.ts ────────────────────────────────────────────────────
// Rename a conversation: prompt for a new title and write it as the
// identity's `task:` frontmatter — the string the sidebar row and the open
// conversation's task line both show. Shared by the sidebar row menu and the
// identity badge menu so both prompt and fail the same way.

import { updateIdentity } from "@/api/identities-api";
import { applyIdentityChange } from "@/state/identities-store";

/** Client-side cap, matching the limit identity birth puts on `task`. */
export const RENAME_MAX_LENGTH = 500;

export function promptAndRenameIdentity(args: {
  hostId: number;
  identityKey: string;
  /** Prefilled value: the row's current title (task, else displayName). */
  currentTitle: string;
}): void {
  const { hostId, identityKey, currentTitle } = args;
  const raw = window.prompt("Rename conversation", currentTitle);
  if (raw === null) return; // Cancel
  const next = raw.trim();
  if (next.length === 0 || next === currentTitle) return;
  if (next.length > RENAME_MAX_LENGTH) {
    window.alert(`Name must be ${RENAME_MAX_LENGTH} characters or fewer.`);
    return;
  }
  void (async () => {
    try {
      const updated = await updateIdentity(identityKey, { task: next }, null, hostId);
      applyIdentityChange(updated);
    } catch (err) {
      console.warn({
        operation: "identity_rename_failed",
        hostId,
        identityKey,
        errMessage: err instanceof Error ? err.message : String(err),
      });
      window.alert(`Rename failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  })();
}
