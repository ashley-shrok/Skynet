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

  const scrollRef = useCallback((el: HTMLElement | null) => {
    setScrollEl(el);
  }, []);
  const contentRef = useCallback((el: HTMLElement | null) => {
    setContentEl(el);
  }, []);

  // Track user scroll: whenever the user (or our own programmatic
  // scrollTop assignment) shifts the position, recompute "am I at the
  // bottom?" and mirror to both the ref and the state.
  //
  // Deliberately NOT running updatePinned() sync on mount. When the
  // container mounts with content already batched-in (a hard refresh
  // on a session with existing history), scrollTop starts at 0 and
  // scrollHeight is already large — the sync would set isPinnedRef =
  // false, which would then gate out the ResizeObserver's initial
  // scroll-to-bottom below. Instead we let isPinnedRef stay at its
  // default `true` so the RO's initial callback pins us to the
  // bottom, and let the resulting programmatic scroll event update
  // the state to reflect reality.
  useEffect(() => {
    if (scrollEl == null) return;
    const updatePinned = () => {
      const distance =
        scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      const pinned = distance <= BOTTOM_TOLERANCE_PX;
      isPinnedRef.current = pinned;
      setIsPinnedToBottom(pinned);
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
