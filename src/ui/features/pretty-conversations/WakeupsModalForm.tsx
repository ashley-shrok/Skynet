// Phase 135 Plan 135-02 Task 1 — WakeupsModalForm: create/edit form
// subcomponent rendered when WakeupsModal is in the "form" view (D-19, D-27).
//
// Locked field layout (D-20 + prototype § C, in order):
//   1) Name (single-line input) — disabled on edit-mode per RESEARCH Pitfall
//      #5 (PATCH's name-vs-slug gate rejects renames-via-patch with 400).
//      Helper text below explains delete-and-recreate is the rename path.
//   2) Prompt (textarea, min-height ~96px) — hint copy verbatim from the
//      shape file § Shape.
//   3) Roles (multi-select chip-picker) — populated via listRolesForHost
//      when a host is selected; dim "Pick a host first" when none.
//   4) Host (single-select chip-picker) — disabled on edit-mode per D-21
//      (cross-host management is delete-and-recreate). Auto-selects the
//      single available host per Phase 84 CreateProjectModal pattern.
//   5) Schedule (segmented control) — Daily / Weekly / Interval / One-shot
//      per D-22, backed by WakeupFormShared.FormSchedule discriminated
//      union + hydrateFormSchedule / buildSchedule / validateForm helpers.
//      Weekly is a single-day segmented control (RESEARCH Assumption A4).
//      The optional day-of-week gate component from WakeupFormShared is
//      deliberately NOT rendered in v1 — hand-editors can still set
//      `schedule.days` on disk and it is preserved on save via the
//      raw-spec passthrough below.
//
// Footer: Cancel (left) + Save (right, primary blue) per D-19. Save
// disabled while inflight OR when validateForm returns a message.
//
// Error banner: inline at top of form body, role="alert", API message
// verbatim per D-25. Dismissible + auto-clears on successful save.
//
// Round-trip preservation: preserve top-level `skills` and nested
// `schedule.timezone` + `schedule.days` on edit-save. The modal only mutates
// fields it actually shows; hand-editor-only fields (skills, timezone that
// wasn't picked in the UI, weekday-restrict `days` gate) survive round-trip
// untouched. Matches the shape's "two paths in, one truth out" spirit —
// agents editing on disk and the UI editing through the modal are peers.
// (Amended 2026-09-24 during /close per user call: "agents are the only
// ones who are going to be editing wake-ups on disk, so whatever would
// cause less problems here" → preserve everything the UI doesn't touch.)
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
import { cn } from "@/lib/utils";
import {
  type FormSchedule,
  buildSchedule,
  detectBrowserTimezone,
  hydrateFormSchedule,
  validateForm,
  WEEKDAY_VALUES,
  type Weekday,
} from "@/features/pretty-view/WakeupFormShared";
import {
  createWakeup,
  updateWakeup,
  type GlobalWakeupSpecWire,
  type WakeupListItem,
} from "@/api/wakeups-api";
import { listRolesForHost, type RoleSummary } from "@/api/identities-api";
import type { Host } from "@/types/ui-types";

// ---------------------------------------------------------------------------
// Error mapping (verbatim adapt of CreateProjectModal.tsx:76-97, wake-ups
// framing per PATTERNS.md § Error mapping and D-25).
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
    return `A wake-up named "${rawName}" already exists on this host — pick a different name.`;
  }
  if (status === 400) {
    const msg = err instanceof Error ? err.message : "";
    return msg || "Wake-up schedule is malformed — check the fields.";
  }
  return err instanceof Error && err.message.length > 0
    ? err.message
    : "Couldn't save wake-up — try again.";
}

// ---------------------------------------------------------------------------
// Chip-picker chrome tokens (magenta = selected, dim = addable). Mirrors
// the row's role-chip tokens from WakeupsModalRow.tsx.
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

export interface WakeupsModalFormProps {
  mode: "create" | "edit";
  initialSpec: WakeupListItem | null;
  flatHosts: Host[];
  onCancel: () => void;
  onSaved: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WakeupsModalForm({
  mode,
  initialSpec,
  flatHosts,
  onCancel,
  onSaved,
}: WakeupsModalFormProps): JSX.Element {
  // ─── Form state ──────────────────────────────────────────────────────
  const [name, setName] = useState<string>(initialSpec?.name ?? "");
  const [prompt, setPrompt] = useState<string>(initialSpec?.prompt ?? "");
  const [selectedRoles, setSelectedRoles] = useState<string[]>(
    initialSpec?.roles ?? [],
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
  // `skills` and `schedule.timezone` survive an edit-save round-trip.
  const initialSpecRef = useRef<WakeupListItem | null>(initialSpec);

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
    if (mode === "create" && flatHosts.length === 1 && selectedHost === null) {
      setSelectedHost(flatHosts[0]);
    }
  }, [mode, flatHosts, selectedHost]);

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
      setError("Prompt is required.");
      return;
    }
    if (selectedHost === null) {
      setError("Pick a host to save.");
      return;
    }
    const scheduleError = validateForm(formSchedule);
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
      // `skills` + `schedule.timezone` + `schedule.days`. The modal only
      // mutates fields it actually shows; hand-editor-only fields survive
      // round-trip untouched. (Amended 2026-09-24 during /close — see the
      // file header for rationale.)
      const tz = detectBrowserTimezone();
      const scheduleObj: Record<string, unknown> = buildSchedule(
        formSchedule,
        tz,
      );

      // Preserve the raw spec's timezone + days-restrict when the schedule
      // kind supports them. buildSchedule already emits `timezone` from the
      // detected browser zone, but this preserves the ORIGINAL zone when
      // the user hand-picked one on disk. `days` is the hand-editor-only
      // weekday-restrict gate — the modal never surfaces it, but any array
      // the disk carries survives round-trip untouched.
      if (
        mode === "edit" &&
        initialSpecRef.current !== null &&
        typeof initialSpecRef.current.schedule === "object" &&
        initialSpecRef.current.schedule !== null
      ) {
        const rawSched = initialSpecRef.current.schedule as Record<
          string,
          unknown
        >;
        if (
          typeof rawSched.timezone === "string" &&
          rawSched.timezone.length > 0 &&
          formSchedule.type !== "interval"
        ) {
          scheduleObj.timezone = rawSched.timezone;
        }
        if (Array.isArray(rawSched.days) && rawSched.days.length > 0) {
          scheduleObj.days = rawSched.days;
        }
      }

      const preservedSkills: string[] =
        mode === "edit" && initialSpecRef.current !== null
          ? initialSpecRef.current.skills
          : [];

      const enabledPassthrough =
        mode === "edit" && initialSpecRef.current !== null
          ? initialSpecRef.current.enabled
          : true;

      const spec: GlobalWakeupSpecWire = {
        name: mode === "edit" ? initialSpecRef.current!.name : trimmedName,
        prompt: trimmedPrompt,
        schedule: scheduleObj,
        roles: selectedRoles,
        skills: preservedSkills,
        enabled: enabledPassthrough,
      };

      if (mode === "create") {
        await createWakeup(hostIdNum, spec);
      } else {
        await updateWakeup(initialSpecRef.current!.slug, hostIdNum, spec);
      }

      onSaved();
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
    selectedRoles,
    selectedHost,
    formSchedule,
    onSaved,
  ]);

  // ─── Chip toggle helpers ──────────────────────────────────────────────
  const toggleRole = useCallback((roleName: string): void => {
    setSelectedRoles((current) =>
      current.includes(roleName)
        ? current.filter((r) => r !== roleName)
        : [...current, roleName],
    );
  }, []);

  const removeRole = useCallback((roleName: string): void => {
    setSelectedRoles((current) => current.filter((r) => r !== roleName));
  }, []);

  const addableRoles = useMemo<string[]>(() => {
    const set = new Set(selectedRoles);
    return availableRoles
      .map((r) => r.name)
      .filter((n) => !set.has(n))
      .sort((a, b) => a.localeCompare(b));
  }, [availableRoles, selectedRoles]);

  // ─── Render ───────────────────────────────────────────────────────────
  const nameDisabled = mode === "edit";
  const hostDisabled = mode === "edit";
  // Hide the host picker entirely in create mode when the user has access
  // to only one host — auto-select handles it, and rendering a picker for
  // a single option is noise. Edit mode always shows the locked chip so
  // the user knows which host owns the wake-up they're editing.
  const hostFieldHidden = mode === "create" && flatHosts.length === 1;
  const scheduleValidationMsg = validateForm(formSchedule);
  const saveDisabled =
    inFlight ||
    scheduleValidationMsg !== null ||
    name.trim().length === 0 ||
    prompt.trim().length === 0 ||
    selectedHost === null;

  return (
    <div
      className="flex flex-col flex-1 min-h-0"
      data-testid="wakeups-modal-form"
    >
      {/* ─── Body (scrollable form column) ─────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-4">
        {/* Inline error banner (D-25) */}
        {error !== null && (
          <div
            role="alert"
            data-testid="wakeups-modal-form-error"
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
            htmlFor="wakeups-modal-form-name-input"
            className="text-xs font-medium text-[color:var(--color-pv-fg-muted)]"
          >
            Name
          </label>
          <input
            id="wakeups-modal-form-name-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="morning-triage"
            disabled={nameDisabled}
            maxLength={120}
            data-testid="wakeups-modal-form-name"
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
              To rename, delete this wake-up and create a new one.
            </p>
          )}
        </div>

        {/* Field 2: Prompt (D-20 order 2) */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="wakeups-modal-form-prompt-input"
            className="text-xs font-medium text-[color:var(--color-pv-fg-muted)]"
          >
            Prompt
          </label>
          <textarea
            id="wakeups-modal-form-prompt-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should this wake-up do?"
            rows={4}
            data-testid="wakeups-modal-form-prompt"
            className={cn(
              "w-full px-3 py-2 rounded-lg text-sm text-[#e8e4d8] resize-y",
              "bg-black/20 border border-white/10 outline-none min-h-[96px]",
              "focus:border-[hsla(220,65%,55%,0.5)] focus:bg-black/30",
              "placeholder:text-[color:var(--color-pv-fg-dim)]",
              "transition-colors duration-150",
            )}
          />
          <p className="text-[11px] text-[color:var(--color-pv-fg-dim)]">
            This becomes the first user message to a freshly-born agent.
            Assume it starts with no memory — reference logs, role files,
            or bounties if continuity matters.
          </p>
        </div>

        {/* Field 3: Roles (D-20 order 3) */}
        <div
          className="flex flex-col gap-2"
          data-testid="wakeups-modal-form-roles"
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
                      data-testid={`wakeups-modal-form-role-selected-${r}`}
                    >
                      <span>{r}</span>
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
                      data-testid={`wakeups-modal-form-role-addable-${r}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )}
              {selectedRoles.length === 0 && addableRoles.length === 0 && (
                <p className="text-[11px] text-[color:var(--color-pv-fg-dim)]">
                  No roles on this host.
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
          data-testid="wakeups-modal-form-host"
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
                  data-testid="wakeups-modal-form-host-locked"
                >
                  {selectedHost?.name ?? initialSpec?.host ?? "unknown"}
                </span>
              </div>
              <p className="text-[11px] text-[color:var(--color-pv-fg-dim)]">
                Host cannot be changed on an existing wake-up. Delete and
                recreate on the target host if needed.
              </p>
            </>
          ) : (
            <div className="flex flex-row flex-wrap gap-1.5">
              {flatHosts.length === 0 && (
                <p className="text-[11px] text-[color:var(--color-pv-fg-dim)]">
                  No hosts available.
                </p>
              )}
              {flatHosts.map((h) => {
                const active = selectedHost?.id === h.id;
                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setSelectedHost(h)}
                    className="inline-flex items-center rounded-full px-3 py-1 text-[12px] font-medium leading-[16px] cursor-pointer"
                    style={active ? HOST_CHIP_SELECTED : HOST_CHIP_ADDABLE}
                    data-testid={`wakeups-modal-form-host-option-${h.id}`}
                  >
                    {h.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        )}

        {/* Field 5: Schedule (D-20 order 5, D-22 kinds) */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-[color:var(--color-pv-fg-muted)]">
            Schedule
          </label>

          {/* Segmented control — kind picker */}
          <div
            className="flex flex-row gap-1 rounded-md p-1"
            data-testid="wakeups-modal-form-schedule-kind"
            style={{
              background: "rgba(0, 0, 0, 0.20)",
              border: "1px solid rgba(220, 225, 245, 0.10)",
            }}
          >
            {(
              [
                { key: "daily", label: "Daily" },
                { key: "weekly", label: "Weekly" },
                { key: "interval", label: "Interval" },
                { key: "one_shot", label: "One-shot" },
              ] as const
            ).map(({ key, label }) => {
              const active = formSchedule.type === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    // Switch kind — seed with a sensible default per kind.
                    if (key === "daily") {
                      setFormSchedule({ type: "daily", at: "09:00" });
                    } else if (key === "weekly") {
                      setFormSchedule({
                        type: "weekly",
                        day: "mon",
                        at: "09:00",
                      });
                    } else if (key === "interval") {
                      setFormSchedule({ type: "interval", n: 30, u: "m" });
                    } else {
                      const d = new Date(Date.now() + 3600e3);
                      d.setMinutes(0, 0, 0);
                      const pad = (n: number) =>
                        String(n).padStart(2, "0");
                      const local =
                        d.getFullYear() +
                        "-" +
                        pad(d.getMonth() + 1) +
                        "-" +
                        pad(d.getDate()) +
                        "T" +
                        pad(d.getHours()) +
                        ":" +
                        pad(d.getMinutes());
                      setFormSchedule({ type: "one_shot", at: local });
                    }
                  }}
                  className="flex-1 px-2 py-1 rounded text-[11px] font-medium cursor-pointer transition-colors duration-150"
                  style={active ? SCHEDULE_KIND_ACTIVE : SCHEDULE_KIND_INACTIVE}
                  data-testid={`wakeups-modal-form-schedule-kind-${key}`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Contextual detail fields per kind */}
          {formSchedule.type === "daily" && (
            <div className="flex flex-row items-center gap-2">
              <label className="text-[11px] text-[color:var(--color-pv-fg-muted)]">
                At
              </label>
              <input
                type="time"
                value={formSchedule.at}
                onChange={(e) =>
                  setFormSchedule({ type: "daily", at: e.target.value })
                }
                data-testid="wakeups-modal-form-schedule-daily-at"
                className={cn(
                  "px-2 py-1 rounded-md text-sm text-[#e8e4d8]",
                  "bg-black/20 border border-white/10 outline-none",
                  "focus:border-[hsla(220,65%,55%,0.5)]",
                )}
              />
            </div>
          )}

          {formSchedule.type === "weekly" && (
            <div className="flex flex-col gap-2">
              <div
                className="flex flex-row gap-1 rounded-md p-1"
                data-testid="wakeups-modal-form-schedule-weekly-day"
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
                      onClick={() =>
                        setFormSchedule({
                          type: "weekly",
                          day: d,
                          at: formSchedule.at,
                        })
                      }
                      className="flex-1 px-1 py-1 rounded text-[10px] font-medium uppercase tracking-wide cursor-pointer transition-colors duration-150"
                      style={active ? SCHEDULE_KIND_ACTIVE : SCHEDULE_KIND_INACTIVE}
                      data-testid={`wakeups-modal-form-schedule-weekly-day-${d}`}
                    >
                      {WEEKDAY_LABELS[d]}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-row items-center gap-2">
                <label className="text-[11px] text-[color:var(--color-pv-fg-muted)]">
                  At
                </label>
                <input
                  type="time"
                  value={formSchedule.at}
                  onChange={(e) =>
                    setFormSchedule({
                      type: "weekly",
                      day: formSchedule.day,
                      at: e.target.value,
                    })
                  }
                  data-testid="wakeups-modal-form-schedule-weekly-at"
                  className={cn(
                    "px-2 py-1 rounded-md text-sm text-[#e8e4d8]",
                    "bg-black/20 border border-white/10 outline-none",
                    "focus:border-[hsla(220,65%,55%,0.5)]",
                  )}
                />
              </div>
            </div>
          )}

          {formSchedule.type === "interval" && (
            <div className="flex flex-row items-center gap-2">
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
                    type: "interval",
                    n: Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
                    u: formSchedule.u,
                  });
                }}
                data-testid="wakeups-modal-form-schedule-interval-n"
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
                    type: "interval",
                    n: formSchedule.n,
                    u: e.target.value as "s" | "m" | "h" | "d",
                  })
                }
                data-testid="wakeups-modal-form-schedule-interval-u"
                className="px-2 py-1 rounded-md text-sm text-[#e8e4d8] bg-black/20 border border-white/10 outline-none cursor-pointer"
              >
                <option value="s">seconds</option>
                <option value="m">minutes</option>
                <option value="h">hours</option>
                <option value="d">days</option>
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
                data-testid="wakeups-modal-form-schedule-oneshot-at"
                className={cn(
                  "px-2 py-1 rounded-md text-sm text-[#e8e4d8]",
                  "bg-black/20 border border-white/10 outline-none",
                  "focus:border-[hsla(220,65%,55%,0.5)]",
                )}
              />
            </div>
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
          data-testid="wakeups-modal-form-cancel"
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
          data-testid="wakeups-modal-form-save"
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
