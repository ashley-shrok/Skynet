import { describe, it, expect, beforeEach, vi } from "vitest";

// Phase 66 Plan 05 — Frontend identityHosts enrichment tests.
//
// vi.mock MUST come BEFORE the SUT import so vitest's hoisted mock intercepts
// the identities-store's `import { listIdentities } from "@/api/identities-api"`
// module-graph edge. The store calls listIdentities inside fetchOnce; every
// assertion in this file inspects the mock's call args to prove the store built
// the identityHosts map correctly from conversation-store.getFleetSessionsSnapshot().
vi.mock("@/api/identities-api", () => ({
  listIdentities: vi.fn().mockResolvedValue([]),
  // Downstream user-preferences-api is not touched by identities-store, but
  // conversation-store imports it — provide a mock so its module load doesn't
  // hit the network during test setup.
}));

vi.mock("@/api/user-preferences-api", () => ({
  getPinnedIds: vi.fn().mockResolvedValue([]),
  putPinnedIds: vi.fn().mockResolvedValue([]),
  getHiddenIds: vi.fn().mockResolvedValue([]),
  putHiddenIds: vi.fn().mockResolvedValue([]),
}));

import {
  buildIdentityHostsFromFleet,
  refreshIdentities,
  __resetIdentitiesStoreForTest,
} from "./identities-store.js";
import * as IdentitiesApi from "@/api/identities-api";
import {
  updateFleetSessions,
  __resetFleetSessionsForTest,
  type FleetSession,
} from "./conversation-store.js";

// Small FleetSession fixture builder — only the shape identities-store's
// buildIdentityHostsFromFleet reads (hostId + sessionName). Other FleetSession
// fields (hostName / created / role) are dummy stubs; if buildIdentityHosts
// touched them we'd surface it via runtime type error.
function makeSession(hostId: number, sessionName: string): FleetSession {
  return {
    hostId,
    hostName: `host-${hostId}`,
    sessionName,
    created: 0,
    role: null,
  };
}

beforeEach(() => {
  vi.mocked(IdentitiesApi.listIdentities).mockClear();
  vi.mocked(IdentitiesApi.listIdentities).mockResolvedValue([]);
  __resetFleetSessionsForTest();
  __resetIdentitiesStoreForTest();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 1-4: buildIdentityHostsFromFleet pure-function contract
// ─────────────────────────────────────────────────────────────────────────────

describe("buildIdentityHostsFromFleet — pure function", () => {
  it("Test 1 (happy path): builds { identityKey → hostId } for each distinct session", () => {
    const sessions = [
      makeSession(1, "tina"),
      makeSession(5, "nelly"),
    ];
    expect(buildIdentityHostsFromFleet(sessions)).toEqual({ tina: 1, nelly: 5 });
  });

  it("Test 2 (empty): empty sessions array → empty map", () => {
    expect(buildIdentityHostsFromFleet([])).toEqual({});
  });

  it("Test 3 (first-wins): duplicate identityKey → first session's hostId wins", () => {
    const sessions = [
      makeSession(1, "tina"),
      makeSession(9, "tina"),
    ];
    expect(buildIdentityHostsFromFleet(sessions)).toEqual({ tina: 1 });
  });

  it("Test 4 (name normalization): sessionMatchKey lowercases the session name", () => {
    const sessions = [makeSession(1, "Tina")];
    expect(buildIdentityHostsFromFleet(sessions)).toEqual({ tina: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 5-6: fetchOnce (invoked via refreshIdentities) passes the constructed
// map to listIdentities
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchOnce / refreshIdentities — passes populated identityHosts to listIdentities", () => {
  it("Test 5: fleet populated → listIdentities called with populated map", async () => {
    updateFleetSessions([makeSession(1, "tina")]);
    await refreshIdentities();
    expect(vi.mocked(IdentitiesApi.listIdentities)).toHaveBeenCalledWith({
      tina: 1,
    });
  });

  it("Test 6: fleet empty (not loaded) → listIdentities called with {}", async () => {
    // fleetSessions state starts empty via __resetFleetSessionsForTest.
    await refreshIdentities();
    expect(vi.mocked(IdentitiesApi.listIdentities)).toHaveBeenCalledWith({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7: one-shot refresh after fleet-sessions load (guarded to fire exactly once)
// ─────────────────────────────────────────────────────────────────────────────

describe("refresh-after-fleet-load — fires exactly once", () => {
  it("Test 7: fetchOnce with empty fleet then updateFleetSessions triggers 1 additional listIdentities call", async () => {
    // First fetch — fleet is empty, so listIdentities called with {}.
    await refreshIdentities();
    expect(vi.mocked(IdentitiesApi.listIdentities)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(IdentitiesApi.listIdentities)).toHaveBeenLastCalledWith({});

    // Fleet loads (false→true flip) → one-shot re-fetch should fire.
    updateFleetSessions([makeSession(1, "tina")]);
    // The subscription is synchronous through microtasks — flush.
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.mocked(IdentitiesApi.listIdentities)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(IdentitiesApi.listIdentities)).toHaveBeenLastCalledWith({
      tina: 1,
    });

    // Subsequent fleet changes must NOT chain more refreshes (guard).
    updateFleetSessions([makeSession(1, "tina"), makeSession(5, "nelly")]);
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.mocked(IdentitiesApi.listIdentities)).toHaveBeenCalledTimes(2);
  });
});
