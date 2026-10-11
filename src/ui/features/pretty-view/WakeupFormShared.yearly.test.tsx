import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  buildSchedule,
  formatYearlyDate,
  hydrateFormSchedule,
  parseYearlyDate,
  validateForm,
  YearlyDateFields,
} from "./WakeupFormShared";

afterEach(cleanup);

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
