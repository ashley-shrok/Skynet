import { useEffect, useState, type RefObject } from "react";

/**
 * True once the element has come within a screen of the viewport, and stays
 * true. Heavy blocks (charts, diagrams) wait for it so a long history full of
 * them stays light. Where there's no IntersectionObserver it's true at once.
 */
export function useInView(ref: RefObject<Element | null>, margin = "400px"): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin, seen]);
  return seen;
}
