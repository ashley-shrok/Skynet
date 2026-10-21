import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";

import {
  useSidebarPeek,
  PEEK_CLOSE_DELAY_MS,
  PEEK_OPEN_DELAY_MS,
  PEEK_SLIDE_MS,
  type SidebarPeek,
} from "./use-sidebar-peek";

const WIDTH = 266;
let peek: SidebarPeek;

function Harness({ enabled = true }: { enabled?: boolean }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  peek = useSidebarPeek({ enabled, width: WIDTH, panelRef, toggleRef });
  return (
    <>
      <div ref={panelRef} data-testid="panel">
        <div data-testid="row" draggable />
        <div data-testid="project" draggable />
        <input data-testid="search" />
      </div>
      <button ref={toggleRef} data-testid="toggle" />
    </>
  );
}

function move(x: number, y = 100) {
  act(() => {
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }));
  });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function dragEvent(type: string, target: Element, types: string[] = []) {
  const evt = new Event(type, { bubbles: true });
  Object.defineProperty(evt, "dataTransfer", { value: { types }, configurable: true });
  act(() => {
    target.dispatchEvent(evt);
  });
}

function openPeek() {
  move(2);
  advance(PEEK_OPEN_DELAY_MS);
  expect(peek.state).toBe("open");
}

describe("useSidebarPeek", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("opens after the mouse rests on the left edge, not before", () => {
    render(<Harness />);
    move(2);
    advance(PEEK_OPEN_DELAY_MS - 1);
    expect(peek.state).toBe("closed");
    advance(1);
    expect(peek.state).toBe("open");
  });

  it("does not open when the mouse leaves the edge before the delay", () => {
    render(<Harness />);
    move(2);
    advance(PEEK_OPEN_DELAY_MS / 2);
    move(40);
    advance(PEEK_OPEN_DELAY_MS);
    expect(peek.state).toBe("closed");
  });

  it("stays open over the panel, slides away after the mouse leaves it", () => {
    render(<Harness />);
    openPeek();
    move(WIDTH - 10);
    advance(PEEK_CLOSE_DELAY_MS * 3);
    expect(peek.state).toBe("open");
    move(WIDTH + 100);
    advance(PEEK_CLOSE_DELAY_MS - 1);
    expect(peek.state).toBe("open");
    advance(1);
    expect(peek.state).toBe("closing");
    advance(PEEK_SLIDE_MS);
    expect(peek.state).toBe("closed");
  });

  it("coming back within the grace period keeps it open", () => {
    render(<Harness />);
    openPeek();
    move(WIDTH + 100);
    advance(PEEK_CLOSE_DELAY_MS / 2);
    move(100);
    advance(PEEK_CLOSE_DELAY_MS * 2);
    expect(peek.state).toBe("open");
  });

  it("an open menu or a typed-in search box holds it open", () => {
    const { getByTestId } = render(<Harness />);
    openPeek();
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.setAttribute("data-state", "open");
    document.body.appendChild(menu);
    move(WIDTH + 100);
    advance(PEEK_CLOSE_DELAY_MS * 2);
    expect(peek.state).toBe("open");
    menu.remove();

    const search = getByTestId("search") as HTMLInputElement;
    search.value = "abc";
    act(() => search.focus());
    move(WIDTH + 120);
    advance(PEEK_CLOSE_DELAY_MS * 2);
    expect(peek.state).toBe("open");
  });

  it("close() slides it away (an item was opened from it)", () => {
    render(<Harness />);
    openPeek();
    act(() => peek.close("test"));
    expect(peek.state).toBe("closing");
    advance(PEEK_SLIDE_MS);
    expect(peek.state).toBe("closed");
  });

  it("a conversation-row drag slides it off; the first mousemove after the drop ends the drag", () => {
    const { getByTestId } = render(<Harness />);
    openPeek();
    dragEvent("dragstart", getByTestId("row"), ["text/plain", "application/x-skynet-row"]);
    advance(20);
    expect(peek.state).toBe("dragging");
    // No dragend reaches the document (source row re-rendered); a mousemove ends it.
    move(600);
    expect(peek.state).toBe("closed");
    // And the edge works again.
    openPeek();
  });

  it("drop ends the drag too", () => {
    const { getByTestId } = render(<Harness />);
    openPeek();
    dragEvent("dragstart", getByTestId("row"), ["application/x-skynet-app-tile"]);
    advance(20);
    expect(peek.state).toBe("dragging");
    dragEvent("drop", document.body);
    advance(1);
    expect(peek.state).toBe("closed");
  });

  it("a project-header drag keeps it open", () => {
    const { getByTestId } = render(<Harness />);
    openPeek();
    dragEvent("dragstart", getByTestId("project"), ["application/x-skynet-project"]);
    advance(20);
    expect(peek.state).toBe("open");
  });

  it("does nothing while disabled, and resets when disabled mid-peek", () => {
    const { rerender } = render(<Harness enabled={false} />);
    move(2);
    advance(PEEK_OPEN_DELAY_MS * 2);
    expect(peek.state).toBe("closed");
    rerender(<Harness enabled />);
    openPeek();
    rerender(<Harness enabled={false} />);
    expect(peek.state).toBe("closed");
  });
});
