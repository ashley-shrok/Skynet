/**
 * done-bell (campaign notify-when-done, shape done-bell): what the bell needs
 * to know about how the user can be reached, fetched ahead of the tap.
 *
 *   hasPhone        — a number is on file, so Call me is offered (only an
 *                     admin can grant one, so without it the row is absent).
 *   telegramLinked  — Telegram already reaches them outside the app.
 *
 * Fetched once per page when a bell first appears and refreshed each time the
 * menu opens; the menu renders from the last known values so the Allow prompt
 * can be asked inside the tap itself (browsers only show it from a gesture).
 * Unknown (not yet fetched, or the fetch failed) counts as no phone and as
 * "don't ask" — never offer a call that can't ring, never prompt on a guess.
 */

import { useSyncExternalStore } from "react";
import { getMyPhone } from "@/api/user-phone-api";
import { getTelegramStatus } from "@/features/notifications/telegram-setup-api";
import {
  getBrowserNotificationsState,
  setBrowserNotificationsEnabled,
} from "@/features/notifications/browser-notifications";

export interface DoneBellReach {
  hasPhone: boolean;
  /** null = unknown. */
  telegramLinked: boolean | null;
}

const UNKNOWN: DoneBellReach = { hasPhone: false, telegramLinked: null };
let reach: DoneBellReach = UNKNOWN;
let inFlight: Promise<void> | null = null;
let loadedOnce = false;
const listeners = new Set<() => void>();

function set(next: DoneBellReach): void {
  if (next.hasPhone === reach.hasPhone && next.telegramLinked === reach.telegramLinked) return;
  reach = next;
  for (const l of listeners) l();
}

export function refreshDoneBellReach(reason: string): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const [phone, telegram] = await Promise.allSettled([getMyPhone(), getTelegramStatus()]);
    const next: DoneBellReach = {
      hasPhone: phone.status === "fulfilled" ? phone.value !== null : reach.hasPhone,
      telegramLinked: telegram.status === "fulfilled" ? telegram.value.linked : reach.telegramLinked,
    };
    console.info(
      `[done-bell] reach reason=${reason} hasPhone=${next.hasPhone} telegramLinked=${next.telegramLinked}` +
        ` phoneFetch=${phone.status} telegramFetch=${telegram.status}`,
    );
    set(next);
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function getDoneBellReach(): DoneBellReach {
  return reach;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Current reach; the first caller with `enabled` starts the page's one fetch. */
export function useDoneBellReach(enabled: boolean): DoneBellReach {
  if (enabled && !loadedOnce) {
    loadedOnce = true;
    void refreshDoneBellReach("first-bell");
  }
  return useSyncExternalStore(subscribe, getDoneBellReach, getDoneBellReach);
}

/**
 * Notify me was picked. When nothing outside the app reaches the user — no
 * Telegram, and this browser can show notifications but has never been asked —
 * ask the browser now; Allow turns on notifications on this computer, exactly
 * as the Preferences switch does. Must be called synchronously inside the tap.
 * Returns whether the prompt was asked. The request is sent whatever happens.
 */
export function maybeAskBrowserNotifications(): boolean {
  if (reach.telegramLinked !== false) return false;
  if (getBrowserNotificationsState() !== "off") return false;
  if (typeof Notification === "undefined" || Notification.permission !== "default") return false;
  console.info("[done-bell] asking browser notification permission");
  void setBrowserNotificationsEnabled(true).then((state) => {
    console.info(`[done-bell] browser notification permission answered state=${state}`);
  });
  return true;
}

export function _resetDoneBellReachForTests(next: DoneBellReach = UNKNOWN): void {
  reach = next;
  inFlight = null;
  loadedOnce = false;
  listeners.clear();
}
