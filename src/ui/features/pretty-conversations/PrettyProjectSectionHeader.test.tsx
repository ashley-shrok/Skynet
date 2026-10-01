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
  screen,
  createEvent,
  cleanup,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// jsdom does not implement ResizeObserver; stub it so Radix's DropdownMenu
// (used by RowKebabMenu) doesn't throw when the portal mounts.
if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

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
  it("Test 1: renders header with displayName + rows region (collapsed=false)", () => {
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
    expect(header.textContent).not.toContain("Project:");
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

  it("Test 4: kebab 'New conversation in this project' item fires onNewConversationClick(slug); does NOT toggle collapse", async () => {
    const user = userEvent.setup();
    const onToggleCollapse = vi.fn();
    const onNewConversationClick = vi.fn();
    render(
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
    const kebabTrigger = screen.getByTestId("pv-project-section-kebab-trigger-gamma");
    await user.click(kebabTrigger);
    const item = screen.getByRole("menuitem", {
      name: "New conversation in this project",
    });
    await user.click(item);
    expect(onNewConversationClick).toHaveBeenCalledTimes(1);
    expect(onNewConversationClick).toHaveBeenCalledWith("gamma");
    // Header toggle NOT fired (RowKebabMenu's portal-click-containment
    // discipline — DropdownMenuContent + DropdownMenuItem both stopProp —
    // prevents the item click from bubbling to the outer div's onClick).
    expect(onToggleCollapse).not.toHaveBeenCalled();
  });

  // Phase 117 M3 fix (2026-09-18) + shape-sidebar-header-affordances
  // (2026-10-01): outer element remains <div role="button"> so the kebab
  // trigger <button> is a SIBLING, not nested. Nesting <button>s is invalid
  // HTML. Test locks the shape across both reworks.
  it("Test M3 A: outer container is <div role='button'> NOT <button>; kebab trigger is a <button> that is NOT nested inside another <button>", () => {
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
    expect(outer.tagName.toLowerCase()).toBe("div");
    expect(outer.getAttribute("role")).toBe("button");
    expect(outer.getAttribute("tabindex")).toBe("0");
    const kebabTrigger = getByTestId("pv-project-section-kebab-trigger-delta");
    expect(kebabTrigger.tagName.toLowerCase()).toBe("button");
    // Regression defense: no ancestor of the kebab trigger should be a
    // <button> element (invalid HTML nesting).
    let ancestor: HTMLElement | null = kebabTrigger.parentElement;
    while (ancestor) {
      expect(ancestor.tagName.toLowerCase()).not.toBe("button");
      ancestor = ancestor.parentElement;
    }
  });

  it("Test 4b: kebab 'Rename project' item fires onRenameProject(slug, displayName)", async () => {
    const user = userEvent.setup();
    const onRenameProject = vi.fn();
    render(
      <PrettyProjectSectionHeader
        slug="theta"
        displayName="Theta Pulse"
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onNewConversationClick={vi.fn()}
        onDropRow={vi.fn()}
        onRenameProject={onRenameProject}
        rows={null}
      />,
    );
    await user.click(screen.getByTestId("pv-project-section-kebab-trigger-theta"));
    await user.click(screen.getByRole("menuitem", { name: "Rename project" }));
    expect(onRenameProject).toHaveBeenCalledTimes(1);
    expect(onRenameProject).toHaveBeenCalledWith("theta", "Theta Pulse");
  });

  it("Test 4c: kebab 'Edit project file' item fires onEditProjectFile(slug)", async () => {
    const user = userEvent.setup();
    const onEditProjectFile = vi.fn();
    render(
      <PrettyProjectSectionHeader
        slug="iota"
        displayName="Iota"
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onNewConversationClick={vi.fn()}
        onDropRow={vi.fn()}
        onEditProjectFile={onEditProjectFile}
        rows={null}
      />,
    );
    await user.click(screen.getByTestId("pv-project-section-kebab-trigger-iota"));
    await user.click(screen.getByRole("menuitem", { name: "Edit project file" }));
    expect(onEditProjectFile).toHaveBeenCalledTimes(1);
    expect(onEditProjectFile).toHaveBeenCalledWith("iota");
  });

  it("Test 4d: kebab 'Archive project' item fires onArchiveProject(slug)", async () => {
    const user = userEvent.setup();
    const onArchiveProject = vi.fn();
    render(
      <PrettyProjectSectionHeader
        slug="kappa"
        displayName="Kappa"
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onNewConversationClick={vi.fn()}
        onDropRow={vi.fn()}
        onArchiveProject={onArchiveProject}
        rows={null}
      />,
    );
    await user.click(screen.getByTestId("pv-project-section-kebab-trigger-kappa"));
    await user.click(screen.getByRole("menuitem", { name: "Archive project" }));
    expect(onArchiveProject).toHaveBeenCalledTimes(1);
    expect(onArchiveProject).toHaveBeenCalledWith("kappa");
  });

  it("Test 4e: kebab items absent when their per-action callback is not provided", async () => {
    const user = userEvent.setup();
    render(
      <PrettyProjectSectionHeader
        slug="lambda"
        displayName="Lambda"
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onNewConversationClick={vi.fn()}
        onDropRow={vi.fn()}
        rows={null}
      />,
    );
    await user.click(screen.getByTestId("pv-project-section-kebab-trigger-lambda"));
    // Only "New conversation in this project" is unconditional; the other
    // three are gated on their callback being provided.
    expect(screen.queryByRole("menuitem", { name: "New conversation in this project" })).not.toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Rename project" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Edit project file" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Archive project" })).toBeNull();
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

// Mobile long-press context menu describe block RETIRED by
// shape-sidebar-header-affordances. Right-click + long-press are retired on
// sidebar surfaces; the kebab tap is the sole gesture. The kebab-item tests
// above (Test 4, 4b, 4c, 4d, 4e) are the new coverage for the four actions
// that used to live behind right-click / long-press.
