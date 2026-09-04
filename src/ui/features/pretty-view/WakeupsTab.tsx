import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react";
import { Skeleton } from "@/components/skeleton";
import { Button } from "@/components/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/alert-dialog";
import { cn } from "@/lib/utils";
import type { Wakeup, WakeupSpecWire } from "@/api/claude-session-api";
import type { TabState } from "./IdentityFileTab";
import { AddWakeupDialog } from "./AddWakeupDialog";
// Phase 72 Plan 02 Task 1: FormSchedule + hydrate/build/validate helpers +
// RestrictToDaysChips lifted into a shared module so the new AddWakeupDialog
// (add-wakeup sub-modal) can consume them. Non-behavior-change refactor.
import {
  type FormSchedule,
  type Weekday,
  buildSchedule,
  detectBrowserTimezone,
  hydrateFormSchedule,
  pad2,
  RestrictToDaysChips,
  validateForm,
} from "./WakeupFormShared";

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

// Phase 72 Plan 02 Task 2: Add-wakeup pill — hue-tinted rounded-full button
// mirroring the sticky search bar hue-tint from IdentityModal L1618. Rendered
// at the top of both the data branch AND the empty-state branch so the
// first-wakeup flow is always reachable.
function AddWakeupPill({
  hue,
  onClick,
}: {
  hue: number;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid="wakeup-add-button"
      onClick={onClick}
      className={cn(
        "self-start cursor-pointer inline-flex items-center gap-1.5",
        "rounded-full px-3 py-1 text-xs font-medium",
        "text-[#f0ebe0] border transition-opacity hover:opacity-90",
      )}
      style={{
        background: `hsla(${hue}, 45%, 25%, 0.82)`,
        borderColor: `hsla(${hue}, 65%, 55%, 0.32)`,
      }}
    >
      <Plus className="h-3.5 w-3.5" />
      Add wakeup
    </button>
  );
}

export function WakeupsTab({
  state,
  hue,
  scope,
  onUpdate,
  onCreate,
  onDelete,
}: {
  state: TabState<Wakeup[]>;
  hue: number;
  scope: "role" | "identity";
  onUpdate: OnUpdate;
  onCreate: (spec: WakeupSpecWire) => Promise<void>;
  onDelete: (slug: string) => Promise<void>;
}) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);

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
      <div className="flex flex-col gap-3">
        <AddWakeupPill hue={hue} onClick={() => setAddDialogOpen(true)} />
        <div className="text-sm text-[var(--color-pv-fg-muted)]">
          No scheduled wake-ups.
        </div>
        <AddWakeupDialog
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
          hue={hue}
          scope={scope}
          onSubmit={onCreate}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <AddWakeupPill hue={hue} onClick={() => setAddDialogOpen(true)} />
      {state.data.map((wakeup) => (
        <WakeupRow
          key={wakeup.slug}
          wakeup={wakeup}
          hue={hue}
          scope={scope}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      ))}
      <AddWakeupDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        hue={hue}
        scope={scope}
        onSubmit={onCreate}
      />
    </div>
  );
}

function WakeupRow({
  wakeup,
  hue,
  scope,
  onUpdate,
  onDelete,
}: {
  wakeup: Wakeup;
  hue: number;
  scope: "role" | "identity";
  onUpdate: OnUpdate;
  onDelete: (slug: string) => Promise<void>;
}) {
  const detectedTz = useMemo(detectBrowserTimezone, []);

  // Quick 260808-<slug>: card collapsed by default to make the list scannable —
  // mirrors BountyCard's disclosure pattern. Header row (name + enabled chip +
  // schedule human + chevron) is a <button> that toggles this; instruction
  // prose + edit pencil + form editor are hidden until expanded.
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
  // Phase 72 Plan 02 Task 2: delete-confirm AlertDialog state.
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete(): Promise<void> {
    setDeleteError(null);
    setDeleting(true);
    try {
      await onDelete(wakeup.slug);
      setDeleteConfirmOpen(false);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

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
      {/* Row 1: disclosure header. Whole row toggles expanded; enabled chip
          uses stopPropagation so toggling on/off doesn't fold the card.
          When editing the schedule the row is NOT a disclosure toggle
          (the form is inline below and the name is an input, both of which
          need clicks to reach without collapsing). */}
      {editingSchedule ? (
        <div className="flex items-center gap-2 flex-wrap">
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
          {/* Phase 72 Plan 02 Task 2: scope pill — always visible per
              CONTEXT.md "every wakeup visibly declares its scope". */}
          <span
            data-testid="wakeup-scope-pill"
            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide border text-[#f0ebe0]"
            style={{
              background: `hsla(${hue}, 45%, 25%, 0.55)`,
              borderColor: `hsla(${hue}, 65%, 55%, 0.32)`,
            }}
          >
            {scope}
          </span>
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
          {/* Phase 72 Plan 02 Task 2: trash icon — opens AlertDialog confirm. */}
          <button
            type="button"
            data-testid="wakeup-delete-icon"
            onClick={() => setDeleteConfirmOpen(true)}
            aria-label="Delete this wakeup"
            title="Delete"
            className="cursor-pointer p-1 rounded text-[#a89a80] hover:text-rose-300 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex items-center gap-2 flex-wrap w-full text-left cursor-pointer pr-2"
          >
            <span className="flex flex-col min-w-0 flex-1 text-left">
              <span className="font-semibold text-[15px] text-[#f0ebe0] truncate">
                {wakeup.name}
              </span>
              <span className="text-xs text-[var(--color-pv-fg-muted)] font-mono truncate leading-tight">
                {wakeup.scheduleHuman}
              </span>
            </span>
            {/* Phase 72 Plan 02 Task 2: scope pill — always visible per
                CONTEXT.md "every wakeup visibly declares its scope". Non-
                interactive <span>, safe to nest inside the disclosure button. */}
            <span
              data-testid="wakeup-scope-pill"
              className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide border text-[#f0ebe0]"
              style={{
                background: `hsla(${hue}, 45%, 25%, 0.55)`,
                borderColor: `hsla(${hue}, 65%, 55%, 0.32)`,
              }}
            >
              {scope}
            </span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                void toggleEnabled();
              }}
              role="button"
              tabIndex={0}
              aria-label={wakeup.enabled ? "Disable this wakeup" : "Enable this wakeup"}
              title={wakeup.enabled ? "Disable" : "Enable"}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  void toggleEnabled();
                }
              }}
              className={cn(
                "shrink-0 cursor-pointer px-2 py-0.5 rounded-full text-[11px] font-medium uppercase tracking-wide border transition-opacity inline-flex items-center",
                saving === "enabled" && "opacity-50 cursor-wait",
                wakeup.enabled
                  ? "bg-emerald-500/25 text-emerald-200 border-emerald-500/40 hover:bg-emerald-500/35"
                  : "bg-slate-500/25 text-slate-300 border-slate-500/40 hover:bg-slate-500/35",
              )}
            >
              {wakeup.enabled ? "on" : "off"}
            </span>
            {/* Phase 72 Plan 02 Task 2: trash icon — nested via <span role="button">
                because the outer disclosure button forbids a real <button>
                child (invalid HTML — buttons can't nest). Same pattern as
                the enable toggle above. */}
            <span
              data-testid="wakeup-delete-icon"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteConfirmOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  setDeleteConfirmOpen(true);
                }
              }}
              role="button"
              tabIndex={0}
              aria-label="Delete this wakeup"
              title="Delete"
              className="shrink-0 cursor-pointer p-1 rounded text-[#a89a80] hover:text-rose-300 transition-colors inline-flex items-center"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-[#a89a80] transition-transform duration-150",
                expanded && "rotate-180",
              )}
            />
          </button>
        </div>
      )}

      {/* Phase 72 Plan 02 Task 2: delete-confirm AlertDialog. Mounted outside
          the header button hierarchy so the portal-rendered content is not
          affected by any parent-button click boundaries. */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete wakeup?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &apos;{wakeup.slug}&apos;? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <div className="text-xs text-rose-300 whitespace-pre-wrap">
              {deleteError}
            </div>
          )}
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={deleting}
              onClick={() => setDeleteConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              data-testid="wakeup-delete-confirm"
              disabled={deleting}
              onClick={handleDelete}
            >
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Row 2: edit-schedule pencil (view-mode, only when expanded) OR form
          editor. Schedule human already lives in the header row, so we don't
          repeat it here — just the affordance to enter edit mode. */}
      {!editingSchedule ? (
        expanded && (
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => setEditingSchedule(true)}
              aria-label="Edit schedule"
              title="Edit schedule"
              className="cursor-pointer text-[#a89a80] hover:text-[#f0ebe0] p-1 rounded transition-colors flex items-center gap-1 text-xs"
            >
              <Pencil className="size-3.5" />
              <span>Edit schedule</span>
            </button>
          </div>
        )
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
                  <RestrictToDaysChips
                    hue={hue}
                    days={formSchedule.days}
                    onChange={(next) => setFormSchedule({ ...formSchedule, days: next })}
                    slug={wakeup.slug}
                  />
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
                  <RestrictToDaysChips
                    hue={hue}
                    days={formSchedule.days}
                    onChange={(next) => setFormSchedule({ ...formSchedule, days: next })}
                    slug={wakeup.slug}
                  />
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

      {/* Row 3: instruction prose (view mode only; edit mode has textarea
          above). Only shown when the card is expanded — the point of the
          collapse is that the instruction is the tallest content in the
          card and hiding it is what makes the list scannable. */}
      {!editingSchedule && expanded && wakeup.instruction && (
        <div className="whitespace-pre-wrap text-sm text-[#e8e4d8]/90 leading-relaxed">
          {wakeup.instruction}
        </div>
      )}
    </div>
  );
}
