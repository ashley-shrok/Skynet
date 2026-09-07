/**
 * Phase 79 Plan 03 Task 2 — /telegram/* Express routes.
 *
 * Four routes:
 *   POST /telegram/validate      — proxy /getMe to Telegram (auth: user)
 *   POST /telegram/activate      — write DB row + Plan 04 side-effects (auth: user + own-identity)
 *   POST /telegram/disconnect    — clear DB row + Plan 04 side-effects (auth: user + own-identity)
 *   GET  /telegram/:identityKey  — status view (auth: user)
 *
 * Shape mirrors src/backend/matrix/matrix-admin-routes.ts verbatim except:
 *   - user-auth (createAuthMiddleware) instead of admin-auth (createAdminMiddleware)
 *   - own-identity ownership check on activate + disconnect
 *   - activate + disconnect fire Plan 04's file writers + registry rewrite
 *     as awaited side-effects BEFORE the response is sent (blockers B-1 + B-2).
 *
 * Blocker rationale (per plan revision B-1 + B-2):
 *   Without writeBotTokenFile: bridge (Plan 05) reads .bottoken files to
 *   authenticate to Telegram. Skipping this write means the newly-activated
 *   bot has NO token file, and the bridge silently drops that agent.
 *   Without rewriteRegistryFromCurrentState: /state/registry.json stays
 *   stale until Skynet restart, and the bridge's inotifywait has nothing
 *   to react to. Both writes fire on the activate happy-path.
 *
 * Security invariants (per plan <threat_model>):
 *   T-79-03-02: regex-guard every body field; early-return 400 on mismatch.
 *   T-79-03-03: GET response NEVER includes bot token field.
 *   T-79-03-04: bot token NEVER logged; log {botUsername, identityKey} for context.
 *   T-79-03-07: identityKey regex-guarded at HTTP boundary AND by
 *               assertSafeHumanName inside shared-volume.ts path helpers.
 */
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../utils/auth-manager.js";
import { authLogger } from "../utils/logger.js";
import type { AuthenticatedRequest } from "../../types/index.js";
import {
  setTelegramBotToken,
  getTelegramBotToken,
  deleteTelegramBotToken,
} from "./tokens-store.js";
import { validateBotToken } from "./getme-proxy.js";
import {
  writeBotTokenFile,
  deleteBotTokenFile,
} from "./bot-token-file-writer.js";
import { rewriteRegistryFromCurrentState } from "./bridge-config-writer.js";

/** Telegram bot token shape: {bot_id 9-10 digits}:{35 chars A-Z a-z 0-9 _ -}. */
const TELEGRAM_BOT_TOKEN_RE = /^[0-9]{9,10}:[A-Za-z0-9_-]{35}$/;
/** Identity slug shape (matches shared-volume.assertSafeHumanName). */
const IDENTITY_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

// ---------------------------------------------------------------------------
// POST /telegram/validate
// ---------------------------------------------------------------------------

router.post(
  "/validate",
  express.json(),
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const { botToken } = (req.body ?? {}) as Record<string, unknown>;

    if (
      typeof botToken !== "string" ||
      !TELEGRAM_BOT_TOKEN_RE.test(botToken)
    ) {
      res
        .status(400)
        .json({ error: "botToken must match Telegram bot token shape" });
      return;
    }

    try {
      const result = await validateBotToken(botToken);
      res.json(result);
    } catch (err) {
      authLogger.error("Failed to validate telegram bot token", err);
      res.status(500).json({ error: "Failed to validate telegram bot token" });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /telegram/activate
// ---------------------------------------------------------------------------

router.post(
  "/activate",
  express.json(),
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const authUserId = (req as AuthenticatedRequest).userId;
    const { identityKey, botToken, humanUserId, telegramChatId } =
      (req.body ?? {}) as Record<string, unknown>;

    if (typeof identityKey !== "string" || !IDENTITY_KEY_RE.test(identityKey)) {
      res
        .status(400)
        .json({ error: "identityKey must match [a-z0-9][a-z0-9_-]{0,63}" });
      return;
    }
    if (
      typeof botToken !== "string" ||
      !TELEGRAM_BOT_TOKEN_RE.test(botToken)
    ) {
      res
        .status(400)
        .json({ error: "botToken must match Telegram bot token shape" });
      return;
    }
    if (typeof humanUserId !== "string" || humanUserId.length === 0) {
      res.status(400).json({ error: "humanUserId required" });
      return;
    }
    if (
      telegramChatId !== undefined &&
      telegramChatId !== null &&
      typeof telegramChatId !== "string"
    ) {
      res
        .status(400)
        .json({ error: "telegramChatId must be a string or null" });
      return;
    }

    if (authUserId !== humanUserId) {
      res.status(403).json({ error: "not your identity" });
      return;
    }

    try {
      const validateResult = await validateBotToken(botToken);
      if (validateResult.ok !== true) {
        const errMsg =
          "error" in validateResult ? validateResult.error : "invalid token";
        res.status(400).json({ error: errMsg });
        return;
      }

      await setTelegramBotToken(identityKey, {
        botToken,
        botUsername: validateResult.botUsername,
        humanUserId,
        telegramChatId:
          typeof telegramChatId === "string" ? telegramChatId : null,
      });

      // Blocker B-1: bridge reads bot token from per-agent .bottoken file.
      // Write it now so the bridge can authenticate immediately.
      try {
        await writeBotTokenFile(identityKey, botToken);
      } catch (err) {
        authLogger.warn(
          "activate: writeBotTokenFile failed (bridge will not see new bot until reconcile)",
          {
            operation: "telegram_activate_bottoken_write_failed",
            identityKey,
            error: err instanceof Error ? err.message : "unknown",
          },
        );
      }

      // Blocker B-2: activate/disconnect MUST trigger a registry rewrite.
      // Without this, /state/registry.json stays stale until Skynet restart,
      // and the bridge's inotifywait has nothing to react to.
      const rewriteResult = await rewriteRegistryFromCurrentState();
      if (rewriteResult.ok !== true) {
        const rewriteErr =
          "error" in rewriteResult ? rewriteResult.error : "unknown";
        authLogger.warn(
          "activate: registry rewrite failed (bridge may lag until next startup or reconcile)",
          {
            operation: "telegram_activate_registry_rewrite_failed",
            identityKey,
            error: rewriteErr,
          },
        );
      }

      authLogger.info("telegram activate ok", {
        operation: "telegram_activate",
        identityKey,
        botUsername: validateResult.botUsername,
        humanUserId,
      });

      res.json({ ok: true, botUsername: validateResult.botUsername });
    } catch (err) {
      authLogger.error("Failed to activate telegram bridge", err);
      res.status(500).json({ error: "Failed to activate telegram bridge" });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /telegram/disconnect
// ---------------------------------------------------------------------------

router.post(
  "/disconnect",
  express.json(),
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const authUserId = (req as AuthenticatedRequest).userId;
    const { identityKey } = (req.body ?? {}) as Record<string, unknown>;

    if (typeof identityKey !== "string" || !IDENTITY_KEY_RE.test(identityKey)) {
      res
        .status(400)
        .json({ error: "identityKey must match [a-z0-9][a-z0-9_-]{0,63}" });
      return;
    }

    try {
      const existing = await getTelegramBotToken(identityKey);
      if (existing === null) {
        res.status(404).json({ error: "no telegram binding for identity" });
        return;
      }
      if (existing.humanUserId !== authUserId) {
        res.status(403).json({ error: "not your identity" });
        return;
      }

      await deleteTelegramBotToken(identityKey);

      // Blocker B-1: bridge stops routing this bot once .bottoken is gone.
      try {
        await deleteBotTokenFile(identityKey);
      } catch (err) {
        authLogger.warn(
          "disconnect: deleteBotTokenFile failed (bridge may retain stale bot token file)",
          {
            operation: "telegram_disconnect_bottoken_delete_failed",
            identityKey,
            error: err instanceof Error ? err.message : "unknown",
          },
        );
      }

      // Blocker B-2: rewrite registry so bridge's inotifywait picks up removal.
      const rewriteResult = await rewriteRegistryFromCurrentState();
      if (rewriteResult.ok !== true) {
        const rewriteErr =
          "error" in rewriteResult ? rewriteResult.error : "unknown";
        authLogger.warn("disconnect: registry rewrite failed", {
          operation: "telegram_disconnect_registry_rewrite_failed",
          identityKey,
          error: rewriteErr,
        });
      }

      authLogger.info("telegram disconnect ok", {
        operation: "telegram_disconnect",
        identityKey,
      });

      res.json({ ok: true });
    } catch (err) {
      authLogger.error("Failed to disconnect telegram bridge", err);
      res.status(500).json({ error: "Failed to disconnect telegram bridge" });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /telegram/status?identityKey=<key>
//
// Phase 83 Plan 05 — read-only endpoint the TelegramTab frontend polls
// (every ~3s per Plan 83-06) while in the "waiting for /start" state.
// Returns { chatId: string | null } for the caller's own identity.
//
// Distinct from GET /telegram/:identityKey (below): that endpoint returns
// { status, botUsername, telegramChatId } for the modal's initial paint;
// this one is a hot poll that returns only the chatId and does NOT
// include botUsername (frontend already has it from the pending-start
// state) so the payload is minimal.
//
// Ownership check: matches /telegram/disconnect L225-228 — 403 when the
// row's humanUserId does not match the JWT-authed userId.
//
// ROUTE ORDERING: /status must be registered BEFORE /:identityKey — Express
// matches routes in registration order; a bare /status would otherwise
// match /:identityKey with identityKey="status".
// ---------------------------------------------------------------------------

router.get(
  "/status",
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const authUserId = (req as AuthenticatedRequest).userId;
    const { identityKey } = req.query as Record<string, unknown>;

    if (typeof identityKey !== "string" || !IDENTITY_KEY_RE.test(identityKey)) {
      res
        .status(400)
        .json({ error: "identityKey must match [a-z0-9][a-z0-9_-]{0,63}" });
      return;
    }

    try {
      const row = await getTelegramBotToken(identityKey);
      if (row === null) {
        res.status(404).json({ error: "no telegram binding for identity" });
        return;
      }
      if (row.humanUserId !== authUserId) {
        res.status(403).json({ error: "not your identity" });
        return;
      }
      // Minimal payload — chatId only. Bot token NEVER included.
      res.json({ chatId: row.telegramChatId });
    } catch (err) {
      authLogger.error("Failed to read telegram pending status", err);
      res.status(500).json({ error: "Failed to read telegram status" });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /telegram/:identityKey
// ---------------------------------------------------------------------------

router.get(
  "/:identityKey",
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const { identityKey } = req.params;

    if (typeof identityKey !== "string" || !IDENTITY_KEY_RE.test(identityKey)) {
      res
        .status(400)
        .json({ error: "identityKey must match [a-z0-9][a-z0-9_-]{0,63}" });
      return;
    }

    try {
      const row = await getTelegramBotToken(identityKey);
      if (row === null) {
        res.json({ status: "unconfigured" });
        return;
      }
      // Explicit shape — bot token NEVER included.
      res.json({
        status: "connected",
        botUsername: row.botUsername,
        telegramChatId: row.telegramChatId,
      });
    } catch (err) {
      authLogger.error("Failed to read telegram status", err);
      res.status(500).json({ error: "Failed to read telegram status" });
    }
  },
);

export default router;
