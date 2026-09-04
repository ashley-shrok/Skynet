// Phase 72 Plan 02 Task 1: shared wakeup-form helpers extracted from
// WakeupsTab.tsx so both the inline row editor (WakeupsTab) AND the new
// add-wakeup sub-modal (AddWakeupDialog) can consume the same
// FormSchedule discriminated union + hydrate/build/validate helpers +
// day-chip UI without duplication.
//
// NON-BEHAVIOR-CHANGE extraction: every function/component below is a
// byte-shape mirror of what previously lived in WakeupsTab.tsx (quick
// 260731-2pa + Phase 65-02 additions). WakeupsTab imports its former
// helpers back in from this module; the pre-existing WakeupsTab.test.tsx
// (12 tests covering hydrate/build/validate/day-chips) continues to pass
// unchanged.

import { cn } from "@/lib/utils";

// Quick 260731-2pa: discriminated union of parsed per-type form state.
// `hydrateFormSchedule` (below) converts a raw `wakeup.schedule` object into
// this shape when entering edit-mode; `buildSchedule` is the inverse.
// Phase 65-02: `days?: Weekday[]` added to interval/daily/weekly variants
// for the optional day-of-week gate. one_shot is unchanged.
export type FormSchedule =
  | { type: "interval"; n: number; u: "s" | "m" | "h" | "d"; days?: Weekday[] }
  | { type: "daily"; at: string; days?: Weekday[] }
  | { type: "weekly"; day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"; at: string; days?: Weekday[] }
  | { type: "one_shot"; at: string /* datetime-local YYYY-MM-DDTHH:MM */ };

export const WEEKDAY_VALUES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAY_VALUES)[number];

export function isWeekday(v: unknown): v is Weekday {
  return typeof v === "string" && (WEEKDAY_VALUES as readonly string[]).includes(v);
}

// Phase 65-02: normalize raw `s.days` from the wire into a canonical
// mon→sun-ordered subset. Returns undefined for all no-gate cases:
// - non-array input
// - empty result (all entries invalid)
// - full-7 result (all days present = same as no gate, per D-02)
// Used by both hydrateFormSchedule (read) and buildSchedule (write) so the
// drop rules apply symmetrically on both ends of the round-trip (D-07).
export function normalizeDays(raw: unknown): Weekday[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<Weekday>();
  for (const entry of raw) {
    const normalized = typeof entry === "string" ? entry.toLowerCase().trim() : null;
    if (normalized !== null && isWeekday(normalized)) {
      seen.add(normalized);
    }
  }
  if (seen.size === 0 || seen.size === 7) return undefined;
  return WEEKDAY_VALUES.filter((w) => seen.has(w));
}

// Phase 65-02: capitalize first letter of a 3-letter weekday code for chip labels.
export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function detectBrowserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz !== "UTC" ? tz : "America/New_York";
  } catch {
    return "America/New_York";
  }
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Convert a `datetime-local` input string (YYYY-MM-DDTHH:MM) to a timezone-
// suffixed ISO string using the BROWSER's UTC offset at that instant. This is
// what the scheduler stores as the fire time for one_shot.
export function toIsoWithOffset(localVal: string): string {
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
export function hydrateFormSchedule(sched: unknown): FormSchedule {
  if (typeof sched !== "object" || sched === null) {
    return { type: "daily", at: "09:00" };
  }
  const s = sched as Record<string, unknown>;
  const t = s.type;
  if (t === "interval") {
    const every = typeof s.every === "string" ? s.every : "";
    const m = /^(\d+)([smhd])$/.exec(every);
    const days = normalizeDays(s.days);
    if (m) {
      return days !== undefined
        ? { type: "interval", n: Number(m[1]), u: m[2] as "s" | "m" | "h" | "d", days }
        : { type: "interval", n: Number(m[1]), u: m[2] as "s" | "m" | "h" | "d" };
    }
    return days !== undefined
      ? { type: "interval", n: 30, u: "m", days }
      : { type: "interval", n: 30, u: "m" };
  }
  if (t === "daily") {
    const at = typeof s.at === "string" && /^\d\d:\d\d$/.test(s.at) ? s.at : "09:00";
    const days = normalizeDays(s.days);
    return days !== undefined ? { type: "daily", at, days } : { type: "daily", at };
  }
  if (t === "weekly") {
    const day = isWeekday(s.day) ? s.day : "mon";
    const at = typeof s.at === "string" && /^\d\d:\d\d$/.test(s.at) ? s.at : "09:00";
    const days = normalizeDays(s.days);
    return days !== undefined ? { type: "weekly", day, at, days } : { type: "weekly", day, at };
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
// Phase 65-02: emit `days:` key only when normalizeDays returns a non-empty,
// non-full-7 subset (D-02 + D-04 drop-the-field on both bounds).
export function buildSchedule(fs: FormSchedule, tz: string): Record<string, unknown> {
  if (fs.type === "interval") {
    const base: Record<string, unknown> = { type: "interval", every: `${fs.n}${fs.u}` };
    const days = normalizeDays(fs.days);
    if (days !== undefined) base.days = days;
    return base;
  }
  if (fs.type === "daily") {
    const base: Record<string, unknown> = { type: "daily", at: fs.at, timezone: tz };
    const days = normalizeDays(fs.days);
    if (days !== undefined) base.days = days;
    return base;
  }
  if (fs.type === "weekly") {
    const base: Record<string, unknown> = { type: "weekly", day: fs.day, at: fs.at, timezone: tz };
    const days = normalizeDays(fs.days);
    if (days !== undefined) base.days = days;
    return base;
  }
  // one_shot: convert local datetime string to ISO+offset.
  return { type: "one_shot", at: toIsoWithOffset(fs.at), timezone: tz };
}

// Return the first validation error or null. Runs before Save writes.
export function validateForm(fs: FormSchedule): string | null {
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

// Phase 65-02: day-of-week chip row (D-06). Mounted under daily + weekly variant
// renders only — NOT on interval (out of scope) or one_shot (nonsensical).
// Container aria-label and chip button aria-label are CONTRACT — tests 9, 10, 11
// all query on these exact strings. Do NOT change them without updating the tests.
export function RestrictToDaysChips({
  hue,
  days,
  onChange,
  slug,
}: {
  hue: number;
  days: Weekday[] | undefined;
  onChange: (next: Weekday[] | undefined) => void;
  slug: string;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span
        id={`wakeup-days-label-${slug}`}
        className="text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold"
      >
        Restrict to days
      </span>
      <div role="group" aria-label="Restrict to days of week" className="flex flex-wrap gap-1.5">
        {WEEKDAY_VALUES.map((d) => {
          const selected = (days ?? []).includes(d);
          return (
            <button
              key={d}
              type="button"
              aria-label={`Toggle ${cap(d)}`}
              aria-pressed={selected}
              onClick={() => {
                const nextSet = new Set(days ?? []);
                if (selected) {
                  nextSet.delete(d);
                } else {
                  nextSet.add(d);
                }
                const nextArr = WEEKDAY_VALUES.filter((w) => nextSet.has(w));
                onChange(nextArr.length === 0 ? undefined : nextArr);
              }}
              className={cn(
                "cursor-pointer px-2 py-0.5 rounded-full text-[11px] font-medium uppercase tracking-wide border transition-opacity",
                !selected && "bg-slate-500/10 text-slate-400 border-slate-500/25",
              )}
              style={selected ? {
                background: `hsla(${hue}, 60%, 50%, 0.35)`,
                borderColor: `hsla(${hue}, 60%, 50%, 0.55)`,
                color: "#f0ebe0",
              } : undefined}
            >
              {cap(d)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
