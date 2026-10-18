// Rows and sizes (2026-10-14): even rows, sized rows, divider drag commits
// only the two neighbours, double-click resets, minimum pane size, and
// dragging the point where lines meet.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { SplitView, dragRowFractions, MIN_PANE_WIDTH } from "./SplitView";
import {
  type SplitNode,
  insertAtEdge,
  findLeaf,
  setRowFractions,
} from "@/lib/split-tree";
import type { Tab } from "@/types/ui-types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("@/shell/tabUtils", () => ({ tabIcon: () => "ICON" }));

afterEach(() => cleanup());

const tab = (id: string): Tab =>
  ({ id, type: "terminal", label: id, host: null }) as unknown as Tab;
const leaf = (tabId: string): SplitNode => ({ kind: "session", tabId });
function rowOf(ids: string[]): SplitNode {
  let t: SplitNode | null = null;
  ids.forEach((id, i) => {
    t = insertAtEdge(t, t === null ? [] : findLeaf(t, ids[i - 1])!, leaf(id), "right");
  });
  return t!;
}

const memberGrows = (container: HTMLElement) => {
  const row = container.querySelector('[data-split-divider]')!.parentElement!;
  return Array.from(row.children)
    .filter((el) => !(el as HTMLElement).hasAttribute("data-split-divider"))
    .map((el) => Number((el as HTMLElement).style.flexGrow));
};

function mockRowRect(container: HTMLElement, width: number, height: number) {
  const row = container.querySelector('[data-split-divider]')!.parentElement!;
  row.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

function stubCapture(handle: Element) {
  const el = handle as HTMLElement & Record<string, unknown>;
  el.setPointerCapture = vi.fn();
  el.releasePointerCapture = vi.fn();
  el.hasPointerCapture = vi.fn(() => true);
}

// jsdom lacks PointerEvent; MouseEvent carries clientX/button, pointerId
// is set by hand.
function pointer(type: string, init: { clientX?: number; clientY?: number }) {
  const ev = new MouseEvent(type, { bubbles: true, button: 0, ...init });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  return ev;
}

describe("SplitView rows", () => {
  it("three panes side by side render as one row of equal thirds", () => {
    const { container } = render(
      <SplitView splitTree={rowOf(["a", "b", "c"])} tabs={["a", "b", "c"].map(tab)} />,
    );
    expect(container.querySelectorAll('[role="separator"]')).toHaveLength(2);
    const grows = memberGrows(container);
    expect(grows).toHaveLength(3);
    grows.forEach((g) => expect(g).toBeCloseTo(1 / 3, 6));
  });

  it("a sized row renders its custom shares", () => {
    const tree = setRowFractions(rowOf(["a", "b", "c"]), [], [0.5, 0.25, 0.25])!;
    const { container } = render(
      <SplitView splitTree={tree} tabs={["a", "b", "c"].map(tab)} />,
    );
    const grows = memberGrows(container);
    [0.5, 0.25, 0.25].forEach((f, i) => expect(grows[i]).toBeCloseTo(f, 3));
  });

  it("dragging a divider resizes live and commits only the two neighbours on release", async () => {
    const onResizeRow = vi.fn();
    const { container } = render(
      <SplitView splitTree={rowOf(["a", "b", "c"])} tabs={["a", "b", "c"].map(tab)} onResizeRow={onResizeRow} />,
    );
    mockRowRect(container, 1202, 800); // 1200px of members + 2 dividers
    const handle = container.querySelectorAll("[data-split-divider-handle]")[1];
    stubCapture(handle);
    fireEvent(handle, pointer("pointerdown", { clientX: 800 }));
    fireEvent(handle, pointer("pointermove", { clientX: 700 }));
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    // Live: b shrinks by 100px, c grows by 100px, a untouched; not yet committed.
    const live = memberGrows(container);
    expect(live[0]).toBeCloseTo(1 / 3, 6);
    expect(live[1]).toBeCloseTo(300 / 1200, 6);
    expect(live[2]).toBeCloseTo(500 / 1200, 6);
    expect(onResizeRow).not.toHaveBeenCalled();
    fireEvent(handle, pointer("pointerup", { clientX: 700 }));
    expect(onResizeRow).toHaveBeenCalledTimes(1);
    const [rowPath, fractions] = onResizeRow.mock.calls[0];
    expect(rowPath).toEqual([]);
    expect(fractions[0]).toBeCloseTo(1 / 3, 6);
    expect(fractions[1]).toBeCloseTo(0.25, 6);
    expect(fractions[2]).toBeCloseTo(500 / 1200, 6);
  });

  it("a click on a divider without movement commits nothing", () => {
    const onResizeRow = vi.fn();
    const { container } = render(
      <SplitView splitTree={rowOf(["a", "b"])} tabs={["a", "b"].map(tab)} onResizeRow={onResizeRow} />,
    );
    mockRowRect(container, 1001, 800);
    const handle = container.querySelector("[data-split-divider-handle]")!;
    stubCapture(handle);
    fireEvent(handle, pointer("pointerdown", { clientX: 500 }));
    fireEvent(handle, pointer("pointerup", { clientX: 500 }));
    expect(onResizeRow).not.toHaveBeenCalled();
  });

  it("a nested row's custom sizes raise its member's minimum", () => {
    // a | column(b over (c | d)) with c|d sized 40/60: the outer divider must
    // stop where c would drop under 280px (member >= 700px), not at 560px.
    let tree: SplitNode = rowOf(["a", "b"]);
    tree = insertAtEdge(tree, findLeaf(tree, "b")!, leaf("c"), "bottom");
    tree = insertAtEdge(tree, findLeaf(tree, "c")!, leaf("d"), "right");
    tree = setRowFractions(tree, findLeaf(tree, "c")!.slice(0, -1), [0.4, 0.6])!;
    const onResizeRow = vi.fn();
    const { container } = render(
      <SplitView splitTree={tree} tabs={["a", "b", "c", "d"].map(tab)} onResizeRow={onResizeRow} />,
    );
    const outer = container.querySelector("[data-split-divider]")!.parentElement!;
    outer.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 2001, bottom: 800, width: 2001, height: 800, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const handle = outer.querySelector(":scope > [data-split-divider] > [data-split-divider-handle]")!;
    stubCapture(handle);
    fireEvent(handle, pointer("pointerdown", { clientX: 1000 }));
    fireEvent(handle, pointer("pointermove", { clientX: 1700 }));
    fireEvent(handle, pointer("pointerup", { clientX: 1700 }));
    const fractions = onResizeRow.mock.calls[0][1];
    expect(fractions[1] * 2000).toBeCloseTo(700, 3);
  });

  it("a row that disappears mid-drag restores the page and commits nothing", () => {
    const onResizeRow = vi.fn();
    const { container, unmount } = render(
      <SplitView splitTree={rowOf(["a", "b"])} tabs={["a", "b"].map(tab)} onResizeRow={onResizeRow} />,
    );
    mockRowRect(container, 1001, 800);
    const handle = container.querySelector("[data-split-divider-handle]")!;
    stubCapture(handle);
    fireEvent(handle, pointer("pointerdown", { clientX: 500 }));
    fireEvent(handle, pointer("pointermove", { clientX: 600 }));
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.hasAttribute("data-split-resizing")).toBe(true);
    unmount();
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
    expect(document.body.hasAttribute("data-split-resizing")).toBe(false);
    expect(onResizeRow).not.toHaveBeenCalled();
  });

  it("divider strips step aside while a pane is being dragged", () => {
    const { container, unmount } = render(
      <SplitView splitTree={rowOf(["a", "b"])} tabs={["a", "b"].map(tab)} />,
    );
    expect(container.querySelector("[data-split-divider]")!.className).toContain("pointer-events-none");
    const drag = (type: string, types: string[]) => {
      const ev = new Event(type, { bubbles: true });
      Object.defineProperty(ev, "dataTransfer", { value: { types } });
      window.dispatchEvent(ev);
    };
    drag("dragover", ["text/plain"]);
    expect(document.body.hasAttribute("data-split-dnd")).toBe(false);
    drag("dragover", ["application/x-skynet-row"]);
    expect(document.body.hasAttribute("data-split-dnd")).toBe(true);
    drag("dragend", []);
    expect(document.body.hasAttribute("data-split-dnd")).toBe(false);
    drag("dragover", ["application/x-skynet-badge"]);
    unmount();
    expect(document.body.hasAttribute("data-split-dnd")).toBe(false);
  });

  it("double-clicking a divider resets its row", () => {
    const onResizeRow = vi.fn();
    const tree = setRowFractions(rowOf(["a", "b"]), [], [0.7, 0.3])!;
    const { container } = render(
      <SplitView splitTree={tree} tabs={["a", "b"].map(tab)} onResizeRow={onResizeRow} />,
    );
    fireEvent.doubleClick(container.querySelector("[data-split-divider-handle]")!);
    expect(onResizeRow).toHaveBeenCalledWith([], null);
  });
});

describe("dragRowFractions", () => {
  const mins = [MIN_PANE_WIDTH, MIN_PANE_WIDTH, MIN_PANE_WIDTH];
  it("moves only the two neighbours", () => {
    const out = dragRowFractions([0.4, 0.3, 0.3], 0, 240, 2400, mins);
    expect(out[0]).toBeCloseTo(0.5, 6);
    expect(out[1]).toBeCloseTo(0.2, 6);
    expect(out[2]).toBe(0.3);
  });
  it("stops at the minimum", () => {
    const out = dragRowFractions([0.4, 0.3, 0.3], 0, 1000, 1200, mins);
    expect(out[1] * 1200).toBeCloseTo(MIN_PANE_WIDTH, 6);
    expect(out[0] + out[1]).toBeCloseTo(0.7, 6);
  });
  it("a pane already below the minimum never jumps, and can't shrink further", () => {
    // 400px row: both panes are 200px, under the 280px minimum.
    const start = [0.5, 0.5];
    const mins2 = [MIN_PANE_WIDTH, MIN_PANE_WIDTH];
    const nudged = dragRowFractions(start, 0, 1, 400, mins2);
    expect(nudged[0]).toBeCloseTo(0.5, 6);
    expect(dragRowFractions(start, 0, -50, 400, mins2)[0]).toBeCloseTo(0.5, 6);
    // In a wider row where only the left pane is undersized, it can grow.
    const grow = dragRowFractions([0.2, 0.8], 0, 100, 1000, mins2);
    expect(grow[0]).toBeCloseTo(0.3, 6);
    expect(dragRowFractions([0.2, 0.8], 0, -100, 1000, mins2)[0]).toBeCloseTo(0.2, 6);
  });
});

function setRect(el: Element, left: number, top: number, width: number, height: number) {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
}

// Lays out the dividers of `container` as `lines` describes, in document
// order: the row holding each line, and each line's 9px grab strip.
function layOut(
  container: HTMLElement,
  lines: Array<{ row: [number, number, number, number]; strip: [number, number, number, number] }>,
) {
  const dividers = container.querySelectorAll("[data-split-divider]");
  expect(dividers).toHaveLength(lines.length);
  const handles: Element[] = [];
  lines.forEach((l, i) => {
    setRect(dividers[i].parentElement!, ...l.row);
    const handle = dividers[i].querySelector("[data-split-divider-handle]")!;
    setRect(handle, ...l.strip);
    stubCapture(handle);
    handles.push(handle);
  });
  return handles;
}

describe("SplitView meeting points", () => {
  // a | (b over c) in a 1001x800 window: the vertical line at x=500, the
  // b/c line at y=400 from x=501 to the right edge, ending on the vertical.
  function tTree() {
    let tree: SplitNode = rowOf(["a", "b"]);
    tree = insertAtEdge(tree, findLeaf(tree, "b")!, leaf("c"), "bottom");
    return tree;
  }
  const tLines = [
    { row: [0, 0, 1001, 800] as [number, number, number, number], strip: [496, 0, 9, 800] as [number, number, number, number] },
    { row: [501, 0, 500, 801] as [number, number, number, number], strip: [501, 396, 500, 9] as [number, number, number, number] },
  ];

  it("dragging where a line ends on another moves both lines", () => {
    const onResizeRow = vi.fn();
    const { container } = render(
      <SplitView splitTree={tTree()} tabs={["a", "b", "c"].map(tab)} onResizeRow={onResizeRow} />,
    );
    const [, inner] = layOut(container, tLines);
    fireEvent(inner, pointer("pointerdown", { clientX: 503, clientY: 400 }));
    expect(document.body.style.cursor).toBe("move");
    fireEvent(inner, pointer("pointermove", { clientX: 403, clientY: 300 }));
    fireEvent(inner, pointer("pointerup", { clientX: 403, clientY: 300 }));
    expect(document.body.style.cursor).toBe("");
    expect(document.body.hasAttribute("data-split-resizing")).toBe(false);
    expect(onResizeRow).toHaveBeenCalledTimes(2);
    const byPath = new Map(onResizeRow.mock.calls.map(([p, f]) => [JSON.stringify(p), f as number[]]));
    expect(byPath.get("[]")![0]).toBeCloseTo(400 / 1000, 6);
    expect(byPath.get("[1]")![0]).toBeCloseTo(300 / 800, 6);
  });

  it("a press away from the meeting point drags only its own line", () => {
    const onResizeRow = vi.fn();
    const { container } = render(
      <SplitView splitTree={tTree()} tabs={["a", "b", "c"].map(tab)} onResizeRow={onResizeRow} />,
    );
    const [outer, inner] = layOut(container, tLines);
    fireEvent(inner, pointer("pointerdown", { clientX: 750, clientY: 400 }));
    expect(document.body.style.cursor).toBe("row-resize");
    fireEvent(inner, pointer("pointermove", { clientX: 650, clientY: 300 }));
    fireEvent(inner, pointer("pointerup", { clientX: 650, clientY: 300 }));
    fireEvent(outer, pointer("pointerdown", { clientX: 500, clientY: 100 }));
    fireEvent(outer, pointer("pointermove", { clientX: 400, clientY: 200 }));
    fireEvent(outer, pointer("pointerup", { clientX: 400, clientY: 200 }));
    expect(onResizeRow.mock.calls.map(([p]) => JSON.stringify(p))).toEqual(["[1]", "[]"]);
  });

  it("a + where lines from both sides end on one line moves all three", () => {
    // (a over b) | (c over d), both horizontal lines at y=400.
    let tree: SplitNode = rowOf(["a", "c"]);
    tree = insertAtEdge(tree, findLeaf(tree, "a")!, leaf("b"), "bottom");
    tree = insertAtEdge(tree, findLeaf(tree, "c")!, leaf("d"), "bottom");
    const onResizeRow = vi.fn();
    const { container } = render(
      <SplitView splitTree={tree} tabs={["a", "b", "c", "d"].map(tab)} onResizeRow={onResizeRow} />,
    );
    // Document order: left column's line, the vertical line, right column's.
    const [, vertical] = layOut(container, [
      { row: [0, 0, 500, 801], strip: [0, 396, 500, 9] },
      { row: [0, 0, 1001, 801], strip: [496, 0, 9, 801] },
      { row: [501, 0, 500, 801], strip: [501, 396, 500, 9] },
    ]);
    fireEvent(vertical, pointer("pointerdown", { clientX: 500, clientY: 401 }));
    fireEvent(vertical, pointer("pointermove", { clientX: 550, clientY: 451 }));
    fireEvent(vertical, pointer("pointerup", { clientX: 550, clientY: 451 }));
    expect(onResizeRow).toHaveBeenCalledTimes(3);
    const byPath = new Map(onResizeRow.mock.calls.map(([p, f]) => [JSON.stringify(p), f as number[]]));
    expect(byPath.get("[]")![0]).toBeCloseTo(550 / 1000, 6);
    expect(byPath.get("[0]")![0]).toBeCloseTo(450 / 800, 6);
    expect(byPath.get("[1]")![0]).toBeCloseTo(450 / 800, 6);
  });

  it("hovering a meeting point lights every line there; leaving clears it", () => {
    const { container } = render(
      <SplitView splitTree={tTree()} tabs={["a", "b", "c"].map(tab)} onResizeRow={vi.fn()} />,
    );
    const [, inner] = layOut(container, tLines);
    const lit = () => container.querySelectorAll("[data-split-divider][data-split-meet]").length;
    fireEvent(inner, pointer("pointermove", { clientX: 503, clientY: 400 }));
    expect(lit()).toBe(2);
    fireEvent(inner, pointer("pointermove", { clientX: 750, clientY: 400 }));
    expect(lit()).toBe(0);
    fireEvent(inner, pointer("pointermove", { clientX: 503, clientY: 400 }));
    fireEvent.pointerLeave(inner);
    expect(lit()).toBe(0);
  });

  it("double-clicking a meeting point resets every row there", () => {
    const onResizeRow = vi.fn();
    const { container } = render(
      <SplitView splitTree={tTree()} tabs={["a", "b", "c"].map(tab)} onResizeRow={onResizeRow} />,
    );
    const [, inner] = layOut(container, tLines);
    fireEvent.doubleClick(inner, { clientX: 503, clientY: 400 });
    expect(onResizeRow).toHaveBeenCalledWith([], null);
    expect(onResizeRow).toHaveBeenCalledWith([1], null);
    expect(onResizeRow).toHaveBeenCalledTimes(2);
  });

  it("each line at a meeting point stops at its own minimum", () => {
    const onResizeRow = vi.fn();
    const { container } = render(
      <SplitView splitTree={tTree()} tabs={["a", "b", "c"].map(tab)} onResizeRow={onResizeRow} />,
    );
    const [, inner] = layOut(container, tLines);
    fireEvent(inner, pointer("pointerdown", { clientX: 503, clientY: 400 }));
    fireEvent(inner, pointer("pointermove", { clientX: 3, clientY: 0 }));
    fireEvent(inner, pointer("pointerup", { clientX: 3, clientY: 0 }));
    const byPath = new Map(onResizeRow.mock.calls.map(([p, f]) => [JSON.stringify(p), f as number[]]));
    expect(byPath.get("[]")![0] * 1000).toBeCloseTo(MIN_PANE_WIDTH, 6);
    expect(byPath.get("[1]")![0] * 800).toBeCloseTo(160, 6);
  });
});
