import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  updateHostTree,
  updateOpenTabs,
  selectConversation,
  selectConversationDeferred,
  pinConversation,
  unpinConversation,
  togglePinConversation,
  useConversations,
  useSelectedConversationId,
  usePinnedIds,
  __subscribeForTest,
  __getSnapshotForTest,
  __getPendingSelectIdForTest,
} from "./conversation-store.js";
import type { Tab, Host, HostFolder } from "@/types/ui-types";

// ─── Test fixtures ────────────────────────────────────────────────────────────
// Minimal Host stubs — only the fields the store reads (id, name). All other
// fields are `as never` since the store must NOT reach for them; if it does
// we get a runtime crash and the test surfaces the leak.

function makeHost(id: string, name: string): Host {
  return { id, name } as unknown as Host;
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
  updateOpenTabs([]);
  selectConversation(null);
  updateHostTree(null);
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
    // Negative: exact key set (5 keys) — catches accidental field additions
    expect(Object.keys(row).sort()).toEqual(
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

// ─────────────────────────────────────────────────────────────────────────────
// Test 10: singleton settings tabs excluded
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: settings singletons excluded", () => {
  it("host-manager / user-profile / admin-settings tabs do NOT appear in the list", () => {
    const hostA = makeHost("hA", "alpha");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([
        makeTab("hm", "host-manager"),
        makeTab("up", "user-profile"),
        makeTab("as", "admin-settings"),
        makeTab("t1", "terminal", hostA),
      ]);
    });
    const snap = __getSnapshotForTest();
    const allIds = [
      ...snap.pinned.map((r) => r.id),
      ...snap.grouped.flatMap((g) => g.rows.map((r) => r.id)),
    ];
    expect(allIds).toEqual(["t1"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 11: tunnel tabs excluded (host-less; not a "conversation")
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store: tunnel tabs excluded", () => {
  it("tunnel tab type is not surfaced anywhere in the conversation list", () => {
    const hostA = makeHost("hA", "alpha");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([
        makeTab("tun1", "tunnel"),
        makeTab("t1", "terminal", hostA),
      ]);
    });
    const snap = __getSnapshotForTest();
    const allIds = [
      ...snap.pinned.map((r) => r.id),
      ...snap.grouped.flatMap((g) => g.rows.map((r) => r.id)),
    ];
    expect(allIds).not.toContain("tun1");
    expect(allIds).toEqual(["t1"]);
  });
});

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

    // 4 real mutations
    expect(cb).toHaveBeenCalledTimes(4);

    // No-op mutations — same reference / same value / stale-id / already-in-set
    cb.mockClear();
    updateHostTree(tree); // same reference → no emit
    updateOpenTabs([tab1]); // same Tab reference in same order → no emit
    selectConversation("t1"); // already selected → no emit
    pinConversation("t1"); // already pinned → no emit
    selectConversation("stale-id-not-in-tabs"); // stale-id guard → no emit
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
