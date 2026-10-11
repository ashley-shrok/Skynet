/**
 * Unit tests for the computeNextFireAt / parseDurationSecs port of the
 * Python scheduler's _due() + _dur_secs() in substrate/scripts/wakeup-
 * scheduler.py. Covers the five schedule shapes (interval / daily / weekly /
 * yearly / one_shot), the optional `days` gate, and malformed input fallbacks.
 */

import { describe, expect, it } from "vitest";
import { computeNextFireAt, parseDurationSecs } from "./schedule-next-fire";

describe("parseDurationSecs", () => {
  it("parses unit-suffixed strings", () => {
    expect(parseDurationSecs("30s")).toBe(30);
    expect(parseDurationSecs("45m")).toBe(45 * 60);
    expect(parseDurationSecs("2h")).toBe(7200);
    expect(parseDurationSecs("3d")).toBe(3 * 86400);
  });

  it("treats bare number string as minutes", () => {
    expect(parseDurationSecs("90")).toBe(90 * 60);
  });

  it("rejects malformed / non-positive values", () => {
    expect(parseDurationSecs("")).toBeNull();
    expect(parseDurationSecs("abc")).toBeNull();
    expect(parseDurationSecs("0h")).toBeNull();
    expect(parseDurationSecs("-5m")).toBeNull();
  });
});

describe("computeNextFireAt — interval", () => {
  const now = 1_700_000_000;

  it("returns lastFired + every when fired recently", () => {
    const next = computeNextFireAt({ type: "interval", every: "2h" }, now - 300, now);
    expect(next).toBe(now - 300 + 7200);
  });

  it("approximates from now when never fired", () => {
    const next = computeNextFireAt({ type: "interval", every: "30m" }, null, now);
    expect(next).toBe(now + 1800);
  });

  it("returns null for malformed every", () => {
    expect(computeNextFireAt({ type: "interval", every: "banana" }, now, now)).toBeNull();
  });
});

describe("computeNextFireAt — daily", () => {
  it("picks today's slot when it's still ahead and never fired today", () => {
    const d = new Date();
    d.setHours(14, 30, 0, 0);
    const todaySlot = Math.floor(d.getTime() / 1000);
    const earlierToday = todaySlot - 3600; // 13:30 same day
    const next = computeNextFireAt({ type: "daily", at: "14:30" }, null, earlierToday);
    expect(next).toBe(todaySlot);
  });

  it("rolls to tomorrow when today's slot has passed", () => {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    const todaySlot = Math.floor(d.getTime() / 1000);
    const laterToday = todaySlot + 3600; // 10:00 same day
    const next = computeNextFireAt({ type: "daily", at: "09:00" }, todaySlot, laterToday);
    expect(next).toBe(todaySlot + 86400);
  });

  it("returns null for malformed at", () => {
    expect(computeNextFireAt({ type: "daily", at: "25:99" }, null, 1_700_000_000)).toBeNull();
    expect(computeNextFireAt({ type: "daily", at: "lunchtime" }, null, 1_700_000_000)).toBeNull();
  });
});

describe("computeNextFireAt — weekly", () => {
  it("returns a future epoch within 7 days", () => {
    const now = Math.floor(Date.now() / 1000);
    const next = computeNextFireAt(
      { type: "weekly", day: "mon", at: "09:00" },
      null,
      now,
    );
    expect(next).not.toBeNull();
    expect(next!).toBeGreaterThanOrEqual(now);
    expect(next!).toBeLessThanOrEqual(now + 7 * 86400 + 60);
  });

  it("returns null for unknown day", () => {
    expect(
      computeNextFireAt({ type: "weekly", day: "funday", at: "09:00" }, null, 1_700_000_000),
    ).toBeNull();
  });
});

describe("computeNextFireAt — one_shot", () => {
  const now = 1_700_000_000;

  it("returns the parsed epoch when still ahead", () => {
    const next = computeNextFireAt(
      { type: "one_shot", at: "2050-01-01T00:00:00Z" },
      null,
      now,
    );
    expect(next).toBe(Math.floor(Date.parse("2050-01-01T00:00:00Z") / 1000));
  });

  it("returns null when the slot is already past", () => {
    const next = computeNextFireAt(
      { type: "one_shot", at: "2000-01-01T00:00:00Z" },
      null,
      now,
    );
    expect(next).toBeNull();
  });

  it("returns null for malformed at", () => {
    expect(
      computeNextFireAt({ type: "one_shot", at: "whenever" }, null, now),
    ).toBeNull();
  });
});

describe("computeNextFireAt — days filter", () => {
  it("rolls past a filtered-out weekday", () => {
    // Set up: pick a known Saturday — 2024-01-06T12:00:00Z is a Saturday.
    // interval every 1h, days = weekdays-only. Expected: skip to Monday.
    const sat = Math.floor(Date.parse("2024-01-06T12:00:00Z") / 1000);
    const next = computeNextFireAt(
      {
        type: "interval",
        every: "1h",
        days: ["mon", "tue", "wed", "thu", "fri"],
      },
      sat,
      sat,
    );
    expect(next).not.toBeNull();
    // Should land somewhere Mon-Fri. Convert to Date and check weekday is 1..5.
    const d = new Date(next! * 1000);
    const dow = d.getDay(); // 0=Sun..6=Sat
    expect(dow).toBeGreaterThanOrEqual(1);
    expect(dow).toBeLessThanOrEqual(5);
  });

  it("returns null for a days gate with an unknown weekday (the scheduler refuses the spec)", () => {
    const now = 1_700_000_000;
    expect(computeNextFireAt({ type: "interval", every: "1h", days: ["xxx"] }, now, now)).toBeNull();
  });
});

describe("computeNextFireAt — malformed schedule", () => {
  it("returns null for non-object", () => {
    expect(computeNextFireAt(null, null, 1_700_000_000)).toBeNull();
    expect(computeNextFireAt("daily", null, 1_700_000_000)).toBeNull();
  });

  it("returns null for unknown type", () => {
    expect(
      computeNextFireAt({ type: "quarterly", at: "09:00" }, null, 1_700_000_000),
    ).toBeNull();
  });
});

describe("computeNextFireAt — yearly", () => {
  // Container-local wall clock, same as the daily/weekly branches.
  const at = (y: number, mo: number, d: number, h = 0, mi = 0) =>
    Math.floor(new Date(y, mo - 1, d, h, mi).getTime() / 1000);
  const sch = { type: "yearly", date: "08-03", at: "09:00" };

  it("returns this year's slot when it is still ahead", () => {
    expect(computeNextFireAt(sch, at(2026, 8, 3, 9, 0), at(2027, 1, 10))).toBe(at(2027, 8, 3, 9, 0));
  });

  it("returns next year's slot once this year's has fired", () => {
    expect(computeNextFireAt(sch, at(2027, 8, 3, 9, 0), at(2027, 9, 1))).toBe(at(2028, 8, 3, 9, 0));
  });

  it("returns next year's slot when never seen and this year's has passed", () => {
    expect(computeNextFireAt(sch, null, at(2027, 9, 1))).toBe(at(2028, 8, 3, 9, 0));
  });

  it("returns this year's (past) slot when it was missed — scheduler catches up", () => {
    expect(computeNextFireAt(sch, at(2027, 1, 1), at(2027, 9, 1))).toBe(at(2027, 8, 3, 9, 0));
  });

  it("returns null for 02-29 and malformed dates", () => {
    const now = at(2027, 1, 1);
    expect(computeNextFireAt({ type: "yearly", date: "02-29", at: "09:00" }, null, now)).toBeNull();
    expect(computeNextFireAt({ type: "yearly", date: "04-31", at: "09:00" }, null, now)).toBeNull();
    expect(computeNextFireAt({ type: "yearly", date: "8-3", at: "09:00" }, null, now)).toBeNull();
    expect(computeNextFireAt({ type: "yearly", date: "08-03" }, null, now)).toBeNull();
  });
});

describe("computeNextFireAt — interval in months", () => {
  const at = (y: number, mo: number, d: number, h = 0, mi = 0) =>
    Math.floor(new Date(y, mo - 1, d, h, mi).getTime() / 1000);

  it("adds calendar months to the reference", () => {
    expect(computeNextFireAt({ type: "interval", every: "11mo" }, at(2026, 9, 3, 9, 0), at(2026, 10, 1))).toBe(
      at(2027, 8, 3, 9, 0),
    );
  });

  it("clamps the day to the target month", () => {
    expect(computeNextFireAt({ type: "interval", every: "1mo" }, at(2027, 1, 31, 12, 0), at(2027, 2, 1))).toBe(
      at(2027, 2, 28, 12, 0),
    );
  });

  it("returns null for a zero or malformed month count", () => {
    expect(computeNextFireAt({ type: "interval", every: "0mo" }, null, at(2027, 1, 1))).toBeNull();
  });
});
