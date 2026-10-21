// Phase 135 Plan 135-02 Task 1 — ScheduledAgentsModalForm: create/edit form
// subcomponent rendered when ScheduledAgentsModal is in the "form" view (D-19, D-27).
//
// Locked field layout (D-20 + prototype § C, in order):
//   1) Name (single-line input) — disabled on edit-mode per RESEARCH Pitfall
//      #5 (PATCH's name-vs-slug gate rejects renames-via-patch with 400).
//      Helper text below explains delete-and-recreate is the rename path.
//   2) Prompt (textarea, min-height ~96px) — hint copy verbatim from the
//      shape file § Shape.
//   3) Roles (multi-select chip-picker) — populated via listRolesForHost when
//      a host is selected; dim "Pick a host first" when none. Zero roles is
//      allowed but must be picked deliberately: a "No roles" chip leads the
//      list, exclusive with the roles (same choice as the new-conversation
//      dialog). Save stays disabled until "No roles" or a role is picked.
//   4) Host (single-select chip-picker) — disabled on edit-mode per D-21
//      (cross-host management is delete-and-recreate). Auto-selects the
//      single available host per Phase 84 CreateProjectModal pattern. Only
//      machines that can host agents (runsFleetSubstrate) are offered.
//   4b) Project (single select) — "No project" or any project on the
//      selected host, sub-projects indented in sidebar order. Picking a
//      different host clears it. A task whose project is gone opens with
//      that project still picked, marked missing, and keeps it on save.
//   5) Schedule (segmented control) — Daily / Weekly / Monthly / Yearly /
//      Interval / One-shot, backed by WakeupFormShared.FormSchedule
//      discriminated union + hydrateFormSchedule / buildSchedule /
//      validateForm helpers and its shared field groups (times, monthly
//      day, every-N / start / window / ends).
//      Weekly is a single-day segmented control (RESEARCH Assumption A4).
//      The optional day-of-week gate component from WakeupFormShared is
//      deliberately NOT rendered in v1 — hand-editors can still set
//      `schedule.days` on disk; hydrateFormSchedule carries it (and any
//      other field the form doesn't show) through to the save.
//
// Footer: Cancel (left) + Save (right, primary blue) per D-19. Save
// disabled while inflight OR when validateForm returns a message.
//
// Error banner: inline at top of form body, role="alert", API message
// verbatim per D-25. Dismissible + auto-clears on successful save.
//
// Round-trip preservation: preserve nested `schedule.timezone` (and, via
// hydrateFormSchedule, `schedule.days` and other unshown fields) on
// edit-save. The modal only mutates fields it actually shows; hand-editor-only
// fields (timezone that wasn't picked in the UI, weekday-restrict `days`
// gate) survive round-trip untouched. Matches the shape's "two paths in, one truth out" spirit —
// agents editing on disk and the UI editing through the modal are peers.
// (Amended 2026-09-24 during /close per user call: "agents are the only
// ones who are going to be editing scheduled agents on disk, so whatever
// would cause less problems here" → preserve everything the UI doesn't touch.)
//
// Threat mitigations (from 129-02-PLAN.md § threat_model):
//   - T-129-06 (XSS via error banner): server errors are React text-children
//     (`{error}`), NEVER dangerouslySetInnerHTML.
//   - T-129-07 (double-click on Save creating duplicate specs):
//     `submitInFlightRef` guard mirrors NewConversationModal.tsx:193-199.
//   - T-129-08 (rename-via-PATCH creates name-slug drift): Name input
//     disabled on edit-mode.
//   - T-129-09 (host swap on edit): Host chip-picker disabled on edit-mode.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  type FormSchedule,
  type IntervalUnit,
  buildSchedule,
  detectBrowserTimezone,
  hydrateFormSchedule,
  isSensorSchedule,
  isOnceSensorSchedule,
  sensorScheduleLabel,
  MonthlyDayFields,
  ScheduleRepeatFields,
  switchScheduleKind,
  TimesField,
  validateForm,
  WEEKDAY_VALUES,
  type Weekday,
  YearlyDateFields,
} from "@/features/pretty-view/WakeupFormShared";
import { SensorDetails } from "@/features/pretty-view/SensorStatusView";
import {
  createScheduledAgent,
  listScheduledAgentProjects,
  updateScheduledAgent,
  type ScheduledAgentProjectOption,
  type ScheduledAgentSpecWire,
  type ScheduledAgentListItem,
} from "@/api/scheduled-agents-api";
import { orderProjectsAsTree, projectPathFromOptions } from "./scheduled-agents-projects";
import { listRolesForHost, type RoleSummary } from "@/api/identities-api";
import { roleDisplayName } from "@/lib/role-display-name";
import type { Host } from "@/types/ui-types";

// ---------------------------------------------------------------------------
// Error mapping (verbatim adapt of CreateProjectModal.tsx:76-97,
// scheduled-agents framing per PATTERNS.md § Error mapping and D-25).
// ---------------------------------------------------------------------------

function statusOf(err: unknown): number | undefined {
  if (err !== null && typeof err === "object" && "status" in err) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return undefined;
}

function interpretError(err: unknown, rawName: string): string {
  const status = statusOf(err);
  if (status === 409) {
    return `A scheduled task named "${rawName}" already exists on this host — pick a different name.`;
  }
  if (status === 400) {
    const msg = err instanceof Error ? err.message : "";
    return msg || "Scheduled task schedule is malformed — check the fields.";
  }
  return err instanceof Error && err.message.length > 0
    ? err.message
    : "Couldn't save scheduled task — try again.";
}

// ---------------------------------------------------------------------------
// Chip-picker chrome tokens (magenta = selected, dim = addable). Mirrors
// the row's role-chip tokens from ScheduledAgentsModalRow.tsx.
// ---------------------------------------------------------------------------

const ROLE_CHIP_SELECTED = {
  background: "hsla(285, 55%, 55%, 0.28)",
  border: "1px solid hsla(285, 55%, 60%, 0.55)",
  color: "hsla(285, 60%, 88%, 1)",
} as const;

const ROLE_CHIP_ADDABLE = {
  background: "rgba(255, 255, 255, 0.04)",
  border: "1px solid rgba(220, 225, 245, 0.14)",
  color: "var(--color-pv-fg-muted)",
} as const;

const HOST_CHIP_SELECTED = {
  background: "hsla(220, 65%, 55%, 0.32)",
  border: "1px solid hsla(220, 65%, 60%, 0.55)",
  color: "#f4f1e8",
} as const;

const HOST_CHIP_ADDABLE = {
  background: "rgba(255, 255, 255, 0.04)",
  border: "1px solid rgba(220, 225, 245, 0.14)",
  color: "var(--color-pv-fg-muted)",
} as const;

const SCHEDULE_KIND_ACTIVE = {
  background: "hsla(220, 65%, 55%, 0.35)",
  border: "1px solid hsla(220, 65%, 60%, 0.55)",
  color: "#f4f1e8",
} as const;

const SCHEDULE_KIND_INACTIVE = {
  background: "rgba(255, 255, 255, 0.04)",
  border: "1px solid rgba(220, 225, 245, 0.14)",
  color: "var(--color-pv-fg-muted)",
} as const;

const SCHEDULE_LABEL_CLASS = "text-[11px] text-[color:var(--color-pv-fg-muted)]";
const SCHEDULE_INPUT_CLASS = cn(
  "px-2 py-1 rounded-md text-sm text-[#e8e4d8]",
  "bg-black/20 border border-white/10 outline-none",
  "focus:border-[hsla(220,65%,55%,0.5)]",
);

const PICK_ROLES_HINT = "Pick roles, or No roles.";

// ---------------------------------------------------------------------------
// Weekday label helper
// ---------------------------------------------------------------------------

const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ScheduledAgentsModalFormProps {
  mode: "create" | "edit";
  initialSpec: ScheduledAgentListItem | null;
  flatHosts: Host[];
  onCancel: () => void;
  /** Fires on successful save. `optimistic` carries a fresh row the parent
   *  splices into its list immediately (prepend on CREATE, replace-by-key
   *  on EDIT) so changes are visible before the authoritative refetch's
   *  SSH fan-out resolves. Refetch overlays with server-canonical fields
   *  (scheduleHuman, colorHue) a moment later. Null-safe for defensive
   *  callers but every save path currently supplies a row.
   *  (UAT 2026-10-01.) */
  onSaved: (optimistic: ScheduledAgentListItem | null) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScheduledAgentsModalForm({
  mode,
  initialSpec,
  flatHosts,
  onCancel,
  onSaved,
}: ScheduledAgentsModalFormProps): JSX.Element {
  const { t } = useTranslation();
  // ─── Form state ──────────────────────────────────────────────────────
  const [name, setName] = useState<string>(initialSpec?.name ?? "");
  const [prompt, setPrompt] = useState<string>(initialSpec?.prompt ?? "");
  const [archiveIfNothingToReport, setArchiveIfNothingToReport] = useState<boolean>(
    initialSpec?.archive_if_nothing_to_report ?? false,
  );
  const [selectedRoles, setSelectedRoles] = useState<string[]>(
    initialSpec?.roles ?? [],
  );
  // "No roles" picked — never true while selectedRoles is non-empty. Not
  // preselected for a new task (the user must choose); an existing task
  // saved with `roles: []` opens with it picked.
  const [noRoles, setNoRoles] = useState<boolean>(
    initialSpec !== null && (initialSpec.roles ?? []).length === 0,
  );
  const rolesPicked = noRoles || selectedRoles.length > 0;

  // Scheduled tasks spawn agents, so a new task can only go to a machine that
  // can host agents (runs the fleet substrate) — same set the new-conversation
  // dialog offers in agent mode. Edit mode resolves its locked host from the
  // full list below.
  const agentHosts = useMemo(
    () => flatHosts.filter((h) => h.runsFleetSubstrate === true),
    [flatHosts],
  );

  // Host — for edit mode, resolve from initialSpec.hostId (best-effort
  // match against flatHosts). For create mode, null until user picks.
  const initialHost = useMemo<Host | null>(() => {
    if (initialSpec === null) return null;
    const match = flatHosts.find(
      (h) => parseInt(String(h.id), 10) === initialSpec.hostId,
    );
    return match ?? null;
  }, [initialSpec, flatHosts]);

  const [selectedHost, setSelectedHost] = useState<Host | null>(initialHost);

  // Schedule state — hydrate from initialSpec.schedule on edit; default
  // to daily 09:00 on create.
  const [formSchedule, setFormSchedule] = useState<FormSchedule>(() =>
    initialSpec !== null
      ? hydrateFormSchedule(initialSpec.schedule)
      : { type: "daily", at: "09:00" },
  );

  // Round-trip preservation slot (Option C): keep the raw initialSpec so
  // `schedule.timezone` survives an edit-save round-trip.
  const initialSpecRef = useRef<ScheduledAgentListItem | null>(initialSpec);

  // A sensor-fired task ({type: "sensor"}) has no clock schedule to edit:
  // the form shows it read-only and saves the schedule object unchanged.
  // Only reachable in edit mode — the app never creates one.
  const isSensor = mode === "edit" && initialSpec !== null && isSensorSchedule(initialSpec.schedule);

  // Available roles for the currently-selected host (chip-picker source).
  const [availableRoles, setAvailableRoles] = useState<RoleSummary[]>([]);

  // Project the task's conversations are filed in (null = No project), and
  // the selected host's projects — null until loaded (or if the read failed),
  // so a saved project isn't called missing before we know.
  const [selectedProject, setSelectedProject] = useState<string | null>(
    initialSpec?.project ?? null,
  );
  const [availableProjects, setAvailableProjects] = useState<ScheduledAgentProjectOption[] | null>(null);

  // Inline error banner (D-25).
  const [error, setError] = useState<string | null>(null);

  // In-flight guard for Save button.
  const [inFlight, setInFlight] = useState<boolean>(false);
  const submitInFlightRef = useRef<boolean>(false);

  // ─── Auto-select single available host (Phase 84 pattern) ────────────
  // Only in create mode — edit mode inherits initialHost above.
  useEffect(() => {
    if (mode === "create" && agentHosts.length === 1 && selectedHost === null) {
      setSelectedHost(agentHosts[0]);
    }
  }, [mode, agentHosts, selectedHost]);

  // ─── Fetch roles for the selected host ────────────────────────────────
  useEffect(() => {
    if (selectedHost === null) {
      setAvailableRoles([]);
      return;
    }
    const hostIdNum = parseInt(String(selectedHost.id), 10);
    if (!Number.isFinite(hostIdNum)) {
      setAvailableRoles([]);
      return;
    }
    let alive = true;
    listRolesForHost(hostIdNum)
      .then((rows) => {
        if (alive) setAvailableRoles(rows);
      })
      .catch(() => {
        if (alive) setAvailableRoles([]);
      });
    return () => {
      alive = false;
    };
  }, [selectedHost]);

  // ─── Fetch projects for the selected host ─────────────────────────────
  useEffect(() => {
    setAvailableProjects(null);
    if (selectedHost === null) return;
    const hostIdNum = parseInt(String(selectedHost.id), 10);
    if (!Number.isFinite(hostIdNum)) return;
    let alive = true;
    listScheduledAgentProjects(hostIdNum)
      .then((rows) => {
        if (alive) setAvailableProjects(rows);
      })
      .catch(() => {
        /* stays null — the picker still offers No project + the saved pick */
      });
    return () => {
      alive = false;
    };
  }, [selectedHost]);

  // Picking a different host clears the project — projects belong to one host.
  const pickHost = useCallback((h: Host): void => {
    if (selectedHost?.id !== h.id) setSelectedProject(null);
    setSelectedHost(h);
  }, [selectedHost]);

  // ─── Save handler (in-flight ref guard per NewConversationModal:193-199) ──
  const onSave = useCallback(async () => {
    if (submitInFlightRef.current) return;

    // Client-side validation (D-23 minimal): required fields + schedule.
    const trimmedName = name.trim();
    const trimmedPrompt = prompt.trim();

    if (trimmedName.length === 0) {
      setError("Name is required.");
      return;
    }
    if (trimmedPrompt.length === 0) {
      setError("Instructions are required.");
      return;
    }
    if (selectedHost === null) {
      setError("Pick a host to save.");
      return;
    }
    if (!rolesPicked) {
      setError(PICK_ROLES_HINT);
      return;
    }
    const scheduleError = isSensor ? null : validateForm(formSchedule);
    if (scheduleError !== null) {
      setError(scheduleError);
      return;
    }

    const hostIdNum = parseInt(String(selectedHost.id), 10);
    if (!Number.isFinite(hostIdNum) || hostIdNum <= 0) {
      setError("Selected host has an invalid id — pick a different host.");
      return;
    }

    submitInFlightRef.current = true;
    setInFlight(true);
    setError(null);

    try {
      // Round-trip preservation: merge form fields with the raw initialSpec's
      // `schedule.timezone`. The modal only mutates fields it actually
      // shows; hand-editor-only fields survive round-trip untouched (the
      // rest ride along in formSchedule via hydrateFormSchedule).
      // (Amended 2026-09-24 during /close — see the file header for rationale.)
      const tz = detectBrowserTimezone();
      const scheduleObj: Record<string, unknown> = isSensor
        ? (initialSpecRef.current!.schedule as Record<string, unknown>)
        : buildSchedule(formSchedule, tz);

      // Preserve the raw spec's timezone. buildSchedule already emits
      // `timezone` from the detected browser zone, but this preserves the
      // ORIGINAL zone when the user hand-picked one on disk.
      if (
        !isSensor &&
        mode === "edit" &&
        initialSpecRef.current !== null &&
        typeof initialSpecRef.current.schedule === "object" &&
        initialSpecRef.current.schedule !== null
      ) {
        const rawSched = initialSpecRef.current.schedule as Record<
          string,
          unknown
        >;
        if (typeof rawSched.timezone === "string" && rawSched.timezone.length > 0) {
          scheduleObj.timezone = rawSched.timezone;
        }
      }

      const enabledPassthrough =
        mode === "edit" && initialSpecRef.current !== null
          ? initialSpecRef.current.enabled
          : true;

      const spec: ScheduledAgentSpecWire = {
        name: mode === "edit" ? initialSpecRef.current!.name : trimmedName,
        prompt: trimmedPrompt,
        schedule: scheduleObj,
        roles: noRoles ? [] : selectedRoles,
        enabled: enabledPassthrough,
        archive_if_nothing_to_report: archiveIfNothingToReport,
        ...(selectedProject !== null ? { project: selectedProject } : {}),
      };
      const projectPath =
        selectedProject !== null && availableProjects !== null
          ? projectPathFromOptions(selectedProject, availableProjects)
          : null;
      const projectFields = {
        project: selectedProject,
        projectPath,
        projectMissing:
          selectedProject !== null && availableProjects !== null && projectPath === null,
      };

      if (mode === "create") {
        const created = await createScheduledAgent(hostIdNum, spec);
        // Optimistic row — the authoritative refetch will replace it with
        // the server's canonical shape (scheduleHuman, colorHue, etc).
        const optimistic: ScheduledAgentListItem = {
          slug: created.slug,
          host: selectedHost.name,
          hostId: hostIdNum,
          name: trimmedName,
          enabled: true,
          schedule: scheduleObj,
          scheduleHuman: "",
          prompt: trimmedPrompt,
          roles: noRoles ? [] : selectedRoles,
          archive_if_nothing_to_report: archiveIfNothingToReport,
          ...projectFields,
            colorHue: null,
          // Fire timestamps unknown on just-created rows — the authoritative
          // refetch replaces them once the server reads .state/<slug>.last
          // and computes nextFireAt. Nullable is wire-correct (same shape
          // as any row whose sentinel hasn't been written yet).
          lastFiredAt: null,
          nextFireAt: null,
        };
        onSaved(optimistic);
      } else {
        await updateScheduledAgent(initialSpecRef.current!.slug, hostIdNum, spec);
        // Edit-side optimistic update — splice-replace the existing row
        // with the new form values immediately (same (hostId, slug) key).
        // Refetch overlays with the server-canonical shape.
        const prev = initialSpecRef.current!;
        const optimistic: ScheduledAgentListItem = {
          slug: prev.slug,
          host: selectedHost.name,
          hostId: hostIdNum,
          name: prev.name, // name is immutable on edit (D-20)
          enabled: enabledPassthrough,
          schedule: scheduleObj,
          scheduleHuman: prev.scheduleHuman,
          prompt: trimmedPrompt,
          roles: noRoles ? [] : selectedRoles,
          archive_if_nothing_to_report: archiveIfNothingToReport,
          ...(availableProjects === null && selectedProject === prev.project
            ? { project: prev.project, projectPath: prev.projectPath, projectMissing: prev.projectMissing }
            : projectFields),
            colorHue: prev.colorHue,
          // Preserve the server-known fire timestamps during optimistic
          // edit — the refetch will overlay with a recomputed nextFireAt
          // reflecting the new schedule.
          lastFiredAt: prev.lastFiredAt,
          nextFireAt: prev.nextFireAt,
        };
        onSaved(optimistic);
      }
    } catch (err) {
      setError(interpretError(err, trimmedName));
    } finally {
      submitInFlightRef.current = false;
      setInFlight(false);
    }
  }, [
    mode,
    name,
    prompt,
    archiveIfNothingToReport,
    selectedRoles,
    noRoles,
    rolesPicked,
    selectedHost,
    selectedProject,
    availableProjects,
    formSchedule,
    isSensor,
    onSaved,
  ]);

  // ─── Chip toggle helpers ──────────────────────────────────────────────
  // Picking a role clears "No roles"; unticking the last role leaves nothing
  // picked (the user chooses again — no silent fall back to "No roles").
  const toggleRole = useCallback((roleName: string): void => {
    setNoRoles(false);
    setSelectedRoles((current) =>
      current.includes(roleName)
        ? current.filter((r) => r !== roleName)
        : [...current, roleName],
    );
  }, []);

  const removeRole = useCallback((roleName: string): void => {
    setSelectedRoles((current) => current.filter((r) => r !== roleName));
  }, []);

  // "No roles" clears any picked roles; clicking it again unpicks it.
  const toggleNoRoles = useCallback((): void => {
    setNoRoles((current) => !current);
    setSelectedRoles([]);
  }, []);
  const noRolesLabel = t("nav.newSessionNoRoles", { defaultValue: "No roles" });

  const addableRoles = useMemo<string[]>(() => {
    const set = new Set(selectedRoles);
    return availableRoles
      .map((r) => r.name)
      .filter((n) => !set.has(n))
      .sort((a, b) => a.localeCompare(b));
  }, [availableRoles, selectedRoles]);

  // Pretty-names shape (2026-09-30): display names for role chips. Chips
  // use the slug as their key / data-testid / state value (that's what
  // gets persisted to disk), but render the role's pretty name for the
  // user. Lookup against availableRoles.
  const roleDisplayByName = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const r of availableRoles) {
      map.set(r.name, roleDisplayName(r.name, r.displayName));
    }
    return map;
  }, [availableRoles]);

  // ─── Project picker options ───────────────────────────────────────────
  const projectOptions = useMemo(
    () => (availableProjects === null ? [] : orderProjectsAsTree(availableProjects)),
    [availableProjects],
  );
  // The saved pick isn't in the host's list — either still loading / unreadable
  // (shown plain) or gone (shown missing). Either way it stays selectable so an
  // unrelated save keeps it.
  const savedProjectUnlisted =
    selectedProject !== null && !projectOptions.some((o) => o.slug === selectedProject);
  const projectMissing = savedProjectUnlisted && availableProjects !== null;

  // ─── Render ───────────────────────────────────────────────────────────
  const nameDisabled = mode === "edit";
  const hostDisabled = mode === "edit";
  // Hide the host picker entirely in create mode when the user has access
  // to only one host — auto-select handles it, and rendering a picker for
  // a single option is noise. Edit mode always shows the locked chip so
  // the user knows which host owns the scheduled agent they're editing.
  const hostFieldHidden = mode === "create" && agentHosts.length === 1;
  const scheduleValidationMsg = isSensor ? null : validateForm(formSchedule);
  const saveDisabled =
    inFlight ||
    scheduleValidationMsg !== null ||
    name.trim().length === 0 ||
    prompt.trim().length === 0 ||
    selectedHost === null ||
    !rolesPicked;

  return (
    <div
      className="flex flex-col flex-1 min-h-0"
      data-testid="scheduled-agents-modal-form"
    >
      {/* ─── Body (scrollable form column) ─────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-4">
        {/* Inline error banner (D-25) */}
        {error !== null && (
          <div
            role="alert"
            data-testid="scheduled-agents-modal-form-error"
            className="px-3 py-2 text-xs rounded-md flex flex-row items-start gap-2"
            style={{
              background: "hsla(0, 60%, 40%, 0.14)",
              border: "1px solid hsla(0, 60%, 55%, 0.30)",
              color: "hsla(0, 60%, 82%, 1)",
            }}
          >
            <span className="flex-1">{error}</span>
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={() => setError(null)}
              className="shrink-0 opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Field 1: Name (D-20 order 1) */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="scheduled-agents-modal-form-name-input"
            className="text-xs font-medium text-[color:var(--color-pv-fg-muted)]"
          >
            Name
          </label>
          <input
            id="scheduled-agents-modal-form-name-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Daily briefing"
            disabled={nameDisabled}
            maxLength={120}
            data-testid="scheduled-agents-modal-form-name"
            className={cn(
              "w-full px-3 py-2 rounded-lg text-sm text-[#e8e4d8]",
              "bg-black/20 border border-white/10 outline-none",
              "focus:border-[hsla(220,65%,55%,0.5)] focus:bg-black/30",
              "placeholder:text-[color:var(--color-pv-fg-dim)]",
              "transition-colors duration-150",
              "disabled:opacity-60 disabled:cursor-not-allowed",
            )}
          />
          {nameDisabled && (
            <p className="text-[11px] text-[color:var(--color-pv-fg-dim)]">
              To rename, delete this scheduled task and create a new one.
            </p>
          )}
        </div>

        {/* Field 2: Instructions (D-20 order 2) */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="scheduled-agents-modal-form-prompt-input"
            className="text-xs font-medium text-[color:var(--color-pv-fg-muted)]"
          >
            Instructions
          </label>
          <textarea
            id="scheduled-agents-modal-form-prompt-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should the agent handling this task do?"
            rows={4}
            data-testid="scheduled-agents-modal-form-prompt"
            className={cn(
              "w-full px-3 py-2 rounded-lg text-sm text-[#e8e4d8] resize-y",
              "bg-black/20 border border-white/10 outline-none min-h-[96px]",
              "focus:border-[hsla(220,65%,55%,0.5)] focus:bg-black/30",
              "placeholder:text-[color:var(--color-pv-fg-dim)]",
              "transition-colors duration-150",
            )}
          />
          <label className="flex items-center gap-1.5 cursor-pointer mt-1 text-xs font-medium text-[color:var(--color-pv-fg-muted)]">
            <input
              type="checkbox"
              checked={archiveIfNothingToReport}
              onChange={(e) => setArchiveIfNothingToReport(e.target.checked)}
              data-testid="scheduled-agents-modal-form-archive-if-nothing-to-report"
              className="w-3.5 h-3.5 accent-sky-500 cursor-pointer"
            />
            Archive if nothing to report
          </label>
          <span className="text-[11px] text-[color:var(--color-pv-fg-dim)]">
            If the run goes smoothly, the agent archives itself so it doesn&apos;t stay in your sidebar.
          </span>
        </div>

        {/* Field 3: Roles (D-20 order 3) */}
        <div
          className="flex flex-col gap-2"
          data-testid="scheduled-agents-modal-form-roles"
        >
          <label className="text-xs font-medium text-[color:var(--color-pv-fg-muted)]">
            Roles
          </label>
          {selectedHost === null ? (
            <p className="text-[11px] text-[color:var(--color-pv-fg-dim)]">
              Pick a host first.
            </p>
          ) : (
            <>
              {/* "No roles" leads the picker — a deliberate choice, exclusive
                  with the roles below. */}
              <div className="flex flex-row flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={toggleNoRoles}
                  role="checkbox"
                  aria-checked={noRoles}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11px] font-medium leading-[16px] cursor-pointer"
                  style={noRoles ? ROLE_CHIP_SELECTED : ROLE_CHIP_ADDABLE}
                  data-testid="scheduled-agents-modal-form-no-roles"
                >
                  <span>{noRolesLabel}</span>
                  {noRoles && <X size={10} />}
                </button>
              </div>
              {/* Selected chips */}
              {selectedRoles.length > 0 && (
                <div className="flex flex-row flex-wrap gap-1.5">
                  {selectedRoles.map((r) => (
                    <button
                      key={`selected-${r}`}
                      type="button"
                      onClick={() => removeRole(r)}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11px] font-medium leading-[16px] cursor-pointer"
                      style={ROLE_CHIP_SELECTED}
                      data-testid={`scheduled-agents-modal-form-role-selected-${r}`}
                    >
                      <span>{roleDisplayByName.get(r) ?? roleDisplayName(r)}</span>
                      <X size={10} />
                    </button>
                  ))}
                </div>
              )}
              {/* Available (addable) chips */}
              {addableRoles.length > 0 && (
                <div className="flex flex-row flex-wrap gap-1.5">
                  {addableRoles.map((r) => (
                    <button
                      key={`addable-${r}`}
                      type="button"
                      onClick={() => toggleRole(r)}
                      className="inline-flex items-center rounded-full px-2 py-[2px] text-[11px] font-medium leading-[16px] cursor-pointer"
                      style={ROLE_CHIP_ADDABLE}
                      data-testid={`scheduled-agents-modal-form-role-addable-${r}`}
                    >
                      {roleDisplayByName.get(r) ?? roleDisplayName(r)}
                    </button>
                  ))}
                </div>
              )}
              {!rolesPicked && (
                <p
                  className="text-[11px] text-[color:var(--color-pv-fg-dim)]"
                  data-testid="scheduled-agents-modal-form-roles-hint"
                >
                  {PICK_ROLES_HINT}
                </p>
              )}
            </>
          )}
        </div>

        {/* Field 4: Host (D-20 order 4).
            Hidden entirely in create mode when the user has access to only
            one host (auto-select covers it). Amended 2026-09-24 during /close. */}
        {!hostFieldHidden && (
        <div
          className="flex flex-col gap-2"
          data-testid="scheduled-agents-modal-form-host"
        >
          <label className="text-xs font-medium text-[color:var(--color-pv-fg-muted)]">
            Host
          </label>
          {hostDisabled ? (
            <>
              <div className="flex flex-row flex-wrap gap-1.5">
                <span
                  className="inline-flex items-center rounded-full px-3 py-1 text-[12px] font-medium"
                  style={{
                    ...HOST_CHIP_SELECTED,
                    opacity: 0.75,
                  }}
                  data-testid="scheduled-agents-modal-form-host-locked"
                >
                  {selectedHost?.name ?? initialSpec?.host ?? "unknown"}
                </span>
              </div>
              <p className="text-[11px] text-[color:var(--color-pv-fg-dim)]">
                Host cannot be changed on an existing scheduled task. Delete and
                recreate on the target host if needed.
              </p>
            </>
          ) : (
            <div className="flex flex-row flex-wrap gap-1.5">
              {agentHosts.length === 0 && (
                <p className="text-[11px] text-[color:var(--color-pv-fg-dim)]">
                  No hosts available.
                </p>
              )}
              {agentHosts.map((h) => {
                const active = selectedHost?.id === h.id;
                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => pickHost(h)}
                    className="inline-flex items-center rounded-full px-3 py-1 text-[12px] font-medium leading-[16px] cursor-pointer"
                    style={active ? HOST_CHIP_SELECTED : HOST_CHIP_ADDABLE}
                    data-testid={`scheduled-agents-modal-form-host-option-${h.id}`}
                  >
                    {h.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        )}

        {/* Field 4b: Project — where each conversation this task starts is filed. */}
        <div
          className="flex flex-col gap-1"
          data-testid="scheduled-agents-modal-form-project"
        >
          <label
            htmlFor="scheduled-agents-modal-form-project-select"
            className="text-xs font-medium text-[color:var(--color-pv-fg-muted)]"
          >
            Project
          </label>
          {selectedHost === null ? (
            <p className="text-[11px] text-[color:var(--color-pv-fg-dim)]">
              Pick a host first.
            </p>
          ) : (
            <>
              <select
                id="scheduled-agents-modal-form-project-select"
                data-testid="scheduled-agents-modal-form-project-select"
                value={selectedProject ?? ""}
                onChange={(e) => setSelectedProject(e.target.value === "" ? null : e.target.value)}
                className={cn(SCHEDULE_INPUT_CLASS, "w-full")}
              >
                <option value="">No project</option>
                {projectOptions.map((o) => (
                  <option key={o.slug} value={o.slug}>
                    {"\u00a0\u00a0\u00a0\u00a0".repeat(o.depth) + o.displayName}
                  </option>
                ))}
                {savedProjectUnlisted && selectedProject !== null && (
                  <option value={selectedProject}>
                    {projectMissing ? `${selectedProject} (missing)` : selectedProject}
                  </option>
                )}
              </select>
              {projectMissing ? (
                <p
                  className="text-[11px] text-[hsla(35,85%,70%,1)]"
                  data-testid="scheduled-agents-modal-form-project-missing"
                >
                  This project no longer exists. Conversations go to Conversations until it&apos;s back or you pick another.
                </p>
              ) : (
                <p className="text-[11px] text-[color:var(--color-pv-fg-dim)]">
                  Each conversation this task starts is filed here.
                </p>
              )}
            </>
          )}
        </div>

        {/* Field 5: Schedule (D-20 order 5, D-22 kinds) */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-[color:var(--color-pv-fg-muted)]">
            Schedule
          </label>

          {isSensor ? (
            <>
            <span
              className="text-sm text-[#e8e4d8]"
              data-testid="scheduled-agents-modal-form-schedule-sensor"
            >
              {sensorScheduleLabel(initialSpec?.schedule)}
            </span>
            {initialSpec?.sensor && (
              <SensorDetails
                sensor={initialSpec.sensor}
                lastFiredAt={initialSpec.lastFiredAt}
                once={isOnceSensorSchedule(initialSpec.schedule)}
                testId="scheduled-agents-modal-form-sensor-details"
              />
            )}
            </>
          ) : (
          <>
          {/* Segmented control — kind picker */}
          <div
            className="flex flex-row flex-wrap gap-1 rounded-md p-1"
            data-testid="scheduled-agents-modal-form-schedule-kind"
            style={{
              background: "rgba(0, 0, 0, 0.20)",
              border: "1px solid rgba(220, 225, 245, 0.10)",
            }}
          >
            {(
              [
                { key: "daily", label: "Daily" },
                { key: "weekly", label: "Weekly" },
                { key: "monthly", label: "Monthly" },
                { key: "yearly", label: "Yearly" },
                { key: "interval", label: "Interval" },
                { key: "one_shot", label: "One-shot" },
              ] as const
            ).map(({ key, label }) => {
              const active = formSchedule.type === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFormSchedule(switchScheduleKind(formSchedule, key))}
                  className="flex-1 min-w-[56px] px-2 py-1 rounded text-[11px] font-medium cursor-pointer transition-colors duration-150"
                  style={active ? SCHEDULE_KIND_ACTIVE : SCHEDULE_KIND_INACTIVE}
                  data-testid={`scheduled-agents-modal-form-schedule-kind-${key}`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Contextual detail fields per kind */}
          {formSchedule.type === "daily" && (
            <TimesField
              at={formSchedule.at}
              onChange={(at) => setFormSchedule({ ...formSchedule, at })}
              label="At"
              idPrefix="scheduled-agents-modal-form-schedule-daily-at"
              inputClassName={SCHEDULE_INPUT_CLASS}
              labelClassName={SCHEDULE_LABEL_CLASS}
            />
          )}

          {formSchedule.type === "weekly" && (
            <div className="flex flex-col gap-2">
              <div
                className="flex flex-row gap-1 rounded-md p-1"
                data-testid="scheduled-agents-modal-form-schedule-weekly-day"
                style={{
                  background: "rgba(0, 0, 0, 0.20)",
                  border: "1px solid rgba(220, 225, 245, 0.10)",
                }}
              >
                {WEEKDAY_VALUES.map((d) => {
                  const active = formSchedule.day === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setFormSchedule({ ...formSchedule, day: d })}
                      className="flex-1 px-1 py-1 rounded text-[10px] font-medium uppercase tracking-wide cursor-pointer transition-colors duration-150"
                      style={active ? SCHEDULE_KIND_ACTIVE : SCHEDULE_KIND_INACTIVE}
                      data-testid={`scheduled-agents-modal-form-schedule-weekly-day-${d}`}
                    >
                      {WEEKDAY_LABELS[d]}
                    </button>
                  );
                })}
              </div>
              <TimesField
                at={formSchedule.at}
                onChange={(at) => setFormSchedule({ ...formSchedule, at })}
                label="At"
                idPrefix="scheduled-agents-modal-form-schedule-weekly-at"
                inputClassName={SCHEDULE_INPUT_CLASS}
                labelClassName={SCHEDULE_LABEL_CLASS}
              />
            </div>
          )}

          {formSchedule.type === "monthly" && (
            <div className="flex flex-col gap-2">
              <MonthlyDayFields
                value={formSchedule}
                onChange={setFormSchedule}
                idPrefix="scheduled-agents-modal-form-schedule-monthly"
                inputClassName={SCHEDULE_INPUT_CLASS}
                labelClassName={SCHEDULE_LABEL_CLASS}
              />
              <TimesField
                at={formSchedule.at}
                onChange={(at) => setFormSchedule({ ...formSchedule, at })}
                label="At"
                idPrefix="scheduled-agents-modal-form-schedule-monthly-at"
                inputClassName={SCHEDULE_INPUT_CLASS}
                labelClassName={SCHEDULE_LABEL_CLASS}
              />
            </div>
          )}

          {formSchedule.type === "yearly" && (
            <div className="flex flex-row items-end gap-2 flex-wrap">
              <YearlyDateFields
                date={formSchedule.date}
                onChange={(date) => setFormSchedule({ ...formSchedule, date })}
                idPrefix="scheduled-agents-modal-form-schedule-yearly"
                labelClassName={SCHEDULE_LABEL_CLASS}
                inputClassName={SCHEDULE_INPUT_CLASS}
              />
              <TimesField
                at={formSchedule.at}
                onChange={(at) => setFormSchedule({ ...formSchedule, at })}
                label="At"
                idPrefix="scheduled-agents-modal-form-schedule-yearly-at"
                inputClassName={SCHEDULE_INPUT_CLASS}
                labelClassName={SCHEDULE_LABEL_CLASS}
              />
            </div>
          )}

          {formSchedule.type === "interval" && (
            <div className="flex flex-row flex-wrap items-center gap-2">
              <label className="text-[11px] text-[color:var(--color-pv-fg-muted)]">
                Every
              </label>
              <input
                type="number"
                min={1}
                value={formSchedule.n}
                onChange={(e) => {
                  const parsed = parseInt(e.target.value, 10);
                  setFormSchedule({
                    ...formSchedule,
                    n: Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
                  });
                }}
                data-testid="scheduled-agents-modal-form-schedule-interval-n"
                className={cn(
                  "w-20 px-2 py-1 rounded-md text-sm text-[#e8e4d8]",
                  "bg-black/20 border border-white/10 outline-none",
                  "focus:border-[hsla(220,65%,55%,0.5)]",
                )}
              />
              <select
                value={formSchedule.u}
                onChange={(e) =>
                  setFormSchedule({
                    ...formSchedule,
                    u: e.target.value as IntervalUnit,
                  })
                }
                data-testid="scheduled-agents-modal-form-schedule-interval-u"
                className="px-2 py-1 rounded-md text-sm text-[#e8e4d8] bg-black/20 border border-white/10 outline-none cursor-pointer"
              >
                <option value="s">seconds</option>
                <option value="m">minutes</option>
                <option value="h">hours</option>
                <option value="d">days</option>
                <option value="mo">months</option>
              </select>
            </div>
          )}

          {formSchedule.type === "one_shot" && (
            <div className="flex flex-row items-center gap-2">
              <label className="text-[11px] text-[color:var(--color-pv-fg-muted)]">
                At
              </label>
              <input
                type="datetime-local"
                value={formSchedule.at}
                onChange={(e) =>
                  setFormSchedule({ type: "one_shot", at: e.target.value })
                }
                data-testid="scheduled-agents-modal-form-schedule-oneshot-at"
                className={cn(
                  "px-2 py-1 rounded-md text-sm text-[#e8e4d8]",
                  "bg-black/20 border border-white/10 outline-none",
                  "focus:border-[hsla(220,65%,55%,0.5)]",
                )}
              />
            </div>
          )}

          {formSchedule.type !== "one_shot" && (
            <ScheduleRepeatFields
              fs={formSchedule}
              onChange={setFormSchedule}
              idPrefix="scheduled-agents-modal-form-schedule"
              inputClassName={SCHEDULE_INPUT_CLASS}
              labelClassName={SCHEDULE_LABEL_CLASS}
            />
          )}
          </>
          )}

          {scheduleValidationMsg !== null && (
            <p className="text-[11px] text-red-400">{scheduleValidationMsg}</p>
          )}
        </div>
      </div>

      {/* ─── Footer (Cancel left, Save right) — D-19 ─────────────────── */}
      <div
        className="px-4 py-3 shrink-0 flex flex-row items-center justify-between"
        style={{ borderTop: "1px solid rgba(220, 225, 245, 0.10)" }}
      >
        <button
          type="button"
          onClick={onCancel}
          data-testid="scheduled-agents-modal-form-cancel"
          className="px-3 py-1.5 rounded-md text-xs cursor-pointer transition-colors duration-150"
          style={{
            background: "rgba(255, 255, 255, 0.04)",
            border: "1px solid rgba(220, 225, 245, 0.10)",
            color: "#e8e4d8",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            void onSave();
          }}
          disabled={saveDisabled}
          data-testid="scheduled-agents-modal-form-save"
          className={cn(
            "px-4 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-colors duration-150",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
          style={{
            background: "hsla(220, 65%, 45%, 0.75)",
            border: "1px solid hsla(220, 65%, 55%, 0.7)",
            color: "#f4f1e8",
          }}
        >
          {inFlight ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
