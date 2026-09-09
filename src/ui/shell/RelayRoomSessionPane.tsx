/* eslint-disable react-refresh/only-export-components */
// Phase 90 Plan 07 Task 1 — RelayRoomSessionPane shell wrapper.
//
// Peer of IdentitySessionPane. Mounts RelayRoomPane inside the standard
// pane wrapper (h-full w-full relative flex flex-col) with a forwardRef
// contract mirroring IdentityPaneHandle so tabUtils.tsx (Task 2) can
// drop it in polymorphically.
//
// What this wrapper is FOR: shell-level type-compatibility layer + a
// structured mount log. The heavy lifting (WS lifecycle, participants
// fetch, compose box, optimistic-send state machine, per-agent badge
// affordances) is entirely owned by RelayRoomPane (Plan 05 + Plan 06).
//
// What this wrapper is NOT: it does NOT thread the viewer's mxid down
// as a prop. Per Plan 05 Task 3 (W#8 resolution), RelayRoomPane sources
// the viewing user's mxid internally via the useViewingUserMxid hook.
// The wrapper is agnostic to the mxid — that keeps this shell layer
// free of any per-user identity plumbing.
//
// What this wrapper does NOT include (per PATTERNS.md § RelayRoomSessionPane
// 'What NOT to include'):
//   - no xterm.js surface — relay panes have no terminal mode
//   - no per-pane queue drawer — relay panes have no message queue
//   - no top-right identity chip — RelayRoomPane owns its own IdentityBadgeRow
//   - no identity edit modal — deferred to a later slice, not v1
//
// The exposed IdentityPaneHandle-shaped surface (togglePrettyMode,
// toggleMessageQueue, disconnect, and the rest) is entirely no-op here:
// relay panes have no terminal mode to toggle, no queue drawer to open,
// no per-pane WS-disconnect concept beyond what RelayRoomPane owns
// internally via its own visibility lifecycle. Preserving the shape
// keeps any polymorphic tab.ref consumer (existing code that reaches
// through .togglePrettyMode() etc.) working as a benign no-op.
//
// D-01 + D-03 upheld: no pretty-view modification. IdentitySessionPane
// is left byte-untouched.

import { forwardRef, useEffect, useImperativeHandle } from "react";
import { RelayRoomPane } from "@/features/relay-room-pane/RelayRoomPane";
import type { Tab } from "@/types/ui-types";

/**
 * The imperative-handle surface exposed by RelayRoomSessionPane. Mirrors
 * IdentityPaneHandle from terminal-types.ts so tab.terminalRef-shaped
 * consumers can invoke any method as a benign no-op on relay panes.
 * All methods are no-ops — see file header for the WHY.
 */
export interface RelayRoomPaneHandle {
  togglePrettyMode: () => void;
  toggleMessageQueue: () => void;
  disconnect: () => void;
  reconnect: () => void;
  fit: () => void;
  sendInput: (data: string, messageQueueItemId?: string) => void;
  notifyResize: () => void;
  refresh: () => void;
  openFileManager: () => void;
}

export interface RelayRoomSessionPaneProps {
  tab: Tab;
  roomId: string;
  roomTitle: string | null;
  isVisible: boolean;
  onCloseTab?: (id: string) => void;
}

export const RelayRoomSessionPane = forwardRef<
  RelayRoomPaneHandle,
  RelayRoomSessionPaneProps
>(function RelayRoomSessionPane(
  { tab, roomId, roomTitle, isVisible },
  ref,
) {
  const tabId = tab.id;

  // Structured mount log — explicit fields, never JSON.stringify on the
  // tab or event objects (PATTERNS.md § 2 discipline).
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.info({
      operation: "relay_room_session_pane_mount",
      tabId,
      roomId,
    });
    // Deliberately once-per-mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // useImperativeHandle: expose the IdentityPaneHandle-shaped surface as
  // no-ops. See file header for WHY each is a no-op.
  //
  // L4 fixup 2026-09-09: every no-op now emits a structured console.warn
  // when invoked so a stray call from a polymorphic tab.terminalRef
  // consumer surfaces in the frontend logs instead of being silently
  // swallowed. Payload carries the operation slug + tabId + roomId so
  // ops-grep can identify which pane received the wayward call. Functional
  // shape preserved — every method still returns synchronously as a
  // benign no-op; the log-warn is observability, not a functional gate.
  useImperativeHandle(
    ref,
    () => {
      // Small helper so every no-op method emits the same structured
      // payload without repeating the boilerplate 9 times below.
      const warnNoop = (operation: string, extra: object = {}): void => {
        // eslint-disable-next-line no-console
        console.warn({
          operation,
          tabId,
          roomId,
          ...extra,
        });
      };
      return {
        togglePrettyMode: () =>
          warnNoop("relay_room_pane_noop_togglePrettyMode"),
        toggleMessageQueue: () =>
          warnNoop("relay_room_pane_noop_toggleMessageQueue"),
        disconnect: () => warnNoop("relay_room_pane_noop_disconnect"),
        reconnect: () => warnNoop("relay_room_pane_noop_reconnect"),
        fit: () => warnNoop("relay_room_pane_noop_fit"),
        sendInput: (data: string, messageQueueItemId?: string) =>
          warnNoop("relay_room_pane_noop_sendInput", {
            // Length of the payload only — NEVER log the payload text
            // (privacy discipline: could contain typed message content).
            dataLen: typeof data === "string" ? data.length : 0,
            hasMessageQueueItemId: typeof messageQueueItemId === "string",
          }),
        notifyResize: () => warnNoop("relay_room_pane_noop_notifyResize"),
        refresh: () => warnNoop("relay_room_pane_noop_refresh"),
        openFileManager: () =>
          warnNoop("relay_room_pane_noop_openFileManager"),
      };
    },
    [tabId, roomId],
  );

  // Pane geometry mirrors IdentitySessionPane.tsx L222 verbatim so the
  // relay pane fits the same shell contract as identity panes: PrettyView
  // there is the flex child that fills 1fr; RelayRoomPane here plays the
  // same role via its own `flex-1 min-h-0` className.
  return (
    <div className="h-full w-full relative flex flex-col">
      <RelayRoomPane
        roomId={roomId}
        roomTitle={roomTitle}
        isVisible={isVisible}
        className="flex-1 min-h-0"
      />
    </div>
  );
});
