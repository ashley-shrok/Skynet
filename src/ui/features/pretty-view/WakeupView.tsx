// One wake-up, one level deeper in the agent window — or a new one. The
// window owns the header (back to the agent, the wake-up's name, close);
// this is the form and its foot.
//
//   - On: a switch. On an existing wake-up it saves at once (same as the
//     list's switch); on a new one it's part of what Create writes.
//   - Name, When (the schedule kinds and every per-kind option from the
//     shared schedule fields), Time zone, Instruction.
//   - A sensor-fired wake-up has no clock schedule: When says so and the
//     sensor's details show read-only instead; its schedule is written back
//     unchanged.
//   - Delete wake-up… at the bottom (existing ones), Cancel / Save or
//     Create at the foot. Leaving with unsaved changes asks first.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModalFoot } from "@/components/modal";
import {
  KitBanner,
  KitButton,
  KitField,
  KitInput,
  KitSelect,
  KitSettingsGroup,
  KitSettingsRow,
  KitSwitch,
  KitTextarea,
  kitConfirm,
} from "@/components/kit";
import type { Wakeup, WakeupSpecWire } from "@/api/claude-session-api";
import { SensorDetails, lastFiredLabel } from "./SensorStatusView";
import {
  type FormSchedule,
  type IntervalUnit,
  type Weekday,
  WEEKDAY_NAMES,
  WEEKDAY_VALUES,
  buildSchedule,
  detectBrowserTimezone,
  hydrateFormSchedule,
  isOnceSensorSchedule,
  isSensorSchedule,
  MonthlyDayFields,
  RestrictToDaysChips,
  ScheduleKindField,
  ScheduleRepeatFields,
  switchScheduleKind,
  TimesField,
  validateForm,
  YearlyDateFields,
} from "./WakeupFormShared";
import type { EscapeHandler, LeaveGuard } from "./roles-window/RolesWindow";

// Must match the backend's slug derivation (kebab-case, a–z0–9 and hyphens):
// a name that slugs to nothing can't be created.
function normalizeSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function scheduleTimezone(schedule: unknown): string {
  const tz = (schedule as { timezone?: unknown } | null)?.timezone;
  return typeof tz === "string" ? tz : "";
}

export type WakeupUpdates = {
  name: string;
  schedule: unknown;
  instruction: string;
};

export interface WakeupViewProps {
  /** Absent = a new wake-up. */
  wakeup?: Wakeup;
  /** Saves just the on/off of an existing wake-up. */
  onToggle?: (enabled: boolean) => Promise<void>;
  onSave?: (updates: WakeupUpdates) => Promise<void>;
  onCreate?: (spec: WakeupSpecWire) => Promise<void>;
  onDelete?: () => Promise<void>;
  /** Back to the list (after Cancel, a save, a create or a delete). */
  onDone: () => void;
  registerGuard: (g: LeaveGuard | null) => void;
  registerEscape: (h: EscapeHandler | null) => void;
}

export function WakeupView({
  wakeup,
  onToggle,
  onSave,
  onCreate,
  onDelete,
  onDone,
  registerGuard,
  registerEscape,
}: WakeupViewProps): JSX.Element {
  const isNew = !wakeup;
  const detectedTz = useMemo(detectBrowserTimezone, []);
  const isSensor = !!wakeup && isSensorSchedule(wakeup.schedule);

  // Drafts start from the wake-up as it was when the view opened; the list's
  // background re-read never resets them.
  const initial = useMemo(
    () => ({
      name: wakeup?.name ?? "",
      instruction: wakeup?.instruction ?? "",
      tz: wakeup ? scheduleTimezone(wakeup.schedule) : "",
      schedule: wakeup && !isSensor ? hydrateFormSchedule(wakeup.schedule) : ({ type: "daily", at: "09:00" } as FormSchedule),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the starting point only
    [],
  );
  const [name, setName] = useState(initial.name);
  const [instruction, setInstruction] = useState(initial.instruction);
  const [tz, setTz] = useState(initial.tz);
  const [fs, setFs] = useState<FormSchedule>(initial.schedule);
  const [newEnabled, setNewEnabled] = useState(true);

  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name !== initial.name ||
    instruction !== initial.instruction ||
    tz !== initial.tz ||
    (!isSensor && JSON.stringify(fs) !== JSON.stringify(initial.schedule)) ||
    (isNew && !newEnabled);

  const validation = isSensor ? null : validateForm(fs);
  const canSubmit =
    !saving &&
    validation === null &&
    name.trim() !== "" &&
    normalizeSlug(name) !== "" &&
    instruction.trim() !== "" &&
    (isNew || dirty);

  const confirmDiscard = useCallback(
    (): Promise<boolean> =>
      kitConfirm({
        title: "Discard your changes?",
        body: isNew ? "This wake-up hasn't been created." : "Your edits to this wake-up haven't been saved.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        destructive: true,
      }),
    [isNew],
  );

  // Leaving with unsaved changes asks first; the window asks on every route out.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    registerGuard(async () => (dirtyRef.current ? confirmDiscard() : true));
    return () => registerGuard(null);
  }, [registerGuard, confirmDiscard]);
  useEffect(() => {
    registerEscape(null);
  }, [registerEscape]);

  const effectiveTz = tz.trim() !== "" ? tz.trim() : detectedTz;

  const submit = async (): Promise<void> => {
    setError(null);
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    try {
      const schedule = isSensor ? wakeup!.schedule : buildSchedule(fs, effectiveTz);
      if (isNew) {
        await onCreate?.({ name: name.trim(), enabled: newEnabled, schedule, instruction });
        console.info({ operation: "wakeup_created", slug: normalizeSlug(name) });
      } else {
        await onSave?.({ name: name.trim(), schedule, instruction });
        console.info({ operation: "wakeup_saved", slug: wakeup!.slug });
      }
      dirtyRef.current = false;
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
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
    if (!wakeup) return;
    const ok = await kitConfirm({
      title: "Delete this wake-up?",
      body: `“${wakeup.name}” will stop firing. This can't be undone.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await onDelete?.();
      console.info({ operation: "wakeup_deleted", slug: wakeup.slug });
      dirtyRef.current = false;
      onDone();
    } catch (e) {
      setError(`Couldn't delete: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const enabled = isNew ? newEnabled : wakeup.enabled;
  const onDescription = isNew
    ? "It starts firing as soon as it's created."
    : isSensor
      ? `Fires when its sensor sees something · ${lastFiredLabel(wakeup.lastFiredAt)}`
      : `${wakeup.scheduleHuman} · ${lastFiredLabel(wakeup.lastFiredAt)}`;

  const oneShotPast =
    fs.type === "one_shot" && fs.at !== "" && !Number.isNaN(new Date(fs.at).getTime()) && new Date(fs.at).getTime() < Date.now();
  const days = fs.type !== "one_shot" && fs.type !== "monthly" && fs.type !== "yearly" && (
    <RestrictToDaysChips days={fs.days} onChange={(next) => setFs({ ...fs, days: next as Weekday[] | undefined })} slug="wakeup" />
  );

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto px-6 max-sm:px-5 pb-6 pt-1">
        <div className="max-w-[620px] mx-auto flex flex-col gap-5" data-testid="wakeup-view">
          <KitSettingsGroup>
            <KitSettingsRow
              label="On"
              description={<span data-testid="wakeup-view-on-note">{enabled ? onDescription : isNew ? "It's created switched off." : "Off — it won't fire."}</span>}
              control={
                <KitSwitch
                  checked={enabled}
                  onCheckedChange={(next) => void toggle(next)}
                  disabled={toggling}
                  aria-label="On"
                  data-testid="wakeup-view-enabled"
                />
              }
            />
          </KitSettingsGroup>

          <KitField label="Name" htmlFor="wakeup-name">
            <KitInput
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Check for email reply"
              data-testid="wakeup-view-name"
            />
          </KitField>

          {isSensor ? (
            <div className="k-field" data-testid="wakeup-sensor-schedule">
              <span className="k-label">When</span>
              <span className="text-[14px] text-[var(--k-t1)]">
                When its sensor fires{isOnceSensorSchedule(wakeup!.schedule) ? " — once, then it retires" : ""}
              </span>
              <span className="k-help">Sensors are built by agents. The switch above is the only control here.</span>
              {wakeup!.sensor && (
                <div className="mt-2">
                  <SensorDetails
                    sensor={wakeup!.sensor}
                    lastFiredAt={wakeup!.lastFiredAt}
                    once={isOnceSensorSchedule(wakeup!.schedule)}
                    testId="wakeup-sensor-details"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4" data-testid="wakeup-view-when">
              <ScheduleKindField value={fs.type} onChange={(kind) => setFs(switchScheduleKind(fs, kind))} testIdPrefix="wakeup-type" />

              {fs.type === "interval" && (
                <div className="flex items-end gap-3 flex-wrap">
                  <KitField label="Every" htmlFor="wakeup-every-n" className="flex-1 min-w-[110px]">
                    <KitInput
                      type="number"
                      min={1}
                      value={fs.n}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setFs({ ...fs, n: Number.isFinite(v) ? v : 1 });
                      }}
                    />
                  </KitField>
                  <KitField label="Unit" htmlFor="wakeup-every-u" className="flex-1 min-w-[110px]">
                    <KitSelect value={fs.u} onChange={(e) => setFs({ ...fs, u: e.target.value as IntervalUnit })}>
                      <option value="s">seconds</option>
                      <option value="m">minutes</option>
                      <option value="h">hours</option>
                      <option value="d">days</option>
                      <option value="mo">months</option>
                    </KitSelect>
                  </KitField>
                </div>
              )}

              {fs.type === "daily" && (
                <TimesField at={fs.at} onChange={(at) => setFs({ ...fs, at })} label="Time" idPrefix="wakeup-daily-at" />
              )}

              {fs.type === "weekly" && (
                <div className="flex items-start gap-3 flex-wrap">
                  <KitField label="Day" htmlFor="wakeup-weekly-day" className="w-[160px] max-w-full">
                    <KitSelect value={fs.day} onChange={(e) => setFs({ ...fs, day: e.target.value as Weekday })}>
                      {WEEKDAY_VALUES.map((d) => (
                        <option key={d} value={d}>
                          {WEEKDAY_NAMES[d]}
                        </option>
                      ))}
                    </KitSelect>
                  </KitField>
                  <TimesField at={fs.at} onChange={(at) => setFs({ ...fs, at })} label="Time" idPrefix="wakeup-weekly-at" />
                </div>
              )}

              {fs.type === "yearly" && (
                <div className="flex items-start gap-3 flex-wrap">
                  <YearlyDateFields date={fs.date} onChange={(date) => setFs({ ...fs, date })} idPrefix="wakeup-yearly" />
                  <TimesField at={fs.at} onChange={(at) => setFs({ ...fs, at })} label="Time" idPrefix="wakeup-yearly-at" />
                </div>
              )}

              {fs.type === "monthly" && (
                <>
                  <MonthlyDayFields value={fs} onChange={setFs} idPrefix="wakeup-monthly" />
                  <TimesField at={fs.at} onChange={(at) => setFs({ ...fs, at })} label="Time" idPrefix="wakeup-monthly-at" />
                </>
              )}

              {days}

              {fs.type !== "one_shot" && <ScheduleRepeatFields fs={fs} onChange={setFs} idPrefix="wakeup" />}

              {fs.type === "one_shot" && (
                <>
                  <KitField label="Fires at" htmlFor="wakeup-oneshot-at" className="w-[240px] max-w-full">
                    <KitInput type="datetime-local" value={fs.at} onChange={(e) => setFs({ ...fs, at: e.target.value })} />
                  </KitField>
                  {oneShotPast && (
                    <KitBanner tone="warn">
                      That time is in the past — the scheduler will fire this <b>immediately</b>.
                    </KitBanner>
                  )}
                </>
              )}

              <KitField
                label="Time zone"
                htmlFor="wakeup-tz"
                help={`Times above are in this zone. Leave it blank for yours (${detectedTz}).`}
              >
                <KitInput
                  type="text"
                  value={tz}
                  onChange={(e) => setTz(e.target.value)}
                  placeholder={detectedTz}
                  data-testid="wakeup-view-tz"
                />
              </KitField>

              {validation && name.trim() !== "" && <span className="k-err">{validation}</span>}
            </div>
          )}

          <KitField label="Instruction" htmlFor="wakeup-instruction" help="Shown to the agent, word for word, each time it fires.">
            <KitTextarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={6}
              placeholder="What should the agent do when this fires?"
              data-testid="wakeup-view-instruction"
            />
          </KitField>

          {error && (
            <KitBanner tone="danger" onDismiss={() => setError(null)}>
              <span className="whitespace-pre-wrap">{error}</span>
            </KitBanner>
          )}

          {!isNew && (
            <div>
              <KitButton variant="danger-quiet" onClick={() => void remove()} data-testid="wakeup-view-delete">
                Delete wake-up…
              </KitButton>
            </div>
          )}
        </div>
      </div>
      <ModalFoot>
        <KitButton disabled={saving} onClick={onDone} data-testid="wakeup-view-cancel">
          Cancel
        </KitButton>
        <KitButton
          variant="primary"
          busy={saving}
          disabled={!canSubmit}
          onClick={() => void submit()}
          data-testid="wakeup-view-save"
        >
          {saving ? "Saving…" : isNew ? "Create" : "Save"}
        </KitButton>
      </ModalFoot>
    </>
  );
}
