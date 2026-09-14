/**
 * Phase 80 Plan 04 — Tests for the pool-routes router (POST /pick).
 *
 * Tests exercise POST /identities/pool/pick via a bare Express app using
 * Node's built-in http module (project convention: no supertest — mirror
 * roles-list-for-host.test.ts pattern).
 *
 * Auth middleware is mocked. All backend collaborators (resolveHostById,
 * getVettedPool, listIdentityKeysOnHost, isLocalHostId, connectOneShot) are
 * mocked so tests exercise only the router logic.
 *
 * ─── 2026-09-14 rewrite ────────────────────────────────────────────────────
 * The availability authority moved from Synapse (per-candidate MXID probe) to
 * the target host's identity directories (single enumeration + set difference).
 * Consequences reflected in these tests:
 *   - `role` is OPTIONAL — it only ever existed here to compose the probe MXID.
 *     A malformed role is still a 400; an ABSENT role is now a 200.
 *   - The Matrix admin-creds fail-early gate is gone (no Matrix dependency).
 *   - Enumeration failure degrades to an unverified suggestion, never a 5xx.
 *
 * Test coverage:
 *   1:   missing JWT → 401
 *   2:   missing hostId → 400
 *   3:   non-integer hostId → 400
 *   4:   ABSENT role → 200 (inverted from the old "missing role → 400")
 *   4b:  empty-string role → 200 (treated as absent)
 *   5:   role uppercase → 400 (malformed role still rejected)
 *   6:   role leading digit → 200 (inverted — canonical pattern allows it)
 *   6b:  genuinely malformed role → 400
 *   7:   cross-user hostId → 404
 *   8:   empty pool → 503 "pool is empty"
 *   9:   HAPPY PATH — a name already on the host is skipped
 *   10:  host enumerated EXACTLY ONCE regardless of pool size (cost guard)
 *   11:  all names taken → falls back to a taken candidate, never fails
 *   12:  unreachable host still returns a name (degradation contract)
 *   12b: enumeration failure mid-flight still returns a name
 *   12c: a hanging host does not hang the request (total budget)
 *   13:  LOCAL host skips SSH entirely (conn === null)
 *   13b: REMOTE host closes its SSH connection
 *   14:  pool casing drift — PascalCase entry matches lowercase folder
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
// Auth manager mock — controls whether a request is authenticated
// ---------------------------------------------------------------------------

let mockUserId: string | null = "1";

vi.mock("../utils/auth-manager.js", () => {
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
// Mock backend collaborators BEFORE importing the module under test
// ---------------------------------------------------------------------------

vi.mock("../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(),
}));

vi.mock("./pool-loader.js", () => ({
  getVettedPool: vi.fn(),
}));

// 2026-09-14: the availability authority moved from Synapse to the target
// host's identity directories, so this router no longer imports
// matrix-admin-client / matrix-admin-creds-store at all. What it DOES import is
// the identity enumerator + the local-host discriminator, plus a one-shot SSH
// connection for the REMOTE branch.
vi.mock("../claude-session/identity-artifact-reader.js", () => ({
  isLocalHostId: vi.fn(),
  listIdentityKeysOnHost: vi.fn(),
}));

vi.mock("../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(),
}));

// Silence logger noise in test output
vi.mock("../utils/logger.js", () => ({
  sshLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { resolveHostById } from "../ssh/host-resolver.js";
import { getVettedPool } from "./pool-loader.js";
import {
  isLocalHostId,
  listIdentityKeysOnHost,
} from "../claude-session/identity-artifact-reader.js";
import { connectOneShot } from "../ssh/ssh-one-shot.js";

// ---------------------------------------------------------------------------
// HTTP request helper (mirrors roles-list-for-host.test.ts)
// ---------------------------------------------------------------------------

function httpRequest(
  server: http.Server,
  opts: {
    method: string;
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const bodyStr = opts.body === undefined ? "" : JSON.stringify(opts.body);
    const headers: Record<string, string> = {
      ...(opts.headers ?? {}),
    };
    if (bodyStr) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(bodyStr));
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
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Stub host + creds records
// ---------------------------------------------------------------------------

const stubHost = {
  id: 7,
  ip: "10.0.0.7",
  port: 22,
  username: "ubuntu",
  authType: "password" as const,
  password: "secret",
};

/** Stub SSH connection handle — only `end()` is exercised by the router. */
const stubConn = { end: vi.fn() };

// ---------------------------------------------------------------------------
// Import the router under test (module does not exist yet → RED)
// ---------------------------------------------------------------------------

import router from "./pool-routes.js";

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();
  mockUserId = "1";

  // Default: user owns host 7, unknown otherwise.
  (resolveHostById as Mock).mockImplementation((hostId: number) => {
    if (hostId === 7) return Promise.resolve(stubHost);
    return Promise.resolve(null);
  });

  (getVettedPool as Mock).mockReturnValue(["Willow", "Aster"]);
  // Default: host 7 is REMOTE, reachable, and has no identities yet.
  (isLocalHostId as Mock).mockReturnValue(false);
  (connectOneShot as Mock).mockResolvedValue(stubConn);
  (listIdentityKeysOnHost as Mock).mockResolvedValue([]);

  const app = express();
  // Mount router at /identities/pool (mirrors database.ts mount).
  app.use("/identities/pool", router);

  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /identities/pool/pick", () => {
  it("Test 1: missing JWT → 401", async () => {
    mockUserId = null;
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer", hostId: 7 },
    });
    expect(res.status).toBe(401);
    expect(listIdentityKeysOnHost).not.toHaveBeenCalled();
    expect(getVettedPool).not.toHaveBeenCalled();
  });

  it("Test 2: missing hostId → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer" },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/hostId/);
    expect(getVettedPool).not.toHaveBeenCalled();
  });

  it("Test 3: non-integer hostId → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer", hostId: "abc" },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/hostId/);
    expect(getVettedPool).not.toHaveBeenCalled();
  });

  it("Test 4: ABSENT role → 200 (role is optional as of 2026-09-14)", async () => {
    // Inverted from the original "missing role → 400". Role only ever existed
    // on this route to compose an MXID for the Synapse availability probe;
    // with availability now answered by the host's identity folders, role is
    // irrelevant here. The frontend needs a name suggestion BEFORE a role has
    // been picked, so absence must be legal rather than a 400.
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { hostId: 7 },
    });
    expect(res.status).toBe(200);
    // Pool is shuffled, so assert membership rather than a specific name.
    expect(["willow", "aster"]).toContain((res.body as { name: string }).name);
    expect(listIdentityKeysOnHost).toHaveBeenCalled();
  });

  it("Test 4b: empty-string role → 200 (treated as absent, not malformed)", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "", hostId: 7 },
    });
    expect(res.status).toBe(200);
    expect(["willow", "aster"]).toContain((res.body as { name: string }).name);
  });

  it("Test 5: role uppercase → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "Skynet-Maintainer", hostId: 7 },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/role/);
    expect(getVettedPool).not.toHaveBeenCalled();
  });

  it("Test 6: role with leading digit → 200 (canonical pattern allows it)", async () => {
    // Inverted 2026-09-14. This route used to enforce a STRICTER leading-alpha
    // rule than the rest of the system, inherited from the MXID-shape gate it
    // needed while it composed handles to probe. It no longer composes anything,
    // and the strict rule was actively harmful: role creation and the role-list
    // endpoint both use the canonical `/^[a-z0-9-]+$/`, so `2foo` is a legal role
    // that would appear in the dropdown and then 400 here — killing name
    // suggestions for a role the system itself accepted.
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "2foo", hostId: 7 },
    });
    expect(res.status).toBe(200);
    expect(["willow", "aster"]).toContain((res.body as { name: string }).name);
  });

  it("Test 6b: genuinely malformed role → 400 (uppercase / illegal chars)", async () => {
    // Validation is still real, just aligned with the canonical pattern. Role is
    // advisory on this route now, so the point of the gate is to fail loudly here
    // rather than let a malformed value travel silently.
    for (const role of ["Skynet-Maintainer", "has space", "has_underscore"]) {
      const res = await httpRequest(server, {
        method: "POST",
        path: "/identities/pool/pick",
        body: { role, hostId: 7 },
      });
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toMatch(/role/);
    }
  });

  it("Test 7: cross-user hostId → 404 (resolveHostById returns null)", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer", hostId: 99999 },
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/Host/i);
    // Pool + host enumeration MUST NOT be touched on cross-user 404
    expect(getVettedPool).not.toHaveBeenCalled();
    expect(listIdentityKeysOnHost).not.toHaveBeenCalled();
  });

  it("Test 8: empty pool → 503 'pool is empty'", async () => {
    // (Was Test 9. The old Test 8 asserted a 503 when Matrix admin creds were
    // missing; this route no longer consults Matrix at all, so that gate — and
    // the fail-early creds dependency behind it — is gone.)
    (getVettedPool as Mock).mockReturnValueOnce([]);
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer", hostId: 7 },
    });
    expect(res.status).toBe(503);
    expect((res.body as { error: string }).error).toMatch(/pool is empty/);
    // Host enumeration MUST NOT be touched on empty pool
    expect(listIdentityKeysOnHost).not.toHaveBeenCalled();
  });

  it("Test 9: HAPPY PATH — skips names already present on the host", async () => {
    // Availability authority is the target host's identity folders. `willow`
    // already has a home there, so the pick MUST fall through to `aster`
    // regardless of shuffle order.
    (getVettedPool as Mock).mockReturnValueOnce(["Willow", "Aster"]);
    (listIdentityKeysOnHost as Mock).mockResolvedValueOnce(["willow"]);

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer", hostId: 7 },
    });

    expect(res.status).toBe(200);
    // Response is the bare lowercase pool name (matches IDENTITY_KEY_RE).
    expect((res.body as { name: string }).name).toBe("aster");
  });

  it("Test 10: enumerates the host EXACTLY ONCE regardless of pool size", async () => {
    // Cost regression guard. The prior implementation issued one Synapse admin
    // call PER CANDIDATE (up to pool-length sequential round-trips). The host
    // authority answers the whole question in a single enumeration; keep it
    // that way.
    (getVettedPool as Mock).mockReturnValueOnce([
      "Willow",
      "Aster",
      "Moxie",
      "Fern",
      "Rune",
    ]);
    (listIdentityKeysOnHost as Mock).mockResolvedValueOnce([]);

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer", hostId: 7 },
    });

    expect(res.status).toBe(200);
    expect((listIdentityKeysOnHost as Mock).mock.calls.length).toBe(1);
  });

  it("Test 11: all names taken → falls back to a taken candidate (never fails)", async () => {
    // SINGLE-name pool so the assertion actually distinguishes "fell back" from
    // "found a free name". With a two-name pool, `toContain` over both names is
    // satisfied by any return value — including the happy path — so the test
    // would still pass with the fallback deleted.
    (getVettedPool as Mock).mockReturnValueOnce(["Willow"]);
    // The only pool name is occupied → no free candidate. Returning it anyway is
    // correct: never 5xx a suggestion endpoint over pool exhaustion (RESEARCH
    // §Landmine 8). Birth will reject it downstream, which is the intended
    // outcome at genuine exhaustion.
    (listIdentityKeysOnHost as Mock).mockResolvedValueOnce(["willow"]);

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer", hostId: 7 },
    });
    expect(res.status).toBe(200);
    expect((res.body as { name: string }).name).toBe("willow");
  });

  it("Test 12: unreachable host still returns a name (degradation contract)", async () => {
    // A suggestion box that stalls or 5xx-es is worse UX than an unverified
    // suggestion, and birth-time checks remain the real correctness gate. So an
    // SSH failure must be swallowed, NOT surfaced.
    (getVettedPool as Mock).mockReturnValueOnce(["Willow"]);
    (connectOneShot as Mock).mockRejectedValueOnce(
      new Error("connect ETIMEDOUT 10.0.0.7:22"),
    );

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer", hostId: 7 },
    });
    expect(res.status).toBe(200);
    expect((res.body as { name: string }).name).toBe("willow");
    // MUST NOT leak host/pool internals in the (successful) response.
    expect(JSON.stringify(res.body)).not.toContain("ETIMEDOUT");
  });

  it("Test 12b: enumeration failure mid-flight still returns a name", async () => {
    // Same contract as Test 12 but the failure lands on the enumeration rather
    // than the connection — covers the SSH-exec-timeout shape too.
    (getVettedPool as Mock).mockReturnValueOnce(["Willow"]);
    (listIdentityKeysOnHost as Mock).mockRejectedValueOnce(
      new Error("SSH exec timeout after 3000ms"),
    );

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer", hostId: 7 },
    });
    expect(res.status).toBe(200);
    expect((res.body as { name: string }).name).toBe("willow");
  });

  it("Test 12c: a hanging host does not hang the request (total budget)", async () => {
    // connectOneShot's timeout covers only the handshake, and the enumerator
    // carries its own 15s exec timer — so a box that accepts TCP but never
    // answers could stall this endpoint ~18s without an outer budget. Assert the
    // request still resolves with a name well before that.
    (getVettedPool as Mock).mockReturnValueOnce(["Willow"]);
    (listIdentityKeysOnHost as Mock).mockImplementation(
      () => new Promise(() => { /* never settles */ }),
    );

    const started = Date.now();
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer", hostId: 7 },
    });
    const elapsed = Date.now() - started;

    expect(res.status).toBe(200);
    expect((res.body as { name: string }).name).toBe("willow");
    expect(elapsed).toBeLessThan(10000);
  }, 20000);

  it("Test 13: LOCAL host skips SSH entirely", async () => {
    // When the target is the box Skynet runs on, enumeration reads the
    // identities root directly — opening an SSH connection to ourselves would
    // be wasteful and can fail on boxes with no inbound SSH (t1000 is
    // SSM-only).
    (isLocalHostId as Mock).mockReturnValue(true);
    (getVettedPool as Mock).mockReturnValueOnce(["Willow"]);
    (listIdentityKeysOnHost as Mock).mockResolvedValueOnce([]);

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer", hostId: 7 },
    });
    expect(res.status).toBe(200);
    expect((res.body as { name: string }).name).toBe("willow");
    expect(connectOneShot).not.toHaveBeenCalled();
    // conn === null signals the LOCAL branch to the enumerator.
    expect(listIdentityKeysOnHost).toHaveBeenCalledWith(null);
  });

  it("Test 13b: REMOTE host closes its SSH connection", async () => {
    // Leaked one-shot connections accumulate per name suggestion, and the modal
    // re-suggests on every host/role change.
    (getVettedPool as Mock).mockReturnValueOnce(["Willow"]);

    await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer", hostId: 7 },
    });

    expect(connectOneShot).toHaveBeenCalled();
    expect(stubConn.end).toHaveBeenCalled();
  });

  it("Test 14: pool.json casing drift — PascalCase entry compares + returns lowercase", async () => {
    // Pool entries are PascalCase by convention (Plan 80-01 seed shape) while
    // identity folders on disk are lowercase (H3 invariant). The comparison
    // must normalize, or a PascalCase pool entry would never match its own
    // lowercase folder and every taken name would read as free.
    (getVettedPool as Mock).mockReturnValueOnce(["Willow", "Aster"]);
    (listIdentityKeysOnHost as Mock).mockResolvedValueOnce(["willow"]);

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer", hostId: 7 },
    });
    expect(res.status).toBe(200);
    // "Willow" (pool) matched "willow" (disk) → skipped, despite the casing gap.
    expect((res.body as { name: string }).name).toBe("aster");
  });
});
