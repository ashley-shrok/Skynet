// One scheduled task, one level deeper in the scheduled tasks window — or a
// new one (apple-ux shape-scheduled-tasks-modal). The window owns the header
// (back to the list, the task's name, close); this is the form and its foot.
// A sibling of the agent window's wake-up view.
//
//   - On: a switch. On an existing task it saves at once (same as the list's
//     switch); on a new one it's part of what Create writes. Under it, Run
//     now — a button — for every task but a one-time one.
//   - Name (fixed once created), Machine (new tasks, only when there's more
//     than one to choose from), Roles, Project (where its conversations are
//     filed; picking another machine clears it), When (the shared schedule section,
//     time zone included), Instructions, Archive if nothing to report.
//   - A sensor-fired task has no clock schedule: When says so and its
//     sensor's details show read-only; its schedule is written back
//     unchanged.
//   - Delete scheduled task… at the bottom (existing ones), Cancel / Save or
//     Create at the foot. Leaving with unsaved changes asks first.
//
// Round-trip: keys of the schedule the form doesn't show ride along in the
// hydrated schedule, so an edit never drops them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ModalFoot } from "@/components/modal";
import {
  KitBanner,
  KitButton,
  KitField,
  KitInput,
  KitPickChip,
  KitPickRow,
  KitSelect,
  KitSettingsGroup,
  KitSettingsRow,
  KitSwitch,
  KitTextarea,
  kitConfirm,
} from "@/components/kit";
import {
  listScheduledAgentProjects,
  type ScheduledAgentListItem,
  type ScheduledAgentProjectOption,
  type ScheduledAgentSpecWire,
} from "@/api/scheduled-agents-api";
import { listRolesForHost, type RoleSummary } from "@/api/identities-api";
import { roleDisplayName } from "@/lib/role-display-name";
import type { Host } from "@/types/ui-types";
import { SensorDetails } from "@/features/pretty-view/SensorStatusView";
import {
  type FormSchedule,
  buildSchedule,
  detectBrowserTimezone,
  hydrateFormSchedule,
  isOnceSensorSchedule,
  isSensorSchedule,
  ScheduleWhenFields,
  validateForm,
} from "@/features/pretty-view/WakeupFormShared";
import type { EscapeHandler, LeaveGuard } from "@/features/pretty-view/roles-window/RolesWindow";
import { isOneShotTask, nextRunLabel, prettifyScheduledAgentName, scheduleSentence } from "./ScheduledAgentsModalRow";
import { formatRelativePast } from "./scheduled-agents-time-fmt";
import { orderProjectsAsTree, projectPathFromOptions } from "./scheduled-agents-projects";

const PICK_ROLES_HINT = "Pick roles, or No roles.";

function statusOf(err: unknown): number | undefined {
  if (err !== null && typeof err === "object" && "status" in err) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return undefined;
}

function interpretError(err: unknown, rawName: string): string {
  const status = statusOf(err);
  if (status === 409) return `A scheduled task named "${rawName}" already exists on this machine — pick a different name.`;
  if (status === 400) {
    const msg = err instanceof Error ? err.message : "";
    return msg || "The schedule is malformed — check the fields.";
  }
  return err instanceof Error && err.message.length > 0 ? err.message : "Couldn't save the scheduled task — try again.";
}

function scheduleTimezone(schedule: unknown): string {
  const tz = (schedule as { timezone?: unknown } | null)?.timezone;
  return typeof tz === "string" ? tz : "";
}

export const hostIdOf = (h: Host): number => parseInt(String(h.id), 10);

/** How a just-saved task's project shows on its row until the list re-reads. */
export type ProjectRowFields = Pick<ScheduledAgentListItem, "project" | "projectPath" | "projectMissing">;

export interface ScheduledTaskViewProps {
  /** Absent = a new task. */
  task?: ScheduledAgentListItem;
  /** Machines a new task can go to (they can run agents). */
  hosts: Host[];
  /** False while the app's machine list hasn't arrived yet. */
  hostsLoaded?: boolean;
  /** Saves just the on/off of an existing task. */
  onToggle?: (enabled: boolean) => Promise<void>;
  onRunNow?: () => void;
  runNowPending?: boolean;
  onSave?: (spec: ScheduledAgentSpecWire, project: ProjectRowFields) => Promise<void>;
  onCreate?: (hostId: number, spec: ScheduledAgentSpecWire, project: ProjectRowFields) => Promise<void>;
  onDelete?: () => Promise<void>;
  /** Back to the list (after Cancel, a save, a create or a delete). */
  onDone: () => void;
  registerGuard: (g: LeaveGuard | null) => void;
  registerEscape: (h: EscapeHandler | null) => void;
}

export function ScheduledTaskView({
  task,
  hosts,
  hostsLoaded = true,
  onToggle,
  onRunNow,
  runNowPending = false,
  onSave,
  onCreate,
  onDelete,
  onDone,
  registerGuard,
  registerEscape,
}: ScheduledTaskViewProps): JSX.Element {
  const { t } = useTranslation();
  const isNew = !task;
  const detectedTz = useMemo(detectBrowserTimezone, []);
  const isSensor = !!task && isSensorSchedule(task.schedule);

  // Drafts start from the task as it was when the view opened; the list's
  // background re-read never resets them.
  const initial = useMemo(
    () => ({
      name: task?.name ?? "",
      prompt: task?.prompt ?? "",
      roles: task?.roles ?? [],
      noRoles: !!task && task.roles.length === 0,
      archive: task?.archive_if_nothing_to_report ?? false,
      project: task?.project ?? null,
      tz: task ? scheduleTimezone(task.schedule) : "",
      schedule: task && !isSensor ? hydrateFormSchedule(task.schedule) : ({ type: "daily", at: "09:00" } as FormSchedule),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the starting point only
    [],
  );
  const [name, setName] = useState(initial.name);
  const [prompt, setPrompt] = useState(initial.prompt);
  const [roles, setRoles] = useState<string[]>(initial.roles);
  const [noRoles, setNoRoles] = useState(initial.noRoles);
  const [archive, setArchive] = useState(initial.archive);
  const [project, setProject] = useState<string | null>(initial.project);
  const [tz, setTz] = useState(initial.tz);
  const [fs, setFs] = useState<FormSchedule>(initial.schedule);
  const [newEnabled, setNewEnabled] = useState(true);
  // A new task on the only machine there is goes there without asking.
  const [hostId, setHostId] = useState<number | null>(() =>
    task ? task.hostId : hosts.length === 1 ? hostIdOf(hosts[0]) : null,
  );
  useEffect(() => {
    if (isNew && hostId === null && hosts.length === 1) setHostId(hostIdOf(hosts[0]));
  }, [isNew, hostId, hosts]);

  const [availableRoles, setAvailableRoles] = useState<RoleSummary[]>([]);
  useEffect(() => {
    // Never offer the previous machine's roles while this one's load.
    setAvailableRoles([]);
    if (hostId === null || !Number.isFinite(hostId)) return;
    let alive = true;
    listRolesForHost(hostId)
      .then((rows) => alive && setAvailableRoles(rows))
      .catch(() => alive && setAvailableRoles([]));
    return () => {
      alive = false;
    };
  }, [hostId]);

  // The machine's projects — null until loaded (or if the read failed), so a
  // saved project isn't called missing before we know.
  const [availableProjects, setAvailableProjects] = useState<ScheduledAgentProjectOption[] | null>(null);
  useEffect(() => {
    setAvailableProjects(null);
    if (hostId === null || !Number.isFinite(hostId)) return;
    let alive = true;
    listScheduledAgentProjects(hostId)
      .then((rows) => alive && setAvailableProjects(rows))
      .catch(() => {
        /* stays null — the picker still offers No project + the saved pick */
      });
    return () => {
      alive = false;
    };
  }, [hostId]);
  const projectOptions = useMemo(
    () => (availableProjects === null ? [] : orderProjectsAsTree(availableProjects)),
    [availableProjects],
  );
  // A saved pick the machine doesn't list is either still loading / unreadable
  // (shown plain) or gone (shown missing). Either way it stays picked so an
  // unrelated save keeps it.
  const projectUnlisted = project !== null && !projectOptions.some((o) => o.slug === project);
  const projectMissing = projectUnlisted && availableProjects !== null;

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A one-time task's time carries this browser's offset, so its zone is
  // always the browser's; the Time zone field is for the repeating kinds.
  // An existing schedule saved without a zone runs in its machine's zone; a
  // blank field keeps it that way instead of writing this browser's zone in.
  const blankIsMachine = !!task && scheduleTimezone(task.schedule) === "";
  const zoneFor = (kind: FormSchedule["type"], typed: string): string =>
    kind === "one_shot" ? detectedTz : typed.trim() !== "" ? typed.trim() : blankIsMachine ? "" : detectedTz;
  const effectiveTz = zoneFor(fs.type, tz);
  // Compared as the schedule that would be written, so switching a kind and
  // back (which can fill in defaults) isn't an edit.
  const built = (f: FormSchedule, z: string): string => (isSensor ? "" : JSON.stringify(buildSchedule(f, z)));
  const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  const rolesPicked = noRoles || roles.length > 0;
  const dirty =
    name !== initial.name ||
    prompt !== initial.prompt ||
    !sameList(roles, initial.roles) ||
    noRoles !== initial.noRoles ||
    archive !== initial.archive ||
    project !== initial.project ||
    built(fs, effectiveTz) !== built(initial.schedule, zoneFor(initial.schedule.type, initial.tz)) ||
    (isNew && (!newEnabled || hostId !== (hosts.length === 1 ? hostIdOf(hosts[0]) : null)));

  const validation = isSensor ? null : validateForm(fs);
  const canSubmit =
    !saving &&
    !deleting &&
    // The update writes the on/off too — wait for a switch still saving.
    !toggling &&
    validation === null &&
    name.trim() !== "" &&
    prompt.trim() !== "" &&
    hostId !== null &&
    rolesPicked &&
    (isNew || dirty);

  const confirmDiscard = useCallback(
    (): Promise<boolean> =>
      kitConfirm({
        title: "Discard your changes?",
        body: isNew ? "This scheduled task hasn't been created." : "Your edits to this scheduled task haven't been saved.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        destructive: true,
      }),
    [isNew],
  );

  // Leaving with unsaved changes asks first; the window asks on every route out.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // While a save, create or delete is on its way, nothing leaves the view —
  // it goes back by itself once the server answers.
  const busyRef = useRef(false);
  useEffect(() => {
    registerGuard(async () => (busyRef.current ? false : dirtyRef.current ? confirmDiscard() : true));
    return () => registerGuard(null);
  }, [registerGuard, confirmDiscard]);
  useEffect(() => {
    registerEscape(() => busyRef.current);
    return () => registerEscape(null);
  }, [registerEscape]);

  const submit = async (): Promise<void> => {
    setError(null);
    if (validation) {
      setError(validation);
      return;
    }
    if (!rolesPicked) {
      setError(PICK_ROLES_HINT);
      return;
    }
    if (hostId === null) {
      setError("Pick a machine.");
      return;
    }
    setSaving(true);
    busyRef.current = true;
    const trimmedName = name.trim();
    try {
      const spec: ScheduledAgentSpecWire = {
        // The name is the task's key on disk — fixed once created.
        name: isNew ? trimmedName : task!.name,
        prompt: prompt.trim(),
        schedule: isSensor ? (task!.schedule as Record<string, unknown>) : buildSchedule(fs, effectiveTz),
        roles: noRoles ? [] : roles,
        enabled: isNew ? newEnabled : task!.enabled,
        archive_if_nothing_to_report: archive,
        ...(project !== null ? { project } : {}),
      };
      // Until the projects load, an unchanged pick keeps the row's own reading.
      const projectPath =
        project !== null && availableProjects !== null ? projectPathFromOptions(project, availableProjects) : null;
      const projectRow: ProjectRowFields =
        task && availableProjects === null && project === task.project
          ? { project: task.project, projectPath: task.projectPath, projectMissing: task.projectMissing }
          : { project, projectPath, projectMissing: project !== null && availableProjects !== null && projectPath === null };
      if (isNew) {
        await onCreate?.(hostId, spec, projectRow);
        console.info({ operation: "scheduled_task_created", hostId, name: trimmedName });
      } else {
        await onSave?.(spec, projectRow);
        console.info({ operation: "scheduled_task_saved", hostId, slug: task!.slug });
      }
      dirtyRef.current = false;
      busyRef.current = false;
      onDone();
    } catch (e) {
      setError(interpretError(e, trimmedName));
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  };

  const toggle = async (next: boolean): Promise<void> => {
    if (isNew) {
      setNewEnabled(next);
      return;
    }
    setError(null);
    setToggling(true);
    try {
      await onToggle?.(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setToggling(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!task) return;
    const ok = await kitConfirm({
      title: `Delete "${prettifyScheduledAgentName(task.name)}"?`,
      body: "This scheduled task stops running and is removed. This can't be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    busyRef.current = true;
    setDeleting(true);
    try {
      await onDelete?.();
      console.info({ operation: "scheduled_task_deleted", hostId: task.hostId, slug: task.slug });
      dirtyRef.current = false;
      busyRef.current = false;
      onDone();
    } catch (e) {
      setError(`Couldn't delete: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      busyRef.current = false;
      setDeleting(false);
    }
  };

  // Picking a role clears "No roles"; unticking the last role leaves nothing
  // picked (the user chooses again — no silent fall back to "No roles").
  const toggleRole = (r: string): void => {
    setNoRoles(false);
    setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  };
  const toggleNoRoles = (): void => {
    setNoRoles((cur) => !cur);
    setRoles([]);
  };
  const pickHost = (id: number): void => {
    if (id === hostId) return;
    setHostId(id);
    // Roles and projects belong to a machine.
    setRoles([]);
    setNoRoles(false);
    setProject(null);
  };

  const roleDisplayByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of availableRoles) m.set(r.name, roleDisplayName(r.name, r.displayName));
    return m;
  }, [availableRoles]);
  // Picked roles first (including any the machine no longer lists), then the rest.
  const roleChips = [
    ...roles.map((r) => ({ name: r, selected: true })),
    ...availableRoles
      .map((r) => r.name)
      .filter((n) => !roles.includes(n))
      .sort((a, b) => (roleDisplayByName.get(a) ?? a).localeCompare(roleDisplayByName.get(b) ?? b))
      .map((n) => ({ name: n, selected: false })),
  ];

  const enabled = isNew ? newEnabled : task.enabled;
  const nowSecs = Math.floor(Date.now() / 1000);
  const onDescription = isNew
    ? enabled
      ? "It starts running on its schedule as soon as it's created."
      : "It's created switched off."
    : !enabled
      ? `Off — it won't run · ${isSensor ? "Runs when its sensor sees something" : scheduleSentence(task)}`
      : [
          isSensor ? "Runs when its sensor sees something" : scheduleSentence(task),
          task.lastFiredAt !== null ? `Last ran ${formatRelativePast(task.lastFiredAt, nowSecs)}` : "Hasn't run yet",
          !isSensor && task.nextFireAt !== null ? nextRunLabel(task.nextFireAt, nowSecs) : null,
        ]
          .filter(Boolean)
          .join(" · ");

  const showMachines = isNew && hosts.length > 1;

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto px-6 max-sm:px-5 pb-6 pt-1">
        <div className="max-w-[620px] mx-auto flex flex-col gap-5" data-testid="scheduled-task-view">
          <KitSettingsGroup>
            <KitSettingsRow
              label="On"
              description={<span data-testid="scheduled-task-on-note">{onDescription}</span>}
              control={
                <KitSwitch
                  checked={enabled}
                  onCheckedChange={(next) => void toggle(next)}
                  disabled={toggling}
                  aria-label="On"
                  data-testid="scheduled-task-enabled"
                />
              }
            />
            {!isNew && !isOneShotTask(task) && (
              <KitSettingsRow
                label={
                  <span className="text-[13px] font-normal text-[var(--k-t2)]">
                    Start a conversation for it right away. The schedule carries on as usual.
                  </span>
                }
                control={
                  <KitButton
                    size="sm"
                    onClick={onRunNow}
                    disabled={runNowPending}
                    busy={runNowPending}
                    data-testid="scheduled-task-run-now"
                  >
                    {runNowPending ? "Starting…" : "Run now"}
                  </KitButton>
                }
              />
            )}
          </KitSettingsGroup>

          <KitField
            label="Name"
            htmlFor="scheduled-task-name"
            help={isNew ? undefined : "To rename it, delete it and create a new one."}
          >
            <KitInput
              type="text"
              value={isNew ? name : prettifyScheduledAgentName(name)}
              onChange={(e) => setName(e.target.value)}
              placeholder="Daily briefing"
              disabled={!isNew}
              maxLength={120}
              data-testid="scheduled-task-name"
            />
          </KitField>

          {showMachines && (
            <KitSettingsGroup
              title="Machine"
              footer="Where its conversations start. Each run is a new agent on this machine."
              data-testid="scheduled-task-machines"
            >
              {hosts.map((h) => {
                const id = hostIdOf(h);
                const picked = hostId === id;
                return (
                  <KitSettingsRow
                    key={h.id}
                    leading={<Server className="size-[17px] text-[var(--k-t3)] shrink-0" aria-hidden="true" />}
                    label={<span className={picked ? "text-[var(--k-acc-text)]" : undefined}>{h.name}</span>}
                    onClick={() => pickHost(id)}
                    chevron={false}
                    control={picked ? <Check className="size-4 text-[var(--k-acc-text)]" aria-label="Picked" /> : undefined}
                    data-testid={`scheduled-task-machine-${h.id}`}
                  />
                );
              })}
            </KitSettingsGroup>
          )}

          {isNew && hostsLoaded && hosts.length === 0 && (
            <KitBanner tone="warn" data-testid="scheduled-task-no-machines">
              None of your machines can run agents, so there's nowhere for this task to start its conversations.
            </KitBanner>
          )}

          {hostId !== null && (
            <KitField
              group
              label="Roles"
              data-testid="scheduled-task-roles"
              help={
                rolesPicked ? (
                  "What each run's agent takes on."
                ) : (
                  <span data-testid="scheduled-task-roles-hint">{PICK_ROLES_HINT}</span>
                )
              }
            >
              <KitPickRow aria-label="Roles">
                {/* "No roles" leads — a deliberate choice, exclusive with the roles after it. */}
                <KitPickChip pressed={noRoles} onPressedChange={toggleNoRoles} data-testid="scheduled-task-no-roles">
                  {t("nav.newSessionNoRoles", { defaultValue: "No roles" })}
                </KitPickChip>
                {roleChips.map(({ name: r, selected }) => (
                  <KitPickChip
                    key={r}
                    pressed={selected}
                    onPressedChange={() => toggleRole(r)}
                    data-testid={selected ? `scheduled-task-role-selected-${r}` : `scheduled-task-role-addable-${r}`}
                  >
                    {roleDisplayByName.get(r) ?? roleDisplayName(r)}
                  </KitPickChip>
                ))}
              </KitPickRow>
            </KitField>
          )}

          {hostId !== null && (
            <KitField
              label="Project"
              htmlFor="scheduled-task-project"
              data-testid="scheduled-task-project"
              help={
                projectMissing ? (
                  <span className="text-[var(--k-warn)]" data-testid="scheduled-task-project-missing">
                    This project no longer exists. Its conversations go to Conversations until it&apos;s back or
                    you pick another.
                  </span>
                ) : (
                  "Where each conversation it starts is filed."
                )
              }
            >
              <KitSelect
                id="scheduled-task-project"
                value={project ?? ""}
                onChange={(e) => setProject(e.target.value === "" ? null : e.target.value)}
                invalid={projectMissing}
                data-testid="scheduled-task-project-select"
              >
                <option value="">No project</option>
                {projectOptions.map((o) => (
                  <option key={o.slug} value={o.slug}>
                    {"\u00a0\u00a0\u00a0\u00a0".repeat(o.depth) + o.displayName}
                  </option>
                ))}
                {projectUnlisted && project !== null && (
                  <option value={project}>{projectMissing ? `${project} (missing)` : project}</option>
                )}
              </KitSelect>
            </KitField>
          )}

          {isSensor ? (
            <div className="k-field" data-testid="scheduled-task-sensor-schedule">
              <span className="k-label">When</span>
              <span className="text-[14px] text-[var(--k-t1)]">
                When its sensor fires{isOnceSensorSchedule(task!.schedule) ? " — once, then it retires" : ""}
              </span>
              <span className="k-help">Its timing comes from its sensor, which agents build — switch it off above to stop it.</span>
              {task!.sensor && (
                <div className="mt-2">
                  <SensorDetails
                    sensor={task!.sensor}
                    lastFiredAt={task!.lastFiredAt}
                    once={isOnceSensorSchedule(task!.schedule)}
                    testId="scheduled-task-sensor-details"
                  />
                </div>
              )}
            </div>
          ) : (
            <ScheduleWhenFields
              fs={fs}
              onChange={setFs}
              tz={tz}
              onTzChange={setTz}
              detectedTz={detectedTz}
              blankIsMachine={blankIsMachine}
              idPrefix="scheduled-task"
              testIds={{ when: "scheduled-task-when", kind: "scheduled-task-type", tz: "scheduled-task-tz" }}
            />
          )}

          <KitField label="Instructions" htmlFor="scheduled-task-prompt" help="Each run's new agent starts with these, word for word.">
            <KitTextarea
              id="scheduled-task-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={8}
              placeholder="What should the agent handling this task do?"
              data-testid="scheduled-task-prompt"
            />
          </KitField>

          <KitSettingsGroup>
            <KitSettingsRow
              label="Archive if nothing to report"
              description="If the run goes smoothly, its agent archives itself so it doesn't stay in your sidebar."
              control={
                <KitSwitch
                  checked={archive}
                  onCheckedChange={setArchive}
                  aria-label="Archive if nothing to report"
                  data-testid="scheduled-task-archive-if-nothing-to-report"
                />
              }
            />
          </KitSettingsGroup>

          {error && (
            <KitBanner tone="danger" onDismiss={() => setError(null)} data-testid="scheduled-task-error">
              <span className="whitespace-pre-wrap">{error}</span>
            </KitBanner>
          )}

          {!isNew && (
            <div>
              <KitButton
                variant="danger-quiet"
                onClick={() => void remove()}
                disabled={deleting || saving}
                busy={deleting}
                data-testid="scheduled-task-delete"
              >
                {deleting ? "Deleting…" : "Delete scheduled task…"}
              </KitButton>
            </div>
          )}
        </div>
      </div>
      <ModalFoot>
        <KitButton disabled={saving || deleting} onClick={onDone} data-testid="scheduled-task-cancel">
          Cancel
        </KitButton>
        <KitButton
          variant="primary"
          busy={saving}
          disabled={!canSubmit}
          onClick={() => void submit()}
          data-testid="scheduled-task-save"
        >
          {saving ? "Saving…" : isNew ? "Create" : "Save"}
        </KitButton>
      </ModalFoot>
    </>
  );
}
