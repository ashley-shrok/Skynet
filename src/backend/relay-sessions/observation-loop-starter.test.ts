/**
 * observation-loop-starter unit tests — Phase 89-03 Task 4.
 *
 * Covers:
 *   - Startup sequence order: ensureRegistryRoomsExist → enumerateUsers
 *     → createObservationLoop.start (Test 1). Auto-backfill is
 *     DELIBERATELY OMITTED — D-12 backfill is MANUAL per instance-deployer
 *     (Ashley 2026-09-08 post-verifier clarification, matching Phase 88
 *     D-02 precedent). Test 1 asserts runRegistryRoomsBackfill is NOT
 *     called at boot.
 *   - ensureRegistryRoomsExist creds-missing → warn + no loop start (Test 2).
 *   - Zero users with mxid → info log, empty-list scheduler.start (Test 3).
 *
 * Mocking strategy: vi.mock the three collaborators (registry-rooms,
 * observation-loop, database/db/index) at the module level so we control
 * every downstream call. No real DB, no HTTP. The
 * registry-rooms-backfill mock is retained (rather than deleted) so any
 * regression that re-introduces the auto-call is caught by Test 1's
 * "not.toHaveBeenCalled" assertion.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — MUST be declared before importing the module under test.
// ---------------------------------------------------------------------------

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

// Hoisted mocks — vi.mock factories run BEFORE any top-level const, so we
// need vi.hoisted for shared mock handles that the factories reference.
const hoisted = vi.hoisted(() => ({
  mockEnsureRegistryRoomsExist: vi.fn(),
  mockRunRegistryRoomsBackfill: vi.fn(),
  mockLoopStart: vi.fn(),
  mockLoopStop: vi.fn(),
  mockCreateObservationLoop: vi.fn(),
  mockPreparedAll: vi.fn(),
}));
hoisted.mockCreateObservationLoop.mockImplementation(() => ({
  start: hoisted.mockLoopStart,
  stop: hoisted.mockLoopStop,
}));

const {
  mockEnsureRegistryRoomsExist,
  mockRunRegistryRoomsBackfill,
  mockLoopStart,
  mockLoopStop,
  mockCreateObservationLoop,
  mockPreparedAll,
} = hoisted;

vi.mock("./registry-rooms.js", () => ({
  ensureRegistryRoomsExist: hoisted.mockEnsureRegistryRoomsExist,
  getAgentsRegistryRoomId: vi.fn(async () => null),
}));

vi.mock("./registry-rooms-backfill.js", () => ({
  runRegistryRoomsBackfill: hoisted.mockRunRegistryRoomsBackfill,
}));

vi.mock("./observation-loop.js", () => ({
  createObservationLoop: hoisted.mockCreateObservationLoop,
}));

vi.mock("./relay-room-sessions-store.js", () => ({
  materializeRelayRoomSession: vi.fn(),
  markRelayRoomSessionInactive: vi.fn(),
  reactivateRelayRoomSession: vi.fn(),
  refreshRelayRoomLastActivity: vi.fn(),
  listActiveRelayRoomSessions: vi.fn(),
}));

vi.mock("./admin-rooms-ignore-list.js", () => ({
  isAdminRoom: vi.fn(),
  listAdminRooms: vi.fn(),
}));

vi.mock("../matrix/matrix-admin-client.js", () => ({
  getUserJoinedRooms: vi.fn(),
  getRoomLatestEventTs: vi.fn(),
  getRoomJoinedMembers: vi.fn(),
}));

vi.mock("../database/db/index.js", () => ({
  db: {
    $client: {
      prepare: vi.fn(() => ({
        all: hoisted.mockPreparedAll,
      })),
    },
  },
}));

// ---------------------------------------------------------------------------
// Module under test (imported AFTER mocks)
// ---------------------------------------------------------------------------

import { startObservationLoopOnBoot } from "./observation-loop-starter.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockEnsureRegistryRoomsExist.mockReset();
  mockRunRegistryRoomsBackfill.mockReset();
  mockLoopStart.mockReset();
  mockLoopStop.mockReset();
  mockCreateObservationLoop.mockClear();
  mockPreparedAll.mockReset();

  // Default happy-path returns
  mockEnsureRegistryRoomsExist.mockResolvedValue({
    ok: true,
    agentsRoomId: "!agents:s",
    humansRoomId: "!humans:s",
  });
  mockRunRegistryRoomsBackfill.mockResolvedValue({
    ok: true,
    agentsAttempted: 0,
    humansAttempted: 2,
    agentsFailed: 0,
    humansFailed: 0,
  });
  mockPreparedAll.mockReturnValue([
    { userId: "user-a", userMxid: "@ashley:s" },
    { userId: "user-b", userMxid: "@bob:s" },
  ]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("startObservationLoopOnBoot", () => {
  it("Test 1: happy path — ensure → enumerate → loop.start called in order; auto-backfill NOT called (D-12 is manual per instance-deployer)", async () => {
    const result = await startObservationLoopOnBoot();

    expect(mockEnsureRegistryRoomsExist).toHaveBeenCalledTimes(1);
    // D-12 backfill is MANUAL — see module docblock. Regression guard: if a
    // future edit accidentally re-wires runRegistryRoomsBackfill into the
    // boot sequence, this assertion fires.
    expect(mockRunRegistryRoomsBackfill).not.toHaveBeenCalled();
    expect(mockCreateObservationLoop).toHaveBeenCalledTimes(1);
    expect(mockLoopStart).toHaveBeenCalledTimes(1);
    expect(mockLoopStart).toHaveBeenCalledWith([
      { userId: "user-a", userMxid: "@ashley:s" },
      { userId: "user-b", userMxid: "@bob:s" },
    ]);

    // Order: ensure before loop.start.
    const ensureOrder = mockEnsureRegistryRoomsExist.mock.invocationCallOrder[0];
    const startOrder = mockLoopStart.mock.invocationCallOrder[0];
    expect(ensureOrder).toBeLessThan(startOrder);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.usersScheduled).toBe(2);
    }
  });

  it("Test 2: ensureRegistryRoomsExist creds-missing → warn + return early (no loop start)", async () => {
    mockEnsureRegistryRoomsExist.mockResolvedValue({
      ok: false,
      reason: "creds_missing",
    });

    const result = await startObservationLoopOnBoot();

    expect(mockRunRegistryRoomsBackfill).not.toHaveBeenCalled();
    expect(mockLoopStart).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("creds_missing");
    }
  });

  it("Test 3: zero users with mxid → info log + start with empty user list (no-op scheduler on fresh install)", async () => {
    mockPreparedAll.mockReturnValue([]);

    const result = await startObservationLoopOnBoot();

    expect(mockLoopStart).toHaveBeenCalledTimes(1);
    expect(mockLoopStart).toHaveBeenCalledWith([]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.usersScheduled).toBe(0);
    }
  });
});
