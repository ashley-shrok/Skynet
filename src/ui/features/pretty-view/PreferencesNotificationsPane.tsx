/**
 * PreferencesNotificationsPane — stub pane to be populated in Plan 137-04.
 *
 * Renders a placeholder div with a data-testid so the nav-switching
 * mechanism in PreferencesModal can be tested independently. Plan 04
 * folds in the EnableNotificationsModal interior (load-bearing iOS PWA
 * gesture-gate invariant preserved there).
 */

export interface PreferencesNotificationsPaneProps {
  userId: string;
}

export function PreferencesNotificationsPane(
  _props: PreferencesNotificationsPaneProps,
): JSX.Element {
  return (
    <div
      className="flex-1 p-6 text-[13px] text-[#c8c4b8]"
      data-testid="preferences-notifications-pane-stub"
    >
      Notifications — populated in Plan 04
    </div>
  );
}
