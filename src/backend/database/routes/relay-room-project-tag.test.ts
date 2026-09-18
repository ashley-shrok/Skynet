/**
 * Phase 117 Plan 117-05 Task 2: Tests for the relay-room-project-tag route.
 *
 * Tests exercise POST /relay-rooms/:roomId/project — the D-05a
 * read-modify-write on the Matrix room's m.tag account_data for
 * relay-room-associated conversations.
 *
 * Test coverage (10 tests per plan behavior block):
 *   1: Happy assign — body { userMxid, project: "alpha" }; setRoomProjectTag
 *      called with ("@ash:...", "!room:host", "alpha"); publishProjectListChanged
 *      called once.
 *   2: Happy clear — body { userMxid, project: null }; setRoomProjectTag
 *      called with third arg = null.
 *   3: Missing userMxid → 400.
 *   4: userMxid mismatch (defense-in-depth) — auth surface's users.mxid
 *      resolves to @bob:host but body userMxid = @carol:host → 403.
 *   5: Bad roomId path segment (fails /^!.+:.+$/) → 400.
 *   6: Bad slug value (uppercase) → 400.
 *   7: setRoomProjectTag returns AdminErr → 502 (or forwards status).
 *   8: setRoomProjectTag throws → 500 generic (no leak).
 *   9: Unauth → 401.
 *   10: userMxid absent on user row (Phase 88 legacy) → 403 (defense holds).
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
// Auth manager mock
// ---------------------------------------------------------------------------

let mockUserId: string | null = "1";

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

// Mute logger during tests.
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock matrix-room-tag-client + identity-artifact-reader (PROJECT_SLUG_RE)
// ---------------------------------------------------------------------------

vi.mock("../../matrix/matrix-room-tag-client.js", () => ({
  setRoomProjectTag: vi.fn(),
}));

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  PROJECT_SLUG_RE: /^[a-z0-9-]{1,64}$/,
}));

// subscription-registry singleton accessor.
const mockPublishProjectListChanged = vi.fn();
vi.mock("../../fleet-status/subscription-registry.js", () => ({
  getSubscriptionRegistry: () => ({
    publishProjectListChanged: mockPublishProjectListChanged,
  }),
}));

// ---------------------------------------------------------------------------
// Mock the drizzle `db` layer used to look up users.mxid from userId.
// ---------------------------------------------------------------------------
//
// The route resolves the authenticated user's mxid via
// `db.select({ mxid: users.mxid }).from(users).where(eq(users.id, userId))`
// — the same shape relay-room-participants.ts uses (lookupViewingUserMxid).
//
// We mock `db` with a chain that returns a preset row keyed to the
// current mockUserId. Tests override `mockUserMxidByUserId` per case.

const mockUserMxidByUserId = new Map<string, string | null>();

vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            const mxid = mockUserMxidByUserId.get(mockUserId ?? "") ?? null;
            return Promise.resolve([{ mxid }]);
          },
        }),
      }),
    }),
  },
}));

// Mock the `users` symbol + `eq` — the route only imports them as types
// and identifiers passed into the mocked db chain (which ignores them).
vi.mock("../db/schema.js", () => ({
  users: { id: "id", mxid: "mxid" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
}));

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { setRoomProjectTag } from "../../matrix/matrix-room-tag-client.js";

// ---------------------------------------------------------------------------
// HTTP request helper
// ---------------------------------------------------------------------------

function httpRequest(
  server: http.Server,
  opts: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const bodyStr =
      opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

    const headers: Record<string, string> = {
      ...(opts.headers ?? {}),
    };
    if (bodyStr !== undefined) {
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
    if (bodyStr !== undefined) {
      req.write(bodyStr);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Import the router under test AFTER all vi.mock() calls
// ---------------------------------------------------------------------------

import router from "./relay-room-project-tag.js";

let server: http.Server;

const CALLER_MXID = "@ash:t1000.taild9b663.ts.net";
const ROOM_ID = "!abcdef:t1000.taild9b663.ts.net";

beforeEach(() => {
  vi.clearAllMocks();
  mockUserMxidByUserId.clear();
  // Default: user "1" has mxid = CALLER_MXID.
  mockUserMxidByUserId.set("1", CALLER_MXID);

  // Default: setRoomProjectTag succeeds.
  (setRoomProjectTag as Mock).mockResolvedValue({ ok: true });

  // Rebuild app per test.
  const app = express();
  app.use(express.json());
  app.use("/relay-rooms", router);

  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  mockUserId = "1";
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// ===========================================================================
// Tests
// ===========================================================================

describe("POST /relay-rooms/:roomId/project", () => {
  // -------------------------------------------------------------------------
  // Test 1: happy assign
  // -------------------------------------------------------------------------

  // Phase 117 H2 fix (2026-09-18): pre-fix, this route published an empty
  // [] to registry.publishProjectListChanged after a successful write,
  // which blew away the projects cache on the frontend. After the fix,
  // the route does NOT publish anything on the projects-list channel; the
  // per-room membership change is out of scope for the projects axis.
  // The assertion below asserts publishProjectListChanged is NOT called.
  it("Test 1 (H2 fix): happy assign → 200; setRoomProjectTag(mxid, roomId, slug); publishProjectListChanged NOT called", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: `/relay-rooms/${encodeURIComponent(ROOM_ID)}/project`,
      body: { userMxid: CALLER_MXID, project: "alpha" },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(setRoomProjectTag).toHaveBeenCalledTimes(1);
    expect(setRoomProjectTag).toHaveBeenCalledWith(
      CALLER_MXID,
      ROOM_ID,
      "alpha",
    );
    // H2 regression: publishProjectListChanged must NOT be called on
    // a room-tag write — publishing [] blows away the projects cache.
    expect(mockPublishProjectListChanged).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 2: happy clear
  // -------------------------------------------------------------------------

  it("Test 2 (H2 fix): happy clear (project: null) → 200; third arg null; publishProjectListChanged NOT called", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: `/relay-rooms/${encodeURIComponent(ROOM_ID)}/project`,
      body: { userMxid: CALLER_MXID, project: null },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(setRoomProjectTag).toHaveBeenCalledWith(CALLER_MXID, ROOM_ID, null);
    // H2 regression: even on clear, we do NOT publish anything.
    expect(mockPublishProjectListChanged).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 3: missing userMxid → 400
  // -------------------------------------------------------------------------

  it("Test 3: missing userMxid → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: `/relay-rooms/${encodeURIComponent(ROOM_ID)}/project`,
      body: { project: "alpha" },
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/userMxid/i);
    expect(setRoomProjectTag).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 4: userMxid mismatch → 403 (defense-in-depth)
  // -------------------------------------------------------------------------

  it("Test 4: userMxid mismatch → 403; setRoomProjectTag NOT called", async () => {
    // Auth surface says user 1's mxid is @ash:host, but body sends @carol:host.
    const res = await httpRequest(server, {
      method: "POST",
      path: `/relay-rooms/${encodeURIComponent(ROOM_ID)}/project`,
      body: {
        userMxid: "@carol:t1000.taild9b663.ts.net",
        project: "alpha",
      },
    });

    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toMatch(
      /userMxid does not match/i,
    );
    expect(setRoomProjectTag).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 5: bad roomId path segment → 400
  // -------------------------------------------------------------------------

  it("Test 5: bad roomId (no `!` / no `:`) → 400", async () => {
    // roomIds must match /^!.+:.+$/ per Matrix spec.
    const res = await httpRequest(server, {
      method: "POST",
      path: `/relay-rooms/${encodeURIComponent("bogus")}/project`,
      body: { userMxid: CALLER_MXID, project: "alpha" },
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/room/i);
    expect(setRoomProjectTag).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 6: bad slug value → 400 (PROJECT_SLUG_RE gate)
  // -------------------------------------------------------------------------

  it("Test 6: bad slug value (uppercase 'Alpha') → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: `/relay-rooms/${encodeURIComponent(ROOM_ID)}/project`,
      body: { userMxid: CALLER_MXID, project: "Alpha" },
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/slug|project/i);
    expect(setRoomProjectTag).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 7: setRoomProjectTag returns AdminErr → 502
  // -------------------------------------------------------------------------

  it("Test 7: setRoomProjectTag returns AdminErr → 502 with error code", async () => {
    (setRoomProjectTag as Mock).mockResolvedValue({
      ok: false,
      status: 500,
      error: "matrix_room_tag_non_2xx",
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: `/relay-rooms/${encodeURIComponent(ROOM_ID)}/project`,
      body: { userMxid: CALLER_MXID, project: "alpha" },
    });

    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toMatch(/matrix write failed/i);
    expect((res.body as { code?: string }).code).toBe("matrix_room_tag_non_2xx");
    // Publish only on success — this is a failure path.
    expect(mockPublishProjectListChanged).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 8: setRoomProjectTag throws → 500 generic (no leak)
  // -------------------------------------------------------------------------

  it("Test 8: setRoomProjectTag throws → 500 generic (no leak)", async () => {
    (setRoomProjectTag as Mock).mockRejectedValue(
      new Error("invalid project slug: <sensitive-leak>"),
    );

    const res = await httpRequest(server, {
      method: "POST",
      path: `/relay-rooms/${encodeURIComponent(ROOM_ID)}/project`,
      body: { userMxid: CALLER_MXID, project: "alpha" },
    });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "failed to set room project tag" });
    expect(JSON.stringify(res.body)).not.toContain("sensitive-leak");
    expect(mockPublishProjectListChanged).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 9: unauth → 401
  // -------------------------------------------------------------------------

  it("Test 9: unauth (no JWT) → 401; no downstream calls", async () => {
    mockUserId = null;

    const res = await httpRequest(server, {
      method: "POST",
      path: `/relay-rooms/${encodeURIComponent(ROOM_ID)}/project`,
      body: { userMxid: CALLER_MXID, project: "alpha" },
    });

    expect(res.status).toBe(401);
    expect(setRoomProjectTag).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 10: users.mxid absent (pre-Phase-88 legacy) → 403
  // -------------------------------------------------------------------------

  it("Test 10: authenticated user has no mxid on record → 403 (defense holds)", async () => {
    mockUserMxidByUserId.set("1", null);

    const res = await httpRequest(server, {
      method: "POST",
      path: `/relay-rooms/${encodeURIComponent(ROOM_ID)}/project`,
      body: { userMxid: CALLER_MXID, project: "alpha" },
    });

    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toMatch(
      /userMxid does not match/i,
    );
    expect(setRoomProjectTag).not.toHaveBeenCalled();
  });
});
