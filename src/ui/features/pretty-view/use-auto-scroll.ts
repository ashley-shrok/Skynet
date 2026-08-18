import { useCallback, useEffect, useRef, useState } from "react";

// ============================================================================
// pretty-view auto-scroll — Phase 43 plain-DOM pinned-follow hook.
//
// With TanStack Virtual removed in plan 43-07a, there is no more virtualizer
// writing to scrollTop. The three-actor scroll problem (user scroll /
// virtualizer correction writes / follow-to-bottom heuristics) collapses to
// one: the user. Every scroll event is either a real user scroll or a
// genuine scrollHeight-driven auto-anchor write from overflow-anchor:auto.
// No delta heuristics, no programmatic-write filtering, no rAF chain, no
// size-observer gymnastics.
// Design source: .planning/phases/43-.../43-CONTEXT.md `<decisions>`
// § "Frontend simplifications enabled" + § "Deletion scope". Hook API frozen
// at exactly { scrollRef, scrollToBottomAndFollow, isPinnedToBottom } —
// plan 43-07b composes its own ref locally rather than pulling scrollEl from
// here, so this hook's return surface does NOT grow.
// Behavior: (1) scroll listener sets pinnedRef from dist-from-bottom vs
// BOTTOM_EPSILON; (2) messageCount effect: if pinned, jump to scrollHeight
// (follow-on-new); (3) scrollToBottomAndFollow(): explicit action for the
// jump-to-bottom pill and compose-send path — jumps + re-arms pinned.
// If the user is scrolled up (pinned = false), a new message arriving does
// NOT yank them down — the follow effect's `if (!pinnedRef.current) return`
// gate is the whole guarantee. Load-bearing regression preserved semantically
// from the retired 245-line Phase 32 hook.
// ============================================================================

const BOTTOM_EPSILON = 100; // px — matches Phase 32 BOTTOM_THRESHOLD threshold

export interface UseAutoScrollResult {
  scrollRef: (el: HTMLElement | null) => void;
  scrollToBottomAndFollow: () => void;
  isPinnedToBottom: boolean;
}

export function useAutoScroll(_paneKey: string, messageCount: number): UseAutoScrollResult {
  // Callback-ref → useState (NOT useRef): the state setter re-fires
  // mount-driven useEffects when PrettyView's composed callback ref binds.
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const scrollRef = useCallback((el: HTMLElement | null) => {
    setScrollEl(el);
  }, []);

  const [isPinnedToBottom, setIsPinnedToBottom] = useState<boolean>(true);
  const pinnedRef = useRef<boolean>(true);

  // Scroll listener → pinnedRef. No delta heuristic, no programmatic-write
  // filter — with virt gone, all scroll events reflect real user intent
  // (or overflow-anchor auto writes we don't care to distinguish).
  useEffect(() => {
    if (!scrollEl) return;
    const onScroll = (): void => {
      const dist = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      const pinned = dist <= BOTTOM_EPSILON;
      pinnedRef.current = pinned;
      setIsPinnedToBottom(pinned);
    };
    onScroll(); // seed once so the initial pinned state reflects the real element geometry
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", onScroll);
  }, [scrollEl]);

  // Follow-when-pinned. Fires on mount and whenever messageCount grows.
  // If the user has scrolled up (pinnedRef.current === false), do nothing —
  // this is the "no yank when scrolled up" guarantee.
  useEffect(() => {
    if (!scrollEl) return;
    if (!pinnedRef.current) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }, [scrollEl, messageCount]);

  // Explicit action — jump-to-bottom pill + compose-send caller. Forces
  // pinned state on and jumps regardless of prior scroll position.
  const scrollToBottomAndFollow = useCallback(() => {
    if (!scrollEl) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
    pinnedRef.current = true;
    setIsPinnedToBottom(true);
  }, [scrollEl]);

  return {
    scrollRef,
    scrollToBottomAndFollow,
    isPinnedToBottom,
  };
}
