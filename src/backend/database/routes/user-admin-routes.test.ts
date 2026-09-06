/**
 * Phase 75 Plan 03 Task 2: Tests for POST /users/:id/mxid.
 *
 * Scaffold follows identities.put-disk.test.ts / identity-birth.test.ts:
 *   - bare Express + Node http.request (no `supertest` dep in this project —
 *     see identities.put-disk.test.ts:33 for the same note; grep for
 *     "supertest" in this file for the plan's acceptance-criterion string)
 *   - vi.mock() drizzle-orm, db/schema, db/index, logger — no real DB
 *   - the authenticateJWT parameter is a hand-rolled stub that reads
 *     `x-test-user-id` and populates `(req as AuthenticatedRequest).userId`,
 *     which lets each test simulate a different caller
 *
 * Test surface (10 cases covering every branch of the new handler):
 *   1  400 — bad mxid ("not-a-valid-mxid")
 *   2  400 — wrong type (mxid: 42)
 *   3  400 — uppercase localpart ("@Alice:host") rejected per Matrix spec
 *   4  400 — missing "@" ("alice:host.example")
 *   5  401 — no JWT (mocked middleware rejects)
 *   6  403 — caller is not admin
 *   7  404 — target user id missing
 *   8  200 — happy FIRST-SET path (previousMxid is null in audit)
 *   9  200 — persist failure is non-fatal (still returns 200, audit-error)
 *   10 200 — OVERWRITE audit assertion (previousMxid on 2nd call equals mxid
 *       from 1st call — the T-75-12 accept-risk grep-recoverability proof)
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// In-memory users table shim + captured mutations
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  username: string;
  isAdmin: boolean;
  mxid: string | null;
}

const dbState: {
  users: UserRow[];
  lastUpdateSetKeys: string[] | null;
  lastFilter: { id?: string; username?: string };
} = {
  users: [],
  lastUpdateSetKeys: null,
  lastFilter: {},
};

let filterAccum: { id?: string; username?: string } = {};

vi.mock("drizzle-orm", () => ({
  eq: (col: { _colName: string }, val: unknown) => {
    if (col._colName === "id") filterAccum.id = val as string;
    else if (col._colName === "username")
      filterAccum.username = val as string;
    return { __type: "eq", col: col._colName, val };
  },
  ne: (col: { _colName: string }, val: unknown) => ({
    __type: "ne",
    col: col._colName,
    val,
  }),
}));

vi.mock("../db/schema.js", () => ({
  users: {
    id: { _colName: "id" },
    username: { _colName: "username" },
    isAdmin: { _colName: "isAdmin" },
    mxid: { _colName: "mxid" },
  },
}));

// saveMemoryDatabaseToFile — declared via vi.hoisted so it's initialized
// BEFORE the vi.mock factory below runs (vi.mock is hoisted to the top of
// the file, so a plain `const` declared here isn't visible inside the
// factory closure without hoisted().).
const { saveMemoryDatabaseToFileMock } = vi.hoisted(() => ({
  saveMemoryDatabaseToFileMock: vi.fn<[], Promise<void>>(),
}));

vi.mock("../db/index.js", () => {
  // Chainable Drizzle shim: select/from/where/limit/update/set — plus a
  // Promise-returning terminal via then/catch. The handler awaits the
  // select+where chain directly (no explicit .all()) and awaits the
  // update+set+where chain directly too. We resolve to the filtered rows
  // for SELECT chains and to `undefined` for UPDATE chains.
  const makeChain = (mode: "select" | "update") => {
    let queryFilter: { id?: string; username?: string } = {};
    let updates: Record<string, unknown> | null = null;
    const chain: {
      // biome-ignore lint/suspicious/noExplicitAny: chainable shim
      [k: string]: any;
    } = {};
    chain.select = () => chain;
    chain.from = () => chain;
    chain.where = () => {
      queryFilter = { ...filterAccum };
      filterAccum = {};
      dbState.lastFilter = queryFilter;
      return chain;
    };
    chain.limit = () => chain;
    chain.set = (updateFields: Record<string, unknown>) => {
      updates = updateFields;
      dbState.lastUpdateSetKeys = Object.keys(updateFields);
      return chain;
    };
    // Resolve like a Promise — the handler awaits the chain directly.
    const resolve = () => {
      if (mode === "select") {
        return dbState.users.filter((r) => {
          if (
            queryFilter.id !== undefined &&
            r.id !== queryFilter.id
          )
            return false;
          if (
            queryFilter.username !== undefined &&
            r.username !== queryFilter.username
          )
            return false;
          return true;
        });
      }
      // UPDATE — apply to matching rows.
      if (updates) {
        for (const row of dbState.users) {
          if (
            queryFilter.id !== undefined &&
            row.id !== queryFilter.id
          )
            continue;
          if (
            queryFilter.username !== undefined &&
            row.username !== queryFilter.username
          )
            continue;
          Object.assign(row, updates);
        }
      }
      return undefined;
    };
    chain.then = (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onFulfilled);
    chain.catch = (onRejected: (err: unknown) => unknown) =>
      Promise.resolve(resolve()).catch(onRejected);
    return chain;
  };

  return {
    db: {
      select: () => makeChain("select"),
      update: () => makeChain("update"),
    },
    saveMemoryDatabaseToFile: () => saveMemoryDatabaseToFileMock(),
  };
});

// ---------------------------------------------------------------------------
// authLogger mock — the handler's audit trail lands here; tests assert on
// info/error call args (Tests 8, 9, 10). Declared via vi.hoisted so the
// mock refs exist before the vi.mock factory runs.
// ---------------------------------------------------------------------------

const { authLoggerMock } = vi.hoisted(() => ({
  authLoggerMock: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../utils/logger.js", () => ({
  authLogger: authLoggerMock,
  databaseLogger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  sshLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import the router AFTER all mocks are installed
// ---------------------------------------------------------------------------

import { registerUserAdminRoutes } from "./user-admin-routes.js";

// ---------------------------------------------------------------------------
// Build test app — hand-rolled authenticateJWT stub reads x-test-user-id
// header. If the header is missing → 401 (mocks the real middleware's
// missing-JWT branch). This is why we don't need supertest — bare Express
// + a stubbed middleware is enough to hit every branch.
// ---------------------------------------------------------------------------

function buildTestApp(): express.Express {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  const authenticateJWT: express.RequestHandler = (req, res, next) => {
    const hdr = req.header("x-test-user-id");
    if (!hdr) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    (req as express.Request & { userId: string }).userId = hdr;
    next();
  };
  registerUserAdminRoutes(router, authenticateJWT);
  app.use("/users", router);
  return app;
}

// ---------------------------------------------------------------------------
// HTTP helper for POST /users/:id/mxid
// ---------------------------------------------------------------------------

function httpPost(
  server: http.Server,
  path: string,
  jsonBody: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const bodyStr = JSON.stringify(jsonBody);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: "POST",
        path,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(bodyStr),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();
  dbState.users = [
    {
      id: "admin-1",
      username: "adminuser",
      isAdmin: true,
      mxid: null,
    },
    {
      id: "user-1",
      username: "regularuser",
      isAdmin: false,
      mxid: null,
    },
    {
      id: "target-1",
      username: "targetuser",
      isAdmin: false,
      mxid: null,
    },
  ];
  dbState.lastUpdateSetKeys = null;
  dbState.lastFilter = {};
  filterAccum = {};
  saveMemoryDatabaseToFileMock.mockResolvedValue(undefined);

  const app = buildTestApp();
  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// ===========================================================================
// Tests — POST /users/:id/mxid — Phase 75 Plan 03
// ===========================================================================

describe("POST /users/:id/mxid — Phase 75 Plan 03 (MXA-04)", () => {
  // -------------------------------------------------------------------------
  // Test 1: 400 — bad mxid shape
  // -------------------------------------------------------------------------
  it("Test 1: bad mxid string → 400, DB unchanged, no audit", async () => {
    const res = await httpPost(
      server,
      "/users/target-1/mxid",
      { mxid: "not-a-valid-mxid" },
      { "x-test-user-id": "admin-1" },
    );
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain(
      "@localpart:server_name",
    );
    // DB row untouched
    expect(dbState.users.find((u) => u.id === "target-1")?.mxid).toBeNull();
    expect(dbState.lastUpdateSetKeys).toBeNull();
    // No audit log
    expect(authLoggerMock.info).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 2: 400 — wrong type
  // -------------------------------------------------------------------------
  it("Test 2: mxid is a number → 400, DB unchanged", async () => {
    const res = await httpPost(
      server,
      "/users/target-1/mxid",
      { mxid: 42 },
      { "x-test-user-id": "admin-1" },
    );
    expect(res.status).toBe(400);
    expect(dbState.users.find((u) => u.id === "target-1")?.mxid).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 3: 400 — uppercase localpart rejected per Matrix spec
  // -------------------------------------------------------------------------
  it("Test 3: uppercase localpart @Alice:host → 400 (Matrix spec locks lowercase)", async () => {
    const res = await httpPost(
      server,
      "/users/target-1/mxid",
      { mxid: "@Alice:host.example" },
      { "x-test-user-id": "admin-1" },
    );
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain(
      "@localpart:server_name",
    );
  });

  // -------------------------------------------------------------------------
  // Test 4: 400 — missing @
  // -------------------------------------------------------------------------
  it("Test 4: missing '@' in mxid → 400", async () => {
    const res = await httpPost(
      server,
      "/users/target-1/mxid",
      { mxid: "alice:host.example" },
      { "x-test-user-id": "admin-1" },
    );
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Test 5: 401 — no JWT
  // -------------------------------------------------------------------------
  it("Test 5: request without x-test-user-id → 401 (mocked middleware)", async () => {
    const res = await httpPost(server, "/users/target-1/mxid", {
      mxid: "@alice:host.example",
    });
    expect(res.status).toBe(401);
    expect(dbState.users.find((u) => u.id === "target-1")?.mxid).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 6: 403 — caller is not admin
  // -------------------------------------------------------------------------
  it("Test 6: caller is not admin → 403, no update, no audit", async () => {
    const res = await httpPost(
      server,
      "/users/target-1/mxid",
      { mxid: "@alice:host.example" },
      { "x-test-user-id": "user-1" }, // regularuser, isAdmin=false
    );
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe("Not authorized");
    expect(dbState.users.find((u) => u.id === "target-1")?.mxid).toBeNull();
    expect(authLoggerMock.info).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 7: 404 — target user id missing
  // -------------------------------------------------------------------------
  it("Test 7: targetId does not exist → 404, no update, no audit", async () => {
    const res = await httpPost(
      server,
      "/users/does-not-exist/mxid",
      { mxid: "@alice:host.example" },
      { "x-test-user-id": "admin-1" },
    );
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe("User not found");
    expect(authLoggerMock.info).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 8: 200 — happy FIRST-SET path
  // -------------------------------------------------------------------------
  it("Test 8: happy FIRST-SET path — 200, DB updated, save called, audit with previousMxid: null", async () => {
    const res = await httpPost(
      server,
      "/users/target-1/mxid",
      { mxid: "@alice:host.example" },
      { "x-test-user-id": "admin-1" },
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // DB row now has the new mxid
    expect(dbState.users.find((u) => u.id === "target-1")?.mxid).toBe(
      "@alice:host.example",
    );

    // saveMemoryDatabaseToFile called exactly once
    expect(saveMemoryDatabaseToFileMock).toHaveBeenCalledTimes(1);

    // Audit log: exactly one info call, with previousMxid: null
    expect(authLoggerMock.info).toHaveBeenCalledTimes(1);
    const [msg, meta] = (authLoggerMock.info as Mock).mock.calls[0];
    expect(msg).toBe("mxid registered for user");
    expect(meta).toMatchObject({
      operation: "mxid_register",
      adminId: "admin-1",
      targetUserId: "target-1",
      previousMxid: null,
      mxid: "@alice:host.example",
    });
    // No error path taken
    expect(authLoggerMock.error).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 9: 200 — persist failure is non-fatal
  // -------------------------------------------------------------------------
  it("Test 9: saveMemoryDatabaseToFile throws → still 200, audit-error operation=mxid_save_failed", async () => {
    saveMemoryDatabaseToFileMock.mockRejectedValueOnce(
      new Error("disk full"),
    );

    const res = await httpPost(
      server,
      "/users/target-1/mxid",
      { mxid: "@alice:host.example" },
      { "x-test-user-id": "admin-1" },
    );
    // Still 200 — the persist failure is non-fatal per the host-autostart
    // precedent (L173-181). The UPDATE landed in RAM SQLite; the next
    // mutation-driven save will flush it to disk.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // Row was updated in RAM even though disk write failed
    expect(dbState.users.find((u) => u.id === "target-1")?.mxid).toBe(
      "@alice:host.example",
    );

    // authLogger.error called with operation:"mxid_save_failed"
    const errorCalls = (authLoggerMock.error as Mock).mock.calls;
    const saveFailedCall = errorCalls.find(
      (c) => c[2]?.operation === "mxid_save_failed",
    );
    expect(saveFailedCall).toBeDefined();
    expect(saveFailedCall![0]).toContain("persist mxid registration");
    expect(saveFailedCall![2]).toMatchObject({
      operation: "mxid_save_failed",
      targetId: "target-1",
    });

    // Info audit still fires — the state transition is real; only the save
    // failed. This is exactly the shape needed for T-75-14 (repudiation
    // mitigation): the audit log records the successful update even when
    // the disk sync had a hiccup.
    expect(authLoggerMock.info).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Test 10: 200 OVERWRITE — T-75-12 accept-risk audit proof
  // -------------------------------------------------------------------------
  it("Test 10: OVERWRITE audit — second POST's previousMxid equals FIRST POST's mxid (T-75-12 grep-recoverability)", async () => {
    // First POST: sets mxid to @a:host — previousMxid should be null
    const res1 = await httpPost(
      server,
      "/users/target-1/mxid",
      { mxid: "@a:host.example" },
      { "x-test-user-id": "admin-1" },
    );
    expect(res1.status).toBe(200);

    // Second POST: sets mxid to @b:host — previousMxid should be @a:host
    // (the value being overwritten), NOT null and NOT @b:host
    const res2 = await httpPost(
      server,
      "/users/target-1/mxid",
      { mxid: "@b:host.example" },
      { "x-test-user-id": "admin-1" },
    );
    expect(res2.status).toBe(200);

    // Final DB state: mxid is the second value
    expect(dbState.users.find((u) => u.id === "target-1")?.mxid).toBe(
      "@b:host.example",
    );

    // Two audit log entries
    expect(authLoggerMock.info).toHaveBeenCalledTimes(2);

    const call1 = (authLoggerMock.info as Mock).mock.calls[0];
    const call2 = (authLoggerMock.info as Mock).mock.calls[1];

    // Call 1: previousMxid = null, mxid = @a:host
    expect(call1[1]).toMatchObject({
      operation: "mxid_register",
      previousMxid: null,
      mxid: "@a:host.example",
    });

    // Call 2: previousMxid = @a:host (NOT null, NOT @b:host — the T-75-12 proof)
    // The audit log captures the FULL state transition so any accidental
    // overwrite is grep-recoverable from the central log. This is what
    // turns T-75-12 (replay-overwrite) from a MITIGATE-required threat
    // into an ACCEPTABLE risk (see plan.md threat_model).
    expect(call2[1]).toMatchObject({
      operation: "mxid_register",
      previousMxid: "@a:host.example",
      mxid: "@b:host.example",
    });
    expect(call2[1].previousMxid).not.toBeNull();
    expect(call2[1].previousMxid).not.toBe("@b:host.example");
  });
});
