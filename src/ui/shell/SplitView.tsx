// ─── SplitView.tsx ───────────────────────────────────────────────────────────
// Phase 56 Plan 02 — recursive-tree renderer. Phase 56 Plan 03 substitutes the
// real nearest-edge geometry in place of Plan 02's stub.
//
// Adopted (Plan 56-01 + 56-02 + 56-03 LOCKED decisions — Ashley 2026-08-28):
//   - Recursive `SplitNode` tree drives layout. Leaves render as `Pane`;
//     internal nodes render as flex containers with a constant-width,
//     non-draggable `<Divider>` between two children.
//   - Constant-ratio 50/50 splits (no draggable dividers).
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
import { computeEdgeZone } from "@/lib/split-tree";

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

// Constant-width, non-draggable divider. `direction` matches split-tree.ts's
// SplitDirection convention: 'horizontal' = 1px-tall line separating stacked
// children; 'vertical' = 1px-wide line separating side-by-side children.
function Divider({ direction }: { direction: "horizontal" | "vertical" }) {
  if (direction === "horizontal") {
    return (
      <div
        className="h-px w-full shrink-0 bg-[color:var(--color-pv-border-quiet-strong)] pointer-events-none"
        role="separator"
        aria-orientation="horizontal"
      />
    );
  }
  return (
    <div
      className="w-px h-full shrink-0 bg-[color:var(--color-pv-border-quiet-strong)] pointer-events-none"
      role="separator"
      aria-orientation="vertical"
    />
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
// IdentityBadge drags, application/x-skynet-row for conv-list-row drags).
// Pure function; used in all three Pane native drag listeners (onDragOver,
// onDragLeave, onDrop) to reject browser text-selection drags, which carry
// only text/plain=<selected-text> and were falsely passing the old gate.
function hasSkynetDragPayload(dt: DataTransfer | null | undefined): boolean {
  return (
    (dt?.types.includes("application/x-skynet-badge") ?? false) ||
    (dt?.types.includes("application/x-skynet-row") ?? false)
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
  onReplaceInTree,
  onSwapInTree,
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
  // Phase 64 Plan 02 — center-drop-from-conv-list dispatch. AppShell wires
  // this to `replaceInTree` (functional-updater around split-tree
  // `replaceLeaf`). See
  // `.planning/phases/64-multi-view-center-drop/64-CONTEXT.md` §
  // In-scope item 3.
  onReplaceInTree?: (
    replacementTabId: string,
    targetTabId: string,
  ) => void;
  // Phase 64 Plan 02 — center-drop-from-open-badge dispatch. AppShell wires
  // this to `swapInTree` (functional-updater around split-tree
  // `swapLeaves`). See
  // `.planning/phases/64-multi-view-center-drop/64-CONTEXT.md` §
  // In-scope item 3.
  onSwapInTree?: (tabIdA: string, tabIdB: string) => void;
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
      const rect = el.getBoundingClientRect();
      const zone = computeEdgeZone(rect, e.clientX, e.clientY);
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
      const payloadTabId = e.dataTransfer?.getData("text/plain") ?? "";
      // eslint-disable-next-line no-console
      console.info(
        `[pv-split-drop] pane dispatch=fallback payloadTabId=${payloadTabId || "(empty)"}`,
      );
      if (payloadTabId) {
        onOpenSessionInTree?.(payloadTabId, path, edge);
      }
    };
    // Window-level dragend cleanup — Escape cancels a drag WITHOUT moving
    // the cursor, so no dragleave fires; dragend on the source is the only
    // reliable signal that the drag has ended. Window-level attach because
    // dragend fires on the SOURCE element (conv-list row / identity badge),
    // not on this Pane; scoping to `el` would miss it. Idempotent — nulling
    // already-null state is a no-op, so this is safe even when a drop
    // already cleared the state.
    const onDragEnd = () => {
      setDropPreview(null);
      prevZoneRef.current = null;
    };
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    window.addEventListener("dragend", onDragEnd);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", onDragEnd);
    };
    // path is a fresh array each render; JSON.stringify it into the dep
    // list so a real path change reattaches (identity would fire every
    // render).
  }, [
    path.join("."),
    onDropRowInTree,
    onOpenSessionInTree,
    onReplaceInTree,
    onSwapInTree,
    tabId,
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
          className="absolute inset-0 flex items-center justify-center pointer-events-none z-20"
          data-testid="pane-stale-tab-placeholder"
        >
          <span className="opacity-40 text-xs font-medium select-none">
            Session no longer exists
          </span>
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
            the drop-preview stays visible when the pane's session is being
            recycled or is otherwise showing one of those scrims. Was
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

// PaneTree — recursive renderer. Leaf → Pane; split → flex container.
// direction 'horizontal' → stacked (flexDirection: column); 'vertical' →
// side-by-side (flexDirection: row). Each child wrapped in flex: 1 1 0 for
// equal 50/50 halves.
function PaneTree({
  node,
  path,
  tabs,
  focusedTabId,
  onPaneContentRef,
  onPaneClick,
  onOpenSessionInTree,
  onDropRowInTree,
  onReplaceInTree,
  onSwapInTree,
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
  // Phase 64 Plan 02 — center-drop handlers threaded through PaneTree to
  // reach each leaf's Pane instance.
  onReplaceInTree?: (
    replacementTabId: string,
    targetTabId: string,
  ) => void;
  onSwapInTree?: (tabIdA: string, tabIdB: string) => void;
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
        onReplaceInTree={onReplaceInTree}
        onSwapInTree={onSwapInTree}
      />
    );
  }
  const flexDirection: "row" | "column" =
    node.direction === "horizontal" ? "column" : "row";
  return (
    <div
      className="flex w-full h-full min-w-0 min-h-0"
      style={{ flexDirection }}
    >
      <div
        className="min-w-0 min-h-0 overflow-hidden"
        style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0 }}
      >
        <PaneTree
          node={node.children[0]}
          path={[...path, 0]}
          tabs={tabs}
          focusedTabId={focusedTabId}
          onPaneContentRef={onPaneContentRef}
          onPaneClick={onPaneClick}
          onOpenSessionInTree={onOpenSessionInTree}
          onDropRowInTree={onDropRowInTree}
          onReplaceInTree={onReplaceInTree}
          onSwapInTree={onSwapInTree}
        />
      </div>
      <Divider direction={node.direction} />
      <div
        className="min-w-0 min-h-0 overflow-hidden"
        style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0 }}
      >
        <PaneTree
          node={node.children[1]}
          path={[...path, 1]}
          tabs={tabs}
          focusedTabId={focusedTabId}
          onPaneContentRef={onPaneContentRef}
          onPaneClick={onPaneClick}
          onOpenSessionInTree={onOpenSessionInTree}
          onDropRowInTree={onDropRowInTree}
          onReplaceInTree={onReplaceInTree}
          onSwapInTree={onSwapInTree}
        />
      </div>
    </div>
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
  onReplaceInTree,
  onSwapInTree,
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
  // Phase 64 Plan 02 — center-drop-from-conv-list-row dispatch. Wired by
  // AppShell to `replaceInTree` (functional-updater around split-tree
  // `replaceLeaf` from Plan 64-01). See CONTEXT.md § In-scope items 2, 3.
  onReplaceInTree?: (
    replacementTabId: string,
    targetTabId: string,
  ) => void;
  // Phase 64 Plan 02 — center-drop-from-open-badge dispatch. Wired by
  // AppShell to `swapInTree` (functional-updater around split-tree
  // `swapLeaves` from Plan 64-01).
  onSwapInTree?: (tabIdA: string, tabIdB: string) => void;
}) {
  useEffect(() => {
    const id = requestAnimationFrame(() => onTerminalResize?.());
    return () => cancelAnimationFrame(id);
  }, [splitTree, onTerminalResize]);

  if (splitTree === null) {
    return (
      <div className="flex flex-col w-full h-full min-h-0 overflow-hidden relative">
        <EmptyDropTarget onOpenSessionInTree={onOpenSessionInTree} />
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full min-h-0 overflow-hidden relative">
      <PaneTree
        node={splitTree}
        path={[]}
        tabs={tabs}
        focusedTabId={focusedTabId}
        onPaneContentRef={onPaneContentRef}
        onPaneClick={onPaneClick}
        onOpenSessionInTree={onOpenSessionInTree}
        onDropRowInTree={onDropRowInTree}
        onReplaceInTree={onReplaceInTree}
        onSwapInTree={onSwapInTree}
      />
    </div>
  );
});
