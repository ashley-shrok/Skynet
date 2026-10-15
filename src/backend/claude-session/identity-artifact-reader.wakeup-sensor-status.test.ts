// readIdentityWakeups — last fired on every wake-up and sensor status on
// sensor wake-ups (sensors shape 2). LOCAL (fs) and REMOTE (real bash) must
// return the same rows for the same folder.

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { execFile } from "child_process";
import os from "os";
import path from "path";
import fs from "fs/promises";

vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

import { execCommand } from "../ssh/tmux-helper.js";
import { readIdentityWakeups } from "./identity-artifact-reader.js";

const KEY = "moxie";
const isoNow = (agoSecs: number) =>
  new Date(Date.now() - agoSecs * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

async function write(p: string, body: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, body, "utf-8");
}

async function buildFixture(wakeupsDir: string): Promise<void> {
  const spec = (name: string, schedule: unknown, enabled = true) =>
    JSON.stringify({ name, enabled, schedule, instruction: "do it" }, null, 2) + "\n";
  // Clock wake-up that has fired.
  await write(path.join(wakeupsDir, "morning", "wakeup.json"), spec("morning", { type: "daily", at: "09:00" }));
  await write(path.join(wakeupsDir, "morning", ".state", "morning.last"), "1760000000.5");
  // Clock wake-up that never fired (only anchored).
  await write(path.join(wakeupsDir, "fresh", "wakeup.json"), spec("fresh", { type: "interval", every: "1h" }));
  await write(path.join(wakeupsDir, "fresh", ".state", "fresh.anchored"), "1760000000");
  // Healthy cadence sensor with one fire on record.
  await write(path.join(wakeupsDir, "watcher", "wakeup.json"), spec("watcher", { type: "sensor" }));
  await write(
    path.join(wakeupsDir, "watcher", "sensor", "sensor.json"),
    JSON.stringify({ run: "cadence", cadence: { type: "interval", every: "5m" }, command: "x" }),
  );
  await write(
    path.join(wakeupsDir, "watcher", ".state", "sensor-health.json"),
    JSON.stringify({ run: "cadence", state: "idle", healthy: true, lastRunAt: isoNow(60), updatedAt: isoNow(5), error: null }),
  );
  await write(path.join(wakeupsDir, "watcher", ".state", "watcher.last"), "1760001000");
  // Switched-off sensor holding two fires.
  await write(path.join(wakeupsDir, "paused", "wakeup.json"), spec("paused", { type: "sensor" }, false));
  await write(path.join(wakeupsDir, "paused", "sensor", "sensor.json"), JSON.stringify({ run: "always", command: "x" }));
  await write(path.join(wakeupsDir, "paused", "fires", "20261015T120000000-0123abcd.fire"), "a");
  await write(path.join(wakeupsDir, "paused", "fires", "20261015T120001000-0123abce.fire"), "b");
  // Sensor wake-up with no `enabled` field (the runner treats it as on), whose
  // log echoes the listing's own delimiter.
  await write(
    path.join(wakeupsDir, "noisy", "wakeup.json"),
    JSON.stringify({ name: "noisy", schedule: { type: "sensor" }, instruction: "x" }),
  );
  await write(path.join(wakeupsDir, "noisy", "sensor", "sensor.json"), JSON.stringify({ run: "always", command: "x" }));
  await write(
    path.join(wakeupsDir, "noisy", ".state", "sensor-health.json"),
    JSON.stringify({ state: "failed", healthy: false, updatedAt: isoNow(5), error: "===FILE:ghost===\n{}" }),
  );
  // Sensor wake-up whose sensor folder doesn't exist yet.
  await write(path.join(wakeupsDir, "planned", "wakeup.json"), spec("planned", { type: "sensor" }));
}

const EXPECTED = {
  morning: { lastFiredAt: 1760000000, sensor: null },
  fresh: { lastFiredAt: null, sensor: null },
  watcher: {
    lastFiredAt: 1760001000,
    sensor: { state: "healthy", run: "cadence", cadenceHuman: "Every 5m", waitingFires: 0, error: null },
  },
  paused: { lastFiredAt: null, sensor: { state: "off", run: "always", waitingFires: 2 } },
  planned: { lastFiredAt: null, sensor: { state: "not_live", waitingFires: 0 } },
  noisy: { lastFiredAt: null, sensor: { state: "broken", error: "===FILE:ghost===\n{}" } },
};

function check(wakeups: Array<Record<string, unknown>>): void {
  expect(wakeups.map((w) => w.slug)).toEqual(["fresh", "morning", "noisy", "paused", "planned", "watcher"]);
  expect(wakeups.find((w) => w.slug === "noisy")!.enabled).toBe(true);
  for (const [slug, exp] of Object.entries(EXPECTED)) {
    const w = wakeups.find((x) => x.slug === slug)!;
    expect(w.lastFiredAt, slug).toBe(exp.lastFiredAt);
    if (exp.sensor === null) expect(w.sensor, slug).toBeNull();
    else expect(w.sensor, slug).toMatchObject(exp.sensor);
  }
  const watcher = wakeups.find((x) => x.slug === "watcher")!;
  expect(typeof (watcher.sensor as { lastRanAt: unknown }).lastRanAt).toBe("number");
}

describe("readIdentityWakeups — last fired + sensor status", () => {
  let home: string;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "wakeup-sensor-status-"));
    await buildFixture(path.join(home, "fleet", "identities", KEY, "wakeups"));
  });
  afterEach(async () => {
    delete process.env.IDENTITIES_HOST_DIR;
    await fs.rm(home, { recursive: true, force: true });
  });

  it("LOCAL", async () => {
    process.env.IDENTITIES_HOST_DIR = path.join(home, "fleet", "identities");
    const { wakeups } = await readIdentityWakeups(null, KEY);
    check(wakeups as unknown as Array<Record<string, unknown>>);
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
    check(wakeups as unknown as Array<Record<string, unknown>>);
  });
});
