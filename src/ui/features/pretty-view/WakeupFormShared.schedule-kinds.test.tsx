import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  type FormSchedule,
  type RepeatingFormSchedule,
  buildSchedule,
  EndsFields,
  EveryNField,
  formatYearlyDate,
  hydrateFormSchedule,
  IntervalWindowFields,
  isoToLocalInput,
  MonthlyDayFields,
  normalizeTime,
  ordinal,
  parseYearlyDate,
  ScheduleRepeatFields,
  StartField,
  startOfTodayIso,
  switchScheduleKind,
  TimesField,
  toIsoWithOffset,
  validateForm,
  YearlyDateFields,
} from "./WakeupFormShared";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const TZ = "America/New_York";
const style = { inputClassName: "", labelClassName: "" };

describe("yearly schedule — form helpers", () => {
  it("round-trips a yearly schedule through hydrate + build", () => {
    const fs = hydrateFormSchedule({ type: "yearly", date: "08-03", at: "09:30" });
    expect(fs).toEqual({ type: "yearly", date: "08-03", at: "09:30" });
    expect(buildSchedule(fs, "America/New_York")).toEqual({
      type: "yearly",
      date: "08-03",
      at: "09:30",
      timezone: "America/New_York",
    });
  });

  it("hydrates a malformed date to a valid default", () => {
    const fs = hydrateFormSchedule({ type: "yearly", date: "02-29" });
    expect(fs.type).toBe("yearly");
    if (fs.type === "yearly") {
      expect(parseYearlyDate(fs.date)).not.toBeNull();
      expect(fs.at).toBe("09:00");
    }
  });

  it("parseYearlyDate rejects 02-29 and impossible days", () => {
    expect(parseYearlyDate("02-28")).toEqual({ month: 2, day: 28 });
    expect(parseYearlyDate("02-29")).toBeNull();
    expect(parseYearlyDate("04-31")).toBeNull();
    expect(parseYearlyDate("13-01")).toBeNull();
    expect(parseYearlyDate("8-3")).toBeNull();
  });

  it("formatYearlyDate clamps the day into the month", () => {
    expect(formatYearlyDate(2, 31)).toBe("02-28");
    expect(formatYearlyDate(4, 31)).toBe("04-30");
    expect(formatYearlyDate(12, 0)).toBe("12-01");
  });

  it("validateForm flags a bad date or time", () => {
    expect(validateForm({ type: "yearly", date: "08-03", at: "09:00" })).toBeNull();
    expect(validateForm({ type: "yearly", date: "02-29", at: "09:00" })).toMatch(/date/);
    expect(validateForm({ type: "yearly", date: "08-03", at: "9am" })).toMatch(/HH:MM/);
  });
});

describe("YearlyDateFields", () => {
  it("emits a clamped MM-DD when the month changes", () => {
    const onChange = vi.fn();
    render(
      <YearlyDateFields date="01-31" onChange={onChange} idPrefix="y" inputClassName="" labelClassName="" />,
    );
    fireEvent.change(screen.getByTestId("y-month"), { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledWith("02-28");
  });

  it("emits MM-DD when the day changes", () => {
    const onChange = vi.fn();
    render(
      <YearlyDateFields date="08-03" onChange={onChange} idPrefix="y" inputClassName="" labelClassName="" />,
    );
    fireEvent.change(screen.getByTestId("y-day"), { target: { value: "15" } });
    expect(onChange).toHaveBeenCalledWith("08-15");
  });
});

describe("interval in months — form helpers", () => {
  it("round-trips Nmo through hydrate + build", () => {
    const fs = hydrateFormSchedule({ type: "interval", every: "11mo" });
    expect(fs).toEqual({ type: "interval", n: 11, u: "mo" });
    expect(buildSchedule(fs, "UTC")).toEqual({ type: "interval", every: "11mo", timezone: "UTC" });
    expect(validateForm(fs)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Schedule format v2: hydrate → build round-trips
// ---------------------------------------------------------------------------

/** hydrate → build must reproduce the spec exactly (timezone included). */
function roundTrip(spec: Record<string, unknown>): Record<string, unknown> {
  const tz = typeof spec.timezone === "string" ? spec.timezone : TZ;
  return buildSchedule(hydrateFormSchedule(spec), tz);
}

describe("format v2 — round-trips every kind and option", () => {
  const specs: Record<string, unknown>[] = [
    // The format doc's examples (timezone added where the doc omits it —
    // buildSchedule always writes one).
    { type: "interval", every: "11mo", start: "2026-09-03T09:00:00-04:00", timezone: TZ },
    {
      type: "interval",
      every: "30m",
      window: { from: "09:00", to: "17:00" },
      days: ["mon", "tue", "wed", "thu", "fri"],
      timezone: TZ,
    },
    { type: "daily", at: ["09:00", "17:00"], timezone: TZ },
    { type: "weekly", day: "fri", at: "09:00", every: 2, start: "2026-10-16T00:00:00", timezone: TZ },
    { type: "monthly", day: 1, at: "09:00", timezone: TZ },
    { type: "monthly", day: "last", at: "17:00", timezone: TZ },
    {
      type: "monthly",
      nth: "last",
      weekday: "fri",
      at: "16:00",
      every: 3,
      start: "2027-01-01T00:00:00",
      timezone: TZ,
    },
    { type: "yearly", date: "08-03", at: "09:00", until: "2030-01-01T00:00:00", count: 3, timezone: TZ },
    // Other combinations.
    { type: "interval", every: "2h", window: { from: "22:00", to: "06:00" }, count: 5, timezone: "Europe/London" },
    { type: "interval", every: "15m", until: "2026-12-31T23:59:00Z", timezone: TZ },
    { type: "daily", at: "07:30", days: ["sat", "sun"], start: "2026-11-01T00:00:00", timezone: TZ },
    { type: "daily", at: ["06:00", "12:00", "18:00"], until: "2027-01-01T00:00:00+01:00", count: 10, timezone: TZ },
    { type: "weekly", day: "mon", at: ["09:00", "13:00"], days: ["mon", "fri"], timezone: TZ },
    { type: "weekly", day: "wed", at: "10:00", every: 1, timezone: TZ },
    { type: "monthly", nth: 2, weekday: "tue", at: ["09:00", "21:00"], count: 12, timezone: TZ },
    { type: "monthly", day: 31, at: "08:00", every: 2, start: "2026-01-01T00:00:00", until: "2028-01-01T00:00:00", timezone: TZ },
    { type: "monthly", day: 15, at: "09:00", days: ["mon", "tue", "wed", "thu", "fri"], timezone: TZ },
    { type: "yearly", date: "12-25", at: ["08:00", "20:00"], days: ["sat", "sun"], start: "2026-01-01", timezone: TZ },
  ];

  for (const spec of specs) {
    it(JSON.stringify(spec), () => {
      expect(roundTrip(spec)).toEqual(spec);
      expect(validateForm(hydrateFormSchedule(spec))).toBeNull();
    });
  }

  it("carries keys the form doesn't model", () => {
    const spec = { type: "daily", at: "09:00", timezone: TZ, jitter: "5m", note: { a: 1 } };
    expect(roundTrip(spec)).toEqual(spec);
  });

  it("does not carry keys over a kind switch", () => {
    const fs = switchScheduleKind(hydrateFormSchedule({ type: "daily", at: "09:00", jitter: "5m" }), "weekly");
    expect(buildSchedule(fs, TZ)).toEqual({ type: "weekly", day: "mon", at: "09:00", timezone: TZ });
  });
});

describe("format v2 — legacy specs hydrate unchanged", () => {
  it.each([
    [{ type: "daily", at: "09:00", timezone: TZ }, { type: "daily", at: "09:00" }],
    [{ type: "daily", at: "23:00", days: ["fri", "mon"] }, { type: "daily", at: "23:00", days: ["mon", "fri"] }],
    [{ type: "weekly", day: "tue", at: "08:15" }, { type: "weekly", day: "tue", at: "08:15" }],
    [{ type: "interval", every: "2h" }, { type: "interval", n: 2, u: "h" }],
    [{ type: "interval", every: "5m", days: ["sat"] }, { type: "interval", n: 5, u: "m", days: ["sat"] }],
    [{ type: "yearly", date: "08-03", at: "09:30" }, { type: "yearly", date: "08-03", at: "09:30" }],
  ])("%j", (spec, expected) => {
    expect(hydrateFormSchedule(spec)).toStrictEqual(expected);
  });

  it("legacy interval writes gain only a timezone", () => {
    expect(buildSchedule(hydrateFormSchedule({ type: "interval", every: "2h" }), TZ)).toEqual({
      type: "interval",
      every: "2h",
      timezone: TZ,
    });
  });
});

describe("format v2 — hydrate normalization", () => {
  it("bare-integer interval `every` is minutes", () => {
    expect(hydrateFormSchedule({ type: "interval", every: 45 })).toEqual({ type: "interval", n: 45, u: "m" });
    expect(hydrateFormSchedule({ type: "interval", every: "90" })).toEqual({ type: "interval", n: 90, u: "m" });
  });

  it("one-digit hours are padded; invalid times fall back", () => {
    expect(hydrateFormSchedule({ type: "daily", at: "9:05" })).toEqual({ type: "daily", at: "09:05" });
    expect(hydrateFormSchedule({ type: "daily", at: "25:00" })).toEqual({ type: "daily", at: "09:00" });
  });

  it("time lists drop invalid entries and duplicates; one survivor becomes a string", () => {
    expect(hydrateFormSchedule({ type: "daily", at: ["09:00", "9:00", "nope", "17:00"] })).toEqual({
      type: "daily",
      at: ["09:00", "17:00"],
    });
    expect(hydrateFormSchedule({ type: "daily", at: ["09:00", "bad"] })).toEqual({ type: "daily", at: "09:00" });
    expect(hydrateFormSchedule({ type: "daily", at: [] })).toEqual({ type: "daily", at: "09:00" });
  });

  it("monthly prefers nth+weekday, falls back to day 1", () => {
    expect(hydrateFormSchedule({ type: "monthly", nth: 3, weekday: "wed", at: "09:00" })).toEqual({
      type: "monthly",
      nth: 3,
      weekday: "wed",
      at: "09:00",
    });
    expect(hydrateFormSchedule({ type: "monthly", nth: 3, at: "09:00" })).toEqual({ type: "monthly", day: 1, at: "09:00" });
    expect(hydrateFormSchedule({ type: "monthly", day: 0, at: "09:00" })).toEqual({ type: "monthly", day: 1, at: "09:00" });
  });

  it("drops a malformed window, every and count", () => {
    expect(
      hydrateFormSchedule({ type: "interval", every: "30m", window: { from: "9am", to: "17:00" }, count: 0 }),
    ).toEqual({ type: "interval", n: 30, u: "m" });
    expect(hydrateFormSchedule({ type: "weekly", day: "mon", at: "09:00", every: 1.5 })).toEqual({
      type: "weekly",
      day: "mon",
      at: "09:00",
    });
  });
});

describe("format v2 — buildSchedule", () => {
  it("writes `at` as a string for one time and a list for several", () => {
    expect(buildSchedule({ type: "daily", at: ["09:00"] }, TZ).at).toBe("09:00");
    expect(buildSchedule({ type: "daily", at: ["09:00", "17:00"] }, TZ).at).toEqual(["09:00", "17:00"]);
  });

  it("every N > 1 weeks/months without a start writes the beginning of today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 11, 15, 30));
    const today = toIsoWithOffset("2026-10-11T00:00");
    expect(startOfTodayIso()).toBe(today);
    expect(buildSchedule({ type: "weekly", day: "fri", at: "09:00", every: 2 }, TZ)).toEqual({
      type: "weekly",
      day: "fri",
      at: "09:00",
      every: 2,
      timezone: TZ,
      start: today,
    });
    expect(buildSchedule({ type: "monthly", day: 1, at: "09:00", every: 3 }, TZ).start).toBe(today);
  });

  it("every 1 (or unset) writes no start; an explicit start wins", () => {
    expect(buildSchedule({ type: "weekly", day: "fri", at: "09:00" }, TZ).start).toBeUndefined();
    expect(buildSchedule({ type: "monthly", day: 1, at: "09:00", every: 1 }, TZ).start).toBeUndefined();
    expect(
      buildSchedule({ type: "weekly", day: "fri", at: "09:00", every: 2, start: "2026-10-16T00:00:00" }, TZ).start,
    ).toBe("2026-10-16T00:00:00");
  });

  it("monthly writes day XOR nth+weekday", () => {
    expect(buildSchedule({ type: "monthly", day: "last", at: "09:00" }, TZ)).toEqual({
      type: "monthly",
      day: "last",
      at: "09:00",
      timezone: TZ,
    });
    const byWeekday = buildSchedule({ type: "monthly", nth: 1, weekday: "mon", at: "09:00" }, TZ);
    expect(byWeekday).toEqual({ type: "monthly", nth: 1, weekday: "mon", at: "09:00", timezone: TZ });
    expect("day" in byWeekday).toBe(false);
  });

  it("interval includes timezone", () => {
    expect(buildSchedule({ type: "interval", n: 30, u: "m" }, "Europe/Paris")).toEqual({
      type: "interval",
      every: "30m",
      timezone: "Europe/Paris",
    });
  });

  it("one_shot is unchanged", () => {
    const built = buildSchedule({ type: "one_shot", at: "2026-10-20T08:00" }, TZ);
    expect(built).toEqual({ type: "one_shot", at: toIsoWithOffset("2026-10-20T08:00"), timezone: TZ });
  });
});

describe("format v2 — switchScheduleKind", () => {
  it("seeds defaults per kind", () => {
    const from: FormSchedule = { type: "daily", at: "09:00" };
    expect(switchScheduleKind(from, "monthly")).toEqual({ type: "monthly", day: 1, at: "09:00" });
    expect(switchScheduleKind(from, "interval")).toEqual({ type: "interval", n: 30, u: "m" });
    expect(switchScheduleKind(from, "weekly")).toEqual({ type: "weekly", day: "mon", at: "09:00" });
    expect(switchScheduleKind(from, "yearly").type).toBe("yearly");
    expect(switchScheduleKind(from, "one_shot").type).toBe("one_shot");
  });

  it("carries the days gate across repeating kinds only", () => {
    const from: FormSchedule = { type: "daily", at: ["09:00", "10:00"], days: ["mon"], count: 3 };
    expect(switchScheduleKind(from, "interval")).toEqual({ type: "interval", n: 30, u: "m", days: ["mon"] });
    expect(switchScheduleKind(from, "one_shot")).not.toHaveProperty("days");
  });
});

describe("format v2 — validateForm", () => {
  it.each<[FormSchedule, RegExp]>([
    [{ type: "daily", at: [] }, /at least one time/],
    [{ type: "daily", at: ["09:00", "09:00"] }, /different/],
    [{ type: "daily", at: ["09:00", ""] }, /HH:MM/],
    [{ type: "daily", at: "24:00" }, /HH:MM/],
    [{ type: "daily", at: Array.from({ length: 25 }, (_, i) => `${String(i % 24).padStart(2, "0")}:${i >= 24 ? "30" : "00"}`) }, /at most 24/],
    [{ type: "weekly", day: "fri", at: "09:00", every: 0 }, /whole number/],
    [{ type: "weekly", day: "fri", at: "09:00", every: Number.NaN }, /whole number/],
    [{ type: "monthly", day: 0, at: "09:00" }, /1–31/],
    [{ type: "monthly", day: 32, at: "09:00" }, /1–31/],
    [{ type: "monthly", nth: 5 as unknown as 1, weekday: "mon", at: "09:00" }, /first–fourth/],
    [{ type: "monthly", nth: 1, at: "09:00" }, /weekday/],
    [{ type: "monthly", day: 1, at: "09:00", every: 2.5 }, /whole number/],
    [{ type: "interval", n: 30, u: "m", window: { from: "09:00", to: "09:00" } }, /same time/],
    [{ type: "interval", n: 30, u: "m", window: { from: "", to: "17:00" } }, /HH:MM/],
    [{ type: "interval", n: 30, u: "m", start: "not a date" }, /start/],
    [{ type: "daily", at: "09:00", until: "" }, /end date/],
    [{ type: "daily", at: "09:00", start: "2027-01-01T00:00:00", until: "2026-01-01T00:00:00" }, /after the start/],
    [{ type: "daily", at: "09:00", count: 0 }, /run count/],
    [{ type: "yearly", date: "08-03", at: "09:00", count: Number.NaN }, /run count/],
  ])("%j → error", (fs, re) => {
    expect(validateForm(fs)).toMatch(re);
  });

  it.each<FormSchedule>([
    { type: "daily", at: ["09:00", "17:00"] },
    { type: "weekly", day: "fri", at: "09:00", every: 2 },
    { type: "monthly", day: "last", at: "09:00", every: 12 },
    { type: "monthly", nth: "last", weekday: "fri", at: ["09:00", "16:00"] },
    { type: "interval", n: 30, u: "m", window: { from: "22:00", to: "06:00" }, start: "2026-10-12T09:00:00-04:00" },
    { type: "yearly", date: "08-03", at: "09:00", until: "2030-01-01T00:00:00", count: 3 },
  ])("%j → valid", (fs) => {
    expect(validateForm(fs)).toBeNull();
  });
});

describe("format v2 — small helpers", () => {
  it("normalizeTime", () => {
    expect(normalizeTime("9:00")).toBe("09:00");
    expect(normalizeTime("23:59")).toBe("23:59");
    expect(normalizeTime("24:00")).toBeNull();
    expect(normalizeTime("12:60")).toBeNull();
    expect(normalizeTime(900)).toBeNull();
  });

  it("isoToLocalInput keeps naive wall-clock and converts offsets", () => {
    expect(isoToLocalInput("2026-10-16T00:00:00")).toBe("2026-10-16T00:00");
    expect(isoToLocalInput("2026-10-16")).toBe("2026-10-16T00:00");
    expect(isoToLocalInput(toIsoWithOffset("2026-10-11T08:15"))).toBe("2026-10-11T08:15");
    expect(isoToLocalInput("garbage")).toBe("");
    expect(isoToLocalInput(undefined)).toBe("");
  });

  it("ordinal", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Shared field components
// ---------------------------------------------------------------------------

describe("TimesField", () => {
  it("edits a single time as a plain string; no remove button", () => {
    const onChange = vi.fn();
    render(<TimesField at="09:00" onChange={onChange} label="Time (local)" idPrefix="t" {...style} />);
    expect(screen.queryByTestId("t-remove-1")).toBeNull();
    fireEvent.change(screen.getByLabelText("Time (local)"), { target: { value: "10:30" } });
    expect(onChange).toHaveBeenCalledWith("10:30");
  });

  it("adds a time an hour after the last, as a list", () => {
    const onChange = vi.fn();
    render(<TimesField at="09:00" onChange={onChange} label="At" idPrefix="t" {...style} />);
    fireEvent.click(screen.getByTestId("t-add"));
    expect(onChange).toHaveBeenCalledWith(["09:00", "10:00"]);
  });

  it("skips times already in the list when suggesting", () => {
    const onChange = vi.fn();
    render(<TimesField at={["10:00", "09:00"]} onChange={onChange} label="At" idPrefix="t" {...style} />);
    fireEvent.click(screen.getByTestId("t-add"));
    expect(onChange).toHaveBeenCalledWith(["10:00", "09:00", "11:00"]);
  });

  it("edits and removes entries; removing down to one yields a string", () => {
    const onChange = vi.fn();
    render(<TimesField at={["09:00", "17:00"]} onChange={onChange} label="At" idPrefix="t" {...style} />);
    fireEvent.change(screen.getByTestId("t-2"), { target: { value: "18:00" } });
    expect(onChange).toHaveBeenLastCalledWith(["09:00", "18:00"]);
    fireEvent.click(screen.getByLabelText("Remove time 1"));
    expect(onChange).toHaveBeenLastCalledWith("17:00");
  });

  it("hides add at 24 times", () => {
    const all = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
    render(<TimesField at={all} onChange={vi.fn()} label="At" idPrefix="t" {...style} />);
    expect(screen.queryByTestId("t-add")).toBeNull();
  });
});

describe("EveryNField", () => {
  it("reports N, with 1 as undefined", () => {
    const onChange = vi.fn();
    const { rerender } = render(<EveryNField every={undefined} unit="weeks" onChange={onChange} idPrefix="e" {...style} />);
    expect((screen.getByTestId("e-every") as HTMLInputElement).value).toBe("1");
    expect(screen.getByText("week")).toBeTruthy();
    fireEvent.change(screen.getByTestId("e-every"), { target: { value: "3" } });
    expect(onChange).toHaveBeenLastCalledWith(3);
    rerender(<EveryNField every={3} unit="weeks" onChange={onChange} idPrefix="e" {...style} />);
    expect(screen.getByText("weeks")).toBeTruthy();
    fireEvent.change(screen.getByTestId("e-every"), { target: { value: "1" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});

describe("StartField", () => {
  it("toggleable: off by default, check seeds a datetime, uncheck clears", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <StartField start={undefined} onChange={onChange} toggleable label="Start at" idPrefix="s" {...style} />,
    );
    expect(screen.queryByTestId("s-start")).toBeNull();
    fireEvent.click(screen.getByTestId("s-start-toggle"));
    const seeded = onChange.mock.calls[0][0] as string;
    expect(Number.isNaN(new Date(seeded).getTime())).toBe(false);
    rerender(<StartField start={seeded} onChange={onChange} toggleable label="Start at" idPrefix="s" {...style} />);
    fireEvent.change(screen.getByTestId("s-start"), { target: { value: "2026-11-02T08:00" } });
    expect(onChange).toHaveBeenLastCalledWith(toIsoWithOffset("2026-11-02T08:00"));
    fireEvent.click(screen.getByTestId("s-start-toggle"));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("plain: shows the stored value; clearing reports undefined", () => {
    const onChange = vi.fn();
    render(
      <StartField
        start="2026-10-16T00:00:00"
        onChange={onChange}
        toggleable={false}
        label="Counting from"
        idPrefix="s"
        {...style}
      />,
    );
    const input = screen.getByLabelText("Counting from") as HTMLInputElement;
    expect(input.value).toBe("2026-10-16T00:00");
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});

describe("IntervalWindowFields", () => {
  it("toggles a 09:00–17:00 window on and off, and edits ends", () => {
    const onChange = vi.fn();
    const { rerender } = render(<IntervalWindowFields value={undefined} onChange={onChange} idPrefix="w" {...style} />);
    expect(screen.queryByTestId("w-window-from")).toBeNull();
    fireEvent.click(screen.getByLabelText("Only between"));
    expect(onChange).toHaveBeenLastCalledWith({ from: "09:00", to: "17:00" });
    rerender(<IntervalWindowFields value={{ from: "09:00", to: "17:00" }} onChange={onChange} idPrefix="w" {...style} />);
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "18:30" } });
    expect(onChange).toHaveBeenLastCalledWith({ from: "09:00", to: "18:30" });
    fireEvent.click(screen.getByLabelText("Only between"));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("notes an overnight window", () => {
    render(<IntervalWindowFields value={{ from: "22:00", to: "06:00" }} onChange={vi.fn()} idPrefix="w" {...style} />);
    expect(screen.getByText("(overnight)")).toBeTruthy();
  });
});

describe("MonthlyDayFields", () => {
  type Monthly = Extract<FormSchedule, { type: "monthly" }>;

  it("switches between day-of-month and weekday-of-month modes", () => {
    const onChange = vi.fn();
    const value: Monthly = { type: "monthly", day: 15, at: "09:00", every: 2 };
    const { rerender } = render(<MonthlyDayFields value={value} onChange={onChange} idPrefix="m" {...style} />);
    expect((screen.getByTestId("m-dom") as HTMLSelectElement).value).toBe("15");
    fireEvent.click(screen.getByLabelText("Weekday of month"));
    const switched = onChange.mock.calls[0][0] as Monthly;
    expect(buildSchedule(switched, TZ)).toEqual({
      type: "monthly",
      nth: 1,
      weekday: "mon",
      at: "09:00",
      every: 2,
      timezone: TZ,
      start: expect.any(String),
    });
    rerender(<MonthlyDayFields value={switched} onChange={onChange} idPrefix="m" {...style} />);
    fireEvent.change(screen.getByLabelText("Which"), { target: { value: "last" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ nth: "last", weekday: "mon" }));
    fireEvent.change(screen.getByLabelText("Weekday"), { target: { value: "fri" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ nth: 1, weekday: "fri" }));
    fireEvent.click(screen.getByLabelText("Day of month"));
    const back = onChange.mock.calls.at(-1)![0] as Monthly;
    expect(back.day).toBe(1);
    expect(back.nth).toBeUndefined();
    expect(back.weekday).toBeUndefined();
  });

  it("offers 1st–31st plus last day", () => {
    const onChange = vi.fn();
    render(<MonthlyDayFields value={{ type: "monthly", day: 1, at: "09:00" }} onChange={onChange} idPrefix="m" {...style} />);
    const select = screen.getByLabelText("Day") as HTMLSelectElement;
    expect(select.options).toHaveLength(32);
    expect(select.options[30].textContent).toBe("31st");
    fireEvent.change(select, { target: { value: "last" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ day: "last" }));
  });

  it("explains clamping for days past the 28th", () => {
    render(<MonthlyDayFields value={{ type: "monthly", day: 31, at: "09:00" }} onChange={vi.fn()} idPrefix="m" {...style} />);
    expect(screen.getByText(/Shorter months/)).toBeTruthy();
  });
});

describe("EndsFields", () => {
  it("never → on a date → after N runs → never", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <EndsFields until={undefined} count={undefined} onChange={onChange} idPrefix="x" {...style} />,
    );
    const select = screen.getByLabelText("Ends") as HTMLSelectElement;
    expect(select.value).toBe("never");
    expect(select.options).toHaveLength(3);

    fireEvent.change(select, { target: { value: "until" } });
    const withUntil = onChange.mock.calls[0][0] as { until?: string; count?: number };
    expect(withUntil.count).toBeUndefined();
    expect(Number.isNaN(new Date(withUntil.until!).getTime())).toBe(false);

    rerender(<EndsFields until={withUntil.until} count={undefined} onChange={onChange} idPrefix="x" {...style} />);
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2030-01-01T00:00" } });
    expect(onChange).toHaveBeenLastCalledWith({ until: toIsoWithOffset("2030-01-01T00:00"), count: undefined });

    fireEvent.change(select, { target: { value: "count" } });
    expect(onChange).toHaveBeenLastCalledWith({ count: 10 });
    rerender(<EndsFields until={undefined} count={10} onChange={onChange} idPrefix="x" {...style} />);
    fireEvent.change(screen.getByLabelText("Number of runs"), { target: { value: "3" } });
    expect(onChange).toHaveBeenLastCalledWith({ until: undefined, count: 3 });

    fireEvent.change(select, { target: { value: "never" } });
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it("a spec with both until and count shows both", () => {
    render(<EndsFields until="2030-01-01T00:00:00" count={3} onChange={vi.fn()} idPrefix="x" {...style} />);
    expect((screen.getByLabelText("Ends") as HTMLSelectElement).value).toBe("both");
    expect((screen.getByLabelText("End date") as HTMLInputElement).value).toBe("2030-01-01T00:00");
    expect((screen.getByLabelText("Number of runs") as HTMLInputElement).value).toBe("3");
  });
});

describe("ScheduleRepeatFields", () => {
  function Harness({ initial, onBuild }: { initial: RepeatingFormSchedule; onBuild: (s: Record<string, unknown>) => void }) {
    const [fs, setFs] = useState<RepeatingFormSchedule>(initial);
    onBuild(buildSchedule(fs, TZ));
    return <ScheduleRepeatFields fs={fs} onChange={setFs} idPrefix="r" {...style} />;
  }

  it("daily shows only Ends", () => {
    render(<Harness initial={{ type: "daily", at: "09:00" }} onBuild={vi.fn()} />);
    expect(screen.getByLabelText("Ends")).toBeTruthy();
    expect(screen.queryByTestId("r-every")).toBeNull();
    expect(screen.queryByTestId("r-window-toggle")).toBeNull();
    expect(screen.queryByTestId("r-start-toggle")).toBeNull();
  });

  it("weekly every 2 reveals the start field and writes start = today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 11, 15, 30));
    const onBuild = vi.fn();
    render(<Harness initial={{ type: "weekly", day: "fri", at: "09:00" }} onBuild={onBuild} />);
    expect(screen.queryByTestId("r-start")).toBeNull();
    fireEvent.change(screen.getByTestId("r-every"), { target: { value: "2" } });
    expect(screen.getByTestId("r-start")).toBeTruthy();
    expect(onBuild).toHaveBeenLastCalledWith(
      expect.objectContaining({ every: 2, start: toIsoWithOffset("2026-10-11T00:00") }),
    );
    fireEvent.change(screen.getByTestId("r-start"), { target: { value: "2026-10-16T00:00" } });
    expect(onBuild).toHaveBeenLastCalledWith(expect.objectContaining({ start: toIsoWithOffset("2026-10-16T00:00") }));
  });

  it("monthly with a hand-set start shows it even at every 1", () => {
    render(<Harness initial={{ type: "monthly", day: 1, at: "09:00", start: "2027-01-01T00:00:00" }} onBuild={vi.fn()} />);
    expect((screen.getByTestId("r-start") as HTMLInputElement).value).toBe("2027-01-01T00:00");
    expect(screen.getByText("month")).toBeTruthy();
  });

  it("interval: window + start + ends all reach the built spec", () => {
    const onBuild = vi.fn();
    render(<Harness initial={{ type: "interval", n: 30, u: "m" }} onBuild={onBuild} />);
    fireEvent.click(screen.getByTestId("r-window-toggle"));
    fireEvent.click(screen.getByTestId("r-start-toggle"));
    fireEvent.change(screen.getByTestId("r-start"), { target: { value: "2026-10-12T09:00" } });
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "count" } });
    fireEvent.change(screen.getByLabelText("Number of runs"), { target: { value: "4" } });
    expect(onBuild).toHaveBeenLastCalledWith({
      type: "interval",
      every: "30m",
      window: { from: "09:00", to: "17:00" },
      timezone: TZ,
      start: toIsoWithOffset("2026-10-12T09:00"),
      count: 4,
    });
  });
});
