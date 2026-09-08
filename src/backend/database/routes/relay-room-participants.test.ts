/**
 * relay-room-participants.test.ts — Phase 90 Plan 04 Task 3.
 *
 * Covers the 8 behavior tests specified in 90-04-PLAN.md § Task 3:
 *   Test 1: unauthenticated → 401
 *   Test 2: user does not own row → 404 (same status as not-a-member, no oracle)
 *   Test 3: authorized → 200 {humans, agents} shape
 *   Test 4: shared classifier import (T-90-04-C1 — W#9 consistency)
 *   Test 5: viewing user self-exclusion (D-07)
 *   Test 6: getRoomJoinedMembers 403/404 → 404 (canonicalized, no oracle)
 *   Test 7: getRoomJoinedMembers other failure → 502 {error:'proxy'}
 *   Test 8: response body scrub — no tokens, no admin creds, no raw Matrix body
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
// Auth mock — canned userId "1" for authed tests; flip to 401 via __authMode.
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
// Mock the DB layer at the module boundary — the endpoint uses db.$client
// prepared statements for the access-control gate + a Drizzle read for the
// viewing user's mxid.
// ---------------------------------------------------------------------------

interface OwnershipRow {
  id?: string;
}
let __ownershipRow: OwnershipRow | undefined = { id: "session-1" };
let __viewingUserMxid: string | null = "@viewer_human:server";

vi.mock("../db/index.js", () => {
  const dbClient = {
    prepare: () => ({
      get: () => __ownershipRow,
    }),
  };
  const dbSelect = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(
            __viewingUserMxid !== null
              ? [{ mxid: __viewingUserMxid }]
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
// Mock getRoomJoinedMembers at matrix-admin-client — the members source.
// ---------------------------------------------------------------------------

vi.mock("../../matrix/matrix-admin-client.js", () => ({
  getRoomJoinedMembers: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock the SHARED classifier — Test 4 asserts this is called (proving the
// endpoint uses the same seam Task 2's WS server uses).
// ---------------------------------------------------------------------------

vi.mock("../../relay-room-stream/participants-classifier.js", () => ({
  classifyParticipants: vi.fn(),
  lookupHumansFromUsersTable: vi.fn().mockResolvedValue(new Map()),
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
  sshLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  },
}));

// eslint-disable-next-line import/first
import { getRoomJoinedMembers } from "../../matrix/matrix-admin-client.js";
// eslint-disable-next-line import/first
import { classifyParticipants } from "../../relay-room-stream/participants-classifier.js";
// eslint-disable-next-line import/first
import relayRoomParticipantsRoutes from "./relay-room-participants.js";
// eslint-disable-next-line import/first
import { databaseLogger } from "../../utils/logger.js";

const mockGetRoomJoinedMembers = getRoomJoinedMembers as unknown as ReturnType<
  typeof vi.fn
>;
const mockClassify = classifyParticipants as unknown as ReturnType<typeof vi.fn>;

let app: express.Express;
let server: http.Server;
let baseUrl: string;

async function startServer(): Promise<void> {
  app = express();
  app.use(express.json());
  app.use("/relay-room", relayRoomParticipantsRoutes);
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

const ROOM_ID = "!room:server";
const VIEWER_MXID = "@viewer_human:server";
const OTHER_HUMAN_MXID = "@other_human:server";
const AGENT_MXID = "@agent_a:server";

describe("GET /relay-room/:roomId/participants (Phase 90 Plan 04 Task 3)", () => {
  beforeEach(async () => {
    __authMode = "pass";
    __ownershipRow = { id: "session-1" };
    __viewingUserMxid = VIEWER_MXID;
    mockGetRoomJoinedMembers.mockReset();
    mockClassify.mockReset();
    (databaseLogger.info as ReturnType<typeof vi.fn>).mockClear();
    (databaseLogger.warn as ReturnType<typeof vi.fn>).mockClear();
    await startServer();
  });

  afterEach(async () => {
    await stopServer();
  });

  it("Test 1: unauthenticated → 401", async () => {
    __authMode = "unauth";
    const url = `${baseUrl}/relay-room/${encodeURIComponent(ROOM_ID)}/participants`;
    const res = await fetch(url);
    expect(res.status).toBe(401);
  });

  it("Test 2: authorized user does NOT own the row → 404 (same status as not-member, no oracle)", async () => {
    __ownershipRow = undefined; // ownership gate returns undefined = no row
    const url = `${baseUrl}/relay-room/${encodeURIComponent(ROOM_ID)}/participants`;
    const res = await fetch(url);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    // Same error string for both "no row" and "not member" — no oracle.
    expect(body.error).toBe("not_found");
    // Getting members should NOT have been attempted (gate rejected first).
    expect(mockGetRoomJoinedMembers).not.toHaveBeenCalled();
  });

  it("Test 3: authorized user gets 200 {humans, agents} shape", async () => {
    mockGetRoomJoinedMembers.mockResolvedValueOnce({
      ok: true,
      memberMxids: [VIEWER_MXID, OTHER_HUMAN_MXID, AGENT_MXID],
      total: 3,
    });
    mockClassify.mockResolvedValueOnce({
      humans: [
        { mxid: VIEWER_MXID, displayName: "Viewer", userId: "user-1" },
        { mxid: OTHER_HUMAN_MXID, displayName: "Other", userId: "user-2" },
      ],
      agents: [{ mxid: AGENT_MXID, identityKey: "agent_a" }],
    });
    const url = `${baseUrl}/relay-room/${encodeURIComponent(ROOM_ID)}/participants`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      humans: Array<{ mxid: string; displayName: string; userId: string }>;
      agents: Array<{ mxid: string; identityKey: string }>;
    };
    // Viewer excluded from humans (D-07 self-exclusion).
    expect(body.humans.map((h) => h.mxid)).toEqual([OTHER_HUMAN_MXID]);
    expect(body.agents.map((a) => a.mxid)).toEqual([AGENT_MXID]);
  });

  it("Test 4: uses the SHARED classifyParticipants seam (W#9 consistency invariant)", async () => {
    mockGetRoomJoinedMembers.mockResolvedValueOnce({
      ok: true,
      memberMxids: [VIEWER_MXID, AGENT_MXID],
      total: 2,
    });
    mockClassify.mockResolvedValueOnce({
      humans: [
        { mxid: VIEWER_MXID, displayName: "Viewer", userId: "user-1" },
      ],
      agents: [{ mxid: AGENT_MXID, identityKey: "agent_a" }],
    });
    const url = `${baseUrl}/relay-room/${encodeURIComponent(ROOM_ID)}/participants`;
    await fetch(url);
    // The endpoint MUST call the classifier — same seam Task 2's WS server
    // uses. If the endpoint re-implemented classification, this test fails.
    expect(mockClassify).toHaveBeenCalledTimes(1);
    // First arg is the mxid list from getRoomJoinedMembers.
    expect(mockClassify.mock.calls[0]![0]).toEqual([VIEWER_MXID, AGENT_MXID]);
  });

  it("Test 5: viewing user IS excluded from humans list even when classifier includes them (D-07)", async () => {
    mockGetRoomJoinedMembers.mockResolvedValueOnce({
      ok: true,
      memberMxids: [VIEWER_MXID, OTHER_HUMAN_MXID],
      total: 2,
    });
    mockClassify.mockResolvedValueOnce({
      humans: [
        { mxid: VIEWER_MXID, displayName: "Viewer", userId: "user-1" },
        { mxid: OTHER_HUMAN_MXID, displayName: "Other", userId: "user-2" },
      ],
      agents: [],
    });
    const url = `${baseUrl}/relay-room/${encodeURIComponent(ROOM_ID)}/participants`;
    const res = await fetch(url);
    const body = (await res.json()) as {
      humans: Array<{ mxid: string }>;
    };
    expect(body.humans.map((h) => h.mxid)).not.toContain(VIEWER_MXID);
    expect(body.humans.map((h) => h.mxid)).toContain(OTHER_HUMAN_MXID);
  });

  it("Test 6: getRoomJoinedMembers 403 → 404 to browser (canonicalized, no oracle)", async () => {
    mockGetRoomJoinedMembers.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: "admin_api_non_2xx",
    });
    const url = `${baseUrl}/relay-room/${encodeURIComponent(ROOM_ID)}/participants`;
    const res = await fetch(url);
    expect(res.status).toBe(404);
  });

  it("Test 6b: getRoomJoinedMembers 404 → 404 to browser", async () => {
    mockGetRoomJoinedMembers.mockResolvedValueOnce({
      ok: false,
      status: 404,
      error: "admin_api_non_2xx",
    });
    const url = `${baseUrl}/relay-room/${encodeURIComponent(ROOM_ID)}/participants`;
    const res = await fetch(url);
    expect(res.status).toBe(404);
  });

  it("Test 7: getRoomJoinedMembers other failure → 502 {error:'proxy'} (no Matrix body leak)", async () => {
    mockGetRoomJoinedMembers.mockResolvedValueOnce({
      ok: false,
      status: 502,
      error: "admin_api_proxy_error",
    });
    const url = `${baseUrl}/relay-room/${encodeURIComponent(ROOM_ID)}/participants`;
    const res = await fetch(url);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("proxy");
  });

  it("Test 8: response body has NO tokens, admin creds, or raw Matrix response bodies (T-90-BE-01)", async () => {
    mockGetRoomJoinedMembers.mockResolvedValueOnce({
      ok: true,
      memberMxids: [VIEWER_MXID, AGENT_MXID],
      total: 2,
    });
    mockClassify.mockResolvedValueOnce({
      humans: [
        { mxid: VIEWER_MXID, displayName: "Viewer", userId: "user-1" },
      ],
      agents: [{ mxid: AGENT_MXID, identityKey: "agent_a" }],
    });
    const url = `${baseUrl}/relay-room/${encodeURIComponent(ROOM_ID)}/participants`;
    const res = await fetch(url);
    const rawText = await res.text();
    // Scrub check — no tokens, no admin creds, no HTTP proxy body fields.
    expect(rawText).not.toMatch(/access_token|accessToken|admin_token/i);
    expect(rawText).not.toMatch(/matrix_admin_creds/i);
    expect(rawText).not.toMatch(/homeserverBase|password/i);
  });

  it("Test 9: invalid roomId (fails Matrix grammar) → 400", async () => {
    const url = `${baseUrl}/relay-room/${encodeURIComponent("not-a-room")}/participants`;
    const res = await fetch(url);
    expect(res.status).toBe(400);
    // Ownership gate should NOT have run.
    expect(mockGetRoomJoinedMembers).not.toHaveBeenCalled();
  });

  it("Test 10: viewing user with no mxid still gets 200 (D-07 filter runs on empty)", async () => {
    __viewingUserMxid = null;
    mockGetRoomJoinedMembers.mockResolvedValueOnce({
      ok: true,
      memberMxids: [OTHER_HUMAN_MXID, AGENT_MXID],
      total: 2,
    });
    mockClassify.mockResolvedValueOnce({
      humans: [
        { mxid: OTHER_HUMAN_MXID, displayName: "Other", userId: "user-2" },
      ],
      agents: [{ mxid: AGENT_MXID, identityKey: "agent_a" }],
    });
    const url = `${baseUrl}/relay-room/${encodeURIComponent(ROOM_ID)}/participants`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      humans: Array<{ mxid: string }>;
    };
    // Nothing to filter — all listed humans returned.
    expect(body.humans.map((h) => h.mxid)).toEqual([OTHER_HUMAN_MXID]);
  });

  it("Test 11: structured log emitted on success with operational fields (no bodies)", async () => {
    mockGetRoomJoinedMembers.mockResolvedValueOnce({
      ok: true,
      memberMxids: [VIEWER_MXID, AGENT_MXID],
      total: 2,
    });
    mockClassify.mockResolvedValueOnce({
      humans: [
        { mxid: VIEWER_MXID, displayName: "Viewer", userId: "user-1" },
      ],
      agents: [{ mxid: AGENT_MXID, identityKey: "agent_a" }],
    });
    const url = `${baseUrl}/relay-room/${encodeURIComponent(ROOM_ID)}/participants`;
    await fetch(url);
    expect(databaseLogger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        operation: "relay_room_participants_ok",
      }),
    );
  });
});
