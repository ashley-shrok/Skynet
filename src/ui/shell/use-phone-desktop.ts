// ─── use-phone-desktop — an agent's desktop full screen on a phone ─────────
//
// A phone has no split view, so an agent's desktop opens on its own screen:
// the desktop tab is selected and shown alone. Opening it adds a history
// entry (same address) tagged with the desktop (`hostId::identityKey` — the
// tag survives a reload, tab ids don't), so the phone's own back gesture
// leaves it the same way the bar's back button does.
//
// Leaving returns to the conversation the desktop was opened from — else the
// agent's own conversation, opened again if it isn't (after a reload only the
// shown tab comes back) — and closes the desktop's tab, which hands control
// back to the agent. Only when even that fails does it go to the list.
//
// A full-screen desktop on screen without its entry on top (after a reload,
// the app's no-selection safety net can step back over it before the tabs
// come back) gets the entry put back, so back still leaves it.
//
// The bar's back button fires DESKTOP_BACK_EVENT. When the desktop's history
// entry is on top, back steps over it and popstate does the leaving, keeping
// the phone's history in step; otherwise it leaves straight away.

import { useCallback, useEffect, useRef } from "react";

import { systemLogger } from "@/lib/frontend-logger";
import { navigateToList, navigateToView } from "@/lib/mobile-flow";
import { selectConversationDeferred } from "@/state/conversation-store";
import type { Tab } from "@/types/ui-types";
import {
  DESKTOP_BACK_EVENT,
  DESKTOP_HISTORY_KEY,
  desktopOpensFullScreen,
  type DesktopDragPayload,
} from "./desktop-drag";

/** The agent's own conversation tab, if open. */
export function findAgentConversation(
  tabs: readonly Tab[],
  hostId: number,
  identityKey: string,
): Tab | undefined {
  return tabs.find(
    (t) =>
      t.type === "terminal" &&
      t.host?.id === String(hostId) &&
      t.targetTmuxSession?.toLowerCase() === identityKey,
  );
}

/** The history tag for a desktop: stable across reloads. */
export function desktopTag(hostId: number, identityKey: string): string {
  return `${hostId}::${identityKey}`;
}

function tagOfState(state: unknown): string | null {
  const v = (state as Record<string, unknown> | null)?.[DESKTOP_HISTORY_KEY];
  return typeof v === "string" ? v : null;
}

export function usePhoneDesktop(
  tabs: readonly Tab[],
  closeTab: (tabId: string) => void,
  /** Open the agent's conversation (not open now); its tab id, or null if it can't be. */
  openConversation: (hostId: number, identityKey: string) => string | null,
  /** The tab on screen. */
  selectedTabId: string | null,
): {
  /** Show an already-opened desktop tab full screen. `fromTabId`: the conversation on screen. */
  openFullScreen: (tabId: string, payload: DesktopDragPayload, fromTabId: string | null) => void;
} {
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const closeTabRef = useRef(closeTab);
  closeTabRef.current = closeTab;
  const openConversationRef = useRef(openConversation);
  openConversationRef.current = openConversation;
  /** Where each full-screen desktop was opened from (desktop tab id → conversation tab id). */
  const originsRef = useRef(new Map<string, string>());
  /** The tag of the history entry on top, as last seen. */
  const topTagRef = useRef<string | null>(
    typeof window === "undefined" ? null : tagOfState(window.history.state),
  );

  const desktopTabFor = (tag: string): Tab | undefined =>
    tabsRef.current.find(
      (t) => t.desktop !== undefined && desktopTag(t.desktop.hostId, t.desktop.identityKey) === tag,
    );

  /** Desktops being left: their entry mustn't be put back meanwhile. */
  const leavingRef = useRef(new Set<string>());

  const leave = useCallback((desk: Tab, via: string) => {
    const d = desk.desktop;
    if (!d) return;
    leavingRef.current.add(desk.id);
    const tabs = tabsRef.current;
    const originId = originsRef.current.get(desk.id);
    originsRef.current.delete(desk.id);
    const convId =
      (originId !== undefined ? tabs.find((t) => t.id === originId) : undefined)?.id ??
      findAgentConversation(tabs, d.hostId, d.identityKey)?.id ??
      openConversationRef.current(d.hostId, d.identityKey);
    systemLogger.info("[desktop-pane] back from full screen", {
      operation: "desktop_pane_full_screen_back",
      tabId: desk.id,
      via,
      hostId: d.hostId,
      identityKey: d.identityKey,
      convTabId: convId,
      toOrigin: convId !== null && convId === originId,
    });
    if (convId !== null) {
      selectConversationDeferred(convId);
      navigateToView();
    } else {
      navigateToList();
    }
    // Closing the desktop hands control back (and stops the stream) even
    // when nothing else is selected in its place.
    closeTabRef.current(desk.id);
  }, []);

  useEffect(() => {
    const onBack = (e: Event) => {
      const tabId = (e as CustomEvent<{ tabId?: unknown }>).detail?.tabId;
      if (typeof tabId !== "string") return;
      const desk = tabsRef.current.find((t) => t.id === tabId);
      if (!desk?.desktop) return;
      const tag = desktopTag(desk.desktop.hostId, desk.desktop.identityKey);
      if (tagOfState(window.history.state) === tag) {
        window.history.back();
        return;
      }
      leave(desk, "bar");
    };
    // A history step that leaves a desktop's entry (the phone's back gesture,
    // or the bar's step back above) leaves that desktop — if it's still open.
    const onPop = () => {
      const prev = topTagRef.current;
      const now = tagOfState(window.history.state);
      topTagRef.current = now;
      if (prev === null || prev === now) return;
      const desk = desktopTabFor(prev);
      if (desk !== undefined) leave(desk, "history");
    };
    window.addEventListener(DESKTOP_BACK_EVENT, onBack);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener(DESKTOP_BACK_EVENT, onBack);
      window.removeEventListener("popstate", onPop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- desktopTabFor reads refs only
  }, [leave]);

  // Put a missing entry back for the full-screen desktop on screen.
  useEffect(() => {
    if (selectedTabId === null || leavingRef.current.has(selectedTabId)) return;
    const desk = tabs.find((t) => t.id === selectedTabId);
    if (!desk?.desktop || !desktopOpensFullScreen()) return;
    const tag = desktopTag(desk.desktop.hostId, desk.desktop.identityKey);
    if (tagOfState(window.history.state) === tag) return;
    systemLogger.info("[desktop-pane] full-screen history entry restored", {
      operation: "desktop_pane_full_screen_entry_restored",
      tabId: desk.id,
      hostId: desk.desktop.hostId,
      identityKey: desk.desktop.identityKey,
    });
    window.history.pushState(
      { ...((window.history.state as object | null) ?? {}), [DESKTOP_HISTORY_KEY]: tag },
      "",
      window.location.href,
    );
    topTagRef.current = tag;
  }, [selectedTabId, tabs]);

  const openFullScreen = useCallback(
    (tabId: string, payload: DesktopDragPayload, fromTabId: string | null) => {
      const fromConv =
        fromTabId !== null && tabsRef.current.find((t) => t.id === fromTabId)?.type === "terminal"
          ? fromTabId
          : null;
      systemLogger.info("[desktop-pane] open full screen", {
        operation: "desktop_pane_open_full_screen",
        hostId: payload.hostId,
        identityKey: payload.identityKey,
        tabId,
        fromTabId: fromConv,
      });
      if (fromConv !== null) originsRef.current.set(tabId, fromConv);
      selectConversationDeferred(tabId);
      navigateToView();
      const tag = desktopTag(payload.hostId, payload.identityKey);
      const state = {
        ...((window.history.state as object | null) ?? {}),
        [DESKTOP_HISTORY_KEY]: tag,
      };
      // Already on a desktop's entry (a second open): reuse it rather than
      // stack an entry the next back would step over to nothing.
      if (topTagRef.current !== null && tagOfState(window.history.state) !== null) {
        window.history.replaceState(state, "", window.location.href);
      } else {
        window.history.pushState(state, "", window.location.href);
      }
      topTagRef.current = tag;
    },
    [],
  );

  return { openFullScreen };
}
