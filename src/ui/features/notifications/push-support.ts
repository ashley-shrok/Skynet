/**
 * Feature-detect Web Push support. Callers hide/replace UI on browsers
 * that can't subscribe (e.g. old Safari, in-app WebViews). Returns false
 * in SSR contexts because `window`/`navigator` are undefined there.
 *
 * Phase 137: relocated from the retired notifications modal as that modal
 * folded into PreferencesModal's NotificationsPane. Kept as a standalone
 * export so PreferencesNotificationsPane and any future consumers can
 * import it without pulling the modal component.
 */
export function pushNotificationsSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}
