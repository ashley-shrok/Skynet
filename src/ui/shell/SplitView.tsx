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
 * bounding rect and the winning edge zone, returns the coral overlay's
 * pane-local `{ left, top, width, height }` in CSS pixels — half the pane
 * along the winning edge (t = 0.5), matching prototype.html:414-421 exactly.
 *
 * Pane-local means the values are relative to the `.flex-1.min-h-0.overflow-
 * hidden.relative` wrapper the overlay is a child of (SplitView.tsx:296).
 * Because that wrapper equals the outer div's full area (post patch #512
 * PaneHeader removal), pane-local coords are effectively rect-relative
 * with (0,0) at the wrapper's top-left.
 *
 * Center is deliberately EXCLUDED from the input type — the caller must
 * short-circuit before invoking this. See Pane's JSX gate on
 * `dropPreview.zone !== "center"`.
 */
function overlayGeometryForZone(
  zone: Exclude<DropZone, "center">,
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
      if (!e.dataTransfer?.types.includes("text/plain")) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const zone = computeEdgeZone(rect, e.clientX, e.clientY);
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
      // Type-gate FIRST — scope the flicker-fix machinery to our own row-drag
      // payload only. Without this gate, unrelated dragleaves (browser file
      // drags, native OS drags) would clear dropPreview mid-drag whenever
      // the browser fires a spurious dragleave on the pane. (Plan-check
      // finding #3.)
      if (!e.dataTransfer?.types.includes("text/plain")) return;
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
      if (!e.dataTransfer?.types.includes("text/plain")) return;
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
      // Center-dead-zone short-circuit. Silent per shape file: no error, no
      // toast, no visual affordance — release does nothing, no drop
      // registered. The AppShell outer handler is already blocked by the
      // preventDefault + stopPropagation above.
      if (zone === "center") {
        // eslint-disable-next-line no-console
        console.info(
          `[pv-split-drop] center-dead-zone ignored path=${JSON.stringify(path)} clientX=${Math.round(e.clientX)} clientY=${Math.round(e.clientY)}`,
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
  }, [path.join("."), onDropRowInTree, onOpenSessionInTree]);

  return (
    <div
      ref={outerRef}
      className={`relative flex flex-col w-full h-full min-w-0 min-h-0 overflow-hidden transition-colors ${
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
        {dropPreview !== null && dropPreview.zone !== "center" && (
          <div
            data-testid="pane-drop-preview-overlay"
            data-zone={dropPreview.zone}
            className="absolute pointer-events-none"
            style={{
              ...overlayGeometryForZone(dropPreview.zone, dropPreview.rect),
              background: "rgba(255, 184, 150, 0.22)",
              border: "2px solid rgba(255, 184, 150, 0.60)",
              borderRadius: 0,
              zIndex: 20,
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
      />
    </div>
  );
});
