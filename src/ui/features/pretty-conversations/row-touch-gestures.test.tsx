// ─── useRowTouchGestures (shape-sidebar) ────────────────────────────────────
// Touch-only press-and-hold → menu, and swipe-left → archive, for sidebar rows
// and app icons. Driven through a tiny harness that spreads the hook's
// handlers + style onto one element, like PrettyConversationRow does.
//
// Event timestamps are set explicitly on each native event (the hook reads
// e.timeStamp for flick speed), and hold / slide-out timing runs on fake
// timers.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createEvent, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { createPortal } from "react-dom";

import {
  HOLD_MS,
  MOVE_SLOP,
  SWIPE_COMMIT_FRACTION,
  useRowTouchGestures,
} from "./row-touch-gestures";

const WIDTH = 200;

function Harness({
  onHold,
  onSwipeArchive,
  onClick,
}: {
  onHold?: (x: number, y: number) => void;
  onSwipeArchive?: () => void;
  onClick?: () => void;
}) {
  const g = useRowTouchGestures({ onHold, onSwipeArchive });
  return (
    <div
      data-testid="surface"
      data-offset={String(g.offset)}
      style={g.style}
      {...g.handlers}
      onClick={onClick}
    >
      row
    </div>
  );
}

function surface(): HTMLElement {
  const el = screen.getByTestId("surface");
  el.getBoundingClientRect = () =>
    ({ width: WIDTH, height: 40, top: 0, left: 0, right: WIDTH, bottom: 40, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return el;
}

type Pt = { x: number; y: number };

/** Fires a touch event with a fixed native timeStamp; returns fireEvent's
 *  result (false when the handler called preventDefault). */
function touch(
  el: HTMLElement,
  kind: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
  points: Pt[],
  t: number,
): boolean {
  const list = points.map((p, i) => ({ identifier: i, clientX: p.x, clientY: p.y, target: el }));
  const ev = createEvent[kind](el, {
    touches: kind === "touchEnd" || kind === "touchCancel" ? [] : list,
    changedTouches: list,
    cancelable: true,
  });
  Object.defineProperty(ev, "timeStamp", { value: t });
  let result = true;
  act(() => {
    result = fireEvent(el, ev);
  });
  return result;
}

const offsetOf = (el: HTMLElement) => Number(el.getAttribute("data-offset"));

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useRowTouchGestures — press-and-hold", () => {
  it("constants are the agreed values", () => {
    expect(HOLD_MS).toBe(500);
    expect(MOVE_SLOP).toBe(8);
    expect(SWIPE_COMMIT_FRACTION).toBe(0.4);
  });

  it("a 500ms hold calls onHold once with the touch point", () => {
    const onHold = vi.fn();
    render(<Harness onHold={onHold} />);
    const el = surface();
    touch(el, "touchStart", [{ x: 37, y: 91 }], 0);

    act(() => vi.advanceTimersByTime(HOLD_MS - 1));
    expect(onHold).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onHold).toHaveBeenCalledTimes(1);
    expect(onHold).toHaveBeenCalledWith(37, 91);
  });

  it("small jitter inside the slop does not cancel the hold", () => {
    const onHold = vi.fn();
    render(<Harness onHold={onHold} />);
    const el = surface();
    touch(el, "touchStart", [{ x: 50, y: 50 }], 0);
    touch(el, "touchMove", [{ x: 50 + MOVE_SLOP - 1, y: 50 - (MOVE_SLOP - 1) }], 100);
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onHold).toHaveBeenCalledWith(50, 50);
  });

  it("moving more than 8px before 500ms cancels the hold", () => {
    const onHold = vi.fn();
    render(<Harness onHold={onHold} />);
    const el = surface();
    touch(el, "touchStart", [{ x: 50, y: 50 }], 0);
    touch(el, "touchMove", [{ x: 50, y: 50 + MOVE_SLOP + 4 }], 100);
    act(() => vi.advanceTimersByTime(HOLD_MS * 2));
    expect(onHold).not.toHaveBeenCalled();
  });

  it("lifting the finger before 500ms cancels the hold and the tap clicks normally", () => {
    const onHold = vi.fn();
    const onClick = vi.fn();
    render(<Harness onHold={onHold} onClick={onClick} />);
    const el = surface();
    touch(el, "touchStart", [{ x: 50, y: 50 }], 0);
    act(() => vi.advanceTimersByTime(200));
    expect(touch(el, "touchEnd", [{ x: 50, y: 50 }], 200)).toBe(true); // not prevented
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onHold).not.toHaveBeenCalled();
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("the click following a hold is swallowed (once), and touchend is preventDefault'd", () => {
    const onHold = vi.fn();
    const onClick = vi.fn();
    render(<Harness onHold={onHold} onClick={onClick} />);
    const el = surface();
    touch(el, "touchStart", [{ x: 10, y: 10 }], 0);
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onHold).toHaveBeenCalledTimes(1);

    const notPrevented = touch(el, "touchEnd", [{ x: 10, y: 10 }], HOLD_MS + 50);
    expect(notPrevented).toBe(false);

    fireEvent.click(el);
    expect(onClick).not.toHaveBeenCalled();
    // Only the one synthesized click is eaten; the next real tap goes through.
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("multi-touch is ignored: no hold, no swipe", () => {
    const onHold = vi.fn();
    const onSwipeArchive = vi.fn();
    render(<Harness onHold={onHold} onSwipeArchive={onSwipeArchive} />);
    const el = surface();
    touch(el, "touchStart", [{ x: 150, y: 20 }, { x: 160, y: 30 }], 0);
    touch(el, "touchMove", [{ x: 20, y: 20 }, { x: 30, y: 30 }], 100);
    expect(offsetOf(el)).toBe(0);
    act(() => vi.advanceTimersByTime(HOLD_MS * 2));
    touch(el, "touchEnd", [], 1200);
    act(() => vi.advanceTimersByTime(1000));
    expect(onHold).not.toHaveBeenCalled();
    expect(onSwipeArchive).not.toHaveBeenCalled();
    expect(offsetOf(el)).toBe(0);
  });

  it("a second finger landing during a pending hold cancels it", () => {
    const onHold = vi.fn();
    render(<Harness onHold={onHold} />);
    const el = surface();
    touch(el, "touchStart", [{ x: 50, y: 50 }], 0);
    act(() => vi.advanceTimersByTime(200));
    touch(el, "touchStart", [{ x: 50, y: 50 }, { x: 90, y: 50 }], 200);
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onHold).not.toHaveBeenCalled();
  });
});

describe("useRowTouchGestures — swipe to archive", () => {
  it("a second finger mid-swipe slides the row back", () => {
    const onSwipeArchive = vi.fn();
    render(<Harness onSwipeArchive={onSwipeArchive} />);
    const el = surface();
    touch(el, "touchStart", [{ x: 180, y: 20 }], 0);
    touch(el, "touchMove", [{ x: 130, y: 22 }], 100);
    expect(offsetOf(el)).toBe(-50);
    touch(el, "touchStart", [{ x: 130, y: 22 }, { x: 60, y: 30 }], 120);
    expect(offsetOf(el)).toBe(0);
    touch(el, "touchEnd", [], 200);
    act(() => vi.advanceTimersByTime(1000));
    expect(onSwipeArchive).not.toHaveBeenCalled();
  });

  it("the browser's own long-press menu is blocked during a hold, not otherwise", () => {
    render(<Harness onHold={vi.fn()} />);
    const el = surface();
    const idle = createEvent.contextMenu(el, { cancelable: true });
    fireEvent(el, idle);
    expect(idle.defaultPrevented).toBe(false);
    touch(el, "touchStart", [{ x: 10, y: 10 }], 0);
    const during = createEvent.contextMenu(el, { cancelable: true });
    fireEvent(el, during);
    expect(during.defaultPrevented).toBe(true);
  });

  it("leftward swipe tracks the finger with a translateX offset (≤ 0) and cancels the hold", () => {
    const onHold = vi.fn();
    render(<Harness onHold={onHold} onSwipeArchive={vi.fn()} />);
    const el = surface();
    touch(el, "touchStart", [{ x: 180, y: 20 }], 0);
    touch(el, "touchMove", [{ x: 150, y: 22 }], 100);
    expect(offsetOf(el)).toBe(-30);
    expect(el.style.transform).toBe("translateX(-30px)");
    // Moving back right of the start clamps at 0, never positive.
    touch(el, "touchMove", [{ x: 195, y: 22 }], 150);
    expect(offsetOf(el)).toBe(0);
    act(() => vi.advanceTimersByTime(HOLD_MS * 2));
    expect(onHold).not.toHaveBeenCalled();
  });

  it("releasing past 40% of the width slides the row out, then calls onSwipeArchive after the slide", () => {
    const onSwipeArchive = vi.fn();
    const onClick = vi.fn();
    render(<Harness onSwipeArchive={onSwipeArchive} onClick={onClick} />);
    const el = surface();
    const dx = -(WIDTH * SWIPE_COMMIT_FRACTION + 10); // -90
    touch(el, "touchStart", [{ x: 190, y: 20 }], 0);
    touch(el, "touchMove", [{ x: 190 + dx, y: 24 }], 1000); // slow — not a flick
    const notPrevented = touch(el, "touchEnd", [], 1000);
    expect(notPrevented).toBe(false);

    // Slid fully out.
    expect(offsetOf(el)).toBe(-WIDTH);
    expect(el.style.transform).toBe(`translateX(-${WIDTH}px)`);
    expect(el.style.transition).toMatch(/transform/);
    expect(onSwipeArchive).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(179));
    expect(onSwipeArchive).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onSwipeArchive).toHaveBeenCalledTimes(1);

    // The swipe is not a tap.
    fireEvent.click(el);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("a short, slow swipe snaps back and never archives", () => {
    const onSwipeArchive = vi.fn();
    const onClick = vi.fn();
    render(<Harness onSwipeArchive={onSwipeArchive} onClick={onClick} />);
    const el = surface();
    touch(el, "touchStart", [{ x: 190, y: 20 }], 0);
    touch(el, "touchMove", [{ x: 150, y: 20 }], 1000); // -40 of 200 = 20%
    expect(offsetOf(el)).toBe(-40);
    touch(el, "touchEnd", [], 1000);
    expect(offsetOf(el)).toBe(0);
    expect(el.style.transform).toBe("");
    // The browser's follow-up click is still not a tap…
    fireEvent.click(el);
    expect(onClick).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    expect(onSwipeArchive).not.toHaveBeenCalled();
    // …but a later, real click is (a mouse on a touch laptop).
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("touches and clicks that bubble in from the row's menu are ignored", () => {
    const onHold = vi.fn();
    const onClick = vi.fn();
    function WithMenu() {
      const g = useRowTouchGestures({ onHold });
      return (
        <div data-testid="surface" {...g.handlers} onClick={onClick}>
          row
          {createPortal(<button data-testid="menu-item">Item</button>, document.body)}
        </div>
      );
    }
    render(<WithMenu />);
    const item = screen.getByTestId("menu-item");
    touch(item, "touchStart", [{ x: 5, y: 5 }], 0);
    act(() => vi.advanceTimersByTime(HOLD_MS + 50));
    expect(onHold).not.toHaveBeenCalled();
    // A hold on the row itself, then a mouse click on the menu item: not eaten.
    const el = surface();
    touch(el, "touchStart", [{ x: 5, y: 5 }], 0);
    act(() => vi.advanceTimersByTime(HOLD_MS + 50));
    touch(el, "touchEnd", [], HOLD_MS + 60);
    expect(onHold).toHaveBeenCalledTimes(1);
    fireEvent.click(item);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("a fast flick commits even when short of 40%", () => {
    const onSwipeArchive = vi.fn();
    render(<Harness onSwipeArchive={onSwipeArchive} />);
    const el = surface();
    touch(el, "touchStart", [{ x: 190, y: 20 }], 0);
    touch(el, "touchMove", [{ x: 120, y: 22 }], 50); // -70 (35%) in 50ms = 1.4px/ms
    touch(el, "touchEnd", [], 60);
    expect(offsetOf(el)).toBe(-WIDTH);
    act(() => vi.advanceTimersByTime(200));
    expect(onSwipeArchive).toHaveBeenCalledTimes(1);
  });

  it("a fast but tiny flick (under the flick minimum) does not commit", () => {
    const onSwipeArchive = vi.fn();
    render(<Harness onSwipeArchive={onSwipeArchive} />);
    const el = surface();
    touch(el, "touchStart", [{ x: 190, y: 20 }], 0);
    touch(el, "touchMove", [{ x: 150, y: 20 }], 10); // -40 in 10ms: fast, but < 60px
    touch(el, "touchEnd", [], 12);
    expect(offsetOf(el)).toBe(0);
    act(() => vi.advanceTimersByTime(500));
    expect(onSwipeArchive).not.toHaveBeenCalled();
  });

  it("touchcancel mid-swipe snaps back without archiving, even when far", () => {
    const onSwipeArchive = vi.fn();
    render(<Harness onSwipeArchive={onSwipeArchive} />);
    const el = surface();
    touch(el, "touchStart", [{ x: 190, y: 20 }], 0);
    touch(el, "touchMove", [{ x: 40, y: 20 }], 1000);
    touch(el, "touchCancel", [], 1000);
    expect(offsetOf(el)).toBe(0);
    act(() => vi.advanceTimersByTime(500));
    expect(onSwipeArchive).not.toHaveBeenCalled();
  });

  it("a mostly-vertical move is left alone (scroll): no offset, no archive, touchend not prevented", () => {
    const onSwipeArchive = vi.fn();
    const onHold = vi.fn();
    render(<Harness onHold={onHold} onSwipeArchive={onSwipeArchive} />);
    const el = surface();
    touch(el, "touchStart", [{ x: 190, y: 20 }], 0);
    touch(el, "touchMove", [{ x: 180, y: 80 }], 100);
    // Once it's a scroll, later sideways travel doesn't turn it into a swipe.
    touch(el, "touchMove", [{ x: 20, y: 90 }], 200);
    expect(offsetOf(el)).toBe(0);
    expect(el.getAttribute("style")).toBeNull();
    expect(touch(el, "touchEnd", [], 300)).toBe(true);
    act(() => vi.advanceTimersByTime(1000));
    expect(onSwipeArchive).not.toHaveBeenCalled();
    expect(onHold).not.toHaveBeenCalled();
  });

  it("a rightward move never swipes", () => {
    const onSwipeArchive = vi.fn();
    render(<Harness onSwipeArchive={onSwipeArchive} />);
    const el = surface();
    touch(el, "touchStart", [{ x: 20, y: 20 }], 0);
    touch(el, "touchMove", [{ x: 150, y: 20 }], 100);
    expect(offsetOf(el)).toBe(0);
    touch(el, "touchEnd", [], 100);
    act(() => vi.advanceTimersByTime(500));
    expect(onSwipeArchive).not.toHaveBeenCalled();
  });

  it("without onSwipeArchive the row never swipes (no offset, no style)", () => {
    const onHold = vi.fn();
    const onClick = vi.fn();
    render(<Harness onHold={onHold} onClick={onClick} />);
    const el = surface();
    touch(el, "touchStart", [{ x: 190, y: 20 }], 0);
    touch(el, "touchMove", [{ x: 20, y: 20 }], 100);
    expect(offsetOf(el)).toBe(0);
    expect(el.getAttribute("style")).toBeNull();
    expect(touch(el, "touchEnd", [], 100)).toBe(true);
    act(() => vi.advanceTimersByTime(HOLD_MS * 2));
    expect(onHold).not.toHaveBeenCalled();
  });
});
