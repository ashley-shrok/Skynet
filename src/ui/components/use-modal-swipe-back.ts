// Swipe-back in a full-screen window — on a phone, a one-finger swipe to the
// right on a window that fills the screen goes back one level, the same as
// its "‹ back" button; on a window's first level it closes the window, the
// same as its ✕. The window follows the finger; let go short and it springs
// back. Bottom sheets don't take part (they close with a swipe down).
//
// "Back" is found, not registered: the window's visible, enabled element
// marked [data-modal-back] that comes last in the page (an inner back, e.g.
// the Git tab's, sits after the window's own head back and so wins) is
// clicked — so a swipe runs exactly what the button runs, unsaved-changes
// check included. With none, the window is asked to close (onClose); if it
// declines (e.g. it asks about unsaved changes first) the window slides back.
//
// The same no-start rules as the conversation swipe (use-swipe-to-list.ts):
// text fields, a text selection, [data-no-swipe-to-list], controls with
// `touch-action: none`, content still scrolled sideways. Listeners sit on the
// window's own element, so a window stacked on top (a file opened from a
// Files tab) handles its own swipes.

import { useEffect, useRef } from "react";
import { systemLogger } from "@/lib/frontend-logger";
import {
  SWIPE_DECIDE_PX,
  SWIPE_FLICK_MAX_HOLD_MS,
  SWIPE_SLIDE_EASING,
  SWIPE_SLIDE_MS,
  swipeBlockedAt,
  swipeCommits,
} from "@/shell/use-swipe-to-list";

/** How long to wait for a close (or back) to take effect before sliding the
 *  window back in. */
const SETTLE_CHECK_MS = 80;

export interface UseModalSwipeBackOptions {
  /** Phone-width, full-screen window, open. */
  enabled: boolean;
  /** The window's content element. */
  element: HTMLElement | null;
  /** First level: close the window. Absent = this window can't be swiped
   *  closed (e.g. it isn't dismissible). */
  onClose?: () => void;
}

/** The back control a swipe would press, or null for "close the window". */
export function findSwipeBack(root: Element): HTMLElement | null {
  const all = root.querySelectorAll<HTMLElement>("[data-modal-back]");
  for (let i = all.length - 1; i >= 0; i--) {
    const el = all[i];
    if (el.closest("[data-slot='modal-content']") !== root) continue;
    if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") continue;
    if (el.getClientRects().length === 0) continue;
    return el;
  }
  return null;
}

export function useModalSwipeBack({ enabled, element, onClose }: UseModalSwipeBackOptions): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!enabled || element === null) return;
    const root = element;

    type Phase = "idle" | "pending" | "dragging" | "settling";
    let phase: Phase = "idle";
    let startX = 0;
    let startY = 0;
    let width = 0;
    let dx = 0;
    let lastX = 0;
    let lastT = 0;
    let prevX = 0;
    let prevT = 0;
    let target: HTMLElement | null = null;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const id = setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };

    const setOffset = (px: number, transitionMs: number) => {
      root.style.transition = transitionMs > 0 ? `transform ${transitionMs}ms ${SWIPE_SLIDE_EASING}` : "none";
      root.style.transform = px > 0 ? `translateX(${px}px)` : "";
    };
    const clearOffset = () => {
      root.style.removeProperty("transition");
      root.style.removeProperty("transform");
      root.style.removeProperty("--tw-exit-translate-x");
    };

    const onStart = (e: TouchEvent) => {
      if (phase === "settling") return;
      if (e.touches.length !== 1) {
        if (phase === "dragging") release("second-finger", true, e.timeStamp);
        else phase = "idle";
        return;
      }
      if (document.querySelector('[role="menu"][data-state="open"]') || swipeBlockedAt(e.target) !== null) {
        phase = "idle";
        return;
      }
      const t = e.touches[0];
      phase = "pending";
      startX = lastX = prevX = t.clientX;
      startY = t.clientY;
      lastT = prevT = e.timeStamp;
      dx = 0;
    };

    const onMove = (e: TouchEvent) => {
      if (phase !== "pending" && phase !== "dragging") return;
      if (e.touches.length !== 1) {
        if (phase === "dragging") release("second-finger", true, e.timeStamp);
        else phase = "idle";
        return;
      }
      const t = e.touches[0];
      const mx = t.clientX - startX;
      const my = t.clientY - startY;
      if (phase === "pending") {
        // Undecided moves are never cancelled (see use-swipe-to-list.ts).
        if (Math.hypot(mx, my) < SWIPE_DECIDE_PX) return;
        if (mx <= 0 || Math.abs(my) * 1.5 > mx) {
          phase = "idle";
          return;
        }
        target = findSwipeBack(root);
        if (target === null && onCloseRef.current === undefined) {
          phase = "idle";
          return;
        }
        width = root.getBoundingClientRect().width || window.innerWidth;
        phase = "dragging";
        systemLogger.info("modal swipe-back start", {
          operation: "modal_swipe_back",
          event: "start",
          action: target ? "back" : "close",
          backTestId: target?.dataset.testid ?? null,
          width: Math.round(width),
        });
      }
      if (e.cancelable) e.preventDefault();
      dx = Math.max(0, Math.min(width, mx));
      prevX = lastX;
      prevT = lastT;
      lastX = t.clientX;
      lastT = e.timeStamp;
      setOffset(dx, 0);
    };

    const release = (reason: string, forceCancel: boolean, endT: number) => {
      const dt = lastT - prevT;
      const velocity = dt > 0 && endT - lastT <= SWIPE_FLICK_MAX_HOLD_MS ? (lastX - prevX) / dt : 0;
      const commit = !forceCancel && swipeCommits(dx, width, velocity);
      const action = target ? "back" : "close";
      systemLogger.info(`modal swipe-back ${commit ? "commit" : "cancel"}`, {
        operation: "modal_swipe_back",
        event: commit ? "commit" : "cancel",
        action,
        reason,
        dx: Math.round(dx),
        width: Math.round(width),
        velocity: Math.round(velocity * 1000) / 1000,
      });
      phase = "settling";
      const slideMs = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : SWIPE_SLIDE_MS;
      if (!commit) {
        setOffset(0, slideMs);
        later(() => {
          phase = "idle";
          clearOffset();
        }, slideMs);
        return;
      }
      setOffset(width, slideMs);
      const back = target;
      later(() => {
        if (back !== null) {
          // The level above takes the window's place where it stands.
          back.click();
          clearOffset();
          phase = "idle";
          return;
        }
        // The window's closing animation runs from where it stands; keep it
        // off screen rather than let it drift back to the middle.
        root.style.setProperty("--tw-exit-translate-x", `${width}px`);
        onCloseRef.current?.();
        // Still open (the window declined, or is asking first): bring it back.
        later(() => {
          if (root.isConnected) setOffset(0, slideMs);
          later(() => {
            phase = "idle";
            if (root.isConnected) clearOffset();
          }, slideMs);
        }, SETTLE_CHECK_MS);
      }, slideMs);
    };

    const onEnd = (e: TouchEvent) => {
      if (phase === "dragging") release("touchend", false, e.timeStamp);
      else if (phase === "pending") phase = "idle";
    };
    const onCancel = (e: TouchEvent) => {
      if (phase === "dragging") release("touchcancel", true, e.timeStamp);
      else if (phase === "pending") phase = "idle";
    };

    root.addEventListener("touchstart", onStart, { passive: true });
    // Not passive: a live swipe must stop the window's content scrolling.
    root.addEventListener("touchmove", onMove, { passive: false });
    root.addEventListener("touchend", onEnd, { passive: true });
    root.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", onCancel);
      for (const id of timers) clearTimeout(id);
      clearOffset();
    };
  }, [enabled, element]);
}
