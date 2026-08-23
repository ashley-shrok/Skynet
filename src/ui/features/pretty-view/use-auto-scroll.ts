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
//   (5) Scroll-container remount race (Ashley 2026-08-23 whitney-click):
//       ~75ms into hydration, React replaces the scroll container element.
//       The new element mounts with scrollTop=0 (empty for one frame),
//       fires a scroll event that flips pinnedRef=false via the scroll-
//       event listener, and every subsequent mutation's observer rAF
//       hits the pinned-gate skip path — content grows past viewport
//       while the user sits at top=0. Fix: bottom-sentinel `<div
//       data-pv-scroll-sentinel />` + IntersectionObserver observing
//       its intersection with the scroll container's viewport. IO
//       intersection state is the AUTHORITATIVE pinning signal
//       (scroll-event pinning becomes diagnostic-only, retained as
//       fallback only when IO is unavailable). IO auto-recovers from
//       container remounts because sentinelEl is re-observed via
//       callback ref, and an intersection callback fires immediately
//       on observe with the sentinel's current state.
//
//   (4) First-content-arrival gap (Ashley 2026-08-23): the mount effect
//       writes scrollTop=scrollHeight at ref-bind time, but when messages[]
//       is empty at that moment (PrettyView initializes empty, then WS
//       backfill populates async) the write is a no-op on an empty
//       container. If any scroll event between ref-bind and first-content
//       arrival flips pinnedRef to false (browser scroll-restoration,
//       scrollbar-mount reflow, empty-container programmatic-write reflow),
//       the messageCount 0→N follow effect gets skipped and the user lands
//       scrolled-up. Fix: `didFirstContentScrollRef` bypasses the pinnedRef
//       gate for the very first content-populate transition per pane, then
//       flips true so subsequent messageCount growth respects the gate
//       (preserving the Test 5 no-yank invariant post-first-content). Same
//       bypass applies to the observer's RAF write path so an accessory or
//       first-message-child mount that arrives via mutation observation
//       also anchors even under spurious pinned=false.
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
//   • `didFirstContentScrollRef` (2026-08-23) bypasses the pinnedRef gate
//     on the very first content-populate transition per pane (fixes 4).
//     Reset alongside pinnedRef in the mount/paneKey effect. Flag flips
//     true after the first-content write; all subsequent writes respect
//     the pinnedRef gate (Test 5 no-yank invariant preserved).
//   • The no-yank-when-scrolled-up invariant (Test 5) is preserved: every
//     write is gated on `pinnedRef.current === true`.
//
// Hook return API is FROZEN — { scrollRef, scrollToBottomAndFollow,
// isPinnedToBottom }. Callers in PrettyView.tsx unchanged.
// ============================================================================

const BOTTOM_EPSILON = 100; // px — matches Phase 32 BOTTOM_THRESHOLD threshold

export interface UseAutoScrollResult {
  scrollRef: (el: HTMLElement | null) => void;
  /**
   * inline-260823-pv-scroll-sentinel (Ashley 2026-08-23): callback ref to
   * bind an invisible 1px `<div data-pv-scroll-sentinel />` as the LAST
   * child of the scroll container (after messages + all accessory
   * bubbles). An IntersectionObserver watching this sentinel is the
   * AUTHORITATIVE pinning signal — pinned ⇔ sentinel intersects the
   * container's viewport. Immune to scroll-container remount races that
   * were defeating the scroll-event-driven pinning (see header §(5)).
   */
  sentinelRef: (el: HTMLElement | null) => void;
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

  // inline-260823-pv-scroll-sentinel: bottom-sentinel element for the
  // IntersectionObserver-driven pinning. Callback ref → useState so the
  // observer effect re-fires when React re-mounts the sentinel (same
  // pattern as scrollEl above).
  const [sentinelEl, setSentinelEl] = useState<HTMLElement | null>(null);
  const sentinelRef = useCallback((el: HTMLElement | null) => {
    setSentinelEl(el);
  }, []);

  const [isPinnedToBottom, setIsPinnedToBottom] = useState<boolean>(true);
  const pinnedRef = useRef<boolean>(true);
  // First-content-arrival guard — see header comment §(4).
  const didFirstContentScrollRef = useRef<boolean>(false);

  // Initial-mount / pane-switch reset. Fires when scrollEl transitions
  // null → element (fresh mount) OR when paneKey changes on an existing
  // element (identity swap without remount). Owns initial state so the
  // scroll listener below doesn't need a fragile seed onScroll.
  useEffect(() => {
    if (!scrollEl) return;
    pinnedRef.current = true;
    didFirstContentScrollRef.current = false;
    setIsPinnedToBottom(true);
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }, [scrollEl, paneKey]);

  // inline-260823-pv-scroll-sentinel: IntersectionObserver on the sentinel
  // is the AUTHORITATIVE pinning signal (Ashley 2026-08-23, diagnosed
  // from console-forward.log 11:18:13.780→.855Z where the scroll
  // container was replaced by React mid-hydration, resetting scrollTop=0
  // and defeating the scroll-event-driven pinning). Sentinel intersecting
  // the container's viewport ⇔ user can see the bottom of content ⇔
  // pinned=true. IntersectionObserver auto-recovers from container
  // remounts because the sentinel is re-observed via ref-callback.
  //
  // Coexists with the scroll listener below (which retains diagnostic
  // logging only — the pinnedRef update is HERE, not there). Old
  // BOTTOM_EPSILON-based scroll-event pinning is REMOVED as
  // authoritative — sentinel intersection replaces it.
  useEffect(() => {
    if (!scrollEl || !sentinelEl) return;
    if (typeof IntersectionObserver === "undefined") {
      // JSDOM without IO polyfill — fall back to scroll-event-driven
      // pinning via the listener below (behavior preserved for tests).
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const pinned = entry.isIntersecting;
        pinnedRef.current = pinned;
        setIsPinnedToBottom(pinned);
        console.info(
          `[pv-scroll-diag] sentinel-intersect pinned=${pinned} ratio=${entry.intersectionRatio} paneKey=${paneKey}`,
        );
      },
      { root: scrollEl, rootMargin: "0px", threshold: 0 },
    );
    io.observe(sentinelEl);
    return () => io.disconnect();
  }, [scrollEl, sentinelEl, paneKey]);

  // Scroll listener. inline-260823-pv-scroll-sentinel: pinning update
  // MOVED to the IntersectionObserver above. This listener remains for
  // pv-scroll-diag geometry logging AND as a fallback pinning updater
  // when IntersectionObserver is unavailable (JSDOM tests without an
  // IO polyfill).
  useEffect(() => {
    if (!scrollEl) return;
    const hasIO = typeof IntersectionObserver !== "undefined";
    const onScroll = (): void => {
      const dist = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      const pinned = dist <= BOTTOM_EPSILON;
      if (!hasIO) {
        // Only update pinnedRef from scroll events when IO is unavailable
        // (test-env fallback). In production the IO owns pinning state.
        pinnedRef.current = pinned;
        setIsPinnedToBottom(pinned);
      }
      // pv-scroll-diag (2026-08-23): log every scroll event so we can
      // reconstruct the geometry timeline around a "jump up" complaint.
      // Volume is bounded by user input; flows to console-forward.log.
      console.info(
        `[pv-scroll-diag] scroll top=${scrollEl.scrollTop} height=${scrollEl.scrollHeight} client=${scrollEl.clientHeight} dist=${dist} pinned=${pinnedRef.current} paneKey=${paneKey}`,
      );
    };
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", onScroll);
  }, [scrollEl, paneKey]);

  // Follow-when-pinned on messageCount growth. Fires on every messages[]
  // increment. The no-yank-when-scrolled-up guarantee is the
  // `if (!pinnedRef.current) return` gate — Test 5 locks this.
  //
  // First-content-arrival bypass (§4): the very first messageCount 0→positive
  // transition per pane anchors to bottom even under spurious pinned=false,
  // then flips didFirstContentScrollRef=true so subsequent growth respects
  // the pinnedRef gate (preserving Test 5 no-yank invariant).
  useEffect(() => {
    if (!scrollEl) return;
    const isFirstContentArrival = !didFirstContentScrollRef.current && messageCount > 0;
    if (!pinnedRef.current && !isFirstContentArrival) {
      // pv-scroll-diag (2026-08-23): log skip-write path so we can see
      // whether the browser's overflow-anchor preserved position when we
      // deliberately did not write.
      console.info(
        `[pv-scroll-diag] follow-skip messageCount=${messageCount} top=${scrollEl.scrollTop} height=${scrollEl.scrollHeight} pinned=false paneKey=${paneKey}`,
      );
      return;
    }
    const beforeTop = scrollEl.scrollTop;
    const beforeHeight = scrollEl.scrollHeight;
    scrollEl.scrollTop = scrollEl.scrollHeight;
    console.info(
      `[pv-scroll-diag] follow-write messageCount=${messageCount} beforeTop=${beforeTop} beforeHeight=${beforeHeight} afterTop=${scrollEl.scrollTop} afterHeight=${scrollEl.scrollHeight} isFirst=${isFirstContentArrival} paneKey=${paneKey}`,
    );
    if (isFirstContentArrival) {
      didFirstContentScrollRef.current = true;
      pinnedRef.current = true;
      setIsPinnedToBottom(true);
    }
  }, [scrollEl, messageCount, paneKey]);

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
    // pv-scroll-diag (2026-08-23): capture the batch of mutations so we
    // can log added/removed counts alongside geometry in the rAF callback.
    let batchedMutations: MutationRecord[] = [];
    const scheduleCheck = (mutations?: MutationRecord[]): void => {
      if (mutations) batchedMutations.push(...mutations);
      if (raf !== 0) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        // pv-scroll-diag: summarise batched mutations before geometry log.
        let added = 0;
        let removed = 0;
        for (const m of batchedMutations) {
          for (const n of Array.from(m.addedNodes)) {
            if (n.nodeType === 1) added += 1;
          }
          for (const n of Array.from(m.removedNodes)) {
            if (n.nodeType === 1) removed += 1;
          }
        }
        batchedMutations = [];
        // First-content-arrival bypass (§4): the very first observed child
        // mount per pane anchors to bottom even under spurious pinned=false.
        const isFirstContentArrival =
          !didFirstContentScrollRef.current && scrollEl.children.length > 0;
        const willWrite = pinnedRef.current || isFirstContentArrival;
        const beforeTop = scrollEl.scrollTop;
        const beforeHeight = scrollEl.scrollHeight;
        if (!willWrite) {
          // pv-scroll-diag: skip-write path — browser overflow-anchor should
          // handle. If Ashley sees a "jump up" and this log shows top
          // moving between successive skip-writes without a user scroll in
          // between, the browser's anchor is being defeated somewhere.
          console.info(
            `[pv-scroll-diag] mutation-skip added=${added} removed=${removed} top=${beforeTop} height=${beforeHeight} client=${scrollEl.clientHeight} pinned=false children=${scrollEl.children.length} paneKey=${paneKey}`,
          );
          return;
        }
        scrollEl.scrollTop = scrollEl.scrollHeight;
        console.info(
          `[pv-scroll-diag] mutation-write added=${added} removed=${removed} beforeTop=${beforeTop} beforeHeight=${beforeHeight} afterTop=${scrollEl.scrollTop} afterHeight=${scrollEl.scrollHeight} isFirst=${isFirstContentArrival} children=${scrollEl.children.length} paneKey=${paneKey}`,
        );
        if (isFirstContentArrival) {
          didFirstContentScrollRef.current = true;
          pinnedRef.current = true;
          setIsPinnedToBottom(true);
        }
      });
    };

    const ro = new ResizeObserver(() => scheduleCheck());
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
      // pv-scroll-diag (2026-08-23): thread the mutation batch through so
      // the rAF callback can log added/removed counts alongside geometry.
      scheduleCheck(mutations);
    });
    mo.observe(scrollEl, { childList: true });

    return () => {
      mo.disconnect();
      ro.disconnect();
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [scrollEl, paneKey]);

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
