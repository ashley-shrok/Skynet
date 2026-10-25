import type { AuthenticatedRequest } from "../../../types/index.js";
import type { RequestHandler, Router } from "express";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import speakeasy from "speakeasy";
import { AuthManager } from "../../utils/auth-manager.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import { LazyFieldEncryption } from "../../utils/lazy-field-encryption.js";
import { authLogger } from "../../utils/logger.js";
import { loginRateLimiter } from "../../utils/login-rate-limiter.js";
import {
  RECENT_AUTH_WINDOW_MS,
  REAUTH_UNAVAILABLE,
} from "../../utils/recent-auth.js";
import { db } from "../db/index.js";
import { sessions, users } from "../db/schema.js";

interface UserConfirmIdentityRoutesDeps {
  authenticateJWT: RequestHandler;
  authManager: AuthManager;
}

// The last code time-step accepted here, per user — a code that already
// confirmed once can't confirm again.
const lastAcceptedStep = new Map<string, number>();

type CodeCheck = "ok" | "wrong" | "unreadable";

/** Accepts a current code (once) or an unused backup code (consuming it). */
async function checkTwoStepCode(
  userRecord: typeof users.$inferSelect,
  code: string,
  authManager: AuthManager,
): Promise<CodeCheck> {
  const dataKey = authManager.getUserDataKey(userRecord.id);
  if (!dataKey || !userRecord.totpSecret) return "unreadable";
  const secret = LazyFieldEncryption.safeGetFieldValue(
    userRecord.totpSecret,
    dataKey,
    userRecord.id,
    "totp_secret",
  );
  if (!secret) return "unreadable";
  const delta = speakeasy.totp.verifyDelta({
    secret,
    encoding: "base32",
    token: code,
    window: 2,
  });
  if (delta) {
    const step = Math.floor(Date.now() / 30_000) + delta.delta;
    if ((lastAcceptedStep.get(userRecord.id) ?? -Infinity) >= step) {
      return "wrong";
    }
    lastAcceptedStep.set(userRecord.id, step);
    return "ok";
  }

  let backupCodes: unknown = [];
  try {
    backupCodes = userRecord.totpBackupCodes
      ? JSON.parse(userRecord.totpBackupCodes)
      : [];
  } catch {
    backupCodes = [];
  }
  if (!Array.isArray(backupCodes)) return "wrong";
  const index = backupCodes.indexOf(code);
  if (index === -1) return "wrong";
  backupCodes.splice(index, 1);
  await db
    .update(users)
    .set({ totpBackupCodes: JSON.stringify(backupCodes) })
    .where(eq(users.id, userRecord.id));
  return "ok";
}

export function registerUserConfirmIdentityRoutes(
  router: Router,
  { authenticateJWT, authManager }: UserConfirmIdentityRoutesDeps,
): void {
  /**
   * @openapi
   * /users/confirm-identity:
   *   post:
   *     summary: Confirm it's you
   *     description: >-
   *       Re-proves the current browser session with the account password and,
   *       when two-step codes are on, a current or backup code. Sensitive
   *       actions then work for the next 10 minutes. A fresh sign-in already
   *       counts as confirmed. Access keys can't confirm.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               password:
   *                 type: string
   *               totpCode:
   *                 type: string
   *     responses:
   *       200:
   *         description: Confirmed; returns when the confirmation runs out.
   *       400:
   *         description: Password (or code) missing.
   *       401:
   *         description: Wrong password or code.
   *       403:
   *         description: This caller can't confirm (access key, no session, SSO-only account).
   *       429:
   *         description: Too many attempts.
   */
  router.post("/confirm-identity", authenticateJWT, async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;
    const sessionId = authReq.sessionId;
    const { password, totpCode } = (req.body ?? {}) as {
      password?: unknown;
      totpCode?: unknown;
    };

    if (!userId || !sessionId) {
      return res.status(403).json({
        error: "Only a signed-in browser session can confirm it's you.",
        code: REAUTH_UNAVAILABLE,
      });
    }

    try {
      const [userRecord] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!userRecord) {
        return res.status(404).json({ error: "User not found" });
      }

      const hasPassword =
        !!userRecord.passwordHash && userRecord.passwordHash.trim() !== "";
      if (userRecord.isOidc && !hasPassword) {
        authLogger.warn("Identity confirmation refused for SSO-only account", {
          operation: "confirm_identity_sso_refused",
          userId,
          sessionId,
        });
        return res.status(403).json({
          error: "Accounts that sign in only through SSO can't confirm here.",
          code: REAUTH_UNAVAILABLE,
        });
      }

      if (typeof password !== "string" || password.length === 0) {
        return res.status(400).json({ error: "Password is required" });
      }
      const needsCode = !!userRecord.totpEnabled;
      if (needsCode && (typeof totpCode !== "string" || totpCode.trim() === "")) {
        return res.status(400).json({ error: "Two-step code is required" });
      }

      const clientIp = req.ip || req.socket.remoteAddress || "unknown";
      const lock = loginRateLimiter.isLocked(clientIp, userRecord.username);
      const totpLock = loginRateLimiter.isTOTPLocked(userId);
      if (lock.locked || totpLock.locked) {
        const remainingTime = lock.remainingTime ?? totpLock.remainingTime;
        authLogger.warn("Identity confirmation rate limited", {
          operation: "confirm_identity_rate_limited",
          userId,
          sessionId,
          remainingTime,
        });
        return res.status(429).json({
          error: `Too many attempts. Please wait ${remainingTime} seconds and try again.`,
          remainingTime,
        });
      }

      if (!(await bcrypt.compare(password, userRecord.passwordHash))) {
        loginRateLimiter.recordFailedAttempt(clientIp, userRecord.username);
        authLogger.warn("Identity confirmation failed: wrong password", {
          operation: "confirm_identity_bad_password",
          userId,
          sessionId,
        });
        return res.status(401).json({ error: "Incorrect password" });
      }

      const codeCheck: CodeCheck = needsCode
        ? await checkTwoStepCode(userRecord, (totpCode as string).trim(), authManager)
        : "ok";
      if (codeCheck === "unreadable") {
        authLogger.warn("Identity confirmation failed: two-step secret unreadable", {
          operation: "confirm_identity_secret_unreadable",
          userId,
          sessionId,
        });
        return res.status(409).json({
          error: "Your two-step codes can't be checked right now. Sign out and sign in again.",
        });
      }
      if (codeCheck === "wrong") {
        loginRateLimiter.recordFailedTOTPAttempt(userId);
        authLogger.warn("Identity confirmation failed: wrong code", {
          operation: "confirm_identity_bad_code",
          userId,
          sessionId,
        });
        return res.status(401).json({ error: "Invalid two-step code" });
      }

      const now = new Date();
      await db
        .update(sessions)
        .set({ confirmedAt: now.toISOString() })
        .where(eq(sessions.id, sessionId));
      try {
        await DatabaseSaveTrigger.forceSave("confirm-identity");
      } catch (saveError) {
        authLogger.warn("Failed to persist identity confirmation", {
          operation: "confirm_identity_save_failed",
          sessionId,
          error: saveError instanceof Error ? saveError.message : String(saveError),
        });
      }

      loginRateLimiter.resetAttempts(clientIp, userRecord.username);
      loginRateLimiter.resetTOTPAttempts(userId);

      authLogger.success("Identity confirmed", {
        operation: "confirm_identity_ok",
        userId,
        sessionId,
      });
      return res.json({
        confirmed: true,
        confirmedUntil: new Date(now.getTime() + RECENT_AUTH_WINDOW_MS).toISOString(),
      });
    } catch (error) {
      authLogger.error("Identity confirmation failed", error, {
        operation: "confirm_identity_error",
        userId,
        sessionId,
      });
      return res.status(500).json({ error: "Could not confirm identity" });
    }
  });
}
