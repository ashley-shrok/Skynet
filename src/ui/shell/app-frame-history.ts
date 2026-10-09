// ─── app-frame-history.ts ─────────────────────────────────────────────────
// shape-app-pane-strip: the app bar's own record of the pages an app pane has
// visited, and where in that list it currently is.
//
// Why not the browser's history: the browser keeps ONE session history for
// the whole tab, shared by Skynet's page and every iframe. Traversing back in
// one app frame (history.back / navigation.back) rewinds the whole tab to the
// moment that entry was current — so a second app frame that navigated since,
// and Skynet's own pushState entries (mobile list/view flow), all rewind with
// it (reproduced in Chrome, 2026-10-09). The bar instead keeps this per-pane
// list and moves by loading the target page with location.replace(), which
// swaps the frame's current entry in place and never traverses shared
// history. Trade-off (user-approved): a page reached by back/forward loads
// fresh rather than being restored from the back/forward cache.
//
// Pure state machine; AppPane feeds it what the frame reports.

export interface FrameHistory {
  /** Page URLs this pane has visited, oldest first. */
  entries: string[];
  /** Index of the page currently shown; -1 before the first load. */
  index: number;
  /** Set while a bar back/forward load is in flight: the index it targets. */
  pending: number | null;
}

/**
 * How the frame arrived at its current URL, as the Navigation API reports it
 * ("push" | "replace" | "reload" | "traverse"), or "unknown" in browsers
 * without it.
 */
export type FrameNavKind = "push" | "replace" | "reload" | "traverse" | "unknown";

export const MAX_FRAME_HISTORY = 100;

export const EMPTY_FRAME_HISTORY: FrameHistory = { entries: [], index: -1, pending: null };

function withEntryAt(h: FrameHistory, index: number, url: string): FrameHistory {
  const entries = h.entries.slice();
  entries[index] = url;
  return { entries, index, pending: null };
}

/** Record that the frame is now showing `url`, arrived at via `kind`. */
export function observeFrameUrl(h: FrameHistory, url: string, kind: FrameNavKind): FrameHistory {
  if (h.entries.length === 0) return { entries: [url], index: 0, pending: null };
  // Our own back/forward load landing (possibly redirected — record where it
  // actually ended up).
  if (h.pending !== null) return withEntryAt(h, h.pending, url);

  const current = h.entries[h.index];
  switch (kind) {
    case "reload":
      return url === current ? h : withEntryAt(h, h.index, url);
    case "replace":
      return url === current ? h : withEntryAt(h, h.index, url);
    case "traverse":
      // The frame moved through the browser's own history (the phone's back
      // gesture, the browser back button). Follow it if it landed on a
      // neighbour we know; otherwise treat it as replacing the current page.
      if (h.index > 0 && h.entries[h.index - 1] === url) {
        return { ...h, index: h.index - 1 };
      }
      if (h.index < h.entries.length - 1 && h.entries[h.index + 1] === url) {
        return { ...h, index: h.index + 1 };
      }
      return url === current ? h : withEntryAt(h, h.index, url);
    case "push":
    case "unknown":
    default: {
      if (url === current) return h;
      let entries = h.entries.slice(0, h.index + 1);
      entries.push(url);
      if (entries.length > MAX_FRAME_HISTORY) {
        entries = entries.slice(entries.length - MAX_FRAME_HISTORY);
      }
      return { entries, index: entries.length - 1, pending: null };
    }
  }
}

export function canFrameGoBack(h: FrameHistory): boolean {
  return h.index > 0;
}

export function canFrameGoForward(h: FrameHistory): boolean {
  return h.index >= 0 && h.index < h.entries.length - 1;
}

/**
 * Plan a back (-1) or forward (+1) step. Returns the URL to load in place and
 * the state to hold while it loads, or null when there is nowhere to go — in
 * particular, back never goes before the first page this pane showed.
 */
export function planFrameStep(
  h: FrameHistory,
  delta: -1 | 1,
): { url: string; next: FrameHistory } | null {
  const target = h.index + delta;
  if (h.index < 0 || target < 0 || target >= h.entries.length) return null;
  return { url: h.entries[target], next: { ...h, pending: target } };
}
