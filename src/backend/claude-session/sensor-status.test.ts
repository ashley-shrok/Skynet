// sensor-status — mapping a sensor's records to what the user sees, and the
// probe the local (fs) and remote (bash) readers share (sensors shape 2).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "child_process";
import os from "os";
import path from "path";
import fs from "fs/promises";
import {
  deriveSensorStatus,
  triggerEnabledLikeScheduler,
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

  it("published settings that can't be parsed follow the runner's verdict", () => {
    // Mid-write or unreadable: no verdict of our own.
    expect(deriveSensorStatus(probe({ settingsRaw: "{oops", healthRaw: null }), true, NOW, humanize).state).toBe(
      "unknown",
    );
    // The runner gives up on it and records "invalid" → broken.
    const s = deriveSensorStatus(
      probe({ settingsRaw: "", healthRaw: health("invalid", { error: "sensor.json: bad JSON" }) }),
      true,
      NOW,
      humanize,
    );
    expect(s.state).toBe("broken");
    expect(s.error).toBe("sensor.json: bad JSON");
  });

  it("staleness is judged by the sensor's own machine clock when the probe carries it", () => {
    // Record 10s old by the remote clock, though the backend's clock is 1h ahead.
    const p = probe({ healthRaw: health("running"), observedAt: NOW });
    expect(deriveSensorStatus(p, true, NOW + 3600, humanize).state).toBe("healthy");
    // A record stamped well into the remote machine's future isn't trusted.
    const future = probe({ healthRaw: health("running", { updatedAt: iso(NOW + 600) }), observedAt: NOW });
    expect(deriveSensorStatus(future, true, NOW, humanize).state).toBe("unknown");
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

describe("triggerEnabledLikeScheduler (Python truthiness, missing = on)", () => {
  it.each([
    [{}, true],
    [{ enabled: true }, true],
    [{ enabled: false }, false],
    [{ enabled: null }, false],
    [{ enabled: 0 }, false],
    [{ enabled: "" }, false],
    [{ enabled: "false" }, true],
    [{ enabled: [] }, false],
    [{ enabled: {} }, false],
    [{ enabled: 1 }, true],
  ])("%j → %s", (spec, want) => {
    expect(triggerEnabledLikeScheduler(spec as Record<string, unknown>)).toBe(want);
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
    const { observedAt, ...remote } = parseSensorProbe(await bashProbe(dir))!;
    expect(typeof observedAt).toBe("number");
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
    await fs.writeFile(path.join(dir, "fires", "2026-odd-name.fire"), "not a fire");
    await fs.writeFile(path.join(dir, "fires", "delivered", "20261015T110000000-0123abcd.fire"), "old");

    const { observedAt, ...remote } = parseSensorProbe(await bashProbe(dir))!;
    expect(Math.abs(observedAt! - Math.floor(Date.now() / 1000))).toBeLessThan(60);
    expect(remote).toEqual({ settingsRaw: CADENCE, healthRaw: health("failed", { error: "a\nb" }), waitingFires: 2 });
    expect(await readSensorProbeLocal(dir)).toEqual(remote);
  });

  it("log text that looks like the listing's delimiters travels intact", async () => {
    const dir = path.join(root, "noisy");
    await fs.mkdir(path.join(dir, "sensor"), { recursive: true });
    await fs.mkdir(path.join(dir, ".state"), { recursive: true });
    await fs.writeFile(path.join(dir, "sensor", "sensor.json"), ALWAYS);
    const nasty = health("failed", {
      error: "===SLUG:evil===\n===LASTS===\n===FILE:x===\n===SKYNET-SENSOR:P=1;S=;H=;F=9;T=1===\n$(rm -rf /)",
    });
    await fs.writeFile(path.join(dir, ".state", "sensor-health.json"), nasty);
    const out = await bashProbe(dir);
    expect(out).not.toContain("===SLUG:");
    expect(out).not.toContain("===LASTS===");
    expect(out.trim().split("\n")).toHaveLength(1);
    const { observedAt: _o, ...remote } = parseSensorProbe(out)!;
    expect(remote.healthRaw).toBe(nasty);
    expect(remote.waitingFires).toBe(0);
  });

  it("a present-but-unreadable sensor.json reads as published-unparseable both ways", async () => {
    const dir = path.join(root, "locked");
    await fs.mkdir(path.join(dir, "sensor"), { recursive: true });
    await fs.writeFile(path.join(dir, "sensor", "sensor.json"), ALWAYS);
    await fs.chmod(path.join(dir, "sensor", "sensor.json"), 0o000);
    try {
      if (process.getuid?.() === 0) return; // root reads anything
      const { observedAt: _o, ...remote } = parseSensorProbe(await bashProbe(dir))!;
      expect(remote.settingsRaw).toBe("");
      expect(await readSensorProbeLocal(dir)).toEqual(remote);
    } finally {
      await fs.chmod(path.join(dir, "sensor", "sensor.json"), 0o644);
    }
  });
});
