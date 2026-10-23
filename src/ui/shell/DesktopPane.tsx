import type { ReactElement } from "react";
import { useMemo } from "react";
import { Hand, Monitor, RotateCw, Undo2 } from "lucide-react";

import type { RowKebabMenuItem } from "@/features/pretty-conversations/RowKebabMenu";
import {
  DesktopStage,
  useDesktopSession,
} from "@/features/pretty-view/desktop-session";
import { useIsMobile } from "@/hooks/use-mobile";
import { systemLogger } from "@/lib/frontend-logger";
import { encodeWorkspaceSpec, specForTab } from "@/lib/tab-url";
import { useIdentities } from "@/state/identities-store";
import { PANE_BAR_BUTTON_CLASS, PaneBar } from "./PaneBar";

// ─── DesktopPane — an agent's virtual desktop as a split-view leaf ─────────
//
// The same live desktop the agent window's Desktop tab shows (shared
// desktop session — view-only stream, Take control / Hand back, start,
// errors), under the glass bar every non-conversation pane has, so it can sit
// beside the conversation.
//
// Bar contents:
//   - Reconnect (circular arrow), then Take control (hand) — or, while in
//     control, Hand back to agent (undo arrow).
//   - Title: monitor glyph + the agent's name; subtitle says whether this is
//     view only, under the user's control, or paused by someone else.
//   - Menu: Move to new tab (desktop) → Close (desktop).
//
// Control is handed back when the pane closes, hides, or loses its stream —
// the session's own rules. If the desktop stops, the pane stays with the
// "isn't running" notice and its Start button.

export interface DesktopPaneProps {
  hostId: number;
  identityKey: string;
  tabId: string;
  isVisible: boolean;
  /** Clicking the bar selects this pane (split focus). */
  onSelectPane?: (tabId: string) => void;
  /** Bar menu's Close / Move to new tab tear this pane down. */
  onCloseTab?: (tabId: string) => void;
}

export function DesktopPane({
  hostId,
  identityKey,
  tabId,
  isVisible,
  onSelectPane,
  onCloseTab,
}: DesktopPaneProps): ReactElement {
  const isMobile = useIsMobile();
  const { byHostKey } = useIdentities();
  const identity = byHostKey?.get(`${hostId}::${identityKey}`);
  const name = identity?.displayName || identityKey;

  const session = useDesktopSession({
    identityKey,
    hostId,
    isVisible,
    logTag: "desktop-pane",
  });
  const { view, taking, inControl, connect, takeControl } = session;
  const live = view.status === "live";

  const subtitle = inControl
    ? "Desktop · You have control · agent paused"
    : live && view.agentPaused
      ? "Desktop · View only · agent paused (someone has control)"
      : "Desktop · View only";

  const menuItems = useMemo<RowKebabMenuItem[]>(() => {
    const items: RowKebabMenuItem[] = [];
    if (isMobile) return items;
    const spec = specForTab({ type: "desktop", desktop: { hostId, identityKey } });
    if (spec !== null) {
      items.push({
        label: "Move to new tab",
        testId: "desktop-pane-menu-move-new-window",
        onClick: () => {
          const w = window.open(
            "#" + encodeWorkspaceSpec({ tabs: [spec], activeIndex: 0, only: true }),
            "_blank",
          );
          systemLogger.info("[desktop-bar-menu] move to new tab", {
            operation: "desktop_bar_menu_move_window",
            tabId,
            hostId,
            identityKey,
            opened: w !== null,
          });
          // Popup blocked → keep this pane.
          if (w !== null) onCloseTab?.(tabId);
        },
      });
    }
    if (onCloseTab) {
      items.push({
        label: "Close",
        testId: "desktop-pane-menu-close",
        onClick: () => onCloseTab(tabId),
      });
    }
    return items;
  }, [isMobile, hostId, identityKey, tabId, onCloseTab]);

  return (
    <div className="flex flex-col h-full w-full" data-testid="desktop-pane">
      <PaneBar
        tabId={tabId}
        testIdPrefix="desktop-pane"
        logTag="desktop-bar"
        logContext={{ hostId, identityKey }}
        dragPayload={{
          identityKey: null,
          hostId: null,
          descriptor: {
            tabType: "desktop",
            desktop: { hostId, identityKey },
            label: name,
          },
        }}
        title={name}
        subtitle={subtitle}
        titleIcon={<Monitor width={12} height={12} />}
        menuItems={menuItems}
        onSelectPane={onSelectPane}
        navButtons={
          <>
            <button
              type="button"
              data-testid="desktop-pane-reconnect"
              aria-label="Reconnect"
              title="Reconnect"
              draggable={false}
              onClick={() => void connect()}
              className={PANE_BAR_BUTTON_CLASS}
            >
              <RotateCw width={14} height={14} aria-hidden="true" />
            </button>
            {inControl ? (
              <button
                type="button"
                data-testid="desktop-pane-hand-back"
                aria-label="Hand back to agent"
                title="Hand back to agent"
                draggable={false}
                onClick={() => void connect()}
                className={PANE_BAR_BUTTON_CLASS}
                style={{ color: "hsla(40, 90%, 70%, 1)" }}
              >
                <Undo2 width={14} height={14} aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                data-testid="desktop-pane-take-control"
                aria-label="Take control"
                title="Take control — use your own mouse and keyboard on this desktop. The agent pauses until you hand back."
                draggable={false}
                disabled={!live || taking}
                onClick={() => void takeControl()}
                className={PANE_BAR_BUTTON_CLASS}
              >
                <Hand width={14} height={14} aria-hidden="true" />
              </button>
            )}
          </>
        }
      />
      {/* Absolute inset gives the display a definite box to scale into. */}
      <div className="relative flex-1 min-h-0 w-full">
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ background: "var(--bg-base, #111)" }}
        >
          <DesktopStage session={session} isVisible={isVisible} />
        </div>
      </div>
    </div>
  );
}
