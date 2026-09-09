/**
 * relay-room-create.test.ts — Phase 91 Plan 03 Task 1.
 *
 * Covers 15 behavior tests for POST /relay-room/create:
 *   Test 1:  unauthenticated → 401
 *   Test 2:  happy path → 201 { ok, roomId, sessionId, roomTitle }
 *   Test 3:  blank name → 400 room_name_required
 *   Test 4:  whitespace-only name → 400 room_name_required
 *   Test 5:  zero participants → 400 no_participants
 *   Test 6:  single-agent-only → 400 single_agent_disallowed
 *   Test 7:  viewer has no mxid → 400 viewer_no_mxid (T-91-BE-02)
 *   Test 8:  participant cap exceeded → 400 too_many_participants (T-91-BE-03)
 *   Test 9:  mxid grammar filter — invalid mxid dropped (T-91-BE-04 layer 1)
 *   Test 10: fleet-registry filter — non-fleet human mxid dropped (T-91-BE-04 layer 2)
 *   Test 11: createRoomAsUser failure → 502 { ok:false, error:'proxy' }
 *   Test 12: invite fan-out best-effort — failed invite does NOT block 201 response
 *   Test 13: materialize failure — route still returns 201 (observation-loop safety net)
 *   Test 14: response shape locked — only { ok, roomId, sessionId, roomTitle } (T-91-BE-05)
 *   Test 15: idempotency shape — two requests with same roomName produce different roomIds
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Auth mock — canned userId "user-1" for authed tests; flip via __authMode.
// ---------------------------------------------------------------------------

let __authMode: "pass" | "unauth" = "pass";

vi.mock("../../utils/auth-manager.js", () => {
  const AuthManager = {
    getInstance: () => ({
      createAuthMiddleware:
        () =>
        (
          req: express.Request,
          res: express.Response,
          next: express.NextFunction,
        ) => {
          if (__authMode === "unauth") {
            res.status(401).json({ ok: false, error: "unauthenticated" });
            return;
          }
          (req as express.Request & { userId: string }).userId = "user-1";
          next();
        },
    }),
  };
  return { AuthManager };
});

// ---------------------------------------------------------------------------
// DB mock — controls users.mxid lookup (viewerMxid) and the session SELECT.
// ---------------------------------------------------------------------------

let __viewerMxid: string | null = "@viewer_human:server";
// Controls db.$client.prepare().get() for two queries:
//   1. loadFleetMxidRegistry: SELECT mxid FROM users WHERE mxid IS NOT NULL
//   2. sessionRow: SELECT id FROM relay_room_sessions WHERE user_id = ? AND room_id = ?
let __fleetHumanMxids: string[] = ["@bob:s", "@viewer_human:server"];
let __sessionId: string | null = "session-abc";
// M5 test control: when true, the sessionRow prepare().get() throws synchronously.
let __sessionRowThrows: boolean = false;

vi.mock("../db/index.js", () => {
  // Track call order for prepare().get() to serve different results per call.
  let _prepareCallCount = 0;
  const dbClient = {
    prepare: (sql: string) => ({
      get: (..._args: unknown[]) => {
        // First prepare+get is for fleet registry (in loadFleetMxidRegistry we use .all())
        // But we need .all() for that. Let's check the sql string.
        if (sql.includes("relay_room_sessions")) {
          if (__sessionRowThrows) throw new Error("DB connection lost");
          // sessionRow lookup
          return __sessionId !== null ? { id: __sessionId } : undefined;
        }
        return undefined;
      },
      all: () => {
        // Fleet registry: returns users with mxids
        if (_prepareCallCount === 0) {
          _prepareCallCount++;
          return __fleetHumanMxids.map((m) => ({ mxid: m }));
        }
        return __fleetHumanMxids.map((m) => ({ mxid: m }));
      },
      run: () => ({}),
    }),
  };
  const dbSelect = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              __viewerMxid !== null
                ? [{ mxid: __viewerMxid }]
                : [{ mxid: null }],
            ),
        }),
      }),
    }),
  };
  return {
    db: { $client: dbClient, ...dbSelect },
  };
});

vi.mock("drizzle-orm", async () => {
  const actual =
    (await vi.importActual("drizzle-orm")) as Record<string, unknown>;
  return {
    ...actual,
    eq: () => ({}),
  };
});

vi.mock("../db/schema.js", () => ({
  users: { id: "users.id", mxid: "users.mxid" },
}));

// ---------------------------------------------------------------------------
// Mock matrix-admin-client — createRoomAsUser + inviteToRoom.
// ---------------------------------------------------------------------------

let __createRoomAsUserResult: { ok: boolean; roomId?: string; status?: number; error?: string } = {
  ok: true,
  roomId: "!room:server",
};
let __inviteToRoomResult: { ok: boolean; status?: number; error?: string } = { ok: true };

vi.mock("../../matrix/matrix-admin-client.js", () => ({
  createRoomAsUser: vi.fn(),
  inviteToRoom: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock relay-room-sessions-store — materializeRelayRoomSession.
// ---------------------------------------------------------------------------

let __materializeThrows: boolean = false;

vi.mock("../../relay-sessions/relay-room-sessions-store.js", () => ({
  materializeRelayRoomSession: vi.fn(),
}));

// Mock loggers.
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import modules after mocks are registered (Vitest hoisting).
// ---------------------------------------------------------------------------

// eslint-disable-next-line import/first
import { createRoomAsUser, inviteToRoom } from "../../matrix/matrix-admin-client.js";
// eslint-disable-next-line import/first
import { materializeRelayRoomSession } from "../../relay-sessions/relay-room-sessions-store.js";
// eslint-disable-next-line import/first
import { databaseLogger } from "../../utils/logger.js";
// eslint-disable-next-line import/first
import relayRoomCreateRoutes from "./relay-room-create.js";

const mockCreateRoomAsUser = createRoomAsUser as unknown as ReturnType<typeof vi.fn>;
const mockInviteToRoom = inviteToRoom as unknown as ReturnType<typeof vi.fn>;
const mockMaterialize = materializeRelayRoomSession as unknown as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Server lifecycle.
// ---------------------------------------------------------------------------

let app: express.Express;
let server: http.Server;
let baseUrl: string;

async function startServer(): Promise<void> {
  app = express();
  app.use(express.json());
  app.use("/relay-room", relayRoomCreateRoutes);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

const VIEWER_MXID = "@viewer_human:server";
const BOB_MXID = "@bob:s";
const AGENT_MXID = "@nelly:s";

function makeBody(overrides: Partial<{
  roomName: unknown;
  humanMxids: unknown;
  agentMxids: unknown;
}> = {}) {
  return {
    roomName: "Chat",
    humanMxids: [BOB_MXID],
    agentMxids: [AGENT_MXID],
    ...overrides,
  };
}

describe("POST /relay-room/create (Phase 91 Plan 03)", () => {
  beforeEach(async () => {
    __authMode = "pass";
    __viewerMxid = VIEWER_MXID;
    __fleetHumanMxids = [BOB_MXID, VIEWER_MXID];
    __sessionId = "session-abc";
    __sessionRowThrows = false;
    __createRoomAsUserResult = { ok: true, roomId: "!room:server" };
    __inviteToRoomResult = { ok: true };
    __materializeThrows = false;

    mockCreateRoomAsUser.mockReset();
    mockCreateRoomAsUser.mockImplementation(async () => __createRoomAsUserResult);

    mockInviteToRoom.mockReset();
    mockInviteToRoom.mockImplementation(async () => __inviteToRoomResult);

    mockMaterialize.mockReset();
    mockMaterialize.mockImplementation(async () => {
      if (__materializeThrows) throw new Error("materialize failed");
    });

    (databaseLogger.info as ReturnType<typeof vi.fn>).mockClear();
    (databaseLogger.warn as ReturnType<typeof vi.fn>).mockClear();

    await startServer();
  });

  afterEach(async () => {
    await stopServer();
  });

  // ─── Test 1: Authentication gate ─────────────────────────────────────────

  it("Test 1: unauthenticated request returns 401", async () => {
    __authMode = "unauth";
    const res = await fetch(`${baseUrl}/relay-room/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeBody()),
    });
    expect(res.status).toBe(401);
  });

  // ─── Test 2: Happy path ───────────────────────────────────────────────────

  it("Test 2: happy path → 201 { ok:true, roomId, sessionId, roomTitle }", async () => {
    const res = await fetch(`${baseUrl}/relay-room/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeBody({ roomName: "Chat", humanMxids: [BOB_MXID], agentMxids: [AGENT_MXID] })),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.roomId).toBe("!room:server");
    expect(body.sessionId).toBe("session-abc");
    expect(body.roomTitle).toBe("Chat");
    expect(mockCreateRoomAsUser).toHaveBeenCalledTimes(1);
    expect(mockInviteToRoom).toHaveBeenCalledWith("!room:server", BOB_MXID, VIEWER_MXID);
    expect(mockInviteToRoom).toHaveBeenCalledWith("!room:server", AGENT_MXID, VIEWER_MXID);
    expect(mockMaterialize).toHaveBeenCalledWith("user-1", "!room:server", "Chat");
  });

  // ─── Test 3: Blank name ───────────────────────────────────────────────────

  it("Test 3: blank roomName → 400 room_name_required", async () => {
    const res = await fetch(`${baseUrl}/relay-room/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeBody({ roomName: "" })),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.error).toBe("room_name_required");
    expect(mockCreateRoomAsUser).not.toHaveBeenCalled();
  });

  // ─── Test 4: Whitespace-only name ─────────────────────────────────────────

  it("Test 4: whitespace-only roomName → 400 room_name_required (trim check)", async () => {
    const res = await fetch(`${baseUrl}/relay-room/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeBody({ roomName: "   " })),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.error).toBe("room_name_required");
  });

  // ─── Test 5: Zero participants ────────────────────────────────────────────

  it("Test 5: zero participants → 400 no_participants", async () => {
    const res = await fetch(`${baseUrl}/relay-room/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeBody({ humanMxids: [], agentMxids: [] })),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.error).toBe("no_participants");
    expect(mockCreateRoomAsUser).not.toHaveBeenCalled();
  });

  // ─── Test 6: Single-agent-only ────────────────────────────────────────────

  it("Test 6: single-agent-only → 400 single_agent_disallowed", async () => {
    const res = await fetch(`${baseUrl}/relay-room/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeBody({ humanMxids: [], agentMxids: [AGENT_MXID] })),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.error).toBe("single_agent_disallowed");
    expect(mockCreateRoomAsUser).not.toHaveBeenCalled();
  });

  // ─── Test 7: Viewer has no mxid (T-91-BE-02) ─────────────────────────────

  it("Test 7: viewer has no mxid → 400 viewer_no_mxid (T-91-BE-02)", async () => {
    __viewerMxid = null;
    const res = await fetch(`${baseUrl}/relay-room/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeBody()),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.error).toBe("viewer_no_mxid");
    expect(mockCreateRoomAsUser).not.toHaveBeenCalled();
  });

  // ─── Test 8: Participant cap (T-91-BE-03) ────────────────────────────────

  it("Test 8: participant count > 32 → 400 too_many_participants (T-91-BE-03)", async () => {
    // Build 33 syntactically valid mxids
    const tooManyHumans = Array.from({ length: 33 }, (_, i) => `@user${i}:s`);
    // All must be in fleet registry to pass that filter
    __fleetHumanMxids = [...tooManyHumans, VIEWER_MXID];
    const res = await fetch(`${baseUrl}/relay-room/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeBody({ humanMxids: tooManyHumans, agentMxids: [] })),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.error).toBe("too_many_participants");
    expect(mockCreateRoomAsUser).not.toHaveBeenCalled();
  });

  // ─── Test 9: MXID grammar filter (T-91-BE-04 layer 1) ───────────────────

  it("Test 9: invalid mxid in humanMxids filtered before inviteToRoom; Layer-1 drop logged (H2 — T-91-BE-04 grammar)", async () => {
    // 'not-an-mxid' fails MXID_RE; only BOB_MXID passes.
    // BOB_MXID is in the fleet registry, so it survives both layers.
    // Result: 1 human + 1 agent → valid room
    const res = await fetch(`${baseUrl}/relay-room/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeBody({ humanMxids: ["not-an-mxid", BOB_MXID], agentMxids: [AGENT_MXID] })),
    });
    expect(res.status).toBe(201);
    // 'not-an-mxid' must NOT have reached inviteToRoom
    const inviteCalls = mockInviteToRoom.mock.calls.map((c) => c[1]);
    expect(inviteCalls).not.toContain("not-an-mxid");
    expect(inviteCalls).toContain(BOB_MXID);
    // H2: Layer-1 grammar drop must be logged with distinct op code
    expect(databaseLogger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        operation: "relay_room_create_dropped_invalid_grammar_human_mxid",
        droppedMxid: "not-an-mxid",
      }),
    );
  });

  // ─── Test 10: Fleet-registry filter (T-91-BE-04 layer 2) ────────────────

  it("Test 10: non-fleet humanMxid filtered before inviteToRoom; relay_room_create_dropped_non_fleet_mxid logged (T-91-BE-04 registry)", async () => {
    // '@stranger:external.server' is syntactically valid but NOT in users.mxid
    const strangerMxid = "@stranger:external.server";
    // Fleet only contains BOB_MXID and VIEWER_MXID
    __fleetHumanMxids = [BOB_MXID, VIEWER_MXID];

    const res = await fetch(`${baseUrl}/relay-room/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeBody({ humanMxids: [strangerMxid, BOB_MXID], agentMxids: [AGENT_MXID] })),
    });
    expect(res.status).toBe(201);

    // Stranger must NOT have reached inviteToRoom
    const inviteCalls = mockInviteToRoom.mock.calls.map((c) => c[1]);
    expect(inviteCalls).not.toContain(strangerMxid);

    // Drop was logged
    expect(databaseLogger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        operation: "relay_room_create_dropped_non_fleet_mxid",
        droppedMxid: strangerMxid,
      }),
    );
  });

  // ─── Test 11: createRoomAsUser failure → 502 ─────────────────────────────

  it("Test 11: createRoomAsUser failure → 502 { ok:false, error:'proxy' }; materialize NOT called", async () => {
    __createRoomAsUserResult = { ok: false, status: 502, error: "ERR_PROXY" };
    const res = await fetch(`${baseUrl}/relay-room/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeBody()),
    });
    expect(res.status).toBe(502);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.error).toBe("proxy");
    // materialize must NOT have been called
    expect(mockMaterialize).not.toHaveBeenCalled();
  });

  // ─── Test 12: Invite fan-out best-effort ─────────────────────────────────

  it("Test 12: one inviteToRoom fails → route logs relay_room_create_invite_failed + returns 201; materialize IS called", async () => {
    // First invite (BOB) fails; second (AGENT) succeeds.
    mockInviteToRoom
      .mockResolvedValueOnce({ ok: false, status: 403, error: "ERR_NON_2XX" })
      .mockResolvedValueOnce({ ok: true });

    const res = await fetch(`${baseUrl}/relay-room/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeBody({ humanMxids: [BOB_MXID], agentMxids: [AGENT_MXID] })),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);

    // materialize was still called
    expect(mockMaterialize).toHaveBeenCalledTimes(1);

    // Failed invite was logged
    expect(databaseLogger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        operation: "relay_room_create_invite_failed",
      }),
    );
  });

  // ─── Test 13: Materialize failure → still 201 ────────────────────────────

  it("Test 13: materialize throws → route logs relay_room_create_materialize_failed; still returns 201", async () => {
    __materializeThrows = true;
    __sessionId = null; // session row absent since materialize failed

    const res = await fetch(`${baseUrl}/relay-room/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeBody()),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.sessionId).toBe(""); // empty when row absent

    expect(databaseLogger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        operation: "relay_room_create_materialize_failed",
      }),
    );
  });

  // ─── Test 14: Response shape locked (T-91-BE-05) ────────────────────────

  it("Test 14: success response has ONLY { ok, roomId, sessionId, roomTitle } — no tokens/creds (T-91-BE-05)", async () => {
    const res = await fetch(`${baseUrl}/relay-room/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeBody()),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;

    // Exactly these four fields on success
    expect(Object.keys(body).sort()).toEqual(["ok", "roomId", "roomTitle", "sessionId"]);

    const rawText = JSON.stringify(body);
    // No token or credential leakage
    expect(rawText).not.toMatch(/access_token|accessToken|admin_token/i);
    expect(rawText).not.toMatch(/homeserverBase|password/i);
  });

  // ─── Test 15: Idempotency shape — two requests produce distinct roomIds ──

  it("Test 15: two requests with same roomName produce different roomIds (idempotency is per-roomId via ON CONFLICT)", async () => {
    // First call returns !room1, second returns !room2
    mockCreateRoomAsUser
      .mockResolvedValueOnce({ ok: true, roomId: "!room1:server" })
      .mockResolvedValueOnce({ ok: true, roomId: "!room2:server" });

    const body1 = makeBody({ roomName: "Same Name" });
    const body2 = makeBody({ roomName: "Same Name" });

    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/relay-room/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body1),
      }),
      fetch(`${baseUrl}/relay-room/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body2),
      }),
    ]);

    const b1 = await res1.json() as Record<string, unknown>;
    const b2 = await res2.json() as Record<string, unknown>;

    // Both succeeded
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    // Different roomIds (Matrix creates separate rooms even for same name)
    expect(b1.roomId).not.toBe(b2.roomId);
  });

  // ─── Test 16: Server-side viewer self-exclusion from humanMxids (M4) ─────

  it("Test 16: viewerMxid in humanMxids filtered before inviteToRoom; no self-invite (M4)", async () => {
    // Client submits VIEWER_MXID in humanMxids — server must silently drop it
    // rather than sending a self-invite that Matrix would reject.
    const res = await fetch(`${baseUrl}/relay-room/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeBody({
        humanMxids: [VIEWER_MXID, BOB_MXID],
        agentMxids: [AGENT_MXID],
      })),
    });
    expect(res.status).toBe(201);

    // VIEWER_MXID must NOT appear in any inviteToRoom call
    const inviteCalls = mockInviteToRoom.mock.calls.map((c) => c[1]);
    expect(inviteCalls).not.toContain(VIEWER_MXID);
    // BOB_MXID and AGENT_MXID should still be invited
    expect(inviteCalls).toContain(BOB_MXID);
    expect(inviteCalls).toContain(AGENT_MXID);
  });

  // ─── Test 17: Top-level try/catch catches synchronous DB throw → 500 (M5) ─

  it("Test 17: synchronous DB throw in sessionRow lookup → 500 internal_error; no error string leaked (M5)", async () => {
    // db.$client.prepare(...).get() for relay_room_sessions throws synchronously.
    // The top-level try/catch must intercept and return 500.
    __sessionRowThrows = true;

    const res = await fetch(`${baseUrl}/relay-room/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeBody()),
    });
    expect(res.status).toBe(500);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.error).toBe("internal_error");
    // Ensure DB error string is not leaked to client (T-91-BE-05)
    expect(JSON.stringify(body)).not.toContain("DB connection lost");
    // Handler logged the error
    expect(databaseLogger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ operation: "relay_room_create_unhandled_error" }),
    );
  });
});
