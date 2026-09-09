/**
 * RolesListModal — Phase 90 Plan 90-05.
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
 * D-10 (LOCKED): '+ New role' button lives in the modal header (right side,
 * near the close X). Click opens `CreateRoleDialog` ON TOP of RolesListModal
 * (stack — planner-pick per D-10 discretion). On successful creation
 * (CreateRoleDialog's `onCreated` fires), RolesListModal closes the dialog
 * and re-fetches its roles list.
 *
 * Row click emits `onSelectRole({roleName, roleCosmetics, hostId})` — the
 * parent (Plan 90-06's PrettyConversationsPanel wiring) handles the
 * swap-not-stack transition to `<RoleModal>` on that role.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { DialogHeader, DialogTitle, DialogClose } from "@/components/dialog";
import { cn } from "@/lib/utils";
import type { Host, HostFolder } from "@/types/ui-types";
import {
  listRolesForHost,
  roleAvatarUrl,
  type RoleSummary,
} from "@/api/identities-api";
import { CreateRoleDialog } from "@/sidebar/CreateRoleDialog";
import type { TabState } from "./IdentityFileTab";

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
  if (role.displayName && role.displayName.trim().length > 0) {
    return role.displayName;
  }
  return role.name
    .split("-")
    .filter((s) => s.length > 0)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

// D-05: hue selector — role's `colorHue` when present, else fallback 190.
function hueFor(role: RoleSummary): number {
  return typeof role.colorHue === "number" ? role.colorHue : FALLBACK_HUE;
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
}

export function RolesListModal({
  open,
  onOpenChange,
  hostTree,
  defaultHostId,
  onSelectRole,
}: RolesListModalProps): JSX.Element {
  const [selectedHostId, setSelectedHostId] = useState<number | null>(null);
  const [rolesState, setRolesState] = useState<TabState<RoleSummary[]>>({
    status: "loading",
  });
  // D-10 planner-pick: CreateRoleDialog stacks on top of RolesListModal.
  const [createRoleOpen, setCreateRoleOpen] = useState<boolean>(false);
  // Fetch-version counter — bumped after CreateRoleDialog.onCreated fires so
  // the fetch effect re-runs even when selectedHostId didn't change.
  const [fetchVersion, setFetchVersion] = useState<number>(0);

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
      setCreateRoleOpen(false);
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

  // Fetch roles list when host changes OR when fetchVersion bumps
  // (post-CreateRoleDialog success). Mirrors GlobalFilesModal L97-119
  // cancellable pattern.
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
  }, [selectedHostId, fetchVersion]);

  // D-10 planner-pick: on CreateRoleDialog success, close the dialog and bump
  // fetchVersion so the roles list refreshes (new role appears).
  const handleCreateRoleCreated = useCallback(() => {
    setCreateRoleOpen(false);
    setFetchVersion((v) => v + 1);
  }, []);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      {/* D-03: global modal — no portal-target prop; defaults to document.body. */}
      <DialogPrimitive.Portal>
        {/* Overlay — same z-index ladder as IdentityModal + GlobalFilesModal. */}
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-[110] bg-black/15",
            "supports-backdrop-filter:backdrop-blur-xs duration-100",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          onInteractOutside={(e) => {
            // Patch #111f pattern: prevent modal from closing when clicking
            // outside. X and Esc remain valid close paths.
            e.preventDefault();
          }}
          className={cn(
            "fixed inset-4 z-[120] outline-none",
            "flex flex-col overflow-hidden rounded-[24px]",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 duration-100",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          )}
          style={{
            // Neutral hue 220 gradient — this modal displays MULTIPLE roles
            // at once (per-row hue variation), so the chrome stays hue-agnostic
            // (matches GlobalFilesModal L216-220 shape).
            background:
              "linear-gradient(160deg, hsla(220, 45%, 25%, 0.82), hsla(220, 40%, 15%, 0.88))",
            backdropFilter: "blur(28px) saturate(1.4)",
            WebkitBackdropFilter: "blur(28px) saturate(1.4)",
            border: "1px solid hsla(220, 65%, 55%, 0.32)",
            boxShadow:
              "0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,220,170,0.15), 0 0 80px hsla(220, 65%, 55%, 0.2)",
            color: "#e8e4d8",
          }}
        >
          {/* Header — title + host-picker (multi-host only) + '+ New role' + close X */}
          <DialogHeader
            className="px-6 py-4 shrink-0 flex flex-row items-center gap-2 flex-wrap"
            style={{ borderBottom: "1px solid rgba(220, 225, 245, 0.10)" }}
          >
            <DialogTitle className="text-[15px] font-semibold text-[#f0ebe0]">
              Roles
            </DialogTitle>

            {/* D-02: single-host primitive — hide host picker when
                flatHosts.length === 1 (matches CreateRoleDialog L762). */}
            {!hidePicker && (
              <select
                aria-label="Host"
                value={selectedHostId ?? ""}
                onChange={(e) =>
                  setSelectedHostId(e.target.value ? Number(e.target.value) : null)
                }
                className="ml-2 px-3 py-1.5 rounded-md bg-black/20 border border-white/10 text-[#e8e4d8] text-sm outline-none cursor-pointer"
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
            )}

            <div className="flex-1" />

            {/* D-10: '+ New role' button in header. Stacks CreateRoleDialog
                on top of RolesListModal (planner-pick per D-10 discretion). */}
            <button
              type="button"
              onClick={() => setCreateRoleOpen(true)}
              className="px-3 py-1.5 rounded-md bg-[hsla(220,80%,60%,0.20)] hover:bg-[hsla(220,80%,60%,0.30)] text-[#e8e4d8] text-sm cursor-pointer"
            >
              + New role
            </button>

            {/* Glass X close button — verbatim from GlobalFilesModal L253-276. */}
            <DialogClose asChild>
              <button
                type="button"
                aria-label="Close"
                title="Close"
                className="shrink-0 cursor-pointer size-9 rounded-full flex items-center justify-center text-[#a89a80] hover:text-[#f0ebe0] transition-[color,background-color,border-color,box-shadow] duration-200"
                style={{
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(220, 225, 245, 0.10)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background =
                    "rgba(255, 255, 255, 0.10)";
                  e.currentTarget.style.border =
                    "1px solid rgba(220, 225, 245, 0.22)";
                  e.currentTarget.style.boxShadow =
                    "0 0 20px hsla(220, 60%, 50%, 0.25)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background =
                    "rgba(255, 255, 255, 0.04)";
                  e.currentTarget.style.border =
                    "1px solid rgba(220, 225, 245, 0.10)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <X className="size-4" />
              </button>
            </DialogClose>
          </DialogHeader>

          {/* Body — layered branches: no-host / loading / error / empty / list. */}
          {selectedHostId == null ? (
            <div className="flex-1 flex items-center justify-center text-[#a89a80] text-sm">
              Pick a host to see its roles.
            </div>
          ) : rolesState.status === "loading" ? (
            <div className="flex-1 flex items-center justify-center text-[#a89a80] text-sm">
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
            <div className="flex-1 flex flex-col items-center justify-center text-[#a89a80] gap-3 text-sm text-center px-6">
              <div>This host has no roles yet.</div>
              <button
                type="button"
                onClick={() => setCreateRoleOpen(true)}
                className="px-3 py-1.5 rounded-md bg-[hsla(220,80%,60%,0.20)] hover:bg-[hsla(220,80%,60%,0.30)] text-[#e8e4d8] text-sm cursor-pointer"
              >
                + New role
              </button>
            </div>
          ) : (
            // D-05: alphabetical list of `.pv-row`-treatment rows.
            <div
              className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              {rolesState.data.map((role) => {
                const hue = hueFor(role);
                const label = displayNameFor(role);
                return (
                  <button
                    key={role.name}
                    type="button"
                    aria-label={label}
                    onClick={() =>
                      onSelectRole({
                        roleName: role.name,
                        roleCosmetics: role,
                        hostId: selectedHostId,
                      })
                    }
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

                    {/* Right-side chevron (low opacity — decorative, not
                        actionable — the whole row is the click target). */}
                    <ChevronRight
                      size={18}
                      style={{ opacity: 0.55, flexShrink: 0 }}
                    />
                  </button>
                );
              })}
            </div>
          )}

          {/* D-10: CreateRoleDialog stacks on top when open. Mounted as a
              sibling inside the same Portal — CreateRoleDialog owns its own
              Radix Dialog root + portal so it will overlay us cleanly. */}
          <CreateRoleDialog
            open={createRoleOpen}
            onClose={() => setCreateRoleOpen(false)}
            hostTree={hostTree}
            onCreated={handleCreateRoleCreated}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default RolesListModal;
