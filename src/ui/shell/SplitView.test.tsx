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
    // quick-260829-mbp: gate now requires a skynet-owned MIME, not just
    // text/plain. Default includes application/x-skynet-row so existing
    // geometry/zone tests (which are semantically about edge-computation, not
    // MIME discrimination) continue to pass the gate. Callers that supply
    // their own types via the dataTransfer argument override this default.
    const dtWithTypes = {
      types: ["application/x-skynet-row", "text/plain"] as readonly string[],
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
    while (cur && !cur.className.includes("relative isolate flex flex-col")) {
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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 57 tests must not regress Phase 56's Plan 02 (Tests 1-6) or Plan 03
// (Tests 1-8) — those blocks above continue to pass unchanged. This describe
// adds Phase 57's overlay + zone + flicker + center-dead-zone coverage.
//
// Phase 57 Plan 02 Task 1 — drop-preview overlay + edge-zone hit-testing.
//
// Tests 1-11 + Test 13 (no discrete Test 12 — that is a documentation-only
// regression assertion satisfied by the overall pass of the Phase 56 blocks
// above).
//
// Helpers `dispatchDragOverAt` and `dispatchDragLeaveAt` replicate the full
// Phase 56 `dispatchDropAt` shape verbatim modulo the `createEvent.*` verb:
// jsdom's DragEvent init does not honor clientX/clientY passed via the
// constructor, so both helpers must use `createEvent.dragOver` /
// `createEvent.dragLeave` + `Object.defineProperty` for clientX/Y. Both
// helpers attach a `dataTransfer` stub with `types: ["text/plain"]` so the
// handler's type-gate does not early-return.
// ─────────────────────────────────────────────────────────────────────────────

describe("SplitView — Phase 57: drop-preview overlay + edge-zone hit-testing", () => {
  // Shared helpers — replicate `dispatchDropAt` shape for dragover / dragleave.
  function dispatchDragOverAt(
    el: Element,
    clientX: number,
    clientY: number,
    dataTransfer?: {
      getData?: (k: string) => string;
      types?: readonly string[];
    },
  ): void {
    const dtWithTypes = {
      // quick-260829-mbp: default includes a skynet MIME so existing
      // overlay/zone tests pass the tightened gate (they test geometry,
      // not MIME discrimination). Caller overrides via dataTransfer arg.
      types: ["application/x-skynet-row", "text/plain"] as readonly string[],
      getData: (_k: string) => "",
      ...(dataTransfer ?? {}),
    };
    const evt = createEvent.dragOver(el, { dataTransfer: dtWithTypes });
    Object.defineProperty(evt, "clientX", { value: clientX, configurable: true });
    Object.defineProperty(evt, "clientY", { value: clientY, configurable: true });
    fireEvent(el, evt);
  }

  function dispatchDragLeaveAt(
    el: Element,
    clientX: number,
    clientY: number,
  ): void {
    const dtWithTypes = {
      // quick-260829-mbp: default includes a skynet MIME so the tightened
      // dragleave gate does not early-return in existing zone tests.
      types: ["application/x-skynet-row", "text/plain"] as readonly string[],
      getData: (_k: string) => "",
    };
    const evt = createEvent.dragLeave(el, { dataTransfer: dtWithTypes });
    Object.defineProperty(evt, "clientX", { value: clientX, configurable: true });
    Object.defineProperty(evt, "clientY", { value: clientY, configurable: true });
    fireEvent(el, evt);
  }

  function dispatchDropAt(
    el: Element,
    clientX: number,
    clientY: number,
    dataTransfer: { getData: (k: string) => string; types?: readonly string[] },
  ): void {
    const dtWithTypes = {
      // quick-260829-mbp: default includes a skynet MIME so existing
      // geometry/zone tests pass the tightened onDrop gate.
      types: ["application/x-skynet-row", "text/plain"] as readonly string[],
      ...dataTransfer,
    };
    const evt = createEvent.drop(el, { dataTransfer: dtWithTypes });
    Object.defineProperty(evt, "clientX", { value: clientX, configurable: true });
    Object.defineProperty(evt, "clientY", { value: clientY, configurable: true });
    fireEvent(el, evt);
  }

  function findPaneOuter(from: HTMLElement): HTMLElement {
    let cur: HTMLElement | null = from.parentElement;
    while (cur && !cur.className.includes("relative isolate flex flex-col")) {
      cur = cur.parentElement;
    }
    if (!cur) throw new Error("Pane outer div not found");
    return cur;
  }

  function mockRect(
    el: HTMLElement,
    r: { left: number; right: number; top: number; bottom: number },
  ): void {
    el.getBoundingClientRect = () =>
      ({
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.right - r.left,
        height: r.bottom - r.top,
        x: r.left,
        y: r.top,
        toJSON: () => ({}),
      }) as DOMRect;
  }

  let infoSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("Test 1: Pane uses dropPreview state (structural check via grep-equivalent DOM absence of default overlay)", () => {
    // No drag in progress → no overlay rendered.
    const tree: SplitNode = leaf("aaa");
    const { container } = render(
      <SplitView splitTree={tree} tabs={[tabA]} />,
    );
    const overlay = container.querySelector(
      '[data-testid="pane-drop-preview-overlay"]',
    );
    expect(overlay).toBeNull();
  });

  it("Test 2: dragover at (10,50) on a 100x100 pane → left-half coral overlay", () => {
    const tree: SplitNode = leaf("aaa");
    const { container } = render(
      <SplitView splitTree={tree} tabs={[tabA]} />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    const paneOuter = findPaneOuter(contentEl);
    mockRect(paneOuter, { left: 0, right: 100, top: 0, bottom: 100 });
    dispatchDragOverAt(paneOuter, 10, 50);
    const overlay = container.querySelector(
      '[data-testid="pane-drop-preview-overlay"]',
    ) as HTMLElement | null;
    expect(overlay).not.toBeNull();
    expect(overlay!.getAttribute("data-zone")).toBe("left");
    // Left half: left=0, top=0, width=50, height=100.
    expect(overlay!.style.left).toBe("0px");
    expect(overlay!.style.top).toBe("0px");
    expect(overlay!.style.width).toBe("50px");
    expect(overlay!.style.height).toBe("100px");
  });

  it("Test 3: dragover at (50,10) on a 100x100 pane → top-half coral overlay", () => {
    const tree: SplitNode = leaf("aaa");
    const { container } = render(
      <SplitView splitTree={tree} tabs={[tabA]} />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    const paneOuter = findPaneOuter(contentEl);
    mockRect(paneOuter, { left: 0, right: 100, top: 0, bottom: 100 });
    dispatchDragOverAt(paneOuter, 50, 10);
    const overlay = container.querySelector(
      '[data-testid="pane-drop-preview-overlay"]',
    ) as HTMLElement | null;
    expect(overlay).not.toBeNull();
    expect(overlay!.getAttribute("data-zone")).toBe("top");
    expect(overlay!.style.left).toBe("0px");
    expect(overlay!.style.top).toBe("0px");
    expect(overlay!.style.width).toBe("100px");
    expect(overlay!.style.height).toBe("50px");
  });

  it("Test 4: dragover at (50,50) — dead center — Phase 64 SUPERSEDED: center is now a live drop target when a skynet MIME is present", () => {
    // Phase 57 asserted "no overlay at dead center" per the shape-file's
    // "center dead zone" concept. Phase 64 Plan 02 retires the dead zone —
    // center is now a live drop target that renders a FULL-CELL coral
    // overlay when the drag carries a skynet MIME. This test is updated to
    // assert Phase 64's new semantics; the "no overlay for unknown MIME"
    // regression is asserted separately at Phase 64 Test 3.
    const tree: SplitNode = leaf("aaa");
    const { container } = render(
      <SplitView splitTree={tree} tabs={[tabA]} />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    const paneOuter = findPaneOuter(contentEl);
    mockRect(paneOuter, { left: 0, right: 100, top: 0, bottom: 100 });
    dispatchDragOverAt(paneOuter, 50, 50);
    const overlay = container.querySelector(
      '[data-testid="pane-drop-preview-overlay"]',
    ) as HTMLElement | null;
    // Phase 64: overlay DOES render for center when a skynet MIME is
    // present (the helper's default includes application/x-skynet-row).
    expect(overlay).not.toBeNull();
    expect(overlay!.getAttribute("data-zone")).toBe("center");
    // Ring affordance still absent — the coral overlay is the ONLY visual.
    expect(paneOuter.className).not.toContain("ring-2 ring-inset ring-accent-brand");
  });

  it("Test 5: dragover then dragleave OUTSIDE pane rect → overlay hides", () => {
    const tree: SplitNode = leaf("aaa");
    const { container } = render(
      <SplitView splitTree={tree} tabs={[tabA]} />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    const paneOuter = findPaneOuter(contentEl);
    mockRect(paneOuter, { left: 0, right: 100, top: 0, bottom: 100 });
    dispatchDragOverAt(paneOuter, 10, 50);
    expect(
      container.querySelector('[data-testid="pane-drop-preview-overlay"]'),
    ).not.toBeNull();
    dispatchDragLeaveAt(paneOuter, 150, 50); // outside rect
    expect(
      container.querySelector('[data-testid="pane-drop-preview-overlay"]'),
    ).toBeNull();
  });

  it("Test 6: FLICKER FIX — dragleave INSIDE pane rect → overlay STAYS visible", () => {
    const tree: SplitNode = leaf("aaa");
    const { container } = render(
      <SplitView splitTree={tree} tabs={[tabA]} />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    const paneOuter = findPaneOuter(contentEl);
    mockRect(paneOuter, { left: 0, right: 100, top: 0, bottom: 100 });
    dispatchDragOverAt(paneOuter, 10, 50);
    const overlayBefore = container.querySelector(
      '[data-testid="pane-drop-preview-overlay"]',
    );
    expect(overlayBefore).not.toBeNull();
    expect(overlayBefore!.getAttribute("data-zone")).toBe("left");
    // Simulate cursor crossing a child DOM boundary (still inside pane).
    dispatchDragLeaveAt(paneOuter, 30, 50);
    const overlayAfter = container.querySelector(
      '[data-testid="pane-drop-preview-overlay"]',
    );
    expect(overlayAfter).not.toBeNull();
    expect(overlayAfter!.getAttribute("data-zone")).toBe("left");
  });

  it("Test 7: center-drop — Phase 64 SUPERSEDED: dead-zone log retired; center now dispatches to replace/swap by MIME", () => {
    // Phase 57 asserted the center-dead-zone silent-return + a structured
    // `[pv-split-drop] center-dead-zone ignored` log. Phase 64 Plan 02
    // replaced that short-circuit with source-conditioned dispatch.
    //
    // Phase 64 /close finding (Addition 2) further tightened the center-drop
    // path: the text/plain-only fallback that previously accepted a bare
    // tabId string as a replace-source was REMOVED, because it opened a
    // hole for stray browser drags (text selection, external drag) to
    // clobber a live session. Now, a center drop with only text/plain
    // (no rich x-skynet-row or x-skynet-badge JSON payload) falls through
    // to the unknown-mime silent-no-op branch — same shape as an unknown
    // drop.
    //
    // This test asserts the current semantics after both changes:
    //   - Payload with types [row + text/plain] but no rich JSON body is
    //     rejected (badge JSON empty, row JSON empty, text/plain fallback
    //     retired) → no handler call.
    //   - Retired dead-zone log is gone.
    //   - New unknown-mime log fires instead of the (now-retired) replace-
    //     fallback log.
    // Deeper handler-dispatch coverage lives in Phase 64 Tests 5-9 below.
    const onOpenSessionInTree =
      vi.fn<(tabId: string, path: SplitPath, edge: DropEdge) => void>();
    const onDropRowInTree =
      vi.fn<(payload: unknown, path: SplitPath, edge: DropEdge) => void>();
    const onReplaceInTree =
      vi.fn<(replacement: string, target: string) => void>();
    const onSwapInTree =
      vi.fn<(a: string, b: string) => void>();
    const tree: SplitNode = leaf("aaa");
    const { container } = render(
      <SplitView
        splitTree={tree}
        tabs={[tabA]}
        onOpenSessionInTree={onOpenSessionInTree}
        onDropRowInTree={onDropRowInTree}
        onReplaceInTree={onReplaceInTree}
        onSwapInTree={onSwapInTree}
      />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    const paneOuter = findPaneOuter(contentEl);
    mockRect(paneOuter, { left: 0, right: 100, top: 0, bottom: 100 });
    dispatchDropAt(paneOuter, 50, 50, {
      getData: (k: string) => (k === "text/plain" ? "newtab" : ""),
    });
    // Phase 56 handlers still not called (center never routed through those).
    expect(onOpenSessionInTree).not.toHaveBeenCalled();
    expect(onDropRowInTree).not.toHaveBeenCalled();
    // Phase 64 /close finding (Addition 2): text/plain-only fallback
    // REMOVED. Payload has no rich JSON (both badge & row getData return
    // ""), text/plain is present but no longer counts — falls through to
    // unknown-mime silent no-op.
    expect(onReplaceInTree).not.toHaveBeenCalled();
    expect(onSwapInTree).not.toHaveBeenCalled();
    // Retired: `center-dead-zone ignored` no longer emitted.
    const deadZoneLog = infoSpy.mock.calls.some((args) =>
      args.some(
        (a) =>
          typeof a === "string" &&
          a.includes("[pv-split-drop] center-dead-zone ignored"),
      ),
    );
    expect(deadZoneLog).toBe(false);
    // Retired (Phase 64 Addition 2 fix): dispatch=replace-fallback log
    // no longer emitted either.
    const fallbackLog = infoSpy.mock.calls.some((args) =>
      args.some(
        (a) =>
          typeof a === "string" &&
          a.includes("[pv-split-drop] center-drop dispatch=replace-fallback"),
      ),
    );
    expect(fallbackLog).toBe(false);
    // New: unknown-mime log fires instead (fail-closed on bare text/plain).
    const unknownMimeLog = infoSpy.mock.calls.some((args) =>
      args.some(
        (a) =>
          typeof a === "string" &&
          a.includes("[pv-split-drop] center-drop-unknown-mime"),
      ),
    );
    expect(unknownMimeLog).toBe(true);
  });

  it("Test 8: edge-zone DROP preserves Phase 56 contract — onOpenSessionInTree('newtab', [], 'left')", () => {
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
    const paneOuter = findPaneOuter(contentEl);
    mockRect(paneOuter, { left: 0, right: 100, top: 0, bottom: 100 });
    dispatchDropAt(paneOuter, 10, 50, {
      getData: (k: string) => (k === "text/plain" ? "newtab" : ""),
    });
    expect(onOpenSessionInTree).toHaveBeenCalledTimes(1);
    expect(onOpenSessionInTree).toHaveBeenCalledWith("newtab", [], "left");
  });

  it("Test 9: [pv-split-preview] logs ONLY on zone changes, not every dragover", () => {
    const tree: SplitNode = leaf("aaa");
    const { container } = render(
      <SplitView splitTree={tree} tabs={[tabA]} />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    const paneOuter = findPaneOuter(contentEl);
    mockRect(paneOuter, { left: 0, right: 100, top: 0, bottom: 100 });

    const previewCalls = () =>
      infoSpy.mock.calls.filter((args) =>
        args.some(
          (a) =>
            typeof a === "string" && a.startsWith("[pv-split-preview] pane"),
        ),
      ).length;

    // First dragover — left zone — one new preview log.
    const before1 = previewCalls();
    dispatchDragOverAt(paneOuter, 10, 50);
    expect(previewCalls() - before1).toBe(1);

    // Second dragover — still left zone — no new log.
    const before2 = previewCalls();
    dispatchDragOverAt(paneOuter, 15, 50);
    expect(previewCalls() - before2).toBe(0);

    // Third dragover — now top zone — one new log.
    const before3 = previewCalls();
    dispatchDragOverAt(paneOuter, 50, 10);
    expect(previewCalls() - before3).toBe(1);

    // Confirm log content shape.
    const allPreviewLogs = infoSpy.mock.calls
      .flat()
      .filter(
        (a) => typeof a === "string" && a.startsWith("[pv-split-preview] pane"),
      ) as string[];
    expect(allPreviewLogs[0]).toContain("path=[]");
    expect(allPreviewLogs[0]).toContain("zone=left");
    expect(allPreviewLogs[1]).toContain("zone=top");
  });

  it("Test 10: overlay is pointer-events-none (so drag events reach the pane below)", () => {
    const tree: SplitNode = leaf("aaa");
    const { container } = render(
      <SplitView splitTree={tree} tabs={[tabA]} />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    const paneOuter = findPaneOuter(contentEl);
    mockRect(paneOuter, { left: 0, right: 100, top: 0, bottom: 100 });
    dispatchDragOverAt(paneOuter, 10, 50);
    const overlay = container.querySelector(
      '[data-testid="pane-drop-preview-overlay"]',
    ) as HTMLElement | null;
    expect(overlay).not.toBeNull();
    expect(overlay!.className).toContain("pointer-events-none");
  });

  it("Test 11: deep tree — dragover in cell B renders overlay INSIDE cell B only", () => {
    const tree: SplitNode = split("vertical", leaf("aaa"), leaf("bbb"));
    const { container } = render(
      <SplitView splitTree={tree} tabs={[tabA, tabB]} />,
    );
    const contentA = container.querySelector(
      '[data-tab-id="aaa"]',
    ) as HTMLElement;
    const contentB = container.querySelector(
      '[data-tab-id="bbb"]',
    ) as HTMLElement;
    const paneOuterA = findPaneOuter(contentA);
    const paneOuterB = findPaneOuter(contentB);
    mockRect(paneOuterA, { left: 0, right: 100, top: 0, bottom: 100 });
    mockRect(paneOuterB, { left: 100, right: 200, top: 0, bottom: 100 });
    // Fire dragover inside cell B, near the right edge.
    dispatchDragOverAt(paneOuterB, 190, 50);
    const overlays = container.querySelectorAll(
      '[data-testid="pane-drop-preview-overlay"]',
    );
    expect(overlays.length).toBe(1);
    // Overlay is a descendant of paneOuterB.
    expect(paneOuterB.contains(overlays[0])).toBe(true);
    expect(paneOuterA.contains(overlays[0])).toBe(false);
    // Right half of cell B in pane-local coords: left=50, top=0, width=50, height=100.
    const overlay = overlays[0] as HTMLElement;
    expect(overlay.getAttribute("data-zone")).toBe("right");
    expect(overlay.style.left).toBe("50px");
    expect(overlay.style.top).toBe("0px");
    expect(overlay.style.width).toBe("50px");
    expect(overlay.style.height).toBe("100px");
  });

  it("Test 13: window `dragend` clears the overlay (Escape-cancel path)", () => {
    const tree: SplitNode = leaf("aaa");
    const { container } = render(
      <SplitView splitTree={tree} tabs={[tabA]} />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    const paneOuter = findPaneOuter(contentEl);
    mockRect(paneOuter, { left: 0, right: 100, top: 0, bottom: 100 });
    dispatchDragOverAt(paneOuter, 10, 50);
    expect(
      container.querySelector('[data-testid="pane-drop-preview-overlay"]'),
    ).not.toBeNull();
    // Simulate Escape-cancel or drop-onto-non-Pane-target.
    fireEvent(window, new Event("dragend"));
    expect(
      container.querySelector('[data-testid="pane-drop-preview-overlay"]'),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 64 Plan 02 Task 1 — center-drop replace-vs-swap dispatch + full-cell
// coral overlay + two new Pane props (onReplaceInTree + onSwapInTree).
//
// See `.planning/phases/64-multi-view-center-drop/64-CONTEXT.md` §
// "Test coverage additions" § Plan 64-02 SplitView tests (Tests 10-18 in
// CONTEXT.md renumbered locally to Phase 64 Tests 1-9 here + Test 10 covering
// deep-tree center-drop from CONTEXT.md § Edge case #7 for robustness).
//
// Helpers redeclared locally — the Phase 57 describe's helpers are describe-
// scoped, not file-scoped. Redeclaring inline keeps the diff surface within
// the Phase 64 block (satisfies "no other file changes" plan-scope directive).
// ─────────────────────────────────────────────────────────────────────────────

describe("SplitView — Phase 64: center-drop replace-vs-swap", () => {
  // ── Local helpers (mirror Phase 57's describe-scoped helpers verbatim) ──
  function dispatchDragOverAt(
    el: Element,
    clientX: number,
    clientY: number,
    dataTransfer?: {
      getData?: (k: string) => string;
      types?: readonly string[];
    },
  ): void {
    const dtWithTypes = {
      types: ["application/x-skynet-row", "text/plain"] as readonly string[],
      getData: (_k: string) => "",
      ...(dataTransfer ?? {}),
    };
    const evt = createEvent.dragOver(el, { dataTransfer: dtWithTypes });
    Object.defineProperty(evt, "clientX", { value: clientX, configurable: true });
    Object.defineProperty(evt, "clientY", { value: clientY, configurable: true });
    fireEvent(el, evt);
  }

  function dispatchDragLeaveAt(
    el: Element,
    clientX: number,
    clientY: number,
  ): void {
    const dtWithTypes = {
      types: ["application/x-skynet-row", "text/plain"] as readonly string[],
      getData: (_k: string) => "",
    };
    const evt = createEvent.dragLeave(el, { dataTransfer: dtWithTypes });
    Object.defineProperty(evt, "clientX", { value: clientX, configurable: true });
    Object.defineProperty(evt, "clientY", { value: clientY, configurable: true });
    fireEvent(el, evt);
  }

  function dispatchDropAt(
    el: Element,
    clientX: number,
    clientY: number,
    dataTransfer: { getData: (k: string) => string; types?: readonly string[] },
  ): void {
    const dtWithTypes = {
      types: ["application/x-skynet-row", "text/plain"] as readonly string[],
      ...dataTransfer,
    };
    const evt = createEvent.drop(el, { dataTransfer: dtWithTypes });
    Object.defineProperty(evt, "clientX", { value: clientX, configurable: true });
    Object.defineProperty(evt, "clientY", { value: clientY, configurable: true });
    fireEvent(el, evt);
  }

  function findPaneOuter(from: HTMLElement): HTMLElement {
    let cur: HTMLElement | null = from.parentElement;
    while (cur && !cur.className.includes("relative isolate flex flex-col")) {
      cur = cur.parentElement;
    }
    if (!cur) throw new Error("Pane outer div not found");
    return cur;
  }

  function mockRect(
    el: HTMLElement,
    r: { left: number; right: number; top: number; bottom: number },
  ): void {
    el.getBoundingClientRect = () =>
      ({
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.right - r.left,
        height: r.bottom - r.top,
        x: r.left,
        y: r.top,
        toJSON: () => ({}),
      }) as DOMRect;
  }

  // ── Local fixtures ──
  const tabTarget = makeTab("target", "TargetTab");
  const tabC = makeTab("ccc", "Charlie");

  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  // ── Overlay rendering (Tests 1-4) ────────────────────────────────────────

  it("Phase 64 Test 1: badge-mime dragover at dead-center renders full-cell overlay (data-zone=center, geometry=full rect)", () => {
    const tree: SplitNode = leaf("target");
    const { container } = render(
      <SplitView splitTree={tree} tabs={[tabTarget]} />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    const paneOuter = findPaneOuter(contentEl);
    mockRect(paneOuter, { left: 0, right: 100, top: 0, bottom: 100 });
    dispatchDragOverAt(paneOuter, 50, 50, {
      types: ["application/x-skynet-badge", "text/plain"],
      getData: (_k: string) => "",
    });
    const overlay = container.querySelector(
      '[data-testid="pane-drop-preview-overlay"]',
    ) as HTMLElement | null;
    expect(overlay).not.toBeNull();
    expect(overlay!.getAttribute("data-zone")).toBe("center");
    expect(overlay!.style.left).toBe("0px");
    expect(overlay!.style.top).toBe("0px");
    expect(overlay!.style.width).toBe("100px");
    expect(overlay!.style.height).toBe("100px");
  });

  it("Phase 64 Test 2: row-mime dragover at dead-center renders full-cell overlay (data-zone=center, geometry=full rect)", () => {
    const tree: SplitNode = leaf("target");
    const { container } = render(
      <SplitView splitTree={tree} tabs={[tabTarget]} />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    const paneOuter = findPaneOuter(contentEl);
    mockRect(paneOuter, { left: 0, right: 100, top: 0, bottom: 100 });
    dispatchDragOverAt(paneOuter, 50, 50, {
      types: ["application/x-skynet-row", "text/plain"],
      getData: (_k: string) => "",
    });
    const overlay = container.querySelector(
      '[data-testid="pane-drop-preview-overlay"]',
    ) as HTMLElement | null;
    expect(overlay).not.toBeNull();
    expect(overlay!.getAttribute("data-zone")).toBe("center");
    expect(overlay!.style.left).toBe("0px");
    expect(overlay!.style.top).toBe("0px");
    expect(overlay!.style.width).toBe("100px");
    expect(overlay!.style.height).toBe("100px");
  });

  it("Phase 64 Test 3: unknown-mime (text/plain only) dragover at center renders NO overlay (hasSkynetDragPayload gate regression)", () => {
    const tree: SplitNode = leaf("target");
    const { container } = render(
      <SplitView splitTree={tree} tabs={[tabTarget]} />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    const paneOuter = findPaneOuter(contentEl);
    mockRect(paneOuter, { left: 0, right: 100, top: 0, bottom: 100 });
    dispatchDragOverAt(paneOuter, 50, 50, {
      types: ["text/plain"],
      getData: (_k: string) => "",
    });
    const overlay = container.querySelector(
      '[data-testid="pane-drop-preview-overlay"]',
    );
    expect(overlay).toBeNull();
  });

  it("Phase 64 Test 4: center dragover then dragleave OUTSIDE clears the overlay (state cleanup regression)", () => {
    const tree: SplitNode = leaf("target");
    const { container } = render(
      <SplitView splitTree={tree} tabs={[tabTarget]} />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    const paneOuter = findPaneOuter(contentEl);
    mockRect(paneOuter, { left: 0, right: 100, top: 0, bottom: 100 });
    dispatchDragOverAt(paneOuter, 50, 50, {
      types: ["application/x-skynet-badge", "text/plain"],
      getData: (_k: string) => "",
    });
    expect(
      container.querySelector('[data-testid="pane-drop-preview-overlay"]'),
    ).not.toBeNull();
    dispatchDragLeaveAt(paneOuter, 500, 500); // outside mocked rect
    expect(
      container.querySelector('[data-testid="pane-drop-preview-overlay"]'),
    ).toBeNull();
  });

  // ── Drop dispatch (Tests 5-9) ────────────────────────────────────────────

  it("Phase 64 Test 5: badge-mime center-drop dispatches onSwapInTree(source, target); no other handler called", () => {
    const swapSpy =
      vi.fn<(a: string, b: string) => void>();
    const replaceSpy =
      vi.fn<(replacement: string, target: string) => void>();
    const openSpy =
      vi.fn<(tabId: string, path: SplitPath, edge: DropEdge) => void>();
    const rowDropSpy =
      vi.fn<(payload: unknown, path: SplitPath, edge: DropEdge) => void>();
    const tree: SplitNode = leaf("target");
    const { container } = render(
      <SplitView
        splitTree={tree}
        tabs={[tabTarget]}
        onSwapInTree={swapSpy}
        onReplaceInTree={replaceSpy}
        onOpenSessionInTree={openSpy}
        onDropRowInTree={rowDropSpy}
      />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    const paneOuter = findPaneOuter(contentEl);
    mockRect(paneOuter, { left: 0, right: 100, top: 0, bottom: 100 });
    dispatchDropAt(paneOuter, 50, 50, {
      types: ["application/x-skynet-badge", "text/plain"],
      getData: (k: string) =>
        k === "application/x-skynet-badge"
          ? JSON.stringify({ tabId: "source" })
          : k === "text/plain"
            ? "source"
            : "",
    });
    expect(swapSpy).toHaveBeenCalledTimes(1);
    expect(swapSpy).toHaveBeenCalledWith("source", "target");
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(rowDropSpy).not.toHaveBeenCalled();
  });

  it("Phase 64 Test 6: row-mime center-drop dispatches onReplaceInTree(source, target); no other handler called", () => {
    const swapSpy =
      vi.fn<(a: string, b: string) => void>();
    const replaceSpy =
      vi.fn<(replacement: string, target: string) => void>();
    const openSpy =
      vi.fn<(tabId: string, path: SplitPath, edge: DropEdge) => void>();
    const rowDropSpy =
      vi.fn<(payload: unknown, path: SplitPath, edge: DropEdge) => void>();
    const tree: SplitNode = leaf("target");
    const { container } = render(
      <SplitView
        splitTree={tree}
        tabs={[tabTarget]}
        onSwapInTree={swapSpy}
        onReplaceInTree={replaceSpy}
        onOpenSessionInTree={openSpy}
        onDropRowInTree={rowDropSpy}
      />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    const paneOuter = findPaneOuter(contentEl);
    mockRect(paneOuter, { left: 0, right: 100, top: 0, bottom: 100 });
    dispatchDropAt(paneOuter, 50, 50, {
      types: ["application/x-skynet-row", "text/plain"],
      getData: (k: string) =>
        k === "application/x-skynet-row"
          ? JSON.stringify({
              id: "source",
              host: null,
              targetTmuxSession: null,
              fleetOnly: false,
              rdpHostRow: false,
            })
          : k === "text/plain"
            ? "source"
            : "",
    });
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith("source", "target");
    expect(swapSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(rowDropSpy).not.toHaveBeenCalled();
  });

  it("Phase 64 Test 7: badge-mime self-drop (source === target) is silent — no handler called, structured log emitted", () => {
    const swapSpy =
      vi.fn<(a: string, b: string) => void>();
    const replaceSpy =
      vi.fn<(replacement: string, target: string) => void>();
    const openSpy =
      vi.fn<(tabId: string, path: SplitPath, edge: DropEdge) => void>();
    const rowDropSpy =
      vi.fn<(payload: unknown, path: SplitPath, edge: DropEdge) => void>();
    const tree: SplitNode = leaf("target");
    const { container } = render(
      <SplitView
        splitTree={tree}
        tabs={[tabTarget]}
        onSwapInTree={swapSpy}
        onReplaceInTree={replaceSpy}
        onOpenSessionInTree={openSpy}
        onDropRowInTree={rowDropSpy}
      />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    const paneOuter = findPaneOuter(contentEl);
    mockRect(paneOuter, { left: 0, right: 100, top: 0, bottom: 100 });
    dispatchDropAt(paneOuter, 50, 50, {
      types: ["application/x-skynet-badge", "text/plain"],
      getData: (k: string) =>
        k === "application/x-skynet-badge"
          ? JSON.stringify({ tabId: "target" })
          : k === "text/plain"
            ? "target"
            : "",
    });
    expect(swapSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(rowDropSpy).not.toHaveBeenCalled();
    // Structured log emits — exact token per must_have truth 6.
    const selfDropLog = infoSpy.mock.calls.some((args) =>
      args.some(
        (a) =>
          typeof a === "string" &&
          a.includes("center-self-drop-ignored"),
      ),
    );
    expect(selfDropLog).toBe(true);
  });

  it("Phase 64 Test 8: unknown-mime center-drop is silent (drop handler is a total function) — no handler called, no throw", () => {
    const swapSpy =
      vi.fn<(a: string, b: string) => void>();
    const replaceSpy =
      vi.fn<(replacement: string, target: string) => void>();
    const openSpy =
      vi.fn<(tabId: string, path: SplitPath, edge: DropEdge) => void>();
    const rowDropSpy =
      vi.fn<(payload: unknown, path: SplitPath, edge: DropEdge) => void>();
    const tree: SplitNode = leaf("target");
    const { container } = render(
      <SplitView
        splitTree={tree}
        tabs={[tabTarget]}
        onSwapInTree={swapSpy}
        onReplaceInTree={replaceSpy}
        onOpenSessionInTree={openSpy}
        onDropRowInTree={rowDropSpy}
      />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    const paneOuter = findPaneOuter(contentEl);
    mockRect(paneOuter, { left: 0, right: 100, top: 0, bottom: 100 });
    // No skynet MIME — hasSkynetDragPayload gate at :333 early-returns.
    expect(() =>
      dispatchDropAt(paneOuter, 50, 50, {
        types: ["text/plain"],
        getData: (k: string) => (k === "text/plain" ? "selected-text" : ""),
      }),
    ).not.toThrow();
    expect(swapSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(rowDropSpy).not.toHaveBeenCalled();
    // No overlay was rendered (no dragover; and even if there had been, the
    // gate would have blocked it).
    expect(
      container.querySelector('[data-testid="pane-drop-preview-overlay"]'),
    ).toBeNull();
  });

  it("Phase 64 Test 9: edge-zone drop preserves Phase 56 rich-payload + Phase 58 badge-onto-edge paths (byte-unchanged regression)", () => {
    const swapSpy =
      vi.fn<(a: string, b: string) => void>();
    const replaceSpy =
      vi.fn<(replacement: string, target: string) => void>();
    const openSpy =
      vi.fn<(tabId: string, path: SplitPath, edge: DropEdge) => void>();
    const rowDropSpy =
      vi.fn<(payload: unknown, path: SplitPath, edge: DropEdge) => void>();
    const tree: SplitNode = leaf("target");
    const { container } = render(
      <SplitView
        splitTree={tree}
        tabs={[tabTarget]}
        onSwapInTree={swapSpy}
        onReplaceInTree={replaceSpy}
        onOpenSessionInTree={openSpy}
        onDropRowInTree={rowDropSpy}
      />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    const paneOuter = findPaneOuter(contentEl);
    mockRect(paneOuter, { left: 0, right: 100, top: 0, bottom: 100 });

    // Scenario A: left-edge drop with row-payload → rich-payload branch fires.
    const rowPayload = {
      id: "source-row",
      host: null,
      targetTmuxSession: null,
      fleetOnly: false,
      rdpHostRow: false,
    };
    dispatchDropAt(paneOuter, 10, 50, {
      types: ["application/x-skynet-row", "text/plain"],
      getData: (k: string) =>
        k === "application/x-skynet-row"
          ? JSON.stringify(rowPayload)
          : k === "text/plain"
            ? "source-row"
            : "",
    });
    expect(rowDropSpy).toHaveBeenCalledTimes(1);
    expect(rowDropSpy).toHaveBeenCalledWith(rowPayload, [], "left");
    expect(swapSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();

    // Scenario B: left-edge drop with badge-MIME + text/plain (no rich row) →
    // text/plain fallback branch fires. Phase 58 badge-onto-edge rearrange.
    dispatchDropAt(paneOuter, 10, 50, {
      types: ["application/x-skynet-badge", "text/plain"],
      getData: (k: string) =>
        k === "text/plain" ? "source-badge" : "",
    });
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith("source-badge", [], "left");
    expect(swapSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  // ── Deep-tree regression (Test 10) ──────────────────────────────────────

  it("Phase 64 Test 10: deep-tree center-drop through SplitView — badge drop onto nested cell C dispatches onSwapInTree(a, c)", () => {
    const swapSpy =
      vi.fn<(a: string, b: string) => void>();
    const replaceSpy =
      vi.fn<(replacement: string, target: string) => void>();
    // splitTree = split(vertical, leaf("aaa"), split(horizontal, leaf("bbb"), leaf("ccc")))
    const tree: SplitNode = split(
      "vertical",
      leaf("aaa"),
      split("horizontal", leaf("bbb"), leaf("ccc")),
    );
    const { container } = render(
      <SplitView
        splitTree={tree}
        tabs={[tabA, tabB, tabC]}
        onSwapInTree={swapSpy}
        onReplaceInTree={replaceSpy}
      />,
    );
    const contentC = container.querySelector(
      '[data-tab-id="ccc"]',
    ) as HTMLElement;
    expect(contentC).not.toBeNull();
    const paneOuterC = findPaneOuter(contentC);
    mockRect(paneOuterC, { left: 0, right: 100, top: 0, bottom: 100 });
    dispatchDropAt(paneOuterC, 50, 50, {
      types: ["application/x-skynet-badge", "text/plain"],
      getData: (k: string) =>
        k === "application/x-skynet-badge"
          ? JSON.stringify({ tabId: "aaa" })
          : k === "text/plain"
            ? "aaa"
            : "",
    });
    expect(swapSpy).toHaveBeenCalledTimes(1);
    expect(swapSpy).toHaveBeenCalledWith("aaa", "ccc");
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  // ── /close findings — Additions 2 + 3 fixes ─────────────────────────────

  it("Phase 64 /close fix (Addition 2): center-drop with rich MIME in types but MALFORMED JSON body + valid-looking text/plain does NOT fall through to text/plain — dispatches unknown-mime silent no-op", () => {
    // Regression test for the removed text/plain fallback. Prior behavior:
    // if badge/row JSON parse failed, text/plain payload was accepted as
    // a replace-source tabId — meaning any stray drag whose rich payload
    // was garbled but whose text/plain happened to look like a tabId
    // could clobber a live session. New behavior: fail-closed, silent
    // no-op via unknown-mime log.
    const replaceSpy = vi.fn<(replacement: string, target: string) => void>();
    const swapSpy = vi.fn<(a: string, b: string) => void>();
    const tree: SplitNode = leaf("target");
    const { container } = render(
      <SplitView
        splitTree={tree}
        tabs={[tabTarget]}
        onReplaceInTree={replaceSpy}
        onSwapInTree={swapSpy}
      />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    const paneOuter = findPaneOuter(contentEl);
    mockRect(paneOuter, { left: 0, right: 100, top: 0, bottom: 100 });
    dispatchDropAt(paneOuter, 50, 50, {
      types: ["application/x-skynet-row", "text/plain"],
      getData: (k: string) =>
        k === "application/x-skynet-row"
          ? "{malformed-json-not-parseable"
          : k === "text/plain"
            ? "stray-content-that-looks-like-tabid"
            : "",
    });
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(swapSpy).not.toHaveBeenCalled();
    const unknownMimeLog = infoSpy.mock.calls.some((args) =>
      args.some(
        (a) =>
          typeof a === "string" &&
          a.includes("[pv-split-drop] center-drop-unknown-mime"),
      ),
    );
    expect(unknownMimeLog).toBe(true);
    // Row-parse-failed warn log fires from the row JSON.parse catch block.
    const rowParseWarn = warnSpy.mock.calls.some((args) =>
      args.some(
        (a) =>
          typeof a === "string" &&
          a.includes("[pv-split-drop] center-drop row-parse failed"),
      ),
    );
    expect(rowParseWarn).toBe(true);
  });

  it("Phase 64 /close fix (Addition 3): badge dragover where source === target suppresses the center-zone coral overlay", () => {
    // Self-drop with badge source: sourceTabId === target tabId. Shape
    // contract: "coral appears → release always performs the corresponding
    // action." Self-drop release is a no-op, so coral must NOT light.
    const tree: SplitNode = leaf("target");
    const { container } = render(
      <SplitView splitTree={tree} tabs={[tabTarget]} />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    const paneOuter = findPaneOuter(contentEl);
    mockRect(paneOuter, { left: 0, right: 100, top: 0, bottom: 100 });
    dispatchDragOverAt(paneOuter, 50, 50, {
      types: ["application/x-skynet-badge", "text/plain"],
      getData: (k: string) =>
        k === "application/x-skynet-badge"
          ? JSON.stringify({ tabId: "target" })
          : k === "text/plain"
            ? "target"
            : "",
    });
    const overlay = container.querySelector(
      '[data-testid="pane-drop-preview-overlay"]',
    ) as HTMLElement | null;
    expect(overlay).toBeNull();
  });

  it("Phase 64 /close fix (Addition 3): row dragover where source === target suppresses the center-zone coral overlay", () => {
    // Same rule for row source (drag conv-list row of an already-open
    // session onto its own cell in the grid).
    const tree: SplitNode = leaf("target");
    const { container } = render(
      <SplitView splitTree={tree} tabs={[tabTarget]} />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    const paneOuter = findPaneOuter(contentEl);
    mockRect(paneOuter, { left: 0, right: 100, top: 0, bottom: 100 });
    dispatchDragOverAt(paneOuter, 50, 50, {
      types: ["application/x-skynet-row", "text/plain"],
      getData: (k: string) =>
        k === "application/x-skynet-row"
          ? JSON.stringify({ id: "target" })
          : k === "text/plain"
            ? "target"
            : "",
    });
    const overlay = container.querySelector(
      '[data-testid="pane-drop-preview-overlay"]',
    ) as HTMLElement | null;
    expect(overlay).toBeNull();
  });

  it("Phase 64 /close fix (Addition 3): badge dragover where source !== target STILL renders the center-zone coral overlay (regression guard)", () => {
    // Ensure the self-drop suppression is scoped to actual self-drops
    // and does not incorrectly suppress valid swap-target dragovers.
    const tree: SplitNode = leaf("target");
    const { container } = render(
      <SplitView splitTree={tree} tabs={[tabTarget]} />,
    );
    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    const paneOuter = findPaneOuter(contentEl);
    mockRect(paneOuter, { left: 0, right: 100, top: 0, bottom: 100 });
    dispatchDragOverAt(paneOuter, 50, 50, {
      types: ["application/x-skynet-badge", "text/plain"],
      getData: (k: string) =>
        k === "application/x-skynet-badge"
          ? JSON.stringify({ tabId: "other-session" })
          : k === "text/plain"
            ? "other-session"
            : "",
    });
    const overlay = container.querySelector(
      '[data-testid="pane-drop-preview-overlay"]',
    ) as HTMLElement | null;
    expect(overlay).not.toBeNull();
    expect(overlay!.getAttribute("data-zone")).toBe("center");
  });
});
