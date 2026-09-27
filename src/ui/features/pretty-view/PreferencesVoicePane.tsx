/**
 * PreferencesVoicePane — stub pane to be populated in Plan 137-03.
 *
 * Renders a placeholder div with a data-testid so the nav-switching
 * mechanism in PreferencesModal can be tested independently. Plan 03
 * replaces the body with the VoicePicker + autosave implementation.
 */

import type { UserPreferences } from "@/api/open-tabs-api";

export interface PreferencesVoicePaneProps {
  userId: string;
  userPrefs: UserPreferences;
  onUserPrefsChanged?: (prefs: Partial<UserPreferences>) => void;
}

export function PreferencesVoicePane(_props: PreferencesVoicePaneProps): JSX.Element {
  return (
    <div
      className="flex-1 p-6 text-[13px] text-[#c8c4b8]"
      data-testid="preferences-voice-pane-stub"
    >
      Voice — populated in Plan 03
    </div>
  );
}
