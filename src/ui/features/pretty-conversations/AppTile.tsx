import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
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
//   - LEFT-CLICK (D-06, Phase 120): opens the app in a pane leaf via the
//     onOpenApp prop. AppShell wires this to
//     `openTab(null, "app", ..., { app: { hostId, slug }, label: title })`.
//     The suppressNextClickRef gate suppresses the synthesized click that
//     follows a long-press so long-press doesn't double-fire menu AND
//     onOpenApp (Pitfall 4). Unhealthy tiles remain clickable — health does
//     NOT gate the click (D-18); the proxy attempts a connection and Phase
//     103's interstitial renders inside the iframe if the tunnel refuses.
//     Phase 119's Phase-119-Plan-03 D-13 shipped this as a deliberate no-op
//     with `cursor: default`; Phase 120 flips both (pretty-conversations.css
//     `.pv-app-tile` now sets `cursor: pointer`).
//   - DRAG (D-07, Phase 120): dragStart emits an
//     `application/x-skynet-app-tile` JSON payload carrying
//     `{ hostId, slug, title }` (hostId cast to number at the wire boundary
//     — see AppTileProps.onOpenApp for the number-vs-string rationale).
//     effectAllowed = "copy" (drag CREATES a new leaf; does NOT MOVE the
//     tile). Does NOT set `text/plain` — Phase 64 closure at
//     SplitView.tsx:596-608 (bare text/plain drags are a stray-drop hazard).
//     SplitView's `hasSkynetDragPayload` gate + onDrop dispatch pick up the
//     new MIME and route to `onDropAppTileInTree` on AppShell.
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
// Hue discipline (D-09 + code-review HIGH-2 fix pass 2026-09-18):
//   The tile does NOT emit an INLINE per-tile hue style from React (the
//   test in AppTile.test.tsx locks that: `tile.style.--pv-hue === ""`).
//   The 216 hue lives in the CSS rule for `.pv-app-tile` itself
//   (pretty-conversations.css) as an explicit `--pv-hue: 216;` declaration.
//   Custom properties inherit from ANCESTORS only — `.pv-app-tile` is a
//   SIBLING to `.pv-row` (both under `.pv-panel-scroll`), so `.pv-row`'s
//   hue does NOT cascade here. Prior comment claimed otherwise; that
//   claim was wrong and produced the HIGH-2 bug (tile fell back to
//   `.dark { --pv-hue: 190 }` from ui/index.css). Do NOT emit a per-tile
//   inline hue style from this component — the class rule owns it.
//
// XSS surface (RESEARCH.md §Security):
//   `app.healthMessage` and `app.title` are React text nodes — auto-
//   escaped, zero XSS surface. No raw-HTML injection APIs are used
//   anywhere in this file (grep-gated at zero).
// ─────────────────────────────────────────────────────────────────────────

export interface AppTileProps {
  app: AppState;
  // Phase 120 D-06 — left-click callback. When present, a plain click on the
  // tile (that is NOT the synthesized click following a long-press) invokes
  // `onOpenApp(Number(app.hostId), app.slug, app.title)`. AppShell wires this
  // to `openTab(null, "app", ..., { app: { hostId, slug }, label: title })`.
  // Optional so unit tests + preview surfaces can render the tile without
  // requiring the parent to wire the callback. `hostId` is cast to number at
  // the wire boundary because `AppState.hostId` is string per
  // fleet-status-types.ts:136, but Tab.app.hostId (Phase 120 Plan 04) is a
  // number — this component unifies the two representations at the tile
  // → openTab boundary.
  onOpenApp?: (hostId: number, slug: string, title: string) => void;
  // Density variant — mirrors PrettyConversationRow's `variant` prop. Drives
  // the `pv-app-tile--mobile` vs `pv-app-tile--desktop` class toggle so tiles
  // pick up the same compact desktop / larger-mobile treatment as sibling
  // conversation rows. Optional + defaults to "desktop" so unit tests and
  // preview surfaces can render without wiring the panel's variant plumbing.
  variant?: "mobile" | "desktop";
}

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

export function AppTile({ app, onOpenApp, variant = "desktop" }: AppTileProps): React.ReactElement {
  const variantClass = variant === "mobile" ? "pv-app-tile--mobile" : "pv-app-tile--desktop";
  // State: image-load failure (Pitfall 3 avoidance — state flip beats CSS
  // :where(img[error]) which has patchy browser support), and context-menu
  // open coords.
  const [imgFailed, setImgFailed] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  // ─── Long-press refs (mirrors PrettyConversationRow.tsx:442-451) ────────
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  // Pitfall 4 (Phase 119 RESEARCH.md) — set to true by the long-press timer
  // body so the synthesized click that follows a long-press touch does NOT
  // re-fire onOpenApp (Phase 120 D-06 wired this ref up; Phase 119 kept it
  // as forward-compat scaffold). Consumed by `onTileClick` below.
  const suppressNextClickRef = useRef<boolean>(false);

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

  // Phase 120 D-06 — plain left-click opens the app in a pane leaf via the
  // onOpenApp prop. Long-press suppression preserved via suppressNextClickRef
  // (Pitfall 4): the long-press timer body sets the ref to true; a
  // subsequent synthesized click reads-and-resets the ref and returns
  // without firing onOpenApp. D-15 multi-instance: no dedupe here — the
  // click callback fires every time, and AppShell's openTab creates a fresh
  // leaf each call.
  const onTileClick = useCallback(
    (_e: ReactMouseEvent<HTMLDivElement>) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      // hostId is a string on the wire (fleet-status-types.ts:136); cast to
      // number to match Tab.app.hostId's numeric shape (ui-types.ts).
      onOpenApp?.(Number(app.hostId), app.slug, app.title);
    },
    [app.hostId, app.slug, app.title, onOpenApp],
  );

  // Phase 120 D-07 — drag source. Emits application/x-skynet-app-tile with
  // a JSON payload {hostId, slug, title}; SplitView's hasSkynetDragPayload
  // gate (SplitView.tsx:187-192) is extended to accept this third MIME and
  // its onDrop dispatch has a new branch that routes the parsed payload
  // through AppShell's onDropAppTileInTree callback.
  //
  // effectAllowed = "copy" because dragging a tile CREATES a new leaf; the
  // sidebar tile itself remains — this is a create-new gesture, not a move.
  //
  // MUST NOT setData("text/plain", ...) — Phase 64 closure at
  // SplitView.tsx:596-608 (bare text/plain drags used to be a session-tabId
  // fallback that stray browser drags could exploit; removed to fail-closed).
  const onTileDragStart = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      e.dataTransfer.setData(
        "application/x-skynet-app-tile",
        JSON.stringify({
          hostId: Number(app.hostId),
          slug: app.slug,
          title: app.title,
        }),
      );
      e.dataTransfer.effectAllowed = "copy";
    },
    [app.hostId, app.slug, app.title],
  );

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
      className={`pv-app-tile ${variantClass}`}
      role="button"
      aria-label={`App tile: ${app.title}`}
      draggable={true}
      onDragStart={onTileDragStart}
      onClick={onTileClick}
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
