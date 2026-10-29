// readIdentityWakeups — `canFireAgain` (shape-archive-wakeup-warning): which
// wake-ups archiving an agent would end. Mirrors the scheduler's own
// bookkeeping (.last / .anchored / .runs / .fired). LOCAL (fs) and REMOTE
// (real bash) must agree.

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { execFile } from "child_process";
import os from "os";
import path from "path";
import fs from "fs/promises";

vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

import { execCommand } from "../ssh/tmux-helper.js";
import { readIdentityWakeups, wakeupCanFireAgain } from "./identity-artifact-reader.js";

const KEY = "moxie";
const NOW = Math.floor(Date.now() / 1000);
const iso = (secs: number) => new Date(secs * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

async function write(p: string, body: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, body, "utf-8");
}

const EXPECTED: Record<string, boolean> = {
  "daily-on": true,
  "daily-off": false,
  "never-seen": true,
  "oneshot-future": true,
  "oneshot-past-unfired": true,
  "oneshot-fired": false,
  "until-passed": false,
  "count-used-up": false,
  "count-left": true,
  "sensor-on": true,
  "sensor-off": false,
  "sensor-once-fired": false,
  "oneshot-recreated": true,
  malformed: false,
};

async function buildFixture(dir: string): Promise<void> {
  const spec = (slug: string, schedule: unknown, enabled = true) =>
    write(
      path.join(dir, slug, "wakeup.json"),
      JSON.stringify({ name: slug, enabled, schedule, instruction: "x" }, null, 2) + "\n",
    );
  const state = (slug: string, ext: string, body: string) =>
    write(path.join(dir, slug, ".state", `${slug}${ext}`), body);

  await spec("daily-on", { type: "daily", at: "09:00" });
  await state("daily-on", ".last", String(NOW - 3600));
  await spec("daily-off", { type: "daily", at: "09:00" }, false);
  await state("daily-off", ".anchored", String(NOW - 3600));
  await spec("never-seen", { type: "interval", every: "2h" });
  await spec("oneshot-future", { type: "one_shot", at: iso(NOW + 86400) });
  await spec("oneshot-past-unfired", { type: "one_shot", at: iso(NOW - 600) });
  await spec("oneshot-fired", { type: "one_shot", at: iso(NOW - 600) });
  await state("oneshot-fired", ".fired", "");
  await spec("until-passed", { type: "interval", every: "1h", until: iso(NOW - 86400) });
  await state("until-passed", ".last", String(NOW - 2 * 86400));
  await spec("count-used-up", { type: "daily", at: "09:00", count: 3 });
  await state("count-used-up", ".last", String(NOW - 3600));
  await state("count-used-up", ".runs", "3\n");
  await spec("count-left", { type: "daily", at: "09:00", count: 3 });
  await state("count-left", ".anchored", String(NOW - 3600));
  await state("count-left", ".runs", "2");
  await spec("sensor-on", { type: "sensor" });
  await spec("sensor-off", { type: "sensor" }, false);
  await spec("sensor-once-fired", { type: "sensor", once: true });
  await state("sensor-once-fired", ".fired", "20261029T120000000-0123abcd");
  await spec("malformed", { type: "weekly", at: "09:00" });
  // A leftover `.fired` from an earlier one-time wake-up of the same name:
  // the spec is newer, so the scheduler clears it and fires.
  await spec("oneshot-recreated", { type: "one_shot", at: iso(NOW + 3600) });
  await state("oneshot-recreated", ".fired", "");
  const old = new Date((NOW - 86400) * 1000);
  await fs.utimes(path.join(dir, "oneshot-recreated", ".state", "oneshot-recreated.fired"), old, old);
}

function check(wakeups: Array<{ slug: string; canFireAgain: boolean }>): void {
  expect(wakeups.map((w) => w.slug).sort()).toEqual(Object.keys(EXPECTED).sort());
  for (const w of wakeups) expect(w.canFireAgain, w.slug).toBe(EXPECTED[w.slug]);
}

describe("readIdentityWakeups — canFireAgain", () => {
  let home: string;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "wakeup-can-fire-"));
    await buildFixture(path.join(home, "fleet", "identities", KEY, "wakeups"));
  });
  afterEach(async () => {
    delete process.env.IDENTITIES_HOST_DIR;
    await fs.rm(home, { recursive: true, force: true });
  });

  it("LOCAL", async () => {
    process.env.IDENTITIES_HOST_DIR = path.join(home, "fleet", "identities");
    const { wakeups } = await readIdentityWakeups(null, KEY);
    check(wakeups);
  });

  it("REMOTE (real bash)", async () => {
    (execCommand as Mock).mockImplementation(
      (_c: unknown, cmd: string) =>
        new Promise<string>((resolve, reject) => {
          execFile("bash", ["-c", cmd], { cwd: home, env: { ...process.env, HOME: home } }, (err, stdout) =>
            err ? reject(err) : resolve(stdout),
          );
        }),
    );
    const conn = {} as unknown as Parameters<typeof readIdentityWakeups>[0];
    const { wakeups } = await readIdentityWakeups(conn, KEY);
    check(wakeups);
  });
});

describe("readIdentityWakeups — remote failures", () => {
  afterEach(() => {
    (execCommand as Mock).mockReset();
  });
  const conn = {} as unknown as Parameters<typeof readIdentityWakeups>[0];

  it("no wakeups folder is an empty list, strict or not", async () => {
    (execCommand as Mock).mockResolvedValue("===SKYNET-NO-WAKEUPS===");
    await expect(readIdentityWakeups(conn, KEY, { strict: true })).resolves.toEqual({ wakeups: [] });
    await expect(readIdentityWakeups(conn, KEY)).resolves.toEqual({ wakeups: [] });
  });

  it("a failed read throws when strict, and reads as none otherwise", async () => {
    (execCommand as Mock).mockRejectedValue(new Error("Permission denied"));
    await expect(readIdentityWakeups(conn, KEY, { strict: true })).rejects.toThrow("Permission denied");
    await expect(readIdentityWakeups(conn, KEY)).resolves.toEqual({ wakeups: [] });
  });

  it("the missing-folder command really exits 0 with the marker", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "wakeup-none-"));
    try {
      (execCommand as Mock).mockImplementation(
        (_c: unknown, cmd: string) =>
          new Promise<string>((resolve, reject) => {
            execFile("bash", ["-c", cmd], { cwd: home, env: { ...process.env, HOME: home } }, (err, stdout) =>
              err ? reject(err) : resolve(stdout.trim()),
            );
          }),
      );
      await expect(readIdentityWakeups(conn, KEY, { strict: true })).resolves.toEqual({ wakeups: [] });
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });
});

describe("wakeupCanFireAgain", () => {
  const none = { last: null, anchored: null, runs: 0, fired: false };

  it("off or malformed never counts", () => {
    expect(wakeupCanFireAgain({ type: "interval", every: "1h" }, false, none, NOW)).toBe(false);
    expect(wakeupCanFireAgain({ type: "bogus" }, true, none, NOW)).toBe(false);
    expect(wakeupCanFireAgain(null, true, none, NOW)).toBe(false);
    expect(wakeupCanFireAgain({ type: "daily", at: "09:00", timezone: "Mars/Olympus" }, true, none, NOW)).toBe(false);
  });

  it("a repeating one counts until its end or its runs are used up", () => {
    const sch = { type: "interval", every: "1h", count: 2 };
    expect(wakeupCanFireAgain(sch, true, { ...none, last: NOW - 60, runs: 1 }, NOW)).toBe(true);
    expect(wakeupCanFireAgain(sch, true, { ...none, last: NOW - 60, runs: 2 }, NOW)).toBe(false);
    expect(wakeupCanFireAgain({ type: "interval", every: "1h", until: iso(NOW + 7200) }, true, none, NOW)).toBe(true);
  });

  it("a sensor counts while on; a one-time sensor stops counting once it has fired", () => {
    expect(wakeupCanFireAgain({ type: "sensor" }, true, { ...none, fired: true }, NOW)).toBe(true);
    expect(wakeupCanFireAgain({ type: "sensor", once: true }, true, none, NOW)).toBe(true);
    expect(wakeupCanFireAgain({ type: "sensor", once: true }, true, { ...none, fired: true }, NOW)).toBe(false);
  });
});
