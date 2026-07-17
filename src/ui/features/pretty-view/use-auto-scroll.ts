import { useCallback, useEffect, useState, type RefObject } from "react";

// Chat-app auto-scroll observation hook — implements RENDER-03.
//
// Reports whether the given scroll container is currently pinned to
// the bottom (small tolerance for sub-pixel rounding) and exposes a
// `scrollToBottom` action the caller can invoke AFTER appending a
// new message when `isPinnedToBottom` was true immediately before
// the append. The hook does NOT auto-scroll on its own — the timing
// is left to the caller so a fresh render can capture the "was
// pinned" bit before setState re-derives it.
//
// Caller usage pattern:
//
//     const listRef = useRef<HTMLDivElement>(null);
//     const { scrollToBottom, isPinnedToBottom } = useAutoScroll(listRef);
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
// A fresh mount with an empty list is trivially "at the bottom" so
// initial state is `true` — the first render of loaded messages pins.

const BOTTOM_TOLERANCE_PX = 16;

export function useAutoScroll(
  scrollRef: RefObject<HTMLElement | null>,
): { scrollToBottom: () => void; isPinnedToBottom: boolean } {
  const [isPinnedToBottom, setIsPinnedToBottom] = useState<boolean>(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el == null) return;

    const handleScroll = () => {
      const cur = scrollRef.current;
      if (cur == null) return;
      const distance = cur.scrollHeight - cur.scrollTop - cur.clientHeight;
      setIsPinnedToBottom(distance <= BOTTOM_TOLERANCE_PX);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    // Sync once on mount in case the container already has a scroll
    // position (e.g., re-mount after a route change).
    handleScroll();
    return () => {
      el.removeEventListener("scroll", handleScroll);
    };
  }, [scrollRef]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el == null) return;
    // Imperative direct assignment — no smooth behavior. Smooth scroll
    // would visibly chase every new message in a streaming feed.
    el.scrollTop = el.scrollHeight;
  }, [scrollRef]);

  return { scrollToBottom, isPinnedToBottom };
}
