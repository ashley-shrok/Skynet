import type { DragEvent as ReactDragEvent, ReactElement, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";

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

// ─── PaneBar — the glass bar across the top of a non-conversation pane ─────
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
//   - A ⋮ kebab at the right end, and right-click anywhere on the bar, open
//     the pane's RowKebabMenu.
//   - On touch devices the bar is taller and leads with the round
//     back-to-conversations button; AppShell hides its floating one while a
//     barred pane sits top-left, so it doesn't cover the bar.
//
// The pane supplies its own left-hand buttons, title glyph and menu items.

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

const BAR_HEIGHT = 40;
// Width of the left button group (sized for the app bar's 3 × 26px + 2 × 2px
// gaps). The title column is centred between two columns of this width so it
// can never overlap the buttons, however narrow the pane.
const NAV_GROUP_WIDTH = 82;
// Touch devices: the bar is taller and holds the back-to-conversations
// button at its left, in place of the floating one AppShell shows over
// conversations (which would otherwise sit over the pane's top-left corner).
const TOUCH_BAR_HEIGHT = 52;
const BACK_TO_LIST_SIZE = 40;
const BACK_TO_LIST_GAP = 6;
const TOUCH_LEFT_GROUP_WIDTH = BACK_TO_LIST_SIZE + BACK_TO_LIST_GAP + NAV_GROUP_WIDTH;

/** Class for the small icon buttons a pane puts in the bar's left group. */
export const PANE_BAR_BUTTON_CLASS =
  "inline-flex items-center justify-center w-[26px] h-[24px] rounded-md text-[color:var(--color-pv-fg-muted)] enabled:hover:text-[color:var(--color-pv-fg)] enabled:hover:bg-[rgba(232,228,216,0.08)] enabled:cursor-pointer disabled:opacity-30 transition-[color,background-color,opacity]";

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
  /** 18px glyph left of the title. */
  titleIcon: ReactNode;
  title: string;
  /** Faint second line under the title (e.g. a file's machine + folder). */
  subtitle?: string;
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
  title,
  subtitle,
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
    <div
      ref={barRef}
      data-testid={`${testIdPrefix}-bar`}
      draggable={isDragSource}
      onPointerDownCapture={(e) => {
        pressOnButtonRef.current = (e.target as HTMLElement).closest("button") !== null;
      }}
      onDragStart={isDragSource ? onBarDragStart : undefined}
      onClick={() => onSelectPane?.(tabId)}
      onContextMenu={barContextMenu.onContextMenu}
      className={`relative z-[1] grid flex-none items-center gap-2 px-2 select-none [-webkit-touch-callout:none] ${
        isDragSource ? "cursor-grab active:cursor-grabbing" : ""
      }`}
      style={{
        height: isTouchDevice ? TOUCH_BAR_HEIGHT : BAR_HEIGHT,
        gridTemplateColumns: rightControls
          ? `${sideColumnWidth}px minmax(0, 1fr) auto`
          : `${sideColumnWidth}px minmax(0, 1fr) ${sideColumnWidth}px`,
        paddingLeft: clearance > 0 ? clearance : undefined,
        background:
          "linear-gradient(160deg, hsla(230, 14%, 24%, 0.85), hsla(230, 14%, 14%, 0.92))",
        borderBottom: "1px solid hsla(230, 30%, 70%, 0.2)",
        boxShadow: "0 4px 12px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,220,170,0.10)",
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
            className="flex-none inline-flex items-center justify-center rounded-full text-[#f0ebe0] active:scale-[0.97] transition-transform cursor-pointer"
            style={{
              width: BACK_TO_LIST_SIZE,
              height: BACK_TO_LIST_SIZE,
              marginRight: BACK_TO_LIST_GAP - 2,
              background:
                "linear-gradient(160deg, hsla(218, 25%, 22%, 0.85), hsla(218, 25%, 14%, 0.9))",
              border: "1px solid hsla(218, 35%, 55%, 0.35)",
              boxShadow:
                "0 2px 8px rgba(0,0,0,0.5), inset 0 2px 0 rgba(220,225,245,0.3), 0 0 16px hsla(218, 40%, 55%, 0.25)",
            }}
          >
            <ChevronLeft width={22} height={22} aria-hidden="true" />
          </button>
        )}
        {navButtons}
      </div>
      <div
        data-testid={`${testIdPrefix}-title`}
        className="justify-self-center max-w-full flex items-center gap-[7px] min-w-0 pointer-events-none"
      >
        <span
          className="flex-none w-[18px] h-[18px] rounded-[5px] overflow-hidden grid place-items-center text-[10px] font-bold"
          style={{ background: "rgba(220,225,245,0.08)", color: "var(--color-pv-fg)" }}
          aria-hidden="true"
        >
          {titleIcon}
        </span>
        {subtitle ? (
          <span className="flex flex-col min-w-0 leading-[1.15]">
            <span
              className="truncate"
              style={{ color: "var(--color-pv-fg)", fontSize: 13, fontWeight: 500 }}
            >
              {title}
            </span>
            <span
              className="truncate"
              data-testid={`${testIdPrefix}-subtitle`}
              style={{ color: "var(--color-pv-fg-muted)", fontSize: 11, opacity: 0.7 }}
            >
              {subtitle}
            </span>
          </span>
        ) : (
          <span
            className="truncate"
            style={{ color: "var(--color-pv-fg)", fontSize: 13, fontWeight: 500 }}
          >
            {title}
          </span>
        )}
      </div>
      <div
        className="justify-self-end flex items-center gap-1.5"
        data-testid={`${testIdPrefix}-kebab-slot`}
      >
        {rightControls}
        {/* No items (e.g. a remote pane on a phone) → no ⋮ that opens nothing. */}
        {menuItems.length > 0 && (
          <RowKebabMenu
            items={menuItems}
            ariaLabel={`${title} menu`}
            testId={`${testIdPrefix}-kebab-trigger`}
          />
        )}
      </div>
      {barContextMenu.menu}
    </div>
  );
}
