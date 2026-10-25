/**
 * An admin setting a forgotten password: data is kept when the server can
 * unlock it (signed in somewhere, or a password+SSO account), wiped only when
 * the request says so, admins are never reset, and the user is always signed
 * out with their keys cancelled. Runs against a real in-memory database so
 * the wipe's SQL is exercised. (The admin and confirm checks themselves are
 * covered elsewhere; here they're let through.)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";

let sqlite: Database.Database;

vi.mock("../db/index.js", () => ({
  db: {
    get $client() {
      return sqlite;
    },
  },
  DatabaseSaveTrigger: { forceSave: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../../utils/logger.js", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() };
  return { authLogger: l };
});
vi.mock("../../utils/recent-auth.js", () => ({
  requireRecentAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { registerUserAdminPasswordRoutes } from "./user-admin-password-routes.js";

const auth = {
  dataKey: null as Buffer | null,
  getUserDataKey: vi.fn(() => auth.dataKey),
  authenticateOIDCUser: vi.fn(async () => {
    auth.dataKey = Buffer.from("sso-unlocked");
    return true;
  }),
  resetUserPasswordWithPreservedDEK: vi.fn().mockResolvedValue(true),
  registerUser: vi.fn().mockResolvedValue(undefined),
  logoutUser: vi.fn().mockResolvedValue(undefined),
  revokeUserApiKeys: vi.fn().mockResolvedValue(undefined),
};

const PER_USER_TABLES = [
  "ssh_credential_usage",
  "file_manager_recent",
  "file_manager_pinned",
  "file_manager_shortcuts",
  "recent_activity",
  "dismissed_alerts",
  "snippets",
  "opkssh_tokens",
  "ssh_credentials",
];

function bootstrap(): void {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, password_hash TEXT, is_admin INTEGER DEFAULT 0,
      is_oidc INTEGER DEFAULT 0, totp_enabled INTEGER DEFAULT 0, totp_secret TEXT, totp_backup_codes TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE ssh_data (id INTEGER PRIMARY KEY, user_id TEXT);
    CREATE TABLE host_access (id INTEGER PRIMARY KEY, host_id INTEGER, user_id TEXT);
    CREATE TABLE shared_credentials (id INTEGER PRIMARY KEY, target_user_id TEXT, needs_re_encryption INTEGER DEFAULT 0);
  `);
  for (const t of PER_USER_TABLES) sqlite.exec(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, user_id TEXT)`);

  sqlite
    .prepare(
      "INSERT INTO users (id, username, password_hash, is_admin, is_oidc, totp_enabled, totp_secret) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run("u2", "beta", "old-hash", 0, 0, 1, "secret");
  sqlite.prepare("INSERT INTO users (id, username, password_hash, is_admin) VALUES ('other', 'other', 'h', 0)").run();
  for (let i = 1; i <= 3; i++) sqlite.prepare("INSERT INTO ssh_data (id, user_id) VALUES (?, 'u2')").run(i);
  sqlite.prepare("INSERT INTO ssh_data (id, user_id) VALUES (9, 'other')").run();
  sqlite.prepare("INSERT INTO host_access (host_id, user_id) VALUES (1, 'other')").run();
  for (const t of PER_USER_TABLES) {
    sqlite.prepare(`INSERT INTO ${t} (user_id) VALUES ('u2')`).run();
    sqlite.prepare(`INSERT INTO ${t} (user_id) VALUES ('other')`).run();
  }
  sqlite.prepare("INSERT INTO shared_credentials (target_user_id) VALUES ('u2')").run();
}

const count = (sql: string) => (sqlite.prepare(sql).get() as { c: number }).c;
const user = () =>
  sqlite.prepare("SELECT * FROM users WHERE id = 'u2'").get() as Record<string, unknown>;

let server: http.Server;
let base: string;

beforeAll(async () => {
  process.env.SALT = "4";
  const app = express();
  app.use(express.json());
  const router = express.Router();
  registerUserAdminPasswordRoutes(router, {
    authManager: auth as never,
    requireAdmin: (req, _res, next) => {
      (req as unknown as { userId: string }).userId = "admin-1";
      next();
    },
  });
  app.use("/users", router);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
beforeEach(() => {
  sqlite?.close();
  bootstrap();
  vi.clearAllMocks();
  auth.dataKey = null;
  auth.resetUserPasswordWithPreservedDEK.mockResolvedValue(true);
  auth.revokeUserApiKeys.mockResolvedValue(undefined);
  auth.registerUser.mockResolvedValue(undefined);
});

async function setPassword(body: unknown, id = "u2") {
  const res = await fetch(`${base}/users/${id}/set-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("admin sets a user's password", () => {
  it("keeps everything when the user's data is unlocked, and signs them out", async () => {
    auth.dataKey = Buffer.from("k");
    const res = await setPassword({ password: "new-pass" });
    expect(res.status).toBe(200);
    expect(res.body.dataKept).toBe(true);
    expect(auth.resetUserPasswordWithPreservedDEK).toHaveBeenCalledWith("u2", "new-pass");
    expect(count("SELECT COUNT(*) c FROM ssh_data WHERE user_id = 'u2'")).toBe(3);
    expect(user().password_hash).not.toBe("old-hash");
    expect(user().totp_enabled).toBe(1);
    expect(auth.registerUser).not.toHaveBeenCalled();
    expect(auth.logoutUser).toHaveBeenCalledWith("u2");
    expect(auth.revokeUserApiKeys).toHaveBeenCalledWith("u2", "admin_set_password");
  });

  it("keeps everything for an account that also signs in with SSO, even when signed out", async () => {
    sqlite.prepare("INSERT INTO settings (key, value) VALUES ('user_encrypted_dek_oidc_u2', 'x')").run();
    const res = await setPassword({ password: "new-pass" });
    expect(res.status).toBe(200);
    expect(res.body.dataKept).toBe(true);
    expect(auth.authenticateOIDCUser).toHaveBeenCalledWith("u2");
    expect(count("SELECT COUNT(*) c FROM ssh_data WHERE user_id = 'u2'")).toBe(3);
    expect(auth.registerUser).not.toHaveBeenCalled();
  });

  it("refuses when data is locked and wiping wasn't asked for, saying what would be lost", async () => {
    const res = await setPassword({ password: "new-pass" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DATA_WOULD_BE_WIPED");
    expect(res.body.wouldLose).toEqual({
      hosts: 3,
      credentials: 1,
      snippets: 1,
      fileManagerPins: 1,
      fileManagerRecents: 1,
      fileManagerShortcuts: 1,
      accessTheyGaveOthers: 1,
      twoStepCodes: true,
    });
    expect(user().password_hash).toBe("old-hash");
    expect(count("SELECT COUNT(*) c FROM ssh_data")).toBe(4);
    expect(auth.authenticateOIDCUser).not.toHaveBeenCalled();
    expect(auth.logoutUser).not.toHaveBeenCalled();
  });

  it("wipes only that user's locked data when told to, turns off two-step codes, and re-locks shared hosts", async () => {
    const res = await setPassword({ password: "new-pass", allowWipe: true });
    expect(res.status).toBe(200);
    expect(res.body.dataKept).toBe(false);
    expect(count("SELECT COUNT(*) c FROM ssh_data WHERE user_id = 'u2'")).toBe(0);
    expect(count("SELECT COUNT(*) c FROM ssh_data WHERE user_id = 'other'")).toBe(1);
    for (const t of PER_USER_TABLES) {
      expect(count(`SELECT COUNT(*) c FROM ${t} WHERE user_id = 'u2'`)).toBe(0);
      expect(count(`SELECT COUNT(*) c FROM ${t} WHERE user_id = 'other'`)).toBe(1);
    }
    expect(count("SELECT needs_re_encryption c FROM shared_credentials WHERE target_user_id = 'u2'")).toBe(1);
    expect(user()).toMatchObject({ totp_enabled: 0, totp_secret: null });
    expect(user().password_hash).not.toBe("old-hash");
    expect(auth.registerUser).toHaveBeenCalledWith("u2", "new-pass");
    expect(auth.logoutUser).toHaveBeenCalledWith("u2");
    expect(auth.revokeUserApiKeys).toHaveBeenCalled();
  });

  it("leaves the old password in place when re-locking their data fails", async () => {
    auth.registerUser.mockRejectedValueOnce(new Error("boom"));
    const res = await setPassword({ password: "new-pass", allowWipe: true });
    expect(res.status).toBe(500);
    expect(user().password_hash).toBe("old-hash");
    expect(user().totp_enabled).toBe(1);
  });

  it("never resets an admin account", async () => {
    sqlite.prepare("UPDATE users SET is_admin = 1 WHERE id = 'u2'").run();
    auth.dataKey = Buffer.from("k");
    const res = await setPassword({ password: "new-pass", allowWipe: true });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TARGET_IS_ADMIN");
    expect(user().password_hash).toBe("old-hash");
    expect(auth.logoutUser).not.toHaveBeenCalled();
  });

  it("refuses an SSO-only account", async () => {
    sqlite.prepare("UPDATE users SET is_oidc = 1, password_hash = '' WHERE id = 'u2'").run();
    const res = await setPassword({ password: "new-pass", allowWipe: true });
    expect(res.status).toBe(400);
    expect(count("SELECT COUNT(*) c FROM ssh_data WHERE user_id = 'u2'")).toBe(3);
  });

  it("needs a password of at least 6 characters and a real yes/no for wiping", async () => {
    expect((await setPassword({})).status).toBe(400);
    expect((await setPassword({ password: "short" })).status).toBe(400);
    expect((await setPassword({ password: "new-pass", allowWipe: "yes" })).status).toBe(400);
  });

  it("404s for an unknown user", async () => {
    expect((await setPassword({ password: "new-pass" }, "nobody")).status).toBe(404);
  });

  it("says so when cancelling their keys fails", async () => {
    auth.dataKey = Buffer.from("k");
    auth.revokeUserApiKeys.mockRejectedValueOnce(new Error("boom"));
    const res = await setPassword({ password: "new-pass" });
    expect(res.status).toBe(500);
    expect(String(res.body.error)).toMatch(/access keys/);
  });
});
