import { useCallback, useEffect, useRef, useState } from "react";

// Chat-app auto-scroll observation hook — implements RENDER-03.
//
// Design (2026-07-17 second rewrite after Ashley reported unreliable
// initial-load scroll):
//
// Two observations drive the auto-scroll:
//   (1) A `scroll` listener on the outer scroll container updates a
//       "was pinned just before this?" ref every time the user's scroll
//       position changes. This tracks user intent (are they reading
//       history vs. following the live tail).
//   (2) A `ResizeObserver` on an INNER content wrapper (provided by the
//       caller via `contentRef`) plus the outer scroll container fires
//       whenever anything resizes — initial mount, new message appended,
//       async web-font swap (Inter loading and re-laying out text
//       metrics), markdown code-block layout, sidebar/drawer open/close
//       shrinking the viewport, etc. If the user was pinned just
//       before the resize, we re-pin to the new bottom.
//
// The prior design listened for `messages.length` changes and called
// `scrollToBottom` from a `useEffect`, which raced with the callback-ref
// attach on first render (scrollEl was often null when the first message
// arrived) and with async layout shifts after the initial scroll (Inter
// font swap moved the bottom out from under us). ResizeObserver's
// initial-observe callback fires immediately with the current size, so
// the "scroll to bottom on load" case is handled by the same code path
// as "scroll on new message" — no first-render timing to get wrong.
//
// Caller usage pattern:
//
//     const { scrollRef, contentRef, scrollToBottom, isPinnedToBottom }
//       = useAutoScroll(messages.length);
//
//     <div ref={scrollRef} className="overflow-y-auto ...">
//       <div ref={contentRef} className="flex flex-col gap-3">
//         {messages.map(m => <ChatMessage key={m.eventId} ... />)}
//       </div>
//       {/* Jump-to-latest pill can live here as a sibling of contentRef;
//           its sticky positioning still works against the scroll container. */}
//     </div>
//
// `isPinnedToBottom` is state (re-renders the pill visibility); the
// internal `isPinnedRef` is a ref so the ResizeObserver reads the latest
// value without re-subscribing.
//
// messageCount argument:
//   Pass the current messages array length; the hook uses the transition
//   (prev < current) as the "new message appended" trigger for the
//   tall-message top-align branch. Growth of an existing message
//   (streaming token deltas) does NOT change this number, so it does NOT
//   re-anchor.

const BOTTOM_TOLERANCE_PX = 16;

export function useAutoScroll(messageCount: number): {
  scrollRef: (el: HTMLElement | null) => void;
  contentRef: (el: HTMLElement | null) => void;
  scrollToBottom: () => void;
  isPinnedToBottom: boolean;
} {
  const [isPinnedToBottom, setIsPinnedToBottom] = useState<boolean>(true);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLElement | null>(null);
  // Ref mirror of the pin state so the ResizeObserver callback reads the
  // latest value without needing to re-attach on every state flip.
  const isPinnedRef = useRef<boolean>(true);
  // Ratchet for user-scroll direction detection. See updatePinned below.
  const lastScrollTopRef = useRef<number>(0);
  // Tracks the last message count seen by the message-add effect so we can
  // distinguish "new message appended" (messageCount increased) from
  // "existing message grew" (messageCount unchanged — streaming token deltas).
  const prevMessageCountRef = useRef<number>(0);

  const scrollRef = useCallback((el: HTMLElement | null) => {
    setScrollEl(el);
  }, []);
  const contentRef = useCallback((el: HTMLElement | null) => {
    setContentEl(el);
  }, []);

  // Track scroll direction and update the pin state, ratcheted so that
  // content growth from underneath cannot silently un-pin.
  //
  // The naive "am I within tolerance of the bottom now?" check is not
  // enough because our OWN programmatic scrollTop set queues a scroll
  // event that fires ASYNC — and if content grew between the set and
  // the event (async web-font swap being the common case), the event
  // computes distance against the NEW scrollHeight, sees distance > 16,
  // and flips the pin off. Then the next RO fire is gated out and we're
  // stuck slightly above bottom.
  //
  // Ratchet rule: flip pin OFF only when the user actively scrolled UP
  // (currentScrollTop < lastScrollTop). Flip pin ON when we reach the
  // bottom (near). Content growth without a user scroll — scrollTop
  // stays put while scrollHeight grows — takes neither branch and
  // preserves whatever pin state we had.
  useEffect(() => {
    if (scrollEl == null) return;
    const updatePinned = () => {
      const currentScrollTop = scrollEl.scrollTop;
      const distance =
        scrollEl.scrollHeight - currentScrollTop - scrollEl.clientHeight;
      const nearBottom = distance <= BOTTOM_TOLERANCE_PX;
      const userScrolledUp = currentScrollTop < lastScrollTopRef.current;
      if (nearBottom) {
        if (!isPinnedRef.current) {
          isPinnedRef.current = true;
          setIsPinnedToBottom(true);
        }
      } else if (userScrolledUp) {
        if (isPinnedRef.current) {
          isPinnedRef.current = false;
          setIsPinnedToBottom(false);
        }
      }
      // Else: content grew from underneath but user didn't scroll up —
      // keep the current pin state. If pinned, the RO callback will
      // re-scroll on this same tick's growth event.
      lastScrollTopRef.current = currentScrollTop;
    };
    scrollEl.addEventListener("scroll", updatePinned, { passive: true });
    return () => scrollEl.removeEventListener("scroll", updatePinned);
  }, [scrollEl]);

  // Re-pin on any resize (content growth, viewport shrink, font swap).
  // The condition is the PRE-resize pin state (isPinnedRef, updated only
  // by scroll events, not by our own programmatic scrolls). New content
  // appended below a bottom-pinned user WOULD normally shift them off
  // the bottom (scrollTop unchanged, scrollHeight grew), but the scroll
  // event from the growth is what would flip the pin — the RO callback
  // fires BEFORE that scroll event, catching the pre-growth state.
  useEffect(() => {
    if (scrollEl == null || contentEl == null) return;
    const ro = new ResizeObserver(() => {
      if (isPinnedRef.current) {
        scrollEl.scrollTop = scrollEl.scrollHeight;
      }
    });
    // Observe the CONTENT wrapper for growth (new messages, markdown
    // re-layout, font swap) AND the outer container for viewport-size
    // changes (sidebar collapse, MessageQueueDrawer open/close, window
    // resize). Either can put a pinned user off the bottom.
    ro.observe(contentEl);
    ro.observe(scrollEl);
    return () => ro.disconnect();
  }, [scrollEl, contentEl]);

  // Tall-message top-align branch — fires ONLY on new-message-append.
  //
  // Why this belongs in the hook (not in PrettyView): the messageCount
  // transition is the SIGNAL that distinguishes "new message appended"
  // from "existing message grew" (streaming token deltas). PrettyView
  // sees the same messageCount change but cannot safely call scrollTop
  // without also carrying refs to scrollEl + isPinnedRef, which live
  // here. Centralizing in the hook keeps the scroll contract in one file.
  //
  // Why the existing ratchet in the scroll handler correctly flips the
  // pin OFF after top-align (no explicit isPinnedRef.current = false
  // needed here): setting scrollEl.scrollTop causes the browser to fire a
  // synchronous "scroll" event. updatePinned runs, sees currentScrollTop <
  // lastScrollTopRef.current (we jumped UP from the bottom), and flips
  // isPinnedRef.current = false via the ratchet. Subsequent streaming deltas
  // grow contentEl but isPinnedRef is already false, so the ResizeObserver
  // effect's if-guard does nothing — the user stays at the top-aligned
  // position. No additional state write is needed.
  //
  // Why we use direct scrollTop assignment rather than the Element scroll-
  // into-view API: that API scrolls the nearest scrollable ANCESTOR — in
  // nested-scroll layouts (e.g. parent tab pane can also scroll on very
  // narrow viewports) this can jump the wrong container. Direct
  // scrollEl.scrollTop = ... is unambiguous.
  //
  // Why we use offsetTop (not getBoundingClientRect): offsetTop is relative
  // to the offsetParent. The scroll container IS the offsetParent for direct
  // children of contentEl when contentEl has no positioning of its own.
  // If this check ever fails in practice (e.g. a future patch adds `relative`
  // to contentEl), fall back to computing the target scrollTop as:
  //   newEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top
  //   + scrollEl.scrollTop - BOTTOM_TOLERANCE_PX
  // Do NOT add the fallback preemptively — verify the offsetTop path first.
  useEffect(() => {
    if (scrollEl == null || contentEl == null) return;

    const prev = prevMessageCountRef.current;
    // ALWAYS update the ref before any further early-returns so the ref
    // stays in sync even when we do not anchor (streaming grows, resets
    // to [], etc.).
    prevMessageCountRef.current = messageCount;

    // No new message: covers streaming grows (messageCount unchanged),
    // initial mount (0 → 0), and the reset path in PrettyView (messages
    // set back to [] → messageCount drops back to 0).
    if (messageCount <= prev) return;

    // User has scrolled up — leave them alone. Matches the existing
    // ResizeObserver gate so scrolled-up users are never yanked.
    if (!isPinnedRef.current) return;

    // Defensive: contentEl may be momentarily empty during a StrictMode
    // double-invoke or between React reconciliation cycles.
    const newEl = contentEl.lastElementChild as HTMLElement | null;
    if (newEl == null) return;

    const messageHeight = newEl.offsetHeight;
    const viewportHeight = scrollEl.clientHeight;

    if (messageHeight > viewportHeight) {
      // Tall message: top-align with BOTTOM_TOLERANCE_PX (16px) margin so
      // the very first line of the new message sits just below the
      // viewport top. The scroll event from this write will fire
      // updatePinned, which detects the upward jump (currentScrollTop <
      // lastScrollTopRef.current) and flips isPinnedRef.current = false —
      // subsequent streaming deltas into this message will NOT re-anchor.
      scrollEl.scrollTop = newEl.offsetTop - BOTTOM_TOLERANCE_PX;
    }
    // Else (short message): return WITHOUT scrolling. The existing
    // ResizeObserver-driven bottom-pin fires on the append's content
    // growth and lands at scrollHeight, preserving current behavior.
  }, [scrollEl, contentEl, messageCount]);

  const scrollToBottom = useCallback(() => {
    if (scrollEl == null) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
    // Optimistically flip the pin ref/state now so a subsequent
    // synchronous resize (before the scroll event fires) re-pins.
    isPinnedRef.current = true;
    setIsPinnedToBottom(true);
  }, [scrollEl]);

  return { scrollRef, contentRef, scrollToBottom, isPinnedToBottom };
}
