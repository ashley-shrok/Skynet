// ─── SplitView.tsx ───────────────────────────────────────────────────────────
// Phase 56 Plan 02 — recursive-tree renderer. Phase 56 Plan 03 substitutes the
// real nearest-edge geometry in place of Plan 02's stub.
//
// Adopted (Plan 56-01 + 56-02 + 56-03 LOCKED decisions — user 2026-08-28):
//   - Recursive `SplitNode` tree drives layout. Leaves render as `Pane`;
//     internal nodes render as rows (`RowView`).
//   - Rows and sizes (2026-10-14, supersedes "constant 50/50, no draggable
//     dividers"): a same-direction chain of splits renders as ONE row whose
//     members share space by `rowFractions` (even unless sized). Every
//     divider between two members drags to resize just those two; double-
//     click returns the row to even. See split-tree.ts § ROWS AND SIZES.
//   - Portal-target contract: every leaf's content div carries a tab-id
//     data attribute and reports its element upstream via
//     `onPaneContentRef(tabId, el)`. AppShell's DOM-placement effect uses
//     this to reparent the tab's stable node (no remount, no WS reset).
//   - Empty tree renders a full-viewport drop target; drop on it invokes
//     `onOpenSessionInTree(tabId, [], 'left')` and seeds the root leaf (the
//     edge argument is ignored by insertAtEdge for a null root, so the
//     literal 'left' is a placeholder there, not stubbed geometry).
//   - Drop on an existing cell forwards `(tabId, path, edge)` upstream where
//     the edge is picked by `computeNearestEdge` (Plan 56-03) — the closest
//     of the four cell edges to the drop's clientX/clientY. Foundation-phase
//     minimum-viable geometry per CONTEXT.md § locked decisions: no
//     edge-zone hit-testing, no center dead zone (both Phase 57's work).

import React, { useState, useEffect, useRef, memo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { Tab } from "@/types/ui-types";
import type { SplitNode, SplitPath, DropEdge, DropZone } from "@/lib/split-tree";
import {
  computeEdgeZone,
  rowFractions,
  rowMembers,
} from "@/lib/split-tree";
import { subscribeDragSessionEnd, useDragPreviewClaim } from "./drag-preview-session";
// Phase 120 LOW-15 cleanup (2026-09-19): route the app-tile drop-dispatch
// logs through the fleet's structured frontend logger instead of raw
// console.info / console.warn. Every other console.* call in this file is
// pre-existing (Phase 56 / 64 / 97 drop-lane dispatch) and stays as-is —
// this cleanup is scoped to the Phase 120 additions per the review's
// LOW-15 finding.
import { systemLogger } from "@/lib/frontend-logger";
import {
  FILE_CHIP_MIME,
  parseFileChipPayload,
  type FileChipDragPayload,
} from "@/features/pretty-view/file-url";
import {
  DESKTOP_DRAG_MIME,
  parseDesktopDragPayload,
  type DesktopDragPayload,
} from "./desktop-drag";

/**
 * Phase 57 Plan 02 — overlay geometry helper. Given the current pane's
 * bounding rect and the winning zone, returns the coral overlay's
 * pane-local `{ left, top, width, height }` in CSS pixels.
 *
 * Pane-local means the values are relative to the `.flex-1.min-h-0.overflow-
 * hidden.relative` wrapper the overlay is a child of (SplitView.tsx:296).
 * Because that wrapper equals the outer div's full area (post patch #512
 * PaneHeader removal), pane-local coords are effectively rect-relative
 * with (0,0) at the wrapper's top-left.
 *
 * Edge zones (top / bottom / left / right): half the pane along the winning
 * edge (t = 0.5), matching prototype.html:414-421 exactly.
 *
 * Phase 64 Plan 02: `center` zone returns FULL-CELL geometry
 * `{ left: 0, top: 0, width: rect.width, height: rect.height }` per
 * CONTEXT.md § In-scope item 4 ("Whole-body coral highlight … same coral
 * vocabulary"). The caller relies on the `hasSkynetDragPayload` gate at
 * :275 to prevent non-skynet drags from setting `dropPreview` in the first
 * place, so any `zone === "center"` reaching this helper is guaranteed to
 * originate from a valid skynet MIME.
 */
export function overlayGeometryForZone(
  zone: DropZone,
  rect: DOMRect | { left: number; right: number; top: number; bottom: number; width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  const w = rect.width ?? rect.right - rect.left;
  const h = rect.height ?? rect.bottom - rect.top;
  const t = 0.5;
  switch (zone) {
    case "top":
      return { left: 0, top: 0, width: w, height: h * t };
    case "bottom":
      return { left: 0, top: h * (1 - t), width: w, height: h * t };
    case "left":
      return { left: 0, top: 0, width: w * t, height: h };
    case "right":
      return { left: w * (1 - t), top: 0, width: w * t, height: h };
    case "center":
      // Phase 64 Plan 02: whole-body coral highlight for center-drop.
      return { left: 0, top: 0, width: w, height: h };
  }
}

/**
 * Phase 56 Plan 03: nearest-edge picker for the foundation-phase drop geometry.
 *
 * CONTEXT.md § locked decision: any drop inside a cell picks the closest edge
 * and splits there — no edge-zone hit-testing, no center dead zone (both are
 * Phase 57's work). This function returns whichever of the four candidate
 * edges (left, right, top, bottom) is nearest to the drop's client
 * coordinates, measured as the perpendicular distance to that edge's line.
 *
 * Tie-break priority: left → top → right → bottom (first-match-wins). This
 * order matches CSS reading order and produces a deterministic answer for
 * pixel-precise ties (dead-center + symmetric-diagonal cases).
 *
 * Exported for test coverage — pure function of rect + point.
 */
export function computeNearestEdge(
  rect: DOMRect | { left: number; right: number; top: number; bottom: number },
  clientX: number,
  clientY: number,
): DropEdge {
  const dLeft = clientX - rect.left;
  const dRight = rect.right - clientX;
  const dTop = clientY - rect.top;
  const dBottom = rect.bottom - clientY;
  // First-match-wins priority: left, top, right, bottom.
  let best: DropEdge = "left";
  let bestDist = dLeft;
  if (dTop < bestDist) {
    best = "top";
    bestDist = dTop;
  }
  if (dRight < bestDist) {
    best = "right";
    bestDist = dRight;
  }
  if (dBottom < bestDist) {
    best = "bottom";
    bestDist = dBottom;
  }
  return best;
}

// Smallest a drag may push a pane, in CSS px. A window too small for every
// pane's minimum still shrinks them all proportionally (flex, no CSS min).
export const MIN_PANE_WIDTH = 280;
export const MIN_PANE_HEIGHT = 160;

/** Minimum size of `node` along the row axis (`width` for side-by-side
 *  rows, `height` for stacked ones). */
function minAlong(node: SplitNode, axis: "width" | "height"): number {
  if (node.kind === "session") {
    return axis === "width" ? MIN_PANE_WIDTH : MIN_PANE_HEIGHT;
  }
  const runsAlong = (node.direction === "vertical") === (axis === "width");
  const mins = rowMembers(node).map((m) => minAlong(m.node, axis));
  if (!runsAlong) return Math.max(...mins);
  // A row along the axis keeps its members' current shares as it shrinks,
  // so it hits its floor when its tightest member does.
  const shares = rowFractions(node);
  return Math.max(...mins.map((m, i) => m / shares[i]));
}

/** Resize two neighbouring members of a row. `fractions` are the row's
 *  shares at drag start, `deltaPx` the pointer travel along the row axis,
 *  `lengthPx` the row's length. Only members `k` and `k + 1` change; the
 *  move stops at either member's minimum — or at its drag-start size if it
 *  was already below the minimum (a small window), so a pane never jumps.
 *  Exported for unit coverage. */
export function dragRowFractions(
  fractions: number[],
  k: number,
  deltaPx: number,
  lengthPx: number,
  minsPx: number[],
): number[] {
  if (lengthPx <= 0 || k < 0 || k + 1 >= fractions.length) return fractions;
  const pair = fractions[k] + fractions[k + 1];
  const lo = Math.min(minsPx[k] / lengthPx, fractions[k]);
  const hi = pair - Math.min(minsPx[k + 1] / lengthPx, fractions[k + 1]);
  const nextK = Math.min(hi, Math.max(lo, fractions[k] + deltaPx / lengthPx));
  const out = fractions.slice();
  out[k] = nextK;
  out[k + 1] = pair - nextK;
  return out;
}

// ─── Divider drags: single lines and the points where lines meet ──────────
// Each divider's grab strip registers a LineControl. A press starts one
// pointer-captured drag (startLineDrag) that drives every line it reaches:
// just the pressed line, or — at a point where lines running both ways meet
// (a T where a line ends on another, or a + where lines from both sides end
// on the same one) — all of them, each moving along its own axis and
// clamped by its own row's minimums.

/** One line's part in a drag. `finish(false)` ends it without committing. */
interface LineDrag {
  move: (clientX: number, clientY: number) => void;
  finish: (commit: boolean) => void;
}

interface LineControl {
  /** Starts this line's part in a drag, or null when it can't resize.
   *  `onAbort` runs if the line's row unmounts mid-drag. */
  begin: (clientX: number, clientY: number, onAbort: () => void) => LineDrag | null;
  reset: () => void;
}

const lineControls = new WeakMap<
  Element,
  LineControl & { direction: "horizontal" | "vertical" }
>();

// How far past a grab strip a press may land and still reach that line —
// sets the size of a meeting point's grab area (~17px square).
const MEET_REACH_PX = 4;

/** Grab strips of the split view holding `pressed` that come within reach
 *  of (x, y). */
function stripsNear(pressed: Element, x: number, y: number): Element[] {
  const root = pressed.closest("[data-split-root]") ?? document;
  return Array.from(root.querySelectorAll("[data-split-divider-handle]")).filter((el) => {
    if (el === pressed) return true;
    if (!lineControls.has(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    return (
      x >= r.left - MEET_REACH_PX &&
      x <= r.right + MEET_REACH_PX &&
      y >= r.top - MEET_REACH_PX &&
      y <= r.bottom + MEET_REACH_PX
    );
  });
}

/** The lines a press at (x, y) on `pressed` drives. Near a meeting point
 *  (lines running both ways within reach) it is every line that reaches
 *  the meeting point itself — the crossing of those lines' centres — so
 *  the set doesn't depend on which side of the point the press lands;
 *  otherwise just the pressed line. */
function linesAt(pressed: Element, x: number, y: number): Element[] {
  const near = stripsNear(pressed, x, y);
  const vertical = near.find((el) => lineControls.get(el)?.direction === "vertical");
  const horizontal = near.find((el) => lineControls.get(el)?.direction === "horizontal");
  if (vertical === undefined || horizontal === undefined) return [pressed];
  const v = vertical.getBoundingClientRect();
  const h = horizontal.getBoundingClientRect();
  const lines = stripsNear(pressed, v.left + v.width / 2, h.top + h.height / 2);
  return lines.includes(pressed) ? lines : [pressed, ...lines];
}

// Grab strips currently lit as one meeting point under a hovering pointer.
let hotLines: Element[] = [];
function setHotLines(lines: Element[]) {
  if (lines.length === hotLines.length && lines.every((el, i) => el === hotLines[i])) return;
  hotLines.forEach((el) => {
    el.removeAttribute("data-split-meet");
    el.parentElement?.removeAttribute("data-split-meet");
  });
  hotLines = lines;
  lines.forEach((el) => {
    el.setAttribute("data-split-meet", "");
    el.parentElement?.setAttribute("data-split-meet", "");
  });
}

function startLineDrag(e: React.PointerEvent<HTMLDivElement>) {
  if (e.button !== 0) return;
  const handle = e.currentTarget;
  const lines = linesAt(handle, e.clientX, e.clientY);
  setHotLines([]);
  let ended = false;
  let open = 0;
  const directions = new Set<string>();
  const drags: LineDrag[] = [];
  lines.forEach((el) => {
    const control = lineControls.get(el);
    const drag = control?.begin(e.clientX, e.clientY, () => {
      open -= 1;
      if (open === 0) teardown();
    });
    if (control === undefined || drag == null) return;
    drags.push(drag);
    directions.add(control.direction);
  });
  open = drags.length;
  if (open === 0) return;
  e.preventDefault();
  e.stopPropagation();
  const pointerId = e.pointerId;
  // Pointer capture keeps every move/up on the handle even while the
  // pointer crosses an app or remote-desktop iframe.
  handle.setPointerCapture(pointerId);
  const prevCursor = document.body.style.cursor;
  const prevSelect = document.body.style.userSelect;
  document.body.style.cursor =
    directions.size > 1 ? "move" : directions.has("vertical") ? "col-resize" : "row-resize";
  document.body.style.userSelect = "none";
  // Backstop for browsers whose pointer capture leaks into iframes: app
  // and remote-desktop frames ignore the pointer while a resize is live.
  document.body.setAttribute("data-split-resizing", "");
  if (drags.length > 1) {
    systemLogger.info("pv-split-resize meet start", {
      operation: "pv_split_resize_meet_start",
      lines: drags.length,
      clientX: Math.round(e.clientX),
      clientY: Math.round(e.clientY),
    });
  }
  // Moves and the release are heard on the window: the pressed strip can
  // unmount mid-drag (its pane closed) while other lines in the drag live on.
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    drags.forEach((d) => d.move(ev.clientX, ev.clientY));
  };
  const onRelease = (ev: PointerEvent) => {
    if (ev.pointerId === pointerId) onEnd();
  };
  // Capture lost while the strip is still on the page (the browser took the
  // pointer away) ends the drag; losing it because the strip unmounted
  // doesn't — the window listeners carry on.
  const onLostCapture = () => {
    if (handle.isConnected) onEnd();
  };
  function teardown() {
    if (ended) return;
    ended = true;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onRelease);
    window.removeEventListener("pointercancel", onRelease);
    handle.removeEventListener("lostpointercapture", onLostCapture);
    if (handle.isConnected && handle.hasPointerCapture(pointerId)) {
      handle.releasePointerCapture(pointerId);
    }
    document.body.style.cursor = prevCursor;
    document.body.style.userSelect = prevSelect;
    document.body.removeAttribute("data-split-resizing");
  }
  function onEnd() {
    if (ended) return;
    teardown();
    drags.forEach((d) => d.finish(true));
  }
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onRelease);
  window.addEventListener("pointercancel", onRelease);
  handle.addEventListener("lostpointercapture", onLostCapture);
}

// Divider between two members of a row. `direction` matches split-tree.ts's
// SplitDirection convention: 'horizontal' = 1px-tall line separating stacked
// members; 'vertical' = 1px-wide line separating side-by-side members. The
// visible line stays 1px; an invisible 8px strip centred on it takes the
// pointer. Hover (and an active drag) lights the line in the accent colour;
// hovering a meeting point lights every line there (data-split-meet,
// index.css). Only the strip takes the pointer, and not while a pane / row /
// app tile is being dragged (body[data-split-dnd], see SplitView) — a drop
// aimed at the line between two panes must land on the pane under it.
function Divider({
  direction,
  active,
  control,
}: {
  direction: "horizontal" | "vertical";
  active: boolean;
  control: LineControl;
}) {
  const stacked = direction === "horizontal";
  const lineColor = active
    ? "bg-[hsla(var(--pv-hue,35),55%,50%,0.6)]"
    : "bg-[color:var(--color-pv-border-quiet-strong)] group-hover/divider:bg-[hsla(var(--pv-hue,35),55%,50%,0.6)]";
  return (
    <div
      className={`group/divider pointer-events-none relative z-20 shrink-0 ${stacked ? "h-px w-full" : "w-px h-full"}`}
      role="separator"
      aria-orientation={direction}
      data-split-divider=""
    >
      <div className={`absolute inset-0 transition-colors ${lineColor}`} data-split-divider-line="" />
      <div
        ref={(el) => {
          if (el !== null) lineControls.set(el, { ...control, direction });
        }}
        className={`absolute pointer-events-auto touch-none ${stacked ? "left-0 right-0 -top-[4px] h-[9px] cursor-row-resize" : "top-0 bottom-0 -left-[4px] w-[9px] cursor-col-resize"}`}
        data-split-divider-handle=""
        onPointerDown={startLineDrag}
        onPointerMove={(e) => {
          if (e.buttons !== 0) return;
          const lines = linesAt(e.currentTarget, e.clientX, e.clientY);
          setHotLines(lines.length > 1 ? lines : []);
        }}
        onPointerLeave={() => setHotLines([])}
        onDoubleClick={(e) => {
          const lines = linesAt(e.currentTarget, e.clientX, e.clientY);
          if (lines.length > 1) {
            systemLogger.info("pv-split-resize meet reset", {
              operation: "pv_split_resize_meet_reset",
              lines: lines.length,
            });
          }
          lines.forEach((el) => lineControls.get(el)?.reset());
        }}
      />
    </div>
  );
}

/** Identity of a row's membership: the panes under each member, in order.
 *  Changes whenever the row is restructured. */
function memberSignature(row: SplitNode & { kind: "split" }): string {
  const ids = (n: SplitNode): string =>
    n.kind === "session" ? n.tabId : `${ids(n.children[0])}+${ids(n.children[1])}`;
  return rowMembers(row).map((m) => ids(m.node)).join("|");
}

// RowView — one row (or column): a same-direction chain of splits rendered
// as its flat list of members with a draggable divider between each pair.
// Live drag sizes stay local to this component and are committed to the
// tree (and so the URL) once, on release.
function RowView({
  node,
  path,
  renderMember,
  onResizeRow,
  onTerminalResize,
}: {
  node: SplitNode & { kind: "split" };
  path: SplitPath;
  renderMember: (member: SplitNode, memberPath: SplitPath) => React.ReactNode;
  onResizeRow?: (rowPath: SplitPath, fractions: number[] | null) => void;
  onTerminalResize?: () => void;
}) {
  const members = rowMembers(node);
  // Latest node, read at drag end to make sure the row is still the one the
  // drag started on before committing.
  const nodeRef = useRef(node);
  nodeRef.current = node;
  // Ends this row's part in an in-flight drag if the row unmounts mid-drag,
  // and lets the drag restore the page cursor / selection lock once no line
  // is left in it. It never commits: the row the drag started on is gone,
  // and its path may now name a different row.
  const endDragRef = useRef<(() => void) | null>(null);
  useEffect(() => () => endDragRef.current?.(), []);
  const committed = rowFractions(node);
  // Live drag sizes, tagged with the panes they were measured for: if the
  // row is restructured mid-drag they no longer apply.
  const [liveDrag, setLive] = useState<{ fractions: number[]; divider: number; signature: string } | null>(null);
  const live = liveDrag !== null && liveDrag.signature === memberSignature(node) ? liveDrag : null;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fractions = live !== null ? live.fractions : committed;
  const sideBySide = node.direction === "vertical";

  // This row's part in a drag of divider `k` (see startLineDrag, which owns
  // the pointer and the page cursor).
  const beginDrag = (
    k: number,
    clientX: number,
    clientY: number,
    onAbort: () => void,
  ): LineDrag | null => {
    if (onResizeRow === undefined) return null;
    const container = containerRef.current;
    if (container === null) return null;
    const rect = container.getBoundingClientRect();
    const axis = sideBySide ? "width" : "height";
    const lengthPx = (sideBySide ? rect.width : rect.height) - (members.length - 1);
    const minsPx = members.map((m) => minAlong(m.node, axis));
    const start = fractions.slice();
    const startPos = sideBySide ? clientX : clientY;
    const signature = memberSignature(node);
    let latest = start;
    let frame = 0;
    let lastFit = 0;
    setLive({ fractions: start, divider: k, signature });
    systemLogger.info("pv-split-resize start", {
      operation: "pv_split_resize_start",
      rowPath: JSON.stringify(path),
      divider: k,
      members: members.length,
      lengthPx: Math.round(lengthPx),
    });
    let ended = false;
    const move = (x: number, y: number) => {
      if (ended) return;
      const pos = sideBySide ? x : y;
      latest = dragRowFractions(start, k, pos - startPos, lengthPx, minsPx);
      // One re-render per frame, however fast the pointer events come.
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setLive({ fractions: latest, divider: k, signature });
        // Terminals refit on a trailing debounce that a steady drag keeps
        // postponing; nudge them a few times a second so they reflow live.
        const now = performance.now();
        if (now - lastFit >= 100) {
          lastFit = now;
          onTerminalResize?.();
        }
      });
    };
    const finish = (commit: boolean) => {
      if (ended) return;
      ended = true;
      endDragRef.current = null;
      if (frame !== 0) cancelAnimationFrame(frame);
      setLive(null);
      const moved = latest.some((f, i) => Math.abs(f - start[i]) > 1e-6);
      const sameRow = memberSignature(nodeRef.current) === signature;
      systemLogger.info("pv-split-resize end", {
        operation: "pv_split_resize_end",
        rowPath: JSON.stringify(path),
        divider: k,
        moved,
        sameRow,
        unmounted: !commit,
        fractions: latest.map((f) => f.toFixed(4)).join(","),
      });
      if (commit && moved && sameRow) onResizeRow(path, latest);
    };
    endDragRef.current = () => {
      finish(false);
      onAbort();
    };
    return { move, finish };
  };

  const resetRow = () => {
    systemLogger.info("pv-split-resize reset", {
      operation: "pv_split_resize_reset",
      rowPath: JSON.stringify(path),
    });
    onResizeRow?.(path, null);
  };

  const children: React.ReactNode[] = [];
  members.forEach((m, i) => {
    if (i > 0) {
      const k = i - 1;
      children.push(
        <Divider
          key={`d${k}`}
          direction={node.direction}
          active={live !== null && live.divider === k}
          control={{
            begin: (x, y, onAbort) => beginDrag(k, x, y, onAbort),
            reset: resetRow,
          }}
        />,
      );
    }
    children.push(
      <div
        key={`m${i}`}
        className="min-w-0 min-h-0 overflow-hidden"
        style={{ flexGrow: fractions[i], flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0 }}
      >
        {renderMember(m.node, [...path, ...m.relPath])}
      </div>,
    );
  });

  return (
    <div
      ref={containerRef}
      className="flex w-full h-full min-w-0 min-h-0"
      style={{ flexDirection: sideBySide ? "row" : "column" }}
    >
      {children}
    </div>
  );
}

// EmptyDropTarget — rendered when the tree is null. Fills the PrettyView area
// with a receptive drop zone; a payload drop seeds the root leaf via
// onOpenSessionInTree(tabId, [], 'left') — insertAtEdge ignores the edge for
// a null root.
function EmptyDropTarget({
  onOpenSessionInTree,
}: {
  onOpenSessionInTree?: (
    tabId: string,
    path: SplitPath,
    edge: DropEdge,
  ) => void;
}) {
  const { t } = useTranslation();
  const [isDragOver, setIsDragOver] = useState(false);
  return (
    <div
      className={`flex flex-col items-center justify-center w-full h-full gap-2 text-[color:var(--color-pv-fg-dim)] bg-[color:var(--color-pv-base)] transition-colors ${
        isDragOver ? "ring-2 ring-inset ring-accent-brand" : ""
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        const tabId = e.dataTransfer.getData("text/plain");
        if (tabId) onOpenSessionInTree?.(tabId, [], "left");
      }}
    >
      <div className="grid grid-cols-2 gap-1">
        <div className="size-5 border-2 border-current rounded-sm" />
        <div className="size-5 border-2 border-current rounded-sm" />
        <div className="size-5 border-2 border-current rounded-sm" />
        <div className="size-5 border-2 border-current rounded-sm" />
      </div>
      <span className="text-xs">{t("splitScreen.noTabAssigned")}</span>
    </div>
  );
}

// quick-260829-mbp: Type-gate helper — returns true iff the DataTransfer
// carries at least one skynet-owned MIME (application/x-skynet-badge for
// IdentityBadge drags, application/x-skynet-row for conv-list-row drags,
// application/x-skynet-app-tile for AppTile drags — Phase 120 D-07,
// FILE_CHIP_MIME for chat file-chip drags, DESKTOP_DRAG_MIME for the
// green desktop button's drags).
// Pure function; used in all three Pane native drag listeners (onDragOver,
// onDragLeave, onDrop) to reject browser text-selection drags, which carry
// only text/plain=<selected-text> and were falsely passing the old gate.
export function hasSkynetDragPayload(dt: DataTransfer | null | undefined): boolean {
  return (
    (dt?.types.includes("application/x-skynet-badge") ?? false) ||
    (dt?.types.includes("application/x-skynet-row") ?? false) ||
    (dt?.types.includes("application/x-skynet-app-tile") ?? false) ||
    (dt?.types.includes(FILE_CHIP_MIME) ?? false) ||
    (dt?.types.includes(DESKTOP_DRAG_MIME) ?? false)
  );
}

// Pane — one leaf cell. Content div reports (tabId, el) upstream via
// onPaneContentRef; AppShell reparents its tabNodesRef node into this element.
// The tab-id data attribute lets tests assert the portal-target contract by
// DOM query. Drop forwards (payloadTabId, path, edge) upstream.
const Pane = memo(function Pane({
  tab,
  tabId,
  path,
  isFocused,
  onPaneContentRef,
  onPaneClick,
  onOpenSessionInTree,
  onDropRowInTree,
  onDropAppTileInTree,
  onDropFileChipInTree,
  onDropDesktopInTree,
  onReplaceInTree,
  onCenterDropRow,
  onCenterDropAppTile,
  onCenterDropFileChip,
  onCenterDropDesktop,
  onSwapInTree,
  onDropBadgeInTree,
  onCenterDropBadge,
  onCloseStalePane,
}: {
  tab: Tab | null;
  tabId: string;
  path: SplitPath;
  isFocused: boolean;
  onPaneContentRef?: (tabId: string, el: HTMLDivElement | null) => void;
  onPaneClick?: (tabId: string) => void;
  onOpenSessionInTree?: (
    tabId: string,
    path: SplitPath,
    edge: DropEdge,
  ) => void;
  // Patch #511: rich-payload drop path. When present, takes precedence
  // over onOpenSessionInTree for drops that carry the
  // application/x-skynet-row JSON payload (real conv-list-row drags).
  // onOpenSessionInTree stays as the text/plain fallback so scaffold
  // tests keep working with a bare tabId string.
  onDropRowInTree?: (
    payload: unknown,
    path: SplitPath,
    edge: DropEdge,
  ) => void;
  // Phase 120 D-07 — app-tile drop dispatch. When present, drops carrying
  // the application/x-skynet-app-tile JSON payload (AppTile drags) route
  // through this callback instead of falling through to onOpenSessionInTree.
  // Payload shape: { hostId: number; slug: string; title: string }.
  // AppShell wires this to onDropAppTileInTree which calls
  // `openTab(null, "app", ..., { app: { hostId, slug }, label: title })` then
  // `insertLeafAtEdge(newTabId, path, edge)` — mirror of onDropRowInTree.
  onDropAppTileInTree?: (
    payload: { hostId: number; slug: string; title: string },
    path: SplitPath,
    edge: DropEdge,
  ) => void;
  // File-chip drop (FILE_CHIP_MIME): opens a new file leaf at the edge.
  onDropFileChipInTree?: (
    payload: FileChipDragPayload,
    path: SplitPath,
    edge: DropEdge,
  ) => void;
  // Desktop-button drop (DESKTOP_DRAG_MIME): opens a new desktop leaf at the edge.
  onDropDesktopInTree?: (
    payload: DesktopDragPayload,
    path: SplitPath,
    edge: DropEdge,
  ) => void;
  // Phase 64 Plan 02 — center-drop-from-conv-list dispatch. AppShell wires
  // this to `replaceInTree` (functional-updater around split-tree
  // `replaceLeaf`). See
  // `.planning/phases/64-multi-view-center-drop/64-CONTEXT.md` §
  // In-scope item 3.
  onReplaceInTree?: (
    replacementTabId: string,
    targetTabId: string,
  ) => void;
  // Row-source center-drop resolver (2026-09-18). When wired, takes
  // precedence over onReplaceInTree for row-mime center drops — passes the
  // full parsed payload upstream so AppShell can route through
  // resolveRowPayloadTabId (opens a fresh tab for fleet-only-detached rows
  // whose row.id is a fleet-synthetic string, not a real tabId). Fixes the
  // symmetric miss to patch #511: edge-drop went through the resolver;
  // center-drop planted the raw synthetic id into the tree and produced a
  // stale leaf that cascaded into a full-screen normal-view overlay. See
  // `bounties/center-drop-row-resolver/fix-center-drop-row-resolver.md`.
  // Falls back to onReplaceInTree when absent (keeps existing tests / any
  // legacy call sites unchanged).
  onCenterDropRow?: (payload: unknown, targetTabId: string) => void;
  // App-tile center-drop dispatch. Symmetric to onCenterDropRow but for
  // AppTile drags (application/x-skynet-app-tile mime). AppShell wires this
  // to openTab(null, "app", …) + replaceInTree(newTabId, targetTabId) — the
  // app-tile equivalent of the row center-drop replace-in-place. Falls
  // through to the unknown-mime no-op when absent (legacy behavior).
  onCenterDropAppTile?: (
    payload: { hostId: number; slug: string; title: string },
    targetTabId: string,
  ) => void;
  // File-chip center drop: replaces the target pane with a new file leaf.
  onCenterDropFileChip?: (
    payload: FileChipDragPayload,
    targetTabId: string,
  ) => void;
  // Desktop-button center drop: replaces the target pane with a new desktop leaf.
  onCenterDropDesktop?: (
    payload: DesktopDragPayload,
    targetTabId: string,
  ) => void;
  // Phase 64 Plan 02 — center-drop-from-open-badge dispatch. AppShell wires
  // this to `swapInTree` (functional-updater around split-tree
  // `swapLeaves`). See
  // `.planning/phases/64-multi-view-center-drop/64-CONTEXT.md` §
  // In-scope item 3.
  onSwapInTree?: (tabIdA: string, tabIdB: string) => void;
  // Cross-window badge drop handlers (2026-09-17). When provided, badge
  // drops route through AppShell's descriptor resolver — same-window drops
  // resolve to the local tabId (existing swap/insert behavior); cross-
  // window drops resolve to a freshly-opened session for the descriptor
  // and dispatch to replace/insert. Fallback to onSwapInTree /
  // onOpenSessionInTree when absent (keeps existing tests + call sites
  // unchanged).
  onDropBadgeInTree?: (
    payload: unknown,
    path: SplitPath,
    edge: DropEdge,
  ) => void;
  onCenterDropBadge?: (payload: unknown, targetTabId: string) => void;
  // Rescue affordance when a leaf references a tabId that no longer exists
  // in tabs[] (e.g. cross-window drag left a stranger tabId, or a session
  // died mid-view). Wired by AppShell to removeLeaf(splitTree, tabId).
  onCloseStalePane?: (tabId: string) => void;
}) {
  // Phase 57 Plan 02 — dropPreview replaces the Phase 56 `isDragOver: boolean`.
  // Stores the current edge-zone pick from `computeEdgeZone` (Plan 57-01) and
  // the pane's bounding rect at that pick, so the overlay's geometry stays
  // stable across renders even if a mid-drag layout reflow occurs.
  //
  // Empty state = null = no drag over (or drag over center dead zone).
  // Rationale: CONTEXT.md §In-scope item 2 (live cursor-tracking overlay).
  const [dropPreview, setDropPreview] = useState<{ zone: DropZone; rect: DOMRect } | null>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  // Phase 57 Plan 02 — prev-zone ref for the `[pv-split-preview]` structured
  // log's zone-change gate. Uses a REF (not a functional-updater on
  // setDropPreview) because React 18 strict mode double-invokes function
  // bodies including reducers, which would double-fire the log. The ref-
  // write happens synchronously inside the dragover handler (effect body,
  // not render body — React does not double-invoke effect handlers).
  const prevZoneRef = useRef<DropZone | null>(null);
  // Exclusive-claim + session-end sweep (drag-preview-session.ts). Covers
  // the holes the local dragleave/drop handlers can't: a leave whose final
  // coordinates sit on a shared edge, and a dragend lost because the drop
  // detached the drag source. Also replaces the per-pane window dragend.
  const { claim: claimPreview, release: releasePreview } = useDragPreviewClaim(
    `pane:${tabId}`,
    () => {
      setDropPreview(null);
      prevZoneRef.current = null;
    },
  );

  const contentRef = useCallback(
    (el: HTMLDivElement | null) => {
      onPaneContentRef?.(tabId, el);
    },
    [tabId, onPaneContentRef],
  );

  // Patch #514 — LOAD-BEARING: attach drag/drop listeners via NATIVE DOM,
  // NOT React synthetic events.
  //
  // The tab content (PrettyView, Terminal, dashboard) is portaled INTO
  // this Pane's DOM (specifically into the `[data-tab-id]` div below) by
  // AppShell's `createPortal(renderTabContent(...), tabNode, tab.id)` call
  // inside its `tabs.map(...)`. React portals preserve React-tree parentage
  // for the portaled subtree — so PrettyView's React parent is AppShell's
  // normal-view container, NOT this Pane, even though the DOM says
  // otherwise.
  //
  // React's SyntheticEvent bubbling walks the React tree, not the DOM tree.
  // A drop on portaled content bubbles via the React tree straight past
  // this Pane and lands on the AppShell outer container's onDrop (patch
  // #510). The Pane's React onDrop only fires for drops directly on the
  // small border around the portaled content — essentially unreachable in
  // practice.
  //
  // Native DOM listeners bubble through the actual DOM tree, so a drop
  // on portaled PrettyView DOES bubble up to this Pane's outer div and
  // the native listener fires. This is the only reliable way to attach a
  // drop target that owns "the area of the screen the Pane occupies."
  //
  // Traced 2026-08-28 via [pv-split-drop] outer logs — every UAT drop
  // hit the outer handler, never the pane. See patch #514 commit body
  // for the console trace evidence.
  useEffect(() => {
    const el = outerRef.current;
    if (el === null) return;
    const onDragOver = (e: DragEvent) => {
      if (!hasSkynetDragPayload(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const zone = computeEdgeZone(rect, e.clientX, e.clientY);
      // Phase 97 Plan 01 Task 1: temporary diagnostic emit (suffix "-diag" to
      // distinguish from the production preview/drop logs) for F-2 drag-drop
      // discovery. Mirrors the pv-split-preview template-string convention at
      // L356-360. MAY stay as ambient forensic instrumentation post-ship per
      // RESEARCH § Finding 2 landmines. Do NOT JSON.stringify the DOM Event
      // (Phase 93 Landmine 6).
      // eslint-disable-next-line no-console
      console.info(
        `[pv-split-drop-diag] phase=dragover pane path=${JSON.stringify(path)} zone=${zone} clientX=${Math.round(e.clientX)} clientY=${Math.round(e.clientY)}`,
      );
      // Phase 64 /close finding (Addition 3): suppress coral on
      // center-zone self-drop. The shape's contract is "coral appears →
      // release always performs the corresponding action." A self-drop
      // (drag source === target cell) at center is a benign no-op on
      // release (swap-with-self / replace-with-self both collapse to
      // no-op), so lighting coral there would break the visual contract.
      // Read the source tabId from the rich payload (same-origin drag
      // means getData is available at dragover time in modern browsers).
      // Only applies to center-zone: edge-zone self-drops still reshape
      // the tree via removeLeaf + insertAtEdge, so their coral is honest.
      // See shape-multi-view-center-drop.closed.md § Additions.
      if (zone === "center") {
        let sourceTabId = "";
        const badgeJson =
          e.dataTransfer?.getData("application/x-skynet-badge") ?? "";
        if (badgeJson.length > 0) {
          try {
            const parsed = JSON.parse(badgeJson) as { tabId?: unknown };
            if (typeof parsed?.tabId === "string") sourceTabId = parsed.tabId;
          } catch {
            /* fall through to row check */
          }
        }
        if (sourceTabId.length === 0) {
          const rowJson =
            e.dataTransfer?.getData("application/x-skynet-row") ?? "";
          if (rowJson.length > 0) {
            try {
              const parsed = JSON.parse(rowJson) as { id?: unknown };
              if (typeof parsed?.id === "string") sourceTabId = parsed.id;
            } catch {
              /* fall through to no-suppress */
            }
          }
        }
        if (sourceTabId.length > 0 && sourceTabId === tabId) {
          // Self-drop — clear any stale preview from a non-self edge zone
          // the cursor may have crossed on the way to center, then return.
          if (prevZoneRef.current !== null) {
            prevZoneRef.current = null;
          }
          setDropPreview((prev) => (prev === null ? prev : null));
          releasePreview();
          return;
        }
      }
      // Zone-change gate for the structured log. Ref-based (see prevZoneRef
      // JSDoc above) to avoid React 18 strict-mode double-fire. Log fires
      // synchronously inside the native listener body, before the setState
      // call — the ref write is atomic with the log emission.
      if (zone !== prevZoneRef.current) {
        // eslint-disable-next-line no-console
        console.info(
          `[pv-split-preview] pane path=${JSON.stringify(path)} zone=${zone} clientX=${Math.round(e.clientX)} clientY=${Math.round(e.clientY)} rectLTRB=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.right)},${Math.round(rect.bottom)}`,
        );
        prevZoneRef.current = zone;
      }
      // Structural bailout — if the zone hasn't changed, return the prev
      // object identity so React's setState bail-out skips the re-render.
      // On zone changes, allocate a new object with the fresh rect.
      setDropPreview((prev) => {
        if (prev !== null && prev.zone === zone) return prev;
        return { zone, rect };
      });
      claimPreview();
    };
    const onDragLeave = (e: DragEvent) => {
      // Type-gate FIRST — scope the flicker-fix machinery to our own skynet
      // drag payloads (row-drag via application/x-skynet-row OR badge-drag
      // via application/x-skynet-badge). Without this gate, unrelated
      // dragleaves (browser text-selection drags, OS file drags, native OS
      // drags) would clear dropPreview mid-drag whenever the browser fires a
      // spurious dragleave on the pane. (Plan-check finding #3.)
      // Tightened from text/plain-only gate in quick-260829-mbp — browser
      // text-selection drags carry text/plain=<selected-text> and were
      // passing the old gate, causing coral overlay + fake-tabId drops that
      // landed as stale split slots (SplitView.tsx:436 placeholder).
      if (!hasSkynetDragPayload(e.dataTransfer)) return;
      const rect = el.getBoundingClientRect();
      // Bounding-rect guard for the flicker fix (CONTEXT.md §Gap (a)). Stateless
      // (no counter to keep in sync across concurrent enter/leave pairs) and
      // robust against React-portal / DOM-tree mismatches — the portaled
      // PrettyView children live in this Pane's DOM subtree but their React
      // parent is AppShell's normal-view container, so `e.relatedTarget` +
      // `el.contains()` can be unreliable across React's portal-boundary
      // edge cases.
      const stillInside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!stillInside) {
        setDropPreview(null);
        // Reset the ref alongside the state — failing to reset means the
        // next dragover-back-into-the-pane won't emit a [pv-split-preview]
        // log because the ref still holds the last zone.
        prevZoneRef.current = null;
        releasePreview();
      }
    };
    const onDrop = (e: DragEvent) => {
      if (!hasSkynetDragPayload(e.dataTransfer)) return;
      e.preventDefault();
      // Prevent AppShell outer container's onDrop from also firing —
      // CRITICAL for the center-dead-zone short-circuit: the guard chain
      // (preventDefault + stopPropagation) fires BEFORE the center-check
      // return so the AppShell handler at AppShell.tsx:2265 never sees the
      // payload even for center-dead-zone drops.
      e.stopPropagation();
      setDropPreview(null);
      prevZoneRef.current = null;
      releasePreview();
      const rect = el.getBoundingClientRect();
      const zone = computeEdgeZone(rect, e.clientX, e.clientY);
      // Phase 97 Plan 01 Task 1: temporary diagnostic emit (suffix "-diag" to
      // distinguish from the production preview/drop logs) at the top of the
      // drop handler, BEFORE any dispatch. Mirrors the pv-split-preview /
      // pv-split-drop template-string convention. Reads the three payload
      // kinds ONCE for the log; downstream branches re-read via their own
      // getData calls (pre-existing pattern preserved). Do NOT JSON.stringify
      // the DOM Event (Phase 93 Landmine 6). Do NOT log payload bodies —
      // ONLY LENGTHS (defense-in-depth per V8).
      //
      // Phase 97 code-review Fix 4: tightened to strict length-only for the
      // text/plain payload as well. Was `tabIdSource=${diagSourceTabId}`
      // which emitted the payload body. Currently safe because upstream
      // guards the text/plain to a Skynet tab UUID, but the diag's own
      // comment claims "only lengths, no payload bodies" — the tabIdSource
      // emit contradicted that. If the MIME shape ever widens, this would
      // start emitting user text. Now `tabIdSourceLen=<n>` matches the
      // badge/row payload treatment.
      const diagSourceTabId = e.dataTransfer?.getData("text/plain") ?? "";
      const diagBadgeJsonLen =
        (e.dataTransfer?.getData("application/x-skynet-badge") ?? "").length;
      const diagRowJsonLen =
        (e.dataTransfer?.getData("application/x-skynet-row") ?? "").length;
      // eslint-disable-next-line no-console
      console.info(
        `[pv-split-drop-diag] phase=drop pane path=${JSON.stringify(path)} tabIdSourceLen=${diagSourceTabId.length} hasBadgePayload=${diagBadgeJsonLen > 0} hasRowPayload=${diagRowJsonLen > 0}`,
      );
      // Phase 64 Plan 02: center-zone dispatch. Was a silent short-circuit
      // through Phase 57 ("center dead zone"); now the drop is routed to
      // one of two handlers based on the drag source's MIME:
      //   - application/x-skynet-badge (open-session identity badge) →
      //     onSwapInTree(sourceTabId, targetTabId)
      //   - application/x-skynet-row (conv-list row) →
      //     onReplaceInTree(sourceTabId, targetTabId)
      //   - text/plain-only fallback (rare: badge-less, row-less, tabId
      //     present) → onReplaceInTree(payloadTabId, targetTabId)
      //   - unknown / malformed → silent no-op with
      //     `[pv-split-drop] center-drop-unknown-mime` log.
      // Self-drop (source === target) is a benign no-op with a structured
      // log (`center-self-drop-ignored`) per CONTEXT.md § Edge case #1.
      // See .planning/phases/64-multi-view-center-drop/64-CONTEXT.md §
      // In-scope items 2, 3, 5.
      if (zone === "center") {
        const badgeJson =
          e.dataTransfer?.getData("application/x-skynet-badge") ?? "";
        if (badgeJson.length > 0) {
          try {
            const parsed = JSON.parse(badgeJson) as { tabId?: unknown };
            const sourceTabId =
              typeof parsed?.tabId === "string" && parsed.tabId.length > 0
                ? parsed.tabId
                : "";
            if (sourceTabId.length > 0) {
              if (sourceTabId === tabId) {
                // eslint-disable-next-line no-console
                console.info(
                  `[pv-split-drop] center-self-drop-ignored path=${JSON.stringify(path)} tabId=${sourceTabId}`,
                );
                return;
              }
              // Cross-window-aware badge center-drop: onCenterDropBadge
              // (when wired) routes through AppShell's descriptor resolver
              // and decides swap-vs-replace based on whether the source
              // tabId is local. Fall back to raw onSwapInTree when the
              // callback isn't wired (tests / legacy paths).
              if (onCenterDropBadge) {
                // eslint-disable-next-line no-console
                console.info(
                  `[pv-split-drop] center-drop dispatch=badge-resolver path=${JSON.stringify(path)} sourceTabId=${sourceTabId} targetTabId=${tabId}`,
                );
                onCenterDropBadge(parsed, tabId);
                return;
              }
              // eslint-disable-next-line no-console
              console.info(
                `[pv-split-drop] center-drop dispatch=swap path=${JSON.stringify(path)} sourceTabId=${sourceTabId} targetTabId=${tabId}`,
              );
              onSwapInTree?.(sourceTabId, tabId);
              return;
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(
              `[pv-split-drop] center-drop badge-parse failed path=${JSON.stringify(path)}: ${(err as Error).message}`,
            );
            // Fall through to row / text/plain / unknown-mime branches.
          }
        }
        const rowJson =
          e.dataTransfer?.getData("application/x-skynet-row") ?? "";
        if (rowJson.length > 0) {
          try {
            const parsed = JSON.parse(rowJson) as { id?: unknown };
            const sourceTabId =
              typeof parsed?.id === "string" && parsed.id.length > 0
                ? parsed.id
                : "";
            if (sourceTabId.length > 0) {
              if (sourceTabId === tabId) {
                // eslint-disable-next-line no-console
                console.info(
                  `[pv-split-drop] center-self-drop-ignored path=${JSON.stringify(path)} tabId=${sourceTabId}`,
                );
                return;
              }
              // Row-source center-drop: prefer onCenterDropRow when wired
              // so AppShell can resolve the payload via
              // resolveRowPayloadTabId — for fleet-only-detached rows,
              // row.id is a fleet-synthetic string (e.g. `fleet::7::aqua`)
              // and MUST NOT be planted raw into the tree. Fall back to
              // the raw onReplaceInTree branch when the resolver callback
              // isn't wired (tests / legacy paths); the fallback preserves
              // pre-fix behavior for already-open rows where row.id IS the
              // tabId. See
              // `bounties/center-drop-row-resolver/fix-center-drop-row-resolver.md`.
              if (onCenterDropRow) {
                // eslint-disable-next-line no-console
                console.info(
                  `[pv-split-drop] center-drop dispatch=row-resolver path=${JSON.stringify(path)} rowId=${sourceTabId} targetTabId=${tabId}`,
                );
                onCenterDropRow(parsed, tabId);
                return;
              }
              // eslint-disable-next-line no-console
              console.info(
                `[pv-split-drop] center-drop dispatch=replace-rich path=${JSON.stringify(path)} rowId=${sourceTabId} targetTabId=${tabId}`,
              );
              onReplaceInTree?.(sourceTabId, tabId);
              return;
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(
              `[pv-split-drop] center-drop row-parse failed path=${JSON.stringify(path)}: ${(err as Error).message}`,
            );
            // Fall through to text/plain / unknown-mime branches.
          }
        }
        // App-tile center-drop dispatch. Symmetric to the row branch
        // above: a fresh drag from the sidebar's app tile lands in the
        // center zone of a target pane → open a new app leaf, replace
        // target with it. AppShell wires onCenterDropAppTile to
        // openTab(null, "app", ...) + replaceInTree(newTabId, targetTabId)
        // + selectConversationDeferred(newTabId). Mirror of the row-source
        // "replace what was here" semantic — user gesture is unambiguous
        // (drop app on center of pane = replace pane with app).
        const appTileJsonCenter =
          e.dataTransfer?.getData("application/x-skynet-app-tile") ?? "";
        if (appTileJsonCenter.length > 0 && onCenterDropAppTile) {
          try {
            const parsed = JSON.parse(appTileJsonCenter) as {
              hostId: number;
              slug: string;
              title: string;
            };
            systemLogger.info("pv-split-drop center-drop dispatch=app-tile", {
              operation: "pv_split_drop_center_app_tile",
              hostId: typeof parsed?.hostId === "number" ? parsed.hostId : undefined,
              slug: typeof parsed?.slug === "string" ? parsed.slug : undefined,
              targetTabId: tabId,
            });
            onCenterDropAppTile(parsed, tabId);
            return;
          } catch (err) {
            systemLogger.warn("pv-split-drop center-drop app-tile parse failed", {
              operation: "pv_split_drop_center_app_tile_parse_failed",
              error: (err as Error).message,
            });
            // Fall through to unknown-mime no-op below.
          }
        }
        // File-chip center drop: open a new file leaf in place of the target.
        const fileChipCenter = parseFileChipPayload(
          e.dataTransfer?.getData(FILE_CHIP_MIME) ?? "",
        );
        if (fileChipCenter !== null && onCenterDropFileChip) {
          systemLogger.info("pv-split-drop center-drop dispatch=file-chip", {
            operation: "pv_split_drop_center_file_chip",
            host: fileChipCenter.host,
            filename: fileChipCenter.filename,
            targetTabId: tabId,
          });
          onCenterDropFileChip(fileChipCenter, tabId);
          return;
        }
        // Desktop-button center drop: open a new desktop leaf in place of the target.
        const desktopCenter = parseDesktopDragPayload(
          e.dataTransfer?.getData(DESKTOP_DRAG_MIME) ?? "",
        );
        if (desktopCenter !== null && onCenterDropDesktop) {
          systemLogger.info("pv-split-drop center-drop dispatch=desktop", {
            operation: "pv_split_drop_center_desktop",
            hostId: desktopCenter.hostId,
            identityKey: desktopCenter.identityKey,
            targetTabId: tabId,
          });
          onCenterDropDesktop(desktopCenter, tabId);
          return;
        }
        // Phase 64 /close finding (Addition 2): text/plain-only fallback
        // path REMOVED. The shape strictly names two rich-payload sources
        // (row via application/x-skynet-row, badge via
        // application/x-skynet-badge). Accepting bare text/plain as a
        // session-tabId payload opens a hole for stray browser drags
        // (text selection, external drag) to clobber a live session on
        // release. Fail-closed: if both rich-payload branches missed
        // (absent OR malformed), fall through to unknown-mime silent
        // no-op. See shape-multi-view-center-drop.closed.md § Additions.
        // eslint-disable-next-line no-console
        console.info(
          `[pv-split-drop] center-drop-unknown-mime path=${JSON.stringify(path)} types=${JSON.stringify(Array.from(e.dataTransfer?.types ?? []))}`,
        );
        return;
      }
      // Zone is narrowed to DropEdge — 'center' returned above.
      const edge: DropEdge = zone;
      const richJson =
        e.dataTransfer?.getData("application/x-skynet-row") ?? "";
      // eslint-disable-next-line no-console
      console.info(
        `[pv-split-drop] pane path=${JSON.stringify(path)} zone=${edge} edge=${edge} clientX=${Math.round(e.clientX)} clientY=${Math.round(e.clientY)} rectLTRB=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.right)},${Math.round(rect.bottom)} hasRichPayload=${richJson.length > 0} richLen=${richJson.length} hasOnDropRowInTree=${!!onDropRowInTree}`,
      );
      if (richJson && onDropRowInTree) {
        try {
          const parsed = JSON.parse(richJson);
          // eslint-disable-next-line no-console
          console.info(
            `[pv-split-drop] pane dispatch=rich rowId=${parsed?.id ?? "?"} fleetOnly=${parsed?.fleetOnly === true} rdpHostRow=${parsed?.rdpHostRow === true} hostId=${parsed?.host?.id ?? "?"} tmux=${parsed?.targetTmuxSession ?? "?"}`,
          );
          onDropRowInTree(parsed, path, edge);
          return;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[pv-split-drop] pane rich-payload parse failed — falling back to text/plain: ${(err as Error).message}`,
          );
        }
      }
      // Phase 120 D-07 — app-tile edge-drop dispatch. Mirrors the row branch
      // above (parse + dispatch + early-return). AppShell wires
      // onDropAppTileInTree to openTab(null, "app", ..., { app, label }) +
      // insertLeafAtEdge — an app-tile drag CREATES a new leaf (matches the
      // effectAllowed="copy" contract on the drag source). The Phase 64
      // closure at :596-608 stays in force: the app-tile drag source does
      // NOT emit a bare-text payload, so the fallback branch further below
      // is unreachable for this source.
      const appTileJson =
        e.dataTransfer?.getData("application/x-skynet-app-tile") ?? "";
      if (appTileJson && onDropAppTileInTree) {
        try {
          const parsed = JSON.parse(appTileJson) as {
            hostId: number;
            slug: string;
            title: string;
          };
          // LOW-15 fix (2026-09-19): structured logger over raw console.info.
          // hostId + slug are extracted explicitly per the role-file 2026-08-11
          // "actionable in isolation" directive.
          systemLogger.info("pv-split-drop pane dispatch=app-tile", {
            operation: "pv_split_drop_app_tile",
            hostId: typeof parsed?.hostId === "number" ? parsed.hostId : undefined,
            slug: typeof parsed?.slug === "string" ? parsed.slug : undefined,
          });
          onDropAppTileInTree(parsed, path, edge);
          return;
        } catch (err) {
          systemLogger.warn("pv-split-drop pane app-tile parse failed", {
            operation: "pv_split_drop_app_tile_parse_failed",
            errorMessage: (err as Error).message,
          });
        }
      }
      // File-chip edge drop: a chip drag CREATES a new file leaf (copy
      // gesture, like an app tile — the chip stays in its bubble).
      const fileChip = parseFileChipPayload(e.dataTransfer?.getData(FILE_CHIP_MIME) ?? "");
      if (fileChip !== null && onDropFileChipInTree) {
        systemLogger.info("pv-split-drop pane dispatch=file-chip", {
          operation: "pv_split_drop_file_chip",
          host: fileChip.host,
          filename: fileChip.filename,
          edge,
        });
        onDropFileChipInTree(fileChip, path, edge);
        return;
      }
      // Desktop-button edge drop: a copy gesture like a file chip — the
      // button stays beside its task pill; a new desktop leaf opens here.
      const desktopDrop = parseDesktopDragPayload(
        e.dataTransfer?.getData(DESKTOP_DRAG_MIME) ?? "",
      );
      if (desktopDrop !== null && onDropDesktopInTree) {
        systemLogger.info("pv-split-drop pane dispatch=desktop", {
          operation: "pv_split_drop_desktop",
          hostId: desktopDrop.hostId,
          identityKey: desktopDrop.identityKey,
          edge,
        });
        onDropDesktopInTree(desktopDrop, path, edge);
        return;
      }
      // Cross-window-aware badge edge-drop (2026-09-17). When onDropBadgeInTree
      // is wired AND the payload carries the badge MIME, route through
      // AppShell's descriptor resolver — same-window resolves to local tabId
      // (parity with the text/plain fallback below); cross-window opens a
      // fresh session for the descriptor. Silent-reject when the resolver
      // returns null, preventing the "Session no longer exists" black hole
      // that the old text/plain fallback produced on unknown tabIds.
      const badgeJson =
        e.dataTransfer?.getData("application/x-skynet-badge") ?? "";
      if (badgeJson && onDropBadgeInTree) {
        try {
          const parsed = JSON.parse(badgeJson);
          // eslint-disable-next-line no-console
          console.info(
            `[pv-split-drop] pane dispatch=badge-resolver payloadTabId=${parsed?.tabId ?? "?"} identity=${parsed?.identityKey ?? "?"} hostId=${parsed?.hostId ?? "?"} hasDescriptor=${parsed?.descriptor != null}`,
          );
          onDropBadgeInTree(parsed, path, edge);
          return;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[pv-split-drop] pane badge-payload parse failed — falling back to text/plain: ${(err as Error).message}`,
          );
        }
      }
      const payloadTabId = e.dataTransfer?.getData("text/plain") ?? "";
      // eslint-disable-next-line no-console
      console.info(
        `[pv-split-drop] pane dispatch=fallback payloadTabId=${payloadTabId || "(empty)"}`,
      );
      if (payloadTabId) {
        onOpenSessionInTree?.(payloadTabId, path, edge);
      }
    };
    // Escape-cancel / lost-dragend cleanup lives in useDragPreviewClaim's
    // session-end sweep (drag-preview-session.ts).
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
    };
    // path is a fresh array each render; JSON.stringify it into the dep
    // list so a real path change reattaches (identity would fire every
    // render).
  }, [
    path.join("."),
    onDropRowInTree,
    onDropAppTileInTree,
    onDropFileChipInTree,
    onDropDesktopInTree,
    onOpenSessionInTree,
    onReplaceInTree,
    onCenterDropRow,
    onCenterDropAppTile,
    onCenterDropFileChip,
    onCenterDropDesktop,
    onSwapInTree,
    onDropBadgeInTree,
    onCenterDropBadge,
    tabId,
    claimPreview,
    releasePreview,
  ]);

  return (
    /* Patch #517 follow-up (quick-260829-fh3): `isolate` establishes a CSS
       stacking context on this Pane wrapper. Without it, PrettyView's
       high-z descendants — IdentityBadge (z-[101] at
       features/terminal/IdentityBadge.tsx:90), DropOverlay (z-[95]),
       SessionHoldingOverlay (z-[99]), and the composebox close button —
       are compared against the AppShell tree and beat the normal-view
       container's zIndex:10 (src/ui/AppShell.tsx:2552-2555) that is
       supposed to cover the split when the active tab is outside the
       split tree. 2026-08-28 UAT trace: ghost identity badge +
       composebox chrome hovering on top of an RDP surface after
       clicking a non-split-tree RDP session while a multi-view split
       was active. `isolate` (Tailwind v4 shorthand for
       `isolation: isolate`) contains that z-index budget inside the
       Pane. Regression test at SplitView.stacking-context.test.tsx.
       Do NOT remove without either (a) removing every z-[NN] > 10
       inside PrettyView chrome, or (b) restructuring the AppShell
       layer gate. Both are strictly larger changes. */
    <div
      ref={outerRef}
      className={`relative isolate flex flex-col w-full h-full min-w-0 min-h-0 overflow-hidden transition-colors ${
        isFocused ? "ring-1 ring-inset ring-accent-brand/30" : ""
      }`}
      onClick={() => onPaneClick?.(tabId)}
    >
      {/* Patch #512: PaneHeader chrome REMOVED per shape file:
          "a session in a cell should feel like the same PrettyView, just
          smaller. If the presence of siblings changes bubble padding,
          header sizing, or compose-box behavior, the surface has been
          split cosmetically as well as structurally, which is not the
          intent." PrettyView has its own IdentityBadge (patch #35, Phase 4
          badge relocation) that identifies which cell shows which session
          without adding a title bar. */}
      {tab === null && (
        <div
          className="absolute inset-0 flex items-center justify-center gap-3 z-20"
          data-testid="pane-stale-tab-placeholder"
        >
          <span className="opacity-40 text-xs font-medium select-none pointer-events-none">
            Session no longer exists
          </span>
          {onCloseStalePane && (
            <button
              type="button"
              data-testid="pane-stale-tab-close"
              aria-label="Close stale pane"
              title="Close stale pane"
              onClick={(e) => {
                e.stopPropagation();
                onCloseStalePane(tabId);
              }}
              className="cursor-pointer text-xs font-medium opacity-50 hover:opacity-100 transition-opacity px-2 py-1 rounded border border-current"
            >
              Close
            </button>
          )}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        <div
          ref={contentRef}
          data-tab-id={tabId}
          className="absolute inset-0"
        />
        {/* Phase 57 Plan 02 — coral drop-preview overlay. Sibling to the
            [data-tab-id] portal-target above; direct child of the
            .flex-1.min-h-0.overflow-hidden.relative wrapper (same DOM depth
            as the Phase 56 placeholder it replaces). Inline styles snap
            to the winning edge (half the pane along that edge, t=0.5,
            matching prototype.html:414-421). pointer-events: none so drag
            events fire on the pane's outer div underneath. Coral RGB
            (255, 184, 150) matches the app's --color-pv-code-fg token at
            index.css:159 and the prototype's --highlight rgba(255,184,150,0.20)
            / --highlight-strong rgba(255,184,150,0.55). */}
        {/* Phase 64 Plan 02: the `!== "center"` gate is REPLACED — the
            overlay now renders for center too, with full-cell geometry.
            The `hasSkynetDragPayload` gate at :275 already prevents
            non-skynet drags from setting dropPreview in the first place,
            so any dropPreview reaching this JSX is guaranteed to originate
            from a valid skynet MIME. Coral RGBA, border, pointer-events,
            transition — UNCHANGED ("same coral vocabulary" per shape file). */}
        {/* zIndex: 100 — above the pane-local state overlays in the z-[95]
            /z-[99] band (DropOverlay z-[95], SessionHoldingOverlay z-[99],
            PrettyViewLoadingOverlay z-[99], PrettyViewErrorOverlay z-[99]) so
            the drop-preview stays visible when the pane is showing one of
            those scrims. Was
            zIndex:20 pre-2026-09-02, which sat UNDER SessionHoldingOverlay in
            the shared Pane-isolate stacking context (the .flex-1.relative
            wrapper doesn't establish its own stacking context, so the coral
            and SessionHoldingOverlay siblings-of-siblings compare directly).
            Left BELOW IdentityBadge (z-[101]) so the badge stays crisp above
            the translucent coral tint. */}
        {dropPreview !== null && (
          <div
            data-testid="pane-drop-preview-overlay"
            data-zone={dropPreview.zone}
            className="absolute pointer-events-none"
            style={{
              ...overlayGeometryForZone(dropPreview.zone, dropPreview.rect),
              background: "rgba(255, 184, 150, 0.22)",
              border: "2px solid rgba(255, 184, 150, 0.60)",
              borderRadius: 0,
              zIndex: 100,
              transition:
                "left 80ms ease, top 80ms ease, width 80ms ease, height 80ms ease",
            }}
          />
        )}
      </div>
    </div>
  );
});

// PaneTree — recursive renderer. Leaf → Pane; split → RowView, which
// flattens the same-direction chain into one row (stacked for 'horizontal',
// side-by-side for 'vertical') sized by its row fractions.
function PaneTree({
  node,
  path,
  tabs,
  focusedTabId,
  onPaneContentRef,
  onPaneClick,
  onOpenSessionInTree,
  onDropRowInTree,
  onDropAppTileInTree,
  onDropFileChipInTree,
  onDropDesktopInTree,
  onReplaceInTree,
  onCenterDropRow,
  onCenterDropAppTile,
  onCenterDropFileChip,
  onCenterDropDesktop,
  onSwapInTree,
  onDropBadgeInTree,
  onCenterDropBadge,
  onCloseStalePane,
  onResizeRow,
  onTerminalResize,
}: {
  node: SplitNode;
  path: SplitPath;
  tabs: Tab[];
  focusedTabId?: string | null;
  onPaneContentRef?: (tabId: string, el: HTMLDivElement | null) => void;
  onPaneClick?: (tabId: string) => void;
  onOpenSessionInTree?: (
    tabId: string,
    path: SplitPath,
    edge: DropEdge,
  ) => void;
  onDropRowInTree?: (
    payload: unknown,
    path: SplitPath,
    edge: DropEdge,
  ) => void;
  // Phase 120 D-07 — see Pane props above for the full JSDoc.
  onDropAppTileInTree?: (
    payload: { hostId: number; slug: string; title: string },
    path: SplitPath,
    edge: DropEdge,
  ) => void;
  // File-chip drop (FILE_CHIP_MIME): opens a new file leaf at the edge.
  onDropFileChipInTree?: (
    payload: FileChipDragPayload,
    path: SplitPath,
    edge: DropEdge,
  ) => void;
  // Desktop-button drop (DESKTOP_DRAG_MIME): opens a new desktop leaf at the edge.
  onDropDesktopInTree?: (
    payload: DesktopDragPayload,
    path: SplitPath,
    edge: DropEdge,
  ) => void;
  // Phase 64 Plan 02 — center-drop handlers threaded through PaneTree to
  // reach each leaf's Pane instance.
  onReplaceInTree?: (
    replacementTabId: string,
    targetTabId: string,
  ) => void;
  // Row-source center-drop resolver (2026-09-18) — see Pane props.
  onCenterDropRow?: (payload: unknown, targetTabId: string) => void;
  // App-tile center-drop dispatch — see Pane props for full JSDoc.
  onCenterDropAppTile?: (
    payload: { hostId: number; slug: string; title: string },
    targetTabId: string,
  ) => void;
  // File-chip center drop: replaces the target pane with a new file leaf.
  onCenterDropFileChip?: (
    payload: FileChipDragPayload,
    targetTabId: string,
  ) => void;
  // Desktop-button center drop: replaces the target pane with a new desktop leaf.
  onCenterDropDesktop?: (
    payload: DesktopDragPayload,
    targetTabId: string,
  ) => void;
  onSwapInTree?: (tabIdA: string, tabIdB: string) => void;
  onDropBadgeInTree?: (
    payload: unknown,
    path: SplitPath,
    edge: DropEdge,
  ) => void;
  onCenterDropBadge?: (payload: unknown, targetTabId: string) => void;
  onCloseStalePane?: (tabId: string) => void;
  onResizeRow?: (rowPath: SplitPath, fractions: number[] | null) => void;
  onTerminalResize?: () => void;
}) {
  if (node.kind === "session") {
    const tab = tabs.find((tt) => tt.id === node.tabId) ?? null;
    return (
      <Pane
        tab={tab}
        tabId={node.tabId}
        path={path}
        isFocused={focusedTabId === node.tabId}
        onPaneContentRef={onPaneContentRef}
        onPaneClick={onPaneClick}
        onOpenSessionInTree={onOpenSessionInTree}
        onDropRowInTree={onDropRowInTree}
        onDropAppTileInTree={onDropAppTileInTree}
        onDropFileChipInTree={onDropFileChipInTree}
        onDropDesktopInTree={onDropDesktopInTree}
        onReplaceInTree={onReplaceInTree}
        onCenterDropRow={onCenterDropRow}
        onCenterDropAppTile={onCenterDropAppTile}
        onCenterDropFileChip={onCenterDropFileChip}
        onCenterDropDesktop={onCenterDropDesktop}
        onSwapInTree={onSwapInTree}
        onDropBadgeInTree={onDropBadgeInTree}
        onCenterDropBadge={onCenterDropBadge}
        onCloseStalePane={onCloseStalePane}
      />
    );
  }
  return (
    <RowView
      node={node}
      path={path}
      onResizeRow={onResizeRow}
      onTerminalResize={onTerminalResize}
      renderMember={(member, memberPath) => (
        <PaneTree
          node={member}
          path={memberPath}
          tabs={tabs}
          focusedTabId={focusedTabId}
          onPaneContentRef={onPaneContentRef}
          onPaneClick={onPaneClick}
          onOpenSessionInTree={onOpenSessionInTree}
          onDropRowInTree={onDropRowInTree}
          onDropAppTileInTree={onDropAppTileInTree}
          onDropFileChipInTree={onDropFileChipInTree}
          onDropDesktopInTree={onDropDesktopInTree}
          onReplaceInTree={onReplaceInTree}
          onCenterDropRow={onCenterDropRow}
          onCenterDropAppTile={onCenterDropAppTile}
          onCenterDropFileChip={onCenterDropFileChip}
          onCenterDropDesktop={onCenterDropDesktop}
          onSwapInTree={onSwapInTree}
          onDropBadgeInTree={onDropBadgeInTree}
          onCenterDropBadge={onCenterDropBadge}
          onCloseStalePane={onCloseStalePane}
          onResizeRow={onResizeRow}
          onTerminalResize={onTerminalResize}
        />
      )}
    />
  );
}

// SplitView — top-level export. Renders the EmptyDropTarget when the tree is
// null, otherwise PaneTree at the root. On tree change, schedules a rAF
// notify to onTerminalResize (parity with the pre-refactor behavior).
export const SplitView = memo(function SplitView({
  tabs,
  splitTree,
  focusedTabId,
  onTerminalResize,
  onPaneContentRef,
  onPaneClick,
  onOpenSessionInTree,
  onDropRowInTree,
  onDropAppTileInTree,
  onDropFileChipInTree,
  onDropDesktopInTree,
  onReplaceInTree,
  onCenterDropRow,
  onCenterDropAppTile,
  onCenterDropFileChip,
  onCenterDropDesktop,
  onSwapInTree,
  onDropBadgeInTree,
  onCenterDropBadge,
  onCloseStalePane,
  onResizeRow,
}: {
  tabs: Tab[];
  splitTree: SplitNode | null;
  focusedTabId?: string | null;
  onTerminalResize?: () => void;
  onPaneContentRef?: (tabId: string, el: HTMLDivElement | null) => void;
  onPaneClick?: (tabId: string) => void;
  onOpenSessionInTree?: (
    tabId: string,
    path: SplitPath,
    edge: DropEdge,
  ) => void;
  onDropRowInTree?: (
    payload: unknown,
    path: SplitPath,
    edge: DropEdge,
  ) => void;
  // Phase 120 D-07 — app-tile drop dispatch. See Pane props above for the
  // full JSDoc. AppShell wires this to `onDropAppTileInTree` which calls
  // openTab(null, "app", ..., { app, label }) + insertLeafAtEdge.
  onDropAppTileInTree?: (
    payload: { hostId: number; slug: string; title: string },
    path: SplitPath,
    edge: DropEdge,
  ) => void;
  // File-chip drop (FILE_CHIP_MIME): opens a new file leaf at the edge.
  onDropFileChipInTree?: (
    payload: FileChipDragPayload,
    path: SplitPath,
    edge: DropEdge,
  ) => void;
  // Desktop-button drop (DESKTOP_DRAG_MIME): opens a new desktop leaf at the edge.
  onDropDesktopInTree?: (
    payload: DesktopDragPayload,
    path: SplitPath,
    edge: DropEdge,
  ) => void;
  // Phase 64 Plan 02 — center-drop-from-conv-list-row dispatch. Wired by
  // AppShell to `replaceInTree` (functional-updater around split-tree
  // `replaceLeaf` from Plan 64-01). See CONTEXT.md § In-scope items 2, 3.
  onReplaceInTree?: (
    replacementTabId: string,
    targetTabId: string,
  ) => void;
  // Row-source center-drop resolver (2026-09-18) — see Pane props.
  onCenterDropRow?: (payload: unknown, targetTabId: string) => void;
  // App-tile center-drop dispatch — see Pane props for full JSDoc.
  onCenterDropAppTile?: (
    payload: { hostId: number; slug: string; title: string },
    targetTabId: string,
  ) => void;
  // File-chip center drop: replaces the target pane with a new file leaf.
  onCenterDropFileChip?: (
    payload: FileChipDragPayload,
    targetTabId: string,
  ) => void;
  // Desktop-button center drop: replaces the target pane with a new desktop leaf.
  onCenterDropDesktop?: (
    payload: DesktopDragPayload,
    targetTabId: string,
  ) => void;
  // Phase 64 Plan 02 — center-drop-from-open-badge dispatch. Wired by
  // AppShell to `swapInTree` (functional-updater around split-tree
  // `swapLeaves` from Plan 64-01).
  onSwapInTree?: (tabIdA: string, tabIdB: string) => void;
  // Cross-window badge drop handlers (2026-09-17). See Pane props above.
  onDropBadgeInTree?: (
    payload: unknown,
    path: SplitPath,
    edge: DropEdge,
  ) => void;
  onCenterDropBadge?: (payload: unknown, targetTabId: string) => void;
  onCloseStalePane?: (tabId: string) => void;
  // Divider drag commit (fractions) / double-click reset (null) for the row
  // rooted at `rowPath`. AppShell wires this to split-tree setRowFractions /
  // clearRowAt.
  onResizeRow?: (rowPath: SplitPath, fractions: number[] | null) => void;
}) {
  useEffect(() => {
    const id = requestAnimationFrame(() => onTerminalResize?.());
    return () => cancelAnimationFrame(id);
  }, [splitTree, onTerminalResize]);

  // While a pane / row / app tile is being dragged, divider strips step
  // aside (body[data-split-dnd], index.css) so a drop near the line between
  // two panes lands on the pane under the pointer. Same arm/disarm pattern
  // as AppPane's iframe mute: dragover re-arms after a watchdog end and
  // covers drags started in another Skynet window.
  useEffect(() => {
    const arm = (e: DragEvent) => {
      if (!hasSkynetDragPayload(e.dataTransfer)) return;
      if (!document.body.hasAttribute("data-split-dnd")) {
        document.body.setAttribute("data-split-dnd", "");
      }
    };
    const disarm = () => document.body.removeAttribute("data-split-dnd");
    const unsubscribe = subscribeDragSessionEnd(disarm);
    window.addEventListener("dragstart", arm);
    window.addEventListener("dragover", arm);
    return () => {
      window.removeEventListener("dragstart", arm);
      window.removeEventListener("dragover", arm);
      unsubscribe();
      disarm();
    };
  }, []);

  if (splitTree === null) {
    return (
      <div className="flex flex-col w-full h-full min-h-0 overflow-hidden relative">
        <EmptyDropTarget onOpenSessionInTree={onOpenSessionInTree} />
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full min-h-0 overflow-hidden relative" data-split-root="">
      <PaneTree
        node={splitTree}
        path={[]}
        tabs={tabs}
        focusedTabId={focusedTabId}
        onPaneContentRef={onPaneContentRef}
        onPaneClick={onPaneClick}
        onOpenSessionInTree={onOpenSessionInTree}
        onDropRowInTree={onDropRowInTree}
        onDropAppTileInTree={onDropAppTileInTree}
        onDropFileChipInTree={onDropFileChipInTree}
        onDropDesktopInTree={onDropDesktopInTree}
        onReplaceInTree={onReplaceInTree}
        onCenterDropRow={onCenterDropRow}
        onCenterDropAppTile={onCenterDropAppTile}
        onCenterDropFileChip={onCenterDropFileChip}
        onCenterDropDesktop={onCenterDropDesktop}
        onSwapInTree={onSwapInTree}
        onDropBadgeInTree={onDropBadgeInTree}
        onCenterDropBadge={onCenterDropBadge}
        onCloseStalePane={onCloseStalePane}
        onResizeRow={onResizeRow}
        onTerminalResize={onTerminalResize}
      />
    </div>
  );
});
