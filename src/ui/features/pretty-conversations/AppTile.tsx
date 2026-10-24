import {
  useCallback,
  useEffect,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import type { AppState } from "../../api/fleet-status-types";
import { appIconUrl } from "./app-icon-url";
import { buildAppMenuItems } from "./app-menu-items";
// The actions (Open in new tab, Open standalone, Rename, Archive) live in a
// RowKebabMenu inside the tile: right-click with a mouse, press-and-hold on a
// touch screen (row-touch-gestures.ts), the ⋮ on keyboard focus.
import { RowKebabMenu, useRowKebabContextMenu, type RowKebabMenuItem } from "./RowKebabMenu";
import { isCoarsePointer, useRowTouchGestures } from "./row-touch-gestures";

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
//     The click that follows a press-and-hold is swallowed so the hold
//     doesn't open the menu AND the app. Unhealthy tiles remain clickable — health does
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
//     the same kebab menu (useRowKebabContextMenu).
//   - PRESS-AND-HOLD (touch): useRowTouchGestures — a 500ms hold opens the
//     same menu at the finger; moving the finger cancels it.
//   - KEBAB actions (Open in new tab [desktop], Open standalone, Rename…,
//     Archive): built by
//     buildAppMenuItems (app-menu-items.ts), shared with the AppPane bar.
//
// Visual shape: one cell of the sidebar's phone-style icon grid
// (.pv-apps-grid in pretty-conversations.css) — rounded-square icon with the
// name centered underneath. Icon slot is either an <img src={iconUrl}
// onError={...}> or a first-letter monogram (.pv-app-icon-initial, which has
// no rule of its own — it inherits from .pv-app-icon-slot). Unhealthy tiles
// get .pv-app-tile--unhealthy (greyed icon, ⚠ name); the health message shows
// under the name on touch screens and moves to the title tooltip with a mouse.
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
  // Fired after the user confirms Archive (both dialogs accepted) so the
  // parent can close any open tabs/panes that point at this app. Runs
  // AFTER the optimistic publishAppGone drop (tile is already off the
  // grid) but BEFORE the awaited archiveApp resolves, so the pane close
  // and the tile removal appear together to the user rather than staggered
  // by the API round-trip. Mirrors identity-archive's handleRowDeactivate
  // composition — this component owns the store optimistic-remove; the
  // parent owns anything that touches AppShell-level state (tabs, split
  // tree). Optional so preview surfaces / older tests can render without
  // wiring the callback.
  onArchive?: (hostId: number, slug: string, title: string) => void;
  // Density variant — mirrors PrettyConversationRow's `variant` prop. Drives
  // the `pv-app-tile--mobile` vs `pv-app-tile--desktop` class toggle so tiles
  // pick up the same compact desktop / larger-mobile treatment as sibling
  // conversation rows. Optional + defaults to "desktop" so unit tests and
  // preview surfaces can render without wiring the panel's variant plumbing.
  variant?: "mobile" | "desktop";
}

const UNHEALTHY_HINT = "ask an agent to check on it.";

function unhealthyTooltip(healthMessage: string | null): string {
  return healthMessage != null
    ? `${healthMessage} — ${UNHEALTHY_HINT}`
    : `This app isn't working — ${UNHEALTHY_HINT}`;
}

export function AppTile({ app, onOpenApp, onArchive, variant = "desktop" }: AppTileProps): React.ReactElement {
  const variantClass = variant === "mobile" ? "pv-app-tile--mobile" : "pv-app-tile--desktop";
  // Same mobile signal conversation rows use (PrettyConversationRow).
  const isMobile = variant === "mobile";
  // State: image-load failure (Pitfall 3 avoidance — state flip beats CSS
  // :where(img[error]) which has patchy browser support).
  const [imgFailed, setImgFailed] = useState(false);

  // shape-sidebar-header-affordances: ctxMenu useState + long-press refs +
  // suppressNextClickRef + clearLongPressTimer + onRowContextMenu +
  // onTouchStart/Move/End handlers all RETIRED alongside the context menu
  // machinery. RowKebabMenu's portal-click-containment prevents the kebab
  // trigger click from bubbling to onTileClick, so no suppression ref is
  // needed on the click path.

  // Phase 120 D-06 — plain left-click opens the app in a pane leaf via the
  // onOpenApp prop. D-15 multi-instance: no dedupe here — the click callback
  // fires every time, and AppShell's openTab creates a fresh leaf each call.
  const onTileClick = useCallback(
    (_e: ReactMouseEvent<HTMLDivElement>) => {
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


  // URL construction — mirrors the backend GET /apps/:hostId/:slug/icon
  // path shape (D-06 / RESEARCH.md discretion).
  //
  // Code-review MEDIUM-1 (fix pass 2026-09-18): defensive
  // Versioned URL (see appIconUrl) — lets the browser keep the icon across
  // collapse/expand of the Apps section instead of refetching it.
  const iconUrl = appIconUrl(app.hostId, app.slug, app.iconVersion);
  // A new icon version is a new URL; give it a fresh chance to load.
  useEffect(() => {
    setImgFailed(false);
  }, [iconUrl]);

  const showFallback = !app.hasIcon || imgFailed;
  const initialLetter =
    app.title.trim().charAt(0).toUpperCase() || "?";

  // Actions shared with the open app pane's bar kebab (app-menu-items.ts);
  // the tile keeps its own test ids.
  const menu = buildAppMenuItems(app, onArchive);
  const kebabItems: RowKebabMenuItem[] = [
    // Desktop-only — a phone has no multi-window story.
    ...(isMobile
      ? []
      : [{ ...menu.openInNewWindow, testId: "pv-app-tile-kebab-item-open-new-window" }]),
    { ...menu.openStandalone, testId: "pv-app-tile-kebab-item-open-standalone" },
    { ...menu.rename, testId: "pv-app-tile-kebab-item-rename" },
    { ...menu.archive, testId: "pv-app-tile-kebab-item-archive" },
  ];
  // Right-click on the tile opens the same kebab menu at the cursor;
  // press-and-hold opens it on a touch screen, like a home screen.
  const kebabContextMenu = useRowKebabContextMenu(kebabItems);
  const touch = useRowTouchGestures({ onHold: kebabContextMenu.openAt });

  return (
    <div
      className={`group pv-app-tile ${variantClass} relative${app.isHealthy ? "" : " pv-app-tile--unhealthy"}`}
      role="button"
      aria-label={
        app.isHealthy
          ? `App tile: ${app.title}`
          : `App tile: ${app.title} (not working — ${app.healthMessage ?? UNHEALTHY_HINT})`
      }
      // The grid hides the health line visually; hover surfaces it instead,
      // with the fix the user can act on.
      title={app.isHealthy ? undefined : unhealthyTooltip(app.healthMessage)}
      // A draggable tile would turn a press-and-hold into a drag on phones.
      draggable={!isCoarsePointer()}
      onDragStart={onTileDragStart}
      onClick={onTileClick}
      {...touch.handlers}
      onContextMenu={kebabContextMenu.onContextMenu}
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
      {/* Tile kebab, top-right. Shown only on keyboard focus (pv-app-tile-
          kebab-slot in the grid CSS): right-click is the menu with a mouse,
          press-and-hold on a touch screen. RowKebabMenu's portal-click-
          containment stops item onClicks from leaking to the tile's onClick
          (which opens the app). */}
      <div
        className="pv-app-tile-kebab-slot"
        data-testid="pv-app-tile-kebab-slot"
      >
        <RowKebabMenu
          ariaLabel={`${app.title} menu`}
          testId="pv-app-tile-kebab-trigger"
          items={kebabItems}
        />
        {kebabContextMenu.menu}
      </div>
    </div>
  );
}
