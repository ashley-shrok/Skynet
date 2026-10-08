/**
 * AdminServiceSecrets — the "Agent service keys" section of the admin user
 * modal's Account tab. Lists every per-user secret the agent services
 * declare, admin- and user-managed, with set/replace/remove. Values are
 * never shown, to admins either.
 *
 * Renders nothing when no service declares per-user secrets.
 */

import { useCallback, useEffect, useState } from "react";
import {
  clearUserServiceSecret,
  getUserServiceSecrets,
  setUserServiceSecret,
  type ServiceSecret,
} from "@/api/service-secrets-api";
import {
  ServiceSecretRow,
  groupByService,
} from "@/features/service-secrets/ServiceSecretRow";
import { AdminError, AdminSection, adminErrorMessage } from "./admin-ui";

export function AdminServiceSecrets({
  userId,
}: {
  userId: string;
}): JSX.Element | null {
  const [secrets, setSecrets] = useState<ServiceSecret[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSecrets(await getUserServiceSecrets(userId));
      setError(null);
    } catch (err) {
      setError(adminErrorMessage(err, "Failed to load service keys."));
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <AdminSection title="Agent service keys">
        <AdminError testId="admin-service-secrets-error">{error}</AdminError>
      </AdminSection>
    );
  }
  if (!secrets || secrets.length === 0) return null;

  return (
    <AdminSection
      title="Agent service keys"
      description="Keys this user's agents use when calling these services. Admin-managed keys are hidden from the user entirely; user-managed ones they can also change in Preferences. Saved keys can't be viewed, only replaced or removed."
      testId="admin-service-secrets"
    >
      {groupByService(secrets).map((group) => (
        <div key={group.service} className="flex flex-col">
          <span className="text-[12px] text-[#cfc8b8] font-mono">
            {group.service}
          </span>
          {group.secrets.map((s) => (
            <ServiceSecretRow
              key={s.name}
              secret={s}
              showManagedBy
              onSave={async (value) => {
                await setUserServiceSecret(userId, s, value);
                await load();
              }}
              onClear={async () => {
                await clearUserServiceSecret(userId, s);
                await load();
              }}
            />
          ))}
        </div>
      ))}
    </AdminSection>
  );
}
