import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type TouchEvent } from "react";
import { systemLogger } from "@/lib/frontend-logger";

// Touch gestures for sidebar rows and app icons (shape-sidebar):
//   - press-and-hold opens the item's menu at the finger;
//   - swiping a row to the left archives it (when the row can be archived).
// Touch only — mouse and pen input never reach these handlers' logic, so the
// desktop keeps right-click + the ⋮ button.
//
// A hold is cancelled the moment the finger moves (so scrolling never opens a
// menu), and the click that follows a hold is swallowed so the item doesn't
// also open. A sideways move takes the gesture over as a swipe; a mostly
// vertical one is left to the list's scroll.

export const HOLD_MS = 500;
/** Finger travel (px) that turns a press into a scroll or a swipe. */
export const MOVE_SLOP = 8;
/** Fraction of the row's width past which letting go archives. */
export const SWIPE_COMMIT_FRACTION = 0.4;
/** A quick flick archives even when short of the commit fraction. */
const FLICK_SPEED = 0.6; // px per ms
const FLICK_MIN = 60;
const SLIDE_OUT_MS = 180;
/** How long after a hold/swipe ends the browser's follow-up click is swallowed. */
const SWALLOW_CLICK_MS = 400;

/** True on touch-first devices (phones and tablets, whatever their width).
 *  Their rows and icons aren't draggable: a hold there must open the menu,
 *  not lift a drag. */
export function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}

/** The row's menu renders inside it (portaled, but React events still bubble
 *  through the row) — only touches and clicks on the row's own DOM count. */
function isOwnTarget(e: { currentTarget: Element; target: EventTarget | null }): boolean {
  return e.target instanceof Node && e.currentTarget.contains(e.target);
}

type Mode = "idle" | "pending" | "held" | "swipe" | "scroll";

export interface RowTouchGestureOptions {
  /** Open the item's menu at the given viewport point. */
  onHold?: (x: number, y: number) => void;
  /** Called once the row has slid fully out. Omit for rows that can't be archived. */
  onSwipeArchive?: () => void;
}

export interface RowTouchGestures {
  handlers: {
    onTouchStart: (e: TouchEvent<HTMLElement>) => void;
    onTouchMove: (e: TouchEvent<HTMLElement>) => void;
    onTouchEnd: (e: TouchEvent<HTMLElement>) => void;
    onTouchCancel: (e: TouchEvent<HTMLElement>) => void;
    onClickCapture: (e: MouseEvent<HTMLElement>) => void;
    onContextMenuCapture: (e: MouseEvent<HTMLElement>) => void;
  };
  /** Horizontal offset of the row while swiping (≤ 0). */
  offset: number;
  /** Style for the moving row surface. */
  style: CSSProperties | undefined;
}

export function useRowTouchGestures({ onHold, onSwipeArchive }: RowTouchGestureOptions): RowTouchGestures {
  const mode = useRef<Mode>("idle");
  const start = useRef({ x: 0, y: 0, t: 0 });
  const last = useRef({ x: 0, t: 0 });
  const width = useRef(0);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swallowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swallowClick = useRef(false);
  const [offset, setOffset] = useState(0);
  const [animating, setAnimating] = useState(false);

  const clearHold = () => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };
  useEffect(
    () => () => {
      clearHold();
      if (swallowTimer.current !== null) clearTimeout(swallowTimer.current);
    },
    [],
  );

  const onTouchStart = useCallback(
    (e: TouchEvent<HTMLElement>) => {
      if (!isOwnTarget(e)) return;
      if (e.touches.length !== 1) {
        // A second finger cancels whatever was going on — a half-done swipe
        // slides back.
        clearHold();
        mode.current = "idle";
        setAnimating(true);
        setOffset(0);
        return;
      }
      // A swipe whose lift never reached us (the element under the finger
      // was replaced) left the row part-way out — put it back.
      if (mode.current === "swipe") setOffset(0);
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY, t: e.timeStamp };
      last.current = { x: t.clientX, t: e.timeStamp };
      width.current = e.currentTarget.getBoundingClientRect().width;
      mode.current = "pending";
      swallowClick.current = false;
      setAnimating(false);
      if (onHold) {
        clearHold();
        holdTimer.current = setTimeout(() => {
          holdTimer.current = null;
          if (mode.current !== "pending") return;
          mode.current = "held";
          swallowClick.current = true;
          systemLogger.info("sidebar hold → menu", { operation: "sidebar_gesture", event: "hold" });
          onHold(start.current.x, start.current.y);
        }, HOLD_MS);
      }
    },
    [onHold],
  );

  const onTouchMove = useCallback(
    (e: TouchEvent<HTMLElement>) => {
      if (mode.current === "idle") return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - start.current.x;
      const dy = t.clientY - start.current.y;
      if (mode.current === "pending") {
        if (Math.abs(dx) < MOVE_SLOP && Math.abs(dy) < MOVE_SLOP) return;
        clearHold();
        mode.current = onSwipeArchive && dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.2 ? "swipe" : "scroll";
      }
      if (mode.current === "swipe") {
        last.current = { x: t.clientX, t: e.timeStamp };
        setOffset(Math.min(0, dx));
      }
    },
    [onSwipeArchive],
  );

  const finish = useCallback(
    (e: TouchEvent<HTMLElement>, cancelled: boolean) => {
      clearHold();
      const was = mode.current;
      if (was === "idle") return;
      mode.current = "idle";
      if (swallowTimer.current !== null) clearTimeout(swallowTimer.current);
      // The follow-up click (if any) arrives right after the touch; a later
      // click — a mouse on a touch laptop — must not be eaten.
      swallowTimer.current = setTimeout(() => {
        swallowTimer.current = null;
        swallowClick.current = false;
      }, SWALLOW_CLICK_MS);
      // After a hold or a swipe, cancel the mouse events the browser would
      // synthesise from this touch — their mousedown moves focus back to the
      // row, which closes the menu the hold just opened.
      if ((was === "held" || was === "swipe") && e.cancelable) e.preventDefault();
      if (was !== "swipe") return;
      // Any swipe, committed or not, must not also count as a tap.
      swallowClick.current = true;
      const dx = last.current.x - start.current.x;
      const dt = Math.max(1, last.current.t - start.current.t);
      const flick = -dx / dt > FLICK_SPEED && -dx > FLICK_MIN;
      const far = -dx > width.current * SWIPE_COMMIT_FRACTION;
      setAnimating(true);
      if (!cancelled && (far || flick) && onSwipeArchive) {
        systemLogger.info("sidebar swipe → archive", {
          operation: "sidebar_gesture",
          event: "swipe_archive",
          dx: Math.round(dx),
          flick,
        });
        setOffset(-Math.max(width.current, 1));
        setTimeout(() => {
          onSwipeArchive();
          // The archive normally removes the row; if it stays, bring it back.
          setAnimating(false);
          setOffset(0);
        }, SLIDE_OUT_MS);
      } else {
        setOffset(0);
      }
    },
    [onSwipeArchive],
  );

  const onTouchEnd = useCallback((e: TouchEvent<HTMLElement>) => finish(e, false), [finish]);
  const onTouchCancel = useCallback((e: TouchEvent<HTMLElement>) => finish(e, true), [finish]);

  const onClickCapture = useCallback((e: MouseEvent<HTMLElement>) => {
    if (!swallowClick.current || !isOwnTarget(e)) return;
    swallowClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // The browser's own long-press menu (Android: "Download image / Share" on a
  // picture) would cancel the touch and win over ours — block it while a
  // touch is being held. Mouse right-clicks pass through untouched.
  const onContextMenuCapture = useCallback((e: MouseEvent<HTMLElement>) => {
    if (mode.current === "pending" || mode.current === "held") e.preventDefault();
  }, []);

  const style: CSSProperties | undefined =
    offset !== 0 || animating
      ? {
          transform: offset !== 0 ? `translateX(${offset}px)` : undefined,
          transition: animating ? `transform ${SLIDE_OUT_MS}ms ease-out` : "none",
        }
      : undefined;

  return {
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onClickCapture, onContextMenuCapture },
    offset,
    style,
  };
}
