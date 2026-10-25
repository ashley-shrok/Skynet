// The roles window's library: every role on the picked host, shared roles
// first, a search box, and a row into archived roles. Rows open the role;
// every action lives inside the role's own view.

import { useState } from "react";
import { Plus } from "lucide-react";
import { ModalBody, ModalHead } from "@/components/modal";
import {
  KitAvatar,
  KitBanner,
  KitButton,
  KitEmpty,
  KitLoading,
  KitSearch,
  KitSelect,
  KitSettingsGroup,
  KitSettingsRow,
} from "@/components/kit";
import type { Host } from "@/types/ui-types";
import { roleAvatarUrl, type RoleSummary } from "@/api/identities-api";
import type { InstanceWideList } from "@/api/instance-wide-api";
import { roleDisplayName } from "@/lib/role-display-name";
import { RowGestures } from "@/features/pretty-conversations/RowKebabMenu";
import type { TabState } from "../IdentityFileTab";
import { roleAvatarColor, roleHue } from "./RolesWindow";

function withBust(url: string, bust: number | undefined): string {
  return bust ? `${url}${url.includes("?") ? "&" : "?"}v=${bust}` : url;
}

export function agentCountLabel(n: number): string {
  return `${n} agent${n === 1 ? "" : "s"}`;
}

export function RolesLibraryView({
  flatHosts,
  hostId,
  onHostChange,
  roles,
  instanceWide,
  archivedCount,
  agentsFor,
  avatarBusts,
  onOpenRole,
  onArchiveRole,
  onNewRole,
  onOpenArchived,
}: {
  flatHosts: Host[];
  hostId: number | null;
  onHostChange: (id: number | null) => void;
  roles: TabState<RoleSummary[]>;
  instanceWide: InstanceWideList | null;
  archivedCount: number;
  agentsFor: (role: RoleSummary) => number;
  /** Per role: when its picture last changed here (fresh image URL). */
  avatarBusts?: Record<string, number>;
  onOpenRole: (role: RoleSummary) => void;
  /** Swipe left on a role row (touch) — archive it, behind the usual confirm.
   *  Shared roles never get it (they must stop being shared first). */
  onArchiveRole?: (role: RoleSummary) => Promise<unknown>;
  onNewRole: () => void;
  onOpenArchived: () => void;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const hostName = flatHosts.find((h) => Number(h.id) === hostId)?.name ?? "this host";

  const newRoleButton = (
    <KitButton
      variant="primary"
      size="sm"
      onClick={onNewRole}
      aria-label="New role"
      title="New role"
      data-testid="roles-window-new-role"
    >
      <Plus /> <span className="max-sm:hidden">New role</span>
    </KitButton>
  );

  const head = (
    <ModalHead
      title="Roles"
      subtitle={<span className="max-sm:hidden">The expertise your agents adopt — each agent holds one or more.</span>}
      closeTestId="roles-window-close"
      actions={
        <>
          {flatHosts.length > 1 && (
            <KitSelect
              aria-label="Host"
              value={hostId ?? ""}
              onChange={(e) => onHostChange(e.target.value ? Number(e.target.value) : null)}
              data-testid="roles-window-host-select"
              className="w-auto max-w-[160px] h-8"
            >
              <option value="">Pick a host…</option>
              {flatHosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </KitSelect>
          )}
          {newRoleButton}
        </>
      }
    />
  );

  if (hostId == null) {
    return (
      <>
        {head}
        <ModalBody className="flex items-center justify-center">
          <KitEmpty title="Pick a host to see its roles." />
        </ModalBody>
      </>
    );
  }
  // Wait for the shared list too, so shared roles never flash as the host's own.
  if (roles.status === "loading" || instanceWide == null) {
    return (
      <>
        {head}
        <ModalBody>
          <KitLoading label="Loading roles…" />
        </ModalBody>
      </>
    );
  }
  if (roles.status === "error") {
    return (
      <>
        {head}
        <ModalBody>
          <KitBanner tone="danger">Couldn&apos;t load roles: {roles.error}</KitBanner>
        </ModalBody>
      </>
    );
  }

  const q = query.trim().toLowerCase();
  const matches = (r: RoleSummary): boolean =>
    q === "" ||
    roleDisplayName(r.name, r.displayName).toLowerCase().includes(q) ||
    r.name.includes(q) ||
    (r.description ?? "").toLowerCase().includes(q);
  const shared = roles.data.filter((r) => r.instanceWide && matches(r));
  const own = roles.data.filter((r) => !r.instanceWide && matches(r));

  const row = (r: RoleSummary): JSX.Element => {
    const label = roleDisplayName(r.name, r.displayName);
    const n = agentsFor(r);
    // Same "shared" test as the role view, whose Archive is off for those.
    const isShared = !!r.instanceWide || !!instanceWide?.items.some((i) => i.name === r.name);
    const swipe = onArchiveRole && !isShared ? { label: "Archive", onSwipe: () => onArchiveRole(r) } : undefined;
    return (
      <RowGestures key={r.name} swipe={swipe}>
        {(g) => (
      <KitSettingsRow
        holdProps={g.holdProps}
        leading={
          <KitAvatar
            src={r.avatar ? withBust(roleAvatarUrl(hostId, r.name), avatarBusts?.[r.name]) : null}
            fallback={label.charAt(0).toUpperCase()}
            color={roleAvatarColor(roleHue(r))}
          />
        }
        label={<span className="font-semibold">{label}</span>}
        description={r.description || undefined}
        truncate
        value={n > 0 ? agentCountLabel(n) : undefined}
        onClick={() => onOpenRole(r)}
        data-testid={`roles-window-row-${r.name}`}
      >
        {g.swipeAction}
      </KitSettingsRow>
        )}
      </RowGestures>
    );
  };

  return (
    <>
      {head}
      {roles.data.length === 0 ? (
        <ModalBody className="flex items-center justify-center">
          <KitEmpty
            title={`No roles on ${hostName} yet.`}
            body="A role is the expertise an agent adopts — what it knows and how it works. Make one with New role."
            action={
              <>
                {newRoleButton}
                {archivedCount > 0 ? (
                  <KitButton size="sm" variant="plain" onClick={onOpenArchived} data-testid="roles-window-archived-row">
                    Archived roles ({archivedCount})
                  </KitButton>
                ) : null}
              </>
            }
          />
        </ModalBody>
      ) : (
        <>
          <div className="px-6 max-sm:px-5 pb-3 flex-shrink-0">
            <KitSearch
              value={query}
              onValueChange={setQuery}
              placeholder="Search roles"
              aria-label="Search roles"
              data-testid="roles-window-search"
            />
          </div>
          <ModalBody className="pt-1" data-testid="roles-window-library">
            {shared.length > 0 && (
              <KitSettingsGroup
                title="On every host"
                note="One copy, kept in step on every host."
                data-testid="roles-window-section-shared"
              >
                {shared.map(row)}
              </KitSettingsGroup>
            )}
            {own.length > 0 && (
              <KitSettingsGroup title={`On ${hostName}`} data-testid="roles-window-section-host">
                {own.map(row)}
              </KitSettingsGroup>
            )}
            {shared.length === 0 && own.length === 0 ? <KitEmpty title="No roles match." /> : null}
            {q === "" && archivedCount > 0 && (
              <KitSettingsGroup data-testid="roles-window-section-archived">
                <KitSettingsRow
                  label={<span className="font-semibold text-[var(--k-t2)]">Archived roles</span>}
                  value={archivedCount}
                  onClick={onOpenArchived}
                  data-testid="roles-window-archived-row"
                />
              </KitSettingsGroup>
            )}
          </ModalBody>
        </>
      )}
    </>
  );
}
