/**
 * Phase 85 Plan 07: End-to-end integration test for the full user-avatar lifecycle.
 *
 * This test exercises the COMPLETE Phase 85 chain end-to-end:
 *   POST /users/create (multipart)
 *     → multer validates bytes in memory
 *     → writeUserAvatar writes REAL file to tmp DATA_DIR
 *     → INSERT users row with avatar_path
 *     → DatabaseSaveTrigger.forceSave("phase-85-user-avatar-create") spy fires
 *   GET /users/:id/avatar
 *     → reads REAL file from disk
 *     → returns correct Content-Type + bytes
 *   PUT /users/:id/avatar
 *     → writeUserAvatar writes REAL new file
 *     → UPDATE users row (raw SQL, mirrors users.ts change-endpoint)
 *     → unlinkUserAvatar removes REAL old file (ext-swap case)
 *     → DatabaseSaveTrigger.forceSave("phase-85-user-avatar-change") spy fires
 *   GET /users/:id/avatar (second time)
 *     → new bytes + new Content-Type
 *   DELETE /users/delete-account
 *     → unlinkUserAvatar removes REAL avatar file
 *     → DELETE users row
 *   Verify: USER_AVATARS_DIR empty, both spy labels fired
 *
 * What is REAL (not mocked):
 *   - Filesystem I/O: writeUserAvatar, unlinkUserAvatar, readUserAvatar (user-avatar-storage.ts)
 *   - multer multipart parsing (runs for real in the Express handler)
 *   - SQLite in-memory DB ($client.prepare, transaction, db.select, db.update, db.delete)
 *   - USER_AVATARS_DIR creation via mkdir { recursive: true }
 *
 * What is spied/mocked:
 *   - DatabaseSaveTrigger.forceSave: vi.fn() spy (resolves void, records calls)
 *   - authenticateJWT: injects req.userId from test-controlled authControl
 *   - AuthManager (registerUser, bcrypt interactions): stubs for create/delete paths
 *   - bcryptjs.compare: stub returning true (skip real hash verification)
 *   - logger (authLogger, databaseLogger): suppress console noise
 *   - misc sub-routers (registerUser*Routes): vi.fn() no-ops
 *
 * Why separate from users.test.ts:
 *   (a) Heavier setup: real file I/O + spy-per-step assertions at each lifecycle point
 *   (b) Single-flow design: each step depends on the state of the previous (not isolated units)
 *   (c) Runnable in isolation via `npx vitest run **\/*.integration.test.ts`
 *
 * Setup strategy: one beforeAll for server + DATA_DIR (like users.test.ts),
 * beforeEach resets DB state + spy + avatar files. vi.resetModules() is NOT
 * called per-test because the hoisted vi.mock factory (db/index.js) already
 * captures the stable forceSaveFn reference at module-load time.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// In-memory SQLite DB — fresh per-test, shared via module-level var
// ---------------------------------------------------------------------------

let sqliteDb: InstanceType<typeof Database>;

// ---------------------------------------------------------------------------
// forceSave spy — declared at module scope so vi.mock factory can close over it.
// The vi.fn() is created here and referenced inside the factory.
// ---------------------------------------------------------------------------

const forceSaveFn = vi.fn<[string], Promise<void>>().mockResolvedValue(undefined);

// ---------------------------------------------------------------------------
// Mock: DatabaseSaveTrigger — spy; resolves void
// ---------------------------------------------------------------------------

// We share a pendingWhereVal across the module-level closure.
let pendingWhereVal: unknown = null;

vi.mock("../db/index.js", () => {
  function camelizeUser(row: Record<string, unknown>) {
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      isAdmin: row.is_admin === 1,
      isOidc: row.is_oidc === 1,
      avatarPath: row.avatar_path ?? null,
      mxid: row.mxid ?? null,
    };
  }

  function buildSelectChain() {
    let fromTable: string | null = null;
    let limitVal: number | null = null;

    const chain: Record<string, unknown> = {
      from(table: unknown) {
        const tSym = (table as Record<symbol, unknown>)[Symbol.for("drizzle:Name")];
        fromTable = typeof tSym === "string" ? tSym : String(table);
        return chain;
      },
      where(predicate: unknown) {
        void predicate;
        return chain;
      },
      limit(n: number) {
        limitVal = n;
        return chain;
      },
      then(resolve: (v: unknown[]) => unknown, reject: (e: unknown) => unknown) {
        try {
          const val = pendingWhereVal;
          pendingWhereVal = null;
          if (fromTable === "users") {
            const rows = val != null
              ? (sqliteDb.prepare(
                  "SELECT * FROM users WHERE id = ? OR username = ?",
                ).all(val as string, val as string) as Record<string, unknown>[])
              : (sqliteDb.prepare("SELECT * FROM users").all() as Record<string, unknown>[]);
            const mapped = rows.map(camelizeUser);
            resolve(limitVal != null ? mapped.slice(0, limitVal) : mapped);
          } else if (fromTable === "sessions") {
            resolve([]);
          } else if (fromTable === "roles") {
            const rows = val != null
              ? sqliteDb.prepare("SELECT * FROM roles WHERE name = ?").all(val as string)
              : sqliteDb.prepare("SELECT * FROM roles").all();
            resolve(rows as unknown[]);
          } else if (fromTable === "settings") {
            const rows = val != null
              ? sqliteDb.prepare("SELECT * FROM settings WHERE key = ?").all(val as string)
              : sqliteDb.prepare("SELECT * FROM settings").all();
            resolve(rows as unknown[]);
          } else {
            resolve([]);
          }
        } catch (e) {
          reject(e);
        }
      },
      catch(handler: (e: unknown) => unknown) {
        void handler;
        return chain;
      },
    };
    return chain;
  }

  const dbProxy = {
    get $client() {
      return sqliteDb;
    },
    select(_cols?: unknown) {
      return buildSelectChain();
    },
    insert(table: unknown) {
      return {
        values(vals: Record<string, unknown>) {
          return {
            run() {
              const tSym = (table as Record<symbol, unknown>)[Symbol.for("drizzle:Name")];
              const tableName = typeof tSym === "string" ? tSym : String(table);
              if (tableName === "user_roles") {
                try {
                  sqliteDb
                    .prepare(
                      "INSERT OR IGNORE INTO user_roles (user_id, role_id, granted_by) VALUES (?, ?, ?)",
                    )
                    .run(vals.userId, vals.roleId, vals.grantedBy);
                } catch {
                  // non-fatal
                }
              }
            },
          };
        },
      };
    },
    update(table: unknown) {
      void table;
      return {
        set(vals: Record<string, unknown>) {
          return {
            where(predicate: unknown) {
              void predicate;
              const targetId = pendingWhereVal as string | null;
              pendingWhereVal = null;
              return Promise.resolve().then(() => {
                if (targetId && vals.avatarPath !== undefined) {
                  sqliteDb
                    .prepare("UPDATE users SET avatar_path = ? WHERE id = ?")
                    .run(vals.avatarPath, targetId);
                }
              });
            },
          };
        },
      };
    },
    delete(table: unknown) {
      void table;
      return {
        where(predicate: unknown) {
          void predicate;
          const targetId = pendingWhereVal as string | null;
          pendingWhereVal = null;
          return Promise.resolve().then(() => {
            if (targetId) {
              sqliteDb.prepare("DELETE FROM users WHERE id = ?").run(targetId);
            }
          });
        },
      };
    },
  };

  return {
    get db() {
      return dbProxy;
    },
    DatabaseSaveTrigger: {
      get forceSave() {
        return forceSaveFn;
      },
    },
    saveMemoryDatabaseToFile: vi.fn().mockResolvedValue(undefined),
  };
});

// eq() mock — stashes the comparison value for the $client chains
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (_col: unknown, val: unknown) => {
      pendingWhereVal = val;
      return { _col, val };
    },
  };
});

// ---------------------------------------------------------------------------
// Mock: auth-manager — injects req.userId via authControl (mirrors users.test.ts)
// Also stubs registerUser (needed for POST /users/create path).
// ---------------------------------------------------------------------------

const authControl = { userId: "alice-placeholder", pass: true };
const mockRegisterUser = vi.fn<[string, string], Promise<void>>().mockResolvedValue(undefined);

vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware: () => (req: unknown, res: unknown, next: () => void) => {
        if (!authControl.pass) {
          (res as import("express").Response).status(401).json({ error: "Unauthorized" });
          return;
        }
        (req as Record<string, unknown>).userId = authControl.userId;
        next();
      },
      createAdminMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
      registerUser: (...args: [string, string]) => mockRegisterUser(...args),
      generateJWTToken: vi.fn().mockResolvedValue("fake-jwt-token"),
      verifyJWTToken: vi.fn().mockResolvedValue({ userId: authControl.userId, sessionId: "session-1" }),
      getSecureCookieOptions: vi.fn().mockReturnValue({}),
      getClearCookieOptions: vi.fn().mockReturnValue({}),
      logoutUser: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

// bcrypt — stub compare to always succeed (skip real hash verification in integration test)
vi.mock("bcryptjs", () => ({
  default: {
    hash: async (_p: string, _r: number) => "hashed-s3cret",
    compare: async (_plain: string, _hash: string) => true,
  },
  hash: async (_p: string, _r: number) => "hashed-s3cret",
  compare: async (_plain: string, _hash: string) => true,
}));

// ---------------------------------------------------------------------------
// Mock: logger — suppress console noise
// ---------------------------------------------------------------------------

vi.mock("../../utils/logger.js", () => ({
  authLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  databaseLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock: misc modules imported by users.ts not exercised in these tests
// ---------------------------------------------------------------------------

vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: {
    getUserDataKey: vi.fn(),
    encryptRecord: vi.fn(),
    decryptRecord: vi.fn(),
  },
}));
vi.mock("../../utils/user-agent-parser.js", () => ({
  parseUserAgent: vi.fn(() => ({
    type: "desktop",
    browser: "chrome",
    os: "linux",
    deviceInfo: "integration-test-device",
  })),
  generateDeviceFingerprint: vi.fn(() => "fp-integration-test"),
}));
vi.mock("../../utils/login-rate-limiter.js", () => ({
  loginRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../utils/request-origin.js", () => ({
  getRequestOriginWithForceHTTPS: vi.fn(() => "http://localhost:3000"),
}));
vi.mock("./delete-user-data.js", () => ({
  deleteUserAndRelatedData: vi.fn(async () => {}),
}));
vi.mock("./user-oidc-utils.js", () => ({
  getOIDCConfigFromEnv: vi.fn(() => null),
  isOIDCUserAllowed: vi.fn(() => true),
  verifyOIDCToken: vi.fn(async () => ({})),
}));
vi.mock("./user-api-key-routes.js", () => ({ registerUserApiKeyRoutes: vi.fn() }));
vi.mock("./user-settings-routes.js", () => ({ registerUserSettingsRoutes: vi.fn() }));
vi.mock("./user-totp-routes.js", () => ({ registerUserTotpRoutes: vi.fn() }));
vi.mock("./user-session-routes.js", () => ({ registerUserSessionRoutes: vi.fn() }));
vi.mock("./user-oidc-account-routes.js", () => ({ registerUserOidcAccountRoutes: vi.fn() }));
vi.mock("./user-password-reset-routes.js", () => ({ registerUserPasswordResetRoutes: vi.fn() }));
vi.mock("./user-admin-routes.js", () => ({ registerUserAdminRoutes: vi.fn() }));
vi.mock("./user-data-access-routes.js", () => ({ registerUserDataAccessRoutes: vi.fn() }));
vi.mock("../../utils/shared-credential-manager.js", () => ({
  SharedCredentialManager: {
    getInstance: () => ({
      reEncryptPendingCredentialsForUser: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Image byte fixtures
// Multer validates Content-Type (client-declared), not file magic bytes —
// so any non-empty Buffer with the correct Content-Type header passes multer.
// We use recognizable byte patterns so we can assert bytes-match round-trips.
// ---------------------------------------------------------------------------

// Minimal PNG header (8 bytes magic) + recognizable trailer bytes.
const validPngBytes = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic
  0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03, 0x04, // recognizable payload
]);

// Minimal WebP: RIFF header + WEBP fourCC + recognizable payload.
const validWebpBytes = Buffer.from([
  0x52, 0x49, 0x46, 0x46, // "RIFF"
  0x14, 0x00, 0x00, 0x00, // chunk size (little-endian)
  0x57, 0x45, 0x42, 0x50, // "WEBP"
  0xca, 0xfe, 0xba, 0xbe, // recognizable payload
  0x05, 0x06, 0x07, 0x08,
]);

// ---------------------------------------------------------------------------
// Multipart request helpers (copied from identity-avatar-batch.test.ts pattern)
// ---------------------------------------------------------------------------

function buildMultipartBody(
  fieldName: string,
  filename: string,
  contentType: string,
  fileBytes: Buffer,
  boundary: string,
): Buffer {
  const parts: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`,
    ),
    fileBytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];
  return Buffer.concat(parts);
}

function buildMultipartBodyMixed(
  textFields: Record<string, string>,
  file: { fieldName: string; filename: string; contentType: string; bytes: Buffer },
  boundary: string,
): Buffer {
  const parts: Buffer[] = [];

  for (const [name, value] of Object.entries(textFields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${name}"\r\n\r\n`,
      ),
      Buffer.from(value),
      Buffer.from("\r\n"),
    );
  }

  // File part
  parts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType}\r\n\r\n`,
    ),
    file.bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );

  return Buffer.concat(parts);
}

/**
 * httpRequest — low-level helper: sends an HTTP request to the ephemeral server.
 */
function httpRequest(
  server: http.Server,
  opts: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: Buffer;
  },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; bodyRaw: Buffer }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: opts.method,
        path: opts.path,
        headers: opts.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            bodyRaw: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on("error", reject);
    if (opts.body) {
      req.write(opts.body);
    }
    req.end();
  });
}

async function postMultipartCreate(
  server: http.Server,
  opts: {
    textFields: Record<string, string>;
    file: { filename: string; contentType: string; bytes: Buffer };
  },
): Promise<{ status: number; body: unknown }> {
  const boundary = "phase85-integration-create";
  const body = buildMultipartBodyMixed(
    opts.textFields,
    { fieldName: "avatar", ...opts.file },
    boundary,
  );
  const { status, bodyRaw } = await httpRequest(server, {
    method: "POST",
    path: "/users/create",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyRaw.toString());
  } catch {
    parsed = bodyRaw.toString();
  }
  return { status, body: parsed };
}

async function getAvatar(
  server: http.Server,
  userId: string,
  jwt: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer | unknown }> {
  const { status, headers, bodyRaw } = await httpRequest(server, {
    method: "GET",
    path: `/users/${userId}/avatar`,
    headers: { Authorization: `Bearer ${jwt}` },
  });
  let body: Buffer | unknown;
  try {
    body = JSON.parse(bodyRaw.toString());
  } catch {
    body = bodyRaw; // binary image bytes
  }
  return { status, headers, body };
}

async function putAvatar(
  server: http.Server,
  userId: string,
  jwt: string,
  file: { filename: string; contentType: string; bytes: Buffer },
): Promise<{ status: number; body: unknown }> {
  const boundary = "phase85-integration-put";
  const body = buildMultipartBody("avatar", file.filename, file.contentType, file.bytes, boundary);
  const { status, bodyRaw } = await httpRequest(server, {
    method: "PUT",
    path: `/users/${userId}/avatar`,
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length),
      Authorization: `Bearer ${jwt}`,
    },
    body,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyRaw.toString());
  } catch {
    parsed = bodyRaw.toString();
  }
  return { status, body: parsed };
}

/**
 * deleteAccount — DELETE /users/delete-account with Bearer auth + JSON body.
 * bcrypt.compare is stubbed to return true, so any password string works.
 */
async function deleteAccount(
  server: http.Server,
  jwt: string,
  password: string,
): Promise<{ status: number; body: unknown }> {
  const bodyJson = Buffer.from(JSON.stringify({ password }));
  const { status, bodyRaw } = await httpRequest(server, {
    method: "DELETE",
    path: "/users/delete-account",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(bodyJson.length),
      Authorization: `Bearer ${jwt}`,
    },
    body: bodyJson,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyRaw.toString());
  } catch {
    parsed = bodyRaw.toString();
  }
  return { status, body: parsed };
}

// ---------------------------------------------------------------------------
// DB bootstrap
// ---------------------------------------------------------------------------

function bootstrapDb(): void {
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      is_oidc INTEGER NOT NULL DEFAULT 0,
      oidc_identifier TEXT,
      client_id TEXT NOT NULL DEFAULT '',
      client_secret TEXT NOT NULL DEFAULT '',
      issuer_url TEXT NOT NULL DEFAULT '',
      authorization_url TEXT NOT NULL DEFAULT '',
      token_url TEXT NOT NULL DEFAULT '',
      identifier_path TEXT NOT NULL DEFAULT '',
      name_path TEXT NOT NULL DEFAULT '',
      scopes TEXT NOT NULL DEFAULT 'openid email profile',
      totp_secret TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      totp_backup_codes TEXT,
      mxid TEXT,
      avatar_path TEXT,
      queue_slots INTEGER NOT NULL DEFAULT 5
    )
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT
    )
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      granted_by TEXT,
      PRIMARY KEY (user_id, role_id)
    )
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
  `);
  sqliteDb
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('allow_registration', 'true')")
    .run();
  sqliteDb
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('allow_password_login', 'true')")
    .run();
  sqliteDb.prepare("INSERT OR IGNORE INTO roles (id, name) VALUES ('role-admin', 'admin')").run();
  sqliteDb.prepare("INSERT OR IGNORE INTO roles (id, name) VALUES ('role-user', 'user')").run();

  // Pre-seed one admin user so Alice (created during the test) is NOT the first
  // user and therefore is NOT made admin. This prevents the "cannot delete last
  // admin" 403 from firing when the test calls DELETE /users/delete-account.
  sqliteDb
    .prepare(
      "INSERT OR IGNORE INTO users (id, username, password_hash, is_admin, is_oidc, avatar_path) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run("seed-admin-id", "seed-admin", "hashed-admin", 1, 0, null);
}

// ---------------------------------------------------------------------------
// Server lifecycle — one server per suite (beforeAll/afterAll)
// ---------------------------------------------------------------------------

let globalServer: http.Server;
let tmpDir: string;
let originalDataDir: string | undefined;
let userAvatarsDir: string;

describe("Phase 85 end-to-end lifecycle", () => {
  // Start the Express server ONCE. DATA_DIR is set before the import so
  // user-avatar-storage.ts picks it up at module-load time.
  beforeAll(async () => {
    originalDataDir = process.env.DATA_DIR;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "phase-85-integration-"));
    process.env.DATA_DIR = tmpDir;
    userAvatarsDir = path.join(tmpDir, "user-avatars");

    // Bootstrap initial DB so the server has a valid DB on first import.
    sqliteDb = new Database(":memory:");
    bootstrapDb();

    // Import the users router (vi.mock already in effect).
    const mod = await import("./users.js");
    const usersRouter = mod.default;
    const app = express();
    app.use(express.json()); // needed for delete-account JSON body
    app.use("/users", usersRouter);
    globalServer = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
  }, 60_000);

  afterAll(async () => {
    if (globalServer) {
      await new Promise<void>((resolve) => globalServer.close(() => resolve()));
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
    if (originalDataDir !== undefined) {
      process.env.DATA_DIR = originalDataDir;
    } else {
      delete process.env.DATA_DIR;
    }
    sqliteDb?.close();
  });

  beforeEach(async () => {
    // Fresh SQLite DB for each test.
    sqliteDb?.close();
    sqliteDb = new Database(":memory:");
    bootstrapDb();

    // Reset spy and mock call state.
    forceSaveFn.mockClear();
    mockRegisterUser.mockClear();

    // Reset auth control.
    authControl.pass = true;
    authControl.userId = "alice-placeholder";
    pendingWhereVal = null;

    // Clean any leftover avatar files from a previous test run.
    try {
      const files = await fs.readdir(userAvatarsDir);
      for (const f of files) {
        await fs.unlink(path.join(userAvatarsDir, f));
      }
    } catch {
      // Dir may not exist yet — that's fine
    }
  });

  afterEach(async () => {
    // Clean up any avatar files created during the test (in case the test
    // failed midway and left stray files).
    try {
      const files = await fs.readdir(userAvatarsDir);
      for (const f of files) {
        await fs.unlink(path.join(userAvatarsDir, f));
      }
    } catch {
      // best-effort
    }
  });

  // =========================================================================
  // THE SINGLE FLOW TEST
  //
  // Steps:
  //  1. POST /users/create — multipart PNG → row + real file on disk + spy fired
  //  2. "Login" — set authControl.userId from the created user's real id
  //  3. GET /users/:id/avatar → PNG bytes round-trip verified
  //  4. PUT /users/:id/avatar — WebP ext-swap → new file, old file unlinked, spy fired
  //  5. GET /users/:id/avatar → WebP bytes round-trip verified
  //  6. DELETE /users/delete-account → row gone + avatar file gone from disk
  //  7. USER_AVATARS_DIR empty (no stray files)
  //  8. Both forceSave labels emitted across lifecycle
  // =========================================================================

  it("create → serve → change → serve → delete → verify-clean", async () => {
    // -------------------------------------------------------------------------
    // STEP 1: POST /users/create with multipart PNG avatar
    // -------------------------------------------------------------------------

    const createRes = await postMultipartCreate(globalServer, {
      textFields: { username: "alice", password: "s3cret" },
      file: {
        filename: "avatar.png",
        contentType: "image/png",
        bytes: validPngBytes,
      },
    });

    expect(createRes.status).toBe(200);
    const createBody = createRes.body as { message: string };
    expect(createBody.message).toBe("User created");

    // Inspect DB row to get alice's real id (nanoid-generated by users.ts).
    const rowAfterCreate = sqliteDb
      .prepare("SELECT id, username, avatar_path FROM users WHERE username = ?")
      .get("alice") as
      | { id: string; username: string; avatar_path: string | null }
      | undefined;

    expect(rowAfterCreate).toBeDefined();
    expect(rowAfterCreate!.username).toBe("alice");
    expect(rowAfterCreate!.avatar_path).toBeTruthy();
    // Filename convention: {userId}.{ext} — should be {aliceId}.png
    expect(rowAfterCreate!.avatar_path).toMatch(/\.png$/);

    const aliceId = rowAfterCreate!.id;
    const pngFilename = rowAfterCreate!.avatar_path!;
    const pngPath = path.join(userAvatarsDir, pngFilename);

    // Assert real file exists on disk with byte-for-byte match.
    const bytesOnDiskAfterCreate = await fs.readFile(pngPath);
    expect(bytesOnDiskAfterCreate.equals(validPngBytes)).toBe(true);

    // Assert forceSave spy fired with the create label.
    expect(forceSaveFn).toHaveBeenCalledWith("phase-85-user-avatar-create");
    forceSaveFn.mockClear(); // reset counter so Step 4 assertion is scoped to change

    // -------------------------------------------------------------------------
    // STEP 2: "Login" — set authControl.userId = aliceId
    // (The mock auth middleware reads authControl.userId at request time, so
    //  setting it here ensures all subsequent authenticated requests identify as Alice.)
    // Any non-empty string works as the JWT since the mock ignores it.
    // -------------------------------------------------------------------------

    authControl.userId = aliceId;
    const aliceJwt = "alice-phase85-integration-jwt";

    // -------------------------------------------------------------------------
    // STEP 3: GET /users/:id/avatar → PNG bytes round-trip
    // -------------------------------------------------------------------------

    const getRes1 = await getAvatar(globalServer, aliceId, aliceJwt);

    expect(getRes1.status).toBe(200);
    expect(getRes1.headers["content-type"]).toBe("image/png");
    // Body must be a raw Buffer (binary, not JSON)
    expect(Buffer.isBuffer(getRes1.body)).toBe(true);
    expect((getRes1.body as Buffer).equals(validPngBytes)).toBe(true);

    // -------------------------------------------------------------------------
    // STEP 4: PUT /users/:id/avatar — change PNG → WebP (ext-swap case)
    // new-file-then-row-UPDATE-then-old-file-unlink ordering per RESEARCH.md § 5
    // -------------------------------------------------------------------------

    const putRes = await putAvatar(globalServer, aliceId, aliceJwt, {
      filename: "new-avatar.webp",
      contentType: "image/webp",
      bytes: validWebpBytes,
    });

    expect(putRes.status).toBe(200);
    const putBody = putRes.body as { id: string; avatarPath: string };
    expect(putBody.id).toBe(aliceId);
    expect(putBody.avatarPath).toMatch(/\.webp$/);

    const webpFilename = putBody.avatarPath;
    const webpPath = path.join(userAvatarsDir, webpFilename);

    // Assert row pointer updated to the new .webp filename.
    const rowAfterChange = sqliteDb
      .prepare("SELECT avatar_path FROM users WHERE id = ?")
      .get(aliceId) as { avatar_path: string | null } | undefined;
    expect(rowAfterChange?.avatar_path).toBe(webpFilename);
    expect(rowAfterChange?.avatar_path).toMatch(/\.webp$/);

    // Assert new .webp file exists on disk with correct bytes.
    const webpBytesOnDisk = await fs.readFile(webpPath);
    expect(webpBytesOnDisk.equals(validWebpBytes)).toBe(true);

    // Assert old .png file was unlinked (ext-swap: pngFilename !== webpFilename).
    // The unlink fires AFTER the row UPDATE succeeds (new-file-then-row-then-old-unlink).
    await expect(fs.access(pngPath)).rejects.toThrow();

    // Assert forceSave spy fired with the change label.
    expect(forceSaveFn).toHaveBeenCalledWith("phase-85-user-avatar-change");

    // -------------------------------------------------------------------------
    // STEP 5: GET /users/:id/avatar again — should now return WebP bytes
    // -------------------------------------------------------------------------

    const getRes2 = await getAvatar(globalServer, aliceId, aliceJwt);

    expect(getRes2.status).toBe(200);
    expect(getRes2.headers["content-type"]).toBe("image/webp");
    expect(Buffer.isBuffer(getRes2.body)).toBe(true);
    expect((getRes2.body as Buffer).equals(validWebpBytes)).toBe(true);

    // -------------------------------------------------------------------------
    // STEP 6: DELETE /users/delete-account — self-delete
    // Requires password in JSON body; bcrypt.compare is stubbed → always true.
    // The delete-account handler fetches avatar_path BEFORE db.delete(users)
    // and calls unlinkUserAvatar (D-22, wired by Plan 05).
    // -------------------------------------------------------------------------

    const delRes = await deleteAccount(globalServer, aliceJwt, "s3cret");

    // delete-account returns 200 { message: "Account deleted successfully" }
    expect([200, 204]).toContain(delRes.status);

    // -------------------------------------------------------------------------
    // STEP 7: Verify row gone + avatar file gone from disk
    // -------------------------------------------------------------------------

    const rowAfterDelete = sqliteDb
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(aliceId);
    expect(rowAfterDelete).toBeUndefined();

    // The .webp file must have been unlinked by the delete-account path.
    await expect(fs.access(webpPath)).rejects.toThrow();

    // USER_AVATARS_DIR should contain no image files.
    let remaining: string[] = [];
    try {
      remaining = await fs.readdir(userAvatarsDir);
    } catch {
      remaining = [];
    }
    const avatarFiles = remaining.filter((f) => /\.(png|jpg|jpeg|webp)$/.test(f));
    expect(avatarFiles).toEqual([]);

    // -------------------------------------------------------------------------
    // STEP 8: Verify both forceSave spy labels were emitted across the lifecycle.
    //
    // - "phase-85-user-avatar-create" was asserted at STEP 1 (spy was cleared after).
    // - "phase-85-user-avatar-change" was asserted at STEP 4 (spy NOT cleared after).
    //
    // Final confirmation: the change label should still be in the spy's call history.
    // -------------------------------------------------------------------------

    const changeCallFound = forceSaveFn.mock.calls.some(
      (c) => c[0] === "phase-85-user-avatar-change",
    );
    expect(changeCallFound).toBe(true);
  });
});
