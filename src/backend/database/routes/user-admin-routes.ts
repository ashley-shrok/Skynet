import type { AuthenticatedRequest } from "../../../types/index.js";
import type { RequestHandler, Router } from "express";
import { eq, ne } from "drizzle-orm";
import { authLogger } from "../../utils/logger.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

/**
 * Phase 75 Plan 03 — Matrix mxid validation regex.
 *
 * Structure: `@localpart:server_name` with lowercase-only localpart per the
 * Matrix spec (agent-relay/SKILL.md:148 locks localpart to lowercase). Length
 * cap: 255 chars localpart + 1 char `@` + 255 chars server_name + 1 char `:` =
 * 512 chars total, naturally enforced by the {1,255} quantifiers.
 *
 * Character sets:
 *   - localpart: `[a-z0-9._=/+-]` (Matrix spec — lowercase letters, digits,
 *     and the punctuation set the spec allows).
 *   - server_name: `[a-z0-9.-]` (conservative — hostnames + IP literal bytes;
 *     no colons/brackets here because Skynet's relay lives at a plain
 *     tailnet hostname, no IPv6-literal ports needed).
 *
 * This gate runs BEFORE any DB touch, URL construction, shell interpolation,
 * or Synapse call. Precedent: Phase 69's IDENTITY_KEY_RE post-review security
 * fix (STATE.md L547) — validate BEFORE interpolate is the discipline that
 * blocks path-traversal / SQL / URL / shell injection at the trust boundary.
 * See threat register T-75-10 (mitigated by this regex + Drizzle parameterized
 * UPDATE) in Phase 75 Plan 03 PLAN.md.
 */
const MXID_RE = /^@[a-z0-9._=/+-]{1,255}:[a-z0-9.-]{1,255}$/;

/**
 * agent-phone — E.164 phone-number validation regex.
 *
 * ITU E.164 specifies a leading `+`, a country code starting with a non-zero
 * digit, and 8-15 total digits after the `+`. This regex enforces exactly
 * that shape — no spaces, no dashes, no parens, no extensions. The gate runs
 * BEFORE any DB touch so shape errors 400 without side effects (same
 * discipline as MXID_RE above).
 *
 * Storage-only validation: the number is never dialed by this endpoint. The
 * phone-call-requests worker consumes the value verbatim and hands it to the
 * third-party phone service, which owns any deeper syntactic + reachability
 * checks.
 */
export const PHONE_E164_RE = /^\+[1-9]\d{7,14}$/;

export function registerUserAdminRoutes(
  router: Router,
  authenticateJWT: RequestHandler,
): void {
  /**
   * @openapi
   * /users/list:
   *   get:
   *     summary: List all users
   *     description: Retrieves a list of all users in the system.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: A list of users.
   *       403:
   *         description: Not authorized.
   *       500:
   *         description: Failed to list users.
   */
  router.get("/list", authenticateJWT, async (req, res) => {
    try {
      const allUsers = await db
        .select({
          id: users.id,
          username: users.username,
          isAdmin: users.isAdmin,
          isOidc: users.isOidc,
        })
        .from(users);

      res.json({ users: allUsers });
    } catch (err) {
      authLogger.error("Failed to list users", err);
      res.status(500).json({ error: "Failed to list users" });
    }
  });

  /**
   * @openapi
   * /users/list-basic:
   *   get:
   *     summary: List other users (picker-facing)
   *     description: |
   *       Returns `{ users: [{id, username, mxid}] }` for every user OTHER
   *       than the requester. Reachable by any authenticated user (NOT
   *       admin-gated). Used by the Phase 38 identity-sharing picker and by
   *       the Phase 91 slice C new-conversation modal to populate human
   *       participant pickers.
   *
   *       `mxid` is the Phase 88 slice A relay identity
   *       (`@localpart_human:server`). It is null for pre-Phase-88 users who
   *       were never minted a relay identity. Slice C's new-conversation modal
   *       (Phase 91) filters mxid-less users out of the Humans picker — they
   *       cannot participate in a relay-mediated room by construction.
   *
   *       Explicitly excludes sensitive fields: isAdmin, isOidc, passwordHash,
   *       totpSecret, OIDC config, email, etc. The picker only needs display
   *       identity, and this route only ever exposes that.
   *
   *       Self-exclusion is enforced server-side so the frontend does not need
   *       to know the requester's id to filter it out client-side.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: |
   *           A list of other users as `{ users: [{id, username, mxid}] }`.
   *           mxid is string for Phase 88+ users, null for pre-Phase-88 users.
   *           Returns 200 with an empty array (NOT 404/204) when the requester
   *           is the only user in the deployment; the frontend hides its
   *           picker affordance on empty response.
   *       401:
   *         description: Missing or invalid JWT.
   *       500:
   *         description: Failed to list users.
   */
  router.get("/list-basic", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      // Explicit column list — this route MUST NOT leak isAdmin, isOidc,
      // passwordHash, totpSecret, OIDC config, or any other sensitive column.
      // `ne(users.id, userId)` enforces server-side self-exclusion so the
      // requester never appears in their own picker (Phase 38 shape guard:
      // "If the picker shows the current user in the list.").
      // Phase 91-00: added mxid to the SELECT list (additive widening —
      // mxid is the Phase 88 relay identity; null for pre-Phase-88 users).
      const otherUsers = await db
        .select({ id: users.id, username: users.username, mxid: users.mxid })
        .from(users)
        .where(ne(users.id, userId));

      res.json({ users: otherUsers });
    } catch (err) {
      authLogger.error("Failed to list users (basic)", err, {
        operation: "list_users_basic",
        userId,
      });
      res.status(500).json({ error: "Failed to list users" });
    }
  });

  /**
   * @openapi
   * /users/make-admin:
   *   post:
   *     summary: Make user admin
   *     description: Grants admin privileges to a user.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               userId:
   *                 type: string
   *                 description: Preferred unique user identifier.
   *               username:
   *                 type: string
   *                 description: Legacy fallback identifier.
   *     responses:
   *       200:
   *         description: User is now an admin.
   *       400:
   *         description: User ID or username is required, or the user is already an admin.
   *       403:
   *         description: Not authorized.
   *       404:
   *         description: User not found.
   *       500:
   *         description: Failed to make user admin.
   */
  router.post("/make-admin", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { userId: targetUserId, username } = req.body;
    const resolvedUserId = isNonEmptyString(targetUserId)
      ? targetUserId.trim()
      : null;
    const resolvedUsername = isNonEmptyString(username)
      ? username.trim()
      : null;

    if (!resolvedUserId && !resolvedUsername) {
      return res.status(400).json({ error: "User ID or username is required" });
    }

    try {
      const adminUser = await db
        .select()
        .from(users)
        .where(eq(users.id, userId));
      if (!adminUser || adminUser.length === 0 || !adminUser[0].isAdmin) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const targetUser = await db
        .select()
        .from(users)
        .where(
          resolvedUserId
            ? eq(users.id, resolvedUserId)
            : eq(users.username, resolvedUsername!),
        )
        .limit(1);
      if (!targetUser || targetUser.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      if (targetUser[0].isAdmin) {
        return res.status(400).json({ error: "User is already an admin" });
      }

      await db
        .update(users)
        .set({ isAdmin: true })
        .where(
          resolvedUserId
            ? eq(users.id, resolvedUserId)
            : eq(users.username, resolvedUsername!),
        );

      try {
        const { saveMemoryDatabaseToFile } = await import("../db/index.js");
        await saveMemoryDatabaseToFile();
      } catch (saveError) {
        authLogger.error(
          "Failed to persist admin promotion to disk",
          saveError,
          {
            operation: "make_admin_save_failed",
            userId: targetUser[0].id,
            username: targetUser[0].username,
          },
        );
      }

      authLogger.info("Admin privileges granted", {
        operation: "admin_grant",
        adminId: userId,
        targetUserId: targetUser[0].id,
        targetUsername: targetUser[0].username,
      });
      res.json({ message: `User ${targetUser[0].username} is now an admin` });
    } catch (err) {
      authLogger.error("Failed to make user admin", err);
      res.status(500).json({ error: "Failed to make user admin" });
    }
  });

  /**
   * @openapi
   * /users/{id}/mxid:
   *   post:
   *     summary: Register a Matrix mxid against a Skynet user
   *     description: |
   *       Phase 75 Plan 03 (MXA-04). Admin-gated endpoint that maps a Skynet
   *       user row to an externally-created Matrix relay account by writing
   *       the mxid to `users.mxid`. Serves both the new-user provisioning
   *       runbook (one POST per new user) and the one-shot import for the
   *       three pre-existing hand-made accounts (user, Zoe, Laura).
   *
   *       The mxid is validated against `MXID_RE` (Matrix spec-compliant:
   *       lowercase localpart, hostname-shaped server_name, 512-char cap)
   *       BEFORE any DB touch — invalid mxids return 400 without side effects.
   *
   *       Audit log includes `previousMxid` (the value being overwritten,
   *       null on first set) so accidental overwrites are grep-recoverable
   *       from the central log. This is what makes T-75-12 an acceptable
   *       risk rather than a MITIGATE-required threat.
   *     tags:
   *       - Users
   *       - Matrix
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: The Skynet user id (users.id).
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [mxid]
   *             properties:
   *               mxid:
   *                 type: string
   *                 description: |
   *                   Matrix user id shaped `@localpart:server_name`.
   *                   Localpart must be lowercase per Matrix spec.
   *                 example: "@ashley:t1000.taild9b663.ts.net"
   *     responses:
   *       200:
   *         description: mxid registered. `{ ok: true }`.
   *       400:
   *         description: mxid missing / wrong type / regex mismatch.
   *       401:
   *         description: Missing or invalid JWT.
   *       403:
   *         description: Caller is not admin.
   *       404:
   *         description: Target user id does not exist.
   *       500:
   *         description: Failed to register mxid.
   */
  router.post("/:id/mxid", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    // Express types req.params[key] as `string | string[]` (legacy wildcards).
    // Drizzle's eq() only accepts `string | SQLWrapper`, so narrow at the
    // handler boundary. Under strict tsconfig.node.json, this cast is required.
    const targetId = req.params.id as string;
    const { mxid } = req.body ?? {};

    // T-75-10 mitigation: regex-gate BEFORE any DB touch, URL construction,
    // or shell interpolation. Precedent: Phase 69's IDENTITY_KEY_RE
    // post-review security fix. Bad shape → 400 with no side effects.
    if (typeof mxid !== "string" || !MXID_RE.test(mxid)) {
      return res
        .status(400)
        .json({ error: "mxid must match @localpart:server_name" });
    }

    try {
      // T-75-11 defense-in-depth: authenticateJWT middleware already verified
      // the session, but admin-status is re-verified here per the sibling
      // POST /make-admin precedent (user-admin-routes.ts:152-158). Consistent
      // with every other admin-gated handler in this file.
      const adminUser = await db
        .select()
        .from(users)
        .where(eq(users.id, userId));
      if (!adminUser || adminUser.length === 0 || !adminUser[0].isAdmin) {
        return res.status(403).json({ error: "Not authorized" });
      }

      // Target existence check + previousMxid capture in one SELECT.
      // previousMxid captured BEFORE the UPDATE so the audit log records the
      // full state transition (from → to), not just the destination. This is
      // the T-75-12 accept-risk mitigation: any accidental overwrite is
      // grep-recoverable from the log.
      const targetUser = await db
        .select()
        .from(users)
        .where(eq(users.id, targetId))
        .limit(1);
      if (!targetUser || targetUser.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }
      const previousMxid: string | null = targetUser[0].mxid ?? null;

      // Drizzle parameterized UPDATE (T-75-10 mitigation — never string-concat).
      await db.update(users).set({ mxid }).where(eq(users.id, targetId));

      // Persist RAM→disk. Wrapped in try/catch + non-fatal warn per the
      // sibling make-admin precedent (L186-199) and host-autostart-routes.ts
      // L173-181. saveMemoryDatabaseToFile may fail on first-boot races
      // (trigger not yet initialized) — the UPDATE above is durable in RAM
      // and will land on disk on the next mutation-driven save.
      try {
        const { saveMemoryDatabaseToFile } = await import("../db/index.js");
        await saveMemoryDatabaseToFile();
      } catch (saveError) {
        authLogger.error(
          "Failed to persist mxid registration to disk",
          saveError,
          {
            operation: "mxid_save_failed",
            targetId,
          },
        );
      }

      // T-75-14 mitigation: audit trail with the full state transition. The
      // previousMxid field is what makes T-75-12 (replay-overwrite) an
      // acceptable risk rather than a MITIGATE-required one — any accidental
      // overwrite is grep-recoverable from the central log. previousMxid is
      // ALWAYS present in the log line (null on first-set, quoted string on
      // overwrite) so grep-forensics tooling can rely on the shape.
      authLogger.info("mxid registered for user", {
        operation: "mxid_register",
        adminId: userId,
        targetUserId: targetUser[0].id,
        previousMxid,
        mxid,
      });
      res.json({ ok: true });
    } catch (err) {
      authLogger.error("Failed to register mxid", err);
      res.status(500).json({ error: "Failed to register mxid" });
    }
  });

  /**
   * @openapi
   * /users/{id}/phone:
   *   post:
   *     summary: Set a user's E.164 phone number (admin only)
   *     description: |
   *       Sets the E.164-formatted phone number on a user record. Consumed by
   *       the agent-phone capability — the phone-call-requests worker looks
   *       this up when an agent drops a call request. Nullable in the schema
   *       (users without a number get a "no_phone_on_file" outcome from the
   *       worker); this endpoint sets it, does not clear it. This is the
   *       only way to grant the feature — users can change or clear their
   *       own number from Preferences (/users/me/phone) but cannot add one.
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
   *             properties:
   *               phoneE164:
   *                 type: string
   *                 pattern: '^\+[1-9]\d{7,14}$'
   *                 example: '+17167871388'
   *     responses:
   *       200:
   *         description: Phone number set.
   *       400:
   *         description: phoneE164 missing or not E.164-shaped.
   *       403:
   *         description: Not authorized.
   *       404:
   *         description: User not found.
   *       500:
   *         description: Failed to set phone number.
   */
  router.post("/:id/phone", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const targetId = req.params.id as string;
    const { phoneE164 } = req.body ?? {};

    // Shape gate BEFORE any DB touch (same discipline as MXID_RE above).
    if (typeof phoneE164 !== "string" || !PHONE_E164_RE.test(phoneE164)) {
      return res
        .status(400)
        .json({ error: "phoneE164 must match E.164 format (e.g. +17167871388)" });
    }

    try {
      // Defense-in-depth admin re-check per the sibling POST /:id/mxid
      // precedent — authenticateJWT already validated the session; this
      // second check confirms admin status at the handler boundary.
      const adminUser = await db
        .select()
        .from(users)
        .where(eq(users.id, userId));
      if (!adminUser || adminUser.length === 0 || !adminUser[0].isAdmin) {
        return res.status(403).json({ error: "Not authorized" });
      }

      // Capture previousPhone BEFORE the UPDATE so the audit log records the
      // full state transition (matches the mxid audit-trail pattern).
      const targetUser = await db
        .select()
        .from(users)
        .where(eq(users.id, targetId))
        .limit(1);
      if (!targetUser || targetUser.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }
      const previousPhone: string | null = targetUser[0].phoneE164 ?? null;

      await db
        .update(users)
        .set({ phoneE164 })
        .where(eq(users.id, targetId));

      // Persist RAM→disk. Wrapped in try/catch + non-fatal warn per the
      // sibling mxid endpoint precedent — a save failure leaves the write
      // durable in RAM and it lands on disk on the next mutation.
      try {
        const { saveMemoryDatabaseToFile } = await import("../db/index.js");
        await saveMemoryDatabaseToFile();
      } catch (saveError) {
        authLogger.error(
          "Failed to persist phone number update to disk",
          saveError,
          {
            operation: "user_phone_save_failed",
            targetId,
          },
        );
      }

      // Audit log records the transition without the digits themselves —
      // phone numbers are personal data and shouldn't sit in log grep.
      // previousPhoneSet distinguishes first-set from overwrite, which is
      // the only forensic bit an admin actually needs.
      authLogger.info("phone_e164 set for user", {
        operation: "user_phone_set",
        adminId: userId,
        targetUserId: targetUser[0].id,
        previousPhoneSet: previousPhone !== null,
        newPhoneSet: true,
      });
      res.json({ ok: true });
    } catch (err) {
      authLogger.error("Failed to set phone number", err);
      res.status(500).json({ error: "Failed to set phone number" });
    }
  });

  /**
   * @openapi
   * /users/{id}/notifications-enabled:
   *   post:
   *     summary: Grant or revoke push notifications for a user (admin only)
   *     description: |
   *       Sets users.notifications_enabled. Push notifications (Preferences →
   *       Notifications, /push-subscriptions/*, and delivery itself) are off
   *       unless this is set; admins always have access regardless. Revoking
   *       stops delivery immediately but leaves any existing ntfy setup in
   *       place, so re-granting resumes it without re-setup.
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
   *             properties:
   *               enabled:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: Flag updated.
   *       400:
   *         description: enabled missing or not a boolean.
   *       403:
   *         description: Not authorized.
   *       404:
   *         description: User not found.
   *       500:
   *         description: Failed to update the flag.
   */
  router.post("/:id/notifications-enabled", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const targetId = req.params.id as string;
    const { enabled } = req.body ?? {};

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be a boolean" });
    }

    try {
      const adminUser = await db
        .select()
        .from(users)
        .where(eq(users.id, userId));
      if (!adminUser || adminUser.length === 0 || !adminUser[0].isAdmin) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const targetUser = await db
        .select()
        .from(users)
        .where(eq(users.id, targetId))
        .limit(1);
      if (!targetUser || targetUser.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      await db
        .update(users)
        .set({ notificationsEnabled: enabled })
        .where(eq(users.id, targetId));

      try {
        const { saveMemoryDatabaseToFile } = await import("../db/index.js");
        await saveMemoryDatabaseToFile();
      } catch (saveError) {
        authLogger.error(
          "Failed to persist notifications flag update to disk",
          saveError,
          {
            operation: "user_notifications_flag_save_failed",
            targetId,
          },
        );
      }

      authLogger.info("notifications_enabled set for user", {
        operation: "user_notifications_flag_set",
        adminId: userId,
        targetUserId: targetUser[0].id,
        previous: !!targetUser[0].notificationsEnabled,
        enabled,
      });
      res.json({ ok: true, enabled });
    } catch (err) {
      authLogger.error("Failed to set notifications flag", err);
      res.status(500).json({ error: "Failed to set notifications flag" });
    }
  });

  /**
   * @openapi
   * /users/remove-admin:
   *   post:
   *     summary: Remove admin status
   *     description: Revokes admin privileges from a user.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               userId:
   *                 type: string
   *                 description: Preferred unique user identifier.
   *               username:
   *                 type: string
   *                 description: Legacy fallback identifier.
   *     responses:
   *       200:
   *         description: Admin status removed from user.
   *       400:
   *         description: User ID or username is required, or cannot remove your own admin status.
   *       403:
   *         description: Not authorized.
   *       404:
   *         description: User not found.
   *       500:
   *         description: Failed to remove admin status.
   */
  router.post("/remove-admin", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { userId: targetUserId, username } = req.body;
    const resolvedUserId = isNonEmptyString(targetUserId)
      ? targetUserId.trim()
      : null;
    const resolvedUsername = isNonEmptyString(username)
      ? username.trim()
      : null;

    if (!resolvedUserId && !resolvedUsername) {
      return res.status(400).json({ error: "User ID or username is required" });
    }

    try {
      const adminUser = await db
        .select()
        .from(users)
        .where(eq(users.id, userId));
      if (!adminUser || adminUser.length === 0 || !adminUser[0].isAdmin) {
        return res.status(403).json({ error: "Not authorized" });
      }

      if (
        (resolvedUserId && adminUser[0].id === resolvedUserId) ||
        (resolvedUsername && adminUser[0].username === resolvedUsername)
      ) {
        return res
          .status(400)
          .json({ error: "Cannot remove your own admin status" });
      }

      const targetUser = await db
        .select()
        .from(users)
        .where(
          resolvedUserId
            ? eq(users.id, resolvedUserId)
            : eq(users.username, resolvedUsername!),
        )
        .limit(1);
      if (!targetUser || targetUser.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      if (!targetUser[0].isAdmin) {
        return res.status(400).json({ error: "User is not an admin" });
      }

      await db
        .update(users)
        .set({ isAdmin: false })
        .where(
          resolvedUserId
            ? eq(users.id, resolvedUserId)
            : eq(users.username, resolvedUsername!),
        );

      try {
        const { saveMemoryDatabaseToFile } = await import("../db/index.js");
        await saveMemoryDatabaseToFile();
      } catch (saveError) {
        authLogger.error("Failed to persist admin removal to disk", saveError, {
          operation: "remove_admin_save_failed",
          userId: targetUser[0].id,
          username: targetUser[0].username,
        });
      }

      authLogger.info("Admin privileges revoked", {
        operation: "admin_revoke",
        adminId: userId,
        targetUserId: targetUser[0].id,
        targetUsername: targetUser[0].username,
      });
      res.json({
        message: `Admin status removed from ${targetUser[0].username}`,
      });
    } catch (err) {
      authLogger.error("Failed to remove admin status", err);
      res.status(500).json({ error: "Failed to remove admin status" });
    }
  });
}
