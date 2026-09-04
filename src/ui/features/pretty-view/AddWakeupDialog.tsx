// Phase 72 Plan 02 Task 1: AddWakeupDialog — Radix Dialog-in-Dialog sub-modal
// for creating a new wakeup. The parent (WakeupsTab) controls the open state
// AND supplies `onSubmit` (which points at either the identity-scope or the
// role-scope create wire-handler in the parent's WS-plumbing). AddWakeupDialog
// itself is scope-agnostic beyond a scope-labeled title (reinforces the
// CONTEXT.md "no scope confusion" spirit-violation guardrail).
//
// The 6 CONTEXT.md-locked form fields:
//   1. Name (required, becomes slug via server-side kebab-case normalization)
//   2. Schedule type (Interval / Daily / Weekly / One-shot)
//   3. Schedule params (per-type: every+unit / at / day+at / datetime-local)
//   4. Timezone (optional IANA text input — hidden for Interval, visible for
//      Daily/Weekly/One-shot; blank falls back to auto-detected browser tz)
//   5. Instruction (required, multiline)
//   6. Enabled (default: true)
//
// Save is disabled until Name AND Instruction non-empty AND
// slug-normalization of Name yields a non-empty string AND validateForm
// returns null. On success onOpenChange(false) closes + resets form state;
// on rejection surfaces err.message inline and keeps the dialog open.

import { useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/button";
import { Switch } from "@/components/switch";
import type { WakeupSpecWire } from "@/api/claude-session-api";
import {
  type FormSchedule,
  type Weekday,
  buildSchedule,
  detectBrowserTimezone,
  pad2,
  RestrictToDaysChips,
  validateForm,
} from "./WakeupFormShared";

// Slug regex must match writeRoleWakeupCreate / writeIdentityWakeupCreate on
// the backend (kebab-case, lowercase, alphanumerics + hyphens). Used ONLY to
// determine whether Save should be enabled — the server owns authoritative
// slug derivation and the client never sends its own slug.
function normalizeSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Build a one-hour-from-now default for one_shot's datetime-local input.
function defaultOneShotAt(): string {
  const d = new Date(Date.now() + 3600e3);
  d.setMinutes(0, 0, 0);
  return (
    d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
    "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes())
  );
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

  // Guard: only render the DOM tree when `open`. Radix Dialog would also
  // handle this via its open prop, but we hard-guard to keep testid queries
  // simple (Test A queries for absence when open=false).
  if (!open) return <></>;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[130] bg-black/60 backdrop-blur-sm"
        />
        <DialogPrimitive.Content
          data-testid="add-wakeup-dialog"
          onInteractOutside={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          className={cn(
            "fixed top-1/2 left-1/2 z-[131] -translate-x-1/2 -translate-y-1/2",
            "w-full max-w-lg max-h-[90vh] overflow-y-auto",
            "rounded-[20px] px-5 py-4 flex flex-col gap-3",
            "text-[#e8e4d8]",
          )}
          style={{
            background: `linear-gradient(160deg, hsla(${hue}, 45%, 25%, 0.82), hsla(${hue}, 40%, 15%, 0.88))`,
            backdropFilter: "blur(28px) saturate(1.4)",
            WebkitBackdropFilter: "blur(28px) saturate(1.4)",
            border: `1px solid hsla(${hue}, 65%, 55%, 0.32)`,
            boxShadow: `0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,220,170,0.15), 0 0 80px hsla(${hue}, 65%, 55%, 0.2)`,
          }}
        >
          <DialogPrimitive.Title className="font-heading text-sm font-semibold text-[#f0ebe0]">
            {scope === "role" ? "Add role-scope wakeup" : "Add identity-scope wakeup"}
          </DialogPrimitive.Title>

          {/* Field 1: Name */}
          <div className="flex flex-col gap-1">
            <label
              htmlFor="add-wakeup-name"
              className="text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold"
            >
              Name (becomes filename slug)
            </label>
            <input
              id="add-wakeup-name"
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="e.g. morning-standup"
              className={cn(
                "bg-black/30 text-[#e8e4d8] border border-white/10",
                "focus:outline-none focus:border-white/25 rounded px-2 py-1.5 text-xs",
              )}
            />
          </div>

          {/* Field 2: Schedule type */}
          <div className="flex flex-col gap-1">
            <label
              htmlFor="add-wakeup-type"
              className="text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold"
            >
              Schedule type
            </label>
            <select
              id="add-wakeup-type"
              value={formSchedule.type}
              onChange={(e) => {
                const next = e.target.value as FormSchedule["type"];
                if (next === "interval") setFormSchedule({ type: "interval", n: 30, u: "m" });
                else if (next === "daily") setFormSchedule({ type: "daily", at: "09:00" });
                else if (next === "weekly") setFormSchedule({ type: "weekly", day: "mon", at: "09:00" });
                else if (next === "one_shot") setFormSchedule({ type: "one_shot", at: defaultOneShotAt() });
              }}
              className={cn(
                "bg-black/30 text-[#e8e4d8] border border-white/10",
                "focus:outline-none focus:border-white/25 rounded px-2 py-1.5 text-xs",
              )}
            >
              <option value="interval">interval — every N s/m/h/d</option>
              <option value="daily">daily — at a time each day</option>
              <option value="weekly">weekly — on a day + time</option>
              <option value="one_shot">one_shot — fires once at a datetime</option>
            </select>
          </div>

          {/* Field 3: Schedule params (per-type) */}
          {formSchedule.type === "interval" && (
            <div className="flex items-end gap-2 flex-wrap">
              <div className="flex flex-col gap-1 flex-1 min-w-[110px]">
                <label
                  htmlFor="add-wakeup-every-n"
                  className="text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold"
                >
                  Every
                </label>
                <input
                  id="add-wakeup-every-n"
                  type="number"
                  min={1}
                  value={formSchedule.n}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setFormSchedule({ ...formSchedule, n: Number.isFinite(v) ? v : 1 });
                  }}
                  className={cn(
                    "bg-black/30 text-[#e8e4d8] border border-white/10",
                    "focus:outline-none focus:border-white/25 rounded px-2 py-1.5 text-xs",
                  )}
                />
              </div>
              <div className="flex flex-col gap-1 flex-1 min-w-[110px]">
                <label
                  htmlFor="add-wakeup-every-u"
                  className="text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold"
                >
                  Unit
                </label>
                <select
                  id="add-wakeup-every-u"
                  value={formSchedule.u}
                  onChange={(e) =>
                    setFormSchedule({ ...formSchedule, u: e.target.value as "s" | "m" | "h" | "d" })
                  }
                  className={cn(
                    "bg-black/30 text-[#e8e4d8] border border-white/10",
                    "focus:outline-none focus:border-white/25 rounded px-2 py-1.5 text-xs",
                  )}
                >
                  <option value="s">seconds</option>
                  <option value="m">minutes</option>
                  <option value="h">hours</option>
                  <option value="d">days</option>
                </select>
              </div>
              <RestrictToDaysChips
                hue={hue}
                days={formSchedule.days}
                onChange={(next) => setFormSchedule({ ...formSchedule, days: next })}
                slug="add"
              />
            </div>
          )}

          {formSchedule.type === "daily" && (
            <>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="add-wakeup-daily-at"
                  className="text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold"
                >
                  Time (local)
                </label>
                <input
                  id="add-wakeup-daily-at"
                  type="time"
                  value={formSchedule.at}
                  onChange={(e) => setFormSchedule({ ...formSchedule, at: e.target.value })}
                  className={cn(
                    "bg-black/30 text-[#e8e4d8] border border-white/10",
                    "focus:outline-none focus:border-white/25 rounded px-2 py-1.5 text-xs",
                  )}
                />
              </div>
              <RestrictToDaysChips
                hue={hue}
                days={formSchedule.days}
                onChange={(next) => setFormSchedule({ ...formSchedule, days: next as Weekday[] | undefined })}
                slug="add"
              />
            </>
          )}

          {formSchedule.type === "weekly" && (
            <>
              <div className="flex items-end gap-2 flex-wrap">
                <div className="flex flex-col gap-1 flex-1 min-w-[110px]">
                  <label
                    htmlFor="add-wakeup-weekly-day"
                    className="text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold"
                  >
                    Day
                  </label>
                  <select
                    id="add-wakeup-weekly-day"
                    value={formSchedule.day}
                    onChange={(e) => setFormSchedule({ ...formSchedule, day: e.target.value as Weekday })}
                    className={cn(
                      "bg-black/30 text-[#e8e4d8] border border-white/10",
                      "focus:outline-none focus:border-white/25 rounded px-2 py-1.5 text-xs",
                    )}
                  >
                    <option value="mon">Monday</option>
                    <option value="tue">Tuesday</option>
                    <option value="wed">Wednesday</option>
                    <option value="thu">Thursday</option>
                    <option value="fri">Friday</option>
                    <option value="sat">Saturday</option>
                    <option value="sun">Sunday</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1 flex-1 min-w-[110px]">
                  <label
                    htmlFor="add-wakeup-weekly-at"
                    className="text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold"
                  >
                    Time (local)
                  </label>
                  <input
                    id="add-wakeup-weekly-at"
                    type="time"
                    value={formSchedule.at}
                    onChange={(e) => setFormSchedule({ ...formSchedule, at: e.target.value })}
                    className={cn(
                      "bg-black/30 text-[#e8e4d8] border border-white/10",
                      "focus:outline-none focus:border-white/25 rounded px-2 py-1.5 text-xs",
                    )}
                  />
                </div>
              </div>
              <RestrictToDaysChips
                hue={hue}
                days={formSchedule.days}
                onChange={(next) => setFormSchedule({ ...formSchedule, days: next as Weekday[] | undefined })}
                slug="add"
              />
            </>
          )}

          {formSchedule.type === "one_shot" && (
            <div className="flex flex-col gap-1">
              <label
                htmlFor="add-wakeup-oneshot-at"
                className="text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold"
              >
                Fires at (local)
              </label>
              <input
                id="add-wakeup-oneshot-at"
                type="datetime-local"
                value={formSchedule.at}
                onChange={(e) => setFormSchedule({ ...formSchedule, at: e.target.value })}
                className={cn(
                  "bg-black/30 text-[#e8e4d8] border border-white/10",
                  "focus:outline-none focus:border-white/25 rounded px-2 py-1.5 text-xs",
                )}
              />
            </div>
          )}

          {/* Field 4: Timezone (optional, hidden for interval) */}
          {formSchedule.type !== "interval" && (
            <div className="flex flex-col gap-1">
              <label
                htmlFor="add-wakeup-tz"
                className="text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold"
              >
                Timezone (optional)
              </label>
              <input
                id="add-wakeup-tz"
                data-testid="add-wakeup-tz-input"
                type="text"
                value={tzDraft}
                onChange={(e) => setTzDraft(e.target.value)}
                placeholder={`${detectedTz} (leave blank to use)`}
                className={cn(
                  "bg-black/30 text-[#e8e4d8] border border-white/10",
                  "focus:outline-none focus:border-white/25 rounded px-2 py-1.5 text-xs",
                )}
              />
              <span className="text-[10px] text-[var(--color-pv-fg-dim)]">
                Leave blank to use box-local. Applies to Daily/Weekly/One-shot.
              </span>
            </div>
          )}

          {/* Field 5: Instruction */}
          <div className="flex flex-col gap-1">
            <label
              htmlFor="add-wakeup-instruction"
              className="text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold"
            >
              Instruction
            </label>
            <textarea
              id="add-wakeup-instruction"
              value={instructionDraft}
              onChange={(e) => setInstructionDraft(e.target.value)}
              rows={3}
              placeholder="What should the agent do when this fires?"
              className={cn(
                "bg-black/30 text-[#e8e4d8] border border-white/10",
                "focus:outline-none focus:border-white/25 rounded px-2 py-1.5 text-xs",
                "resize-y min-h-[60px]",
              )}
            />
          </div>

          {/* Field 6: Enabled */}
          <div className="flex items-center gap-2">
            <Switch
              id="add-wakeup-enabled"
              checked={enabledDraft}
              onCheckedChange={setEnabledDraft}
            />
            <label htmlFor="add-wakeup-enabled" className="text-xs text-[var(--color-pv-fg)]">
              Enabled
            </label>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="add-wakeup-save"
              onClick={handleSave}
              disabled={saveDisabled}
              className="cursor-pointer h-7"
              style={{
                background: `hsla(${hue}, 55%, 40%, 0.55)`,
                borderColor: `hsla(${hue}, 60%, 55%, 0.55)`,
                color: "#f0ebe0",
              }}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="add-wakeup-cancel"
              onClick={handleCancel}
              disabled={saving}
              className="cursor-pointer h-7"
            >
              Cancel
            </Button>
            {validationError && nameDraft.trim() !== "" && (
              <span className="text-[10px] text-rose-300 font-mono">
                {validationError}
              </span>
            )}
          </div>

          {error && (
            <div className="text-xs text-rose-300 whitespace-pre-wrap">
              {error}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
