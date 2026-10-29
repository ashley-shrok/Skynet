/**
 * Preferences → Notifications: notifications on this computer (browser
 * notifications). Per browser, desktop only — hidden on touch devices and
 * browsers without notifications. See browser-notifications.ts.
 *
 * States:
 *   off      → switch off; turning it on asks the browser's permission
 *   on       → switch on, plus a test send
 *   blocked  → the browser (or the user's IT) denied permission: say so
 *              plainly, never show the switch as on
 */

import { useCallback, useState, useSyncExternalStore, type ReactElement } from "react";
import {
  getBrowserNotificationsState,
  setBrowserNotificationsEnabled,
  showTestNotification,
  subscribeBrowserNotificationsState,
} from "@/features/notifications/browser-notifications";
import { useBrandingConfig } from "@/branding/branding-store";
import { KitSettingsGroup, KitSettingsRow, KitSwitch } from "@/components/kit";

export function PreferencesBrowserNotificationsSection(): ReactElement | null {
  const state = useSyncExternalStore(subscribeBrowserNotificationsState, getBrowserNotificationsState);
  const { appName } = useBrandingConfig();
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);

  const handleToggle = useCallback(async (next: boolean) => {
    setBusy(true);
    setTestResult(null);
    try {
      await setBrowserNotificationsEnabled(next);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleTest = useCallback(() => {
    setTestResult(showTestNotification(appName) ? "ok" : "fail");
  }, [appName]);

  if (state === "unsupported") return null;

  return (
    <section className="flex flex-col" data-testid="preferences-browser-notifications">
      <KitSettingsGroup
        footer={
          state === "blocked" ? (
            <span data-testid="preferences-browser-notifications-blocked" role="status">
              Your browser is blocking notifications from this site. To allow them, click
              the icon at the left of the address bar and allow notifications. On a work
              computer, your company may have turned them off.
            </span>
          ) : (
            `Works while a tab of ${appName} is open in this browser.`
          )
        }
      >
        <KitSettingsRow
          label="Notifications on this computer"
          description="Your computer shows each notification from an agent."
          control={
            <KitSwitch
              checked={state === "on"}
              disabled={busy || state === "blocked"}
              onCheckedChange={(next) => void handleToggle(next)}
              aria-label="Show notifications from agents on this computer"
              data-testid="preferences-browser-notifications-switch"
            />
          }
        />
      </KitSettingsGroup>
      {state === "on" && (
        <KitSettingsGroup
          footer={
            testResult === "fail" ? (
              <span className="k-err" role="alert" data-testid="preferences-browser-notifications-test-result">
                Couldn't show a notification. Check that notifications are allowed for this browser in your computer's settings.
              </span>
            ) : testResult === "ok" ? (
              <span data-testid="preferences-browser-notifications-test-result" role="status">
                Sent. If nothing appeared, check that notifications are allowed for this browser in your computer's settings.
              </span>
            ) : undefined
          }
        >
          <KitSettingsRow
            tone="accent"
            label="Send a test notification"
            onClick={handleTest}
            chevron={false}
            data-testid="preferences-browser-notifications-test"
          />
        </KitSettingsGroup>
      )}
    </section>
  );
}
