// Rows and sizes (2026-10-14): even rows, sized rows, divider drag commits
// only the two neighbours, double-click resets, minimum pane size.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
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

  it("dragging a divider resizes live and commits only the two neighbours on release", () => {
    const onResizeRow = vi.fn();
    const { container } = render(
      <SplitView splitTree={rowOf(["a", "b", "c"])} tabs={["a", "b", "c"].map(tab)} onResizeRow={onResizeRow} />,
    );
    mockRowRect(container, 1202, 800); // 1200px of members + 2 dividers
    const handle = container.querySelectorAll("[data-split-divider-handle]")[1];
    stubCapture(handle);
    fireEvent(handle, pointer("pointerdown", { clientX: 800 }));
    fireEvent(handle, pointer("pointermove", { clientX: 700 }));
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
  it("leaves panes alone when neither can meet the minimum", () => {
    const start = [0.5, 0.5];
    expect(dragRowFractions(start, 0, 50, 400, [MIN_PANE_WIDTH, MIN_PANE_WIDTH])).toBe(start);
  });
});
