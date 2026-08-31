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

  it("30. one_shot + days → custom schedule (one_shot is unchanged, days gate ignored)", () => {
    expect(
      humanizeWakeupSchedule({ type: "one_shot", days: ["mon", "fri"] }),
    ).toBe("custom schedule");
  });
});
