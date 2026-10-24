/**
 * Marks an in-bubble control (copy button, diff fold toggle) whose text must
 * not be read aloud by the bubble's speak button.
 */
export const SPEAK_SKIP_ATTR = "data-speak-skip";

/**
 * The bubble's rendered text as the speak button should hear it: innerText
 * (so block layout still yields line breaks / pauses) minus every element
 * marked with SPEAK_SKIP_ATTR. Marked elements are hidden only for the
 * synchronous read and restored before returning, so nothing paints.
 * Returns undefined where innerText isn't implemented (jsdom).
 */
export function readSpeakableText(root: HTMLElement): string | undefined {
  const skipped = Array.from(root.querySelectorAll<HTMLElement>(`[${SPEAK_SKIP_ATTR}]`));
  const prev = skipped.map((el) => el.style.display);
  skipped.forEach((el) => {
    el.style.display = "none";
  });
  try {
    return root.innerText;
  } finally {
    skipped.forEach((el, i) => {
      el.style.display = prev[i];
    });
  }
}
