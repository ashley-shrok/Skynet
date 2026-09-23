/**
 * host-user-counter.test.ts — Phase 129 Plan 01 Task 3
 *
 * Unit tests for isHostMultiUser + getUsernameForUserId. Uses vi.mock on the
 * database barrel + drizzle-orm + schema so no real SQLite is spun up.
 *
 * The mock db is a queue-based select-chain: each terminal `.where(...)` or
 * `.limit(...)` returns the next queued result-set (a plain array). Tests
 * enqueue result-sets in the order isHostMultiUser issues its queries:
 *   1. hosts (owner lookup)
 *   2. hostAccess (direct-user + role-scoped shares)
 *   3. userRoles (RBAC-role expansion — only issued if any role-scoped shares)
 * getUsernameForUserId issues a single query.
 *
 * Structured-log assertions (Test 10) verify the debug entries at gate seam
 * per box-maintainer directive (hostId + distinctUsers count at every check).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — hoisted per vitest semantics. The queued-result-set select-chain
// lets each test enqueue exactly the rows its queries should see.
// ---------------------------------------------------------------------------

const resultQueue: unknown[][] = [];

/**
 * Build a chain object that is both continue-chainable (returns itself from
 * select/from/where/limit) AND thenable (awaiting it pops the next queued
 * result-set). This lets the module code write both:
 *   await db.select(...).from(...).where(...)                — 3 chain calls, awaited
 *   await db.select(...).from(...).where(...).limit(1)       — 4 chain calls, awaited
 * without the mock caring which terminal was chosen.
 */
function makeChain() {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.then = (
    onFulfilled: (value: unknown[]) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => {
    try {
      const rows = resultQueue.shift() ?? [];
      return Promise.resolve(rows).then(onFulfilled, onRejected);
    } catch (err) {
      return Promise.reject(err).then(onFulfilled, onRejected);
    }
  };
  return chain;
}

const mockDb = makeChain();

vi.mock("../database/db/index.js", () => ({
  db: mockDb,
}));

vi.mock("../database/db/schema.js", () => ({
  hosts: {
    id: { _col: "hosts.id" },
    userId: { _col: "hosts.userId" },
    ip: { _col: "hosts.ip" },
    port: { _col: "hosts.port" },
    username: { _col: "hosts.username" },
  },
  hostAccess: {
    hostId: { _col: "hostAccess.hostId" },
    userId: { _col: "hostAccess.userId" },
    roleId: { _col: "hostAccess.roleId" },
  },
  userRoles: {
    roleId: { _col: "userRoles.roleId" },
    userId: { _col: "userRoles.userId" },
  },
  users: {
    id: { _col: "users.id" },
    username: { _col: "users.username" },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ __op: "eq", col, val })),
  and: vi.fn((...clauses: unknown[]) => ({ __op: "and", clauses })),
  ne: vi.fn((col: unknown, val: unknown) => ({ __op: "ne", col, val })),
  inArray: vi.fn((col: unknown, vals: unknown[]) => ({
    __op: "inArray",
    col,
    vals,
  })),
  isNotNull: vi.fn((col: unknown) => ({ __op: "isNotNull", col })),
}));

const debugLog = vi.fn();
const infoLog = vi.fn();
const warnLog = vi.fn();
const errorLog = vi.fn();

vi.mock("./logger.js", () => ({
  systemLogger: {
    debug: debugLog,
    info: infoLog,
    warn: warnLog,
    error: errorLog,
    success: vi.fn(),
  },
  databaseLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
  sshLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const {
  isHostMultiUser,
  getUsernameForUserId,
} = await import("./host-user-counter.js");

// ---------------------------------------------------------------------------
// Test helpers — enqueue mock query result-sets in the order the module
// issues them for isHostMultiUser:
//   1. owner (hosts): [{userId, ip, port, username}] or []
//   2. direct-user shares (hostAccess where userId not null): [{userId: "..."}]
//   3. role-scoped shares (hostAccess where roleId not null): [{roleId: N}]
//   4. userRoles expansion (if step 3 non-empty): [{userId: "..."}]
//   5. SSH-connection collision (hosts where ip/port/username match, id != hostId):
//      [{userId: "..."}] — Skynet's actual sharing model today (Phase 129
//      post-deploy fix 2026-09-23; see host-user-counter.ts Query 5 docblock).
//
// Owner rows carry a default (ip, port, username) tuple ("10.0.0.1", 22, "u")
// unless a test overrides it. The collision query is issued unconditionally
// after Query 4 — every test MUST enqueue a 5th result-set (empty [] if no
// collision expected).
// ---------------------------------------------------------------------------

const DEFAULT_OWNER_CONN = { ip: "10.0.0.1", port: 22, username: "u" };
function ownerRow(userId: string, override?: Partial<typeof DEFAULT_OWNER_CONN>) {
  return { userId, ...DEFAULT_OWNER_CONN, ...(override ?? {}) };
}

function enqueue(...rows: unknown[][]) {
  for (const r of rows) resultQueue.push(r);
}

beforeEach(() => {
  resultQueue.length = 0;
  debugLog.mockReset();
  infoLog.mockReset();
  warnLog.mockReset();
  errorLog.mockReset();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// isHostMultiUser — 7 behavior tests + 1 structured-log test
// ---------------------------------------------------------------------------

describe("isHostMultiUser — Phase 129 multi-user host detection", () => {
  it("Test 1: unknown hostId returns false (defensive — no phantom auto-tag)", async () => {
    // owner lookup returns empty rows → unknown host. Early-return skips
    // queries 2-5, so no additional enqueues needed.
    enqueue([]);
    const result = await isHostMultiUser(9999);
    expect(result).toBe(false);
  });

  it("Test 2: owner-only, no shares, no SSH collision → false (single-user host)", async () => {
    enqueue(
      [ownerRow("U1")], // owner
      [], // no direct-user shares
      [], // no role-scoped shares
      [], // no SSH-connection collision
    );
    expect(await isHostMultiUser(1)).toBe(false);
  });

  it("Test 3: direct-user share → true (owner + other user = 2 distinct)", async () => {
    enqueue(
      [ownerRow("U1")], // owner
      [{ userId: "U2" }], // direct share to U2
      [], // no role-scoped shares
      [], // no SSH-connection collision
    );
    expect(await isHostMultiUser(1)).toBe(true);
  });

  it("Test 4: share back to owner is not double-counted (Set dedup)", async () => {
    enqueue(
      [ownerRow("U1")], // owner
      [{ userId: "U1" }], // defensive: hostAccess row back to owner
      [], // no role-scoped shares
      [], // no SSH-connection collision
    );
    expect(await isHostMultiUser(1)).toBe(false);
  });

  it("Test 5: RBAC-role share (Assumption A6) — role expands to non-owner member → true", async () => {
    enqueue(
      [ownerRow("U1")], // owner
      [], // no direct-user shares
      [{ roleId: 42 }], // one role-scoped share
      [{ userId: "U2" }], // role R42 members includes U2
      [], // no SSH-connection collision
    );
    expect(await isHostMultiUser(1)).toBe(true);
  });

  it("Test 6: RBAC-role share where role's sole member IS the owner → false", async () => {
    enqueue(
      [ownerRow("U1")], // owner
      [], // no direct-user shares
      [{ roleId: 99 }], // one role-scoped share
      [{ userId: "U1" }], // role R99 has only owner as member
      [], // no SSH-connection collision
    );
    expect(await isHostMultiUser(1)).toBe(false);
  });

  it("Test 7: overlapping direct + role share → dedup to size 2, still true", async () => {
    enqueue(
      [ownerRow("U1")], // owner
      [{ userId: "U2" }], // direct share to U2
      [{ roleId: 7 }], // role-scoped share
      [{ userId: "U2" }], // role R7 also contains U2 (overlap with direct)
      [], // no SSH-connection collision
    );
    // Owner U1 + share U2 + role-member U2 → Set size 2, still > 1.
    expect(await isHostMultiUser(1)).toBe(true);
  });

  it("Test 7b: SSH-connection collision — another user's host row on same (ip, port, username) → true (Skynet's actual shared-host model)", async () => {
    // Post-deploy fix 2026-09-23: Skynet's real sharing model is per-user
    // connection profiles pointing at the same physical (ip, port, ssh-user).
    // host_access is empty in prod (verified in the live thenasty repro).
    // Same (ip, port, username) on a different user's row → same filesystem
    // → multi-user for auto-tag purposes.
    enqueue(
      [ownerRow("U1", { ip: "1.2.3.4", port: 22, username: "svc" })], // owner
      [], // no direct-user shares (production shape)
      [], // no role-scoped shares
      [{ userId: "U2" }], // another user has ssh_data row on same connection
    );
    expect(await isHostMultiUser(1)).toBe(true);
  });

  it("Test 7c: SSH-connection collision back to owner (defensive) → not double-counted", async () => {
    // ne(hosts.id, hostId) filter should already exclude the row itself, but
    // if a stale/duplicate row for the same user exists (id != hostId, same
    // owner user_id) the Set dedup keeps distinctUsers correct.
    enqueue(
      [ownerRow("U1")], // owner
      [], // no direct shares
      [], // no role shares
      [{ userId: "U1" }], // same-connection row happens to belong to owner
    );
    expect(await isHostMultiUser(1)).toBe(false);
  });

  it("Test 7d: SSH-connection collision + direct share (dedup across paths) → true, count stays honest", async () => {
    enqueue(
      [ownerRow("U1")], // owner
      [{ userId: "U2" }], // direct share to U2
      [], // no role shares
      [{ userId: "U2" }], // collision row also for U2 (dedup — Set size still 2)
    );
    expect(await isHostMultiUser(1)).toBe(true);
  });

  it("Test 8: structured log fires at entry and exit with hostId + distinctUsers count", async () => {
    enqueue(
      [ownerRow("U1")], // owner
      [{ userId: "U2" }], // direct share
      [], // no role-scoped shares
      [], // no SSH-connection collision
    );
    await isHostMultiUser(42);
    // Entry log — hostId present, no count yet.
    expect(debugLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        operation: "host_user_counter_check",
        hostId: 42,
      }),
    );
    // Exit log — hostId + distinctUsers count + isMultiUser boolean.
    expect(debugLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        operation: "host_user_counter_result",
        hostId: 42,
        distinctUsers: 2,
        isMultiUser: true,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// getUsernameForUserId — 2 behavior tests
// ---------------------------------------------------------------------------

describe("getUsernameForUserId — Phase 129 username lookup", () => {
  it("Test 9: known user returns case-preserved username", async () => {
    enqueue([{ username: "User" }]);
    const result = await getUsernameForUserId("some-user-id");
    // Case preserved verbatim — Pitfall 7 lock (no toLowerCase on the read side).
    expect(result).toBe("User");
  });

  it("Test 10: unknown userId returns null (defensive path)", async () => {
    enqueue([]); // no matching row
    const result = await getUsernameForUserId("unknown-id");
    expect(result).toBeNull();
  });
});
