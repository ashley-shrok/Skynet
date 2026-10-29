import type { ReactElement } from "react";
import { Suspense, lazy, useMemo } from "react";
import { Monitor, RotateCw, Terminal } from "lucide-react";

import type { RowKebabMenuItem } from "@/features/pretty-conversations/RowKebabMenu";
import { TouchDesktopButtons } from "@/features/guacamole/touch/TouchDesktopButtons";
import { TOGGLE_KEYBOARD_EVENT } from "@/features/guacamole/touch/touch-mode";
import { useIsTouchDevice } from "@/hooks/use-is-touch-device";
import { useIsMobile } from "@/hooks/use-mobile";
import { systemLogger } from "@/lib/frontend-logger";
import { encodeWorkspaceSpec, specForTab } from "@/lib/tab-url";
import { PANE_BAR_BUTTON_CLASS, PaneBar } from "./PaneBar";

const GuacamoleApp = lazy(() => import("@/features/guacamole/GuacamoleApp"));

// ─── RemotePane — RDP / VNC / telnet leaf ──────────────────────────────────
//
// The remote desktop under the same bar apps have (PaneBar), so a
// remote session is a first-class split-view pane: drag the bar to rearrange,
// to the drop lane's Close zone, or into another Skynet window; ⋯ / right-
// click for its menu.
//
// Bar contents:
//   - Reconnect (circular arrow) — fires the existing
//     `skynet:refresh-guacamole` event GuacamoleApp listens for: fresh token,
//     display remount. Back/forward have no meaning for a remote session.
//   - Touch screens: the touch-mode switch (not telnet) and the keyboard
//     button, which raises the phone's keyboard for the session.
//   - Title: monitor (or terminal, for telnet) glyph + host name.
//   - Menu: Move to new tab (desktop) → Close (desktop).
//
// Moving within a window never reconnects — AppShell reparents the pane's
// DOM node. Moving to another window (bar drag or Move to new tab) opens a
// fresh connection there; the backend's one-session-per-(user, host) takeover
// then ends this one, and the source pane closes.

export interface RemotePaneProps {
  hostId: string;
  hostName: string;
  tabId: string;
  protocol: "rdp" | "vnc" | "telnet";
  isVisible: boolean;
  /** Clicking the bar selects this pane (split focus). */
  onSelectPane?: (tabId: string) => void;
  /** Bar menu's Close / Move to new tab tear this pane down. */
  onCloseTab?: (tabId: string) => void;
}

export function RemotePane({
  hostId,
  hostName,
  tabId,
  protocol,
  isVisible,
  onSelectPane,
  onCloseTab,
}: RemotePaneProps): ReactElement {
  const isMobile = useIsMobile();
  const isTouchDevice = useIsTouchDevice();
  const numericHostId = Number(hostId);

  const reconnect = () => {
    systemLogger.info("[remote-bar] reconnect", {
      operation: "remote_bar_reconnect",
      tabId,
      hostId: numericHostId,
      protocol,
    });
    window.dispatchEvent(
      new CustomEvent("skynet:refresh-guacamole", { detail: { tabId } }),
    );
  };

  const menuItems = useMemo<RowKebabMenuItem[]>(() => {
    const items: RowKebabMenuItem[] = [];
    if (!isMobile) {
      const spec = specForTab({ type: protocol, host: { name: hostName, id: hostId } });
      if (spec !== null) {
        items.push({
          label: "Move to new tab",
          testId: "remote-pane-menu-move-new-window",
          onClick: () => {
            const w = window.open(
              "#" + encodeWorkspaceSpec({ tabs: [spec], activeIndex: 0, only: true }),
              "_blank",
            );
            systemLogger.info("[remote-bar-menu] move to new tab", {
              operation: "remote_bar_menu_move_window",
              tabId,
              hostId: numericHostId,
              protocol,
              opened: w !== null,
            });
            // Popup blocked → keep this pane; the session has nowhere else to go.
            if (w !== null) onCloseTab?.(tabId);
          },
        });
      }
      if (onCloseTab) {
        items.push({
          label: "Close",
          testId: "remote-pane-menu-close",
          onClick: () => onCloseTab(tabId),
        });
      }
    }
    return items;
  }, [isMobile, protocol, hostName, hostId, numericHostId, tabId, onCloseTab]);

  const TitleIcon = protocol === "telnet" ? Terminal : Monitor;
  return (
    <div className="flex flex-col h-full w-full" data-testid="remote-pane">
      <PaneBar
        tabId={tabId}
        testIdPrefix="remote-pane"
        logTag="remote-bar"
        logContext={{ hostId: numericHostId, protocol }}
        dragPayload={{
          identityKey: null,
          hostId: numericHostId,
          descriptor: { tabType: protocol, label: hostName },
        }}
        title={hostName}
        titleIcon={<TitleIcon aria-hidden="true" />}
        menuItems={menuItems}
        onSelectPane={onSelectPane}
        navButtons={
          <>
            <button
              type="button"
              data-testid="remote-pane-reconnect"
              aria-label="Reconnect"
              title="Reconnect"
              draggable={false}
              onClick={reconnect}
              className={PANE_BAR_BUTTON_CLASS}
            >
              <RotateCw aria-hidden="true" />
            </button>
            {isTouchDevice && (
              <TouchDesktopButtons
                showModeSwitch={protocol !== "telnet"}
                onToggleKeyboard={() =>
                  window.dispatchEvent(
                    new CustomEvent(TOGGLE_KEYBOARD_EVENT, { detail: { tabId } }),
                  )
                }
                buttonClassName={PANE_BAR_BUTTON_CLASS}
                testIdPrefix="remote-pane"
              />
            )}
          </>
        }
      />
      {/* Absolute inset gives the remote display a definite height (the
          space under the bar) to fill — its resolution is measured from it. */}
      <div className="relative flex-1 min-h-0 w-full">
        <div className="absolute inset-0 overflow-hidden">
          <Suspense fallback={null}>
            <GuacamoleApp
              hostId={hostId}
              tabId={tabId}
              protocol={protocol}
              isVisible={isVisible}
              onClose={() => onCloseTab?.(tabId)}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
