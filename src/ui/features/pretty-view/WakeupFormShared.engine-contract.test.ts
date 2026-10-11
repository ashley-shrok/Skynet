/**
 * Contract between the schedule forms and the scheduler: whatever the forms
 * let a user save (validateForm passes) must be a schedule the scheduler will
 * fire (the engine's scheduleError passes), and must survive an edit
 * round-trip unchanged. Randomized over every kind and option.
 */

import { describe, expect, it } from "vitest";
import { scheduleError } from "../../../backend/claude-session/schedule-next-fire";
import {
  buildSchedule,
  hydrateFormSchedule,
  validateForm,
  type FormSchedule,
  type Weekday,
} from "./WakeupFormShared";

const DAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const TZS = ["America/New_York", "Europe/London", "Australia/Lord_Howe", "Asia/Kolkata", "UTC"];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomForm(r: () => number): FormSchedule {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const time = () => `${String(Math.floor(r() * 24)).padStart(2, "0")}:${String(Math.floor(r() * 60)).padStart(2, "0")}`;
  const times = () => (r() < 0.5 ? time() : Array.from({ length: 1 + Math.floor(r() * 4) }, time));
  const iso = () => {
    const d = new Date(Date.UTC(2026, 0, 1) + Math.floor(r() * 900) * 86400e3);
    return d.toISOString().slice(0, 10) + "T09:00:00-05:00";
  };
  const repeat = () => ({
    ...(r() < 0.3 ? { days: DAYS.filter(() => r() < 0.5) } : {}),
    ...(r() < 0.3 ? { start: iso() } : {}),
    ...(r() < 0.2 ? { until: iso() } : {}),
    ...(r() < 0.2 ? { count: 1 + Math.floor(r() * 10) } : {}),
  });
  switch (pick(["interval", "daily", "weekly", "monthly", "yearly", "one_shot"] as const)) {
    case "interval":
      return {
        type: "interval",
        n: 1 + Math.floor(r() * 90),
        u: pick(["s", "m", "h", "d", "mo"] as const),
        ...(r() < 0.4 ? { window: { from: time(), to: time() } } : {}),
        ...repeat(),
      };
    case "daily":
      return { type: "daily", at: times(), ...repeat() };
    case "weekly":
      return { type: "weekly", day: pick(DAYS), at: times(), ...(r() < 0.5 ? { every: 1 + Math.floor(r() * 4) } : {}), ...repeat() };
    case "monthly":
      return r() < 0.5
        ? { type: "monthly", day: pick([1, 15, 28, 30, 31, "last"] as const), at: times(), ...(r() < 0.4 ? { every: 1 + Math.floor(r() * 6) } : {}), ...repeat() }
        : { type: "monthly", nth: pick([1, 2, 3, 4, "last"] as const), weekday: pick(DAYS), at: times(), ...(r() < 0.4 ? { every: 1 + Math.floor(r() * 6) } : {}), ...repeat() };
    case "yearly":
      return { type: "yearly", date: `${String(1 + Math.floor(r() * 12)).padStart(2, "0")}-${String(1 + Math.floor(r() * 28)).padStart(2, "0")}`, at: times(), ...repeat() };
    default:
      return { type: "one_shot", at: "2027-03-14T02:30" };
  }
}

describe("schedule forms ↔ scheduler engine contract", () => {
  it("everything the forms accept, the scheduler accepts — and it round-trips", () => {
    const r = rng(20261011);
    let accepted = 0;
    const violations: unknown[] = [];
    for (let i = 0; i < 4000; i++) {
      const form = randomForm(r);
      if (validateForm(form) !== null) continue;
      accepted++;
      const tz = TZS[i % TZS.length];
      const spec = buildSchedule(form, tz);
      const err = scheduleError(spec);
      if (err !== null) violations.push({ form, spec, err });
      const again = buildSchedule(hydrateFormSchedule(spec), tz);
      // `start` may be filled in at build time (every > 1); after that it's stable.
      if (JSON.stringify(again) !== JSON.stringify(spec)) violations.push({ roundTrip: true, spec, again });
    }
    const kinds = [...new Set(violations.map((v) => (v as { err?: string; roundTrip?: boolean }).err ?? "round-trip"))];
    expect(kinds).toEqual([]);
    expect(violations.slice(0, 5)).toEqual([]);
    expect(accepted).toBeGreaterThan(1500);
  });
});
