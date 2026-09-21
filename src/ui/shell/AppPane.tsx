import type { ReactElement } from "react";
import { useEffect, useRef } from "react";

import { hasSkynetDragPayload } from "./SplitView";

// ─── AppPane — Phase 120 Plan 06 (D-05, D-19, D-20) ─────────────────────────
//
// Single-purpose iframe wrapper that mounts inside the pane's leaf renderer
// for tab.type === "app". Renders the live authenticated web view of an app
// running on its home box, served under Skynet's own primary origin via the
// /apps/:hostId/:slug/pane/* reverse-proxy path (Plan 05).
//
// The iframe IS the entire in-pane view. Skynet draws no chrome around the
// app inside the leaf — the leaf's own title bar (D-19: static app title
// from tab.label) is the ONLY Skynet-authored surface visible in the leaf.
// This preserves the pane-is-transparent-to-the-app philosophy locked by
// the shape file — Skynet's contribution to the leaf is exactly the title
// bar + the frame that hosts the app; the app owns the entire content area.
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
//   - `className="h-full w-full border-0"` — fills the leaf. No border,
//     because the app owns the entire content area.
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
// underneath; dragend/drop restore. Gated on hasSkynetDragPayload so browser
// text-selection drags and OS file drags leave the iframe interactive.

export interface AppPaneProps {
  hostId: number;
  slug: string;
  tabId: string;
  isVisible: boolean;
}

export function AppPane({
  hostId,
  slug,
  tabId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isVisible,
}: AppPaneProps): ReactElement {
  // isVisible is honoured by the parent Pane one layer up — matches
  // GuacamoleApp integration (parent manages visibility via CSS
  // display:none / hidden style; the iframe stays mounted so state is
  // preserved when the user swaps between leaves).
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const onDragStart = (e: DragEvent) => {
      if (!hasSkynetDragPayload(e.dataTransfer)) return;
      const el = iframeRef.current;
      if (el !== null) el.style.pointerEvents = "none";
    };
    const restore = () => {
      const el = iframeRef.current;
      if (el !== null) el.style.pointerEvents = "";
    };
    window.addEventListener("dragstart", onDragStart);
    window.addEventListener("dragend", restore);
    // Belt-and-braces: some drag sources (e.g. rows removed from a filtered
    // list mid-drop) are unmounted before dragend fires. drop on window is
    // the last-chance signal that the drag has ended.
    window.addEventListener("drop", restore);
    return () => {
      window.removeEventListener("dragstart", onDragStart);
      window.removeEventListener("dragend", restore);
      window.removeEventListener("drop", restore);
    };
  }, []);

  const src = `/apps/${encodeURIComponent(hostId)}/${encodeURIComponent(slug)}/pane/`;
  return (
    <iframe
      ref={iframeRef}
      src={src}
      title={`App ${slug}`}
      referrerPolicy="no-referrer"
      loading="eager"
      className="h-full w-full border-0"
      data-app-hostid={hostId}
      data-app-slug={slug}
      data-tab-id={tabId}
    />
  );
}
