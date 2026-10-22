// Sidebar hover-peek — while the desktop sidebar is collapsed, resting the
// mouse on the window's left edge slides the sidebar out OVER the panes (the
// split layout never reflows), so a row can be dragged into the split view
// without opening the sidebar for real.
//
//   closed ──(mouse at left edge for OPEN_DELAY)──▶ open
//   open ──(mouse away for CLOSE_DELAY, nothing holding it)──▶ closing ──(SLIDE)──▶ closed
//   open ──(close(): a conversation/app opened from it)──▶ closing
//   open ──(a conversation row / app tile drag starts in it)──▶ drag-open
//   drag-open ──(drag leaves the panel)──▶ dragging ──(drag rests at the left edge)──▶ drag-open
//   drag-open ──(drag over)──▶ open          dragging ──(drag over)──▶ closed
//
// "drag-open" keeps the panel showing so a row can be dropped inside the
// sidebar (e.g. moved to another project). "dragging" slides it off-screen so
// the drag can reach the panes, but keeps it mounted — removing a drag source
// mid-drag cancels the drag. No mousemove fires during an HTML5 drag, so the
// pointer is tracked from dragover. A drop can re-render the source row so its
// dragend never reaches the document; the first mousemove afterwards also
// ends the drag.
//
// Mouse motion over an embedded frame (app panes, viewers) never reaches this
// document; entering one shows up as a mouseover on the <iframe> element,
// which is taken as the pointer's last position. While the pointer is in a
// frame, `edgeStrip` asks the shell to lay an invisible strip over the left
// edge (EDGE_STRIP_ATTR) so resting there still reaches us; any mousemove
// outside a frame takes it away again, so it never eats clicks elsewhere.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { systemLogger } from "@/lib/frontend-logger";

export const PEEK_EDGE_PX = 6;
export const PEEK_OPEN_DELAY_MS = 200;
export const PEEK_CLOSE_DELAY_MS = 350;
export const PEEK_SLIDE_MS = 180;
export const EDGE_STRIP_ATTR = "data-sidebar-peek-edge";

// Drags that open into a pane. Project-header drags stay in the sidebar, so
// they keep the peek open.
const PANE_DRAG_MIMES = ["application/x-skynet-row", "application/x-skynet-app-tile"];

export type SidebarPeekState = "closed" | "open" | "closing" | "drag-open" | "dragging";

export interface UseSidebarPeekOptions {
  /** Desktop, non-touch, sidebar collapsed. Off = no listeners, state "closed". */
  enabled: boolean;
  /** Peek panel width in px — the mouse counts as "inside" left of this. */
  width: number;
  panelRef: RefObject<HTMLElement | null>;
  toggleRef: RefObject<HTMLElement | null>;
}

export interface SidebarPeek {
  state: SidebarPeekState;
  /** Slide the peek away (e.g. after a conversation or app is opened from it). */
  close: (reason: string) => void;
  /** Render the edge strip: closed, and the pointer is over an embedded frame. */
  edgeStrip: boolean;
}

// An open menu or dialog (often portaled outside the panel), or a text field
// in the panel with something typed in it, keeps the peek open.
function holdOpen(panel: HTMLElement | null): boolean {
  if (document.querySelector('[role="menu"][data-state="open"], [role="dialog"][data-state="open"]')) {
    return true;
  }
  const active = document.activeElement;
  return (
    panel !== null &&
    active instanceof HTMLElement &&
    panel.contains(active) &&
    (((active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
      active.value !== "") ||
      active.isContentEditable)
  );
}

export function useSidebarPeek({ enabled, width, panelRef, toggleRef }: UseSidebarPeekOptions): SidebarPeek {
  const [state, setState] = useState<SidebarPeekState>("closed");
  const [overFrame, setOverFrame] = useState(false);
  const stateRef = useRef<SidebarPeekState>("closed");
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;
  // Re-check the pointer's last position (e.g. when a slide-out finishes).
  const evaluateRef = useRef<() => void>(() => {});

  const clearTimers = useCallback(() => {
    for (const t of [openTimer, closeTimer, slideTimer]) {
      if (t.current !== null) clearTimeout(t.current);
      t.current = null;
    }
  }, []);

  const go = useCallback(
    (next: SidebarPeekState, reason: string) => {
      clearTimers();
      const prev = stateRef.current;
      if (prev === next) return;
      stateRef.current = next;
      setState(next);
      systemLogger.info(`sidebar-peek ${prev}→${next}`, { operation: "sidebar_peek", prev, next, reason });
      if (next === "closing" || (next === "closed" && reason !== "disabled")) {
        // Focus left on a row in the hidden panel would let Enter/Space act
        // on something invisible. ("disabled" = pinned open: focus stays.)
        const active = document.activeElement;
        if (active instanceof HTMLElement && panelRef.current?.contains(active)) active.blur();
      }
      if (next === "closing") {
        slideTimer.current = setTimeout(() => {
          go("closed", "slide-done");
          evaluateRef.current();
        }, PEEK_SLIDE_MS);
      }
    },
    [clearTimers, panelRef],
  );

  const close = useCallback(
    (reason: string) => {
      if (stateRef.current === "open") go("closing", reason);
    },
    [go],
  );

  useEffect(() => {
    if (!enabled) {
      clearTimers();
      if (stateRef.current !== "closed") go("closed", "disabled");
      setOverFrame(false);
      return;
    }

    let x = Number.POSITIVE_INFINITY;
    let y = 0;

    const overToggle = (): boolean => {
      const r = toggleRef.current?.getBoundingClientRect();
      return r !== undefined && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };

    const evaluate = () => {
      const s = stateRef.current;
      if (s === "closed") {
        if (x <= PEEK_EDGE_PX) {
          if (openTimer.current === null) {
            openTimer.current = setTimeout(() => go("open", "edge-hover"), PEEK_OPEN_DELAY_MS);
          }
        } else if (openTimer.current !== null) {
          clearTimeout(openTimer.current);
          openTimer.current = null;
        }
      } else if (s === "open") {
        if (x <= widthRef.current || overToggle() || holdOpen(panelRef.current)) {
          if (closeTimer.current !== null) {
            clearTimeout(closeTimer.current);
            closeTimer.current = null;
          }
        } else if (closeTimer.current === null) {
          closeTimer.current = setTimeout(() => {
            closeTimer.current = null;
            if (!holdOpen(panelRef.current)) go("closing", "mouse-left");
          }, PEEK_CLOSE_DELAY_MS);
        }
      }
    };

    evaluateRef.current = evaluate;

    const onMove = (e: MouseEvent) => {
      if (!(e.target instanceof Element && e.target.hasAttribute(EDGE_STRIP_ATTR))) setOverFrame(false);
      x = e.clientX;
      y = e.clientY;
      if (stateRef.current === "dragging") go("closed", "drag-over-mousemove");
      else if (stateRef.current === "drag-open") go("open", "drag-over-mousemove");
      evaluate();
    };
    const onLeaveWindow = () => {
      x = Number.POSITIVE_INFINITY;
      evaluate();
    };
    const onOver = (e: MouseEvent) => {
      if (!(e.target instanceof HTMLIFrameElement)) return;
      setOverFrame(true);
      x = e.clientX;
      y = e.clientY;
      evaluate();
    };
    // Focus leaving a typed-in search box (possibly into a frame) can release
    // the hold without any mousemove following.
    const onFocusOut = () => setTimeout(evaluate, 0);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stateRef.current === "open" && !holdOpen(panelRef.current)) {
        go("closing", "escape");
      }
    };
    // Bubble phase: the row's own dragstart has already set its MIME types.
    const onDragStart = (e: DragEvent) => {
      if (stateRef.current !== "open") return;
      const target = e.target instanceof Node ? e.target : null;
      if (target === null || !panelRef.current?.contains(target)) return;
      const types = Array.from(e.dataTransfer?.types ?? []);
      if (!PANE_DRAG_MIMES.some((m) => types.includes(m))) return;
      requestAnimationFrame(() => {
        if (stateRef.current === "open") go("drag-open", "pane-drag-start");
      });
    };
    const onDragOver = (e: DragEvent) => {
      const s = stateRef.current;
      if (s !== "drag-open" && s !== "dragging") return;
      x = e.clientX;
      y = e.clientY;
      if (s === "drag-open") {
        if (x > widthRef.current) go("dragging", "drag-left-panel");
      } else if (x <= PEEK_EDGE_PX) {
        // dragover repeats while the pointer rests, so the timer starts on time.
        if (openTimer.current === null) {
          openTimer.current = setTimeout(() => go("drag-open", "drag-edge-hover"), PEEK_OPEN_DELAY_MS);
        }
      } else if (openTimer.current !== null) {
        clearTimeout(openTimer.current);
        openTimer.current = null;
      }
    };
    const onDropOrEnd = (e: DragEvent) => {
      const s = stateRef.current;
      if (s !== "drag-open" && s !== "dragging") return;
      const reason = e.type === "drop" ? "drop" : "dragend";
      // A pending edge re-open must not land after the drag is over.
      clearTimers();
      // After the drop target's own handlers have run.
      if (s === "dragging") {
        x = Number.POSITIVE_INFINITY;
        setTimeout(() => {
          if (stateRef.current === "dragging") go("closed", reason);
        }, 0);
      } else {
        setTimeout(() => {
          if (stateRef.current !== "drag-open") return;
          go("open", reason);
          evaluate();
        }, 0);
      }
    };

    const root = document.documentElement;
    document.addEventListener("mousemove", onMove, { passive: true });
    root.addEventListener("mouseleave", onLeaveWindow);
    document.addEventListener("mouseover", onOver, { passive: true });
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("dragend", onDropOrEnd, true);
    document.addEventListener("drop", onDropOrEnd, true);
    return () => {
      document.removeEventListener("mousemove", onMove);
      root.removeEventListener("mouseleave", onLeaveWindow);
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("dragend", onDropOrEnd, true);
      document.removeEventListener("drop", onDropOrEnd, true);
      evaluateRef.current = () => {};
      clearTimers();
    };
  }, [enabled, go, clearTimers, panelRef, toggleRef]);

  return { state, close, edgeStrip: enabled && state === "closed" && overFrame };
}
