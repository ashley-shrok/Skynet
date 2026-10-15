/**
 * sensor-status.ts — turns a sensor's on-disk records into the status the app
 * shows (sensors campaign, shape 2 — see
 * .planning/campaigns/sensors/shape-sensor-app-surfaces.md and
 * sensor-contract.md).
 *
 * Read-only: everything here comes from what the sensor-runner and the
 * schedulers already record. Nothing is checked on the sensor's behalf.
 *
 * Per trigger folder (a wake-up folder or a scheduled-task folder):
 *   sensor/sensor.json          published settings (absent = not live yet)
 *   sensor/sensor.json.pending  draft (ignored for status)
 *   .state/sensor-health.json   written by sensor-runner every pass (~30s)
 *   fires/*.fire                fires waiting for delivery
 *
 * The same probe is used by the local (bind-mount) and remote (SSH) readers:
 * `sensorProbeShell` emits a delimited block that `parseSensorProbe` reads
 * back, and `readSensorProbeLocal` builds the identical raw shape from fs.
 */

import fs from "fs/promises";
import path from "path";

/** What the user sees. Mapping rules live in deriveSensorStatus. */
export type SensorState =
  | "healthy"
  | "broken"
  | "running_long"
  | "off"
  | "not_live"
  | "unknown";

/** Wire shape attached to sensor-triggered wake-ups and scheduled tasks. */
export type SensorStatus = {
  state: SensorState;
  /** "always" | "cadence" from the published settings; null when unknown. */
  run: "always" | "cadence" | null;
  /** Humanized cadence ("Every 5m") for cadence sensors; null otherwise. */
  cadenceHuman: string | null;
  /** Epoch seconds of the sensor's last run start; null when it never ran. */
  lastRanAt: number | null;
  /** Fires waiting for delivery (held while the trigger is off). */
  waitingFires: number;
  /** Last error lines when broken; null otherwise. */
  error: string | null;
};

/** Raw records for one trigger's sensor, as read from disk. */
export type SensorProbe = {
  /** Contents of sensor/sensor.json, or null when not published. */
  settingsRaw: string | null;
  /** Contents of .state/sensor-health.json, or null when absent. */
  healthRaw: string | null;
  waitingFires: number;
};

/** A health record older than this is not trusted — the sensor-runner that
 *  writes it every ~30s may itself be down. */
export const HEALTH_STALE_SECS = 5 * 60;

const FIRE_NAME_RE = /^20[0-9]{6}T[0-9]{9}-[0-9a-f]{8}\.fire$/;

function isoToEpoch(v: unknown): number | null {
  if (typeof v !== "string" || !v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function parseObject(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Map raw records to the user-facing status.
 *
 *   no published settings                     → not_live
 *   trigger switched off                      → off
 *   health missing / unreadable / stale       → unknown
 *   invalid | failed | restarting             → broken
 *   overrunning                               → running_long
 *   running | starting | idle (healthy)       → healthy
 *   anything else (e.g. "stopped" while on —  → unknown
 *     the runner hasn't caught up yet)
 */
export function deriveSensorStatus(
  probe: SensorProbe | null,
  enabled: boolean,
  nowSecs: number,
  humanize: (schedule: unknown) => string,
): SensorStatus {
  const waitingFires = probe?.waitingFires ?? 0;
  const base: SensorStatus = {
    state: "unknown",
    run: null,
    cadenceHuman: null,
    lastRanAt: null,
    waitingFires,
    error: null,
  };

  if (probe === null || probe.settingsRaw === null) {
    return { ...base, state: "not_live" };
  }

  const settings = parseObject(probe.settingsRaw);
  if (settings) {
    if (settings.run === "always" || settings.run === "cadence") base.run = settings.run;
    if (settings.run === "cadence" && settings.cadence !== undefined) {
      base.cadenceHuman = humanize(settings.cadence);
    }
  }

  const health = parseObject(probe.healthRaw);
  if (health) base.lastRanAt = isoToEpoch(health.lastRunAt);

  if (!enabled) return { ...base, state: "off" };

  // Published settings that don't parse are broken whatever the runner says.
  if (!settings) {
    return { ...base, state: "broken", error: "sensor.json is not valid JSON" };
  }
  if (!health) return base;

  const updatedAt = isoToEpoch(health.updatedAt);
  if (updatedAt === null || nowSecs - updatedAt > HEALTH_STALE_SECS) return base;

  const error = typeof health.error === "string" && health.error ? health.error : null;
  switch (health.state) {
    case "invalid":
    case "failed":
    case "restarting":
      return { ...base, state: "broken", error };
    case "overrunning":
      return { ...base, state: "running_long" };
    case "running":
    case "starting":
    case "idle":
      return health.healthy === false
        ? { ...base, state: "broken", error }
        : { ...base, state: "healthy" };
    default:
      return base;
  }
}

// ---------------------------------------------------------------------------
// Probe — shell (remote) and fs (local) readers producing the same SensorProbe
// ---------------------------------------------------------------------------

/** Every probe line starts with this; callers use it to find where a
 *  trigger's spec text ends and its probe block begins. */
export const SENSOR_PROBE_MARK = "===SKYNET-SENSOR:";
const MARK = SENSOR_PROBE_MARK;

/**
 * Bash snippet that prints the sensor probe block for one trigger folder.
 * `dirExpr` is a shell expression for the trigger folder (already quoted as
 * needed, e.g. `"$s"`). Requires bash with nullglob set by the caller. Prints
 * nothing when the folder has neither a sensor/ nor a fires/ folder (a clock
 * trigger, or a sensor trigger whose sensor hasn't been started).
 */
export function sensorProbeShell(dirExpr: string): string {
  return (
    `if [ -d ${dirExpr}/sensor ] || [ -d ${dirExpr}/fires ]; then ` +
    `echo "${MARK}SETTINGS==="; ` +
    `[ -f ${dirExpr}/sensor/sensor.json ] && { cat ${dirExpr}/sensor/sensor.json; echo; echo "${MARK}PUBLISHED==="; }; ` +
    `echo "${MARK}HEALTH==="; cat ${dirExpr}/.state/sensor-health.json 2>/dev/null; echo; ` +
    `_f=( ${dirExpr}/fires/20*.fire ); echo "${MARK}FIRES=\${#_f[@]}==="; ` +
    `echo "${MARK}END==="; ` +
    `fi; `
  );
}

/**
 * Parse one trigger's probe text (the portion of stdout belonging to that
 * trigger). Returns null when no probe block is present.
 */
export function parseSensorProbe(text: string): SensorProbe | null {
  const start = text.indexOf(`${MARK}SETTINGS===`);
  if (start === -1) return null;
  const body = text.slice(start + `${MARK}SETTINGS===`.length);
  const healthIdx = body.indexOf(`${MARK}HEALTH===`);
  const firesIdx = body.indexOf(`${MARK}FIRES=`);
  if (healthIdx === -1 || firesIdx === -1) return null;

  const settingsPart = body.slice(0, healthIdx);
  const pubIdx = settingsPart.indexOf(`${MARK}PUBLISHED===`);
  const settingsRaw = pubIdx === -1 ? null : settingsPart.slice(0, pubIdx).trim();

  const healthText = body.slice(healthIdx + `${MARK}HEALTH===`.length, firesIdx).trim();
  const firesMatch = /^(\d+)===/.exec(body.slice(firesIdx + `${MARK}FIRES=`.length));
  const waitingFires = firesMatch ? Number(firesMatch[1]) : 0;

  return {
    settingsRaw,
    healthRaw: healthText ? healthText : null,
    waitingFires,
  };
}

async function readOrNull(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf-8");
  } catch {
    return null;
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Local (bind-mount) equivalent of sensorProbeShell + parseSensorProbe. */
export async function readSensorProbeLocal(triggerDir: string): Promise<SensorProbe | null> {
  const sensorDir = path.join(triggerDir, "sensor");
  const firesDir = path.join(triggerDir, "fires");
  const [hasSensor, hasFires] = await Promise.all([isDir(sensorDir), isDir(firesDir)]);
  if (!hasSensor && !hasFires) return null;

  const [settingsRaw, healthRaw, fireNames] = await Promise.all([
    readOrNull(path.join(sensorDir, "sensor.json")),
    readOrNull(path.join(triggerDir, ".state", "sensor-health.json")),
    fs.readdir(firesDir).catch(() => [] as string[]),
  ]);
  return {
    settingsRaw: settingsRaw === null ? null : settingsRaw.trim(),
    healthRaw: healthRaw && healthRaw.trim() ? healthRaw.trim() : null,
    waitingFires: fireNames.filter((n) => FIRE_NAME_RE.test(n)).length,
  };
}
