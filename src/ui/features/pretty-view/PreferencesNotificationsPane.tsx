/**
 * Preferences → Notifications. Each user sets up their own Telegram bot;
 * the section handles setup, testing and disconnecting.
 */

import type { ReactElement } from "react";
import { PreferencesTelegramSection } from "./PreferencesTelegramSection";

export interface PreferencesNotificationsPaneProps {
  userId?: string;
}

export function PreferencesNotificationsPane(
  _props: PreferencesNotificationsPaneProps,
): ReactElement {
  return (
    <PreferencesTelegramSection />
  );
}
