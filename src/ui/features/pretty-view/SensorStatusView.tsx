/**
 * SensorStatusView — how a sensor-triggered wake-up or scheduled task shows
 * its sensor (sensors campaign shape 2, see
 * .planning/campaigns/sensors/shape-sensor-app-surfaces.md).
 *
 * Two pieces, shared by the wake-ups tab and the scheduled-tasks list:
 *   - SensorSummaryLine — the unopened row's line:
 *       "📡 Sensor · Healthy · Last fired 3h ago · 2 waiting"
 *   - SensorDetails — the read-only section in the opened view: status (with
 *       the last error lines when broken), how it runs, last ran, last
 *       fired, waiting fires.
 *
 * Read-only by design: the trigger's existing on/off switch is the only
 * control a user has over a sensor.
 */

import type { SensorState, SensorStatus } from "@/api/sensor-status-types";
import {
  formatAbsolute,
  formatRelativePast,
} from "@/features/pretty-conversations/scheduled-agents-time-fmt";
import { cn } from "@/lib/utils";

export const SENSOR_MARK = "📡";

const STATE_LABEL: Record<SensorState, string> = {
  healthy: "Healthy",
  broken: "Broken",
  running_long: "Running long",
  off: "Off",
  not_live: "Not live yet",
  unknown: "Unknown",
};

/** Text colour per state. Off / not live are deliberately calm (inherit the
 *  muted line colour); unknown is grey; broken is red. */
const STATE_CLASS: Record<SensorState, string> = {
  healthy: "text-emerald-300",
  broken: "text-rose-400 font-semibold",
  running_long: "text-amber-300",
  off: "",
  not_live: "",
  unknown: "text-slate-400",
};

const STATE_HINT: Record<SensorState, string> = {
  healthy: "The sensor is running normally.",
  broken: "The sensor is failing — open it to see why.",
  running_long: "A run is still going when the next one was due.",
  off: "Switched off — the sensor is stopped.",
  not_live: "An agent is still building this sensor; it hasn't been published.",
  unknown: "The app can't read this sensor's status right now.",
};

export function sensorStateLabel(state: SensorState): string {
  return STATE_LABEL[state] ?? "Unknown";
}

function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

function lastFiredText(lastFiredAt: number | null | undefined, now: number): string {
  return typeof lastFiredAt === "number"
    ? `Last fired ${formatRelativePast(lastFiredAt, now)}`
    : "Never fired";
}

function runText(sensor: SensorStatus): string {
  if (sensor.run === "always") return "Always running";
  if (sensor.run === "cadence") {
    return sensor.cadenceHuman ? `Runs: ${sensor.cadenceHuman}` : "Runs on a schedule";
  }
  return "—";
}

function waitingText(n: number): string {
  return `${n} waiting`;
}

const Dot = () => <span className="mx-1.5 opacity-55">·</span>;

export function SensorSummaryLine({
  sensor,
  lastFiredAt,
  className,
  testId,
}: {
  sensor: SensorStatus;
  lastFiredAt: number | null | undefined;
  className?: string;
  testId?: string;
}): JSX.Element {
  const now = nowSecs();
  return (
    <span className={className} data-testid={testId}>
      <span aria-hidden="true">{SENSOR_MARK} </span>
      Sensor
      <Dot />
      <span
        className={STATE_CLASS[sensor.state]}
        title={STATE_HINT[sensor.state]}
        data-testid={testId ? `${testId}-state` : undefined}
        data-state={sensor.state}
      >
        {sensorStateLabel(sensor.state)}
      </span>
      <Dot />
      <span title={typeof lastFiredAt === "number" ? formatAbsolute(lastFiredAt, now) : undefined}>
        {lastFiredText(lastFiredAt, now)}
      </span>
      {sensor.waitingFires > 0 && (
        <>
          <Dot />
          <span data-testid={testId ? `${testId}-waiting` : undefined}>
            {waitingText(sensor.waitingFires)}
          </span>
        </>
      )}
    </span>
  );
}

/** Clock wake-ups' last-fired fragment for the header line. */
export function lastFiredLabel(lastFiredAt: number | null | undefined): string {
  return lastFiredText(lastFiredAt, nowSecs());
}

export function SensorDetails({
  sensor,
  lastFiredAt,
  testId,
}: {
  sensor: SensorStatus;
  lastFiredAt: number | null | undefined;
  testId?: string;
}): JSX.Element {
  const now = nowSecs();
  const rows: Array<[string, JSX.Element | string]> = [
    [
      "Status",
      <span className={STATE_CLASS[sensor.state]} data-state={sensor.state}>
        {sensorStateLabel(sensor.state)}
        <span className="ml-2 text-[11px] font-normal text-[var(--color-pv-fg-muted)]">
          {STATE_HINT[sensor.state]}
        </span>
      </span>,
    ],
    ["How it runs", runText(sensor)],
    [
      // An always-running sensor's last run start is when its current
      // process started — "Last ran 3 days ago" would misread as idle.
      sensor.run === "always" ? "Running since" : "Last ran",
      typeof sensor.lastRanAt === "number"
        ? `${formatRelativePast(sensor.lastRanAt, now)} (${formatAbsolute(sensor.lastRanAt, now)})`
        : "Never",
    ],
    [
      "Last fired",
      typeof lastFiredAt === "number"
        ? `${formatRelativePast(lastFiredAt, now)} (${formatAbsolute(lastFiredAt, now)})`
        : "Never fired",
    ],
  ];
  if (sensor.waitingFires > 0) {
    rows.push(["Waiting fires", `${sensor.waitingFires} — delivered when switched on`]);
  }

  return (
    <div
      className="flex flex-col gap-1.5 rounded-md border border-white/10 bg-black/20 px-3 py-2"
      data-testid={testId}
    >
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold">
        {SENSOR_MARK} Sensor
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-[var(--color-pv-fg-muted)]">{label}</dt>
            <dd className="text-[#e8e4d8] min-w-0">{value}</dd>
          </div>
        ))}
      </dl>
      {sensor.state === "broken" && sensor.error && (
        <pre
          className={cn(
            "mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded",
            "bg-black/40 px-2 py-1.5 text-[11px] leading-snug text-rose-200 font-mono",
          )}
          data-testid={testId ? `${testId}-error` : undefined}
        >
          {sensor.error}
        </pre>
      )}
    </div>
  );
}
