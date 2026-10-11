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
//
// The schedule shape mirrors the scheduler's spec format (schedule-format v2):
// `at` stays a string for one time and becomes a list for several; the
// repeating kinds share days / start / until / count. Keys the form doesn't
// model are carried in `extra` so an edit never drops them.

import { cn } from "@/lib/utils";

// Quick 260731-2pa: discriminated union of parsed per-type form state.
// `hydrateFormSchedule` (below) converts a raw `wakeup.schedule` object into
// this shape when entering edit-mode; `buildSchedule` is the inverse.
// Phase 65-02: `days?: Weekday[]` added to interval/daily/weekly variants
// for the optional day-of-week gate. one_shot is unchanged.
// "mo" = calendar months (scheduler adds months, clamping the day).
export type IntervalUnit = "s" | "m" | "h" | "d" | "mo";

/** Spec `at` for the calendar kinds: one "HH:MM", or a list of them. */
export type Times = string | string[];
export type MonthDay = number | "last";
export type Nth = 1 | 2 | 3 | 4 | "last";
export type TimeWindow = { from: string; to: string };

/** Fields every repeating kind (not one_shot) may carry. `start` / `until`
 *  hold the spec's ISO strings verbatim so an untouched value round-trips. */
export type RepeatFields = {
  days?: Weekday[];
  start?: string;
  until?: string;
  count?: number;
  extra?: Record<string, unknown>;
};

export type FormSchedule =
  | ({ type: "interval"; n: number; u: IntervalUnit; window?: TimeWindow } & RepeatFields)
  | ({ type: "daily"; at: Times } & RepeatFields)
  | ({ type: "weekly"; day: Weekday; at: Times; every?: number } & RepeatFields)
  | ({
      type: "monthly";
      day?: MonthDay;
      nth?: Nth;
      weekday?: Weekday;
      at: Times;
      every?: number;
    } & RepeatFields)
  | ({ type: "yearly"; date: string /* MM-DD */; at: Times } & RepeatFields)
  | { type: "one_shot"; at: string /* datetime-local YYYY-MM-DDTHH:MM */ };

export type RepeatingFormSchedule = Exclude<FormSchedule, { type: "one_shot" }>;

export const WEEKDAY_VALUES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAY_VALUES)[number];

export const WEEKDAY_NAMES: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export const NTH_VALUES = [1, 2, 3, 4, "last"] as const;
const NTH_LABELS: Record<string, string> = {
  "1": "First",
  "2": "Second",
  "3": "Third",
  "4": "Fourth",
  last: "Last",
};

export const MAX_TIMES = 24;

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

export const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

// Yearly `date` is MM-DD. Feb is capped at 28 — the scheduler refuses 02-29
// (it would skip three years in four).
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function parseYearlyDate(date: string): { month: number; day: number } | null {
  const m = /^(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > DAYS_IN_MONTH[month - 1]) return null;
  return { month, day };
}

// Build MM-DD, clamping the day into the month (so switching Jan 31 → Feb
// lands on Feb 28 rather than an invalid date).
export function formatYearlyDate(month: number, day: number): string {
  const clamped = Math.min(Math.max(1, day), DAYS_IN_MONTH[month - 1]);
  return `${pad2(month)}-${pad2(clamped)}`;
}

function defaultYearlyDate(): string {
  const d = new Date();
  return formatYearlyDate(d.getMonth() + 1, d.getDate());
}

function formatLocalInput(d: Date): string {
  return (
    d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
    "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes())
  );
}

/** One hour from now, on the hour, as a datetime-local value. */
export function defaultOneShotAt(): string {
  const d = new Date(Date.now() + 3600e3);
  d.setMinutes(0, 0, 0);
  return formatLocalInput(d);
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

/** Midnight today (browser-local) as ISO+offset — the default `start` for
 *  every-N weeks/months. */
export function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return toIsoWithOffset(formatLocalInput(d));
}

/** Show a spec ISO datetime in a datetime-local input. A naive value is
 *  wall-clock already and is shown as written; a Z/offset value is converted
 *  to browser-local. */
export function isoToLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const naive = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(iso.trim());
  if (naive) return `${naive[1]}T${naive[2] ?? "00:00"}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : formatLocalInput(d);
}

/** Normalize "H:MM" / "HH:MM" to "HH:MM"; null if not a valid time of day. */
export function normalizeTime(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${pad2(h)}:${m[2]}`;
}

/** `at` as a list, for editing. */
export function timesList(at: Times): string[] {
  return Array.isArray(at) ? at : [at];
}

/** A list of times back to spec shape: a plain string when there's one. */
export function timesValue(list: string[]): Times {
  return list.length === 1 ? list[0] : list;
}

function hydrateTimes(raw: unknown): Times {
  if (Array.isArray(raw)) {
    const list: string[] = [];
    for (const entry of raw) {
      const t = normalizeTime(entry);
      if (t !== null && !list.includes(t)) list.push(t);
    }
    return list.length === 0 ? "09:00" : timesValue(list);
  }
  return normalizeTime(raw) ?? "09:00";
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}

const REPEAT_KEYS = ["type", "timezone", "days", "start", "until", "count"];

const KIND_KEYS: Record<RepeatingFormSchedule["type"], string[]> = {
  interval: ["every", "window"],
  daily: ["at"],
  weekly: ["day", "at", "every"],
  monthly: ["day", "nth", "weekday", "at", "every"],
  yearly: ["date", "at"],
};

function hydrateRepeat(s: Record<string, unknown>, type: RepeatingFormSchedule["type"]): RepeatFields {
  const out: RepeatFields = {};
  const days = normalizeDays(s.days);
  if (days !== undefined) out.days = days;
  if (typeof s.start === "string" && s.start.trim() !== "") out.start = s.start.trim();
  if (typeof s.until === "string" && s.until.trim() !== "") out.until = s.until.trim();
  if (isPositiveInt(s.count)) out.count = s.count;
  const known = new Set([...REPEAT_KEYS, ...KIND_KEYS[type]]);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (!known.has(k)) extra[k] = v;
  }
  if (Object.keys(extra).length > 0) out.extra = extra;
  return out;
}

function hydrateEvery(raw: unknown): { every?: number } {
  return isPositiveInt(raw) ? { every: raw } : {};
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
    // A bare integer (string or JSON number) is minutes.
    const every = typeof s.every === "number" ? String(s.every) : typeof s.every === "string" ? s.every.trim() : "";
    const m = /^(\d+)(mo|[smhd])?$/.exec(every);
    const base: Extract<FormSchedule, { type: "interval" }> = m
      ? { type: "interval", n: Number(m[1]), u: (m[2] ?? "m") as IntervalUnit }
      : { type: "interval", n: 30, u: "m" };
    const w = s.window as Record<string, unknown> | null | undefined;
    if (typeof w === "object" && w !== null) {
      const from = normalizeTime(w.from);
      const to = normalizeTime(w.to);
      if (from !== null && to !== null) base.window = { from, to };
    }
    return { ...base, ...hydrateRepeat(s, "interval") };
  }
  if (t === "daily") {
    return { type: "daily", at: hydrateTimes(s.at), ...hydrateRepeat(s, "daily") };
  }
  if (t === "weekly") {
    const day = isWeekday(s.day) ? s.day : "mon";
    return { type: "weekly", day, at: hydrateTimes(s.at), ...hydrateEvery(s.every), ...hydrateRepeat(s, "weekly") };
  }
  if (t === "monthly") {
    const fs: Extract<FormSchedule, { type: "monthly" }> = { type: "monthly", at: hydrateTimes(s.at) };
    const nth = s.nth === "last" || (isPositiveInt(s.nth) && s.nth <= 4) ? (s.nth as Nth) : undefined;
    if (nth !== undefined && isWeekday(s.weekday)) {
      fs.nth = nth;
      fs.weekday = s.weekday;
    } else if (s.day === "last" || (isPositiveInt(s.day) && s.day <= 31)) {
      fs.day = s.day as MonthDay;
    } else {
      fs.day = 1;
    }
    return { ...fs, ...hydrateEvery(s.every), ...hydrateRepeat(s, "monthly") };
  }
  if (t === "yearly") {
    const date = typeof s.date === "string" && parseYearlyDate(s.date) ? s.date.trim() : defaultYearlyDate();
    return { type: "yearly", date, at: hydrateTimes(s.at), ...hydrateRepeat(s, "yearly") };
  }
  if (t === "one_shot") {
    if (typeof s.at === "string") {
      const d = new Date(s.at);
      if (!Number.isNaN(d.getTime())) {
        return { type: "one_shot", at: formatLocalInput(d) };
      }
    }
    // Default to one hour from now, rounded to the hour, in local time.
    return { type: "one_shot", at: defaultOneShotAt() };
  }
  return { type: "daily", at: "09:00" };
}

/** Fresh form state for a kind picked in a type switcher. The day-of-week
 *  gate carries across repeating kinds; everything else resets. */
export function switchScheduleKind(prev: FormSchedule, next: FormSchedule["type"]): FormSchedule {
  if (next === "one_shot") return { type: "one_shot", at: defaultOneShotAt() };
  let fresh: RepeatingFormSchedule;
  if (next === "interval") fresh = { type: "interval", n: 30, u: "m" };
  else if (next === "weekly") fresh = { type: "weekly", day: "mon", at: "09:00" };
  else if (next === "monthly") fresh = { type: "monthly", day: 1, at: "09:00" };
  else if (next === "yearly") fresh = { type: "yearly", date: defaultYearlyDate(), at: "09:00" };
  else fresh = { type: "daily", at: "09:00" };
  if (prev.type !== "one_shot" && prev.days !== undefined) fresh.days = prev.days;
  return fresh;
}

function emitTimes(at: Times): Times {
  return Array.isArray(at) ? timesValue(at) : at;
}

// Build the schedule object that gets written back. Every kind includes the
// timezone (interval honors it for window / days / start).
// Phase 65-02: emit `days:` key only when normalizeDays returns a non-empty,
// non-full-7 subset (D-02 + D-04 drop-the-field on both bounds).
export function buildSchedule(fs: FormSchedule, tz: string): Record<string, unknown> {
  if (fs.type === "one_shot") {
    // one_shot: convert local datetime string to ISO+offset.
    return { type: "one_shot", at: toIsoWithOffset(fs.at), timezone: tz };
  }
  const base: Record<string, unknown> = { type: fs.type };
  if (fs.type === "interval") {
    base.every = `${fs.n}${fs.u}`;
    if (fs.window) base.window = { from: fs.window.from, to: fs.window.to };
  } else if (fs.type === "daily") {
    base.at = emitTimes(fs.at);
  } else if (fs.type === "weekly") {
    base.day = fs.day;
    base.at = emitTimes(fs.at);
    if (fs.every !== undefined) base.every = fs.every;
  } else if (fs.type === "monthly") {
    if (fs.nth !== undefined) {
      base.nth = fs.nth;
      base.weekday = fs.weekday;
    } else {
      base.day = fs.day;
    }
    base.at = emitTimes(fs.at);
    if (fs.every !== undefined) base.every = fs.every;
  } else {
    base.date = fs.date;
    base.at = emitTimes(fs.at);
  }
  base.timezone = tz;
  const days = normalizeDays(fs.days);
  if (days !== undefined) base.days = days;
  if (fs.start !== undefined) {
    base.start = fs.start;
  } else if ((fs.type === "weekly" || fs.type === "monthly") && (fs.every ?? 1) > 1) {
    // Every-N weeks/months counts from `start`; the scheduler requires it.
    base.start = startOfTodayIso();
  }
  if (fs.until !== undefined) base.until = fs.until;
  if (fs.count !== undefined) base.count = fs.count;
  return fs.extra ? { ...base, ...fs.extra } : base;
}

function validateTimes(at: Times): string | null {
  const list = timesList(at);
  if (list.length === 0) return "add at least one time";
  if (list.length > MAX_TIMES) return `at most ${MAX_TIMES} times`;
  for (const t of list) {
    if (!/^\d\d:\d\d$/.test(t) || normalizeTime(t) === null) return "`at` must be HH:MM";
  }
  if (new Set(list).size !== list.length) return "times must be different";
  return null;
}

function validDate(iso: string): boolean {
  return !Number.isNaN(new Date(iso).getTime());
}

function validateRepeat(fs: RepeatingFormSchedule): string | null {
  if (fs.start !== undefined && !validDate(fs.start)) return "start is not a valid datetime";
  if (fs.until !== undefined && !validDate(fs.until)) return "end date is not a valid datetime";
  // Compare against the start buildSchedule will actually write — it fills in
  // today for every-N weeks/months when none was picked.
  const start =
    fs.start ??
    ((fs.type === "weekly" || fs.type === "monthly") && (fs.every ?? 1) > 1 ? startOfTodayIso() : undefined);
  if (start !== undefined && fs.until !== undefined && new Date(fs.until) <= new Date(start)) {
    return "end date must be after the start";
  }
  if (fs.count !== undefined && !isPositiveInt(fs.count)) return "run count must be a whole number ≥ 1";
  return null;
}

function validateEvery(every: number | undefined, unit: string): string | null {
  if (every === undefined || isPositiveInt(every)) return null;
  return `every N ${unit} must be a whole number ≥ 1`;
}

// Return the first validation error or null. Runs before Save writes.
export function validateForm(fs: FormSchedule): string | null {
  if (fs.type === "one_shot") {
    const d = new Date(fs.at);
    if (Number.isNaN(d.getTime())) return "`at` is not a valid datetime";
    return null;
  }
  let err: string | null = null;
  if (fs.type === "interval") {
    if (!/^\d+(mo|[smhd])$/.test(`${fs.n}${fs.u}`)) {
      return "interval `every` must be like 30m, 2h, 5s, 1d, 11mo";
    }
    if (!(fs.n > 0)) return "interval `every` must be positive";
    if (fs.window) {
      if (normalizeTime(fs.window.from) === null || normalizeTime(fs.window.to) === null) {
        return "window times must be HH:MM";
      }
      if (fs.window.from === fs.window.to) return "window start and end can't be the same time";
    }
  } else if (fs.type === "daily") {
    err = validateTimes(fs.at);
  } else if (fs.type === "weekly") {
    if (!isWeekday(fs.day)) return "`day` must be one of mon..sun";
    err = validateTimes(fs.at) ?? validateEvery(fs.every, "weeks");
  } else if (fs.type === "monthly") {
    if (fs.nth !== undefined) {
      if (!(NTH_VALUES as readonly unknown[]).includes(fs.nth)) return "pick first–fourth or last";
      if (!isWeekday(fs.weekday)) return "pick a weekday";
    } else if (!(fs.day === "last" || (isPositiveInt(fs.day) && fs.day <= 31))) {
      return "day of month must be 1–31 or last";
    }
    err = validateTimes(fs.at) ?? validateEvery(fs.every, "months");
  } else {
    if (!parseYearlyDate(fs.date)) return "`date` must be a real month + day (Feb 29 isn't supported)";
    err = validateTimes(fs.at);
  }
  return err ?? validateRepeat(fs);
}


// Phase 65-02: day-of-week chip row (D-06). Mounted under the interval, daily
// and weekly variants in the wake-up forms — never on one_shot (nonsensical).
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

// Month select + day-of-month input for the yearly schedule kind. Shared by
// the wake-up dialogs and the scheduled-tasks form; each passes its own
// input styling so the picker matches the surrounding fields.
export function YearlyDateFields({
  date,
  onChange,
  idPrefix,
  inputClassName,
  labelClassName,
}: {
  date: string;
  onChange: (next: string) => void;
  idPrefix: string;
  inputClassName: string;
  labelClassName: string;
}): JSX.Element {
  const parsed = parseYearlyDate(date) ?? { month: 1, day: 1 };
  return (
    <>
      <div className="flex flex-col gap-1 flex-1 min-w-[110px]">
        <label htmlFor={`${idPrefix}-month`} className={labelClassName}>
          Month
        </label>
        <select
          id={`${idPrefix}-month`}
          data-testid={`${idPrefix}-month`}
          value={parsed.month}
          onChange={(e) => onChange(formatYearlyDate(Number(e.target.value), parsed.day))}
          className={inputClassName}
        >
          {MONTH_LABELS.map((label, i) => (
            <option key={label} value={i + 1}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1 w-[70px]">
        <label htmlFor={`${idPrefix}-day`} className={labelClassName}>
          Day
        </label>
        <input
          id={`${idPrefix}-day`}
          data-testid={`${idPrefix}-day`}
          type="number"
          min={1}
          max={DAYS_IN_MONTH[parsed.month - 1]}
          value={parsed.day}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (Number.isFinite(n)) onChange(formatYearlyDate(parsed.month, n));
          }}
          className={inputClassName}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared schedule field groups. Like YearlyDateFields, each takes an
// idPrefix plus the host form's input/label classes so it blends into the
// wake-up dialogs and the scheduled-tasks form alike.
// ---------------------------------------------------------------------------

type FieldStyle = {
  idPrefix: string;
  inputClassName: string;
  labelClassName: string;
  /** Small secondary buttons (add/remove time). */
  buttonClassName?: string;
};

const DEFAULT_BUTTON_CLASS =
  "cursor-pointer px-2 py-1 rounded text-[11px] border border-white/10 bg-white/5 text-[#e8e4d8] hover:bg-white/10 transition-colors";
const CHECKBOX_CLASS = "w-3.5 h-3.5 accent-sky-500 cursor-pointer";
const HINT_CLASS = "text-[11px] text-[color:var(--color-pv-fg-dim)]";

type MonthlyFormSchedule = Extract<FormSchedule, { type: "monthly" }>;

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** A time an hour after the last one that isn't already in the list. */
function suggestNextTime(list: string[]): string {
  const last = normalizeTime(list[list.length - 1]) ?? "09:00";
  let mins = Number(last.slice(0, 2)) * 60 + Number(last.slice(3));
  for (let i = 0; i < 24; i++) {
    mins = (mins + 60) % 1440;
    const t = `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
    if (!list.includes(t)) return t;
  }
  return last;
}

/** One or more times of day, with add / remove. The first input carries
 *  `idPrefix` as its id and test id; later ones get `-2`, `-3`, … */
export function TimesField({
  at,
  onChange,
  label,
  idPrefix,
  inputClassName,
  labelClassName,
  buttonClassName = DEFAULT_BUTTON_CLASS,
}: FieldStyle & {
  at: Times;
  onChange: (next: Times) => void;
  label: string;
}) {
  const list = timesList(at);
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label htmlFor={idPrefix} className={labelClassName}>
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        {list.map((t, i) => {
          const id = i === 0 ? idPrefix : `${idPrefix}-${i + 1}`;
          return (
            <div key={i} className="flex items-center gap-1">
              <input
                id={id}
                data-testid={id}
                type="time"
                aria-label={i === 0 ? undefined : `Time ${i + 1}`}
                value={t}
                onChange={(e) => {
                  const next = [...list];
                  next[i] = e.target.value;
                  onChange(timesValue(next));
                }}
                className={inputClassName}
              />
              {list.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove time ${i + 1}`}
                  data-testid={`${idPrefix}-remove-${i + 1}`}
                  onClick={() => onChange(timesValue(list.filter((_, j) => j !== i)))}
                  className={buttonClassName}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        {list.length < MAX_TIMES && (
          <button
            type="button"
            data-testid={`${idPrefix}-add`}
            onClick={() => onChange([...list, suggestNextTime(list)])}
            className={buttonClassName}
          >
            + Add time
          </button>
        )}
      </div>
    </div>
  );
}

/** datetime-local bound to a spec ISO string (see isoToLocalInput). Clearing
 *  the input reports `emptyValue`. */
function DateTimeInput({
  id,
  value,
  onChange,
  emptyValue,
  className,
  ariaLabel,
}: {
  id: string;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  emptyValue: string | undefined;
  className: string;
  ariaLabel?: string;
}) {
  return (
    <input
      id={id}
      data-testid={id}
      type="datetime-local"
      aria-label={ariaLabel}
      value={isoToLocalInput(value)}
      onChange={(e) => onChange(e.target.value ? toIsoWithOffset(e.target.value) : emptyValue)}
      className={cn("min-w-0 max-w-full", className)}
    />
  );
}

/** "Every N weeks/months" for weekly + monthly. 1 is the default and is
 *  stored as undefined. */
export function EveryNField({
  every,
  unit,
  onChange,
  idPrefix,
  inputClassName,
  labelClassName,
}: FieldStyle & {
  every: number | undefined;
  unit: "weeks" | "months";
  onChange: (next: number | undefined) => void;
}) {
  const id = `${idPrefix}-every`;
  const value = every ?? 1;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={labelClassName}>
        Repeat every
      </label>
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          data-testid={id}
          type="number"
          min={1}
          value={Number.isNaN(value) ? "" : value}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onChange(n === 1 ? undefined : n);
          }}
          className={cn("w-20", inputClassName)}
        />
        <span className={HINT_CLASS}>{value === 1 ? unit.slice(0, -1) : unit}</span>
      </div>
    </div>
  );
}

/** Optional `start`. Interval uses the checkbox form (off by default);
 *  every-N weeks/months uses the plain form, where blank means "today". */
export function StartField({
  start,
  onChange,
  toggleable,
  label,
  hint,
  idPrefix,
  inputClassName,
  labelClassName,
}: FieldStyle & {
  start: string | undefined;
  onChange: (next: string | undefined) => void;
  toggleable: boolean;
  label: string;
  hint?: string;
}) {
  const id = `${idPrefix}-start`;
  if (toggleable) {
    const on = start !== undefined;
    return (
      <div className="flex flex-col gap-1">
        <label className={cn("flex items-center gap-1.5 cursor-pointer", labelClassName)}>
          <input
            type="checkbox"
            data-testid={`${id}-toggle`}
            checked={on}
            onChange={(e) => onChange(e.target.checked ? toIsoWithOffset(defaultOneShotAt()) : undefined)}
            className={CHECKBOX_CLASS}
          />
          {label}
        </label>
        {on && (
          <DateTimeInput
            id={id}
            ariaLabel={label}
            value={start}
            onChange={onChange}
            emptyValue=""
            className={inputClassName}
          />
        )}
        {on && hint && <span className={HINT_CLASS}>{hint}</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label htmlFor={id} className={labelClassName}>
        {label}
      </label>
      <DateTimeInput id={id} value={start} onChange={onChange} emptyValue={undefined} className={inputClassName} />
      {hint && <span className={HINT_CLASS}>{hint}</span>}
    </div>
  );
}

/** Interval "Only between" time-of-day window (off by default). */
export function IntervalWindowFields({
  value,
  onChange,
  idPrefix,
  inputClassName,
  labelClassName,
}: FieldStyle & {
  value: TimeWindow | undefined;
  onChange: (next: TimeWindow | undefined) => void;
}) {
  const on = value !== undefined;
  return (
    <div className="flex flex-col gap-1">
      <label className={cn("flex items-center gap-1.5 cursor-pointer", labelClassName)}>
        <input
          type="checkbox"
          data-testid={`${idPrefix}-window-toggle`}
          checked={on}
          onChange={(e) => onChange(e.target.checked ? { from: "09:00", to: "17:00" } : undefined)}
          className={CHECKBOX_CLASS}
        />
        Only between
      </label>
      {on && (
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            id={`${idPrefix}-window-from`}
            data-testid={`${idPrefix}-window-from`}
            type="time"
            aria-label="From"
            value={value.from}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
            className={inputClassName}
          />
          <span className={HINT_CLASS}>and</span>
          <input
            id={`${idPrefix}-window-to`}
            data-testid={`${idPrefix}-window-to`}
            type="time"
            aria-label="To"
            value={value.to}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            className={inputClassName}
          />
          {value.from > value.to && <span className={HINT_CLASS}>(overnight)</span>}
        </div>
      )}
    </div>
  );
}

/** Monthly: "Day of month" (1–31 / last) vs "Weekday of month" (first
 *  Monday … last Friday). */
export function MonthlyDayFields({
  value,
  onChange,
  idPrefix,
  inputClassName,
  labelClassName,
}: FieldStyle & {
  value: MonthlyFormSchedule;
  onChange: (next: MonthlyFormSchedule) => void;
}) {
  const byWeekday = value.nth !== undefined;
  const cleared = { ...value, day: undefined, nth: undefined, weekday: undefined };
  const radioLabel = "flex items-center gap-1.5 cursor-pointer text-xs text-[#e8e4d8]";
  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label="Repeat by" className="flex flex-wrap gap-x-4 gap-y-1">
        <label className={radioLabel}>
          <input
            type="radio"
            name={`${idPrefix}-mode`}
            data-testid={`${idPrefix}-mode-day`}
            checked={!byWeekday}
            onChange={() => onChange({ ...cleared, day: 1 })}
            className={CHECKBOX_CLASS}
          />
          Day of month
        </label>
        <label className={radioLabel}>
          <input
            type="radio"
            name={`${idPrefix}-mode`}
            data-testid={`${idPrefix}-mode-weekday`}
            checked={byWeekday}
            onChange={() => onChange({ ...cleared, nth: 1, weekday: "mon" })}
            className={CHECKBOX_CLASS}
          />
          Weekday of month
        </label>
      </div>
      {byWeekday ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1 flex-1 min-w-[100px]">
            <label htmlFor={`${idPrefix}-nth`} className={labelClassName}>
              Which
            </label>
            <select
              id={`${idPrefix}-nth`}
              data-testid={`${idPrefix}-nth`}
              value={String(value.nth)}
              onChange={(e) =>
                onChange({ ...value, nth: e.target.value === "last" ? "last" : (Number(e.target.value) as Nth) })
              }
              className={inputClassName}
            >
              {NTH_VALUES.map((n) => (
                <option key={n} value={String(n)}>
                  {NTH_LABELS[String(n)]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[110px]">
            <label htmlFor={`${idPrefix}-weekday`} className={labelClassName}>
              Weekday
            </label>
            <select
              id={`${idPrefix}-weekday`}
              data-testid={`${idPrefix}-weekday`}
              value={value.weekday ?? "mon"}
              onChange={(e) => onChange({ ...value, weekday: e.target.value as Weekday })}
              className={inputClassName}
            >
              {WEEKDAY_VALUES.map((d) => (
                <option key={d} value={d}>
                  {WEEKDAY_NAMES[d]}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1 min-w-[100px]">
          <label htmlFor={`${idPrefix}-dom`} className={labelClassName}>
            Day
          </label>
          <select
            id={`${idPrefix}-dom`}
            data-testid={`${idPrefix}-dom`}
            value={String(value.day ?? 1)}
            onChange={(e) =>
              onChange({ ...value, day: e.target.value === "last" ? "last" : Number(e.target.value) })
            }
            className={inputClassName}
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={String(n)}>
                {ordinal(n)}
              </option>
            ))}
            <option value="last">Last day</option>
          </select>
          {typeof value.day === "number" && value.day > 28 && (
            <span className={HINT_CLASS}>Shorter months fire on their last day.</span>
          )}
        </div>
      )}
    </div>
  );
}

function defaultUntil(): string {
  const d = new Date(Date.now() + 30 * 86400e3);
  d.setHours(0, 0, 0, 0);
  return toIsoWithOffset(
    d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + "T00:00",
  );
}

/** "Ends": never / on a date-time (`until`) / after N runs (`count`). A spec
 *  carrying both shows both (whichever comes first). */
export function EndsFields({
  until,
  count,
  onChange,
  idPrefix,
  inputClassName,
  labelClassName,
}: FieldStyle & {
  until: string | undefined;
  count: number | undefined;
  onChange: (next: { until?: string; count?: number }) => void;
}) {
  const mode = until !== undefined && count !== undefined ? "both" : until !== undefined ? "until" : count !== undefined ? "count" : "never";
  const id = `${idPrefix}-ends`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={labelClassName}>
        Ends
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          id={id}
          data-testid={id}
          value={mode}
          onChange={(e) => {
            const m = e.target.value;
            if (m === "until") onChange({ until: until ?? defaultUntil() });
            else if (m === "count") onChange({ count: count ?? 10 });
            else if (m === "both") onChange({ until: until ?? defaultUntil(), count: count ?? 10 });
            else onChange({});
          }}
          className={inputClassName}
        >
          <option value="never">Never</option>
          <option value="until">On a date</option>
          <option value="count">After N runs</option>
          {mode === "both" && <option value="both">Date or N runs, whichever first</option>}
        </select>
        {until !== undefined && (
          <DateTimeInput
            id={`${idPrefix}-until`}
            ariaLabel="End date"
            value={until}
            onChange={(next) => onChange({ until: next ?? "", count })}
            emptyValue=""
            className={inputClassName}
          />
        )}
        {count !== undefined && (
          <div className="flex items-center gap-1.5">
            <input
              id={`${idPrefix}-count`}
              data-testid={`${idPrefix}-count`}
              type="number"
              min={1}
              aria-label="Number of runs"
              value={Number.isNaN(count) ? "" : count}
              onChange={(e) => onChange({ until, count: parseInt(e.target.value, 10) })}
              className={cn("w-20", inputClassName)}
            />
            <span className={HINT_CLASS}>{count === 1 ? "run" : "runs"}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** The options that sit under a repeating kind's main fields: every-N +
 *  start (weekly/monthly), window + start (interval), and Ends (all). */
export function ScheduleRepeatFields({
  fs,
  onChange,
  idPrefix,
  inputClassName,
  labelClassName,
}: FieldStyle & {
  fs: RepeatingFormSchedule;
  onChange: (next: RepeatingFormSchedule) => void;
}) {
  const style = { idPrefix, inputClassName, labelClassName };
  const setStart = (start: string | undefined) =>
    onChange({ ...fs, start });
  return (
    <div className="flex flex-col gap-3">
      {(fs.type === "weekly" || fs.type === "monthly") && (
        <div className="flex flex-wrap items-start gap-3">
          <EveryNField
            {...style}
            every={fs.every}
            unit={fs.type === "weekly" ? "weeks" : "months"}
            onChange={(every) => onChange({ ...fs, every })}
          />
          {((fs.every ?? 1) > 1 || fs.start !== undefined) && (
            <StartField
              {...style}
              start={fs.start}
              onChange={setStart}
              toggleable={false}
              label="Counting from"
              hint={`Blank = today. Every ${fs.every ?? 1} ${fs.type === "weekly" ? "weeks" : "months"} from this ${fs.type === "weekly" ? "week" : "month"}.`}
            />
          )}
        </div>
      )}
      {fs.type === "interval" && (
        <>
          <IntervalWindowFields
            {...style}
            value={fs.window}
            onChange={(window) => onChange({ ...fs, window })}
          />
          <StartField
            {...style}
            start={fs.start}
            onChange={setStart}
            toggleable
            label="Start at"
            hint="Fires land on start, start + every, start + 2×every, …"
          />
        </>
      )}
      <EndsFields
        {...style}
        until={fs.until}
        count={fs.count}
        onChange={(ends) => onChange({ ...fs, until: ends.until, count: ends.count })}
      />
    </div>
  );
}
