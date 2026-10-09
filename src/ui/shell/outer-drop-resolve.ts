// ─── outer-drop-resolve.ts ────────────────────────────────────────────────
// Resolution ladder for a drop onto the content area when no split is open
// (AppShell's outer drop handler). Order:
//   1. application/x-skynet-row — conv-list row, opens the tab if needed.
//   2. text/plain tabId already in this window — same-window badge/row.
//   3. application/x-skynet-badge descriptor — a badge or app bar dragged
//      from ANOTHER Skynet window; opens a fresh tab for it and reports the
//      dragId so the caller can echo the accept back to the source window.
// Step 3 is the 2026-10-09 fix: before it, every cross-window badge drop
// onto a window with no split silently aborted here.

export interface OuterDropData {
  getData(type: string): string;
}

export interface OuterDropResolvers<BadgePayload> {
  resolveRow: (payload: unknown) => string | null;
  isLocalTab: (tabId: string) => boolean;
  resolveBadge: (payload: BadgePayload) => string | null;
}

export interface OuterDropResolution {
  tabId: string | null;
  /** Set only when the tab came from another window via the badge path. */
  acceptDragId: string | null;
  via: "row" | "local" | "badge" | null;
}

export function resolveOuterDrop<BadgePayload extends { dragId?: string | null }>(
  dt: OuterDropData,
  r: OuterDropResolvers<BadgePayload>,
): OuterDropResolution {
  const rowJson = dt.getData("application/x-skynet-row");
  if (rowJson) {
    try {
      const tabId = r.resolveRow(JSON.parse(rowJson));
      if (tabId !== null) return { tabId, acceptDragId: null, via: "row" };
    } catch {
      // fall through
    }
  }
  const bareId = dt.getData("text/plain");
  if (bareId && r.isLocalTab(bareId)) {
    return { tabId: bareId, acceptDragId: null, via: "local" };
  }
  const badgeJson = dt.getData("application/x-skynet-badge");
  if (badgeJson) {
    try {
      const payload = JSON.parse(badgeJson) as BadgePayload;
      const tabId = r.resolveBadge(payload);
      if (tabId !== null) {
        const dragId =
          typeof payload.dragId === "string" && payload.dragId.length > 0
            ? payload.dragId
            : null;
        return { tabId, acceptDragId: dragId, via: "badge" };
      }
    } catch {
      // fall through
    }
  }
  return { tabId: null, acceptDragId: null, via: null };
}
