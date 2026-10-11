/**
 * Holds the TypeScript schedule engine to the Python one. The fixture is the
 * Python engine's own output on a seeded corpus (see
 * substrate/scripts/tests/schedule_conformance_gen.py); every validation
 * verdict and every next-fire instant must match.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nextFire, scheduleError } from "./schedule-next-fire";

type Fixture = {
  validation: { schedule: unknown; valid: boolean }[];
  next: { schedule: Record<string, unknown>; after: number; boxZone: string; expected: (number | null)[] }[];
};

const fixture: Fixture = JSON.parse(
  readFileSync(join(__dirname, "__fixtures__", "schedule-conformance.json"), "utf-8"),
);

const iso = (ts: number | null) => (ts === null ? null : new Date(Math.round(ts * 1000)).toISOString());

describe("schedule engine conformance with wakeup-scheduler.py", () => {
  it("has a substantial corpus", () => {
    expect(fixture.validation.length).toBeGreaterThan(1000);
    expect(fixture.next.length).toBeGreaterThan(1000);
  });

  it("agrees on every validation verdict", () => {
    const mismatches = fixture.validation
      .filter((c) => (scheduleError(c.schedule) === null) !== c.valid)
      .map((c) => ({ schedule: c.schedule, pythonValid: c.valid, tsError: scheduleError(c.schedule) }));
    expect(mismatches).toEqual([]);
  });

  it("agrees on every next-fire instant", () => {
    const mismatches: unknown[] = [];
    for (const c of fixture.next) {
      let t = c.after;
      for (const want of c.expected) {
        const got = nextFire(c.schedule, t, c.boxZone);
        const same = got === null || want === null ? got === want : Math.abs(got - want) < 1e-3;
        if (!same) {
          mismatches.push({ schedule: c.schedule, boxZone: c.boxZone, after: t, want: iso(want), got: iso(got) });
          break;
        }
        if (want === null) break;
        t = want;
      }
    }
    expect(mismatches.slice(0, 10)).toEqual([]);
  });
});
