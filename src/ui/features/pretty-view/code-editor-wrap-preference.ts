/**
 * Soft-wrap preference for CodeEditor — read/write to browser-local storage.
 *
 * Per-browser preference: user turns soft-wrap on once, it stays on across
 * sessions until they turn it back off. Not synced across devices.
 *
 * Safe on private-mode / disabled localStorage — returns the default (off)
 * on read failure, silently swallows write failures. The toggle still
 * works for the current session even if persistence fails.
 */

export const WRAP_STORAGE_KEY = "skynet.codeEditor.softWrap";

export function readSavedWrap(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(WRAP_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeSavedWrap(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WRAP_STORAGE_KEY, value ? "true" : "false");
  } catch {
    // ignore
  }
}
