// ScheduledAgentsModal — fleet-wide list/edit modal for scheduled agents
// (entries that spawn a new identity on each firing; distinct from
// per-identity wake-ups, which fire an instruction into an already-running
// identity).
//
// Modal-unification 2026-09-29: composes from the canonical <Modal> shell
// (see components/modal.tsx). Backdrop click never dismisses (unified
// Modal-layer rule); only X + Esc close. Esc in form view routes back to
// list view instead of closing the modal (unsaved-work protection).
//
// Structure:
//   list view — ModalHead "Scheduled Agents" + "+ New" action + close X,
//                filter-bar (search + role select + host select, host
//                hidden on single-host boxes), single compact error
//                banner slot, scrollable rows via ScheduledAgentsModalRow.
//   form view — ModalHead "New scheduled agent" / "Edit scheduled agent"
//                + close X (no "+ New" action), body renders
//                <ScheduledAgentsModalForm> which owns its Cancel/Save
//                foot.
//
// D-XX contract preserved:
//   D-03: no client cache — refetch every open.
//   D-08: default state on open is list.
//   D-10: filter bar = search + role + host (host hidden when single-host).
//   D-11: row click enters edit mode; toggle + kebab stopPropagation.
//   D-12: pessimistic toggle — writer confirmed via API ack before flipping.
//   D-15: loading = 3 Skeleton bars.
//   D-16: empty state = centered dim helper text (fleet-wide zero vs
//         filter-narrows-to-zero copy).
//   D-17: filter state resets on close.
//   D-26: controlled open state lifted to PrettyConversationsPanel.
//   D-27: internal state machine — list ↔ form.
//   D-28: no streaming affordances.
//
// Dropped from the pre-unification implementation (user 2026-09-29):
//   - Footer count row (tasting anatomy has no foot in list view).
//   - `agent-when` next-fire timestamp on rows (unclear meaning; toggle +
//     kebab move up to the corner in its place).
//   - Host chip on rows (tasting drops it; host context lives in the
//     filter bar in multi-host mode).
//   - Role prefix on row title (avatar hue + role chip already carry it).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { Modal, ModalHead, ModalBody } from "@/components/modal";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/skeleton";
import type { Host, HostFolder } from "@/types/ui-types";
import {
  deleteScheduledAgent,
  listScheduledAgents,
  toggleScheduledAgentEnabled,
  type ScheduledAgentListItem,
} from "@/api/scheduled-agents-api";
import { ScheduledAgentsModalRow } from "./ScheduledAgentsModalRow";
import { ScheduledAgentsModalForm } from "./ScheduledAgentsModalForm";

// Host-tree flatten helpers — inlined from CreateProjectModal (small
// enough that a shared util isn't worth the migration cost).
function isFolder(item: Host | HostFolder): item is HostFolder {
  return "children" in item;
}
function collectAllHosts(children: (Host | HostFolder)[]): Host[] {
  const out: Host[] = [];
  for (const child of children) {
    if (isFolder(child)) {
      out.push(...collectAllHosts(child.children));
    } else {
      out.push(child);
    }
  }
  return out;
}

export interface ScheduledAgentsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostTree: HostFolder | null;
}

// "No filter" sentinel — double-underscore-bracketed so it can never
// collide with a real user-defined role or host name.
const ALL_SENTINEL = "__ALL__" as const;

export function ScheduledAgentsModal({
  open,
  onOpenChange,
  hostTree,
}: ScheduledAgentsModalProps): JSX.Element {
  // items === null → loading; items === [] → empty (fleet-wide zero OR
  // load error); items non-empty → rendered by ScheduledAgentsModalRow.
  const [items, setItems] = useState<ScheduledAgentListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filter state (D-10). "ALL" sentinels = no filter. Reset on close.
  const [search, setSearch] = useState<string>("");
  const [roleFilter, setRoleFilter] = useState<string>(ALL_SENTINEL);
  const [hostFilter, setHostFilter] = useState<number | typeof ALL_SENTINEL>(
    ALL_SENTINEL,
  );

  // Two internal views (D-27).
  const [view, setView] = useState<"list" | "form">("list");
  const [editingSlug, setEditingSlug] = useState<string | null>(null);

  // Which row's kebab popover is currently open (null = closed).
  const [kebabOpen, setKebabOpen] = useState<string | null>(null);

  // Unified error slot — one dismissible banner shows whichever write
  // most recently failed (toggle / delete / load). Priority: load-error
  // wins if both a load AND a write failed in the same window.
  const [writeError, setWriteError] = useState<string | null>(null);

  // Toggle in-flight guard — rage-click on the same row is a no-op.
  const toggleInFlightRef = useRef<Set<string>>(new Set<string>());

  // Fetch-on-open + reset-on-close (D-03, D-17).
  useEffect(() => {
    if (!open) {
      setItems(null);
      setLoadError(null);
      setSearch("");
      setRoleFilter(ALL_SENTINEL);
      setHostFilter(ALL_SENTINEL);
      setView("list");
      setEditingSlug(null);
      setKebabOpen(null);
      setWriteError(null);
      return;
    }

    const controller = new AbortController();
    listScheduledAgents()
      .then((rows) => {
        if (controller.signal.aborted) return;
        setItems(rows);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setItems([]);
        setLoadError(
          err instanceof Error ? err.message : "Couldn't load scheduled agents",
        );
      });
    return () => controller.abort();
  }, [open]);

  // Refetch after any write (D-03).
  const refetch = useCallback(async (): Promise<void> => {
    try {
      const rows = await listScheduledAgents();
      setItems(rows);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Couldn't refresh scheduled agents",
      );
    }
  }, []);

  const flatHosts = useMemo(
    () =>
      collectAllHosts(hostTree?.children ?? []).filter(
        (h) => h.enableRdp !== true,
      ),
    [hostTree],
  );

  // Single-host mode: hide the host select (tasting drops it) AND treat
  // the filter as implicit.
  const hideHostFilter = flatHosts.length === 1;

  const availableRoles = useMemo<string[]>(() => {
    if (items === null) return [];
    const set = new Set<string>();
    for (const item of items) {
      for (const r of item.roles) set.add(r);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  // Filter reconciliation — reset filter when option disappears.
  useEffect(() => {
    if (
      roleFilter !== ALL_SENTINEL &&
      availableRoles.length > 0 &&
      !availableRoles.includes(roleFilter)
    ) {
      setRoleFilter(ALL_SENTINEL);
    }
  }, [availableRoles, roleFilter]);
  useEffect(() => {
    if (hostFilter === ALL_SENTINEL) return;
    const hostIds = new Set<number>();
    for (const h of flatHosts) {
      const idNum = parseInt(String(h.id), 10);
      if (Number.isFinite(idNum) && idNum > 0) hostIds.add(idNum);
    }
    if (!hostIds.has(hostFilter)) setHostFilter(ALL_SENTINEL);
  }, [flatHosts, hostFilter]);

  const visibleItems = useMemo<ScheduledAgentListItem[]>(() => {
    if (items === null) return [];
    const q = search.trim().toLowerCase();
    return items.filter((row) => {
      if (q.length > 0) {
        const nameHit = row.name.toLowerCase().includes(q);
        const promptHit = row.prompt.toLowerCase().includes(q);
        if (!nameHit && !promptHit) return false;
      }
      if (roleFilter !== ALL_SENTINEL && !row.roles.includes(roleFilter)) {
        return false;
      }
      if (hostFilter !== ALL_SENTINEL && row.hostId !== hostFilter) {
        return false;
      }
      return true;
    });
  }, [items, search, roleFilter, hostFilter]);

  const totalItems = items ?? [];

  function handleRowClick(row: ScheduledAgentListItem): void {
    setKebabOpen(null);
    setEditingSlug(row.slug);
    setView("form");
  }

  async function handleToggleClick(row: ScheduledAgentListItem): Promise<void> {
    if (toggleInFlightRef.current.has(row.slug)) return;
    toggleInFlightRef.current.add(row.slug);
    setWriteError(null);
    try {
      await toggleScheduledAgentEnabled(row.slug, row.hostId, !row.enabled);
      await refetch();
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : "Toggle failed");
    } finally {
      toggleInFlightRef.current.delete(row.slug);
    }
  }

  function handleKebabClick(row: ScheduledAgentListItem): void {
    setKebabOpen((current) => (current === row.slug ? null : row.slug));
  }

  function handleEditFromKebab(row: ScheduledAgentListItem): void {
    setKebabOpen(null);
    setEditingSlug(row.slug);
    setView("form");
  }

  async function handleDeleteFromKebab(
    row: ScheduledAgentListItem,
  ): Promise<void> {
    setKebabOpen(null);
    // eslint-disable-next-line no-alert
    const ok = window.confirm(`Delete scheduled agent "${row.name}"?`);
    if (!ok) return;
    setWriteError(null);
    try {
      await deleteScheduledAgent(row.slug, row.hostId);
      await refetch();
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  function enterCreateMode(): void {
    setEditingSlug(null);
    setView("form");
  }

  function backToList(): void {
    setView("list");
    setEditingSlug(null);
    void refetch();
  }

  const headerTitle =
    view === "list"
      ? "Scheduled Agents"
      : editingSlug !== null
        ? "Edit scheduled agent"
        : "New scheduled agent";

  // Unified error banner content — load error wins if both present.
  const bannerError = loadError ?? writeError;

  // Escape-in-form handler: prevent the Modal's default close, route back
  // to list instead.
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key !== "Escape") return;
      if (view === "form") {
        e.stopPropagation();
        e.preventDefault();
        setView("list");
        setEditingSlug(null);
        void refetch();
      }
    },
    [open, view, refetch],
  );
  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [open, handleEscape]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="list"
      data-testid="scheduled-agents-modal"
    >
      <ModalHead
        title={headerTitle}
        actions={
          view === "list" ? (
            <button
              type="button"
              aria-label="New scheduled agent"
              title="New scheduled agent"
              data-testid="scheduled-agents-modal-add-button"
              onClick={enterCreateMode}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] cursor-pointer",
                "bg-[hsla(var(--pv-id-hue),65%,55%,0.30)]",
                "hover:bg-[hsla(var(--pv-id-hue),65%,55%,0.42)]",
                "border border-[hsla(var(--pv-id-hue),75%,70%,0.45)]",
                "text-[#fbf5e8]",
              )}
            >
              <Plus size={12} /> New
            </button>
          ) : undefined
        }
      />

      {view === "list" && (
        <div
          className={cn(
            "px-4 py-2.5 flex flex-row items-center gap-2 flex-shrink-0",
            "bg-black/25",
            "border-b border-[hsla(var(--pv-id-hue),60%,55%,0.18)]",
          )}
        >
          <div
            className={cn(
              "flex-1 min-w-0 flex items-center gap-2 px-2 py-1 rounded-md",
              "bg-black/20 border border-[hsla(var(--pv-id-hue),65%,55%,0.22)]",
            )}
          >
            <Search
              size={14}
              className="shrink-0 text-[hsla(var(--pv-id-hue),22%,88%,0.6)]"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or prompt..."
              data-testid="scheduled-agents-modal-filter-search"
              className={cn(
                "flex-1 min-w-0 bg-transparent text-[12.5px] outline-none",
                "text-[#fbf5e8]",
                "placeholder:text-[hsla(var(--pv-id-hue),22%,88%,0.45)]",
              )}
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            data-testid="scheduled-agents-modal-filter-role"
            className={cn(
              "text-[12px] px-2 py-1 rounded-md outline-none cursor-pointer",
              "bg-black/20 border border-[hsla(var(--pv-id-hue),65%,55%,0.22)]",
              "text-[#fbf5e8]",
            )}
          >
            <option value={ALL_SENTINEL} style={OPTION_STYLE}>
              All roles
            </option>
            {availableRoles.map((r) => (
              <option key={r} value={r} style={OPTION_STYLE}>
                {r}
              </option>
            ))}
          </select>
          {!hideHostFilter && (
            <select
              value={
                hostFilter === ALL_SENTINEL ? ALL_SENTINEL : String(hostFilter)
              }
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === ALL_SENTINEL) {
                  setHostFilter(ALL_SENTINEL);
                } else {
                  const parsed = parseInt(raw, 10);
                  if (Number.isFinite(parsed) && parsed > 0) {
                    setHostFilter(parsed);
                  }
                }
              }}
              data-testid="scheduled-agents-modal-filter-host"
              className={cn(
                "text-[12px] px-2 py-1 rounded-md outline-none cursor-pointer",
                "bg-black/20 border border-[hsla(var(--pv-id-hue),65%,55%,0.22)]",
                "text-[#fbf5e8]",
              )}
            >
              <option value={ALL_SENTINEL} style={OPTION_STYLE}>
                All hosts
              </option>
              {flatHosts.map((h) => {
                const idNum = parseInt(String(h.id), 10);
                if (!Number.isFinite(idNum)) return null;
                return (
                  <option key={h.id} value={String(idNum)} style={OPTION_STYLE}>
                    {h.name}
                  </option>
                );
              })}
            </select>
          )}
        </div>
      )}

      {view === "list" ? (
        <ModalBody
          className="p-0 overflow-y-auto flex flex-col gap-1.5 px-3 py-2.5"
          data-testid="scheduled-agents-modal-list"
        >
          {bannerError !== null && (
            <div
              role="alert"
              data-testid={
                loadError !== null
                  ? "scheduled-agents-modal-load-error"
                  : "scheduled-agents-modal-write-error"
              }
              className="pv-agent-list-error"
            >
              <span style={{ flex: 1 }}>{bannerError}</span>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => {
                  setWriteError(null);
                  setLoadError(null);
                }}
                className="pv-agent-list-error-dismiss"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {items === null ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-24 w-full rounded-[var(--radius-pv-bubble)]" />
              <Skeleton className="h-24 w-full rounded-[var(--radius-pv-bubble)]" />
              <Skeleton className="h-24 w-full rounded-[var(--radius-pv-bubble)]" />
            </div>
          ) : visibleItems.length === 0 ? (
            <div
              className="flex items-center justify-center h-full min-h-[120px] px-6 py-8 text-center text-[12.5px] text-[hsla(var(--pv-id-hue),22%,88%,0.6)]"
              data-testid="scheduled-agents-modal-empty-state"
            >
              {totalItems.length === 0
                ? "No scheduled agents on any host. Click + to create one."
                : "No scheduled agents match this filter."}
            </div>
          ) : (
            visibleItems.map((row) => (
              <ScheduledAgentsModalRow
                key={`${row.hostId}::${row.slug}`}
                row={row}
                onRowClick={handleRowClick}
                onToggleClick={(r) => {
                  void handleToggleClick(r);
                }}
                onKebabClick={handleKebabClick}
                kebabOpen={kebabOpen === row.slug}
                onEditFromKebab={handleEditFromKebab}
                onDeleteFromKebab={(r) => {
                  void handleDeleteFromKebab(r);
                }}
              />
            ))
          )}
        </ModalBody>
      ) : (
        <ModalBody className="p-0 flex flex-col min-h-0 overflow-hidden">
          <ScheduledAgentsModalForm
            mode={editingSlug !== null ? "edit" : "create"}
            initialSpec={
              editingSlug !== null
                ? (items?.find((i) => i.slug === editingSlug) ?? null)
                : null
            }
            flatHosts={flatHosts}
            onCancel={backToList}
            onSaved={backToList}
          />
        </ModalBody>
      )}
    </Modal>
  );
}

const OPTION_STYLE = { backgroundColor: "#1a1a1a", color: "#e8e4d8" } as const;
