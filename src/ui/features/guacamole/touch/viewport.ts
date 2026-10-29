/**
 * viewport — the zoomed view of a remote desktop, as pure math.
 *
 * The picture is fitted to a box (the visible part of the display area —
 * shorter while the phone keyboard is up), then zoomed by `zoom` (1 = whole
 * desktop fits, up to MAX_ZOOM) and moved by (tx, ty): the offset of the
 * picture's centre from the box's centre, in screen pixels. Offsets are
 * clamped so a zoomed-in picture always covers the box and a fitted one
 * stays centred.
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export interface ViewState {
  zoom: number;
  tx: number;
  ty: number;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RemoteSize {
  width: number;
  height: number;
}

export const FITTED_VIEW: ViewState = { zoom: 1, tx: 0, ty: 0 };

export function fitScale(box: Box, remote: RemoteSize): number {
  if (remote.width <= 0 || remote.height <= 0 || box.width <= 0 || box.height <= 0) return 1;
  return Math.min(box.width / remote.width, box.height / remote.height);
}

export function viewScale(view: ViewState, box: Box, remote: RemoteSize): number {
  return fitScale(box, remote) * view.zoom;
}

function center(view: ViewState, box: Box): { x: number; y: number } {
  return { x: box.left + box.width / 2 + view.tx, y: box.top + box.height / 2 + view.ty };
}

export function remoteToScreen(
  view: ViewState,
  box: Box,
  remote: RemoteSize,
  r: { x: number; y: number },
): { x: number; y: number } {
  const s = viewScale(view, box, remote);
  const c = center(view, box);
  return { x: c.x + (r.x - remote.width / 2) * s, y: c.y + (r.y - remote.height / 2) * s };
}

export function screenToRemote(
  view: ViewState,
  box: Box,
  remote: RemoteSize,
  p: { x: number; y: number },
): { x: number; y: number } {
  const s = viewScale(view, box, remote);
  const c = center(view, box);
  return { x: (p.x - c.x) / s + remote.width / 2, y: (p.y - c.y) / s + remote.height / 2 };
}

export function clampView(view: ViewState, box: Box, remote: RemoteSize): ViewState {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom));
  const s = fitScale(box, remote) * zoom;
  const maxX = Math.max(0, (remote.width * s - box.width) / 2);
  const maxY = Math.max(0, (remote.height * s - box.height) / 2);
  return {
    zoom,
    // `|| 0` folds -0 into 0.
    tx: Math.min(maxX, Math.max(-maxX, view.tx)) || 0,
    ty: Math.min(maxY, Math.max(-maxY, view.ty)) || 0,
  };
}

/** Zoom by `factor`, keeping the desktop spot under client point (cx, cy) there. */
export function zoomAt(
  view: ViewState,
  box: Box,
  remote: RemoteSize,
  factor: number,
  cx: number,
  cy: number,
): ViewState {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
  const u = screenToRemote(view, box, remote, { x: cx, y: cy });
  const s = fitScale(box, remote) * zoom;
  const cxNew = cx - (u.x - remote.width / 2) * s;
  const cyNew = cy - (u.y - remote.height / 2) * s;
  return clampView(
    { zoom, tx: cxNew - (box.left + box.width / 2), ty: cyNew - (box.top + box.height / 2) },
    box,
    remote,
  );
}

export function panBy(
  view: ViewState,
  box: Box,
  remote: RemoteSize,
  dx: number,
  dy: number,
): ViewState {
  return clampView({ ...view, tx: view.tx + dx, ty: view.ty + dy }, box, remote);
}

/**
 * Move the view just enough that remote point `r` sits at least `margin`
 * pixels inside the box — the cursor pushing at an edge carries the view
 * along, and the view follows the pointer when the keyboard comes up.
 */
export function followPoint(
  view: ViewState,
  box: Box,
  remote: RemoteSize,
  r: { x: number; y: number },
  margin: number,
): ViewState {
  const p = remoteToScreen(view, box, remote, r);
  const m = Math.min(margin, box.width / 2, box.height / 2);
  let { tx, ty } = view;
  if (p.x < box.left + m) tx += box.left + m - p.x;
  else if (p.x > box.left + box.width - m) tx -= p.x - (box.left + box.width - m);
  if (p.y < box.top + m) ty += box.top + m - p.y;
  else if (p.y > box.top + box.height - m) ty -= p.y - (box.top + box.height - m);
  return clampView({ ...view, tx, ty }, box, remote);
}
