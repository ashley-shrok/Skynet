/**
 * Phase 98 Plan 08 Task 1 — bridge-service-token unit tests.
 *
 * mintBridgeServiceToken() produces a JWT the bridge writes into
 * /state/config.env and later hands to Skynet's authenticateJWT middleware
 * when POSTing voice notes to /voice/transcribe (per D-Telegram-bridge-STT
 * locked 2026-09-10). The token is signed with the same JWT secret
 * AuthManager uses for user tokens so it validates through the same
 * verifyJWTToken path — no bridge-specific verification path required.
 *
 * Covers:
 *   - happy path: returns {ok:true, token} where token is a well-formed JWT
 *   - payload carries bridge-identifying claims (subject: "tg-bridge",
 *     userId: "tg-bridge-service", scope: "voice-transcribe")
 *   - long expiry (30 days) — encoded so exp > now + 29d
 *   - NO sessionId claim (bridge JWT is stateless; authenticateJWT skips
 *     the sessions-table lookup when sessionId is absent, so a bridge
 *     token doesn't need a persisted session row)
 *   - crypto failure returns {ok:false, reason} — never throws
 *   - token verifies against the same secret via jsonwebtoken.verify()
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import jwt from "jsonwebtoken";

// The system JWT secret is loaded via SystemCrypto.getInstance().getJWTSecret().
// Mock the singleton so we can control the secret without touching disk / env.
const jwtSecretSpy = vi.fn();
vi.mock("../utils/system-crypto.js", () => ({
  SystemCrypto: {
    getInstance: () => ({
      getJWTSecret: () => jwtSecretSpy(),
    }),
  },
}));

const warnSpy = vi.fn();
const infoSpy = vi.fn();
const errorSpy = vi.fn();
vi.mock("../utils/logger.js", () => ({
  databaseLogger: {
    info: (...args: unknown[]) => infoSpy(...args),
    warn: (...args: unknown[]) => warnSpy(...args),
    error: (...args: unknown[]) => errorSpy(...args),
    debug: vi.fn(),
  },
}));

beforeEach(() => {
  jwtSecretSpy.mockReset();
  warnSpy.mockReset();
  infoSpy.mockReset();
  errorSpy.mockReset();
  vi.resetModules();
});

describe("bridge-service-token.mintBridgeServiceToken", () => {
  it("happy path — returns {ok:true, token} with a well-formed JWT", async () => {
    jwtSecretSpy.mockResolvedValue(
      "test-secret-64-chars-minimum-length-padding-padding-padding-padd",
    );

    const { mintBridgeServiceToken } = await import(
      "./bridge-service-token.js"
    );
    const result = await mintBridgeServiceToken();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.token).toBe("string");
      expect(result.token.length).toBeGreaterThan(0);
      // JWT is three base64url segments joined by "."
      expect(result.token.split(".")).toHaveLength(3);
    }
  });

  it("token payload carries bridge-identifying claims", async () => {
    const secret =
      "test-secret-64-chars-minimum-length-padding-padding-padding-padd";
    jwtSecretSpy.mockResolvedValue(secret);

    const { mintBridgeServiceToken } = await import(
      "./bridge-service-token.js"
    );
    const result = await mintBridgeServiceToken();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const decoded = jwt.verify(result.token, secret) as {
      userId: string;
      subject?: string;
      scope?: string;
      sessionId?: string;
      exp: number;
      iat: number;
    };

    expect(decoded.userId).toBe("tg-bridge-service");
    expect(decoded.subject).toBe("tg-bridge");
    expect(decoded.scope).toBe("voice-transcribe");
  });

  it("token has no sessionId (stateless — authenticateJWT skips sessions-table lookup)", async () => {
    const secret =
      "test-secret-64-chars-minimum-length-padding-padding-padding-padd";
    jwtSecretSpy.mockResolvedValue(secret);

    const { mintBridgeServiceToken } = await import(
      "./bridge-service-token.js"
    );
    const result = await mintBridgeServiceToken();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const decoded = jwt.verify(result.token, secret) as {
      userId: string;
      sessionId?: string;
    };

    // sessionId is undefined (or explicitly absent) — this is the whole point:
    // authenticateJWT only queries the sessions table when payload.sessionId
    // is truthy. A bridge JWT stays stateless.
    expect(decoded.sessionId).toBeUndefined();
  });

  it("token has 30-day expiry (long enough to survive bridge restarts but bounded)", async () => {
    const secret =
      "test-secret-64-chars-minimum-length-padding-padding-padding-padd";
    jwtSecretSpy.mockResolvedValue(secret);

    const { mintBridgeServiceToken } = await import(
      "./bridge-service-token.js"
    );
    const result = await mintBridgeServiceToken();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const decoded = jwt.verify(result.token, secret) as {
      exp: number;
      iat: number;
    };

    // exp - iat should be ~30 days (in seconds). Allow small drift for
    // whatever the signer's clock did during the test run.
    const thirtyDaysInSec = 30 * 24 * 60 * 60;
    const lifetime = decoded.exp - decoded.iat;
    expect(lifetime).toBeGreaterThanOrEqual(thirtyDaysInSec - 60);
    expect(lifetime).toBeLessThanOrEqual(thirtyDaysInSec + 60);
  });

  it("returns {ok:false, reason} on secret-retrieval failure — does NOT throw", async () => {
    jwtSecretSpy.mockRejectedValue(new Error("simulated JWT secret failure"));

    const { mintBridgeServiceToken } = await import(
      "./bridge-service-token.js"
    );

    // Explicit no-throw guarantee.
    await expect(mintBridgeServiceToken()).resolves.toBeDefined();

    const result = await mintBridgeServiceToken();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.reason).toBe("string");
      expect(result.reason.length).toBeGreaterThan(0);
    }
    // Structured warn logged for observability.
    expect(warnSpy.mock.calls.length).toBeGreaterThan(0);
    const opCall = warnSpy.mock.calls.find((c) => {
      const meta = c[1] as { operation?: string } | undefined;
      return meta?.operation === "bridge_service_token_mint_failed";
    });
    expect(opCall).toBeDefined();
  });

  it("minted token verifies successfully against the same secret (mirrors authenticateJWT verify path)", async () => {
    const secret =
      "test-secret-64-chars-minimum-length-padding-padding-padding-padd";
    jwtSecretSpy.mockResolvedValue(secret);

    const { mintBridgeServiceToken } = await import(
      "./bridge-service-token.js"
    );
    const result = await mintBridgeServiceToken();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // jsonwebtoken.verify throws on any failure — passing means the token
    // would pass through AuthManager.verifyJWTToken's `jwt.verify(...)` call
    // at auth-manager.ts:428, which is the gate authenticateJWT sits behind.
    expect(() => jwt.verify(result.token, secret)).not.toThrow();
  });
});
