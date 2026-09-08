/**
 * host-resolver-by-name.test.ts (Phase 78, Plan 78-01, Task 1)
 *
 * Vitest suite for `resolveHostByName(name, userId)` — the NEW helper that
 * scopes host lookup by BOTH `hosts.name` AND `hosts.userId`.
 *
 * Cross-user isolation is load-bearing (RESEARCH § Pitfall 7):
 * `hosts.name` is a per-user friendly name and is NOT unique across users. If
 * two users both have a host named `thenasty`, filtering only by `name` would
 * let user A trigger reads on user B's box just by guessing the friendly name.
 * `and(name, userId)` returns null on cross-user access; the route boundary
 * then maps null → 404 `unknown_host` (no cross-user existence leak).
 *
 * Tests use the same "mock DB module" pattern established for
 * permission-manager.test.ts — stub the DB barrel + logger before importing
 * the module under test, then drive `db.select().from(hosts).where(...)` via
 * a chainable spy that records the WHERE clause and returns fixture rows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* --------------------------------------------------------------------- */
/*  Mock the DB barrel + logger BEFORE importing the module under test   */
/* --------------------------------------------------------------------- */

/**
 * Fixture data set at test time; the chainable spy below reads from this to
 * decide what `.where(...)` should return.
 */
type HostRow = Record<string, unknown> & {
  id: number;
  name: string;
  userId: string;
};

let hostFixtures: HostRow[] = [];
let credentialFixtures: Record<string, unknown>[] = [];
/** Table→fixtures map — the mock `SimpleDBOps.select` reads by tableName. */
const tableFixtures: Record<string, unknown[]> = {
  ssh_data: [],
  ssh_credentials: [],
};

/**
 * Records of the last-observed WHERE clause per query. drizzle's `eq()` /
 * `and()` return opaque objects; we snapshot the arguments at call time via
 * spies so tests can assert the actual filter shape.
 */
interface WhereSnapshot {
  columnEq: Array<{ column: unknown; value: unknown }>;
}
let lastWhere: WhereSnapshot = { columnEq: [] };
function resetWhereSnapshot() {
  lastWhere = { columnEq: [] };
}

vi.mock("drizzle-orm", () => {
  const eq = vi.fn((column: unknown, value: unknown) => {
    lastWhere.columnEq.push({ column, value });
    return { __eq: true, column, value };
  });
  const and = vi.fn((...args: unknown[]) => ({ __and: true, args }));
  const or = vi.fn((...args: unknown[]) => ({ __or: true, args }));
  const isNull = vi.fn((column: unknown) => ({ __isNull: true, column }));
  const gte = vi.fn((column: unknown, value: unknown) => ({
    __gte: true,
    column,
    value,
  }));
  const sql = Object.assign(vi.fn(), { join: vi.fn() });
  return { eq, and, or, isNull, gte, sql };
});

/**
 * Chainable query builder shape that mirrors drizzle enough for
 * resolveHostByName. Every terminal Promise resolves to whatever fixture
 * corresponds to the current table.
 *
 * The `.from(...)` call captures which schema table is being queried and
 * uses that to pick the right fixture bucket.
 */
function makeChainable(table: string) {
  const chain: Record<string, unknown> = {
    from: vi.fn((_tbl: unknown) => chain),
    where: vi.fn((_clause: unknown) => chain),
    limit: vi.fn((_n: number) => chain),
    then: (resolve: (v: unknown[]) => void) => {
      resolve(tableFixtures[table] ?? []);
      return { catch: () => {} };
    },
  };
  return chain;
}

/**
 * Mock `getDb()` — returns a db-shaped object where `.select().from(hosts)`
 * and `.select().from(sshCredentials)` both return chainable builders that
 * resolve to the current fixture bucket. `hosts` and `sshCredentials` are
 * mocked to opaque markers.
 */
vi.mock("../database/db/index.js", () => {
  const hostsMarker = { __table: "hosts" };
  const sshCredentialsMarker = { __table: "sshCredentials" };
  return {
    getDb: () => ({
      select: vi.fn(() => ({
        from: vi.fn((tbl: { __table?: string }) => {
          const tableName =
            tbl?.__table === "hosts" ? "ssh_data" : "ssh_credentials";
          return makeChainable(tableName);
        }),
      })),
    }),
    db: {},
    hostsMarker,
    sshCredentialsMarker,
  };
});

vi.mock("../database/db/schema.js", () => ({
  hosts: { __table: "hosts", name: { __col: "name" }, userId: { __col: "userId" }, id: { __col: "id" } },
  sshCredentials: {
    __table: "sshCredentials",
    id: { __col: "credId" },
    userId: { __col: "credUserId" },
  },
  hostAccess: { __table: "hostAccess" },
}));

vi.mock("../utils/simple-db-ops.js", () => ({
  SimpleDBOps: {
    /**
     * Reads the fixture bucket keyed by the tableName arg. Signature mirrors
     * the real `SimpleDBOps.select(query, tableName, userId)`.
     */
    select: vi.fn(async (query: unknown, tableName: string, _userId: string) => {
      // `await` the chainable so its `.then` fires and returns fixtures.
      // The query is already a chain from getDb().select().from(...)
      const rows = await Promise.resolve(query as unknown as unknown[]);
      // Prefer the tableFixtures bucket by name.
      return tableFixtures[tableName] ?? rows ?? [];
    }),
  },
}));

vi.mock("../utils/logger.js", () => ({
  logger: {
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
  databaseLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

/* --------------------------------------------------------------------- */
/*  Import module under test                                             */
/* --------------------------------------------------------------------- */

const { resolveHostByName, resolveHostById } = await import(
  "./host-resolver.js"
);

/* --------------------------------------------------------------------- */
/*  Test helpers                                                         */
/* --------------------------------------------------------------------- */

function setHostFixtures(rows: HostRow[]) {
  hostFixtures = rows;
  tableFixtures.ssh_data = rows;
}
function setCredentialFixtures(rows: Record<string, unknown>[]) {
  credentialFixtures = rows;
  tableFixtures.ssh_credentials = rows;
}

beforeEach(() => {
  vi.clearAllMocks();
  hostFixtures = [];
  credentialFixtures = [];
  tableFixtures.ssh_data = [];
  tableFixtures.ssh_credentials = [];
  resetWhereSnapshot();
});

/* --------------------------------------------------------------------- */
/*  Tests                                                                */
/* --------------------------------------------------------------------- */

describe("resolveHostByName — cross-user isolation invariants", () => {
  it("Test 1: returns the host row when name AND userId both match", async () => {
    setHostFixtures([
      {
        id: 42,
        name: "thenasty",
        userId: "user-A",
        ip: "100.101.1.1",
        port: 22,
        username: "ubuntu",
        authType: "password",
        password: "secret",
      },
    ]);

    const result = await resolveHostByName("thenasty", "user-A");
    expect(result).not.toBeNull();
    expect(result?.id).toBe(42);
    expect(result?.name).toBe("thenasty");
    expect((result as unknown as { userId: string }).userId).toBe("user-A");
  });

  it("Test 2: returns null when only user-A owns 'thenasty' but user-B asks", async () => {
    // Fixture holds ONLY the user-A row; the chainable stubs return the whole
    // bucket, but the resolver must apply an `and(name, userId)` filter which
    // — since our mock chain doesn't actually filter — is enforced via the
    // downstream .where() call snapshot. To simulate a cross-user miss, we
    // set the bucket to empty here (representing what the real DB would
    // return after the userId scope).
    setHostFixtures([]);

    const result = await resolveHostByName("thenasty", "user-B");
    expect(result).toBeNull();
  });

  it("Test 3: returns null when no host by that name exists at all", async () => {
    setHostFixtures([]);

    const result = await resolveHostByName("no-such-host", "user-A");
    expect(result).toBeNull();
  });

  it("Test 4: returned shape parity with resolveHostById (JSON-fields parsed, credentials resolved)", async () => {
    // Fixture: JSON-encoded jumpHosts + tunnelConnections; credentialId set;
    // credential fixture returned via sshCredentials bucket.
    setHostFixtures([
      {
        id: 42,
        name: "thenasty",
        userId: "user-A",
        ip: "100.101.1.1",
        port: 22,
        username: "ubuntu",
        authType: "password",
        credentialId: 7,
        jumpHosts: JSON.stringify([{ host: "bastion" }]),
        tunnelConnections: JSON.stringify([{ port: 3000 }]),
      },
    ]);
    setCredentialFixtures([
      {
        id: 7,
        userId: "user-A",
        username: "ubuntu",
        password: "resolved-secret",
        key: null,
        keyPassword: null,
        keyType: null,
      },
    ]);

    const result = await resolveHostByName("thenasty", "user-A");
    expect(result).not.toBeNull();
    // JSON-field parsing performed by the credential-resolution tail:
    expect(Array.isArray((result as unknown as { jumpHosts: unknown }).jumpHosts)).toBe(
      true,
    );
    expect(
      Array.isArray(
        (result as unknown as { tunnelConnections: unknown }).tunnelConnections,
      ),
    ).toBe(true);
    // Credential resolution attached: password copied through, authType set
    expect((result as unknown as { password: string }).password).toBe(
      "resolved-secret",
    );
    expect(result?.authType).toBe("password");
  });

  it("Test 5: cross-user isolation — the query filters by BOTH name AND userId", async () => {
    // Even if the fixture bucket were populated with a foreign-user host, the
    // real DB would filter it out. Here we assert that the mocked `eq()` was
    // called for both `name` AND `userId` — the load-bearing invariant per
    // RESEARCH Pitfall 7. This is a structural check that survives any
    // implementation detail change in the credential-resolution tail.
    setHostFixtures([]);

    const drizzle = await import("drizzle-orm");
    await resolveHostByName("thenasty", "user-A");

    const eqCalls = (drizzle.eq as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    const columns = eqCalls.map((call) => (call[0] as { __col?: string })?.__col);
    // `resolveHostByName` MUST call eq(hosts.name, name) AND eq(hosts.userId, userId).
    expect(columns).toContain("name");
    expect(columns).toContain("userId");
  });

  it("Test 6: resolveHostById still exists and is callable (existing helper unchanged)", () => {
    expect(typeof resolveHostById).toBe("function");
  });
});
