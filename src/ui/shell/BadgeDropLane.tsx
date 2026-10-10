// ─── BadgeDropLane.tsx ─────────────────────────────────────────────────────
// The one place a dragged identity badge is put away. While a badge drag is
// in flight, a ~115px lane appears along the left edge of the content area
// (beside the sidebar when it's open, at the window edge when it's
// collapsed):
//   - top two-thirds  → Close: drop to close that pane.
//   - bottom third    → Archive: drop to archive the identity, after the same
//                       confirm the menu's Archive item shows. Only present
//                       when the badge stands for one identity's own
//                       conversation (not relay rooms).
// The sidebar itself no longer closes badges — its sections file them
// (PrettyConversationsPanel), so closing needed a home of its own.
//
// Grammar (user, 2026-08-29): the lane is NEUTRAL at rest and lights only
// under the cursor — coral for close, red for archive. A lit-at-rest lane
// would read as "already at the destination".
//
// Native DOM drag listeners — NOT React synthetic (patch #514 lesson): React
// portal boundaries + synthetic drag events don't co-bubble reliably;
// SplitView.tsx is the canonical shape mirrored here. Listeners attach via a
// callback ref → state, so they bind the moment the div mounts on the first
// drag (inline-260830-close-lane-callback-ref: a plain useRef + [] deps
// never attached, because the component returns null when idle). Props are
// forwarded through refs so their churn doesn't reattach listeners.
//
// `isolation: isolate` sandboxes the hover state's z-index budget (mirrors
// the SplitView Pane wrapper).

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Archive, X } from "lucide-react";
import { useDragPreviewClaim } from "./drag-preview-session";
import { BADGE_MIME, hasBadgeMime, parseBadgePayload, type DraggedBadge } from "./badge-drag";

export const BADGE_DROP_LANE_WIDTH = 115;

type Zone = "close" | "archive";

interface BadgeDropLaneProps {
  /** The badge being dragged in this window; null renders nothing. */
  draggedBadge: DraggedBadge | null;
  /**
   * Currently-open tabIds — the drop ladder's security guard: a payload
   * whose tabId isn't open is silently dropped.
   */
  openTabIds: string[];
  onCloseTab: (tabId: string) => void;
  /**
   * Archive the identity behind the dropped badge (confirm included).
   * Absent → no archive zone; the whole lane closes.
   */
  onArchiveTab?: (badge: DraggedBadge) => void;
  /** Whether the dragged badge can be archived — gates the archive zone. */
  canArchive: boolean;
}

/**
 * Mount gate for AppShell: no lane on mobile (no split view) or on the
 * mobile list screen (the sidebar fills the viewport). Sidebar state no
 * longer matters — the lane shows beside an open sidebar too.
 */
export function shouldMountBadgeDropLane(args: {
  isMobile: boolean;
  isMobileListScreen: boolean;
}): boolean {
  return !args.isMobile && !args.isMobileListScreen;
}

/** Which zone a cursor y falls in: the bottom third archives. */
export function zoneAt(rect: { top: number; height: number }, clientY: number, archiveZone: boolean): Zone {
  if (!archiveZone) return "close";
  return clientY >= rect.top + (rect.height * 2) / 3 ? "archive" : "close";
}

const CORAL_BG = "rgba(255, 184, 150, 0.22)";
const CORAL_BORDER = "rgba(255, 184, 150, 0.60)";
const RED_BG = "rgba(239, 68, 68, 0.25)";
const RED_BORDER = "rgba(239, 68, 68, 0.75)";

export default function BadgeDropLane({
  draggedBadge,
  openTabIds,
  onCloseTab,
  onArchiveTab,
  canArchive,
}: BadgeDropLaneProps) {
  const [outerEl, setOuterEl] = useState<HTMLDivElement | null>(null);
  const outerRef = useCallback((el: HTMLDivElement | null) => {
    setOuterEl(el);
  }, []);
  const [hover, setHover] = useState<Zone | null>(null);
  const { claim: claimPreview, release: releasePreview } = useDragPreviewClaim(
    "badge-drop-lane",
    () => setHover(null),
  );

  const archiveZone = canArchive && onArchiveTab !== undefined;
  const openTabIdsRef = useRef(openTabIds);
  const onCloseTabRef = useRef(onCloseTab);
  const onArchiveTabRef = useRef(onArchiveTab);
  const archiveZoneRef = useRef(archiveZone);
  openTabIdsRef.current = openTabIds;
  onCloseTabRef.current = onCloseTab;
  onArchiveTabRef.current = onArchiveTab;
  archiveZoneRef.current = archiveZone;

  useEffect(() => {
    const el = outerEl;
    if (el === null) return;

    const onDragOver = (e: DragEvent) => {
      // Only badge drags; row and file drags keep the browser's
      // not-a-drop-target default.
      if (!hasBadgeMime(e.dataTransfer)) return;
      e.preventDefault();
      // The lane owns this cursor position — keep the pane drop targets
      // underneath from reacting too.
      e.stopPropagation();
      setHover(zoneAt(el.getBoundingClientRect(), e.clientY, archiveZoneRef.current));
      claimPreview();
    };

    const onDragLeave = (e: DragEvent) => {
      if (!hasBadgeMime(e.dataTransfer)) return;
      // Bounding-rect guard: crossing onto a child fires dragleave too.
      const rect = el.getBoundingClientRect();
      const stillInside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (stillInside) return;
      setHover(null);
      releasePreview();
    };

    const onDrop = (e: DragEvent) => {
      setHover(null);
      releasePreview();
      const badge = parseBadgePayload(e.dataTransfer?.getData(BADGE_MIME) ?? "");
      if (badge === null) return;
      if (!openTabIdsRef.current.includes(badge.tabId)) return;
      e.preventDefault();
      e.stopPropagation();
      const zone = zoneAt(el.getBoundingClientRect(), e.clientY, archiveZoneRef.current);
      // eslint-disable-next-line no-console
      console.info(`[badge-lane-drop] zone=${zone} tabId=${badge.tabId}`);
      // The archive confirm is a modal — open it after the drop has
      // finished, not while the browser is still inside the drag.
      if (zone === "archive") setTimeout(() => onArchiveTabRef.current?.(badge), 0);
      else onCloseTabRef.current(badge.tabId);
    };

    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, [outerEl, claimPreview, releasePreview]);

  if (draggedBadge === null) return null;

  const zoneStyle = (zone: Zone, flex: number): CSSProperties => {
    const lit = hover === zone;
    const red = zone === "archive";
    return {
      flex,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      fontSize: 12,
      fontWeight: 600,
      transition: "background 120ms ease, opacity 120ms ease",
      background: lit ? (red ? RED_BG : CORAL_BG) : "transparent",
      outline: lit ? `2px solid ${red ? RED_BORDER : CORAL_BORDER}` : "none",
      outlineOffset: -2,
      opacity: lit ? 1 : 0.6,
      ...(red ? { borderTop: "1px dashed rgba(239, 68, 68, 0.45)" } : {}),
    };
  };

  return (
    <div
      ref={outerRef}
      data-testid="badge-drop-lane"
      data-hover={hover ?? "none"}
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 0,
        width: BADGE_DROP_LANE_WIDTH,
        zIndex: 30,
        isolation: "isolate",
        display: "flex",
        flexDirection: "column",
        background: "var(--color-pv-base)",
        borderRight: "1px solid var(--color-pv-border-quiet-strong)",
        color: "var(--color-pv-fg)",
      }}
    >
      <div data-testid="badge-drop-lane-close" style={zoneStyle("close", 2)} aria-label="Drop badge here to close the conversation">
        <X size={26} aria-hidden="true" />
        <span>Close</span>
      </div>
      {archiveZone && (
        <div data-testid="badge-drop-lane-archive" style={zoneStyle("archive", 1)} aria-label="Drop badge here to archive the agent">
          <Archive size={22} aria-hidden="true" />
          <span>Archive</span>
        </div>
      )}
    </div>
  );
}
