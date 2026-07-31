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
  updateHostsFlat,
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
  type FleetSession,
} from "./conversation-store.js";
import * as UserPreferencesApi from "@/api/user-preferences-api";
import type { Tab, Host, HostFolder } from "@/types/ui-types";

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
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: empty state
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: empty state", () => {
  it("returns empty pinned + grouped and null selection when no tabs or tree", () => {
    const { result: convs } = renderHook(() => useConversations());
    const { result: sel } = renderHook(() => useSelectedConversationId());
    expect(convs.current.pinned).toEqual([]);
    expect(convs.current.grouped).toEqual([]);
    expect(sel.current).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: host-tree order preserved below pins
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: host-tree order", () => {
  it("preserves depth-first host-tree order below pins (not insertion, not alphabetical)", () => {
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
        makeTab("t3", "rdp", hostA1),
      ]);
    });

    const { result } = renderHook(() => useConversations());
    const groups = result.current.grouped;
    // Expected DFS traversal: folderA -> [hostA1 (zeus), hostA2 (apollo)],
    // then hostRoot1 (hermes). Insertion order was t1, t2, t3 — but t3 (hostA1)
    // MUST come first because hostA1 appears first in tree order.
    expect(groups.map((g) => g.hostId)).toEqual(["hA1", "hA2", "hR1"]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["t3"]);
    expect(groups[1].rows.map((r) => r.id)).toEqual(["t1"]);
    expect(groups[2].rows.map((r) => r.id)).toEqual(["t2"]);
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

    // Snapshot pre-pin: hostA -> [t1], hostB -> [t2, t3]
    let snap = __getSnapshotForTest();
    expect(snap.grouped.map((g) => g.hostId)).toEqual(["hA", "hB"]);
    expect(snap.grouped[1].rows.map((r) => r.id)).toEqual(["t2", "t3"]);

    act(() => pinConversation("t2"));
    snap = __getSnapshotForTest();
    expect(snap.pinned.map((r) => r.id)).toEqual(["t2"]);
    // hostB group no longer contains t2 — only t3
    expect(snap.grouped[1].rows.map((r) => r.id)).toEqual(["t3"]);

    act(() => unpinConversation("t2"));
    snap = __getSnapshotForTest();
    expect(snap.pinned).toEqual([]);
    // t2 restored to its host-tree slot (BEFORE t3, since tabs order t2 < t3
    // and host-tree derivation is deterministic on openTabs order).
    expect(snap.grouped[1].rows.map((r) => r.id)).toEqual(["t2", "t3"]);
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
    // t3 stays in hostA1's group — unaffected by t1's pin
    expect(snap.grouped[0].hostId).toBe("hA1");
    expect(snap.grouped[0].rows.map((r) => r.id)).toEqual(["t3"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: session-end vanishes row + clears pin + coerces selection
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: session-end lifecycle", () => {
  it("removing a tab from openTabs clears its pin AND (if selected) coerces selection to null", () => {
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
    // Pin cleared alongside the row
    expect(snap.pinnedIds.has("t2")).toBe(false);
    expect(snap.pinned).toEqual([]);
    // Row is gone
    expect(snap.grouped[0].rows.map((r) => r.id)).toEqual(["t1"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 5b/5c (Patch #150 A): pruner fleet-aware — updateOpenTabs must keep
// pinnedIds that are legitimate fleet-derived ids (from state.fleetSessions),
// not just openTabs-derived ids. Pre-#150 A the pruner dropped any pinnedId
// not in nextIds (openTab id set), which nuked Ashley's 4-5 pinned fleet rows
// the instant she clicked ANY row to activate its session. Regression guard
// pair: (5b) fleet pins survive an openTabs mutation; (5c) stale openTab pins
// (not fleet, not in openTabs) are STILL pruned as they were pre-#150.
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: pruner fleet-aware (patch #150 A)", () => {
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

    // Post-#150 A: all four fleet pins survive.
    // Pre-#150 A (regression this test guards): pinnedIds.size would be 0.
    snap = __getSnapshotForTest();
    expect(snap.pinnedIds.size).toBe(4);
    expect(snap.pinnedIds.has("fleet::1::work")).toBe(true);
    expect(snap.pinnedIds.has("fleet::1::scratch")).toBe(true);
    expect(snap.pinnedIds.has("fleet::2::srv")).toBe(true);
    expect(snap.pinnedIds.has("fleet::2::dev")).toBe(true);
  });

  it("clicking an openTab row still prunes stale openTab pins as before (regression guard)", () => {
    // fleetSessions is empty per beforeEach — this test proves the pre-#150
    // pruner behavior for non-fleet ids is preserved. If the fix accidentally
    // stopped pruning stale openTab pins (e.g. by keeping every pinnedId
    // regardless of both openTabs AND fleet membership), this test would fail.
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

    // Exercise: t1 vanishes from openTabs (session-end simulation).
    // t1 is NOT a fleet id (fleetSessions is empty), so the pruner MUST drop it.
    act(() => updateOpenTabs([tabT2]));

    snap = __getSnapshotForTest();
    expect(snap.pinnedIds.has("t1")).toBe(false);
    expect(snap.pinnedIds.has("t2")).toBe(true);
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
    const row = snap.grouped[0].rows[0];
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

    const row = __getSnapshotForTest().grouped[0].rows[0];
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
    // present on openTabs-derived rows. Filter BOTH before comparing so the
    // locked 5-key core-shape contract is preserved.
    const keysForShapeCheck = Object.keys(row).filter(
      (k) => k !== "fleetOnly" && k !== "rdpHostRow",
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
    // dashboard MUST NOT appear anywhere
    const allIds = [
      ...snap.pinned.map((r) => r.id),
      ...snap.grouped.flatMap((g) => g.rows.map((r) => r.id)),
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
    expect(snap.grouped.length).toBe(1);
    expect(snap.grouped[0].hostId).toBe("1");
    expect(snap.grouped[0].rows.length).toBe(1);
    const row = snap.grouped[0].rows[0];
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
    expect(snap.grouped.length).toBe(1);
    expect(snap.grouped[0].rows.length).toBe(1);
    const row = snap.grouped[0].rows[0];
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
    expect(snap.grouped.length).toBe(1);
    expect(snap.grouped[0].hostId).toBe("1");
    const ids = snap.grouped[0].rows.map((r) => r.id);
    // Both rows appear; alphabetically sorted by row.label:
    // "scratch" (fleet::1::scratch) < "terminal:hostA" (t1)
    expect(ids).toEqual(["fleet::1::scratch", "t1"]);
    const scratchRow = snap.grouped[0].rows[0];
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
    expect(snap.grouped.length).toBe(1);
    const ids = snap.grouped[0].rows.map((r) => r.id);
    // Both rows appear — the fleet's "work" is unrelated to t1
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
    expect(snap.grouped.length).toBe(1);
    expect(snap.grouped[0].hostName).toBe("hostA-fallback-name");
    expect(snap.grouped[0].rows.length).toBe(1);
    const row = snap.grouped[0].rows[0];
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
// Test 1 shape-guard extension: empty state must expose activeSet field
// (appended to the existing Test 1 assertions inline in a new describe block
// rather than modifying the original, to keep git diff surgical)
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (Patch #149 B+C): empty state exposes activeSet field", () => {
  it("returns empty activeSet alongside empty pinned + grouped on the happy-empty path", () => {
    const { result: convs } = renderHook(() => useConversations());
    expect(convs.current.activeSet).toEqual([]);
    expect(convs.current.pinned).toEqual([]);
    expect(convs.current.grouped).toEqual([]);
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

    // Sanity: the fleet-only row exists, nothing pinned
    const snap1 = __getSnapshotForTest();
    expect(snap1.grouped[0].rows[0].id).toBe("fleet::1::work");
    expect(snap1.pinnedIds.size).toBe(0);

    // Patch #149 A: pinning a fleet-only row now succeeds
    act(() => pinConversation("fleet::1::work"));

    const snap2 = __getSnapshotForTest();
    expect(snap2.pinnedIds.has("fleet::1::work")).toBe(true);
    // Slice B (Patch #149 B+C): the pinned-section now surfaces fleet rows,
    // so the fleet row is promoted to snap2.pinned and is NOT in grouped.
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

    // Dedup: the row must NOT appear in any grouped[] group
    const allGroupedIds = snap.grouped.flatMap((g) => g.rows.map((r) => r.id));
    expect(allGroupedIds).not.toContain("fleet::1::work");
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
    // Post-change: alphabetically sorted by row.label → ["a", "m", "n", "z"]
    expect(snap.pinned.map((r) => r.label)).toEqual(["a", "m", "n", "z"]);
  });
});

describe("conversation-store (Patch #149 B+C): Test 30c — active-set row overtakes pinned tier", () => {
  it("addToActiveSet on a pinned fleet id promotes it to activeSet and removes it from pinned", () => {
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

    // Tier 1: activeSet contains the fleet row
    expect(snap.activeSet.length).toBe(1);
    expect(snap.activeSet[0].id).toBe("fleet::1::work");

    // Strict dedup: NOT in pinned (promoted out)
    expect(snap.pinned.length).toBe(0);

    // Strict dedup: NOT in grouped
    const allGroupedIds = snap.grouped.flatMap((g) => g.rows.map((r) => r.id));
    expect(allGroupedIds).not.toContain("fleet::1::work");
  });
});

describe("conversation-store (Patch #149 B+C): Test 30d — activeSet-only row (not pinned)", () => {
  it("fleet row in activeSet but not pinned goes to Tier 1 only; pinned stays empty; not in grouped", () => {
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

    expect(snap.activeSet[0].id).toBe("fleet::1::work");
    expect(snap.pinned.length).toBe(0);

    const allGroupedIds = snap.grouped.flatMap((g) => g.rows.map((r) => r.id));
    expect(allGroupedIds).not.toContain("fleet::1::work");
  });
});

describe("conversation-store (Patch #149 B+C): Test 30e — openTab pinned + activeSet → activeSet only", () => {
  it("openTab row in both pinnedIds and activeSet goes to Tier 1 only (dedup applies to openTab path too)", () => {
    const hostA = makeHost("hA", "hostA");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([makeTab("t1", "terminal", hostA, "s1", "t1-label")]);
      pinConversation("t1");
      addToActiveSet("t1");
    });

    const snap = __getSnapshotForTest();

    // Tier 1: t1 is in activeSet
    expect(snap.activeSet[0].id).toBe("t1");

    // Strict dedup: NOT in pinned (promoted to Tier 1)
    expect(snap.pinned.length).toBe(0);

    // Strict dedup: NOT in grouped
    const allGroupedIds = snap.grouped.flatMap((g) => g.rows.map((r) => r.id));
    expect(allGroupedIds).not.toContain("t1");
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
    // The RDP rows live in a sentinel HostGroup with hostId === "__rdp__" at
    // the BOTTOM of the grouped output. Identity-tmux HostGroups (hostA,
    // hostB) have no openTabs and no fleetSessions, so they emit nothing.
    const rdpGroups = snap.grouped.filter((g) => g.hostId === "__rdp__");
    expect(rdpGroups.length).toBe(1);
    const rdpRows = rdpGroups[0].rows;
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
    const rdpGroups = snap.grouped.filter((g) => g.hostId === "__rdp__");
    // Either the RDP group is absent (no matching hosts) or it exists with 0
    // rows. Both are acceptable; the load-bearing assertion is zero rendered
    // RDP rows for a host without the field.
    const rowCount = rdpGroups.reduce((acc, g) => acc + g.rows.length, 0);
    expect(rowCount).toBe(0);
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
    // Expected group order:
    //   1. hostA (id="1"): openTabs row t1 (attached) + fleet-only row (work)
    //   2. __rdp__ sentinel group: RDP row for hostA + RDP row for hostB
    // hostB has no openTabs and no fleetSessions, so it does NOT get a
    // regular HostGroup — but IS represented in the RDP sentinel group.
    const orderedIds = snap.grouped.map((g) => g.hostId);
    // hostA's identity-tmux group first
    expect(orderedIds[0]).toBe("1");
    // RDP sentinel LAST
    expect(orderedIds[orderedIds.length - 1]).toBe("__rdp__");

    // Concatenate the row ids across all groups to verify the full ordering
    const concatRowIds = snap.grouped.flatMap((g) => g.rows.map((r) => r.id));
    // openTabs entry first, fleet-only "work" second (append order per Test 25),
    // then RDP rows for hostA + hostB in host-tree order.
    expect(concatRowIds).toEqual([
      "t1",
      "fleet::1::work",
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

    // Prime with enableRdp=true — one RDP row present
    act(() => {
      updateHostsFlat(new Map<number, Host>([[1, hostAOn]]));
    });
    let snap = __getSnapshotForTest();
    let rdpGroups = snap.grouped.filter((g) => g.hostId === "__rdp__");
    expect(rdpGroups.length).toBe(1);
    expect(rdpGroups[0].rows.length).toBe(1);
    expect(rdpGroups[0].rows[0].id).toBe("rdp-host::1");

    // Simulate Ashley toggling RDP OFF in the host editor → realHostTree
    // rebuild → new hostsFlat Map with enableRdp=false
    act(() => {
      updateHostsFlat(new Map<number, Host>([[1, hostAOff]]));
    });
    snap = __getSnapshotForTest();
    rdpGroups = snap.grouped.filter((g) => g.hostId === "__rdp__");
    // Either the group is absent entirely, or it exists with 0 rows
    const rowCount = rdpGroups.reduce((acc, g) => acc + g.rows.length, 0);
    expect(rowCount).toBe(0);

    // Toggle back on — row returns
    act(() => {
      updateHostsFlat(new Map<number, Host>([[1, hostAOn]]));
    });
    snap = __getSnapshotForTest();
    rdpGroups = snap.grouped.filter((g) => g.hostId === "__rdp__");
    expect(rdpGroups.length).toBe(1);
    expect(rdpGroups[0].rows[0].id).toBe("rdp-host::1");
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

    // Sanity: RDP row exists
    let snap = __getSnapshotForTest();
    const rdpGroup = snap.grouped.find((g) => g.hostId === "__rdp__");
    expect(rdpGroup).toBeDefined();
    expect(rdpGroup!.rows[0].id).toBe("rdp-host::1");
    expect(snap.pinnedIds.size).toBe(0);

    // Patch #149 A: the store no longer rejects any id. Direct call succeeds.
    // The panel wires `onTogglePin={rdpNoopTogglePin}` for RDP rows so no user
    // click can trigger this path — the RDP-un-pinnable invariant is enforced
    // at the panel wiring, not here.
    act(() => pinConversation("rdp-host::1"));

    snap = __getSnapshotForTest();
    expect(snap.pinnedIds.has("rdp-host::1")).toBe(true);
    // Row still visible in the RDP sentinel group
    const rdpGroupAfter = snap.grouped.find((g) => g.hostId === "__rdp__");
    expect(rdpGroupAfter).toBeDefined();
    expect(rdpGroupAfter!.rows[0].id).toBe("rdp-host::1");
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
// pinnedIds. The pin id itself SURVIVES in state.pinnedIds (the pruner's
// fleetPinKeepSet is built from state.fleetSessions, which still holds
// the session); this bug is render-side only.
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
// quick-260727-kbw: regression — fleet pin survives updateOpenTabs pruner
// when hydrated after fleet load
// ─────────────────────────────────────────────────────────────────────────────
// Pre-fix, if hydrate happened before updateFleetSessions, the updateOpenTabs
// pruner would nuke the pin because fleetPinKeepSet would have been empty.
// Post-fix, once the panel gates on fleetSessionsLoaded, hydrate ALWAYS runs
// after fleet load — this test locks the store-level invariant that IF the
// ordering is correct (fleet first, then hydrate), the pin survives an
// empty-tabs re-emission.
describe("regression: fleet pin survives updateOpenTabs pruner when hydrated after fleet load (quick-260727-kbw)", () => {
  it("fleet::7::aqua survives updateOpenTabs([]) when hydrated after updateFleetSessions", () => {
    // Step 1: fleet loads first (mirrors the fixed panel ordering)
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

    // Step 3: routine empty tab-list re-emission (the pruner branch under
    // pinnedIds.size > 0 fires, builds fleetPinKeepSet from state.fleetSessions,
    // and MUST keep fleet::7::aqua because it's in the fleet keep-set)
    act(() => updateOpenTabs([]));

    // The load-bearing assertion: fleet::7::aqua is STILL pinned.
    snap = __getSnapshotForTest();
    expect(snap.pinnedIds.has("fleet::7::aqua")).toBe(true);
  });
});
