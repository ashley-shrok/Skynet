// Swipe-to-list — on a touchscreen's conversation screen, a one-finger swipe
// to the right drags the conversation list in over the conversation (the
// same slide-over as the desktop hover-peek, use-sidebar-peek.ts) and, let go
// far or fast enough, goes back to the list. Let go short and it slides away.
//
//   idle ──(touchstart)──▶ pending ──(moves right, mostly sideways)──▶ dragging
//   pending ──(moves up/down/left first, or a 2nd finger)──▶ idle
//   dragging ──(release past COMMIT_FRACTION or a flick)──▶ settling-in ──▶ onCommit()
//   dragging ──(release short / touchcancel)──▶ settling-out ──▶ idle
//
// The list layer stays mounted under the conversation, parked by CSS
// ([data-swipe-layer="parked"] in index.css). While a swipe is live this hook
// drives the layer's inline transform directly — a React render per
// touchmove would re-render the whole shell — and clears it when done.
//
// A swipe doesn't start on: a text field, a text selection, an open
// dialog/menu, anything marked [data-no-swipe-to-list], anything with
// `touch-action: none` (controls that take their own drags — split dividers,
// image pan/zoom, the hold-to-record mic), or content that can still scroll
// left (a wide code block scrolled right keeps the swipe to
// scroll itself back). Embedded frames (app panes) never pass touches here.

import { useEffect, useRef, type RefObject } from "react";
import { systemLogger } from "@/lib/frontend-logger";
import { PEEK_SLIDE_MS } from "@/shell/use-sidebar-peek";

export const SWIPE_DECIDE_PX = 8;
export const SWIPE_COMMIT_FRACTION = 0.35;
export const SWIPE_FLICK_PX_PER_MS = 0.5;
export const SWIPE_FLICK_MIN_PX = 40;
export const SWIPE_SLIDE_MS = PEEK_SLIDE_MS;
export const SWIPE_SLIDE_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const COMMIT_STUCK_MS = 1500;
// A finger held still this long before lifting isn't a flick.
export const SWIPE_FLICK_MAX_HOLD_MS = 100;

export interface UseSwipeToListOptions {
  /** Touchscreen, conversation screen showing, nothing modal on top. */
  enabled: boolean;
  layerRef: RefObject<HTMLElement | null>;
  /** The swipe completed — switch to the list screen. */
  onCommit: () => void;
}

function blockedStart(target: EventTarget | null): string | null {
  if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"]')) {
    return "dialog-open";
  }
  return swipeBlockedAt(target);
}

/**
 * Why a sideways swipe must not start on `target` (null = it may): a text
 * field, a text selection, an opted-out element, a control with its own drag
 * (`touch-action: none`), or content that can still scroll left. Shared with
 * the windows' swipe-back (components/use-modal-swipe-back.ts).
 */
export function swipeBlockedAt(target: EventTarget | null): string | null {
  const sel = window.getSelection();
  if (sel !== null && !sel.isCollapsed) return "text-selection";
  let el = target instanceof Element ? target : null;
  for (; el !== null && el !== document.documentElement; el = el.parentElement) {
    if (el.hasAttribute("data-no-swipe-to-list")) return "opted-out";
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      return "text-field";
    }
    if (el instanceof HTMLElement && el.isContentEditable) return "text-field";
    const style = getComputedStyle(el);
    if (style.touchAction === "none") return "own-drag";
    if (el.scrollLeft > 0 && el.scrollWidth > el.clientWidth) {
      if (style.overflowX === "auto" || style.overflowX === "scroll") return "scrolled-content";
    }
  }
  return null;
}

/** Whether a released swipe goes through: far enough, or a flick. A flick
 *  back to the left cancels, however far out it is. */
export function swipeCommits(dx: number, width: number, velocity: number): boolean {
  return (
    velocity > -SWIPE_FLICK_PX_PER_MS &&
    (dx >= width * SWIPE_COMMIT_FRACTION || (velocity >= SWIPE_FLICK_PX_PER_MS && dx >= SWIPE_FLICK_MIN_PX))
  );
}

export function useSwipeToList({ enabled, layerRef, onCommit }: UseSwipeToListOptions): void {
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    if (!enabled) return;

    type Phase = "idle" | "pending" | "dragging" | "settling";
    let phase: Phase = "idle";
    let startX = 0;
    let startY = 0;
    let width = 0;
    let dx = 0;
    // Last two samples, for release velocity.
    let lastX = 0;
    let lastT = 0;
    let prevX = 0;
    let prevT = 0;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const setLayer = (offsetPx: number, transitionMs: number) => {
      const layer = layerRef.current;
      if (layer === null) return;
      layer.style.visibility = "visible";
      layer.style.contentVisibility = "visible";
      layer.style.boxShadow = "8px 0 32px rgba(0,0,0,0.55)";
      layer.style.transition = transitionMs > 0 ? `transform ${transitionMs}ms ${SWIPE_SLIDE_EASING}` : "none";
      layer.style.transform = `translateX(${offsetPx - width}px)`;
    };

    const clearLayer = () => {
      const layer = layerRef.current;
      if (layer === null) return;
      for (const p of ["visibility", "content-visibility", "box-shadow", "transition", "transform"]) {
        layer.style.removeProperty(p);
      }
    };

    const onStart = (e: TouchEvent) => {
      if (phase === "settling") return;
      if (e.touches.length !== 1) {
        if (phase === "dragging") release("second-finger", true, e.timeStamp);
        else phase = "idle";
        return;
      }
      const blocked = blockedStart(e.target);
      if (blocked !== null) {
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
        // Undecided moves are never cancelled: cancelling a touch's first
        // move stops the page scrolling for the whole touch, which would
        // freeze a scroll that merely started out leaning right.
        if (Math.hypot(mx, my) < SWIPE_DECIDE_PX) return;
        if (mx <= 0 || Math.abs(my) * 1.5 > mx) {
          phase = "idle";
          return;
        }
        const layer = layerRef.current;
        if (layer === null) {
          phase = "idle";
          return;
        }
        width = layer.getBoundingClientRect().width || window.innerWidth;
        phase = "dragging";
        systemLogger.info("swipe-to-list start", { operation: "swipe_to_list", event: "start", width });
      }
      if (e.cancelable) e.preventDefault();
      dx = Math.max(0, Math.min(width, mx));
      prevX = lastX;
      prevT = lastT;
      lastX = t.clientX;
      lastT = e.timeStamp;
      setLayer(dx, 0);
    };

    const release = (reason: string, forceCancel: boolean, endT: number) => {
      const dt = lastT - prevT;
      // Speed of the last move, unless the finger then rested before lifting.
      const velocity = dt > 0 && endT - lastT <= SWIPE_FLICK_MAX_HOLD_MS ? (lastX - prevX) / dt : 0;
      const commit = !forceCancel && swipeCommits(dx, width, velocity);
      systemLogger.info(`swipe-to-list ${commit ? "commit" : "cancel"}`, {
        operation: "swipe_to_list",
        event: commit ? "commit" : "cancel",
        reason,
        dx: Math.round(dx),
        width: Math.round(width),
        velocity: Math.round(velocity * 1000) / 1000,
      });
      phase = "settling";
      const slideMs = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : SWIPE_SLIDE_MS;
      setLayer(commit ? width : 0, slideMs);
      settleTimer = setTimeout(() => {
        settleTimer = null;
        if (commit) {
          // The layer stays fully in until the screen switches (that turns
          // this hook off, and the cleanup below clears the inline styles).
          // Should the switch never come, don't leave it covering the view.
          onCommitRef.current();
          settleTimer = setTimeout(() => {
            settleTimer = null;
            phase = "idle";
            systemLogger.warn("swipe-to-list: still on the conversation after commit", {
              operation: "swipe_to_list",
              event: "commit-stuck",
            });
            clearLayer();
          }, COMMIT_STUCK_MS);
        } else {
          phase = "idle";
          clearLayer();
        }
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

    document.addEventListener("touchstart", onStart, { passive: true });
    // Not passive: a live swipe must stop the page from scrolling.
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onCancel);
      if (settleTimer !== null) clearTimeout(settleTimer);
      // Disabled (screen switched to the list, a modal opened, …): whatever
      // the layer was doing, it goes back to React/CSS control.
      clearLayer();
    };
  }, [enabled, layerRef]);
}
