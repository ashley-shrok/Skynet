// ─── SplitView.tsx ───────────────────────────────────────────────────────────
// Phase 56 Plan 02 — recursive-tree renderer.
//
// Adopted (Plan 56-01 + 56-02 LOCKED decisions — Ashley 2026-08-28):
//   - Recursive `SplitNode` tree drives layout. Leaves render as `Pane`;
//     internal nodes render as flex containers with a constant-width,
//     non-draggable `<Divider>` between two children.
//   - Constant-ratio 50/50 splits (no draggable dividers).
//   - Portal-target contract: every leaf's content div carries a tab-id
//     data attribute and reports its element upstream via
//     `onPaneContentRef(tabId, el)`. AppShell's DOM-placement effect uses
//     this to reparent the tab's stable node (no remount, no WS reset).
//   - Empty tree renders a full-viewport drop target; drop on it invokes
//     `onOpenSessionInTree(tabId, [], 'left')` and seeds the root leaf.
//   - Drop on an existing cell forwards `(tabId, path, edge)` upstream where
//     the edge is the executor's `computeEdgeFromDrop` stub (always `'left'`
//     in Plan 56-02). Plan 56-03 wires the real nearest-edge geometry.

import React, { useState, useEffect, memo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { tabIcon } from "@/shell/tabUtils";
import type { Tab } from "@/types/ui-types";
import type { SplitNode, SplitPath, DropEdge } from "@/lib/split-tree";

// Plan 56-02 stub — any drop resolves to 'left'. Plan 56-03 substitutes the
// real nearest-edge computation using the drop event's client coordinates
// against the target cell's bounding rect.
function computeEdgeFromDrop(_e: React.DragEvent): DropEdge {
  return "left";
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

// PaneHeader — icon + label row inside each Pane. Kept from the pre-refactor
// file with the pane-slot-index prop retired.
function PaneHeader({
  tab,
  isFocused,
}: {
  tab: Tab | null;
  isFocused: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 h-7 shrink-0 border-b text-xs font-medium select-none transition-colors ${
        isFocused
          ? "bg-[hsla(var(--pv-hue,35),45%,28%,0.42)] border-[hsla(var(--pv-hue,35),55%,50%,0.4)] text-[color:var(--color-pv-code-fg)]"
          : "bg-[color:var(--color-pv-surface-quiet)] border-[color:var(--color-pv-border-quiet)] text-[color:var(--color-pv-fg-muted)]"
      }`}
    >
      {isFocused && (
        <span className="w-1 h-3.5 rounded-full bg-[hsla(var(--pv-hue,35),55%,45%,0.9)] shrink-0" />
      )}
      {tab ? (
        <>
          <span className={isFocused ? "text-[color:var(--color-pv-code-fg)]" : "opacity-60"}>
            {tabIcon(tab.type)}
          </span>
          <span
            className={`truncate ${isFocused ? "text-[color:var(--color-pv-code-fg)] font-semibold" : "text-[color:var(--color-pv-fg)]"}`}
          >
            {tab.type === "dashboard" ? "Dashboard" : tab.label}
          </span>
        </>
      ) : (
        <span className="opacity-40">
          {t("splitScreen.paneEmpty", { index: 1 })}
        </span>
      )}
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
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  const contentRef = useCallback(
    (el: HTMLDivElement | null) => {
      onPaneContentRef?.(tabId, el);
    },
    [tabId, onPaneContentRef],
  );

  return (
    <div
      className={`relative flex flex-col w-full h-full min-w-0 min-h-0 overflow-hidden transition-colors ${
        isFocused ? "ring-1 ring-inset ring-accent-brand/30" : ""
      } ${isDragOver ? "ring-2 ring-inset ring-accent-brand" : ""}`}
      onClick={() => onPaneClick?.(tabId)}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        const payloadTabId = e.dataTransfer.getData("text/plain");
        if (payloadTabId) {
          onOpenSessionInTree?.(payloadTabId, path, computeEdgeFromDrop(e));
        }
      }}
    >
      <PaneHeader tab={tab} isFocused={isFocused} />
      <div className="flex-1 min-h-0 overflow-hidden relative">
        <div
          ref={contentRef}
          data-tab-id={tabId}
          className="absolute inset-0"
        />
        {isDragOver && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[hsla(var(--pv-hue,35),45%,28%,0.42)] border-2 border-dashed border-[hsla(var(--pv-hue,35),65%,55%,0.6)] pointer-events-none">
            <span className="text-xs font-medium text-[color:var(--color-pv-code-fg)]">
              Drop to split
            </span>
          </div>
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
      />
    </div>
  );
});
