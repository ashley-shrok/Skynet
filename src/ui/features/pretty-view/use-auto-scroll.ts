import { useCallback, useEffect, useRef, useState } from "react";

// ============================================================================
// pretty-view auto-scroll — three-case sticky-bottom model.
//
// Design source: .planning/phases/32-redesign-pretty-view-auto-scroll-three-
// case-sticky-bottom-ho/32-CONTEXT.md (LOCKED for the original three-case
// design) + Post-ship correction 2026-08-13 (§ appended section).
//
// The hook covers exactly three user-facing cases:
//
//   1. Session first load          → paneKey-change useEffect enters sticky +
//                                     runs a self-halting rAF chain for
//                                     STICK_ARM_MS so image decode / batched WS
//                                     backfill settle at the bottom.
//   2. New messages while at bottom → new-message useEffect keyed on
//                                     `messageCount`; if sticky, jump to
//                                     bottom. Semantic separation from
//                                     re-measure — the RO no longer writes
//                                     scrollTop.
//   3. User send                    → scrollToBottomAndFollow() enters sticky +
//                                     jumps + brief rAF re-arm. Wired by
//                                     PrettyView to both the jump-to-bottom
//                                     pill AND every send-path caller.
//
// Case 2b — pill-visibility RO. The outer-container + per-child RO +
// MutationObserver-for-new-children machinery is retained because pill
// visibility must reflect ANY scrollHeight change while non-sticky (tall-
// bubble re-measure grows scrollHeight → pill should still show "jump to
// bottom" correctly). But the RO callback ONLY writes
// `setIsPinnedToBottom(...)` — it NEVER calls jumpToBottom. That decoupling
// is the fix for 2026-08-13 (Ashley: "snaps back to the bottom or jumps to a
// completely different area … coincides with very tall bubbles").
//
// Implicit inverse (Ashley confirmed 2026-08-12): if the user is scrolled up
// reading history, new incoming messages do NOT yank them down — the scroll
// listener flips stickyRef.current = false on any user scroll-up, the new-
// message useEffect then sees stickyRef.current === false and does nothing,
// and the RO callback only recomputes pill visibility (never writes scrollTop).
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

export function useAutoScroll(paneKey: string, messageCount: number): UseAutoScrollResult {
  // Callback-ref → useState (NOT useRef): the state setter is what re-fires
  // mount-driven useEffects when PrettyView's composed callback ref binds.
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const scrollRef = useCallback((el: HTMLElement | null) => {
    setScrollEl(el);
  }, []);

  const stickyRef = useRef<boolean>(true);
  const programmaticRef = useRef<boolean>(false);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState<boolean>(true);

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

  // Case 2 — new-message signal. Fires on mount and every time `messageCount`
  // grows. If sticky, jump to bottom. This is the ONLY code path that calls
  // jumpToBottom on message arrival — cleanly separated from re-measure so a
  // tall-bubble RO fire (no new message) never yanks scrollTop.
  //
  // Post-ship correction 2026-08-13 (Ashley: "snaps back to the bottom or
  // jumps to a completely different area … coincides with very tall bubbles"):
  // the previous single Case 2 useEffect conflated "new message arrived"
  // (jump desired) with "existing bubble re-measured by TanStack Virtual"
  // (jump NOT desired). Splitting into (a) this new-message signal keyed on
  // messageCount + (b) the retained RO for pill-visibility only is the
  // structural fix Ashley greenlit.
  //
  // This effect intentionally fires on mount (initial messageCount value)
  // even when messageCount is 0; Case 1's paneKey effect already handles
  // session-first-load stickying so a harmless second nudge here is fine.
  useEffect(() => {
    if (!scrollEl) return;
    if (stickyRef.current) jumpToBottom(scrollEl);
  }, [scrollEl, messageCount, jumpToBottom]);

  // Case 2b — pill-visibility RO. Observes the outer scroll container AND
  // every direct child (accessory siblings + sized virtualizer container),
  // with a MutationObserver watching for newly-mounted children so the RO
  // set stays complete across post-Phase-27 accessory mount/unmount cycles
  // (WipBubble/PlanPendingBubble/AsideBubble).
  //
  // The callback ONLY updates `setIsPinnedToBottom(...)` — it NEVER calls
  // jumpToBottom. That decoupling is the fix for 2026-08-13: tall-bubble
  // re-measure fires this RO, but the RO no longer writes scrollTop, so no
  // snap-back / no jump-to-different-area.
  //
  // The RO must stay (rather than being dropped entirely) because pill
  // visibility must reflect ANY scrollHeight change while non-sticky —
  // e.g., a tall-bubble re-measure while the user is scrolled up should
  // still update the "jump to bottom" pill's dist-from-bottom calculation.
  useEffect(() => {
    if (!scrollEl) return;
    const ro = new ResizeObserver(() => {
      const dist = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      setIsPinnedToBottom(dist <= BOTTOM_THRESHOLD);
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
  }, [scrollEl]);

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
