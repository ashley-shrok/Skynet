/**
 * resolveHostByUniversalId — maps a URL host id (row id or machine_id) to the
 * caller's own row for the same physical machine.
 *
 * The db is a tiny fake: drizzle's eq/and are replaced with plain objects and
 * evaluated against an in-memory row list, so the tests assert on WHICH row
 * comes back rather than on query shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = { id: number; userId: string; machineId: number | null; credentialId: null };
type Cond = { eq: [string, unknown] } | { and: Cond[] };

let rows: Row[] = [];
let grants = new Set<string>();

const FIELD: Record<string, keyof Row> = {
  id: "id",
  user_id: "userId",
  machine_id: "machineId",
};

function matches(row: Row, c: Cond): boolean {
  if ("and" in c) return c.and.every((x) => matches(row, x));
  const [col, val] = c.eq;
  return row[FIELD[col]] === val;
}

vi.mock("drizzle-orm", async (orig) => ({
  ...(await orig<typeof import("drizzle-orm")>()),
  eq: (col: { name: string }, val: unknown) => ({ eq: [col.name, val] }),
  and: (...conds: Cond[]) => ({ and: conds }),
}));

function makeChain() {
  const chain = {
    cond: null as Cond | null,
    from: vi.fn(() => chain),
    where: vi.fn((c: Cond) => {
      chain.cond = c;
      return chain;
    }),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(async () =>
      rows
        .filter((r) => matches(r, chain.cond!))
        .sort((a, b) => a.id - b.id)
        .slice(0, 1),
    ),
  };
  return chain;
}

vi.mock("../database/db/index.js", () => ({
  getDb: vi.fn(() => ({ select: vi.fn(() => makeChain()) })),
}));

vi.mock("../utils/simple-db-ops.js", () => ({
  SimpleDBOps: {
    select: vi.fn(async (chain: { cond: Cond }) =>
      rows.filter((r) => matches(r, chain.cond)).map((r) => ({ ...r })),
    ),
  },
}));

vi.mock("../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      canAccessHost: async (userId: string, hostId: number) => {
        const owner = rows.find((r) => r.id === hostId)?.userId === userId;
        return { hasAccess: owner || grants.has(`${userId}:${hostId}`) };
      },
    }),
  },
}));

vi.mock("../utils/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { resolveHostByUniversalId } from "./host-resolver.js";

const row = (id: number, userId: string, machineId: number | null): Row => ({
  id,
  userId,
  machineId,
  credentialId: null,
});

beforeEach(() => {
  grants = new Set();
  rows = [
    row(5, "alice", 5), // alice's entry, anchors machine 5
    row(9, "bob", 5), // bob's entry for the same box
    row(12, "bob", 5), // bob's second entry (different SSH user)
    row(7, "carol", 7), // unrelated box
  ];
});

describe("resolveHostByUniversalId", () => {
  it("maps another user's row id to the caller's own row on that machine", async () => {
    expect((await resolveHostByUniversalId(5, "bob"))?.id).toBe(9);
    expect((await resolveHostByUniversalId(9, "alice"))?.id).toBe(5);
  });

  it("uses the caller's own row as-is when the ref is theirs", async () => {
    expect((await resolveHostByUniversalId(12, "bob"))?.id).toBe(12);
  });

  it("accepts a machine_id whose anchor row was deleted", async () => {
    rows = rows.filter((r) => r.id !== 5);
    expect((await resolveHostByUniversalId(5, "bob"))?.id).toBe(9);
  });

  it("returns null when the caller has no row on that machine and no grant", async () => {
    expect(await resolveHostByUniversalId(5, "carol")).toBeNull();
    expect(await resolveHostByUniversalId(7, "alice")).toBeNull();
    expect(await resolveHostByUniversalId(999, "alice")).toBeNull();
  });

  it("falls back to a host_access grant on the referenced row", async () => {
    grants.add("carol:5");
    expect((await resolveHostByUniversalId(5, "carol"))?.id).toBe(5);
  });
});
