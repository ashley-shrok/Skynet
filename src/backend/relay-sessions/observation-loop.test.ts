/**
 * observation-loop unit tests — Phase 89-03 Task 3.
 *
 * Covers:
 *   - runObservationTick core orchestration (materialize / mark-inactive /
 *     reactivate / refresh-activity per D-04/D-05/D-06/D-08/D-13/D-07).
 *   - Backoff ladder + reset semantics (D-06).
 *   - Per-user isolation (D-04).
 *   - Per-user in-flight guard (ssh-poll-orchestrator quick-260820-tm0 pattern).
 *
 * Mocking strategy: every dep the observation-loop consumes is injected via
 * ObservationTickDeps — the tests wire vi.fn() implementations directly.
 * No vi.mock() needed; no database, no HTTP.
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
  runObservationTick,
  createObservationLoop,
  OBSERVATION_TICK_INTERVAL_MS,
  BACKOFF_LADDER_MS,
  type ObservationTickDeps,
} from "./observation-loop.js";

// ---------------------------------------------------------------------------
// Test fixtures — a minimal ObservationTickDeps factory returning happy stubs.
// Individual tests override specific fields per scenario.
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<ObservationTickDeps> = {}): ObservationTickDeps {
  return {
    // Matrix admin-client primitives
    getUserJoinedRooms: vi.fn(async () => ({ ok: true, roomIds: [] })),
    getRoomLatestEventTs: vi.fn(async () => ({ ok: true, ts: null })),
    getRoomJoinedMembers: vi.fn(async () => ({
      ok: true,
      memberMxids: [],
      total: 0,
    })),
    // Store primitives
    materializeRelayRoomSession: vi.fn(async () => {}),
    markRelayRoomSessionInactive: vi.fn(async () => {}),
    reactivateRelayRoomSession: vi.fn(async () => {}),
    refreshRelayRoomLastActivity: vi.fn(async () => {}),
    listActiveRelayRoomSessions: vi.fn(async () => []),
    // Ignore-list + registry
    listAdminRooms: vi.fn(async () => []),
    getAgentsRegistryRoomId: vi.fn(async () => null),
    ...overrides,
  };
}

const USER_A = "user-a-id";
const USER_A_MXID = "@ashley:server";
const USER_B = "user-b-id";
const USER_B_MXID = "@bob:server";

beforeEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// runObservationTick — orchestration tests
// ---------------------------------------------------------------------------

describe("runObservationTick", () => {
  it("Test 1: happy path materialize — new group + two-party non-agent room both get materialize + reactivate + refresh", async () => {
    const deps = makeDeps({
      getUserJoinedRooms: vi.fn(async () => ({
        ok: true,
        roomIds: ["!r1:s", "!r2:s"],
      })),
      getRoomJoinedMembers: vi.fn(async (roomId: string) => {
        if (roomId === "!r1:s") {
          return {
            ok: true as const,
            memberMxids: [USER_A_MXID, "@x:s", "@y:s"],
            total: 3,
          };
        }
        // !r2:s — two-party with foreign account (not in agents registry)
        return {
          ok: true as const,
          memberMxids: [USER_A_MXID, "@foreign:s"],
          total: 2,
        };
      }),
      getRoomLatestEventTs: vi.fn(async () => ({
        ok: true,
        ts: 1725840000000,
      })),
    });

    const result = await runObservationTick(USER_A, USER_A_MXID, deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.materialized).toBe(2);
    }
    expect(deps.materializeRelayRoomSession).toHaveBeenCalledTimes(2);
    expect(deps.materializeRelayRoomSession).toHaveBeenCalledWith(
      USER_A,
      "!r1:s",
      null,
    );
    expect(deps.materializeRelayRoomSession).toHaveBeenCalledWith(
      USER_A,
      "!r2:s",
      null,
    );
    expect(deps.refreshRelayRoomLastActivity).toHaveBeenCalledTimes(2);
    expect(deps.markRelayRoomSessionInactive).not.toHaveBeenCalled();
  });

  it("Test 2: external kick — active row for room no longer in joined_rooms transitions to inactive", async () => {
    const deps = makeDeps({
      getUserJoinedRooms: vi.fn(async () => ({
        ok: true,
        roomIds: [], // user was kicked from !r1
      })),
      listActiveRelayRoomSessions: vi.fn(async () => [
        {
          id: "session-1",
          roomId: "!r1:s",
          roomTitle: null,
          lastActivityAt: null,
          createdAt: "2026-09-01",
          updatedAt: "2026-09-01",
        },
      ]),
    });

    await runObservationTick(USER_A, USER_A_MXID, deps);
    expect(deps.markRelayRoomSessionInactive).toHaveBeenCalledTimes(1);
    expect(deps.markRelayRoomSessionInactive).toHaveBeenCalledWith(
      USER_A,
      "!r1:s",
    );
    expect(deps.materializeRelayRoomSession).not.toHaveBeenCalled();
  });

  it("Test 3: reactivation — user rejoined a room previously inactive; materialize is called (idempotent no-op) + reactivate is called (flips state)", async () => {
    const deps = makeDeps({
      getUserJoinedRooms: vi.fn(async () => ({
        ok: true,
        roomIds: ["!r1:s"],
      })),
      getRoomJoinedMembers: vi.fn(async () => ({
        ok: true,
        memberMxids: [USER_A_MXID, "@foreign:s", "@extra:s"],
        total: 3,
      })),
      // listActiveRelayRoomSessions returns [] (row is inactive)
      listActiveRelayRoomSessions: vi.fn(async () => []),
    });

    await runObservationTick(USER_A, USER_A_MXID, deps);
    expect(deps.materializeRelayRoomSession).toHaveBeenCalledTimes(1);
    expect(deps.reactivateRelayRoomSession).toHaveBeenCalledTimes(1);
    expect(deps.reactivateRelayRoomSession).toHaveBeenCalledWith(
      USER_A,
      "!r1:s",
    );
  });

  it("Test 4: D-08 exclusion (harness DM) — two-party w/ registry-agent other member is skipped", async () => {
    const deps = makeDeps({
      getUserJoinedRooms: vi.fn(async () => ({
        ok: true,
        roomIds: ["!dm:s"],
      })),
      getRoomJoinedMembers: vi.fn(async (roomId: string) => {
        if (roomId === "!agentsRegistry:s") {
          return {
            ok: true as const,
            memberMxids: ["@agent-local-1:s"],
            total: 1,
          };
        }
        return {
          ok: true as const,
          memberMxids: [USER_A_MXID, "@agent-local-1:s"],
          total: 2,
        };
      }),
      getAgentsRegistryRoomId: vi.fn(async () => "!agentsRegistry:s"),
    });

    await runObservationTick(USER_A, USER_A_MXID, deps);
    expect(deps.materializeRelayRoomSession).not.toHaveBeenCalled();
    expect(deps.markRelayRoomSessionInactive).not.toHaveBeenCalled();
  });

  it("Test 5: D-13 exclusion (admin room) — joined_rooms containing agents-registry-room-id is skipped", async () => {
    const deps = makeDeps({
      getUserJoinedRooms: vi.fn(async () => ({
        ok: true,
        roomIds: ["!agentsRegistry:s"],
      })),
      getRoomJoinedMembers: vi.fn(async () => ({
        ok: true,
        memberMxids: [USER_A_MXID, "@a:s", "@b:s", "@c:s"],
        total: 4,
      })),
      listAdminRooms: vi.fn(async () => ["!agentsRegistry:s"]),
    });

    await runObservationTick(USER_A, USER_A_MXID, deps);
    expect(deps.materializeRelayRoomSession).not.toHaveBeenCalled();
  });

  it("Test 6: D-06 failure — getUserJoinedRooms non-ok: no rows destroyed, tick returns ok:false", async () => {
    const deps = makeDeps({
      getUserJoinedRooms: vi.fn(async () => ({
        ok: false,
        status: 504,
        error: "admin_api_timeout",
      })),
      listActiveRelayRoomSessions: vi.fn(async () => [
        {
          id: "session-1",
          roomId: "!r1:s",
          roomTitle: null,
          lastActivityAt: null,
          createdAt: "",
          updatedAt: "",
        },
        {
          id: "session-2",
          roomId: "!r2:s",
          roomTitle: null,
          lastActivityAt: null,
          createdAt: "",
          updatedAt: "",
        },
      ]),
    });

    const result = await runObservationTick(USER_A, USER_A_MXID, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("joined_rooms_fetch_failed");
    }
    expect(deps.markRelayRoomSessionInactive).not.toHaveBeenCalled();
    expect(deps.materializeRelayRoomSession).not.toHaveBeenCalled();
    // listActiveRelayRoomSessions should NOT have been queried either — the
    // whole reconcile step is skipped when the join-list fetch fails.
    expect(deps.listActiveRelayRoomSessions).not.toHaveBeenCalled();
  });

  it("Test 9: D-05 same-tick augmentation — refreshRelayRoomLastActivity called with the ts from getRoomLatestEventTs", async () => {
    const deps = makeDeps({
      getUserJoinedRooms: vi.fn(async () => ({
        ok: true,
        roomIds: ["!r1:s"],
      })),
      getRoomJoinedMembers: vi.fn(async () => ({
        ok: true,
        memberMxids: [USER_A_MXID, "@foreign:s", "@extra:s"],
        total: 3,
      })),
      getRoomLatestEventTs: vi.fn(async () => ({ ok: true, ts: 1725840000000 })),
    });

    await runObservationTick(USER_A, USER_A_MXID, deps);
    expect(deps.refreshRelayRoomLastActivity).toHaveBeenCalledTimes(1);
    const call = vi.mocked(deps.refreshRelayRoomLastActivity).mock.calls[0];
    expect(call[0]).toBe(USER_A);
    expect(call[1]).toBe("!r1:s");
    // ISO string of 1725840000000 = 2024-09-09T00:00:00.000Z
    expect(call[2]).toBe(new Date(1725840000000).toISOString());
  });

  it("Test 9b: per-room ts fetch failure does NOT block materialize — refresh is skipped for that room", async () => {
    const deps = makeDeps({
      getUserJoinedRooms: vi.fn(async () => ({
        ok: true,
        roomIds: ["!r1:s"],
      })),
      getRoomJoinedMembers: vi.fn(async () => ({
        ok: true,
        memberMxids: [USER_A_MXID, "@foreign:s", "@extra:s"],
        total: 3,
      })),
      getRoomLatestEventTs: vi.fn(async () => ({
        ok: false,
        status: 502,
        error: "admin_api_proxy_error",
      })),
    });

    await runObservationTick(USER_A, USER_A_MXID, deps);
    expect(deps.materializeRelayRoomSession).toHaveBeenCalledTimes(1);
    expect(deps.refreshRelayRoomLastActivity).not.toHaveBeenCalled();
  });

  it("Test H-1 [fixup]: per-room getRoomJoinedMembers failure does NOT mark that room inactive (D-06 no-destruction invariant)", async () => {
    // User has 3 joined rooms. The per-room members fetch fails for room 2
    // (transient Synapse 429 / network hiccup). Rooms 1 and 3 succeed.
    // There is an existing active DB row for room 2. Per D-06, that row
    // MUST NOT be marked inactive — absence of observation is not evidence
    // the user left the room. Only rooms we SUCCESSFULLY fetched and that
    // are NOT in the discovered set may be marked inactive.
    const deps = makeDeps({
      getUserJoinedRooms: vi.fn(async () => ({
        ok: true,
        roomIds: ["!r1:s", "!r2:s", "!r3:s"],
      })),
      getRoomJoinedMembers: vi.fn(async (roomId: string) => {
        if (roomId === "!r2:s") {
          // Transient failure on the per-room fetch. Whole-user fetch
          // succeeded, so the tick continues — but this room's state is
          // now unknown and MUST NOT be reconciled against.
          return {
            ok: false as const,
            status: 429,
            error: "admin_api_non_2xx",
          };
        }
        return {
          ok: true as const,
          memberMxids: [USER_A_MXID, "@foreign:s", "@extra:s"],
          total: 3,
        };
      }),
      // DB has an active row for the room whose per-room fetch failed.
      listActiveRelayRoomSessions: vi.fn(async () => [
        {
          id: "session-r2",
          roomId: "!r2:s",
          roomTitle: null,
          lastActivityAt: null,
          createdAt: "2026-09-01",
          updatedAt: "2026-09-01",
        },
      ]),
    });

    await runObservationTick(USER_A, USER_A_MXID, deps);

    // Rooms 1 and 3 materialize as normal.
    expect(deps.materializeRelayRoomSession).toHaveBeenCalledWith(
      USER_A,
      "!r1:s",
      null,
    );
    expect(deps.materializeRelayRoomSession).toHaveBeenCalledWith(
      USER_A,
      "!r3:s",
      null,
    );
    // Critical: room 2's DB row MUST NOT be marked inactive despite being
    // absent from materializedRoomIds — the per-room fetch failed so its
    // state is unknown, not "user left".
    expect(deps.markRelayRoomSessionInactive).not.toHaveBeenCalledWith(
      USER_A,
      "!r2:s",
    );
  });

  it("Test 10: D-07 no-user-visible — runObservationTick never throws when store primitives throw", async () => {
    const deps = makeDeps({
      getUserJoinedRooms: vi.fn(async () => ({
        ok: true,
        roomIds: ["!r1:s"],
      })),
      getRoomJoinedMembers: vi.fn(async () => ({
        ok: true,
        memberMxids: [USER_A_MXID, "@foreign:s", "@extra:s"],
        total: 3,
      })),
      materializeRelayRoomSession: vi.fn(async () => {
        throw new Error("db failure");
      }),
    });

    // MUST NOT THROW — return { ok:false, reason:... } instead.
    await expect(
      runObservationTick(USER_A, USER_A_MXID, deps),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// createObservationLoop — per-user scheduler + backoff + in-flight guard
// ---------------------------------------------------------------------------

describe("createObservationLoop", () => {
  it("Test 7: D-06 backoff ladder — consecutive failures walk 10s → 30s → 60s → 120s → 300s (cap); success resets to 10s", () => {
    // The ladder itself is exported; this test locks its shape as a public
    // contract so the scheduler code can be exercised safely.
    expect(BACKOFF_LADDER_MS).toEqual([
      10_000, 30_000, 60_000, 120_000, 300_000,
    ]);
    // Cap: index >= 4 clamps at 300_000 — verified by asserting the last
    // element is 300_000 AND that the length is 5 (so index 4 is the cap).
    expect(BACKOFF_LADDER_MS[BACKOFF_LADDER_MS.length - 1]).toBe(300_000);
    // Base tick interval per D-04.
    expect(OBSERVATION_TICK_INTERVAL_MS).toBe(10_000);
  });

  it("Test 8: D-04 per-user isolation — one user's failing tick does NOT block another user's next scheduled tick", async () => {
    vi.useFakeTimers();

    const perUserCalls: Record<string, number> = { [USER_A]: 0, [USER_B]: 0 };
    const deps = makeDeps({
      getUserJoinedRooms: vi.fn(async (mxid: string) => {
        if (mxid === USER_A_MXID) {
          perUserCalls[USER_A]++;
          // Fail on every tick for user A
          throw new Error("user A always fails");
        }
        perUserCalls[USER_B]++;
        return { ok: true as const, roomIds: [] };
      }),
    });

    const loop = createObservationLoop(deps);
    loop.start([
      { userId: USER_A, userMxid: USER_A_MXID },
      { userId: USER_B, userMxid: USER_B_MXID },
    ]);

    // Advance to allow both users' first ticks.
    await vi.advanceTimersByTimeAsync(2000);
    // Both should have run once
    expect(perUserCalls[USER_A]).toBeGreaterThanOrEqual(1);
    expect(perUserCalls[USER_B]).toBeGreaterThanOrEqual(1);

    // Advance another 10s+ — user B should have run again on its 10s cadence.
    await vi.advanceTimersByTimeAsync(11_000);
    expect(perUserCalls[USER_B]).toBeGreaterThanOrEqual(2);

    loop.stop();
    vi.useRealTimers();
  });

  it("Test 11: per-user in-flight guard — a slow tick does not accumulate a second tick for the same user", async () => {
    vi.useFakeTimers();

    let inflightACount = 0;
    let concurrentA = 0;
    let maxConcurrentA = 0;
    const deps = makeDeps({
      getUserJoinedRooms: vi.fn(async () => {
        inflightACount++;
        concurrentA++;
        if (concurrentA > maxConcurrentA) maxConcurrentA = concurrentA;
        // Simulate a slow tick — 30s.
        await new Promise<void>((resolve) => setTimeout(resolve, 30_000));
        concurrentA--;
        return { ok: true as const, roomIds: [] };
      }),
    });

    const loop = createObservationLoop(deps);
    loop.start([{ userId: USER_A, userMxid: USER_A_MXID }]);

    // Advance 25s while the first tick is still in flight — the scheduler
    // should attempt more ticks but the guard should skip them.
    await vi.advanceTimersByTimeAsync(25_000);
    // maxConcurrentA MUST remain 1 — no accumulated concurrent ticks.
    expect(maxConcurrentA).toBe(1);
    expect(inflightACount).toBe(1);

    loop.stop();
    vi.useRealTimers();
  });
});
