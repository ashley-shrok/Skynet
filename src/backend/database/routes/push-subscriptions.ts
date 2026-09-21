/**
 * Phase 128 Plan 05 Task 1 — /push-subscriptions Express router.
 *
 * Two endpoints:
 *
 *   POST /              — Register a browser PushSubscription for the
 *                         authenticated user. Body: {endpoint, keys:{p256dh,auth}}.
 *                         Response: 201 {ok:true} on new, 200 {ok:true,
 *                         alreadyRegistered:true} on duplicate.
 *
 *   GET /vapid-public-key — Return the VAPID public key so the client can
 *                           pass it to pushManager.subscribe(). NO AUTH — the
 *                           public key is public by design (T-128-26 handles
 *                           the private-key confidentiality invariant by
 *                           returning ONLY the public field).
 *
 * NOT mounted in this plan — Plan 08 wires the router into database.ts
 * alongside the starter.ts changes.
 *
 * Route discipline (mirrors user-preferences.ts:1-24, 469-509):
 *   - authenticateJWT gates POST; GET is public.
 *   - userId is sourced from `(req as AuthenticatedRequest).userId` — the
 *     JWT-verified value. NEVER from the request body (T-128-21 mitigation).
 *   - express.json({ limit: "8kb" }) caps body size (T-128-22 mitigation).
 *   - Zod SubscriptionSchema validates body shape + endpoint URL length +
 *     base64url key regex (T-128-23 mitigation).
 *   - Malformed body → 400 with a generic error string (do NOT echo the
 *     invalid body back — T-128-24 log/echo minimization).
 *   - INSERT uses ON CONFLICT(user_id, endpoint) DO NOTHING; the UNIQUE INDEX
 *     lives at the DDL layer (db/index.ts).
 *   - When result.changes === 0 the handler returns 200 alreadyRegistered
 *     WITHOUT calling forceSave — this is the S2 disk-sat guard byte-mirrored
 *     from relay-room-sessions-store.ts:86-90.
 *   - When result.changes > 0 the handler calls
 *     DatabaseSaveTrigger.forceSave("push-subscription-register") inside a
 *     try/catch; on catch, .warn is logged with the operation code, userId,
 *     and truncated endpoint (endpoint.slice(0, 40) — T-128-24). The response
 *     is 201 either way (write already reached RAM — degrade gracefully).
 *
 * Handler-level exports (`handleRegisterSubscription`, `handleGetVapidPublicKey`)
 * mirror user-preferences.ts's `handleGetPreferences` / `handlePutPreferences`
 * so tests can exercise the logic without an Express harness (see
 * push-subscriptions.test.ts).
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, DatabaseSaveTrigger } from "../db/index.js";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { getVapidDetails } from "../../notifications/vapid-config.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

// ---------------------------------------------------------------------------
// Zod validation — subscription body shape (T-128-23)
// ---------------------------------------------------------------------------
//
// endpoint: HTTPS URL from the browser's push service; capped at 2048 chars
//   (well above real-world lengths ~200-400; caps a DoS surface).
// keys.p256dh: base64url ECDH public key. Length 87-88 in practice; regex
//   ^[A-Za-z0-9_-]{80,180}$ accepts a defensive range.
// keys.auth: base64url auth secret. Length 24 in practice; regex 20-40 range.
//
// The full body is capped at 8kb via express.json({limit:"8kb"}) below — that
// runs BEFORE zod parses, so a mega-body is rejected at the parser layer.
const SubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,180}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{20,40}$/),
  }),
});

// ---------------------------------------------------------------------------
// Core handlers (exported for direct unit-test invocation — same shape as
// user-preferences.ts's handleGetPreferences / handlePutPreferences).
// ---------------------------------------------------------------------------

/**
 * POST /push-subscriptions handler.
 *
 * `userId` is threaded in by the router-level Express wrapper below, which
 * extracts it from `(req as AuthenticatedRequest).userId`. Tests call this
 * function directly with the userId argument — bypassing the auth middleware
 * intentionally, since the middleware is `authenticateJWT` from AuthManager
 * (auth-by-construction; validated in push-subscriptions.test.ts).
 */
export async function handleRegisterSubscription(
  userId: string,
  body: unknown,
  res: Response,
): Promise<Response> {
  const parsed = SubscriptionSchema.safeParse(body);
  if (!parsed.success) {
    // Generic error — do NOT echo the invalid body back (V8 / T-128-24).
    return res.status(400).json({ error: "invalid subscription shape" });
  }
  const sub = parsed.data;
  const id = randomUUID();

  let result: { changes: number };
  try {
    // Raw better-sqlite3 prepared statement — Drizzle doesn't have first-class
    // ON CONFLICT DO NOTHING support in every version, so we drop to the raw
    // client here (same escape hatch used elsewhere in the codebase for
    // ON CONFLICT patterns — see the RESEARCH.md § Pattern 1 excerpt).
    result = db.$client
      .prepare(
        "INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, endpoint) DO NOTHING",
      )
      .run(id, userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth) as {
      changes: number;
    };
  } catch (e) {
    // Defensive — INSERT should not throw at the DB layer with valid inputs,
    // but if it does (e.g. FK violation on a stale userId) we surface a
    // generic 500 without a stack trace (V7 discipline).
    databaseLogger.error("push_subscriptions INSERT failed", e, {
      operation: "push_subscription_register_insert_failed",
      userId,
      endpoint: sub.endpoint.slice(0, 40),
    });
    return res.status(500).json({ error: "failed to register subscription" });
  }

  if (result.changes === 0) {
    // Row already exists — no state change, no disk churn (S2 no-op guard,
    // byte-mirror of relay-room-sessions-store.ts:86-90).
    return res.status(200).json({ ok: true, alreadyRegistered: true });
  }

  // Row inserted → force the save so it survives a container restart. Failure
  // to save is a warn-log, NOT a 5xx — the write already reached RAM, and a
  // 5xx here would lose the (retriable) client subscription registration
  // gesture. Same discipline as user-preferences.ts:406-418.
  try {
    await DatabaseSaveTrigger.forceSave("push-subscription-register");
  } catch (saveErr) {
    databaseLogger.warn(
      "Force-save after push subscription register failed",
      {
        operation: "push_subscription_register_save_failed",
        userId,
        // V8 / T-128-24 — endpoint URL is a capability token; only a short
        // prefix ever appears in logs.
        endpoint: sub.endpoint.slice(0, 40),
        error:
          saveErr instanceof Error ? saveErr.message : "Unknown error",
      },
    );
  }

  return res.status(201).json({ ok: true });
}

/**
 * GET /push-subscriptions/vapid-public-key handler.
 *
 * Returns 200 {publicKey} for the client to feed into pushManager.subscribe.
 * The VAPID *private* key is loaded by getVapidDetails() too but is
 * deliberately dropped from the response body (T-128-26 mitigation — the
 * response object is constructed by name, not by spread, so an accidental
 * `...vapid` refactor would still not leak the private field unless someone
 * explicitly writes `privateKey` into it).
 *
 * On config-load failure (should never happen at runtime — assertVapidConfigAtBoot
 * fails fast in Plan 08's starter.ts wiring — but defensive against bad
 * env-var hot-swap between boot and request), return a generic 500.
 */
export function handleGetVapidPublicKey(res: Response): Response {
  try {
    const { publicKey } = getVapidDetails();
    return res.status(200).json({ publicKey });
  } catch (e) {
    databaseLogger.warn("VAPID public key GET failed to load config", {
      operation: "push_vapid_public_key_load_failed",
      error: e instanceof Error ? e.message : "Unknown error",
    });
    return res.status(500).json({ error: "vapid unavailable" });
  }
}

// ---------------------------------------------------------------------------
// Route wiring — auth-gated POST + public GET.
// ---------------------------------------------------------------------------
//
// POST body cap: 8kb via express.json({limit:"8kb"}). A well-formed
// PushSubscriptionJSON is < 1kb in practice; 8kb is a generous ceiling that
// still bounds the T-128-22 DoS surface.

/**
 * @openapi
 * /push-subscriptions:
 *   post:
 *     summary: Register a Web Push subscription for the authenticated user.
 *     tags:
 *       - Push Notifications
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [endpoint, keys]
 *             properties:
 *               endpoint:
 *                 type: string
 *                 format: uri
 *               keys:
 *                 type: object
 *                 required: [p256dh, auth]
 *                 properties:
 *                   p256dh: { type: string }
 *                   auth:   { type: string }
 *     responses:
 *       201: { description: New subscription registered }
 *       200: { description: Subscription already registered (idempotent) }
 *       400: { description: Invalid subscription shape }
 */
router.post(
  "/",
  authenticateJWT,
  express.json({ limit: "8kb" }),
  async (req: Request, res: Response) => {
    // T-128-21 mitigation: userId comes from the JWT-verified auth request,
    // NEVER from req.body. An attacker's body can carry any userId value —
    // we ignore it entirely.
    const userId = (req as AuthenticatedRequest).userId;
    return handleRegisterSubscription(userId, req.body, res);
  },
);

/**
 * @openapi
 * /push-subscriptions/vapid-public-key:
 *   get:
 *     summary: Fetch the VAPID public key for pushManager.subscribe.
 *     description: |
 *       No authentication — the VAPID public key is public by design.
 *       The response body carries ONLY the publicKey field; the private
 *       key never leaves the backend (T-128-26).
 *     tags:
 *       - Push Notifications
 *     responses:
 *       200:
 *         description: The VAPID public key.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 publicKey:
 *                   type: string
 */
router.get("/vapid-public-key", (_req: Request, res: Response) => {
  return handleGetVapidPublicKey(res);
});

export default router;
