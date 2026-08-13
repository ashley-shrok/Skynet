/**
 * Phase 38 (identity-sharing, Plan 38-01, Task 1): Tests for GET /users/list-basic.
 *
 * The picker-facing users list — reachable by ANY authenticated user (not
 * admin-only), returning ONLY {id, username} for every user EXCEPT the
 * requester (server-side self-exclusion).
 *
 * Scaffold follows identity-clone.test.ts:
 *   - bare Express + Node http.request (no supertest dep)
 *   - vi.mock() AuthManager, db/index, drizzle-orm, db/schema, utils/logger
 *   - in-memory dbState.users with a `.all()` filter that supports both
 *     "id === X" (eq) and "id !== X" (ne, for self-exclusion)
 *
 * Test coverage (5 tests, 1:1 with plan Task 1 <behavior> items):
 *   1: No JWT → 401
 *   2: Valid JWT for u-alice, users=[alice,bob,carol] → 200 {users:[bob,carol]}
 *   3: Only requester in users table → 200 {users:[]}
 *   4: Each row has exactly {id, username} — no sensitive fields
 *   5: DB error during select → 500 {error:"Failed to list users"}
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Auth manager mock — controls whether a request is authenticated
// ---------------------------------------------------------------------------

let mockUserId: string | null = "u-alice";

vi.mock("../../utils/auth-manager.js", () => {
  const AuthManager = {
    getInstance: () => ({
      createAuthMiddleware: () =>
        (
          req: express.Request,
          res: express.Response,
          next: express.NextFunction,
        ) => {
          if (mockUserId === null) {
            return res.status(401).json({ error: "Unauthorized" });
          }
          (req as express.Request & { userId: string }).userId = mockUserId;
          next();
        },
    }),
  };
  return { AuthManager };
});

// ---------------------------------------------------------------------------
// In-memory DB shim — mirrors the drizzle chain surface for select users.
// ---------------------------------------------------------------------------

type UserRow = {
  id: string;
  username: string;
  passwordHash?: string;
  isAdmin?: boolean;
  isOidc?: boolean;
  totpSecret?: string;
};

const dbState: {
  users: UserRow[];
  lastFilter: { notUserId?: string; userId?: string };
  lastSelectedKeys: string[] | null;
  throwOnSelect: boolean;
} = {
  users: [],
  lastFilter: {},
  lastSelectedKeys: null,
  throwOnSelect: false,
};

let filterAccum: { notUserId?: string; userId?: string } = {};

vi.mock("drizzle-orm", () => ({
  eq: (col: { _colName: string }, val: unknown) => {
    if (col._colName === "id") {
      filterAccum.userId = val as string;
    }
    return { __type: "eq", col: col._colName, val };
  },
  ne: (col: { _colName: string }, val: unknown) => {
    if (col._colName === "id") {
      filterAccum.notUserId = val as string;
    }
    return { __type: "ne", col: col._colName, val };
  },
  and: (...conds: unknown[]) => ({ __type: "and", conds }),
}));

vi.mock("../db/schema.js", () => ({
  users: {
    id: { _colName: "id" },
    username: { _colName: "username" },
    isAdmin: { _colName: "isAdmin" },
    isOidc: { _colName: "isOidc" },
    passwordHash: { _colName: "passwordHash" },
  },
  identities: {
    id: { _colName: "id" },
    userId: { _colName: "userId" },
    identityKey: { _colName: "identityKey" },
  },
}));

vi.mock("../db/index.js", () => {
  const chain = {
    select: (keys?: Record<string, unknown>) => {
      if (dbState.throwOnSelect) {
        // Throw only on the FIRST select call inside a request path.
        // Reset before returning so subsequent tests aren't affected.
        dbState.throwOnSelect = false;
        throw new Error("DB down");
      }
      dbState.lastSelectedKeys = keys ? Object.keys(keys) : null;
      return chain;
    },
    from: () => chain,
    where: () => {
      dbState.lastFilter = { ...filterAccum };
      filterAccum = {};
      return chain;
    },
    // await db.select().from().where() resolves to the rows array (drizzle
    // pattern used by user-admin-routes.ts). Support both awaited and .all()
    // resolution.
    then: (onFulfilled: (rows: unknown[]) => unknown) => {
      const rows = runQuery();
      return Promise.resolve(rows).then(onFulfilled);
    },
    all: () => runQuery(),
  };

  function runQuery() {
    const f = dbState.lastFilter;
    dbState.lastFilter = {};
    const keys = dbState.lastSelectedKeys;
    dbState.lastSelectedKeys = null;
    return dbState.users
      .filter((r) => {
        if (f.notUserId !== undefined && r.id === f.notUserId) return false;
        if (f.userId !== undefined && r.id !== f.userId) return false;
        return true;
      })
      .map((r) => {
        if (!keys) return r;
        const out: Record<string, unknown> = {};
        for (const k of keys) {
          out[k] = (r as unknown as Record<string, unknown>)[k];
        }
        return out;
      });
  }

  return { db: chain };
});

vi.mock("../../utils/logger.js", () => ({
  authLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  databaseLogger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks
// ---------------------------------------------------------------------------

import { registerUserAdminRoutes } from "./user-admin-routes.js";
import { AuthManager } from "../../utils/auth-manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function httpRequest(
  server: http.Server,
  opts: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;

    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.body !== undefined) {
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(opts.body));
    }

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: opts.method,
        path: opts.path,
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          let body: unknown;
          try {
            body = JSON.parse(data);
          } catch {
            body = data;
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) {
      req.write(opts.body);
    }
    req.end();
  });
}

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();
  dbState.users = [];
  dbState.lastFilter = {};
  dbState.lastSelectedKeys = null;
  dbState.throwOnSelect = false;
  filterAccum = {};
  mockUserId = "u-alice";

  const app = express();
  const router = express.Router();
  registerUserAdminRoutes(
    router,
    AuthManager.getInstance().createAuthMiddleware(),
  );
  app.use("/users", router);

  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /users/list-basic", () => {
  it("Test 1: no JWT → 401", async () => {
    mockUserId = null;
    dbState.users = [
      { id: "u-alice", username: "alice" },
      { id: "u-bob", username: "bob" },
    ];

    const res = await httpRequest(server, {
      method: "GET",
      path: "/users/list-basic",
    });
    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).toBe("Unauthorized");
  });

  it("Test 2: valid JWT, three users → returns other two", async () => {
    dbState.users = [
      { id: "u-alice", username: "alice" },
      { id: "u-bob", username: "bob" },
      { id: "u-carol", username: "carol" },
    ];

    const res = await httpRequest(server, {
      method: "GET",
      path: "/users/list-basic",
    });
    expect(res.status).toBe(200);
    const body = res.body as { users: Array<{ id: string; username: string }> };
    expect(body.users).toBeInstanceOf(Array);
    expect(body.users.length).toBe(2);
    const ids = body.users.map((u) => u.id).sort();
    expect(ids).toEqual(["u-bob", "u-carol"]);
    // Alice (the requester) is NOT in the response
    expect(body.users.find((u) => u.id === "u-alice")).toBeUndefined();
  });

  it("Test 3: only the requester in users table → returns empty array (not 404/204)", async () => {
    dbState.users = [{ id: "u-alice", username: "alice" }];

    const res = await httpRequest(server, {
      method: "GET",
      path: "/users/list-basic",
    });
    expect(res.status).toBe(200);
    const body = res.body as { users: unknown[] };
    expect(body.users).toEqual([]);
  });

  it("Test 4: every returned row has EXACTLY {id, username} — no sensitive fields", async () => {
    dbState.users = [
      {
        id: "u-alice",
        username: "alice",
        isAdmin: true,
        isOidc: true,
        passwordHash: "hash-alice",
        totpSecret: "totp-alice",
      },
      {
        id: "u-bob",
        username: "bob",
        isAdmin: false,
        isOidc: false,
        passwordHash: "hash-bob",
        totpSecret: "totp-bob",
      },
    ];

    const res = await httpRequest(server, {
      method: "GET",
      path: "/users/list-basic",
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      users: Array<Record<string, unknown>>;
    };
    expect(body.users.length).toBe(1);
    const row = body.users[0];
    // Explicit sensitive-field non-leak: exactly the two allowed keys
    expect(Object.keys(row).sort()).toEqual(["id", "username"]);
    // Defensive: assert each forbidden field is undefined even if serializer
    // added it under a different casing
    expect(row.isAdmin).toBeUndefined();
    expect(row.isOidc).toBeUndefined();
    expect(row.passwordHash).toBeUndefined();
    expect(row.totpSecret).toBeUndefined();
    expect(row.email).toBeUndefined();
  });

  it("Test 5: DB error during select → 500 {error:'Failed to list users'}", async () => {
    dbState.throwOnSelect = true;
    dbState.users = [
      { id: "u-alice", username: "alice" },
      { id: "u-bob", username: "bob" },
    ];

    const res = await httpRequest(server, {
      method: "GET",
      path: "/users/list-basic",
    });
    expect(res.status).toBe(500);
    expect((res.body as { error: string }).error).toBe("Failed to list users");
  });
});
