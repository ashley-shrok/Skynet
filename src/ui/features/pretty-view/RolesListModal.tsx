/**
 * RolesListModal — Phase 90 Plan 90-05.
 *
 * Phase 143 Plan 143-07: adds archived-roles section (D-10) + retires right-click Archive (D-15) + kebab-on-live-rows (D-12/D-13/D-14). See .planning/campaigns/un-archiving/shape-unarchive-frontend-backend.md
 *
 * D-02 (LOCKED): the roles-list modal mirrors the Edit-global-files host-picker
 * pattern (`GlobalFilesModal.tsx`) — takes `hostTree: HostFolder | null` +
 * `defaultHostId: number | null`, auto-selects a single host, otherwise
 * surfaces a `<select>` picker at the top of the modal header. Roles list is
 * scope-per-selected-host (no cross-fleet aggregation).
 *
 * D-03 (LOCKED): global modal — portals to `document.body` (no portal-target
 * prop threaded through). Same viewport-level modal as GlobalFilesModal +
 * SkillsEditorModal.
 *
 * D-05 (revised apple-ux look A): each row is the kit's KitListRow — the
 * role's avatar (or its initial) on a disc tinted by the role's `colorHue`
 * (fallback hue 190), the display name (falls back to title-cased slug), and
 * the kebab menu. The colour tints only the avatar, never the row.
 * Alphabetical sort by displayName.
 *
 * D-10 (revised 2026-09-11): '+ New role' button lives in the modal header
 * (right side, near the close X). Click emits `onNewRole()` — parent
 * (PrettyConversationsPanel) closes this modal and opens CreateRoleDialog as
 * a swap-not-stack sibling. Mirrors the row-click → RoleModal swap pattern.
 * Restores the CreateRoleDialog → NewSessionDialog chain (via the parent's
 * `onChainToCreateIdentity` → `chainPrefill` wiring) that was dropped when
 * Plan 90-06 first mounted CreateRoleDialog internally. Stacking two Radix
 * Dialog portals was also the cause of the "click freezes app" bug.
 *
 * Row click emits `onSelectRole({roleName, roleCosmetics, hostId})` — the
 * parent (Plan 90-06's PrettyConversationsPanel wiring) handles the
 * swap-not-stack transition to `<RoleModal>` on that role.
 */

import { identityRoles } from "@/lib/identity-roles";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Archive as ArchivedBoxIcon, Plus } from "lucide-react";
import { Modal, ModalHead, ModalBody } from "@/components/modal";
import {
  KitBanner,
  KitButton,
  KitEmpty,
  KitList,
  KitListHead,
  KitListRow,
  KitLoading,
  KitSelect,
  kitAlert,
  kitConfirm,
} from "@/components/kit";
import type { Host, HostFolder } from "@/types/ui-types";
import {
  listRolesForHost,
  roleAvatarUrl,
  type RoleSummary,
} from "@/api/identities-api";
import type { TabState } from "./IdentityFileTab";
import { roleDisplayName } from "@/lib/role-display-name";
import { useIdentities } from "@/state/identities-store";
import { archiveRole } from "@/api/role-archive-api";
import {
  RowKebabMenu,
  RowKebabContextMenuSurface,
  useRowKebabContextMenu,
  type RowKebabMenuItem,
} from "@/features/pretty-conversations/RowKebabMenu";
import { listArchivedRoles, type ArchivedRoleListEntry } from "@/api/roles-archive-list-api";
import { unarchiveRole } from "@/api/role-unarchive-api";
import { UnarchiveError } from "@/api/identity-unarchive-api";
import {
  listInstanceWide,
  previewPromote,
  promote,
  promoteConfirmText,
  removeInstanceWide,
  type InstanceWideList,
} from "@/api/instance-wide-api";
import { InstanceWideChip, InstanceWideSyncStatus } from "./InstanceWideStatus";

// D-05 fallback hue: 190 is the app-wide accent — used when a role's
// frontmatter lacks `colorHue` (edge case only per Phase 86 invariant).
const FALLBACK_HUE = 190;

// NOTE: duplicated from GlobalFilesModal.tsx L38-48 + SkillsEditorModal +
// NewSessionDialog + CreateRoleDialog. Fourth duplication instance intentional
// — extract when a fifth caller emerges (matches GEFM-01 precedent).
function isFolder(item: Host | HostFolder): item is HostFolder {
  return "children" in item;
}
function collectAllHosts(children: (Host | HostFolder)[]): Host[] {
  const out: Host[] = [];
  for (const child of children) {
    if (isFolder(child)) out.push(...collectAllHosts(child.children));
    else out.push(child);
  }
  return out;
}

// D-05: displayName fallback. When the role's frontmatter lacks
// `displayName`, we title-case the kebab-slug (e.g. `box-maintainer` →
// `Box Maintainer`).
function displayNameFor(role: RoleSummary): string {
  return roleDisplayName(role.name, role.displayName);
}

// D-05: hue selector — role's `colorHue` when present, else fallback 190.
function hueFor(role: RoleSummary): number {
  return typeof role.colorHue === "number" ? role.colorHue : FALLBACK_HUE;
}

// Look A: the role's colour tints only its avatar disc, never the row.
export function roleAvatarColor(hue: number): string {
  return `hsl(${hue}, 42%, 34%)`;
}

// ─── ArchivedRoleRow ──────────────────────────────────────────────────────────
// Phase 143 Plan 143-07 (D-10 / D-12 / D-13) — sub-component for each
// archived-role row in the collapsed section. Uses FALLBACK_HUE=190 since the
// archived-list minimal schema (ArchivedRoleListEntry) carries name only.
// The row is NOT clickable per D-11 sibling pattern; the kebab is the ONLY
// interaction path.

interface ArchivedRoleRowProps {
  entry: ArchivedRoleListEntry;
  onUnarchive: (entry: ArchivedRoleListEntry) => void;
}

function ArchivedRoleRow({ entry, onUnarchive }: ArchivedRoleRowProps): JSX.Element {
  // Title-case the slug as a display label (no displayName in the minimal schema).
  const label = roleDisplayName(entry.name, undefined);
  const kebabItems: RowKebabMenuItem[] = [
    { label: "Un-archive", onClick: () => onUnarchive(entry) },
  ];
  // Right-click the row → same kebab menu at the cursor.
  const kebabContextMenu = useRowKebabContextMenu(kebabItems);
  return (
    <>
      <KitListRow
        onContextMenu={kebabContextMenu.onContextMenu}
        dim
        avatar={label.charAt(0).toUpperCase()}
        avatarColor={roleAvatarColor(FALLBACK_HUE)}
        title={label}
        // Kebab — single "Un-archive" item; the row itself is not clickable.
        menu={
          <RowKebabMenu
            items={kebabItems}
            ariaLabel={`Row menu for ${entry.name}`}
            testId={`roles-list-archived-row-kebab-${entry.name}`}
          />
        }
      />
      {kebabContextMenu.menu}
    </>
  );
}

export interface RolesListModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Host tree from `useHostTree()` upstream — same shape GlobalFilesModal takes. */
  hostTree: HostFolder | null;
  /** Default host selection — the currently-focused session's host, if any. */
  defaultHostId: number | null;
  /**
   * Row-click callback — parent handles the swap-not-stack coordination
   * (close RolesListModal + open <RoleModal> for the picked role).
   * Ships the FULL RoleSummary so the parent can pass it downstream
   * without a second round-trip.
   */
  onSelectRole: (params: {
    roleName: string;
    roleCosmetics: RoleSummary;
    hostId: number;
  }) => void;
  /**
   * Fired when the user clicks either '+ New role' button (header or
   * empty-state). Parent is expected to close this modal and open
   * CreateRoleDialog as a sibling swap target (D-10 revised 2026-09-11).
   */
  onNewRole: () => void;
}

export function RolesListModal({
  open,
  onOpenChange,
  hostTree,
  defaultHostId,
  onSelectRole,
  onNewRole,
}: RolesListModalProps): JSX.Element {
  const [selectedHostId, setSelectedHostId] = useState<number | null>(null);
  const [rolesState, setRolesState] = useState<TabState<RoleSummary[]>>({
    status: "loading",
  });

  // Phase 133 Plan 133-05 (D-04): cascade-preview identities live here.
  // useIdentities() returns the fleet-wide identity snapshot; the row-level
  // Archive click filters this down to `role === roleName && hostId === selectedHostId`.
  const { identities } = useIdentities();

  // Phase 143 Plan 143-07 (D-10) — archived-roles collapsed section state.
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [archivedRolesState, setArchivedRolesState] = useState<TabState<ArchivedRoleListEntry[]>>({
    status: "loading",
  });
  const [archivedHasFetched, setArchivedHasFetched] = useState(false);

  // Instance-wide roles (master copy in the app, on every host) are listed in
  // their own section above the host's own roles. reloadKey re-fetches the
  // host's roles after a promote/remove.
  const [instanceWide, setInstanceWide] = useState<InstanceWideList | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const isAdmin = instanceWide?.isAdmin ?? false;
  useEffect(() => {
    if (!open) {
      setInstanceWide(null);
      return;
    }
    let cancelled = false;
    listInstanceWide("role")
      .then((list) => {
        if (!cancelled) setInstanceWide(list);
      })
      .catch(() => {
        if (!cancelled) setInstanceWide({ isAdmin: false, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [open, reloadKey]);

  const handlePromoteRole = async (roleName: string): Promise<void> => {
    if (selectedHostId == null) return;
    try {
      const preview = await previewPromote("role", roleName, selectedHostId);
      if (preview.tooLarge) {
        void kitAlert({
          title: `"${roleName}" is too big to make instance-wide`,
          body: `It has ${preview.files} files. Clean up its folder first.`,
        });
        return;
      }
      if (
        !(await kitConfirm({
          title: `Make "${roleName}" instance-wide?`,
          // The text opens with the same question — the title carries it.
          body: promoteConfirmText("role", roleName, preview).replace(/^[^\n]*\n\n?/, ""),
          confirmLabel: "Make instance-wide",
        }))
      )
        return;
      await promote("role", roleName, selectedHostId);
      setReloadKey((k) => k + 1);
    } catch (err) {
      void kitAlert({ title: "Couldn't make it instance-wide", body: err instanceof Error ? err.message : undefined });
    }
  };

  const handleRemoveInstanceRole = async (roleName: string, label: string): Promise<void> => {
    const count = instanceWide?.items.find((i) => i.name === roleName)?.hostCount ?? 0;
    if (
      !(await kitConfirm({
        title: `Remove the instance-wide role ${label}?`,
        body: `Its folder will be deleted from ${count} host${count === 1 ? "" : "s"}, along with anything agents saved in it there. This can't be undone.`,
        confirmLabel: "Remove",
        destructive: true,
      }))
    )
      return;
    try {
      await removeInstanceWide("role", roleName);
      setReloadKey((k) => k + 1);
    } catch (err) {
      void kitAlert({ title: "Couldn't remove it", body: err instanceof Error ? err.message : undefined });
    }
  };

  // Phase 133 Plan 133-05 (D-01, D-03, D-04): the archive click handler.
  // - D-04 cascade preview computed frontend-side from useIdentities().
  // - D-03 double confirm — cancel at either stops with zero API calls.
  // - D-01 fire-and-forget: cascade complexity lives in the supervisor; the
  //   UI does not await. .catch() logs a structured warn matching the
  //   identity-archive path at IdentitySessionPane.tsx:232-239.
  // Rationale: modal stays OPEN after archive (browse-and-act semantics — the
  // operator may want to archive multiple roles in sequence). Deliberate
  // divergence from identity-archive which closes the pane.
  const handleArchiveClick = async (
    roleName: string,
    roleDisplayLabel: string,
  ): Promise<void> => {
    if (selectedHostId == null) return;
    const hostId = selectedHostId;
    // D-04: filter useIdentities() by role + host. Uses `task || displayName`
    // fallback — same expression as AppShell.tsx:894 (do not special-case
    // "Untitled conversation").
    const affected = identities.filter(
      (i) => identityRoles(i).includes(roleName) && i.hostId === hostId,
    );
    // D-03 first confirm: blast-radius disclosure. Complete list, no truncation.
    const blastRadius =
      affected.length === 0
        ? "No agents hold it."
        : `This will also archive ${affected.length} ${affected.length === 1 ? "agent" : "agents"} holding it:\n` +
          affected.map((i) => `• ${i.task || i.displayName}`).join("\n");
    if (
      !(await kitConfirm({
        title: `Archive role ${roleDisplayLabel}?`,
        body: blastRadius,
        confirmLabel: "Archive",
        destructive: true,
      }))
    )
      return;
    // D-03 second confirm: sanity tap (mirrors identity-archive's sanity tap).
    if (
      !(await kitConfirm({
        title: "Are you sure?",
        body: "This can't be undone.",
        confirmLabel: "Archive",
        destructive: true,
      }))
    )
      return;
    // Optimistic removal: drop the row from the local list immediately so the
    // operator sees the archive take effect. If the API call fails, the alert
    // below tells them, and the next modal open / host switch fetches fresh
    // state from disk (which is authoritative) — no need to restore the row
    // by hand.
    setRolesState((prev) =>
      prev.status === "ready"
        ? { status: "ready", data: prev.data.filter((r) => r.name !== roleName) }
        : prev,
    );
    // D-01 fire-and-forget with structured console.warn + user-facing alert on failure.
    void archiveRole(hostId, roleName).catch((err) => {
      const errMessage = err instanceof Error ? err.message : String(err);
      console.warn({
        operation: "role_archive_failed",
        hostId,
        roleName,
        errMessage,
      });
      void kitAlert({
        title: `Couldn't archive role "${roleDisplayLabel}"`,
        body: `${errMessage}\n\nThe role may still be present. Close and reopen the roles list to see current state.`,
      });
    });
  };

  const flatHosts = useMemo(
    () =>
      collectAllHosts(hostTree?.children ?? []).filter((h) => h.enableRdp !== true),
    [hostTree],
  );

  // D-02: single-host primitive — hide the picker when the fleet has exactly
  // one pickable host (matches CreateRoleDialog L762 pattern).
  const hidePicker = flatHosts.length === 1;

  // Auto-select host on open; reset all state on close. Mirrors
  // GlobalFilesModal L79-94.
  useEffect(() => {
    if (!open) {
      setSelectedHostId(null);
      setRolesState({ status: "loading" });
      return;
    }
    // Prefer defaultHostId if it's in the fleet
    if (defaultHostId != null && flatHosts.some((h) => Number(h.id) === defaultHostId)) {
      setSelectedHostId(defaultHostId);
      return;
    }
    // Auto-select sole host (D-02)
    if (flatHosts.length === 1) setSelectedHostId(Number(flatHosts[0].id));
  }, [open, defaultHostId, flatHosts]);

  // Fetch roles list when host changes. Mirrors GlobalFilesModal L97-119
  // cancellable pattern. (D-10 revised 2026-09-11: fetchVersion counter
  // dropped — CreateRoleDialog now opens as a swap sibling, so this modal
  // re-mounts on next open and naturally re-fetches with fresh data.)
  useEffect(() => {
    if (selectedHostId == null) return;
    let cancelled = false;
    setRolesState({ status: "loading" });
    listRolesForHost(selectedHostId)
      .then((entries) => {
        if (cancelled) return;
        // D-05: sort alphabetical by displayName (fallback to title-cased slug).
        const sorted = [...entries].sort((a, b) => {
          const na = displayNameFor(a).toLocaleLowerCase();
          const nb = displayNameFor(b).toLocaleLowerCase();
          return na.localeCompare(nb);
        });
        setRolesState({ status: "ready", data: sorted });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setRolesState({
            status: "error",
            error: err instanceof Error ? err.message : "Failed to load roles",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedHostId, reloadKey]);

  // Phase 143 Plan 143-07 (D-07) — host-scope reset for archived section.
  // When selectedHostId changes, reset archived section state so the next
  // expand lazy-fetches fresh data for the new host. Do NOT auto-fetch on
  // host change — only on user expand.
  useEffect(() => {
    setArchivedHasFetched(false);
    setArchivedRolesState({ status: "loading" });
    setArchivedExpanded(false);
  }, [selectedHostId]);

  // Phase 143 Plan 143-07 (D-10) — expand handler for archived section.
  // Lazy-fetches on first expand only (archivedHasFetched gate prevents
  // re-fetch on subsequent expand/collapse cycles per D-03 DoS mitigation).
  const handleExpandArchived = (): void => {
    if (!archivedHasFetched && selectedHostId != null) {
      setArchivedHasFetched(true);
      void listArchivedRoles(selectedHostId)
        .then((entries) => setArchivedRolesState({ status: "ready", data: entries }))
        .catch((err: unknown) =>
          setArchivedRolesState({
            status: "error",
            error: err instanceof Error ? err.message : "unknown",
          }),
        );
    }
    setArchivedExpanded((v) => !v);
  };

  // Phase 143 Plan 143-07 (D-16 / D-17) — un-archive handler.
  // CRITICAL SEQUENCE per CONTEXT.md Risk Summary: row must NOT be removed
  // until the endpoint returns 200. Call unarchiveRole FIRST; only on resolve
  // do we remove the row and fire the success alert. On reject, the row stays
  // (never removed) and we fire a failure alert. No restore branch needed.
  const handleUnarchiveRole = (entry: ArchivedRoleListEntry): void => {
    if (selectedHostId == null) return;
    void unarchiveRole(selectedHostId, entry.name)
      .then(() => {
        // On 200: remove row THEN fire success alert (D-16).
        setArchivedRolesState((prev) =>
          prev.status === "ready"
            ? { status: "ready", data: prev.data.filter((e) => e.name !== entry.name) }
            : prev,
        );
        void kitAlert({
          title: `Un-archiving role ${entry.name}`,
          body: "It may take a moment to reflect elsewhere in the app.",
        });
        // D-19: section stays expanded after un-archive — do NOT setArchivedExpanded(false).
      })
      .catch((err: unknown) => {
        // On failure: row stays (never touched state). Fire D-17 alert.
        if (err instanceof UnarchiveError && err.reason === "name_collision") {
          void kitAlert({
            title: `Couldn't un-archive role ${entry.name}`,
            body: "A live role with that name already exists.",
          });
        } else {
          void kitAlert({
            title: `Couldn't un-archive role ${entry.name}`,
            body: "Try again in a moment.",
          });
        }
      });
  };

  const newRoleButton = () => (
    <KitButton variant="primary" size="sm" onClick={onNewRole} aria-label="+ New role">
      <Plus /> New role
    </KitButton>
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="list"
    >
      {/* Header — title + '+ New role' action + close X. Host picker (when
          multi-host) renders as a separate row BELOW the header per the
          modal-look-unification pattern. */}
      <ModalHead
        title="Roles"
        subtitle="Roles are the expertise your agents adopt. Every agent using a role inherits its goals, rules, and knowledge."
        actions={newRoleButton()}
      />

      {/* Host picker — hidden when flatHosts.length === 1 (Phase 84 D-02). */}
      {!hidePicker && (
        <div className="px-6 max-sm:px-5 pb-3 flex-shrink-0">
          <KitSelect
            aria-label="Host"
            value={selectedHostId ?? ""}
            onChange={(e) =>
              setSelectedHostId(e.target.value ? Number(e.target.value) : null)
            }
            className="w-full"
          >
            <option value="">Pick a host…</option>
            {flatHosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </KitSelect>
        </div>
      )}

      {/* Body — layered branches: no-host / loading / error / empty / list. */}
      <ModalBody className="flex flex-col">
      {selectedHostId == null ? (
            <KitEmpty className="flex-1 justify-center" title="Pick a host to see its roles." />
          ) : rolesState.status === "loading" ? (
            <KitLoading label="Loading…" />
          ) : rolesState.status === "error" ? (
            <KitBanner tone="danger">{rolesState.error}</KitBanner>
          ) : rolesState.data.length === 0 ? (
            // D-05 empty state — surface the '+ New role' affordance
            // prominently. The header button is always available; a
            // secondary in-body button gives the empty-state its own
            // affordance so the user isn't hunting.
            <KitEmpty
              className="flex-1 justify-center"
              title="No roles yet."
              action={newRoleButton()}
            />
          ) : (
            // D-05: alphabetical list of kit list rows.
            // D-12/D-13/D-14: each row carries a kebab menu with Archive.
            // D-15: right-click Archive retired on this surface (phase-143).
            <KitList>
              {[
                ...rolesState.data.filter((r) => r.instanceWide),
                ...rolesState.data.filter((r) => !r.instanceWide),
              ].map((role, index, ordered) => {
                const hue = hueFor(role);
                const iwItem = role.instanceWide
                  ? instanceWide?.items.find((i) => i.name === role.name) ?? null
                  : null;
                const hasIwSection = ordered.some((r) => r.instanceWide);
                const sectionHeading =
                  hasIwSection && index === 0
                    ? "Instance-wide — every host"
                    : hasIwSection && !role.instanceWide && ordered[index - 1]?.instanceWide
                    ? flatHosts.find((h) => Number(h.id) === selectedHostId)?.name ?? "This host"
                    : null;
                const label = displayNameFor(role);
                // D-14: row click opens RoleModal; clicks on the kebab (or
                // any control inside the row) don't activate the row.
                const handleRowSelect = (): void => {
                  onSelectRole({
                    roleName: role.name,
                    roleCosmetics: role,
                    hostId: selectedHostId,
                  });
                };
                const kebabItems: RowKebabMenuItem[] = role.instanceWide
                  ? isAdmin
                    ? [
                        {
                          label: "Remove from every host…",
                          danger: true,
                          testId: `roles-list-remove-instance-${role.name}`,
                          onClick: () => {
                            void handleRemoveInstanceRole(role.name, label);
                          },
                        },
                      ]
                    : [
                        {
                          label: "Managed instance-wide — only an admin can change it",
                          disabled: true,
                          onClick: () => {},
                        },
                      ]
                  : [
                      ...(isAdmin
                        ? [
                            {
                              label: "Make instance-wide…",
                              hint: "Keep one copy of this role in step on every host",
                              testId: `roles-list-promote-${role.name}`,
                              onClick: () => {
                                void handlePromoteRole(role.name);
                              },
                            },
                          ]
                        : []),
                      {
                        label: "Archive",
                        danger: true,
                        separatorBefore: isAdmin,
                        onClick: () => {
                          void handleArchiveClick(role.name, label);
                        },
                      },
                    ];
                return (
                  <div key={role.name} style={{ display: "contents" }}>
                  {sectionHeading && (
                    <KitListHead data-testid="roles-list-section-heading">
                      {sectionHeading}
                    </KitListHead>
                  )}
                  {/* D-15: right-click opens the SAME kebab menu at the cursor.
                      The kebab's ariaLabel uses the slug (role.name), not the
                      display label, to avoid aria-label collisions with the
                      row itself (which carries the display name). */}
                  <RowKebabContextMenuSurface items={kebabItems}>
                    <KitListRow
                      aria-label={label}
                      onActivate={handleRowSelect}
                      avatarColor={roleAvatarColor(hue)}
                      avatarSrc={role.avatar ? roleAvatarUrl(selectedHostId, role.name) : null}
                      // Fallback: neutral placeholder — a single letter of
                      // the display name (D-05 "neutral placeholder avatar").
                      avatar={label.charAt(0).toUpperCase()}
                      title={label}
                      trailing={
                        role.instanceWide || iwItem ? (
                          <>
                            {role.instanceWide && <InstanceWideChip />}
                            {iwItem && (
                              <span onClick={(e) => e.stopPropagation()}>
                                <InstanceWideSyncStatus item={iwItem} />
                              </span>
                            )}
                          </>
                        ) : undefined
                      }
                      menu={
                        <RowKebabMenu
                          items={kebabItems}
                          ariaLabel={`Row menu for ${role.name}`}
                          testId={`roles-list-row-kebab-${role.name}`}
                        />
                      }
                    />
                  </RowKebabContextMenuSurface>
                  </div>
                );
              })}
            </KitList>
          )}
      </ModalBody>

      {/* phase-143 D-10 / D-18 / D-19 — archived-roles collapsed section */}
      <div className="border-t border-[var(--k-hair)] flex-shrink-0">
        {/* Section header — always visible regardless of archived count (D-18). */}
        <div
          role="button"
          tabIndex={0}
          onClick={handleExpandArchived}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleExpandArchived();
            }
          }}
          className="flex items-center gap-2.5 px-6 max-sm:px-5 py-3 w-full text-left cursor-pointer text-[var(--k-t2)] hover:text-[var(--k-t1)]"
          data-testid="roles-list-archived-section-header"
          aria-expanded={archivedExpanded}
          aria-controls="roles-list-archived-content"
        >
          <ArchivedBoxIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="text-[13px] font-semibold shrink-0">Archived roles</span>
          <span aria-hidden="true" className="flex-1" />
          <ChevronDown
            className={`size-3.5 shrink-0 transition-transform ${archivedExpanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </div>

        {/* Section body — only rendered when expanded */}
        {archivedExpanded && (
          <div
            id="roles-list-archived-content"
            className="max-h-[40vh] overflow-y-auto px-6 max-sm:px-5 pb-4"
          >
            {archivedRolesState.status === "loading" && <KitLoading lines={2} label="Loading…" />}
            {archivedRolesState.status === "error" && (
              <KitBanner tone="danger">{archivedRolesState.error}</KitBanner>
            )}
            {archivedRolesState.status === "ready" && archivedRolesState.data.length === 0 && (
              <KitEmpty title="No archived roles." />
            )}
            {archivedRolesState.status === "ready" && archivedRolesState.data.length > 0 && (
              <KitList>
                {archivedRolesState.data.map((entry) => (
                  <ArchivedRoleRow
                    key={entry.name}
                    entry={entry}
                    onUnarchive={handleUnarchiveRole}
                  />
                ))}
              </KitList>
            )}
          </div>
        )}
      </div>

      {/* phase-143 D-15 — right-click Archive retired in favor of kebab-on-row; see .planning/campaigns/un-archiving/shape-unarchive-frontend-backend.md */}
    </Modal>
  );
}

export default RolesListModal;
