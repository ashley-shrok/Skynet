import { useCallback, useEffect, useRef, useState } from "react";

// ============================================================================
// pretty-view auto-scroll — three-case sticky-bottom model.
//
// Design source: .planning/phases/32-redesign-pretty-view-auto-scroll-three-
// case-sticky-bottom-ho/32-CONTEXT.md (LOCKED — do not re-litigate).
//
// The hook covers exactly three user-facing cases:
//
//   1. Session first load          → paneKey-change useEffect enters sticky +
//                                     runs a self-halting rAF chain for
//                                     STICK_ARM_MS so image decode / batched WS
//                                     backfill settle at the bottom.
//   2. New messages while at bottom → ResizeObserver on the OUTER scroll
//                                     container fires on any child growth
//                                     (including post-Phase-27 accessory mounts
//                                     that are in-flow siblings of the sized
//                                     virtualizer container); if sticky and not
//                                     shrinking, jump to bottom.
//   3. User send                    → scrollToBottomAndFollow() enters sticky +
//                                     jumps + brief rAF re-arm. Wired by
//                                     PrettyView to both the jump-to-bottom
//                                     pill AND every send-path caller.
//
// Implicit inverse (Ashley confirmed 2026-08-12): if the user is scrolled up
// reading history, new incoming messages do NOT yank them down — the scroll
// listener flips stickyRef.current = false on any user scroll-up and the RO
// callback then only recomputes pill visibility, never writes scrollTop.
//
// Event model — ONE scroll listener, gated by two flags:
//   - programmaticRef  → filters out our own scrollTop writes (set true before
//                        the write, cleared in the next rAF).
//   - <20 px delta     → filters out TanStack Virtual's own scrollTo({top})
//                        writes from `applyScrollAdjustment` (verified in
//                        32-01-VERIFICATION-REPORT.md — measurement corrections
//                        are typically <20 px; real user scrolls are ≥40 px).
//
// Deliberately NOT here (see CONTEXT.md § Decisions LOCKED):
//   - No wheel / keydown / touchmove listeners  (single `scroll` covers all).
//   - No loadLockUntilRef gate                   (chain self-halts on un-stick).
//   - No inline overflow-anchor:none write       (patch #385 static Tailwind
//                                                 class on composeScrollRefs div
//                                                 is authoritative).
//   - No contentRef export                       (RO observes outer scrollEl
//                                                 only — captures accessory
//                                                 sibling mounts too).
//   - No forceStickAndJump export                (folded into single action).
// ============================================================================

const BOTTOM_THRESHOLD = 100; // px — matches old hook
const STICK_ARM_MS = 150; // rAF chain duration for load/send re-arm
// Per 32-01-VERIFICATION-REPORT.md § Recommendation: TanStack Virtual's
// `scrollWithAdjustments` (virtual-core/dist/esm/index.js:152-160) invokes
// `element.scrollTo({ top })` for measurement corrections — that write fires a
// `scroll` event on the container just like a real user scroll. Adjustments
// are typically small (a few px); user scroll events per tick are ≥40 px
// (mouse wheel default 100 px, keyboard PageUp ≥600 px, touch drag never
// yields a single ≤20 px event mid-drag). 20 px cleanly separates the two.
const MEASUREMENT_DELTA_IGNORE_PX = 20;

export interface UseAutoScrollResult {
  scrollRef: (el: HTMLElement | null) => void;
  scrollToBottomAndFollow: () => void;
  isPinnedToBottom: boolean;
}

export function useAutoScroll(paneKey: string): UseAutoScrollResult {
  // Callback-ref → useState (NOT useRef): the state setter is what re-fires
  // mount-driven useEffects when PrettyView's composed callback ref binds.
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const scrollRef = useCallback((el: HTMLElement | null) => {
    setScrollEl(el);
  }, []);

  const stickyRef = useRef<boolean>(true);
  const programmaticRef = useRef<boolean>(false);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState<boolean>(true);
  const prevScrollHeightRef = useRef<number>(0);

  // Wrap every scrollTop write so the shared scroll listener can distinguish
  // "we jumped" from "user scrolled." Clearing in rAF (not synchronously) lets
  // the browser fire its resulting `scroll` event before the flag is dropped.
  const jumpToBottom = useCallback((el: HTMLElement) => {
    programmaticRef.current = true;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => {
      programmaticRef.current = false;
    });
  }, []);

  // Case 1 — paneKey change (incl. initial mount) → enter sticky + rAF chain
  // for STICK_ARM_MS so async content settle (image decode, backfill) lands us
  // at the bottom. Chain self-halts when stickyRef flips false, so a user
  // scroll-up mid-chain un-sticks naturally with no time-gated blocking.
  useEffect(() => {
    if (!scrollEl) return;
    stickyRef.current = true;
    setIsPinnedToBottom(true);
    let cancelled = false;
    const start = Date.now();
    const tick = () => {
      if (cancelled || !scrollEl) return;
      if (!stickyRef.current) return; // user un-stuck mid-chain → halt
      jumpToBottom(scrollEl);
      if (Date.now() - start < STICK_ARM_MS) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, [scrollEl, paneKey, jumpToBottom]);

  // Case 2 — observe content growth inside the outer scroll container.
  //
  // Observing scrollEl itself catches viewport resize but NOT scrollHeight
  // growth, because scrollEl's own box is fixed by the parent flex layout —
  // messages arriving grow scrollHeight, not scrollEl's boundingRect. So we
  // also observe every direct child (whose box DOES grow with content: the
  // sized virtualizer container's inline height reflects
  // rowVirtualizer.getTotalSize(); accessory siblings each have their own
  // size), and wire a MutationObserver to observe newly-mounted children too
  // (accessories mount/unmount post-Phase-27 — WipBubble/PlanPendingBubble/
  // AsideBubble). This composite catches every scrollHeight change without
  // reintroducing a contentRef API.
  //
  // The `shrunk` guard preserves the old hook's WipBubble-unmount behavior
  // (browser auto-clamps on shrink; extra jump would drag a near-bottom
  // viewport further than the user intended).
  //
  // Fix for shipped #426 UAT failure (Ashley 2026-08-12: session first load
  // didn't land at bottom, follow-on-new-when-at-bottom didn't follow —
  // both fail if RO doesn't fire on scrollHeight growth).
  useEffect(() => {
    if (!scrollEl) return;
    prevScrollHeightRef.current = scrollEl.scrollHeight;
    const ro = new ResizeObserver(() => {
      const nextHeight = scrollEl.scrollHeight;
      const shrunk = nextHeight < prevScrollHeightRef.current;
      prevScrollHeightRef.current = nextHeight;
      if (stickyRef.current) {
        if (!shrunk) jumpToBottom(scrollEl);
      } else {
        const dist = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
        setIsPinnedToBottom(dist <= BOTTOM_THRESHOLD);
      }
    });
    ro.observe(scrollEl);
    for (const child of Array.from(scrollEl.children)) {
      ro.observe(child);
    }
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if (node instanceof Element) ro.observe(node);
        }
      }
    });
    mo.observe(scrollEl, { childList: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [scrollEl, jumpToBottom]);

  // Single scroll listener. Every input source (mouse wheel, keyboard
  // PageUp/ArrowUp/Home, touch drag, scrollbar drag, iOS momentum, and
  // TanStack Virtual's `scrollTo({top})` measurement corrections) fires
  // `scroll` — no need for the old wheel+keydown+touchmove trifecta.
  useEffect(() => {
    if (!scrollEl) return;
    let lastScrollTop = scrollEl.scrollTop;
    const handleScroll = () => {
      if (programmaticRef.current) return; // gate 1: our own writes
      const now = scrollEl.scrollTop;
      const dist = scrollEl.scrollHeight - now - scrollEl.clientHeight;
      const atBottom = dist <= BOTTOM_THRESHOLD;

      // Gate 2 — TanStack Virtual measurement-adjustment tolerance (per
      // 32-01-VERIFICATION-REPORT.md § Recommendation). Sub-threshold deltas
      // still update lastScrollTop + pill visibility so a series of tiny
      // corrections in the same direction can't silently accumulate a supra-
      // threshold shift measured against a stale baseline — they just must
      // not touch stickyRef.
      if (Math.abs(now - lastScrollTop) < MEASUREMENT_DELTA_IGNORE_PX) {
        setIsPinnedToBottom(atBottom);
        lastScrollTop = now;
        return;
      }

      if (now < lastScrollTop) {
        stickyRef.current = false; // user scrolled up
      } else if (atBottom) {
        stickyRef.current = true; // user landed back at bottom on their own
      }
      setIsPinnedToBottom(atBottom);
      lastScrollTop = now;
    };
    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", handleScroll);
  }, [scrollEl]);

  // Case 3 — single exported action. Enters sticky, jumps, then brief rAF
  // re-arm to absorb async content settle. Chain self-halts on user un-stick
  // so this action never fights a subsequent user scroll-up.
  const scrollToBottomAndFollow = useCallback(() => {
    stickyRef.current = true;
    setIsPinnedToBottom(true);
    if (!scrollEl) return;
    jumpToBottom(scrollEl);
    const start = Date.now();
    const tick = () => {
      if (!scrollEl) return;
      if (!stickyRef.current) return; // self-halt on user un-stick
      jumpToBottom(scrollEl);
      if (Date.now() - start < STICK_ARM_MS) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [scrollEl, jumpToBottom]);

  return {
    scrollRef,
    scrollToBottomAndFollow,
    isPinnedToBottom,
  };
}
