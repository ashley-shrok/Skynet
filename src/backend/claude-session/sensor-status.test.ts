// sensor-status — mapping a sensor's records to what the user sees, and the
// probe the local (fs) and remote (bash) readers share (sensors shape 2).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "child_process";
import os from "os";
import path from "path";
import fs from "fs/promises";
import {
  deriveSensorStatus,
  HEALTH_STALE_SECS,
  parseSensorProbe,
  readSensorProbeLocal,
  sensorProbeShell,
  type SensorProbe,
} from "./sensor-status.js";

const NOW = 1_800_000_000;
const iso = (secs: number) => new Date(secs * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const humanize = (s: unknown) => `H(${JSON.stringify(s)})`;

function health(state: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    run: "cadence",
    state,
    healthy: !["failed", "restarting", "invalid", "overrunning"].includes(state),
    lastRunAt: iso(NOW - 120),
    updatedAt: iso(NOW - 10),
    error: null,
    ...extra,
  });
}

const CADENCE = JSON.stringify({ run: "cadence", cadence: { type: "interval", every: "5m" }, command: "x" });
const ALWAYS = JSON.stringify({ run: "always", command: "x" });

function probe(p: Partial<SensorProbe> = {}): SensorProbe {
  return { settingsRaw: CADENCE, healthRaw: health("idle"), waitingFires: 0, ...p };
}

describe("deriveSensorStatus", () => {
  it("no sensor folder, or no published settings → not live yet", () => {
    expect(deriveSensorStatus(null, true, NOW, humanize).state).toBe("not_live");
    expect(deriveSensorStatus(probe({ settingsRaw: null }), true, NOW, humanize).state).toBe("not_live");
  });

  it("trigger switched off → off, whatever the health says", () => {
    const s = deriveSensorStatus(probe({ healthRaw: health("failed", { error: "boom" }) }), false, NOW, humanize);
    expect(s.state).toBe("off");
    expect(s.error).toBeNull();
  });

  it.each(["running", "starting", "idle"])("%s and healthy → healthy", (st) => {
    expect(deriveSensorStatus(probe({ healthRaw: health(st) }), true, NOW, humanize).state).toBe("healthy");
  });

  it.each(["failed", "restarting", "invalid"])("%s → broken, carrying the error lines", (st) => {
    const s = deriveSensorStatus(probe({ healthRaw: health(st, { error: "line1\nline2" }) }), true, NOW, humanize);
    expect(s.state).toBe("broken");
    expect(s.error).toBe("line1\nline2");
  });

  it("overrunning → running long", () => {
    expect(deriveSensorStatus(probe({ healthRaw: health("overrunning") }), true, NOW, humanize).state).toBe(
      "running_long",
    );
  });

  it("missing, unreadable or stale health → unknown (never a false all-clear)", () => {
    expect(deriveSensorStatus(probe({ healthRaw: null }), true, NOW, humanize).state).toBe("unknown");
    expect(deriveSensorStatus(probe({ healthRaw: "{not json" }), true, NOW, humanize).state).toBe("unknown");
    const stale = health("running", { updatedAt: iso(NOW - HEALTH_STALE_SECS - 1) });
    expect(deriveSensorStatus(probe({ healthRaw: stale }), true, NOW, humanize).state).toBe("unknown");
  });

  it("'stopped' while switched on (runner not caught up) → unknown", () => {
    expect(deriveSensorStatus(probe({ healthRaw: health("stopped") }), true, NOW, humanize).state).toBe("unknown");
  });

  it("published settings that aren't JSON → broken", () => {
    const s = deriveSensorStatus(probe({ settingsRaw: "{oops" }), true, NOW, humanize);
    expect(s.state).toBe("broken");
    expect(s.error).toMatch(/not valid JSON/);
  });

  it("carries run style, humanized cadence, last ran and waiting fires", () => {
    const s = deriveSensorStatus(probe({ waitingFires: 2 }), true, NOW, humanize);
    expect(s).toMatchObject({
      run: "cadence",
      cadenceHuman: 'H({"type":"interval","every":"5m"})',
      lastRanAt: NOW - 120,
      waitingFires: 2,
    });
    const a = deriveSensorStatus(probe({ settingsRaw: ALWAYS }), true, NOW, humanize);
    expect(a.run).toBe("always");
    expect(a.cadenceHuman).toBeNull();
  });

  it("waiting fires are reported while off too", () => {
    expect(deriveSensorStatus(probe({ waitingFires: 3 }), false, NOW, humanize).waitingFires).toBe(3);
  });
});

describe("sensor probe — bash and fs readers agree", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sensor-probe-"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  function bashProbe(dir: string): Promise<string> {
    const cmd = `shopt -s nullglob; s=${JSON.stringify(dir)}; ${sensorProbeShell('"$s"')}`;
    return new Promise((resolve, reject) =>
      execFile("bash", ["-c", cmd], (err, out) => (err ? reject(err) : resolve(out))),
    );
  }

  it("a clock trigger (no sensor/ or fires/) has no probe", async () => {
    const dir = path.join(root, "clock");
    await fs.mkdir(dir);
    expect(await bashProbe(dir)).toBe("");
    expect(parseSensorProbe("")).toBeNull();
    expect(await readSensorProbeLocal(dir)).toBeNull();
  });

  it("a draft-only sensor reads as unpublished, same both ways", async () => {
    const dir = path.join(root, "draft");
    await fs.mkdir(path.join(dir, "sensor"), { recursive: true });
    await fs.writeFile(path.join(dir, "sensor", "sensor.json.pending"), ALWAYS);
    const remote = parseSensorProbe(await bashProbe(dir));
    expect(remote).toEqual({ settingsRaw: null, healthRaw: null, waitingFires: 0 });
    expect(await readSensorProbeLocal(dir)).toEqual(remote);
  });

  it("a published sensor with health and waiting fires, same both ways", async () => {
    const dir = path.join(root, "live");
    await fs.mkdir(path.join(dir, "sensor"), { recursive: true });
    await fs.mkdir(path.join(dir, "fires", "delivered"), { recursive: true });
    await fs.mkdir(path.join(dir, ".state"), { recursive: true });
    await fs.writeFile(path.join(dir, "sensor", "sensor.json"), CADENCE + "\n");
    await fs.writeFile(path.join(dir, ".state", "sensor-health.json"), health("failed", { error: "a\nb" }) + "\n");
    await fs.writeFile(path.join(dir, "fires", "20261015T120000000-0123abcd.fire"), "x");
    await fs.writeFile(path.join(dir, "fires", "20261015T120001000-0123abce.fire"), "y");
    await fs.writeFile(path.join(dir, "fires", "20261015T120002000-0123abcf.fire.tmp"), "z");
    await fs.writeFile(path.join(dir, "fires", "delivered", "20261015T110000000-0123abcd.fire"), "old");

    const remote = parseSensorProbe(await bashProbe(dir));
    expect(remote).toEqual({ settingsRaw: CADENCE, healthRaw: health("failed", { error: "a\nb" }), waitingFires: 2 });
    expect(await readSensorProbeLocal(dir)).toEqual(remote);
  });
});
