import { useCallback, useEffect, useState } from "react";

// Chat-app auto-scroll observation hook — implements RENDER-03.
//
// Reports whether the observed scroll container is currently pinned to the
// bottom (small tolerance for sub-pixel rounding) and exposes a
// `scrollToBottom` action the caller can invoke AFTER appending a new
// message when `isPinnedToBottom` was true immediately before the append.
// The hook does NOT auto-scroll on its own — the timing is left to the
// caller so a fresh render can capture the "was pinned" bit before setState
// re-derives it.
//
// **Callback-ref pattern** (Ashley 2026-07-17): the hook returns a `scrollRef`
// callback function instead of consuming a `RefObject` passed in. The caller
// assigns it to `<div ref={scrollRef}>`. React invokes the callback with the
// DOM element when it attaches (and null when it detaches), and the internal
// effect keys on the element identity — so the scroll listener is guaranteed
// to attach AFTER the element exists in the DOM. The prior useRef+useEffect
// pattern raced: on first render `scrollRef.current` was null (because the
// scrollable div was gated behind `status === "streaming"`, and status started
// at "connecting"), the effect ran once returning early, and the ref later
// pointed at a live DOM node but the effect never re-fired.
//
// Caller usage pattern:
//
//     const { scrollRef, scrollToBottom, isPinnedToBottom } = useAutoScroll();
//     const wasPinnedRef = useRef(true);
//
//     // On each new WS message:
//     wasPinnedRef.current = isPinnedToBottom;   // capture BEFORE setState
//     setMessages(prev => [...prev, next]);
//
//     // Then in a useEffect keyed on messages.length:
//     useEffect(() => {
//       if (wasPinnedRef.current) scrollToBottom();
//     }, [messages.length]);
//
//     // And on the scrollable element:
//     <div ref={scrollRef} className="overflow-y-auto ...">…</div>
//
// A fresh mount with an empty list is trivially "at the bottom" so initial
// state is `true` — the first render of loaded messages pins.

const BOTTOM_TOLERANCE_PX = 16;

export function useAutoScroll(): {
  scrollRef: (el: HTMLElement | null) => void;
  scrollToBottom: () => void;
  isPinnedToBottom: boolean;
} {
  const [isPinnedToBottom, setIsPinnedToBottom] = useState<boolean>(true);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);

  // React calls this with the element when the ref attaches, null when it
  // detaches. Storing in state (not useRef) is what makes the effect below
  // re-run on element identity change — the whole reason for the callback-
  // ref refactor.
  const scrollRef = useCallback((el: HTMLElement | null) => {
    setScrollEl(el);
  }, []);

  useEffect(() => {
    if (scrollEl == null) return;
    const handleScroll = () => {
      const distance =
        scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      setIsPinnedToBottom(distance <= BOTTOM_TOLERANCE_PX);
    };
    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    // Sync once on mount so the initial state reflects the actual scroll
    // position (e.g., a re-mount after route change).
    handleScroll();
    return () => {
      scrollEl.removeEventListener("scroll", handleScroll);
    };
  }, [scrollEl]);

  const scrollToBottom = useCallback(() => {
    if (scrollEl == null) return;
    // Imperative direct assignment — no smooth behavior. Smooth scroll would
    // visibly chase every new message in a streaming feed.
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }, [scrollEl]);

  return { scrollRef, scrollToBottom, isPinnedToBottom };
}
