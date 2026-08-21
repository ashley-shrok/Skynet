import { useCallback, useEffect, useRef, useState } from "react";

// ============================================================================
// pretty-view auto-scroll — plain-DOM pinned-follow hook.
//
// Phase 43 (2026-08) removed TanStack Virtual and simplified to a scroll-
// listener + messageCount follow-effect. That simplification undershot in
// three ways diagnosed 2026-08-21 (tina):
//
//   (1) Accessory mount/unmount (WipBubble, WaitingBubble, PlanPendingBubble,
//       DormancyOverlay, AsideBubble) doesn't bump messageCount, so the
//       follow effect didn't re-fire → the accessory pushed scrollHeight past
//       the viewport and the user drifted above the true bottom.
//   (2) Content growth AFTER a message's initial render (streaming assistant
//       tokens, markdown re-render, code-block highlight, image decode) also
//       didn't re-fire the follow effect → same drift.
//   (3) The seed onScroll() ran at mount and could compute pinned=false from
//       pre-populated DOM geometry (fast re-mount, warm cache) → the follow
//       effect then skipped its mount fire → the user landed above the
//       bottom on session enter. Compounded by the `paneKey` param being
//       accepted but never used, so `pinnedRef` from the prior conversation
//       leaked into a new pane on identity-swap re-render.
//
// The rewrite:
//   • ResizeObserver-on-children + MutationObserver on the scroll container
//     re-anchor when children grow or mount/unmount (fixes 1 + 2). Children
//     are observed dynamically: the MO watches childList so newly-mounted
//     accessories join the RO's observation set, and the RO fires on any
//     observed child's border-box growth (which covers streaming and image
//     decode because a bubble's height grows with its content). A single
//     RAF coalesces multi-mutation frames into one scrollHeight write.
//   • paneKey is now USED. An effect on [scrollEl, paneKey] resets pinned
//     to true and jumps to the current scrollHeight — this owns "initial
//     mount" AND "pane switch on the same PrettyView instance" cases.
//     Removes the fragile seed onScroll (fix 3).
//   • The no-yank-when-scrolled-up invariant (Test 5) is preserved: every
//     write is gated on `pinnedRef.current === true`.
//
// Hook return API is FROZEN — { scrollRef, scrollToBottomAndFollow,
// isPinnedToBottom }. Callers in PrettyView.tsx unchanged.
// ============================================================================

const BOTTOM_EPSILON = 100; // px — matches Phase 32 BOTTOM_THRESHOLD threshold

export interface UseAutoScrollResult {
  scrollRef: (el: HTMLElement | null) => void;
  scrollToBottomAndFollow: () => void;
  isPinnedToBottom: boolean;
}

export function useAutoScroll(paneKey: string, messageCount: number): UseAutoScrollResult {
  // Callback-ref → useState (NOT useRef): the state setter re-fires
  // mount-driven useEffects when PrettyView's composed callback ref binds.
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const scrollRef = useCallback((el: HTMLElement | null) => {
    setScrollEl(el);
  }, []);

  const [isPinnedToBottom, setIsPinnedToBottom] = useState<boolean>(true);
  const pinnedRef = useRef<boolean>(true);

  // Initial-mount / pane-switch reset. Fires when scrollEl transitions
  // null → element (fresh mount) OR when paneKey changes on an existing
  // element (identity swap without remount). Owns initial state so the
  // scroll listener below doesn't need a fragile seed onScroll.
  useEffect(() => {
    if (!scrollEl) return;
    pinnedRef.current = true;
    setIsPinnedToBottom(true);
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }, [scrollEl, paneKey]);

  // Scroll listener → pinnedRef. No seed — the mount/paneKey effect above
  // owns the initial value.
  useEffect(() => {
    if (!scrollEl) return;
    const onScroll = (): void => {
      const dist = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      const pinned = dist <= BOTTOM_EPSILON;
      pinnedRef.current = pinned;
      setIsPinnedToBottom(pinned);
    };
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", onScroll);
  }, [scrollEl]);

  // Follow-when-pinned on messageCount growth. Fires on every messages[]
  // increment. The no-yank-when-scrolled-up guarantee is the
  // `if (!pinnedRef.current) return` gate — Test 5 locks this.
  useEffect(() => {
    if (!scrollEl) return;
    if (!pinnedRef.current) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }, [scrollEl, messageCount]);

  // Accessory + content-growth observer. Complements the messageCount effect
  // by re-anchoring when scrollHeight changes for reasons OTHER than a new
  // message frame: WipBubble/PlanPendingBubble/etc. mount as in-flow siblings
  // of the messages.map output; streaming assistant content grows the last
  // bubble's height token-by-token; image decode changes a bubble's height
  // async. Without this observer, all three drift above the bottom.
  //
  // Design: ResizeObserver observes every DIRECT child of scrollEl so any
  // child's border-box change (which includes internal content growth via
  // normal flow) triggers a check. MutationObserver on scrollEl's childList
  // adds/removes observations as accessories mount/unmount. A single RAF
  // coalesces multiple mutations in one frame into one check.
  //
  // Every write is gated on `pinnedRef.current === true` — user-scrolled-up
  // state suppresses the write (Test 5 no-yank invariant extends to observer-
  // triggered writes, not just messageCount writes).
  useEffect(() => {
    if (!scrollEl) return;
    if (typeof ResizeObserver === "undefined" || typeof MutationObserver === "undefined") {
      // JSDOM without RO/MO polyfills — hook still functions via the
      // messageCount effect above; observer is a bonus safety net.
      return;
    }

    let raf = 0;
    const scheduleCheck = (): void => {
      if (raf !== 0) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!pinnedRef.current) return;
        scrollEl.scrollTop = scrollEl.scrollHeight;
      });
    };

    const ro = new ResizeObserver(scheduleCheck);
    for (const child of Array.from(scrollEl.children)) {
      if (child instanceof HTMLElement) ro.observe(child);
    }

    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if (node instanceof HTMLElement) ro.observe(node);
        }
        for (const node of Array.from(m.removedNodes)) {
          if (node instanceof HTMLElement) ro.unobserve(node);
        }
      }
      scheduleCheck();
    });
    mo.observe(scrollEl, { childList: true });

    return () => {
      mo.disconnect();
      ro.disconnect();
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [scrollEl]);

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
