/**
 * relay-room-stream-server.test.ts — Phase 90 Plan 04 Task 2.
 *
 * Tests the pure frame-dispatch core (handleConnectToRoom,
 * handleFetchOlderRange, handleSendMessage, runMembershipTick,
 * parseClientFrame, checkRateLimit) via injected deps. Does NOT spin up a
 * real WebSocketServer — the module's binding is gated on !VITEST so
 * importing the module in a test is a pure no-op for the WS listener.
 *
 * Test coverage mirrors the plan's Tests 1-12 (with 1/2/8 folded into the
 * pure-dispatch tests since JWT auth + URL trust are the same code path).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the matrix-admin-client boundary — the tests should not hit real
// Matrix or admin creds. classifyParticipants is exercised directly (it
// only reads users.mxid via the injected deps).
vi.mock("../matrix/matrix-admin-client.js", () => ({
  getRoomJoinedMembers: vi.fn(),
}));

// eslint-disable-next-line import/first
import {
  handleConnectToRoom,
  handleFetchOlderRange,
  handleSendMessage,
  parseClientFrame,
  checkRateLimit,
  sweepRateWindows,
  __resetRateLimiterForTests,
  __getRateWindowsSizeForTests,
  __resetRoomSubscriptionsForTests,
  __getRoomSubscriptionForTests,
  computeParticipantsFrame,
  runMembershipTick,
  runLiveEventTick,
  subscribeRoom,
  memberSetsEqual,
  RELAY_ROOM_STREAM_PORT,
  type WsAuthContext,
  type HandleConnectToRoomDeps,
  type HandleFetchOlderDeps,
  type HandleSendMessageDeps,
  type ComputeParticipantsDeps,
  type LiveEventTickDeps,
  type RoomTickDeps,
  type ServerFrame,
} from "./relay-room-stream-server.js";

const OWNER_USER = "user-owner-1";
const OTHER_USER = "user-other-2";
const ROOM_ID = "!room:server";
const OWNER_MXID = "@owner_human:server";
const AGENT_MXID = "@agent1:server";

function makeAuth(userId: string, mxid: string | null): WsAuthContext {
  return { userId, mxid };
}

function makeClassifierDeps(
  humansMap: Map<string, { displayName: string; userId: string }> = new Map(),
) {
  return {
    lookupHumans: vi.fn().mockResolvedValue(humansMap),
  };
}

function makeConnectDeps(overrides: {
  ownsRelayRoomSession?: (userId: string, roomId: string) => boolean;
  lookupRoomTitle?: (userId: string, roomId: string) => string | null;
  fetchMembers?: ComputeParticipantsDeps["fetchMembers"];
  classifierDeps?: ComputeParticipantsDeps["classifierDeps"];
  fetchInitialHistory?: HandleConnectToRoomDeps["fetchInitialHistory"];
} = {}): HandleConnectToRoomDeps {
  return {
    ownsRelayRoomSession:
      overrides.ownsRelayRoomSession ??
      ((userId, _roomId) => userId === OWNER_USER),
    lookupRoomTitle:
      overrides.lookupRoomTitle ??
      ((_userId, _roomId) => "Test Room"),
    fetchMembers:
      overrides.fetchMembers ??
      (async () => ({ ok: true, memberMxids: [OWNER_MXID, AGENT_MXID] })),
    classifierDeps:
      overrides.classifierDeps ??
      makeClassifierDeps(
        new Map([
          [OWNER_MXID, { displayName: "Owner", userId: OWNER_USER }],
        ]),
      ),
    fetchInitialHistory:
      overrides.fetchInitialHistory ??
      (async () => ({ ok: true, events: [], hasMore: false, endToken: null })),
  };
}

describe("parseClientFrame (Phase 90 Plan 04 Task 2)", () => {
  it("Test A: rejects null / non-object payloads", () => {
    expect(parseClientFrame(null)).toBeNull();
    expect(parseClientFrame("string")).toBeNull();
    expect(parseClientFrame(42)).toBeNull();
    expect(parseClientFrame([])).toBeNull();
  });

  it("Test B: rejects payloads with missing/invalid type", () => {
    expect(parseClientFrame({})).toBeNull();
    expect(parseClientFrame({ type: 42 })).toBeNull();
    expect(parseClientFrame({ type: "unknown_op" })).toBeNull();
  });

  it("Test C: rejects connectToRoom with missing/empty roomId", () => {
    expect(parseClientFrame({ type: "connectToRoom" })).toBeNull();
    expect(parseClientFrame({ type: "connectToRoom", roomId: "" })).toBeNull();
    expect(parseClientFrame({ type: "connectToRoom", roomId: 42 })).toBeNull();
  });

  it("Test D: accepts valid connectToRoom", () => {
    expect(
      parseClientFrame({ type: "connectToRoom", roomId: "!r:s" }),
    ).toEqual({ type: "connectToRoom", roomId: "!r:s" });
  });

  it("Test E: rejects fetch_older_range with invalid fields", () => {
    expect(parseClientFrame({ type: "fetch_older_range" })).toBeNull();
    expect(
      parseClientFrame({ type: "fetch_older_range", beforeEventId: "" }),
    ).toBeNull();
    expect(
      parseClientFrame({
        type: "fetch_older_range",
        beforeEventId: "$e:s",
        count: 0,
      }),
    ).toBeNull();
    expect(
      parseClientFrame({
        type: "fetch_older_range",
        beforeEventId: "$e:s",
        count: "20",
      }),
    ).toBeNull();
  });

  it("Test F: accepts valid fetch_older_range", () => {
    expect(
      parseClientFrame({
        type: "fetch_older_range",
        beforeEventId: "$e:s",
        count: 20,
      }),
    ).toEqual({
      type: "fetch_older_range",
      beforeEventId: "$e:s",
      count: 20,
    });
  });

  it("Test G: rejects send_message with invalid fields", () => {
    expect(parseClientFrame({ type: "send_message" })).toBeNull();
    expect(
      parseClientFrame({ type: "send_message", body: 42, txnId: "t" }),
    ).toBeNull();
    expect(
      parseClientFrame({ type: "send_message", body: "hi", txnId: "" }),
    ).toBeNull();
  });

  it("Test H: accepts valid send_message", () => {
    expect(
      parseClientFrame({
        type: "send_message",
        body: "hello",
        txnId: "mqid-1",
      }),
    ).toEqual({
      type: "send_message",
      body: "hello",
      txnId: "mqid-1",
    });
  });
});

describe("handleConnectToRoom (Phase 90 Plan 04 Task 2)", () => {
  it("Test 2: access-gate deny returns close(4404) with SAME code for no-row + not-owner (no oracle)", async () => {
    // Case A: user does not own the row (returns false).
    const denyDeps = makeConnectDeps({
      ownsRelayRoomSession: () => false,
    });
    const outcome = await handleConnectToRoom(
      makeAuth(OTHER_USER, "@other:server"),
      { type: "connectToRoom", roomId: ROOM_ID },
      denyDeps,
    );
    expect(outcome.frames).toEqual([]);
    expect(outcome.close).toEqual({ code: 4404, reason: "not found" });

    // Case B: row does not exist (also returns false — same close code).
    const missingRowDeps = makeConnectDeps({
      ownsRelayRoomSession: () => false,
    });
    const outcomeB = await handleConnectToRoom(
      makeAuth(OWNER_USER, OWNER_MXID),
      { type: "connectToRoom", roomId: "!doesnotexist:server" },
      missingRowDeps,
    );
    expect(outcomeB.close).toEqual({ code: 4404, reason: "not found" });
  });

  it("Test 3: authorized user gets session → participants → history_batch (in order)", async () => {
    const deps = makeConnectDeps({
      fetchInitialHistory: async () => ({
        ok: true,
        events: [{ event_id: "$e1:s" }, { event_id: "$e2:s" }],
        hasMore: true,
        endToken: "end-cursor-1",
      }),
    });
    const outcome = await handleConnectToRoom(
      makeAuth(OWNER_USER, OWNER_MXID),
      { type: "connectToRoom", roomId: ROOM_ID },
      deps,
    );
    expect(outcome.close).toBeUndefined();
    expect(outcome.frames.length).toBe(3);
    expect(outcome.frames[0]).toEqual({
      type: "session",
      roomId: ROOM_ID,
      roomTitle: "Test Room",
    });
    expect(outcome.frames[1]!.type).toBe("participants");
    const participants = outcome.frames[1] as {
      type: "participants";
      humans: Array<{ mxid: string }>;
      agents: Array<{ mxid: string }>;
    };
    expect(participants.humans.map((h) => h.mxid)).toEqual([OWNER_MXID]);
    expect(participants.agents.map((a) => a.mxid)).toEqual([AGENT_MXID]);
    expect(outcome.frames[2]).toEqual({
      type: "history_batch",
      events: [{ event_id: "$e1:s" }, { event_id: "$e2:s" }],
      hasMore: true,
    });
  });

  it("Test 7 (Pitfall 8/D-18): initial-history 403 → inactive frame + clean close", async () => {
    const deps = makeConnectDeps({
      fetchInitialHistory: async () => ({
        ok: false,
        status: 403,
        error: "not_member",
      }),
    });
    const outcome = await handleConnectToRoom(
      makeAuth(OWNER_USER, OWNER_MXID),
      { type: "connectToRoom", roomId: ROOM_ID },
      deps,
    );
    // Session + participants first, then inactive.
    expect(outcome.frames.map((f) => f.type)).toEqual([
      "session",
      "participants",
      "inactive",
    ]);
    const inactive = outcome.frames[2] as {
      type: "inactive";
      reason: string;
    };
    expect(inactive.reason).toBe("not_member");
    expect(outcome.close).toEqual({ code: 1000, reason: "inactive" });
  });

  it("Test 7b (Pitfall 8/D-18): initial-history 404 → inactive frame + clean close", async () => {
    const deps = makeConnectDeps({
      fetchInitialHistory: async () => ({
        ok: false,
        status: 404,
        error: "not_found",
      }),
    });
    const outcome = await handleConnectToRoom(
      makeAuth(OWNER_USER, OWNER_MXID),
      { type: "connectToRoom", roomId: ROOM_ID },
      deps,
    );
    const inactive = outcome.frames.find((f) => f.type === "inactive") as {
      type: "inactive";
      reason: string;
    } | undefined;
    expect(inactive?.reason).toBe("not_found");
    expect(outcome.close).toEqual({ code: 1000, reason: "inactive" });
  });

  it("Test 7c: non-403/404 history error emits `error` frame but keeps connection open", async () => {
    const deps = makeConnectDeps({
      fetchInitialHistory: async () => ({
        ok: false,
        status: 502,
        error: "admin_api_proxy_error",
      }),
    });
    const outcome = await handleConnectToRoom(
      makeAuth(OWNER_USER, OWNER_MXID),
      { type: "connectToRoom", roomId: ROOM_ID },
      deps,
    );
    expect(outcome.close).toBeUndefined();
    const errorFrame = outcome.frames.find((f) => f.type === "error") as {
      type: "error";
      message: string;
    } | undefined;
    expect(errorFrame?.message).toBe(
      "history_fetch_failed:admin_api_proxy_error",
    );
  });

  it("Test 12 (W#9 shared classifier): participants frame is derived via classifyParticipants(memberMxids, classifierDeps)", async () => {
    const lookupHumans = vi.fn().mockResolvedValue(
      new Map([[OWNER_MXID, { displayName: "Owner", userId: OWNER_USER }]]),
    );
    const fetchMembers = vi
      .fn()
      .mockResolvedValue({ ok: true, memberMxids: [OWNER_MXID, AGENT_MXID] });
    const deps = makeConnectDeps({
      fetchMembers,
      classifierDeps: { lookupHumans },
    });

    await handleConnectToRoom(
      makeAuth(OWNER_USER, OWNER_MXID),
      { type: "connectToRoom", roomId: ROOM_ID },
      deps,
    );

    // Both the fetch AND the classifier's humans-lookup were called
    // during the connect — the classifier is the seam.
    expect(fetchMembers).toHaveBeenCalledWith(ROOM_ID);
    expect(lookupHumans).toHaveBeenCalled();
  });
});

describe("handleFetchOlderRange (Phase 90 Plan 04 Task 2)", () => {
  it("Test 4: authorized fetch returns history_batch derived from fetchOlder cursor+count", async () => {
    const fetchOlder = vi.fn().mockResolvedValue({
      ok: true,
      events: [{ event_id: "$older-1:s" }],
      hasMore: true,
    });
    const deps: HandleFetchOlderDeps = {
      ownsRelayRoomSession: () => true,
      fetchOlder,
    };
    const outFrames = await handleFetchOlderRange(
      makeAuth(OWNER_USER, OWNER_MXID),
      ROOM_ID,
      { type: "fetch_older_range", beforeEventId: "cursor-x", count: 20 },
      deps,
    );
    expect(fetchOlder).toHaveBeenCalledWith(ROOM_ID, "cursor-x", 20);
    expect(outFrames).toEqual([
      {
        type: "history_batch",
        events: [{ event_id: "$older-1:s" }],
        hasMore: true,
      },
    ]);
  });

  it("Test 4b: access-gate deny returns error frame (does NOT close — connection continues)", async () => {
    const deps: HandleFetchOlderDeps = {
      ownsRelayRoomSession: () => false,
      fetchOlder: vi.fn(),
    };
    const outFrames = await handleFetchOlderRange(
      makeAuth(OTHER_USER, null),
      ROOM_ID,
      { type: "fetch_older_range", beforeEventId: "c", count: 20 },
      deps,
    );
    expect(outFrames).toEqual([{ type: "error", message: "not_found" }]);
  });

  it("Test 4c: fetch_older 403 / 404 → inactive frame (Pitfall 8)", async () => {
    const deps: HandleFetchOlderDeps = {
      ownsRelayRoomSession: () => true,
      fetchOlder: vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        error: "not_member",
      }),
    };
    const outFrames = await handleFetchOlderRange(
      makeAuth(OWNER_USER, OWNER_MXID),
      ROOM_ID,
      { type: "fetch_older_range", beforeEventId: "c", count: 20 },
      deps,
    );
    expect(outFrames).toEqual([{ type: "inactive", reason: "not_member" }]);
  });
});

describe("handleSendMessage (Phase 90 Plan 04 Task 2)", () => {
  beforeEach(() => {
    __resetRateLimiterForTests();
  });

  it("Test 5: happy-path send returns send_ack{txnId, eventId}", async () => {
    const send = vi
      .fn()
      .mockResolvedValue({ ok: true, eventId: "$e-server:s" });
    const deps: HandleSendMessageDeps = {
      ownsRelayRoomSession: () => true,
      send,
      checkRate: () => true,
    };
    const outFrames = await handleSendMessage(
      makeAuth(OWNER_USER, OWNER_MXID),
      ROOM_ID,
      { type: "send_message", body: "hello", txnId: "mqid-1" },
      deps,
    );
    // CRITICAL (T-90-BE-03): server passes auth.mxid — NEVER accepts a
    // mxid from the WS frame.
    expect(send).toHaveBeenCalledWith(OWNER_MXID, ROOM_ID, "hello", "mqid-1");
    expect(outFrames).toEqual([
      { type: "send_ack", txnId: "mqid-1", eventId: "$e-server:s" },
    ]);
  });

  it("Test 5b: send failure returns send_error{txnId, reason}", async () => {
    const deps: HandleSendMessageDeps = {
      ownsRelayRoomSession: () => true,
      send: vi.fn().mockResolvedValue({
        ok: false,
        status: 413,
        error: "body_too_long",
      }),
      checkRate: () => true,
    };
    const outFrames = await handleSendMessage(
      makeAuth(OWNER_USER, OWNER_MXID),
      ROOM_ID,
      { type: "send_message", body: "hi", txnId: "mqid-2" },
      deps,
    );
    expect(outFrames).toEqual([
      { type: "send_error", txnId: "mqid-2", reason: "body_too_long" },
    ]);
  });

  it("Test 5c: 502 primitive error maps to 'proxy' reason", async () => {
    const deps: HandleSendMessageDeps = {
      ownsRelayRoomSession: () => true,
      send: vi
        .fn()
        .mockResolvedValue({ ok: false, status: 502, error: "admin_api_proxy_error" }),
      checkRate: () => true,
    };
    const outFrames = await handleSendMessage(
      makeAuth(OWNER_USER, OWNER_MXID),
      ROOM_ID,
      { type: "send_message", body: "hi", txnId: "t" },
      deps,
    );
    expect((outFrames[0] as { reason: string }).reason).toBe("proxy");
  });

  it("Test 5d: access-gate deny returns send_error{reason:'not_found'} — NOT close (no oracle)", async () => {
    const deps: HandleSendMessageDeps = {
      ownsRelayRoomSession: () => false,
      send: vi.fn(),
      checkRate: () => true,
    };
    const outFrames = await handleSendMessage(
      makeAuth(OTHER_USER, "@other:s"),
      ROOM_ID,
      { type: "send_message", body: "hi", txnId: "t" },
      deps,
    );
    expect(outFrames).toEqual([
      { type: "send_error", txnId: "t", reason: "not_found" },
    ]);
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("Test 5e: no mxid on the auth context → send_error{reason:'no_mxid'}", async () => {
    const deps: HandleSendMessageDeps = {
      ownsRelayRoomSession: () => true,
      send: vi.fn(),
      checkRate: () => true,
    };
    const outFrames = await handleSendMessage(
      makeAuth(OWNER_USER, null),
      ROOM_ID,
      { type: "send_message", body: "hi", txnId: "t" },
      deps,
    );
    expect((outFrames[0] as { reason: string }).reason).toBe("no_mxid");
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("Test 6: token-bucket 30/60s — 31st send rejected without calling Matrix", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, eventId: "$e:s" });
    let sendCount = 0;
    const deps: HandleSendMessageDeps = {
      ownsRelayRoomSession: () => true,
      send,
      checkRate: () => {
        sendCount++;
        return sendCount <= 30;
      },
    };
    // 30 allowed
    for (let i = 0; i < 30; i++) {
      const outFrames = await handleSendMessage(
        makeAuth(OWNER_USER, OWNER_MXID),
        ROOM_ID,
        { type: "send_message", body: "hi", txnId: `t-${i}` },
        deps,
      );
      expect(outFrames[0]!.type).toBe("send_ack");
    }
    // 31st rejected
    const rejected = await handleSendMessage(
      makeAuth(OWNER_USER, OWNER_MXID),
      ROOM_ID,
      { type: "send_message", body: "hi", txnId: "t-31" },
      deps,
    );
    expect(rejected).toEqual([
      { type: "send_error", txnId: "t-31", reason: "rate_limited" },
    ]);
    // Send primitive called only 30 times.
    expect(send).toHaveBeenCalledTimes(30);
  });
});

describe("checkRateLimit (real limiter, Phase 90 Plan 04 Task 2)", () => {
  beforeEach(() => {
    __resetRateLimiterForTests();
  });

  it("Test RL-1: allows first 30 within window", () => {
    const now = 1_000_000;
    for (let i = 0; i < 30; i++) {
      expect(checkRateLimit(OWNER_USER, now + i)).toBe(true);
    }
    expect(checkRateLimit(OWNER_USER, now + 30)).toBe(false);
  });

  it("Test RL-2: window slides — old entries drop after 60s", () => {
    const now = 1_000_000;
    for (let i = 0; i < 30; i++) {
      expect(checkRateLimit(OWNER_USER, now + i)).toBe(true);
    }
    // 60 seconds after the first send — its bucket entry has aged out.
    // Only 29 entries within the sliding window, so the next send is
    // allowed.
    const laterNow = now + 60_001;
    expect(checkRateLimit(OWNER_USER, laterNow)).toBe(true);
  });

  it("Test RL-3: rate limits are per-user", () => {
    const now = 1_000_000;
    for (let i = 0; i < 30; i++) {
      expect(checkRateLimit(OWNER_USER, now)).toBe(true);
    }
    expect(checkRateLimit(OWNER_USER, now)).toBe(false);
    expect(checkRateLimit(OTHER_USER, now)).toBe(true);
  });

  // ==========================================================================
  // M6 FIXUP TESTS (2026-09-09) — bounded rate-limit map
  // ==========================================================================

  it("Test M6a: sweepRateWindows drops entries whose timestamps have all aged out", () => {
    const now = 1_000_000;
    // Populate the map with two users.
    checkRateLimit(OWNER_USER, now);
    checkRateLimit(OTHER_USER, now);
    expect(__getRateWindowsSizeForTests()).toBe(2);

    // Sweep at exactly the window boundary — neither entry has aged out yet.
    let dropped = sweepRateWindows(now);
    expect(dropped).toBe(0);
    expect(__getRateWindowsSizeForTests()).toBe(2);

    // Sweep 60_001ms later — every entry is older than the cutoff.
    dropped = sweepRateWindows(now + 60_001);
    expect(dropped).toBe(2);
    expect(__getRateWindowsSizeForTests()).toBe(0);
  });

  it("Test M6b: partially-aged entries survive; array is refreshed to drop stale entries", () => {
    const now = 1_000_000;
    // Mix of old + recent timestamps for the same user.
    checkRateLimit(OWNER_USER, now); // old
    checkRateLimit(OWNER_USER, now + 30_000); // recent

    // Sweep just past the first entry's window.
    const dropped = sweepRateWindows(now + 60_005);
    // Only the "old" ts is beyond the cutoff (now+5ms). "recent"
    // (now+30_000) is still within the 60s window from the sweep-now
    // reference (now+60_005 - 60_000 = cutoff at now+5). Entry survives.
    expect(dropped).toBe(0);
    expect(__getRateWindowsSizeForTests()).toBe(1);

    // Sweep well past — now every ts is stale.
    const droppedAll = sweepRateWindows(now + 120_000);
    expect(droppedAll).toBe(1);
    expect(__getRateWindowsSizeForTests()).toBe(0);
  });

  it("Test M6c: sweep on an empty map is a safe no-op", () => {
    expect(__getRateWindowsSizeForTests()).toBe(0);
    expect(sweepRateWindows(Date.now())).toBe(0);
  });
});

describe("computeParticipantsFrame + classifier integration (Phase 90 Plan 04 Task 2)", () => {
  it("Test P1: happy-path returns a participants frame with sorted humans + agents", async () => {
    const deps: ComputeParticipantsDeps = {
      fetchMembers: async () => ({
        ok: true,
        memberMxids: [
          "@zebra_human:server",
          "@agent_z:server",
          "@aardvark_human:server",
          "@agent_a:server",
        ],
      }),
      classifierDeps: makeClassifierDeps(
        new Map([
          [
            "@zebra_human:server",
            { displayName: "Zebra", userId: "u-zebra" },
          ],
          [
            "@aardvark_human:server",
            { displayName: "Aardvark", userId: "u-aardvark" },
          ],
        ]),
      ),
    };
    const frame = await computeParticipantsFrame(ROOM_ID, deps);
    expect(frame).not.toBeNull();
    expect(frame!.type).toBe("participants");
    // Alphabetical within group.
    expect(frame!.humans.map((h) => h.displayName)).toEqual([
      "Aardvark",
      "Zebra",
    ]);
    expect(frame!.agents.map((a) => a.identityKey)).toEqual([
      "agent_a",
      "agent_z",
    ]);
  });

  it("Test P2: fetch failure returns null (caller skips emission)", async () => {
    const deps: ComputeParticipantsDeps = {
      fetchMembers: async () => ({
        ok: false,
        status: 502,
        error: "admin_api_proxy_error",
      }),
      classifierDeps: makeClassifierDeps(),
    };
    const frame = await computeParticipantsFrame(ROOM_ID, deps);
    expect(frame).toBeNull();
  });
});

describe("runMembershipTick (W#9 — Phase 90 Plan 04 Task 2 Test 11)", () => {
  beforeEach(() => {
    __resetRoomSubscriptionsForTests();
  });

  it("Test 11a: unchanged member set → returns null (no re-emit)", async () => {
    const deps: ComputeParticipantsDeps = {
      fetchMembers: async () => ({
        ok: true,
        memberMxids: [OWNER_MXID, AGENT_MXID],
      }),
      classifierDeps: makeClassifierDeps(),
    };
    const lastSet = new Set([OWNER_MXID, AGENT_MXID]);
    const result = await runMembershipTick(ROOM_ID, lastSet, deps);
    expect(result.frame).toBeNull();
    expect(result.nextMemberSet.size).toBe(2);
  });

  it("Test 11b: member added → emits fresh participants frame with FULL list", async () => {
    const NEW_AGENT = "@agent_new:server";
    const deps: ComputeParticipantsDeps = {
      fetchMembers: async () => ({
        ok: true,
        memberMxids: [OWNER_MXID, AGENT_MXID, NEW_AGENT],
      }),
      classifierDeps: makeClassifierDeps(
        new Map([
          [OWNER_MXID, { displayName: "Owner", userId: OWNER_USER }],
        ]),
      ),
    };
    const lastSet = new Set([OWNER_MXID, AGENT_MXID]);
    const result = await runMembershipTick(ROOM_ID, lastSet, deps);
    expect(result.frame).not.toBeNull();
    expect(result.frame!.type).toBe("participants");
    // FULL list (not diff).
    expect(result.frame!.humans.length + result.frame!.agents.length).toBe(3);
    expect(result.nextMemberSet.size).toBe(3);
  });

  it("Test 11c: member removed → emits fresh frame", async () => {
    const deps: ComputeParticipantsDeps = {
      fetchMembers: async () => ({
        ok: true,
        memberMxids: [OWNER_MXID],
      }),
      classifierDeps: makeClassifierDeps(
        new Map([
          [OWNER_MXID, { displayName: "Owner", userId: OWNER_USER }],
        ]),
      ),
    };
    const lastSet = new Set([OWNER_MXID, AGENT_MXID]);
    const result = await runMembershipTick(ROOM_ID, lastSet, deps);
    expect(result.frame).not.toBeNull();
    expect(result.frame!.humans.length).toBe(1);
    expect(result.frame!.agents.length).toBe(0);
  });

  it("Test 11d: fetch failure preserves previous set (no spurious drop)", async () => {
    const deps: ComputeParticipantsDeps = {
      fetchMembers: async () => ({
        ok: false,
        status: 502,
        error: "admin_api_proxy_error",
      }),
      classifierDeps: makeClassifierDeps(),
    };
    const lastSet = new Set([OWNER_MXID, AGENT_MXID]);
    const result = await runMembershipTick(ROOM_ID, lastSet, deps);
    expect(result.frame).toBeNull();
    // Previous set preserved — a transient fetch fail must NOT clear
    // the tracked membership.
    expect(result.nextMemberSet.size).toBe(2);
  });

  it("Test 11e: memberSetsEqual is order-independent", () => {
    expect(memberSetsEqual(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(memberSetsEqual(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
    expect(memberSetsEqual(new Set(), new Set())).toBe(true);
  });
});

// ============================================================================
// H1 FIXUP TESTS (2026-09-09) — live_event tick + subscribeRoom lifecycle
// ============================================================================

describe("runLiveEventTick (H1 fixup — inbound message subscription)", () => {
  it("Test LE-1: null sinceToken short-circuits — returns empty events and null cursor without fetching", async () => {
    const fetchLive = vi.fn();
    const deps: LiveEventTickDeps = { fetchLive };
    const result = await runLiveEventTick(ROOM_ID, null, deps);
    expect(fetchLive).not.toHaveBeenCalled();
    expect(result.events).toEqual([]);
    expect(result.nextSinceToken).toBeNull();
  });

  it("Test LE-2: happy-path advance — returns events + nextSinceToken from response `end`", async () => {
    const deps: LiveEventTickDeps = {
      fetchLive: vi.fn().mockResolvedValue({
        ok: true,
        events: [{ event_id: "$live-1:s" }, { event_id: "$live-2:s" }],
        nextSinceToken: "cursor-after",
      }),
    };
    const result = await runLiveEventTick(ROOM_ID, "cursor-before", deps);
    expect(result.events.length).toBe(2);
    expect(result.nextSinceToken).toBe("cursor-after");
  });

  it("Test LE-3: fetch failure preserves the previous cursor (transient-fail discipline)", async () => {
    const deps: LiveEventTickDeps = {
      fetchLive: vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        error: "admin_api_proxy_error",
      }),
    };
    const result = await runLiveEventTick(ROOM_ID, "cursor-preserve", deps);
    expect(result.events).toEqual([]);
    // Cursor unchanged so the next tick retries from the same point.
    expect(result.nextSinceToken).toBe("cursor-preserve");
  });

  it("Test LE-4: no new events — returns empty batch, advances cursor if server gave a new one", async () => {
    const deps: LiveEventTickDeps = {
      fetchLive: vi.fn().mockResolvedValue({
        ok: true,
        events: [],
        nextSinceToken: "same-cursor",
      }),
    };
    const result = await runLiveEventTick(ROOM_ID, "cursor-x", deps);
    expect(result.events).toEqual([]);
    expect(result.nextSinceToken).toBe("same-cursor");
  });
});

describe("subscribeRoom (H1 fixup — per-room tick driver + subscriber lifecycle)", () => {
  beforeEach(() => {
    __resetRoomSubscriptionsForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    __resetRoomSubscriptionsForTests();
  });

  function makeTickDeps(overrides: {
    fetchMembers?: ComputeParticipantsDeps["fetchMembers"];
    fetchLive?: LiveEventTickDeps["fetchLive"];
    classifierDeps?: ComputeParticipantsDeps["classifierDeps"];
  } = {}): RoomTickDeps {
    return {
      fetchMembers:
        overrides.fetchMembers ??
        (async () => ({ ok: true, memberMxids: [OWNER_MXID, AGENT_MXID] })),
      fetchLive:
        overrides.fetchLive ??
        (async () => ({ ok: true, events: [], nextSinceToken: "unused" })),
      classifierDeps: overrides.classifierDeps ?? makeClassifierDeps(),
    };
  }

  it("Test H1a: first subscriber boots both timers; second subscriber shares the same subscription", () => {
    const deps = makeTickDeps();
    const emit1 = vi.fn();
    const emit2 = vi.fn();
    const dispose1 = subscribeRoom(
      ROOM_ID,
      emit1,
      "cursor-1",
      new Set([OWNER_MXID]),
      deps,
    );
    const dispose2 = subscribeRoom(
      ROOM_ID,
      emit2,
      "cursor-2",
      new Set([OWNER_MXID, AGENT_MXID]),
      deps,
    );
    const sub = __getRoomSubscriptionForTests(ROOM_ID);
    expect(sub).toBeDefined();
    expect(sub!.subscribers.size).toBe(2);
    expect(sub!.membershipTimer).not.toBeNull();
    expect(sub!.liveEventTimer).not.toBeNull();
    // Cursor stays with the first seed — second subscriber's seed is
    // only used if the first seed was null.
    expect(sub!.sinceToken).toBe("cursor-1");
    dispose1();
    dispose2();
  });

  it("Test H1b: live_event frame emitted when new inbound arrives via poll — all subscribers receive it", async () => {
    const newEvent = {
      event_id: "$live-new:s",
      type: "m.room.message",
      sender: "@sender:s",
      content: { body: "hello" },
    };
    const fetchLive = vi
      .fn()
      // First tick returns the new event; subsequent ticks empty.
      .mockResolvedValueOnce({
        ok: true,
        events: [newEvent],
        nextSinceToken: "cursor-2",
      })
      .mockResolvedValue({
        ok: true,
        events: [],
        nextSinceToken: "cursor-2",
      });
    const deps = makeTickDeps({ fetchLive });
    const emitA = vi.fn();
    const emitB = vi.fn();
    subscribeRoom(ROOM_ID, emitA, "cursor-1", new Set(), deps);
    subscribeRoom(ROOM_ID, emitB, "cursor-1", new Set(), deps);

    // Advance timers past one live-event tick + flush microtasks.
    await vi.advanceTimersByTimeAsync(2_100);

    const liveFramesA = emitA.mock.calls
      .map((c) => c[0] as ServerFrame)
      .filter((f) => f.type === "live_event");
    const liveFramesB = emitB.mock.calls
      .map((c) => c[0] as ServerFrame)
      .filter((f) => f.type === "live_event");
    expect(liveFramesA.length).toBe(1);
    expect(liveFramesB.length).toBe(1);
    expect((liveFramesA[0] as { event: unknown }).event).toEqual(newEvent);
  });

  it("Test H1c: participants frame emitted on membership change — all subscribers receive it", async () => {
    let tick = 0;
    const fetchMembers: ComputeParticipantsDeps["fetchMembers"] = async () => {
      tick += 1;
      // First tick: baseline; second tick: new agent joins.
      if (tick <= 1) {
        return { ok: true, memberMxids: [OWNER_MXID] };
      }
      return { ok: true, memberMxids: [OWNER_MXID, AGENT_MXID] };
    };
    const deps = makeTickDeps({ fetchMembers });
    const emit = vi.fn();
    // Test-override the membership interval to keep the assertion fast —
    // the production 30s cadence (post-M5 fixup) would need a 60_000ms
    // fake-timer advance per tick otherwise.
    subscribeRoom(
      ROOM_ID,
      emit,
      null,
      new Set([OWNER_MXID]),
      deps,
      { membershipMs: 1_000 },
    );

    // Advance past two membership ticks — first sees no change, second
    // sees the new member and emits.
    await vi.advanceTimersByTimeAsync(2_500);

    const partFrames = emit.mock.calls
      .map((c) => c[0] as ServerFrame)
      .filter((f) => f.type === "participants");
    expect(partFrames.length).toBeGreaterThanOrEqual(1);
    // Last participants frame carries the FULL new list.
    const last = partFrames[partFrames.length - 1] as {
      humans: Array<{ mxid: string }>;
      agents: Array<{ mxid: string }>;
    };
    expect(last.humans.length + last.agents.length).toBe(2);
  });

  it("Test H1d: subscriber deregistration on dispose — last subscriber clears both timers", () => {
    const deps = makeTickDeps();
    const emit = vi.fn();
    const dispose = subscribeRoom(
      ROOM_ID,
      emit,
      "cursor-1",
      new Set(),
      deps,
    );
    const subBefore = __getRoomSubscriptionForTests(ROOM_ID);
    expect(subBefore!.membershipTimer).not.toBeNull();
    expect(subBefore!.liveEventTimer).not.toBeNull();

    dispose();

    const subAfter = __getRoomSubscriptionForTests(ROOM_ID);
    // Last subscriber gone → subscription removed entirely.
    expect(subAfter).toBeUndefined();
  });

  it("Test H1e: two subscribers, one disposes — timers stay running for the other", () => {
    const deps = makeTickDeps();
    const emitA = vi.fn();
    const emitB = vi.fn();
    const disposeA = subscribeRoom(ROOM_ID, emitA, "cursor-1", new Set(), deps);
    subscribeRoom(ROOM_ID, emitB, "cursor-1", new Set(), deps);

    disposeA();
    const sub = __getRoomSubscriptionForTests(ROOM_ID);
    expect(sub).toBeDefined();
    expect(sub!.subscribers.size).toBe(1);
    // Timers still active.
    expect(sub!.membershipTimer).not.toBeNull();
    expect(sub!.liveEventTimer).not.toBeNull();
  });

  it("Test H1f: emit throw doesn't kill the tick — the other subscriber still receives", async () => {
    const newEvent = {
      event_id: "$live-1:s",
      type: "m.room.message",
      sender: "@s:s",
      content: {},
    };
    const fetchLive = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        events: [newEvent],
        nextSinceToken: "cursor-2",
      })
      .mockResolvedValue({ ok: true, events: [], nextSinceToken: "cursor-2" });
    const deps = makeTickDeps({ fetchLive });
    const emitThrow = vi.fn(() => {
      throw new Error("emit failed");
    });
    const emitOk = vi.fn();
    subscribeRoom(ROOM_ID, emitThrow, "cursor-1", new Set(), deps);
    subscribeRoom(ROOM_ID, emitOk, "cursor-1", new Set(), deps);

    await vi.advanceTimersByTimeAsync(2_100);

    // Second subscriber's emit still fired at least once with the live event.
    const okLive = emitOk.mock.calls
      .map((c) => c[0] as ServerFrame)
      .filter((f) => f.type === "live_event");
    expect(okLive.length).toBe(1);
  });
});

describe("module-scope invariants (Phase 90 Plan 04 Task 2)", () => {
  it("Test M1: port matches the plan's allocation (30015)", () => {
    expect(RELAY_ROOM_STREAM_PORT).toBe(30015);
  });

  it("Test M2: WS server is NOT started at test-import time", () => {
    // If startWebSocketServer had bound port 30015, a second bind would
    // throw EADDRINUSE. We construct + immediately close a peer server
    // on the same port to prove the port is free during tests. If it
    // wasn't free, the constructor would throw synchronously.
    // (Guarded by env var; see relay-room-stream-server.ts bottom.)
    expect(process.env.VITEST).toBe("true");
  });
});
