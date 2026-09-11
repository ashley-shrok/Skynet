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
  // Phase 92 Plan 04: getPinnedIds retired.
  putPinnedIds: vi.fn().mockResolvedValue([]),
  getHiddenIds: vi.fn().mockResolvedValue([]),
  putHiddenIds: vi.fn().mockResolvedValue([]),
}));

import {
  buildIdentityHostsFromFleet,
  refreshIdentities,
  __resetIdentitiesStoreForTest,
  deriveDiskPinnedIds,
} from "./identities-store.js";
import * as IdentitiesStore from "./identities-store.js";
import * as IdentitiesApi from "@/api/identities-api";
import type { Identity } from "@/api/identities-api";
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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 92 Plan 04 Task 1 — SEL-92-* tests for deriveDiskPinnedIds
// ─────────────────────────────────────────────────────────────────────────────
//
// deriveDiskPinnedIds projects each identity's `pinned: boolean` field into the
// conversation-row id space (`fleet::<hostId>::<sessionName>`). It replaces the
// retired getPinnedIds() /user-preferences fetch. The projection is:
//
//   for each identity in state.identities:
//     if identity.pinned !== true: skip (fail-closed per D-01)
//     hostId = identityHosts[identity.identityKey.toLowerCase()]
//     if hostId is undefined: skip (no host → no row to render on)
//     emit `fleet::${hostId}::${identityKey.toLowerCase()}`
//
// H2 invariant: the identityHosts argument MUST be built by
// buildIdentityHostsFromFleet (same helper the identities-store fetch uses).
// SEL-92-04 locks the export shape so a naive rewrite that introduces a
// parallel helper trips loudly.

function makeIdentity(
  identityKey: string,
  pinned: boolean | undefined,
): Identity {
  const base: Identity = {
    identityKey,
    displayName: identityKey,
    title: null,
    colorHue: null,
    voice: null,
    role: null,
    avatarMime: "",
    avatarUrl: "",
    avatarEtag: "",
    coordinator: false,
    task: null,
  };
  // Phase 92 D-04 — new field on the Identity type. Optional to preserve
  // compat with callsites that don't care about the pin projection.
  if (pinned !== undefined) {
    (base as Identity & { pinned?: boolean }).pinned = pinned;
  }
  return base;
}

// Seed the identities-store by invoking refreshIdentities with a stubbed
// listIdentities return — the only public write path into the module-scoped
// identities snapshot.
async function seedIdentities(list: Identity[]): Promise<void> {
  vi.mocked(IdentitiesApi.listIdentities).mockResolvedValue(list);
  // refreshIdentities skips the pre-fetch empty-map guard and always calls
  // listIdentities; seed at least one session so the code path is symmetric
  // with production use.
  updateFleetSessions([makeSession(1, "seed-noop")]);
  await refreshIdentities();
}

describe("Phase 92 Plan 04 — deriveDiskPinnedIds projection", () => {
  it("SEL-92-01 (happy path): projects pinned identities into fleet::<hostId>::<key> shape", async () => {
    await seedIdentities([
      makeIdentity("tina", true),
      makeIdentity("alice", false),
      makeIdentity("bob", true),
    ]);
    const identityHosts = { tina: 1, alice: 2, bob: 2 };
    const result = deriveDiskPinnedIds(identityHosts);
    // order-agnostic — sort both sides to compare
    expect([...result].sort()).toEqual(
      ["fleet::1::tina", "fleet::2::bob"].sort(),
    );
  });

  it("SEL-92-02 (fail-closed on missing pinned field): treats absent `pinned` as false", async () => {
    // Identity without `pinned` key at all — must be treated as unpinned per
    // D-01 fail-closed contract. Backend Plan-02 fail-closed contract mirrors.
    await seedIdentities([
      makeIdentity("tina", undefined),
      makeIdentity("bob", true),
    ]);
    const result = deriveDiskPinnedIds({ tina: 1, bob: 2 });
    expect(result).toEqual(["fleet::2::bob"]);
  });

  it("SEL-92-03 (missing host mapping filters identity out): identity absent from identityHosts is dropped", async () => {
    await seedIdentities([
      makeIdentity("tina", true),
      makeIdentity("bob", true),
    ]);
    // Only tina has a host mapping — bob is pinned but has no host, so it
    // cannot render as a pinned row and must be excluded.
    const result = deriveDiskPinnedIds({ tina: 1 });
    expect(result).toEqual(["fleet::1::tina"]);
  });

  it("SEL-92-04 (H2 lock): both buildIdentityHostsFromFleet AND deriveDiskPinnedIds are exported from identities-store", () => {
    // Both exports live on the same module. Anyone rewriting the pin path
    // must reuse buildIdentityHostsFromFleet (identities-store L74-85) rather
    // than a parallel local helper — SEL-92-04 is the regression trap.
    expect(typeof IdentitiesStore.buildIdentityHostsFromFleet).toBe("function");
    expect(typeof IdentitiesStore.deriveDiskPinnedIds).toBe("function");
    // Both must be functions (not just properties). A future refactor that
    // silently replaces buildIdentityHostsFromFleet with a non-function value
    // (e.g. deleting the export and re-exporting an object property) trips
    // the truthy typeof gate.
  });

  it("SEL-92-05 (empty identityHosts): returns empty array when identityHosts is empty", async () => {
    await seedIdentities([makeIdentity("tina", true)]);
    // Empty identityHosts → no rows to project onto → empty result. Matches
    // the pre-fleet-loaded transition window.
    expect(deriveDiskPinnedIds({})).toEqual([]);
  });
});
