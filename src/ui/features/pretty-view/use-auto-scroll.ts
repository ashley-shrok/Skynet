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
//
// URL-param-gated sticky-bottom variant (?scroll=stick) — WIP overhaul for
// bounty #4 conversations-scroll-to-bottom-on-load. When present, useAutoScroll
// dispatches to useStickyBottomScroll (below) which guarantees:
//   1. Fresh conversation load ALWAYS lands at bottom (rAF-chain jump for
//      ~200ms after paneKey changes; defeats image-load / batched-WS-backfill
//      races that leave the current default hook stranded above last message).
//   2. Sticky bottom persists through user sends AND incoming replies — no
//      prior-message anchoring; browser scroll-anchoring suppressed via
//      overflow-anchor: none on the scroll container.
//   3. Only real scroll-up gestures (wheel up, keyboard PgUp/Home/ArrowUp,
//      touchmove that actually reduces scrollTop) leave sticky mode.
//   4. Send-message intent (via forceStickAndJump) always re-enters sticky
//      regardless of prior scroll position.
// ============================================================================

const BOTTOM_THRESHOLD = 100; // px — matches prototype line 149

// URL-param gate for the sticky-bottom variant. Read once at module load
// (URL doesn't change without page reload). Absent → current default hook.
// ?scroll=stick → new sticky-bottom model.
function readScrollVariant(): "default" | "stick" {
  if (typeof window === "undefined") return "default";
  try {
    // Check both ?scroll=stick (query) and #scroll=stick (hash) — Skynet's SPA
    // uses hash-based routing in some paths (mobile-flow.ts, tab-url.ts) and
    // may rewrite the query part on internal navigation. Reading both means
    // the variant survives whichever URL surface the reload lands on.
    const q = new URLSearchParams(window.location.search).get("scroll");
    if (q === "stick") return "stick";
    const h = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("scroll");
    if (h === "stick") return "stick";
    return "default";
  } catch {
    return "default";
  }
}
const SCROLL_VARIANT = readScrollVariant();

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

export interface UseAutoScrollResult {
  scrollRef: (el: HTMLElement | null) => void;
  contentRef: (el: HTMLElement | null) => void;
  scrollToBottomAndFollow: () => void;
  forceStickAndJump: () => void;
  isPinnedToBottom: boolean;
}

// Dispatcher — picks the variant based on the URL param read once at module load.
// Callers pass paneKey so the sticky-bottom variant can reset on conversation swap;
// the default variant ignores it (behavior unchanged).
export function useAutoScroll(paneKey?: string): UseAutoScrollResult {
  if (SCROLL_VARIANT === "stick") {
    // Hook order is stable across a session because SCROLL_VARIANT is module-scope const
    // (read once from URL at load) — safe to conditionally call.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useStickyBottomScroll(paneKey);
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useDefaultAutoScroll();
}

function useDefaultAutoScroll(): UseAutoScrollResult {
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
    // In the default model, "force stick + jump" is exactly the same operation
    // as the pill's jump-to-latest — expose the same fn under both names so
    // callers written for the sticky variant work unmodified here.
    forceStickAndJump: scrollToBottomAndFollow,
    isPinnedToBottom,
  };
}

// ============================================================================
// Sticky-bottom variant (?scroll=stick) — overhaul for bounty #4.
//
// Model:
//   - One axis: stickToBottomRef (bool). Default true.
//   - Content grows (RO) → if stick, scrollTop = scrollHeight. No anchoring.
//   - Pane change (paneKey diff) → force stick=true + rAF-chain jump for
//     ~200ms, absorbing image-load / batched-WS-backfill layout settle.
//   - Exit sticky ONLY on real scroll-up gestures:
//       wheel with deltaY < 0 (and container actually moved up)
//       keydown PageUp/ArrowUp/Home
//       touchmove that reduces scrollTop from previous tick
//     Passive touchmove from tap-then-scroll-list finger travel (which does
//     NOT reduce scrollTop) is filtered out — this is the fix for "opening
//     a conversation and immediately being scrolled up on mobile".
//   - overflow-anchor: none on scrollEl — defeats browser scroll-anchoring
//     that pins to old messages as new content appears above the viewport.
//   - forceStickAndJump(): re-enter sticky + jump. Called by PrettyView's
//     send-message wrapper so a fresh send always sees the reply arrive
//     at the bottom, regardless of prior scroll position.
// ============================================================================

const LOAD_LOCK_MS = 300; // rAF-chain duration after paneKey change

function useStickyBottomScroll(paneKey?: string): UseAutoScrollResult {
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLElement | null>(null);

  const stickToBottomRef = useRef<boolean>(true);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState<boolean>(true);

  // Load-lock: ignore user-gesture-driven un-stick for LOAD_LOCK_MS after a
  // paneKey change, so a residual mobile touchmove from the row-tap gesture
  // can't strand us above the last message during backfill.
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
