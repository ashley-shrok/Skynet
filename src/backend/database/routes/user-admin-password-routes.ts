import type { AuthenticatedRequest } from "../../../types/index.js";
import type { RequestHandler, Router } from "express";
import bcrypt from "bcryptjs";
import { AuthManager } from "../../utils/auth-manager.js";
import { authLogger } from "../../utils/logger.js";
import { requireRecentAuth } from "../../utils/recent-auth.js";
import { db, DatabaseSaveTrigger } from "../db/index.js";

// The only way back from a forgotten password: an admin who has confirmed
// it's them sets a new one. A user's saved data is locked by their password,
// so it survives only when the server can unlock it — they're signed in
// somewhere and active since the last restart, or the account also signs in
// with SSO (which keeps a server-unlockable copy of their data key).
// Otherwise the admin must say explicitly that wiping it is OK. Admin
// accounts are never reset this way — an admin's own hosts are the whole
// fleet.

export const MIN_PASSWORD_LENGTH = 6;

interface UserAdminPasswordRoutesDeps {
  authManager: AuthManager;
  requireAdmin: RequestHandler;
}

interface TargetRow {
  id: string;
  username: string;
  is_admin: number;
  is_oidc: number;
  password_hash: string | null;
  totp_enabled: number;
}

function countWhere(sql: string, userId: string): number {
  const row = db.$client.prepare(sql).get(userId) as { c?: number } | undefined;
  return row?.c ?? 0;
}

// Everything locked by the user's old data key that a wipe removes. Their
// own hosts cascade to everything hanging off them — including access they
// gave other people, which is why that's counted too.
const WIPE_STATEMENTS = [
  "DELETE FROM ssh_credential_usage WHERE user_id = ?",
  "DELETE FROM file_manager_recent WHERE user_id = ?",
  "DELETE FROM file_manager_pinned WHERE user_id = ?",
  "DELETE FROM file_manager_shortcuts WHERE user_id = ?",
  "DELETE FROM recent_activity WHERE user_id = ?",
  "DELETE FROM dismissed_alerts WHERE user_id = ?",
  "DELETE FROM snippets WHERE user_id = ?",
  "DELETE FROM opkssh_tokens WHERE user_id = ?",
  "DELETE FROM ssh_data WHERE user_id = ?",
  "DELETE FROM ssh_credentials WHERE user_id = ?",
  // Hosts others share with them were locked to the old key too; re-lock
  // them to the new one once the sharer's copy can be read again.
  "UPDATE shared_credentials SET needs_re_encryption = 1 WHERE target_user_id = ?",
];

export function registerUserAdminPasswordRoutes(
  router: Router,
  { authManager, requireAdmin }: UserAdminPasswordRoutesDeps,
): void {
  /**
   * @openapi
   * /users/{id}/set-password:
   *   post:
   *     summary: Set a new password for another user (admin only)
   *     description: |
   *       Signs the user out everywhere and cancels their access keys. When
   *       their data is unlocked on the server it is kept under the new
   *       password. When it is locked the request is refused with what would
   *       be lost — hosts, credentials, snippets, file-manager pins, recents and
   *       shortcuts, two-step codes — (409 DATA_WOULD_BE_WIPED) unless `allowWipe: true`, which
   *       deletes their own hosts (and access they gave others to them),
   *       credentials, snippets and file-manager data and turns off two-step
   *       codes. An account that also signs in with SSO is always kept. Refused for admin accounts and
   *       SSO-only accounts. Needs a session that confirmed it's you in the
   *       last 10 minutes; access keys are refused.
   *     tags:
   *       - Users
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [password]
   *             properties:
   *               password:
   *                 type: string
   *               allowWipe:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: "Password set. `{ dataKept: boolean }`."
   *       400:
   *         description: Password missing or shorter than 6 characters, or the account signs in with SSO only.
   *       403:
   *         description: Not an admin, target is an admin, or REAUTH_REQUIRED / REAUTH_UNAVAILABLE.
   *       404:
   *         description: User not found.
   *       409:
   *         description: Data is locked and `allowWipe` was not given; body lists what would be lost.
   *       500:
   *         description: Failed to set password.
   */
  router.post("/:id/set-password", requireAdmin, requireRecentAuth, async (req, res) => {
    const adminId = (req as AuthenticatedRequest).userId;
    const targetId = String(req.params.id);
    const { password, allowWipe } = req.body ?? {};

    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        error: `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      });
    }
    if (allowWipe !== undefined && typeof allowWipe !== "boolean") {
      return res.status(400).json({ error: "allowWipe must be true or false" });
    }

    try {
      const target = db.$client
        .prepare(
          "SELECT id, username, is_admin, is_oidc, password_hash, totp_enabled FROM users WHERE id = ?",
        )
        .get(targetId) as TargetRow | undefined;
      if (!target) {
        return res.status(404).json({ error: "User not found" });
      }
      if (target.is_admin) {
        authLogger.warn("Admin password set refused: target is an admin", {
          operation: "admin_set_password_refused",
          adminId,
          targetUserId: targetId,
          reason: "target_is_admin",
        });
        return res.status(403).json({
          error:
            "Admin accounts can't be reset this way. To change your own password, use change password.",
          code: "TARGET_IS_ADMIN",
        });
      }
      if (target.is_oidc && !target.password_hash) {
        return res.status(400).json({
          error: "This account signs in with SSO only and has no password.",
        });
      }

      let dataUnlocked = authManager.getUserDataKey(targetId) !== null;
      if (!dataUnlocked) {
        const hasSsoCopy = db.$client
          .prepare("SELECT 1 FROM settings WHERE key = ?")
          .get(`user_encrypted_dek_oidc_${targetId}`);
        if (hasSsoCopy) {
          await authManager.authenticateOIDCUser(targetId);
          dataUnlocked = authManager.getUserDataKey(targetId) !== null;
        }
      }

      if (!dataUnlocked && allowWipe !== true) {
        const wouldLose = {
          hosts: countWhere("SELECT COUNT(*) AS c FROM ssh_data WHERE user_id = ?", targetId),
          credentials: countWhere("SELECT COUNT(*) AS c FROM ssh_credentials WHERE user_id = ?", targetId),
          snippets: countWhere("SELECT COUNT(*) AS c FROM snippets WHERE user_id = ?", targetId),
          fileManagerPins: countWhere("SELECT COUNT(*) AS c FROM file_manager_pinned WHERE user_id = ?", targetId),
          fileManagerRecents: countWhere("SELECT COUNT(*) AS c FROM file_manager_recent WHERE user_id = ?", targetId),
          fileManagerShortcuts: countWhere("SELECT COUNT(*) AS c FROM file_manager_shortcuts WHERE user_id = ?", targetId),
          accessTheyGaveOthers: countWhere(
            "SELECT COUNT(*) AS c FROM host_access WHERE host_id IN (SELECT id FROM ssh_data WHERE user_id = ?)",
            targetId,
          ),
        };
        authLogger.info("Admin password set held: data locked, wipe not allowed", {
          operation: "admin_set_password_needs_wipe",
          adminId,
          targetUserId: targetId,
          ...wouldLose,
        });
        return res.status(409).json({
          error:
            "Their saved data is locked by their old password. Setting a new one would wipe it. Send allowWipe: true to go ahead.",
          code: "DATA_WOULD_BE_WIPED",
          wouldLose: {
            ...wouldLose,
            twoStepCodes: Boolean(target.totp_enabled),
          },
        });
      }

      const saltRounds = parseInt(process.env.SALT || "10", 10);
      const passwordHash = await bcrypt.hash(password, saltRounds);

      // The new password hash is written last, once their data is locked to
      // the new password — so a failure part-way never leaves a password
      // that signs in but can't unlock their data. Retrying is safe.
      if (dataUnlocked) {
        const kept = await authManager.resetUserPasswordWithPreservedDEK(
          targetId,
          password,
        );
        if (!kept) {
          authLogger.error("Admin password set failed re-locking data", undefined, {
            operation: "admin_set_password_relock_failed",
            adminId,
            targetUserId: targetId,
          });
          return res.status(500).json({ error: "Failed to set password. Nothing changed; try again." });
        }
        db.$client
          .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
          .run(passwordHash, targetId);
      } else {
        db.$client.transaction(() => {
          for (const sql of WIPE_STATEMENTS) {
            db.$client.prepare(sql).run(targetId);
          }
        })();
        await authManager.registerUser(targetId, password);
        db.$client
          .prepare(
            "UPDATE users SET password_hash = ?, totp_enabled = 0, totp_secret = NULL, totp_backup_codes = NULL WHERE id = ?",
          )
          .run(passwordHash, targetId);
      }

      authLogger.warn("Admin set a user's password", {
        operation: "admin_set_password",
        adminId,
        targetUserId: targetId,
        targetUsername: target.username,
        dataKept: dataUnlocked,
      });

      await authManager.logoutUser(targetId);

      try {
        await DatabaseSaveTrigger.forceSave("admin-set-password");
      } catch (saveError) {
        authLogger.error("Failed to persist admin password set", saveError, {
          operation: "admin_set_password_save_failed",
          targetUserId: targetId,
        });
      }

      try {
        await authManager.revokeUserApiKeys(targetId, "admin_set_password");
      } catch {
        return res.status(500).json({
          error:
            "Password set, but cancelling their access keys failed. Delete them before relying on the new password.",
        });
      }

      res.json({
        message: dataUnlocked
          ? `Password set for ${target.username}. Their data was kept; they've been signed out.`
          : `Password set for ${target.username}. Their saved data was wiped; they've been signed out. Hosts others share with them unlock again once the sharer's copy can be read.`,
        dataKept: dataUnlocked,
      });
    } catch (err) {
      authLogger.error("Failed to set user password", err, {
        operation: "admin_set_password_failed",
        adminId,
        targetUserId: targetId,
      });
      res.status(500).json({ error: "Failed to set password" });
    }
  });
}
