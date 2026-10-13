// ─── app-frame-no-history.ts ──────────────────────────────────────────────
// Keeps an app frame's page changes out of the browser's session history.
//
// The browser keeps ONE session history for the whole tab, shared by
// Skynet's page and every iframe (see app-frame-history.ts). Any page an app
// pushes lands on top of Skynet's own mobile list/view entry, so the phone's
// back gesture and the back-to-conversations button (history.back()) rewind
// the app instead of leaving it — and leaving any other way strands those
// entries behind as dead back presses. So every push the app makes is turned
// into a replace: the frame's current entry is swapped in place and the
// tab's history never grows. The app bar's own page list (told about each
// converted push via onPushConverted) is what back/forward inside the app
// walk; the phone's back gesture leaves the app for the conversation list.
//
// Three paths, all on the frame's own (same-origin) window:
//   - history.pushState is replaced by a call to replaceState (SPA routers).
//   - Navigation API `navigate` events for document loads and fragment jumps
//     are cancelled and re-issued with location.replace().
//   - Without the Navigation API, plain same-frame link clicks the app didn't
//     handle itself are re-issued with location.replace().
// Form posts and downloads are left alone: re-issuing them would drop the
// body or the download.

import { systemLogger } from "@/lib/frontend-logger";

interface NavigateEventLike extends Event {
  navigationType?: string;
  hashChange?: boolean;
  formData?: FormData | null;
  downloadRequest?: string | null;
  destination?: { url: string; sameDocument?: boolean };
}

interface NoHistoryWindow {
  history: History;
  location: Location;
  document: Document;
  navigation?: {
    addEventListener(type: string, cb: (e: Event) => void): void;
    removeEventListener(type: string, cb: (e: Event) => void): void;
  };
  addEventListener(type: string, cb: (e: Event) => void): void;
  removeEventListener(type: string, cb: (e: Event) => void): void;
}

export interface NoHistoryLogContext {
  tabId: string;
  hostId: number;
  slug: string;
}

/**
 * Install on a freshly loaded frame document. Returns a cleanup. Call again
 * on every load — each load is a new window.history / navigation object.
 */
export function keepFrameOutOfSessionHistory(
  win: NoHistoryWindow,
  onPushConverted: () => void,
  ctx: NoHistoryLogContext,
): () => void {
  const history = win.history;
  const originalPushState = history.pushState;
  const replaceState = history.replaceState.bind(history);
  const patchedPushState: History["pushState"] = (data, unused, url) => {
    onPushConverted();
    replaceState(data, unused, url);
  };
  history.pushState = patchedPushState;

  const replaceWith = (url: string, via: string) => {
    systemLogger.info("[app-frame-no-history] push converted to replace", {
      operation: "app_frame_push_to_replace",
      via,
      ...ctx,
    });
    onPushConverted();
    win.location.replace(url);
  };

  const navigation = win.navigation;
  const onNavigate = (event: Event) => {
    const e = event as NavigateEventLike;
    if (e.navigationType !== "push" || !e.cancelable) return;
    if (e.formData != null || e.downloadRequest != null) return;
    const dest = e.destination;
    if (!dest) return;
    // A same-document push that isn't a fragment jump can only come from a
    // pushState reference the app grabbed before we patched it. Re-issuing
    // it would reload the page and lose the app's in-memory state.
    if (dest.sameDocument && !e.hashChange) {
      systemLogger.warn("[app-frame-no-history] unpatched pushState left in history", {
        operation: "app_frame_push_unconverted",
        ...ctx,
      });
      return;
    }
    e.preventDefault();
    replaceWith(dest.url, e.hashChange ? "navigate_hash" : "navigate_document");
  };

  const onClick = (event: Event) => {
    const e = event as MouseEvent;
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const target = e.target as Element | null;
    const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor || anchor.hasAttribute("download")) return;
    // mailto:, tel:, javascript: and friends aren't page loads.
    if (anchor.protocol !== "http:" && anchor.protocol !== "https:") return;
    const frameTarget = anchor.getAttribute("target");
    if (frameTarget && frameTarget !== "_self") return;
    e.preventDefault();
    replaceWith(anchor.href, "link_click");
  };

  if (navigation) {
    navigation.addEventListener("navigate", onNavigate);
  } else {
    // Bubble phase so the app's own click handlers (SPA routers) run first
    // and can claim the click with preventDefault.
    win.addEventListener("click", onClick);
  }

  return () => {
    if (history.pushState === patchedPushState) history.pushState = originalPushState;
    navigation?.removeEventListener("navigate", onNavigate);
    if (!navigation) win.removeEventListener("click", onClick);
  };
}
