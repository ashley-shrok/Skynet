// ScheduledAgentsModal — the scheduled tasks window (clock icon in the
// sidebar footer). Scheduled tasks spawn a new identity on each firing;
// distinct from per-identity wake-ups, which fire an instruction into an
// already-running identity.
//
// apple-ux shape-scheduled-tasks-modal — a sibling of the agent window's
// wake-ups:
//   list — title + note, New, one search box (name, roles, instructions),
//          tasks grouped by machine (group titles only when there's more
//          than one), on tasks soonest-next first, switched-off ones after.
//   task — one level deeper in the same window: "‹ Scheduled Tasks" back,
//          the task's name, "On <machine>"; the body is ScheduledTaskView.
//          A new task is the same view, empty.
//   Back, Esc, Cancel and the X all ask before dropping unsaved edits. Esc in
//   a task goes back to the list; in the list it clears the search, then
//   closes.
//
// Data: no client cache — read on every open, re-read after every write and
// every 30s while open (sensor status, last / next stay current). Each row
// is keyed by (hostId, slug): slugs are only unique per machine.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Plus } from "lucide-react";
import { toast } from "sonner";
import { Modal, ModalHead, escBelongsElsewhere } from "@/components/modal";
import {
  KitBanner,
  KitButton,
  KitEmpty,
  KitLoading,
  KitSearch,
  KitSettingsGroup,
  kitConfirm,
} from "@/components/kit";
import type { Host, HostFolder } from "@/types/ui-types";
import {
  createScheduledAgent,
  deleteScheduledAgent,
  listScheduledAgents,
  runScheduledAgentNow,
  toggleScheduledAgentEnabled,
  updateScheduledAgent,
  type ScheduledAgentExpected,
  type ScheduledAgentListItem,
  type ScheduledAgentSpecWire,
} from "@/api/scheduled-agents-api";
import { sensorStatusUnreachable } from "@/api/sensor-status-types";
import { roleDisplayName } from "@/lib/role-display-name";
import { listRolesForHost } from "@/api/identities-api";
import type { EscapeHandler, LeaveGuard } from "@/features/pretty-view/roles-window/RolesWindow";
import { ScheduledAgentsModalRow, prettifyScheduledAgentName } from "./ScheduledAgentsModalRow";
import { ScheduledTaskView, type ProjectRowFields } from "./ScheduledTaskView";
import type { ScheduledTasksFilter } from "./open-scheduled-tasks";

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

export interface ScheduledAgentsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostTree: HostFolder | null;
  /** Opened from a role's "N scheduled tasks" shortcut: start on that role's
   *  tasks on its machine. Null = everything. */
  initialFilter?: ScheduledTasksFilter | null;
}

/** How often an open scheduled-tasks window re-reads the list. */
const LIST_REFRESH_MS = 30_000;

const LIST_NOTE = "Conversations that start themselves on a schedule, to carry out instructions you write now.";

type Deep = { view: "task"; hostId: number; slug: string; title: string } | { view: "new" };

const keyOf = (r: { hostId: number; slug: string }): string => `${r.hostId}:${r.slug}`;

/** hostId → role name → the role's display name on that machine. */
type RoleNames = Map<number, Map<string, string>>;

/** Every word must appear in the task's name, its roles (name or display
 *  name) or its instructions. */
function matches(row: ScheduledAgentListItem, words: string[], roleNames: RoleNames): boolean {
  if (words.length === 0) return true;
  const hay = [
    row.name,
    prettifyScheduledAgentName(row.name),
    row.prompt,
    ...row.roles,
    ...row.roles.map((r) => roleNames.get(row.hostId)?.get(r) ?? roleDisplayName(r)),
    row.project ?? "",
    ...(row.projectPath ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** On tasks soonest-next first (no next time after those), then the off ones. */
function byNextRun(a: ScheduledAgentListItem, b: ScheduledAgentListItem): number {
  if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
  const an = a.nextFireAt ?? Number.MAX_SAFE_INTEGER;
  const bn = b.nextFireAt ?? Number.MAX_SAFE_INTEGER;
  if (an !== bn) return an - bn;
  return prettifyScheduledAgentName(a.name).localeCompare(prettifyScheduledAgentName(b.name));
}

export function ScheduledAgentsModal({
  open,
  onOpenChange,
  hostTree,
  initialFilter = null,
}: ScheduledAgentsModalProps): JSX.Element {
  // items === null → loading; [] → none (or the load failed).
  const [items, setItems] = useState<ScheduledAgentListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deep, setDeep] = useState<Deep | null>(null);
  // One role on one machine (the role shortcut); "Show all" clears it.
  const [roleFilter, setRoleFilter] = useState<ScheduledTasksFilter | null>(null);
  useEffect(() => {
    if (open) setRoleFilter(initialFilter);
  }, [open, initialFilter]);

  const [toggling, setToggling] = useState<Set<string>>(() => new Set<string>());
  // Rows with a run-now request in flight — also the guard against starting two.
  const [runNowPending, setRunNowPending] = useState<Set<string>>(() => new Set<string>());

  // Read on open; everything resets on close.
  useEffect(() => {
    if (!open) {
      setItems(null);
      setLoadError(null);
      setWriteError(null);
      setSearch("");
      setDeep(null);
      setRoleFilter(null);
      return;
    }
    const controller = new AbortController();
    listScheduledAgents()
      .then((rows) => {
        if (!controller.signal.aborted) setItems(rows);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setItems([]);
        setLoadError(err instanceof Error ? err.message : "Couldn't load scheduled tasks");
      });
    return () => controller.abort();
  }, [open]);

  // Each machine's role display names, read once per open, so search finds a
  // role by the name the app shows for it.
  const [roleNames, setRoleNames] = useState<RoleNames>(() => new Map());
  const roleNamesAsked = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!open) {
      roleNamesAsked.current = new Set();
      setRoleNames(new Map());
      return;
    }
    for (const hostId of new Set((items ?? []).map((r) => r.hostId))) {
      if (roleNamesAsked.current.has(hostId)) continue;
      roleNamesAsked.current.add(hostId);
      listRolesForHost(hostId)
        .then((roles) => {
          if (!openRef.current) return;
          const names = new Map(roles.map((r) => [r.name, roleDisplayName(r.name, r.displayName)]));
          setRoleNames((cur) => new Map(cur).set(hostId, names));
        })
        .catch(() => {
          // Search falls back to names worked out from the role's slug until
          // the next list read asks again.
          roleNamesAsked.current.delete(hostId);
        });
    }
  }, [open, items]);

  // Only the most recently started read may land, and only while open: a slow
  // background refresh can't undo a write's fresher read, and a late one can't
  // repopulate a closed window.
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
        prev === null ? prev : prev.map((r) => (r.sensor ? { ...r, sensor: sensorStatusUnreachable(r.sensor) } : r)),
      );
      setLoadError(err instanceof Error ? err.message : "Couldn't refresh scheduled tasks");
    }
  }, []);

  // Every 30s: re-render (relative times) and re-read — one read at a time.
  const [, setTick] = useState(0);
  const refreshInFlight = useRef(false);
  useEffect(() => {
    if (!open) return;
    const handle = setInterval(() => {
      setTick((t) => t + 1);
      if (refreshInFlight.current) return;
      refreshInFlight.current = true;
      void refetch().finally(() => {
        refreshInFlight.current = false;
      });
    }, LIST_REFRESH_MS);
    return () => clearInterval(handle);
  }, [open, refetch]);

  const flatHosts = useMemo(
    () => collectAllHosts(hostTree?.children ?? []).filter((h) => h.enableRdp !== true),
    [hostTree],
  );
  // A new task can only go to a machine that can run agents.
  const agentHosts = useMemo(() => flatHosts.filter((h) => h.canHostAgents === true), [flatHosts]);

  // The open task, read live from the list so a background refresh updates
  // its status. If a refresh leaves it out because its machine didn't
  // answer, keep the last copy rather than blanking the view — with any
  // sensor status Unknown. If its machine answered without it, it's gone.
  const liveDeepRow =
    deep?.view === "task" ? (items?.find((i) => i.hostId === deep.hostId && i.slug === deep.slug) ?? null) : null;
  const [lastDeepRow, setLastDeepRow] = useState<ScheduledAgentListItem | null>(null);
  useEffect(() => {
    if (deep?.view !== "task") setLastDeepRow(null);
    else if (liveDeepRow) setLastDeepRow(liveDeepRow);
  }, [deep, liveDeepRow]);
  const machineAnswered = deep?.view === "task" && (items ?? []).some((r) => r.hostId === deep.hostId);
  const staleDeepRow =
    deep?.view === "task" && !machineAnswered && lastDeepRow && keyOf(lastDeepRow) === keyOf(deep) ? lastDeepRow : null;
  // Gone while being edited (a one-time task that ran, or deleted elsewhere):
  // keep the edits on screen to copy instead of dropping them.
  const [deepDirty, setDeepDirty] = useState(false);
  const goneDeepRow =
    deep?.view === "task" && !liveDeepRow && !staleDeepRow && deepDirty && lastDeepRow && keyOf(lastDeepRow) === keyOf(deep)
      ? lastDeepRow
      : null;
  const deepRow =
    liveDeepRow ??
    (staleDeepRow?.sensor ? { ...staleDeepRow, sensor: sensorStatusUnreachable(staleDeepRow.sensor) } : staleDeepRow) ??
    goneDeepRow;

  // ── Navigation ─────────────────────────────────────────────────────────
  // The task view registers its own leave guard (unsaved edits) and may use
  // Esc itself first.
  const guardRef = useRef<LeaveGuard | null>(null);
  const escapeRef = useRef<EscapeHandler | null>(null);
  const registerGuard = useCallback((g: LeaveGuard | null) => {
    guardRef.current = g;
  }, []);
  const registerEscape = useCallback((h: EscapeHandler | null) => {
    escapeRef.current = h;
  }, []);

  const leave = useCallback(async (): Promise<boolean> => {
    const g = guardRef.current;
    if (g && !(await g())) return false;
    guardRef.current = null;
    escapeRef.current = null;
    return true;
  }, []);

  const openTask = useCallback((row: ScheduledAgentListItem) => {
    console.debug("[ScheduledAgentsModal] nav", { to: "task", hostId: row.hostId, slug: row.slug });
    setWriteError(null);
    setDeep({ view: "task", hostId: row.hostId, slug: row.slug, title: prettifyScheduledAgentName(row.name) });
  }, []);
  const openNew = useCallback(() => {
    console.debug("[ScheduledAgentsModal] nav", { to: "new" });
    setWriteError(null);
    setDeep({ view: "new" });
  }, []);

  const back = useCallback(async (): Promise<void> => {
    if (!(await leave())) return;
    setDeep(null);
    void refetch();
  }, [leave, refetch]);

  const handleOpenChange = useCallback(
    async (next: boolean): Promise<void> => {
      if (next) return onOpenChange(true);
      if (!(await leave())) return;
      onOpenChange(false);
    },
    [leave, onOpenChange],
  );

  // Esc: a task goes back to the list; in the list it clears the search
  // first; otherwise it falls through to the window, which closes.
  const escState = useRef({ deep: false, search: "" });
  escState.current = { deep: deep !== null, search };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (escBelongsElsewhere(e)) return;
      const stop = (): void => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (escapeRef.current?.()) return stop();
      if (escState.current.deep) {
        stop();
        void back();
        return;
      }
      if (escState.current.search) {
        stop();
        setSearch("");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, back]);

  // ── Writes ─────────────────────────────────────────────────────────────
  const toggle = useCallback(
    async (row: ScheduledAgentListItem, enabled: boolean): Promise<void> => {
      const key = keyOf(row);
      if (toggling.has(key)) return;
      setToggling((s) => new Set(s).add(key));
      try {
        await toggleScheduledAgentEnabled(row.slug, row.hostId, enabled);
        // The server has it now: show it at once, so a save from the open
        // task (which writes the on/off too) can't put the old value back
        // even if the re-read below leaves this machine out.
        setItems((cur) => (cur === null ? cur : cur.map((r) => (keyOf(r) === key ? { ...r, enabled } : r))));
        setLastDeepRow((cur) => (cur && keyOf(cur) === key ? { ...cur, enabled } : cur));
        await refetch();
      } finally {
        setToggling((s) => {
          const next = new Set(s);
          next.delete(key);
          return next;
        });
      }
    },
    [toggling, refetch],
  );

  const toggleFromList = (row: ScheduledAgentListItem, enabled: boolean): void => {
    setWriteError(null);
    toggle(row, enabled).catch((err: unknown) => {
      const name = prettifyScheduledAgentName(row.name);
      setWriteError(`Couldn't turn “${name}” ${enabled ? "on" : "off"}: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  // Where the user is when a run-now answers decides where its error shows.
  const deepRef = useRef(deep);
  deepRef.current = deep;
  const runNow = async (row: ScheduledAgentListItem): Promise<void> => {
    const key = keyOf(row);
    if (runNowPending.has(key)) return;
    setRunNowPending((cur) => new Set(cur).add(key));
    setWriteError(null);
    try {
      await runScheduledAgentNow(row.slug, row.hostId);
      console.info({ operation: "scheduled_task_run_now", hostId: row.hostId, slug: row.slug });
      toast.success(`Started "${prettifyScheduledAgentName(row.name)}" — the new conversation appears shortly`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Run now failed";
      if (deepRef.current) toast.error(`Couldn't start it: ${msg}`);
      else setWriteError(msg);
    } finally {
      setRunNowPending((cur) => {
        const next = new Set(cur);
        next.delete(key);
        return next;
      });
    }
  };

  const deleteFromList = async (row: ScheduledAgentListItem): Promise<void> => {
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
      console.info({ operation: "scheduled_task_deleted", hostId: row.hostId, slug: row.slug });
      await refetch();
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  // On create / save, splice the fresh row in at once so it shows before the
  // refetch's fan-out answers; the refetch then overlays the server's copy.
  const spliceIn = (row: ScheduledAgentListItem): void => {
    setItems((cur) => {
      const base = cur ?? [];
      const i = base.findIndex((r) => keyOf(r) === keyOf(row));
      if (i < 0) return [row, ...base];
      const next = base.slice();
      next[i] = row;
      return next;
    });
  };

  const create = async (hostId: number, spec: ScheduledAgentSpecWire, project: ProjectRowFields): Promise<void> => {
    const created = await createScheduledAgent(hostId, spec);
    spliceIn({
      slug: created.slug,
      host: flatHosts.find((h) => parseInt(String(h.id), 10) === hostId)?.name ?? "",
      hostId,
      name: spec.name,
      enabled: spec.enabled ?? true,
      schedule: spec.schedule,
      scheduleHuman: "",
      prompt: spec.prompt,
      roles: spec.roles ?? [],
      archive_if_nothing_to_report: spec.archive_if_nothing_to_report ?? false,
      ...project,
      colorHue: null,
      lastFiredAt: null,
      nextFireAt: null,
    });
  };

  const save = async (
    row: ScheduledAgentListItem,
    spec: ScheduledAgentSpecWire,
    project: ProjectRowFields,
    expected: ScheduledAgentExpected,
  ): Promise<void> => {
    await updateScheduledAgent(row.slug, row.hostId, spec, expected);
    spliceIn({
      ...row,
      schedule: spec.schedule,
      prompt: spec.prompt,
      roles: spec.roles ?? [],
      archive_if_nothing_to_report: spec.archive_if_nothing_to_report ?? false,
      ...project,
    });
  };

  // ── List ───────────────────────────────────────────────────────────────
  const groups = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (items === null) return [];
    const byHost = new Map<number, { hostId: number; host: string; rows: ScheduledAgentListItem[] }>();
    for (const row of items) {
      if (!byHost.has(row.hostId)) byHost.set(row.hostId, { hostId: row.hostId, host: row.host, rows: [] });
      const inFilter = roleFilter === null || (row.hostId === roleFilter.hostId && row.roles.includes(roleFilter.role));
      if (inFilter && matches(row, words, roleNames)) byHost.get(row.hostId)!.rows.push(row);
    }
    return [...byHost.values()].map((g) => ({ ...g, rows: g.rows.sort(byNextRun) }));
  }, [items, search, roleNames, roleFilter]);
  const filterRoleLabel = roleFilter
    ? (roleNames.get(roleFilter.hostId)?.get(roleFilter.role) ?? roleDisplayName(roleFilter.role))
    : "";
  const filterHostLabel = roleFilter
    ? (flatHosts.find((h) => parseInt(String(h.id), 10) === roleFilter.hostId)?.name ?? "")
    : "";
  const multiMachine = groups.length > 1;
  const visibleGroups = groups.filter((g) => g.rows.length > 0);
  // What the user just did failing matters more than a background refresh.
  const bannerError = writeError ?? loadError;

  const newButton = (
    <KitButton variant="primary" size="sm" onClick={openNew} data-testid="scheduled-agents-modal-add-button">
      <Plus /> New scheduled task
    </KitButton>
  );

  const listView = (
    <>
      <ModalHead
        title="Scheduled Tasks"
        subtitle={LIST_NOTE}
        actions={
          <KitButton
            variant="primary"
            size="sm"
            aria-label="New scheduled task"
            title="New scheduled task"
            onClick={openNew}
            data-testid="scheduled-agents-modal-new"
          >
            <Plus /> <span className="max-sm:hidden">New</span>
          </KitButton>
        }
      />
      {items !== null && items.length > 0 && (
        <div className="px-6 max-sm:px-4 pb-3 flex-shrink-0">
          <KitSearch
            value={search}
            onValueChange={setSearch}
            placeholder="Search tasks, roles or instructions"
            aria-label="Search scheduled tasks"
            data-testid="scheduled-agents-modal-filter-search"
          />
        </div>
      )}
      {roleFilter !== null && (
        <div
          className="px-6 max-sm:px-4 pb-3 flex-shrink-0 flex items-center gap-2 text-[13px] text-[var(--k-t2)]"
          data-testid="scheduled-agents-modal-role-filter"
        >
          <span className="min-w-0 truncate">
            With <span className="font-semibold text-[var(--k-t1)]">{filterRoleLabel}</span>
            {filterHostLabel ? <> on {filterHostLabel}</> : null}
          </span>
          <KitButton variant="plain" size="sm" onClick={() => setRoleFilter(null)} data-testid="scheduled-agents-modal-role-filter-clear">
            Show all
          </KitButton>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 max-sm:px-4 pb-6 flex flex-col gap-4" data-testid="scheduled-agents-modal-list">
        {bannerError !== null && (
          <KitBanner
            tone="danger"
            data-testid={writeError !== null ? "scheduled-agents-modal-write-error" : "scheduled-agents-modal-load-error"}
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
        ) : items.length === 0 ? (
          <KitEmpty
            className="flex-1"
            data-testid="scheduled-agents-modal-empty-state"
            title="No scheduled tasks"
            body="A scheduled task starts a new conversation on a schedule to carry out instructions you write now."
            action={newButton}
          />
        ) : visibleGroups.length === 0 && roleFilter !== null && search.trim() === "" ? (
          <KitEmpty
            className="flex-1"
            data-testid="scheduled-agents-modal-role-filter-empty"
            title={`No scheduled tasks with ${filterRoleLabel}`}
            body="None of your scheduled tasks take this role on this machine yet."
            action={newButton}
          />
        ) : visibleGroups.length === 0 ? (
          <KitEmpty
            className="flex-1"
            data-testid="scheduled-agents-modal-no-matches"
            title="No matches"
            body={`Nothing called “${search.trim()}”, and no instructions or roles mention it.`}
          />
        ) : (
          visibleGroups.map((g) => (
            <KitSettingsGroup
              key={g.hostId}
              title={
                multiMachine ? (
                  <span className="flex items-baseline gap-2">
                    {g.host}
                    <small className="font-medium normal-case tracking-normal text-[var(--k-t3)]">
                      {g.rows.length} {g.rows.length === 1 ? "task" : "tasks"}
                    </small>
                  </span>
                ) : undefined
              }
              data-testid={`scheduled-agents-modal-group-${g.host}`}
            >
              {g.rows.map((row) => (
                <ScheduledAgentsModalRow
                  key={keyOf(row)}
                  row={row}
                  onOpen={openTask}
                  onToggle={toggleFromList}
                  onDelete={(r) => void deleteFromList(r)}
                  onRunNow={(r) => void runNow(r)}
                  runNowPending={runNowPending.has(keyOf(row))}
                  toggling={toggling.has(keyOf(row))}
                />
              ))}
            </KitSettingsGroup>
          ))
        )}
      </div>
    </>
  );

  // ── One level deeper ───────────────────────────────────────────────────
  const deepHead = (title: string, subtitle: string) => (
    <ModalHead
      title={title}
      subtitle={subtitle}
      leading={
        <KitButton
          variant="plain"
          size="sm"
          onClick={() => void back()}
          className="max-w-[180px] max-sm:max-w-[44px]"
          aria-label="Back to Scheduled Tasks"
          data-testid="scheduled-agents-modal-back"
          data-modal-back=""
        >
          <ChevronLeft /> <span className="truncate max-sm:hidden">Scheduled Tasks</span>
        </KitButton>
      }
    />
  );

  let deepView: JSX.Element | null = null;
  if (deep?.view === "new") {
    deepView = (
      <>
        {deepHead("New scheduled task", "Starts a conversation on a schedule")}
        <ScheduledTaskView
          key="new"
          hosts={agentHosts}
          hostsLoaded={hostTree !== null}
          onCreate={create}
          onDone={() => void back()}
          registerGuard={registerGuard}
          registerEscape={registerEscape}
        />
      </>
    );
  } else if (deep?.view === "task") {
    deepView = !deepRow ? (
      <>
        {deepHead(deep.title, "Scheduled task")}
        <div className="flex-1 min-h-0 px-6 py-4">
          <KitEmpty title="This scheduled task is gone." body="It was deleted elsewhere." />
        </div>
      </>
    ) : (
      <>
        {deepHead(prettifyScheduledAgentName(deepRow.name), `On ${deepRow.host}`)}
        <ScheduledTaskView
          key={keyOf(deepRow)}
          task={deepRow}
          hosts={agentHosts}
          onToggle={(enabled) => toggle(deepRow, enabled)}
          onRunNow={() => void runNow(deepRow)}
          runNowPending={runNowPending.has(keyOf(deepRow))}
          onSave={(spec, project, expected) => save(deepRow, spec, project, expected)}
          onDirtyChange={setDeepDirty}
          gone={
            goneDeepRow
              ? (goneDeepRow.schedule as { type?: unknown } | null)?.type === "one_shot"
                ? "ran"
                : "deleted"
              : undefined
          }
          onDelete={async () => {
            await deleteScheduledAgent(deepRow.slug, deepRow.hostId);
            setItems((cur) => (cur ?? []).filter((r) => keyOf(r) !== keyOf(deepRow)));
            // Straight back to the list — never via the "gone" screen.
            guardRef.current = null;
            escapeRef.current = null;
            setDeep(null);
            void refetch();
          }}
          onDone={() => void back()}
          registerGuard={registerGuard}
          registerEscape={registerEscape}
        />
      </>
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => void handleOpenChange(next)}
      size="tall-list"
      data-testid="scheduled-agents-modal"
    >
      {deepView ?? listView}
    </Modal>
  );
}
