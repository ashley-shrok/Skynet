// ─── drag-preview-session.ts ──────────────────────────────────────────────
// Single owner of the coral drop-preview zones' lifecycle. Every drop zone
// (split Pane, empty-PV tint, collapsed close lane, sidebar badge target,
// pinned zone, flat-middle zone, project sections) used to track its own
// highlight with no knowledge of the others, clearing only on its own
// bounding-rect-guarded dragleave, its own drop, or a window `dragend`.
// Two holes made zones stick:
//
//   1. Multiple lit at once — a dragleave whose final coordinates land on a
//      shared edge / divider passes the inclusive "still inside" guard, so
//      the zone the cursor just left never clears while the next one lights.
//   2. Stuck after drop — `dragend` fires on the drag SOURCE. When the drop
//      itself unmounts or reparents the source (badge of a pane being moved,
//      sidebar row re-sorted into a project / Pinned), the event fires on a
//      detached node and never reaches `window`.
//
// This module closes both:
//   - Exclusive claim: a zone calls `claim()` whenever it lights; any OTHER
//     zone currently holding the claim is cleared on the spot.
//   - Session end: window CAPTURE listeners for `drop` (always dispatched on
//     an attached target, and capture runs before any zone's
//     stopPropagation) and `dragend`, plus a heartbeat watchdog — browsers
//     fire `dragover` continuously during a live drag (even with the cursor
//     still), so WATCHDOG_MS of silence means the drag left the window or
//     ended without a signal we could hear. On end, the claimed zone and
//     every end-subscriber clear.

import { useCallback, useEffect, useRef } from "react";

// Firefox fires stationary dragover ~every 350ms (spec cadence); Chromium
// and WebKit fire far more often. 1000ms keeps a still-held drag lit in every
// engine while still sweeping a lost drag within about a second.
export const DRAG_PREVIEW_WATCHDOG_MS = 1000;

type Owner = { id: object; label: string; clear: () => void };
export type DragSessionEndReason = "drop" | "dragend" | "watchdog";

let owner: Owner | null = null;
const endListeners = new Set<(reason: DragSessionEndReason) => void>();
let watchdog: ReturnType<typeof setTimeout> | null = null;
let installed = false;

function endSession(reason: DragSessionEndReason): void {
  if (watchdog !== null) {
    clearTimeout(watchdog);
    watchdog = null;
  }
  const prev = owner;
  owner = null;
  if (prev !== null) {
    // eslint-disable-next-line no-console
    console.info(`[drag-preview] session-end reason=${reason} cleared=${prev.label}`);
    prev.clear();
  }
  for (const cb of endListeners) cb(reason);
}

const onWindowDragOver = (): void => {
  if (watchdog !== null) clearTimeout(watchdog);
  watchdog = setTimeout(() => {
    watchdog = null;
    endSession("watchdog");
  }, DRAG_PREVIEW_WATCHDOG_MS);
};
// Deferred so the target zone's own drop handler runs (and reads its state)
// before everything is swept.
const onWindowDrop = (): void => {
  setTimeout(() => endSession("drop"), 0);
};
const onWindowDragEnd = (): void => endSession("dragend");

function install(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("dragover", onWindowDragOver, true);
  window.addEventListener("drop", onWindowDrop, true);
  window.addEventListener("dragend", onWindowDragEnd, true);
}

function uninstallIfIdle(): void {
  if (!installed || endListeners.size > 0) return;
  installed = false;
  window.removeEventListener("dragover", onWindowDragOver, true);
  window.removeEventListener("drop", onWindowDrop, true);
  window.removeEventListener("dragend", onWindowDragEnd, true);
  if (watchdog !== null) {
    clearTimeout(watchdog);
    watchdog = null;
  }
}

/** Light-up claim. Clears whichever other zone currently holds it. */
export function claimDragPreview(id: object, label: string, clear: () => void): void {
  if (owner !== null && owner.id !== id) {
    // eslint-disable-next-line no-console
    console.info(`[drag-preview] handoff from=${owner.label} to=${label}`);
    owner.clear();
  }
  owner = { id, label, clear };
}

/** Called when a zone clears itself (dragleave / drop) — drops the claim. */
export function releaseDragPreview(id: object): void {
  if (owner !== null && owner.id === id) owner = null;
}

/**
 * Subscribe to drag-session end. `reason` is "drop" / "dragend" (the drag
 * really ended) or "watchdog" (no dragover for WATCHDOG_MS — the drag may
 * still be live with the cursor outside the window or over an iframe that
 * swallows drag events). State that can only be set at dragstart must
 * ignore "watchdog", or it is lost for the rest of a still-live drag.
 */
export function subscribeDragSessionEnd(
  cb: (reason: DragSessionEndReason) => void,
): () => void {
  endListeners.add(cb);
  install();
  return () => {
    endListeners.delete(cb);
    uninstallIfIdle();
  };
}

/**
 * Hook for a drop zone. `clear` resets the zone's preview state; it runs on
 * session end and when another zone claims. Call `claim()` every time the
 * zone lights (idempotent per dragover) and `release()` when the zone clears
 * itself.
 */
export function useDragPreviewClaim(
  label: string,
  clear: () => void,
): { claim: () => void; release: () => void } {
  const idRef = useRef<object>({});
  const clearRef = useRef(clear);
  clearRef.current = clear;

  useEffect(() => {
    const id = idRef.current;
    const unsubscribe = subscribeDragSessionEnd(() => clearRef.current());
    return () => {
      releaseDragPreview(id);
      unsubscribe();
    };
  }, []);

  const claim = useCallback(() => {
    claimDragPreview(idRef.current, label, () => clearRef.current());
  }, [label]);
  const release = useCallback(() => releaseDragPreview(idRef.current), []);
  return { claim, release };
}

/** Test-only: reset module state between tests. */
export function __resetDragPreviewSessionForTests(): void {
  owner = null;
  endListeners.clear();
  uninstallIfIdle();
}
