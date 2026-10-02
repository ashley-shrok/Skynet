/**
 * Phase 144 Plan 02 Task 3 — ntfy push-subscriptions router (rebuilt).
 *
 * Replaces the Phase 128 browser-push subscription CRUD with the new
 * ntfy setup/test/regenerate/delete API.
 *
 * ## Endpoints
 *
 *   GET  /ntfy-setup       — Return setup state for the authenticated user.
 *                            {isSetUp:false} if no row; {isSetUp:true, serverAddress,
 *                            topicName, readingCredential, ntfyUsername} if setup.
 *
 *   POST /ntfy-setup       — Idempotent provision. Creates ntfy user + ACL + token
 *                            on first call. Returns existing setup shape on re-call.
 *
 *   POST /ntfy-test        — Publish a test notification to the user's topic via
 *                            sendPushToUser. Returns {ok:true} or 500 {error:...}.
 *
 *   POST /ntfy-regenerate  — Revoke old token via ntfy admin API, mint new token,
 *                            update DB, return new setup shape. MC-4: reads
 *                            ntfy_username from the stored DB row.
 *
 *   DELETE /ntfy-setup     — Delete ntfy user + revoke ACL + drop DB row. MC-4:
 *                            reads ntfy_username from the stored DB row, NOT
 *                            reconstructed from userId.
 *
 * ## Security discipline
 *   - All endpoints require JWT auth (authenticateJWT middleware — T-144-08).
 *   - userId is sourced from the JWT-verified AuthenticatedRequest, NEVER from
 *     req.body (same invariant as Phase 128 Phase-128-21 mitigation).
 *   - NtfyAdminError caught and returned as generic 500 {error:...} — no
 *     credential leakage in error responses (T-144-07 mitigation).
 *   - reading_credential encrypted via FieldCrypto (T-144-06 mitigation).
 *
 * ## MC-4 fix (plan-checker flag)
 *   DELETE and REGENERATE handlers SELECT ntfy_username from the stored DB row
 *   before calling ntfy admin API. The stored value is the single source of
 *   truth — it may differ from the pattern "skynet-reader-" + userId if the
 *   row was inserted by an older code path or manually adjusted. Using the
 *   stored value prevents orphaned ntfy users on delete.
 *
 * ## HC-1 note
 *   ensureSkynetPublisherUserExists in ntfy-bootstrap.ts is belt-and-suspenders;
 *   the primary publisher provisioning is docker/ntfy/server.yml at compose up.
 *
 * ## /vapid-public-key
 *   Deliberately NOT mounted. The GET /vapid-public-key endpoint from Phase 128
 *   is removed here; plan 04 handles any residual VAPID file cleanup.
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { db, DatabaseSaveTrigger } from "../db/index.js";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { FieldCrypto } from "../../utils/field-crypto.js";
import { getNtfyBaseUrl } from "../../notifications/ntfy-config.js";
import {
  createNtfyUser,
  deleteNtfyUser,
  grantTopicReadAccess,
  revokeTopicAccess,
  mintUserToken,
  NtfyAdminError,
} from "../../notifications/ntfy-admin-client.js";
import { sendPushToUser } from "../../notifications/ntfy-sender.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PushSubscriptionRow {
  id: string;
  user_id: string;
  topic_name: string;
  reading_credential: string; // encrypted via FieldCrypto
  ntfy_username: string;
  created_at: string;
}

interface NtfySetupResponse {
  isSetUp: boolean;
  serverAddress?: string;
  topicName?: string;
  readingCredential?: string; // decrypted
  ntfyUsername?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the ntfy setup response shape for the given user.
 * Returns {isSetUp:false} if no row; decrypts reading_credential via FieldCrypto
 * and returns {isSetUp:true, ...} if row exists.
 *
 * MC-4: ntfyUsername is READ from the stored ntfy_username column — never
 * reconstructed from userId.
 */
function buildSetupResponse(
  row: PushSubscriptionRow | undefined,
  userId: string,
): NtfySetupResponse {
  if (!row) {
    return { isSetUp: false };
  }

  // Decrypt the reading_credential via FieldCrypto.
  // Uses the user's data key — DataCrypto.validateUserAccess throws if user
  // data is not unlocked, but in practice all authenticated requests have
  // unlocked user data by the time routes are reached.
  const userDataKey = DataCrypto.validateUserAccess(userId);
  const decryptedCredential = FieldCrypto.decryptField(
    row.reading_credential,
    userDataKey,
    row.id,
    "reading_credential",
  );

  return {
    isSetUp: true,
    serverAddress: getNtfyBaseUrl(),
    topicName: row.topic_name,
    readingCredential: decryptedCredential,
    // MC-4 fix: ntfyUsername is READ from the DB row, not reconstructed from userId.
    ntfyUsername: row.ntfy_username,
  };
}

/**
 * Read the push_subscriptions row for the given userId.
 * Returns undefined if no row exists.
 */
function getSubscriptionRow(userId: string): PushSubscriptionRow | undefined {
  return db.$client
    .prepare("SELECT id, user_id, topic_name, reading_credential, ntfy_username, created_at FROM push_subscriptions WHERE user_id = ?")
    .get(userId) as PushSubscriptionRow | undefined;
}

// ---------------------------------------------------------------------------
// Core handlers (exported for direct unit-test invocation)
// ---------------------------------------------------------------------------

/**
 * GET /ntfy-setup handler.
 *
 * Returns the current ntfy setup state for the authenticated user.
 * No ntfy API calls — reads from DB only.
 */
export async function handleGetNtfySetup(
  userId: string,
  res: Response,
): Promise<Response> {
  const row = getSubscriptionRow(userId);
  return res.status(200).json(buildSetupResponse(row, userId));
}

/**
 * POST /ntfy-setup handler.
 *
 * Idempotent provision. If a row already exists, returns the existing setup
 * shape without making any ntfy API calls. On first call, creates:
 *   1. A ntfy user: "skynet-reader-<userId>" with a random password
 *   2. ACL: grants that user ro access to the user's topic
 *   3. A token: minted for that user (stored as reading_credential)
 *
 * The ntfy_username stored at creation time is the computed value
 * "skynet-reader-<userId>" — subsequent DELETE/REGENERATE reads it back
 * from the DB (MC-4: never reconstructs from userId at use-time).
 *
 * Credential generation follows RESEARCH.md Pattern 4:
 *   - topicName: randomBytes(16).toString("hex") — 32-char hex, 128-bit entropy
 *   - readerPassword: randomBytes(16).toString("hex") — 32-char hex
 *   (The token returned by mintUserToken has the "tk_..." prefix from ntfy)
 */
export async function handlePostNtfySetup(
  userId: string,
  res: Response,
): Promise<Response> {
  const existing = getSubscriptionRow(userId);
  if (existing) {
    // Idempotent: return existing setup shape.
    return res.status(200).json(buildSetupResponse(existing, userId));
  }

  // Generate credentials.
  const topicName = randomBytes(16).toString("hex"); // 32-char hex
  const readerPassword = randomBytes(16).toString("hex"); // 32-char hex
  const ntfyUsername = `skynet-reader-${userId}`;

  try {
    // Step 1: Create the ntfy user.
    await createNtfyUser(ntfyUsername, readerPassword);
  } catch (err) {
    if (err instanceof NtfyAdminError) {
      databaseLogger.warn("[ntfy] setup: create user failed", {
        operation: "ntfy_setup_create_user_failed",
        userId,
        status: err.status,
      });
      return res.status(500).json({ error: "ntfy admin error" });
    }
    throw err;
  }

  try {
    // Step 2: Grant the user ro access to their topic.
    await grantTopicReadAccess(ntfyUsername, topicName);
  } catch (err) {
    if (err instanceof NtfyAdminError) {
      databaseLogger.warn("[ntfy] setup: grant access failed", {
        operation: "ntfy_setup_grant_access_failed",
        userId,
        status: err.status,
      });
      return res.status(500).json({ error: "ntfy admin error" });
    }
    throw err;
  }

  let readingToken: string;
  try {
    // Step 3: Mint a token for the user (per-user Basic auth via ntfy-admin-client).
    readingToken = await mintUserToken(ntfyUsername, readerPassword);
  } catch (err) {
    if (err instanceof NtfyAdminError) {
      databaseLogger.warn("[ntfy] setup: mint token failed", {
        operation: "ntfy_setup_mint_token_failed",
        userId,
        status: err.status,
      });
      return res.status(500).json({ error: "ntfy admin error" });
    }
    throw err;
  }

  // Encrypt the reading credential via FieldCrypto.
  const rowId = randomUUID();
  const userDataKey = DataCrypto.validateUserAccess(userId);
  const encryptedCredential = FieldCrypto.encryptField(
    readingToken,
    userDataKey,
    rowId,
    "reading_credential",
  );

  // Insert the DB row.
  db.$client
    .prepare(
      "INSERT INTO push_subscriptions (id, user_id, topic_name, reading_credential, ntfy_username) VALUES (?, ?, ?, ?, ?)",
    )
    .run(rowId, userId, topicName, encryptedCredential, ntfyUsername);

  try {
    await DatabaseSaveTrigger.forceSave("ntfy-setup-provision");
  } catch (saveErr) {
    databaseLogger.warn("[ntfy] setup: forceSave failed (non-fatal — write in RAM)", {
      operation: "ntfy_setup_force_save_failed",
      userId,
      error: saveErr instanceof Error ? saveErr.message : "unknown",
    });
  }

  // Build the response from the freshly inserted row (re-read from DB).
  const newRow = getSubscriptionRow(userId);
  return res.status(200).json(buildSetupResponse(newRow, userId));
}

/**
 * POST /ntfy-test handler.
 *
 * Publishes a canned test notification to the user's ntfy topic via
 * sendPushToUser. The test notification uses agentHostId: null (no specific
 * agent host to navigate to — it's a system ping). buildClickUrl handles
 * null by omitting the host= query param (HC-4).
 */
export async function handlePostNtfyTest(
  userId: string,
  res: Response,
): Promise<Response> {
  try {
    await sendPushToUser(userId, {
      title: "Skynet test notification",
      body: "Setup is working — tap to dismiss",
      agentMxid: "@system:skynet",
      agentHostId: null,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    databaseLogger.warn("[ntfy] test notification failed", {
      operation: "ntfy_test_notification_failed",
      userId,
      error: err instanceof Error ? err.message : "unknown",
    });
    return res.status(500).json({
      error: err instanceof Error ? err.message : "test notification failed",
    });
  }
}

/**
 * POST /ntfy-regenerate handler.
 *
 * Hard credential rotation — revokes the old token and mints a new one.
 * MC-4 fix: reads ntfy_username from the stored DB row — does NOT reconstruct
 * as "skynet-reader-" + userId, which could differ for older rows.
 *
 * Inline comment: "MC-4 fix: ntfy_username is READ from the DB row, not
 * reconstructed from userId."
 */
export async function handlePostNtfyRegenerate(
  userId: string,
  res: Response,
): Promise<Response> {
  // MC-4 fix: ntfy_username is READ from the DB row, not reconstructed from userId.
  const row = getSubscriptionRow(userId);
  if (!row) {
    return res.status(200).json({ isSetUp: false });
  }

  const ntfyUsername = row.ntfy_username; // MC-4: stored value, not reconstructed

  // Mint a new token (we need the user's password to auth, but we no longer
  // have it — use the admin API delete + recreate pattern instead).
  // Since we can't re-auth as the user without their password, we use the
  // admin API to delete the user and re-create them, then mint a token.
  // This is the correct rotation approach when the password is not stored.
  //
  // Simplified approach: delete the user (which invalidates all tokens),
  // recreate them with a new password, grant ACL again, mint a new token.
  const newPassword = randomBytes(16).toString("hex");

  try {
    // Revoke by deleting + recreating the user (all tokens invalidated).
    await deleteNtfyUser(ntfyUsername);
  } catch (err) {
    if (err instanceof NtfyAdminError) {
      databaseLogger.warn("[ntfy] regenerate: delete user failed", {
        operation: "ntfy_regenerate_delete_token_failed",
        userId,
        status: err.status,
      });
      return res.status(500).json({ error: "ntfy admin error" });
    }
    throw err;
  }

  try {
    await createNtfyUser(ntfyUsername, newPassword);
  } catch (err) {
    if (err instanceof NtfyAdminError) {
      databaseLogger.warn("[ntfy] regenerate: re-create user failed", {
        operation: "ntfy_regenerate_delete_token_failed",
        userId,
        status: err.status,
      });
      return res.status(500).json({ error: "ntfy admin error" });
    }
    throw err;
  }

  try {
    await grantTopicReadAccess(ntfyUsername, row.topic_name);
  } catch (err) {
    if (err instanceof NtfyAdminError) {
      databaseLogger.warn("[ntfy] regenerate: grant access failed", {
        operation: "ntfy_regenerate_delete_token_failed",
        userId,
        status: err.status,
      });
      return res.status(500).json({ error: "ntfy admin error" });
    }
    throw err;
  }

  let newToken: string;
  try {
    newToken = await mintUserToken(ntfyUsername, newPassword);
  } catch (err) {
    if (err instanceof NtfyAdminError) {
      databaseLogger.warn("[ntfy] regenerate: mint token failed", {
        operation: "ntfy_regenerate_delete_token_failed",
        userId,
        status: err.status,
      });
      return res.status(500).json({ error: "ntfy admin error" });
    }
    throw err;
  }

  // Encrypt the new token.
  const userDataKey = DataCrypto.validateUserAccess(userId);
  const encryptedNewToken = FieldCrypto.encryptField(
    newToken,
    userDataKey,
    row.id,
    "reading_credential",
  );

  // Update the DB row with the new encrypted credential.
  db.$client
    .prepare("UPDATE push_subscriptions SET reading_credential = ? WHERE user_id = ?")
    .run(encryptedNewToken, userId);

  try {
    await DatabaseSaveTrigger.forceSave("ntfy-regenerate");
  } catch (saveErr) {
    databaseLogger.warn("[ntfy] regenerate: forceSave failed (non-fatal)", {
      operation: "ntfy_regenerate_delete_token_failed",
      userId,
      error: saveErr instanceof Error ? saveErr.message : "unknown",
    });
  }

  // Build response from the updated row.
  const updatedRow = getSubscriptionRow(userId);
  return res.status(200).json(buildSetupResponse(updatedRow, userId));
}

/**
 * DELETE /ntfy-setup handler.
 *
 * Tears down the ntfy setup: revokes ACL, deletes the ntfy user, drops the DB row.
 * Idempotent — returns {isSetUp:false} if no row exists.
 *
 * MC-4 fix: reads ntfy_username from the stored DB row before deletion.
 * Does NOT reconstruct as "skynet-reader-" + userId — the stored value is the
 * single source of truth (T-144-24 mitigation).
 *
 * Inline comment: "MC-4 fix: ntfy_username is READ from the DB row, not
 * reconstructed from userId."
 */
export async function handleDeleteNtfySetup(
  userId: string,
  res: Response,
): Promise<Response> {
  // SELECT ntfy_username — MC-4 fix: read from DB row before deletion.
  const row = getSubscriptionRow(userId);
  if (!row) {
    // Idempotent — already deleted.
    return res.status(200).json({ isSetUp: false });
  }

  const ntfyUsername = row.ntfy_username; // MC-4 fix: ntfy_username is READ from the DB row, not reconstructed from userId.
  const topicName = row.topic_name;

  try {
    // Revoke ACL first, then delete the user.
    await revokeTopicAccess(ntfyUsername, topicName);
  } catch (err) {
    if (err instanceof NtfyAdminError) {
      databaseLogger.warn("[ntfy] delete setup: revoke access failed", {
        operation: "ntfy_delete_setup_failed",
        userId,
        status: err.status,
      });
      // Continue to deleteNtfyUser + DB delete even if ACL revoke fails.
    }
  }

  try {
    await deleteNtfyUser(ntfyUsername);
  } catch (err) {
    if (err instanceof NtfyAdminError) {
      databaseLogger.warn("[ntfy] delete setup: delete user failed", {
        operation: "ntfy_delete_setup_failed",
        userId,
        status: err.status,
      });
      return res.status(500).json({ error: "ntfy admin error" });
    }
    throw err;
  }

  // Drop the DB row.
  db.$client
    .prepare("DELETE FROM push_subscriptions WHERE user_id = ?")
    .run(userId);

  try {
    await DatabaseSaveTrigger.forceSave("ntfy-delete-setup");
  } catch (saveErr) {
    databaseLogger.warn("[ntfy] delete setup: forceSave failed (non-fatal)", {
      operation: "ntfy_delete_setup_failed",
      userId,
      error: saveErr instanceof Error ? saveErr.message : "unknown",
    });
  }

  return res.status(200).json({ isSetUp: false });
}

// ---------------------------------------------------------------------------
// Route wiring
// ---------------------------------------------------------------------------

router.get(
  "/ntfy-setup",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    return handleGetNtfySetup(userId, res);
  },
);

router.post(
  "/ntfy-setup",
  authenticateJWT,
  express.json({ limit: "8kb" }),
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    return handlePostNtfySetup(userId, res);
  },
);

router.post(
  "/ntfy-test",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    return handlePostNtfyTest(userId, res);
  },
);

router.post(
  "/ntfy-regenerate",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    return handlePostNtfyRegenerate(userId, res);
  },
);

router.delete(
  "/ntfy-setup",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    return handleDeleteNtfySetup(userId, res);
  },
);

// NOTE: GET /vapid-public-key is deliberately NOT mounted here.
// The Phase 128 endpoint is removed as part of the ntfy backend swap.
// Plan 04 handles any residual VAPID file/env cleanup; the route itself
// is unmounted here so the backend swap ships atomically.

export default router;
