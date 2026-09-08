/**
 * Phase 85 Plan 03: Tests for POST /users/create (multipart with mandatory avatar).
 *
 * These tests exercise the extended create endpoint against a real in-memory
 * better-sqlite3 instance so db.$client.prepare().run() and transaction()
 * semantics work correctly. All external side-effects (AuthManager,
 * DatabaseSaveTrigger, writeUserAvatar, unlinkUserAvatar) are mocked.
 *
 * Test cases (7 total):
 *  1: Happy path — multipart with valid PNG → 200, users row + file on disk
 *  2: Missing avatar field → 400 "avatar is required", no row, no file
 *  3: 6 MB avatar → 413 "file too large (max 5 MB)", no row, no file
 *  4: image/gif → 400 "PNG, JPEG, or WebP", no row, no file
 *  5: authManager.registerUser throws → 500, row rolled back, file unlinked
 *  6: Happy path invokes DatabaseSaveTrigger.forceSave("phase-85-user-avatar-create")
 *  7: allow_registration=false → 403 BEFORE file-write (no orphan file)
 *
 * Test infrastructure:
 *  - Real better-sqlite3 in-memory DB for $client (prepare/transaction semantics)
 *  - Drizzle ORM chains mocked to delegate to the in-memory $client where possible
 *  - Multer (via user-avatar-storage.ts) runs for real — tests hit it via HTTP
 *  - writeUserAvatar and unlinkUserAvatar mocked so no disk I/O in most tests
 *  - DatabaseSaveTrigger.forceSave mocked as vi.fn()
 *  - HTTP server spun up on port 0 for each test via multipartRequestMixed helper
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// In-memory SQLite DB — shared across tests, re-bootstrapped in beforeEach
// ---------------------------------------------------------------------------

// We create one at module level and recreate it in beforeEach by dropping and
// re-creating the tables. This avoids the cost of importing a new Database
// instance each test while still giving a clean slate.
let sqliteDb: InstanceType<typeof Database>;

// The mock db object exposes $client pointing at the real sqlite instance
// plus Drizzle-shaped select/insert/delete chains.
// These chains are rebuilt in beforeEach to reset any captured state.

// ---------------------------------------------------------------------------
// Mock: user-avatar-storage — we control writeUserAvatar / unlinkUserAvatar
// so tests don't touch the real filesystem.
// ---------------------------------------------------------------------------

// These are hoisted at the top; we set their implementations in beforeEach.
const mockWriteUserAvatar = vi.fn<[string, string, Buffer], Promise<string>>();
const mockUnlinkUserAvatar = vi.fn<[string | null | undefined], Promise<void>>();
const mockForceSave = vi.fn<[string], Promise<void>>();

vi.mock("./user-avatar-storage.js", async (importOriginal) => {
  // Import the REAL module so multer (userAvatarUpload) runs for real —
  // we only stub the file-I/O functions that would hit the real disk.
  const real = await importOriginal<typeof import("./user-avatar-storage.js")>();
  return {
    ...real,
    writeUserAvatar: (...args: [string, string, Buffer]) => mockWriteUserAvatar(...args),
    unlinkUserAvatar: (...args: [string | null | undefined]) => mockUnlinkUserAvatar(...args),
  };
});

// ---------------------------------------------------------------------------
// Mock: db/index.js — expose the real $client and stub Drizzle chains
// ---------------------------------------------------------------------------

// Drizzle chain helpers: these delegate to the real in-memory sqlite for
// tables that the POST /create handler touches.
function buildSelectChain(db: () => InstanceType<typeof Database>) {
  let fromTable: string | null = null;
  let whereVal: unknown = null;

  const chain = {
    from(table: unknown) {
      // Infer table name from Drizzle schema object's Symbol.iterator/tableName
      const t = table as { [key: string]: unknown };
      if (typeof t?._ === "object" && t._ && typeof (t._ as Record<string, unknown>).name === "string") {
        fromTable = (t._ as Record<string, unknown>).name as string;
      } else {
        fromTable = String(table);
      }
      return chain;
    },
    where(predicate: unknown) {
      // The eq() mock stashes the value; we grab it from pendingWhereValue
      whereVal = pendingWhereValue;
      pendingWhereValue = null;
      void predicate;
      return chain;
    },
    limit(_n: number) {
      return chain;
    },
    then(resolve: (v: unknown[]) => unknown, reject: (e: unknown) => unknown) {
      try {
        if (fromTable === "users") {
          const rows = whereVal != null
            ? db().prepare("SELECT * FROM users WHERE username = ? OR id = ?").all(whereVal, whereVal)
            : db().prepare("SELECT * FROM users").all();
          resolve(rows.map(camelizeUser));
        } else if (fromTable === "roles") {
          const rows = whereVal != null
            ? db().prepare("SELECT * FROM roles WHERE name = ?").all(whereVal)
            : db().prepare("SELECT * FROM roles").all();
          resolve(rows);
        } else {
          resolve([]);
        }
      } catch (e) {
        reject(e);
      }
      return { catch: () => Promise.resolve([]) };
    },
  };
  // Make it awaitable by returning a thenable
  return {
    ...chain,
    // Override to make Promise-compatible
    [Symbol.thenableOf ?? "notused"]: undefined,
  };
}

// Pending where value — captured by eq() mock
let pendingWhereValue: unknown = null;

function camelizeUser(row: Record<string, unknown>) {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    isAdmin: row.is_admin === 1,
    isOidc: row.is_oidc === 1,
    avatarPath: row.avatar_path ?? null,
  };
}

// vi.mock is hoisted — we reference module-level vars via getters.
vi.mock("../db/index.js", () => {
  // Build a proxy db object that uses sqliteDb at call time (not capture time).
  const dbProxy = {
    get $client() {
      return sqliteDb;
    },
    select() {
      return buildSelectChainDynamic();
    },
    insert(table: unknown) {
      return {
        values(vals: Record<string, unknown>) {
          return {
            run() {
              const t = table as { [key: string]: unknown };
              const tableName = (t?._ as Record<string, unknown>)?.name ?? "unknown";
              if (tableName === "user_roles") {
                try {
                  sqliteDb.prepare(
                    "INSERT OR IGNORE INTO user_roles (user_id, role_id, granted_by) VALUES (?, ?, ?)"
                  ).run(vals.userId, vals.roleId, vals.grantedBy);
                } catch {
                  // Non-fatal — roles table may not have the role
                }
              }
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
          const userId = pendingWhereValue as string | null;
          pendingWhereValue = null;
          return Promise.resolve().then(() => {
            if (userId) {
              sqliteDb.prepare("DELETE FROM users WHERE id = ?").run(userId);
            }
          });
        },
      };
    },
  };

  function buildSelectChainDynamic() {
    let fromTable: string | null = null;

    const chain: Record<string, unknown> = {
      from(table: unknown) {
        const t = table as { [key: string]: unknown };
        const tName = (t?._ as Record<string, unknown>)?.name;
        fromTable = typeof tName === "string" ? tName : String(table);
        return chain;
      },
      where(predicate: unknown) {
        void predicate;
        return chain;
      },
      limit(_n: number) {
        return chain;
      },
      then(resolve: (v: unknown[]) => unknown, reject: (e: unknown) => unknown) {
        try {
          const val = pendingWhereValue;
          pendingWhereValue = null;
          if (fromTable === "users") {
            const rows = val != null
              ? sqliteDb.prepare("SELECT * FROM users WHERE username = ? OR id = ?").all(val as string, val as string)
              : sqliteDb.prepare("SELECT * FROM users").all() as Record<string, unknown>[];
            resolve((rows as Record<string, unknown>[]).map(camelizeUser));
          } else if (fromTable === "roles") {
            const rows = val != null
              ? sqliteDb.prepare("SELECT * FROM roles WHERE name = ?").all(val as string)
              : sqliteDb.prepare("SELECT * FROM roles").all();
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

  return {
    get db() {
      return dbProxy;
    },
    DatabaseSaveTrigger: {
      get forceSave() {
        return mockForceSave;
      },
    },
  };
});

// eq() mock — stashes the comparison value for the $client chains
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (_col: unknown, val: unknown) => {
      pendingWhereValue = val;
      return { _col, val };
    },
  };
});

// ---------------------------------------------------------------------------
// Mock: auth-manager — registerUser is stubbed; createAuthMiddleware passthrough
// ---------------------------------------------------------------------------

const mockRegisterUser = vi.fn<[string, string], Promise<void>>();

vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
      createAdminMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
      registerUser: (...args: [string, string]) => mockRegisterUser(...args),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Mock: logger — suppress console noise
// ---------------------------------------------------------------------------

vi.mock("../../utils/logger.js", () => ({
  authLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  databaseLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock: misc modules imported by users.ts that are not exercised by /create tests
// ---------------------------------------------------------------------------

vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: { getUserDataKey: vi.fn(), encryptRecord: vi.fn(), decryptRecord: vi.fn() },
}));
vi.mock("../../utils/user-agent-parser.js", () => ({
  parseUserAgent: vi.fn(() => ({ type: "desktop", browser: "chrome", os: "linux" })),
  generateDeviceFingerprint: vi.fn(() => "fp-test"),
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
vi.mock("./user-api-key-routes.js", () => ({
  registerUserApiKeyRoutes: vi.fn(),
}));
vi.mock("./user-settings-routes.js", () => ({
  registerUserSettingsRoutes: vi.fn(),
}));
vi.mock("./user-totp-routes.js", () => ({
  registerUserTotpRoutes: vi.fn(),
}));
vi.mock("./user-session-routes.js", () => ({
  registerUserSessionRoutes: vi.fn(),
}));
vi.mock("./user-oidc-account-routes.js", () => ({
  registerUserOidcAccountRoutes: vi.fn(),
}));
vi.mock("./user-password-reset-routes.js", () => ({
  registerUserPasswordResetRoutes: vi.fn(),
}));
vi.mock("./user-admin-routes.js", () => ({
  registerUserAdminRoutes: vi.fn(),
}));
vi.mock("./user-data-access-routes.js", () => ({
  registerUserDataAccessRoutes: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Multipart request helpers (adapted from identity-avatar-batch.test.ts:184-254)
// ---------------------------------------------------------------------------

/**
 * buildMultipartBody — single file part (from identity-avatar-batch.test.ts VERBATIM).
 */
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

/**
 * buildMultipartBodyMixed — text fields + one file part.
 * Per RESEARCH.md § 7 sketch: one non-filename part per text field, then the file part.
 */
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
 * multipartRequest — single file part (from identity-avatar-batch.test.ts VERBATIM).
 */
function multipartRequest(
  server: http.Server,
  opts: {
    path: string;
    fieldName: string;
    filename: string;
    fileContentType: string;
    fileBytes: Buffer;
  },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const boundary = "test-boundary-42";
    const body = buildMultipartBody(
      opts.fieldName,
      opts.filename,
      opts.fileContentType,
      opts.fileBytes,
      boundary,
    );

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: "POST",
        path: opts.path,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": String(body.length),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks);
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw.toString());
          } catch {
            parsed = raw.toString();
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * multipartRequestMixed — text fields + file part.
 */
function multipartRequestMixed(
  server: http.Server,
  opts: {
    path: string;
    textFields: Record<string, string>;
    file: { fieldName: string; filename: string; contentType: string; bytes: Buffer };
  },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const boundary = "test-boundary-mixed-85";
    const body = buildMultipartBodyMixed(opts.textFields, opts.file, boundary);

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: "POST",
        path: opts.path,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": String(body.length),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks);
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw.toString());
          } catch {
            parsed = raw.toString();
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Minimal valid PNG header — multer's fileFilter only checks client-declared
// Content-Type, so even a 16-byte stub is fine as the "file" bytes.
const MINIMAL_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

// ---------------------------------------------------------------------------
// DB bootstrap helpers
// ---------------------------------------------------------------------------

function bootstrapDb(): void {
  // Create the users table with all columns the POST /create INSERT uses.
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

  // settings table for allow_registration gate
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // roles + user_roles tables (needed for default-role assignment)
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

  // Seed: allow_registration=true by default
  sqliteDb.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('allow_registration', 'true')").run();

  // Seed roles
  sqliteDb.prepare("INSERT OR IGNORE INTO roles (id, name) VALUES ('role-admin', 'admin')").run();
  sqliteDb.prepare("INSERT OR IGNORE INTO roles (id, name) VALUES ('role-user', 'user')").run();
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server: http.Server;
let tmpDir: string;
let originalDataDir: string | undefined;

// Start the server once for all tests — vi.mock is hoisted so mocks are
// already in place before this runs. We share one server across tests and
// reset DB + mock state in beforeEach.
async function startServer(): Promise<http.Server> {
  const mod = await import("./users.js");
  const router = mod.default;
  const app = express();
  // Attach the router at /users so the path is /users/create
  app.use("/users", router);
  return new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
}

// Global server — started before the describe block.
let globalServer: http.Server;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("POST /users/create (Phase 85 — multipart with mandatory avatar)", () => {
  // Start the server once for all tests in this describe block.
  // Timeout 60s: users.ts imports many sub-routers and can take >10s on fleet load.
  beforeAll(async () => {
    originalDataDir = process.env.DATA_DIR;
    // Use a persistent tmpDir for the server lifetime
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "phase-85-users-global-"));
    process.env.DATA_DIR = tmpDir;

    // Bootstrap the first DB before starting the server (server uses db via getter)
    sqliteDb = new Database(":memory:");
    bootstrapDb();

    globalServer = await startServer();
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
    // Fresh SQLite in-memory DB for each test — the mock db getter returns sqliteDb
    // via the module-level variable, so re-assigning here gives each test a clean slate.
    sqliteDb?.close();
    sqliteDb = new Database(":memory:");
    bootstrapDb();

    // Reset mock call state (not implementations)
    mockWriteUserAvatar.mockClear();
    mockUnlinkUserAvatar.mockClear();
    mockForceSave.mockClear();
    mockRegisterUser.mockClear();

    // Default implementations
    mockWriteUserAvatar.mockImplementation(async (userId, mime) => {
      const extMap: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
      const ext = extMap[mime] ?? "png";
      const filename = `${userId}.${ext}`;
      // Actually write to tmpDir so fs.access checks work in Test 1
      const dir = path.join(tmpDir, "user-avatars");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, filename), Buffer.from("fake-avatar-bytes"));
      return filename;
    });

    mockUnlinkUserAvatar.mockResolvedValue(undefined);
    mockForceSave.mockResolvedValue(undefined);
    mockRegisterUser.mockResolvedValue(undefined);

    // Reset pending where value
    pendingWhereValue = null;

    server = globalServer;
  });

  afterEach(async () => {
    // Clean the user-avatars dir between tests so Test 1's file check is reliable
    const avatarDir = path.join(tmpDir, "user-avatars");
    try {
      const files = await fs.readdir(avatarDir);
      for (const f of files) {
        await fs.unlink(path.join(avatarDir, f));
      }
    } catch {
      // Dir may not exist — that's fine
    }
  });

  // -------------------------------------------------------------------------
  // Test 1: Happy path
  // -------------------------------------------------------------------------

  it("POST /users/create — happy path (multipart with valid avatar) creates user + file", async () => {
    const res = await multipartRequestMixed(server, {
      path: "/users/create",
      textFields: { username: "alice", password: "s3cret123" },
      file: {
        fieldName: "avatar",
        filename: "avatar.png",
        contentType: "image/png",
        bytes: MINIMAL_PNG_BYTES,
      },
    });

    expect(res.status).toBe(200);
    const body = res.body as { message: string; is_admin: boolean };
    expect(body.message).toBe("User created");

    // users row must exist with avatar_path set
    const row = sqliteDb.prepare("SELECT username, avatar_path FROM users WHERE username = ?").get("alice") as
      | { username: string; avatar_path: string | null }
      | undefined;
    expect(row).toBeDefined();
    expect(row!.username).toBe("alice");
    expect(row!.avatar_path).toBeTruthy();
    expect(row!.avatar_path).toMatch(/\.(png|jpg|webp)$/);

    // File must exist on disk (mockWriteUserAvatar actually writes to tmpDir)
    const avatarDir = path.join(tmpDir, "user-avatars");
    const files = await fs.readdir(avatarDir);
    expect(files.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Test 2: Missing avatar field → 400, no side effects
  // -------------------------------------------------------------------------

  it("POST /users/create — missing avatar field returns 400 without side effects", async () => {
    // Send multipart with only text fields (no file part)
    const boundary = "test-boundary-text-only";
    const textBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="username"\r\n\r\nalice\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="password"\r\n\r\ns3cret123\r\n`),
      Buffer.from(`--${boundary}--\r\n`),
    ]);

    const res = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const { port } = server.address() as AddressInfo;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          method: "POST",
          path: "/users/create",
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": String(textBody.length),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => {
            let parsed: unknown;
            try { parsed = JSON.parse(Buffer.concat(chunks).toString()); } catch { parsed = null; }
            resolve({ status: response.statusCode ?? 0, body: parsed });
          });
        },
      );
      req.on("error", reject);
      req.write(textBody);
      req.end();
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("avatar is required");

    // No user row
    const count = sqliteDb.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number };
    expect(count.c).toBe(0);

    // writeUserAvatar must NOT have been called
    expect(mockWriteUserAvatar).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 3: 6 MB avatar → 413
  // -------------------------------------------------------------------------

  it("POST /users/create — 6 MB avatar returns 413", async () => {
    const oversizeBytes = Buffer.alloc(6 * 1024 * 1024, 0xab);

    const res = await multipartRequestMixed(server, {
      path: "/users/create",
      textFields: { username: "alice", password: "s3cret123" },
      file: {
        fieldName: "avatar",
        filename: "big.png",
        contentType: "image/png",
        bytes: oversizeBytes,
      },
    });

    expect(res.status).toBe(413);
    expect((res.body as { error: string }).error).toBe("file too large (max 5 MB)");

    // No user row
    const count = sqliteDb.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number };
    expect(count.c).toBe(0);

    // No file written
    expect(mockWriteUserAvatar).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 4: image/gif → 400 with mime error
  // -------------------------------------------------------------------------

  it("POST /users/create — image/gif returns 400 with mime error", async () => {
    const res = await multipartRequestMixed(server, {
      path: "/users/create",
      textFields: { username: "alice", password: "s3cret123" },
      file: {
        fieldName: "avatar",
        filename: "anim.gif",
        contentType: "image/gif",
        bytes: Buffer.from([0x47, 0x49, 0x46, 0x38]),
      },
    });

    expect(res.status).toBe(400);
    const body = res.body as { error: string };
    expect(body.error).toMatch(/PNG, JPEG, or WebP/);

    // No user row
    const count = sqliteDb.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number };
    expect(count.c).toBe(0);

    // No file written
    expect(mockWriteUserAvatar).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 5: authManager.registerUser throws → rollback row and file
  // -------------------------------------------------------------------------

  it("POST /users/create — encryption failure rolls back both row and file", async () => {
    mockRegisterUser.mockRejectedValueOnce(new Error("encryption init failed"));

    const res = await multipartRequestMixed(server, {
      path: "/users/create",
      textFields: { username: "alice", password: "s3cret123" },
      file: {
        fieldName: "avatar",
        filename: "avatar.png",
        contentType: "image/png",
        bytes: MINIMAL_PNG_BYTES,
      },
    });

    expect(res.status).toBe(500);

    // Row must not exist (rollback ran db.delete)
    const count = sqliteDb.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number };
    expect(count.c).toBe(0);

    // unlinkUserAvatar must have been called (T-85-06b rollback)
    expect(mockUnlinkUserAvatar).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Test 6: forceSave called with the correct label
  // -------------------------------------------------------------------------

  it("POST /users/create — happy path invokes DatabaseSaveTrigger.forceSave with correct label", async () => {
    const res = await multipartRequestMixed(server, {
      path: "/users/create",
      textFields: { username: "alice", password: "s3cret123" },
      file: {
        fieldName: "avatar",
        filename: "avatar.png",
        contentType: "image/png",
        bytes: MINIMAL_PNG_BYTES,
      },
    });

    expect(res.status).toBe(200);
    expect(mockForceSave).toHaveBeenCalledWith("phase-85-user-avatar-create");
  });

  // -------------------------------------------------------------------------
  // Test 7: allow_registration=false → 403 BEFORE file-write
  // -------------------------------------------------------------------------

  it("POST /users/create — allow_registration=false rejects BEFORE file-write", async () => {
    // Disable registration
    sqliteDb.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('allow_registration', 'false')").run();

    const res = await multipartRequestMixed(server, {
      path: "/users/create",
      textFields: { username: "alice", password: "s3cret123" },
      file: {
        fieldName: "avatar",
        filename: "avatar.png",
        contentType: "image/png",
        bytes: MINIMAL_PNG_BYTES,
      },
    });

    // Existing gate status (users.ts:93-96)
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe("Registration is currently disabled");

    // No file written — gate fires BEFORE req.file check and file write
    expect(mockWriteUserAvatar).not.toHaveBeenCalled();

    // No user row
    const count = sqliteDb.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number };
    expect(count.c).toBe(0);
  });
});
