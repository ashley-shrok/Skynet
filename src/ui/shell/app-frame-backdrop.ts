// ─── app-frame-backdrop.ts ────────────────────────────────────────────────
// Keeps an app pane's frame from flashing white between the app's pages.
//
// The frame element is white (AppPane § Attribute discipline) so apps with
// no background look the way they do in their own tab. But between one page
// going away and the next one painting, the frame shows nothing except its
// own background — so a dark app flashed white on every full page change.
// A top-level tab doesn't, because the browser holds the old page's paint;
// inside a frame it doesn't hold it.
//
// Fix: as a page is left (pagehide), read what its canvas paints. When that
// paint covers the whole frame — an opaque background on html (or body, which
// propagates to the canvas when html has none), or the opaque dark canvas the
// browser paints for a page in a dark-only color scheme inside the light
// frame — give the frame element that color for the gap, so the gap shows
// the app's own color instead of white. Anything that doesn't fully cover (no
// background, a see-through one, an image or gradient with no color) leaves
// the gap white, exactly as before.
//
// The element is only recolored between pages, never under a live one: once
// the next page has loaded it is white again. A live page with no background
// of its own (or one that switches theme in place) shows the white element
// through itself, so a lingering color would change how it looks.
//
// The next page takes over as early as it can be trusted: as soon as its
// document reports a covering background (its color, invisible under it), or
// once it is fully styled with none — parsed, deferred scripts run, every
// stylesheet in (white) — and at its load (white). A page left before its
// own load finished isn't watched yet and keeps the old white gap. Nothing is injected into the app: this only reads
// computed styles and listens for pagehide on the frame's same-origin
// window. Off-site (cross-origin) pages can't be read and stay white.

import { systemLogger } from "@/lib/frontend-logger";

// How long after leaving a page we keep looking for the next one before
// giving up (the next load re-reads regardless).
export const BACKDROP_WATCH_CAP_MS = 10_000;

// Alpha of a computed CSS color. Computed colors come back as rgb()/rgba()
// for legacy syntax, and in their own space (oklch(… / a), color(srgb … / a))
// for modern syntax; anything else without an alpha is opaque.
export function colorAlpha(color: string): number {
  const c = color.trim().toLowerCase();
  if (c === "" || c === "transparent") return 0;
  const legacy = /^rgba?\(([^)]*)\)$/.exec(c);
  if (legacy !== null) {
    const parts = legacy[1].split(/[\s,/]+/).filter((p) => p !== "");
    return parts.length >= 4 ? parseAlpha(parts[3]) : 1;
  }
  const slash = /\/\s*([^\s)]+)\s*\)$/.exec(c);
  return slash !== null ? parseAlpha(slash[1]) : 1;
}

function parseAlpha(raw: string): number {
  if (raw === "none") return 0;
  const n = raw.endsWith("%") ? parseFloat(raw) / 100 : parseFloat(raw);
  return Number.isFinite(n) ? n : 1;
}

// A page in a dark-only color scheme, inside the frame's light scheme, gets
// an opaque dark canvas from the browser. "light dark" follows the frame's
// light scheme and gets the normal transparent one.
function usesDarkCanvas(doc: Document, rootScheme: string | undefined): boolean {
  let scheme = rootScheme ?? "";
  if (scheme === "" || scheme === "normal") {
    scheme = doc.querySelector('meta[name="color-scheme"]')?.getAttribute("content") ?? "";
  }
  const tokens = scheme.toLowerCase().split(/\s+/).filter((t) => t !== "" && t !== "only");
  return tokens.includes("dark") && !tokens.includes("light");
}

let darkCanvasCache: string | null = null;

// The browser's own dark canvas color, read from a probe in Skynet's page
// (not the app's) so it matches whatever this browser actually paints.
function darkCanvasColor(): string {
  if (darkCanvasCache !== null) return darkCanvasCache;
  let color = "";
  try {
    const probe = document.createElement("div");
    probe.style.colorScheme = "dark";
    probe.style.backgroundColor = "Canvas";
    probe.style.display = "none";
    document.body.appendChild(probe);
    color = getComputedStyle(probe).backgroundColor;
    probe.remove();
  } catch {
    color = "";
  }
  darkCanvasCache = /^rgba?\(/.test(color) && colorAlpha(color) >= 1 ? color : "rgb(18, 18, 18)";
  return darkCanvasCache;
}

// The color the page's canvas paints across the whole frame, or null when it
// doesn't fully cover it (the frame's white then shows through, as intended).
export function frameCoveringBackdrop(doc: Document | null): string | null {
  const win = doc?.defaultView;
  const root = doc?.documentElement;
  if (doc == null || win == null || root == null) return null;
  const rootStyle = win.getComputedStyle(root);
  let layer = rootStyle.backgroundColor;
  let image = rootStyle.backgroundImage;
  if (colorAlpha(layer) === 0 && (image === "" || image === "none") && doc.body !== null) {
    const bodyStyle = win.getComputedStyle(doc.body);
    layer = bodyStyle.backgroundColor;
    image = bodyStyle.backgroundImage;
  }
  if (colorAlpha(layer) >= 1) return layer;
  if (usesDarkCanvas(doc, rootStyle.colorScheme)) return darkCanvasColor();
  return null;
}

export interface BackdropLogContext {
  tabId: string;
  hostId: number;
  slug: string;
}

// Every stylesheet link has finished loading (or failed to — its sheet stays
// null, so a broken link keeps the gap color until load: the safe side).
function stylesheetsLoaded(doc: Document): boolean {
  const links = doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet" i]');
  return Array.from(links).every((l) => l.disabled || l.sheet !== null);
}

// Watches the frame across its page changes and calls apply() with the
// covering color (null = keep the frame white). Apply synchronously — the
// gap starts right after pagehide, so a deferred render can let a white
// frame through. Returns the cleanup.
export function watchFrameBackdrop(
  frame: HTMLIFrameElement,
  apply: (color: string | null) => void,
  logCtx: () => BackdropLogContext,
): () => void {
  let last: string | null | undefined;
  let raf: number | null = null;
  let watchStartedAt = 0;
  // The page Window we listen on for pagehide — the page's own Window, not
  // the frame's contentWindow proxy (which follows navigations). One at a
  // time, so old pages' Windows aren't kept alive.
  let watchedWindow: Window | null = null;
  // Documents whose DOMContentLoaded has fired: parsing done AND deferred /
  // module scripts run (readyState "interactive" comes before those).
  const parsedDocs = new WeakSet<Document>();

  const set = (color: string | null, reason: string) => {
    if (color === last) return;
    last = color;
    apply(color);
    systemLogger.info(`[app-pane] backdrop ${color ?? "white"} (${reason})`, {
      operation: "app_pane_backdrop",
      ...logCtx(),
      color: color ?? "white",
      reason,
    });
  };

  const currentDoc = (): Document | null => {
    try {
      return frame.contentDocument;
    } catch {
      return null;
    }
  };

  const stopWatch = () => {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
  };

  const onPageHide = (e: Event) => {
    // A bfcache'd page (the whole Skynet tab going into back/forward cache)
    // comes back with no load event to undo a color — leave it white.
    if ((e as PageTransitionEvent).persisted === true) return;
    // The pane closing detaches the frame, which also fires pagehide.
    if (!frame.isConnected) return;
    const doc = currentDoc();
    if (doc === null) return;
    set(frameCoveringBackdrop(doc), "leaving");
    watchForNextPage(doc);
  };

  const unwatchPage = () => {
    try {
      watchedWindow?.removeEventListener("pagehide", onPageHide);
    } catch {
      // Window already gone.
    }
    watchedWindow = null;
  };

  const watchPage = (doc: Document) => {
    const win = doc.defaultView;
    if (win === null || win === watchedWindow) return;
    unwatchPage();
    watchedWindow = win;
    win.addEventListener("pagehide", onPageHide);
  };

  // Keep the leaving page's color until the next page either reports a
  // covering background (its own color — invisible under it) or is fully
  // styled with none (white). Until then its paint is blocked or unstyled,
  // and white would show through.
  const watchForNextPage = (leaving: Document) => {
    stopWatch();
    watchStartedAt = Date.now();
    const tick = () => {
      raf = null;
      const doc = currentDoc();
      if (doc === null) {
        set(null, "off-site");
        return;
      }
      if (doc !== leaving) {
        watchPage(doc);
        if (doc.readyState === "loading" && !parsedDocs.has(doc)) {
          doc.addEventListener("DOMContentLoaded", () => parsedDocs.add(doc), { once: true });
        }
        const cover = frameCoveringBackdrop(doc);
        if (cover !== null) {
          set(cover, "next-page");
          return;
        }
        if (parsedDocs.has(doc) && stylesheetsLoaded(doc)) {
          set(null, "next-page");
          return;
        }
      }
      if (Date.now() - watchStartedAt < BACKDROP_WATCH_CAP_MS) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };

  // Each loaded page: back to white (the page shows over it exactly as it
  // always has) and listen for it being left.
  const onLoad = () => {
    stopWatch();
    set(null, "load");
    const doc = currentDoc();
    if (doc !== null) watchPage(doc);
  };

  frame.addEventListener("load", onLoad);
  return () => {
    frame.removeEventListener("load", onLoad);
    stopWatch();
    unwatchPage();
  };
}
