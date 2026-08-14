// ─── AppShell.persistence.test.tsx ───────────────────────────────────────────
// Phase 6 Plan 06-02 Task 2 — persistence-contract smoke test.
//
// The load-bearing correctness contract of Plan 06-02 (and the whole of Phase
// 6): switching from conversation A → B → A must NOT unmount either pane;
// the DOM node for each conversation's mount is created ONCE per tab lifetime
// and re-parented / visibility-toggled between showings via the patch #35
// `tabNodesRef` + `normalViewRef` DOM-move mechanism preserved in AppShell.
//
// This is the T-06-02-01 (tampering — mount lifecycle regression) programmatic
// defense. If a future refactor accidentally re-mounts on switch, THIS test
// fails loudly rather than waiting for a UAT walk to catch the WebSocket-drop
// / terminal-buffer-loss / pretty-view-scroll-reset regression.
//
// ─── Test scope / fallback path (plan Task 2 <action> + NOTE-08) ─────────────
// The plan gives an explicit fallback: if mocking AppShell's ~30 imports is
// too fragile (i18n provider, theme provider, backend axios calls,
// dbHealthMonitor, terminal/guacamole feature panels, all sidebar panels),
// extract the ONE new mechanism this plan wires (selected-id-drives-visibility
// via tabNodesRef DOM-move) into a minimal MountManager scaffold and test THAT
// in isolation.
//
// This test takes the fallback path: it reproduces the exact tabNodesRef +
// normalViewRef DOM-move mechanism + createPortal loop from AppShell.tsx
// lines 285-297, 1195-1237, 1595-1620 in a minimal ~60-line MountManager
// component, and asserts:
//
//   Test 1 (DOM node identity across switches): reference-equality of the
//     per-tab DOM node across A → B → A.  If a switch remounts, the ref
//     changes and this test fails.  This is the load-bearing correctness
//     assertion — it directly tests the "no unmount on switch" contract.
//
//   Test 2 (mount-count invariant): the mock content component tracks
//     mount/unmount counts.  After A → B → A, both A's and B's counts are
//     mount=1 / unmount=0.  Proves NO remount, complementing Test 1 from
//     the React-side.
//
//   Test 3 (visibility toggle applied on switch): after selecting A, A's
//     node has `visibility: visible` and B's has `visibility: hidden`.
//     Selecting B flips them.  Proves the DOM-move effect's visibility
//     toggle is wired correctly.
//
// Tests 4 (activeTabId mirror), 5 (stale-id no-op), 6 (URL-sync fragment
// update) from the plan spec are DEFERRED to UAT in Plan 06-05 per NOTE-08.
// They exercise integration behavior (document.title effect, URL-sync effect,
// selectConversation guard as it flows into AppShell's mirror effect) that
// only meaningfully runs in a real AppShell. Their observable outcomes are
// covered by:
//   - Test 5 (stale-id no-op): already covered by conversation-store.test.ts
//     Test 6 (T-06-01-01 stale-selection defense) — selectConversation with
//     an unknown id is a silent no-op at the store level, so no downstream
//     mirror effect fires.
//   - Test 6 (URL-sync fragment update): the URL-sync effect at AppShell.tsx
//     line 420 fires on `activeTabId` change; because Plan 06-02 mirrors
//     store's selectedId → activeTabId (Step C), the URL-sync effect fires
//     the same way it did before.  UAT walk in Plan 06-05 confirms the wire
//     behavior end-to-end (patch #25 URL fragment survives Chrome window-
//     restore).
//   - Test 4 (document.title): analogous — the title effect at AppShell.tsx
//     line 407 fires on activeTabId; the mirror keeps it firing.
//
// This split preserves the load-bearing correctness guard (Tests 1-3) as a
// programmatic test that runs on every CI while shifting the integration
// pathway to a manual walk that catches the same class of regression.

import { render, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  __getSnapshotForTest,
  __subscribeForTest,
  selectConversation,
  updateHostTree,
  updateOpenTabs,
  updateFleetSessions,
  updateHostsFlat,
} from "./state/conversation-store.js";
import type { Tab, Host } from "@/types/ui-types";

// ─── Test fixtures ────────────────────────────────────────────────────────────

function makeHost(id: string, name: string): Host {
  return { id, name } as unknown as Host;
}

function makeTerminalTab(id: string, host: Host, label: string): Tab {
  return {
    id,
    instanceId: id,
    type: "terminal",
    label,
    host,
    openedAt: 0,
    targetTmuxSession: null,
  };
}

// Reset module-scoped store between tests (mirrors the pattern in
// conversation-store.test.ts beforeEach).
beforeEach(() => {
  updateOpenTabs([]);
  selectConversation(null);
  updateHostTree(null);
  // Plan 07-01: reset the new fleet-native inputs so Test 4's store-contract
  // assertion starts from an empty fleet + empty hostsFlat. Tests 1-3 do
  // not consume these inputs, so their behavior is unchanged.
  updateFleetSessions([]);
  updateHostsFlat(new Map());
  const snap = __getSnapshotForTest();
  expect(snap.pinned.length).toBe(0);
  // Phase 41 Plan 01: `grouped: HostGroup[]` retired; `middle` + `rdpGroup`.
  expect(snap.middle.length).toBe(0);
  expect(snap.rdpGroup).toBeNull();
  expect(snap.selectedId).toBeNull();
  // Reset mount counters between tests
  mountCounts.clear();
  unmountCounts.clear();
});

// ─── MountManager scaffold ───────────────────────────────────────────────────
// Reproduces the load-bearing patch #35 mechanism from AppShell.tsx byte-for-
// byte-comparable form, driven by the conversation-store's selectedId. Any
// regression to the AppShell code that changes this mechanism's shape will
// diverge from this scaffold; the tests still pass on the scaffold but the
// UAT walk catches the AppShell-side drift. This is intentional — the
// scaffold is a WHITEBOX test of "the mechanism, done correctly, gives the
// contract"; the UAT is the BLACKBOX test of "AppShell uses the mechanism
// correctly."

const mountCounts = new Map<string, number>();
const unmountCounts = new Map<string, number>();

function MockTabContent({ tabId, isVisible }: { tabId: string; isVisible: boolean }) {
  useEffect(() => {
    mountCounts.set(tabId, (mountCounts.get(tabId) ?? 0) + 1);
    return () => {
      unmountCounts.set(tabId, (unmountCounts.get(tabId) ?? 0) + 1);
    };
  }, [tabId]);
  return (
    <div
      data-testid={`content-${tabId}`}
      data-visible={isVisible ? "true" : "false"}
    >
      {tabId}
    </div>
  );
}

function MountManager({
  tabs,
  effectiveSelectedTabId,
  tabNodesRef,
}: {
  tabs: Tab[];
  effectiveSelectedTabId: string | null;
  tabNodesRef: React.MutableRefObject<Map<string, HTMLDivElement>>;
}) {
  const normalViewRef = useRef<HTMLDivElement>(null);

  const getTabNode = useCallback(
    (tabId: string) => {
      if (!tabNodesRef.current.has(tabId)) {
        const el = document.createElement("div");
        el.style.position = "absolute";
        el.style.inset = "0";
        el.style.overflow = "hidden";
        tabNodesRef.current.set(tabId, el);
      }
      return tabNodesRef.current.get(tabId)!;
    },
    [tabNodesRef],
  );

  // Mirror of AppShell.tsx lines 1195-1237 DOM-placement effect. The `if
  // (isTerminal)` branch is a full match; the singleton non-terminal branch
  // uses `display: none` instead of `visibility: hidden`. We test the
  // terminal branch (visibility toggle) which is what all conversation
  // tabs use.
  useEffect(() => {
    const normalView = normalViewRef.current;
    if (!normalView) return;

    const tabIds = new Set(tabs.map((t) => t.id));
    for (const [id, node] of tabNodesRef.current) {
      if (!tabIds.has(id)) {
        node.remove();
        tabNodesRef.current.delete(id);
      }
    }

    for (const tab of tabs) {
      const node = getTabNode(tab.id);
      const activeInline = tab.id === effectiveSelectedTabId;
      if (node.parentElement !== normalView) normalView.appendChild(node);
      node.style.display = "";
      node.style.visibility = activeInline ? "visible" : "hidden";
      node.style.pointerEvents = activeInline ? "auto" : "none";
      node.style.zIndex = activeInline ? "1" : "0";
    }
  });

  return (
    <div ref={normalViewRef} data-testid="normal-view">
      {tabs.map((tab) => {
        const tabNode = getTabNode(tab.id);
        const isVisible = tab.id === effectiveSelectedTabId;
        return createPortal(
          <MockTabContent tabId={tab.id} isVisible={isVisible} />,
          tabNode,
          tab.id,
        );
      })}
    </div>
  );
}

// Driver component: renders MountManager and derives effectiveSelectedTabId
// the same way AppShell does (via a selectedConversationId hook — here we
// read the store directly and force re-renders via useSyncExternalStore).
function TestHarness({ tabs }: { tabs: Tab[] }) {
  // We drive selection via the real conversation-store so the test exercises
  // the actual store's selectConversation guards + the effectiveSelectedTabId
  // derivation semantics AppShell uses. This is more realistic than a plain
  // useState.
  const tabNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // Push tabs into the store on every render so store's selection guard
    // can accept the id when a test calls selectConversation.
    updateOpenTabs(tabs);
  }, [tabs]);

  useEffect(() => {
    // Subscribe to store changes to trigger re-renders when selection changes.
    // We drive re-renders manually because the harness's effectiveSelectedTabId
    // reads state.selectedId via __getSnapshotForTest (not a React hook), so
    // there's nothing to auto-invalidate without an explicit setState.
    const unsub = __subscribeForTest(() => setTick((n) => n + 1));
    return unsub;
    // tick intentionally NOT in deps — the effect is a permanent subscription
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const snap = __getSnapshotForTest();
  const selectedId = snap.selectedId;

  const effectiveSelectedTabId = useMemo(() => {
    if (selectedId && tabs.some((t) => t.id === selectedId)) return selectedId;
    return tabs[0]?.id ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, tabs, tick]);

  return (
    <MountManager
      tabs={tabs}
      effectiveSelectedTabId={effectiveSelectedTabId}
      tabNodesRef={tabNodesRef}
    />
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AppShell persistence contract — patch #35 tabNodesRef DOM-move (T-06-02-01)", () => {
  const hostA = makeHost("host-A", "hostA");
  const hostB = makeHost("host-B", "hostB");
  const tabT1 = makeTerminalTab("t1", hostA, "session-1");
  const tabT2 = makeTerminalTab("t2", hostB, "session-2");
  const tabs = [tabT1, tabT2];

  it("Test 1: DOM node identity persists across A → B → A switches (load-bearing)", () => {
    const { rerender: _rerender } = render(<TestHarness tabs={tabs} />);

    // Select t1 first
    act(() => selectConversation("t1"));
    // Note: the harness uses a subscribeToStore hook so the effect fires;
    // React needs another render cycle to pick up the tick — we force it
    // via act() calls below.

    // Grab the DOM nodes from the tabNodesRef map — accessed via the
    // MountManager's internal ref, so we test via the actual DOM tree.
    // The mock content renders inside a per-tab DOM node the mechanism
    // created; that node is a child of the normalView container.
    const normalViewBefore = document.querySelector('[data-testid="normal-view"]');
    expect(normalViewBefore).not.toBeNull();
    const t1ContentBefore = document.querySelector('[data-testid="content-t1"]');
    const t2ContentBefore = document.querySelector('[data-testid="content-t2"]');
    expect(t1ContentBefore).not.toBeNull();
    expect(t2ContentBefore).not.toBeNull();
    // The IMMEDIATE parent element of the content is the per-tab DOM node
    // the mechanism created (created via document.createElement inside
    // getTabNode).
    const t1NodeBefore = t1ContentBefore!.parentElement;
    const t2NodeBefore = t2ContentBefore!.parentElement;
    expect(t1NodeBefore).not.toBeNull();
    expect(t2NodeBefore).not.toBeNull();

    // Switch to t2
    act(() => selectConversation("t2"));

    const t1ContentMid = document.querySelector('[data-testid="content-t1"]');
    const t2ContentMid = document.querySelector('[data-testid="content-t2"]');
    expect(t1ContentMid).not.toBeNull(); // still mounted (hidden, not unmounted)
    expect(t2ContentMid).not.toBeNull();
    const t1NodeMid = t1ContentMid!.parentElement;
    const t2NodeMid = t2ContentMid!.parentElement;

    // Same DOM node references — patch #35 mechanism preserved DOM identity
    expect(t1NodeMid).toBe(t1NodeBefore);
    expect(t2NodeMid).toBe(t2NodeBefore);

    // Switch back to t1
    act(() => selectConversation("t1"));

    const t1ContentAfter = document.querySelector('[data-testid="content-t1"]');
    const t2ContentAfter = document.querySelector('[data-testid="content-t2"]');
    expect(t1ContentAfter).not.toBeNull();
    expect(t2ContentAfter).not.toBeNull();
    const t1NodeAfter = t1ContentAfter!.parentElement;
    const t2NodeAfter = t2ContentAfter!.parentElement;

    // ADR: reference equality is the load-bearing assertion
    expect(t1NodeAfter).toBe(t1NodeBefore);
    expect(t2NodeAfter).toBe(t2NodeBefore);
  });

  it("Test 2: mount-count invariant — no remount on switch", () => {
    render(<TestHarness tabs={tabs} />);

    // Initial mount: both t1 and t2 mount once each (createPortal loop
    // renders every tab into its own persistent DOM node from the first
    // render). The initial selection defaults to tabs[0] = t1 in the
    // harness (no explicit select).
    expect(mountCounts.get("t1")).toBe(1);
    expect(mountCounts.get("t2")).toBe(1);
    expect(unmountCounts.get("t1") ?? 0).toBe(0);
    expect(unmountCounts.get("t2") ?? 0).toBe(0);

    // Switch to t2
    act(() => selectConversation("t2"));

    // No mount count changes — visibility toggled, component NOT remounted
    expect(mountCounts.get("t1")).toBe(1);
    expect(mountCounts.get("t2")).toBe(1);
    expect(unmountCounts.get("t1") ?? 0).toBe(0);
    expect(unmountCounts.get("t2") ?? 0).toBe(0);

    // Switch back to t1
    act(() => selectConversation("t1"));

    expect(mountCounts.get("t1")).toBe(1);
    expect(mountCounts.get("t2")).toBe(1);
    expect(unmountCounts.get("t1") ?? 0).toBe(0);
    expect(unmountCounts.get("t2") ?? 0).toBe(0);
  });

  it("Test 3: visibility toggle applied on switch", () => {
    render(<TestHarness tabs={tabs} />);

    // Select t1 explicitly
    act(() => selectConversation("t1"));

    const t1Content = document.querySelector('[data-testid="content-t1"]');
    const t2Content = document.querySelector('[data-testid="content-t2"]');
    const t1Node = t1Content!.parentElement!;
    const t2Node = t2Content!.parentElement!;

    // t1 visible, t2 hidden
    expect(t1Node.style.visibility).toBe("visible");
    expect(t2Node.style.visibility).toBe("hidden");
    expect(t1Node.style.pointerEvents).toBe("auto");
    expect(t2Node.style.pointerEvents).toBe("none");

    // Switch to t2 — flips
    act(() => selectConversation("t2"));

    expect(t1Node.style.visibility).toBe("hidden");
    expect(t2Node.style.visibility).toBe("visible");
    expect(t1Node.style.pointerEvents).toBe("none");
    expect(t2Node.style.pointerEvents).toBe("auto");
  });

  // ─── Plan 07-01: fleet-derived row-shape contract (Test 4) ─────────────────
  // Store-level assertion that the Plan 07-01 Task 2 detached-row-click
  // handler's INPUTS are produced correctly. AppShell's onDetachedRowClick
  // (see AppShell.tsx §Plan 07-01) reads row.host + row.targetTmuxSession
  // from a fleet-only row and calls openTab. Test 4 asserts that after
  // AppShell would have called updateHostsFlat + updateFleetSessions, the
  // store's snapshot contains a fleet-derived row with the fields the
  // handler needs — host resolved via hostsFlat, targetTmuxSession set,
  // deterministic id, and the internal fleetOnly=true routing marker.
  //
  // This is NOT an openTab integration test — the openTab call itself is
  // an AppShell concern and is walked in Plan 07-03 UAT. Test 4 is a
  // regression guard for the store contract that the handler depends on;
  // if a future refactor breaks the resolution chain (e.g., host stops
  // being populated via hostsFlat, or fleetOnly stops being set) this
  // test fails BEFORE Ashley clicks a detached row and gets a silent
  // no-op.
  //
  // Tests 1-3 above (T-06-02-01 MountManager scaffold) are UNCHANGED —
  // this test does not render the MountManager, does not touch tabNodesRef,
  // does not extend the createPortal loop.
  it("Test 4: fleet-derived row shape — hostsFlat resolves host + fleetOnly:true + id `fleet::N::name`", () => {
    const mockHostA = makeHost("1", "hostA");

    // Simulate what AppShell's mount effects do in production:
    //   1. hostsById memo populates from realHostTree → updateHostsFlat
    //   2. getSessionList() resolves → updateFleetSessions
    // Order isn't semantically load-bearing (both are pure inputs), but we
    // match the AppShell effect ordering for realism.
    act(() => {
      updateHostsFlat(new Map<number, Host>([[1, mockHostA]]));
      updateFleetSessions([
        { hostId: 1, hostName: "hostA", sessionName: "work", created: 100 },
      ]);
    });

    const snap = __getSnapshotForTest();
    // Phase 41 Plan 01: fleet-derived row lands in flat middle (no host bucket).
    expect(snap.middle.length).toBe(1);
    const row = snap.middle[0];

    // Handler's required inputs:
    //   - row.host (resolved via hostsFlat — passed to openTab)
    //   - row.targetTmuxSession (passed to openTab options)
    //   - row.fleetOnly === true (routes ConversationsPanel through
    //     onDetachedRowClick vs selectConversation)
    //   - row.id in deterministic `fleet::${hostId}::${sessionName}` shape
    //     so future assertions / diagnostics can reason about identity
    expect(row.host).toBe(mockHostA);
    expect(row.targetTmuxSession).toBe("work");
    expect((row as unknown as { fleetOnly?: boolean }).fleetOnly).toBe(true);
    expect(row.id).toBe("fleet::1::work");
  });
});
