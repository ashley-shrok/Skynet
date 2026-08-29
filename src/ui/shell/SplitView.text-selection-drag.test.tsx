// ─── SplitView.text-selection-drag.test.tsx ──────────────────────────────────
// quick-260829-mbp: Regression suite for the tightened Pane MIME gate.
//
// Verifies that browser text-selection drags (dataTransfer.types = ["text/plain"]
// only, no skynet MIMEs) are rejected by all three Pane native drag listeners
// (onDragOver, onDragLeave, onDrop). Also verifies that badge drags and row drags
// (which carry skynet-owned MIMEs) still pass the gate and behave correctly.
//
// Self-contained — does NOT import helpers from SplitView.test.tsx.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, createEvent, cleanup } from "@testing-library/react";
import { SplitView } from "./SplitView";
import type { SplitNode, SplitPath, DropEdge } from "@/lib/split-tree";
import type { Tab } from "@/types/ui-types";

// Lightweight react-i18next mock — matches SplitView.test.tsx shim shape.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

// tabIcon mock — avoids pulling the icon tree.
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

const leaf = (tabId: string): SplitNode => ({ kind: "session", tabId });

const tabA = makeTab("aaa", "Alpha");

// ─── helpers ─────────────────────────────────────────────────────────────────

// Map-backed DataTransfer stub. Reproduced inline (from PrettyConversationsPanel.test.tsx:4079)
// for isolation — the new test file must be self-contained.
// `types` getter reflects Map keys so MIME-gate checks work correctly.
// `getData` returns "" for missing keys (real DataTransfer semantics).
function makeDataTransferStub(entries: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(entries));
  return {
    setData: (type: string, value: string) => {
      store.set(type, value);
    },
    getData: (type: string): string => store.get(type) ?? "",
    effectAllowed: "none" as string,
    get types(): string[] {
      return Array.from(store.keys());
    },
  };
}

// Walk from a [data-tab-id] descendant up to the Pane's outer div — the
// element that owns the native drag listeners. Matches the `relative isolate
// flex flex-col` className added by patch #517/fh3.
function findPaneOuter(from: HTMLElement): HTMLElement {
  let cur: HTMLElement | null = from.parentElement;
  while (cur && !cur.className.includes("relative isolate flex flex-col")) {
    cur = cur.parentElement;
  }
  if (!cur) throw new Error("Pane outer div not found");
  return cur;
}

// jsdom does not implement window.DragEvent; clientX/Y are ignored by the
// constructor init object, so we use Object.defineProperty after createEvent.
// Caller supplies dataTransfer AS-IS — no forced defaults are injected so the
// caller controls the exact types[] and getData payload (the whole point of
// this test file).

function dispatchDragOverAt(
  el: Element,
  clientX: number,
  clientY: number,
  dataTransfer: { getData?: (k: string) => string; types?: readonly string[] },
): void {
  const evt = createEvent.dragOver(el, { dataTransfer });
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
  const evt = createEvent.drop(el, { dataTransfer });
  Object.defineProperty(evt, "clientX", { value: clientX, configurable: true });
  Object.defineProperty(evt, "clientY", { value: clientY, configurable: true });
  fireEvent(el, evt);
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

// ─── suite ───────────────────────────────────────────────────────────────────

describe("SplitView Pane — text-selection drag rejection (tightened MIME gate)", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cleanup();
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });

  // ── Test 1 (NEGATIVE) ──────────────────────────────────────────────────────
  // A text-selection drag (text/plain only) must NOT render the coral overlay.
  it("Test 1 (NEGATIVE): text-selection drag does NOT render coral drop-preview overlay on dragOver", () => {
    const onOpenSessionInTree =
      vi.fn<(tabId: string, path: SplitPath, edge: DropEdge) => void>();
    const onDropRowInTree =
      vi.fn<(payload: unknown, path: SplitPath, edge: DropEdge) => void>();

    const { container } = render(
      <SplitView
        splitTree={leaf("aaa")}
        tabs={[tabA]}
        onOpenSessionInTree={onOpenSessionInTree}
        onDropRowInTree={onDropRowInTree}
      />,
    );

    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    expect(contentEl).not.toBeNull();
    const paneOuter = findPaneOuter(contentEl);

    // Mock rect: 200x100 at origin.
    mockRect(paneOuter, { left: 0, right: 200, top: 0, bottom: 100 });

    // Text-selection drag: only text/plain, no skynet MIMEs.
    const dtStub = makeDataTransferStub({ "text/plain": "some highlighted user text" });

    // Dispatch dragOver at x=10 (left-zone if gate passed) — should be rejected.
    dispatchDragOverAt(paneOuter, 10, 50, dtStub);

    // Overlay must NOT be rendered.
    expect(container.querySelector('[data-testid="pane-drop-preview-overlay"]')).toBeNull();
  });

  // ── Tests 2 & 3 (NEGATIVE, combined) ──────────────────────────────────────
  // A text-selection drop must NOT call onOpenSessionInTree or onDropRowInTree.
  it("Tests 2-3 (NEGATIVE): text-selection drop does NOT call onOpenSessionInTree or onDropRowInTree", () => {
    const onOpenSessionInTree =
      vi.fn<(tabId: string, path: SplitPath, edge: DropEdge) => void>();
    const onDropRowInTree =
      vi.fn<(payload: unknown, path: SplitPath, edge: DropEdge) => void>();

    const { container } = render(
      <SplitView
        splitTree={leaf("aaa")}
        tabs={[tabA]}
        onOpenSessionInTree={onOpenSessionInTree}
        onDropRowInTree={onDropRowInTree}
      />,
    );

    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    expect(contentEl).not.toBeNull();
    const paneOuter = findPaneOuter(contentEl);

    mockRect(paneOuter, { left: 0, right: 200, top: 0, bottom: 100 });

    // Text-selection drag: only text/plain, no skynet MIMEs.
    const dtStub = makeDataTransferStub({ "text/plain": "some highlighted user text" });

    dispatchDropAt(paneOuter, 10, 50, dtStub);

    expect(onOpenSessionInTree).not.toHaveBeenCalled();
    expect(onDropRowInTree).not.toHaveBeenCalled();
  });

  // ── Test 4 (POSITIVE-CONTROL — badge drag) ─────────────────────────────────
  // A badge drag carries BOTH application/x-skynet-badge AND text/plain=<tabId>.
  // It must render the overlay AND call onOpenSessionInTree on drop.
  it("Test 4 (POSITIVE-CONTROL): badge drag renders coral overlay AND calls onOpenSessionInTree", () => {
    const onOpenSessionInTree =
      vi.fn<(tabId: string, path: SplitPath, edge: DropEdge) => void>();
    const onDropRowInTree =
      vi.fn<(payload: unknown, path: SplitPath, edge: DropEdge) => void>();

    const { container } = render(
      <SplitView
        splitTree={leaf("aaa")}
        tabs={[tabA]}
        onOpenSessionInTree={onOpenSessionInTree}
        onDropRowInTree={onDropRowInTree}
      />,
    );

    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    expect(contentEl).not.toBeNull();
    const paneOuter = findPaneOuter(contentEl);

    mockRect(paneOuter, { left: 0, right: 200, top: 0, bottom: 100 });

    // Badge dragstart wire contract (IdentityBadge): BOTH skynet badge MIME + text/plain=<tabId>.
    // Mirrors PrettyConversationsPanel.test.tsx:4366-4398.
    const dtStub = makeDataTransferStub({
      "application/x-skynet-badge": JSON.stringify({ tabId: "tab-alice-1" }),
      "text/plain": "tab-alice-1",
    });

    // DragOver → coral overlay must appear.
    dispatchDragOverAt(paneOuter, 10, 50, dtStub);
    expect(container.querySelector('[data-testid="pane-drop-preview-overlay"]')).not.toBeNull();

    // Drop → onOpenSessionInTree called with (tabId, path=[], edge='left').
    // x=10 on a 200-wide rect → 'left' zone.
    dispatchDropAt(paneOuter, 10, 50, dtStub);
    expect(onOpenSessionInTree).toHaveBeenCalledTimes(1);
    expect(onOpenSessionInTree).toHaveBeenCalledWith("tab-alice-1", [], "left");
    // Rich branch should NOT have fired (no application/x-skynet-row present).
    expect(onDropRowInTree).not.toHaveBeenCalled();
  });

  // ── Test 5 (POSITIVE-CONTROL — row drag) ───────────────────────────────────
  // A row drag carries application/x-skynet-row + text/plain=<tabId>.
  // It must dispatch via the rich branch (onDropRowInTree) and NOT call onOpenSessionInTree.
  it("Test 5 (POSITIVE-CONTROL): row drag dispatches via rich branch (onDropRowInTree), not onOpenSessionInTree", () => {
    const onOpenSessionInTree =
      vi.fn<(tabId: string, path: SplitPath, edge: DropEdge) => void>();
    const onDropRowInTree =
      vi.fn<(payload: unknown, path: SplitPath, edge: DropEdge) => void>();

    const { container } = render(
      <SplitView
        splitTree={leaf("aaa")}
        tabs={[tabA]}
        onOpenSessionInTree={onOpenSessionInTree}
        onDropRowInTree={onDropRowInTree}
      />,
    );

    const contentEl = container.querySelector("[data-tab-id]") as HTMLElement;
    expect(contentEl).not.toBeNull();
    const paneOuter = findPaneOuter(contentEl);

    mockRect(paneOuter, { left: 0, right: 200, top: 0, bottom: 100 });

    // Row drag payload: rich JSON + text/plain=<tabId>.
    const rowPayload = { id: "row-42", tabId: "tab-42", fleetOnly: false };
    const dtStub = makeDataTransferStub({
      "application/x-skynet-row": JSON.stringify(rowPayload),
      "text/plain": "tab-42",
    });

    dispatchDropAt(paneOuter, 10, 50, dtStub);

    // Rich branch fires onDropRowInTree, short-circuits before text/plain fallback.
    expect(onDropRowInTree).toHaveBeenCalledTimes(1);
    expect(onDropRowInTree).toHaveBeenCalledWith(rowPayload, [], "left");
    // Fallback branch must NOT fire (rich branch returned early).
    expect(onOpenSessionInTree).not.toHaveBeenCalled();
  });
});
