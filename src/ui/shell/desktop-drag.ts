// ─── desktop-drag.ts ───────────────────────────────────────────────────────
// Wire contract for dragging an agent's desktop OUT of its conversation (the
// green "desktop running" button beside the task pill) into split view, where
// it opens as a desktop pane.
//
// Its own MIME, like FILE_CHIP_MIME and the app tile's: this drag makes a NEW
// pane, so it must not read as a pane-handle (badge) drag — that would light
// the drop lane's Close / Archive and the sidebar's filing targets. Once the
// pane exists, its bar drags as a badge like every other pane.

import { APP_HOST_ID_RE, DESKTOP_IDENTITY_RE } from "@/lib/tab-url";

export const DESKTOP_DRAG_MIME = "application/x-skynet-desktop";

export interface DesktopDragPayload {
  hostId: number;
  identityKey: string;
  /** The agent's display name, for the pane title. */
  label: string;
}

const MAX_LABEL = 128;

export function writeDesktopDragData(dt: DataTransfer, payload: DesktopDragPayload): void {
  dt.setData(DESKTOP_DRAG_MIME, JSON.stringify(payload));
  dt.effectAllowed = "copy";
}

export function hasDesktopDragMime(dt: DataTransfer | null | undefined): boolean {
  return !!dt && !!dt.types && Array.from(dt.types).includes(DESKTOP_DRAG_MIME);
}

/** Parse + validate a DESKTOP_DRAG_MIME payload. Null when malformed. */
export function parseDesktopDragPayload(json: string): DesktopDragPayload | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const { hostId, identityKey, label } = raw as Record<string, unknown>;
  if (typeof hostId !== "number" || !APP_HOST_ID_RE.test(String(hostId))) return null;
  if (typeof identityKey !== "string" || !DESKTOP_IDENTITY_RE.test(identityKey)) return null;
  const cleanLabel =
    typeof label === "string" && label.trim().length > 0
      ? label.trim().slice(0, MAX_LABEL)
      : identityKey;
  return { hostId, identityKey, label: cleanLabel };
}

/**
 * Window event the agent window's "Open beside conversation" fires; AppShell
 * opens a desktop pane to the right of that agent's conversation. Detail is a
 * DesktopDragPayload.
 */
export const OPEN_DESKTOP_PANE_EVENT = "skynet:open-desktop-pane";

export function requestDesktopPane(payload: DesktopDragPayload): void {
  window.dispatchEvent(new CustomEvent(OPEN_DESKTOP_PANE_EVENT, { detail: payload }));
}
