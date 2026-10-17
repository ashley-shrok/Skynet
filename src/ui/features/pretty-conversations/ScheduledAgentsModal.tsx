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
//   D-15: loading = the kit's loading state (KitLoading).
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
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Modal, ModalHead, ModalBody } from "@/components/modal";
import {
  KitBanner,
  KitButton,
  KitEmpty,
  KitList,
  KitLoading,
  KitSearch,
  KitSelect,
  kitConfirm,
} from "@/components/kit";
import type { Host, HostFolder } from "@/types/ui-types";
import {
  deleteScheduledAgent,
  listScheduledAgents,
  runScheduledAgentNow,
  toggleScheduledAgentEnabled,
  type ScheduledAgentListItem,
} from "@/api/scheduled-agents-api";
import { sensorStatusUnreachable } from "@/api/sensor-status-types";
import { ScheduledAgentsModalRow, prettifyScheduledAgentName } from "./ScheduledAgentsModalRow";
import { ScheduledAgentsModalForm } from "./ScheduledAgentsModalForm";
import type { ScheduledTasksFilter } from "./open-scheduled-tasks";

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
  /** Filter applied each time the modal opens (e.g. from a role modal's
   *  shortcut). Null = open unfiltered. */
  initialFilter?: ScheduledTasksFilter | null;
}

// "No filter" sentinel — double-underscore-bracketed so it can never
// collide with a real user-defined role or host name.
const ALL_SENTINEL = "__ALL__" as const;

/** How often an open scheduled-tasks modal re-reads the list. */
const LIST_REFRESH_MS = 30_000;

export function ScheduledAgentsModal({
  open,
  onOpenChange,
  hostTree,
  initialFilter = null,
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
  // Keyed by (hostId, slug): slugs are only unique per host, so a slug-only
  // lookup opened (and saved over) another host's same-named task.
  const [editing, setEditing] = useState<{ hostId: number; slug: string } | null>(null);

  // Unified error slot — one dismissible banner shows whichever write
  // most recently failed (toggle / delete / load). Priority: load-error
  // wins if both a load AND a write failed in the same window.
  const [writeError, setWriteError] = useState<string | null>(null);

  // Toggle in-flight guard — rage-click on the same row is a no-op.
  const toggleInFlightRef = useRef<Set<string>>(new Set<string>());
  // Rows with a run-now request in flight, keyed `${hostId}:${slug}`. State
  // (not a ref) so the row's menu item re-renders as "Starting…" + disabled,
  // which is also the double-click guard against spawning two agents.
  const [runNowPending, setRunNowPending] = useState<Set<string>>(() => new Set<string>());

  // Opened with a filter (role modal shortcut) — apply it on each open.
  useEffect(() => {
    if (!open || initialFilter === null) return;
    setRoleFilter(initialFilter.role);
    setHostFilter(initialFilter.hostId);
  }, [open, initialFilter]);

  // Fetch-on-open + reset-on-close (D-03, D-17).
  useEffect(() => {
    if (!open) {
      setItems(null);
      setLoadError(null);
      setSearch("");
      setRoleFilter(ALL_SENTINEL);
      setHostFilter(ALL_SENTINEL);
      setView("list");
      setEditing(null);
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
          err instanceof Error ? err.message : "Couldn't load scheduled tasks",
        );
      });
    return () => controller.abort();
  }, [open]);

  // Refetch after any write (D-03).
  // Only the most recently started read may land, and only while the modal
  // is open: a slow background refresh can't undo a write's fresher read,
  // and a late one can't repopulate a closed modal.
  const fetchSeq = useRef(0);
  const openRef = useRef(open);
  openRef.current = open;
  const refetch = useCallback(async (): Promise<void> => {
    const seq = ++fetchSeq.current;
    const current = () => seq === fetchSeq.current && openRef.current;
    try {
      const rows = await listScheduledAgents();
      if (!current()) return;
      setItems(rows);
      setLoadError(null);
    } catch (err) {
      if (!current()) return;
      // Rows stay on screen, but no sensor keeps a verdict the app can no
      // longer back up.
      setItems((prev) =>
        prev === null
          ? prev
          : prev.map((r) => (r.sensor ? { ...r, sensor: sensorStatusUnreachable(r.sensor) } : r)),
      );
      setLoadError(
        err instanceof Error ? err.message : "Couldn't refresh scheduled tasks",
      );
    }
  }, []);

  // Keep the list current while the modal is open (sensors shape 2): every
  // 30s re-render (the Last / Next chips compute relative time at render)
  // and re-read the list, so sensor status, last fired and Next never go
  // more than ~30s stale. Runs in the form view too — an opened sensor
  // task's status section reads the live row. Nothing runs while closed.
  // One refresh at a time: a slow host fan-out never stacks requests.
  const [, setChipTick] = useState(0);
  const refreshInFlight = useRef(false);
  useEffect(() => {
    if (!open) return;
    const handle = setInterval(() => {
      setChipTick((t) => t + 1);
      if (refreshInFlight.current) return;
      refreshInFlight.current = true;
      void refetch().finally(() => {
        refreshInFlight.current = false;
      });
    }, LIST_REFRESH_MS);
    return () => clearInterval(handle);
  }, [open, refetch]);

  // The row being edited, read live from `items` so a background refresh
  // updates its sensor status. If a refresh drops it (its host didn't
  // answer), keep showing the last copy rather than blanking the form — but
  // with its sensor status Unknown, never a stale verdict.
  const lastEditingRow = useRef<ScheduledAgentListItem | null>(null);
  const liveEditingRow =
    editing !== null
      ? (items?.find((i) => i.hostId === editing.hostId && i.slug === editing.slug) ?? null)
      : null;
  if (editing === null) {
    lastEditingRow.current = null;
  } else if (liveEditingRow !== null) {
    lastEditingRow.current = liveEditingRow;
  }
  const staleEditingRow =
    editing !== null &&
    lastEditingRow.current?.hostId === editing.hostId &&
    lastEditingRow.current?.slug === editing.slug
      ? lastEditingRow.current
      : null;
  const editingRow =
    liveEditingRow ??
    (staleEditingRow?.sensor
      ? { ...staleEditingRow, sensor: sensorStatusUnreachable(staleEditingRow.sensor) }
      : staleEditingRow);

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
    // A role opened from its role modal stays pickable even with no tasks,
    // so the list reads "none match" instead of silently showing everything.
    if (initialFilter !== null) set.add(initialFilter.role);
    for (const item of items) {
      for (const r of item.roles) set.add(r);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items, initialFilter]);

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
    // Host tree not loaded yet — nothing to reconcile against.
    if (hostFilter === ALL_SENTINEL || flatHosts.length === 0) return;
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
        const nameHit = row.name.toLowerCase().includes(q) ||
          prettifyScheduledAgentName(row.name).toLowerCase().includes(q);
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
    setEditing({ hostId: row.hostId, slug: row.slug });
    setView("form");
  }

  async function handleToggleClick(row: ScheduledAgentListItem): Promise<void> {
    const toggleKey = `${row.hostId}:${row.slug}`;
    if (toggleInFlightRef.current.has(toggleKey)) return;
    toggleInFlightRef.current.add(toggleKey);
    setWriteError(null);
    try {
      await toggleScheduledAgentEnabled(row.slug, row.hostId, !row.enabled);
      await refetch();
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : "Toggle failed");
    } finally {
      toggleInFlightRef.current.delete(toggleKey);
    }
  }

  async function handleRunNowFromKebab(row: ScheduledAgentListItem): Promise<void> {
    const key = `${row.hostId}:${row.slug}`;
    if (runNowPending.has(key)) return;
    setRunNowPending((cur) => new Set(cur).add(key));
    setWriteError(null);
    try {
      await runScheduledAgentNow(row.slug, row.hostId);
      toast.success(`Started "${prettifyScheduledAgentName(row.name)}" — the new conversation appears shortly`);
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : "Run now failed");
    } finally {
      setRunNowPending((cur) => {
        const next = new Set(cur);
        next.delete(key);
        return next;
      });
    }
  }

  function handleEditFromKebab(row: ScheduledAgentListItem): void {
    setEditing({ hostId: row.hostId, slug: row.slug });
    setView("form");
  }

  async function handleDeleteFromKebab(
    row: ScheduledAgentListItem,
  ): Promise<void> {
    const ok = await kitConfirm({
      title: `Delete "${prettifyScheduledAgentName(row.name)}"?`,
      body: "This scheduled task stops running and is removed. This can't be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
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
    setEditing(null);
    setView("form");
  }

  function backToList(optimistic: ScheduledAgentListItem | null = null): void {
    setView("list");
    setEditing(null);
    // On create, splice the fresh row in immediately so it's visible before
    // the authoritative refetch resolves (UAT 2026-10-01). Dedupe on
    // (hostId, slug) so a re-save of the same scheduled agent doesn't
    // duplicate. The refetch below overlays with the server's canonical row.
    if (optimistic !== null) {
      setItems((current) => {
        const base = current ?? [];
        const existingIdx = base.findIndex(
          (r) => r.hostId === optimistic.hostId && r.slug === optimistic.slug,
        );
        if (existingIdx >= 0) {
          const next = base.slice();
          next[existingIdx] = optimistic;
          return next;
        }
        return [optimistic, ...base];
      });
    }
    void refetch();
  }

  const headerTitle =
    view === "list"
      ? "Scheduled Tasks"
      : editing !== null
        ? "Edit scheduled task"
        : "New scheduled task";

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
        setEditing(null);
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
        subtitle={
          view === "list"
            ? "Scheduled tasks are conversations that start themselves at a future date or time to carry out instructions you set in advance. They can be recurring or one-time."
            : undefined
        }
        actions={
          view === "list" ? (
            <KitButton
              variant="primary"
              size="sm"
              aria-label="New scheduled task"
              title="New scheduled task"
              data-testid="scheduled-agents-modal-add-button"
              onClick={enterCreateMode}
            >
              <Plus /> New
            </KitButton>
          ) : undefined
        }
      />

      {view === "list" && (
        <div
          // Below md the selects (sized to their longest option) would squeeze
          // the search to nothing — wrap so search gets its own full row.
          className="px-6 max-sm:px-5 pb-2 flex flex-row flex-wrap md:flex-nowrap items-center gap-2 flex-shrink-0"
        >
          <KitSearch
            value={search}
            onValueChange={setSearch}
            placeholder="Search name or prompt…"
            aria-label="Search scheduled tasks"
            data-testid="scheduled-agents-modal-filter-search"
            wrapperClassName="basis-full md:basis-auto flex-1"
          />
          <KitSelect
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            aria-label="Filter by role"
            data-testid="scheduled-agents-modal-filter-role"
            className="flex-1 md:flex-none md:w-auto"
          >
            <option value={ALL_SENTINEL}>All roles</option>
            {availableRoles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </KitSelect>
          {!hideHostFilter && (
            <KitSelect
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
              aria-label="Filter by host"
              data-testid="scheduled-agents-modal-filter-host"
              className="flex-1 md:flex-none md:w-auto"
            >
              <option value={ALL_SENTINEL}>All hosts</option>
              {flatHosts.map((h) => {
                const idNum = parseInt(String(h.id), 10);
                if (!Number.isFinite(idNum)) return null;
                return (
                  <option key={h.id} value={String(idNum)}>
                    {h.name}
                  </option>
                );
              })}
            </KitSelect>
          )}
        </div>
      )}

      {view === "list" ? (
        <ModalBody
          className="flex flex-col gap-2 px-4 max-sm:px-3"
          data-testid="scheduled-agents-modal-list"
        >
          {bannerError !== null && (
            <KitBanner
              tone="danger"
              data-testid={
                loadError !== null
                  ? "scheduled-agents-modal-load-error"
                  : "scheduled-agents-modal-write-error"
              }
              onDismiss={() => {
                setWriteError(null);
                setLoadError(null);
              }}
            >
              {bannerError}
            </KitBanner>
          )}

          {items === null ? (
            <KitLoading lines={3} className="px-2" />
          ) : visibleItems.length === 0 ? (
            <KitEmpty
              className="flex-1"
              data-testid="scheduled-agents-modal-empty-state"
              title={
                totalItems.length === 0
                  ? "No scheduled tasks"
                  : "No scheduled tasks match this filter"
              }
              body={totalItems.length === 0 ? "Choose New to create one." : undefined}
            />
          ) : (
            <KitList>
              {visibleItems.map((row) => (
                <ScheduledAgentsModalRow
                  key={`${row.hostId}::${row.slug}`}
                  row={row}
                  onRowClick={handleRowClick}
                  onToggleClick={(r) => {
                    void handleToggleClick(r);
                  }}
                  onEditFromKebab={handleEditFromKebab}
                  onDeleteFromKebab={(r) => {
                    void handleDeleteFromKebab(r);
                  }}
                  onRunNowFromKebab={(r) => {
                    void handleRunNowFromKebab(r);
                  }}
                  runNowPending={runNowPending.has(`${row.hostId}:${row.slug}`)}
                />
              ))}
            </KitList>
          )}
        </ModalBody>
      ) : (
        <ModalBody className="p-0 flex flex-col min-h-0 overflow-hidden">
          <ScheduledAgentsModalForm
            mode={editing !== null ? "edit" : "create"}
            initialSpec={editingRow}
            flatHosts={flatHosts}
            onCancel={() => backToList()}
            onSaved={(optimistic) => backToList(optimistic)}
          />
        </ModalBody>
      )}
    </Modal>
  );
}

