/**
 * Wire shape of a sensor's status, attached to sensor-triggered wake-ups
 * (identity:wakeups) and scheduled tasks (GET /scheduled-agents). Mirrors
 * `SensorStatus` in src/backend/claude-session/sensor-status.ts.
 */
export type SensorState =
  | "healthy"
  | "broken"
  | "running_long"
  | "off"
  | "tripped"
  | "not_live"
  | "unknown";

export type SensorStatus = {
  state: SensorState;
  run: "always" | "cadence" | null;
  /** Humanized cadence ("Every 5m") for cadence sensors. */
  cadenceHuman: string | null;
  /** Epoch seconds of the last run start. */
  lastRanAt: number | null;
  /** Why it tripped, when tripped (switched off for firing too often). */
  trippedReason: string | null;
  /** Epoch seconds it tripped at, when tripped. */
  trippedAt: number | null;
  /** Last error lines when broken. */
  error: string | null;
};

/** The status to show when a refresh couldn't reach the sensor's machine:
 *  keep what's known about how it runs, but never keep a stale verdict. */
export function sensorStatusUnreachable(sensor: SensorStatus): SensorStatus {
  return { ...sensor, state: "unknown", error: null };
}
