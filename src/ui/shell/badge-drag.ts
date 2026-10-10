// ─── badge-drag.ts ─────────────────────────────────────────────────────────
// Which identity badge is being dragged right now, readable synchronously.
//
// A drop zone can only read a drag's payload on `drop` — during `dragover`
// the browser exposes the MIME types and nothing else. The badge drop lane
// and the sidebar sections both have to decide on dragover whether they
// accept THIS badge (can it be archived? does it map to a sidebar row?), so
// the payload is captured once at window `dragstart` and held here until the
// drag really ends.
//
// Badge drags that start in ANOTHER Skynet window never pass through this
// window's dragstart, so they read as null here — those drops are left to
// the split-pane targets, which carry their own cross-window handling.

import { useSyncExternalStore } from "react";
import { subscribeDragSessionEnd } from "./drag-preview-session";

export const BADGE_MIME = "application/x-skynet-badge";

export interface DraggedBadge {
  tabId: string;
  /** Host the badge's session lives on; null for relay-room panes. */
  hostId: number | null;
  /** The badge's identity name (for a relay-room agent cell, that agent). */
  identityKey: string | null;
  sessionKind: "harness" | "relay-room" | null;
  targetTmuxSession: string | null;
  relayRoomId: string | null;
}

export function hasBadgeMime(dt: DataTransfer | null | undefined): boolean {
  return !!dt && Array.from(dt.types).includes(BADGE_MIME);
}

/** Parses the badge MIME payload IdentityBadge writes at dragstart. */
export function parseBadgePayload(raw: string): DraggedBadge | null {
  if (raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  if (typeof p.tabId !== "string" || p.tabId === "") return null;
  const d =
    p.descriptor !== null && typeof p.descriptor === "object"
      ? (p.descriptor as Record<string, unknown>)
      : {};
  const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  return {
    tabId: p.tabId,
    hostId: typeof p.hostId === "number" && Number.isFinite(p.hostId) ? p.hostId : null,
    identityKey: str(p.identityKey),
    sessionKind:
      d.sessionKind === "harness" || d.sessionKind === "relay-room" ? d.sessionKind : null,
    targetTmuxSession: str(d.targetTmuxSession),
    relayRoomId: str(d.relayRoomId),
  };
}

/**
 * The identity to archive when this badge is dropped on the lane's archive
 * zone — null unless the badge stands for one identity's own conversation
 * (relay rooms, app panes' bars and host-less badges aren't archivable).
 */
export function archivableIdentity(
  badge: DraggedBadge,
): { hostId: number; identityKey: string } | null {
  if (badge.sessionKind !== "harness" || badge.hostId === null) return null;
  const key = (badge.targetTmuxSession ?? badge.identityKey)?.toLowerCase() ?? null;
  return key ? { hostId: badge.hostId, identityKey: key } : null;
}

let current: DraggedBadge | null = null;
const listeners = new Set<() => void>();
let installed = false;

function set(next: DraggedBadge | null): void {
  if (next === current) return;
  current = next;
  for (const l of listeners) l();
}

function install(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("dragstart", (e: DragEvent) => {
    // Every dragstart replaces the slot — a row or file drag clears it.
    set(hasBadgeMime(e.dataTransfer) ? parseBadgePayload(e.dataTransfer!.getData(BADGE_MIME)) : null);
  });
  // Clear on a REAL end only (drop / dragend). A watchdog end is just a
  // dragover gap — cursor outside the window or over an iframe that
  // swallows drag events — and the payload can't be re-read mid-drag.
  subscribeDragSessionEnd((reason) => {
    if (reason !== "watchdog") set(null);
  });
}

// Track from module load: the sidebar sections read getDraggedBadge()
// without subscribing, so capture can't wait for a hook to mount.
install();

export function getDraggedBadge(): DraggedBadge | null {
  return current;
}

function subscribe(cb: () => void): () => void {
  install();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** The badge currently being dragged in this window, or null. */
export function useDraggedBadge(): DraggedBadge | null {
  return useSyncExternalStore(subscribe, getDraggedBadge, () => null);
}

/** Test-only: drop any captured badge. */
export function __resetDraggedBadgeForTests(): void {
  set(null);
}
