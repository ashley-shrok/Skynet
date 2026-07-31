import { useEffect, useMemo, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { Skeleton } from "@/components/skeleton";
import { Button } from "@/components/button";
import { cn } from "@/lib/utils";
import type { Wakeup } from "@/api/claude-session-api";
import type { TabState } from "./IdentityFileTab";

// Patch #17g: tab renderer for the identity's wakeups/*.json files.
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
// longer justified. The Ashley-signed-off prototype lives at
// ~/.claude/identities/tina/bounties/identity-modal-wakeup-form-editor/prototype.html.
//   - Form fields (edit-mode): name (text), schedule.type dropdown +
//     per-type fields, instruction (textarea), enabled (checkbox — secondary
//     path; the header chip is the primary one-click toggle).
//   - Live JSON preview on the right on ≥620px viewports.
//   - Timezone silently detected via Intl.DateTimeFormat().resolvedOptions().timeZone
//     with fallback America/New_York. Shown as a muted hint on daily / weekly /
//     one_shot; OMITTED from the emitted schedule on interval (the scheduler
//     no-ops timezone on interval per tina.md § Scheduled wake-ups).
//   - Preserves patch #154's always-visible enabled chip + one-click
//     `toggleEnabled` — the header chip in edit-mode is untouched.
//   - Backend write path was extended in the previous commit (Task 1) to
//     accept name + instruction alongside enabled + schedule.
//
// Card treatment mirrors BountyCard's glass token family.

type OnUpdate = (
  slug: string,
  // Quick 260731-2pa: widened to also accept name + instruction (form
  // editor writes the full spec on Save).
  updates: { enabled?: boolean; schedule?: unknown; name?: string; instruction?: string },
) => Promise<void>;

// Quick 260731-2pa: discriminated union of parsed per-type form state.
// `hydrateFormSchedule` (below) converts a raw `wakeup.schedule` object into
// this shape when entering edit-mode; `buildSchedule` is the inverse.
type FormSchedule =
  | { type: "interval"; n: number; u: "s" | "m" | "h" | "d" }
  | { type: "daily"; at: string }
  | { type: "weekly"; day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"; at: string }
  | { type: "one_shot"; at: string /* datetime-local YYYY-MM-DDTHH:MM */ };

const WEEKDAY_VALUES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type Weekday = (typeof WEEKDAY_VALUES)[number];

function isWeekday(v: unknown): v is Weekday {
  return typeof v === "string" && (WEEKDAY_VALUES as readonly string[]).includes(v);
}

function detectBrowserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz !== "UTC" ? tz : "America/New_York";
  } catch {
    return "America/New_York";
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Convert a `datetime-local` input string (YYYY-MM-DDTHH:MM) to a timezone-
// suffixed ISO string using the BROWSER's UTC offset at that instant. This is
// what the scheduler stores as the fire time for one_shot.
function toIsoWithOffset(localVal: string): string {
  if (!localVal) return "";
  const d = new Date(localVal);
  const off = -d.getTimezoneOffset(); // minutes east of UTC
  const sign = off >= 0 ? "+" : "-";
  const oh = pad2(Math.floor(Math.abs(off) / 60));
  const om = pad2(Math.abs(off) % 60);
  return localVal + ":00" + sign + oh + ":" + om;
}

// Hydrate a form-side FormSchedule from a server-provided `wakeup.schedule`
// object. Defaults gracefully when the input is unrecognized so entering
// edit-mode never throws.
function hydrateFormSchedule(sched: unknown): FormSchedule {
  if (typeof sched !== "object" || sched === null) {
    return { type: "daily", at: "09:00" };
  }
  const s = sched as Record<string, unknown>;
  const t = s.type;
  if (t === "interval") {
    const every = typeof s.every === "string" ? s.every : "";
    const m = /^(\d+)([smhd])$/.exec(every);
    if (m) {
      return { type: "interval", n: Number(m[1]), u: m[2] as "s" | "m" | "h" | "d" };
    }
    return { type: "interval", n: 30, u: "m" };
  }
  if (t === "daily") {
    const at = typeof s.at === "string" && /^\d\d:\d\d$/.test(s.at) ? s.at : "09:00";
    return { type: "daily", at };
  }
  if (t === "weekly") {
    const day = isWeekday(s.day) ? s.day : "mon";
    const at = typeof s.at === "string" && /^\d\d:\d\d$/.test(s.at) ? s.at : "09:00";
    return { type: "weekly", day, at };
  }
  if (t === "one_shot") {
    if (typeof s.at === "string") {
      const d = new Date(s.at);
      if (!Number.isNaN(d.getTime())) {
        const local =
          d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
          "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
        return { type: "one_shot", at: local };
      }
    }
    // Default to one hour from now, rounded to the hour, in local time.
    const d = new Date(Date.now() + 3600e3);
    d.setMinutes(0, 0, 0);
    const local =
      d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    return { type: "one_shot", at: local };
  }
  return { type: "daily", at: "09:00" };
}

// Build the schedule object that gets written back. Interval OMITS timezone
// (scheduler no-ops it); daily/weekly/one_shot include the browser-detected zone.
function buildSchedule(fs: FormSchedule, tz: string): Record<string, unknown> {
  if (fs.type === "interval") {
    return { type: "interval", every: `${fs.n}${fs.u}` };
  }
  if (fs.type === "daily") {
    return { type: "daily", at: fs.at, timezone: tz };
  }
  if (fs.type === "weekly") {
    return { type: "weekly", day: fs.day, at: fs.at, timezone: tz };
  }
  // one_shot: convert local datetime string to ISO+offset.
  return { type: "one_shot", at: toIsoWithOffset(fs.at), timezone: tz };
}

// Return the first validation error or null. Runs before Save writes.
function validateForm(fs: FormSchedule): string | null {
  if (fs.type === "interval") {
    if (!/^\d+[smhd]$/.test(`${fs.n}${fs.u}`)) {
      return "interval `every` must be like 30m, 2h, 5s, 1d";
    }
    if (!(fs.n > 0)) return "interval `every` must be positive";
    return null;
  }
  if (fs.type === "daily" || fs.type === "weekly") {
    if (!/^\d\d:\d\d$/.test(fs.at)) return "`at` must be HH:MM";
    if (fs.type === "weekly" && !isWeekday(fs.day)) return "`day` must be one of mon..sun";
    return null;
  }
  // one_shot
  const d = new Date(fs.at);
  if (Number.isNaN(d.getTime())) return "`at` is not a valid datetime";
  return null;
}

export function WakeupsTab({
  state,
  hue,
  onUpdate,
}: {
  state: TabState<Wakeup[]>;
  hue: number;
  onUpdate: OnUpdate;
}) {
  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full rounded-[var(--radius-pv-bubble)]" />
        <Skeleton className="h-24 w-full rounded-[var(--radius-pv-bubble)]" />
        <Skeleton className="h-24 w-full rounded-[var(--radius-pv-bubble)]" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="text-sm text-[color:var(--color-pv-code-fg)]">
        Couldn&apos;t load wakeups: {state.error}
      </div>
    );
  }

  if (state.data.length === 0) {
    return (
      <div className="text-sm text-[var(--color-pv-fg-muted)]">
        No scheduled wake-ups.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {state.data.map((wakeup) => (
        <WakeupRow
          key={wakeup.slug}
          wakeup={wakeup}
          hue={hue}
          onUpdate={onUpdate}
        />
      ))}
    </div>
  );
}

function WakeupRow({
  wakeup,
  hue,
  onUpdate,
}: {
  wakeup: Wakeup;
  hue: number;
  onUpdate: OnUpdate;
}) {
  const detectedTz = useMemo(detectBrowserTimezone, []);

  const [editingSchedule, setEditingSchedule] = useState(false);
  const [nameDraft, setNameDraft] = useState(wakeup.name);
  const [enabledDraft, setEnabledDraft] = useState(wakeup.enabled);
  const [instructionDraft, setInstructionDraft] = useState(wakeup.instruction);
  const [formSchedule, setFormSchedule] = useState<FormSchedule>(() =>
    hydrateFormSchedule(wakeup.schedule),
  );
  const [saving, setSaving] = useState<null | "enabled" | "form">(null);
  const [error, setError] = useState<string | null>(null);

  // Reset all drafts when the underlying wakeup identity changes (post-save
  // refresh, or a different card rendered into the same slot).
  useEffect(() => {
    setNameDraft(wakeup.name);
    setEnabledDraft(wakeup.enabled);
    setInstructionDraft(wakeup.instruction);
    setFormSchedule(hydrateFormSchedule(wakeup.schedule));
  }, [wakeup.slug, wakeup.schedule, wakeup.name, wakeup.instruction, wakeup.enabled]);

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
    const validationError = validateForm(formSchedule);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving("form");
    try {
      await onUpdate(wakeup.slug, {
        name: nameDraft,
        enabled: enabledDraft,
        schedule: buildSchedule(formSchedule, detectedTz),
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
  // wakeups/<slug>.json on Save.
  const livePreview = useMemo(() => {
    const spec = {
      name: nameDraft,
      enabled: enabledDraft,
      schedule: buildSchedule(formSchedule, detectedTz),
      instruction: instructionDraft,
    };
    return JSON.stringify(spec, null, 2);
  }, [nameDraft, enabledDraft, instructionDraft, formSchedule, detectedTz]);

  // Past-datetime hint (one_shot only).
  const oneShotPast =
    formSchedule.type === "one_shot" &&
    formSchedule.at !== "" &&
    !Number.isNaN(new Date(formSchedule.at).getTime()) &&
    new Date(formSchedule.at).getTime() < Date.now();

  return (
    <div
      className={cn(
        "rounded-[var(--radius-pv-bubble)] px-4 py-3 flex flex-col gap-2",
        "backdrop-blur-lg saturate-[1.3] [-webkit-backdrop-filter:blur(16px)_saturate(1.3)]",
        "font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif]",
      )}
      style={{
        background: `linear-gradient(160deg, hsla(${hue}, 40%, 22%, 0.5), hsla(${hue}, 35%, 14%, 0.55))`,
        border: `1px solid hsla(${hue}, 60%, 50%, 0.24)`,
        boxShadow: "0 4px 16px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,220,170,0.10)",
      }}
    >
      {/* Row 1: name (span or input) + always-visible enabled toggle chip.
          The chip is patch #154's one-click toggle — untouched in edit mode. */}
      <div className="flex items-center gap-2 flex-wrap">
        {editingSchedule ? (
          <input
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            aria-label="Wakeup name"
            className={cn(
              "flex-1 min-w-0 font-semibold text-[15px] text-[#f0ebe0]",
              "bg-black/30 border border-white/10 rounded px-2 py-1",
              "focus:outline-none focus:border-white/25",
            )}
          />
        ) : (
          <span className="font-semibold text-[15px] text-[#f0ebe0] flex-1">
            {wakeup.name}
          </span>
        )}
        <button
          type="button"
          onClick={toggleEnabled}
          disabled={saving === "enabled"}
          aria-label={wakeup.enabled ? "Disable this wakeup" : "Enable this wakeup"}
          title={wakeup.enabled ? "Disable" : "Enable"}
          className={cn(
            "cursor-pointer px-2 py-0.5 rounded-full text-[11px] font-medium uppercase tracking-wide border transition-opacity",
            saving === "enabled" && "opacity-50 cursor-wait",
            wakeup.enabled
              ? "bg-emerald-500/25 text-emerald-200 border-emerald-500/40 hover:bg-emerald-500/35"
              : "bg-slate-500/25 text-slate-300 border-slate-500/40 hover:bg-slate-500/35",
          )}
        >
          {wakeup.enabled ? "on" : "off"}
        </button>
      </div>

      {/* Row 2: schedule human OR form editor. Pencil expands the row into
          a 2-column grid (form + live JSON) on ≥620px viewports. */}
      {!editingSchedule ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-pv-fg-muted)] font-mono flex-1">
            {wakeup.scheduleHuman}
          </span>
          <button
            type="button"
            onClick={() => setEditingSchedule(true)}
            aria-label="Edit schedule"
            title="Edit schedule"
            className="cursor-pointer text-[#a89a80] hover:text-[#f0ebe0] p-1 rounded transition-colors"
          >
            <Pencil className="size-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
            {/* Left column: form fields */}
            <div className="flex flex-col gap-3">
              {/* Schedule type dropdown */}
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`wakeup-type-${wakeup.slug}`}
                  className="text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold"
                >
                  Schedule type
                </label>
                <select
                  id={`wakeup-type-${wakeup.slug}`}
                  value={formSchedule.type}
                  onChange={(e) => {
                    const next = e.target.value as FormSchedule["type"];
                    if (next === "interval") setFormSchedule({ type: "interval", n: 30, u: "m" });
                    else if (next === "daily") setFormSchedule({ type: "daily", at: "09:00" });
                    else if (next === "weekly") setFormSchedule({ type: "weekly", day: "mon", at: "09:00" });
                    else if (next === "one_shot") {
                      const d = new Date(Date.now() + 3600e3);
                      d.setMinutes(0, 0, 0);
                      const local =
                        d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
                        "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
                      setFormSchedule({ type: "one_shot", at: local });
                    }
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

              {/* Per-type fields */}
              {formSchedule.type === "interval" && (
                <div className="flex items-end gap-2 flex-wrap">
                  <div className="flex flex-col gap-1 flex-1 min-w-[110px]">
                    <label
                      htmlFor={`wakeup-every-n-${wakeup.slug}`}
                      className="text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold"
                    >
                      Every
                    </label>
                    <input
                      id={`wakeup-every-n-${wakeup.slug}`}
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
                      htmlFor={`wakeup-every-u-${wakeup.slug}`}
                      className="text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold"
                    >
                      Unit
                    </label>
                    <select
                      id={`wakeup-every-u-${wakeup.slug}`}
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
                </div>
              )}

              {formSchedule.type === "daily" && (
                <>
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor={`wakeup-daily-at-${wakeup.slug}`}
                      className="text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold"
                    >
                      Time (local)
                    </label>
                    <input
                      id={`wakeup-daily-at-${wakeup.slug}`}
                      type="time"
                      value={formSchedule.at}
                      onChange={(e) => setFormSchedule({ ...formSchedule, at: e.target.value })}
                      className={cn(
                        "bg-black/30 text-[#e8e4d8] border border-white/10",
                        "focus:outline-none focus:border-white/25 rounded px-2 py-1.5 text-xs",
                      )}
                    />
                  </div>
                  <div className="text-xs text-[var(--color-pv-fg-dim)] font-mono">
                    Timezone (auto-detected from browser): <b>{detectedTz}</b>
                  </div>
                </>
              )}

              {formSchedule.type === "weekly" && (
                <>
                  <div className="flex items-end gap-2 flex-wrap">
                    <div className="flex flex-col gap-1 flex-1 min-w-[110px]">
                      <label
                        htmlFor={`wakeup-weekly-day-${wakeup.slug}`}
                        className="text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold"
                      >
                        Day
                      </label>
                      <select
                        id={`wakeup-weekly-day-${wakeup.slug}`}
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
                        htmlFor={`wakeup-weekly-at-${wakeup.slug}`}
                        className="text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold"
                      >
                        Time (local)
                      </label>
                      <input
                        id={`wakeup-weekly-at-${wakeup.slug}`}
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
                  <div className="text-xs text-[var(--color-pv-fg-dim)] font-mono">
                    Timezone (auto-detected from browser): <b>{detectedTz}</b>
                  </div>
                </>
              )}

              {formSchedule.type === "one_shot" && (
                <>
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor={`wakeup-oneshot-at-${wakeup.slug}`}
                      className="text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold"
                    >
                      Fires at (local)
                    </label>
                    <input
                      id={`wakeup-oneshot-at-${wakeup.slug}`}
                      type="datetime-local"
                      value={formSchedule.at}
                      onChange={(e) => setFormSchedule({ ...formSchedule, at: e.target.value })}
                      className={cn(
                        "bg-black/30 text-[#e8e4d8] border border-white/10",
                        "focus:outline-none focus:border-white/25 rounded px-2 py-1.5 text-xs",
                      )}
                    />
                  </div>
                  <div className="text-xs text-[var(--color-pv-fg-dim)] font-mono">
                    Timezone (auto-detected from browser): <b>{detectedTz}</b>
                  </div>
                  {oneShotPast && (
                    <div className="text-xs text-rose-300">
                      ⚠ that datetime is in the past — the scheduler will fire this{" "}
                      <b>immediately</b> on first sight.
                    </div>
                  )}
                </>
              )}

              {/* Instruction textarea */}
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`wakeup-instruction-${wakeup.slug}`}
                  className="text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold"
                >
                  Instruction
                </label>
                <textarea
                  id={`wakeup-instruction-${wakeup.slug}`}
                  value={instructionDraft}
                  onChange={(e) => setInstructionDraft(e.target.value)}
                  rows={3}
                  className={cn(
                    "bg-black/30 text-[#e8e4d8] border border-white/10",
                    "focus:outline-none focus:border-white/25 rounded px-2 py-1.5 text-xs",
                    "resize-y min-h-[60px]",
                  )}
                />
              </div>

              {/* Enabled checkbox (secondary path — header chip is primary) */}
              <div className="flex items-center gap-2">
                <input
                  id={`wakeup-enabled-${wakeup.slug}`}
                  type="checkbox"
                  checked={enabledDraft}
                  onChange={(e) => setEnabledDraft(e.target.checked)}
                  className="w-3.5 h-3.5 accent-emerald-500"
                />
                <label
                  htmlFor={`wakeup-enabled-${wakeup.slug}`}
                  className="text-xs text-[var(--color-pv-fg)]"
                >
                  Enabled
                </label>
              </div>
            </div>

            {/* Right column: live JSON preview (≥620px) */}
            <div className="flex flex-col gap-1 min-w-0">
              <label className="text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold">
                Live JSON preview
              </label>
              <pre
                className={cn(
                  "bg-black/40 text-[#d8d4c8] border border-white/10 rounded",
                  "px-3 py-2 text-[11px] font-mono whitespace-pre overflow-auto min-h-[160px]",
                )}
                data-testid="wakeup-json-preview"
              >
                {livePreview}
              </pre>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={saveForm}
              disabled={saving === "form"}
              className="cursor-pointer h-7 gap-1"
            >
              <Check className="size-3.5" />
              {saving === "form" ? "Saving…" : "Save"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={cancelEdit}
              disabled={saving === "form"}
              className="cursor-pointer h-7 gap-1"
            >
              <X className="size-3.5" />
              Cancel
            </Button>
            <span className="text-[10px] text-[var(--color-pv-fg-dim)] font-mono">
              Scheduler reloads every ~30s
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="text-xs text-rose-300 whitespace-pre-wrap">{error}</div>
      )}

      {/* Row 3: instruction prose (view mode only; edit mode has textarea above). */}
      {!editingSchedule && wakeup.instruction && (
        <div className="whitespace-pre-wrap text-sm text-[#e8e4d8]/90 leading-relaxed">
          {wakeup.instruction}
        </div>
      )}
    </div>
  );
}
