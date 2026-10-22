/**
 * SensorStatusView — how a sensor-triggered wake-up or scheduled task shows
 * its sensor (sensors campaign shape 2, see
 * .planning/campaigns/sensors/shape-sensor-app-surfaces.md).
 *
 * Two pieces, shared by the wake-ups tab and the scheduled-tasks list:
 *   - SensorSummaryLine — the unopened row's line:
 *       "📡 Sensor · Healthy · Last fired 3h ago"
 *   - SensorDetails — the read-only section in the opened view: status (with
 *       the last error lines when broken), how it runs, last ran, last
 *       fired, and why it tripped when it did.
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
import { KitChip, type KitChipTone } from "@/components/kit";

export const SENSOR_MARK = "📡";

const STATE_LABEL: Record<SensorState, string> = {
  healthy: "Healthy",
  broken: "Broken",
  running_long: "Running long",
  off: "Off",
  tripped: "Tripped",
  not_live: "Not live yet",
  unknown: "Unknown",
};

/** Kit chip tone per state. Off / not live are deliberately calm. */
const STATE_TONE: Record<SensorState, KitChipTone> = {
  healthy: "ok",
  broken: "danger",
  running_long: "warn",
  off: "neutral",
  tripped: "warn",
  not_live: "neutral",
  unknown: "neutral",
};

/** Text colour per state (inline text inside the details panel). */
const STATE_CLASS: Record<SensorState, string> = {
  healthy: "text-[#6fd3a5]",
  broken: "text-[var(--k-danger-text)] font-semibold",
  running_long: "text-[#e8bf72]",
  off: "",
  tripped: "text-[var(--k-warn)] font-semibold",
  not_live: "",
  unknown: "text-[var(--k-t3)]",
};

const STATE_HINT: Record<SensorState, string> = {
  healthy: "The sensor is running normally.",
  broken: "The sensor is failing — open it to see why.",
  running_long: "A run is still going when the next one was due.",
  off: "Switched off — the sensor is stopped.",
  tripped:
    "Fired far more than usual, so it was switched off and an agent was told. Switch it back on to resume — it starts fresh.",
  not_live: "An agent is still building this sensor; it hasn't been published.",
  unknown: "The app can't read this sensor's status right now.",
};

export function sensorStateLabel(state: SensorState): string {
  return STATE_LABEL[state] ?? "Unknown";
}

export function sensorStateHint(state: SensorState): string {
  return STATE_HINT[state] ?? STATE_HINT.unknown;
}

/** "Fired more than its limit…" — a tripped sensor's reason, capitalised. */
export function trippedReasonText(sensor: SensorStatus): string | null {
  if (sensor.state !== "tripped" || !sensor.trippedReason) return null;
  return sensor.trippedReason[0].toUpperCase() + sensor.trippedReason.slice(1);
}

/** The sensor's state as a kit status chip (with its hover hint). */
export function SensorStateChip({
  state,
  testId,
}: {
  state: SensorState;
  testId?: string;
}) {
  return (
    <KitChip
      tone={STATE_TONE[state] ?? "neutral"}
      dot={state === "healthy" || state === "broken" || state === "running_long"}
      title={sensorStateHint(state)}
      data-testid={testId}
      data-state={state}
    >
      {sensorStateLabel(state)}
    </KitChip>
  );
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

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

const Dot = () => <span className="mx-1.5 opacity-55">·</span>;

/** "Sensor", or "Sensor · once" for a one-time sensor (retires after its
 *  first delivered fire). */
function sensorLabel(once: boolean | undefined): string {
  return once ? "Sensor · once" : "Sensor";
}

export function SensorSummaryLine({
  sensor,
  lastFiredAt,
  once,
  className,
  testId,
}: {
  sensor: SensorStatus;
  lastFiredAt: number | null | undefined;
  once?: boolean;
  className?: string;
  testId?: string;
}): JSX.Element {
  const now = nowSecs();
  return (
    <span className={className} data-testid={testId}>
      <span aria-hidden="true">{SENSOR_MARK} </span>
      {sensorLabel(once)}
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
      {sensor.state === "tripped" && sensor.trippedReason && (
        <>
          <Dot />
          <span data-testid={testId ? `${testId}-tripped` : undefined}>
            {capitalize(sensor.trippedReason)}
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
  once,
  testId,
}: {
  sensor: SensorStatus;
  lastFiredAt: number | null | undefined;
  once?: boolean;
  testId?: string;
}): JSX.Element {
  const now = nowSecs();
  const rows: Array<[string, JSX.Element | string]> = [
    [
      "Status",
      <span className={STATE_CLASS[sensor.state]} data-state={sensor.state}>
        {sensorStateLabel(sensor.state)}
        <span className="ml-2 text-[11.5px] font-normal text-[var(--k-t3)]">
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
  if (sensor.state === "tripped") {
    const when =
      typeof sensor.trippedAt === "number"
        ? ` — ${formatRelativePast(sensor.trippedAt, now)} (${formatAbsolute(sensor.trippedAt, now)})`
        : "";
    rows.push(["Tripped", `${capitalize(sensor.trippedReason ?? "fired far more than usual")}${when}`]);
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-[14px] bg-[var(--k-s1)] px-3.5 py-3"
      data-testid={testId}
    >
      <div className="text-[13px] font-semibold text-[var(--k-t2)]">
        {SENSOR_MARK} {sensorLabel(once)}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-[var(--k-t3)]">{label}</dt>
            <dd className="text-[var(--k-t1)] min-w-0">{value}</dd>
          </div>
        ))}
      </dl>
      {sensor.state === "broken" && sensor.error && (
        <pre
          className={cn(
            "mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[10px]",
            "bg-[var(--k-danger-soft)] px-2.5 py-2 text-[12px] leading-snug text-[#ffb1ab] font-mono",
          )}
          data-testid={testId ? `${testId}-error` : undefined}
        >
          {sensor.error}
        </pre>
      )}
    </div>
  );
}
