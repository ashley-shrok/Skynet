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
 * D-05 (LOCKED): each row is rendered in `.pv-row` conversation-row treatment
 * — hue-tinted linear-gradient background keyed on the role's `colorHue`
 * (fallback hue 190 per D-05 edge-case), hue-tinted border, layered
 * hue-glow box-shadow, backdrop-filter blur, `border-radius:
 * var(--radius-pv-bubble)` (14px), 8px vertical gap between rows. Row
 * content: 40px round `.pv-avatar`-style disc with the role's avatar image,
 * display name (falls back to title-cased slug), right-side chevron.
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

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ChevronDown, Archive as ArchivedBoxIcon } from "lucide-react";
import { Modal, ModalHead, ModalBody } from "@/components/modal";
import { cn } from "@/lib/utils";
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
import { RowKebabMenu } from "@/features/pretty-conversations/RowKebabMenu";
import { listArchivedRoles, type ArchivedRoleListEntry } from "@/api/roles-archive-list-api";
import { unarchiveRole } from "@/api/role-unarchive-api";
import { UnarchiveError } from "@/api/identity-unarchive-api";

// Chrome/Linux desktop <option> popup — same OPTION_STYLE that
// GlobalFilesModal.tsx L33 pins for popup contrast.
const OPTION_STYLE = { backgroundColor: "#1a1a1a", color: "#e8e4d8" } as const;

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
  const hue = FALLBACK_HUE;
  // Title-case the slug as a display label (no displayName in the minimal schema).
  const label = roleDisplayName(entry.name, undefined);
  return (
    <div
      style={{
        borderRadius: 14,
        background: `linear-gradient(160deg, hsla(${hue}, 30%, 28%, 0.45), hsla(${hue}, 25%, 16%, 0.50))`,
        border: `1px solid hsla(${hue}, 40%, 40%, 0.25)`,
        boxShadow: [
          "0 8px 24px rgba(0, 0, 0, 0.5)",
          "inset 0 1px 0 rgba(255, 220, 170, 0.10)",
          `0 0 0 0.5px hsla(${hue}, 50%, 45%, 0.15)`,
          `0 0 32px hsla(${hue}, 50%, 42%, 0.12)`,
        ].join(", "),
        backdropFilter: "blur(20px) saturate(1.5)",
        WebkitBackdropFilter: "blur(20px) saturate(1.5)",
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        color: "hsla(0, 0%, 90%, 0.65)",
        opacity: 0.85,
      }}
    >
      {/* 40px round avatar disc — fallback placeholder letter */}
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `linear-gradient(160deg, hsla(${hue}, 25%, 18%, 0.72), hsla(${hue}, 20%, 10%, 0.82))`,
          border: `1px solid hsla(${hue}, 40%, 40%, 0.30)`,
          boxShadow: [
            "0 4px 12px rgba(0, 0, 0, 0.6)",
            "inset 0 2px 0 rgba(255, 235, 190, 0.15)",
            `0 0 24px hsla(${hue}, 45%, 40%, 0.25)`,
          ].join(", "),
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: "hsla(0, 0%, 88%, 0.60)",
          }}
        >
          {label.charAt(0).toUpperCase()}
        </span>
      </div>

      {/* Display name */}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        {label}
      </span>

      {/* Kebab — single "Un-archive" item; no ChevronRight (not drill-in) */}
      <RowKebabMenu
        items={[{ label: "Un-archive", onClick: () => onUnarchive(entry) }]}
        ariaLabel={`Row menu for ${entry.name}`}
        testId={`roles-list-archived-row-kebab-${entry.name}`}
      />
    </div>
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

  // Phase 133 Plan 133-05 (D-01, D-03, D-04): the archive click handler.
  // - D-04 cascade preview computed frontend-side from useIdentities().
  // - D-03 double confirm — cancel at either stops with zero API calls.
  // - D-01 fire-and-forget: cascade complexity lives in the supervisor; the
  //   UI does not await. .catch() logs a structured warn matching the
  //   identity-archive path at IdentitySessionPane.tsx:232-239.
  // Rationale: modal stays OPEN after archive (browse-and-act semantics — the
  // operator may want to archive multiple roles in sequence). Deliberate
  // divergence from identity-archive which closes the pane.
  const handleArchiveClick = (
    roleName: string,
    roleDisplayLabel: string,
  ): void => {
    if (selectedHostId == null) return;
    const hostId = selectedHostId;
    // D-04: filter useIdentities() by role + host. Uses `task || displayName`
    // fallback — same expression as AppShell.tsx:894 (do not special-case
    // "Untitled conversation").
    const affected = identities.filter(
      (i) => i.role === roleName && i.hostId === hostId,
    );
    // D-03 first confirm: blast-radius disclosure. Complete list, no truncation.
    const dialog1 =
      affected.length === 0
        ? `archive role ${roleDisplayLabel}? no agents hold it.`
        : `archive role ${roleDisplayLabel}? this will also archive ${affected.length} ${affected.length === 1 ? "agent" : "agents"} holding it:\n` +
          affected.map((i) => `• ${i.task || i.displayName}`).join("\n");
    if (!window.confirm(dialog1)) return;
    // D-03 second confirm: sanity tap. Byte-identical to identity-archive's
    // sanity-tap copy at IdentitySessionPane.tsx:227.
    if (!window.confirm("are you sure? this can't be undone.")) return;
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
      window.alert(
        `Failed to archive role "${roleDisplayLabel}": ${errMessage}\n\nThe role may still be present. Close and reopen the roles list to see current state.`,
      );
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
  }, [selectedHostId]);

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
        window.alert(
          `Un-archiving role ${entry.name} — it may take a moment to reflect elsewhere in the app.`,
        );
        // D-19: section stays expanded after un-archive — do NOT setArchivedExpanded(false).
      })
      .catch((err: unknown) => {
        // On failure: row stays (never touched state). Fire D-17 alert.
        if (err instanceof UnarchiveError && err.reason === "name_collision") {
          window.alert(
            `Couldn't un-archive role ${entry.name} — a live role with that name already exists.`,
          );
        } else {
          window.alert(
            `Couldn't un-archive role ${entry.name} — try again in a moment.`,
          );
        }
      });
  };

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
        subtitle="Roles are the expertise your agents adopt. Every agent using this role inherits its goals, rules, and knowledge."
        actions={
          <button
            type="button"
            onClick={onNewRole}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm cursor-pointer",
              "bg-[hsla(var(--pv-id-hue),65%,55%,0.30)]",
              "hover:bg-[hsla(var(--pv-id-hue),65%,55%,0.42)]",
              "border border-[hsla(var(--pv-id-hue),75%,70%,0.45)]",
              "text-[#fbf5e8]",
            )}
          >
            + New role
          </button>
        }
      />

      {/* Host picker — hidden when flatHosts.length === 1 (Phase 84 D-02). */}
      {!hidePicker && (
        <div
          className={cn(
            "px-5 py-2.5 flex-shrink-0",
            "border-b border-[hsla(var(--pv-id-hue),60%,55%,0.18)]",
            "bg-black/25",
          )}
        >
          <select
            aria-label="Host"
            value={selectedHostId ?? ""}
            onChange={(e) =>
              setSelectedHostId(e.target.value ? Number(e.target.value) : null)
            }
            className={cn(
              "w-full px-3 py-1.5 rounded-md text-sm cursor-pointer outline-none",
              "bg-black/20 border border-[hsla(var(--pv-id-hue),65%,55%,0.22)]",
              "text-[#fbf5e8]",
              "focus:border-[hsla(var(--pv-id-hue),70%,60%,0.5)]",
            )}
          >
            <option value="" style={OPTION_STYLE}>
              Pick a host…
            </option>
            {flatHosts.map((h) => (
              <option key={h.id} value={h.id} style={OPTION_STYLE}>
                {h.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Body — layered branches: no-host / loading / error / empty / list. */}
      <ModalBody className="p-0 overflow-y-auto flex flex-col">
      {selectedHostId == null ? (
            <div className="flex-1 flex items-center justify-center text-[hsla(var(--pv-id-hue),22%,88%,0.65)] text-sm">
              Pick a host to see its roles.
            </div>
          ) : rolesState.status === "loading" ? (
            <div className="flex-1 flex items-center justify-center text-[hsla(var(--pv-id-hue),22%,88%,0.65)] text-sm">
              Loading…
            </div>
          ) : rolesState.status === "error" ? (
            <div className="flex-1 flex items-center justify-center text-red-400 text-sm px-6 text-center">
              {rolesState.error}
            </div>
          ) : rolesState.data.length === 0 ? (
            // D-05 empty state — surface the '+ New role' affordance
            // prominently. The header button is always available; a
            // secondary in-body button gives the empty-state its own
            // affordance so the user isn't hunting.
            <div className="flex-1 flex flex-col items-center justify-center text-[hsla(var(--pv-id-hue),22%,88%,0.65)] gap-3 text-sm text-center px-6">
              <div>No roles yet.</div>
              <button
                type="button"
                onClick={onNewRole}
                className="px-3 py-1.5 rounded-md bg-[hsla(var(--pv-id-hue),65%,55%,0.30)] hover:bg-[hsla(var(--pv-id-hue),65%,55%,0.42)] border border-[hsla(var(--pv-id-hue),75%,70%,0.45)] text-[#fbf5e8] text-sm cursor-pointer"
              >
                + New role
              </button>
            </div>
          ) : (
            // D-05: alphabetical list of `.pv-row`-treatment rows.
            // D-12/D-13/D-14: each row carries an always-visible kebab menu with Archive.
            // D-15: right-click Archive retired on this surface (phase-143).
            <div
              className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              {rolesState.data.map((role) => {
                const hue = hueFor(role);
                const label = displayNameFor(role);
                // D-14: row handlers — row click opens RoleModal; kebab click
                // stops propagation (handled inside RowKebabMenu per D-14).
                const handleRowSelect = (): void => {
                  onSelectRole({
                    roleName: role.name,
                    roleCosmetics: role,
                    hostId: selectedHostId,
                  });
                };
                const handleRowKeyDown = (e: React.KeyboardEvent): void => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleRowSelect();
                  }
                };
                return (
                  // D-12/D-13/D-14: row is a <div role="button"> so the kebab
                  // <button> can live as a sibling inside it without violating
                  // the HTML rule against nested <button> elements.
                  // D-15: right-click Archive handler removed — retired on this surface.
                  <div
                    key={role.name}
                    role="button"
                    tabIndex={0}
                    aria-label={label}
                    onClick={handleRowSelect}
                    onKeyDown={handleRowKeyDown}
                    // D-05 verbatim: `.pv-row` treatment inline (class-based
                    // hue is not viable, so we inline the hsla stops keyed
                    // on the role's hue). Values mirror
                    // pretty-conversations.css L482-517.
                    style={{
                      borderRadius: 14,
                      background: `linear-gradient(160deg, hsla(${hue}, 50%, 38%, 0.55), hsla(${hue}, 45%, 24%, 0.60))`,
                      border: `1px solid hsla(${hue}, 65%, 55%, 0.32)`,
                      boxShadow: [
                        "0 8px 24px rgba(0, 0, 0, 0.5)",
                        "inset 0 1px 0 rgba(255, 220, 170, 0.18)",
                        `0 0 0 0.5px hsla(${hue}, 70%, 55%, 0.20)`,
                        `0 0 32px hsla(${hue}, 70%, 52%, 0.18)`,
                      ].join(", "),
                      backdropFilter: "blur(20px) saturate(1.5)",
                      WebkitBackdropFilter: "blur(20px) saturate(1.5)",
                      padding: "10px 12px",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      cursor: "pointer",
                      color: "#fbf5e8",
                      textAlign: "left",
                    }}
                  >
                    {/* 40px round `.pv-avatar`-style disc — hue gradient
                        background with the role's avatar image inside. */}
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 999,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: `linear-gradient(160deg, hsla(${hue}, 45%, 25%, 0.72), hsla(${hue}, 40%, 15%, 0.82))`,
                        border: `1px solid hsla(${hue}, 65%, 55%, 0.40)`,
                        boxShadow: [
                          "0 4px 12px rgba(0, 0, 0, 0.6)",
                          "inset 0 2px 0 rgba(255, 235, 190, 0.35)",
                          `0 0 24px hsla(${hue}, 65%, 55%, 0.40)`,
                        ].join(", "),
                        overflow: "hidden",
                        flexShrink: 0,
                      }}
                    >
                      {role.avatar ? (
                        <img
                          src={roleAvatarUrl(selectedHostId, role.name)}
                          alt=""
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            borderRadius: 999,
                          }}
                        />
                      ) : (
                        // Fallback: neutral placeholder — a single letter of
                        // the display name (D-05 "neutral placeholder avatar").
                        <span
                          style={{
                            fontSize: 15,
                            fontWeight: 700,
                            color: "#fbf5e8",
                          }}
                        >
                          {label.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>

                    {/* Display name */}
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontWeight: 600,
                        fontSize: 14,
                      }}
                    >
                      {label}
                    </span>

                    {/* D-12/D-13: always-visible kebab with single Archive item.
                        Placed BEFORE ChevronRight so the kebab is the rightmost
                        interactive element (ChevronRight removed — the whole row
                        is the click target). ariaLabel uses slug (role.name) not
                        display label to avoid aria-label collisions with the row
                        itself (both carry the display name). */}
                    <RowKebabMenu
                      items={[{ label: "Archive", danger: true, onClick: () => handleArchiveClick(role.name, label) }]}
                      ariaLabel={`Row menu for ${role.name}`}
                      testId={`roles-list-row-kebab-${role.name}`}
                    />

                    {/* Right-side chevron (low opacity — decorative, not
                        actionable — the whole row is the click target). */}
                    <ChevronRight
                      size={18}
                      style={{ opacity: 0.55, flexShrink: 0 }}
                    />
                  </div>
                );
              })}
            </div>
          )}
      </ModalBody>

      {/* phase-143 D-10 / D-18 / D-19 — archived-roles collapsed section */}
      <div className="border-t border-[hsla(var(--pv-id-hue),40%,45%,0.15)] flex-shrink-0">
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
          className="flex items-center gap-2.5 px-6 py-2.5 w-full text-left cursor-pointer"
          data-testid="roles-list-archived-section-header"
          aria-expanded={archivedExpanded}
          aria-controls="roles-list-archived-content"
        >
          <ArchivedBoxIcon className="size-3.5 text-[hsla(var(--pv-id-hue),22%,88%,0.6)] shrink-0" aria-hidden="true" />
          <span className="text-[13px] font-semibold text-[hsla(var(--pv-id-hue),22%,88%,0.6)] shrink-0">Archived roles</span>
          <span aria-hidden="true" className="flex-1 h-px bg-[linear-gradient(90deg,transparent_0%,rgba(168,154,128,0.20)_30%,rgba(168,154,128,0.20)_70%,transparent_100%)]" />
          <ChevronDown
            className={`size-3.5 text-[hsla(var(--pv-id-hue),22%,88%,0.6)] shrink-0 transition-transform ${archivedExpanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </div>

        {/* Section body — only rendered when expanded */}
        {archivedExpanded && (
          <div
            id="roles-list-archived-content"
            className="max-h-[40vh] overflow-y-auto px-6 pb-4"
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
          >
            {archivedRolesState.status === "loading" && (
              <div className="flex items-center justify-center text-[hsla(var(--pv-id-hue),22%,88%,0.55)] text-sm py-4">
                Loading…
              </div>
            )}
            {archivedRolesState.status === "error" && (
              <div className="flex items-center justify-center text-red-400 text-sm py-4 text-center">
                {archivedRolesState.error}
              </div>
            )}
            {archivedRolesState.status === "ready" && archivedRolesState.data.length === 0 && (
              <div className="flex items-center justify-center text-[hsla(var(--pv-id-hue),22%,88%,0.50)] text-sm py-4">
                {"No archived roles."}
              </div>
            )}
            {archivedRolesState.status === "ready" && archivedRolesState.data.length > 0 &&
              archivedRolesState.data.map((entry) => (
                <ArchivedRoleRow
                  key={entry.name}
                  entry={entry}
                  onUnarchive={handleUnarchiveRole}
                />
              ))
            }
          </div>
        )}
      </div>

      {/* phase-143 D-15 — right-click Archive retired in favor of kebab-on-row; see .planning/campaigns/un-archiving/shape-unarchive-frontend-backend.md */}
    </Modal>
  );
}

export default RolesListModal;
