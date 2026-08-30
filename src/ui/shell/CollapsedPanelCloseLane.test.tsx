// ─── CollapsedPanelCloseLane.test.tsx ───────────────────────────────────────
// Quick task 260829-ih3 Task 1 — regression suite for the collapsed-panel
// drop-lane close-target proxy that stands in for PrettyConversationsPanel
// during a badge drag when the sidebar is closed.
//
// Mirrors the AppShell.empty-pv-drop-tint.test.tsx scaffold shape verbatim:
//   - makeDataTransferStub: Map-backed DataTransfer with types/getData
//   - dispatchDragLeaveAt: createEvent.dragLeave + Object.defineProperty for
//     clientX/Y (jsdom drops those from DragEvent init)
//   - KNOWN_RECT + HTMLElement.prototype.getBoundingClientRect override in
//     beforeEach, restore in afterEach
//
// Tests (per PLAN.md <behavior> block A-J):
//   A: draggedBadgeTabId === null → component returns null.
//   B: draggedBadgeTabId='tab-alice-1' → lane rendered; data-hover="false";
//      inline style contains var(--color-pv-base), NOT rgba(255, 184, 150,.
//   C: dragover with application/x-skynet-badge → data-hover="true"; inline
//      style contains rgba(255, 184, 150, 0.22) AND rgba(255, 184, 150, 0.60).
//   D: dragover with ONLY text/plain → data-hover stays "false"; palette
//      stays neutral (row drags never activate hover).
//   E: dragover then drop with valid badge payload matching openTabId →
//      onCloseTab called EXACTLY once with correct tabId; data-hover cleared;
//      structured log [collapsed-lane-drop] close tabId=… emitted once.
//   F: drop with badge payload tabId NOT in openTabIds → onCloseTab NOT
//      called (silent-drop); NO structured log; data-hover cleared.
//   G: dragover then dragLeave INSIDE bounding rect → data-hover STAYS "true".
//   H: dragover then window-level dragend (Escape-cancel) → data-hover
//      cleared without a preceding dragleave.
//   I: mount-gate integration — draggedBadgeTabId null→'tab-x'→null cycle.
//   J: useDraggedBadgeTabId hook — dragstart with badge MIME sets tabId;
//      dragend clears to null.

import { useEffect, useState } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  fireEvent,
  createEvent,
  act,
  cleanup,
} from "@testing-library/react";

import CollapsedPanelCloseLane, {
  useDraggedBadgeTabId,
  shouldMountCloseLane,
} from "./CollapsedPanelCloseLane";

// Helper: build a stub DataTransfer with a Map-backed store. `types` reflects
// the keys, so dragover code that inspects types works. `getData` returns ""
// for missing keys (matches real DataTransfer semantics). Mirrors the shape
// established in PrettyConversationsPanel.test.tsx:4078-4090 and
// AppShell.empty-pv-drop-tint.test.tsx:47-59.
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

// jsdom's DragEvent init object does NOT honor clientX/clientY passed via the
// constructor, so `fireEvent.dragLeave(el, { clientX, clientY })` sets both
// to 0. Mirror SplitView.test.tsx:448-461 pattern: build via `createEvent.*`
// then Object.defineProperty for clientX/Y, then dispatch via fireEvent(el, evt).
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

// Native-listener dispatch helper — the lane attaches drag listeners via
// useEffect + ref rather than React synthetic handlers (patch #514 lesson),
// so fireEvent.dragOver (which walks React's synthetic event path) does NOT
// wake up the native handler. Dispatch a real DOM DragEvent whose
// `dataTransfer` was patched onto the event via Object.defineProperty
// (jsdom's DragEvent constructor ignores dataTransfer in its init dict).
function dispatchNativeDragOver(
  el: Element,
  dt: ReturnType<typeof makeDataTransferStub>,
): void {
  const evt = new Event("dragover", { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "dataTransfer", { value: dt, configurable: true });
  el.dispatchEvent(evt);
}

function dispatchNativeDrop(
  el: Element,
  dt: ReturnType<typeof makeDataTransferStub>,
): void {
  const evt = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "dataTransfer", { value: dt, configurable: true });
  el.dispatchEvent(evt);
}

function dispatchNativeDragLeaveAt(
  el: Element,
  clientX: number,
  clientY: number,
  dt: ReturnType<typeof makeDataTransferStub>,
): void {
  const evt = new Event("dragleave", { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "dataTransfer", { value: dt, configurable: true });
  Object.defineProperty(evt, "clientX", { value: clientX, configurable: true });
  Object.defineProperty(evt, "clientY", { value: clientY, configurable: true });
  el.dispatchEvent(evt);
}

// Known rect for bounding-rect guard tests (F/G analog).
// Overrides HTMLElement.prototype.getBoundingClientRect in beforeEach.
const KNOWN_RECT: DOMRect = {
  left: 0,
  top: 0,
  right: 115,
  bottom: 800,
  x: 0,
  y: 0,
  width: 115,
  height: 800,
  toJSON() {
    return this;
  },
};

let originalGetBoundingClientRect: () => DOMRect;

beforeEach(() => {
  cleanup();
  originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    return KNOWN_RECT;
  };
});

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  vi.restoreAllMocks();
});

describe("CollapsedPanelCloseLane component (quick-260829-ih3 Task 1)", () => {
  it("Test A: draggedBadgeTabId === null → component returns null", () => {
    const { queryByTestId } = render(
      <CollapsedPanelCloseLane
        draggedBadgeTabId={null}
        openTabIds={["tab-alice-1"]}
        onCloseTab={vi.fn()}
      />,
    );
    expect(queryByTestId("collapsed-panel-close-lane")).toBeNull();
  });

  it("Test B: draggedBadgeTabId non-null → lane rendered with NEUTRAL baseline (data-hover='false', pv-base fill, NOT coral)", () => {
    const { getByTestId } = render(
      <CollapsedPanelCloseLane
        draggedBadgeTabId="tab-alice-1"
        openTabIds={["tab-alice-1"]}
        onCloseTab={vi.fn()}
      />,
    );
    const lane = getByTestId("collapsed-panel-close-lane");
    expect(lane).not.toBeNull();
    expect(lane.getAttribute("data-hover")).toBe("false");
    const styleAttr = lane.getAttribute("style") ?? "";
    // Neutral baseline must reference the pv-base token…
    expect(styleAttr).toContain("var(--color-pv-base)");
    // …and MUST NOT paint coral before hover.
    expect(styleAttr).not.toContain("rgba(255, 184, 150,");
  });

  it("Test C: dragover with application/x-skynet-badge → data-hover='true' + coral palette in inline style", () => {
    const { getByTestId } = render(
      <CollapsedPanelCloseLane
        draggedBadgeTabId="tab-alice-1"
        openTabIds={["tab-alice-1"]}
        onCloseTab={vi.fn()}
      />,
    );
    const lane = getByTestId("collapsed-panel-close-lane");
    const dt = makeDataTransferStub({
      "text/plain": "tab-alice-1",
      "application/x-skynet-badge": JSON.stringify({ tabId: "tab-alice-1" }),
    });
    act(() => {
      dispatchNativeDragOver(lane, dt);
    });
    expect(lane.getAttribute("data-hover")).toBe("true");
    const styleAttr = lane.getAttribute("style") ?? "";
    expect(styleAttr).toContain("rgba(255, 184, 150, 0.22)");
    // jsdom serializes `0.60` as `0.6` in the style attribute string. The
    // SOURCE token in CollapsedPanelCloseLane.tsx is `rgba(255, 184, 150, 0.60)`
    // (byte-for-byte match with SplitView.tsx:464) — the palette-exactness
    // grep in PLAN.md's <done> block asserts the source form; this assertion
    // checks the serialized runtime form which may differ in trailing zeros.
    expect(styleAttr).toMatch(/rgba\(255, 184, 150, 0\.60?\)/);
  });

  it("Test D: dragover with ONLY text/plain (row drag) → data-hover STAYS 'false', palette stays neutral, AND preventDefault NOT called (browser default not-a-drop-target semantic preserved per T-260829-ih3-04)", () => {
    const { getByTestId } = render(
      <CollapsedPanelCloseLane
        draggedBadgeTabId="tab-alice-1"
        openTabIds={["tab-alice-1"]}
        onCloseTab={vi.fn()}
      />,
    );
    const lane = getByTestId("collapsed-panel-close-lane");
    const dt = makeDataTransferStub({ "text/plain": "row-payload" });
    // Dispatch inline so we can spy on the event's preventDefault BEFORE
    // it enters the handler — a future change that accidentally called
    // preventDefault before the type-gate would silently break the
    // browser's not-a-drop-target semantic for row drags on the lane.
    const evt = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(evt, "dataTransfer", {
      value: dt,
      configurable: true,
    });
    const preventDefaultSpy = vi.spyOn(evt, "preventDefault");
    act(() => {
      lane.dispatchEvent(evt);
    });
    expect(lane.getAttribute("data-hover")).toBe("false");
    const styleAttr = lane.getAttribute("style") ?? "";
    expect(styleAttr).not.toContain("rgba(255, 184, 150,");
    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it("Test E: dragover + drop with valid badge payload matching openTabIds → onCloseTab called once, data-hover cleared, structured log emitted once", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const onCloseTab = vi.fn();
    const { getByTestId } = render(
      <CollapsedPanelCloseLane
        draggedBadgeTabId="tab-alice-1"
        openTabIds={["tab-alice-1", "tab-bob-2"]}
        onCloseTab={onCloseTab}
      />,
    );
    const lane = getByTestId("collapsed-panel-close-lane");
    const dt = makeDataTransferStub({
      "text/plain": "tab-alice-1",
      "application/x-skynet-badge": JSON.stringify({ tabId: "tab-alice-1" }),
    });
    act(() => {
      dispatchNativeDragOver(lane, dt);
    });
    expect(lane.getAttribute("data-hover")).toBe("true");
    act(() => {
      dispatchNativeDrop(lane, dt);
    });
    expect(onCloseTab).toHaveBeenCalledTimes(1);
    expect(onCloseTab).toHaveBeenCalledWith("tab-alice-1");
    expect(lane.getAttribute("data-hover")).toBe("false");
    const laneDropLogs = infoSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === "string" &&
        call[0].startsWith("[collapsed-lane-drop] close tabId="),
    );
    expect(laneDropLogs).toHaveLength(1);
    expect(laneDropLogs[0][0]).toBe("[collapsed-lane-drop] close tabId=tab-alice-1");
  });

  it("Test F: drop with badge payload tabId NOT in openTabIds → onCloseTab NOT called (silent-drop security guard), NO log, data-hover cleared", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const onCloseTab = vi.fn();
    const { getByTestId } = render(
      <CollapsedPanelCloseLane
        draggedBadgeTabId="tab-attacker-forged"
        openTabIds={["tab-alice-1", "tab-bob-2"]}
        onCloseTab={onCloseTab}
      />,
    );
    const lane = getByTestId("collapsed-panel-close-lane");
    const dt = makeDataTransferStub({
      "text/plain": "tab-attacker-forged",
      "application/x-skynet-badge": JSON.stringify({
        tabId: "tab-attacker-forged",
      }),
    });
    act(() => {
      dispatchNativeDragOver(lane, dt);
    });
    act(() => {
      dispatchNativeDrop(lane, dt);
    });
    expect(onCloseTab).not.toHaveBeenCalled();
    const laneDropLogs = infoSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === "string" &&
        call[0].startsWith("[collapsed-lane-drop] "),
    );
    expect(laneDropLogs).toHaveLength(0);
    expect(lane.getAttribute("data-hover")).toBe("false");
  });

  it("Test G: dragover then dragleave INSIDE bounding rect → data-hover STAYS 'true' (child-boundary crossing guard)", () => {
    const { getByTestId } = render(
      <CollapsedPanelCloseLane
        draggedBadgeTabId="tab-alice-1"
        openTabIds={["tab-alice-1"]}
        onCloseTab={vi.fn()}
      />,
    );
    const lane = getByTestId("collapsed-panel-close-lane");
    const dt = makeDataTransferStub({
      "text/plain": "tab-alice-1",
      "application/x-skynet-badge": JSON.stringify({ tabId: "tab-alice-1" }),
    });
    act(() => {
      dispatchNativeDragOver(lane, dt);
    });
    expect(lane.getAttribute("data-hover")).toBe("true");
    // KNOWN_RECT is 0,0 → 115,800 — (50, 400) is inside.
    act(() => {
      dispatchNativeDragLeaveAt(lane, 50, 400, dt);
    });
    expect(lane.getAttribute("data-hover")).toBe("true");
  });

  it("Test H: dragover then window-level dragend (Escape-cancel) → data-hover cleared without a preceding dragleave", () => {
    const { getByTestId } = render(
      <CollapsedPanelCloseLane
        draggedBadgeTabId="tab-alice-1"
        openTabIds={["tab-alice-1"]}
        onCloseTab={vi.fn()}
      />,
    );
    const lane = getByTestId("collapsed-panel-close-lane");
    const dt = makeDataTransferStub({
      "text/plain": "tab-alice-1",
      "application/x-skynet-badge": JSON.stringify({ tabId: "tab-alice-1" }),
    });
    act(() => {
      dispatchNativeDragOver(lane, dt);
    });
    expect(lane.getAttribute("data-hover")).toBe("true");
    act(() => {
      window.dispatchEvent(new Event("dragend"));
    });
    expect(lane.getAttribute("data-hover")).toBe("false");
  });

  it("Test I: mount-gate integration — draggedBadgeTabId null → tab-x → null cycles the lane in/out of the DOM", () => {
    const onCloseTab = vi.fn();
    const { queryByTestId, rerender } = render(
      <CollapsedPanelCloseLane
        draggedBadgeTabId={null}
        openTabIds={[]}
        onCloseTab={onCloseTab}
      />,
    );
    expect(queryByTestId("collapsed-panel-close-lane")).toBeNull();
    rerender(
      <CollapsedPanelCloseLane
        draggedBadgeTabId="tab-x"
        openTabIds={["tab-x"]}
        onCloseTab={onCloseTab}
      />,
    );
    expect(queryByTestId("collapsed-panel-close-lane")).not.toBeNull();
    rerender(
      <CollapsedPanelCloseLane
        draggedBadgeTabId={null}
        openTabIds={[]}
        onCloseTab={onCloseTab}
      />,
    );
    // Instant disappear (no exit animation) — DOM node must be gone.
    expect(queryByTestId("collapsed-panel-close-lane")).toBeNull();
  });

  it("Test I.2 (regression — inline-260830-close-lane-callback-ref): dragover works when lane mounts AFTER starting from null (drag handlers attach when the div appears, not only on component mount)", () => {
    // Regression for the bug where a plain useRef + `[]` deps effect ran
    // exactly once at first render with `outerRef.current === null`
    // (component returned null when draggedBadgeTabId was null), silently
    // failed to attach drag listeners, and never re-ran when the div
    // eventually mounted on drag-start. Ashley report 2026-08-30 (taylor):
    // "when I start dragging an identity badge it does pop out that side
    // thing with the X in it but it doesn't highlight coral when I actually
    // hover over it with the identity badge and if I drop on there nothing
    // happens." Test I above proves the DOM cycles in/out; this test proves
    // handlers are LIVE on the mounted div.
    const onCloseTab = vi.fn();
    const { getByTestId, queryByTestId, rerender } = render(
      <CollapsedPanelCloseLane
        draggedBadgeTabId={null}
        openTabIds={["tab-alice-1"]}
        onCloseTab={onCloseTab}
      />,
    );
    expect(queryByTestId("collapsed-panel-close-lane")).toBeNull();
    rerender(
      <CollapsedPanelCloseLane
        draggedBadgeTabId="tab-alice-1"
        openTabIds={["tab-alice-1"]}
        onCloseTab={onCloseTab}
      />,
    );
    const lane = getByTestId("collapsed-panel-close-lane");
    expect(lane.getAttribute("data-hover")).toBe("false");
    const dt = makeDataTransferStub({
      "text/plain": "tab-alice-1",
      "application/x-skynet-badge": JSON.stringify({ tabId: "tab-alice-1" }),
    });
    act(() => {
      dispatchNativeDragOver(lane, dt);
    });
    // If the listener re-attach never happens, data-hover stays "false"
    // (native dragover fires but the div has no listener → setHover(true)
    // never runs).
    expect(lane.getAttribute("data-hover")).toBe("true");
    // And a drop should also fire onCloseTab through the wired handler.
    act(() => {
      dispatchNativeDrop(lane, dt);
    });
    expect(onCloseTab).toHaveBeenCalledTimes(1);
    expect(onCloseTab).toHaveBeenCalledWith("tab-alice-1");
  });
});

// ─── useDraggedBadgeTabId hook probe ────────────────────────────────────────
// Tiny probe component that renders the hook's returned tabId into a DOM node
// so tests can read it via textContent.
function HookProbe() {
  const [, forceRender] = useState(0);
  const tabId = useDraggedBadgeTabId();
  // Force a re-render on window drag events so React commits after the hook's
  // setState fires from a native listener (act wraps state updates but the
  // hook uses a plain useState — dispatchEvent inside act() should flush).
  useEffect(() => {
    const handler = () => forceRender((n) => n + 1);
    window.addEventListener("dragstart", handler);
    window.addEventListener("dragend", handler);
    return () => {
      window.removeEventListener("dragstart", handler);
      window.removeEventListener("dragend", handler);
    };
  }, []);
  return <div data-testid="probe">{tabId ?? ""}</div>;
}

describe("useDraggedBadgeTabId hook (quick-260829-ih3 Task 1)", () => {
  it("Test J: dragstart with application/x-skynet-badge sets probe to tabId; dragend clears to empty", () => {
    const { getByTestId } = render(<HookProbe />);
    const probe = getByTestId("probe");
    expect(probe.textContent).toBe("");

    const dt = makeDataTransferStub({
      "text/plain": "tab-alice-1",
      "application/x-skynet-badge": JSON.stringify({ tabId: "tab-alice-1" }),
    });
    act(() => {
      const evt = new Event("dragstart", { bubbles: true });
      Object.defineProperty(evt, "dataTransfer", {
        value: dt,
        configurable: true,
      });
      window.dispatchEvent(evt);
    });
    expect(probe.textContent).toBe("tab-alice-1");

    act(() => {
      window.dispatchEvent(new Event("dragend"));
    });
    expect(probe.textContent).toBe("");
  });

  it("Test J.2: dragstart WITHOUT application/x-skynet-badge (row-drag only text/plain) leaves probe empty", () => {
    const { getByTestId } = render(<HookProbe />);
    const probe = getByTestId("probe");
    const dt = makeDataTransferStub({ "text/plain": "row-payload" });
    act(() => {
      const evt = new Event("dragstart", { bubbles: true });
      Object.defineProperty(evt, "dataTransfer", {
        value: dt,
        configurable: true,
      });
      window.dispatchEvent(evt);
    });
    // Row drag MUST NOT setState — probe stays empty.
    expect(probe.textContent).toBe("");
  });
});

// ─── Drop-ladder validation branches (quick-260829-ih3 code-review finding #5) ───
// Test E covers the happy path; Test F covers the openTabIds-membership miss.
// The 4 tests below cover the earlier gauntlet steps in the drop handler:
//   Step 2: JSON.parse fail (malformed JSON)
//   Step 3a: parsed === null
//   Step 3b: parsed is non-object (or tabId key wrong type)
//   Step 3c: parsed.tabId is empty string
// All four MUST silently drop — no onCloseTab, no structured log, no throw.
describe("CollapsedPanelCloseLane — drop-ladder validation branches (code-review finding #5)", () => {
  beforeEach(() => {
    Element.prototype.getBoundingClientRect = function () {
      return {
        left: 0,
        top: 0,
        right: 115,
        bottom: 800,
        width: 115,
        height: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    };
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("Drop-ladder A: badge MIME with malformed JSON payload → silent drop, no onCloseTab, no log, no throw", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const onCloseTab = vi.fn();
    const { getByTestId } = render(
      <CollapsedPanelCloseLane
        draggedBadgeTabId="tab-alice-1"
        openTabIds={["tab-alice-1"]}
        onCloseTab={onCloseTab}
      />,
    );
    const lane = getByTestId("collapsed-panel-close-lane");
    const dt = makeDataTransferStub({
      "application/x-skynet-badge": "{tabId:", // invalid JSON
    });
    expect(() => {
      act(() => {
        dispatchNativeDrop(lane, dt);
      });
    }).not.toThrow();
    expect(onCloseTab).not.toHaveBeenCalled();
    expect(
      infoSpy.mock.calls.some((call) =>
        String(call[0]).startsWith("[collapsed-lane-drop]"),
      ),
    ).toBe(false);
  });

  it("Drop-ladder B: badge MIME with JSON `null` payload → silent drop, no onCloseTab, no log", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const onCloseTab = vi.fn();
    const { getByTestId } = render(
      <CollapsedPanelCloseLane
        draggedBadgeTabId="tab-alice-1"
        openTabIds={["tab-alice-1"]}
        onCloseTab={onCloseTab}
      />,
    );
    const lane = getByTestId("collapsed-panel-close-lane");
    const dt = makeDataTransferStub({
      "application/x-skynet-badge": "null",
    });
    act(() => {
      dispatchNativeDrop(lane, dt);
    });
    expect(onCloseTab).not.toHaveBeenCalled();
    expect(
      infoSpy.mock.calls.some((call) =>
        String(call[0]).startsWith("[collapsed-lane-drop]"),
      ),
    ).toBe(false);
  });

  it("Drop-ladder C: badge MIME with wrong-type tabId (number) → silent drop, no onCloseTab, no log", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const onCloseTab = vi.fn();
    const { getByTestId } = render(
      <CollapsedPanelCloseLane
        draggedBadgeTabId="tab-alice-1"
        openTabIds={["tab-alice-1"]}
        onCloseTab={onCloseTab}
      />,
    );
    const lane = getByTestId("collapsed-panel-close-lane");
    const dt = makeDataTransferStub({
      "application/x-skynet-badge": JSON.stringify({ tabId: 42 }),
    });
    act(() => {
      dispatchNativeDrop(lane, dt);
    });
    expect(onCloseTab).not.toHaveBeenCalled();
    expect(
      infoSpy.mock.calls.some((call) =>
        String(call[0]).startsWith("[collapsed-lane-drop]"),
      ),
    ).toBe(false);
  });

  it("Drop-ladder D: badge MIME with empty-string tabId → silent drop, no onCloseTab, no log", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const onCloseTab = vi.fn();
    const { getByTestId } = render(
      <CollapsedPanelCloseLane
        draggedBadgeTabId="tab-alice-1"
        openTabIds={["tab-alice-1"]}
        onCloseTab={onCloseTab}
      />,
    );
    const lane = getByTestId("collapsed-panel-close-lane");
    const dt = makeDataTransferStub({
      "application/x-skynet-badge": JSON.stringify({ tabId: "" }),
    });
    act(() => {
      dispatchNativeDrop(lane, dt);
    });
    expect(onCloseTab).not.toHaveBeenCalled();
    expect(
      infoSpy.mock.calls.some((call) =>
        String(call[0]).startsWith("[collapsed-lane-drop]"),
      ),
    ).toBe(false);
  });
});

// ─── shouldMountCloseLane helper (code-review finding #3) ───
// Locks the mount-gate against silent regression at the AppShell wire site.
// The gate is `!isMobile && !isMobileListScreen && !sidebarOpen` — the lane
// mounts if and only if ALL THREE booleans are false. Walk all 8 truth-table
// combinations so a future refactor that flips one of the negations, or
// forgets one of the three inputs, is caught.
describe("shouldMountCloseLane (code-review finding #3 — mount-gate truth table)", () => {
  it("all-false (desktop, split screen, panel collapsed) → mounts", () => {
    expect(
      shouldMountCloseLane({
        isMobile: false,
        isMobileListScreen: false,
        sidebarOpen: false,
      }),
    ).toBe(true);
  });

  it("isMobile true → does NOT mount (split view doesn't exist on mobile)", () => {
    expect(
      shouldMountCloseLane({
        isMobile: true,
        isMobileListScreen: false,
        sidebarOpen: false,
      }),
    ).toBe(false);
  });

  it("isMobileListScreen true → does NOT mount (sidebar occupies whole viewport)", () => {
    expect(
      shouldMountCloseLane({
        isMobile: false,
        isMobileListScreen: true,
        sidebarOpen: false,
      }),
    ).toBe(false);
  });

  it("sidebarOpen true → does NOT mount (actual panel is already the drop target)", () => {
    expect(
      shouldMountCloseLane({
        isMobile: false,
        isMobileListScreen: false,
        sidebarOpen: true,
      }),
    ).toBe(false);
  });

  it("isMobile true + isMobileListScreen true → does NOT mount", () => {
    expect(
      shouldMountCloseLane({
        isMobile: true,
        isMobileListScreen: true,
        sidebarOpen: false,
      }),
    ).toBe(false);
  });

  it("isMobile true + sidebarOpen true → does NOT mount", () => {
    expect(
      shouldMountCloseLane({
        isMobile: true,
        isMobileListScreen: false,
        sidebarOpen: true,
      }),
    ).toBe(false);
  });

  it("isMobileListScreen true + sidebarOpen true → does NOT mount", () => {
    expect(
      shouldMountCloseLane({
        isMobile: false,
        isMobileListScreen: true,
        sidebarOpen: true,
      }),
    ).toBe(false);
  });

  it("all-true → does NOT mount", () => {
    expect(
      shouldMountCloseLane({
        isMobile: true,
        isMobileListScreen: true,
        sidebarOpen: true,
      }),
    ).toBe(false);
  });
});
