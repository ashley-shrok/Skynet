import { describe, it, expect } from "vitest";
import { humanizeWakeupSchedule } from "./identity-artifact-reader.js";

// ---------------------------------------------------------------------------
// Unit tests for humanizeWakeupSchedule — Phase 65 days-gate extension.
//
// Block A: days-gate rendering (D-01..D-05 per CONTEXT).
// Block B: backwards compatibility — specs WITHOUT `days` field (SC #5).
// Block C: defensive input handling (D-07).
// ---------------------------------------------------------------------------

describe("humanizeWakeupSchedule — days-gate (Phase 65 / CONTEXT D-01..D-05)", () => {
  it("1. daily + weekdays exact set → Weekdays at 23:00 (box-local)", () => {
    expect(
      humanizeWakeupSchedule({ type: "daily", at: "23:00", days: ["mon", "tue", "wed", "thu", "fri"] }),
    ).toBe("Weekdays at 23:00 (box-local)");
  });

  it("2. daily + weekdays in scrambled order → Weekdays at 23:00 (box-local)", () => {
    expect(
      humanizeWakeupSchedule({ type: "daily", at: "23:00", days: ["fri", "mon", "wed", "tue", "thu"] }),
    ).toBe("Weekdays at 23:00 (box-local)");
  });

  it("3. daily + weekends exact set → Weekends at 23:00 (box-local)", () => {
    expect(
      humanizeWakeupSchedule({ type: "daily", at: "23:00", days: ["sat", "sun"] }),
    ).toBe("Weekends at 23:00 (box-local)");
  });

  it("4. daily + full-7 (any order, deduplicated) → Daily at 23:00 (box-local)", () => {
    expect(
      humanizeWakeupSchedule({ type: "daily", at: "23:00", days: ["sun", "sat", "fri", "thu", "wed", "tue", "mon"] }),
    ).toBe("Daily at 23:00 (box-local)");
  });

  it("5. daily + full-7 with duplicates → Daily at 23:00 (box-local)", () => {
    expect(
      humanizeWakeupSchedule({ type: "daily", at: "23:00", days: ["mon", "mon", "tue", "wed", "thu", "fri", "sat", "sun"] }),
    ).toBe("Daily at 23:00 (box-local)");
  });

  it("6. daily + arbitrary subset {mon,wed,fri} → Mon/Wed/Fri at 23:00 (box-local)", () => {
    expect(
      humanizeWakeupSchedule({ type: "daily", at: "23:00", days: ["fri", "mon", "wed"] }),
    ).toBe("Mon/Wed/Fri at 23:00 (box-local)");
  });

  it("7. daily + arbitrary subset {tue,thu} → Tue/Thu at 23:00 (box-local)", () => {
    expect(
      humanizeWakeupSchedule({ type: "daily", at: "23:00", days: ["thu", "tue"] }),
    ).toBe("Tue/Thu at 23:00 (box-local)");
  });

  it("8. interval + weekdays → Weekdays every 2h", () => {
    expect(
      humanizeWakeupSchedule({ type: "interval", every: "2h", days: ["mon", "tue", "wed", "thu", "fri"] }),
    ).toBe("Weekdays every 2h");
  });

  it("9. interval + weekends → Weekends every 30m", () => {
    expect(
      humanizeWakeupSchedule({ type: "interval", every: "30m", days: ["sat", "sun"] }),
    ).toBe("Weekends every 30m");
  });

  it("10. interval + arbitrary subset → Mon/Wed/Fri every 2h", () => {
    expect(
      humanizeWakeupSchedule({ type: "interval", every: "2h", days: ["mon", "wed", "fri"] }),
    ).toBe("Mon/Wed/Fri every 2h");
  });

  it("11. interval + full-7 → Every 2h", () => {
    expect(
      humanizeWakeupSchedule({ type: "interval", every: "2h", days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] }),
    ).toBe("Every 2h");
  });

  it("12. weekly with day ∈ days (weekdays gate, day=mon) → Weekdays at 09:00 (box-local)", () => {
    expect(
      humanizeWakeupSchedule({ type: "weekly", day: "mon", at: "09:00", days: ["mon", "tue", "wed", "thu", "fri"] }),
    ).toBe("Weekdays at 09:00 (box-local)");
  });

  it("13. weekly with day ∈ days (arbitrary subset) → Mon/Fri at 09:00 (box-local)", () => {
    expect(
      humanizeWakeupSchedule({ type: "weekly", day: "mon", at: "09:00", days: ["mon", "fri"] }),
    ).toBe("Mon/Fri at 09:00 (box-local)");
  });

  it("14. weekly + full-7 → Weekly on Mon at 09:00 (box-local)", () => {
    expect(
      humanizeWakeupSchedule({ type: "weekly", day: "mon", at: "09:00", days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] }),
    ).toBe("Weekly on Mon at 09:00 (box-local)");
  });

  it("15. weekly with day ∉ days (NEVER FIRES malformed) → Weekly on Mon at 09:00 (box-local) — NEVER FIRES (weekly day excluded from days gate)", () => {
    expect(
      humanizeWakeupSchedule({ type: "weekly", day: "mon", at: "09:00", days: ["tue", "wed"] }),
    ).toBe("Weekly on Mon at 09:00 (box-local) — NEVER FIRES (weekly day excluded from days gate)");
  });
});

describe("humanizeWakeupSchedule — backwards compat (Phase 65 / Success Criteria #5)", () => {
  it("16. daily without days field → Daily at 23:00 (box-local)", () => {
    expect(
      humanizeWakeupSchedule({ type: "daily", at: "23:00" }),
    ).toBe("Daily at 23:00 (box-local)");
  });

  it("17. daily with days: [] (empty array) → Daily at 23:00 (box-local)", () => {
    expect(
      humanizeWakeupSchedule({ type: "daily", at: "23:00", days: [] }),
    ).toBe("Daily at 23:00 (box-local)");
  });

  it("18. interval without days → Every 2h", () => {
    expect(
      humanizeWakeupSchedule({ type: "interval", every: "2h" }),
    ).toBe("Every 2h");
  });

  it("19. interval with numeric every (legacy) → Every 30m", () => {
    expect(
      humanizeWakeupSchedule({ type: "interval", every: 30 }),
    ).toBe("Every 30m");
  });

  it("20. weekly without days → Weekly on Mon at 09:00 (box-local)", () => {
    expect(
      humanizeWakeupSchedule({ type: "weekly", day: "mon", at: "09:00" }),
    ).toBe("Weekly on Mon at 09:00 (box-local)");
  });

  it("21. daily without at → Daily (box-local)", () => {
    expect(
      humanizeWakeupSchedule({ type: "daily" }),
    ).toBe("Daily (box-local)");
  });

  it("22. weekly without day → Weekly on ? at 09:00 (box-local)", () => {
    expect(
      humanizeWakeupSchedule({ type: "weekly", at: "09:00" }),
    ).toBe("Weekly on ? at 09:00 (box-local)");
  });

  it("23. unknown type → custom schedule", () => {
    expect(
      humanizeWakeupSchedule({ type: "unknown-thing" }),
    ).toBe("custom schedule");
  });

  it("24. non-object schedule → custom schedule (null)", () => {
    expect(humanizeWakeupSchedule(null)).toBe("custom schedule");
  });

  it("24b. non-object schedule → custom schedule (undefined)", () => {
    expect(humanizeWakeupSchedule(undefined)).toBe("custom schedule");
  });

  it("24c. non-object schedule → custom schedule (string)", () => {
    expect(humanizeWakeupSchedule("string")).toBe("custom schedule");
  });

  it("24d. non-object schedule → custom schedule (number)", () => {
    expect(humanizeWakeupSchedule(42)).toBe("custom schedule");
  });
});

describe("humanizeWakeupSchedule — defensive input handling (Phase 65 / D-07)", () => {
  it("25. daily + malformed days (not an array) → falls back to no-gate render", () => {
    expect(
      humanizeWakeupSchedule({ type: "daily", at: "23:00", days: "mon" }),
    ).toBe("Daily at 23:00 (box-local)");
  });

  it("26. daily + malformed days (non-string entries) → filters non-strings, renders survivors", () => {
    expect(
      humanizeWakeupSchedule({ type: "daily", at: "23:00", days: ["mon", 42, null, "fri"] }),
    ).toBe("Mon/Fri at 23:00 (box-local)");
  });

  it("27. daily + days with unknown 3-letter codes → filters unknowns, renders survivors", () => {
    expect(
      humanizeWakeupSchedule({ type: "daily", at: "23:00", days: ["mon", "xyz", "fri"] }),
    ).toBe("Mon/Fri at 23:00 (box-local)");
  });

  it("28. daily + days with uppercase/whitespace entries → normalized via lowercase+trim", () => {
    expect(
      humanizeWakeupSchedule({ type: "daily", at: "23:00", days: ["MON", "Tue", "fri "] }),
    ).toBe("Mon/Tue/Fri at 23:00 (box-local)");
  });

  it("29. daily + days where ALL entries are invalid → falls back to no-gate render", () => {
    expect(
      humanizeWakeupSchedule({ type: "daily", at: "23:00", days: ["xyz", "abc"] }),
    ).toBe("Daily at 23:00 (box-local)");
  });

  it("30. one_shot + days → 'Once' (days gate ignored — one_shot fires once, DoW gate is meaningless; Phase 128 code-review fix #2)", () => {
    expect(
      humanizeWakeupSchedule({ type: "one_shot", days: ["mon", "fri"] }),
    ).toBe("Once");
  });

  it("31. one_shot with `at` datetime → 'Once at <at>' (Phase 128 code-review fix #2)", () => {
    expect(
      humanizeWakeupSchedule({
        type: "one_shot",
        at: "2026-08-15T09:00:00-04:00",
      }),
    ).toBe("Once at 2026-08-15T09:00:00-04:00");
  });

  it("32. one_shot with no `at` field → 'Once' (Phase 128 code-review fix #2)", () => {
    expect(humanizeWakeupSchedule({ type: "one_shot" })).toBe("Once");
  });
});

describe("humanizeWakeupSchedule — yearly", () => {
  it("renders month name + day + time", () => {
    expect(humanizeWakeupSchedule({ type: "yearly", date: "08-03", at: "09:00" })).toBe(
      "Yearly on Aug 3 at 09:00 (box-local)",
    );
  });

  it("omits the time when `at` is missing", () => {
    expect(humanizeWakeupSchedule({ type: "yearly", date: "12-25" })).toBe("Yearly on Dec 25 (box-local)");
  });

  it("shows '?' for a malformed date", () => {
    expect(humanizeWakeupSchedule({ type: "yearly", date: "aug 3", at: "09:00" })).toBe(
      "Yearly on ? at 09:00 (box-local)",
    );
  });
});

describe("humanizeWakeupSchedule — interval in months", () => {
  it("spells out months", () => {
    expect(humanizeWakeupSchedule({ type: "interval", every: "11mo" })).toBe("Every 11 months");
    expect(humanizeWakeupSchedule({ type: "interval", every: "1mo" })).toBe("Every 1 month");
  });
});

describe("humanizeWakeupSchedule — multiple times", () => {
  it("daily with two times", () => {
    expect(humanizeWakeupSchedule({ type: "daily", at: ["09:00", "17:00"] })).toBe(
      "Daily at 09:00 and 17:00 (box-local)",
    );
  });

  it("daily with three times + days gate", () => {
    expect(
      humanizeWakeupSchedule({ type: "daily", at: ["09:00", "12:00", "17:00"], days: ["mon", "tue", "wed", "thu", "fri"] }),
    ).toBe("Weekdays at 09:00, 12:00 and 17:00 (box-local)");
  });

  it("a one-element list reads like a plain string", () => {
    expect(humanizeWakeupSchedule({ type: "daily", at: ["09:00"] })).toBe("Daily at 09:00 (box-local)");
  });

  it("weekly / yearly / monthly with multiple times", () => {
    expect(humanizeWakeupSchedule({ type: "weekly", day: "fri", at: ["09:00", "16:00"] })).toBe(
      "Weekly on Fri at 09:00 and 16:00 (box-local)",
    );
    expect(humanizeWakeupSchedule({ type: "yearly", date: "08-03", at: ["09:00", "21:00"] })).toBe(
      "Yearly on Aug 3 at 09:00 and 21:00 (box-local)",
    );
    expect(humanizeWakeupSchedule({ type: "monthly", day: 15, at: ["08:00", "20:00"] })).toBe(
      "Monthly on the 15th at 08:00 and 20:00 (box-local)",
    );
  });
});

describe("humanizeWakeupSchedule — every N weeks", () => {
  it("every 2 → every other week", () => {
    expect(humanizeWakeupSchedule({ type: "weekly", day: "fri", at: "09:00", every: 2 })).toBe(
      "Every other week on Fri at 09:00 (box-local)",
    );
  });

  it("every 3 → every 3 weeks", () => {
    expect(humanizeWakeupSchedule({ type: "weekly", day: "fri", at: "09:00", every: 3 })).toBe(
      "Every 3 weeks on Fri at 09:00 (box-local)",
    );
  });

  it("every 1 reads as plain weekly", () => {
    expect(humanizeWakeupSchedule({ type: "weekly", day: "fri", at: "09:00", every: 1 })).toBe(
      "Weekly on Fri at 09:00 (box-local)",
    );
  });

  it("start renders as a from-suffix", () => {
    expect(
      humanizeWakeupSchedule({ type: "weekly", day: "fri", at: "09:00", every: 2, start: "2026-10-16T00:00:00" }),
    ).toBe("Every other week on Fri at 09:00 (box-local) · from 2026-10-16");
  });

  it("every N with the day inside the days gate keeps the cadence phrasing", () => {
    expect(
      humanizeWakeupSchedule({ type: "weekly", day: "mon", at: "09:00", every: 2, days: ["mon", "fri"] }),
    ).toBe("Every other week on Mon at 09:00 (box-local)");
  });

  it("every N with the day outside the gate still flags NEVER FIRES", () => {
    expect(
      humanizeWakeupSchedule({ type: "weekly", day: "mon", at: "09:00", every: 3, days: ["tue"] }),
    ).toBe("Every 3 weeks on Mon at 09:00 (box-local) — NEVER FIRES (weekly day excluded from days gate)");
  });
});

describe("humanizeWakeupSchedule — monthly", () => {
  it("day of month", () => {
    expect(humanizeWakeupSchedule({ type: "monthly", day: 1, at: "09:00" })).toBe(
      "Monthly on the 1st at 09:00 (box-local)",
    );
    expect(humanizeWakeupSchedule({ type: "monthly", day: 2, at: "09:00" })).toBe(
      "Monthly on the 2nd at 09:00 (box-local)",
    );
    expect(humanizeWakeupSchedule({ type: "monthly", day: 23, at: "09:00" })).toBe(
      "Monthly on the 23rd at 09:00 (box-local)",
    );
    expect(humanizeWakeupSchedule({ type: "monthly", day: 11, at: "09:00" })).toBe(
      "Monthly on the 11th at 09:00 (box-local)",
    );
    expect(humanizeWakeupSchedule({ type: "monthly", day: 31, at: "09:00" })).toBe(
      "Monthly on the 31st at 09:00 (box-local)",
    );
  });

  it("last day", () => {
    expect(humanizeWakeupSchedule({ type: "monthly", day: "last", at: "17:00" })).toBe(
      "Monthly on the last day at 17:00 (box-local)",
    );
  });

  it("nth weekday", () => {
    expect(humanizeWakeupSchedule({ type: "monthly", nth: 1, weekday: "mon", at: "09:00" })).toBe(
      "Monthly on the first Monday at 09:00 (box-local)",
    );
    expect(humanizeWakeupSchedule({ type: "monthly", nth: 4, weekday: "thu", at: "09:00" })).toBe(
      "Monthly on the fourth Thursday at 09:00 (box-local)",
    );
  });

  it("every 3 months on the last Friday", () => {
    expect(
      humanizeWakeupSchedule({ type: "monthly", nth: "last", weekday: "fri", at: "16:00", every: 3 }),
    ).toBe("Every 3 months on the last Friday at 16:00 (box-local)");
  });

  it("every 2 months → every other month", () => {
    expect(humanizeWakeupSchedule({ type: "monthly", day: 1, at: "09:00", every: 2 })).toBe(
      "Every other month on the 1st at 09:00 (box-local)",
    );
  });

  it("no time / malformed day", () => {
    expect(humanizeWakeupSchedule({ type: "monthly", day: 5 })).toBe("Monthly on the 5th (box-local)");
    expect(humanizeWakeupSchedule({ type: "monthly", day: 40, at: "09:00" })).toBe(
      "Monthly on ? at 09:00 (box-local)",
    );
    expect(humanizeWakeupSchedule({ type: "monthly", nth: 5, weekday: "mon", at: "09:00" })).toBe(
      "Monthly on ? at 09:00 (box-local)",
    );
  });

  it("days gate on monthly is a suffix", () => {
    expect(
      humanizeWakeupSchedule({ type: "monthly", day: 1, at: "09:00", days: ["mon", "tue", "wed", "thu", "fri"] }),
    ).toBe("Monthly on the 1st at 09:00 (box-local) · Weekdays only");
  });
});

describe("humanizeWakeupSchedule — interval window / start", () => {
  it("window", () => {
    expect(
      humanizeWakeupSchedule({ type: "interval", every: "30m", window: { from: "09:00", to: "17:00" } }),
    ).toBe("Every 30m between 09:00–17:00");
  });

  it("window + days gate", () => {
    expect(
      humanizeWakeupSchedule({
        type: "interval",
        every: "30m",
        window: { from: "09:00", to: "17:00" },
        days: ["mon", "tue", "wed", "thu", "fri"],
        timezone: "America/New_York",
      }),
    ).toBe("Weekdays every 30m between 09:00–17:00");
  });

  it("overnight window", () => {
    expect(
      humanizeWakeupSchedule({ type: "interval", every: "1h", window: { from: "22:00", to: "06:00" } }),
    ).toBe("Every 1h between 22:00–06:00");
  });

  it("malformed window is ignored", () => {
    expect(humanizeWakeupSchedule({ type: "interval", every: "1h", window: { from: "22:00" } })).toBe("Every 1h");
  });

  it("start with offset shows its wall-clock date + time", () => {
    expect(
      humanizeWakeupSchedule({ type: "interval", every: "11mo", start: "2026-09-03T09:00:00-04:00" }),
    ).toBe("Every 11 months · from 2026-09-03 09:00");
  });
});

describe("humanizeWakeupSchedule — ends", () => {
  it("until", () => {
    expect(humanizeWakeupSchedule({ type: "daily", at: "09:00", until: "2030-01-01T00:00:00" })).toBe(
      "Daily at 09:00 (box-local) · until 2030-01-01",
    );
  });

  it("until with a time", () => {
    expect(humanizeWakeupSchedule({ type: "interval", every: "2h", until: "2030-01-01T17:30:00Z" })).toBe(
      "Every 2h · until 2030-01-01 17:30",
    );
  });

  it("count", () => {
    expect(humanizeWakeupSchedule({ type: "weekly", day: "mon", at: "09:00", count: 3 })).toBe(
      "Weekly on Mon at 09:00 (box-local) · 3 runs",
    );
    expect(humanizeWakeupSchedule({ type: "daily", at: "09:00", count: 1 })).toBe(
      "Daily at 09:00 (box-local) · 1 run",
    );
  });

  it("until + count together (yearly example from the format)", () => {
    expect(
      humanizeWakeupSchedule({ type: "yearly", date: "08-03", at: "09:00", until: "2030-01-01T00:00:00", count: 3 }),
    ).toBe("Yearly on Aug 3 at 09:00 (box-local) · until 2030-01-01 · 3 runs");
  });

  it("invalid count is ignored", () => {
    expect(humanizeWakeupSchedule({ type: "daily", at: "09:00", count: 0 })).toBe("Daily at 09:00 (box-local)");
    expect(humanizeWakeupSchedule({ type: "daily", at: "09:00", count: 2.5 })).toBe("Daily at 09:00 (box-local)");
  });

  it("monthly with everything", () => {
    expect(
      humanizeWakeupSchedule({
        type: "monthly",
        nth: "last",
        weekday: "fri",
        at: ["09:00", "16:00"],
        every: 3,
        start: "2027-01-01T00:00:00",
        until: "2029-01-01T00:00:00",
        count: 8,
      }),
    ).toBe("Every 3 months on the last Friday at 09:00 and 16:00 (box-local) · from 2027-01-01 · until 2029-01-01 · 8 runs");
  });

  it("one_shot ignores repeat fields", () => {
    expect(humanizeWakeupSchedule({ type: "one_shot", at: "2026-08-15T09:00:00-04:00", count: 3 })).toBe(
      "Once at 2026-08-15T09:00:00-04:00",
    );
  });
});
