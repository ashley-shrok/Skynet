/**
 * Phase 128 Plan 06 Task 2 — push-trigger-starter unit tests.
 *
 * Boot-time bootstrap tests mirroring observation-loop-starter.test.ts.
 * Covers the behavior cases from 128-06-PLAN.md § Task 2 (updated in
 * Phase 144 Plan 04 to remove the VAPID gate test — ntfy has no VAPID):
 *   1. Zero users with mxid → {ok:false, reason:"no_users"}, loop NOT started.
 *   2. Happy path (users present) → {ok:true, users:N}, loop.start called.
 *   3. Exception in DB query → {ok:false, reason:"exception"}, warn logged,
 *      no rethrow.
 *
 * Mocking discipline:
 *   - vi.mock the db + push-trigger-loop + ntfy-sender + logger.
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
  fetchRoomHistoryMock,
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
  const fetchRoomHistoryMock = vi.fn(async () => ({ ok: true, events: [] }));
  const warnSpy = vi.fn();
  const infoSpy = vi.fn();
  return {
    prepareMock,
    allMock,
    createPushTriggerLoopMock,
    loopStartMock,
    loopStopMock,
    fetchRoomHistoryMock,
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
  fetchRoomHistory: fetchRoomHistoryMock,
}));

vi.mock("./ntfy-sender.js", () => ({
  sendPushToUser: vi.fn(async () => {}),
}));

vi.mock("./preview-text.js", () => ({
  derivePreviewText: vi.fn(() => "body"),
}));

vi.mock("./resolve-agent-display-name.js", () => ({
  resolveAgentDisplayName: vi.fn(async () => "Agent"),
}));

vi.mock("./resolve-remote-agent-host-id.js", () => ({
  resolveRemoteAgentHostId: vi.fn(async () => null),
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
  fetchRoomHistoryMock.mockReset();
  fetchRoomHistoryMock.mockImplementation(async () => ({
    ok: true,
    events: [],
  }));
  warnSpy.mockClear();
  infoSpy.mockClear();
  // Reset the default all() to a two-user happy set — individual tests
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

  it("Test 2: happy path — users present → {ok:true, users:N}, loop.start called with users", async () => {
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

  it("Test 3: exception in DB query → {ok:false, reason:'exception'}, warn logged, no rethrow", async () => {
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
    // Fix pass M-1: cold-start anchor dep — MUST be wired.
    expect(depsArg).toHaveProperty("fetchInitialCursor");
    expect(depsArg).toHaveProperty("getUserJoinedRooms");
    expect(depsArg).toHaveProperty("getRoomJoinedMembers");
    expect(depsArg).toHaveProperty("classifyRoom");
    expect(depsArg).toHaveProperty("listAdminRooms");
    expect(depsArg).toHaveProperty("getAgentsRegistryRoomId");
    expect(depsArg).toHaveProperty("getRegistryMembers");
    // Fix pass M-7: `resolveUserId` dep deleted — was declared but never
    // called by runPushTriggerTick. Explicitly assert the shape stays gone
    // so a future maintainer doesn't quietly re-add it.
    expect(depsArg).not.toHaveProperty("resolveUserId");
    expect(depsArg).toHaveProperty("sendPushToUser");
    expect(depsArg).toHaveProperty("derivePreviewText");
    expect(depsArg).toHaveProperty("resolveAgentDisplayName");
    expect(depsArg).toHaveProperty("now");
    // `now` should be a function returning a number roughly Date.now.
    const t = depsArg.now();
    expect(typeof t).toBe("number");
    expect(t).toBeGreaterThan(1_000_000_000_000);
  });

  it("M-8 fix: fetchInitialCursor calls fetchRoomHistory(dir:'b', count) and returns response.start (NOT response.end) as sinceToken", async () => {
    // Load-bearing regression test for the deploy-notification-replay
    // bug (M-8 fix). Matrix's `/messages` response tokens are
    // direction-dependent:
    //   - dir=b `start`: position of the head event in the chunk (newest
    //     boundary of the returned batch — the correct forward-anchor).
    //   - dir=b `end`:   position PAST the returned chunk in the backward
    //     direction (older than the head — the "continue paginating
    //     backward" token). Seeding the forward cursor with `end` caused
    //     the next tick's dir=f fetch to include the head event again and
    //     dispatch it as a fresh push on every server restart.
    //
    // This test locks in the correct wire-level behavior — the closure
    // MUST hand back `start`, not `end`, so a future refactor can't
    // silently swap them back.
    fetchRoomHistoryMock.mockImplementation(async () => ({
      ok: true,
      events: [],
      // Distinct sentinel values so the assertion is unambiguous.
      start: "TOKEN_START_HEAD",
      end: "TOKEN_END_OLDER",
    }));

    await startPushTriggerLoopOnBoot();

    const depsArg = createPushTriggerLoopMock.mock.calls[0][0];
    const initialResult = await depsArg.fetchInitialCursor("!room:t1000", 20);

    // The wire call — dir=b, count passed through.
    expect(fetchRoomHistoryMock).toHaveBeenCalledWith("!room:t1000", {
      dir: "b",
      count: 20,
    });
    // The cursor stored MUST be `start`, not `end`.
    expect(initialResult).toEqual({
      ok: true,
      sinceToken: "TOKEN_START_HEAD",
      events: [],
    });
    // Belt-and-suspenders: MUST NOT be the `end` value.
    expect(initialResult).not.toEqual({
      ok: true,
      sinceToken: "TOKEN_END_OLDER",
    });
  });

  it("fetchInitialCursor returns sinceToken:null when Matrix omits `start` (empty room)", async () => {
    // Empty-room case: Matrix omits `start` (and typically `end` too) on
    // a backward-fetch that finds nothing. Closure must fall back to null
    // so the loop parks the sentinel "" cursor instead of storing
    // undefined.
    fetchRoomHistoryMock.mockImplementation(async () => ({
      ok: true,
      events: [],
      // No start/end fields — mimics empty-room response.
    }));

    await startPushTriggerLoopOnBoot();

    const depsArg = createPushTriggerLoopMock.mock.calls[0][0];
    const initialResult = await depsArg.fetchInitialCursor("!empty:t1000", 20);

    expect(initialResult).toEqual({ ok: true, sinceToken: null, events: [] });
  });
});
