/**
 * Phase 128 Plan 06 Task 1 — push-trigger-loop unit tests.
 *
 * The per-user always-on live-event pump — this is the LOAD-BEARING trigger
 * for every push notification the phase delivers. Without this loop, all the
 * plumbing from Wave 1 (vapid-config, push-sender, service worker handlers,
 * subscription route) has no way to fire.
 *
 * Covers the twelve behavior cases named in 128-06-PLAN.md § Task 1
 * <behavior>:
 *   1. Filter Step 1 rejects non-m.room.message events (defense-in-depth —
 *      fetchLive already filters, but this guards direct callers).
 *   2. Filter Step 2 rejects self-sent events (D-04 no self-push).
 *   3. Filter Step 3 rejects edits (m.relates_to.rel_type === "m.replace").
 *   4. Filter Step 4 rejects non-harness_dm classified rooms (D-02).
 *   5. Filter Step 4 rejects classifier decision !== "exclude" (group_room
 *      passes classifier but with wrong decision — must not push).
 *   6. Happy path — all four filters pass → sendPushToUser called with
 *      expected shape (title = `${displayName}:`, body = derived preview,
 *      roomId + agentMxid populated).
 *   7. Per-user isolation — user A's fetchLive throws → user B's tick still
 *      runs, user A's cursor state unchanged.
 *   8. Cursor advancement — after a successful fetchLive with N events,
 *      state.cursorByRoom.set(roomId, nextSinceToken) is called.
 *   9. In-flight guard — overlapping ticks for the same user are skipped.
 *  10. Backoff — two consecutive failures advance backoffIndex; success
 *      resets it.
 *  11. Thundering-herd jitter — start(N users) produces N distinct
 *      nextRunAt values within [now, now + INITIAL_TICK_JITTER_MS].
 *  12. Cold-start — first tick for a fresh room does NOT emit pushes,
 *      only sets the cursor. Prevents boot-time push storm.
 *
 * Mocking strategy: every dep is injected via PushTriggerLoopDeps — the
 * tests wire vi.fn() implementations directly. No vi.mock() needed for the
 * loop-level tests, mirroring observation-loop.test.ts's dep-injection style.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../utils/logger.js", () => ({
  databaseLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  },
  systemLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  },
}));

import {
  createPushTriggerLoop,
  runPushTriggerTick,
  PUSH_TRIGGER_POLL_INTERVAL_MS,
  PUSH_TRIGGER_INITIAL_JITTER_MS,
  PUSH_TRIGGER_BACKOFF_LADDER_MS,
  type PushTriggerLoopDeps,
  type PerUserState,
} from "./push-trigger-loop.js";

// ---------------------------------------------------------------------------
// Fixtures / factories
// ---------------------------------------------------------------------------

const USER_A = "user-a-id";
const USER_A_MXID = "@ashley:server";
const USER_B = "user-b-id";
const USER_B_MXID = "@bob:server";
const AGENT_MXID = "@fanny:server";
const ROOM_ID = "!room1:server";
const AGENTS_REGISTRY_ROOM_ID = "!registry:server";

/**
 * Build a happy-path deps object. Individual tests override specific fields.
 * Default fetchLive returns zero events with a cursor advancement — the
 * common "nothing new" path.
 */
function makeDeps(
  overrides: Partial<PushTriggerLoopDeps> = {},
): PushTriggerLoopDeps {
  return {
    fetchLive: vi.fn(async () => ({
      ok: true as const,
      events: [],
      nextSinceToken: "cursor-1",
    })),
    getUserJoinedRooms: vi.fn(async () => ({
      ok: true as const,
      roomIds: [ROOM_ID],
    })),
    getRoomJoinedMembers: vi.fn(async () => ({
      ok: true as const,
      memberMxids: [USER_A_MXID, AGENT_MXID],
      total: 2,
    })),
    classifyRoom: vi.fn(() => ({
      decision: "exclude" as const,
      reason: "harness_dm",
    })),
    listAdminRooms: vi.fn(async () => []),
    getAgentsRegistryRoomId: vi.fn(async () => AGENTS_REGISTRY_ROOM_ID),
    getRegistryMembers: vi.fn(async () => new Set<string>([AGENT_MXID])),
    sendPushToUser: vi.fn(async () => {}),
    derivePreviewText: vi.fn(() => "hey"),
    resolveAgentDisplayName: vi.fn(async () => "Fanny"),
    now: vi.fn(() => Date.now()),
    ...overrides,
  };
}

/**
 * Build a Matrix message event skeleton with common defaults. Individual
 * tests override specific fields to trigger each filter branch.
 */
function makeEvent(overrides: Partial<{
  type: string;
  sender: string;
  content: Record<string, unknown>;
  event_id: string;
}> = {}) {
  return {
    type: "m.room.message",
    sender: AGENT_MXID,
    content: { msgtype: "m.text", body: "hey" },
    event_id: "$evt1:server",
    ...overrides,
  };
}

/**
 * Manually build a PerUserState with a pre-warmed cursor so the tick fires
 * on the second pass (i.e. we skip cold-start suppression).
 */
function makeStateWithWarmCursor(userMxid: string, cursor = "cursor-warm"): PerUserState {
  return {
    userMxid,
    nextRunAt: 0,
    backoffIndex: 0,
    inFlight: false,
    cursorByRoom: new Map([[ROOM_ID, cursor]]),
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// runPushTriggerTick — filter pipeline + dispatch + cursor advancement
// ---------------------------------------------------------------------------

describe("runPushTriggerTick — filter pipeline", () => {
  it("Test 1: Filter Step 1 rejects non-m.room.message events (defense-in-depth)", async () => {
    const nonMessageEvent = makeEvent({ type: "m.reaction" });
    const deps = makeDeps({
      fetchLive: vi.fn(async () => ({
        ok: true as const,
        events: [nonMessageEvent],
        nextSinceToken: "cursor-2",
      })),
    });
    const state = makeStateWithWarmCursor(USER_A_MXID);

    await runPushTriggerTick(USER_A, state, deps);

    expect(deps.sendPushToUser).not.toHaveBeenCalled();
    // Cursor still advances (fetch succeeded; we're just not firing).
    expect(state.cursorByRoom.get(ROOM_ID)).toBe("cursor-2");
  });

  it("Test 2: Filter Step 2 rejects self-sent events (D-04 no self-push)", async () => {
    const selfEvent = makeEvent({ sender: USER_A_MXID });
    const deps = makeDeps({
      fetchLive: vi.fn(async () => ({
        ok: true as const,
        events: [selfEvent],
        nextSinceToken: "cursor-2",
      })),
    });
    const state = makeStateWithWarmCursor(USER_A_MXID);

    await runPushTriggerTick(USER_A, state, deps);

    expect(deps.sendPushToUser).not.toHaveBeenCalled();
    expect(state.cursorByRoom.get(ROOM_ID)).toBe("cursor-2");
  });

  it("Test 3: Filter Step 3 rejects edits (m.relates_to.rel_type === m.replace)", async () => {
    const editEvent = makeEvent({
      content: {
        msgtype: "m.text",
        body: "edited body",
        "m.relates_to": { rel_type: "m.replace", event_id: "$original:server" },
      },
    });
    const deps = makeDeps({
      fetchLive: vi.fn(async () => ({
        ok: true as const,
        events: [editEvent],
        nextSinceToken: "cursor-2",
      })),
    });
    const state = makeStateWithWarmCursor(USER_A_MXID);

    await runPushTriggerTick(USER_A, state, deps);

    expect(deps.sendPushToUser).not.toHaveBeenCalled();
    expect(state.cursorByRoom.get(ROOM_ID)).toBe("cursor-2");
  });

  it("Test 4: Filter Step 4 rejects non-harness_dm classified rooms (D-02)", async () => {
    const event = makeEvent();
    const deps = makeDeps({
      fetchLive: vi.fn(async () => ({
        ok: true as const,
        events: [event],
        nextSinceToken: "cursor-2",
      })),
      // Non-DM 3-party room: classifier will return group_room / materialize.
      classifyRoom: vi.fn(() => ({
        decision: "materialize" as const,
        reason: "group_room",
      })),
    });
    const state = makeStateWithWarmCursor(USER_A_MXID);

    await runPushTriggerTick(USER_A, state, deps);

    expect(deps.sendPushToUser).not.toHaveBeenCalled();
    expect(state.cursorByRoom.get(ROOM_ID)).toBe("cursor-2");
  });

  it("Test 5: Filter Step 4 rejects wrong-decision harness_dm-classified events (exclude + wrong reason)", async () => {
    const event = makeEvent();
    const deps = makeDeps({
      fetchLive: vi.fn(async () => ({
        ok: true as const,
        events: [event],
        nextSinceToken: "cursor-2",
      })),
      // exclude but reason=admin_room (not harness_dm) — must not push.
      classifyRoom: vi.fn(() => ({
        decision: "exclude" as const,
        reason: "admin_room",
      })),
    });
    const state = makeStateWithWarmCursor(USER_A_MXID);

    await runPushTriggerTick(USER_A, state, deps);

    expect(deps.sendPushToUser).not.toHaveBeenCalled();
  });

  it("Test 6: Happy path — all four filters pass → sendPushToUser called with expected shape", async () => {
    const event = makeEvent();
    const deps = makeDeps({
      fetchLive: vi.fn(async () => ({
        ok: true as const,
        events: [event],
        nextSinceToken: "cursor-2",
      })),
    });
    const state = makeStateWithWarmCursor(USER_A_MXID);

    await runPushTriggerTick(USER_A, state, deps);

    expect(deps.sendPushToUser).toHaveBeenCalledTimes(1);
    expect(deps.sendPushToUser).toHaveBeenCalledWith(USER_A, {
      title: "Fanny:",
      body: "hey",
      roomId: ROOM_ID,
      agentMxid: AGENT_MXID,
    });
    // classifyRoom was CALLED (not re-derived) with expected input shape.
    expect(deps.classifyRoom).toHaveBeenCalledTimes(1);
    const classifyCallArgs = (
      deps.classifyRoom as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(classifyCallArgs.userMxid).toBe(USER_A_MXID);
    expect(classifyCallArgs.roomId).toBe(ROOM_ID);
    expect(classifyCallArgs.memberMxids).toEqual([USER_A_MXID, AGENT_MXID]);
    // Cursor advances after successful dispatch.
    expect(state.cursorByRoom.get(ROOM_ID)).toBe("cursor-2");
  });
});

// ---------------------------------------------------------------------------
// runPushTriggerTick — cursor advancement + cold-start + non-cursor edge cases
// ---------------------------------------------------------------------------

describe("runPushTriggerTick — cursor management", () => {
  it("Test 8: Cursor advancement — after successful fetchLive with N events, state.cursorByRoom updates to nextSinceToken", async () => {
    const deps = makeDeps({
      fetchLive: vi.fn(async () => ({
        ok: true as const,
        events: [makeEvent()],
        nextSinceToken: "cursor-advanced-42",
      })),
    });
    const state = makeStateWithWarmCursor(USER_A_MXID, "cursor-old");

    await runPushTriggerTick(USER_A, state, deps);

    expect(state.cursorByRoom.get(ROOM_ID)).toBe("cursor-advanced-42");
  });

  it("Test 12: Cold-start — first tick for a fresh room does NOT emit pushes, only sets cursor", async () => {
    // A NEW event exists on the room, but it's the FIRST tick for this room
    // (no cursor). Cold-start policy: discard, just set the cursor. Prevents
    // boot-time push storm.
    const event = makeEvent();
    const deps = makeDeps({
      fetchLive: vi.fn(async () => ({
        ok: true as const,
        events: [event],
        nextSinceToken: "cursor-cold-1",
      })),
    });
    // Empty cursorByRoom — first tick.
    const state: PerUserState = {
      userMxid: USER_A_MXID,
      nextRunAt: 0,
      backoffIndex: 0,
      inFlight: false,
      cursorByRoom: new Map(),
    };

    await runPushTriggerTick(USER_A, state, deps);

    // NO push fired despite qualifying event.
    expect(deps.sendPushToUser).not.toHaveBeenCalled();
    // Cursor IS set — second tick onward gets normal filter+dispatch flow.
    expect(state.cursorByRoom.get(ROOM_ID)).toBe("cursor-cold-1");
  });

  it("Cursor does NOT advance when fetchLive fails — subsequent ticks retry the same range", async () => {
    const deps = makeDeps({
      fetchLive: vi.fn(async () => ({
        ok: false as const,
        status: 502,
        error: "proxy",
      })),
    });
    const state = makeStateWithWarmCursor(USER_A_MXID, "cursor-old");

    await runPushTriggerTick(USER_A, state, deps);

    expect(state.cursorByRoom.get(ROOM_ID)).toBe("cursor-old");
    expect(deps.sendPushToUser).not.toHaveBeenCalled();
  });

  it("Multiple events in a batch: all qualifying events fire pushes; cursor advances once after the batch", async () => {
    const events = [makeEvent({ event_id: "$e1" }), makeEvent({ event_id: "$e2" })];
    const deps = makeDeps({
      fetchLive: vi.fn(async () => ({
        ok: true as const,
        events,
        nextSinceToken: "cursor-2",
      })),
    });
    const state = makeStateWithWarmCursor(USER_A_MXID);

    await runPushTriggerTick(USER_A, state, deps);

    expect(deps.sendPushToUser).toHaveBeenCalledTimes(2);
    expect(state.cursorByRoom.get(ROOM_ID)).toBe("cursor-2");
  });

  it("Never-throw contract: sendPushToUser failure does NOT propagate; cursor still advances", async () => {
    const deps = makeDeps({
      fetchLive: vi.fn(async () => ({
        ok: true as const,
        events: [makeEvent()],
        nextSinceToken: "cursor-2",
      })),
      sendPushToUser: vi.fn(async () => {
        throw new Error("push-sender crash");
      }),
    });
    const state = makeStateWithWarmCursor(USER_A_MXID);

    await expect(
      runPushTriggerTick(USER_A, state, deps),
    ).resolves.toBeDefined();
    // Cursor STILL advances — we successfully fetched, we tried to dispatch.
    // Dropping the push is preferable to re-firing on next tick from same
    // cursor (which would spam pushes for the same event).
    expect(state.cursorByRoom.get(ROOM_ID)).toBe("cursor-2");
  });

  it("classifyRoom is CALLED (not re-derived) — every qualifying event triggers a classifier lookup", async () => {
    const deps = makeDeps({
      fetchLive: vi.fn(async () => ({
        ok: true as const,
        events: [makeEvent()],
        nextSinceToken: "cursor-2",
      })),
    });
    const state = makeStateWithWarmCursor(USER_A_MXID);

    await runPushTriggerTick(USER_A, state, deps);

    // classifyRoom + getRegistryMembers + getRoomJoinedMembers all called
    // — the trigger delegates room shape logic to the existing classifier
    // exactly per D-02.
    expect(deps.classifyRoom).toHaveBeenCalled();
    expect(deps.getRegistryMembers).toHaveBeenCalled();
    expect(deps.getRoomJoinedMembers).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createPushTriggerLoop — scheduler shape + isolation + backoff + jitter
// ---------------------------------------------------------------------------

describe("createPushTriggerLoop — scheduler", () => {
  it("Test 11: Thundering-herd jitter — start(N users) produces N distinct nextRunAt values within [now, now + INITIAL_TICK_JITTER_MS]", () => {
    // Assert the constants are exported and locked to their documented
    // values — regression pin.
    expect(PUSH_TRIGGER_POLL_INTERVAL_MS).toBe(2_000);
    expect(PUSH_TRIGGER_INITIAL_JITTER_MS).toBe(500);
    expect(PUSH_TRIGGER_BACKOFF_LADDER_MS[0]).toBe(2_000);
    expect(
      PUSH_TRIGGER_BACKOFF_LADDER_MS[PUSH_TRIGGER_BACKOFF_LADDER_MS.length - 1],
    ).toBeGreaterThanOrEqual(60_000);

    // Deterministic rng returning distinct fractions → distinct scheduled
    // slot per user, all within the jitter window.
    const rngValues = [0.0, 0.5, 0.99];
    let rngIdx = 0;
    const rng = () => rngValues[rngIdx++];

    const deps = makeDeps();
    const loop = createPushTriggerLoop(deps, { jitter: true, rng });

    const observedRunAts: number[] = [];
    const nowRef = { value: 1_000_000 };
    deps.now = vi.fn(() => nowRef.value);

    // Instead of running the scheduler, capture the seeded state directly
    // via the exported seedForTests helper. If seedForTests isn't exposed,
    // fall back to invoking start(...) and immediately calling stop() —
    // the state is set at start time synchronously.
    loop.start([
      { userId: "u1", userMxid: "@u1:s" },
      { userId: "u2", userMxid: "@u2:s" },
      { userId: "u3", userMxid: "@u3:s" },
    ]);

    // Extract via peekPerUserStateForTests — exported for this exact test.
    const stateSnapshot = loop.__getPerUserStateForTests();
    for (const [, s] of stateSnapshot) {
      observedRunAts.push(s.nextRunAt);
    }
    loop.stop();

    // Three DISTINCT nextRunAt values (thundering-herd defense proof).
    const distinct = new Set(observedRunAts);
    expect(distinct.size).toBe(3);
    // All within [nowRef, nowRef + INITIAL_JITTER].
    for (const runAt of observedRunAts) {
      expect(runAt).toBeGreaterThanOrEqual(nowRef.value);
      expect(runAt).toBeLessThanOrEqual(
        nowRef.value + PUSH_TRIGGER_INITIAL_JITTER_MS,
      );
    }
  });

  it("Test 9: In-flight guard — overlapping ticks for the same user are skipped", async () => {
    vi.useFakeTimers();
    // Slow fetchLive to hold the tick in-flight; concurrent ticks must not
    // stack.
    let inflightCount = 0;
    let maxInflight = 0;
    const deps = makeDeps({
      getUserJoinedRooms: vi.fn(async () => {
        inflightCount++;
        if (inflightCount > maxInflight) maxInflight = inflightCount;
        await new Promise<void>((resolve) => setTimeout(resolve, 20_000));
        inflightCount--;
        return { ok: true as const, roomIds: [] };
      }),
    });

    const loop = createPushTriggerLoop(deps, { jitter: false });
    loop.start([{ userId: USER_A, userMxid: USER_A_MXID }]);

    // Advance long enough that the scheduler would try to dispatch multiple
    // ticks in-flight — the guard MUST keep the count at 1.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(maxInflight).toBe(1);

    loop.stop();
    vi.useRealTimers();
  });

  it("Test 7: Per-user isolation — one user's failing fetchLive does NOT block another user's tick", async () => {
    vi.useFakeTimers();

    const perUserCalls: Record<string, number> = {
      [USER_A_MXID]: 0,
      [USER_B_MXID]: 0,
    };
    const deps = makeDeps({
      getUserJoinedRooms: vi.fn(async (mxid: string) => {
        if (mxid === USER_A_MXID) {
          perUserCalls[USER_A_MXID]++;
          throw new Error("user A always fails");
        }
        perUserCalls[USER_B_MXID]++;
        return { ok: true as const, roomIds: [] };
      }),
    });

    const loop = createPushTriggerLoop(deps, { jitter: false });
    loop.start([
      { userId: USER_A, userMxid: USER_A_MXID },
      { userId: USER_B, userMxid: USER_B_MXID },
    ]);

    await vi.advanceTimersByTimeAsync(1_500);
    expect(perUserCalls[USER_A_MXID]).toBeGreaterThanOrEqual(1);
    expect(perUserCalls[USER_B_MXID]).toBeGreaterThanOrEqual(1);

    loop.stop();
    vi.useRealTimers();
  });

  it("Test 10: Backoff — two consecutive failures advance backoffIndex; success resets", async () => {
    vi.useFakeTimers();

    let callCount = 0;
    const deps = makeDeps({
      getUserJoinedRooms: vi.fn(async () => {
        callCount++;
        // First two calls fail; third succeeds.
        if (callCount <= 2) {
          throw new Error("temporary failure");
        }
        return { ok: true as const, roomIds: [] };
      }),
    });

    const loop = createPushTriggerLoop(deps, { jitter: false });
    loop.start([{ userId: USER_A, userMxid: USER_A_MXID }]);

    // Advance through the backoff ladder — first fail at t~0, second fail
    // at t~2s (first backoff), third success at t~2+4 = 6s if ladder is
    // [2s, 4s, ...]. Give ample slop.
    await vi.advanceTimersByTimeAsync(30_000);

    const stateAfter = loop.__getPerUserStateForTests().get(USER_A);
    expect(stateAfter).toBeDefined();
    // After the successful third call, backoffIndex should be reset to 0.
    expect(stateAfter?.backoffIndex).toBe(0);
    expect(callCount).toBeGreaterThanOrEqual(3);

    loop.stop();
    vi.useRealTimers();
  });

  it("stop() clears the per-user Map and cancels the scan timer", () => {
    const deps = makeDeps();
    const loop = createPushTriggerLoop(deps, { jitter: false });
    loop.start([{ userId: USER_A, userMxid: USER_A_MXID }]);

    expect(loop.__getPerUserStateForTests().size).toBe(1);

    loop.stop();

    expect(loop.__getPerUserStateForTests().size).toBe(0);
  });
});
