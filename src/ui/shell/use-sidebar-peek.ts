// Sidebar hover-peek — while the desktop sidebar is collapsed, resting the
// mouse on the window's left edge slides the sidebar out OVER the panes (the
// split layout never reflows), so a row can be dragged into the split view
// without opening the sidebar for real.
//
//   closed ──(mouse at left edge for OPEN_DELAY)──▶ open
//   open ──(mouse away for CLOSE_DELAY, nothing holding it)──▶ closing ──(SLIDE)──▶ closed
//   open ──(close(): a conversation/app opened from it)──▶ closing
//   open ──(a conversation row / app tile drag starts in it)──▶ dragging ──(drag over)──▶ closed
//
// "dragging" slides the panel off-screen but keeps it mounted — removing a
// drag source inside dragstart cancels the drag. A drop can re-render the
// source row so its dragend never reaches the document; since no mousemove
// fires during an HTML5 drag, the first mousemove afterwards also ends it.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { systemLogger } from "@/lib/frontend-logger";

export const PEEK_EDGE_PX = 6;
export const PEEK_OPEN_DELAY_MS = 200;
export const PEEK_CLOSE_DELAY_MS = 350;
export const PEEK_SLIDE_MS = 180;

// Drags that open into a pane. Project-header drags stay in the sidebar, so
// they keep the peek open.
const PANE_DRAG_MIMES = ["application/x-skynet-row", "application/x-skynet-app-tile"];

export type SidebarPeekState = "closed" | "open" | "closing" | "dragging";

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
  const stateRef = useRef<SidebarPeekState>("closed");
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;

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
      if (next === "closing") {
        slideTimer.current = setTimeout(() => go("closed", "slide-done"), PEEK_SLIDE_MS);
      }
    },
    [clearTimers],
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
      if (s === "closed" || s === "closing") {
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

    const onMove = (e: MouseEvent) => {
      x = e.clientX;
      y = e.clientY;
      if (stateRef.current === "dragging") go("closed", "drag-over-mousemove");
      evaluate();
    };
    const onLeaveWindow = () => {
      x = Number.POSITIVE_INFINITY;
      evaluate();
    };
    // Bubble phase: the row's own dragstart has already set its MIME types.
    const onDragStart = (e: DragEvent) => {
      if (stateRef.current !== "open") return;
      const target = e.target instanceof Node ? e.target : null;
      if (target === null || !panelRef.current?.contains(target)) return;
      const types = Array.from(e.dataTransfer?.types ?? []);
      if (!PANE_DRAG_MIMES.some((m) => types.includes(m))) return;
      requestAnimationFrame(() => {
        if (stateRef.current === "open") go("dragging", "pane-drag-start");
      });
    };
    const onDropOrEnd = (e: DragEvent) => {
      if (stateRef.current !== "dragging") return;
      x = Number.POSITIVE_INFINITY;
      // After the drop target's own handlers have run.
      setTimeout(() => {
        if (stateRef.current === "dragging") go("closed", e.type === "drop" ? "drop" : "dragend");
      }, 0);
    };

    const root = document.documentElement;
    document.addEventListener("mousemove", onMove, { passive: true });
    root.addEventListener("mouseleave", onLeaveWindow);
    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("dragend", onDropOrEnd, true);
    document.addEventListener("drop", onDropOrEnd, true);
    return () => {
      document.removeEventListener("mousemove", onMove);
      root.removeEventListener("mouseleave", onLeaveWindow);
      document.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("dragend", onDropOrEnd, true);
      document.removeEventListener("drop", onDropOrEnd, true);
      clearTimers();
    };
  }, [enabled, go, clearTimers, panelRef, toggleRef]);

  return { state, close };
}
