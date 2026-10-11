/**
 * Puts the scheduler's own test drivers inside `npx vitest run` — the
 * full-suite gate before every deploy — so a scheduling regression can't ship
 * just because nobody ran the shell suites by hand.
 *
 *   - wakeup-scheduler.test.sh: real-process wiring, plus (SA-G11) the engine
 *     suite test_schedule_engine.py — validation table, hand-checked cases,
 *     differential vs a brute-force oracle, poll-loop simulation.
 *   - agent-supervisor-schedule-peek.test.sh: the dormant-wake peek.
 *   - schedule_conformance_gen.py --check: the TS port's fixture is current
 *     with the Python engine.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(__dirname, "..", "..", "..");
const tests = join(repoRoot, "substrate", "scripts", "tests");

function run(cmd: string, args: string[], timeoutMs: number): { ok: boolean; output: string } {
  try {
    const output = execFileSync(cmd, args, { cwd: repoRoot, timeout: timeoutMs, encoding: "utf-8", stdio: "pipe" });
    return { ok: true, output };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    return { ok: false, output: `${e.stdout ?? ""}\n${e.stderr ?? ""}\n${e.message}`.slice(-4000) };
  }
}

describe("scheduler substrate suites", () => {
  it("wakeup-scheduler.test.sh (incl. the schedule engine suite) passes", () => {
    const r = run("bash", [join(tests, "wakeup-scheduler.test.sh")], 600_000);
    expect(r.output).toMatch(/FAIL: 0/);
    expect(r.ok).toBe(true);
  }, 610_000);

  it("agent-supervisor-schedule-peek.test.sh passes", () => {
    const r = run("bash", [join(tests, "agent-supervisor-schedule-peek.test.sh")], 120_000);
    expect(r.output).toMatch(/FAIL: 0/);
    expect(r.ok).toBe(true);
  }, 130_000);

  it("the conformance fixture is current with the Python engine", () => {
    const r = run("python3", [join(tests, "schedule_conformance_gen.py"), "--check"], 120_000);
    expect(r.output).not.toMatch(/stale/);
    expect(r.ok).toBe(true);
  }, 130_000);
});
