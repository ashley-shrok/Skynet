/**
 * "Confirm it's you" end to end, in process: a sensitive route guarded by
 * requireRecentAuth, and POST /users/confirm-identity that re-proves the
 * session. Bare Express + node http (no supertest in this project); the
 * database is a small in-memory stand-in for the users and sessions tables.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Row = Record<string, unknown>;
const tables: { users: Row[]; sessions: Row[] } = { users: [], sessions: [] };

vi.mock("drizzle-orm", () => ({
  eq: (col: { table: string; key: string }, val: unknown) => ({ col, val }),
}));

vi.mock("../db/schema.js", () => {
  const cols = (table: string, keys: string[]) => {
    const t: Record<string, unknown> = { __name: table };
    for (const k of keys) t[k] = { table, key: k };
    return t;
  };
  return {
    users: cols("users", ["id", "username", "passwordHash", "isOidc", "totpEnabled", "totpSecret", "totpBackupCodes"]),
    sessions: cols("sessions", ["id", "userId", "confirmedAt"]),
  };
});

vi.mock("../db/index.js", () => {
  type Cond = { col: { key: string }; val: unknown };
  const rowsOf = (t: { __name: string }) => tables[t.__name as "users" | "sessions"];
  const match = (c: Cond) => (r: Row) => r[c.col.key] === c.val;
  return {
    db: {
      select: () => ({
        from: (t: { __name: string }) => ({
          where: (c: Cond) => {
            const found = rowsOf(t).filter(match(c)).map((r) => ({ ...r }));
            return Object.assign(Promise.resolve(found), {
              limit: (n: number) => Promise.resolve(found.slice(0, n)),
            });
          },
        }),
      }),
      update: (t: { __name: string }) => ({
        set: (patch: Row) => ({
          where: (c: Cond) => {
            for (const r of rowsOf(t).filter(match(c))) Object.assign(r, patch);
            return Promise.resolve();
          },
        }),
      }),
    },
  };
});

vi.mock("../../utils/logger.js", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() };
  return { authLogger: l, databaseLogger: l };
});

vi.mock("../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: { forceSave: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../../utils/auth-manager.js", () => ({ AuthManager: class {} }));

vi.mock("../../utils/lazy-field-encryption.js", () => ({
  LazyFieldEncryption: { safeGetFieldValue: (v: string) => v },
}));

vi.mock("bcryptjs", () => ({
  default: { compare: async (pw: string, hash: string) => hash === `hash:${pw}` },
}));

// "123456" is the current code; "654321" is the next one (still in the window).
vi.mock("speakeasy", () => ({
  default: {
    totp: {
      verifyDelta: ({ token }: { token: string }) =>
        token === "123456" ? { delta: 0 } : token === "654321" ? { delta: 1 } : undefined,
    },
  },
}));

import {
  requireRecentAuth,
  requireRecentAuthUnlessOwnSession,
  RECENT_AUTH_WINDOW_MS,
  isRecentlyConfirmed,
} from "../../utils/recent-auth.js";
import { registerUserConfirmIdentityRoutes } from "./user-confirm-identity-routes.js";
import { loginRateLimiter } from "../../utils/login-rate-limiter.js";

let server: http.Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // Stand-in for the real sign-in check: who's calling comes from headers.
  const authenticateJWT: express.RequestHandler = (req, _res, next) => {
    const r = req as unknown as { userId?: string; sessionId?: string };
    r.userId = req.header("x-user") || undefined;
    r.sessionId = req.header("x-session") || undefined;
    next();
  };
  const router = express.Router();
  registerUserConfirmIdentityRoutes(router, {
    authenticateJWT,
    authManager: { getUserDataKey: () => Buffer.from("k") } as never,
  });
  router.post("/sensitive", authenticateJWT, requireRecentAuth, (_req, res) => {
    res.json({ done: true });
  });
  router.delete("/sessions/:sessionId", authenticateJWT, requireRecentAuthUnlessOwnSession, (_req, res) => {
    res.json({ signedOut: true });
  });
  app.use("/users", router);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

beforeEach(() => {
  vi.useRealTimers();
  tables.users = [
    { id: "u1", username: "owner", passwordHash: "hash:pw", isOidc: false, totpEnabled: true, totpSecret: "S", totpBackupCodes: JSON.stringify(["backup-1"]) },
    { id: "u2", username: "nocode", passwordHash: "hash:pw2", isOidc: false, totpEnabled: false, totpSecret: null, totpBackupCodes: null },
    { id: "u3", username: "sso", passwordHash: "", isOidc: true, totpEnabled: false, totpSecret: null, totpBackupCodes: null },
    { id: "u4", username: "both", passwordHash: "hash:pw4", isOidc: true, totpEnabled: false, totpSecret: null, totpBackupCodes: null },
  ];
  tables.sessions = [
    { id: "s1", userId: "u1", confirmedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
    { id: "s2", userId: "u2", confirmedAt: null },
    { id: "s3", userId: "u3", confirmedAt: null },
    { id: "s4", userId: "u4", confirmedAt: null },
  ];
  for (const u of ["owner", "nocode", "sso", "both"]) loginRateLimiter.resetAttempts("127.0.0.1", u);
  for (const u of ["u1", "u2", "u3", "u4"]) loginRateLimiter.resetTOTPAttempts(u);
});

async function call(
  path: string,
  headers: Record<string, string>,
  body: unknown = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}/users${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const owner = { "x-user": "u1", "x-session": "s1" };

describe("confirm it's you", () => {
  it("refuses a stale sign-in, accepts after confirming, and refuses again after 10 minutes", async () => {
    const first = await call("/sensitive", owner);
    expect(first.status).toBe(403);
    expect(first.body).toMatchObject({ code: "REAUTH_REQUIRED", totpRequired: true });

    const wrongPw = await call("/confirm-identity", owner, { password: "nope", totpCode: "123456" });
    expect(wrongPw.status).toBe(401);
    const wrongCode = await call("/confirm-identity", owner, { password: "pw", totpCode: "000000" });
    expect(wrongCode.status).toBe(401);
    expect((await call("/sensitive", owner)).status).toBe(403);

    const ok = await call("/confirm-identity", owner, { password: "pw", totpCode: "123456" });
    expect(ok.status).toBe(200);
    expect(ok.body.confirmed).toBe(true);
    expect((await call("/sensitive", owner)).body).toEqual({ done: true });

    // Eleven minutes on, the confirmation has run out.
    tables.sessions[0].confirmedAt = new Date(Date.now() - RECENT_AUTH_WINDOW_MS - 60_000).toISOString();
    expect((await call("/sensitive", owner)).status).toBe(403);
  });

  it("counts a fresh sign-in as confirmed", async () => {
    tables.sessions[0].confirmedAt = new Date().toISOString();
    expect((await call("/sensitive", owner)).status).toBe(200);
  });

  it("accepts a backup code once", async () => {
    const ok = await call("/confirm-identity", owner, { password: "pw", totpCode: "backup-1" });
    expect(ok.status).toBe(200);
    expect(JSON.parse(tables.users[0].totpBackupCodes as string)).toEqual([]);
    tables.sessions[0].confirmedAt = null;
    expect((await call("/confirm-identity", owner, { password: "pw", totpCode: "backup-1" })).status).toBe(401);
  });

  it("asks for a code when two-step codes are on", async () => {
    const res = await call("/confirm-identity", owner, { password: "pw" });
    expect(res.status).toBe(400);
  });

  it("takes just the password when the account has no two-step codes", async () => {
    const h = { "x-user": "u2", "x-session": "s2" };
    expect((await call("/sensitive", h)).body).toMatchObject({ code: "REAUTH_REQUIRED", totpRequired: false });
    expect((await call("/confirm-identity", h, { password: "pw2" })).status).toBe(200);
    expect((await call("/sensitive", h)).status).toBe(200);
  });

  it("never lets an access key through, and a key can't confirm", async () => {
    const key = { "x-user": "u1", authorization: "Bearer tmx_abc" };
    const res = await call("/sensitive", key);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("REAUTH_UNAVAILABLE");
    // Even with a session that just confirmed, a key-authenticated call is refused.
    tables.sessions[0].confirmedAt = new Date().toISOString();
    expect((await call("/sensitive", { ...key, "x-session": "s1" })).body.code).toBe("REAUTH_UNAVAILABLE");
    expect((await call("/confirm-identity", key, { password: "pw", totpCode: "123456" })).status).toBe(403);
  });

  it("refuses a token with no session (the server's own internal tokens)", async () => {
    const res = await call("/sensitive", { "x-user": "u1" });
    expect(res.body.code).toBe("REAUTH_UNAVAILABLE");
  });

  it("doesn't let one user's confirmed session cover another user", async () => {
    tables.sessions[0].confirmedAt = new Date().toISOString();
    expect((await call("/sensitive", { "x-user": "u2", "x-session": "s1" })).status).toBe(403);
  });

  it("refuses SSO-only accounts", async () => {
    const res = await call("/confirm-identity", { "x-user": "u3", "x-session": "s3" }, { password: "x" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("REAUTH_UNAVAILABLE");
  });

  it("lets an SSO account that also has a password confirm with it", async () => {
    const res = await call("/confirm-identity", { "x-user": "u4", "x-session": "s4" }, { password: "pw4" });
    expect(res.status).toBe(200);
  });

  it("won't take the same two-step code twice", async () => {
    expect((await call("/confirm-identity", owner, { password: "pw", totpCode: "654321" })).status).toBe(200);
    expect((await call("/confirm-identity", owner, { password: "pw", totpCode: "654321" })).status).toBe(401);
  });

  it("says to sign in again when the two-step secret can't be read", async () => {
    tables.users[0].totpSecret = null;
    const res = await call("/confirm-identity", owner, { password: "pw", totpCode: "123456" });
    expect(res.status).toBe(409);
  });

  it("locks out after repeated wrong passwords", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await call("/confirm-identity", owner, { password: "nope", totpCode: "123456" })).status;
    }
    expect(last).toBe(429);
  });
});

describe("signing out one session", () => {
  const del = async (target: string, headers: Record<string, string>) => {
    const res = await fetch(`${base}/users/sessions/${target}`, { method: "DELETE", headers });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it("signs out your own session without asking", async () => {
    expect((await del("s1", owner)).status).toBe(200);
  });

  it("asks before signing out a different session", async () => {
    const res = await del("s2", owner);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("REAUTH_REQUIRED");
    tables.sessions[0].confirmedAt = new Date().toISOString();
    expect((await del("s2", owner)).status).toBe(200);
  });

  it("never lets an access key sign out sessions", async () => {
    const res = await del("s2", { "x-user": "u1", authorization: "Bearer tmx_abc" });
    expect(res.body.code).toBe("REAUTH_UNAVAILABLE");
  });
});

describe("isRecentlyConfirmed", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  it("is true inside the window and false outside or when missing", () => {
    expect(isRecentlyConfirmed("2026-10-25T11:55:00Z", now)).toBe(true);
    expect(isRecentlyConfirmed("2026-10-25T11:49:00Z", now)).toBe(false);
    expect(isRecentlyConfirmed(null, now)).toBe(false);
    expect(isRecentlyConfirmed("garbage", now)).toBe(false);
    expect(isRecentlyConfirmed("2026-10-25T13:00:00Z", now)).toBe(false);
  });
});
