/**
 * relay-registry-backfill.ts — admin endpoint for one-shot registry-rooms backfill.
 *
 * POST /relay-room/backfill (admin-only)
 *
 * Solves the deploy-time gap discovered at the arc-close ship 2026-09-09:
 * Skynet uses `:memory:` SQLite (Phase 68), so the previously-documented
 * `docker exec node --input-type=module` invocation could not reach the
 * running backend's DB instance — it opened a fresh empty in-memory DB.
 * The backfill utility is stateful against the live process's DB + Matrix
 * admin creds; it can only run INSIDE the live process. This endpoint
 * exposes it via HTTP so it fires against the running backend, not a
 * detached node process.
 *
 * Bounty: registry-rooms-backfill-runbook-broken-in-memory-db.
 *
 * ## Semantics
 *
 * Idempotent by design. `runRegistryRoomsBackfill` self-gates against the
 * `has_backfilled_registry_rooms` settings key — the first call performs
 * the work + flips the gate; every subsequent call returns `{ ok: true,
 * skipped: true }` without re-doing the fan-out. Query `?force=true`
 * bypasses the gate for re-runs (e.g. after schema changes).
 *
 * ## Auth
 *
 * authenticateJWT middleware enforces JWT presence. Inside the handler,
 * users.isAdmin is checked (403 if false). Mirrors user-admin-routes.ts
 * make-admin/remove-admin gate pattern.
 *
 * ## Path choice
 *
 * Mounted under /relay-room/ so it lives inside the existing nginx
 * ^~ /relay-room/ location block — no new nginx surface required.
 * Semantically: registry rooms ARE relay rooms; backfill is a relay-room-
 * scoped admin op.
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import { runRegistryRoomsBackfill } from "../../relay-sessions/registry-rooms-backfill.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * @openapi
 * /relay-room/backfill:
 *   post:
 *     summary: One-shot backfill of pre-existing users/agents into registry rooms.
 *     description: |
 *       Admin-only. Enumerates humans from users.mxid + optionally agents
 *       (via injected enumerator) and joins each to the appropriate registry
 *       room. Idempotent — the has_backfilled_registry_rooms settings gate
 *       prevents duplicate work.
 *     parameters:
 *       - in: query
 *         name: force
 *         schema: { type: boolean }
 *         description: If true, bypass the has_backfilled gate and re-run.
 *     responses:
 *       200:
 *         description: Backfill completed (or skipped as no-op if already gated).
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   properties:
 *                     ok: { type: boolean, enum: [true] }
 *                     skipped: { type: boolean, enum: [true] }
 *                 - type: object
 *                   properties:
 *                     ok: { type: boolean, enum: [true] }
 *                     humansAttempted: { type: integer }
 *                     humansFailed: { type: integer }
 *                     agentsAttempted: { type: integer }
 *                     agentsFailed: { type: integer }
 *                 - type: object
 *                   properties:
 *                     ok: { type: boolean, enum: [false] }
 *                     reason: { type: string }
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Not authorized (non-admin caller)
 *       500:
 *         description: Backfill threw
 */
router.post("/backfill", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;

  try {
    const adminRow = await db.select().from(users).where(eq(users.id, userId));
    if (!adminRow || adminRow.length === 0 || !adminRow[0].isAdmin) {
      return res.status(403).json({ ok: false, error: "not_authorized" });
    }

    const force = req.query.force === "true";

    databaseLogger.info("relay-registry-backfill: invocation", {
      operation: "relay_registry_backfill_invoke",
      userId,
      force,
    });

    const result = await runRegistryRoomsBackfill(force ? { force: true } : {});

    databaseLogger.info("relay-registry-backfill: result", {
      operation: "relay_registry_backfill_result",
      userId,
      resultOk: result.ok,
      resultShape:
        "skipped" in result
          ? "skipped"
          : "reason" in result
            ? "failed"
            : "completed",
    });

    return res.status(200).json(result);
  } catch (err) {
    databaseLogger.error("relay-registry-backfill: threw", {
      operation: "relay_registry_backfill_threw",
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
