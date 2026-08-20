import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Phase 15: mock the api-client the store now calls on pin/unpin. MUST come
// BEFORE the imports of the store so vitest's hoisted vi.mock intercepts the
// module-graph edge. The store's `import { putPinnedIds } from "@/api/user-
// preferences-api"` resolves to this factory during test runs.
vi.mock("@/api/user-preferences-api", () => ({
  getPinnedIds: vi.fn().mockResolvedValue([]),
  putPinnedIds: vi.fn().mockResolvedValue([]),
}));

import {
  updateHostTree,
  updateOpenTabs,
  updateFleetSessions,
  removeFleetSession,
  updateHostsFlat,
  updateIdentitiesByKey,
  selectConversation,
  selectConversationDeferred,
  pinConversation,
  unpinConversation,
  togglePinConversation,
  hydratePinnedIdsFromServer,
  addToActiveSet,
  removeFromActiveSet,
  fleetRowId,
  useConversations,
  useSelectedConversationId,
  usePinnedIds,
  useActiveSet,
  useFleetSessionsLoaded,
  __subscribeForTest,
  __getSnapshotForTest,
  __getPendingSelectIdForTest,
  __getFleetOnlyRowsForTest,
  __resetActiveSetForTest,
  __resetPinnedIdsForTest,
  __resetFleetSessionsForTest,
  // Phase 41 Plan 01: test-only injection API for row.lastMessageAt.
  __setLastMessageAtForTest,
  __resetLastMessageAtForTest,
  // Phase 44 Plan 04: cache round-trip tests exercise the public readers.
  readFleetSessionsCache,
  writeFleetSessionsCache,
  type FleetSession,
} from "./conversation-store.js";
import * as UserPreferencesApi from "@/api/user-preferences-api";
import type { Tab, Host, HostFolder } from "@/types/ui-types";
import type { Identity } from "@/api/identities-api";

// ─── Test fixtures ────────────────────────────────────────────────────────────
// Minimal Host stubs — only the fields the store reads (id, name). All other
// fields are `as never` since the store must NOT reach for them; if it does
// we get a runtime crash and the test surfaces the leak.

function makeHost(
  id: string,
  name: string,
  overrides?: Partial<Host>,
): Host {
  return { id, name, ...(overrides ?? {}) } as unknown as Host;
}

function makeTab(
  id: string,
  type: Tab["type"],
  host?: Host,
  targetTmuxSession: string | null = null,
  label?: string,
): Tab {
  return {
    id,
    instanceId: id,
    type,
    label: label ?? `${type}:${host?.name ?? id}`,
    host,
    openedAt: 0,
    targetTmuxSession,
  };
}

// Phase 25 (Plan 25-03): minimal Identity stub for role injection in sort tests.
// Only `identityKey` and `role` are read by conversation-store (via sessionMatchKey
// lookup in state.identitiesByKey); all other fields are dummy stubs.
function makeIdentity(
  identityKey: string,
  role: string | null,
  overrides?: Partial<Identity>,
): Identity {
  return {
    id: identityKey,
    identityKey,
    displayName: identityKey,
    title: null,
    colorHue: null,
    voice: null,
    role,
    avatarMime: "",
    avatarUrl: "",
    avatarEtag: "",
    createdAt: "",
    updatedAt: "",
    ...(overrides ?? {}),
  } as unknown as Identity;
}

// Phase 25 (Plan 25-03): build a Map<string, Identity> keyed by
// identityKey.toLowerCase() — matches the sessionMatchKey convention used in
// identities-store.ts:21 and conversation-store rowFromTab().
function identitiesMap(...identities: Identity[]): Map<string, Identity> {
  return new Map(identities.map((id) => [id.identityKey.toLowerCase(), id]));
}

// Reset all module-scoped state between tests. Ordering matters: clear tabs
// FIRST so pin-pruning + selection-coercion fire on a valid transition, then
// null out selection explicitly (idempotent) which ALSO clears any leftover
// pendingSelectId from a prior test (per Plan 06-04 Task 1: selectConversation
// clears pending), then drop the host tree.
beforeEach(() => {
  // Patch #137: clear sessionStorage FIRST so the module-level activeSet
  // (already hydrated at module-init time) can be reset from an empty
  // persistence layer. JSDOM provides sessionStorage; no mocking needed.
  // Then explicitly reset the module-scoped activeSet via
  // __resetActiveSetForTest so a prior test's addToActiveSet /
  // removeFromActiveSet writes don't leak forward. quick-260727-gm3
  // introduced removeFromActiveSet as the pure reverse of addToActiveSet
  // — the set now grows AND shrinks within a session, but still dies on
  // tab close (sessionStorage semantics unchanged).
  sessionStorage.clear();
  __resetActiveSetForTest();
  // Phase 15: reset the pinnedIds slice so a prior test's pinConversation
  // writes don't leak forward, AND clear the mocked putPinnedIds spy so
  // per-test toHaveBeenCalledTimes assertions start from zero.
  __resetPinnedIdsForTest();
  vi.mocked(UserPreferencesApi.putPinnedIds).mockClear();
  vi.mocked(UserPreferencesApi.getPinnedIds).mockClear();
  updateOpenTabs([]);
  selectConversation(null);
  updateHostTree(null);
  // Plan 07-01: reset the new fleet + hostsFlat inputs so each test starts
  // from a known-empty fleet-derived-rows state. Ordering is not load-bearing
  // (fleetSessions + hostsFlat are pure inputs — they don't feed selection
  // coercion the way openTabs does), but reset AFTER openTabs so a
  // hypothetical listener never sees a mid-clear state.
  updateFleetSessions([]);
  updateHostsFlat(new Map());
  // Phase 25: reset identitiesByKey so a prior test's role injection does not
  // leak forward into the next test's sort output.
  updateIdentitiesByKey(new Map());
  // Phase 41 Plan 01: reset the test-only lastMessageAt injection map so a
  // prior test's stamps don't leak into the next test's middle-zone sort.
  __resetLastMessageAtForTest();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: empty state
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: empty state", () => {
  it("returns empty pinned + middle + null rdpGroup and null selection when no tabs or tree", () => {
    const { result: convs } = renderHook(() => useConversations());
    const { result: sel } = renderHook(() => useSelectedConversationId());
    expect(convs.current.pinned).toEqual([]);
    // Phase 41 Plan 01: `grouped: HostGroup[]` replaced with `middle:
    // ConversationRow[]` + `rdpGroup: HostGroup | null`.
    expect(convs.current.middle).toEqual([]);
    expect(convs.current.rdpGroup).toBeNull();
    expect(sel.current).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 (Phase 41 Plan 01 REWRITE — middle-flip supersedes host-tree order):
// the pre-Phase-41 depth-first host-tree order lock on the middle is retired.
// The middle is now a FLAT array (no per-host bucketing), and — since Plan 03
// has not yet landed the recency signal — every row's lastMessageAt is null,
// so all rows sort by insertion-order key (openTabs iteration order first, then
// fleetSyntheticRows iteration order). The hostTree-order lock survives ONLY
// in the RDP synthesis pass (see Test 32 for the RDP-side hostTree assertion).
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (Phase 41 Plan 01): middle is flat + insertion-order fallback", () => {
  it("middle emits ALL non-pinned identity-tmux rows in openTabs iteration order (no host bucketing)", () => {
    const hostA1 = makeHost("hA1", "zeus"); // deliberately z-name — proves not alphabetical
    const hostA2 = makeHost("hA2", "apollo");
    const hostRoot1 = makeHost("hR1", "hermes");
    const tree: HostFolder = {
      name: "root",
      children: [
        {
          name: "folderA",
          children: [hostA1, hostA2],
        } as HostFolder,
        hostRoot1,
      ],
    };

    act(() => {
      updateHostTree(tree);
      updateOpenTabs([
        makeTab("t1", "terminal", hostA2), // opened first in insertion order
        makeTab("t2", "terminal", hostRoot1),
        makeTab("t3", "terminal", hostA1),  // terminal, not rdp (rdp would go to rdpGroup)
      ]);
    });

    const { result } = renderHook(() => useConversations());
    const middle = result.current.middle;
    // Phase 41 lock: middle is FLAT. No per-host bucketing. Since all
    // lastMessageAt values are null (Plan 03 not yet landed), rows sort by
    // insertion-order key — which is openTabs iteration order: [t1, t2, t3].
    // The pre-Phase-41 depth-first hostTree traversal that would have placed
    // t3 (hostA1) first is INTENTIONALLY GONE.
    expect(Array.isArray(middle)).toBe(true);
    expect(middle.map((r) => r.id)).toEqual(["t1", "t2", "t3"]);
    // Belt-and-suspenders: `middle` is NOT a HostGroup[] shape.
    // Every element carries the ConversationRow shape (has `id`), not the
    // HostGroup shape (which would have `hostId` + `rows`).
    for (const row of middle) {
      expect(typeof row.id).toBe("string");
      expect((row as unknown as { hostId?: unknown }).hostId).toBeUndefined();
      expect((row as unknown as { rows?: unknown }).rows).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: pin float above host groups; unpin restores host-tree position
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: pin float + unpin restore", () => {
  it("pinConversation floats row to `pinned`; unpin restores to original host-tree slot (NOT appended)", () => {
    const hostA = makeHost("hA", "alpha");
    const hostB = makeHost("hB", "bravo");
    const tree: HostFolder = { name: "root", children: [hostA, hostB] };

    act(() => {
      updateHostTree(tree);
      updateOpenTabs([
        makeTab("t1", "terminal", hostA),
        makeTab("t2", "terminal", hostB),
        makeTab("t3", "terminal", hostB),
      ]);
    });

    // Phase 41 Plan 01: middle is FLAT (no host bucketing). Snapshot pre-pin:
    // insertion order [t1, t2, t3] across the flat middle.
    let snap = __getSnapshotForTest();
    expect(snap.middle.map((r) => r.id)).toEqual(["t1", "t2", "t3"]);

    act(() => pinConversation("t2"));
    snap = __getSnapshotForTest();
    expect(snap.pinned.map((r) => r.id)).toEqual(["t2"]);
    // Middle no longer contains t2 — only [t1, t3]
    expect(snap.middle.map((r) => r.id)).toEqual(["t1", "t3"]);

    act(() => unpinConversation("t2"));
    snap = __getSnapshotForTest();
    expect(snap.pinned).toEqual([]);
    // t2 restored to the middle at its insertion-order slot (openTabs order:
    // [t1, t2, t3]; all lastMessageAt values null → insertion-order fallback).
    expect(snap.middle.map((r) => r.id)).toEqual(["t1", "t2", "t3"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: pin per-session, not per-host
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: pin per-session", () => {
  it("pinning t1 does NOT pin t3 even though both are on hostA1", () => {
    const hostA1 = makeHost("hA1", "alpha1");
    const tree: HostFolder = { name: "root", children: [hostA1] };

    act(() => {
      updateHostTree(tree);
      updateOpenTabs([
        makeTab("t1", "terminal", hostA1),
        makeTab("t3", "rdp", hostA1),
      ]);
      pinConversation("t1");
    });

    const snap = __getSnapshotForTest();
    expect(snap.pinned.map((r) => r.id)).toEqual(["t1"]);
    // Phase 41 Plan 01: t3 stays in the flat middle (rdp goes to rdpGroup;
    // this test uses a `"rdp"` tab type, but tabs of type "rdp" that aren't
    // synthesized RDP rows still land in middle — RDP zone is derived from
    // hostsFlat + enableRdp, not from tab.type). Since t3 is `type: "rdp"`
    // with a host but no enableRdp flag on the host, it goes to middle.
    expect(snap.middle.map((r) => r.id)).toEqual(["t3"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: session-end vanishes row + coerces selection (pins are sticky)
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: session-end lifecycle (pins are sticky)", () => {
  it("removing a tab from openTabs coerces stale selection to null but leaves the pin id in state.pinnedIds", () => {
    const hostA = makeHost("hA", "alpha");
    const tabT1 = makeTab("t1", "terminal", hostA);
    const tabT2 = makeTab("t2", "terminal", hostA);

    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([tabT1, tabT2]);
      pinConversation("t2");
      selectConversation("t2");
    });

    // Sanity: t2 is pinned + selected
    let snap = __getSnapshotForTest();
    expect(snap.pinnedIds.has("t2")).toBe(true);
    expect(snap.selectedId).toBe("t2");

    // Simulate session-end: openTabs no longer contains t2
    act(() => updateOpenTabs([tabT1]));

    snap = __getSnapshotForTest();
    // T-06-01-01 defense: stale selection coerced to null
    expect(snap.selectedId).toBeNull();
    // Pin id SURVIVES (retire-pruner quick-260818-l8n) — no matching row
    // source, so nothing renders in the pinned tier, but the id stays in
    // state.pinnedIds for when the session returns.
    expect(snap.pinnedIds.has("t2")).toBe(true);
    expect(snap.pinned.map((r) => r.id)).toEqual([]);
    // Phase 41 Plan 01: row is gone from the flat middle.
    expect(snap.middle.map((r) => r.id)).toEqual(["t1"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 5b/5c (retire-pruner quick-260818-l8n): pins are sticky across
// updateOpenTabs. Ashley: "Pins are pins. Doesn't matter if they are open or
// anything else." Pre-retire, updateOpenTabs scrubbed any pinnedId not in
// nextIds ∪ a fleet-derived keep-set — which on WS reconnect (updateOpenTabs
// fires with a partial/empty tabs list before every managed host re-reports)
// nuked legitimate pins. Ashley's next pin/unpin then wrote the pruned Set to
// the server via putPinnedIds, making the loss durable. Post-retire, update
// OpenTabs never touches pinnedIds — the render-side skip in computeSnapshot
// Tier 2 handles orphan pin ids gracefully. Regression guard pair:
// (5b) fleet pins survive an openTabs mutation; (5c) openTab pins ALSO
// survive an openTabs mutation that drops their tab.
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: pins are sticky across updateOpenTabs (quick-260818-l8n)", () => {
  it("clicking a pinned fleet row does NOT unpin OTHER pinned fleet rows", () => {
    // Two-host layout with 4 fleet-only sessions (all synthetic fleet::N::S ids).
    const hostA = makeHost("1", "hostA");
    const hostB = makeHost("2", "hostB");
    const tree: HostFolder = { name: "root", children: [hostA, hostB] };

    act(() => {
      updateHostTree(tree);
      updateHostsFlat(
        new Map<number, Host>([
          [1, hostA],
          [2, hostB],
        ]),
      );
      updateFleetSessions([
        { hostId: 1, hostName: "hostA", sessionName: "work", created: 100 },
        { hostId: 1, hostName: "hostA", sessionName: "scratch", created: 200 },
        { hostId: 2, hostName: "hostB", sessionName: "srv", created: 300 },
        { hostId: 2, hostName: "hostB", sessionName: "dev", created: 400 },
      ]);
      pinConversation("fleet::1::work");
      pinConversation("fleet::1::scratch");
      pinConversation("fleet::2::srv");
      pinConversation("fleet::2::dev");
    });

    // Sanity: all four fleet ids present in pinnedIds
    let snap = __getSnapshotForTest();
    expect(snap.pinnedIds.size).toBe(4);
    expect(snap.pinnedIds.has("fleet::1::work")).toBe(true);
    expect(snap.pinnedIds.has("fleet::1::scratch")).toBe(true);
    expect(snap.pinnedIds.has("fleet::2::srv")).toBe(true);
    expect(snap.pinnedIds.has("fleet::2::dev")).toBe(true);

    // Exercise: openTab appears (activating an unrelated conversation).
    // The new openTab does NOT reference any of the fleet ids above.
    act(() => updateOpenTabs([makeTab("t1", "terminal", hostA)]));

    // Pre-retire-pruner (quick-260818-l8n) — the pruner would have kept
    // these via a fleet-aware keep-set built from state.fleetSessions;
    // post-retire the pruner is gone, so this passes for free. Any
    // regression that re-introduces openTabs → pinnedIds scrubbing (in
    // any form — openTab-only keep-set, fleet-aware keep-set, whatever)
    // trips this assertion on the deploy-race scenario Ashley hit.
    snap = __getSnapshotForTest();
    expect(snap.pinnedIds.size).toBe(4);
    expect(snap.pinnedIds.has("fleet::1::work")).toBe(true);
    expect(snap.pinnedIds.has("fleet::1::scratch")).toBe(true);
    expect(snap.pinnedIds.has("fleet::2::srv")).toBe(true);
    expect(snap.pinnedIds.has("fleet::2::dev")).toBe(true);
  });

  it("updateOpenTabs does NOT drop stale openTab pins when their tab leaves the tabs list (retire-pruner quick-260818-l8n)", () => {
    // fleetSessions is empty per beforeEach — this test locks the retire-
    // pruner invariant for pure openTab-format pins (no fleet component).
    // Ashley's deploy-race: on WS reconnect, updateOpenTabs fires with an
    // empty (or transiently partial) tabs list before setTabs re-emits the
    // real list; any pruner keyed on nextIds would nuke every openTab pin
    // in that window. Ashley's next pin/unpin write via putPinnedIds would
    // then persist the loss server-side. The retire-pruner guarantee: both
    // pin ids survive updateOpenTabs regardless of the passed tabs list.
    const hostA = makeHost("hA", "alpha");
    const tabT1 = makeTab("t1", "terminal", hostA);
    const tabT2 = makeTab("t2", "terminal", hostA);

    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([tabT1, tabT2]);
      pinConversation("t1");
      pinConversation("t2");
    });

    // Sanity: both openTab pins present
    let snap = __getSnapshotForTest();
    expect(snap.pinnedIds.has("t1")).toBe(true);
    expect(snap.pinnedIds.has("t2")).toBe(true);

    // Exercise: t1 vanishes from openTabs (session-end / WS-reconnect
    // simulation). The pin id must NOT be scrubbed from state.pinnedIds.
    act(() => updateOpenTabs([tabT2]));

    snap = __getSnapshotForTest();
    expect(snap.pinnedIds.has("t1")).toBe(true);
    expect(snap.pinnedIds.has("t2")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// quick-260818-l8n: orphan pinnedIds render gracefully. A pin id with no
// matching openTab and no matching fleetSession renders zero pinned tiles
// (computeSnapshot Tier 2 iterates both conversationTabs and
// fleetSyntheticRows; neither produces a matching row for the orphan id) —
// AND the id itself SURVIVES in state.pinnedIds so the pin re-materializes
// the instant its session (or a re-opened tab) reappears. This is the
// render-side counterpart to the retire-pruner change that makes the
// updateOpenTabs pruner unnecessary in the first place.
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: orphan pinnedIds render gracefully (retire-pruner quick-260818-l8n)", () => {
  it("a pin id with no matching openTab and no matching fleetSession survives in pinnedIds but renders zero pinned tiles", () => {
    // Post-retire-pruner, updateOpenTabs no longer scrubs orphan pin
    // ids. The render side (computeSnapshot Tier 2) skips them because
    // neither conversationTabs nor fleetSyntheticRows produce a matching
    // row. The id stays in state.pinnedIds so the pin re-materializes
    // the moment the session (or a re-opened tab) reappears.
    act(() => {
      updateHostTree(null);
      updateFleetSessions([]);
      updateOpenTabs([]);
      hydratePinnedIdsFromServer(["fleet::99::ghost"]);
    });
    const snap = __getSnapshotForTest();
    expect(snap.pinnedIds.has("fleet::99::ghost")).toBe(true);
    expect(snap.pinned).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: single-select coercion — stale id is a no-op
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: selectConversation stale-id guard", () => {
  it("selecting an id NOT in openTabs is a no-op (does not change selectedId)", () => {
    const hostA = makeHost("hA", "alpha");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([makeTab("t1", "terminal", hostA)]);
      selectConversation("t1");
    });
    expect(__getSnapshotForTest().selectedId).toBe("t1");

    act(() => selectConversation("t99"));
    // Selection unchanged — stale id ignored
    expect(__getSnapshotForTest().selectedId).toBe("t1");
  });

  it("selecting null explicitly is always allowed (clears selection)", () => {
    const hostA = makeHost("hA", "alpha");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([makeTab("t1", "terminal", hostA)]);
      selectConversation("t1");
      selectConversation(null);
    });
    expect(__getSnapshotForTest().selectedId).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7: identity carry-through — row surfaces targetTmuxSession verbatim
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: identity carry-through metadata", () => {
  it("row for a tmux-attached tab carries `targetTmuxSession` for downstream identity lookup", () => {
    const hostA = makeHost("hA", "alpha");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([makeTab("t1", "terminal", hostA, "tina-abc")]);
    });

    const snap = __getSnapshotForTest();
    // Phase 41 Plan 01: read from the flat middle.
    const row = snap.middle[0];
    expect(row.targetTmuxSession).toBe("tina-abc");
    // Store MUST NOT compute identity hue itself (purity: it's a selection layer)
    expect((row as unknown as Record<string, unknown>).identityHue).toBeUndefined();
    expect((row as unknown as Record<string, unknown>).identity).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8: row shape is minimal and exact
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: row shape is exactly the documented fields", () => {
  it("each row is { id, type, label, host, targetTmuxSession } — no extra derived fields", () => {
    const hostA = makeHost("hA", "alpha");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([makeTab("t1", "terminal", hostA, null, "my-session")]);
    });

    // Phase 41 Plan 01: read from the flat middle.
    const row = __getSnapshotForTest().middle[0];
    // Positive: expected fields
    expect(row.id).toBe("t1");
    expect(row.type).toBe("terminal");
    expect(row.label).toBe("my-session");
    expect(row.host).toBe(hostA);
    expect(row.targetTmuxSession).toBeNull();
    // Negative: exact key set — catches accidental field additions.
    // Plan 07-01: `fleetOnly` is an OPTIONAL Phase 7 marker (INTERNAL routing
    // signal for detached-row-click plumbing — never user-visible, never
    // present on openTabs-derived rows in the recommended implementation).
    // Plan 07-02: `rdpHostRow` is a THIRD OPTIONAL Phase 7 marker analog to
    // fleetOnly, marking a synthetic RDP-host row derived from state.hostsFlat
    // filtered on `enableRdp === true`. Same INTERNAL routing role — never
    // present on openTabs-derived rows.
    // Phase 41 Plan 01: `lastMessageAt` is a FOURTH OPTIONAL Phase 41 marker —
    // the recency signal for the middle-zone sort. Deliberately OMITTED until
    // Plan 03 lands the fleet-status protocol extension, so it does not appear
    // on rows constructed today. Filter all three before comparing so the
    // locked 5-key core-shape contract is preserved.
    const keysForShapeCheck = Object.keys(row).filter(
      (k) => k !== "fleetOnly" && k !== "rdpHostRow" && k !== "lastMessageAt",
    );
    expect(keysForShapeCheck.sort()).toEqual(
      ["host", "id", "label", "targetTmuxSession", "type"].sort(),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 9: dashboard tab excluded
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: dashboard tab excluded", () => {
  it("does not surface the dashboard singleton in the conversation list", () => {
    const hostA = makeHost("hA", "alpha");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([
        makeTab("dashboard", "dashboard"),
        makeTab("t1", "terminal", hostA),
      ]);
    });

    const snap = __getSnapshotForTest();
    // dashboard MUST NOT appear anywhere. Phase 41 Plan 01: walk the flat
    // middle instead of grouped[].
    const allIds = [
      ...snap.pinned.map((r) => r.id),
      ...snap.middle.map((r) => r.id),
    ];
    expect(allIds).not.toContain("dashboard");
    expect(allIds).toEqual(["t1"]);
  });
});

// Phase 14A retirement: Tests 10 + 11 removed. They asserted that the retired
// tab types "host-manager", "user-profile", "admin-settings", and "tunnel"
// were excluded from the conversation list. Those tab types no longer exist
// in the TabType union, so the exclusion is enforced by the type system
// rather than the store. The remaining CONVERSATION_TAB_TYPES set is
// covered by Tests 1-9 + 12+ (below).

// ─────────────────────────────────────────────────────────────────────────────
// Test 12: reactive updates — subscriber fires on real mutations, not on no-ops
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: reactive emit semantics", () => {
  it("subscribe callback fires exactly once per real state mutation and does NOT fire on no-op mutations", () => {
    const hostA = makeHost("hA", "alpha");
    const tree: HostFolder = { name: "root", children: [hostA] };
    const tab1 = makeTab("t1", "terminal", hostA);

    const cb = vi.fn();
    const unsubscribe = __subscribeForTest(cb);

    updateHostTree(tree);
    updateOpenTabs([tab1]);
    selectConversation("t1");
    pinConversation("t1");

    // 5 real mutations — patch #137 makes `selectConversation("t1")` on a
    // first-time-selected id fire TWICE (once for addToActiveSet's notify,
    // once for the selectedId change). updateHostTree + updateOpenTabs +
    // pinConversation each fire once → 3. Total: 3 + 2 = 5.
    expect(cb).toHaveBeenCalledTimes(5);

    // No-op mutations — same reference / same value / stale-id / already-in-set
    cb.mockClear();
    updateHostTree(tree); // same reference → no emit
    updateOpenTabs([tab1]); // same Tab reference in same order → no emit
    // Patch #137: id "t1" is now in activeSet AND already selected → both
    // guards short-circuit → no emit.
    selectConversation("t1");
    pinConversation("t1"); // already pinned → no emit
    // Stale-id guard runs BEFORE the addToActiveSet call → no activeSet
    // write → no emit.
    selectConversation("stale-id-not-in-tabs");
    unpinConversation("not-actually-pinned"); // no-op → no emit
    expect(cb).toHaveBeenCalledTimes(0);

    // A togglePinConversation on a pinned id should fire (unpins)
    togglePinConversation("t1");
    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bonus: usePinnedIds hook reflects state
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: usePinnedIds hook", () => {
  it("returns a ReadonlySet reflecting the current pinnedIds", () => {
    const hostA = makeHost("hA", "alpha");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([
        makeTab("t1", "terminal", hostA),
        makeTab("t2", "terminal", hostA),
      ]);
      pinConversation("t2");
    });
    const { result } = renderHook(() => usePinnedIds());
    expect(result.current.has("t2")).toBe(true);
    expect(result.current.has("t1")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 13: selectConversationDeferred — id not in tabs sets pending, no emit
// ─────────────────────────────────────────────────────────────────────────────
// Plan 06-04 Task 1 race defense: openTab's setTabs is batched — the new tab
// id is NOT visible in `state.openTabs` synchronously after openTab returns.
// selectConversationDeferred parks the id in a module-scoped pendingSelectId
// slot; updateOpenTabs flushes it when the id finally arrives.
describe("conversation-store: selectConversationDeferred — id not in tabs", () => {
  it("stores id in pendingSelectId and does NOT change selectedId when id is absent", () => {
    const hostA = makeHost("hA", "alpha");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([makeTab("existing", "terminal", hostA)]);
      selectConversation("existing");
    });
    expect(__getSnapshotForTest().selectedId).toBe("existing");
    expect(__getPendingSelectIdForTest()).toBeNull();

    act(() => selectConversationDeferred("newid"));
    // Selection UNCHANGED — the deferred id isn't in openTabs yet
    expect(__getSnapshotForTest().selectedId).toBe("existing");
    // But it's parked in the pending slot for updateOpenTabs to flush
    expect(__getPendingSelectIdForTest()).toBe("newid");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 14: deferred flushes when updateOpenTabs adds the id
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: selectConversationDeferred — flush on arrival", () => {
  it("updateOpenTabs applies the pending id when it appears in the new tabs list", () => {
    const hostA = makeHost("hA", "alpha");
    const existingTab = makeTab("existing", "terminal", hostA);
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([existingTab]);
      selectConversation("existing");
      selectConversationDeferred("newid");
    });
    expect(__getSnapshotForTest().selectedId).toBe("existing");
    expect(__getPendingSelectIdForTest()).toBe("newid");

    // Simulate the batched React setTabs commit — the new tab now arrives
    const newTab = makeTab("newid", "terminal", hostA);
    act(() => updateOpenTabs([existingTab, newTab]));

    // Pending id flushes into selection; pending slot clears
    expect(__getSnapshotForTest().selectedId).toBe("newid");
    expect(__getPendingSelectIdForTest()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 15: deferred with id never arriving — selection unchanged, pending sticky
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: selectConversationDeferred — id never arrives", () => {
  it("updateOpenTabs without the deferred id leaves selection and pending untouched", () => {
    const hostA = makeHost("hA", "alpha");
    const existingTab = makeTab("existing", "terminal", hostA);
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([existingTab]);
      selectConversation("existing");
      selectConversationDeferred("newid");
    });
    expect(__getPendingSelectIdForTest()).toBe("newid");

    // Re-emit the same tabs (without newid) — should NOT flush pending, and
    // selection should stay put
    const anotherTab = makeTab("another", "terminal", hostA);
    act(() => updateOpenTabs([existingTab, anotherTab]));

    expect(__getSnapshotForTest().selectedId).toBe("existing");
    expect(__getPendingSelectIdForTest()).toBe("newid");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 16: deferred applies IMMEDIATELY if id is already in tabs
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: selectConversationDeferred — already present", () => {
  it("selects synchronously via selectConversation when id is in openTabs; pending stays null", () => {
    const hostA = makeHost("hA", "alpha");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([makeTab("existing", "terminal", hostA)]);
    });
    expect(__getSnapshotForTest().selectedId).toBeNull();
    expect(__getPendingSelectIdForTest()).toBeNull();

    act(() => selectConversationDeferred("existing"));

    // Immediate selection — no defer, no pending
    expect(__getSnapshotForTest().selectedId).toBe("existing");
    expect(__getPendingSelectIdForTest()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 17: direct selectConversation clears pending
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: selectConversation clears pending", () => {
  it("a direct selectConversation call clears the pending slot even for same-id", () => {
    const hostA = makeHost("hA", "alpha");
    const existingTab = makeTab("existing", "terminal", hostA);
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([existingTab]);
      selectConversation("existing");
    });
    expect(__getSnapshotForTest().selectedId).toBe("existing");

    act(() => selectConversationDeferred("pending"));
    expect(__getPendingSelectIdForTest()).toBe("pending");

    // A direct selectConversation to an id that IS in tabs clears pending.
    // Re-decision (NOTE-03): even a same-id call clears pending. Here we
    // select the id we're already on — the pending slot must still clear.
    act(() => selectConversation("existing"));
    expect(__getSnapshotForTest().selectedId).toBe("existing");
    expect(__getPendingSelectIdForTest()).toBeNull();
  });

  it("selecting an id NOT in tabs does NOT clear pending (stale-guard runs first)", () => {
    const hostA = makeHost("hA", "alpha");
    const existingTab = makeTab("existing", "terminal", hostA);
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([existingTab]);
      selectConversation("existing");
      selectConversationDeferred("pending");
    });
    expect(__getPendingSelectIdForTest()).toBe("pending");

    // Stale-id: guard runs first, returns before pending is touched
    act(() => selectConversation("stale-not-in-tabs"));
    expect(__getSnapshotForTest().selectedId).toBe("existing");
    expect(__getPendingSelectIdForTest()).toBe("pending");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 18: multiple deferred — last one wins
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: selectConversationDeferred — last-write-wins", () => {
  it("consecutive deferred calls overwrite pending; only the last-set id flushes", () => {
    const hostA = makeHost("hA", "alpha");
    const existingTab = makeTab("existing", "terminal", hostA);
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([existingTab]);
      selectConversation("existing");
    });

    act(() => {
      selectConversationDeferred("p1");
      selectConversationDeferred("p2");
    });
    expect(__getPendingSelectIdForTest()).toBe("p2");
    expect(__getSnapshotForTest().selectedId).toBe("existing");

    // updateOpenTabs adds p2 — pending flushes to p2
    const tabP2 = makeTab("p2", "terminal", hostA);
    act(() => updateOpenTabs([existingTab, tabP2]));
    expect(__getSnapshotForTest().selectedId).toBe("p2");
    expect(__getPendingSelectIdForTest()).toBeNull();
  });

  it("if only p1 arrives (not p2), selection stays put and pending stays 'p2'", () => {
    const hostA = makeHost("hA", "alpha");
    const existingTab = makeTab("existing", "terminal", hostA);
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([existingTab]);
      selectConversation("existing");
      selectConversationDeferred("p1");
      selectConversationDeferred("p2");
    });
    expect(__getPendingSelectIdForTest()).toBe("p2");

    // p1 arrives — but pending is "p2", so pending does NOT flush
    const tabP1 = makeTab("p1", "terminal", hostA);
    act(() => updateOpenTabs([existingTab, tabP1]));
    expect(__getSnapshotForTest().selectedId).toBe("existing");
    expect(__getPendingSelectIdForTest()).toBe("p2");
  });
});

// ─── Plan 07-01: fleet-native data source (TG-12, TG-13, TG-14, TG-17) ──────
// Below: Tests 23-30 covering the new `fleetSessions` + `hostsFlat` inputs,
// the `fleet ∪ openTabs` union with openTabs-entry-wins dedup, the internal
// `fleetOnly` routing marker on synthetic rows, and the no-op emit guards on
// the new actions. Fleet-only row ids are `fleet::${hostId}::${sessionName}`;
// dedup normalizes hostId to string (RemoteTmuxSession.hostId is number,
// Host.id is string — matches SessionsPanel.tsx:47 `parseInt(h.id)` pattern).

// ─────────────────────────────────────────────────────────────────────────────
// Test 23: fleet-only render — no openTabs, fleet emits a synthetic row
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (Plan 07-01): fleet-only render", () => {
  it("emits a synthetic fleetOnly row when fleetSessions has a session and openTabs is empty", () => {
    const hostA = makeHost("1", "hostA");
    const tree: HostFolder = { name: "root", children: [hostA] };

    act(() => {
      updateHostTree(tree);
      updateHostsFlat(new Map([[1, hostA]]));
      updateFleetSessions([
        { hostId: 1, hostName: "hostA", sessionName: "work", created: 100 },
      ]);
    });

    const snap = __getSnapshotForTest();
    expect(snap.pinned).toEqual([]);
    // Phase 41 Plan 01: fleet-derived row lands in flat middle (no host bucket).
    expect(snap.middle.length).toBe(1);
    const row = snap.middle[0];
    expect(row.id).toBe("fleet::1::work");
    expect(row.label).toBe("work");
    expect(row.type).toBe("terminal");
    expect(row.targetTmuxSession).toBe("work");
    expect(row.host).toBe(hostA);
    expect((row as unknown as { fleetOnly?: boolean }).fleetOnly).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 24: openTabs-entry-wins dedup — same session identity collapses to one
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (Plan 07-01): openTabs-entry-wins dedup", () => {
  it("collapses (hostId, sessionName) match to the openTabs row; fleet entry silently dropped", () => {
    const hostA = makeHost("1", "hostA");
    const tree: HostFolder = { name: "root", children: [hostA] };
    const t1 = makeTab("t1", "terminal", hostA, "work", "work-tab");

    act(() => {
      updateHostTree(tree);
      updateHostsFlat(new Map([[1, hostA]]));
      updateOpenTabs([t1]);
      updateFleetSessions([
        { hostId: 1, hostName: "hostA", sessionName: "work", created: 100 },
      ]);
    });

    const snap = __getSnapshotForTest();
    // Phase 41 Plan 01: openTab-derived row lands in flat middle.
    expect(snap.middle.length).toBe(1);
    const row = snap.middle[0];
    // openTabs id wins — NOT the synthetic fleet id
    expect(row.id).toBe("t1");
    // Label preserved from the openTabs entry
    expect(row.label).toBe("work-tab");
    // fleetOnly undefined/false — this is an openTabs-derived row
    expect(
      (row as unknown as { fleetOnly?: boolean }).fleetOnly,
    ).toBeFalsy();
    // Fleet-only introspection: zero rows (the fleet entry was dropped)
    expect(__getFleetOnlyRowsForTest().length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 25: union rendering — same host, disjoint sessions, both appear
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (Plan 07-01): union rendering", () => {
  it("appends fleet-only rows AFTER openTabs rows in the same HostGroup", () => {
    const hostA = makeHost("1", "hostA");
    const tree: HostFolder = { name: "root", children: [hostA] };
    const t1 = makeTab("t1", "terminal", hostA, "work");

    act(() => {
      updateHostTree(tree);
      updateHostsFlat(new Map([[1, hostA]]));
      updateOpenTabs([t1]);
      updateFleetSessions([
        { hostId: 1, hostName: "hostA", sessionName: "work", created: 100 },
        { hostId: 1, hostName: "hostA", sessionName: "scratch", created: 200 },
      ]);
    });

    const snap = __getSnapshotForTest();
    // Phase 41 Plan 01: middle is flat; both rows land in it. All lastMessageAt
    // are null → insertion-order fallback. openTabs iterates first (yields t1),
    // then fleetSyntheticRows iterates (yields fleet::1::scratch).
    expect(snap.middle.length).toBe(2);
    const ids = snap.middle.map((r) => r.id);
    expect(ids).toEqual(["t1", "fleet::1::scratch"]);
    // The fleet-synthetic row still carries fleetOnly === true.
    const scratchRow = snap.middle[1];
    expect(
      (scratchRow as unknown as { fleetOnly?: boolean }).fleetOnly,
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 26: null-target openTabs tab does NOT dedup against a named fleet session
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (Plan 07-01): null-target tab does not false-collide", () => {
  it("an openTabs tab with targetTmuxSession=null does not swallow a same-host fleet session", () => {
    const hostA = makeHost("1", "hostA");
    const tree: HostFolder = { name: "root", children: [hostA] };
    // openTabs entry with no target tmux session — attached to hostA but we
    // don't know which tmux session. Its identity is (hostA, null) which is
    // NOT the same as (hostA, "work").
    const t1 = makeTab("t1", "terminal", hostA, null, "hostA");

    act(() => {
      updateHostTree(tree);
      updateHostsFlat(new Map([[1, hostA]]));
      updateOpenTabs([t1]);
      updateFleetSessions([
        { hostId: 1, hostName: "hostA", sessionName: "work", created: 100 },
      ]);
    });

    const snap = __getSnapshotForTest();
    // Phase 41 Plan 01: both rows land in flat middle in insertion order
    // (openTabs first → t1, then fleetSyntheticRows → fleet::1::work).
    expect(snap.middle.length).toBe(2);
    const ids = snap.middle.map((r) => r.id);
    expect(ids).toEqual(["t1", "fleet::1::work"]);
    expect(__getFleetOnlyRowsForTest().length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 27: updateFleetSessions no-op guards — ref-equal input does not bump version
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (Plan 07-01): updateFleetSessions no-op guards", () => {
  it("same-reference array does not fire subscribers; different-reference content-equal array does fire", () => {
    const sessions1: FleetSession[] = [
      { hostId: 1, hostName: "hostA", sessionName: "work", created: 100 },
    ];

    // Prime the store
    act(() => updateFleetSessions(sessions1));

    const cb = vi.fn();
    const unsub = __subscribeForTest(cb);

    // Same reference → no emit
    updateFleetSessions(sessions1);
    expect(cb).toHaveBeenCalledTimes(0);

    // Different reference but content-equal — we do NOT deep-equal, so a fresh
    // array from a fresh fetch is treated as a real signal and DOES fire.
    const sessions2: FleetSession[] = [
      { hostId: 1, hostName: "hostA", sessionName: "work", created: 100 },
    ];
    updateFleetSessions(sessions2);
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// quick-260810-oig: removeFleetSession R1-R4
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (quick-260810-oig): removeFleetSession", () => {
  // Phase 47 Plan 01: cache key bumped v2 → v3 (see conversation-store.ts
  // FLEET_CACHE_KEY comment for rationale — aiTitle field addition on
  // FleetSession forces a fresh cold-start so v2 entries lacking aiTitle
  // do not rehydrate and seed working-store with missing/undefined aiTitle).
  const FLEET_CACHE_KEY = "skynet:convo-fleet-cache:v3";

  it("R1: removes present (hostId, sessionName) tuple, fires notify, trims cache", () => {
    const sessions: FleetSession[] = [
      { hostId: 1, hostName: "hostA", sessionName: "work", created: 100, role: null },
      { hostId: 2, hostName: "hostB", sessionName: "idle", created: 200, role: null },
    ];
    act(() => updateFleetSessions(sessions));

    const cb = vi.fn();
    const unsub = __subscribeForTest(cb);

    const spy = vi.spyOn(Storage.prototype, "setItem");

    act(() => removeFleetSession(1, "work"));

    // State: (1,"work") gone; (2,"idle") remains
    const fleetRows = __getFleetOnlyRowsForTest();
    expect(fleetRows.some((r) => r.id === "fleet::1::work")).toBe(false);
    expect(fleetRows.some((r) => r.id === "fleet::2::idle")).toBe(true);

    // notify() fired once
    expect(cb).toHaveBeenCalledTimes(1);

    // Cache written with surviving session only
    const cacheWrites = spy.mock.calls.filter(([k]) => k === FLEET_CACHE_KEY);
    expect(cacheWrites.length).toBeGreaterThanOrEqual(1);
    const lastWrite = cacheWrites[cacheWrites.length - 1];
    const parsed = JSON.parse(lastWrite[1] as string) as unknown[];
    expect(parsed.length).toBe(1);
    expect((parsed[0] as { sessionName: string }).sessionName).toBe("idle");

    spy.mockRestore();
    unsub();
  });

  it("R2: idempotent no-op for absent (hostId, sessionName) — no notify, no cache write", () => {
    const sessions: FleetSession[] = [
      { hostId: 1, hostName: "hostA", sessionName: "work", created: 100, role: null },
    ];
    act(() => updateFleetSessions(sessions));

    const cb = vi.fn();
    const unsub = __subscribeForTest(cb);

    const spy = vi.spyOn(Storage.prototype, "setItem");

    act(() => removeFleetSession(99, "nonexistent"));

    // State unchanged: original session still present
    const fleetRows = __getFleetOnlyRowsForTest();
    expect(fleetRows.some((r) => r.id === "fleet::1::work")).toBe(true);

    // notify() NOT fired
    expect(cb).toHaveBeenCalledTimes(0);

    // No cache write for FLEET_CACHE_KEY
    const cacheWrites = spy.mock.calls.filter(([k]) => k === FLEET_CACHE_KEY);
    expect(cacheWrites.length).toBe(0);

    spy.mockRestore();
    unsub();
  });

  it("R3: selective — only exact (hostId, sessionName) tuple removed; siblings remain", () => {
    const sessions: FleetSession[] = [
      { hostId: 1, hostName: "hostA", sessionName: "work", created: 100, role: null },
      { hostId: 1, hostName: "hostA", sessionName: "idle", created: 200, role: null },
      { hostId: 2, hostName: "hostB", sessionName: "work", created: 300, role: null },
    ];
    act(() => updateFleetSessions(sessions));

    act(() => removeFleetSession(1, "work"));

    const fleetRows = __getFleetOnlyRowsForTest();
    expect(fleetRows.some((r) => r.id === "fleet::1::work")).toBe(false);
    expect(fleetRows.some((r) => r.id === "fleet::1::idle")).toBe(true);
    expect(fleetRows.some((r) => r.id === "fleet::2::work")).toBe(true);
  });

  it("R4: cache-write failure does not block in-memory state update or notify()", () => {
    const sessions: FleetSession[] = [
      { hostId: 1, hostName: "hostA", sessionName: "work", created: 100, role: null },
    ];
    act(() => updateFleetSessions(sessions));

    const cb = vi.fn();
    const unsub = __subscribeForTest(cb);

    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    try {
      // Must not propagate any error
      expect(() => { act(() => removeFleetSession(1, "work")); }).not.toThrow();

      // In-memory state IS trimmed despite cache failure
      const fleetRows = __getFleetOnlyRowsForTest();
      expect(fleetRows.some((r) => r.id === "fleet::1::work")).toBe(false);

      // notify() fired exactly once
      expect(cb).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      unsub();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 28: fleet-only host absent from hostTree + hostsFlat — fallback name used
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (Plan 07-01): host-tree/hostsFlat fallback for fleet-only host", () => {
  it("uses FleetSession.hostName when the host is unresolvable via hostTree/hostsFlat", () => {
    // hostTree null + hostsFlat empty — this is the initial-load race where
    // the fleet fetch resolved before realHostTree loaded. Resilience defense:
    // fleet-only rows still surface via the hostName carried on the FleetSession.

    act(() => {
      updateFleetSessions([
        {
          hostId: 1,
          hostName: "hostA-fallback-name",
          sessionName: "work",
          created: 100,
        },
      ]);
    });

    const snap = __getSnapshotForTest();
    // Phase 41 Plan 01: middle is flat. The pre-Phase-41 host-group hostName
    // fallback (fleet-session hostName → hostsFlat → raw hostId) surfaced
    // through the group header. Post-Phase-41 the middle no longer emits
    // group headers, so the fallback is inert for the middle. The row itself
    // still surfaces even when host is unresolvable — this is the load-bearing
    // resilience contract that survives the shape change.
    expect(snap.middle.length).toBe(1);
    const row = snap.middle[0];
    expect(row.id).toBe("fleet::1::work");
    expect(row.host).toBeUndefined();
    expect((row as unknown as { fleetOnly?: boolean }).fleetOnly).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 29: updateHostsFlat mutation triggers notify; ref-equal Map does not
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (Plan 07-01): updateHostsFlat no-op guards", () => {
  it("same-reference Map is a no-op; new Map with same content DOES fire (no deep-equal)", () => {
    const hostA = makeHost("1", "hostA");
    const map1 = new Map<number, Host>([[1, hostA]]);

    // Prime
    act(() => updateHostsFlat(map1));

    const cb = vi.fn();
    const unsub = __subscribeForTest(cb);

    // Same ref → no emit
    updateHostsFlat(map1);
    expect(cb).toHaveBeenCalledTimes(0);

    // Different Map ref (even with identical content) DOES fire — we don't
    // deep-equal Maps. This matches the fleetSessions same-content-different-
    // ref behavior (Test 27) so the store's polling-thrash-guard story is
    // consistent across inputs. Callers memoize upstream when they want
    // reference stability across polls (see AppShell stableHostTreeKey).
    const map2 = new Map<number, Host>([[1, hostA]]);
    updateHostsFlat(map2);
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 shape-guard extension: activeSet field is always an empty array
// (Phase 42 UAT amendment 2026-08-17 — Tier 1 render tier retired; the
// snapshot field is preserved as an always-empty ConversationRow[] so
// every consumer's `const { activeSet, ... } = useConversations();`
// destructure keeps compiling.)
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: activeSet snapshot field is always empty (Phase 42 UAT amendment 2026-08-17)", () => {
  it("returns empty activeSet alongside empty pinned + middle + null rdpGroup on the happy-empty path", () => {
    const { result: convs } = renderHook(() => useConversations());
    expect(convs.current.activeSet).toEqual([]);
    expect(convs.current.pinned).toEqual([]);
    // Phase 41 Plan 01: `grouped: HostGroup[]` → `middle: ConversationRow[]`
    // + `rdpGroup: HostGroup | null`.
    expect(convs.current.middle).toEqual([]);
    expect(convs.current.rdpGroup).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 30 (Patch #149 A): fleet-only rows CAN be pinned — pinConversation
// accepts any id. The pre-#149 openTabs-only guard was retired: the mock
// treats all non-RDP rows uniformly, so the pin affordance and the store must
// agree. Slice A only removes the guard (pinnedIds gains the fleet id); the
// pinned-section reorder-to-top is Patch #149 B's scope.
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (Patch #149 A): fleet-only rows are pinnable", () => {
  it("pinConversation on a fleet-only row id adds the id to pinnedIds", () => {
    const hostA = makeHost("1", "hostA");
    const tree: HostFolder = { name: "root", children: [hostA] };

    act(() => {
      updateHostTree(tree);
      updateHostsFlat(new Map([[1, hostA]]));
      updateFleetSessions([
        { hostId: 1, hostName: "hostA", sessionName: "work", created: 100 },
      ]);
    });

    // Sanity: the fleet-only row exists in the flat middle; nothing pinned
    const snap1 = __getSnapshotForTest();
    expect(snap1.middle[0].id).toBe("fleet::1::work");
    expect(snap1.pinnedIds.size).toBe(0);

    // Patch #149 A: pinning a fleet-only row now succeeds
    act(() => pinConversation("fleet::1::work"));

    const snap2 = __getSnapshotForTest();
    expect(snap2.pinnedIds.has("fleet::1::work")).toBe(true);
    // Slice B (Patch #149 B+C): the pinned-section now surfaces fleet rows,
    // so the fleet row is promoted to snap2.pinned and is NOT in middle.
    // The Slice A regression we protect here is that pinnedIds contains the
    // fleet id — that assertion above is the load-bearing one.
    expect(snap2.pinned.length).toBe(1);
    expect(snap2.pinned[0].id).toBe("fleet::1::work");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 30b-30e (Patch #149 B+C): three-tier sort + strict dedup contract
// ─────────────────────────────────────────────────────────────────────────────

describe("conversation-store (Patch #149 B+C): Test 30b — pinned fleet row appears in snap.pinned", () => {
  it("pinning a fleet-only id moves the row into the pinned tier and removes it from grouped", () => {
    const hostA = makeHost("1", "hostA");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateHostsFlat(new Map([[1, hostA]]));
      updateFleetSessions([
        { hostId: 1, hostName: "hostA", sessionName: "work", created: 100 },
      ]);
      pinConversation("fleet::1::work");
    });

    const snap = __getSnapshotForTest();

    // Tier 2: pinned contains the fleet row
    expect(snap.pinned.length).toBe(1);
    expect(snap.pinned[0].id).toBe("fleet::1::work");
    expect((snap.pinned[0] as unknown as { fleetOnly?: boolean }).fleetOnly).toBe(true);

    // Dedup: the row must NOT appear in middle. Phase 41 Plan 01: assert
    // against the flat middle array (not the old grouped[] shape).
    const allMiddleIds = snap.middle.map((r) => r.id);
    expect(allMiddleIds).not.toContain("fleet::1::work");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// quick-260730-wfy: pinned tier is alphabetically sorted by row.label
// ─────────────────────────────────────────────────────────────────────────────
// Regression guard: computeSnapshot must sort the pinned array in-place by
// row.label using the compareByLabel comparator after population, regardless
// of the source order that openTabs and fleetSessions were iterated in.
// Expected to FAIL against the pre-change store (which would emit
// ["z", "m", "a", "n"]) and PASS against the post-change store.
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (quick-260730-wfy): pinned tier alphabetical ordering", () => {
  it("pinned tier is alphabetically sorted by row.label regardless of source", () => {
    const hostA = makeHost("hA", "alpha");
    // Two openTabs with labels ["z", "m"] in that order
    const tabZ = makeTab("t-z", "terminal", hostA, null, "z");
    const tabM = makeTab("t-m", "terminal", hostA, null, "m");
    // Two fleet sessions with labels ["a", "n"] in that order (sessionName IS the label)
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      // Phase 25 supersedes: host is now outer sort key. Fleet rows (host=undefined
      // before hostsFlat populates) sort before openTab rows (host=hostA → hostName
      // "alpha") because "" < "alpha". Fix: provide hostsFlat so fleet rows resolve
      // to hostA — all 4 rows tie on host → tie on role (all null) → label
      // fallback → original ["a","m","n","z"] intent is restored.
      updateHostsFlat(new Map([[99, hostA]]));
      updateOpenTabs([tabZ, tabM]);
      updateFleetSessions([
        { hostId: 99, hostName: "alpha", sessionName: "a", created: 100 },
        { hostId: 99, hostName: "alpha", sessionName: "n", created: 200 },
      ]);
      // Mark all four pinned
      pinConversation("t-z");
      pinConversation("t-m");
      pinConversation("fleet::99::a");
      pinConversation("fleet::99::n");
    });

    const snap = __getSnapshotForTest();
    // Post-change: all 4 rows share host "alpha" → tie on host → tie on role
    // (all null) → alphabetically sorted by row.label → ["a", "m", "n", "z"]
    expect(snap.pinned.map((r) => r.label)).toEqual(["a", "m", "n", "z"]);
  });
});

describe("conversation-store (Phase 42 UAT amendment 2026-08-17): Test 30c — active-set + pinned row stays in pinned tier", () => {
  // Phase 42 UAT amendment 2026-08-17 (Ashley verbatim): "sessions are still
  // showing above the pinned area when they are active in the current instance
  // of the client. That shouldn't happen." — activeSet render tier retired;
  // activeSet-and-pinned rows stay in pinned, activeSet-only rows fall
  // through to middle by recency.
  it("addToActiveSet on a pinned fleet id keeps the row in pinned; activeSet snapshot field is empty", () => {
    const hostA = makeHost("1", "hostA");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateHostsFlat(new Map([[1, hostA]]));
      updateFleetSessions([
        { hostId: 1, hostName: "hostA", sessionName: "work", created: 100 },
      ]);
      pinConversation("fleet::1::work");
      addToActiveSet("fleet::1::work");
    });

    const snap = __getSnapshotForTest();

    // Active-set render tier retired: activeSet snapshot field is always empty.
    expect(snap.activeSet.length).toBe(0);

    // Pin wins: the fleet row lands in the pinned tier.
    expect(snap.pinned.length).toBe(1);
    expect(snap.pinned[0].id).toBe("fleet::1::work");

    // Pinned dedup still works: NOT in middle.
    const allMiddleIds = snap.middle.map((r) => r.id);
    expect(allMiddleIds).not.toContain("fleet::1::work");
  });
});

describe("conversation-store (Phase 42 UAT amendment 2026-08-17): Test 30d — activeSet-only row (not pinned) falls through to middle", () => {
  // Phase 42 UAT amendment 2026-08-17 (Ashley verbatim): "sessions are still
  // showing above the pinned area when they are active in the current instance
  // of the client. That shouldn't happen." — activeSet render tier retired;
  // activeSet-and-pinned rows stay in pinned, activeSet-only rows fall
  // through to middle by recency.
  it("fleet row in activeSet but not pinned lands in middle; pinned and activeSet snapshot fields are both empty", () => {
    const hostA = makeHost("1", "hostA");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateHostsFlat(new Map([[1, hostA]]));
      updateFleetSessions([
        { hostId: 1, hostName: "hostA", sessionName: "work", created: 100 },
      ]);
      addToActiveSet("fleet::1::work");
    });

    const snap = __getSnapshotForTest();

    // Active-set render tier retired: activeSet snapshot field is always empty.
    expect(snap.activeSet.length).toBe(0);
    expect(snap.pinned.length).toBe(0);

    // Fleet row falls through to middle by recency.
    expect(snap.middle.some((r) => r.id === "fleet::1::work")).toBe(true);
  });
});

describe("conversation-store (Phase 42 UAT amendment 2026-08-17): Test 30e — openTab pinned + activeSet stays in pinned", () => {
  // Phase 42 UAT amendment 2026-08-17 (Ashley verbatim): "sessions are still
  // showing above the pinned area when they are active in the current instance
  // of the client. That shouldn't happen." — activeSet render tier retired;
  // activeSet-and-pinned rows stay in pinned, activeSet-only rows fall
  // through to middle by recency.
  it("openTab row in both pinnedIds and activeSet stays in pinned; activeSet snapshot field is empty", () => {
    const hostA = makeHost("hA", "hostA");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([makeTab("t1", "terminal", hostA, "s1", "t1-label")]);
      pinConversation("t1");
      addToActiveSet("t1");
    });

    const snap = __getSnapshotForTest();

    // Active-set render tier retired: activeSet snapshot field is always empty.
    expect(snap.activeSet.length).toBe(0);

    // Pin wins: t1 lands in the pinned tier.
    expect(snap.pinned.length).toBe(1);
    expect(snap.pinned[0].id).toBe("t1");

    // Pinned dedup still works: NOT in middle.
    const allMiddleIds = snap.middle.map((r) => r.id);
    expect(allMiddleIds).not.toContain("t1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 30f-30i (quick-260727-gm3): removeFromActiveSet contract
// ─────────────────────────────────────────────────────────────────────────────
// Ashley 2026-07-27 preview lockdown: deactivate is the pure reverse of the
// tap-ambient-to-activate flow. Store semantics MUST mirror addToActiveSet:
//   - idempotent no-op when the id is not in the set (no notify, no write)
//   - real removal produces a NEW Set reference, writes sessionStorage, notifies
//   - selectedId is orthogonal (deactivation does NOT deselect at the store
//     layer — the panel wires closeTab separately)
//   - silent try/catch on sessionStorage (unchanged from addToActiveSet)
// ─────────────────────────────────────────────────────────────────────────────

describe("conversation-store (quick-260727-gm3): Test 30f — removeFromActiveSet no-op on absent id", () => {
  it("removeFromActiveSet(id) is a silent no-op when the id is not in the set", () => {
    const cb = vi.fn();
    const unsub = __subscribeForTest(cb);

    // Sanity: activeSet is empty (reset in beforeEach)
    expect(__getSnapshotForTest().activeSet.length).toBe(0);

    // Call removeFromActiveSet on an id NOT in the set — must not fire notify
    act(() => removeFromActiveSet("id-not-in-set"));

    expect(cb).toHaveBeenCalledTimes(0);
    // Set reference stays untouched (no gratuitous new Set on no-op)
    expect(__getSnapshotForTest().activeSet.length).toBe(0);

    unsub();
  });
});

describe("conversation-store (quick-260727-gm3): Test 30g — removeFromActiveSet removes, writes storage, notifies", () => {
  it("removeFromActiveSet(id) on a present id removes it, writes sessionStorage, and fires notify once", () => {
    act(() => addToActiveSet("t1"));

    // Sanity — the add landed
    const snapBefore = __getSnapshotForTest();
    // pinnedIds is the ReadonlySet snapshot; activeSet is derived rows — we
    // assert via the sessionStorage write below AND via the state's
    // pinnedIds proxy pattern here by checking useActiveSet reads.
    expect(sessionStorage.getItem("pv-conv-active-set")).toBe(
      JSON.stringify(["t1"]),
    );

    const cb = vi.fn();
    const unsub = __subscribeForTest(cb);

    act(() => removeFromActiveSet("t1"));

    // Exactly one notify from the real removal
    expect(cb).toHaveBeenCalledTimes(1);

    // sessionStorage now reflects the empty set
    expect(sessionStorage.getItem("pv-conv-active-set")).toBe(
      JSON.stringify([]),
    );

    unsub();
    // silence unused var
    void snapBefore;
  });
});

describe("conversation-store (quick-260727-gm3): Test 30h — round-trip add → remove → add", () => {
  it("addToActiveSet(x) → removeFromActiveSet(x) leaves the set empty; a subsequent addToActiveSet(x) re-adds", () => {
    // Prime with an add, then remove.
    act(() => addToActiveSet("t1"));
    act(() => removeFromActiveSet("t1"));
    expect(sessionStorage.getItem("pv-conv-active-set")).toBe(
      JSON.stringify([]),
    );

    // Second add succeeds (proves the set actually shrunk and no stale
    // state prevents re-adding the same id).
    act(() => addToActiveSet("t1"));
    expect(sessionStorage.getItem("pv-conv-active-set")).toBe(
      JSON.stringify(["t1"]),
    );
  });
});

describe("conversation-store (quick-260727-gm3): Test 30i — removeFromActiveSet leaves selectedId untouched", () => {
  it("removeFromActiveSet(id) does NOT clear state.selectedId even when the removed id was selected", () => {
    const hostA = makeHost("hA", "hostA");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([makeTab("t1", "terminal", hostA, "s1", "t1-label")]);
      selectConversation("t1");
    });

    // Sanity: selectedId is t1 (also added to active-set via selectConversation)
    const { result: selected } = renderHook(() => useSelectedConversationId());
    expect(selected.current).toBe("t1");

    act(() => removeFromActiveSet("t1"));

    // Deactivation is orthogonal to selection at the store layer — the
    // panel wires closeTab separately; the store MUST NOT implicitly
    // deselect. Ashley 2026-07-27: agent keeps running under the hood.
    expect(selected.current).toBe("t1");
  });
});

// ─── Plan 07-02: RDP row derivation (TG-15) ──────────────────────────────────
// Tests 31-34 cover the new synthetic RDP row emission path: one row per host
// in state.hostsFlat where `host.enableRdp === true`, emitted at the BOTTOM of
// the derived ConversationList via a sentinel HostGroup with hostId === "__rdp__".
// RDP rows carry `rdpHostRow: true` so ConversationsPanel can route their
// click to onRdpRowClick → AppShell → openTab(host, "rdp"). RDP ids follow
// `rdp-host::${host.id}` — deterministic per host (fleet fact, NOT tab state).

// ─────────────────────────────────────────────────────────────────────────────
// Test 31: RDP row emission — enableRdp=true host emits one row; enableRdp=false does not
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (Plan 07-02): RDP row emission", () => {
  it("emits one RDP row per host with enableRdp=true and none for enableRdp=false", () => {
    const hostA = makeHost("1", "hostA", { enableRdp: true });
    const hostB = makeHost("2", "hostB", { enableRdp: false });
    const tree: HostFolder = { name: "root", children: [hostA, hostB] };

    act(() => {
      updateHostTree(tree);
      updateHostsFlat(
        new Map<number, Host>([
          [1, hostA],
          [2, hostB],
        ]),
      );
    });

    const snap = __getSnapshotForTest();
    // Phase 41 Plan 01: RDP rows live in the standalone `rdpGroup` field
    // (sentinel HostGroup with hostId === "__rdp__"). Identity-tmux hosts
    // (hostA, hostB) have no openTabs and no fleetSessions, so nothing lands
    // in middle either.
    expect(snap.rdpGroup).not.toBeNull();
    expect(snap.rdpGroup!.hostId).toBe("__rdp__");
    const rdpRows = snap.rdpGroup!.rows;
    expect(rdpRows.length).toBe(1);
    const row = rdpRows[0];
    expect(row.id).toBe("rdp-host::1");
    expect(row.label).toBe("hostA");
    expect(row.type).toBe("rdp");
    expect(row.host).toBe(hostA);
    expect(row.targetTmuxSession).toBeNull();
    expect(
      (row as unknown as { rdpHostRow?: boolean }).rdpHostRow,
    ).toBe(true);
    // hostB (enableRdp=false) MUST NOT appear
    const ids = rdpRows.map((r) => r.id);
    expect(ids).not.toContain("rdp-host::2");
  });

  it("does not emit an RDP row for a host with enableRdp === undefined (strict === true check)", () => {
    // Legacy Host record without the enableRdp field — must NOT accidentally
    // emit a row (T-07-02-01 mitigation: strict identity check, not truthy).
    const hostLegacy = makeHost("3", "hostLegacy"); // no overrides → no enableRdp
    act(() => {
      updateHostsFlat(new Map<number, Host>([[3, hostLegacy]]));
    });
    const snap = __getSnapshotForTest();
    // Phase 41 Plan 01: rdpGroup is null when zero RDP-eligible hosts exist
    // (Ashley lock #7 — no empty RDP header renders).
    expect(snap.rdpGroup).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 32: RDP rows appear AFTER all openTabs + fleet HostGroups
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (Plan 07-02): RDP row placement at BOTTOM", () => {
  it("orders openTabs group → fleet-only row → RDP sentinel group at the very bottom", () => {
    const hostA = makeHost("1", "hostA", { enableRdp: true });
    const hostB = makeHost("2", "hostB", { enableRdp: true });
    const tree: HostFolder = { name: "root", children: [hostA, hostB] };
    // openTabs entry with (hostA, "attached") tmux target
    const t1 = makeTab("t1", "terminal", hostA, "attached", "attached");

    act(() => {
      updateHostTree(tree);
      updateHostsFlat(
        new Map<number, Host>([
          [1, hostA],
          [2, hostB],
        ]),
      );
      updateOpenTabs([t1]);
      // fleet-only session (hostA, "work")
      updateFleetSessions([
        { hostId: 1, hostName: "hostA", sessionName: "work", created: 100 },
      ]);
    });

    const snap = __getSnapshotForTest();
    // Phase 41 Plan 01: shape is (middle: flat, rdpGroup: standalone).
    //   - `middle` carries the identity-tmux + fleet rows in insertion order:
    //     openTabs first (t1) → fleetSyntheticRows (fleet::1::work).
    //   - `rdpGroup.rows` carries RDP rows in hostTree order (hostA, hostB).
    //     hostB has no openTabs / no fleetSessions but IS RDP-enabled, so it
    //     surfaces in rdpGroup regardless.
    expect(snap.middle.map((r) => r.id)).toEqual(["t1", "fleet::1::work"]);
    expect(snap.rdpGroup).not.toBeNull();
    expect(snap.rdpGroup!.rows.map((r) => r.id)).toEqual([
      "rdp-host::1",
      "rdp-host::2",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 33: RDP row vanishes when enableRdp toggled off
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (Plan 07-02): RDP row persistence tied to enableRdp flag", () => {
  it("toggling enableRdp off via updateHostsFlat removes the RDP row; toggling on restores it", () => {
    const hostAOn = makeHost("1", "hostA", { enableRdp: true });
    const hostAOff = makeHost("1", "hostA", { enableRdp: false });

    // Phase 41 Plan 01: rdpGroup is null when zero RDP hosts, an object with
    // rows when >=1 (Ashley lock #7).
    act(() => {
      updateHostsFlat(new Map<number, Host>([[1, hostAOn]]));
    });
    let snap = __getSnapshotForTest();
    expect(snap.rdpGroup).not.toBeNull();
    expect(snap.rdpGroup!.rows.length).toBe(1);
    expect(snap.rdpGroup!.rows[0].id).toBe("rdp-host::1");

    // Simulate Ashley toggling RDP OFF in the host editor → realHostTree
    // rebuild → new hostsFlat Map with enableRdp=false
    act(() => {
      updateHostsFlat(new Map<number, Host>([[1, hostAOff]]));
    });
    snap = __getSnapshotForTest();
    expect(snap.rdpGroup).toBeNull();

    // Toggle back on — row returns
    act(() => {
      updateHostsFlat(new Map<number, Host>([[1, hostAOn]]));
    });
    snap = __getSnapshotForTest();
    expect(snap.rdpGroup).not.toBeNull();
    expect(snap.rdpGroup!.rows[0].id).toBe("rdp-host::1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 34 (Patch #149 A): RDP-row un-pinnability is now enforced at the UI
// layer (PrettyConversationsPanel wires `onTogglePin={rdpNoopTogglePin}` for
// RDP rows and hard-codes `pinned={false}` in the RDP branch), NOT at the
// store layer. Patch #149 A removed the store-level openTabs guard so fleet
// rows could be pinned; the RDP invariant survives via the panel wiring and
// the RDP row's render never producing a real pin click. If somebody DOES
// call pinConversation("rdp-host::…") directly the store now accepts it, but
// no path in the app does so, and the render still shows the RDP row as
// unpinned (hard-coded prop).
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (Patch #149 A): RDP-row un-pinnability moved to UI layer", () => {
  it("pinConversation on an RDP row id accepts it at the store level (UI wiring is the guard)", () => {
    const hostA = makeHost("1", "hostA", { enableRdp: true });
    act(() => {
      updateHostsFlat(new Map<number, Host>([[1, hostA]]));
    });

    // Sanity: RDP row exists. Phase 41 Plan 01: rdpGroup is the standalone
    // field (not an entry in the retired `grouped` shape).
    let snap = __getSnapshotForTest();
    expect(snap.rdpGroup).not.toBeNull();
    expect(snap.rdpGroup!.rows[0].id).toBe("rdp-host::1");
    expect(snap.pinnedIds.size).toBe(0);

    // Patch #149 A: the store no longer rejects any id. Direct call succeeds.
    // The panel wires `onTogglePin={rdpNoopTogglePin}` for RDP rows so no user
    // click can trigger this path — the RDP-un-pinnable invariant is enforced
    // at the panel wiring, not here.
    act(() => pinConversation("rdp-host::1"));

    snap = __getSnapshotForTest();
    expect(snap.pinnedIds.has("rdp-host::1")).toBe(true);
    // Row still visible in the rdpGroup
    expect(snap.rdpGroup).not.toBeNull();
    expect(snap.rdpGroup!.rows[0].id).toBe("rdp-host::1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Patch #137 — activeSet side-effect on selectConversation + sessionStorage
// persistence + module-init hydration
// ─────────────────────────────────────────────────────────────────────────────

describe("conversation-store (patch #137): selectConversation → activeSet + sessionStorage", () => {
  it("selectConversation(id) adds id to activeSet AND writes to sessionStorage", () => {
    const hostA = makeHost("hA", "nasty");
    act(() => {
      updateOpenTabs([makeTab("t-A", "terminal", hostA)]);
    });

    act(() => {
      selectConversation("t-A");
    });

    // Hook returns a ReadonlySet that includes the id.
    const { result } = renderHook(() => useActiveSet());
    expect(result.current.has("t-A")).toBe(true);

    // Persistence: sessionStorage carries the same id under the canonical key.
    const raw = sessionStorage.getItem("pv-conv-active-set");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toContain("t-A");
  });
});

describe("conversation-store (patch #137): activeSet is idempotent on repeat select", () => {
  it("selectConversation(id) called twice does NOT trigger a second sessionStorage.setItem write", () => {
    const hostA = makeHost("hA", "nasty");
    act(() => {
      updateOpenTabs([makeTab("t-A", "terminal", hostA)]);
    });

    // First select — this DOES write to sessionStorage.
    act(() => {
      selectConversation("t-A");
    });

    // Spy AFTER the first write so we count only the second call's writes.
    const spy = vi.spyOn(Storage.prototype, "setItem");

    // Second select — same id → addToActiveSet short-circuits (already
    // present) → NO sessionStorage.setItem call for pv-conv-active-set.
    act(() => {
      selectConversation("t-A");
    });

    const activeSetWrites = spy.mock.calls.filter(
      ([k]) => k === "pv-conv-active-set",
    );
    expect(activeSetWrites.length).toBe(0);

    spy.mockRestore();
  });
});

describe("conversation-store (patch #137): module-init hydrates activeSet from sessionStorage", () => {
  it("pre-seeded sessionStorage entries populate activeSet on module reload", async () => {
    // Pre-seed the storage layer with a JSON array of ids.
    sessionStorage.setItem(
      "pv-conv-active-set",
      JSON.stringify(["seed-1", "seed-2"]),
    );

    // Re-execute the module to force the module-scope hydrateActiveSetFromStorage
    // call to run against the seeded storage. vi.resetModules() drops the
    // module-cache entry; the dynamic import re-runs the module body.
    vi.resetModules();
    const reImported = await import("./conversation-store.js");

    const { result } = renderHook(() => reImported.useActiveSet());
    expect(result.current.has("seed-1")).toBe(true);
    expect(result.current.has("seed-2")).toBe(true);
    expect(result.current.size).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ashley 2026-08-05: only=1 sessionStorage-bleed guard.
//
// When window.open drops `noopener` (PrettyConversationRow.tsx
// uo4-noopener-fix), the child window inherits the opener's sessionStorage —
// including the pv-conv-active-set key. Without the guard, the child window's
// hydrate pulls in the opener's whole activeSet on module load, causing
// Move-to-new-window to bring along every origin-active row alongside the
// target row. The guard detects `only=1` in location.hash and starts fresh:
// returns empty Set AND clears the storage key so any later addToActiveSet
// calls persist onto a clean slate.
//
// Uses vi.resetModules() to force a fresh hydrate against test-controlled
// sessionStorage + location.hash — mirrors the patch #137 module-init test
// pattern above.
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (2026-08-05 uo4 followup): only=1 sessionStorage-bleed guard on hydrate", () => {
  // Restore hash after each test — window.location.hash writes persist across
  // vitest tests since JSDOM's window is shared. Explicit reset avoids leakage.
  const originalHash = window.location.hash;

  beforeEach(() => {
    window.location.hash = "";
  });

  it("hash contains only=1 → hydrate returns empty Set AND removes the storage key (fresh-slate for new window)", async () => {
    // Pre-seed as if inherited from opener via window.open sessionStorage clone.
    sessionStorage.setItem(
      "pv-conv-active-set",
      JSON.stringify(["opener-tina", "opener-nelly"]),
    );
    // Simulate the Move-to-new-window URL landing.
    window.location.hash = "#tab=tmux:thenasty:nelly&active=0&only=1";

    vi.resetModules();
    const reImported = await import("./conversation-store.js");

    const { result } = renderHook(() => reImported.useActiveSet());
    // Load-bearing: the opener's ids must NOT have leaked in.
    expect(result.current.has("opener-tina")).toBe(false);
    expect(result.current.has("opener-nelly")).toBe(false);
    expect(result.current.size).toBe(0);

    // Storage key must have been cleared so any subsequent addToActiveSet
    // writes persist onto a clean slate (not merged with the opener's set).
    expect(sessionStorage.getItem("pv-conv-active-set")).toBeNull();

    window.location.hash = originalHash;
  });

  it("hash without only param → hydrate returns stored values unchanged (patch #137 regression guard)", async () => {
    sessionStorage.setItem(
      "pv-conv-active-set",
      JSON.stringify(["kept-1", "kept-2"]),
    );
    // A hash without only=1 (e.g. a normal restored URL, or empty hash) must
    // NOT trigger the clear — the guard is strictly for the Move-to-new-window
    // origin URL.
    window.location.hash = "#tab=tmux:thenasty:tina&active=0";

    vi.resetModules();
    const reImported = await import("./conversation-store.js");

    const { result } = renderHook(() => reImported.useActiveSet());
    expect(result.current.has("kept-1")).toBe(true);
    expect(result.current.has("kept-2")).toBe(true);
    expect(result.current.size).toBe(2);

    // Storage must still hold the seeded value (not cleared).
    expect(sessionStorage.getItem("pv-conv-active-set")).not.toBeNull();

    window.location.hash = originalHash;
  });

  it("empty hash → hydrate returns stored values unchanged (patch #137 regression guard, empty-hash edge)", async () => {
    sessionStorage.setItem(
      "pv-conv-active-set",
      JSON.stringify(["kept-1"]),
    );
    window.location.hash = "";

    vi.resetModules();
    const reImported = await import("./conversation-store.js");

    const { result } = renderHook(() => reImported.useActiveSet());
    expect(result.current.has("kept-1")).toBe(true);
    expect(result.current.size).toBe(1);
    expect(sessionStorage.getItem("pv-conv-active-set")).not.toBeNull();
  });

  it("hash contains other params but no only → hydrate returns stored values (only=1 is a strict match, not a substring)", async () => {
    sessionStorage.setItem(
      "pv-conv-active-set",
      JSON.stringify(["kept-only-lonely"]),
    );
    // "lonely" contains the substring "only" but is NOT the URL param `only`;
    // guard must use URLSearchParams parsing, not substring match.
    window.location.hash = "#tab=lonely&active=0";

    vi.resetModules();
    const reImported = await import("./conversation-store.js");

    const { result } = renderHook(() => reImported.useActiveSet());
    expect(result.current.has("kept-only-lonely")).toBe(true);
    expect(sessionStorage.getItem("pv-conv-active-set")).not.toBeNull();

    window.location.hash = originalHash;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Patch #150 C — URL-restore multi-tab glow (store-level contract).
// Ashley's followup-3 UAT (2026-07-24): a URL that captured 2 (or more)
// active sessions restored with .active-set glow on ONLY the first restored
// tab. Root cause: AppShell's persisted-restore branch hardcoded
// `selectConversationDeferred(restoredTabs[0].id)` → only the first id ever
// reached the addToActiveSet path (via pending-flush → selectedId → Pretty
// ConversationsPanel effect). Task 3 fix iterates ALL restoredTabs, calling
// addToActiveSet per tab (see the #150 C-investigate comment block in
// AppShell.tsx for the full trace).
//
// This test is the store-level regression guard for the fix: mirror what
// the fixed AppShell does (per-tab addToActiveSet) and assert that BOTH
// ids land in activeSet. Expected to PASS trivially (the store contract is
// sound; the bug lived in AppShell not the store) — if it starts failing,
// the store-level assumption underneath the C-investigate mechanism has
// changed and the AppShell fix + the C-investigate comment must both be
// revisited.
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (patch #150 C): two-URL-tab restore glows both restored tabs", () => {
  it("per-tab addToActiveSet after updateOpenTabs lights BOTH tabs in activeSet", () => {
    const hostA = makeHost("hA", "alpha");
    const tabA = makeTab("restored-a", "terminal", hostA);
    const tabB = makeTab("restored-b", "terminal", hostA);

    // Mirror the fixed AppShell persisted-restore sequence:
    //   setTabs([...prev, tabA, tabB]) → React commit → updateOpenTabs
    //   setActiveTabId(tabA.id) → mirror
    //   for each restoredTab: addToActiveSet(t.id)   ← THE FIX
    //   selectConversationDeferred(tabA.id) → flushes into selectedId
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([tabA, tabB]);
      // The fix: addToActiveSet per restored tab so ALL glow, not just [0].
      addToActiveSet("restored-a");
      addToActiveSet("restored-b");
      // Retained for focus/selectedId behavior on the first tab only.
      selectConversationDeferred("restored-a");
    });

    const { result } = renderHook(() => useActiveSet());
    // BOTH restored tabs are in activeSet — the load-bearing assertion.
    expect(result.current.has("restored-a")).toBe(true);
    expect(result.current.has("restored-b")).toBe(true);
    expect(result.current.size).toBeGreaterThanOrEqual(2);

    // Selection landed on the first (focus contract preserved).
    expect(__getSnapshotForTest().selectedId).toBe("restored-a");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Patch #230 A — URL-driven restore glow parity (store-level contract).
// Ashley reported (2026-07-31, live diag with tina): loading a hash-restore
// URL only "activates" the ONE tab focused by active=<N>; other URL-hash
// tabs mount in the tab bar but stay ambient in pretty-conversations and
// don't connect their WebSocket until first click. Root cause paralleled
// patch #150 C's persisted-restore bug: AppShell.tsx's URL-driven block
// (~L969-978) called setActiveTabId + selectConversationDeferred on the
// active tab only, never looped addToActiveSet over openedIds. The fix
// mirrors #150 C's `for (const t of restoredTabs) addToActiveSet(t.id)`
// pattern into the URL-driven block.
//
// This test is the store-level regression guard for the URL-driven fix:
// mirror what the fixed AppShell does (per-tab addToActiveSet after the
// updateOpenTabs commit) and assert that ALL opened ids land in activeSet.
// Structurally identical to the #150 C test above; the AppShell fix location
// is different but the store-side contract is the same.
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (patch #230 A): URL-driven multi-tab restore glows all opened tabs", () => {
  it("per-tab addToActiveSet after updateOpenTabs lights ALL URL-opened tabs in activeSet", () => {
    const hostA = makeHost("hA", "alpha");
    // URL-restored tabs use openTab-generated dynamic ids
    // (`hostname-terminal-${Date.now()}-${counter}` in AppShell.tsx:1033).
    // Fake three such ids here to represent a #tab=A&tab=B&tab=C restore.
    const tabA = makeTab("alpha-terminal-9990-0", "terminal", hostA, "s1");
    const tabB = makeTab("alpha-terminal-9990-1", "terminal", hostA, "s2");
    const tabC = makeTab("alpha-terminal-9990-2", "terminal", hostA, "s3");

    // Mirror the fixed AppShell URL-driven block:
    //   for each spec: openTab(...) → openedIds.push(newId) → setTabs
    //   → updateOpenTabs (via useEffect)
    //   setActiveTabId(openedIds[idx]) → mirror
    //   selectConversationDeferred(openedIds[idx]) → active-tab focus
    //   for (const id of openedIds) addToActiveSet(id)   ← THE FIX
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([tabA, tabB, tabC]);
      const openedIds = [tabA.id, tabB.id, tabC.id];
      const idx = 1; // active=1 in the URL, i.e. tabB is focused
      selectConversationDeferred(openedIds[idx]);
      // The fix: addToActiveSet per opened id so ALL glow, not just [idx].
      for (const id of openedIds) addToActiveSet(id);
    });

    const { result } = renderHook(() => useActiveSet());
    // ALL three URL-opened tabs are in activeSet — the load-bearing assertion.
    expect(result.current.has(tabA.id)).toBe(true);
    expect(result.current.has(tabB.id)).toBe(true);
    expect(result.current.has(tabC.id)).toBe(true);
    expect(result.current.size).toBeGreaterThanOrEqual(3);

    // Selection landed on the active URL-index tab (focus contract preserved).
    expect(__getSnapshotForTest().selectedId).toBe(tabB.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Patch #230 B — pinned tier surfaces fleet-shadow pins on URL-restored openTabs.
// Ashley reported (2026-07-31, live diag): pin count differs by URL —
// loading with a hash-restore shows FEWER pins than the base URL. Root
// cause: server-persisted pins use fleet-format ids
// (`fleet::${hostId}::${sessionName}`). URL-hash restore calls openTab()
// which mints a dynamic id (`hostname-terminal-${Date.now()}-${counter}`,
// AppShell.tsx:1033). computeSnapshot then dedupes the matching fleet
// synthetic row OUT of fleetSyntheticRows (L324, "openTabs-entry-wins").
// The Tier 2 pinned iteration over conversationTabs checked
// `pinnedIds.has(tab.id)` — dynamic id doesn't match fleet-format pin →
// pin has nowhere to render. Fix: also check the openTab's fleet-shadow
// id `fleetRowId(parseInt(tab.host.id), tab.targetTmuxSession)` against
// pinnedIds. Post-quick-260818-l8n, pinnedIds are never pruned by
// updateOpenTabs at all, so the pin id trivially survives in state.
// pinnedIds regardless of openTabs / fleetSessions churn; this bug is
// render-side only.
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (patch #230 B): pinned tier surfaces fleet-shadow pins on URL-restored openTabs", () => {
  it("openTab with dynamic id + fleet-format pin renders in pinned tier via fleet-shadow-id check", () => {
    const hostA = makeHost("1", "alpha"); // host.id "1" so parseInt(host.id) = 1
    // Fleet session exists on hostId=1 with sessionName="work".
    const fleetSession: FleetSession = {
      hostId: 1,
      hostName: "alpha",
      sessionName: "work",
      created: 100,
    };
    // URL-restored openTab with a dynamic id (NOT the fleet-format id)
    // that shadows the fleet session via (host.id=1, targetTmuxSession="work").
    const tabDynamicId = "alpha-terminal-1785522000-0";
    const openTab = makeTab(tabDynamicId, "terminal", hostA, "work");
    // Server-persisted pin uses the FLEET-format id.
    const persistedPinId = fleetRowId(1, "work");

    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateFleetSessions([fleetSession]);
      updateOpenTabs([openTab]);
      hydratePinnedIdsFromServer([persistedPinId]);
    });

    const { result } = renderHook(() => useConversations());
    // The pin is rendered — via the openTab (fleet row got deduped out
    // by openTabs-entry-wins at L324).
    expect(result.current.pinned).toHaveLength(1);
    expect(result.current.pinned[0].id).toBe(tabDynamicId);
    // Sanity: the raw pinnedIds set still holds the fleet-format id.
    expect(__getSnapshotForTest().pinnedIds.has(persistedPinId)).toBe(true);
  });

  it("openTab with dynamic id + openTab-form pin ALSO still renders (backwards compat)", () => {
    const hostA = makeHost("1", "alpha");
    const openTab = makeTab("alpha-terminal-1785522000-0", "terminal", hostA, "work");

    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([openTab]);
      // Pin under the openTab-form id (the legacy path — e.g. user pinned
      // via the UI after opening the tab). Must continue to work.
      hydratePinnedIdsFromServer([openTab.id]);
    });

    const { result } = renderHook(() => useConversations());
    expect(result.current.pinned).toHaveLength(1);
    expect(result.current.pinned[0].id).toBe(openTab.id);
  });

  it("openTab WITHOUT targetTmuxSession does not fake-match a fleet-shadow pin", () => {
    // Defense-in-depth: the fleet-shadow-id check must only fire when
    // targetTmuxSession is non-null/non-empty (mirroring L303-306's
    // openTabsSessionKeys build). A hostless-or-sessionless tab must not
    // synthesize a fleet id and accidentally match an unrelated pin.
    const hostA = makeHost("1", "alpha");
    const openTab = makeTab("alpha-terminal-1785522000-0", "terminal", hostA, null);

    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([openTab]);
      // A pin exists for fleet::1::something but this tab has no session.
      hydratePinnedIdsFromServer([fleetRowId(1, "something")]);
    });

    const { result } = renderHook(() => useConversations());
    // Pinned tier must be empty — the openTab has no session to shadow, so
    // it can't claim the fleet pin.
    expect(result.current.pinned).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 30j-30p (Phase 15): pinnedIds ↔ server persistence
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (Phase 15): pinnedIds ↔ server persistence", () => {
  // Test 30j — pin fires PUT with the new post-mutation set (PIN-03).
  it("30j: pinConversation(id) adds id to pinnedIds AND fires putPinnedIds with the post-mutation set", () => {
    const hostA = makeHost("hA", "alpha");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([makeTab("t-A", "terminal", hostA)]);
    });

    const putSpy = vi.mocked(UserPreferencesApi.putPinnedIds);
    putSpy.mockClear(); // isolate from any updateOpenTabs-driven noise

    act(() => pinConversation("t-A"));

    // In-memory mutation happened
    const snap = __getSnapshotForTest();
    expect(snap.pinnedIds.has("t-A")).toBe(true);

    // Server write fired exactly once with the post-mutation set.
    // ordering guard: put must receive the post-mutation set (["t-A"]),
    // NOT the pre-mutation set ([]) — a future refactor that swaps the
    // compute-then-put ordering (putting stale state.pinnedIds instead
    // of nextPinnedIds) would silently drift pins on the server. The
    // assertion below MUST equal ["t-A"], not [].
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledWith(["t-A"]);
  });

  // Test 30k — unpin fires PUT with the reduced set (PIN-03).
  it("30k: unpinConversation(id) removes id from pinnedIds AND fires putPinnedIds with the reduced set", () => {
    const hostA = makeHost("hA", "alpha");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([makeTab("t-A", "terminal", hostA)]);
    });

    const putSpy = vi.mocked(UserPreferencesApi.putPinnedIds);

    // Pin first, then clear the spy so we count only the unpin write.
    act(() => pinConversation("t-A"));
    putSpy.mockClear();

    act(() => unpinConversation("t-A"));

    const snap = __getSnapshotForTest();
    expect(snap.pinnedIds.has("t-A")).toBe(false);

    // Server write fired once with the reduced (empty) set.
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledWith([]);
  });

  // Test 30l — idempotent no-op: pin on already-pinned id does NOT fire PUT.
  it("30l: pinConversation(id) on an already-pinned id does NOT fire putPinnedIds (idempotent)", () => {
    const hostA = makeHost("hA", "alpha");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([makeTab("t-A", "terminal", hostA)]);
    });

    const putSpy = vi.mocked(UserPreferencesApi.putPinnedIds);

    // First pin fires the write; clear the spy to isolate the second call.
    act(() => pinConversation("t-A"));
    putSpy.mockClear();

    // Second pin on the same id — early-return before the network call.
    act(() => pinConversation("t-A"));

    expect(putSpy).toHaveBeenCalledTimes(0);
  });

  // Test 30m — hydrate replaces stale in-memory pins with server-authoritative set (PIN-04 partial).
  it("30m: hydratePinnedIdsFromServer(ids) replaces state.pinnedIds and drops stale in-memory pins", () => {
    const hostA = makeHost("hA", "alpha");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([
        makeTab("t-A", "terminal", hostA),
        makeTab("t-B", "terminal", hostA),
      ]);
    });

    // Seed two in-memory pins.
    act(() => {
      pinConversation("t-A");
      pinConversation("t-B");
    });

    const putSpy = vi.mocked(UserPreferencesApi.putPinnedIds);
    putSpy.mockClear();

    // Hydrate with a completely different set — the two prior pins must be
    // dropped and replaced with only "fresh-1".
    act(() => hydratePinnedIdsFromServer(["fresh-1"]));

    const snap = __getSnapshotForTest();
    expect(snap.pinnedIds.size).toBe(1);
    expect(snap.pinnedIds.has("fresh-1")).toBe(true);
    expect(snap.pinnedIds.has("t-A")).toBe(false);
    expect(snap.pinnedIds.has("t-B")).toBe(false);

    // Hydrate is a pure setter — NO write-back to server.
    expect(putSpy).toHaveBeenCalledTimes(0);
  });

  // Test 30n — server error does not roll back the optimistic pin (PIN-05).
  it("30n: putPinnedIds rejection does NOT roll back the optimistic pin (retry-on-next-sync)", async () => {
    const hostA = makeHost("hA", "alpha");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([makeTab("t-A", "terminal", hostA)]);
    });

    const putSpy = vi.mocked(UserPreferencesApi.putPinnedIds);
    putSpy.mockRejectedValueOnce(new Error("network"));

    act(() => pinConversation("t-A"));

    // Flush the microtask queue so the rejected promise settles before we assert.
    await Promise.resolve();
    await Promise.resolve();

    const snap = __getSnapshotForTest();
    // PIN-05 locked semantics: optimistic pin stays even though write failed.
    expect(snap.pinnedIds.has("t-A")).toBe(true);
  });

  // Test 30o — same-content hydrate does not bump snapshotVersion.
  it("30o: hydratePinnedIdsFromServer with identical content does NOT bump notify() (same-content guard)", () => {
    const hostA = makeHost("hA", "alpha");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([makeTab("t-A", "terminal", hostA)]);
    });

    act(() => pinConversation("t-A"));

    // Subscribe a spy so we can count notify() calls across a same-content hydrate.
    const notifySpy = vi.fn();
    const unsubscribe = __subscribeForTest(notifySpy);

    // Hydrate with content identical to current state.pinnedIds ({"t-A"}).
    act(() => hydratePinnedIdsFromServer(["t-A"]));

    // Same-content guard: notify() must NOT have fired.
    expect(notifySpy).toHaveBeenCalledTimes(0);

    unsubscribe();
  });

  // Test 30p — SC6 rollout scaffold: echo-mismatch fires console.warn.
  // Runs against the REAL putPinnedIds (bypasses the module mock via
  // vi.importActual) and stubs authApi.put at the axios layer so the real
  // comparison logic executes. Both `sent` and `echoed` keys must be
  // present on the warn payload — this is the JSON-endpoint substrate
  // the SC6 rollout window relies on to detect silent-drop regressions.
  it("30p: putPinnedIds console.warn's with [pin-persistence] server echo mismatch when server echoes a differing array", async () => {
    const [{ putPinnedIds: realPutPinnedIds }, { authApi }] = await Promise.all([
      vi.importActual<typeof import("@/api/user-preferences-api")>(
        "@/api/user-preferences-api",
      ),
      import("@/main-axios"),
    ]);

    const putSpy = vi
      .spyOn(authApi, "put")
      .mockResolvedValueOnce({
        data: { pinnedConversationIds: ["b", "a"] },
      });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await realPutPinnedIds(["a", "b"]);

    // Server echo is authoritative — putPinnedIds returns what the server sent.
    expect(result).toEqual(["b", "a"]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[pin-persistence] server echo mismatch",
      expect.objectContaining({ sent: ["a", "b"], echoed: ["b", "a"] }),
    );

    warnSpy.mockRestore();
    putSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// quick-260727-kbw: fleetSessionsLoaded flag + useFleetSessionsLoaded hook
// ─────────────────────────────────────────────────────────────────────────────
// Locks the load-order gate the panel mount effect depends on. Sequence:
//   - flag starts false at t=0
//   - updateFleetSessions() flips it true unconditionally, including empty []
//   - the false→true flip MUST fire notify() even if the sessions array is
//     a shallow no-op (that's the whole point — panel subscribers need to
//     learn "load complete" via subscribe(), not via getSnapshot() polling)
//   - subsequent same-ref calls with the flag already true stay full no-ops
//   - the hook re-renders on the flip
describe("fleetSessionsLoaded flag + useFleetSessionsLoaded hook (quick-260727-kbw)", () => {
  it("fleetSessionsLoaded starts false at t=0 (after __resetFleetSessionsForTest)", () => {
    // Explicit reset to observe the pre-flip state. beforeEach fires
    // updateFleetSessions([]) which — post-fix — flips the flag true; the
    // reset helper restores the module-init state so this test can see the
    // false starting point directly.
    act(() => __resetFleetSessionsForTest());
    const { result } = renderHook(() => useFleetSessionsLoaded());
    expect(result.current).toBe(false);
  });

  it("updateFleetSessions with a non-empty array flips fleetSessionsLoaded to true and fires notify() once", () => {
    act(() => __resetFleetSessionsForTest());

    const cb = vi.fn();
    const unsub = __subscribeForTest(cb);

    const sessions: FleetSession[] = [
      { hostId: 7, hostName: "hostA", sessionName: "aqua", created: 100 },
    ];
    act(() => updateFleetSessions(sessions));

    const { result } = renderHook(() => useFleetSessionsLoaded());
    expect(result.current).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
  });

  it("updateFleetSessions with an empty [] array ALSO flips fleetSessionsLoaded to true and fires notify() once (critical: empty counts as loaded)", () => {
    act(() => __resetFleetSessionsForTest());

    const cb = vi.fn();
    const unsub = __subscribeForTest(cb);

    // The load-bearing assertion: an empty [] dispatch with the flag currently
    // false must still fire notify() because the flag transition is a real
    // state change. Post-fix, updateFleetSessions([]) is NOT a no-op when the
    // flag was false — the sessions-array short-circuit is bypassed by the
    // needsFlagFlip predicate.
    act(() => updateFleetSessions([]));

    const { result } = renderHook(() => useFleetSessionsLoaded());
    expect(result.current).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
  });

  it("second updateFleetSessions call with the SAME ref array does NOT fire notify() (flag already true, sessions array ref-equal)", () => {
    const sessions: FleetSession[] = [
      { hostId: 7, hostName: "hostA", sessionName: "aqua", created: 100 },
    ];
    // Prime: first call transitions flag false→true AND lands the array.
    act(() => __resetFleetSessionsForTest());
    act(() => updateFleetSessions(sessions));

    const cb = vi.fn();
    const unsub = __subscribeForTest(cb);

    // Same-ref dispatch twice — flag is already true, array is ref-equal.
    // Both dispatches MUST be full no-ops. Total notify()s from these two
    // dispatches: exactly 0.
    updateFleetSessions(sessions);
    updateFleetSessions(sessions);
    expect(cb).toHaveBeenCalledTimes(0);

    unsub();
  });

  it("subsequent updateFleetSessions([]) after flag already true is a full no-op (no notify)", () => {
    // The no-op path proof: sessions are shallow-equal (both empty) AND the
    // flag is already true. Must NOT bump snapshotVersion. beforeEach already
    // fired updateFleetSessions([]) so the flag is true here.
    const cb = vi.fn();
    const unsub = __subscribeForTest(cb);

    act(() => updateFleetSessions([]));
    expect(cb).toHaveBeenCalledTimes(0);

    unsub();
  });

  it("useFleetSessionsLoaded re-renders when the flag flips false→true", () => {
    act(() => __resetFleetSessionsForTest());

    const { result } = renderHook(() => useFleetSessionsLoaded());
    expect(result.current).toBe(false);

    act(() => updateFleetSessions([]));
    expect(result.current).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// quick-260727-kbw: regression — fleet pin survives updateOpenTabs when
// hydrated after fleet load
// ─────────────────────────────────────────────────────────────────────────────
// Historical context: pre-quick-260818-l8n, updateOpenTabs ran a pin
// scrubber keyed on `nextIds ∪ fleet-keep-set`. If hydrate happened before
// updateFleetSessions, the fleet keep-set would have been empty and the
// scrubber would have nuked the just-hydrated fleet pin. quick-260727-kbw
// added the fleetSessionsLoaded gate on the panel so hydrate ALWAYS ran
// after fleet load. quick-260818-l8n retired the scrubber outright — the
// pin survives updateOpenTabs([]) because updateOpenTabs no longer touches
// pinnedIds at all. This test is retained as an invariant guard: any
// regression that re-introduces openTabs-driven pin scrubbing (in ANY
// form) trips this assertion.
describe("regression: fleet pin survives updateOpenTabs when hydrated after fleet load (quick-260727-kbw)", () => {
  it("fleet::7::aqua survives updateOpenTabs([]) when hydrated after updateFleetSessions", () => {
    // Step 1: fleet loads first (mirrors the fixed panel ordering).
    act(() =>
      updateFleetSessions([
        { hostId: 7, hostName: "hostA", sessionName: "aqua", created: 100 },
      ]),
    );

    // Step 2: hydrate the fleet pin from the server
    act(() => hydratePinnedIdsFromServer(["fleet::7::aqua"]));

    // Sanity check: the pin landed in state.pinnedIds
    let snap = __getSnapshotForTest();
    expect(snap.pinnedIds.has("fleet::7::aqua")).toBe(true);

    // Step 3: routine empty tab-list re-emission. Pre-retire-pruner this
    // path built a fleet-aware keep-set from state.fleetSessions and kept
    // fleet::7::aqua via that set; post-retire (quick-260818-l8n) the path
    // is a no-op on pinnedIds — the pin survives because updateOpenTabs
    // never touches pinnedIds at all.
    act(() => updateOpenTabs([]));

    // The load-bearing assertion: fleet::7::aqua is STILL pinned.
    snap = __getSnapshotForTest();
    expect(snap.pinnedIds.has("fleet::7::aqua")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 25 (RETARGETED Phase 41 Plan 01): role-clustering sort regression tests
//
// Phase 41 retired `compareByHostRoleLabel` from the middle-zone sort site — the
// middle now uses `compareByRecencyDesc` with insertion-order fallback. The
// (host, role, label) tuple contract SURVIVES in activeSet, pinned, and
// rdpGroup. These regression tests retarget from the retired middle-tier
// site to the PINNED tier (or activeSet where noted) so the role-clustering
// contract remains locked at its surviving sort sites.
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (Phase 25 retargeted Phase 41 Plan 01): role-clustering sort on surviving tiers", () => {
  // Locks: §Sort semantics tuple order (host outer, role middle, label inner)
  // on the PINNED tier (retargeted from the retired Tier 3 middle-bucket site).
  it("role-clustering within pinned tier — identities with same role cluster together", () => {
    const hostA = makeHost("hA", "alpha");
    const tabOrwell = makeTab("t-orwell", "terminal", hostA, "orwell", "orwell");
    const tabAsimov = makeTab("t-asimov", "terminal", hostA, "asimov", "asimov");
    const tabOrwellClone = makeTab("t-orwell-clone", "terminal", hostA, "orwell-clone", "orwell-clone");

    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([tabOrwell, tabAsimov, tabOrwellClone]);
      updateIdentitiesByKey(
        identitiesMap(
          makeIdentity("orwell", "novelist"),
          makeIdentity("asimov", "essayist"),
          makeIdentity("orwell-clone", "novelist"),
        ),
      );
      // Pin all three so compareByHostRoleLabel drives their order.
      pinConversation("t-orwell");
      pinConversation("t-asimov");
      pinConversation("t-orwell-clone");
    });

    const snap = __getSnapshotForTest();
    // essayist ("asimov") sorts before novelist ("orwell*") alphabetically on role.
    // Within novelist: "orwell" < "orwell-clone" on label.
    expect(snap.pinned.map((r) => r.label)).toEqual([
      "asimov",
      "orwell",
      "orwell-clone",
    ]);
  });

  // Phase 42 UAT amendment 2026-08-17 (Ashley verbatim): "sessions are still
  // showing above the pinned area when they are active in the current instance
  // of the client. That shouldn't happen." — the activeSet render tier is
  // retired. The previous "host is outer sort key in ActiveSet — same-role
  // rows from different hosts stay host-ordered" test is DELETED; the same
  // host-outer sort semantic is exhaustively covered by the sibling test
  // "host is outer sort key in Pinned — same-role rows from different hosts
  // stay host-ordered" immediately below (identical two-host architect setup
  // on a surviving tier).

  // Locks: §Sort semantics "applies to all three tiers, not just Tier 3" —
  // Pinned tier must also honour host-outer ordering.
  it("host is outer sort key in Pinned — same-role rows from different hosts stay host-ordered", () => {
    const hostA = makeHost("hA", "alpha");
    const hostB = makeHost("hB", "beta");
    const tabA = makeTab("t-a", "terminal", hostA, "sess-a", "sess-a");
    const tabB = makeTab("t-b", "terminal", hostB, "sess-b", "sess-b");

    act(() => {
      updateHostTree({ name: "root", children: [hostA, hostB] });
      updateOpenTabs([tabB, tabA]); // intentionally reversed insertion order
      updateIdentitiesByKey(
        identitiesMap(
          makeIdentity("sess-a", "architect"),
          makeIdentity("sess-b", "architect"),
        ),
      );
      pinConversation("t-a");
      pinConversation("t-b");
    });

    const snap = __getSnapshotForTest();
    // Both rows share role "architect" → tie on role → host outer key resolves:
    // "alpha" < "beta" → hostA row first.
    expect(snap.pinned.map((r) => r.host?.name)).toEqual(["alpha", "beta"]);
  });

  // Locks: §Null-role handling — retargeted to the PINNED tier (Phase 41 Plan 01).
  it("null-role rows sort last within pinned tier — even when their label would sort first alphabetically", () => {
    const hostA = makeHost("hA", "alpha");
    // Label chosen to sort FIRST under a pure-label comparator (a < arch < build).
    // Phase 25 null-role-last must override and place this row LAST because
    // "unmapped-session" has no entry in identitiesByKey → role resolves null.
    const tabAaa = makeTab("t-aaa", "terminal", hostA, "unmapped-session", "aaa-would-be-first");
    const tabArch = makeTab("t-arch", "terminal", hostA, "arch-session", "arch");
    const tabBuild = makeTab("t-build", "terminal", hostA, "build-session", "build");

    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([tabAaa, tabArch, tabBuild]);
      // "unmapped-session" has NO entry in identitiesByKey → role resolves null
      updateIdentitiesByKey(
        identitiesMap(
          makeIdentity("arch-session", "architect"),
          makeIdentity("build-session", "builder"),
        ),
      );
      pinConversation("t-aaa");
      pinConversation("t-arch");
      pinConversation("t-build");
    });

    const snap = __getSnapshotForTest();
    // "architect" < "builder" on role → arch before build.
    // Null-role tab sorts LAST despite its label being alphabetically first —
    // this is the load-bearing behavioral gate for §Null-role handling.
    expect(snap.pinned.map((r) => r.label)).toEqual([
      "arch",
      "build",
      "aaa-would-be-first",
    ]);
  });

  // Locks: §Sort semantics "case-insensitive alphabetical throughout" for ROLE.
  // Disambiguation fixture: four roles including "Box-Maintainer" and "box-maintainer"
  // (same role under sensitivity:"base") plus "q-role" and "zeta-role".
  // Case-insensitive order: Box-Maintainer == box-maintainer < q-role < zeta-role
  //   → output: [bm-a, bm-b, q-tab, zed]
  // Case-sensitive order: B(66) < q(113) < z(122) < b(98)
  //   → output: [bm-a, q-tab, zed, bm-b]   (bm-b has lowercase "box-maintainer")
  // The assertion [bm-a, bm-b, q-tab, zed] is only achievable under case-insensitive.
  it("5a: role compare is case-insensitive on pinned tier — Box-Maintainer and box-maintainer cluster together before q-role and zeta-role", () => {
    const hostA = makeHost("hA", "alpha");
    const tabBmA = makeTab("t-bm-a", "terminal", hostA, "bm-a-sess", "bm-a");
    const tabBmB = makeTab("t-bm-b", "terminal", hostA, "bm-b-sess", "bm-b");
    const tabQ = makeTab("t-q", "terminal", hostA, "q-sess", "q-tab");
    const tabZed = makeTab("t-zed", "terminal", hostA, "zed-sess", "zed");

    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([tabBmA, tabBmB, tabQ, tabZed]);
      updateIdentitiesByKey(
        identitiesMap(
          makeIdentity("bm-a-sess", "Box-Maintainer"),
          makeIdentity("bm-b-sess", "box-maintainer"),
          makeIdentity("q-sess", "q-role"),
          makeIdentity("zed-sess", "zeta-role"),
        ),
      );
      pinConversation("t-bm-a");
      pinConversation("t-bm-b");
      pinConversation("t-q");
      pinConversation("t-zed");
    });

    const snap = __getSnapshotForTest();
    // Case-insensitive: "Box-Maintainer" == "box-maintainer" (both cluster at head)
    // then "q-role" < "zeta-role". The two bm rows cluster first (positions 0+1),
    // then q-tab, then zed. This order is ONLY possible with sensitivity:"base".
    const labels = snap.pinned.map((r) => r.label);
    // The bm cluster must be at indices 0 and 1 (in either internal order)
    expect(labels.slice(0, 2).sort()).toEqual(["bm-a", "bm-b"]);
    expect(labels[2]).toBe("q-tab");
    expect(labels[3]).toBe("zed");
  });

  // Locks: §Sort semantics "case-insensitive alphabetical throughout" for LABEL.
  // Within the same role, "Alpha" and "alpha" are equivalent under sensitivity:"base"
  // — both sort before "Zebra". Under case-sensitive compare: A(65) < Z(90) < a(97).
  it("5b: label compare within a role is case-insensitive on pinned tier — Alpha and alpha cluster before Zebra", () => {
    const hostA = makeHost("hA", "alpha");
    const tabAlphaUpper = makeTab("t-au", "terminal", hostA, "au-sess", "Alpha");
    const tabAlphaLower = makeTab("t-al", "terminal", hostA, "al-sess", "alpha");
    const tabZebra = makeTab("t-z", "terminal", hostA, "z-sess", "Zebra");

    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([tabZebra, tabAlphaUpper, tabAlphaLower]); // reversed insertion
      updateIdentitiesByKey(
        identitiesMap(
          makeIdentity("au-sess", "novelist"),
          makeIdentity("al-sess", "novelist"),
          makeIdentity("z-sess", "novelist"),
        ),
      );
      pinConversation("t-au");
      pinConversation("t-al");
      pinConversation("t-z");
    });

    const snap = __getSnapshotForTest();
    // All three share role "novelist" → fall to label inner key.
    // Case-insensitive: "Alpha" == "alpha" (cluster at positions 0+1) < "Zebra".
    const lowerLabels = snap.pinned.map((r) => r.label.toLowerCase());
    expect(lowerLabels.slice(0, 2).sort()).toEqual(["alpha", "alpha"]);
    expect(lowerLabels[2]).toBe("zebra");
  });

  // Locks: §Sort semantics "within each role, sort by label" — retargeted to pinned tier.
  it("same-role different-label falls to label on pinned tier — rows with shared role sort alphabetically by label", () => {
    const hostA = makeHost("hA", "alpha");
    const tabMike = makeTab("t-mike", "terminal", hostA, "mike-sess", "mike");
    const tabAlice = makeTab("t-alice", "terminal", hostA, "alice-sess", "alice");
    const tabZed = makeTab("t-zed", "terminal", hostA, "zed-sess", "zed");

    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([tabMike, tabAlice, tabZed]);
      updateIdentitiesByKey(
        identitiesMap(
          makeIdentity("mike-sess", "builder"),
          makeIdentity("alice-sess", "builder"),
          makeIdentity("zed-sess", "builder"),
        ),
      );
      pinConversation("t-mike");
      pinConversation("t-alice");
      pinConversation("t-zed");
    });

    const snap = __getSnapshotForTest();
    // All three share role "builder" → tie on role → label inner key.
    // Alphabetical label order: alice < mike < zed.
    expect(snap.pinned.map((r) => r.label)).toEqual([
      "alice",
      "mike",
      "zed",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 41 Plan 01: middle-zone recency sort — compareByRecencyDesc contract
//
// These tests lock the four rules from the plan's <behavior> block:
//   Rule 1: no-history rows (lastMessageAt == null) sort BEFORE rows with a timestamp
//   Rule 2: among no-history rows, insertion-order key breaks ties
//   Rule 3: among rows with timestamps, lastMessageAt DESC (freshest first)
//   Rule 4: identical lastMessageAt values fall back to insertion-order key
//
// The rows in these tests are constructed by manually stamping lastMessageAt
// on the underlying tab-derived rows via a small helper. Plan 03 has NOT yet
// landed the real fleet-status protocol extension; these tests exercise the
// comparator's contract by directly constructing rows with test lastMessageAt
// values — they will keep passing once Plan 03 lands the wire-side signal.
// ─────────────────────────────────────────────────────────────────────────────

// Helper: forcibly set lastMessageAt on the tab-derived row by post-hoc
// mutation after the snapshot is computed. Since rowFromTab does not read
// tab.lastMessageAt today (Plan 03 will), the pragmatic path for these tests
// is to construct a row directly and inject it via the fleet-synthetic path
// or by using a small test-fixture Tab type with lastMessageAt on the row.
//
// Simplest approach: construct openTabs whose derived rows have specific
// insertion-order + labels, then patch each snapshot row's lastMessageAt
// via a shallow Object.assign before re-running the sort comparator directly.
// But that would test the comparator in isolation, not the store's use of it.
//
// Cleaner: extend the makeTab helper with a lastMessageAt field that flows
// through rowFromTab. Adding that flow to the store is a small, forward-
// compatible change that stays inert until Plan 03 populates the field.

// See the store's rowFromTab — Phase 41 Plan 01 adds a `lastMessageAt` pass-
// through hook that reads from a test-injected map. To keep this test file
// deterministic without introducing production-code plumbing that Plan 03
// will supersede, we inject lastMessageAt via a post-hoc row-object patch
// in a separate WeakMap indexed by `sessionName` — see rowLastMessageAt
// below. The store's comparator reads row.lastMessageAt directly, so
// patching row.lastMessageAt after snapshot construction and re-running
// comparator assertions is functionally equivalent to Plan 03's wire signal.

describe("conversation-store (Phase 41 Plan 01): compareByRecencyDesc — middle-zone recency contract", () => {
  // Test C — Phase 44 Plan 04 FLIP: null-to-bottom rule (was null-to-top).
  // Retires Ashley's 2026-08-14 no-history-to-top lock per 44-CONTEXT.md
  // § Comparator change — retire no-history-to-top.
  it("Test C: no-history row (lastMessageAt=null) sorts AFTER a row with any timestamp (Phase 44 Plan 04 flip)", () => {
    const hostA = makeHost("hA", "alpha");
    // Two rows: R1 has lastMessageAt = 1000 (has history), R2 = null (fresh).
    const tabR1 = makeTab("r1", "terminal", hostA, "r1-sess", "r1");
    const tabR2 = makeTab("r2", "terminal", hostA, "r2-sess", "r2");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([tabR1, tabR2]);
    });
    let snap = __getSnapshotForTest();
    // Baseline: insertion-order fallback [r1, r2] (both lastMessageAt = null).
    expect(snap.middle.map((r) => r.id)).toEqual(["r1", "r2"]);
    // Inject via the Phase 41 test-only API: r1 gets a real timestamp;
    // r2 stays null (no-history).
    act(() => __setLastMessageAtForTest("r1", 1000));
    snap = __getSnapshotForTest();
    // Phase 44 Plan 04: r1 (1000, real) sorts BEFORE r2 (null) — null-to-bottom.
    // This is the load-bearing behavioral gate for the flip.
    expect(snap.middle.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  // Test D — recency DESC.
  it("Test D: two rows with timestamps sort by lastMessageAt DESC (freshest first)", () => {
    const hostA = makeHost("hA", "alpha");
    const tabR1 = makeTab("r1", "terminal", hostA, "r1-sess", "r1");
    const tabR2 = makeTab("r2", "terminal", hostA, "r2-sess", "r2");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([tabR1, tabR2]);
    });
    // Inject: r1 = 2000, r2 = 1000. Freshest is r1.
    act(() => {
      __setLastMessageAtForTest("r1", 2000);
      __setLastMessageAtForTest("r2", 1000);
    });
    const snap = __getSnapshotForTest();
    // r1 (2000) sorts before r2 (1000) — DESC.
    expect(snap.middle.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  // Test G — pinned tier does NOT recency-sort. Even with two pinned rows
  // where one has a fresher lastMessageAt, they sort by compareByHostRoleLabel
  // (label order), NOT by recency. Locks the "pins don't shuffle on activity"
  // contract post-Plan-03.
  it("Test G: pinned zone stays (host, role, label) — does NOT shuffle when a row's lastMessageAt changes", () => {
    const hostA = makeHost("hA", "alpha");
    // Two pinned rows with labels chosen to put "zebra" alphabetically LAST.
    // If pinned recency-sorted DESC, the row with the newer lastMessageAt
    // would jump to the top. compareByHostRoleLabel (label ASC) puts "alpha"
    // first regardless of recency.
    const tabA = makeTab("t-alpha-row", "terminal", hostA, "alpha-sess", "alpha-label");
    const tabZ = makeTab("t-zebra-row", "terminal", hostA, "zebra-sess", "zebra-label");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([tabA, tabZ]);
      pinConversation("t-alpha-row");
      pinConversation("t-zebra-row");
    });
    // Inject: zebra is FRESHER than alpha.
    act(() => {
      __setLastMessageAtForTest("t-zebra-row", 9999);
      __setLastMessageAtForTest("t-alpha-row", 1);
    });
    const snap = __getSnapshotForTest();
    // Label order still wins: alpha-label < zebra-label. Recency is IGNORED
    // in the pinned zone.
    expect(snap.pinned.map((r) => r.label)).toEqual(["alpha-label", "zebra-label"]);
  });

  // Test H — RDP zone stays (host, role, label) — analogous to G for rdpGroup.
  // Locks the "RDP rows don't shuffle" contract post-Plan-03.
  it("Test H: RDP zone stays (host, role, label) — does NOT shuffle when a row's lastMessageAt changes", () => {
    // Two RDP-enabled hosts with names that place "alpha" alphabetically first.
    const hostAlpha = makeHost("1", "alpha-box", { enableRdp: true });
    const hostZebra = makeHost("2", "zebra-box", { enableRdp: true });
    act(() => {
      updateHostsFlat(
        new Map<number, Host>([
          [1, hostAlpha],
          [2, hostZebra],
        ]),
      );
    });
    let snap = __getSnapshotForTest();
    expect(snap.rdpGroup).not.toBeNull();
    // Inject via the RDP row ids (deterministic shape: rdp-host::${host.id}).
    act(() => {
      __setLastMessageAtForTest("rdp-host::2", 9999); // zebra fresher
      __setLastMessageAtForTest("rdp-host::1", 1);
    });
    snap = __getSnapshotForTest();
    // Label order still wins: alpha-box < zebra-box. Recency is IGNORED
    // in the RDP zone.
    expect(snap.rdpGroup!.rows.map((r) => r.label)).toEqual([
      "alpha-box",
      "zebra-box",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 41 Plan 03: real fleet-status wire-side signal drives middle-zone sort
//
// These tests exercise the FULL path from `publishFleetStatusSessionState` in
// the working-store → session-working-store cache → conversation-store row
// derivation stamps `row.lastMessageAt` from `getSessionLastMessageAt(
// sessionWorkingKey(row))` → compareByRecencyDesc re-orders.
//
// Locks the wire-to-render contract that Plan 03 closes. The tests use REAL
// production `publishFleetStatusSessionState` — no test-only injection API —
// so a break anywhere along the pipeline (frontend cache write, conversation-
// store subscription bridge, row stamping, comparator input) fails one of
// these tests.
// ─────────────────────────────────────────────────────────────────────────────

// Isolate imports to the tests below — top-level file imports must not be
// re-declared, but these helpers are only used by Phase 41 Plan 03 tests.
import {
  publishFleetStatusSessionState,
  __resetForTest as __resetSessionWorkingForTest,
} from "./session-working-store.js";
import type { SessionState } from "../api/fleet-status-types.js";

describe("conversation-store (Phase 41 Plan 03): real fleet-status wire-side signal drives middle-zone sort", () => {
  // Fresh session-working store per test so a prior test's publish does not
  // leak forward into the next test's snapshot.
  beforeEach(() => {
    __resetSessionWorkingForTest();
  });

  function makeSessionState(
    hostId: string,
    tmuxSession: string | null,
    lastMessageAt: number | null,
    overrides: Partial<SessionState> = {},
  ): SessionState {
    return {
      hostId,
      tmuxSession,
      sessionId: `sess-${hostId}-${tmuxSession ?? "null"}`,
      pid: 1,
      status: "idle",
      backgroundTasks: [],
      updatedAt: Date.now(),
      lastMessageAt,
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------------
  // Test I: two rows in the middle zone, publish real lastMessageAt via
  //          publishFleetStatusSessionState → DESC-by-recency order emerges.
  // ---------------------------------------------------------------------------
  it("Test I: real fleet-status publish → middle zone sorts DESC by lastMessageAt (freshest first)", () => {
    const hostA = makeHost("1", "hostA"); // host.id must be numeric so working-key = "1:sess-name"
    const tab1 = makeTab("t1", "terminal", hostA, "sess-1", "row-1");
    const tab2 = makeTab("t2", "terminal", hostA, "sess-2", "row-2");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([tab1, tab2]);
    });
    // Publish real fleet-status frames: sess-2 is FRESHER than sess-1.
    act(() => {
      publishFleetStatusSessionState(
        "1",
        makeSessionState("1", "sess-1", 1000),
      );
      publishFleetStatusSessionState(
        "1",
        makeSessionState("1", "sess-2", 2000),
      );
    });
    const snap = __getSnapshotForTest();
    // sess-2 (2000) sorts before sess-1 (1000) — DESC by lastMessageAt.
    expect(snap.middle.map((r) => r.id)).toEqual(["t2", "t1"]);
  });

  // ---------------------------------------------------------------------------
  // Test J: mix of published + un-published rows — Phase 44 Plan 04 flip. The
  //          real-timestamp row now sorts to the TOP; the no-wire-side-signal
  //          row (null lastMessageAt) sinks to the BOTTOM (null-to-bottom).
  //          Retires the pre-Phase-44 assertion that expected null-to-top.
  // ---------------------------------------------------------------------------
  it("Test J: middle zone — row with real lastMessageAt vs. row with no wire-side signal → real-timestamp row sorts to top, no-history row sinks (Phase 44 Plan 04 flip)", () => {
    const hostA = makeHost("1", "hostA");
    const tab1 = makeTab("t1", "terminal", hostA, "sess-1", "row-1");
    const tab2 = makeTab("t2", "terminal", hostA, "sess-2", "row-2");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([tab1, tab2]);
    });
    // Only sess-1 has a wire-side lastMessageAt; sess-2's key is never
    // published → the working-store cache has no entry for it → conversation-
    // store's row derivation stamps `lastMessageAt: null` on that row →
    // Phase 44 Plan 04's null-to-bottom rule sinks it below the row with real
    // history.
    act(() => {
      publishFleetStatusSessionState(
        "1",
        makeSessionState("1", "sess-1", 1000),
      );
    });
    const snap = __getSnapshotForTest();
    // Phase 44 Plan 04: sess-1 (1000, real) sorts BEFORE sess-2 (null) —
    // null-to-bottom via the real fleet-status wire path.
    expect(snap.middle.map((r) => r.id)).toEqual(["t1", "t2"]);
  });

  // ---------------------------------------------------------------------------
  // Test K: recency-change re-orders — publishing a fresher lastMessageAt for
  //          the currently-second row moves it to position 0. Locks the "row
  //          jumps to top on message activity" contract at the wire level.
  // ---------------------------------------------------------------------------
  it("Test K: publishing a NEWER lastMessageAt for the currently-second row moves it to position 0", () => {
    const hostA = makeHost("1", "hostA");
    const tab1 = makeTab("t1", "terminal", hostA, "sess-1", "row-1");
    const tab2 = makeTab("t2", "terminal", hostA, "sess-2", "row-2");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([tab1, tab2]);
    });
    // Initial: sess-1 is fresher (t1 at position 0, t2 at position 1).
    act(() => {
      publishFleetStatusSessionState(
        "1",
        makeSessionState("1", "sess-1", 2000),
      );
      publishFleetStatusSessionState(
        "1",
        makeSessionState("1", "sess-2", 1000),
      );
    });
    let snap = __getSnapshotForTest();
    expect(snap.middle.map((r) => r.id)).toEqual(["t1", "t2"]);
    // Now sess-2 gets a NEWER message → row t2 must jump to position 0.
    act(() => {
      publishFleetStatusSessionState(
        "1",
        makeSessionState("1", "sess-2", 3000),
      );
    });
    snap = __getSnapshotForTest();
    expect(snap.middle.map((r) => r.id)).toEqual(["t2", "t1"]);
  });

  // ---------------------------------------------------------------------------
  // Test L: pinned zone under REAL recency data — pins do NOT shuffle when the
  //          wire-side lastMessageAt makes zebra fresher than alpha. Locks Plan
  //          01's Ashley lock #2 survives real signal flowing through the
  //          wire path (analogous to Test G but via publishFleetStatusSessionState
  //          rather than the test-only injection API).
  // ---------------------------------------------------------------------------
  it("Test L: pinned zone under REAL wire-side recency data — does NOT shuffle when zebra publishes a fresher lastMessageAt", () => {
    const hostA = makeHost("1", "hostA");
    const tabA = makeTab("t-alpha-row", "terminal", hostA, "alpha-sess", "alpha-label");
    const tabZ = makeTab("t-zebra-row", "terminal", hostA, "zebra-sess", "zebra-label");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([tabA, tabZ]);
      pinConversation("t-alpha-row");
      pinConversation("t-zebra-row");
    });
    // Zebra publishes a FRESHER lastMessageAt via the real wire path.
    act(() => {
      publishFleetStatusSessionState(
        "1",
        makeSessionState("1", "zebra-sess", 9999),
      );
      publishFleetStatusSessionState(
        "1",
        makeSessionState("1", "alpha-sess", 1),
      );
    });
    const snap = __getSnapshotForTest();
    // Label order still wins in the pinned zone regardless of wire-side
    // recency. Recency is IGNORED — pinned rows use compareByHostRoleLabel.
    expect(snap.pinned.map((r) => r.label)).toEqual([
      "alpha-label",
      "zebra-label",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 44 Plan 04 — FleetSession lastMessageAt field + cache round-trip
//
// Task 1 coverage: FleetSession type gains optional lastMessageAt; isFleetSession
// predicate accepts undefined/null/number for lastMessageAt (rejects other types);
// readFleetSessionsCache preserves the field (coerces undefined → null);
// writeFleetSessionsCache persists it. Cache key bumped v1 → v2.
// ─────────────────────────────────────────────────────────────────────────────

describe("conversation-store (Phase 44 Plan 04): FleetSession lastMessageAt cache round-trip", () => {
  // Phase 47 Plan 01: cache key bumped v2 → v3 (aiTitle addition). Local const
  // renamed from the prior v2-suffixed name to track the current v3 key.
  const FLEET_CACHE_KEY_V3 = "skynet:convo-fleet-cache:v3";

  beforeEach(() => {
    try {
      localStorage.removeItem(FLEET_CACHE_KEY_V3);
      // Also clear any lingering v1 or v2 entry so a pre-bump cache from a
      // previous test run does NOT leak into the v3 read (which would correctly
      // return [] — this beforeEach is defense in depth).
      localStorage.removeItem("skynet:convo-fleet-cache:v1");
      localStorage.removeItem("skynet:convo-fleet-cache:v2");
    } catch {
      /* jsdom localStorage always available */
    }
  });

  it("Task 1 – Test A: writeFleetSessionsCache persists lastMessageAt (number + null both survive round-trip via read)", () => {
    const sessions: FleetSession[] = [
      { hostId: 1, hostName: "hA", sessionName: "s-real", created: 100, role: null, lastMessageAt: 12345 },
      { hostId: 2, hostName: "hB", sessionName: "s-null", created: 200, role: "sre", lastMessageAt: null },
    ];
    writeFleetSessionsCache(sessions);
    const read = readFleetSessionsCache();
    expect(read.length).toBe(2);
    expect(read[0].lastMessageAt).toBe(12345);
    expect(read[1].lastMessageAt).toBeNull();
  });

  it("Task 1 – Test B: writeFleetSessionsCache normalizes undefined lastMessageAt to null on the wire (read yields null, not undefined)", () => {
    // Session object with lastMessageAt OMITTED (undefined at the property
    // level). writeFleetSessionsCache should coerce to null on serialize; the
    // read path returns null.
    const sessions: FleetSession[] = [
      { hostId: 3, hostName: "hC", sessionName: "s-undef", created: 300, role: null },
    ];
    writeFleetSessionsCache(sessions);
    const read = readFleetSessionsCache();
    expect(read.length).toBe(1);
    // `null` (not undefined) — the round-trip goes through JSON where
    // undefined is not representable. The write path's `?? null` coerces.
    expect(read[0].lastMessageAt).toBeNull();
  });

  it("Task 1 – Test C: readFleetSessionsCache accepts current-key entries missing lastMessageAt (coerces to null)", () => {
    // Simulate a v3 cache entry that predates the lastMessageAt field being
    // populated by the writer — the isFleetSession predicate accepts the
    // absence (optional), and the reader defensively coerces to null so
    // downstream consumers (AppShell seed loop) have a consistent shape.
    // (Phase 47 Plan 01: bumped v2 → v3; the read path shape-check is
    // otherwise identical.)
    const legacy = [
      { hostId: 4, hostName: "hD", sessionName: "s-legacy", created: 400, role: null },
    ];
    localStorage.setItem(FLEET_CACHE_KEY_V3, JSON.stringify(legacy));
    const read = readFleetSessionsCache();
    expect(read.length).toBe(1);
    expect(read[0].sessionName).toBe("s-legacy");
    expect(read[0].lastMessageAt).toBeNull();
  });

  it("Task 1 – Test D: readFleetSessionsCache rejects entries whose lastMessageAt is neither undefined, null, nor number", () => {
    // A malformed cache entry with lastMessageAt = "not a number" must not
    // pass the isFleetSession predicate — else max-wins could seed on a
    // non-numeric ts. The reader filters the bad entry silently; the
    // sibling with a numeric ts survives.
    const mixed = [
      { hostId: 5, hostName: "hE", sessionName: "s-bad", created: 500, role: null, lastMessageAt: "not-a-number" },
      { hostId: 6, hostName: "hF", sessionName: "s-good", created: 600, role: null, lastMessageAt: 6000 },
    ];
    localStorage.setItem(FLEET_CACHE_KEY_V3, JSON.stringify(mixed));
    const read = readFleetSessionsCache();
    expect(read.length).toBe(1);
    expect(read[0].sessionName).toBe("s-good");
    expect(read[0].lastMessageAt).toBe(6000);
  });

  it("Task 1 – Test E: writeFleetSessionsCache writes to the v3 cache key (v2 not written)", () => {
    // Phase 47 Plan 01: bump v2 → v3. Writer must not touch the old key.
    const sessions: FleetSession[] = [
      { hostId: 7, hostName: "hG", sessionName: "s-key-test", created: 700, role: null, lastMessageAt: 700 },
    ];
    writeFleetSessionsCache(sessions);
    expect(localStorage.getItem("skynet:convo-fleet-cache:v3")).not.toBeNull();
    expect(localStorage.getItem("skynet:convo-fleet-cache:v2")).toBeNull();
  });

  it("Task 1 – Test F: readFleetSessionsCache returns [] when only a v2 (pre-Phase-47-bump) cache entry exists", () => {
    // Phase 47 Plan 01: bumped v2 → v3. A leftover v2 cache from a pre-Phase-47
    // client (post-Phase-44) must be ignored — the reader reads FROM v3, so
    // the v2 entry contributes nothing. Forces a clean fresh-fetch on first
    // Phase 47 load. Same rationale as Phase 44's v1→v2 bump: prevents
    // rehydrate from seeding working-store with objects lacking aiTitle
    // (which would flow undefined → null via readFleetSessionsCache's coerce
    // → AppShell seed-loop calls seedSessionAiTitle with null → last-wins
    // no-op → row renders the fallback ellipsis instead of the last-known
    // ai-title from the v2 cache).
    const v2data = [
      { hostId: 8, hostName: "hH", sessionName: "s-v2-leftover", created: 800, role: null, lastMessageAt: 800 },
    ];
    localStorage.setItem("skynet:convo-fleet-cache:v2", JSON.stringify(v2data));
    const read = readFleetSessionsCache();
    expect(read).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 47 Plan 01 — FleetSession aiTitle field + cache round-trip
//
// Task 2 coverage: FleetSession type gained optional aiTitle; isFleetSession
// predicate accepts undefined/null/string for aiTitle (rejects other types);
// readFleetSessionsCache preserves the field (coerces undefined → null);
// writeFleetSessionsCache persists it. Cache key bumped v2 → v3.
// ─────────────────────────────────────────────────────────────────────────────

describe("conversation-store (Phase 47 Plan 01): FleetSession aiTitle cache round-trip", () => {
  const FLEET_CACHE_KEY_V3 = "skynet:convo-fleet-cache:v3";

  beforeEach(() => {
    try {
      localStorage.removeItem(FLEET_CACHE_KEY_V3);
      localStorage.removeItem("skynet:convo-fleet-cache:v1");
      localStorage.removeItem("skynet:convo-fleet-cache:v2");
    } catch {
      /* jsdom localStorage always available */
    }
  });

  it("Task 2 – Test G: writeFleetSessionsCache + readFleetSessionsCache round-trip preserves aiTitle (both null and string cases)", () => {
    // Write a two-item fleet with one null aiTitle + one populated aiTitle.
    // Both must survive the round-trip verbatim, exercising both branches of
    // the reader's `?? null` coerce (populated: pass-through; null: pass-through).
    const sessions: FleetSession[] = [
      { hostId: 10, hostName: "hJ", sessionName: "s-null-title", created: 1000, role: null, lastMessageAt: null, aiTitle: null },
      { hostId: 11, hostName: "hK", sessionName: "s-real-title", created: 1100, role: "sre", lastMessageAt: 1100, aiTitle: "Fix bug X" },
    ];
    writeFleetSessionsCache(sessions);
    const read = readFleetSessionsCache();
    expect(read.length).toBe(2);
    expect(read[0].aiTitle).toBeNull();
    expect(read[1].aiTitle).toBe("Fix bug X");
  });

  it("Task 2 – Test H: isFleetSession rejects aiTitle of wrong type (number)", () => {
    // Construct a cache payload with all valid canonical fields except
    // aiTitle: 42 (number). The reader must reject the entry defensively —
    // else last-wins reconciliation would poison the working-store with a
    // non-string aiTitle until the next legitimate write.
    const bad = [
      { hostId: 12, hostName: "hL", sessionName: "s-bad-title", created: 1200, role: null, lastMessageAt: null, aiTitle: 42 },
      { hostId: 13, hostName: "hM", sessionName: "s-good-title", created: 1300, role: null, lastMessageAt: null, aiTitle: "OK" },
    ];
    localStorage.setItem(FLEET_CACHE_KEY_V3, JSON.stringify(bad));
    const read = readFleetSessionsCache();
    expect(read.length).toBe(1);
    expect(read[0].sessionName).toBe("s-good-title");
    expect(read[0].aiTitle).toBe("OK");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 44 Plan 04 — compareByRecencyDesc Rule 1 flip (null-to-bottom)
//
// Task 2 coverage: retires Ashley's 2026-08-14 no-history-to-top lock. Rule 1
// now sorts null-lastMessageAt rows AFTER rows with a real timestamp. Rule 2
// (insertion-order fallback among null rows) preserved. Rules 3 (real DESC)
// and 4 (identical-ts fallback) unchanged.
// ─────────────────────────────────────────────────────────────────────────────

describe("conversation-store (Phase 44 Plan 04): compareByRecencyDesc — null-to-bottom flip", () => {
  it("Task 2 – Test L: null-cluster insertion-order stability under the flip", () => {
    // Three rows, all with lastMessageAt=null after the flip → still fall back
    // to insertion-order key (Rule 2 preserved). Locks that the flip retired
    // ONLY Rule 1's direction, not Rule 2's tie-break mechanic.
    const hostA = makeHost("hA", "alpha");
    const tabFirst = makeTab("r-first", "terminal", hostA, "s-first", "row-first");
    const tabSecond = makeTab("r-second", "terminal", hostA, "s-second", "row-second");
    const tabThird = makeTab("r-third", "terminal", hostA, "s-third", "row-third");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([tabFirst, tabSecond, tabThird]);
    });
    // All three carry lastMessageAt=null (default) — insertion order applies.
    const snap = __getSnapshotForTest();
    expect(snap.middle.map((r) => r.id)).toEqual(["r-first", "r-second", "r-third"]);
  });

  it("Task 2 – Test M: mixed real + null — real timestamps DESC first, then null rows in insertion order", () => {
    // Four rows inserted in order [r1@1000, r2@null, r3@2000, r4@null].
    // Post-flip: real timestamps first DESC (r3=2000, r1=1000), then null
    // rows in insertion order (r2, r4).
    const hostA = makeHost("hA", "alpha");
    const tab1 = makeTab("r1", "terminal", hostA, "s1", "row-1");
    const tab2 = makeTab("r2", "terminal", hostA, "s2", "row-2");
    const tab3 = makeTab("r3", "terminal", hostA, "s3", "row-3");
    const tab4 = makeTab("r4", "terminal", hostA, "s4", "row-4");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([tab1, tab2, tab3, tab4]);
    });
    act(() => {
      __setLastMessageAtForTest("r1", 1000);
      __setLastMessageAtForTest("r3", 2000);
      // r2 and r4 stay null.
    });
    const snap = __getSnapshotForTest();
    expect(snap.middle.map((r) => r.id)).toEqual(["r3", "r1", "r2", "r4"]);
  });

  it("Task 2 – Test N: single-real-vs-single-null — real timestamp sorts before null (mirror of the flipped Test C contract)", () => {
    // Behavior-level lock: with two rows R_real=1000 and R_null=null, the
    // real-ts row lands at position 0 and the null row at position 1. This is
    // the direct semantic inverse of pre-Phase-44 Test C which asserted
    // ["r2","r1"] (null first).
    const hostA = makeHost("hA", "alpha");
    const tabReal = makeTab("r-real", "terminal", hostA, "s-real", "row-real");
    const tabNull = makeTab("r-null", "terminal", hostA, "s-null", "row-null");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([tabReal, tabNull]);
    });
    act(() => __setLastMessageAtForTest("r-real", 1000));
    const snap = __getSnapshotForTest();
    expect(snap.middle.map((r) => r.id)).toEqual(["r-real", "r-null"]);
  });
});
