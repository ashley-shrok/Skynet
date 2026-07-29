import { useCallback, useEffect, useRef, useState } from "react";

// ============================================================================
// pretty-view scroll model — follow-bottom-when-near-bottom (Phase-01 contract)
// Patch #185 — reverts the clamp-anchor state machine added by patches #96/#98.
// See ROADMAP.md:59 for the Phase-01 scroll contract.
//
// Behavior:
//   - Single internal state: followBottomRef (bool) + isPinnedToBottom (React state).
//   - When user is scrolled to within BOTTOM_THRESHOLD of bottom → pinned.
//   - When pinned, ResizeObserver fires on content growth → scrollTop = scrollHeight.
//   - When scrolled up, ResizeObserver fires but leaves scrollTop alone.
//   - scrollToBottomAndFollow: sets pinned=true, jumps to bottom.
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

/** Returns the scrollTop value that places the very last pixel of content at viewport bottom. */
export function computeFollowBottomTop(scrollEl: HTMLElement): number {
  return Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
}

export function useAutoScroll(): {
  scrollRef: (el: HTMLElement | null) => void;
  contentRef: (el: HTMLElement | null) => void;
  scrollToBottomAndFollow: () => void;
  isPinnedToBottom: boolean;
} {
  // --- element refs (callback-ref pattern so effects re-attach on swap) ---
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLElement | null>(null);

  // --- internal state refs (useRef so values survive re-renders without triggering them) ---
  const followBottomRef = useRef<boolean>(true);

  // --- React state (only for pill re-render) ---
  const [isPinnedToBottom, setIsPinnedToBottom] = useState<boolean>(true);

  // --- callback refs ---
  const scrollRef = useCallback((el: HTMLElement | null) => {
    setScrollEl(el);
  }, []);

  const contentRef = useCallback((el: HTMLElement | null) => {
    setContentEl(el);
  }, []);

  // --- shared helper: recompute pinned-ness from current scroll geometry ---
  function syncPinned(el: HTMLElement): void {
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const pinned = distFromBottom <= BOTTOM_THRESHOLD;
    followBottomRef.current = pinned;
    setIsPinnedToBottom(pinned);
  }

  // --- exported action: jump-to-latest ---
  const scrollToBottomAndFollow = useCallback(() => {
    followBottomRef.current = true;
    setIsPinnedToBottom(true);
    if (scrollEl) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollEl]);

  // --- effect 1: scroll event → sync isPinnedToBottom + followBottomRef ---
  useEffect(() => {
    if (!scrollEl) return;
    const handleScroll = () => {
      syncPinned(scrollEl);
    };
    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", handleScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollEl]);

  // --- effect 1b: user gesture listeners → recompute pinned-ness ---
  useEffect(() => {
    if (!scrollEl) return;

    const handleUserGesture = () => {
      syncPinned(scrollEl);
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

  // --- effect 2: ResizeObserver → follow bottom or hold position ---
  useEffect(() => {
    if (!scrollEl || !contentEl) return;
    const ro = new ResizeObserver(() => {
      if (followBottomRef.current) {
        scrollEl.scrollTop = scrollEl.scrollHeight;
      }
      // Always recompute pill visibility — content growth changes distFromBottom
      // even when scrollTop didn't move (held position case).
      syncPinned(scrollEl);
    });
    ro.observe(contentEl);
    ro.observe(scrollEl);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollEl, contentEl]);

  return {
    scrollRef,
    contentRef,
    scrollToBottomAndFollow,
    isPinnedToBottom,
  };
}
