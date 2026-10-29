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
 *   - One tab per browser shows it: the tab holding a Web Lock. Without Web
 *     Locks every tab shows it under the same tag, which the browser folds
 *     into one.
 *   - Not when the user is looking at that conversation: a tab with the
 *     conversation on screen in a focused window says so over a
 *     BroadcastChannel, and the showing tab waits briefly to hear it.
 *
 * Clicking a notification focuses the tab that showed it and opens the
 * conversation (requestOpenConversation → AppShell's openHarness path).
 */

import { isTouchDeviceNow } from "@/hooks/use-is-touch-device";

const ENABLED_KEY = "browser-notifications-enabled";
const LOCK_NAME = "agent-notifications-leader";
const CHANNEL_NAME = "agent-notifications";
/** How long the showing tab waits to hear that another tab is looking. */
export const LOOKING_WAIT_MS = 300;
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
      permission = await Notification.requestPermission();
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

// ─── What this tab is showing ────────────────────────────────────────────────

function convKey(hostId: string, identityName: string): string {
  return `${hostId}|${identityName.toLowerCase()}`;
}

let lookingAt = new Set<string>();

/**
 * The conversations this tab has on screen while the tab is visible (fed by
 * the seen tracker). Empty when the tab is hidden.
 */
export function setLookingAtConversations(targets: ReadonlyArray<{ hostId: string; identityName: string }>): void {
  lookingAt = new Set(targets.map((t) => convKey(t.hostId, t.identityName)));
}

function thisTabIsLookingAt(key: string): boolean {
  if (!lookingAt.has(key)) return false;
  try {
    return document.visibilityState === "visible" && document.hasFocus();
  } catch {
    return false;
  }
}

// ─── Which tab shows it ──────────────────────────────────────────────────────

let started = false;
let isLeader = false;
let locksAvailable = false;
let channel: BroadcastChannel | null = null;
const lookingElsewhere = new Set<string>();
const seenIds: string[] = [];

type ChannelMessage = { kind: "looking"; notificationId: string };

/**
 * Join this browser's tabs: take part in choosing the one tab that shows
 * notifications, and listen for tabs that are looking at a conversation.
 * Idempotent; called once at app start.
 */
export function startBrowserNotifications(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (e: MessageEvent<ChannelMessage>) => {
        if (e.data?.kind === "looking" && typeof e.data.notificationId === "string") {
          lookingElsewhere.add(e.data.notificationId);
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
}

function rememberId(id: string): boolean {
  if (seenIds.includes(id)) return false;
  seenIds.push(id);
  if (seenIds.length > SEEN_IDS_CAP) seenIds.shift();
  return true;
}

function show(n: AgentNotification): void {
  if (lookingElsewhere.has(n.notificationId)) {
    lookingElsewhere.delete(n.notificationId);
    console.info({ operation: "browser_notifications_skipped_looking_elsewhere", notificationId: n.notificationId });
    return;
  }
  // Re-check: switched off or permission revoked while we waited.
  if (getBrowserNotificationsState() !== "on") return;
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
  if (!rememberId(n.notificationId)) return;
  if (thisTabIsLookingAt(convKey(n.hostId, n.identityName))) {
    channel?.postMessage({ kind: "looking", notificationId: n.notificationId } satisfies ChannelMessage);
    console.info({ operation: "browser_notifications_skipped_looking", notificationId: n.notificationId });
    return;
  }
  // With Web Locks only the chosen tab shows it; without, every tab does and
  // the shared tag folds them into one.
  if (locksAvailable && !isLeader) return;
  window.setTimeout(() => show(n), LOOKING_WAIT_MS);
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
  lookingElsewhere.clear();
  seenIds.length = 0;
  lookingAt = new Set();
  stateListeners.clear();
  openListeners.clear();
}
