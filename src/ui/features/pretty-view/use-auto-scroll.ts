import { useCallback, useEffect, useRef, useState } from "react";

// ============================================================================
// pretty-view scroll model — clamp-anchor + Slack-follow state machine
// Patch #96 — replaces patch #88's "scroll to top of tall message" one-shot.
// Patch #98 — user-gesture detection (wheel / touchmove / keydown-scroll-keys)
//             replaces the scroll-event-based mode-flip counter from patch #96.
//
// Rationale (patch #98): browser scroll events can arrive 200ms+ after a
// programmatic scrollTop write. Direct user-input events cannot be delayed by
// our own writes, so they are the reliable signal for user-vs-programmatic mode.
//
// State machine:
//   mode: 'clamp' | 'user-driving'
//   followBottom: bool  (only meaningful while mode === 'user-driving')
//   anchor: HTMLElement | null  (the current user message DOM node)
//
// The core clamp rule (unified follow-bottom + anchor ceiling):
//   scrollTop = min(followBottomTop, anchorPinTop)
//   - followBottomTop = scrollHeight - clientHeight  (scroll such that latest
//     content sits at the bottom of the viewport)
//   - anchorPinTop    = anchor's absolute offset inside scroll content
//     (scroll such that anchor sits at the TOP of the viewport)
//   Early in a turn, followBottomTop < anchorPinTop → we follow bottom
//   (content is short, everything fits, view scrolls to keep tail visible).
//   Once content grows past a full viewport below anchor, followBottomTop
//   crosses anchorPinTop → view stops at anchorPinTop (ceiling), further
//   content lands BELOW the fold and the anchor never scrolls off the top.
//
// on new user message (anchor key changes):
//   mode = 'clamp', followBottom = false
//   apply the clamp rule on the next rAF (DOM must have committed anchor ref)
//
// content growth (ResizeObserver on contentEl + scrollEl):
//   if mode === 'clamp':                 apply clamp rule
//   if mode === 'user-driving' && followBottom: scroll to bottom (no ceiling)
//   else:                                do nothing (leave user's view alone)
//
// user gesture (wheel / touchmove / scroll-key keydown):
//   mode = 'user-driving'
//   followBottom = (distFromBottom <= BOTTOM_THRESHOLD)
//
// good-to-go / jump-to-latest (scrollToBottomAndFollow):
//   mode = 'user-driving', followBottom = true, jump to bottom
//   (explicit opt-in to "no ceiling; show me the latest")
//
// doProgScroll:
//   bare scrollTop write — no counter, no rAF dance. Mode flip is now driven
//   by user-input events (wheel/touchmove/keydown), so delayed scroll events
//   from our own writes are harmless.
// ============================================================================

const BOTTOM_THRESHOLD = 100; // px — matches prototype line 149

// Scroll keys that indicate the user intends to scroll the container.
const SCROLL_KEYS: readonly string[] = [
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  " ",
];

// Pure helpers — accept element args so they're testable without the full hook.

/** Returns the scrollTop value that places anchorEl at the top of scrollEl's visible area. */
export function computeAnchorPinTop(
  anchorEl: HTMLElement,
  scrollEl: HTMLElement,
): number {
  return (
    anchorEl.getBoundingClientRect().top -
    scrollEl.getBoundingClientRect().top +
    scrollEl.scrollTop
  );
}

/** Returns the scrollTop value that places the very last pixel of content at viewport bottom. */
export function computeFollowBottomTop(scrollEl: HTMLElement): number {
  return Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
}

/** Computes the clamp-rule target without mutating anything. Returns null when anchor is absent. */
export function computeClampTarget(
  anchorEl: HTMLElement,
  scrollEl: HTMLElement,
): number | null {
  const fbt = computeFollowBottomTop(scrollEl);
  const apt = computeAnchorPinTop(anchorEl, scrollEl);
  return Math.min(fbt, apt);
}

// Minimal structural type for the messages array. Only role + eventId are
// needed; this avoids importing the full StreamEvent union from PrettyView
// and keeps the hook self-contained.
export interface AnchorMessage {
  type?: string;
  role?: string;
  eventId: string;
}

export function useAutoScroll(messages: readonly AnchorMessage[]): {
  scrollRef: (el: HTMLElement | null) => void;
  contentRef: (el: HTMLElement | null) => void;
  anchorRefCallback: (el: HTMLElement | null) => void;
  scrollToBottomAndFollow: () => void;
  isPinnedToBottom: boolean;
} {
  // --- element refs (callback-ref pattern so effects re-attach on swap) ---
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLElement | null>(null);

  // --- state machine refs (useRef so values survive re-renders without triggering them) ---
  const modeRef = useRef<"clamp" | "user-driving">("clamp");
  const followBottomRef = useRef<boolean>(false);
  const anchorElRef = useRef<HTMLElement | null>(null);
  // Tracks which user-message eventId the current anchor represents.
  // When the derived last-user-role eventId differs from this ref,
  // a new turn has started → reset mode + apply clamp.
  const anchorEventIdRef = useRef<string | null>(null);

  // --- React state (only for pill re-render) ---
  const [isPinnedToBottom, setIsPinnedToBottom] = useState<boolean>(true);

  // --- callback refs ---
  const scrollRef = useCallback((el: HTMLElement | null) => {
    setScrollEl(el);
  }, []);

  const contentRef = useCallback((el: HTMLElement | null) => {
    setContentEl(el);
  }, []);

  const anchorRefCallback = useCallback((el: HTMLElement | null) => {
    anchorElRef.current = el;
  }, []);

  // --- internal helpers (closures — depend on scrollEl/anchorElRef at call time) ---

  function doProgScroll(newTop: number): void {
    if (!scrollEl) return;
    scrollEl.scrollTop = newTop;
  }

  function applyClampRule(): void {
    if (!scrollEl || !anchorElRef.current) return;
    const fbt = computeFollowBottomTop(scrollEl);
    const apt = computeAnchorPinTop(anchorElRef.current, scrollEl);
    const target = Math.min(fbt, apt);
    if (Math.abs(target - scrollEl.scrollTop) > 0.5) {
      doProgScroll(target);
    }
  }

  function scrollToBottom(): void {
    if (!scrollEl) return;
    doProgScroll(scrollEl.scrollHeight);
  }

  // --- exported action: GTG / jump-to-latest ---
  const scrollToBottomAndFollow = useCallback(() => {
    modeRef.current = "user-driving";
    followBottomRef.current = true;
    setIsPinnedToBottom(true);
    scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollEl]);

  // --- effect 1: scroll event → sync isPinnedToBottom + followBottomRef (NO mode flip) ---
  useEffect(() => {
    if (!scrollEl) return;
    const handleScroll = () => {
      const distFromBottom =
        scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      const nb = distFromBottom <= BOTTOM_THRESHOLD;
      // Update followBottom only when already user-driving (gesture listeners set mode).
      if (modeRef.current === "user-driving") {
        followBottomRef.current = nb;
      }
      // Always keep the jump-pill in sync with current scroll position.
      setIsPinnedToBottom(nb);
    };
    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", handleScroll);
  }, [scrollEl]);

  // --- effect 1b: user gesture listeners → mode flip + followBottom update ---
  useEffect(() => {
    if (!scrollEl) return;

    const handleUserGesture = () => {
      // Flip mode from clamp → user-driving on any direct user input.
      modeRef.current = "user-driving";
      // Recompute followBottom from current scroll position regardless of prior mode.
      const distFromBottom =
        scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      const nb = distFromBottom <= BOTTOM_THRESHOLD;
      followBottomRef.current = nb;
      setIsPinnedToBottom(nb);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (SCROLL_KEYS.includes(e.key)) {
        handleUserGesture();
      }
    };

    scrollEl.addEventListener("wheel", handleUserGesture, { passive: true });
    scrollEl.addEventListener("touchmove", handleUserGesture, { passive: true });
    scrollEl.addEventListener("keydown", handleKeyDown, { passive: true });
    return () => {
      scrollEl.removeEventListener("wheel", handleUserGesture);
      scrollEl.removeEventListener("touchmove", handleUserGesture);
      scrollEl.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollEl]);

  // --- effect 2: ResizeObserver → dispatch clamp or follow-bottom ---
  useEffect(() => {
    if (!scrollEl || !contentEl) return;
    const ro = new ResizeObserver(() => {
      if (modeRef.current === "clamp") {
        applyClampRule();
      } else if (followBottomRef.current) {
        scrollToBottom();
      }
      // Recompute pill visibility. In clamp mode with the anchor at the
      // ceiling, applyClampRule short-circuits (target === scrollTop) so no
      // scroll event fires as content grows — effect 1's handler wouldn't
      // otherwise notice that scrollHeight has moved past scrollTop +
      // clientHeight and the pill would stay hidden.
      const distFromBottom =
        scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      setIsPinnedToBottom(distFromBottom <= BOTTOM_THRESHOLD);
    });
    ro.observe(contentEl);
    ro.observe(scrollEl);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollEl, contentEl]);

  // --- effect 3: anchor key change → reset mode + apply clamp rule ---
  useEffect(() => {
    // Derive last user-role eventId by scanning back-to-front.
    let lastUserEventId: string | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.type === "message" && m.role === "user") {
        lastUserEventId = m.eventId;
        break;
      }
    }

    if (lastUserEventId === null) return; // no user messages yet

    if (lastUserEventId === anchorEventIdRef.current) return; // same turn, no reset needed

    // New turn: update the tracked eventId, reset mode.
    anchorEventIdRef.current = lastUserEventId;
    modeRef.current = "clamp";
    followBottomRef.current = false;
    setIsPinnedToBottom(false);

    // Schedule applyClampRule via rAF so DOM has committed the new anchor ref
    // (anchorRefCallback fires at React commit time, which precedes rAF).
    requestAnimationFrame(() => {
      applyClampRule();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, scrollEl]);

  return {
    scrollRef,
    contentRef,
    anchorRefCallback,
    scrollToBottomAndFollow,
    isPinnedToBottom,
  };
}
