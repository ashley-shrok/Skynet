/**
 * Phase 38 (identity-sharing, Plan 38-01, Task 2): Tests for POST
 * /identities/:id/share.
 *
 * Copy-and-diverge row duplicator: given a source identity id the requester
 * can see (i.e., under their own userId), insert a fresh identities row for
 * the target user carrying the same identityKey/displayName/title/colorHue/
 * voice/avatarMime/avatarData/avatarEtag. Fresh id + fresh timestamps.
 *
 * No permission gate on "did requester create the source" — any user with
 * the identity in their scope can share it onward (Phase 38 CONTEXT.md
 * § Who can share).
 *
 * No-op-on-repeat: if the target already has an identity with the same
 * identityKey, return 200 with {identityId: <existing>, shared:false} and
 * do NOT INSERT.
 *
 * Scaffold follows identity-clone.test.ts:
 *   - bare Express + Node http.request (no supertest dep)
 *   - vi.mock() AuthManager, db/index, drizzle-orm, db/schema, logger, nanoid
 *   - two-table in-memory dbState: identities + users
 *   - drizzle chain tracks which table `from()` targeted so `.all()` can
 *     dispatch to the right array
 *
 * Test coverage (10 tests — one per <behavior> item plus body-shape + field
 * fidelity, per plan Task 2 acceptance criteria):
 *   1: No JWT → 401
 *   2: Missing body → 400 "targetUserId is required"
 *   3: Body without targetUserId → 400
 *   4: Self-target (targetUserId === requester) → 400 "Cannot share to self"
 *   5: Source id not visible to requester (wrong userId scope) → 404
 *   6: Source id genuinely does not exist → 404 (indistinguishable from #5)
 *   7: Target user does not exist in users table → 400 "Target user not found"
 *   8: Happy path — 200 {identityId: <new>, shared: true}; row inserted with
 *      every copied column matching source verbatim; fresh id + timestamps
 *   9: No-op on repeat — target already has identityKey → 200 shared:false;
 *      NO insert (identities row count unchanged); existing id returned
 *  10: Share-onward — requester received the identity via prior share (they
 *      are not the original creator); share still succeeds (no permission
 *      gate); shared:true; new row created for the new target
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
// nanoid mock — predictable id for happy-path assertions
// ---------------------------------------------------------------------------

vi.mock("nanoid", () => ({
  nanoid: () => "new-share-uuid",
}));

// ---------------------------------------------------------------------------
// In-memory two-table DB shim
// ---------------------------------------------------------------------------

// Phase 66 Plan 04: identities row narrowed to 5 surviving columns.
// Cosmetics live on disk; identity-share.ts no longer copies them from
// sourceRow into the target-user's insert.
type IdentityRow = {
  id: string;
  userId: string;
  identityKey: string;
  createdAt: string;
  updatedAt: string;
};

type UserRow = { id: string; username: string };

const dbState: {
  identities: IdentityRow[];
  users: UserRow[];
  lastTable: "identities" | "users" | null;
  lastFilter: {
    id?: string;
    userId?: string;
    identityKey?: string;
  };
  lastSelectedKeys: string[] | null;
  lastPendingInsertRow: IdentityRow | null;
  insertCount: number;
  // Race-injection hook (Test 11 UNIQUE-constraint safety):
  // When set, the very next .run() throws a stubbed SQLITE_CONSTRAINT_UNIQUE
  // error AFTER pushing winnerRow into dbState.identities. This simulates a
  // concurrent request landing between our SELECT and INSERT.
  nextInsertRaceInjection: { winnerRow: IdentityRow } | null;
} = {
  identities: [],
  users: [],
  lastTable: null,
  lastFilter: {},
  lastSelectedKeys: null,
  lastPendingInsertRow: null,
  insertCount: 0,
  nextInsertRaceInjection: null,
};

let filterAccum: {
  id?: string;
  userId?: string;
  identityKey?: string;
} = {};

// ---------------------------------------------------------------------------
// drizzle-orm mock — eq/and capture filter intent by column name
// ---------------------------------------------------------------------------

vi.mock("drizzle-orm", () => ({
  eq: (col: { _colName: string; _table: string }, val: unknown) => {
    // Column-name maps to filter key. For the users table, the id column
    // captures as `userId` in the filter (target user existence check).
    if (col._table === "users" && col._colName === "id") {
      filterAccum.userId = val as string;
    } else if (col._colName === "userId") {
      filterAccum.userId = val as string;
    } else if (col._colName === "id") {
      filterAccum.id = val as string;
    } else if (col._colName === "identityKey") {
      filterAccum.identityKey = val as string;
    }
    return { __type: "eq", col: col._colName, val };
  },
  and: (...conds: unknown[]) => ({ __type: "and", conds }),
}));

// ---------------------------------------------------------------------------
// db/schema mock — expose identities + users columns the handler uses
// ---------------------------------------------------------------------------

// Phase 66 Plan 04: schema mock narrowed to 5 surviving columns on identities.
vi.mock("../db/schema.js", () => ({
  identities: {
    id: { _colName: "id", _table: "identities" },
    userId: { _colName: "userId", _table: "identities" },
    identityKey: { _colName: "identityKey", _table: "identities" },
    createdAt: { _colName: "createdAt", _table: "identities" },
    updatedAt: { _colName: "updatedAt", _table: "identities" },
    _tableName: "identities",
  },
  users: {
    id: { _colName: "id", _table: "users" },
    username: { _colName: "username", _table: "users" },
    _tableName: "users",
  },
}));

// ---------------------------------------------------------------------------
// db/index mock — chained select/insert routed by from() table
// ---------------------------------------------------------------------------

vi.mock("../db/index.js", () => {
  const chain = {
    select: (keys?: Record<string, unknown>) => {
      dbState.lastSelectedKeys = keys ? Object.keys(keys) : null;
      return chain;
    },
    from: (table: { _tableName: string }) => {
      dbState.lastTable = table._tableName as "identities" | "users";
      return chain;
    },
    where: () => {
      dbState.lastFilter = { ...filterAccum };
      filterAccum = {};
      return chain;
    },
    all: () => {
      const f = dbState.lastFilter;
      const table = dbState.lastTable;
      const keys = dbState.lastSelectedKeys;
      dbState.lastFilter = {};
      dbState.lastTable = null;
      dbState.lastSelectedKeys = null;

      const source =
        table === "users"
          ? (dbState.users as unknown as Record<string, unknown>[])
          : (dbState.identities as unknown as Record<string, unknown>[]);
      const rows = source.filter((r) => {
        if (table === "users") {
          if (f.userId !== undefined && r.id !== f.userId) return false;
        } else {
          if (f.userId !== undefined && r.userId !== f.userId) return false;
          if (f.id !== undefined && r.id !== f.id) return false;
          if (f.identityKey !== undefined && r.identityKey !== f.identityKey) {
            return false;
          }
        }
        return true;
      });
      if (!keys) return rows;
      return rows.map((r) => {
        const out: Record<string, unknown> = {};
        for (const k of keys) out[k] = r[k];
        return out;
      });
    },
    insert: (table: { _tableName: string }) => {
      dbState.lastTable = table._tableName as "identities" | "users";
      return chain;
    },
    values: (row: IdentityRow) => {
      dbState.lastPendingInsertRow = row;
      return chain;
    },
    run: () => {
      const row = dbState.lastPendingInsertRow;
      const table = dbState.lastTable;
      dbState.lastPendingInsertRow = null;
      dbState.lastTable = null;
      const injection = dbState.nextInsertRaceInjection;
      if (injection) {
        // Simulate a concurrent insert landing between our SELECT and INSERT:
        // the "winner" row lands in the table, then our INSERT fails with
        // the schema's UNIQUE(user_id, identity_key) constraint. One-shot.
        dbState.nextInsertRaceInjection = null;
        dbState.identities.push(injection.winnerRow);
        const err = new Error(
          "UNIQUE constraint failed: identities.user_id, identities.identity_key",
        ) as Error & { code: string };
        err.code = "SQLITE_CONSTRAINT_UNIQUE";
        throw err;
      }
      if (row && table === "identities") {
        dbState.identities.push(row);
        dbState.insertCount++;
      }
    },
  };
  return { db: chain };
});

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  authLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

import router from "./identity-share.js";

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

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

// Phase 66 Plan 04: cosmetic fields removed from the seed. Any test that
// spread additional cosmetic keys via `overrides` now silently drops them
// (Partial<IdentityRow> excludes those keys entirely because the type
// itself narrowed above).
function makeSourceIdentity(overrides: Partial<IdentityRow> = {}): IdentityRow {
  return {
    id: "src-id-nano",
    userId: "u-alice",
    identityKey: "tina",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();
  dbState.identities = [];
  dbState.users = [
    { id: "u-alice", username: "alice" },
    { id: "u-bob", username: "bob" },
    { id: "u-carol", username: "carol" },
  ];
  dbState.lastFilter = {};
  dbState.lastTable = null;
  dbState.lastSelectedKeys = null;
  dbState.lastPendingInsertRow = null;
  dbState.insertCount = 0;
  dbState.nextInsertRaceInjection = null;
  filterAccum = {};
  mockUserId = "u-alice";

  // Default: source identity exists under alice
  dbState.identities.push(makeSourceIdentity());

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/identities", router);

  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /identities/:id/share", () => {
  it("Test 1: no JWT → 401", async () => {
    mockUserId = null;
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/src-id-nano/share",
      body: JSON.stringify({ targetUserId: "u-bob" }),
    });
    expect(res.status).toBe(401);
    expect(dbState.insertCount).toBe(0);
  });

  it("Test 2: empty body → 400 'targetUserId is required'", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/src-id-nano/share",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe(
      "targetUserId is required",
    );
    expect(dbState.insertCount).toBe(0);
  });

  it("Test 3: non-string targetUserId → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/src-id-nano/share",
      body: JSON.stringify({ targetUserId: 123 }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe(
      "targetUserId is required",
    );
    expect(dbState.insertCount).toBe(0);
  });

  it("Test 4: self-target → 400 'Cannot share to self'", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/src-id-nano/share",
      body: JSON.stringify({ targetUserId: "u-alice" }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("Cannot share to self");
    expect(dbState.insertCount).toBe(0);
  });

  it("Test 5: source id not visible to requester (owned by different user) → 404", async () => {
    // Replace default seed with a bob-owned identity — alice cannot see it
    dbState.identities = [
      makeSourceIdentity({
        id: "bob-only-id",
        userId: "u-bob",
        identityKey: "bob-only",
      }),
    ];
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/bob-only-id/share",
      body: JSON.stringify({ targetUserId: "u-carol" }),
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe("Identity not found");
    expect(dbState.insertCount).toBe(0);
  });

  it("Test 6: source id genuinely does not exist → 404", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/nonexistent-id/share",
      body: JSON.stringify({ targetUserId: "u-bob" }),
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe("Identity not found");
    expect(dbState.insertCount).toBe(0);
  });

  it("Test 7: target user does not exist → 400 'Target user not found'", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/src-id-nano/share",
      body: JSON.stringify({ targetUserId: "u-ghost" }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe(
      "Target user not found",
    );
    expect(dbState.insertCount).toBe(0);
  });

  it("Test 8: happy path — inserts new row with copied fields, shared:true", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/src-id-nano/share",
      body: JSON.stringify({ targetUserId: "u-bob" }),
    });
    expect(res.status).toBe(200);
    const body = res.body as { identityId: string; shared: boolean };
    expect(body.shared).toBe(true);
    expect(body.identityId).toBe("new-share-uuid");

    // Exactly one new identity row inserted, under u-bob
    expect(dbState.insertCount).toBe(1);
    expect(dbState.identities.length).toBe(2);
    const newRow = dbState.identities.find((r) => r.id === "new-share-uuid");
    expect(newRow).toBeDefined();
    expect(newRow!.userId).toBe("u-bob");

    // Phase 66 Plan 04: only the 5 surviving columns are copied. Cosmetics
    // live on disk — share-onward implicitly gains them from the disk file
    // (identityKey is the disk-lookup key). The insertRow is narrow now.
    const source = dbState.identities.find((r) => r.id === "src-id-nano")!;
    expect(newRow!.identityKey).toBe(source.identityKey);
    expect((newRow as unknown as Record<string, unknown>).displayName).toBeUndefined();
    expect((newRow as unknown as Record<string, unknown>).avatarData).toBeUndefined();
    expect((newRow as unknown as Record<string, unknown>).avatarMime).toBeUndefined();
    expect((newRow as unknown as Record<string, unknown>).avatarEtag).toBeUndefined();
    expect((newRow as unknown as Record<string, unknown>).colorHue).toBeUndefined();
    expect((newRow as unknown as Record<string, unknown>).voice).toBeUndefined();
    expect((newRow as unknown as Record<string, unknown>).title).toBeUndefined();

    // Fresh timestamps — ISO strings, distinct from source's 2026-01-01 seed
    expect(newRow!.createdAt).not.toBe(source.createdAt);
    expect(newRow!.updatedAt).not.toBe(source.updatedAt);
    expect(newRow!.createdAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });

  it("Test 9: no-op on repeat — target already has identityKey → 200 shared:false, NO insert", async () => {
    // Seed an existing bob row with SAME identityKey as alice's source.
    // Phase 66 Plan 04: cosmetic overrides no longer meaningful — the row
    // only holds ownership + timestamps.
    const existingBobRow = makeSourceIdentity({
      id: "existing-bob-tina-id",
      userId: "u-bob",
      identityKey: "tina",
    });
    dbState.identities.push(existingBobRow);
    const countBefore = dbState.identities.length;

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/src-id-nano/share",
      body: JSON.stringify({ targetUserId: "u-bob" }),
    });
    expect(res.status).toBe(200);
    const body = res.body as { identityId: string; shared: boolean };
    expect(body.shared).toBe(false);
    // Returns the EXISTING row's id (not the source's, not a new one)
    expect(body.identityId).toBe("existing-bob-tina-id");

    // NO insert — row count unchanged
    expect(dbState.insertCount).toBe(0);
    expect(dbState.identities.length).toBe(countBefore);
  });

  it("Test 10: share-onward — requester received identity via prior share (not creator) still shares successfully", async () => {
    // Simulate: alice is NOT the original creator. She has the identity in
    // her scope via a prior share (id different from any original creator's).
    // The handler MUST NOT check "did alice create this" — the only gate is
    // "is this identity in alice's userId scope."
    dbState.identities = [
      makeSourceIdentity({
        id: "alice-received-tina-id",
        userId: "u-alice",
        // Same identityKey as some other user might have — no matter
        identityKey: "tina",
      }),
    ];

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/alice-received-tina-id/share",
      body: JSON.stringify({ targetUserId: "u-carol" }),
    });
    expect(res.status).toBe(200);
    const body = res.body as { identityId: string; shared: boolean };
    expect(body.shared).toBe(true);
    expect(body.identityId).toBe("new-share-uuid");

    // Alice's row still there + one new carol row. Phase 66 Plan 04:
    // narrow insert — no cosmetic-copy from source.
    expect(dbState.identities.length).toBe(2);
    const carolRow = dbState.identities.find((r) => r.userId === "u-carol");
    expect(carolRow).toBeDefined();
    expect(carolRow!.identityKey).toBe("tina");
    expect((carolRow as unknown as Record<string, unknown>).displayName).toBeUndefined();
    expect((carolRow as unknown as Record<string, unknown>).colorHue).toBeUndefined();
    expect((carolRow as unknown as Record<string, unknown>).voice).toBeUndefined();
    expect((carolRow as unknown as Record<string, unknown>).avatarMime).toBeUndefined();
    expect((carolRow as unknown as Record<string, unknown>).avatarData).toBeUndefined();
  });

  it("Test 11: race safety — UNIQUE(user_id, identity_key) conflict on INSERT → 200 shared:false with race-winner's id (not 500)", async () => {
    // Setup: target user has NO conflicting row at the moment of the initial
    // no-op SELECT (so the handler proceeds toward INSERT). We inject a
    // one-shot race: when the handler's INSERT runs, the concurrent winner
    // row appears in the table AND the INSERT fails with the schema's
    // UNIQUE(user_id, identity_key) constraint. Handler must catch the
    // constraint, re-SELECT, and return 200 shared:false with the winner's
    // id — not 500 — so the client's re-share contract still holds under
    // concurrency.
    const raceWinnerRow = makeSourceIdentity({
      id: "race-winner-bob-tina-id",
      userId: "u-bob",
      identityKey: "tina",
    });
    dbState.nextInsertRaceInjection = { winnerRow: raceWinnerRow };

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/src-id-nano/share",
      body: JSON.stringify({ targetUserId: "u-bob" }),
    });

    // 200 shared:false — silent-no-op contract honored despite the race
    expect(res.status).toBe(200);
    const body = res.body as { identityId: string; shared: boolean };
    expect(body.shared).toBe(false);
    // Returns the race-winner's id (not a fresh nanoid, not the source's)
    expect(body.identityId).toBe("race-winner-bob-tina-id");

    // The winner row is in the table (from the injection); no additional
    // insertCount bump from OUR insert path (it threw before reaching the
    // normal push).
    expect(dbState.insertCount).toBe(0);
    expect(dbState.identities.some((r) => r.id === "race-winner-bob-tina-id")).toBe(true);
  });
});
