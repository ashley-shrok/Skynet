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
//      machines that can host agents (canHostAgents) are offered.
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
// Footer: ModalFoot with Cancel + Save (kit buttons) per D-19. Save
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
import { useTranslation } from "react-i18next";
import { ModalFoot } from "@/components/modal";
import {
  KitBanner,
  KitButton,
  KitCheckbox,
  KitChip,
  KitField,
  KitInput,
  KitOption,
  KitPickChip,
  KitPickRow,
  KitSegmented,
  KitSelect,
  KitTextarea,
} from "@/components/kit";
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
  ScheduleKindField,
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
  updateScheduledAgent,
  type ScheduledAgentSpecWire,
  type ScheduledAgentListItem,
} from "@/api/scheduled-agents-api";
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
    () => flatHosts.filter((h) => h.canHostAgents === true),
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

  // Role chips: selected roles first (including any the host no longer
  // lists), then the addable ones. Tap toggles.
  const roleChips: Array<{ name: string; selected: boolean }> = [
    ...selectedRoles.map((r) => ({ name: r, selected: true })),
    ...addableRoles.map((r) => ({ name: r, selected: false })),
  ];

  return (
    <div
      className="flex flex-col flex-1 min-h-0"
      data-testid="scheduled-agents-modal-form"
    >
      {/* ─── Body (scrollable form column) ─────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 max-sm:px-5 py-3 flex flex-col gap-5">
        {/* Inline error banner (D-25) */}
        {error !== null && (
          <KitBanner
            tone="danger"
            data-testid="scheduled-agents-modal-form-error"
            onDismiss={() => setError(null)}
          >
            {error}
          </KitBanner>
        )}

        {/* Field 1: Name (D-20 order 1) */}
        <KitField
          label="Name"
          htmlFor="scheduled-agents-modal-form-name-input"
          help={nameDisabled ? "To rename, delete this scheduled task and create a new one." : undefined}
        >
          <KitInput
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Daily briefing"
            disabled={nameDisabled}
            maxLength={120}
            data-testid="scheduled-agents-modal-form-name"
          />
        </KitField>

        {/* Field 2: Instructions (D-20 order 2) */}
        <KitField label="Instructions" htmlFor="scheduled-agents-modal-form-prompt-input">
          <KitTextarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should the agent handling this task do?"
            rows={4}
            data-testid="scheduled-agents-modal-form-prompt"
          />
        </KitField>
        <KitOption
          label="Archive if nothing to report"
          description="If the run goes smoothly, the agent archives itself so it doesn't stay in your sidebar."
          control={
            <KitCheckbox
              checked={archiveIfNothingToReport}
              onCheckedChange={setArchiveIfNothingToReport}
              data-testid="scheduled-agents-modal-form-archive-if-nothing-to-report"
            />
          }
        />

        {/* Field 3: Roles (D-20 order 3) */}
        <KitField
          label="Roles"
          data-testid="scheduled-agents-modal-form-roles"
          help={
            selectedHost === null ? (
              "Pick a host first."
            ) : !rolesPicked ? (
              <span data-testid="scheduled-agents-modal-form-roles-hint">
                {PICK_ROLES_HINT}
              </span>
            ) : undefined
          }
        >
          {selectedHost !== null && (
            <KitPickRow aria-label="Roles">
              {/* "No roles" leads the picker — a deliberate choice, exclusive
                  with the roles after it. */}
              <KitPickChip
                pressed={noRoles}
                onPressedChange={toggleNoRoles}
                data-testid="scheduled-agents-modal-form-no-roles"
              >
                {noRolesLabel}
              </KitPickChip>
              {roleChips.map(({ name: r, selected }) => (
                <KitPickChip
                  key={r}
                  pressed={selected}
                  onPressedChange={() => toggleRole(r)}
                  data-testid={
                    selected
                      ? `scheduled-agents-modal-form-role-selected-${r}`
                      : `scheduled-agents-modal-form-role-addable-${r}`
                  }
                >
                  {roleDisplayByName.get(r) ?? roleDisplayName(r)}
                </KitPickChip>
              ))}
            </KitPickRow>
          )}
        </KitField>

        {/* Field 4: Host (D-20 order 4).
            Hidden entirely in create mode when the user has access to only
            one host (auto-select covers it). Amended 2026-09-24 during /close. */}
        {!hostFieldHidden && (
          <KitField
            label="Host"
            data-testid="scheduled-agents-modal-form-host"
            help={
              hostDisabled
                ? "Host cannot be changed on an existing scheduled task. Delete and recreate on the target host if needed."
                : agentHosts.length === 0
                  ? "No hosts available."
                  : undefined
            }
          >
            {hostDisabled ? (
              <div>
                <KitChip tone="accent" data-testid="scheduled-agents-modal-form-host-locked">
                  {selectedHost?.name ?? initialSpec?.host ?? "unknown"}
                </KitChip>
              </div>
            ) : agentHosts.length > 0 ? (
              <KitPickRow aria-label="Host">
                {agentHosts.map((h) => (
                  <KitPickChip
                    key={h.id}
                    pressed={selectedHost?.id === h.id}
                    onPressedChange={() => setSelectedHost(h)}
                    data-testid={`scheduled-agents-modal-form-host-option-${h.id}`}
                  >
                    {h.name}
                  </KitPickChip>
                ))}
              </KitPickRow>
            ) : null}
          </KitField>
        )}

        {/* Field 5: Schedule (D-20 order 5, D-22 kinds) */}
          {isSensor ? (
            <KitField label="Schedule">
              <span
                className="text-[14px] text-[var(--k-t1)]"
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
            </KitField>
          ) : (
            <div className="flex flex-col gap-3">
              <ScheduleKindField
                value={formSchedule.type}
                onChange={(key) => setFormSchedule(switchScheduleKind(formSchedule, key))}
                testIdPrefix="scheduled-agents-modal-form-schedule-kind"
              />

              {/* Contextual detail fields per kind */}
              {formSchedule.type === "daily" && (
                <TimesField
                  at={formSchedule.at}
                  onChange={(at) => setFormSchedule({ ...formSchedule, at })}
                  label="At"
                  idPrefix="scheduled-agents-modal-form-schedule-daily-at"
                />
              )}

              {formSchedule.type === "weekly" && (
                <div className="flex flex-col gap-3">
                  <KitSegmented
                    full
                    aria-label="Day of the week"
                    options={WEEKDAY_VALUES.map((d) => ({ value: d, label: WEEKDAY_LABELS[d] }))}
                    value={formSchedule.day}
                    onValueChange={(d) => setFormSchedule({ ...formSchedule, day: d })}
                    data-testid="scheduled-agents-modal-form-schedule-weekly-day"
                    testIdPrefix="scheduled-agents-modal-form-schedule-weekly-day"
                  />
                  <TimesField
                    at={formSchedule.at}
                    onChange={(at) => setFormSchedule({ ...formSchedule, at })}
                    label="At"
                    idPrefix="scheduled-agents-modal-form-schedule-weekly-at"
                  />
                </div>
              )}

              {formSchedule.type === "monthly" && (
                <div className="flex flex-col gap-3">
                  <MonthlyDayFields
                    value={formSchedule}
                    onChange={setFormSchedule}
                    idPrefix="scheduled-agents-modal-form-schedule-monthly"
                  />
                  <TimesField
                    at={formSchedule.at}
                    onChange={(at) => setFormSchedule({ ...formSchedule, at })}
                    label="At"
                    idPrefix="scheduled-agents-modal-form-schedule-monthly-at"
                  />
                </div>
              )}

              {formSchedule.type === "yearly" && (
                <div className="flex flex-row items-end gap-2 flex-wrap">
                  <YearlyDateFields
                    date={formSchedule.date}
                    onChange={(date) => setFormSchedule({ ...formSchedule, date })}
                    idPrefix="scheduled-agents-modal-form-schedule-yearly"
                  />
                  <TimesField
                    at={formSchedule.at}
                    onChange={(at) => setFormSchedule({ ...formSchedule, at })}
                    label="At"
                    idPrefix="scheduled-agents-modal-form-schedule-yearly-at"
                  />
                </div>
              )}

              {formSchedule.type === "interval" && (
                <div className="flex flex-row flex-wrap items-center gap-2">
                  <label
                    htmlFor="scheduled-agents-modal-form-schedule-interval-n"
                    className="k-label"
                  >
                    Every
                  </label>
                  <KitInput
                    id="scheduled-agents-modal-form-schedule-interval-n"
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
                    className="w-20"
                  />
                  <KitSelect
                    id="scheduled-agents-modal-form-schedule-interval-u"
                    aria-label="Unit"
                    value={formSchedule.u}
                    onChange={(e) =>
                      setFormSchedule({
                        ...formSchedule,
                        u: e.target.value as IntervalUnit,
                      })
                    }
                    data-testid="scheduled-agents-modal-form-schedule-interval-u"
                    className="w-auto"
                  >
                    <option value="s">seconds</option>
                    <option value="m">minutes</option>
                    <option value="h">hours</option>
                    <option value="d">days</option>
                    <option value="mo">months</option>
                  </KitSelect>
                </div>
              )}

              {formSchedule.type === "one_shot" && (
                <div className="flex flex-row items-center gap-2">
                  <label
                    htmlFor="scheduled-agents-modal-form-schedule-oneshot-at"
                    className="k-label"
                  >
                    At
                  </label>
                  <KitInput
                    id="scheduled-agents-modal-form-schedule-oneshot-at"
                    type="datetime-local"
                    value={formSchedule.at}
                    onChange={(e) =>
                      setFormSchedule({ type: "one_shot", at: e.target.value })
                    }
                    data-testid="scheduled-agents-modal-form-schedule-oneshot-at"
                    className="w-auto"
                  />
                </div>
              )}

              {formSchedule.type !== "one_shot" && (
                <ScheduleRepeatFields
                  fs={formSchedule}
                  onChange={setFormSchedule}
                  idPrefix="scheduled-agents-modal-form-schedule"
                />
              )}

              {scheduleValidationMsg !== null && (
                <span className="k-err">
                  {scheduleValidationMsg}
                </span>
              )}
            </div>
          )}
      </div>

      {/* ─── Footer — D-19 ─────────────────────────────────────────── */}
      <ModalFoot>
        <KitButton onClick={onCancel} data-testid="scheduled-agents-modal-form-cancel">
          Cancel
        </KitButton>
        <KitButton
          variant="primary"
          onClick={() => {
            void onSave();
          }}
          disabled={saveDisabled}
          busy={inFlight}
          data-testid="scheduled-agents-modal-form-save"
        >
          {inFlight ? "Saving…" : "Save"}
        </KitButton>
      </ModalFoot>
    </div>
  );
}
