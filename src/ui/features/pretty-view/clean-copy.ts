/**
 * Clean copy for chat bubbles.
 *
 * Left alone, a Ctrl+C over bubble text makes the browser serialize the
 * dark-theme computed styles (background-color, color) into the text/html
 * clipboard flavor. Pasting into a rich-text editor (Zoho Mail, Gmail,
 * Word) then reproduces white-on-black bands around every paragraph.
 *
 * `handleCleanCopy` takes over the copy event: it writes the selection's
 * structure (paragraphs, bold, lists, links, tables) as HTML stripped of
 * every style/class attribute, plus the browser's own plain-text rendering.
 * The pasted text then takes on the destination's default look.
 */

// Interactive chrome inside a bubble (speak / copy / thumbs buttons and
// their icons) — never part of the copied text.
const CHROME_SELECTOR = "button, svg, [aria-hidden='true'], [data-pv-no-copy]";

// Attributes worth keeping on the copied HTML; everything else (style,
// class, data-*, title, aria-*) is dropped.
const KEPT_ATTRIBUTES = new Set(["href", "src", "alt", "colspan", "rowspan", "start"]);

export function sanitizeFragment(fragment: DocumentFragment): void {
  fragment.querySelectorAll(CHROME_SELECTOR).forEach((el) => el.remove());
  fragment.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (!KEPT_ATTRIBUTES.has(attr.name)) el.removeAttribute(attr.name);
    }
  });
}

/**
 * Returns `{ html, text }` for the current selection, or null when there is
 * nothing selected (so the caller lets the browser's default copy run).
 */
export function cleanSelectionPayload(
  selection: Selection | null,
): { html: string; text: string } | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const container = document.createElement("div");
  for (let i = 0; i < selection.rangeCount; i++) {
    container.appendChild(selection.getRangeAt(i).cloneContents());
  }
  const fragment = document.createDocumentFragment();
  while (container.firstChild) fragment.appendChild(container.firstChild);
  sanitizeFragment(fragment);
  container.appendChild(fragment);

  return { html: container.innerHTML, text: selection.toString() };
}

export function handleCleanCopy(e: React.ClipboardEvent | ClipboardEvent): void {
  const payload = cleanSelectionPayload(window.getSelection());
  if (!payload || !e.clipboardData) return;
  e.clipboardData.setData("text/html", payload.html);
  e.clipboardData.setData("text/plain", payload.text);
  e.preventDefault();
}
