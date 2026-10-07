import {
  useCallback,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import type { AppState } from "../../api/fleet-status-types";
import { archiveApp } from "../../api/apps-archive-api";
import { renameApp, validateAppTitle } from "../../api/apps-rename-api";
import {
  publishAppGone,
  markPendingAppArchive,
  clearPendingAppArchive,
  setPendingAppTitle,
  clearPendingAppTitle,
} from "../../state/app-tiles-store";
// shape-sidebar-header-affordances: app tile context menu + long-press
// machinery retired; the actions (Open in new tab, Rename, Archive) now live in
// a RowKebabMenu rendered inside the tile. Hover-reveal on desktop +
// always-visible on mobile via a CSS-only group-hover + viewport-width gate
// at the kebab's wrapper div.
import { RowKebabMenu, type RowKebabMenuItem } from "./RowKebabMenu";

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

export function AppTile({ app, onOpenApp, onArchive, variant = "desktop" }: AppTileProps): React.ReactElement {
  const variantClass = variant === "mobile" ? "pv-app-tile--mobile" : "pv-app-tile--desktop";
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

  // shape-sidebar-header-affordances: onRowContextMenu + onTouchStart/Move/End
  // handlers RETIRED. The kebab is the sole affordance for the two actions.

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

  const kebabItems: RowKebabMenuItem[] = [
    {
      label: "Open in new tab",
      onClick: () => {
        // Defence-in-depth (RESEARCH.md §Security T-119-03-03 + T-119-03-04):
        // the third arg on this window.open call sets the tabnabbing-guard
        // window-features string, which prevents the new tab from
        // accessing window.opener AND suppresses the HTTP Referer header.
        window.open(openUrl, "_blank", "noopener,noreferrer");
      },
      testId: "pv-app-tile-kebab-item-open-new-tab",
    },
    // app-rename shape — title only (the slug is the app's identity). Native
    // window.prompt; an invalid entry re-prompts with the error and the
    // user's text pre-filled until it validates or they cancel. Sidebar
    // update: OPTIMISTIC via setPendingAppTitle (the store keeps the new
    // title over stale fleet-status frames until the sweep re-reads
    // app.json); rolled back via clearPendingAppTitle on failure.
    {
      label: "Rename…",
      testId: "pv-app-tile-kebab-item-rename",
      onClick: async () => {
        const previousTitle = app.title;
        let message = `Rename "${previousTitle}" to:`;
        let draft = previousTitle;
        let title: string;
        for (;;) {
          const input = window.prompt(message, draft);
          if (input === null) return;
          const v = validateAppTitle(input);
          if (v.ok) {
            title = v.title;
            break;
          }
          message = `${v.error}\n\nRename "${previousTitle}" to:`;
          draft = input;
        }
        if (title === previousTitle) return;

        setPendingAppTitle(app.hostId, app.slug, title);
        try {
          await renameApp(Number(app.hostId), app.slug, title);
        } catch (err) {
          clearPendingAppTitle(app.hostId, app.slug, previousTitle);
          const errMessage =
            err instanceof Error ? err.message : String(err);
          console.warn({
            operation: "app_rename_failed",
            hostId: Number(app.hostId),
            slug: app.slug,
            errMessage,
          });
          window.alert(
            `Failed to rename app "${previousTitle}": ${errMessage}`,
          );
        }
      },
    },
    // app-archive shape — Archive item, danger-styled, placed LAST (mirrors
    // the identity/role archive menu placement discipline; most destructive
    // at bottom). Uses two consecutive window.confirm dialogs (double-confirm
    // ceremony). Sidebar update: OPTIMISTIC via markPendingAppArchive +
    // publishAppGone — mirrors identity-archive's optimistic-remove.
    {
      label: "Archive",
      danger: true,
      testId: "pv-app-tile-kebab-item-archive",
      onClick: async () => {
        if (!window.confirm(`archive ${app.title}? this can't be undone.`)) return;
        if (!window.confirm("are you sure? this can't be undone.")) return;
        // Optimistic sidebar removal — mark pending FIRST so any in-flight
        // fleet-status app-update / app-snapshot frame is silent-dropped
        // rather than re-inserting the tile.
        markPendingAppArchive(app.hostId, app.slug);
        publishAppGone(app.hostId, app.slug);
        // Close any open tabs / panes pointing at this app. Parent-owned
        // because tabs live in AppShell state, not in a store. Fires with
        // the same (hostId, slug, title) shape as onOpenApp so the parent
        // can filter its tab list by the tab's `.app.hostId` / `.app.slug`
        // fields (Phase 120 D-02 tab shape).
        onArchive?.(Number(app.hostId), app.slug, app.title);
        // hostId is a string on the wire (AppState mirrors the backend
        // AppStateSchema); the archiveApp client accepts number. Cast at
        // the boundary, same as onTileClick's onOpenApp cast above.
        //
        // Alert-message content contract: errMessage flows from the
        // ApiError path (handleApiError in main-axios). The backend
        // archive endpoint redacts internal errors before responding
        // (500 body is a generic "failed to drop archive sentinel" — see
        // apps-archive.ts's try/catch), so the message surfaced here
        // stays at "network/transport-level failure" granularity. If
        // handleApiError's contract ever widens to propagate structured
        // backend details, this alert becomes a leak vector — review.
        try {
          await archiveApp(Number(app.hostId), app.slug);
        } catch (err) {
          // Rollback: clear the pending flag so the next fleet-status
          // pulse (still coming — app is alive on the backend) re-inserts
          // the tile via the normal publishAppUpdate / publishAppSnapshot
          // path. The closed tab is NOT re-opened — a rare edge case, and
          // the user still sees the failure alert so they can re-open it
          // manually if they need to.
          clearPendingAppArchive(app.hostId, app.slug);
          const errMessage =
            err instanceof Error ? err.message : String(err);
          console.warn({
            operation: "app_archive_failed",
            hostId: Number(app.hostId),
            slug: app.slug,
            errMessage,
          });
          window.alert(
            `Failed to archive app "${app.title}": ${errMessage}`,
          );
        }
      },
    },
  ];

  return (
    <div
      className={`group pv-app-tile ${variantClass} relative`}
      role="button"
      aria-label={`App tile: ${app.title}`}
      draggable={true}
      onDragStart={onTileDragStart}
      onClick={onTileClick}
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
      {/* shape-sidebar-header-affordances: tile kebab. Absolute-positioned top-
          right. Hover-reveal on desktop (opacity-0 → md:group-hover:opacity-100
          + md:group-focus-within for keyboard a11y); always-visible on mobile
          (opacity-100 at <md). RowKebabMenu's portal-click-containment stops
          item onClicks from leaking to the tile's onClick (which opens the app). */}
      <div
        className="absolute top-1.5 right-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity shrink-0 z-[5]"
        data-testid="pv-app-tile-kebab-slot"
      >
        <RowKebabMenu
          ariaLabel={`${app.title} menu`}
          testId="pv-app-tile-kebab-trigger"
          items={kebabItems}
        />
      </div>
    </div>
  );
}
