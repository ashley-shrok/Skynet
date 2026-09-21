/**
 * Phase 128 Plan 06 Task 2 — push-trigger-starter unit tests.
 *
 * Boot-time bootstrap tests mirroring observation-loop-starter.test.ts.
 * Covers the four behavior cases from 128-06-PLAN.md § Task 2:
 *   1. Zero users with mxid → {ok:false, reason:"no_users"}, loop NOT started.
 *   2. VAPID missing (getVapidDetails throws) → {ok:false, reason:"vapid_missing"},
 *      warn logged, loop NOT started.
 *   3. Happy path (users present + VAPID present) → {ok:true, users:N},
 *      loop.start called with users.
 *   4. Exception in DB query → {ok:false, reason:"exception"}, warn logged,
 *      no rethrow.
 *
 * Mocking discipline mirrors push-sender.test.ts:
 *   - vi.mock the db + push-trigger-loop + vapid-config + logger.
 *   - Spy on createPushTriggerLoop to intercept the .start call.
 *   - Use vi.hoisted for the mock instances so mocks can share references
 *     with per-test assertions.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — hoisted before starter import.
// ---------------------------------------------------------------------------

const {
  prepareMock,
  allMock,
  createPushTriggerLoopMock,
  loopStartMock,
  loopStopMock,
  getVapidDetailsMock,
  warnSpy,
  infoSpy,
} = vi.hoisted(() => {
  const allMock = vi.fn();
  const prepareMock = vi.fn(() => ({ all: allMock }));
  const loopStartMock = vi.fn();
  const loopStopMock = vi.fn();
  const createPushTriggerLoopMock = vi.fn(() => ({
    start: loopStartMock,
    stop: loopStopMock,
    __getPerUserStateForTests: () => new Map(),
  }));
  const getVapidDetailsMock = vi.fn(() => ({
    subject: "mailto:test@example.com",
    publicKey: "test-public-key",
    privateKey: "test-private-key",
  }));
  const warnSpy = vi.fn();
  const infoSpy = vi.fn();
  return {
    prepareMock,
    allMock,
    createPushTriggerLoopMock,
    loopStartMock,
    loopStopMock,
    getVapidDetailsMock,
    warnSpy,
    infoSpy,
  };
});

vi.mock("../database/db/index.js", () => ({
  db: {
    $client: {
      prepare: prepareMock,
    },
  },
}));

vi.mock("./push-trigger-loop.js", () => ({
  createPushTriggerLoop: createPushTriggerLoopMock,
  PUSH_TRIGGER_POLL_INTERVAL_MS: 2_000,
  PUSH_TRIGGER_INITIAL_JITTER_MS: 500,
  PUSH_TRIGGER_BACKOFF_LADDER_MS: [2_000, 8_000, 15_000, 30_000, 60_000],
  PUSH_TRIGGER_BATCH_SIZE: 20,
}));

vi.mock("./vapid-config.js", () => ({
  getVapidDetails: getVapidDetailsMock,
  assertVapidConfigAtBoot: vi.fn(),
}));

// Real-ish stubs for the wiring deps; starter only touches the shape.
vi.mock("../relay-sessions/observation-loop-classifier.js", () => ({
  classifyRoom: vi.fn(),
}));

vi.mock("../relay-sessions/admin-rooms-ignore-list.js", () => ({
  listAdminRooms: vi.fn(async () => []),
}));

vi.mock("../relay-sessions/registry-rooms.js", () => ({
  getAgentsRegistryRoomId: vi.fn(async () => null),
}));

vi.mock("../matrix/matrix-admin-client.js", () => ({
  getUserJoinedRooms: vi.fn(async () => ({ ok: true, roomIds: [] })),
  getRoomJoinedMembers: vi.fn(async () => ({
    ok: true,
    memberMxids: [],
    total: 0,
  })),
}));

vi.mock("../relay-room-stream/matrix-message-fetch.js", () => ({
  fetchRoomHistory: vi.fn(async () => ({ ok: true, events: [] })),
}));

vi.mock("./push-sender.js", () => ({
  sendPushToUser: vi.fn(async () => {}),
}));

vi.mock("./preview-text.js", () => ({
  derivePreviewText: vi.fn(() => "body"),
}));

vi.mock("./resolve-agent-display-name.js", () => ({
  resolveAgentDisplayName: vi.fn(async () => "Agent"),
}));

vi.mock("../utils/logger.js", () => ({
  databaseLogger: {
    warn: warnSpy,
    info: infoSpy,
    debug: vi.fn(),
    error: vi.fn(),
  },
  systemLogger: {
    warn: warnSpy,
    info: infoSpy,
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports AFTER mocks.
// ---------------------------------------------------------------------------

import { startPushTriggerLoopOnBoot } from "./push-trigger-starter.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  prepareMock.mockClear();
  allMock.mockClear();
  createPushTriggerLoopMock.mockClear();
  loopStartMock.mockClear();
  loopStopMock.mockClear();
  getVapidDetailsMock.mockReset();
  getVapidDetailsMock.mockImplementation(() => ({
    subject: "mailto:test@example.com",
    publicKey: "test-public-key",
    privateKey: "test-private-key",
  }));
  warnSpy.mockClear();
  infoSpy.mockClear();
  // Reset the default all() to a single-user happy set — individual tests
  // override.
  allMock.mockReturnValue([
    { userId: "u1", userMxid: "@ashley:server" },
    { userId: "u2", userMxid: "@bob:server" },
  ]);
});

// ---------------------------------------------------------------------------
// Behavior tests
// ---------------------------------------------------------------------------

describe("startPushTriggerLoopOnBoot", () => {
  it("Test 1: zero users → returns {ok:false, reason:'no_users'}, loop NOT started", async () => {
    allMock.mockReturnValue([]);

    const result = await startPushTriggerLoopOnBoot();

    expect(result).toEqual({ ok: false, reason: "no_users" });
    expect(createPushTriggerLoopMock).not.toHaveBeenCalled();
    expect(loopStartMock).not.toHaveBeenCalled();
  });

  it("Test 2: VAPID missing (getVapidDetails throws) → {ok:false, reason:'vapid_missing'}, warn logged, loop NOT started", async () => {
    getVapidDetailsMock.mockImplementation(() => {
      throw new Error("VAPID_PUBLIC_KEY env var is missing or empty");
    });

    const result = await startPushTriggerLoopOnBoot();

    expect(result).toEqual({ ok: false, reason: "vapid_missing" });
    expect(createPushTriggerLoopMock).not.toHaveBeenCalled();
    expect(loopStartMock).not.toHaveBeenCalled();
    // Warn was emitted so ops sees the degradation.
    expect(warnSpy).toHaveBeenCalled();
    const warnCallArgs = warnSpy.mock.calls[0];
    expect(warnCallArgs[0]).toMatch(/vapid|push-trigger/i);
  });

  it("Test 3: happy path — users present + VAPID present → {ok:true, users:N}, loop.start called with users", async () => {
    const result = await startPushTriggerLoopOnBoot();

    expect(result).toEqual({ ok: true, users: 2 });
    expect(createPushTriggerLoopMock).toHaveBeenCalledTimes(1);
    expect(loopStartMock).toHaveBeenCalledTimes(1);
    // The users passed to loop.start match the DB query result.
    const startArgs = loopStartMock.mock.calls[0][0];
    expect(startArgs).toEqual([
      { userId: "u1", userMxid: "@ashley:server" },
      { userId: "u2", userMxid: "@bob:server" },
    ]);
  });

  it("Test 4: exception in DB query → {ok:false, reason:'exception'}, warn logged, no rethrow", async () => {
    allMock.mockImplementation(() => {
      throw new Error("db unavailable");
    });

    // MUST NOT throw — best-effort discipline per PATTERNS.md § S3.
    const result = await startPushTriggerLoopOnBoot();

    expect(result).toEqual({ ok: false, reason: "exception" });
    expect(loopStartMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("Wiring: createPushTriggerLoop receives a fully-wired PushTriggerLoopDeps", async () => {
    await startPushTriggerLoopOnBoot();

    expect(createPushTriggerLoopMock).toHaveBeenCalledTimes(1);
    const depsArg = createPushTriggerLoopMock.mock.calls[0][0];
    // Every dep the loop expects MUST be present.
    expect(depsArg).toHaveProperty("fetchLive");
    expect(depsArg).toHaveProperty("getUserJoinedRooms");
    expect(depsArg).toHaveProperty("getRoomJoinedMembers");
    expect(depsArg).toHaveProperty("classifyRoom");
    expect(depsArg).toHaveProperty("listAdminRooms");
    expect(depsArg).toHaveProperty("getAgentsRegistryRoomId");
    expect(depsArg).toHaveProperty("getRegistryMembers");
    expect(depsArg).toHaveProperty("resolveUserId");
    expect(depsArg).toHaveProperty("sendPushToUser");
    expect(depsArg).toHaveProperty("derivePreviewText");
    expect(depsArg).toHaveProperty("resolveAgentDisplayName");
    expect(depsArg).toHaveProperty("now");
    // `now` should be a function returning a number roughly Date.now.
    const t = depsArg.now();
    expect(typeof t).toBe("number");
    expect(t).toBeGreaterThan(1_000_000_000_000);
  });
});
