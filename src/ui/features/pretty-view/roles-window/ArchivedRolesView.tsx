// The roles window's archived view: retired roles on this host, each with an
// Un-archive button. Un-archiving keeps you here; the row then says the role
// is on its way back.

import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { ModalBody, ModalHead } from "@/components/modal";
import {
  KitAvatar,
  KitBanner,
  KitButton,
  KitEmpty,
  KitLoading,
  KitSettingsGroup,
  KitSettingsRow,
  kitAlert,
} from "@/components/kit";
import type { ArchivedRoleListEntry } from "@/api/roles-archive-list-api";
import { unarchiveRole } from "@/api/role-unarchive-api";
import { UnarchiveError } from "@/api/identity-unarchive-api";
import { roleDisplayName } from "@/lib/role-display-name";
import type { TabState } from "../IdentityFileTab";
import { ROLE_FALLBACK_HUE, roleAvatarColor } from "./RolesWindow";

export function ArchivedRolesView({
  hostId,
  hostName,
  archived,
  onBack,
  onRestored,
  restored,
}: {
  hostId: number;
  hostName: string;
  archived: TabState<ArchivedRoleListEntry[]>;
  onBack: () => void;
  onRestored: (name: string) => void;
  /** Roles restored earlier while this window was open (still listed by the server until they land). */
  restored?: ReadonlySet<string>;
}): JSX.Element {
  const [state, setState] = useState<Record<string, "restoring" | "restored">>(() =>
    Object.fromEntries([...(restored ?? [])].map((n) => [n, "restored" as const])),
  );

  const restore = (entry: ArchivedRoleListEntry): void => {
    setState((s) => ({ ...s, [entry.name]: "restoring" }));
    unarchiveRole(hostId, entry.name)
      .then(() => {
        console.info({ operation: "role_unarchive_requested", hostId, roleName: entry.name });
        setState((s) => ({ ...s, [entry.name]: "restored" }));
        onRestored(entry.name);
      })
      .catch((err: unknown) => {
        setState((s) => {
          const next = { ...s };
          delete next[entry.name];
          return next;
        });
        console.warn({
          operation: "role_unarchive_failed",
          hostId,
          roleName: entry.name,
          errMessage: err instanceof Error ? err.message : String(err),
        });
        void kitAlert({
          title: `Couldn't un-archive ${roleDisplayName(entry.name)}`,
          body:
            err instanceof UnarchiveError && err.reason === "name_collision"
              ? "A live role with that name already exists."
              : "Try again in a moment.",
        });
      });
  };

  return (
    <>
      <ModalHead
        title="Archived roles"
        subtitle={<span className="max-sm:hidden">Retired roles. Un-archive one to bring it back to {hostName}.</span>}
        closeTestId="roles-window-close"
        leading={
          <KitButton variant="plain" size="sm" onClick={onBack} data-testid="roles-window-back">
            <ChevronLeft /> Roles
          </KitButton>
        }
      />
      <ModalBody className="pt-1">
        {archived.status === "loading" ? (
          <KitLoading lines={2} label="Loading…" />
        ) : archived.status === "error" ? (
          <KitBanner tone="danger">{archived.error}</KitBanner>
        ) : archived.data.length === 0 ? (
          <KitEmpty title="No archived roles." />
        ) : (
          <KitSettingsGroup data-testid="roles-window-archived-list">
            {archived.data.map((entry) => {
              const label = roleDisplayName(entry.name);
              const description = entry.description;
              const s = state[entry.name];
              return (
                <KitSettingsRow
                  key={entry.name}
                  leading={
                    <KitAvatar fallback={label.charAt(0).toUpperCase()} color={roleAvatarColor(ROLE_FALLBACK_HUE)} dim />
                  }
                  label={<span className="text-[var(--k-t2)]">{label}</span>}
                  description={s === "restored" ? "On its way back — it shows in Roles in a moment." : description || undefined}
                  truncate
                  control={
                    s === "restored" ? null : (
                      <KitButton
                        size="sm"
                        busy={s === "restoring"}
                        disabled={s === "restoring"}
                        onClick={() => restore(entry)}
                        data-testid={`roles-window-unarchive-${entry.name}`}
                      >
                        Un-archive
                      </KitButton>
                    )
                  }
                  data-testid={`roles-window-archived-${entry.name}`}
                />
              );
            })}
          </KitSettingsGroup>
        )}
      </ModalBody>
    </>
  );
}
