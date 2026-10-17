import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import {
  KitBanner,
  KitButton,
  KitCheckbox,
  KitChip,
  KitEmpty,
  KitField,
  KitIconButton,
  KitInput,
  KitListRow,
  KitLoading,
  KitOption,
  KitSelect,
  KitSwitch,
  KitTextarea,
  kitConfirm,
} from "@/components/kit";
import { cn } from "@/lib/utils";
import type { Wakeup, WakeupSpecWire } from "@/api/claude-session-api";
import type { SensorStatus } from "@/api/sensor-status-types";
import {
  formatAbsolute,
  formatRelativePast,
} from "@/features/pretty-conversations/scheduled-agents-time-fmt";
import type { TabState } from "./IdentityFileTab";
import { AddWakeupDialog } from "./AddWakeupDialog";
import { SENSOR_MARK, SensorDetails, SensorStateChip, lastFiredLabel } from "./SensorStatusView";
// Phase 72 Plan 02 Task 1: FormSchedule + hydrate/build/validate helpers +
// RestrictToDaysChips lifted into a shared module so the new AddWakeupDialog
// (add-wakeup sub-modal) can consume them. Non-behavior-change refactor.
import {
  type FormSchedule,
  type IntervalUnit,
  type Weekday,
  WEEKDAY_NAMES,
  WEEKDAY_VALUES,
  buildSchedule,
  detectBrowserTimezone,
  hydrateFormSchedule,
  isSensorSchedule,
  isOnceSensorSchedule,
  sensorScheduleLabel,
  MonthlyDayFields,
  RestrictToDaysChips,
  ScheduleKindField,
  ScheduleRepeatFields,
  switchScheduleKind,
  TimesField,
  validateForm,
  YearlyDateFields,
} from "./WakeupFormShared";

// Patch #17g: tab renderer for the identity's wakeups/<slug>/wakeup.json specs.
// Patch #154: adds inline editing — an enabled toggle + a schedule JSON editor.
//   Enabled writes are optimistic-agnostic (we wait on the server response
//   and rely on the fresh wakeups[] the server sends back to reflect state).
//   Schedule editing WAS a raw-JSON textarea in patch #154 because the wakeup
//   schema (interval/daily/weekly/one_shot + optional timezone) was Nelly-owned
//   and evolving; a structured field editor would need to co-evolve.
//
// Quick 260731-2pa: form-based editor replaces the raw JSON textarea. The
// schema is stable enough now (interval/daily/weekly/one_shot + optional tz)
// that the patch #154 "raw textarea because schema evolves" hedge is no
// longer justified. The user-signed-off prototype lives at
// ~/.claude/identities/tina/bounties/identity-modal-wakeup-form-editor/prototype.html.
//   - Form fields (edit-mode): name (text), schedule kind (kit segmented) +
//     per-type fields, instruction (textarea), enabled (checkbox — secondary
//     path; the row switch is the primary one-click toggle).
//   - Live JSON preview on the right on ≥620px viewports.
//   - Timezone silently detected via Intl.DateTimeFormat().resolvedOptions().timeZone
//     with fallback America/New_York. Shown as a muted hint and written on
//     every kind (interval honors it for its window / days / start).
//   - Preserves patch #154's always-visible enabled chip + one-click
//     `toggleEnabled` — the header chip in edit-mode is untouched.
//   - Backend write path was extended in the previous commit (Task 1) to
//     accept name + instruction alongside enabled + schedule.
//
// apple-ux: every part below comes from the kit — list rows for the
// wake-ups, chips for scope and sensor status, a switch for on/off, kit
// fields and the segmented schedule-kind control in the editor, and the
// kit confirm for delete.

type OnUpdate = (
  slug: string,
  // Quick 260731-2pa: widened to also accept name + instruction (form
  // editor writes the full spec on Save).
  updates: { enabled?: boolean; schedule?: unknown; name?: string; instruction?: string },
) => Promise<void>;

// Phase 72 Plan 02 Task 2: Add-wakeup button, rendered at the top of both the
// data branch AND the non-coordinator-identity empty-state branch so the
// first-wakeup flow is always reachable. The coordinator + scope='identity'
// empty branch omits it entirely (see below).
function AddWakeupButton({ onClick }: { onClick: () => void }) {
  return (
    <KitButton
      size="sm"
      data-testid="wakeup-add-button"
      onClick={onClick}
      className="self-start"
    >
      <Plus />
      Add wakeup
    </KitButton>
  );
}

/** The unopened row's sensor line: "📡 Sensor [Healthy] · Last fired 3h ago · 2 waiting". */
function WakeupSensorSummary({
  sensor,
  lastFiredAt,
  once,
  testId,
}: {
  sensor: SensorStatus;
  lastFiredAt: number | null | undefined;
  once: boolean;
  testId: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0 flex-wrap" data-testid={testId}>
      <span>
        <span aria-hidden="true">{SENSOR_MARK} </span>
        {once ? "Sensor · once" : "Sensor"}
      </span>
            <SensorStateChip state={sensor.state} testId={`${testId}-state`} />
      <span title={typeof lastFiredAt === "number" ? formatAbsolute(lastFiredAt, now) : undefined}>
        {typeof lastFiredAt === "number"
          ? `Last fired ${formatRelativePast(lastFiredAt, now)}`
          : "Never fired"}
      </span>
      {sensor.waitingFires > 0 && (
        <span data-testid={`${testId}-waiting`}>· {sensor.waitingFires} waiting</span>
      )}
    </span>
  );
}

export function WakeupsTab({
  state,
  hue,
  scope,
  isCoordinator,
  onUpdate,
  onCreate,
  onDelete,
}: {
  state: TabState<Wakeup[]>;
  hue: number;
  scope: "role" | "identity";
  // Phase 72 Plan 04 Task 1: required, non-optional. Callers always know
  // whether the identity is a coordinator (via identity.coordinator on the
  // Identity type, Phase 67 addition). The empty-state branch below fires
  // a coordinator-Identity-scope caption when this is true AND scope is
  // identity — hiding the Add-wakeup button so coord can't accidentally
  // create identity-scope wakeups (coord meaningful wakeups are all role-
  // scope; the caption tells them to switch to Role view).
  isCoordinator: boolean;
  onUpdate: OnUpdate;
  onCreate: (spec: WakeupSpecWire) => Promise<void>;
  onDelete: (slug: string) => Promise<void>;
}) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  if (state.status === "loading") {
    return <KitLoading lines={3} />;
  }

  if (state.status === "error") {
    return <KitBanner tone="danger">Couldn&apos;t load wakeups: {state.error}</KitBanner>;
  }

  const addDialog = (
    <AddWakeupDialog
      open={addDialogOpen}
      onOpenChange={setAddDialogOpen}
      hue={hue}
      scope={scope}
      onSubmit={onCreate}
    />
  );

  if (state.data.length === 0) {
    // Phase 72 Plan 04 Task 1: three-branch empty state.
    //
    // Branch 1: coordinator + Identity scope → caption ONLY, no Add-wakeup
    // button. Coordinators create wakeups from Role scope; the button would
    // let them create a wakeup that never fires (identity-scope wakeups on
    // a coordinator identity are semantically undefined per the shape).
    if (isCoordinator && scope === "identity") {
      return (
        <KitEmpty
          data-testid="wakeups-coordinator-empty-identity"
          title="Coordinators use role-scope wakeups only."
          body="Switch to Role view to manage."
        />
      );
    }

    // Branch 2 + Branch 3: any non-(coord+identity) empty case → caption
    // AND the Add-wakeup button so the first-wakeup flow is reachable.
    return (
      <div className="flex flex-col gap-3">
        <KitEmpty
          title="No scheduled wake-ups."
          body="Wake-ups are instructions that are automatically sent to this agent at a future date/time. Ask the agent to create one or use the button below."
          action={<AddWakeupButton onClick={() => setAddDialogOpen(true)} />}
        />
        {addDialog}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <AddWakeupButton onClick={() => setAddDialogOpen(true)} />
      <div className="flex flex-col gap-1">
        {state.data.map((wakeup) => (
          <WakeupRow
            key={wakeup.slug}
            wakeup={wakeup}
            scope={scope}
            onUpdate={onUpdate}
            onDelete={onDelete}
          />
        ))}
      </div>
      {addDialog}
    </div>
  );
}

function WakeupRow({
  wakeup,
  scope,
  onUpdate,
  onDelete,
}: {
  wakeup: Wakeup;
  scope: "role" | "identity";
  onUpdate: OnUpdate;
  onDelete: (slug: string) => Promise<void>;
}) {
  const detectedTz = useMemo(detectBrowserTimezone, []);

  // Quick 260808-<slug>: row collapsed by default to make the list scannable.
  // The row itself toggles this; instruction prose + edit button + form
  // editor are hidden until expanded.
  const [expanded, setExpanded] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [nameDraft, setNameDraft] = useState(wakeup.name);
  const [enabledDraft, setEnabledDraft] = useState(wakeup.enabled);
  const [instructionDraft, setInstructionDraft] = useState(wakeup.instruction);
  const [formSchedule, setFormSchedule] = useState<FormSchedule>(() =>
    hydrateFormSchedule(wakeup.schedule),
  );
  const [saving, setSaving] = useState<null | "enabled" | "form">(null);
  const [error, setError] = useState<string | null>(null);
  // Sensor-fired wake-ups ({type: "sensor"}) have no clock schedule to edit;
  // the form keeps name/instruction/enabled editable and writes the schedule
  // object back unchanged.
  const isSensor = isSensorSchedule(wakeup.schedule);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete(): Promise<void> {
    const ok = await kitConfirm({
      title: "Delete this wake-up?",
      body: `“${wakeup.name}” (${wakeup.slug}) will stop firing. This can't be undone.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      await onDelete(wakeup.slug);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  // Reset all drafts when the underlying wakeup identity changes (post-save
  // refresh, or a different card rendered into the same slot). The schedule
  // is compared by value — the open tab re-reads the list every 30s and each
  // read parses a fresh object — and drafts are never reset mid-edit, so a
  // background refresh can't wipe what the user is typing.
  const scheduleKey = JSON.stringify(wakeup.schedule ?? null);
  useEffect(() => {
    if (editingSchedule) return;
    setNameDraft(wakeup.name);
    setEnabledDraft(wakeup.enabled);
    setInstructionDraft(wakeup.instruction);
    setFormSchedule(hydrateFormSchedule(wakeup.schedule));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- schedule compared via scheduleKey
  }, [wakeup.slug, scheduleKey, wakeup.name, wakeup.instruction, wakeup.enabled, editingSchedule]);

  async function toggleEnabled() {
    setError(null);
    setSaving("enabled");
    try {
      await onUpdate(wakeup.slug, { enabled: !wakeup.enabled });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  async function saveForm() {
    setError(null);
    const validationError = isSensor ? null : validateForm(formSchedule);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving("form");
    try {
      await onUpdate(wakeup.slug, {
        name: nameDraft,
        enabled: enabledDraft,
        schedule: isSensor ? wakeup.schedule : buildSchedule(formSchedule, detectedTz),
        instruction: instructionDraft,
      });
      setEditingSchedule(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  function cancelEdit() {
    setNameDraft(wakeup.name);
    setEnabledDraft(wakeup.enabled);
    setInstructionDraft(wakeup.instruction);
    setFormSchedule(hydrateFormSchedule(wakeup.schedule));
    setEditingSchedule(false);
    setError(null);
  }

  // Live JSON preview — the exact shape that would be PUT to
  // wakeups/<slug>/wakeup.json on Save.
  const livePreview = useMemo(() => {
    const spec = {
      name: nameDraft,
      enabled: enabledDraft,
      schedule: isSensor ? wakeup.schedule : buildSchedule(formSchedule, detectedTz),
      instruction: instructionDraft,
    };
    return JSON.stringify(spec, null, 2);
  }, [nameDraft, enabledDraft, instructionDraft, formSchedule, detectedTz, isSensor, wakeup.schedule]);

  // Past-datetime hint (one_shot only).
  const oneShotPast =
    formSchedule.type === "one_shot" &&
    formSchedule.at !== "" &&
    !Number.isNaN(new Date(formSchedule.at).getTime()) &&
    new Date(formSchedule.at).getTime() < Date.now();

  const tzNote = (
    <div className="k-help basis-full">
      Timezone (auto-detected from browser): <b>{detectedTz}</b>
    </div>
  );
  const daysChips = formSchedule.type !== "one_shot" && formSchedule.type !== "monthly" && formSchedule.type !== "yearly" && (
    <RestrictToDaysChips
      days={formSchedule.days}
      onChange={(next) => setFormSchedule({ ...formSchedule, days: next })}
      slug={wakeup.slug}
    />
  );

  // Header controls shared by the collapsed row and the editor: scope chip
  // (every wakeup visibly declares its scope), on/off switch, delete.
  const scopeChip = (
    <KitChip data-testid="wakeup-scope-pill">{scope}</KitChip>
  );
  const enabledSwitch = (
    <KitSwitch
      checked={wakeup.enabled}
      onCheckedChange={() => {
        void toggleEnabled();
      }}
      disabled={saving === "enabled"}
      aria-label={wakeup.enabled ? "Disable this wakeup" : "Enable this wakeup"}
      title={wakeup.enabled ? "Disable" : "Enable"}
    />
  );
  const deleteButton = (
    <KitIconButton
      size="sm"
      tone="danger"
      label="Delete this wakeup"
      data-testid="wakeup-delete-icon"
      disabled={deleting}
      onClick={() => {
        void handleDelete();
      }}
    >
      <Trash2 />
    </KitIconButton>
  );

  return (
    <div
      className={cn(
        "flex flex-col",
        (expanded || editingSchedule) && "k-group",
      )}
    >
      {editingSchedule ? (
        <div className="flex items-center gap-2 flex-wrap px-3 pt-3">
          <div className="flex-1 min-w-[160px]">
            <KitInput
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              aria-label="Wakeup name"
            />
          </div>
          {scopeChip}
          {enabledSwitch}
          {deleteButton}
        </div>
      ) : (
        <KitListRow
          aria-expanded={expanded}
          onActivate={() => setExpanded((v) => !v)}
          title={wakeup.name}
          subtitle={
            wakeup.sensor ? (
              <WakeupSensorSummary
                sensor={wakeup.sensor}
                lastFiredAt={wakeup.lastFiredAt}
                once={isOnceSensorSchedule(wakeup.schedule)}
                testId="wakeup-sensor-summary"
              />
            ) : (
              <span>
                <span className="font-mono">{wakeup.scheduleHuman}</span>
                <span data-testid="wakeup-last-fired">
                  {" · "}
                  {lastFiredLabel(wakeup.lastFiredAt)}
                </span>
              </span>
            )
          }
          trailing={
            <>
              {scopeChip}
              {enabledSwitch}
              {deleteButton}
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "size-4 shrink-0 text-[var(--k-t3)] transition-transform duration-150",
                  expanded && "rotate-180",
                )}
              />
            </>
          }
        />
      )}

      {deleteError && (
        <div className="px-3 pb-2">
          <KitBanner tone="danger" onDismiss={() => setDeleteError(null)}>
            <span className="whitespace-pre-wrap">Couldn&apos;t delete: {deleteError}</span>
          </KitBanner>
        </div>
      )}

      {/* Expanded view: sensor details + instruction + Edit schedule, OR the
          form editor. */}
      {!editingSchedule ? (
        expanded && (
          <div className="flex flex-col gap-3 px-3 pb-3">
            {wakeup.sensor && (
              <SensorDetails
                sensor={wakeup.sensor}
                lastFiredAt={wakeup.lastFiredAt}
                once={isOnceSensorSchedule(wakeup.schedule)}
                testId="wakeup-sensor-details"
              />
            )}
            {/* Instruction prose — the tallest content, which is why the row
                folds by default. */}
            {wakeup.instruction && (
              <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--k-t1)]">
                {wakeup.instruction}
              </div>
            )}
            <div className="flex items-center justify-end">
              <KitButton
                variant="plain"
                size="sm"
                onClick={() => setEditingSchedule(true)}
                title="Edit schedule"
              >
                <Pencil />
                Edit schedule
              </KitButton>
            </div>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-4 p-3">
          <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
            {/* Left column: form fields */}
            <div className="flex flex-col gap-4 min-w-0">
              {/* A sensor-fired wake-up's schedule is not editable here:
                  show it as a plain read-only line and keep it on save. */}
              {isSensor ? (
                <div className="k-field" data-testid="wakeup-sensor-schedule">
                  <span className="k-label">Schedule</span>
                  <span className="text-[13px] text-[var(--k-t1)] font-mono">{sensorScheduleLabel(wakeup.schedule)}</span>
                </div>
              ) : (
              <>
              <ScheduleKindField
                value={formSchedule.type}
                onChange={(kind) => setFormSchedule(switchScheduleKind(formSchedule, kind))}
                testIdPrefix={`wakeup-type-${wakeup.slug}`}
              />

              {/* Per-type fields */}
              {formSchedule.type === "interval" && (
                <div className="flex items-end gap-3 flex-wrap">
                  <KitField label="Every" htmlFor={`wakeup-every-n-${wakeup.slug}`} className="flex-1 min-w-[110px]">
                    <KitInput
                      type="number"
                      min={1}
                      value={formSchedule.n}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setFormSchedule({ ...formSchedule, n: Number.isFinite(v) ? v : 1 });
                      }}
                    />
                  </KitField>
                  <KitField label="Unit" htmlFor={`wakeup-every-u-${wakeup.slug}`} className="flex-1 min-w-[110px]">
                    <KitSelect
                      value={formSchedule.u}
                      onChange={(e) =>
                        setFormSchedule({ ...formSchedule, u: e.target.value as IntervalUnit })
                      }
                    >
                      <option value="s">seconds</option>
                      <option value="m">minutes</option>
                      <option value="h">hours</option>
                      <option value="d">days</option>
                      <option value="mo">months</option>
                    </KitSelect>
                  </KitField>
                  {tzNote}
                  {daysChips}
                </div>
              )}

              {formSchedule.type === "daily" && (
                <>
                  <TimesField
                    at={formSchedule.at}
                    onChange={(at) => setFormSchedule({ ...formSchedule, at })}
                    label="Time (local)"
                    idPrefix={`wakeup-daily-at-${wakeup.slug}`}
                  />
                  {tzNote}
                  {daysChips}
                </>
              )}

              {formSchedule.type === "weekly" && (
                <>
                  <div className="flex items-start gap-3 flex-wrap">
                    <KitField label="Day" htmlFor={`wakeup-weekly-day-${wakeup.slug}`} className="w-[160px] max-w-full">
                      <KitSelect
                        value={formSchedule.day}
                        onChange={(e) => setFormSchedule({ ...formSchedule, day: e.target.value as Weekday })}
                      >
                        {WEEKDAY_VALUES.map((d) => (
                          <option key={d} value={d}>
                            {WEEKDAY_NAMES[d]}
                          </option>
                        ))}
                      </KitSelect>
                    </KitField>
                    <TimesField
                      at={formSchedule.at}
                      onChange={(at) => setFormSchedule({ ...formSchedule, at })}
                      label="Time (local)"
                      idPrefix={`wakeup-weekly-at-${wakeup.slug}`}
                    />
                  </div>
                  {tzNote}
                  {daysChips}
                </>
              )}

              {formSchedule.type === "yearly" && (
                <>
                  <div className="flex items-start gap-3 flex-wrap">
                    <YearlyDateFields
                      date={formSchedule.date}
                      onChange={(date) => setFormSchedule({ ...formSchedule, date })}
                      idPrefix={`wakeup-yearly-${wakeup.slug}`}
                    />
                    <TimesField
                      at={formSchedule.at}
                      onChange={(at) => setFormSchedule({ ...formSchedule, at })}
                      label="Time (local)"
                      idPrefix={`wakeup-yearly-at-${wakeup.slug}`}
                    />
                  </div>
                  {tzNote}
                </>
              )}

              {formSchedule.type === "monthly" && (
                <>
                  <MonthlyDayFields
                    value={formSchedule}
                    onChange={setFormSchedule}
                    idPrefix={`wakeup-monthly-${wakeup.slug}`}
                  />
                  <TimesField
                    at={formSchedule.at}
                    onChange={(at) => setFormSchedule({ ...formSchedule, at })}
                    label="Time (local)"
                    idPrefix={`wakeup-monthly-at-${wakeup.slug}`}
                  />
                  {tzNote}
                </>
              )}

              {formSchedule.type !== "one_shot" && (
                <ScheduleRepeatFields
                  fs={formSchedule}
                  onChange={setFormSchedule}
                  idPrefix={`wakeup-${wakeup.slug}`}
                />
              )}

              {formSchedule.type === "one_shot" && (
                <>
                  <KitField
                    label="Fires at (local)"
                    htmlFor={`wakeup-oneshot-at-${wakeup.slug}`}
                    className="w-[240px] max-w-full"
                  >
                    <KitInput
                      type="datetime-local"
                      value={formSchedule.at}
                      onChange={(e) => setFormSchedule({ ...formSchedule, at: e.target.value })}
                    />
                  </KitField>
                  {tzNote}
                  {oneShotPast && (
                    <KitBanner tone="warn">
                      That datetime is in the past — the scheduler will fire this{" "}
                      <b>immediately</b> on first sight.
                    </KitBanner>
                  )}
                </>
              )}
              </>
              )}

              {/* Instruction */}
              <KitField label="Instruction" htmlFor={`wakeup-instruction-${wakeup.slug}`}>
                <KitTextarea
                  value={instructionDraft}
                  onChange={(e) => setInstructionDraft(e.target.value)}
                  rows={3}
                />
              </KitField>

              {/* Enabled (secondary path — the row's switch is primary) */}
              <KitOption
                label="Enabled"
                control={
                  <KitCheckbox
                    id={`wakeup-enabled-${wakeup.slug}`}
                    checked={enabledDraft}
                    onCheckedChange={setEnabledDraft}
                  />
                }
              />
            </div>

            {/* Right column: live JSON preview (≥620px) */}
            <div className="k-field min-w-0">
              <span className="k-label">Live JSON preview</span>
              <pre
                className={cn(
                  "m-0 rounded-[10px] bg-[var(--k-s2)] text-[var(--k-t2)]",
                  "px-3 py-2 text-[11.5px] font-mono whitespace-pre overflow-auto min-h-[160px]",
                )}
                data-testid="wakeup-json-preview"
              >
                {livePreview}
              </pre>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            <KitButton
              size="sm"
              variant="primary"
              onClick={() => {
                void saveForm();
              }}
              busy={saving === "form"}
            >
              {saving === "form" ? "Saving…" : "Save"}
            </KitButton>
            <KitButton size="sm" onClick={cancelEdit} disabled={saving === "form"}>
              Cancel
            </KitButton>
            <span className="k-help">Scheduler reloads every ~30s</span>
          </div>
        </div>
      )}

      {error && (
        <div className="px-3 pb-3">
          <KitBanner tone="danger">
            <span className="whitespace-pre-wrap">{error}</span>
          </KitBanner>
        </div>
      )}
    </div>
  );
}
