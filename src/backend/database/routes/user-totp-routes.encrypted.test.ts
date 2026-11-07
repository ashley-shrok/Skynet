/**
 * Two-step codes after a sign-in has encrypted the user's secret and backup
 * codes at rest (AuthManager's lazy migration does this on every login).
 * Real field encryption and real TOTP codes; the database is a small
 * in-memory stand-in. Every route that checks a code must still accept the
 * right one.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import speakeasy from "speakeasy";

type Row = Record<string, unknown>;
const tables: { users: Row[]; sessions: Row[]; trusted_devices: Row[] } = {
  users: [],
  sessions: [],
  trusted_devices: [],
};

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
    users: cols("users", ["id", "username", "passwordHash", "isOidc", "isAdmin", "totpEnabled", "totpSecret", "totpBackupCodes"]),
    sessions: cols("sessions", ["id", "userId"]),
    trustedDevices: cols("trusted_devices", ["id", "userId"]),
  };
});

vi.mock("../db/index.js", () => {
  type Cond = { col: { key: string }; val: unknown };
  type T = { __name: keyof typeof tables };
  const match = (c: Cond) => (r: Row) => r[c.col.key] === c.val;
  return {
    db: {
      select: () => ({
        from: (t: T) => ({
          where: (c: Cond) => Promise.resolve(tables[t.__name].filter(match(c)).map((r) => ({ ...r }))),
        }),
      }),
      update: (t: T) => ({
        set: (patch: Row) => ({
          where: (c: Cond) => {
            for (const r of tables[t.__name].filter(match(c))) Object.assign(r, patch);
            return Promise.resolve();
          },
        }),
      }),
      delete: (t: T) => ({
        where: (c: Cond) => {
          tables[t.__name] = tables[t.__name].filter((r) => !match(c)(r));
          return Promise.resolve();
        },
      }),
    },
    saveMemoryDatabaseToFile: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../../utils/logger.js", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() };
  return { authLogger: l, databaseLogger: l };
});
vi.mock("../../utils/auth-manager.js", () => ({ AuthManager: class {} }));
vi.mock("../../utils/recent-auth.js", () => ({
  requireRecentAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../utils/session-timeout.js", () => ({ getSessionTimeoutHours: () => 24 }));
vi.mock("../../branding/branding-config-loader.js", () => ({
  loadBrandingConfig: async () => ({ appName: "App" }),
}));
vi.mock("qrcode", () => ({ default: { toDataURL: async () => "data:," } }));
vi.mock("bcryptjs", () => ({
  default: { compare: async (pw: string, hash: string) => hash === `hash:${pw}` },
}));

import { LazyFieldEncryption } from "../../utils/lazy-field-encryption.js";
import { registerUserTotpRoutes } from "./user-totp-routes.js";

const USER = "u1";
const DATA_KEY = crypto.randomBytes(32);
const SECRET = speakeasy.generateSecret({ length: 20 }).base32;
const BACKUPS = ["AAAA1111", "BBBB2222"];
let dataKeyAvailable = true;

const now = () => speakeasy.totp({ secret: SECRET, encoding: "base32" });

/** Store the row the way it is after a sign-in: secret + codes encrypted. */
function seedEncryptedUser(totpEnabled = true) {
  const raw: Row = {
    id: USER,
    username: "alice",
    passwordHash: "hash:pw",
    isOidc: false,
    isAdmin: false,
    totpEnabled,
    totp_secret: SECRET,
    totp_backup_codes: JSON.stringify(BACKUPS),
  };
  const { updatedRecord, needsUpdate } = LazyFieldEncryption.migrateRecordSensitiveFields(
    raw,
    LazyFieldEncryption.getSensitiveFieldsForTable("users"),
    DATA_KEY,
    USER,
  );
  expect(needsUpdate).toBe(true);
  const { totp_secret, totp_backup_codes, ...rest } = updatedRecord;
  tables.users = [{ ...rest, totpSecret: totp_secret, totpBackupCodes: totp_backup_codes }];
  // Sanity: the stored values really are ciphertext now.
  expect(tables.users[0].totpSecret).not.toBe(SECRET);
  expect(LazyFieldEncryption.isPlaintextField(String(tables.users[0].totpSecret))).toBe(false);
}

let server: http.Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const authenticateJWT: express.RequestHandler = (req, _res, next) => {
    (req as unknown as { userId?: string }).userId = req.header("x-user") || undefined;
    next();
  };
  const router = express.Router();
  registerUserTotpRoutes(router, {
    authenticateJWT,
    authManager: {
      getUserDataKey: () => (dataKeyAvailable ? DATA_KEY : null),
      verifyJWTToken: async (t: string) => (t === "temp" ? { userId: USER, pendingTOTP: true } : null),
      generateJWTToken: async () => "jwt",
      getSecureCookieOptions: () => ({}),
    } as never,
  });
  app.use("/users", router);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  dataKeyAvailable = true;
  tables.sessions = [];
  tables.trusted_devices = [];
});

async function post(path: string, body: unknown, user: string | null = USER) {
  const r = await fetch(`${base}/users${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(user ? { "x-user": user } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

describe("two-step routes with the secret encrypted at rest", () => {
  it("disable accepts the current code", async () => {
    seedEncryptedUser();
    const r = await post("/totp/disable", { password: "pw", totp_code: now() });
    expect(r.status).toBe(200);
    expect(tables.users[0].totpEnabled).toBe(false);
  });

  it("disable still rejects a wrong code", async () => {
    seedEncryptedUser();
    const r = await post("/totp/disable", { password: "pw", totp_code: "abcdef" });
    expect(r.status).toBe(401);
    expect(tables.users[0].totpEnabled).toBe(true);
  });

  it("backup-codes accepts the current code", async () => {
    seedEncryptedUser();
    const r = await post("/totp/backup-codes", { password: "pw", totp_code: now() });
    expect(r.status).toBe(200);
    expect(r.body.backup_codes).toHaveLength(8);
  });

  it("enable accepts the current code when a sign-in landed between setup and enable", async () => {
    seedEncryptedUser(false);
    const r = await post("/totp/enable", { totp_code: now() });
    expect(r.status).toBe(200);
    expect(tables.users[0].totpEnabled).toBe(true);
  });

  it("answers session expired, not invalid code, without the data key", async () => {
    for (const [path, body, enabled] of [
      ["/totp/disable", { password: "pw", totp_code: now() }, true],
      ["/totp/backup-codes", { password: "pw", totp_code: now() }, true],
      ["/totp/enable", { totp_code: now() }, false],
    ] as const) {
      seedEncryptedUser(enabled);
      dataKeyAvailable = false;
      const r = await post(path, body);
      expect(r.status).toBe(401);
      expect(r.body.code).toBe("SESSION_EXPIRED");
    }
  });

  it("sign-in accepts an encrypted backup code, once", async () => {
    seedEncryptedUser();
    const first = await post("/totp/verify-login", { temp_token: "temp", totp_code: BACKUPS[1] }, null);
    expect(first.status).toBe(200);
    expect(JSON.parse(String(tables.users[0].totpBackupCodes))).toEqual([BACKUPS[0]]);
    const again = await post("/totp/verify-login", { temp_token: "temp", totp_code: BACKUPS[1] }, null);
    expect(again.status).toBe(401);
  });

  it("sign-in still accepts the current code", async () => {
    seedEncryptedUser();
    const r = await post("/totp/verify-login", { temp_token: "temp", totp_code: now() }, null);
    expect(r.status).toBe(200);
  });
});
