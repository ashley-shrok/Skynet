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
    <div
      className="flex-1 p-6 flex flex-col gap-5"
      data-testid="preferences-services-pane"
    >
      <p className="text-[13px] leading-[18px]" style={{ color: "#c8c4b8" }}>
        Keys your agents use when they call these services for you. Once saved,
        a key can be replaced or removed but not viewed.
      </p>
      {groupByService(secrets).map((group) => (
        <section key={group.service} className="flex flex-col gap-1">
          <h3
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "rgba(200,196,184,0.6)",
              fontWeight: 600,
            }}
          >
            {group.service}
          </h3>
          <span className="text-[12px] text-[#a89a80]">
            {group.description}
          </span>
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
        </section>
      ))}
    </div>
  );
}
