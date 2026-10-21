/**
 * PreferencesServicesPane — the user's own keys for agent services (e.g. an
 * API key their agents use on their behalf).
 *
 * Only user-managed secrets appear; admin-managed ones (company-issued keys)
 * are never listed for the user. PreferencesModal hides the nav entry when
 * there is nothing to show.
 */

import type { ServiceSecret } from "@/api/service-secrets-api";
import {
  clearMyServiceSecret,
  setMyServiceSecret,
} from "@/api/service-secrets-api";
import {
  ServiceSecretRow,
  groupByService,
} from "@/features/service-secrets/ServiceSecretRow";
import { KitSettingsGroup } from "@/components/kit";

export interface PreferencesServicesPaneProps {
  secrets: ServiceSecret[];
  /** Re-fetch after a change so statuses update. */
  onChanged: () => void;
}

export function PreferencesServicesPane({
  secrets,
  onChanged,
}: PreferencesServicesPaneProps): JSX.Element {
  return (
    <div data-testid="preferences-services-pane">
      {groupByService(secrets).map((group) => (
        <KitSettingsGroup
          key={group.service}
          title={group.service}
          footer={group.description || undefined}
        >
          <div className="flex flex-col px-3.5">
            {group.secrets.map((s) => (
              <ServiceSecretRow
                key={s.name}
                secret={s}
                onSave={async (value) => {
                  await setMyServiceSecret(s, value);
                  onChanged();
                }}
                onClear={async () => {
                  await clearMyServiceSecret(s);
                  onChanged();
                }}
              />
            ))}
          </div>
        </KitSettingsGroup>
      ))}
    </div>
  );
}
