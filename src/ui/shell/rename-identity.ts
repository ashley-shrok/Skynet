// ─── rename-identity.ts ────────────────────────────────────────────────────
// Rename a conversation: prompt for a new title and write it as the
// identity's `task:` frontmatter — the string the sidebar row and the open
// conversation's task line both show. Shared by the sidebar row menu and the
// identity badge menu so both prompt and fail the same way.

import { updateIdentity } from "@/api/identities-api";
import { applyIdentityChange } from "@/state/identities-store";
import { kitAlert, kitPrompt } from "@/components/kit";

/** Client-side cap, matching the limit identity birth puts on `task`. */
export const RENAME_MAX_LENGTH = 500;

export function promptAndRenameIdentity(args: {
  hostId: number;
  identityKey: string;
  /** Prefilled value: the row's current title (task, else displayName). */
  currentTitle: string;
}): void {
  const { hostId, identityKey, currentTitle } = args;
  void (async () => {
    const raw = await kitPrompt({
      title: "Rename conversation",
      defaultValue: currentTitle,
      confirmLabel: "Rename",
      validate: (v) =>
        v.trim().length === 0
          ? "Enter a name."
          : v.trim().length > RENAME_MAX_LENGTH
            ? `Name must be ${RENAME_MAX_LENGTH} characters or fewer.`
            : null,
    });
    if (raw === null) return; // Cancel
    const next = raw.trim();
    if (next.length === 0 || next === currentTitle) return;
    if (next.length > RENAME_MAX_LENGTH) return; // validate already blocks this
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
      void kitAlert({
        title: "Couldn't rename",
        body: err instanceof Error ? err.message : String(err),
      });
    }
  })();
}
