import { useCallback, useEffect, useRef, useState } from "react";

// ============================================================================
// pretty-view scroll model — sticky-bottom (sole variant).
//
// Model:
//   - One axis: stickToBottomRef (bool). Default true.
//   - Content grows (ResizeObserver) → if sticky, scrollTop = scrollHeight.
//     No prior-message anchoring; browser scroll-anchoring is suppressed via
//     overflow-anchor: none applied inline on the scroll container while the
//     hook is mounted (prior value is restored on unmount).
//   - Pane change (paneKey diff) → force stick = true + rAF-chain jump for
//     LOAD_LOCK_MS, absorbing image-load / batched-WS-backfill layout settle
//     so a fresh conversation load always lands at the bottom.
//   - Exit sticky ONLY on real scroll-up gestures:
//       * wheel with deltaY < 0
//       * keydown PageUp / ArrowUp / Home
//       * touchmove that reduces scrollTop from previous tick by > 2px
//     Passive touchmove from tap-then-scroll-list finger travel (which does
//     NOT reduce scrollTop) is filtered out — this is the fix for "opening
//     a conversation and immediately being scrolled up on mobile".
//   - forceStickAndJump(): re-enter sticky + jump + re-arm the load-lock for
//     LOAD_LOCK_MS. PrettyView's handleComposeSend calls this on every send
//     so a fresh reply is guaranteed to land at the bottom regardless of
//     prior scroll position.
//   - scrollToBottomAndFollow(): re-enter sticky + jump WITHOUT arming the
//     load-lock. The jump-to-latest pill uses this — user intent is only
//     "go to the bottom right now", not "protect that stickiness across
//     a follow-up load".
// ============================================================================

const BOTTOM_THRESHOLD = 100; // px
const LOAD_LOCK_MS = 300; // rAF-chain duration after paneKey change / send

export interface UseAutoScrollResult {
  scrollRef: (el: HTMLElement | null) => void;
  contentRef: (el: HTMLElement | null) => void;
  scrollToBottomAndFollow: () => void;
  forceStickAndJump: () => void;
  isPinnedToBottom: boolean;
}

export function useAutoScroll(paneKey?: string): UseAutoScrollResult {
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLElement | null>(null);

  const stickToBottomRef = useRef<boolean>(true);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState<boolean>(true);

  // Load-lock: ignore user-gesture-driven un-stick for LOAD_LOCK_MS after a
  // paneKey change or a send, so a residual mobile touchmove from the row-tap
  // gesture can't strand us above the last message during backfill.
  const loadLockUntilRef = useRef<number>(0);

  // Track scrollTop across touchmove ticks so we can distinguish "user pulled
  // content down" (real scroll-up gesture → exit sticky) from "container
  // didn't actually move" (passive gesture → ignore).
  const lastScrollTopRef = useRef<number>(0);

  const scrollRef = useCallback((el: HTMLElement | null) => {
    setScrollEl(el);
  }, []);
  const contentRef = useCallback((el: HTMLElement | null) => {
    setContentEl(el);
  }, []);

  const jumpToBottom = useCallback((el: HTMLElement) => {
    el.scrollTop = el.scrollHeight;
    lastScrollTopRef.current = el.scrollTop;
  }, []);

  const enterStick = useCallback(() => {
    stickToBottomRef.current = true;
    setIsPinnedToBottom(true);
  }, []);

  const exitStick = useCallback(() => {
    stickToBottomRef.current = false;
    setIsPinnedToBottom(false);
  }, []);

  const scrollToBottomAndFollow = useCallback(() => {
    enterStick();
    if (scrollEl) jumpToBottom(scrollEl);
  }, [scrollEl, enterStick, jumpToBottom]);

  const forceStickAndJump = useCallback(() => {
    // Send-intent signal — arm the load-lock briefly too so a reply that
    // arrives with images / async content can't be un-stuck by a stray gesture.
    loadLockUntilRef.current = Date.now() + LOAD_LOCK_MS;
    enterStick();
    if (scrollEl) jumpToBottom(scrollEl);
  }, [scrollEl, enterStick, jumpToBottom]);

  // Apply overflow-anchor: none inline on the scroll container so the browser
  // doesn't fight our scrollTop writes when content grows above the viewport.
  useEffect(() => {
    if (!scrollEl) return;
    const prev = scrollEl.style.overflowAnchor;
    scrollEl.style.overflowAnchor = "none";
    return () => {
      scrollEl.style.overflowAnchor = prev;
    };
  }, [scrollEl]);

  // Pane change → force stick + rAF-chain jump for LOAD_LOCK_MS so image loads,
  // batched WS backfill, and layout settle can't leave us stranded.
  useEffect(() => {
    if (!scrollEl) return;
    enterStick();
    loadLockUntilRef.current = Date.now() + LOAD_LOCK_MS;
    let cancelled = false;
    const start = Date.now();
    const tick = () => {
      if (cancelled || !scrollEl) return;
      if (stickToBottomRef.current) {
        jumpToBottom(scrollEl);
      }
      if (Date.now() - start < LOAD_LOCK_MS) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, [scrollEl, paneKey, enterStick, jumpToBottom]);

  // ResizeObserver → if sticky, jump to bottom on every content growth.
  // Also recomputes pill visibility (distance-from-bottom check for the
  // pill state, NOT for stickiness — stickiness only changes on gesture).
  useEffect(() => {
    if (!scrollEl || !contentEl) return;
    const ro = new ResizeObserver(() => {
      if (stickToBottomRef.current) {
        jumpToBottom(scrollEl);
        // Keep pill hidden while sticky.
        if (!isPinnedToBottom) setIsPinnedToBottom(true);
      } else {
        // Recompute pill visibility from geometry — content grew but user is
        // scrolled up, so distFromBottom likely increased.
        const dist = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
        setIsPinnedToBottom(dist <= BOTTOM_THRESHOLD);
      }
    });
    ro.observe(contentEl);
    ro.observe(scrollEl);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollEl, contentEl, jumpToBottom]);

  // User-gesture listeners — only real scroll-up motion exits sticky.
  useEffect(() => {
    if (!scrollEl) return;

    const gestureIsLocked = () => Date.now() < loadLockUntilRef.current;

    const handleWheel = (e: WheelEvent) => {
      if (gestureIsLocked()) return;
      // deltaY < 0 = scrolling up (content moves down). Exit sticky.
      if (e.deltaY < 0) exitStick();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (gestureIsLocked()) return;
      if (e.key === "PageUp" || e.key === "ArrowUp" || e.key === "Home") {
        exitStick();
      }
    };

    const handleTouchMove = () => {
      if (gestureIsLocked()) return;
      // touchmove doesn't have a delta — compare scrollTop to last known.
      // If scrollTop decreased (moved up), user is actively scrolling up.
      const now = scrollEl.scrollTop;
      const prev = lastScrollTopRef.current;
      if (now < prev - 2) {
        exitStick();
      }
      lastScrollTopRef.current = now;
    };

    // Scroll event — keep pill state in sync as user drags scrollbar or
    // momentum-scrolls, AND detect scrolling back into the bottom threshold
    // (re-enter sticky if user landed at the bottom without hitting the pill).
    const handleScroll = () => {
      const dist = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      const atBottom = dist <= BOTTOM_THRESHOLD;
      // If user scrolled back to bottom on their own, re-enter sticky.
      if (atBottom && !stickToBottomRef.current) enterStick();
      // Keep pill visibility in sync with current geometry (even when sticky
      // is unchanged — momentum scroll past the threshold).
      setIsPinnedToBottom(atBottom);
      lastScrollTopRef.current = scrollEl.scrollTop;
    };

    scrollEl.addEventListener("wheel", handleWheel, { passive: true });
    scrollEl.addEventListener("touchmove", handleTouchMove, { passive: true });
    scrollEl.addEventListener("keydown", handleKeyDown, { passive: true });
    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scrollEl.removeEventListener("wheel", handleWheel);
      scrollEl.removeEventListener("touchmove", handleTouchMove);
      scrollEl.removeEventListener("keydown", handleKeyDown);
      scrollEl.removeEventListener("scroll", handleScroll);
    };
  }, [scrollEl, exitStick, enterStick]);

  return {
    scrollRef,
    contentRef,
    scrollToBottomAndFollow,
    forceStickAndJump,
    isPinnedToBottom,
  };
}
