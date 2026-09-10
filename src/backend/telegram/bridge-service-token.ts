/**
 * Phase 98 Plan 08 Task 1 — mint a bridge-scoped JWT so the tg-bridge
 * Docker service can authenticate to Skynet's /voice/transcribe endpoint
 * (per D-Telegram-bridge-STT locked 2026-09-10: "the telegram bridge is
 * supposed to use whatever STT that Skynet is configured with for STT on
 * the front end.").
 *
 * Design:
 *   - Signed with the SAME JWT secret AuthManager uses for user tokens
 *     (via SystemCrypto.getInstance().getJWTSecret()), so the token passes
 *     through AuthManager.verifyJWTToken → authenticateJWT middleware on
 *     /voice/* routes with zero bridge-specific verification path.
 *   - Payload carries bridge-identifying claims (subject: "tg-bridge",
 *     scope: "voice-transcribe", userId: "tg-bridge-service") that would
 *     let a future audit-logging path distinguish bridge calls from user
 *     calls without changing the verification gate.
 *   - NO sessionId claim — bridge JWT is stateless. authenticateJWT's
 *     sessions-table lookup (auth-manager.ts:842) only fires when
 *     payload.sessionId is truthy; a bridge token doesn't need a persisted
 *     session row.
 *   - 30-day expiry — long enough to survive frequent bridge restarts and
 *     the config-writer's startup-only mint cadence, short enough that a
 *     compromised token has a bounded replay window (STRIDE T-98-08-05).
 *   - NEVER throws — wraps everything in try/catch and returns
 *     {ok:false, reason} so callers (bridge-config-writer.ts) can short-
 *     circuit their config-write with a clean shape rather than an
 *     unhandled rejection. Matches the writer's invariant that its public
 *     entry points never throw (see bridge-config-writer.ts:29 "Do NOT
 *     re-throw anywhere in the public entry points").
 *
 * The minted token is written to /state/config.env by bridge-config-writer.ts
 * as `SKYNET_BRIDGE_TOKEN=<jwt>`; bridge.sh then attaches it as
 * `Authorization: Bearer $SKYNET_BRIDGE_TOKEN` when POSTing voice notes
 * to $SKYNET_BASE/voice/transcribe.
 */
import jwt from "jsonwebtoken";
import { SystemCrypto } from "../utils/system-crypto.js";
import { databaseLogger } from "../utils/logger.js";

const BRIDGE_TOKEN_EXPIRY = "30d";

export async function mintBridgeServiceToken(): Promise<
  { ok: true; token: string } | { ok: false; reason: string }
> {
  try {
    const secret = await SystemCrypto.getInstance().getJWTSecret();

    // Payload shape mirrors AuthManager's JWTPayload interface so it flows
    // through the same verifyJWTToken path unchanged. The extra `subject`
    // and `scope` fields are additive — jsonwebtoken accepts arbitrary
    // claim keys and jwt.verify ignores unknown fields.
    const payload = {
      userId: "tg-bridge-service",
      subject: "tg-bridge",
      scope: "voice-transcribe",
    };

    const token = jwt.sign(payload, secret, {
      expiresIn: BRIDGE_TOKEN_EXPIRY,
    } as jwt.SignOptions);

    return { ok: true, token };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    databaseLogger.warn("mintBridgeServiceToken: mint failed", {
      operation: "bridge_service_token_mint_failed",
      error: reason,
    });
    return { ok: false, reason };
  }
}
