/**
 * Phase 117 Plan 117-08 Task 1 — PrettyProjectSectionHeader tests.
 *
 * Component under test: PrettyProjectSectionHeader.tsx (new in this plan).
 *
 * Behavior surface (see 117-08-PLAN.md <behavior> Task 1):
 *   Test 1  — render happy path (collapsed=false) — header + rows region + FolderOpen icon
 *   Test 2  — render collapsed=true — chevron rotated + rows NOT in DOM
 *   Test 3  — click header toggles collapse (onToggleCollapse fires with slug)
 *   Test 4  — new-conversation SquarePen button fires onNewConversationClick(slug),
 *             does NOT toggle collapse
 *   Test 5  — drop-lane baseline is NEUTRAL — no coral overlay when isDragOver=false
 *   Test 6  — dragover with application/x-skynet-row MIME → coral overlay appears with
 *             verbatim palette (rgba(255,184,150,0.22) bg + rgba(255,184,150,0.60) border
 *             + zIndex 30); preventDefault called
 *   Test 7  — dragover with WRONG MIME (application/x-skynet-badge) → no overlay,
 *             no preventDefault
 *   Test 8  — dragleave with cursor STILL inside bounding rect → overlay STAYS visible
 *   Test 9  — dragleave with cursor outside bounding rect → overlay hides
 *   Test 10 — window-level dragend clears overlay (Escape-cancel path)
 *   Test 11 — drop on identity row → onDropRow called with (slug, parsed payload);
 *             overlay clears
 *   Test 12 — drop on relay-room row → onDropRow called with (slug, parsed payload
 *             carrying roomId); overlay clears
 *   Test 13 — drop on RDP row (rdpHostRow=true) is REFUSED per D-08 — onDropRow NOT called
 *   Test 14 — drop with missing MIME is a no-op — no callback, overlay clears
 *   Test 15 — outer wrapper carries `isolation: isolate` for z-index sandboxing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  fireEvent,
  createEvent,
  cleanup,
  act,
} from "@testing-library/react";

// Per-test override handle for useIsTouchDevice — flip to `true` to arm
// touch handlers, `false` to leave them unwired (desktop path).
let currentIsTouchDevice = false;
vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: () => currentIsTouchDevice,
}));

import { PrettyProjectSectionHeader } from "./PrettyProjectSectionHeader";

// Helper: build a stub DataTransfer with a Map-backed store. Mirrors the shape
// used at PrettyConversationsPanel.test.tsx and CollapsedPanelCloseLane.test.tsx.
function makeDataTransferStub(entries: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(entries));
  return {
    setData: (type: string, value: string) => {
      store.set(type, value);
    },
    getData: (type: string) => store.get(type) ?? "",
    effectAllowed: "none" as string,
    get types() {
      return Array.from(store.keys());
    },
  };
}

// jsdom's DragEvent init ignores clientX/Y and dataTransfer — use createEvent +
// Object.defineProperty for full control. Mirrors SplitView.test.tsx pattern.
function dispatchDragOverAt(
  el: Element,
  clientX: number,
  clientY: number,
  dt: ReturnType<typeof makeDataTransferStub>,
): DragEvent {
  const evt = createEvent.dragOver(el, { dataTransfer: dt });
  Object.defineProperty(evt, "clientX", { value: clientX, configurable: true });
  Object.defineProperty(evt, "clientY", { value: clientY, configurable: true });
  fireEvent(el, evt);
  return evt as unknown as DragEvent;
}

function dispatchDragLeaveAt(
  el: Element,
  clientX: number,
  clientY: number,
  dt: ReturnType<typeof makeDataTransferStub>,
): void {
  const evt = createEvent.dragLeave(el, { dataTransfer: dt });
  Object.defineProperty(evt, "clientX", { value: clientX, configurable: true });
  Object.defineProperty(evt, "clientY", { value: clientY, configurable: true });
  fireEvent(el, evt);
}

function dispatchDrop(
  el: Element,
  dt: ReturnType<typeof makeDataTransferStub>,
): DragEvent {
  const evt = createEvent.drop(el, { dataTransfer: dt });
  fireEvent(el, evt);
  return evt as unknown as DragEvent;
}

// Bounding rect for dragleave / drop guards. beforeEach installs an override
// so getBoundingClientRect returns this rect regardless of layout.
const KNOWN_RECT: DOMRect = {
  left: 100,
  top: 100,
  right: 500,
  bottom: 400,
  x: 100,
  y: 100,
  width: 400,
  height: 300,
  toJSON() {
    return this;
  },
};

let originalGetBoundingClientRect: () => DOMRect;

beforeEach(() => {
  cleanup();
  currentIsTouchDevice = false;
  originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    return KNOWN_RECT;
  };
});

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  vi.restoreAllMocks();
});

describe("PrettyProjectSectionHeader — render", () => {
  it("Test 1: renders header with 'Project:' prefix + displayName + rows region (collapsed=false)", () => {
    const { getByTestId, queryByTestId, container } = render(
      <PrettyProjectSectionHeader
        slug="alpha"
        displayName="Alpha"
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onNewConversationClick={vi.fn()}
        onDropRow={vi.fn()}
        rows={<div data-testid="row-child">row-child-here</div>}
      />,
    );
    const header = getByTestId("pv-project-section-header-alpha");
    expect(header).not.toBeNull();
    expect(header.textContent).toContain("Project:");
    expect(header.textContent).toContain("Alpha");
    // Rows region present with children.
    expect(queryByTestId("row-child")).not.toBeNull();
    // Chevron NOT rotated when expanded.
    expect(header.getAttribute("aria-expanded")).toBe("true");
    // FolderOpen icon present (svg with lucide FolderOpen shape — check presence via svg).
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThan(0);
  });

  it("Test 2: collapsed=true → chevron rotated + rows NOT rendered", () => {
    const { getByTestId, queryByTestId } = render(
      <PrettyProjectSectionHeader
        slug="alpha"
        displayName="Alpha"
        collapsed={true}
        onToggleCollapse={vi.fn()}
        onNewConversationClick={vi.fn()}
        onDropRow={vi.fn()}
        rows={<div data-testid="row-child">row-child-here</div>}
      />,
    );
    const header = getByTestId("pv-project-section-header-alpha");
    expect(header.getAttribute("aria-expanded")).toBe("false");
    // Rows region NOT in DOM.
    expect(queryByTestId("row-child")).toBeNull();
  });
});

describe("PrettyProjectSectionHeader — callbacks", () => {
  it("Test 3: click header toggles collapse (fires onToggleCollapse with slug)", () => {
    const onToggleCollapse = vi.fn();
    const { getByTestId } = render(
      <PrettyProjectSectionHeader
        slug="beta"
        displayName="Beta"
        collapsed={false}
        onToggleCollapse={onToggleCollapse}
        onNewConversationClick={vi.fn()}
        onDropRow={vi.fn()}
        rows={null}
      />,
    );
    fireEvent.click(getByTestId("pv-project-section-header-beta"));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
    expect(onToggleCollapse).toHaveBeenCalledWith("beta");
  });

  it("Test 4: new-conversation SquarePen button fires onNewConversationClick(slug); does NOT toggle collapse", () => {
    const onToggleCollapse = vi.fn();
    const onNewConversationClick = vi.fn();
    const { getByTestId } = render(
      <PrettyProjectSectionHeader
        slug="gamma"
        displayName="Gamma"
        collapsed={false}
        onToggleCollapse={onToggleCollapse}
        onNewConversationClick={onNewConversationClick}
        onDropRow={vi.fn()}
        rows={null}
      />,
    );
    const newConvBtn = getByTestId("pv-project-section-new-conv-gamma");
    fireEvent.click(newConvBtn);
    expect(onNewConversationClick).toHaveBeenCalledTimes(1);
    expect(onNewConversationClick).toHaveBeenCalledWith("gamma");
    // Header toggle NOT fired (stopPropagation on the inner button).
    expect(onToggleCollapse).not.toHaveBeenCalled();
  });

  // Phase 117 M3 fix (2026-09-18): pre-fix, the outer header element was
  // <button> and inside it was a <span role="button" tabIndex={0}> for
  // the new-conversation action — nesting an interactive element inside
  // a <button> is invalid HTML. Fix: outer is <div role="button"
  // tabIndex={0}> with keyboard handler, new-conversation is a <button>
  // sibling (not nested). Tests below lock the fix.
  it("Test M3 A: outer container is <div role='button'> NOT <button>; new-conversation control is a <button> that is NOT nested inside another <button>", () => {
    const { getByTestId } = render(
      <PrettyProjectSectionHeader
        slug="delta"
        displayName="Delta"
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onNewConversationClick={vi.fn()}
        onDropRow={vi.fn()}
        rows={null}
      />,
    );
    const outer = getByTestId("pv-project-section-header-delta");
    // Regression defense (M3): outer element MUST be <div>, not <button>.
    // Nesting a <button> inside a <button> is invalid HTML.
    expect(outer.tagName.toLowerCase()).toBe("div");
    // ARIA button semantics preserved.
    expect(outer.getAttribute("role")).toBe("button");
    expect(outer.getAttribute("tabindex")).toBe("0");
    // Inner new-conversation button is a <button>.
    const newConv = getByTestId("pv-project-section-new-conv-delta");
    expect(newConv.tagName.toLowerCase()).toBe("button");
    // Regression defense: no ancestor of the new-conversation button
    // should be a <button> element (invalid HTML nesting).
    let ancestor: HTMLElement | null = newConv.parentElement;
    while (ancestor) {
      expect(ancestor.tagName.toLowerCase()).not.toBe("button");
      ancestor = ancestor.parentElement;
    }
  });

  it("Test M3 B: keyboard Enter on outer div fires onToggleCollapse (WAI-ARIA button pattern)", () => {
    const onToggleCollapse = vi.fn();
    const { getByTestId } = render(
      <PrettyProjectSectionHeader
        slug="epsilon"
        displayName="Epsilon"
        collapsed={false}
        onToggleCollapse={onToggleCollapse}
        onNewConversationClick={vi.fn()}
        onDropRow={vi.fn()}
        rows={null}
      />,
    );
    const outer = getByTestId("pv-project-section-header-epsilon");
    fireEvent.keyDown(outer, { key: "Enter" });
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
    expect(onToggleCollapse).toHaveBeenCalledWith("epsilon");
  });

  it("Test M3 C: keyboard Space on outer div fires onToggleCollapse (WAI-ARIA button pattern)", () => {
    const onToggleCollapse = vi.fn();
    const { getByTestId } = render(
      <PrettyProjectSectionHeader
        slug="zeta"
        displayName="Zeta"
        collapsed={false}
        onToggleCollapse={onToggleCollapse}
        onNewConversationClick={vi.fn()}
        onDropRow={vi.fn()}
        rows={null}
      />,
    );
    const outer = getByTestId("pv-project-section-header-zeta");
    fireEvent.keyDown(outer, { key: " " });
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
    expect(onToggleCollapse).toHaveBeenCalledWith("zeta");
  });
});

describe("PrettyProjectSectionHeader — drop lane", () => {
  it("Test 5: baseline render has NO coral overlay (isDragOver=false)", () => {
    const { queryByTestId } = render(
      <PrettyProjectSectionHeader
        slug="alpha"
        displayName="Alpha"
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onNewConversationClick={vi.fn()}
        onDropRow={vi.fn()}
        rows={null}
      />,
    );
    expect(queryByTestId("pv-project-drop-overlay-alpha")).toBeNull();
  });

  it("Test 6: dragover with application/x-skynet-row MIME → coral overlay with verbatim palette; preventDefault called", () => {
    const { getByTestId, queryByTestId } = render(
      <PrettyProjectSectionHeader
        slug="alpha"
        displayName="Alpha"
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onNewConversationClick={vi.fn()}
        onDropRow={vi.fn()}
        rows={null}
      />,
    );
    const section = getByTestId("pv-project-section-alpha");
    const dt = makeDataTransferStub({
      "text/plain": "row-1",
      "application/x-skynet-row": JSON.stringify({ id: "row-1" }),
    });
    const evt = dispatchDragOverAt(section, 200, 200, dt);
    // Overlay appeared with the verbatim palette.
    const overlay = queryByTestId("pv-project-drop-overlay-alpha");
    expect(overlay).not.toBeNull();
    const styleAttr = overlay!.getAttribute("style") ?? "";
    expect(styleAttr).toContain("rgba(255, 184, 150, 0.22)");
    // jsdom may serialize 0.60 as 0.6 — accept either.
    expect(
      styleAttr.includes("rgba(255, 184, 150, 0.60)") ||
        styleAttr.includes("rgba(255, 184, 150, 0.6)"),
    ).toBe(true);
    expect(styleAttr).toContain("z-index: 30");
    // preventDefault called on the event so browser accepts drop.
    expect(evt.defaultPrevented).toBe(true);
  });

  it("Test 7: dragover with WRONG MIME (application/x-skynet-badge) → NO overlay, no preventDefault", () => {
    const { getByTestId, queryByTestId } = render(
      <PrettyProjectSectionHeader
        slug="alpha"
        displayName="Alpha"
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onNewConversationClick={vi.fn()}
        onDropRow={vi.fn()}
        rows={null}
      />,
    );
    const section = getByTestId("pv-project-section-alpha");
    const dt = makeDataTransferStub({
      "application/x-skynet-badge": JSON.stringify({ tabId: "tab-1" }),
    });
    const evt = dispatchDragOverAt(section, 200, 200, dt);
    expect(queryByTestId("pv-project-drop-overlay-alpha")).toBeNull();
    expect(evt.defaultPrevented).toBe(false);
  });

  it("Test 8: dragleave with cursor STILL inside bounding rect → overlay STAYS visible", () => {
    const { getByTestId, queryByTestId } = render(
      <PrettyProjectSectionHeader
        slug="alpha"
        displayName="Alpha"
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onNewConversationClick={vi.fn()}
        onDropRow={vi.fn()}
        rows={null}
      />,
    );
    const section = getByTestId("pv-project-section-alpha");
    const dt = makeDataTransferStub({
      "application/x-skynet-row": JSON.stringify({ id: "row-1" }),
    });
    // Activate hover first.
    dispatchDragOverAt(section, 200, 200, dt);
    expect(queryByTestId("pv-project-drop-overlay-alpha")).not.toBeNull();
    // dragleave with cursor still inside the KNOWN_RECT (100..500 x 100..400).
    dispatchDragLeaveAt(section, 250, 250, dt);
    // Overlay STAYS visible because bounding-rect guard says still inside.
    expect(queryByTestId("pv-project-drop-overlay-alpha")).not.toBeNull();
  });

  it("Test 9: dragleave with cursor OUTSIDE bounding rect → overlay hides", () => {
    const { getByTestId, queryByTestId } = render(
      <PrettyProjectSectionHeader
        slug="alpha"
        displayName="Alpha"
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onNewConversationClick={vi.fn()}
        onDropRow={vi.fn()}
        rows={null}
      />,
    );
    const section = getByTestId("pv-project-section-alpha");
    const dt = makeDataTransferStub({
      "application/x-skynet-row": JSON.stringify({ id: "row-1" }),
    });
    dispatchDragOverAt(section, 200, 200, dt);
    expect(queryByTestId("pv-project-drop-overlay-alpha")).not.toBeNull();
    // dragleave with cursor OUTSIDE KNOWN_RECT (clientX=50 < left=100).
    dispatchDragLeaveAt(section, 50, 50, dt);
    expect(queryByTestId("pv-project-drop-overlay-alpha")).toBeNull();
  });

  it("Test 10: window-level dragend clears overlay (Escape-cancel path)", () => {
    const { getByTestId, queryByTestId } = render(
      <PrettyProjectSectionHeader
        slug="alpha"
        displayName="Alpha"
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onNewConversationClick={vi.fn()}
        onDropRow={vi.fn()}
        rows={null}
      />,
    );
    const section = getByTestId("pv-project-section-alpha");
    const dt = makeDataTransferStub({
      "application/x-skynet-row": JSON.stringify({ id: "row-1" }),
    });
    dispatchDragOverAt(section, 200, 200, dt);
    expect(queryByTestId("pv-project-drop-overlay-alpha")).not.toBeNull();
    // Window-level dragend → cleared (mirrors Escape-cancel path).
    act(() => {
      window.dispatchEvent(new Event("dragend"));
    });
    expect(queryByTestId("pv-project-drop-overlay-alpha")).toBeNull();
  });
});

describe("PrettyProjectSectionHeader — drop handler routing", () => {
  it("Test 11: drop on identity-row payload → onDropRow(slug, payload) called; overlay clears", () => {
    const onDropRow = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <PrettyProjectSectionHeader
        slug="alpha"
        displayName="Alpha"
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onNewConversationClick={vi.fn()}
        onDropRow={onDropRow}
        rows={null}
      />,
    );
    const section = getByTestId("pv-project-section-alpha");
    const payload = {
      id: "wren",
      host: { id: "1" },
      targetTmuxSession: "wren-session",
      rdpHostRow: false,
    };
    const dt = makeDataTransferStub({
      "application/x-skynet-row": JSON.stringify(payload),
    });
    // Simulate: dragover → drop.
    dispatchDragOverAt(section, 200, 200, dt);
    dispatchDrop(section, dt);
    expect(onDropRow).toHaveBeenCalledTimes(1);
    expect(onDropRow).toHaveBeenCalledWith("alpha", expect.objectContaining({
      id: "wren",
      targetTmuxSession: "wren-session",
    }));
    // Overlay cleared post-drop.
    expect(queryByTestId("pv-project-drop-overlay-alpha")).toBeNull();
  });

  it("Test 12: drop on relay-room row payload (roomId set) → onDropRow(slug, payload) fires with roomId", () => {
    const onDropRow = vi.fn();
    const { getByTestId } = render(
      <PrettyProjectSectionHeader
        slug="alpha"
        displayName="Alpha"
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onNewConversationClick={vi.fn()}
        onDropRow={onDropRow}
        rows={null}
      />,
    );
    const section = getByTestId("pv-project-section-alpha");
    const payload = {
      id: "relay-1",
      matrixRoomId: "!abc:matrix.example",
      rdpHostRow: false,
    };
    const dt = makeDataTransferStub({
      "application/x-skynet-row": JSON.stringify(payload),
    });
    dispatchDragOverAt(section, 200, 200, dt);
    dispatchDrop(section, dt);
    expect(onDropRow).toHaveBeenCalledTimes(1);
    expect(onDropRow).toHaveBeenCalledWith("alpha", expect.objectContaining({
      id: "relay-1",
      matrixRoomId: "!abc:matrix.example",
    }));
  });

  it("Test 13: drop with rdpHostRow=true is REFUSED per D-08 — onDropRow NOT called", () => {
    const onDropRow = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <PrettyProjectSectionHeader
        slug="alpha"
        displayName="Alpha"
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onNewConversationClick={vi.fn()}
        onDropRow={onDropRow}
        rows={null}
      />,
    );
    const section = getByTestId("pv-project-section-alpha");
    const payload = {
      id: "rdp-host-1",
      rdpHostRow: true,
    };
    const dt = makeDataTransferStub({
      "application/x-skynet-row": JSON.stringify(payload),
    });
    dispatchDragOverAt(section, 200, 200, dt);
    dispatchDrop(section, dt);
    expect(onDropRow).not.toHaveBeenCalled();
    expect(queryByTestId("pv-project-drop-overlay-alpha")).toBeNull();
  });

  it("Test 14: drop with missing MIME (empty dataTransfer) is a no-op — no callback fires, no throw", () => {
    const onDropRow = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <PrettyProjectSectionHeader
        slug="alpha"
        displayName="Alpha"
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onNewConversationClick={vi.fn()}
        onDropRow={onDropRow}
        rows={null}
      />,
    );
    const section = getByTestId("pv-project-section-alpha");
    const dt = makeDataTransferStub({});
    // No dragover activation needed — drop with empty types just clears.
    expect(() => dispatchDrop(section, dt)).not.toThrow();
    expect(onDropRow).not.toHaveBeenCalled();
    expect(queryByTestId("pv-project-drop-overlay-alpha")).toBeNull();
  });
});

describe("PrettyProjectSectionHeader — isolation invariant", () => {
  it("Test 15: outer wrapper carries `isolation: isolate` for z-index sandboxing", () => {
    const { getByTestId } = render(
      <PrettyProjectSectionHeader
        slug="alpha"
        displayName="Alpha"
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onNewConversationClick={vi.fn()}
        onDropRow={vi.fn()}
        rows={null}
      />,
    );
    const section = getByTestId("pv-project-section-alpha");
    const styleAttr = section.getAttribute("style") ?? "";
    expect(styleAttr).toContain("isolation: isolate");
  });
});

describe("PrettyProjectSectionHeader — mobile long-press context menu", () => {
  it("500ms touch hold on the header fires onContextMenu with captured coords", () => {
    vi.useFakeTimers();
    currentIsTouchDevice = true;
    const onContextMenu = vi.fn();
    const onToggleCollapse = vi.fn();
    const { getByTestId } = render(
      <PrettyProjectSectionHeader
        slug="alpha"
        displayName="Alpha"
        collapsed={false}
        onToggleCollapse={onToggleCollapse}
        onNewConversationClick={vi.fn()}
        onDropRow={vi.fn()}
        onContextMenu={onContextMenu}
        rows={null}
      />,
    );
    const header = getByTestId("pv-project-section-header-alpha");
    fireEvent.touchStart(header, { touches: [{ clientX: 42, clientY: 84 }] });
    expect(onContextMenu).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu).toHaveBeenCalledWith("alpha", "Alpha", 42, 84);
    // The synthesized click that follows a long-press must NOT toggle collapse.
    fireEvent.click(header);
    expect(onToggleCollapse).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("touchend before 500ms cancels the timer — no menu, tap falls through to collapse toggle", () => {
    vi.useFakeTimers();
    currentIsTouchDevice = true;
    const onContextMenu = vi.fn();
    const onToggleCollapse = vi.fn();
    const { getByTestId } = render(
      <PrettyProjectSectionHeader
        slug="alpha"
        displayName="Alpha"
        collapsed={false}
        onToggleCollapse={onToggleCollapse}
        onNewConversationClick={vi.fn()}
        onDropRow={vi.fn()}
        onContextMenu={onContextMenu}
        rows={null}
      />,
    );
    const header = getByTestId("pv-project-section-header-alpha");
    fireEvent.touchStart(header, { touches: [{ clientX: 10, clientY: 20 }] });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.touchEnd(header, { touches: [] });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onContextMenu).not.toHaveBeenCalled();
    fireEvent.click(header);
    expect(onToggleCollapse).toHaveBeenCalledWith("alpha");
    vi.useRealTimers();
  });

  it("touch movement >10px cancels the pending long-press timer", () => {
    vi.useFakeTimers();
    currentIsTouchDevice = true;
    const onContextMenu = vi.fn();
    const { getByTestId } = render(
      <PrettyProjectSectionHeader
        slug="alpha"
        displayName="Alpha"
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onNewConversationClick={vi.fn()}
        onDropRow={vi.fn()}
        onContextMenu={onContextMenu}
        rows={null}
      />,
    );
    const header = getByTestId("pv-project-section-header-alpha");
    fireEvent.touchStart(header, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(header, { touches: [{ clientX: 100, clientY: 140 }] });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onContextMenu).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("desktop right-click still opens the menu (regression control) with coord args", () => {
    currentIsTouchDevice = false;
    const onContextMenu = vi.fn();
    const { getByTestId } = render(
      <PrettyProjectSectionHeader
        slug="alpha"
        displayName="Alpha"
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onNewConversationClick={vi.fn()}
        onDropRow={vi.fn()}
        onContextMenu={onContextMenu}
        rows={null}
      />,
    );
    const header = getByTestId("pv-project-section-header-alpha");
    fireEvent.contextMenu(header, { clientX: 200, clientY: 300 });
    expect(onContextMenu).toHaveBeenCalledWith("alpha", "Alpha", 200, 300);
  });
});
