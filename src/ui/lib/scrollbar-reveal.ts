/**
 * scrollbar-reveal — scrollbars hide when idle and show while they're in use,
 * the way Windows 11, macOS (trackpad), iOS and Android do it.
 *
 * The CSS half lives in index.css: every scrollbar's thumb is transparent
 * unless its scroll area is hovered or carries `data-scrollbar-reveal`. This
 * module sets that attribute:
 *
 *   - while the user scrolls an area (wheel, touch, keyboard, scrollbar drag),
 *     and for REVEAL_MS after the last scroll — programmatic scrolls (the
 *     conversation following new messages) don't count;
 *   - briefly when a scroll area opens with more content than fits
 *     (`flashScrollbars`), so a list that runs past its edge says so even
 *     before it's hovered — Apple's flashScrollIndicators.
 *
 * React never sets `data-scrollbar-reveal`, so it doesn't fight the attribute.
 */

export const REVEAL_ATTR = "data-scrollbar-reveal";
/** How long a scrollbar stays shown after the last scroll / a flash. */
export const REVEAL_MS = 1000;
/** A scroll this soon after user input counts as the user's. Covers
 *  momentum scrolling after a flick or a trackpad swipe. */
const USER_INPUT_WINDOW_MS = 1500;

const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

function reveal(el: Element, ms: number): void {
  const prev = timers.get(el);
  if (prev !== undefined) clearTimeout(prev);
  else el.setAttribute(REVEAL_ATTR, "");
  timers.set(
    el,
    setTimeout(() => {
      timers.delete(el);
      el.removeAttribute(REVEAL_ATTR);
    }, ms),
  );
}

function overflows(el: Element): boolean {
  return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
}

function isScrollArea(el: Element): boolean {
  if (!overflows(el)) return false;
  const s = getComputedStyle(el);
  return /(auto|scroll)/.test(s.overflowY) || /(auto|scroll)/.test(s.overflowX);
}

/** Briefly show the scrollbars of `root` and (unless `descendants: false`)
 *  every scroll area inside it that has more content than fits. No-op for
 *  areas that don't scroll. */
export function flashScrollbars(
  root: Element | null | undefined,
  { descendants = true }: { descendants?: boolean } = {},
): void {
  if (!root || !root.isConnected) return;
  if (!descendants) {
    if (isScrollArea(root)) reveal(root, REVEAL_MS);
    return;
  }
  // Measure everything first, then write: setting the attribute between
  // reads would force a style recalc on every following read.
  const found = [root, ...root.querySelectorAll("*")].filter(isScrollArea);
  for (const el of found) reveal(el, REVEAL_MS);
}

let installed = false;

/** Start revealing scrollbars on user scroll. Idempotent; call once at boot. */
export function installScrollbarReveal(doc: Document = document): void {
  if (installed) return;
  installed = true;
  let lastInput = -Infinity;
  const noteInput = () => {
    lastInput = performance.now();
  };
  const opts = { capture: true, passive: true } as const;
  for (const type of ["wheel", "touchstart", "touchmove", "keydown", "pointerdown"]) {
    doc.addEventListener(type, noteInput, opts);
  }
  doc.addEventListener(
    "scroll",
    (e) => {
      if (performance.now() - lastInput > USER_INPUT_WINDOW_MS) return;
      const target = e.target;
      const el = target === doc ? doc.scrollingElement : target;
      if (el instanceof Element) reveal(el, REVEAL_MS);
    },
    opts,
  );
}

/** Test-only: forget the installed listener state. */
export function __resetScrollbarRevealForTests(): void {
  installed = false;
}
