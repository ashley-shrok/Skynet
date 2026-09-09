import { eq } from "drizzle-orm";
import { authLogger } from "../../utils/logger.js";
import { db, DatabaseSaveTrigger } from "../db/index.js";
import { unlinkUserAvatar } from "./user-avatar-storage.js";
import { assertAdminErr, deactivateUser } from "../../matrix/matrix-admin-client.js";
import {
  auditLogs,
  commandHistory,
  dashboardPreferences,
  dismissedAlerts,
  fileManagerPinned,
  fileManagerRecent,
  fileManagerShortcuts,
  hostAccess,
  hosts,
  networkTopology,
  opksshTokens,
  recentActivity,
  sessionRecordings,
  sessions,
  sharedCredentials,
  snippetFolders,
  snippets,
  sshCredentialUsage,
  sshCredentials,
  sshFolders,
  transferRecent,
  userOpenTabs,
  userPreferences,
  userRoles,
  users,
} from "../db/schema.js";

export async function deleteUserAndRelatedData(userId: string): Promise<void> {
  try {
    await db
      .delete(sharedCredentials)
      .where(eq(sharedCredentials.targetUserId, userId));

    await db
      .delete(sessionRecordings)
      .where(eq(sessionRecordings.userId, userId));

    await db.delete(hostAccess).where(eq(hostAccess.userId, userId));
    await db.delete(hostAccess).where(eq(hostAccess.grantedBy, userId));

    await db.delete(sessions).where(eq(sessions.userId, userId));

    await db.delete(userRoles).where(eq(userRoles.userId, userId));
    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));

    await db
      .delete(sshCredentialUsage)
      .where(eq(sshCredentialUsage.userId, userId));

    await db
      .delete(fileManagerRecent)
      .where(eq(fileManagerRecent.userId, userId));
    await db
      .delete(fileManagerPinned)
      .where(eq(fileManagerPinned.userId, userId));
    await db
      .delete(fileManagerShortcuts)
      .where(eq(fileManagerShortcuts.userId, userId));

    await db.delete(transferRecent).where(eq(transferRecent.userId, userId));

    await db.delete(recentActivity).where(eq(recentActivity.userId, userId));
    await db.delete(dismissedAlerts).where(eq(dismissedAlerts.userId, userId));

    await db.delete(snippets).where(eq(snippets.userId, userId));
    await db.delete(snippetFolders).where(eq(snippetFolders.userId, userId));

    await db.delete(sshFolders).where(eq(sshFolders.userId, userId));

    await db.delete(commandHistory).where(eq(commandHistory.userId, userId));

    await db.delete(hosts).where(eq(hosts.userId, userId));
    await db.delete(sshCredentials).where(eq(sshCredentials.userId, userId));

    await db.delete(networkTopology).where(eq(networkTopology.userId, userId));
    await db
      .delete(dashboardPreferences)
      .where(eq(dashboardPreferences.userId, userId));
    await db.delete(opksshTokens).where(eq(opksshTokens.userId, userId));
    await db.delete(userOpenTabs).where(eq(userOpenTabs.userId, userId));
    await db.delete(userPreferences).where(eq(userPreferences.userId, userId));

    db.$client
      .prepare("DELETE FROM settings WHERE key LIKE ?")
      .run(`user_%_${userId}`);

    // Phase 85 (D-22) — remove this user's avatar file from disk BEFORE deleting
    // the row. We fetch the pointer first because the row is our source of truth
    // for the filename; deleting the row first would lose the pointer forever.
    // unlinkUserAvatar is ENOENT-tolerant per Plan 02 — a null pointer or a
    // missing file on disk both no-op cleanly. If the unlink fails for a
    // non-ENOENT reason (permission, EBUSY), the throw propagates and the
    // outer try/catch at the top of this helper surfaces it — the DELETE
    // will not run and the operator sees the error rather than a silent
    // orphan-file leak.
    const avatarRow = await db.select({ avatarPath: users.avatarPath, mxid: users.mxid })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (avatarRow.length > 0) {
      await unlinkUserAvatar(avatarRow[0].avatarPath);
    }

    // Phase 88 D-09 — deactivate Matrix account BEFORE row DELETE (Pitfall 5 — mxid must be fetched from the row
    // before it's gone; extended into the avatarRow select projection above). Best-effort per D-10: Synapse failure
    // logs a warning with the orphan mxid and proceeds with the row DELETE anyway. This helper is called by
    // admin-side + OIDC-merge paths; the helper's caller is responsible for the HTTP response.
    if (avatarRow.length > 0 && avatarRow[0].mxid) {
      const deactivateResult = await deactivateUser(avatarRow[0].mxid);
      if (!deactivateResult.ok) {
        assertAdminErr(deactivateResult);
        authLogger.warn(
          "Matrix account deactivation failed in deleteUserAndRelatedData (orphaned mxid logged for future sweep — D-10 best-effort)",
          {
            operation: "delete_user_and_related_data_matrix_deactivate_failed",
            userId,
            mxid: avatarRow[0].mxid,
            status: deactivateResult.status,
            error: deactivateResult.error,
          },
        );
      }
    }

    await db.delete(users).where(eq(users.id, userId));

    // Crown-jewel in-memory-SQLite invariant: every db.delete requires a
    // matching forceSave or the write is lost across container restart. This
    // helper does ~25 deletes across the user's related tables; before this
    // fix the whole cascade was RAM-only until the next unrelated write
    // triggered a save. Discovered via Phase 88's unbiased code review sweep.
    try {
      await DatabaseSaveTrigger.forceSave("phase-88-fixup-delete-user-and-related");
    } catch (saveError) {
      authLogger.error("Failed to persist user cascade delete to disk", saveError, {
        operation: "delete_user_and_related_data_save_failed",
        userId,
      });
    }

    authLogger.success("User and all related data deleted successfully", {
      operation: "delete_user_and_related_data_complete",
      userId,
    });
  } catch (error) {
    authLogger.error("Failed to delete user and related data", error, {
      operation: "delete_user_and_related_data_failed",
      userId,
    });
    throw error;
  }
}
