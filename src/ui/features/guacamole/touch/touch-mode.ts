/**
 * touch-mode — which way touch drives a remote desktop's mouse (trackpad or
 * direct). One choice per device, kept in this browser, shared by every
 * remote desktop. Phones start in trackpad mode, tablets in direct mode.
 */

import { useSyncExternalStore } from "react";
import { systemLogger } from "@/lib/frontend-logger";
import type { TouchMouseMode } from "./gestures";

export const TOUCH_MODE_STORAGE_KEY = "skynet.touchMouseMode";

/**
 * A remote-desktop bar's keyboard button asks the session in pane `tabId`
 * (event detail) to raise or put away the phone keyboard. Dispatched inside
 * the tap, so the session can still raise it.
 */
export const TOGGLE_KEYBOARD_EVENT = "skynet:guacamole-toggle-keyboard";

/** A phone: the screen's short side is under 600 CSS px, whichever way it's held. */
export function isPhoneScreen(): boolean {
  if (typeof window === "undefined" || !window.screen) return false;
  const short = Math.min(window.screen.width, window.screen.height);
  // 0 = the size isn't known (not a real screen): not a phone.
  return short > 0 && short < 600;
}

export function defaultTouchMode(): TouchMouseMode {
  return isPhoneScreen() ? "trackpad" : "direct";
}

const listeners = new Set<() => void>();
/** The last choice made on this page — used when storage is unavailable. */
let pageMode: TouchMouseMode | null = null;

export function getTouchMode(): TouchMouseMode {
  try {
    const v = window.localStorage.getItem(TOUCH_MODE_STORAGE_KEY);
    if (v === "trackpad" || v === "direct") return v;
  } catch {
    // Storage unavailable — fall through to the device default.
  }
  return pageMode ?? defaultTouchMode();
}

export function setTouchMode(mode: TouchMouseMode): void {
  pageMode = mode;
  try {
    window.localStorage.setItem(TOUCH_MODE_STORAGE_KEY, mode);
  } catch {
    // Storage unavailable — the choice lasts for this page only.
  }
  systemLogger.info("[touch-input] mode switched", {
    operation: "touch_mode_switch",
    mode,
  });
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === TOUCH_MODE_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useTouchMode(): TouchMouseMode {
  return useSyncExternalStore(subscribe, getTouchMode, getTouchMode);
}
