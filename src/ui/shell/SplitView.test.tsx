// ─── SplitView.test.tsx ─────────────────────────────────────────────────────
// Phase 56 Plan 02 Task 1 — vitest suite for the recursive-tree renderer.
//
// Tests cite plan-item numbers from the `<behavior>` block of the Task 1
// spec. See:
//   .planning/phases/56-visual-session-management-foundation-recursive-split-tree-da/56-02-PLAN.md
//
// Tests 1-7 assert the shape the AppShell wire-swap (Task 2) depends on:
//   Test 1  single-leaf mounts one content div, zero dividers, one tab-id.
//   Test 2  horizontal split → stacked (flex column), one divider between.
//   Test 3  vertical split → side-by-side (flex row), one divider between.
//   Test 4  null tree → empty drop-target, drop invokes callback with [].
//   Test 5  constant-ratio 50/50 wrapping via flex: 1 1 0 on each subtree.
//   Test 6  onPaneContentRef callback shape is (tabId, HTMLDivElement | null).
//   Test 7  Pane drop forwards (payloadTabId, path, 'left') to upstream.
//
// jsdom setup mirrors the split-tree.test.ts + AppShell.persistence.test.tsx
// patterns. We MOCK react-i18next to avoid pulling the whole i18n provider
// tree — the same lightweight shim shape used elsewhere in the repo.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { SplitView } from "./SplitView";
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

  it("Test 7: Pane onDrop forwards (payloadTabId, path, 'left') to onOpenSessionInTree", () => {
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
    // The Pane's outer container has the onDrop handler; the [data-tab-id]
    // element is the innermost content div. Find the Pane container by
    // ascending from the data-tab-id element until we find an ancestor that
    // is a direct child of SplitView's root — the Pane's outer div.
    const contentEl = container.querySelector("[data-tab-id]");
    expect(contentEl).not.toBeNull();
    // Pane's outer div is the closest ancestor with a class listing the
    // characteristic 'relative flex flex-col' shape. Simpler: fire the drop
    // on the content element — the event bubbles up to the Pane's div.
    fireEvent.drop(contentEl as Element, {
      dataTransfer: {
        getData: (k: string) => (k === "text/plain" ? "xyz" : ""),
      },
    });
    expect(onOpenSessionInTree).toHaveBeenCalledTimes(1);
    expect(onOpenSessionInTree).toHaveBeenCalledWith("xyz", [], "left");
  });
});
