/**
 * Browser notifications — an agent's notification shown by the computer's own
 * notification system while a tab of the app is open in this browser.
 *
 * Every open tab gets an `agent-notified` fleet-status frame when an agent
 * notifies the user (the same event that sends Telegram). This module decides
 * whether, and from which tab, to show it:
 *
 *   - Only when switched on in THIS browser (localStorage — per browser, not
 *     per account) and the browser has granted permission. Desktop only.
 *   - One tab per browser shows it: the tab holding a Web Lock, which tells
 *     the others it handled it. If they hear nothing (that tab's connection
 *     was down when the frame went out) one of them shows it after a short
 *     wait. Without Web Locks every tab shows it under the same tag, which
 *     the browser folds into one.
 *   - Not when the user is looking at that conversation: the focused tab
 *     announces what it has on screen over a BroadcastChannel whenever that
 *     changes, so every tab already knows before a notification arrives.
 *
 * Clicking a notification focuses the tab that showed it and opens the
 * conversation (requestOpenConversation → AppShell's openHarness path).
 */

import { isTouchDeviceNow } from "@/hooks/use-is-touch-device";

const ENABLED_KEY = "browser-notifications-enabled";
const LOCK_NAME = "agent-notifications-leader";
const CHANNEL_NAME = "agent-notifications";
/** How long a tab that isn't the chosen one waits to hear it was handled. */
export const FALLBACK_WAIT_MS = 2_000;
/** Notification ids remembered, so a re-sent frame never shows twice. */
const SEEN_IDS_CAP = 200;

export interface AgentNotification {
  notificationId: string;
  hostId: string;
  identityName: string;
  agentMxid: string;
  title: string;
  body: string;
}

export type OpenConversationRequest = { mxid: string; hostId: number };

export type BrowserNotificationsState =
  | "unsupported" // no Notifications API, or a touch device
  | "blocked" // the browser (or the user's IT) denied permission
  | "off"
  | "on";

// ─── Setting (per browser) ───────────────────────────────────────────────────

const stateListeners = new Set<() => void>();

function notifyState(): void {
  for (const cb of stateListeners) {
    try {
      cb();
    } catch (err) {
      console.warn({ operation: "browser_notifications_listener_threw", error: err instanceof Error ? err.message : String(err) });
    }
  }
}

export function subscribeBrowserNotificationsState(cb: () => void): () => void {
  stateListeners.add(cb);
  return () => stateListeners.delete(cb);
}

function hasNotificationApi(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function isBrowserNotificationsSupported(): boolean {
  return hasNotificationApi() && !isTouchDeviceNow();
}

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeEnabled(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(ENABLED_KEY, "1");
    else window.localStorage.removeItem(ENABLED_KEY);
  } catch (err) {
    console.warn({ operation: "browser_notifications_store_failed", error: err instanceof Error ? err.message : String(err) });
  }
}

export function getBrowserNotificationsState(): BrowserNotificationsState {
  if (!isBrowserNotificationsSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return readEnabled() && Notification.permission === "granted" ? "on" : "off";
}

/**
 * Turn browser notifications on (asking the browser's permission if it hasn't
 * been given yet) or off. Must be called from the user's click — browsers only
 * show the Allow prompt for a user gesture. Resolves to the resulting state.
 */
export async function setBrowserNotificationsEnabled(on: boolean): Promise<BrowserNotificationsState> {
  if (!isBrowserNotificationsSupported()) return "unsupported";
  if (!on) {
    writeEnabled(false);
    console.info({ operation: "browser_notifications_turned_off" });
    notifyState();
    return getBrowserNotificationsState();
  }
  let permission = Notification.permission;
  if (permission === "default") {
    try {
      // Old Safari's is callback-only and resolves undefined.
      permission = (await Notification.requestPermission()) ?? Notification.permission;
    } catch (err) {
      console.warn({ operation: "browser_notifications_permission_threw", error: err instanceof Error ? err.message : String(err) });
      permission = Notification.permission;
    }
  }
  writeEnabled(permission === "granted");
  console.info({ operation: "browser_notifications_turn_on", permission });
  notifyState();
  return getBrowserNotificationsState();
}

// ─── Opening a conversation from a click ─────────────────────────────────────

const openListeners = new Set<(req: OpenConversationRequest) => void>();

/** AppShell subscribes and opens the conversation, as a deep link would. */
export function subscribeOpenConversationRequests(cb: (req: OpenConversationRequest) => void): () => void {
  openListeners.add(cb);
  return () => openListeners.delete(cb);
}

function requestOpenConversation(req: OpenConversationRequest): void {
  for (const cb of openListeners) {
    try {
      cb(req);
    } catch (err) {
      console.warn({ operation: "browser_notifications_open_threw", error: err instanceof Error ? err.message : String(err) });
    }
  }
}

// ─── What the user is looking at ─────────────────────────────────────────────

function convKey(hostId: string, identityName: string): string {
  return `${hostId}|${identityName.toLowerCase()}`;
}

const tabId = Math.random().toString(36).slice(2) + Date.now().toString(36);
let lookingAt: string[] = [];
/** The tab in a focused window and what it has on screen — at most one. */
let focusedTab: { tabId: string; keys: string[] } | null = null;

function thisTabIsFocused(): boolean {
  try {
    return document.visibilityState === "visible" && document.hasFocus();
  } catch {
    return false;
  }
}

/** Tell the other tabs whether this one is focused, and on what. */
function announceFocus(): void {
  const focused = thisTabIsFocused();
  if (focused) focusedTab = { tabId, keys: lookingAt };
  else if (focusedTab?.tabId === tabId) focusedTab = null;
  channel?.postMessage({ kind: "focus", tabId, focused, keys: lookingAt } satisfies ChannelMessage);
}

/**
 * The conversations this tab has on screen while the tab is visible (fed by
 * the seen tracker). Empty when the tab is hidden.
 */
export function setLookingAtConversations(targets: ReadonlyArray<{ hostId: string; identityName: string }>): void {
  lookingAt = targets.map((t) => convKey(t.hostId, t.identityName));
  announceFocus();
}

function userIsLookingAt(key: string): boolean {
  if (thisTabIsFocused()) return lookingAt.includes(key);
  return focusedTab !== null && focusedTab.tabId !== tabId && focusedTab.keys.includes(key);
}

// ─── Which tab shows it ──────────────────────────────────────────────────────

let started = false;
let isLeader = false;
let locksAvailable = false;
let channel: BroadcastChannel | null = null;
const seenIds: string[] = [];
/** Notifications another tab has dealt with (shown or skipped). */
const handledIds: string[] = [];

type ChannelMessage =
  | { kind: "focus"; tabId: string; focused: boolean; keys: string[] }
  | { kind: "handled"; notificationId: string };

function remember(list: string[], id: string): boolean {
  if (list.includes(id)) return false;
  list.push(id);
  if (list.length > SEEN_IDS_CAP) list.shift();
  return true;
}

/**
 * Join this browser's tabs: take part in choosing the one tab that shows
 * notifications, and keep track of which tab the user is looking at.
 * Idempotent; called once at app start.
 */
export function startBrowserNotifications(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (e: MessageEvent<ChannelMessage>) => {
        const m = e.data;
        if (m?.kind === "handled" && typeof m.notificationId === "string") {
          remember(handledIds, m.notificationId);
        } else if (m?.kind === "focus" && typeof m.tabId === "string" && Array.isArray(m.keys)) {
          if (m.focused) focusedTab = { tabId: m.tabId, keys: m.keys };
          else if (focusedTab?.tabId === m.tabId) focusedTab = null;
        }
      };
    } catch (err) {
      console.warn({ operation: "browser_notifications_channel_failed", error: err instanceof Error ? err.message : String(err) });
    }
  }
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (locks && typeof locks.request === "function") {
    locksAvailable = true;
    // Held for the tab's life; the browser hands it on when this tab closes.
    void locks
      .request(LOCK_NAME, () => {
        isLeader = true;
        console.info({ operation: "browser_notifications_leader" });
        return new Promise<void>(() => {});
      })
      .catch((err: unknown) => {
        locksAvailable = false;
        console.warn({ operation: "browser_notifications_lock_failed", error: err instanceof Error ? err.message : String(err) });
      });
  }
  window.addEventListener("storage", (e) => {
    if (e.key === ENABLED_KEY) notifyState();
  });
  window.addEventListener("focus", announceFocus);
  window.addEventListener("blur", announceFocus);
  document.addEventListener("visibilitychange", announceFocus);
  window.addEventListener("pagehide", () => {
    if (focusedTab?.tabId === tabId) focusedTab = null;
    channel?.postMessage({ kind: "focus", tabId, focused: false, keys: [] } satisfies ChannelMessage);
  });
  // Blocked or allowed in the browser's own settings while the app is open.
  const permissions = (navigator as Navigator & { permissions?: Permissions }).permissions;
  if (permissions && typeof permissions.query === "function") {
    permissions
      .query({ name: "notifications" as PermissionName })
      .then((status) => {
        status.onchange = () => {
          console.info({ operation: "browser_notifications_permission_changed", permission: Notification.permission });
          notifyState();
        };
      })
      .catch(() => {
        // Not every browser can watch this permission; the switch re-reads on its next render.
      });
  }
}

function markHandled(id: string): void {
  remember(handledIds, id);
  channel?.postMessage({ kind: "handled", notificationId: id } satisfies ChannelMessage);
}

function show(n: AgentNotification): void {
  if (handledIds.includes(n.notificationId)) return;
  // Re-check: switched off, permission revoked, or the user came to it while we waited.
  if (getBrowserNotificationsState() !== "on") return;
  markHandled(n.notificationId);
  if (userIsLookingAt(convKey(n.hostId, n.identityName))) {
    console.info({ operation: "browser_notifications_skipped_looking", notificationId: n.notificationId });
    return;
  }
  try {
    const shown = new Notification(n.title, { body: n.body, tag: n.notificationId });
    const hostId = Number(n.hostId);
    shown.onclick = () => {
      try {
        window.focus();
      } catch {
        // focus is best-effort
      }
      if (Number.isInteger(hostId) && hostId > 0) {
        requestOpenConversation({ mxid: n.agentMxid, hostId });
      }
      shown.close();
      console.info({ operation: "browser_notifications_clicked", notificationId: n.notificationId, hostId: n.hostId, identityName: n.identityName });
    };
    console.info({ operation: "browser_notifications_shown", notificationId: n.notificationId, hostId: n.hostId, identityName: n.identityName });
  } catch (err) {
    console.warn({ operation: "browser_notifications_show_failed", notificationId: n.notificationId, error: err instanceof Error ? err.message : String(err) });
  }
}

/** An agent just notified the user (fleet-status `agent-notified` frame). */
export function handleAgentNotified(n: AgentNotification): void {
  if (getBrowserNotificationsState() !== "on") return;
  if (!remember(seenIds, n.notificationId)) return;
  // The chosen tab (or every tab, without Web Locks — the shared tag folds
  // them into one) shows it now; the others stand by in case the chosen
  // tab never got it.
  if (!locksAvailable || isLeader) show(n);
  else window.setTimeout(() => show(n), FALLBACK_WAIT_MS);
}

/** Preferences' "Send a test notification". */
export function showTestNotification(appName: string): boolean {
  if (getBrowserNotificationsState() !== "on") return false;
  try {
    new Notification(appName, {
      body: "Notifications from your agents will look like this.",
      tag: "browser-notifications-test",
    });
    console.info({ operation: "browser_notifications_test_shown" });
    return true;
  } catch (err) {
    console.warn({ operation: "browser_notifications_test_failed", error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/** Test-only: forget everything. */
export function _resetBrowserNotificationsForTests(): void {
  started = false;
  isLeader = false;
  locksAvailable = false;
  channel?.close();
  channel = null;
  seenIds.length = 0;
  handledIds.length = 0;
  lookingAt = [];
  focusedTab = null;
  stateListeners.clear();
  openListeners.clear();
}
