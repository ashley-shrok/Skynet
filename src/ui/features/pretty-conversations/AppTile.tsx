import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";

import type { AppState } from "../../api/fleet-status-types";
import {
  PrettyConversationContextMenu,
  type PrettyContextMenuItem,
} from "./PrettyConversationContextMenu";

// ─── AppTile — Phase 119 Plan 03 (D-07..D-13) ───────────────────────────────
// One tile in the sidebar's Apps section (119-04 integrates it into
// PrettyConversationsPanel). Standalone component in this plan so visual
// regressions can be diagnosed against tests scoped to this file.
//
// Data source: a single AppState prop from the app-tiles store (119-02 hook
// `useAppTiles()`). Panel-level composition + section chrome are 119-04's
// responsibility. This component knows nothing about the panel.
//
// Interaction shape:
//   - LEFT-CLICK (D-13): deliberate NO-OP in v1. cursor: default in the CSS
//     (pretty-conversations.css `.pv-app-tile`) plus zero onClick handler
//     wiring. Shape 4 will own primary-click for "open in current view /
//     drag into split leaf"; deferring means shape 4 doesn't have to migrate
//     an affordance from another mapping later. suppressNextClickRef is
//     RETAINED as a forward-compat pin for shape 4 (Pitfall 4 mitigation)
//     even though nothing in this file consumes its value.
//   - RIGHT-CLICK (D-12, desktop): fires onContextMenu → opens
//     PrettyConversationContextMenu with one item: "Open in new tab".
//   - LONG-PRESS (D-12, mobile / coarse-pointer): 500ms touchstart timer;
//     10px movement cancels; timer fire triggers the same context menu at
//     the touch coords. navigator.vibrate?.(10) is feature-checked because
//     iOS Safari does not implement the API (Pitfall 4). Handlers mirror
//     PrettyConversationRow.tsx:442-451 + :595-603 exactly.
//   - "OPEN IN NEW TAB" action: opens the app's URL in a fresh tab with
//     the tabnabbing-defence window-features string set (see the callsite
//     below for the exact args). The URL construction mirrors the backend
//     GET /apps/:hostId/:slug/icon path shape (RESEARCH.md discretion);
//     the window-features string is the RESEARCH.md §Security defence-in-
//     depth win against window.opener abuse and Referer leakage.
//
// Visual shape (D-10 + D-11):
//   - .pv-app-tile: .pv-row glass bubble treatment (padded rectangle,
//     gradient, hover lift, drop shadow) inherited from CSS; the only
//     overrides vs .pv-row are `cursor: default` (D-13) and the absence of
//     a `.selected` variant (D-13 — no primary-click affordance to reflect).
//   - .pv-app-icon-slot: rounded-square (10px border-radius per D-10 Claude
//     discretion, iOS-app-icon target) at .pv-avatar's 40×40 dimensions
//     with the same gradient / border / shadow / letter typography.
//   - Icon slot children (branching on `hasIcon` + `imgFailed` state flip
//     per RESEARCH.md recommendation): either an <img src={iconUrl}
//     onError={...}> or a `<span className="pv-app-icon-initial">L</span>`
//     first-letter monogram (D-08). The letter inherits typography from
//     the parent .pv-app-icon-slot — the .pv-app-icon-initial class has
//     NO standalone CSS rule (mirrors the identity-row .pv-avatar-initial
//     discipline; Pitfall 3 mitigation).
//   - .pv-app-body: vertical flex column, title above optional
//     healthMessage. Single-line title (D-10, no `.pv-body` secondary
//     line). Two-line only when !isHealthy && healthMessage != null (D-11).
//
// Hue discipline (D-09):
//   The tile does NOT emit an inline per-tile hue style. The .pv-row
//   fallback declared at pretty-conversations.css:338 cascades into
//   .pv-app-tile via CSS inheritance. Never emit a custom-property style
//   for the hue token on the tile root — that would violate D-09 and is
//   grep-gated at zero in this file.
//
// XSS surface (RESEARCH.md §Security):
//   `app.healthMessage` and `app.title` are React text nodes — auto-
//   escaped, zero XSS surface. No raw-HTML injection APIs are used
//   anywhere in this file (grep-gated at zero).
// ─────────────────────────────────────────────────────────────────────────

export interface AppTileProps {
  app: AppState;
}

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

export function AppTile({ app }: AppTileProps): React.ReactElement {
  // State: image-load failure (Pitfall 3 avoidance — state flip beats CSS
  // :where(img[error]) which has patchy browser support), and context-menu
  // open coords.
  const [imgFailed, setImgFailed] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  // ─── Long-press refs (mirrors PrettyConversationRow.tsx:442-451) ────────
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  // Pitfall 4 (RESEARCH.md) — retained for shape 4 forward-compat even
  // though D-13 makes left-click a no-op in v1. When shape 4 wires a real
  // left-click behavior, this ref lets the long-press timer suppress the
  // synthesized click that follows so long-press doesn't double-fire menu
  // AND left-click. Nothing in v1 reads this ref, but removing it now would
  // force shape 4 to re-add + re-verify a solved pattern.
  const suppressNextClickRef = useRef<boolean>(false);
  // Suppress the "unused" lint by touching the ref once in an inert
  // effect-free path. This costs zero runtime and preserves the forward-
  // compat intent above.
  void suppressNextClickRef;

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // Cleanup pending timer on unmount so a late timer fire never calls
  // setCtxMenu on an unmounted component.
  useEffect(() => {
    return () => {
      clearLongPressTimer();
    };
  }, [clearLongPressTimer]);

  const closeSelf = useCallback(() => setCtxMenu(null), []);

  const onRowContextMenu = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu({ x: e.clientX, y: e.clientY });
    },
    [],
  );

  const onTouchStart = useCallback(
    (e: ReactTouchEvent<HTMLDivElement>) => {
      const t = e.touches[0];
      if (!t) return;
      const x = t.clientX;
      const y = t.clientY;
      longPressStartRef.current = { x, y };
      clearLongPressTimer();
      longPressTimerRef.current = window.setTimeout(() => {
        setCtxMenu({ x, y });
        // Feature-checked — iOS Safari has no navigator.vibrate. The
        // optional-chain guard MUST stay so the timer body doesn't throw
        // (Pitfall 4).
        navigator.vibrate?.(10);
        suppressNextClickRef.current = true;
        longPressTimerRef.current = null;
      }, LONG_PRESS_MS);
    },
    [clearLongPressTimer],
  );

  const onTouchMove = useCallback((e: ReactTouchEvent<HTMLDivElement>) => {
    const start = longPressStartRef.current;
    if (!start) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE_PX) {
      // Movement gate — cancel long-press so vertical scroll / swipe wins.
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }, []);

  // URL construction — mirrors the backend GET /apps/:hostId/:slug/icon
  // path shape (D-06 / RESEARCH.md discretion). The "Open in new tab"
  // action opens the app's own URL, NOT the /icon subpath.
  //
  // Code-review MEDIUM-1 (fix pass 2026-09-18): defensive
  // encodeURIComponent on both hostId and slug — today APP_SLUG_RE gates
  // the wire (hostId numeric, slug kebab-case), so unencoded interpolation
  // is safe. But encoding here means a future backend regression that
  // widens either shape cannot expose an unencoded interpolation from
  // this frontend surface. Cheap defence-in-depth.
  const iconUrl = `/apps/${encodeURIComponent(app.hostId)}/${encodeURIComponent(app.slug)}/icon`;
  const openUrl = `/apps/${encodeURIComponent(app.hostId)}/${encodeURIComponent(app.slug)}`;

  const showFallback = !app.hasIcon || imgFailed;
  const initialLetter =
    app.title.trim().charAt(0).toUpperCase() || "?";

  const menuItems: PrettyContextMenuItem[] = [
    {
      label: "Open in new tab",
      onClick: () => {
        // Defence-in-depth (RESEARCH.md §Security T-119-03-03 + T-119-03-04):
        // the third arg on this window.open call sets the tabnabbing-guard
        // window-features string, which prevents the new tab from
        // accessing window.opener AND suppresses the HTTP Referer header.
        window.open(openUrl, "_blank", "noopener,noreferrer");
      },
    },
  ];

  return (
    <div
      className="pv-app-tile"
      role="button"
      aria-label={`App tile: ${app.title}`}
      onContextMenu={onRowContextMenu}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      data-testid="pv-app-tile"
      data-app-key={`${app.hostId}:${app.slug}`}
    >
      <div className="pv-app-icon-slot">
        {showFallback ? (
          <span className="pv-app-icon-initial">{initialLetter}</span>
        ) : (
          <img
            src={iconUrl}
            alt=""
            className="pv-app-icon-img"
            onError={() => setImgFailed(true)}
            draggable={false}
          />
        )}
      </div>
      <div className="pv-app-body">
        <span className="pv-app-title">{app.title}</span>
        {!app.isHealthy && app.healthMessage != null && (
          <span className="pv-app-unhealthy-message">{app.healthMessage}</span>
        )}
      </div>
      {ctxMenu !== null && (
        <PrettyConversationContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={menuItems}
          onClose={closeSelf}
        />
      )}
    </div>
  );
}
