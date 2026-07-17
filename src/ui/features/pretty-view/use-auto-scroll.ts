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
//       metrics), markdown code-block layout, sidebar/drawer toggle
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
//       = useAutoScroll();
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

const BOTTOM_TOLERANCE_PX = 16;

export function useAutoScroll(): {
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
