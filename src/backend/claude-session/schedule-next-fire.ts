/**
 * Compute the next fire epoch for a scheduled-agent / wake-up spec. Port of
 * the `_due()` + `_dur_secs()` + `_slot_at()` logic in
 * substrate/scripts/wakeup-scheduler.py, inverted: instead of returning a
 * boolean "fire now?", returns the epoch-seconds of the NEXT fire slot.
 *
 * Consumed by the scheduled-agents LIST endpoint so the modal row can show
 * "Next: in 27m" alongside the humanized schedule.
 *
 * Pragmatic simplification: the Python side honors an optional `timezone`
 * IANA zone on daily/weekly/yearly/one_shot specs. This port runs
 * daily/weekly/yearly wall-clock math in the container's local zone and ignores the `timezone`
 * field — matching the humanizer's `(box-local)` suffix and keeping the port
 * dependency-free. The resulting "Next" string is approximate when a spec
 * carries a `timezone` that differs from box-local (relative-time rounding
 * absorbs the drift for the common case). Promote to a tz-aware port if a
 * precise display becomes a requirement.
 */

type Schedule = Record<string, unknown>;

const DOW: Record<string, number> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};

/** Parse a duration string like "30m" / "2h" / "1d" / "45s" into seconds.
 *  Bare number string = minutes (matches Python _dur_secs). Returns null on
 *  malformed input so the caller can decide (we skip rendering nextFireAt). */
export function parseDurationSecs(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? raw * 60 : null;
  }
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const unit = s.slice(-1);
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  if (mult[unit] !== undefined) {
    const n = Number(s.slice(0, -1));
    return Number.isFinite(n) && n > 0 ? Math.round(n * mult[unit]) : null;
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 60) : null;
}

/** Mon=0..Sun=6 (matches Python datetime.weekday()). Takes a Date in
 *  container-local; getDay() is 0=Sun..6=Sat, so shift. */
function mondayZeroDow(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** Compute the epoch (secs) of today's HH:MM slot in container-local time. */
function slotAtToday(hhmm: string, nowSecs: number): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  const d = new Date(nowSecs * 1000);
  d.setHours(h, min, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/** Normalize the optional `days` gate on a schedule to a Set of mon=0..sun=6
 *  indices. Returns null when no gate is present or shape is unrecognized
 *  (gate inactive = fires every day). */
function normalizeDays(raw: unknown): Set<number> | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out = new Set<number>();
  for (const d of raw) {
    if (typeof d !== "string") continue;
    const key = d.toLowerCase().slice(0, 3);
    if (DOW[key] !== undefined) out.add(DOW[key]);
  }
  return out.size > 0 ? out : null;
}

/** Parse a one_shot `at` ISO datetime into epoch secs. Offset-bearing /
 *  Z-suffixed strings parse exactly; naive strings are treated as
 *  container-local (matches Python naive→astimezone() fallback). */
function parseOneShotAt(at: unknown): number | null {
  if (typeof at !== "string" || !at) return null;
  const s = at.trim();
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

/**
 * Return epoch-seconds of the next time this schedule will fire from `now`,
 * given a scheduling-reference timestamp (null when neither `.last` nor
 * `.anchored` sentinels exist for this slug). Callers should pass
 * `referenceSecs ?? anchoredSecs` — the Python scheduler's own due-check
 * uses the same precedence. Null when: schedule is malformed; schedule type
 * is unknown; a one_shot has already fired; or a days-filter prunes every
 * candidate within 14 days.
 */
export function computeNextFireAt(
  schedule: unknown,
  referenceSecs: number | null,
  nowSecs: number,
): number | null {
  if (typeof schedule !== "object" || schedule === null) return null;
  const sch = schedule as Schedule;
  const type = sch.type;
  const daysGate = normalizeDays(sch.days);

  /** Walk forward day-by-day until the candidate's weekday is inside the
   *  gate (or the gate is inactive). Caps at 14 days to avoid infinite loop
   *  on a never-matching gate. */
  const applyDaysFilter = (candidate: number): number | null => {
    if (!daysGate) return candidate;
    let c = candidate;
    for (let i = 0; i < 14; i++) {
      const dow = mondayZeroDow(new Date(c * 1000));
      if (daysGate.has(dow)) return c;
      c += 86400;
    }
    return null;
  };

  if (type === "interval") {
    const every = parseDurationSecs(sch.every);
    if (every === null) return null;
    // When never fired: approximate next-fire as `now + every` so the UI
    // can display something right after a spec is created.
    const base = referenceSecs ?? nowSecs;
    return applyDaysFilter(base + every);
  }

  if (type === "daily") {
    const at = typeof sch.at === "string" ? sch.at : "";
    const todaySlot = slotAtToday(at, nowSecs);
    if (todaySlot === null) return null;
    // If today's slot hasn't passed, that's next. Otherwise, next = +1d.
    // Account for referenceSecs — if we already fired at today's slot
    // or later, next is tomorrow regardless of clock position.
    let candidate: number;
    if (nowSecs < todaySlot && (referenceSecs === null || referenceSecs < todaySlot)) {
      candidate = todaySlot;
    } else {
      candidate = todaySlot + 86400;
    }
    return applyDaysFilter(candidate);
  }

  if (type === "weekly") {
    const at = typeof sch.at === "string" ? sch.at : "";
    const dayRaw = typeof sch.day === "string" ? sch.day : "";
    const todaySlot = slotAtToday(at, nowSecs);
    const target = DOW[dayRaw.toLowerCase().slice(0, 3)];
    if (todaySlot === null || target === undefined) return null;
    const todayDow = mondayZeroDow(new Date(nowSecs * 1000));
    let daysForward = (target - todayDow + 7) % 7;
    // If today is the target day: fire later today if slot still ahead and
    // we haven't already fired at or past today's slot; otherwise next week.
    if (daysForward === 0) {
      const firedToday = referenceSecs !== null && referenceSecs >= todaySlot;
      if (nowSecs >= todaySlot || firedToday) daysForward = 7;
    }
    const candidate = todaySlot + daysForward * 86400;
    // Weekly specs that also carry a `days` gate are a degenerate shape
    // (humanizer surfaces them as "NEVER FIRES" when the weekly day is
    // excluded). Honor the gate by walking forward; the 14-day cap stops
    // the loop in the pathological case.
    return applyDaysFilter(candidate);
  }

  if (type === "yearly") {
    const dm = typeof sch.date === "string" ? /^(\d{2})-(\d{2})$/.exec(sch.date.trim()) : null;
    const hm = typeof sch.at === "string" ? /^(\d{1,2}):(\d{2})$/.exec(sch.at) : null;
    if (!dm || !hm) return null;
    const month = Number(dm[1]) - 1;
    const day = Number(dm[2]);
    if (month === 1 && day === 29) return null; // scheduler refuses 02-29
    const slotIn = (year: number): number | null => {
      const d = new Date(year, month, day, Number(hm[1]), Number(hm[2]), 0, 0);
      if (d.getMonth() !== month || d.getDate() !== day) return null;
      return Math.floor(d.getTime() / 1000);
    };
    const year = new Date(nowSecs * 1000).getFullYear();
    const thisYear = slotIn(year);
    if (thisYear === null) return null;
    // Slot still ahead this year (and not already fired at/after it) → this
    // year's; otherwise next year's. A missed slot (reference before it, now
    // past it) catches up on the scheduler's next poll — show it as now-ish.
    if (referenceSecs !== null && referenceSecs >= thisYear) return slotIn(year + 1);
    if (nowSecs < thisYear) return thisYear;
    return referenceSecs === null ? slotIn(year + 1) : thisYear;
  }

  if (type === "one_shot") {
    const ts = parseOneShotAt(sch.at);
    if (ts === null) return null;
    // Already fired (or spec outlived its slot without firing) → no "Next".
    if (ts <= nowSecs) return null;
    return ts;
  }

  return null;
}
