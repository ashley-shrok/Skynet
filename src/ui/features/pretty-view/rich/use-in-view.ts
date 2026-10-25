import { useEffect, useState } from "react";

/**
 * Whether the element is within `margin` of the viewport. Heavy blocks wait
 * for it so a long history full of them stays light. `sticky` keeps it true
 * once seen (diagrams: a drawn picture is cheap to keep); otherwise it follows
 * the element in and out, so charts far off-screen can let go of their
 * canvases. Takes the element itself (from a callback ref), so a block whose
 * box appears later — after a fallback, say — is still watched. Where there's
 * no IntersectionObserver it's true at once.
 */
export function useNearView(el: Element | null, { margin = "400px", sticky = true }: { margin?: string; sticky?: boolean } = {}): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  const settled = sticky && near;
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || !el || settled) return;
    const io = new IntersectionObserver(
      (entries) => {
        const now = entries.some((e) => e.isIntersecting);
        setNear(now);
        if (now && sticky) io.disconnect();
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [el, margin, sticky, settled]);
  return near;
}
