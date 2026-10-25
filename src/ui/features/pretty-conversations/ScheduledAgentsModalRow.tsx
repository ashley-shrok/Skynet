/**
 * ScheduledAgentsModalRow — one task in the scheduled tasks window's list
 * (apple-ux shape-scheduled-tasks-modal).
 *
 *   leading — the role's picture (two overlapped for a two-role task, a clock
 *             tile for no roles), dimmed when the task is off
 *   label   — the task's name
 *   desc    — "Daily at 11:30 · Next in 14h" (or "Off"; a sensor task shows
 *             its sensor line), then the project its conversations are filed
 *             in ("SKYNET › later", amber when it's gone), then one quiet line
 *             of the instructions
 *   control — the on/off switch (pessimistic — the parent flips it on ack)
 *   click   — opens the task; right-click → Run now / Open / Delete…
 */

import { AlarmClock, Folder } from "lucide-react";
import type { ScheduledAgentListItem } from "@/api/scheduled-agents-api";
import { roleAvatarUrl } from "@/api/identities-api";
import { KitAvatar, KitSettingsRow, KitSwitch } from "@/components/kit";
import { cn } from "@/lib/utils";
import { useRowKebabContextMenu, type RowKebabMenuItem } from "./RowKebabMenu";
import { formatAbsolute, formatRelativeFuture, formatRelativePast } from "./scheduled-agents-time-fmt";
import { SENSOR_MARK, SensorStateChip, trippedReasonText } from "@/features/pretty-view/SensorStatusView";
import { isOnceSensorSchedule } from "@/features/pretty-view/WakeupFormShared";
import { formatProjectPath } from "./scheduled-agents-projects";

const FALLBACK_HUE = 190;

/** Render-only de-slug. Hyphens/underscores → spaces, capitalize first char.
 *  Kept in sync with `_prettify_name` in substrate/scripts/wakeup-scheduler.py
 *  (the ⏰ task-prefix on scheduled-agent-spawned identities). */
export function prettifyScheduledAgentName(name: string): string {
  const spaced = name.replace(/[-_]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The server's schedule sentence, minus "(box-local)" — this window says
 *  where times are in the task itself. */
export function scheduleSentence(row: Pick<ScheduledAgentListItem, "scheduleHuman">): string {
  return row.scheduleHuman.replace(/\s*\(box-local\)/g, "");
}

/** "Next in 3h" / "Due now" / "Next Mar 1, 2027". */
export function nextRunLabel(nextFireAt: number, nowSecs: number): string {
  const rel = formatRelativeFuture(nextFireAt, nowSecs);
  return rel === "due now" ? "Due now" : `Next ${rel}`;
}

export function isOneShotTask(row: Pick<ScheduledAgentListItem, "schedule">): boolean {
  return (row.schedule as { type?: unknown } | null)?.type === "one_shot";
}

/** The role pictures for a task — two overlapped at most; a clock tile when
 *  the task takes no roles. */
export function TaskAvatars({ row, size = 36 }: { row: ScheduledAgentListItem; size?: number }): JSX.Element {
  const off = !row.enabled;
  if (row.roles.length === 0) {
    return (
      <span
        className={cn("grid place-items-center shrink-0 rounded-full bg-[var(--k-s3)] text-[var(--k-t2)]", off && "opacity-50")}
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <AlarmClock className="size-[18px]" />
      </span>
    );
  }
  const hue = row.colorHue ?? FALLBACK_HUE;
  return (
    <span className="flex shrink-0" aria-hidden="true">
      {row.roles.slice(0, 2).map((r, i) => (
        <KitAvatar
          key={r}
          src={roleAvatarUrl(row.hostId, r)}
          fallback={r.charAt(0).toUpperCase()}
          color={`hsl(${hue}, 45%, 34%)`}
          size={size}
          dim={off}
          className={i > 0 ? "-ml-3 shadow-[0_0_0_2px_var(--k-bg)]" : undefined}
        />
      ))}
    </span>
  );
}

export interface ScheduledAgentsModalRowProps {
  row: ScheduledAgentListItem;
  onOpen: (row: ScheduledAgentListItem) => void;
  onToggle: (row: ScheduledAgentListItem, enabled: boolean) => void;
  onDelete: (row: ScheduledAgentListItem) => void | Promise<unknown>;
  /** Fire once now, outside the schedule. Not offered for one-time tasks
   *  (firing one early would use it up) — the server rejects those too. */
  onRunNow: (row: ScheduledAgentListItem) => void;
  /** True while a run-now request for this row is in flight. */
  runNowPending?: boolean;
  /** True while this row's switch write is in flight. */
  toggling?: boolean;
}

const Dot = () => <span className="mx-1.5 opacity-55">·</span>;

/** "📡 Sensor · <status chip> · Last fired …" (plus why, when tripped) — the
 *  row line for a sensor-triggered task (sensors have no Next). */
function SensorLine({
  row,
  testId,
}: {
  row: ScheduledAgentListItem & { sensor: NonNullable<ScheduledAgentListItem["sensor"]> };
  testId: string;
}) {
  const nowSecs = Math.floor(Date.now() / 1000);
  const { sensor, lastFiredAt } = row;
  return (
    <span className="flex flex-wrap items-center" data-testid={testId}>
      <span aria-hidden="true">{SENSOR_MARK}&nbsp;</span>
      {isOnceSensorSchedule(row.schedule) ? "Sensor · once" : "Sensor"}
      <Dot />
      <SensorStateChip state={sensor.state} testId={`${testId}-state`} />
      <Dot />
      <span title={typeof lastFiredAt === "number" ? formatAbsolute(lastFiredAt, nowSecs) : undefined}>
        {typeof lastFiredAt === "number" ? `Last fired ${formatRelativePast(lastFiredAt, nowSecs)}` : "Never fired"}
      </span>
      {trippedReasonText(sensor) && (
        <>
          <Dot />
          <span data-testid={`${testId}-tripped`}>{trippedReasonText(sensor)}</span>
        </>
      )}
    </span>
  );
}

export function ScheduledAgentsModalRow({
  row,
  onOpen,
  onToggle,
  onDelete,
  onRunNow,
  runNowPending = false,
  toggling = false,
}: ScheduledAgentsModalRowProps): JSX.Element {
  const name = prettifyScheduledAgentName(row.name);
  const testId = `scheduled-agents-modal-row-${row.slug}`;
  const menuItems: RowKebabMenuItem[] = [
    ...(isOneShotTask(row)
      ? []
      : [
          {
            label: runNowPending ? "Starting…" : "Run now",
            disabled: runNowPending,
            onClick: () => onRunNow(row),
            testId: `${testId}-run-now`,
          },
        ]),
    { label: "Open", onClick: () => onOpen(row), testId: `${testId}-open` },
    { label: "Delete…", danger: true, onClick: () => onDelete(row), testId: `${testId}-delete` },
  ];
  // Touch: swipe left deletes (behind the same confirm as the menu's Delete…).
  const contextMenu = useRowKebabContextMenu(menuItems, {
    swipe: { label: "Delete", onSwipe: () => onDelete(row) },
  });

  const nowSecs = Math.floor(Date.now() / 1000);
  const when = row.sensor ? (
    <SensorLine
      row={row as ScheduledAgentListItem & { sensor: NonNullable<ScheduledAgentListItem["sensor"]> }}
      testId={`${testId}-sensor`}
    />
  ) : (
    <span data-testid={`${testId}-when`}>
      {scheduleSentence(row)}
      {!row.enabled ? (
        <>
          <Dot />
          Off
        </>
      ) : row.nextFireAt !== null ? (
        <>
          <Dot />
          <span title={formatAbsolute(row.nextFireAt, nowSecs)}>{nextRunLabel(row.nextFireAt, nowSecs)}</span>
        </>
      ) : null}
    </span>
  );

  return (
    <KitSettingsRow
      data-testid={testId}
      className="[&_.k-row-desc]:min-w-0 max-sm:[&_.k-row-chev]:hidden"
      leading={<TaskAvatars row={row} />}
      label={<span className={cn("font-semibold", !row.enabled && "text-[var(--k-t2)]")}>{name}</span>}
      openLabel={`Open ${name}`}
      description={
        <span className="flex flex-col min-w-0">
          {when}
          {row.project && (
            <span
              className={cn(
                "flex items-center gap-1 min-w-0 text-[12.5px] mt-px",
                row.projectMissing ? "text-[var(--k-warn)]" : "text-[var(--k-t2)]",
              )}
              title={
                row.projectMissing
                  ? "This project no longer exists — its conversations go to Conversations"
                  : row.projectPath
                    ? "Its conversations are filed in this project"
                    : "Couldn't read this machine's projects right now"
              }
              data-testid={`${testId}-project`}
            >
              <Folder className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {row.projectMissing
                  ? `Project missing: ${row.project}`
                  : row.projectPath
                    ? formatProjectPath(row.projectPath)
                    : row.project}
              </span>
            </span>
          )}
          <span className="truncate text-[12.5px] text-[var(--k-t3)] mt-px" data-testid={`${testId}-prompt`}>
            {row.prompt.replace(/\s+/g, " ")}
          </span>
        </span>
      }
      control={
        <KitSwitch
          checked={row.enabled}
          onCheckedChange={(next) => onToggle(row, next)}
          disabled={toggling}
          aria-label={row.enabled ? `Turn off ${name}` : `Turn on ${name}`}
          data-testid={`${testId}-toggle`}
        />
      }
      onClick={() => onOpen(row)}
      onContextMenu={contextMenu.onContextMenu}
      holdProps={contextMenu.holdProps}
    >
      {contextMenu.menu}
      {contextMenu.swipeAction}
    </KitSettingsRow>
  );
}
