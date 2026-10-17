// Phase 72 Plan 02 Task 1: AddWakeupDialog — Radix Dialog-in-Dialog sub-modal
// for creating a new wakeup. The parent (WakeupsTab) controls the open state
// AND supplies `onSubmit` (which points at either the identity-scope or the
// role-scope create wire-handler in the parent's WS-plumbing). AddWakeupDialog
// itself is scope-agnostic beyond a scope-labeled title (reinforces the
// CONTEXT.md "no scope confusion" spirit-violation guardrail).
//
// The 6 CONTEXT.md-locked form fields:
//   1. Name (required, becomes slug via server-side kebab-case normalization)
//   2. Schedule type (Interval / Daily / Weekly / Monthly / Yearly / One-shot)
//   3. Schedule params (per-type fields, then the shared repeat options:
//      every-N, start, interval window, ends)
//   4. Timezone (optional IANA text input; blank falls back to the
//      auto-detected browser tz)
//   5. Instruction (required, multiline)
//   6. Enabled (default: true)
//
// Save is disabled until Name AND Instruction non-empty AND
// slug-normalization of Name yields a non-empty string AND validateForm
// returns null. On success onOpenChange(false) closes + resets form state;
// on rejection surfaces err.message inline and keeps the dialog open.

import { useState } from "react";
import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal";
import {
  KitBanner,
  KitButton,
  KitField,
  KitInput,
  KitOption,
  KitSelect,
  KitSwitch,
} from "@/components/kit";
import type { WakeupSpecWire } from "@/api/claude-session-api";
import {
  type FormSchedule,
  type IntervalUnit,
  type Weekday,
  WEEKDAY_NAMES,
  WEEKDAY_VALUES,
  buildSchedule,
  detectBrowserTimezone,
  MonthlyDayFields,
  RestrictToDaysChips,
  ScheduleKindField,
  ScheduleRepeatFields,
  switchScheduleKind,
  TimesField,
  validateForm,
  YearlyDateFields,
} from "./WakeupFormShared";
// Phase 112 Plan 03: instruction field adopts the shared MarkdownEditor with
// a synthetic `filename="wakeup.md"` that forces the pretty (MDXEditor) branch
// of the D-06 filetype gate. Wakeup instructions are markdown-content by
// contract (per phase CONTEXT §Phase Boundary).
import { MarkdownEditor } from "./MarkdownEditor";

// Slug regex must match writeRoleWakeupCreate / writeIdentityWakeupCreate on
// the backend (kebab-case, lowercase, alphanumerics + hyphens). Used ONLY to
// determine whether Save should be enabled — the server owns authoritative
// slug derivation and the client never sends its own slug.
function normalizeSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export type AddWakeupDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  hue: number;
  scope: "role" | "identity";
  /** Parent handles the actual WS call. Rejects → error surfaces inline. */
  onSubmit: (spec: WakeupSpecWire) => Promise<void>;
};

export function AddWakeupDialog({
  open,
  onOpenChange,
  hue,
  scope,
  onSubmit,
}: AddWakeupDialogProps): JSX.Element {
  // Detected once per open (does NOT re-detect between edits). The stable
  // reference is what the Timezone placeholder + blank-fallback both consume.
  const detectedTz = detectBrowserTimezone();

  const [nameDraft, setNameDraft] = useState("");
  const [enabledDraft, setEnabledDraft] = useState(true);
  const [instructionDraft, setInstructionDraft] = useState("");
  const [tzDraft, setTzDraft] = useState("");
  const [formSchedule, setFormSchedule] = useState<FormSchedule>({
    type: "daily",
    at: "09:00",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Save enablement gate: Name + Instruction non-empty AND slug non-empty AND
  // schedule validates. Runs on every render (cheap — a few regex checks).
  const slug = normalizeSlug(nameDraft);
  const validationError = validateForm(formSchedule);
  const saveDisabled =
    saving ||
    nameDraft.trim() === "" ||
    slug === "" ||
    instructionDraft.trim() === "" ||
    validationError !== null;

  function resetForm(): void {
    setNameDraft("");
    setEnabledDraft(true);
    setInstructionDraft("");
    setTzDraft("");
    setFormSchedule({ type: "daily", at: "09:00" });
    setError(null);
  }

  async function handleSave(): Promise<void> {
    setError(null);
    setSaving(true);
    try {
      const effectiveTz = tzDraft.trim() !== "" ? tzDraft.trim() : detectedTz;
      const spec: WakeupSpecWire = {
        name: nameDraft,
        enabled: enabledDraft,
        schedule: buildSchedule(formSchedule, effectiveTz),
        instruction: instructionDraft,
      };
      await onSubmit(spec);
      onOpenChange(false);
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function handleCancel(): void {
    onOpenChange(false);
  }

  // Guard: only render the DOM tree when `open`. Kept from pre-unification
  // for test symmetry (Test A queries for absence when open=false).
  if (!open) return <></>;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      hue={hue}
      size="lg"
      data-testid="add-wakeup-dialog"
    >
      <ModalHead
        title={
          scope === "role" ? "Add role-scope wakeup" : "Add wakeup"
        }
      />
      <ModalBody className="flex flex-col gap-4">
          {/* Field 1: Name */}
          <KitField label="Name" htmlFor="add-wakeup-name">
            <KitInput
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="e.g. Check for email reply"
            />
          </KitField>

          {/* Field 2: Schedule type — the kit segmented control. */}
          <ScheduleKindField
            value={formSchedule.type}
            onChange={(kind) => setFormSchedule(switchScheduleKind(formSchedule, kind))}
            testIdPrefix="add-wakeup-type"
          />

          {/* Field 3: Schedule params (per-type) */}
          {formSchedule.type === "interval" && (
            <div className="flex items-end gap-3 flex-wrap">
              <KitField label="Every" htmlFor="add-wakeup-every-n" className="flex-1 min-w-[110px]">
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
              <KitField label="Unit" htmlFor="add-wakeup-every-u" className="flex-1 min-w-[110px]">
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
              <RestrictToDaysChips
                days={formSchedule.days}
                onChange={(next) => setFormSchedule({ ...formSchedule, days: next })}
                slug="add"
              />
            </div>
          )}

          {formSchedule.type === "daily" && (
            <>
              <TimesField
                at={formSchedule.at}
                onChange={(at) => setFormSchedule({ ...formSchedule, at })}
                label="Time (local)"
                idPrefix="add-wakeup-daily-at"
              />
              <RestrictToDaysChips
                days={formSchedule.days}
                onChange={(next) => setFormSchedule({ ...formSchedule, days: next as Weekday[] | undefined })}
                slug="add"
              />
            </>
          )}

          {formSchedule.type === "weekly" && (
            <>
              <div className="flex items-start gap-3 flex-wrap">
                <KitField label="Day" htmlFor="add-wakeup-weekly-day" className="w-[160px] max-w-full">
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
                  idPrefix="add-wakeup-weekly-at"
                />
              </div>
              <RestrictToDaysChips
                days={formSchedule.days}
                onChange={(next) => setFormSchedule({ ...formSchedule, days: next as Weekday[] | undefined })}
                slug="add"
              />
            </>
          )}

          {formSchedule.type === "yearly" && (
            <div className="flex items-start gap-3 flex-wrap">
              <YearlyDateFields
                date={formSchedule.date}
                onChange={(date) => setFormSchedule({ ...formSchedule, date })}
                idPrefix="add-wakeup-yearly"
              />
              <TimesField
                at={formSchedule.at}
                onChange={(at) => setFormSchedule({ ...formSchedule, at })}
                label="Time (local)"
                idPrefix="add-wakeup-yearly-at"
              />
            </div>
          )}

          {formSchedule.type === "monthly" && (
            <>
              <MonthlyDayFields
                value={formSchedule}
                onChange={setFormSchedule}
                idPrefix="add-wakeup-monthly"
              />
              <TimesField
                at={formSchedule.at}
                onChange={(at) => setFormSchedule({ ...formSchedule, at })}
                label="Time (local)"
                idPrefix="add-wakeup-monthly-at"
              />
            </>
          )}

          {formSchedule.type !== "one_shot" && (
            <ScheduleRepeatFields
              fs={formSchedule}
              onChange={setFormSchedule}
              idPrefix="add-wakeup"
            />
          )}

          {formSchedule.type === "one_shot" && (
            <KitField label="Fires at (local)" htmlFor="add-wakeup-oneshot-at" className="w-[240px] max-w-full">
              <KitInput
                type="datetime-local"
                value={formSchedule.at}
                onChange={(e) => setFormSchedule({ ...formSchedule, at: e.target.value })}
              />
            </KitField>
          )}

          {/* Field 4: Timezone (optional) */}
          <KitField label="Timezone (optional)" htmlFor="add-wakeup-tz">
            <KitInput
              data-testid="add-wakeup-tz-input"
              type="text"
              value={tzDraft}
              onChange={(e) => setTzDraft(e.target.value)}
              placeholder={`${detectedTz} (leave blank to use)`}
            />
          </KitField>

          {/* Field 5: Instruction — Phase 112 Plan 03: MarkdownEditor swap.
              The wrapper <div className="min-h-[160px]"> accommodates the ~40px
              MDXEditor toolbar (RESEARCH §Open Question 2 recommendation): the
              old min-h-[60px] would leave ~20px for the editing area (unusable);
              160px gives room for toolbar + a comfortable ~3-row edit surface
              matching the spatial feel of the pre-swap textarea. */}
          <div className="k-field">
            <label htmlFor="add-wakeup-instruction" className="k-label">
              Instruction
            </label>
            <div className="min-h-[160px]">
              <MarkdownEditor
                filename="wakeup.md"
                content={instructionDraft}
                onChange={setInstructionDraft}
                placeholder="What should the agent do when this fires?"
              />
            </div>
          </div>

          {/* Field 6: Enabled */}
          <KitOption
            label="Enabled"
            control={
              <KitSwitch
                id="add-wakeup-enabled"
                checked={enabledDraft}
                onCheckedChange={setEnabledDraft}
              />
            }
          />

          {validationError && nameDraft.trim() !== "" && (
            <span className="k-err">{validationError}</span>
          )}

          {error && (
            <KitBanner tone="danger">
              <span className="whitespace-pre-wrap">{error}</span>
            </KitBanner>
          )}
      </ModalBody>

      <ModalFoot>
        <KitButton
          data-testid="add-wakeup-cancel"
          onClick={handleCancel}
          disabled={saving}
        >
          Cancel
        </KitButton>
        <KitButton
          variant="primary"
          data-testid="add-wakeup-save"
          onClick={handleSave}
          disabled={saveDisabled}
          busy={saving}
        >
          {saving ? "Saving…" : "Save"}
        </KitButton>
      </ModalFoot>
    </Modal>
  );
}
