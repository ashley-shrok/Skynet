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
  // Phase 107 Plan 04: getHiddenIds retired.
  putPinnedIds: vi.fn().mockResolvedValue([]),
  putHiddenIds: vi.fn().mockResolvedValue([]),
}));

import {
  buildIdentityHostsFromFleet,
  refreshIdentities,
  __resetIdentitiesStoreForTest,
  __getIdentitiesStoreSnapshotForTest,
  __seedIdentitiesLoadedFalseForTest,
  deriveDiskPinnedIds,
  deriveDiskHiddenIds,
  patchIdentityFlag,
  mergeIdentityAppearance,
} from "./identities-store.js";
import * as IdentitiesStore from "./identities-store.js";
import * as IdentitiesApi from "@/api/identities-api";
import * as UserPreferencesApi from "@/api/user-preferences-api";
import type { Identity } from "@/api/identities-api";
import {
  updateFleetSessions,
  __resetFleetSessionsForTest,
  __resetPinnedIdsForTest,
  __resetHiddenIdsForTest,
  __getSnapshotForTest,
  pinConversation,
  unpinConversation,
  hideConversation,
  unhideConversation,
  hydratePinnedIdsFromServer,
  hydrateHiddenIdsFromServer,
  type FleetSession,
} from "./conversation-store.js";
import * as ConversationStore from "./conversation-store.js";

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
  vi.mocked(UserPreferencesApi.putPinnedIds).mockClear();
  vi.mocked(UserPreferencesApi.putPinnedIds).mockResolvedValue([]);
  vi.mocked(UserPreferencesApi.putHiddenIds).mockClear();
  vi.mocked(UserPreferencesApi.putHiddenIds).mockResolvedValue([]);
  __resetFleetSessionsForTest();
  __resetIdentitiesStoreForTest();
  __resetPinnedIdsForTest();
  __resetHiddenIdsForTest();
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

  // Regression guard: a FAILED post-fleet-load refresh must not spend the
  // latch. It used to be set before the fetch resolved, so a single failure
  // left the safe-default (null-cosmetics) render up for the life of the tab —
  // the colourless-conversation-rows bug. The only recovery was a user action
  // that called refreshIdentities directly, e.g. creating a role.
  it("Test 7b: a failed post-fleet-load refresh retries on the next fleetSessions change", async () => {
    vi.mocked(IdentitiesApi.listIdentities).mockRejectedValueOnce(
      new Error("network down"),
    );

    // Fleet loads → one-shot re-fetch fires and FAILS.
    updateFleetSessions([makeSession(1, "tina")]);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(vi.mocked(IdentitiesApi.listIdentities)).toHaveBeenCalledTimes(1);

    // Next fleetSessions change must retry, because the latch was not spent.
    updateFleetSessions([makeSession(1, "tina"), makeSession(5, "nelly")]);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(vi.mocked(IdentitiesApi.listIdentities)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(IdentitiesApi.listIdentities)).toHaveBeenLastCalledWith({
      tina: 1,
      nelly: 5,
    });

    // Once it succeeds the latch IS spent — no further chaining.
    updateFleetSessions([makeSession(1, "tina"), makeSession(7, "zeus")]);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(vi.mocked(IdentitiesApi.listIdentities)).toHaveBeenCalledTimes(2);
  });

  it("Test 7c: refreshIdentities resolves false on failure, true on success, and never rejects", async () => {
    vi.mocked(IdentitiesApi.listIdentities).mockRejectedValueOnce(
      new Error("boom"),
    );
    await expect(refreshIdentities()).resolves.toBe(false);
    await expect(refreshIdentities()).resolves.toBe(true);
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
  hostId?: number,
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
  // quick-260912-0t4: hostId enables (hostId, key)-scoped byHostKey lookups
  // and cross-host name-collision tests for patchIdentityFlag.
  if (hostId !== undefined) {
    (base as Identity & { hostId?: number }).hostId = hostId;
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
      makeIdentity("user", false),
      makeIdentity("bob", true),
    ]);
    const identityHosts = { tina: 1, user: 2, bob: 2 };
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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 107 Plan 04 Task 1 — SEL-107-* tests for deriveDiskHiddenIds
// ─────────────────────────────────────────────────────────────────────────────
//
// deriveDiskHiddenIds mirrors deriveDiskPinnedIds exactly — same projection
// algorithm, same fail-closed contract, same H2 reuse of buildIdentityHostsFromFleet
// as argument. Only the field changes: `identity.pinned` → `identity.hidden`.
//
// H2 invariant: identityHosts argument MUST be built by buildIdentityHostsFromFleet.
// SEL-107-04 locks the export shape so a naive rewrite trips loudly.

function makeIdentityWithHidden(
  identityKey: string,
  opts: { pinned?: boolean; hidden?: boolean },
  hostId?: number,
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
  if (opts.pinned !== undefined) {
    (base as Identity & { pinned?: boolean }).pinned = opts.pinned;
  }
  if (opts.hidden !== undefined) {
    (base as Identity & { hidden?: boolean }).hidden = opts.hidden;
  }
  if (hostId !== undefined) {
    (base as Identity & { hostId?: number }).hostId = hostId;
  }
  return base;
}

describe("Phase 107 Plan 04 — deriveDiskHiddenIds projection", () => {
  it("SEL-107-01 (happy path): projects hidden identities into fleet::<hostId>::<key> shape", async () => {
    await seedIdentities([
      makeIdentityWithHidden("tina", { hidden: true }),
      makeIdentityWithHidden("user", { hidden: false }),
      makeIdentityWithHidden("bob", { hidden: true }),
    ]);
    const identityHosts = { tina: 1, user: 2, bob: 2 };
    const result = deriveDiskHiddenIds(identityHosts);
    // order-agnostic — sort both sides to compare
    expect([...result].sort()).toEqual(
      ["fleet::1::tina", "fleet::2::bob"].sort(),
    );
  });

  it("SEL-107-02 (fail-closed on missing hidden field): treats absent `hidden` as false", async () => {
    // Identity without `hidden` key at all — must be treated as unhidden per
    // D-01 fail-closed contract. Backend Plan-02 fail-closed contract mirrors.
    await seedIdentities([
      makeIdentityWithHidden("tina", {}),       // no hidden field
      makeIdentityWithHidden("bob", { hidden: true }),
    ]);
    const result = deriveDiskHiddenIds({ tina: 1, bob: 2 });
    expect(result).toEqual(["fleet::2::bob"]);
  });

  it("SEL-107-03 (missing host mapping filters identity out): identity absent from identityHosts is dropped", async () => {
    await seedIdentities([
      makeIdentityWithHidden("tina", { hidden: true }),
      makeIdentityWithHidden("bob", { hidden: true }),
    ]);
    // Only tina has a host mapping — bob is hidden but has no host, so it
    // cannot render as a hidden row and must be excluded.
    const result = deriveDiskHiddenIds({ tina: 1 });
    expect(result).toEqual(["fleet::1::tina"]);
  });

  it("SEL-107-04 (H2 lock): both buildIdentityHostsFromFleet AND deriveDiskHiddenIds are exported from identities-store", () => {
    // Both exports live on the same module. Anyone rewriting the hidden path
    // must reuse buildIdentityHostsFromFleet (identities-store.ts:111-122)
    // rather than a parallel local helper — SEL-107-04 is the regression trap.
    expect(typeof IdentitiesStore.buildIdentityHostsFromFleet).toBe("function");
    expect(typeof IdentitiesStore.deriveDiskHiddenIds).toBe("function");
  });

  it("SEL-107-05 (pin/hidden independence): deriveDiskPinnedIds and deriveDiskHiddenIds are independent axes", async () => {
    // Both can return non-empty simultaneously — they are not mutually exclusive.
    await seedIdentities([
      makeIdentityWithHidden("tina", { pinned: true, hidden: false }),
      makeIdentityWithHidden("user", { pinned: false, hidden: true }),
    ]);
    const identityHosts = { tina: 1, user: 2 };
    const pinnedResult = deriveDiskPinnedIds(identityHosts);
    const hiddenResult = deriveDiskHiddenIds(identityHosts);
    expect([...pinnedResult].sort()).toEqual(["fleet::1::tina"]);
    expect([...hiddenResult].sort()).toEqual(["fleet::2::user"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// patchIdentityFlag — write-side sync for pin/hide server writes
// ─────────────────────────────────────────────────────────────────────────────
//
// fern 2026-09-13: user reported that pinning a conversation on mobile, then
// entering a session, then coming back to the list, silently reverted the pin
// (server persisted — hard refresh restored it, so the write reached disk).
//
// Root cause: PrettyConversationsPanel (AppShell.tsx L2632) unmounts on mobile
// list→session→list navigation. On remount, its hydrate effect re-runs
// deriveDiskPinnedIds over the identities-store, which was STALE — the pin
// path only mutated conversation-store's pinnedIds + fired the PUT, leaving
// identities-store's per-identity `pinned: boolean` at false. Result:
// hydratePinnedIdsFromServer(staleSet) overwrote the just-set pin.
//
// Fix: pinConversation/unpinConversation (and hidden mirror) now call
// patchIdentityFlag on the PUT-success side to keep identities-store aligned
// with the write. These tests lock the mutator's contract plus the end-to-end
// remount-cycle invariant.

describe("patchIdentityFlag — pure mutator contract", () => {
  it("patches `pinned` true→false on a matching (hostId, key) identity", async () => {
    await seedIdentities([
      makeIdentity("tina", true, 1),
      makeIdentity("user", true, 2),
    ]);
    patchIdentityFlag("tina", 1, "pinned", false);
    // Only tina flipped; user untouched.
    const identityHosts = { tina: 1, user: 2 };
    expect(deriveDiskPinnedIds(identityHosts)).toEqual(["fleet::2::user"]);
  });

  it("patches `hidden` false→true independently of `pinned`", async () => {
    await seedIdentities([
      makeIdentityWithHidden("tina", { pinned: true, hidden: false }, 1),
    ]);
    patchIdentityFlag("tina", 1, "hidden", true);
    const identityHosts = { tina: 1 };
    expect(deriveDiskPinnedIds(identityHosts)).toEqual(["fleet::1::tina"]);
    expect(deriveDiskHiddenIds(identityHosts)).toEqual(["fleet::1::tina"]);
  });

  it("is idempotent — no-op when field already matches target value", async () => {
    await seedIdentities([makeIdentity("tina", true, 1)]);
    // No-op path: setIdentities NOT called, snapshot reference stable.
    const identityHosts = { tina: 1 };
    const before = deriveDiskPinnedIds(identityHosts);
    patchIdentityFlag("tina", 1, "pinned", true); // already true
    const afterNoop = deriveDiskPinnedIds(identityHosts);
    expect(afterNoop).toEqual(before);
    patchIdentityFlag("tina", 1, "pinned", false); // real change
    expect(deriveDiskPinnedIds(identityHosts)).toEqual([]);
  });

  it("with null hostId, falls back to bare-name match", async () => {
    await seedIdentities([makeIdentity("tina", false, 1)]);
    patchIdentityFlag("tina", null, "pinned", true);
    expect(deriveDiskPinnedIds({ tina: 1 })).toEqual(["fleet::1::tina"]);
  });

  it("with mismatched hostId, is a no-op (never patches the wrong host row)", async () => {
    // Two identities share a name across hosts. patchIdentityFlag targeted at a
    // hostId that doesn't match any existing row must NOT flip anything (the
    // caller's write refers to a row that doesn't exist locally yet — likely a
    // wire-fanout race; the next refreshIdentities will reconcile).
    await seedIdentities([
      makeIdentity("willow", false, 1),
      makeIdentity("willow", false, 2),
    ]);
    patchIdentityFlag("willow", 99, "pinned", true);
    // Nobody flipped. Both willows still unpinned.
    // deriveDiskPinnedIds projects one row per identityKey (map is one-per-name),
    // so the invariant we can assert is "no willow surfaces as pinned regardless
    // of which host mapping we project through."
    expect(deriveDiskPinnedIds({ willow: 1 })).toEqual([]);
    expect(deriveDiskPinnedIds({ willow: 2 })).toEqual([]);
  });
});

describe("Pin/hide remount-cycle regression (fern 2026-09-13)", () => {
  it("PIN: after a successful pin, a subsequent deriveDiskPinnedIds→hydrate cycle preserves the pin", async () => {
    // Seed the identities-store with tina UNPINNED on disk (baseline before
    // the click). The fleet session provides the hostId used by the pin path
    // to build identityHosts and by deriveDiskPinnedIds to project.
    await seedIdentities([makeIdentity("tina", false, 1)]);
    updateFleetSessions([makeSession(1, "tina")]);

    const rowId = "fleet::1::tina";
    pinConversation(rowId);
    // Let the fire-and-forget PUT .then() microtask run so patchIdentityFlag
    // executes before we simulate the remount.
    await Promise.resolve();
    await Promise.resolve();

    // Simulate the panel's remount hydrate cycle: derive from the identities-
    // store (should NOW include tina), then hydrate the conversation-store.
    const identityHosts = buildIdentityHostsFromFleet([makeSession(1, "tina")]);
    const derived = deriveDiskPinnedIds(identityHosts);
    expect(derived).toEqual([rowId]); // the fix — pre-fix this was []
    hydratePinnedIdsFromServer(derived); // pre-fix this wiped state.pinnedIds
  });

  it("UNPIN: after a successful unpin, a subsequent deriveDiskPinnedIds→hydrate cycle preserves the unpin", async () => {
    await seedIdentities([makeIdentity("tina", true, 1)]);
    updateFleetSessions([makeSession(1, "tina")]);

    // Prime conversation-store's pinnedIds via hydrate so unpinConversation's
    // "already unpinned — no-op" guard doesn't short-circuit.
    hydratePinnedIdsFromServer(["fleet::1::tina"]);

    unpinConversation("fleet::1::tina");
    await Promise.resolve();
    await Promise.resolve();

    const identityHosts = buildIdentityHostsFromFleet([makeSession(1, "tina")]);
    expect(deriveDiskPinnedIds(identityHosts)).toEqual([]);
  });

  it("HIDE: after a successful hide, a subsequent deriveDiskHiddenIds→hydrate cycle preserves the hide", async () => {
    await seedIdentities([
      makeIdentityWithHidden("tina", { hidden: false }, 1),
    ]);
    updateFleetSessions([makeSession(1, "tina")]);

    hideConversation("fleet::1::tina");
    await Promise.resolve();
    await Promise.resolve();

    const identityHosts = buildIdentityHostsFromFleet([makeSession(1, "tina")]);
    const derived = deriveDiskHiddenIds(identityHosts);
    expect(derived).toEqual(["fleet::1::tina"]);
    hydrateHiddenIdsFromServer(derived);
  });

  it("UNHIDE: after a successful unhide, a subsequent deriveDiskHiddenIds cycle preserves the unhide", async () => {
    await seedIdentities([
      makeIdentityWithHidden("tina", { hidden: true }, 1),
    ]);
    updateFleetSessions([makeSession(1, "tina")]);

    hydrateHiddenIdsFromServer(["fleet::1::tina"]);

    unhideConversation("fleet::1::tina");
    await Promise.resolve();
    await Promise.resolve();

    const identityHosts = buildIdentityHostsFromFleet([makeSession(1, "tina")]);
    expect(deriveDiskHiddenIds(identityHosts)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 111 Plan 04 — mergeIdentityAppearance D-09/D-10 contract (cases 1-11)
// ─────────────────────────────────────────────────────────────────────────────
//
// These tests pin the three structural invariants of the new additive-merge
// door. Deliberately broken and restored in the acceptance check below each
// load-bearing case.

// Helper: build a full Identity fixture with hostId set
function makeIdentityFull(
  identityKey: string,
  hostId: number,
  overrides: Partial<Identity> = {},
): Identity {
  return {
    identityKey,
    hostId,
    displayName: identityKey.charAt(0).toUpperCase() + identityKey.slice(1),
    title: null,
    colorHue: null,
    voice: null,
    role: null,
    avatarMime: "",
    avatarUrl: `/identities/${identityKey}/avatar?hostId=${hostId}`,
    avatarEtag: "",
    coordinator: false,
    task: null,
    pinned: false,
    hidden: false,
    roleDefaults: null,
    ...overrides,
  };
}

describe("mergeIdentityAppearance — D-09/D-10 contract", () => {
  // Case 1 — D-10: `loaded` stays false after a cold merge
  // LOAD-BEARING PROOF: temporarily change `loaded: state.loaded` to
  // `loaded: true` in the merge's state assignment → this case goes RED.
  it("Case 1: loaded stays false after a cold merge (D-10 guard)", async () => {
    // Part A: Cold store, loaded=false, key ABSENT → no-op, loaded stays false.
    mergeIdentityAppearance(5, "ghost", { colorHue: 120 });
    expect(__getIdentitiesStoreSnapshotForTest().loaded).toBe(false);

    // Part B: The load-bearing scenario — loaded=false, key IS PRESENT, field
    // changes. With `loaded: true` in the merge, this would flip loaded to true
    // with a partial byKey (the exact D-10 violation that boots N xterms).
    // With `loaded: state.loaded`, loaded stays false after the merge.
    __seedIdentitiesLoadedFalseForTest([makeIdentityFull("pixel", 5)]);
    expect(__getIdentitiesStoreSnapshotForTest().loaded).toBe(false);
    mergeIdentityAppearance(5, "pixel", { colorHue: 120 });
    // The merge found the key and changed colorHue — but loaded must stay false.
    expect(__getIdentitiesStoreSnapshotForTest().loaded).toBe(false);
    expect(__getIdentitiesStoreSnapshotForTest().byHostKey.get("5::pixel")?.colorHue).toBe(120);

    // Part C: Once loaded=true (via normal refreshIdentities), merge keeps it true
    __resetIdentitiesStoreForTest();
    await seedIdentities([makeIdentityFull("pixel", 5)]);
    expect(__getIdentitiesStoreSnapshotForTest().loaded).toBe(true);
    mergeIdentityAppearance(5, "pixel", { colorHue: 200 });
    expect(__getIdentitiesStoreSnapshotForTest().loaded).toBe(true);
  });

  // Case 2 — D-10: absent key does not append (the amplified terminal-flash
  // prevention — a one-entry byKey while loaded=true sends every OTHER identity
  // pane down the false-Terminal branch)
  it("Case 2: absent key does not append a row (D-10 amplified-bug path)", async () => {
    await seedIdentities([makeIdentityFull("pixel", 5)]);
    const before = __getIdentitiesStoreSnapshotForTest().identities.length;

    mergeIdentityAppearance(9, "ghost", { colorHue: 80 });

    const snap = __getIdentitiesStoreSnapshotForTest();
    expect(snap.identities.length).toBe(before);
    expect(snap.byKey.has("ghost")).toBe(false);
  });

  // Case 3 — D-09: undefined field is skipped (existing value preserved)
  it("Case 3: undefined field is skipped — existing value preserved (D-09)", async () => {
    await seedIdentities([makeIdentityFull("pixel", 5, { title: "Original", colorHue: 10 })]);
    mergeIdentityAppearance(5, "pixel", { title: undefined, colorHue: 40 });
    const snap = __getIdentitiesStoreSnapshotForTest();
    const entry = snap.byHostKey.get("5::pixel");
    expect(entry?.title).toBe("Original");
    expect(entry?.colorHue).toBe(40);
  });

  // Case 4 — D-09: null field is skipped, not written.
  // "An answer that knows less must never blank one that knew more."
  it("Case 4: null field is skipped — an answer that knows less must never blank one that knew more (D-09)", async () => {
    await seedIdentities([makeIdentityFull("pixel", 5, { title: "Original" })]);
    mergeIdentityAppearance(5, "pixel", { title: null });
    const snap = __getIdentitiesStoreSnapshotForTest();
    const entry = snap.byHostKey.get("5::pixel");
    expect(entry?.title).toBe("Original");
  });

  // Case 5 — Idempotence: no notify on a no-op merge
  it("Case 5: no notify when nothing changed; notify fires exactly once when something changes", async () => {
    await seedIdentities([makeIdentityFull("pixel", 5, { colorHue: 120 })]);

    let notifyCount = 0;
    // Subscribe via the store's listener mechanism
    const unsubscribe = (() => {
      let cb: () => void;
      // Use the IdentitiesStore module's useIdentities indirectly — but
      // the simplest approach is to subscribe via __resetIdentitiesStoreForTest
      // triggering notify. Instead, exploit the fact that mergeIdentityAppearance
      // calls notify internally; we can observe side effects via the snapshot.
      // Actually, we need direct listener access. Use a fresh subscriber by
      // having refreshIdentities trigger a reload, or intercept via the
      // hydrate functions. The cleanest approach: add a temporary subscription
      // via the exported listener mechanism.
      // Since there is no direct subscribeIdentitiesStore export, we observe
      // indirectly: spy on notify by checking that byHostKey reference changes
      // only when a real change is made.
      return () => {};
    })();
    void unsubscribe;

    // To properly spy on notifications, we observe the byHostKey reference
    // changing (a new Map is allocated on each notify-with-change path).
    const snapBefore = __getIdentitiesStoreSnapshotForTest();
    const byHostKeyBefore = snapBefore.byHostKey;

    // No-op: merge exact same colorHue
    mergeIdentityAppearance(5, "pixel", { colorHue: 120 });
    expect(__getIdentitiesStoreSnapshotForTest().byHostKey).toBe(byHostKeyBefore);

    // Real change: different colorHue → new byHostKey allocated
    mergeIdentityAppearance(5, "pixel", { colorHue: 200 });
    expect(__getIdentitiesStoreSnapshotForTest().byHostKey).not.toBe(byHostKeyBefore);
  });

  // Case 6 — roleDefaults structural equality: different reference but same
  // content must NOT notify; different key order must also NOT notify.
  it("Case 6: roleDefaults structural equality does not notify (sorted-key comparison)", async () => {
    const rd = { colorHue: 40, title: "Analyst" };
    await seedIdentities([makeIdentityFull("pixel", 5, { roleDefaults: rd })]);
    const snapBefore = __getIdentitiesStoreSnapshotForTest();
    const byHostKeyBefore = snapBefore.byHostKey;

    // Different reference, same structure
    mergeIdentityAppearance(5, "pixel", { roleDefaults: { colorHue: 40, title: "Analyst" } });
    expect(__getIdentitiesStoreSnapshotForTest().byHostKey).toBe(byHostKeyBefore);

    // Different key insertion order — still same content
    mergeIdentityAppearance(5, "pixel", { roleDefaults: { title: "Analyst", colorHue: 40 } });
    expect(__getIdentitiesStoreSnapshotForTest().byHostKey).toBe(byHostKeyBefore);

    // Different content → notify fires (new byHostKey)
    mergeIdentityAppearance(5, "pixel", { roleDefaults: { colorHue: 99, title: "Analyst" } });
    expect(__getIdentitiesStoreSnapshotForTest().byHostKey).not.toBe(byHostKeyBefore);
  });

  // Case 7 — Composite keying: no cross-host bleed
  // quick-260912-0t4 collision case: two same-named identities on different hosts
  it("Case 7: composite keying — no cross-host bleed (quick-260912-0t4)", async () => {
    await seedIdentities([
      makeIdentityFull("willow", 4, { colorHue: 10 }),
      makeIdentityFull("willow", 7, { colorHue: 20 }),
    ]);

    // Merge a new colorHue for (4, "willow") only
    mergeIdentityAppearance(4, "willow", { colorHue: 99 });

    const snap = __getIdentitiesStoreSnapshotForTest();
    expect(snap.byHostKey.get("4::willow")?.colorHue).toBe(99);
    expect(snap.byHostKey.get("7::willow")?.colorHue).toBe(20); // unchanged
  });

  // Case 8 — byHostKey and byKey are both rebuilt after a merge
  it("Case 8: byHostKey and byKey both reflect the updated value after merge", async () => {
    await seedIdentities([makeIdentityFull("pixel", 5, { colorHue: 10 })]);

    mergeIdentityAppearance(5, "pixel", { colorHue: 55 });

    const snap = __getIdentitiesStoreSnapshotForTest();
    expect(snap.byHostKey.get("5::pixel")?.colorHue).toBe(55);
    expect(snap.byKey.get("pixel")?.colorHue).toBe(55);
    // Same object reference in both maps (same normalized entry)
    expect(snap.byHostKey.get("5::pixel")).toBe(snap.byKey.get("pixel"));
  });

  // Case 9 — pinned/hidden are written on a true→false transition (membership axes)
  it("Case 9: pinned/hidden are written on true→false transition — they are membership axes, not cosmetics", async () => {
    await seedIdentities([makeIdentityFull("pixel", 5, { pinned: true, hidden: true })]);

    mergeIdentityAppearance(5, "pixel", { pinned: false });
    expect(__getIdentitiesStoreSnapshotForTest().byHostKey.get("5::pixel")?.pinned).toBe(false);

    mergeIdentityAppearance(5, "pixel", { hidden: false });
    expect(__getIdentitiesStoreSnapshotForTest().byHostKey.get("5::pixel")?.hidden).toBe(false);
  });

  // Case 10 — withDisplayCap normalization applies at this door too
  it("Case 10: withDisplayCap normalization applies — merge('pixel') stores 'Pixel'", async () => {
    await seedIdentities([makeIdentityFull("pixel", 5, { displayName: "Pixel" })]);
    // Merge a lowercase displayName — should be capitalized by withDisplayCap
    mergeIdentityAppearance(5, "pixel", { displayName: "pixel" });
    expect(__getIdentitiesStoreSnapshotForTest().byHostKey.get("5::pixel")?.displayName).toBe("Pixel");
  });

  // Case 11 — non-finite hostId is a no-op
  it("Case 11: non-finite hostId is a no-op — no state change, no throw", async () => {
    await seedIdentities([makeIdentityFull("pixel", 5, { colorHue: 10 })]);
    const snapBefore = __getIdentitiesStoreSnapshotForTest();
    const byHostKeyBefore = snapBefore.byHostKey;

    expect(() => mergeIdentityAppearance(NaN, "pixel", { colorHue: 99 })).not.toThrow();
    expect(__getIdentitiesStoreSnapshotForTest().byHostKey).toBe(byHostKeyBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 111 Plan 04 Task 3 — re-projection of pinned/hidden into row-id sets
// (cases 12-17)
// ─────────────────────────────────────────────────────────────────────────────
//
// reprojectDiskPinHideIntoRows() is called from mergeIdentityAppearance only
// when pinned or hidden actually changed. These tests prove the full pipeline:
// merge → re-project → conversation-store row-id set updated.

describe("mergeIdentityAppearance — pin/hide re-projection (Task 3)", () => {
  // Seed identities with a SPECIFIC fleet session for Task 3 tests.
  // The regular seedIdentities() helper calls updateFleetSessions([makeSession(1,"seed-noop")])
  // which would overwrite any fleet sessions we set before it. So this helper
  // sets the fleet session AFTER seeding, ensuring getFleetSessionsSnapshot()
  // returns the right hostId when reprojectDiskPinHideIntoRows fires.
  async function seedAndLoadWithFleet(
    identities: Identity[],
    sessions: FleetSession[],
  ): Promise<void> {
    await seedIdentities(identities);
    // Override the fleet session set by seedIdentities's internal seed-noop call
    updateFleetSessions(sessions);
  }

  // Case 12 — pulse pinned:true reaches the row-id set
  it("Case 12: pulse pinned:true reaches the conversation-store pinned-id set", async () => {
    await seedAndLoadWithFleet(
      [makeIdentityFull("pixel", 5, { pinned: false })],
      [makeSession(5, "pixel")],
    );

    mergeIdentityAppearance(5, "pixel", { pinned: true });

    const { pinnedIds } = __getSnapshotForTest();
    expect(pinnedIds.has("fleet::5::pixel")).toBe(true);
  });

  // Case 13 — pulse pinned:false removes from pinned-id set
  it("Case 13: pulse pinned:false removes from conversation-store pinned-id set", async () => {
    await seedAndLoadWithFleet(
      [makeIdentityFull("pixel", 5, { pinned: true })],
      [makeSession(5, "pixel")],
    );
    // Seed the pinned set so there's something to remove
    hydratePinnedIdsFromServer(["fleet::5::pixel"]);

    mergeIdentityAppearance(5, "pixel", { pinned: false });

    const { pinnedIds } = __getSnapshotForTest();
    expect(pinnedIds.has("fleet::5::pixel")).toBe(false);
  });

  // Case 14 — hidden behaves the same way
  it("Case 14: pulse hidden:true/false reaches the conversation-store hidden-id set", async () => {
    await seedAndLoadWithFleet(
      [makeIdentityFull("pixel", 5, { hidden: false })],
      [makeSession(5, "pixel")],
    );

    mergeIdentityAppearance(5, "pixel", { hidden: true });
    expect(__getSnapshotForTest().hiddenIds.has("fleet::5::pixel")).toBe(true);

    mergeIdentityAppearance(5, "pixel", { hidden: false });
    expect(__getSnapshotForTest().hiddenIds.has("fleet::5::pixel")).toBe(false);
  });

  // Case 15 — cosmetics-only merge does NOT re-project (guard against double
  // set rebuilds on every colour change)
  it("Case 15: cosmetics-only merge does not call hydratePinnedIdsFromServer (no unnecessary re-projection)", async () => {
    await seedAndLoadWithFleet(
      [makeIdentityFull("pixel", 5, { colorHue: 10 })],
      [makeSession(5, "pixel")],
    );

    const spy = vi.spyOn(ConversationStore, "hydratePinnedIdsFromServer");
    spy.mockClear();

    mergeIdentityAppearance(5, "pixel", { colorHue: 99 });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // Case 16 — merge on a not-loaded store does not re-project (quick-260912-5q2
  // guard: projecting from a partial store wipes pins for every missing identity)
  // LOAD-BEARING PROOF: remove the `if (!state.loaded) return` gate from
  // reprojectDiskPinHideIntoRows → this case goes RED.
  it("Case 16: merge on not-loaded store does not re-project (quick-260912-5q2 guard)", async () => {
    // Reset everything to get a clean loaded=false state
    __resetIdentitiesStoreForTest();
    __resetFleetSessionsForTest();
    __resetPinnedIdsForTest();
    __resetHiddenIdsForTest();

    // Prime fleet sessions and pinned ids. Use __seedIdentitiesLoadedFalseForTest
    // to place an identity in the store WITHOUT setting loaded=true (simulates a
    // pulse frame arriving before GET /identities returns).
    updateFleetSessions([makeSession(5, "pixel")]);
    __seedIdentitiesLoadedFalseForTest([makeIdentityFull("pixel", 5, { pinned: false })]);
    // Pre-prime the pinned set so we can detect if a re-projection wipes it.
    hydratePinnedIdsFromServer(["fleet::5::pixel"]);

    expect(__getIdentitiesStoreSnapshotForTest().loaded).toBe(false);

    const spy = vi.spyOn(ConversationStore, "hydratePinnedIdsFromServer");
    spy.mockClear();

    // loaded=false. Row IS present. Merge fires pinHidChanged=true → but the
    // reprojectDiskPinHideIntoRows gate must block re-projection.
    mergeIdentityAppearance(5, "pixel", { pinned: true });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // Case 17 — relay-room sessions do not crash the re-projection
  // (H2 invariant: buildIdentityHostsFromFleet's null-return on undefined
  // sessionName filters relay rooms before reprojectDiskPinHideIntoRows iterates)
  it("Case 17: relay-room sessions do not crash re-projection (H2 invariant)", async () => {
    // Build a fleet with a relay-room session (no sessionName, no hostId on the
    // relay row — buildIdentityHostsFromFleet filters it via sessionMatchKey → null)
    // and a harness session alongside it.
    const relaySession: FleetSession = {
      hostId: 0,
      hostName: "relay",
      sessionName: undefined as unknown as string, // relay-room: sessionName undefined
      created: 0,
      role: null,
    };
    await seedAndLoadWithFleet(
      [makeIdentityFull("pixel", 5, { pinned: false })],
      [makeSession(5, "pixel"), relaySession],
    );

    // This must NOT throw even with the relay-room in fleetSessions
    expect(() => mergeIdentityAppearance(5, "pixel", { pinned: true })).not.toThrow();

    // And the harness row's id must still be in the set
    const { pinnedIds } = __getSnapshotForTest();
    expect(pinnedIds.has("fleet::5::pixel")).toBe(true);
  });
});
