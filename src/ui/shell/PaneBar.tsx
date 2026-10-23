import type { DragEvent as ReactDragEvent, ReactElement, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";

import { KitScopeContext, type KitScopeValue } from "@/components/kit/scope";

import {
  RowKebabMenu,
  useRowKebabContextMenu,
  type RowKebabMenuItem,
} from "@/features/pretty-conversations/RowKebabMenu";
import { useIsMobile } from "@/hooks/use-mobile";
import { useIsTouchDevice } from "@/hooks/use-is-touch-device";
import { navigateToList } from "@/lib/mobile-flow";
import { systemLogger } from "@/lib/frontend-logger";
import { armOutboundDrag, mintDragId } from "./cross-window-drag";
import "./pane-bar.css";

// ─── PaneBar — the bar across the top of a non-conversation pane ───────────
//
// Shared by AppPane (apps), RemotePane (RDP/VNC/telnet) and FilePane (files). The bar is the
// pane's handle in the split view, the same job an IdentityBadge does for a
// conversation:
//   - The WHOLE bar (minus its buttons) is draggable and writes the same
//     application/x-skynet-badge payload an IdentityBadge does, so every
//     existing badge drop path (split edges/center, the drop lane's Close
//     zone, cross-window via the descriptor) applies with no pane-specific
//     branch. Not draggable on mobile (no split view there).
//   - Clicking the bar selects the pane (split focus).
//   - A ⋯ button at the right end, and right-click anywhere on the bar, open
//     the pane's RowKebabMenu, in the kit's menu look (kit scope).
//   - On touch devices the bar is taller and leads with the round
//     back-to-conversations button; AppShell hides its floating one while a
//     barred pane sits top-left, so it doesn't cover the bar.
//
// The pane supplies its own left-hand buttons, title glyph and menu items.
// Look: solid, one hairline, quiet buttons — pane-bar.css.

// Skynet's floating sidebar-collapse toggle sits fixed at the content area's
// top-left. Returns how far the bar's contents must shift right to clear it
// (0 when the toggle isn't over the bar). The toggle only counts when its
// vertical middle falls inside the bar. Exported for unit tests.
export function sidebarToggleClearance(
  barRect: Pick<DOMRect, "left" | "top" | "bottom">,
  toggleRect: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width"> | null,
): number {
  if (toggleRect === null || toggleRect.width === 0) return 0;
  const overlapsX = toggleRect.right > barRect.left && toggleRect.left < barRect.left + 40;
  const middleY = (toggleRect.top + toggleRect.bottom) / 2;
  const overlapsY = middleY >= barRect.top && middleY <= barRect.bottom;
  if (!overlapsX || !overlapsY) return 0;
  return Math.ceil(toggleRect.right - barRect.left) + 6;
}

// Width of the left button group (sized for the app bar's 3 × 30px buttons,
// 2 × 2px gaps and reload's 4px step apart). The title column is centred
// between two columns of this width so it can never overlap the buttons,
// however narrow the pane.
const NAV_GROUP_WIDTH = 98;
// Touch devices: the bar is taller and holds the back-to-conversations
// button at its left, in place of the floating one AppShell shows over
// conversations (which would otherwise sit over the pane's top-left corner).
// Its buttons are 32px wide there.
const TOUCH_NAV_GROUP_WIDTH = 104;
const BACK_TO_LIST_SIZE = 36;
const BACK_TO_LIST_GAP = 6;
const TOUCH_LEFT_GROUP_WIDTH = BACK_TO_LIST_SIZE + BACK_TO_LIST_GAP + TOUCH_NAV_GROUP_WIDTH;

// The bar's ⋯ menu takes the kit look, like the sidebar's menus.
const PANE_BAR_KIT_SCOPE: KitScopeValue = { hue: 220 };

/** Class for the icon buttons a pane puts in the bar's left group. Back and
 *  forward also set data-icon="arrow" for their larger chevrons. */
export const PANE_BAR_BUTTON_CLASS = "pane-bar-btn";

/** Utilities that bring the read-aloud button (its own component, styled with
 *  utilities) into line with the bar's quiet buttons. */
export const PANE_BAR_SPEAK_CLASS =
  "size-[30px] rounded-lg border-0 bg-transparent hover:bg-[var(--k-s2)] text-[var(--k-t2)] hover:text-[var(--k-t1)]";

export interface PaneBarProps {
  tabId: string;
  /** Prefix for every data-testid on the bar (`${prefix}-bar`, …). */
  testIdPrefix: string;
  /** Log tag + operation prefix, e.g. "app-bar" → `[app-bar-drag]`, `app_bar_drag_start`. */
  logTag: string;
  /** Extra fields on every bar log line (hostId, slug, …). */
  logContext: Record<string, unknown>;
  /** Badge payload fields beyond tabId + dragId (identityKey, hostId, descriptor). */
  dragPayload: Record<string, unknown>;
  /** The pane's own buttons, left of the title. */
  navButtons: ReactNode;
  /** Glyph in the 20px tile left of the title. */
  titleIcon: ReactNode;
  /** The glyph is a picture filling the tile (an app's icon): no grey tile. */
  titleIconIsPicture?: boolean;
  title: string;
  /** Controls left of the ⋮ (e.g. a view switcher); the column then sizes to fit. */
  rightControls?: ReactNode;
  menuItems: RowKebabMenuItem[];
  onSelectPane?: (tabId: string) => void;
}

export function PaneBar({
  tabId,
  testIdPrefix,
  logTag,
  logContext,
  dragPayload,
  navButtons,
  titleIcon,
  titleIconIsPicture = false,
  title,
  rightControls,
  menuItems,
  onSelectPane,
}: PaneBarProps): ReactElement {
  const barRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const isTouchDevice = useIsTouchDevice();
  const barContextMenu = useRowKebabContextMenu(menuItems);
  const opPrefix = logTag.replace(/-/g, "_");

  // Clear the AppShell's fixed sidebar-toggle chevron when it sits over the
  // bar's left end (desktop, sidebar collapsed, pane top-left). Re-measured
  // on bar resize, window resize, and the sidebar's width transition.
  const [clearance, setClearance] = useState(0);
  useEffect(() => {
    const bar = barRef.current;
    if (bar === null) return;
    const measure = () => {
      const toggle = document.querySelector<HTMLElement>("[data-sidebar-toggle]");
      // While the sidebar peeks, the toggle rides the peek's edge over the
      // panes; the bar keeps the clearance of the toggle's resting spot.
      if (toggle?.dataset.peeking === "true") return;
      setClearance(
        sidebarToggleClearance(
          bar.getBoundingClientRect(),
          toggle ? toggle.getBoundingClientRect() : null,
        ),
      );
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(bar);
    window.addEventListener("resize", measure);
    window.addEventListener("transitionend", measure, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("transitionend", measure, true);
    };
  }, []);

  // In a real browser, dragstart fires on the draggable bar even when the
  // press began on one of its buttons — so remember where the press started.
  const pressOnButtonRef = useRef(false);
  const isDragSource = !isMobile;
  const onBarDragStart = (e: ReactDragEvent<HTMLDivElement>) => {
    // A press that began on a button never drags the pane.
    if (pressOnButtonRef.current) {
      e.preventDefault();
      return;
    }
    const dragId = mintDragId();
    armOutboundDrag(dragId, tabId);
    e.dataTransfer.setData("text/plain", tabId);
    e.dataTransfer.setData(
      "application/x-skynet-badge",
      JSON.stringify({ tabId, dragId, ...dragPayload }),
    );
    e.dataTransfer.effectAllowed = "move";
    systemLogger.info(`[${logTag}-drag] tabId=${tabId} dragId=${dragId}`, {
      operation: `${opPrefix}_drag_start`,
      tabId,
      ...logContext,
    });
  };

  const sideColumnWidth = isTouchDevice ? TOUCH_LEFT_GROUP_WIDTH : NAV_GROUP_WIDTH;
  return (
    <KitScopeContext.Provider value={PANE_BAR_KIT_SCOPE}>
      <div
        ref={barRef}
        data-testid={`${testIdPrefix}-bar`}
        data-touch={isTouchDevice ? "true" : undefined}
        draggable={isDragSource}
        onPointerDownCapture={(e) => {
          pressOnButtonRef.current = (e.target as HTMLElement).closest("button") !== null;
        }}
        onDragStart={isDragSource ? onBarDragStart : undefined}
        onClick={() => onSelectPane?.(tabId)}
        onContextMenu={barContextMenu.onContextMenu}
        className={`pane-bar k-hued relative z-[1] grid flex-none items-center gap-2.5 px-2 select-none [-webkit-touch-callout:none] ${
          isDragSource ? "cursor-grab active:cursor-grabbing" : ""
        }`}
        style={{
          gridTemplateColumns: rightControls
            ? `${sideColumnWidth}px minmax(0, 1fr) auto`
            : `${sideColumnWidth}px minmax(0, 1fr) ${sideColumnWidth}px`,
          paddingLeft: clearance > 0 ? clearance : undefined,
        }}
      >
        <div className="flex items-center gap-0.5">
          {isTouchDevice && (
            <button
              type="button"
              data-testid={`${testIdPrefix}-back-to-list`}
              aria-label="Back to conversations"
              title="Back to conversations"
              draggable={false}
              onClick={(e) => {
                e.stopPropagation();
                systemLogger.info(`[${logTag}] back to conversations`, {
                  operation: `${opPrefix}_back_to_list`,
                  tabId,
                  ...logContext,
                });
                navigateToList();
              }}
              className="pane-bar-btn pane-bar-back"
              style={{ marginRight: BACK_TO_LIST_GAP - 2 }}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
          )}
          {navButtons}
        </div>
        <div
          data-testid={`${testIdPrefix}-title`}
          className="justify-self-center max-w-full flex items-center gap-2 min-w-0 pointer-events-none"
        >
          <span className="pane-bar-icon" data-picture={titleIconIsPicture ? "true" : undefined} aria-hidden="true">
            {titleIcon}
          </span>
          <span className="pane-bar-title truncate">{title}</span>
        </div>
        <div
          className="justify-self-end flex items-center gap-1"
          data-testid={`${testIdPrefix}-kebab-slot`}
        >
          {rightControls}
          {/* No items (e.g. a remote pane on a phone) → no ⋯ that opens nothing. */}
          {menuItems.length > 0 && (
            <RowKebabMenu
              items={menuItems}
              ariaLabel={`${title} menu`}
              testId={`${testIdPrefix}-kebab-trigger`}
              triggerClassName="pane-bar-menu"
            />
          )}
        </div>
        {barContextMenu.menu}
      </div>
    </KitScopeContext.Provider>
  );
}
