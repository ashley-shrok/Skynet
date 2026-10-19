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
  buildSchedule,
  detectBrowserTimezone,
  hydrateFormSchedule,
  isOnceSensorSchedule,
  isSensorSchedule,
  ScheduleWhenFields,
  validateForm,
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

  // A one-time wake-up's time carries this browser's offset, so its zone is
  // always the browser's; the Time zone field is for the repeating kinds.
  // An existing schedule saved without a zone runs in its machine's zone; a
  // blank field keeps it that way instead of writing this browser's zone in.
  const blankIsMachine = !!wakeup && scheduleTimezone(wakeup.schedule) === "";
  const zoneFor = (kind: FormSchedule["type"], typed: string): string =>
    kind === "one_shot" ? detectedTz : typed.trim() !== "" ? typed.trim() : blankIsMachine ? "" : detectedTz;
  const effectiveTz = zoneFor(fs.type, tz);
  // Compared as the schedule that would be written, so switching a kind and
  // back (which can fill in defaults) isn't an edit.
  const built = (f: FormSchedule, z: string): string => (isSensor ? "" : JSON.stringify(buildSchedule(f, z)));
  const dirty =
    name !== initial.name ||
    instruction !== initial.instruction ||
    built(fs, effectiveTz) !== built(initial.schedule, zoneFor(initial.schedule.type, initial.tz)) ||
    (isNew && !newEnabled);

  const validation = isSensor ? null : validateForm(fs);
  const canSubmit =
    !saving &&
    validation === null &&
    name.trim() !== "" &&
    normalizeSlug(name) !== "" &&
    // A new wake-up needs an instruction; an existing one saved without one
    // (the server allows it) can still be edited.
    (instruction.trim() !== "" || !isNew) &&
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
    setSaving(true);
    busyRef.current = true;
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
      busyRef.current = false;
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
    if (!wakeup) return;
    const ok = await kitConfirm({
      title: "Delete this wake-up?",
      body: `“${wakeup.name}” will stop firing. This can't be undone.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    busyRef.current = true;
    try {
      await onDelete?.();
      console.info({ operation: "wakeup_deleted", slug: wakeup.slug });
      dirtyRef.current = false;
      busyRef.current = false;
      onDone();
    } catch (e) {
      setError(`Couldn't delete: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      busyRef.current = false;
    }
  };

  const enabled = isNew ? newEnabled : wakeup.enabled;
  const onDescription = isNew
    ? "It starts firing as soon as it's created."
    : isSensor
      ? `Fires when its sensor sees something · ${lastFiredLabel(wakeup.lastFiredAt)}`
      : `${wakeup.scheduleHuman} · ${lastFiredLabel(wakeup.lastFiredAt)}`;


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
              <span className="k-help">Its timing comes from its sensor, which agents build — switch it off above to stop it.</span>
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
            <ScheduleWhenFields
              fs={fs}
              onChange={setFs}
              tz={tz}
              onTzChange={setTz}
              detectedTz={detectedTz}
              blankIsMachine={blankIsMachine}
              idPrefix="wakeup"
              testIds={{ when: "wakeup-view-when", kind: "wakeup-type", tz: "wakeup-view-tz" }}
            />
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
