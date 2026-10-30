/**
 * drag-diag — always-on lifecycle log for HTML5 drags, so an intermittent
 * "drag does nothing" episode is on disk the moment it happens.
 *
 * The failure it hunts (desktop Chrome on Windows, recurring): dragstart
 * fires — the drop lane slides out — but no drag image follows the cursor,
 * the cursor is a no-symbol, and no dragover ever reaches the page. It
 * survived a reload and cleared on its own later.
 *
 * One `[dnd-diag] start` and one `[dnd-diag] end` line per drag, plus:
 *   - `stalled`  — DRAG_STALL_MS after dragstart, no drag / dragover event
 *                  has arrived. Carries what the page could still see
 *                  (mouse moves — a live native drag swallows them —, focus,
 *                  visibility, what is under the pointer).
 *   - `stale-previous` — a new dragstart while the previous drag never got
 *                  a dragend / drop.
 *   - `no-end`   — DRAG_NO_END_MS after dragstart with no dragend / drop.
 *
 * Window capture listeners only; never preventDefault / stopPropagation.
 */

export const DRAG_STALL_MS = 1500;
export const DRAG_NO_END_MS = 30_000;

type Counts = {
  drag: number;
  dragenter: number;
  dragover: number;
  dragleave: number;
  mousemove: number;
  mouseup: number;
  blur: number;
  /** dragovers some handler preventDefault'ed — the page accepted the drop there */
  accepted: number;
};

type Session = {
  id: number;
  t0: number;
  source: string;
  counts: Counts;
  lastOver: string;
  lastX: number;
  lastY: number;
  /** Read on the NEXT dragover / at end, once every handler has run. */
  pendingOver: DragEvent | null;
  stallTimer: ReturnType<typeof setTimeout> | null;
  noEndTimer: ReturnType<typeof setTimeout> | null;
};

let current: Session | null = null;
let nextId = 1;
let installed = false;

function describe(el: EventTarget | null): string {
  if (!(el instanceof Element)) return el === window ? "window" : el === document ? "document" : "-";
  const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
  const testId = el.getAttribute("data-testid");
  return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${testId ? `[${testId}]` : ""}`;
}

function elapsed(s: Session): number {
  return Math.round(performance.now() - s.t0);
}

function settleOver(s: Session): void {
  if (s.pendingOver?.defaultPrevented) s.counts.accepted++;
  s.pendingOver = null;
}

function summary(s: Session): Record<string, unknown> {
  settleOver(s);
  return { drag: s.id, ms: elapsed(s), source: s.source, lastOver: s.lastOver, counts: { ...s.counts } };
}

function clearTimers(s: Session): void {
  if (s.stallTimer !== null) clearTimeout(s.stallTimer);
  if (s.noEndTimer !== null) clearTimeout(s.noEndTimer);
  s.stallTimer = null;
  s.noEndTimer = null;
}

function log(kind: string, data: Record<string, unknown>, warn = false): void {
  const line = `[dnd-diag] ${kind} ${JSON.stringify(data)}`;
  if (warn) console.warn(line);
  else console.info(line);
}

function onDragStart(e: DragEvent): void {
  if (current !== null) {
    log("stale-previous", summary(current), true);
    clearTimers(current);
  }
  const s: Session = {
    id: nextId++,
    t0: performance.now(),
    source: describe(e.target),
    counts: { drag: 0, dragenter: 0, dragover: 0, dragleave: 0, mousemove: 0, mouseup: 0, blur: 0, accepted: 0 },
    lastOver: "-",
    lastX: e.clientX,
    lastY: e.clientY,
    pendingOver: null,
    stallTimer: null,
    noEndTimer: null,
  };
  current = s;
  const target = e.target instanceof Element ? e.target : null;
  const dt = e.dataTransfer;
  // Deferred so it sees what the app's own dragstart handlers did
  // (setData, effectAllowed, preventDefault, re-renders of the source).
  setTimeout(() => {
    const rect = target?.getBoundingClientRect();
    const style = target ? getComputedStyle(target) : null;
    log("start", {
      drag: s.id,
      source: s.source,
      types: dt ? Array.from(dt.types) : null,
      effectAllowed: dt?.effectAllowed ?? null,
      prevented: e.defaultPrevented,
      connected: target?.isConnected ?? null,
      rect: rect ? [rect.x, rect.y, rect.width, rect.height].map(Math.round) : null,
      visibility: style?.visibility ?? null,
      opacity: style?.opacity ?? null,
      bodyPointerEvents: document.body.style.pointerEvents || "",
      iframes: document.querySelectorAll("iframe").length,
      dpr: window.devicePixelRatio,
      focused: document.hasFocus(),
    });
  }, 0);
  s.stallTimer = setTimeout(() => {
    s.stallTimer = null;
    if (current !== s || s.counts.drag > 0 || s.counts.dragover > 0) return;
    const under = document.elementFromPoint?.(s.lastX, s.lastY) ?? null;
    log(
      "stalled",
      {
        ...summary(s),
        focused: document.hasFocus(),
        visibility: document.visibilityState,
        active: describe(document.activeElement),
        under: describe(under),
        bodyPointerEvents: document.body.style.pointerEvents || "",
      },
      true,
    );
  }, DRAG_STALL_MS);
  s.noEndTimer = setTimeout(() => {
    s.noEndTimer = null;
    if (current === s) log("no-end", summary(s), true);
  }, DRAG_NO_END_MS);
}

function onEnd(e: DragEvent): void {
  const s = current;
  if (s === null) {
    // A drop from another window, or a dragend after a stale-previous.
    log(e.type, { drag: null, at: describe(e.target), dropEffect: e.dataTransfer?.dropEffect ?? null });
    return;
  }
  if (e.type === "drop") {
    log("drop", { drag: s.id, ms: elapsed(s), at: describe(e.target), dropEffect: e.dataTransfer?.dropEffect ?? null });
    return; // dragend follows on the source and closes the session
  }
  clearTimers(s);
  current = null;
  // Where the button came up: outside the viewport means the drag left the
  // window (or the browser ended it with the pointer elsewhere).
  log("end", {
    ...summary(s),
    dropEffect: e.dataTransfer?.dropEffect ?? null,
    endXY: [Math.round(e.clientX), Math.round(e.clientY)],
    viewport: [window.innerWidth, window.innerHeight],
  });
}

function count(key: keyof Counts) {
  return (e: Event): void => {
    const s = current;
    if (s === null) return;
    s.counts[key]++;
    if (e instanceof MouseEvent && (key === "dragover" || key === "mousemove")) {
      s.lastX = e.clientX;
      s.lastY = e.clientY;
    }
    if (key === "dragover") {
      settleOver(s);
      s.pendingOver = e as DragEvent;
    }
    if (key === "dragover" || key === "dragenter") s.lastOver = describe(e.target);
  };
}

/** Install the window listeners. Idempotent. */
export function installDragDiag(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const opts = { capture: true, passive: true } as const;
  window.addEventListener("dragstart", onDragStart, opts);
  window.addEventListener("drop", onEnd, opts);
  window.addEventListener("dragend", onEnd, opts);
  window.addEventListener("drag", count("drag"), opts);
  window.addEventListener("dragenter", count("dragenter"), opts);
  window.addEventListener("dragover", count("dragover"), opts);
  window.addEventListener("dragleave", count("dragleave"), opts);
  window.addEventListener("mousemove", count("mousemove"), opts);
  window.addEventListener("mouseup", count("mouseup"), opts);
  window.addEventListener("blur", count("blur"), opts);
}

/** Test-only: forget the session and allow a fresh install. */
export function __resetDragDiagForTests(): void {
  if (current !== null) clearTimers(current);
  current = null;
  nextId = 1;
}
