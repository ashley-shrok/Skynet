import { archiveApp } from "../../api/apps-archive-api";
import { encodeWorkspaceSpec, specForTab } from "../../lib/tab-url";
import { renameApp, validateAppTitle } from "../../api/apps-rename-api";
import {
  publishAppGone,
  markPendingAppArchive,
  clearPendingAppArchive,
  setPendingAppTitle,
  clearPendingAppTitle,
} from "../../state/app-tiles-store";
import type { RowKebabMenuItem } from "./RowKebabMenu";

// ─── App menu items — shared by the sidebar AppTile and the AppPane bar ─────
//
// The per-app actions (Open in new window, Open standalone, Rename…, Archive)
// live here so the sidebar tile's kebab and an open app pane's bar kebab
// offer the same actions with the same copy and side effects. Each surface
// adds its own placement-specific items around these — the bar swaps Open in
// new window for Move to new window (opens, then closes that pane) and adds
// Close. Same open/move split as conversation rows vs. badges.
//
// `hostId` is the wire string (AppState.hostId); the API clients take a
// number, cast at the boundary.

export interface AppMenuTarget {
  hostId: string;
  slug: string;
  title: string;
}

/** Opens the app as the only pane of a new Skynet window. null = popup
 *  blocked (or no spec), so callers never tear down a pane on failure. */
export function openAppInNewWindow(hostId: number, slug: string): Window | null {
  const spec = specForTab({ type: "app", app: { hostId, slug } });
  if (spec === null) return null;
  return window.open(
    "#" + encodeWorkspaceSpec({ tabs: [spec], activeIndex: 0, only: true }),
    "_blank",
  );
}

export interface AppMenuItems {
  /** Desktop-only — callers gate on isMobile (no multi-window on a phone).
   *  Leaves any panes already showing the app alone: an app can back
   *  several panes at once. */
  openInNewWindow: RowKebabMenuItem;
  openStandalone: RowKebabMenuItem;
  rename: RowKebabMenuItem;
  archive: RowKebabMenuItem;
}

export function buildAppMenuItems(
  app: AppMenuTarget,
  // Fired after the user confirms Archive, once the tile is optimistically
  // dropped and BEFORE the awaited archiveApp resolves, so the parent can
  // close every open pane for this app in the same beat as the tile vanishes.
  onArchive?: (hostId: number, slug: string, title: string) => void,
): AppMenuItems {
  // Defensive encodeURIComponent on both segments — APP_SLUG_RE gates the
  // wire today, but encoding here means a future widening can't expose an
  // unencoded interpolation from this surface.
  const openUrl = `/apps/${encodeURIComponent(app.hostId)}/${encodeURIComponent(app.slug)}`;

  return {
    openInNewWindow: {
      label: "Open in new window",
      testId: "app-menu-item-open-new-window",
      onClick: () => {
        openAppInNewWindow(Number(app.hostId), app.slug);
      },
    },
    // The app on its own in a browser tab — no Skynet around it.
    openStandalone: {
      label: "Open standalone",
      testId: "app-menu-item-open-standalone",
      onClick: () => {
        // Tabnabbing guard: no window.opener, no Referer.
        window.open(openUrl, "_blank", "noopener,noreferrer");
      },
    },
    // app-rename shape — title only (the slug is the app's identity). Native
    // window.prompt; an invalid entry re-prompts with the error and the
    // user's text pre-filled until it validates or they cancel. Sidebar
    // update: OPTIMISTIC via setPendingAppTitle (the store keeps the new
    // title over stale fleet-status frames until the sweep re-reads
    // app.json); rolled back via clearPendingAppTitle on failure.
    rename: {
      label: "Rename…",
      testId: "app-menu-item-rename",
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
          const errMessage = err instanceof Error ? err.message : String(err);
          console.warn({
            operation: "app_rename_failed",
            hostId: Number(app.hostId),
            slug: app.slug,
            errMessage,
          });
          window.alert(`Failed to rename app "${previousTitle}": ${errMessage}`);
        }
      },
    },
    // app-archive shape — danger-styled, placed LAST by every caller (most
    // destructive at bottom, same as identity/role archive). Double-confirm
    // ceremony. Sidebar update: OPTIMISTIC via markPendingAppArchive +
    // publishAppGone — mirrors identity-archive's optimistic-remove.
    archive: {
      label: "Archive",
      danger: true,
      testId: "app-menu-item-archive",
      onClick: async () => {
        if (!window.confirm(`archive ${app.title}? this can't be undone.`)) return;
        if (!window.confirm("are you sure? this can't be undone.")) return;
        // Mark pending FIRST so any in-flight fleet-status app-update /
        // app-snapshot frame is silent-dropped rather than re-inserting it.
        markPendingAppArchive(app.hostId, app.slug);
        publishAppGone(app.hostId, app.slug);
        onArchive?.(Number(app.hostId), app.slug, app.title);
        // errMessage flows from handleApiError; the backend archive endpoint
        // redacts internal errors (generic 500 body), so the alert stays at
        // transport-level granularity. If that contract widens, review.
        try {
          await archiveApp(Number(app.hostId), app.slug);
        } catch (err) {
          // Rollback: the next fleet-status pulse re-inserts the tile. Closed
          // panes are NOT re-opened — the alert lets the user do it by hand.
          clearPendingAppArchive(app.hostId, app.slug);
          const errMessage = err instanceof Error ? err.message : String(err);
          console.warn({
            operation: "app_archive_failed",
            hostId: Number(app.hostId),
            slug: app.slug,
            errMessage,
          });
          window.alert(`Failed to archive app "${app.title}": ${errMessage}`);
        }
      },
    },
  };
}
