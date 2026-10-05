import { useEffect, useState } from "react";

/**
 * Shared plumbing for chip previews that need the file's text (diff, CSV):
 * fetch only once the chip is on screen, and read a bounded prefix so a
 * huge file never downloads in full just to draw a preview.
 */

/** True once `el` has been on screen (stays true). Always true without IntersectionObserver. */
export function useInView(el: Element | null): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setSeen(true);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [el, seen]);
  return seen;
}

/**
 * Fetch `url` and return at most `maxBytes` of it as text. When cut short,
 * the trailing partial line is dropped and `partial` is true.
 */
export async function fetchTextPrefix(
  url: string,
  maxBytes: number,
  signal: AbortSignal,
): Promise<{ text: string; partial: boolean }> {
  const res = await fetch(url, { credentials: "same-origin", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!res.body) return { text: await res.text(), partial: false };
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { text: text + decoder.decode(), partial: false };
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (bytes >= maxBytes) {
      void reader.cancel();
      return { text: text.slice(0, text.lastIndexOf("\n") + 1), partial: true };
    }
  }
}
