/**
 * PreferencesAboutYouPane — stub pane to be populated in Plan 137-05.
 *
 * Renders a placeholder div with a data-testid so the nav-switching
 * mechanism in PreferencesModal can be tested independently. Plan 05
 * folds in the GlobalFilesModal interior (host picker + MDXEditor + save flow).
 */

import type { HostFolder } from "@/types/ui-types";

export interface PreferencesAboutYouPaneProps {
  userId: string;
  hostTree?: HostFolder | null;
  defaultHostId?: number | null;
}

export function PreferencesAboutYouPane(
  _props: PreferencesAboutYouPaneProps,
): JSX.Element {
  return (
    <div
      className="flex-1 p-6 text-[13px] text-[#c8c4b8]"
      data-testid="preferences-about-you-pane-stub"
    >
      About you — populated in Plan 05
    </div>
  );
}
