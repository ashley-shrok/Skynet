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
  /** Contents of sensor/sensor.json ("" when it exists but can't be read),
   *  or null when not published. */
  settingsRaw: string | null;
  /** Contents of .state/sensor-health.json, or null when absent. */
  healthRaw: string | null;
  waitingFires: number;
  /** Epoch seconds on the sensor's own machine when the probe ran; the
   *  staleness check compares the record's timestamp against this, so two
   *  machines' clocks are never mixed. Absent = use the caller's clock. */
  observedAt?: number;
};

/**
 * A trigger's `enabled` exactly as the wake-up scheduler and sensor-runner
 * read it (`spec.get("enabled", True)` + Python truthiness): missing means
 * on; null, false, 0, "" and empty arrays/objects mean off; anything else on.
 */
export function triggerEnabledLikeScheduler(spec: Record<string, unknown>): boolean {
  if (!Object.prototype.hasOwnProperty.call(spec, "enabled")) return true;
  const v = spec.enabled;
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

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

/** A record stamped further than this into the future (by the sensor's own
 *  machine's clock) is not trusted either. */
const FUTURE_SLACK_SECS = 2 * 60;

/**
 * Map raw records to the user-facing status.
 *
 *   no published settings                     → not_live
 *   trigger switched off                      → off
 *   health missing / unreadable / stale /     → unknown
 *     stamped in the future
 *   invalid | failed | restarting             → broken
 *   overrunning                               → running_long
 *   running | starting | idle (healthy)       → healthy
 *   anything else (e.g. "stopped" while on —  → unknown
 *     the runner hasn't caught up yet)
 *
 * Published settings that can't be parsed (mid-write, unreadable) are left to
 * the runner's verdict: it holds a half-written file for a few passes and
 * then records "invalid", which reads as broken.
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
  if (!health) return base;

  const now = typeof probe.observedAt === "number" ? probe.observedAt : nowSecs;
  const updatedAt = isoToEpoch(health.updatedAt);
  if (
    updatedAt === null ||
    now - updatedAt > HEALTH_STALE_SECS ||
    updatedAt - now > FUTURE_SLACK_SECS
  ) {
    return base;
  }

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

/** Prefix of the one probe line per trigger; callers use it to find where a
 *  trigger's spec text ends and its probe line begins. */
export const SENSOR_PROBE_MARK = "===SKYNET-SENSOR:";

/** The whole probe is one line of fixed fields; file contents travel
 *  base64-encoded so nothing a sensor prints into its log (which ends up in
 *  the health record) can be mistaken for the listing's own delimiters. */
const PROBE_LINE_RE =
  /===SKYNET-SENSOR:P=([01]);S=([A-Za-z0-9+/=]*);H=([A-Za-z0-9+/=]*);F=(\d+);T=(\d*)===/;

/** Shell glob matching exactly the fire-file name format
 *  `YYYYMMDDTHHMMSSmmm-<8 hex>.fire` (same rule as FIRE_NAME_RE). */
const FIRE_GLOB =
  "20" + "[0-9]".repeat(6) + "T" + "[0-9]".repeat(9) + "-" + "[0-9a-f]".repeat(8) + ".fire";

/**
 * Bash snippet that prints the probe line for one trigger folder.
 * `dirExpr` is a shell expression for the trigger folder (already quoted as
 * needed, e.g. `"$s"`). Prints nothing when the folder has neither a sensor/
 * nor a fires/ folder (a clock trigger, or a sensor trigger whose sensor
 * hasn't been started).
 */
export function sensorProbeShell(dirExpr: string): string {
  const b64 = (file: string) => `$(base64 < ${file} 2>/dev/null | tr -d '\\n')`;
  return (
    `if [ -d ${dirExpr}/sensor ] || [ -d ${dirExpr}/fires ]; then ` +
    `_p=0; [ -e ${dirExpr}/sensor/sensor.json ] && _p=1; ` +
    `_n=0; for _x in ${dirExpr}/fires/*.fire; do case "\${_x##*/}" in ${FIRE_GLOB}) _n=$((_n+1));; esac; done; ` +
    `echo "${SENSOR_PROBE_MARK}P=$_p;S=${b64(`${dirExpr}/sensor/sensor.json`)};` +
    `H=${b64(`${dirExpr}/.state/sensor-health.json`)};F=$_n;T=$(date +%s)==="; ` +
    `fi; `
  );
}

function decodeB64(v: string): string {
  return Buffer.from(v, "base64").toString("utf-8").trim();
}

/**
 * Parse one trigger's probe text (the portion of stdout belonging to that
 * trigger). Returns null when no probe line is present.
 */
export function parseSensorProbe(text: string): SensorProbe | null {
  const m = PROBE_LINE_RE.exec(text);
  if (!m) return null;
  const [, published, settingsB64, healthB64, fires, observed] = m;
  const healthText = decodeB64(healthB64);
  const probe: SensorProbe = {
    settingsRaw: published === "1" ? decodeB64(settingsB64) : null,
    healthRaw: healthText ? healthText : null,
    waitingFires: Number(fires),
  };
  if (observed) probe.observedAt = Number(observed);
  return probe;
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

  const settingsPath = path.join(sensorDir, "sensor.json");
  const [settingsRaw, healthRaw, fireNames] = await Promise.all([
    // Present-but-unreadable reads as "" (published, unparseable), same as
    // the remote probe; absent reads as null (not published).
    fs.readFile(settingsPath, "utf-8").then(
      (t) => t.trim(),
      (err: NodeJS.ErrnoException) => (err?.code === "ENOENT" ? null : ""),
    ),
    fs.readFile(path.join(triggerDir, ".state", "sensor-health.json"), "utf-8").catch(() => null),
    fs.readdir(firesDir).catch(() => [] as string[]),
  ]);
  return {
    settingsRaw,
    healthRaw: healthRaw && healthRaw.trim() ? healthRaw.trim() : null,
    waitingFires: fireNames.filter((n) => FIRE_NAME_RE.test(n)).length,
  };
}
