// ─── SplitView.test.tsx ─────────────────────────────────────────────────────
// Phase 56 Plan 02 Task 1 — vitest suite for the recursive-tree renderer.
//
// Tests cite plan-item numbers from the `<behavior>` block of the Task 1
// spec. See:
//   .planning/phases/56-visual-session-management-foundation-recursive-split-tree-da/56-02-PLAN.md
//
// Tests 1-6 assert the shape the AppShell wire-swap (Task 2) depends on:
//   Test 1  single-leaf mounts one content div, zero dividers, one tab-id.
//   Test 2  horizontal split → stacked (flex column), one divider between.
//   Test 3  vertical split → side-by-side (flex row), one divider between.
//   Test 4  null tree → empty drop-target, drop invokes callback with [].
//   Test 5  constant-ratio 50/50 wrapping via flex: 1 1 0 on each subtree.
//   Test 6  onPaneContentRef callback shape is (tabId, HTMLDivElement | null).
//
// Test 7 (Plan 56-02) — Pane drop forwards (payloadTabId, path, 'left') — was
// the stub-era assertion for Plan 56-02's `computeEdgeFromDrop => 'left'`.
// It is DELETED in Plan 56-03 and superseded by Tests 6-7 of the new
// "Phase 56 Plan 03: nearest-edge drop geometry" describe block below,
// which assert the real geometry-driven edge computed against a mocked
// getBoundingClientRect. See Plan 56-03 Task 2 acceptance criteria.
//
// jsdom setup mirrors the split-tree.test.ts + AppShell.persistence.test.tsx
// patterns. We MOCK react-i18next to avoid pulling the whole i18n provider
// tree — the same lightweight shim shape used elsewhere in the repo.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, createEvent, cleanup } from "@testing-library/react";
import { SplitView, computeNearestEdge } from "./SplitView";
import type { SplitNode, SplitPath, DropEdge } from "@/lib/split-tree";
import type { Tab } from "@/types/ui-types";

// Lightweight react-i18next mock. useTranslation returns a passthrough `t`
// that echoes the key back (matches the render assertion here — we only need
// to be sure the component mounts).
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

// tabIcon is imported from @/shell/tabUtils; mock it to a stable spy string so
// we don't have to pull the icon tree.
vi.mock("@/shell/tabUtils", () => ({
  tabIcon: (_type: string) => "ICON",
}));

// ─── fixtures ────────────────────────────────────────────────────────────────

function makeTab(id: string, label: string): Tab {
  return {
    id,
    instanceId: id,
    type: "terminal",
    label,
    openedAt: 0,
    targetTmuxSession: null,
  } as unknown as Tab;
}

const tabA = makeTab("aaa", "Alpha");
const tabB = makeTab("bbb", "Bravo");

const leaf = (tabId: string): SplitNode => ({ kind: "session", tabId });
const split = (
  direction: "horizontal" | "vertical",
  a: SplitNode,
  b: SplitNode,
): SplitNode => ({ kind: "split", direction, children: [a, b] });

beforeEach(() => {
  cleanup();
});

// ─── tests ───────────────────────────────────────────────────────────────────

describe("SplitView — recursive-tree renderer (Phase 56 Plan 02 Task 1)", () => {
  it("Test 1: single leaf renders one Pane content-div and zero dividers", () => {
    const tree: SplitNode = leaf("aaa");
    const { container } = render(
      <SplitView splitTree={tree} tabs={[tabA]} />,
    );
    const contentDivs = container.querySelectorAll("[data-tab-id]");
    expect(contentDivs.length).toBe(1);
    expect(contentDivs[0].getAttribute("data-tab-id")).toBe("aaa");
    const dividers = container.querySelectorAll('[role="separator"]');
    expect(dividers.length).toBe(0);
  });

  it("Test 2: horizontal split renders stacked (flexDirection: column) with exactly one divider", () => {
    const tree: SplitNode = split("horizontal", leaf("aaa"), leaf("bbb"));
    const { container } = render(
      <SplitView splitTree={tree} tabs={[tabA, tabB]} />,
    );
    const contentDivs = container.querySelectorAll("[data-tab-id]");
    expect(contentDivs.length).toBe(2);
    const ids = Array.from(contentDivs).map((d) => d.getAttribute("data-tab-id"));
    expect(ids).toEqual(["aaa", "bbb"]);
    const dividers = container.querySelectorAll('[role="separator"]');
    expect(dividers.length).toBe(1);
    expect(dividers[0].getAttribute("aria-orientation")).toBe("horizontal");
    // Find the split container — the direct wrapper of the two subtrees + divider.
    // We look for a flex container whose inline flexDirection is 'column'.
    const flexColumnContainer = Array.from(
      container.querySelectorAll("div"),
    ).find((el) => (el.style.flexDirection === "column") && el.contains(dividers[0]));
    expect(flexColumnContainer).toBeDefined();
  });

  it("Test 3: vertical split renders side-by-side (flexDirection: row) with exactly one divider", () => {
    const tree: SplitNode = split("vertical", leaf("aaa"), leaf("bbb"));
    const { container } = render(
      <SplitView splitTree={tree} tabs={[tabA, tabB]} />,
    );
    const contentDivs = container.querySelectorAll("[data-tab-id]");
    expect(contentDivs.length).toBe(2);
    const dividers = container.querySelectorAll('[role="separator"]');
    expect(dividers.length).toBe(1);
    expect(dividers[0].getAttribute("aria-orientation")).toBe("vertical");
    const flexRowContainer = Array.from(
      container.querySelectorAll("div"),
    ).find((el) => (el.style.flexDirection === "row") && el.contains(dividers[0]));
    expect(flexRowContainer).toBeDefined();
  });

  it("Test 4: null tree renders zero Pane content-divs and a drop-target that fires onOpenSessionInTree(tabId, [], 'left')", () => {
    const onOpenSessionInTree = vi.fn();
    const { container } = render(
      <SplitView
        splitTree={null}
        tabs={[]}
        onOpenSessionInTree={onOpenSessionInTree}
      />,
    );
    const contentDivs = container.querySelectorAll("[data-tab-id]");
    expect(contentDivs.length).toBe(0);
    // EmptyDropTarget is the deepest div. Fire on the deepest div with the
    // dashed-square grid pattern (grid-cols-2) — that's inside the drop
    // container so the drop event bubbles to the drop handler via React's
    // synthetic-event delegation. Simpler: fire on every leaf div until one
    // triggers the handler, or (better) fire on the deepest descendant of
    // the SplitView root.
    const allDivs = Array.from(container.querySelectorAll("div"));
    expect(allDivs.length).toBeGreaterThan(0);
    // Choose the deepest div — its ancestor chain contains the drop-handler
    // element, so React's synthetic event bubbles up to it.
    const deepest = allDivs.reduce((deep, el) => {
      let depth = 0;
      let cur: Element | null = el;
      while (cur && cur !== container) {
        depth += 1;
        cur = cur.parentElement;
      }
      return depth > deep.depth ? { el, depth } : deep;
    }, { el: allDivs[0], depth: 0 }).el;
    fireEvent.drop(deepest, {
      dataTransfer: {
        types: ["text/plain"],
        getData: (k: string) => (k === "text/plain" ? "xyz" : ""),
      },
    });
    expect(onOpenSessionInTree).toHaveBeenCalledTimes(1);
    expect(onOpenSessionInTree).toHaveBeenCalledWith("xyz", [], "left");
  });

  it("Test 5: split children wrap in equal-ratio flex boxes (constant-ratio 50/50)", () => {
    const tree: SplitNode = split("vertical", leaf("aaa"), leaf("bbb"));
    const { container } = render(
      <SplitView splitTree={tree} tabs={[tabA, tabB]} />,
    );
    // Look for divs with flexGrow=1 AND flexShrink=1 AND flexBasis=0 (or "0px").
    // We use the longhand triple deliberately — jsdom's strict CSS parser
    // rejects the `flex: 1 1 0` shorthand (unitless zero in the basis slot),
    // so we set the longhand fields via React's style prop.
    const wrappers = Array.from(container.querySelectorAll("div")).filter(
      (el) => {
        const grow = el.style.flexGrow || "";
        const shrink = el.style.flexShrink || "";
        const basis = el.style.flexBasis || "";
        return (
          grow === "1" &&
          shrink === "1" &&
          (basis === "0" || basis === "0px")
        );
      },
    );
    expect(wrappers.length).toBeGreaterThanOrEqual(2);
    // No % based inline widths / heights anywhere — we don't emit any.
    const percentInline = Array.from(container.querySelectorAll("div")).some(
      (el) =>
        (el.style.width && el.style.width.endsWith("%")) ||
        (el.style.height && el.style.height.endsWith("%")),
    );
    expect(percentInline).toBe(false);
  });

  it("Test 6: onPaneContentRef fires with (tabId, HTMLDivElement) on mount and (tabId, null) on unmount", () => {
    const calls: Array<[string, HTMLDivElement | null]> = [];
    const spy = (tabId: string, el: HTMLDivElement | null) => {
      calls.push([tabId, el]);
    };
    const tree: SplitNode = leaf("aaa");
    const { unmount } = render(
      <SplitView
        splitTree={tree}
        tabs={[tabA]}
        onPaneContentRef={spy}
      />,
    );
    // First call must attach with a real element for the leaf's tabId.
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const attach = calls.find(
      ([id, el]) => id === "aaa" && el instanceof HTMLDivElement,
    );
    expect(attach).toBeDefined();
    // Detach on unmount — must fire with null for the same tabId.
    unmount();
    const detach = calls.find(([id, el]) => id === "aaa" && el === null);
    expect(detach).toBeDefined();
  });

  // Test 7 (Plan 56-02 stub-era assertion) DELETED — see file-top comment.
  // Real geometry-driven coverage lives in the Plan 56-03 describe block
  // that follows this one.
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 56 Plan 03 Task 2 — nearest-edge drop geometry.
//
// Tests 1-5: unit tests for the exported pure function `computeNearestEdge`.
// Tests 6-8: integration tests wiring Pane onDrop through getBoundingClientRect
// mocked via Object.defineProperty. The mocked rect + fireEvent.drop clientX/Y
// combine to compute a real edge and forward it to onOpenSessionInTree.
//
// Tie-break priority for computeNearestEdge (documented on the function):
// left → top → right → bottom (first-match-wins).
// ─────────────────────────────────────────────────────────────────────────────

describe("SplitView — Phase 56 Plan 03: nearest-edge drop geometry", () => {
  // 100x100 rect anchored at origin — used for the unit tests 1-5.
  const rect = {
    left: 0,
    right: 100,
    top: 0,
    bottom: 100,
  } as const;

  it("Test 1: left-biased drop → 'left' (dLeft=10 wins vs dRight=90, dTop=50, dBottom=50)", () => {
    expect(computeNearestEdge(rect, 10, 50)).toBe("left");
  });

  it("Test 2: right-biased drop → 'right' (dRight=10 wins)", () => {
    expect(computeNearestEdge(rect, 90, 50)).toBe("right");
  });

  it("Test 3: top-biased drop → 'top' (dTop=10 wins)", () => {
    expect(computeNearestEdge(rect, 50, 10)).toBe("top");
  });

  it("Test 4: bottom-biased drop → 'bottom' (dBottom=10 wins)", () => {
    expect(computeNearestEdge(rect, 50, 90)).toBe("bottom");
  });

  it("Test 5: dead-center tie → 'left' by documented left→top→right→bottom priority", () => {
    // All four distances equal 50; tie-break priority returns 'left'.
    expect(computeNearestEdge(rect, 50, 50)).toBe("left");
  });

  // jsdom does not implement `window.DragEvent`; RTL falls back to `Event`,
  // which doesn't accept `clientX`/`clientY` via its constructor init. We
  // build the drop event via `createEvent.drop`, then define clientX/clientY
  // on it via Object.defineProperty before dispatching. The React synthetic
  // event exposes the underlying nativeEvent's clientX/Y at e.clientX/Y.
  function dispatchDropAt(
    el: Element,
    clientX: number,
    clientY: number,
    dataTransfer: { getData: (k: string) => string; types?: readonly string[] },
  ): void {
    // Patch #510 gate on Pane onDrop requires `dataTransfer.types` to be a
    // string[] with "text/plain" present (conv-list-row drag shape). Real
    // browser drag events always populate `types`; jsdom's DataTransfer
    // shim on our old ~4.x line doesn't, so tests supply it here.
    const dtWithTypes = {
      types: ["text/plain"] as readonly string[],
      ...dataTransfer,
    };
    const evt = createEvent.drop(el, { dataTransfer: dtWithTypes });
    Object.defineProperty(evt, "clientX", { value: clientX, configurable: true });
    Object.defineProperty(evt, "clientY", { value: clientY, configurable: true });
    fireEvent(el, evt);
  }

  // Walk from a [data-tab-id] descendant up to the Pane's outer div — the
  // element that owns the onDrop handler (React sets e.currentTarget to it).
  function findPaneOuter(from: HTMLElement): HTMLElement {
    let cur: HTMLElement | null = from.parentElement;
    while (cur && !cur.className.includes("relative flex flex-col")) {
      cur = cur.parentElement;
    }
    if (!cur) throw new Error("Pane outer div not found");
    return cur;
  }

  it("Test 6: Pane onDrop at (15,50) on a 200x100 cell → onOpenSessionInTree('newtab', [], 'left')", () => {
    const onOpenSessionInTree =
      vi.fn<(tabId: string, path: SplitPath, edge: DropEdge) => void>();
    const tree: SplitNode = leaf("aaa");
    const { container } = render(
      <SplitView
        splitTree={tree}
        tabs={[tabA]}
        onOpenSessionInTree={onOpenSessionInTree}
      />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    expect(contentEl).not.toBeNull();
    const paneOuter = findPaneOuter(contentEl);
    // Mock getBoundingClientRect on the Pane's outer div — the element that
    // is e.currentTarget inside the onDrop handler. 200x100 cell anchored at
    // origin. (15,50) is 15 from left, 185 from right, 50 from top/bottom —
    // 'left' wins.
    paneOuter.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 200,
        top: 0,
        bottom: 100,
        width: 200,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    dispatchDropAt(paneOuter, 15, 50, {
      getData: (k: string) => (k === "text/plain" ? "newtab" : ""),
    });
    expect(onOpenSessionInTree).toHaveBeenCalledTimes(1);
    expect(onOpenSessionInTree).toHaveBeenCalledWith("newtab", [], "left");
  });

  it("Test 7: Pane onDrop threads path through deep tree — drop near right edge of cell B → [1], 'right'", () => {
    const onOpenSessionInTree =
      vi.fn<(tabId: string, path: SplitPath, edge: DropEdge) => void>();
    const tree: SplitNode = split("vertical", leaf("aaa"), leaf("bbb"));
    const { container } = render(
      <SplitView
        splitTree={tree}
        tabs={[tabA, tabB]}
        onOpenSessionInTree={onOpenSessionInTree}
      />,
    );
    const contentB = container.querySelector(
      '[data-tab-id="bbb"]',
    ) as HTMLElement;
    expect(contentB).not.toBeNull();
    const paneOuterB = findPaneOuter(contentB);
    // Cell B is the right half of a vertical split: rect is 100x100 anchored
    // at x=100. (190,50) is 90 from left (of cell B), 10 from right → 'right'.
    paneOuterB.getBoundingClientRect = () =>
      ({
        left: 100,
        right: 200,
        top: 0,
        bottom: 100,
        width: 100,
        height: 100,
        x: 100,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    dispatchDropAt(paneOuterB, 190, 50, {
      getData: (k: string) => (k === "text/plain" ? "newtab" : ""),
    });
    expect(onOpenSessionInTree).toHaveBeenCalledTimes(1);
    expect(onOpenSessionInTree).toHaveBeenCalledWith("newtab", [1], "right");
  });

  it("Test 8: dragover alone does NOT fire onOpenSessionInTree (only drop does)", () => {
    const onOpenSessionInTree =
      vi.fn<(tabId: string, path: SplitPath, edge: DropEdge) => void>();
    const tree: SplitNode = leaf("aaa");
    const { container } = render(
      <SplitView
        splitTree={tree}
        tabs={[tabA]}
        onOpenSessionInTree={onOpenSessionInTree}
      />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    // Patch #510 gate on onDragOver reads `dataTransfer.types` — supply
    // it here to match real browser event shape.
    fireEvent.dragOver(contentEl, {
      clientX: 50,
      clientY: 50,
      dataTransfer: { types: ["text/plain"], getData: () => "" },
    });
    expect(onOpenSessionInTree).not.toHaveBeenCalled();
  });
});
