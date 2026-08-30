// ─── AppShell.split-tree.test.tsx ──────────────────────────────────────────
// Phase 56 Plan 02 Task 2 — split-tree mechanism-scaffold suite.
//
// Follows the fallback pattern the sibling `AppShell.persistence.test.tsx`
// establishes: mocking AppShell's ~30 imports would be strictly more fragile
// than extracting the load-bearing mechanism into a minimal scaffold and
// asserting THAT. The mechanism this plan wires:
//
//   1. splitTree: SplitNode | null useState — the single source-of-truth
//      for the split arrangement.
//   2. URL hydration in an effect gated on tabsReady: parse the pending
//      workspace, decode splitTree via a resolver over the live tab set,
//      and setSplitTree(decoded).
//   3. openSessionInTree(tabId, path, edge) — one handler drives both
//      first-drop-into-empty and move-within-tree; implemented as
//      removeLeaf-then-insertAtEdge.
//   4. DOM-placement effect keys on findLeaf(splitTree, tabId) + a Map
//      paneElsRef lookup, replacing the retired paneTabIds indexOf +
//      paneContentEls array.
//   5. Visibility gate `display: hasSplit ? 'flex' : 'none'` prevents a
//      first-paint mispaint while URL-restore is pending (loadSavedTabs is
//      a useEffect that fires AFTER first render).
//   6. NO localStorage writes for split state — the two prior effects
//      (skynet_splitMode / skynet_paneTabIds) are DELETED unconditionally.
//
// Tests:
//   Test 3   URL split fragment → after hydration, two Pane content-refs
//            exist keyed by tabId (portal-target contract).
//   Test 4   openSessionInTree updates splitTree; downstream URL-sync
//            emits s=/t= via the encoded fragment.
//   Test 5   NO calls to localStorage.setItem('skynet_splitMode') or
//            'skynet_paneTabIds' during the mechanism's lifetime.
//   Test 6   Portal-preservation contract: after openSessionInTree moves a
//            tab from cell A to cell B, the DOM node for that tab is
//            Object.is-equal to the DOM node before the move (patch #35
//            tabNodesRef mechanism preserved under the tree refactor).
//   Test 7   Graceful degradation on stale URL: decoding a fragment that
//            references a session not present in the tabs returns null (or
//            a collapsed partial), no blank-screen crash.
//   Test 8   Mispaint-gate: SplitView container has display:'none' on the
//            first render when splitTree === null; flips to display:'flex'
//            after the effect settles a non-null splitTree.

import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { createPortal } from "react-dom";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import type { SplitNode, SplitPath, DropEdge } from "@/lib/split-tree";
import {
  collectTabIds,
  findLeaf,
  getNodeAt,
  insertAtEdge,
  removeLeaf,
  replaceLeaf,
  swapLeaves,
} from "@/lib/split-tree";
import {
  encodeSplitTreeToUrl,
  decodeSplitTreeFromUrl,
} from "@/lib/split-tree-url";
import type { TabSpec } from "@/lib/tab-url";
import {
  consumePendingWorkspace,
  writeWorkspaceToUrl,
} from "@/lib/tab-url";

// ─── Fixtures ────────────────────────────────────────────────────────────────

type TestTab = {
  id: string;
  hostName: string;
  session: string; // tmux session name
};

function makeTab(id: string, hostName: string, session: string): TestTab {
  return { id, hostName, session };
}

function specForTestTab(t: TestTab): TabSpec {
  return { protocol: "tmux", host: t.hostName, session: t.session };
}

// ─── MechanismScaffold ───────────────────────────────────────────────────────
// Mirrors the AppShell code paths this plan added / rewrote. Any regression
// to AppShell.tsx that changes the mechanism's shape diverges from this
// scaffold — Tests 3-8 fail on the scaffold but the UAT walk catches the
// AppShell-side drift. Same pattern the persistence-test file authorizes for
// its own Tests 1-3.

const localStorageSetItemSpy = vi.spyOn(Storage.prototype, "setItem");

function MechanismScaffold({
  tabs,
  simulateTabsReady = true,
  onSplitTreeChange,
  registerHandle,
  useLayoutHydration = false,
}: {
  tabs: TestTab[];
  simulateTabsReady?: boolean;
  onSplitTreeChange?: (tree: SplitNode | null) => void;
  registerHandle?: (h: {
    openSessionInTree: (tabId: string, path: SplitPath, edge: DropEdge) => void;
    // Phase 64 Plan 02 — mirror AppShell handler shape so integration tests
    // exercise the same setSplitTree wrapper the real handlers use.
    replaceInTree: (replacementTabId: string, targetTabId: string) => void;
    swapInTree: (tabIdA: string, tabIdB: string) => void;
    getSplitTree: () => SplitNode | null;
  }) => void;
  useLayoutHydration?: boolean;
}) {
  const [splitTree, setSplitTree] = useState<SplitNode | null>(null);
  const [tabsReady, setTabsReady] = useState(false);
  const paneElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const tabNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const normalViewRef = useRef<HTMLDivElement>(null);
  const splitViewGateRef = useRef<HTMLDivElement>(null);

  const getTabNode = useCallback((tabId: string) => {
    if (!tabNodesRef.current.has(tabId)) {
      const el = document.createElement("div");
      el.style.position = "absolute";
      el.style.inset = "0";
      el.setAttribute("data-tab-node-for", tabId);
      tabNodesRef.current.set(tabId, el);
    }
    return tabNodesRef.current.get(tabId)!;
  }, []);

  const onPaneContentRef = useCallback(
    (tabId: string, el: HTMLDivElement | null) => {
      if (el) paneElsRef.current.set(tabId, el);
      else paneElsRef.current.delete(tabId);
    },
    [],
  );

  // Hydrate splitTree from URL — mirrors AppShell.tsx loadSavedTabs hydration.
  // For Test 8 (mispaint-gate) we optionally lift this to useLayoutEffect to
  // prove the visibility-gate invariant still holds when the wire is deferred.
  const hydrate = useLayoutHydration ? useLayoutEffect : useEffect;
  hydrate(() => {
    if (!simulateTabsReady) return;
    const pending = consumePendingWorkspace();
    if (pending?.splitTree) {
      const resolver = (spec: TabSpec): string | null => {
        for (const t of tabs) {
          if (
            t.hostName === spec.host &&
            t.session === (spec.session ?? "")
          ) {
            return t.id;
          }
        }
        return null;
      };
      const decoded = decodeSplitTreeFromUrl(pending.splitTree, resolver);
      if (decoded !== null) setSplitTree(decoded);
    }
    setTabsReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirrors the real AppShell openSessionInTree after the Phase 56
  // code-review HIGH fix. Recomputes the target's path after
  // removeLeaf so a collapsed ancestor split doesn't leave a stale
  // path pointing past a leaf (which the old code would swallow into
  // a catch block that root-inserted, silently destroying every
  // surviving cell).
  const openSessionInTree = useCallback(
    (tabId: string, path: SplitPath, edge: DropEdge) => {
      setSplitTree((prev) => {
        if (prev === null) {
          return insertAtEdge(null, [], { kind: "session", tabId }, edge);
        }
        const sourcePath = findLeaf(prev, tabId);
        if (
          sourcePath !== null &&
          sourcePath.length === path.length &&
          sourcePath.every((v, i) => v === path[i])
        ) {
          return prev;
        }
        const targetNode = getNodeAt(prev, path);
        const targetTabId =
          targetNode !== null && targetNode.kind === "session"
            ? targetNode.tabId
            : null;
        const withoutDup = removeLeaf(prev, tabId);
        if (withoutDup === null) {
          return insertAtEdge(null, [], { kind: "session", tabId }, edge);
        }
        if (targetTabId === null || targetTabId === tabId) {
          return withoutDup;
        }
        const freshPath = findLeaf(withoutDup, targetTabId);
        if (freshPath === null) {
          return withoutDup;
        }
        try {
          return insertAtEdge(
            withoutDup,
            freshPath,
            { kind: "session", tabId },
            edge,
          );
        } catch {
          return withoutDup;
        }
      });
    },
    [],
  );

  // Phase 64 Plan 02 — pure setSplitTree wrappers around Plan 64-01's helpers.
  // Scaffold mirrors AppShell.replaceInTree / AppShell.swapInTree shape but
  // omits the structured [pv-split-drop] logs (those belong to the real
  // handler layer; scaffold callbacks are pure state wrappers).
  const replaceInTree = useCallback(
    (replacementTabId: string, targetTabId: string) => {
      setSplitTree((prev) => replaceLeaf(prev, targetTabId, replacementTabId));
    },
    [],
  );
  const swapInTree = useCallback((tabIdA: string, tabIdB: string) => {
    setSplitTree((prev) => swapLeaves(prev, tabIdA, tabIdB));
  }, []);

  useEffect(() => {
    onSplitTreeChange?.(splitTree);
  }, [splitTree, onSplitTreeChange]);

  useEffect(() => {
    registerHandle?.({
      openSessionInTree,
      replaceInTree,
      swapInTree,
      getSplitTree: () => splitTree,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSessionInTree, replaceInTree, swapInTree, splitTree]);

  // URL-sync effect — encode splitTree back into the URL. Mirrors the
  // AppShell URL-sync effect at ~L768.
  useEffect(() => {
    if (!tabsReady) return;
    const tabSpecs: TabSpec[] = tabs.map(specForTestTab);
    const splitTreeFragment = encodeSplitTreeToUrl(splitTree, (tabId) => {
      const t = tabs.find((tt) => tt.id === tabId);
      return t ? specForTestTab(t) : null;
    });
    writeWorkspaceToUrl(
      tabSpecs.length === 0
        ? null
        : {
            tabs: tabSpecs,
            splitTree: splitTreeFragment || undefined,
          },
    );
  }, [tabsReady, tabs, splitTree]);

  // DOM-placement effect — mirrors AppShell.tsx L1488-1546 rewritten shape.
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
      const inPane =
        splitTree !== null && findLeaf(splitTree, tab.id) !== null;
      const paneEl = inPane
        ? (paneElsRef.current.get(tab.id) ?? null)
        : null;
      if (inPane && paneEl) {
        if (node.parentElement !== paneEl) paneEl.appendChild(node);
        node.style.visibility = "visible";
        node.style.pointerEvents = "auto";
        node.style.display = "";
      } else {
        if (node.parentElement !== normalView) normalView.appendChild(node);
        node.style.visibility = "hidden";
        node.style.pointerEvents = "none";
      }
    }
  }, [tabs, splitTree, getTabNode]);

  const hasSplit = splitTree !== null;

  return (
    <div>
      <div
        ref={splitViewGateRef}
        data-testid="splitview-gate"
        style={{
          display: hasSplit ? "flex" : "none",
          flexDirection: "column",
        }}
      >
        <MiniSplitViewRenderer
          tree={splitTree}
          onPaneContentRef={onPaneContentRef}
        />
      </div>
      <div ref={normalViewRef} data-testid="normal-view">
        {tabs.map((tab) => {
          const tabNode = getTabNode(tab.id);
          return createPortal(
            <div data-testid={`content-${tab.id}`}>{tab.id}</div>,
            tabNode,
            tab.id,
          );
        })}
      </div>
    </div>
  );
}

// Minimal renderer that mirrors the SplitView leaf → data-tab-id contract.
// We only need to expose the leaf content divs with data-tab-id so the
// mechanism scaffold's paneElsRef gets populated. Splits render two nested
// PaneTrees.
function MiniSplitViewRenderer({
  tree,
  onPaneContentRef,
}: {
  tree: SplitNode | null;
  onPaneContentRef: (tabId: string, el: HTMLDivElement | null) => void;
}) {
  if (tree === null) return null;
  return <MiniPaneTree node={tree} onPaneContentRef={onPaneContentRef} />;
}

function MiniPaneTree({
  node,
  onPaneContentRef,
}: {
  node: SplitNode;
  onPaneContentRef: (tabId: string, el: HTMLDivElement | null) => void;
}) {
  if (node.kind === "session") {
    return (
      <div
        ref={(el) => onPaneContentRef(node.tabId, el)}
        data-tab-id={node.tabId}
      />
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: node.direction === "horizontal" ? "column" : "row" }}>
      <MiniPaneTree node={node.children[0]} onPaneContentRef={onPaneContentRef} />
      <MiniPaneTree node={node.children[1]} onPaneContentRef={onPaneContentRef} />
    </div>
  );
}

// ─── Test setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  cleanup();
  localStorageSetItemSpy.mockClear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", window.location.pathname);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("AppShell split-tree mechanism (Phase 56 Plan 02)", () => {
  it("Test 3: URL split fragment hydrates two-leaf tree; both leaf data-tab-ids present", async () => {
    // Encode a two-leaf vertical split BEFORE mount.
    const tabA = makeTab("t-aaa", "host1", "aqua");
    const tabB = makeTab("t-bbb", "host1", "nelly");
    const tree: SplitNode = {
      kind: "split",
      direction: "vertical",
      children: [
        { kind: "session", tabId: tabA.id },
        { kind: "session", tabId: tabB.id },
      ],
    };
    const fragment = encodeSplitTreeToUrl(tree, (tabId) => {
      if (tabId === tabA.id) return specForTestTab(tabA);
      if (tabId === tabB.id) return specForTestTab(tabB);
      return null;
    });
    expect(fragment).not.toBe("");
    // Plant the encoded fragment in the URL so consumePendingWorkspace picks
    // it up on mount. We also need a `#tab=` entry per the tab-url invariant
    // that consumePendingWorkspace requires tab entries. Emit both.
    const tabParams = [tabA, tabB]
      .map((t) => `tab=${encodeURIComponent(`tmux:${t.hostName}:${t.session}`)}`)
      .join("&");
    window.history.replaceState(null, "", `#${tabParams}&${fragment}`);

    const { container } = render(
      <MechanismScaffold tabs={[tabA, tabB]} />,
    );
    // The hydration effect fires on mount but is async wrt the render
    // pipeline; use act to flush it.
    await act(async () => {
      await Promise.resolve();
    });
    const leafDivs = container.querySelectorAll("[data-tab-id]");
    expect(leafDivs.length).toBe(2);
    const ids = Array.from(leafDivs).map((d) => d.getAttribute("data-tab-id"));
    expect(ids.sort()).toEqual([tabA.id, tabB.id].sort());
  });

  it("Test 4: openSessionInTree updates splitTree; URL-sync effect writes s=/t=", async () => {
    const tabA = makeTab("t-aaa", "host1", "aqua");
    let handle: {
      openSessionInTree: (tabId: string, path: SplitPath, edge: DropEdge) => void;
      getSplitTree: () => SplitNode | null;
    } | null = null;
    render(
      <MechanismScaffold
        tabs={[tabA]}
        registerHandle={(h) => {
          handle = h;
        }}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    // Initial splitTree === null; URL has no s=/t=.
    expect(handle!.getSplitTree()).toBeNull();
    // Fire a first-drop-into-empty: open tabA in the tree.
    await act(async () => {
      handle!.openSessionInTree(tabA.id, [], "left");
      await Promise.resolve();
    });
    const tree = handle!.getSplitTree();
    expect(tree).not.toBeNull();
    expect(tree).toEqual({ kind: "session", tabId: tabA.id });
    // URL now carries s=/t=. Wait a microtask so the URL-sync effect flushes.
    await act(async () => {
      await Promise.resolve();
    });
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    expect(params.get("s")).not.toBeNull();
    expect(params.get("t")).not.toBeNull();
  });

  it("Test 5: NO localStorage.setItem calls for skynet_splitMode or skynet_paneTabIds during mechanism lifetime", async () => {
    const tabA = makeTab("t-aaa", "host1", "aqua");
    let handle: {
      openSessionInTree: (tabId: string, path: SplitPath, edge: DropEdge) => void;
      getSplitTree: () => SplitNode | null;
    } | null = null;
    render(
      <MechanismScaffold
        tabs={[tabA]}
        registerHandle={(h) => {
          handle = h;
        }}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      handle!.openSessionInTree(tabA.id, [], "left");
      await Promise.resolve();
    });
    // Every setItem call from the mechanism's lifetime — assert neither of
    // the retired keys is ever written.
    const calls = localStorageSetItemSpy.mock.calls;
    for (const call of calls) {
      const key = call[0];
      expect(key).not.toBe("skynet_splitMode");
      expect(key).not.toBe("skynet_paneTabIds");
    }
  });

  it("Test 6: Portal-preservation contract — Object.is holds on the tab's DOM node across a cross-cell move", async () => {
    const tabA = makeTab("t-aaa", "host1", "aqua");
    const tabB = makeTab("t-bbb", "host1", "nelly");
    let handle: {
      openSessionInTree: (tabId: string, path: SplitPath, edge: DropEdge) => void;
      getSplitTree: () => SplitNode | null;
    } | null = null;
    render(
      <MechanismScaffold
        tabs={[tabA, tabB]}
        registerHandle={(h) => {
          handle = h;
        }}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    // Seed the tree: two leaves — tabA on the left, tabB on the right.
    await act(async () => {
      handle!.openSessionInTree(tabA.id, [], "left");
      await Promise.resolve();
    });
    await act(async () => {
      handle!.openSessionInTree(tabB.id, [], "right");
      await Promise.resolve();
    });
    // Grab tabA's DOM node (the portal target that AppShell reparents).
    const contentABefore = document.querySelector('[data-testid="content-t-aaa"]');
    expect(contentABefore).not.toBeNull();
    const nodeABefore = contentABefore!.parentElement as HTMLDivElement;
    expect(nodeABefore).not.toBeNull();
    expect(nodeABefore.getAttribute("data-tab-node-for")).toBe("t-aaa");

    // Move tabA to the other side by calling openSessionInTree with a
    // different edge — same tabId, so removeLeaf-then-insert triggers a
    // cross-cell rearrange.
    await act(async () => {
      handle!.openSessionInTree(tabA.id, [], "right");
      await Promise.resolve();
    });

    const contentAAfter = document.querySelector('[data-testid="content-t-aaa"]');
    expect(contentAAfter).not.toBeNull();
    const nodeAAfter = contentAAfter!.parentElement as HTMLDivElement;
    // Load-bearing assertion: SAME DOM node — reparented, not remounted.
    expect(Object.is(nodeAAfter, nodeABefore)).toBe(true);
  });

  it("Test 7: graceful degradation on stale URL — decoded tree is null (or a partial), no crash", async () => {
    // URL references a session that isn't in the tabs list. Decoder must
    // return null (or a collapsed partial) — Plan 56-01's Test 10.
    const staleFragment = `s=${encodeURIComponent("tmux:host1:ghost")}&t=0`;
    const tabParams = `tab=${encodeURIComponent("tmux:host1:aqua")}`;
    window.history.replaceState(null, "", `#${tabParams}&${staleFragment}`);
    // Only tabA is available; the URL references a ghost session.
    const tabA = makeTab("t-aaa", "host1", "aqua");
    let handle: {
      openSessionInTree: (tabId: string, path: SplitPath, edge: DropEdge) => void;
      getSplitTree: () => SplitNode | null;
    } | null = null;
    const { container } = render(
      <MechanismScaffold
        tabs={[tabA]}
        registerHandle={(h) => {
          handle = h;
        }}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    // The tree stays null — the ghost leaf couldn't resolve, and the
    // resulting tree of one collapsed nothing is null.
    expect(handle!.getSplitTree()).toBeNull();
    // No blank-screen: the normal-view container is present.
    expect(container.querySelector('[data-testid="normal-view"]')).not.toBeNull();
    // The SplitView gate is hidden (display: none) because splitTree === null.
    const gate = container.querySelector('[data-testid="splitview-gate"]') as HTMLElement;
    expect(gate.style.display).toBe("none");
  });

  it("Test 8: mispaint-gate — SplitView container renders display:none on first paint when splitTree === null", async () => {
    // No URL fragment; splitTree === null on mount. The visibility gate
    // must render display:'none' so a mispaint of "no split" doesn't leak
    // through while any downstream URL-restore effect settles.
    const tabA = makeTab("t-aaa", "host1", "aqua");
    let handle: {
      openSessionInTree: (tabId: string, path: SplitPath, edge: DropEdge) => void;
      getSplitTree: () => SplitNode | null;
    } | null = null;
    const { container } = render(
      <MechanismScaffold
        tabs={[tabA]}
        registerHandle={(h) => {
          handle = h;
        }}
      />,
    );
    const gate = container.querySelector('[data-testid="splitview-gate"]') as HTMLElement;
    expect(gate).not.toBeNull();
    // First-paint invariant: splitTree null → display: 'none'.
    expect(gate.style.display).toBe("none");
    // After openSessionInTree fires (simulating a settled URL-restore), the
    // gate flips to display: 'flex'.
    await act(async () => {
      handle!.openSessionInTree(tabA.id, [], "left");
      await Promise.resolve();
    });
    expect(gate.style.display).toBe("flex");
  });

  it("Test 9: openSessionInTree preserves surviving cells when dragging an already-open session into a deep tree (Phase 56 code-review HIGH)", async () => {
    // Regression guard for the path-shift bug caught in Phase 56 code
    // review: given a nested tree, moving a session that lives in a
    // collapsible ancestor invalidates any subsequent path index in the
    // original path. The old code walked the stale path, threw, caught,
    // and root-inserted just the moved session — silently deleting every
    // other surviving cell. Post-fix: recompute the target's path in the
    // post-removal tree via findLeaf, then insert against that fresh path.
    const tabA = makeTab("t-aaa", "host1", "aqua");
    const tabB = makeTab("t-bbb", "host1", "bella");
    const tabC = makeTab("t-ccc", "host1", "carol");
    let handle: {
      openSessionInTree: (tabId: string, path: SplitPath, edge: DropEdge) => void;
      getSplitTree: () => SplitNode | null;
    } | null = null;
    render(
      <MechanismScaffold
        tabs={[tabA, tabB, tabC]}
        registerHandle={(h) => {
          handle = h;
        }}
      />,
    );
    // Build the offending tree shape:
    //   split-v(A, split-h(B, C))
    // Step 1: A takes root (drop into empty).
    await act(async () => {
      handle!.openSessionInTree(tabA.id, [], "left");
      await Promise.resolve();
    });
    // Step 2: B drops on A's bottom edge → split-v(A, B).
    await act(async () => {
      handle!.openSessionInTree(tabB.id, [], "bottom");
      await Promise.resolve();
    });
    // Step 3: C drops on B's right edge (path [1] in split-v(A,B)) →
    // split-v(A, split-h(B, C)).
    await act(async () => {
      handle!.openSessionInTree(tabC.id, [1], "right");
      await Promise.resolve();
    });
    const initial = handle!.getSplitTree();
    expect(initial).not.toBeNull();
    expect(collectTabIds(initial!).sort()).toEqual(["t-aaa", "t-bbb", "t-ccc"]);
    // Now trigger the bug scenario: drag A (currently at path [0]) onto
    // B (currently at path [1, 0]) with edge='left'. The pre-fix code
    // path was:
    //   removeLeaf(A) → tree becomes split-h(B, C) — outer split-v collapsed.
    //   insertAtEdge(split-h(B,C), [1,0], leaf(A), 'left') — walk to [1,0]:
    //     children[1] = C leaf; descend [0] into leaf → throws.
    //   catch → insertAtEdge(null, [], leaf(A), 'left') = leaf(A). B and C GONE.
    await act(async () => {
      handle!.openSessionInTree(tabA.id, [1, 0], "left");
      await Promise.resolve();
    });
    const after = handle!.getSplitTree();
    expect(after).not.toBeNull();
    // Load-bearing assertion: ALL THREE tabs survive. The old code kept
    // only tabA.
    expect(collectTabIds(after!).sort()).toEqual(["t-aaa", "t-bbb", "t-ccc"]);
  });

  it("Test 10: openSessionInTree on same-cell drop is a no-op (avoids the null-and-back flicker)", async () => {
    const tabA = makeTab("t-aaa", "host1", "aqua");
    let handle: {
      openSessionInTree: (tabId: string, path: SplitPath, edge: DropEdge) => void;
      getSplitTree: () => SplitNode | null;
    } | null = null;
    render(
      <MechanismScaffold
        tabs={[tabA]}
        registerHandle={(h) => {
          handle = h;
        }}
      />,
    );
    await act(async () => {
      handle!.openSessionInTree(tabA.id, [], "left");
      await Promise.resolve();
    });
    const before = handle!.getSplitTree();
    expect(before).not.toBeNull();
    // Same cell (path [] = root leaf, tabId is that leaf). Should be a
    // no-op: return prev unchanged, NOT drop-through null-and-back.
    await act(async () => {
      handle!.openSessionInTree(tabA.id, [], "right");
      await Promise.resolve();
    });
    const after = handle!.getSplitTree();
    // Object.is because the no-op returns `prev` verbatim from the
    // setState callback, which React's useState honors as "no change".
    expect(Object.is(after, before)).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 64 Plan 02 Task 2 — AppShell replaceInTree + swapInTree integration
  // tests. Exercise the new setSplitTree wrappers around Plan 64-01's
  // replaceLeaf + swapLeaves helpers end-to-end, verifying the tabs[] and
  // portal-preservation invariants Ashley locked in CONTEXT.md.
  //
  // See:
  //   .planning/phases/64-multi-view-center-drop/64-CONTEXT.md §
  //     In-scope items 2 + 6, § Test coverage additions § Plan 64-02
  //     AppShell integration tests (Tests 19-21 renumbered locally to
  //     Phase 64 Tests 1-3).
  //   64-02-PLAN.md Task 2 <behavior> block.
  // ─────────────────────────────────────────────────────────────────────────

  it("Phase 64 Test 1: end-to-end swap via center-drop preserves both sessions in tabs[] and trades cells", async () => {
    const tabA = makeTab("t-aaa", "host1", "aqua");
    const tabB = makeTab("t-bbb", "host1", "nelly");
    let handle: {
      openSessionInTree: (
        tabId: string,
        path: SplitPath,
        edge: DropEdge,
      ) => void;
      replaceInTree: (replacementTabId: string, targetTabId: string) => void;
      swapInTree: (tabIdA: string, tabIdB: string) => void;
      getSplitTree: () => SplitNode | null;
    } | null = null;
    const observedTrees: Array<SplitNode | null> = [];
    render(
      <MechanismScaffold
        tabs={[tabA, tabB]}
        registerHandle={(h) => {
          handle = h;
        }}
        onSplitTreeChange={(tree) => {
          observedTrees.push(tree);
        }}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    // Seed: split-v(A on left, B on right).
    await act(async () => {
      handle!.openSessionInTree(tabA.id, [], "left");
      await Promise.resolve();
    });
    await act(async () => {
      handle!.openSessionInTree(tabB.id, [], "right");
      await Promise.resolve();
    });
    const preSwap = handle!.getSplitTree();
    expect(preSwap).not.toBeNull();
    expect(preSwap!.kind).toBe("split");
    expect(collectTabIds(preSwap!).sort()).toEqual(["t-aaa", "t-bbb"]);
    // Swap A ↔ B via center-drop dispatch path.
    await act(async () => {
      handle!.swapInTree("t-aaa", "t-bbb");
      await Promise.resolve();
    });
    const postSwap = handle!.getSplitTree();
    expect(postSwap).not.toBeNull();
    expect(postSwap!.kind).toBe("split");
    // Both leaves still present — tree shape identical, only leaf tabIds
    // traded. The URL-sync effect fires on splitTree change (verified by
    // observedTrees capturing at least the seed + swap emissions); tabs[]
    // never changes (scaffold's tabs prop is the passed [tabA, tabB]
    // literal, no closeTab call was made).
    expect(collectTabIds(postSwap!).sort()).toEqual(["t-aaa", "t-bbb"]);
    // Verify the actual swap took place: A's path pre vs post.
    const pathABefore = findLeaf(preSwap!, "t-aaa");
    const pathAAfter = findLeaf(postSwap!, "t-aaa");
    const pathBBefore = findLeaf(preSwap!, "t-bbb");
    const pathBAfter = findLeaf(postSwap!, "t-bbb");
    expect(pathABefore).not.toEqual(pathAAfter);
    expect(pathBBefore).not.toEqual(pathBAfter);
    // A ended up in B's old cell and vice versa.
    expect(pathAAfter).toEqual(pathBBefore);
    expect(pathBAfter).toEqual(pathABefore);
    // URL-sync fires via setSplitTree — the encoded s= fragment reflects
    // the new tree.
    await act(async () => {
      await Promise.resolve();
    });
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    expect(params.get("s")).not.toBeNull();
    expect(params.get("t")).not.toBeNull();
  });

  it("Phase 64 Test 2: end-to-end replace via center-drop kicks displaced session out of tree, keeps it in tabs[]", async () => {
    const tabA = makeTab("t-aaa", "host1", "aqua");
    const tabB = makeTab("t-bbb", "host1", "nelly");
    let handle: {
      openSessionInTree: (
        tabId: string,
        path: SplitPath,
        edge: DropEdge,
      ) => void;
      replaceInTree: (replacementTabId: string, targetTabId: string) => void;
      swapInTree: (tabIdA: string, tabIdB: string) => void;
      getSplitTree: () => SplitNode | null;
    } | null = null;
    render(
      <MechanismScaffold
        tabs={[tabA, tabB]}
        registerHandle={(h) => {
          handle = h;
        }}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      handle!.openSessionInTree(tabA.id, [], "left");
      await Promise.resolve();
    });
    await act(async () => {
      handle!.openSessionInTree(tabB.id, [], "right");
      await Promise.resolve();
    });
    const preReplace = handle!.getSplitTree();
    expect(preReplace).not.toBeNull();
    expect(collectTabIds(preReplace!).sort()).toEqual(["t-aaa", "t-bbb"]);
    // Center-drop: A (already in tree) replaces B's cell. Per Plan 64-01
    // replaceLeaf, the mainline branch first calls removeLeaf(A) — which
    // collapses the vertical split — then rediscovers B's path and replaces
    // B's leaf with A. Result: single-leaf root of A. B evicted from tree
    // but still in tabs[] (Phase 64 replace is a tree-op, not a
    // tab-lifecycle op — scaffold does not call any closeTab-analog per
    // CONTEXT.md § What this is line 3: "still present in the conv list,
    // no longer occupying a slot").
    await act(async () => {
      handle!.replaceInTree("t-aaa", "t-bbb");
      await Promise.resolve();
    });
    const postReplace = handle!.getSplitTree();
    expect(postReplace).not.toBeNull();
    expect(postReplace).toEqual({ kind: "session", tabId: "t-aaa" });
    // A is at root []; B is gone from the tree.
    expect(findLeaf(postReplace!, "t-aaa")).toEqual([]);
    expect(findLeaf(postReplace!, "t-bbb")).toBeNull();
    // CRITICAL — tabs[] invariant: the scaffold's tabs prop is UNCHANGED
    // (still [tabA, tabB]). The displaced session B stays live, just kicked
    // out of the grid. Phase 64 does not call any closeTab-analog for the
    // displaced session; the scaffold has no closeTab wire so this
    // invariant holds by absence of a mutation path.
  });

  it("Phase 64 Test 3: portal-preservation across center-drop swap — Object.is holds on both nodes (mirrors Test 6)", async () => {
    const tabA = makeTab("t-aaa", "host1", "aqua");
    const tabB = makeTab("t-bbb", "host1", "nelly");
    let handle: {
      openSessionInTree: (
        tabId: string,
        path: SplitPath,
        edge: DropEdge,
      ) => void;
      replaceInTree: (replacementTabId: string, targetTabId: string) => void;
      swapInTree: (tabIdA: string, tabIdB: string) => void;
      getSplitTree: () => SplitNode | null;
    } | null = null;
    render(
      <MechanismScaffold
        tabs={[tabA, tabB]}
        registerHandle={(h) => {
          handle = h;
        }}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      handle!.openSessionInTree(tabA.id, [], "left");
      await Promise.resolve();
    });
    await act(async () => {
      handle!.openSessionInTree(tabB.id, [], "right");
      await Promise.resolve();
    });
    // Grab both sessions' portal-target DOM nodes BEFORE swap.
    const contentABefore = document.querySelector(
      '[data-testid="content-t-aaa"]',
    );
    const contentBBefore = document.querySelector(
      '[data-testid="content-t-bbb"]',
    );
    expect(contentABefore).not.toBeNull();
    expect(contentBBefore).not.toBeNull();
    const nodeABefore = contentABefore!.parentElement as HTMLDivElement;
    const nodeBBefore = contentBBefore!.parentElement as HTMLDivElement;
    expect(nodeABefore.getAttribute("data-tab-node-for")).toBe("t-aaa");
    expect(nodeBBefore.getAttribute("data-tab-node-for")).toBe("t-bbb");
    // Fire the swap. MechanismScaffold's DOM-placement effect at :249-277
    // reparents each tab's node into whichever Pane the tab is now
    // assigned to. It iterates `tabs`, not paths, so the swap is
    // transparent to the reparenting logic — the effect body invariant
    // is preserved: each tab gets its SAME per-tab node placed under the
    // matching pane element by findLeaf lookup.
    await act(async () => {
      handle!.swapInTree("t-aaa", "t-bbb");
      await Promise.resolve();
    });
    // Regrab the DOM nodes AFTER swap.
    const contentAAfter = document.querySelector(
      '[data-testid="content-t-aaa"]',
    );
    const contentBAfter = document.querySelector(
      '[data-testid="content-t-bbb"]',
    );
    expect(contentAAfter).not.toBeNull();
    expect(contentBAfter).not.toBeNull();
    const nodeAAfter = contentAAfter!.parentElement as HTMLDivElement;
    const nodeBAfter = contentBAfter!.parentElement as HTMLDivElement;
    // Load-bearing assertions — SAME DOM nodes reparented, not remounted.
    // Phase 64 swap is a leaf-content-only tree mutation; the underlying
    // React subtree does not unmount. CONTEXT.md § What would make Phase
    // 64 wrong: "Portal preservation broken on swap."
    expect(Object.is(nodeAAfter, nodeABefore)).toBe(true);
    expect(Object.is(nodeBAfter, nodeBBefore)).toBe(true);
  });
});
