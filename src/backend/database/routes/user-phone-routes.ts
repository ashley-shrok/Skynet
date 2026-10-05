/**
 * agent-phone — self-service phone number routes for the Preferences modal.
 *
 * Access model: having a number on file IS the feature flag. An admin grants
 * the feature by setting a number via POST /users/:id/phone; after that the
 * user can change or clear their own number here. A user with no number on
 * file gets 403 from both mutating endpoints, so these routes can never be
 * used to opt in. Clearing is allowed but one-way — once cleared, only an
 * admin can re-enable it.
 *
 *   GET    /users/me/phone  → { phoneE164: string | null }
 *   PUT    /users/me/phone  → { ok: true, phoneE164 }   (body: { phoneE164 })
 *   DELETE /users/me/phone  → { ok: true }
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import type { RequestHandler, Router } from "express";
import { and, eq, isNotNull } from "drizzle-orm";
import { authLogger } from "../../utils/logger.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { PHONE_E164_RE } from "./user-admin-routes.js";

async function persistToDisk(userId: string): Promise<void> {
  // Same non-fatal save as the admin phone endpoint — a failed save leaves
  // the write in RAM and it lands on disk with the next mutation.
  try {
    const { saveMemoryDatabaseToFile } = await import("../db/index.js");
    await saveMemoryDatabaseToFile();
  } catch (saveError) {
    authLogger.error("Failed to persist phone number update to disk", saveError, {
      operation: "user_phone_self_save_failed",
      userId,
    });
  }
}

async function getPhoneOnFile(userId: string): Promise<string | null | undefined> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!rows || rows.length === 0) return undefined;
  return rows[0].phoneE164 ?? null;
}

export function registerUserPhoneRoutes(
  router: Router,
  authenticateJWT: RequestHandler,
): void {
  /**
   * @openapi
   * /users/me/phone:
   *   get:
   *     summary: Get the current user's phone number
   *     description: Returns the caller's E.164 phone number, or null when the agent-phone feature is not enabled for them.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: The caller's phone number (nullable).
   *       404:
   *         description: User not found.
   */
  router.get("/me/phone", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const phoneE164 = await getPhoneOnFile(userId);
      if (phoneE164 === undefined) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json({ phoneE164 });
    } catch (err) {
      authLogger.error("Failed to get phone number", err);
      res.status(500).json({ error: "Failed to get phone number" });
    }
  });

  /**
   * @openapi
   * /users/me/phone:
   *   put:
   *     summary: Change the current user's phone number
   *     description: Replaces the caller's E.164 phone number. Only allowed when a number is already on file — users cannot add a number themselves.
   *     tags:
   *       - Users
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
   *     responses:
   *       200:
   *         description: Phone number changed.
   *       400:
   *         description: phoneE164 missing or not E.164-shaped.
   *       403:
   *         description: No phone number on file (feature not enabled).
   *       404:
   *         description: User not found.
   */
  router.put("/me/phone", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { phoneE164 } = req.body ?? {};

    if (typeof phoneE164 !== "string" || !PHONE_E164_RE.test(phoneE164)) {
      return res
        .status(400)
        .json({ error: "phoneE164 must match E.164 format (e.g. +17167871388)" });
    }

    try {
      const current = await getPhoneOnFile(userId);
      if (current === undefined) {
        return res.status(404).json({ error: "User not found" });
      }
      if (current === null) {
        return res
          .status(403)
          .json({ error: "Phone is not enabled for this account" });
      }

      // isNotNull in the WHERE keeps the gate atomic: if the number was
      // cleared between the read above and this write, nothing is set.
      await db
        .update(users)
        .set({ phoneE164 })
        .where(and(eq(users.id, userId), isNotNull(users.phoneE164)));
      await persistToDisk(userId);

      // No digits in the log — phone numbers are personal data.
      authLogger.info("phone_e164 changed by user", {
        operation: "user_phone_self_change",
        userId,
      });
      res.json({ ok: true, phoneE164 });
    } catch (err) {
      authLogger.error("Failed to change phone number", err);
      res.status(500).json({ error: "Failed to change phone number" });
    }
  });

  /**
   * @openapi
   * /users/me/phone:
   *   delete:
   *     summary: Clear the current user's phone number
   *     description: Removes the caller's phone number, disabling the agent-phone feature. Only an admin can re-enable it.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Phone number cleared.
   *       403:
   *         description: No phone number on file.
   *       404:
   *         description: User not found.
   */
  router.delete("/me/phone", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const current = await getPhoneOnFile(userId);
      if (current === undefined) {
        return res.status(404).json({ error: "User not found" });
      }
      if (current === null) {
        return res
          .status(403)
          .json({ error: "Phone is not enabled for this account" });
      }

      await db
        .update(users)
        .set({ phoneE164: null })
        .where(eq(users.id, userId));
      await persistToDisk(userId);

      authLogger.info("phone_e164 cleared by user", {
        operation: "user_phone_self_clear",
        userId,
      });
      res.json({ ok: true });
    } catch (err) {
      authLogger.error("Failed to clear phone number", err);
      res.status(500).json({ error: "Failed to clear phone number" });
    }
  });
}
