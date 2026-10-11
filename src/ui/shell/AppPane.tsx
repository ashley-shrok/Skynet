import type { DragEvent as ReactDragEvent, ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCw } from "lucide-react";

import { buildAppMenuItems } from "@/features/pretty-conversations/app-menu-items";
import {
  RowKebabMenu,
  useRowKebabContextMenu,
  type RowKebabMenuItem,
} from "@/features/pretty-conversations/RowKebabMenu";
import { useIsMobile } from "@/hooks/use-mobile";
import { systemLogger } from "@/lib/frontend-logger";
import { encodeWorkspaceSpec, specForTab } from "@/lib/tab-url";
import { useAppTiles } from "@/state/app-tiles-store";
import {
  EMPTY_FRAME_HISTORY,
  canFrameGoBack,
  canFrameGoForward,
  observeFrameUrl,
  planFrameStep,
  type FrameHistory,
  type FrameNavKind,
} from "./app-frame-history";
import { armOutboundDrag, mintDragId } from "./cross-window-drag";
import { hasSkynetDragPayload } from "./SplitView";
import { subscribeDragSessionEnd } from "./drag-preview-session";

// ─── AppPane — Phase 120 Plan 06 (D-05, D-19, D-20) ─────────────────────────
//
// Single-purpose iframe wrapper that mounts inside the pane's leaf renderer
// for tab.type === "app". Renders the live authenticated web view of an app
// running on its home box, served under Skynet's own primary origin via the
// /apps/:hostId/:slug/pane/* reverse-proxy path (Plan 05).
//
// Skynet's contribution to the leaf is exactly the app bar (see § App bar
// below — drag handle, back/forward/reload, static app title) + the frame
// that hosts the app; the app owns everything below the bar. The pane stays
// transparent to the app: nothing is injected into it or signalled to it.
//
// Attribute discipline:
//   - `src` uses encodeURIComponent on BOTH hostId (defensive; a number cast
//     to string cannot contain URL-unsafe chars, but the consistency mirrors
//     the AppTile.tsx MEDIUM-1 fix pattern) and slug (T-120-32 mitigation:
//     slugs like `"../evil"` become `%2E%2E%2Fevil` — cannot break out of
//     the URL path segment; defence-in-depth atop the backend's APP_SLUG_RE
//     gate at the proxy boundary).
//   - Referrer policy: D-20 discipline — the pane sends NO signal to the
//     app about which Skynet page opened it (no custom header, no query
//     parameter, no injected JavaScript, no Referer leak).
//   - Eager load: the pane is visible immediately on tab open; deferring
//     first paint would show a blank leaf longer than necessary.
//   - Fully-permissive frame (T-120-34 accepted trade-off): app is same-
//     origin + fully authenticated + trusted at the pane level per shape
//     file philosophy; restricting frame permissions would break the app's
//     own JavaScript, forms, and cookies.
//   - `flex-1 min-h-0 w-full border-0 bg-white scheme-light` — fills the
//     leaf below the bar. No border, because the app owns the content area.
//     The white bg + light color-scheme reproduce a top-level tab's
//     browser-default-white canvas for apps that declare no background,
//     without touching the app document: when the iframe element's
//     color-scheme matches the app's (light by default) the app canvas is
//     transparent and this white shows through; an app declaring
//     `color-scheme: dark` mismatches and the browser paints an opaque dark
//     canvas instead — same as in its own tab. Never inject a background
//     into the app's html/body — a root-element background stops the app's
//     `body` background from propagating to the canvas, leaving short dark
//     apps white below their content (2026-10-09).
//   - `title={`App ${slug}`}` — accessibility affordance (iframes need a
//     title). Reflects the slug (NOT the app's live document.title per D-19
//     — the pane never peeks at the app's internal state).
//
// Failure surface (D-17): iframe naturally shows the browser's blank frame
// until first paint; tunnel failures render Phase 103's interstitial inside
// the frame via the proxy. No Skynet-authored placeholder here (fleet rule).
//
// ─── Iframe drag-passthrough (2026-09-21) ──────────────────────────────────
// Drag events (dragover/dragenter/drop) fire in the iframe's own document,
// not on the parent. Without intervention a Skynet drag (identity badge, conv
// row, app tile) landing on an app pane never reaches the Pane's outer
// dragover listener at SplitView.tsx:355 — no coral preview, drop silently
// ignored. While a Skynet drag is in flight we set the iframe's
// pointer-events to "none" so those events pass through to the pane element
// underneath. Gated on hasSkynetDragPayload so browser text-selection drags
// and OS file drags leave the iframe interactive.
//
// Restore rides the shared drag-session end (drag-preview-session.ts):
// window-capture drop (a bubble-phase drop listener never sees drops onto a
// split Pane — the Pane stopPropagation()s), dragend, or the dragover
// heartbeat watchdog for drags whose dragend is lost to a detached source.
// Restoring on watchdog is deliberate — a stuck-muted iframe eats every
// click. A watchdog can also fire mid-drag (cursor outside the window), so
// the next Skynet dragover re-mutes.
//
// ─── App bar (shape-app-pane-strip, 2026-10-09) ────────────────────────────
// The pane is no longer chrome-free: a glass bar sits above the iframe, always
// visible. The WHOLE bar (minus its buttons) is the pane's drag handle and
// writes the same application/x-skynet-badge payload an IdentityBadge does,
// so every existing badge drop path (split edges/center, the badge drop
// lane's Close zone, cross-window via the descriptor) applies with no
// app-specific branch. Sidebar sections don't take it (no sidebar row) and
// the lane offers no Archive for it. Not draggable on mobile (no split view there).
//
// Back / forward / reload act on the iframe only. The bar keeps its own list
// of the pages this pane has visited (app-frame-history.ts) and moves by
// loading the target page in place with location.replace() — it never
// traverses the browser's session history, which is shared by Skynet's page
// and every app frame (traversing it from one frame rewinds the others).
// Back never goes before the first page the pane showed. The list is fed from
// the frame's load events plus the Navigation API's navigation types where
// the browser has them (in-document pushState shows up only with the API).
//
// The bar shows the app's static title (sidebar tile metadata), never the
// app's live document.title. The only thing read from the frame is its
// current address, to keep the page list.
//
// Bar menu (2026-10-11): a ⋮ kebab at the bar's right end, and right-click on
// the bar, open the same RowKebabMenu an IdentityBadge has. Items: Move to new
// window (desktop) → Open in new tab → Rename… → Close (desktop) → Archive.
// The app actions come from buildAppMenuItems, shared with the sidebar tile,
// so both surfaces stay identical. Right-click inside the app itself is the
// app's own (separate document) and never reaches the bar.

// ─── Chrome auto-rendered-viewer dark-mode injection ──────────────────────
// When an app route returns Content-Type: application/json or text/plain,
// Chrome hands the response to its built-in viewer (JSON tree + Pretty-print
// checkbox for JSON; plain <pre> for text). Those viewers have minimal
// styling — transparent body bg + black text in light mode — so they render
// as near-invisible-black-text against Skynet's dark pane. Real app HTML is
// left untouched (D-20 pane-transparency to the app).
//
// The injected stylesheet flips html.color-scheme to dark (so Chrome remaps
// its own syntax-color palette to the dark variants) and paints an explicit
// bg matching --color-pv-base so the viewer blends into the pane chrome.
// Kept as a stylesheet-only injection (no JS side effects); the app can
// still respond to any programmatic-client Accept: application/json request
// exactly as before — this only touches what the human sees inside the pane.

const AUTO_RENDERED_VIEWER_STYLESHEET = `
  html { color-scheme: dark; background-color: #141520; }
  body { background-color: #141520; }
`;

// Exported for unit tests — the load handler wires this to iframe.contentDocument.
export function injectDarkViewerStylesheetIfApplicable(doc: Document | null): void {
  if (doc === null) return;
  const ct = doc.contentType ?? "";
  if (!ct.startsWith("application/json") && !ct.startsWith("text/plain")) return;
  const style = doc.createElement("style");
  style.textContent = AUTO_RENDERED_VIEWER_STYLESHEET;
  doc.head.appendChild(style);
}

type FrameWindow = Window & {
  navigation?: {
    activation?: { navigationType?: string } | null;
    addEventListener(type: string, cb: (e: Event) => void): void;
    removeEventListener(type: string, cb: (e: Event) => void): void;
  };
};

function frameWindow(el: HTMLIFrameElement | null): FrameWindow | null {
  return (el?.contentWindow as FrameWindow | null | undefined) ?? null;
}

// The frame's current address, or null when it can't be read (cross-origin
// after an off-site redirect) or is the initial blank document.
function frameUrl(el: HTMLIFrameElement | null): string | null {
  try {
    const href = frameWindow(el)?.location.href ?? null;
    if (href === null || href === "about:blank") return null;
    return href;
  } catch {
    return null;
  }
}

function toNavKind(t: unknown): FrameNavKind {
  return t === "push" || t === "replace" || t === "reload" || t === "traverse"
    ? t
    : "unknown";
}

// Skynet's floating sidebar-collapse toggle sits fixed at the content area's
// top-left. Returns how far the bar's contents must shift right to clear it
// (0 when the toggle isn't over the bar). The toggle only counts when its
// vertical middle falls inside the bar — the touch-device back button sits
// lower, over the app, not the bar. Exported for unit tests.
export function sidebarToggleClearance(
  barRect: Pick<DOMRect, "left" | "top" | "bottom">,
  toggleRect: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width"> | null,
): number {
  if (toggleRect === null || toggleRect.width === 0) return 0;
  const overlapsX = toggleRect.right > barRect.left && toggleRect.left < barRect.left + 40;
  const middleY = (toggleRect.top + toggleRect.bottom) / 2;
  const overlapsY = middleY >= barRect.top && middleY <= barRect.bottom;
  if (!overlapsX || !overlapsY) return 0;
  return Math.ceil(toggleRect.right - barRect.left) + 6;
}

const BAR_HEIGHT = 40;
// Width of the back/forward/reload group (3 × 26px + 2 × 2px gaps). The title
// column is centred between two columns of this width so it can never
// overlap the buttons, however narrow the pane.
const NAV_GROUP_WIDTH = 82;

export interface AppPaneProps {
  hostId: number;
  slug: string;
  tabId: string;
  isVisible: boolean;
  /** Tab label — fallback title when the app isn't in the tiles store. */
  label?: string;
  /** Clicking the bar selects this pane (split focus). */
  onSelectPane?: (tabId: string) => void;
  /** Bar menu's Close / Move to new window tear this pane down. */
  onCloseTab?: (tabId: string) => void;
  /** Bar menu's Archive — closes every open pane for this app. */
  onArchiveApp?: (hostId: number, slug: string, title: string) => void;
}

export function AppPane({
  hostId,
  slug,
  tabId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isVisible,
  label,
  onSelectPane,
  onCloseTab,
  onArchiveApp,
}: AppPaneProps): ReactElement {
  // isVisible is honoured by the parent Pane one layer up — matches
  // GuacamoleApp integration (parent manages visibility via CSS
  // display:none / hidden style; the iframe stays mounted so state is
  // preserved when the user swaps between leaves).
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  const tiles = useAppTiles();
  const tile = tiles.find((a) => a.hostId === String(hostId) && a.slug === slug);
  const title = (tile?.title ?? label ?? slug).trim() || slug;
  const initial = title.charAt(0).toUpperCase() || "?";
  const iconUrl = `/apps/${encodeURIComponent(hostId)}/${encodeURIComponent(slug)}/icon`;
  const [iconFailed, setIconFailed] = useState(false);
  useEffect(() => {
    setIconFailed(false);
  }, [iconUrl]);
  const showIcon = tile?.hasIcon === true && !iconFailed;

  // Bar menu (see § Bar menu above).
  const menuItems = useMemo<RowKebabMenuItem[]>(() => {
    const app = buildAppMenuItems({ hostId: String(hostId), slug, title }, onArchiveApp);
    const items: RowKebabMenuItem[] = [];
    // Desktop-only — mobile has no multi-window story.
    if (!isMobile) {
      const spec = specForTab({ type: "app", app: { hostId, slug } });
      if (spec !== null) {
        items.push({
          label: "Move to new window",
          testId: "app-pane-menu-move-new-window",
          onClick: () => {
            const w = window.open(
              "#" + encodeWorkspaceSpec({ tabs: [spec], activeIndex: 0, only: true }),
              "_blank",
            );
            systemLogger.info("[app-bar-menu] move to new window", {
              operation: "app_bar_menu_move_window",
              tabId,
              hostId,
              slug,
              opened: w !== null,
            });
            // Popup blocked → keep the pane rather than lose it.
            if (w !== null) onCloseTab?.(tabId);
          },
        });
      }
    }
    items.push(app.openInNewTab, app.rename);
    // Desktop-only: on a phone the pane IS the screen.
    if (!isMobile && onCloseTab) {
      items.push({
        label: "Close",
        testId: "app-pane-menu-close",
        onClick: () => onCloseTab(tabId),
      });
    }
    items.push(app.archive);
    return items;
  }, [hostId, slug, title, tabId, isMobile, onCloseTab, onArchiveApp]);
  const barContextMenu = useRowKebabContextMenu(menuItems);

  // Page list for back/forward (see § App bar above).
  const historyRef = useRef<FrameHistory>(EMPTY_FRAME_HISTORY);
  const [nav, setNav] = useState({ canBack: false, canForward: false });
  const publishNav = useCallback(() => {
    const h = historyRef.current;
    const next = { canBack: canFrameGoBack(h), canForward: canFrameGoForward(h) };
    setNav((prev) =>
      prev.canBack === next.canBack && prev.canForward === next.canForward ? prev : next,
    );
  }, []);
  const observe = useCallback(
    (kind: FrameNavKind) => {
      const url = frameUrl(iframeRef.current);
      if (url === null) return;
      historyRef.current = observeFrameUrl(historyRef.current, url, kind);
      publishNav();
    },
    [publishNav],
  );

  useEffect(() => {
    const mute = (e: DragEvent) => {
      if (!hasSkynetDragPayload(e.dataTransfer)) return;
      const el = iframeRef.current;
      if (el !== null && el.style.pointerEvents !== "none") {
        el.style.pointerEvents = "none";
      }
    };
    const unsubscribe = subscribeDragSessionEnd(() => {
      const el = iframeRef.current;
      if (el !== null) el.style.pointerEvents = "";
    });
    // dragstart mutes a local drag up front; dragover re-mutes after a
    // mid-drag watchdog restore (and covers drags started in another
    // Skynet window).
    window.addEventListener("dragstart", mute);
    window.addEventListener("dragover", mute);
    return () => {
      window.removeEventListener("dragstart", mute);
      window.removeEventListener("dragover", mute);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const el = iframeRef.current;
    if (el === null) return;
    // Each load is a fresh document with its own navigation object; in-
    // document pushState/replaceState fires currententrychange on it.
    // Re-subscribe per load so both kinds of page change reach the list.
    let subscribed: FrameWindow["navigation"] | null = null;
    const onEntryChange = (e: Event) => {
      observe(toNavKind((e as Event & { navigationType?: unknown }).navigationType));
    };
    const onLoad = () => {
      try {
        injectDarkViewerStylesheetIfApplicable(el.contentDocument);
      } catch {
        // Cross-origin access will throw a SecurityError; transient DOM
        // states can also raise here. Both are safe to swallow — the app
        // simply renders without the dark-viewer injection.
      }
      subscribed?.removeEventListener("currententrychange", onEntryChange);
      let navigation: FrameWindow["navigation"] | null = null;
      try {
        navigation = frameWindow(el)?.navigation ?? null;
      } catch {
        navigation = null;
      }
      subscribed = navigation;
      subscribed?.addEventListener("currententrychange", onEntryChange);
      observe(toNavKind(navigation?.activation?.navigationType));
    };
    el.addEventListener("load", onLoad);
    return () => {
      el.removeEventListener("load", onLoad);
      subscribed?.removeEventListener("currententrychange", onEntryChange);
    };
  }, [observe]);

  // Shift the bar's contents clear of the floating sidebar toggle. The toggle
  // slides (a CSS transition on its left edge) when the sidebar opens or
  // closes, and the pane resizes with it — re-measure on bar resize, window
  // resize, and the end of any transition.
  const [clearance, setClearance] = useState(0);
  useEffect(() => {
    const bar = barRef.current;
    if (bar === null) return;
    const measure = () => {
      const toggle = document.querySelector<HTMLElement>("[data-sidebar-toggle]");
      setClearance(
        sidebarToggleClearance(
          bar.getBoundingClientRect(),
          toggle ? toggle.getBoundingClientRect() : null,
        ),
      );
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(bar);
    window.addEventListener("resize", measure);
    window.addEventListener("transitionend", measure, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("transitionend", measure, true);
    };
  }, []);

  const onNavClick = (action: "back" | "forward" | "reload") => {
    const el = iframeRef.current;
    const h = historyRef.current;
    systemLogger.info(`[app-bar] ${action}`, {
      operation: "app_bar_nav",
      tabId,
      hostId,
      slug,
      index: h.index,
      length: h.entries.length,
    });
    try {
      if (action === "reload") {
        frameWindow(el)?.location.reload();
        return;
      }
      // Re-plan at click time — state can lag a fast double-click.
      const step = planFrameStep(h, action === "back" ? -1 : 1);
      if (step === null) {
        systemLogger.info(`[app-bar] ${action} refused — nowhere to go`, {
          operation: "app_bar_floor_guard",
          tabId,
          index: h.index,
          length: h.entries.length,
        });
        return;
      }
      historyRef.current = step.next;
      frameWindow(el)?.location.replace(step.url);
    } catch (err) {
      historyRef.current = { ...historyRef.current, pending: null };
      systemLogger.warn(`[app-bar] ${action} failed: ${(err as Error).message}`, {
        operation: "app_bar_nav",
        tabId,
      });
    }
  };

  // In a real browser, dragstart fires on the draggable bar even when the
  // press began on one of its buttons — so remember where the press started.
  const pressOnButtonRef = useRef(false);
  const isDragSource = !isMobile;
  const onBarDragStart = (e: ReactDragEvent<HTMLDivElement>) => {
    // A press that began on a button never drags the pane.
    if (pressOnButtonRef.current) {
      e.preventDefault();
      return;
    }
    const dragId = mintDragId();
    armOutboundDrag(dragId, tabId);
    e.dataTransfer.setData("text/plain", tabId);
    e.dataTransfer.setData(
      "application/x-skynet-badge",
      JSON.stringify({
        tabId,
        dragId,
        identityKey: null,
        hostId,
        descriptor: { tabType: "app", app: { hostId, slug }, label: title },
      }),
    );
    e.dataTransfer.effectAllowed = "move";
    systemLogger.info(`[app-bar-drag] tabId=${tabId} dragId=${dragId}`, {
      operation: "app_bar_drag_start",
      tabId,
      hostId,
      slug,
    });
  };

  const src = `/apps/${encodeURIComponent(hostId)}/${encodeURIComponent(slug)}/pane/`;
  const buttonClass =
    "inline-flex items-center justify-center w-[26px] h-[24px] rounded-md text-[color:var(--color-pv-fg-muted)] enabled:hover:text-[color:var(--color-pv-fg)] enabled:hover:bg-[rgba(232,228,216,0.08)] enabled:cursor-pointer disabled:opacity-30 transition-[color,background-color,opacity]";
  return (
    <div className="flex flex-col h-full w-full" data-testid="app-pane">
      <div
        ref={barRef}
        data-testid="app-pane-bar"
        draggable={isDragSource}
        onPointerDownCapture={(e) => {
          pressOnButtonRef.current = (e.target as HTMLElement).closest("button") !== null;
        }}
        onDragStart={isDragSource ? onBarDragStart : undefined}
        onClick={() => onSelectPane?.(tabId)}
        onContextMenu={barContextMenu.onContextMenu}
        className={`relative z-[1] grid flex-none items-center gap-2 px-2 select-none [-webkit-touch-callout:none] ${
          isDragSource ? "cursor-grab active:cursor-grabbing" : ""
        }`}
        style={{
          height: BAR_HEIGHT,
          gridTemplateColumns: `${NAV_GROUP_WIDTH}px minmax(0, 1fr) ${NAV_GROUP_WIDTH}px`,
          paddingLeft: clearance > 0 ? clearance : undefined,
          background:
            "linear-gradient(160deg, hsla(230, 14%, 24%, 0.85), hsla(230, 14%, 14%, 0.92))",
          borderBottom: "1px solid hsla(230, 30%, 70%, 0.2)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,220,170,0.10)",
        }}
      >
        <div className="flex gap-0.5">
          <button
            type="button"
            data-testid="app-pane-back"
            aria-label="Back"
            title="Back"
            draggable={false}
            disabled={!nav.canBack}
            onClick={() => onNavClick("back")}
            className={buttonClass}
          >
            <ChevronLeft width={16} height={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            data-testid="app-pane-forward"
            aria-label="Forward"
            title="Forward"
            draggable={false}
            disabled={!nav.canForward}
            onClick={() => onNavClick("forward")}
            className={buttonClass}
          >
            <ChevronRight width={16} height={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            data-testid="app-pane-reload"
            aria-label="Reload"
            title="Reload"
            draggable={false}
            onClick={() => onNavClick("reload")}
            className={buttonClass}
          >
            <RotateCw width={14} height={14} aria-hidden="true" />
          </button>
        </div>
        <div
          data-testid="app-pane-title"
          className="justify-self-center max-w-full flex items-center gap-[7px] min-w-0 pointer-events-none"
        >
          <span
            className="flex-none w-[18px] h-[18px] rounded-[5px] overflow-hidden grid place-items-center text-[10px] font-bold"
            style={{ background: "rgba(220,225,245,0.08)", color: "var(--color-pv-fg)" }}
            aria-hidden="true"
          >
            {showIcon ? (
              <img
                src={iconUrl}
                alt=""
                className="w-full h-full object-cover"
                draggable={false}
                onError={() => setIconFailed(true)}
              />
            ) : (
              initial
            )}
          </span>
          <span
            className="truncate"
            style={{ color: "var(--color-pv-fg)", fontSize: 13, fontWeight: 500 }}
          >
            {title}
          </span>
        </div>
        <div className="justify-self-end flex items-center" data-testid="app-pane-kebab-slot">
          <RowKebabMenu
            items={menuItems}
            ariaLabel={`${title} menu`}
            testId="app-pane-kebab-trigger"
          />
        </div>
        {barContextMenu.menu}
      </div>
      <iframe
        ref={iframeRef}
        src={src}
        title={`App ${slug}`}
        referrerPolicy="no-referrer"
        loading="eager"
        className="flex-1 min-h-0 w-full border-0 bg-white scheme-light"
        data-app-hostid={hostId}
        data-app-slug={slug}
        data-tab-id={tabId}
      />
    </div>
  );
}
