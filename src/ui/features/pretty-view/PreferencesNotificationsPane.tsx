/**
 * Preferences → Notifications. Two routes out of the app, each optional:
 * notifications on this computer (per browser, desktop only — hidden
 * elsewhere) and the user's own Telegram bot.
 */

import type { ReactElement } from "react";
import { PreferencesBrowserNotificationsSection } from "./PreferencesBrowserNotificationsSection";
import { PreferencesTelegramSection } from "./PreferencesTelegramSection";
import { isBrowserNotificationsSupported } from "@/features/notifications/browser-notifications";

export interface PreferencesNotificationsPaneProps {
  userId?: string;
}

export function PreferencesNotificationsPane(
  _props: PreferencesNotificationsPaneProps,
): ReactElement {
  if (!isBrowserNotificationsSupported()) return <PreferencesTelegramSection />;
  return (
    <div className="flex flex-col">
      <h3 className="k-group-title">This computer</h3>
      <PreferencesBrowserNotificationsSection />
      <h3 className="k-group-title" data-testid="preferences-notifications-telegram-heading">Telegram</h3>
      <PreferencesTelegramSection />
    </div>
  );
}
