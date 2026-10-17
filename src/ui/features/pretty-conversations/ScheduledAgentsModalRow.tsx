/**
 * ScheduledAgentsModalRow — presentational row for the fleet-wide
 * scheduled-agents list. Modal-unification 2026-09-29 anatomy per
 * .planning/design/modal-tasting.html § scheduled-agents.
 *
 * Layout (apple-ux kit, 2026-10-16): one KitListRow.
 *   avatar — hue-tinted disc, first letter of first-role uppercased
 *   title — row.name (schedule name alone, NO role prefix)
 *   subtitle (wraps)
 *     - row.scheduleHuman, or the sensor line (status as a KitChip)
 *     - Last / Next run times
 *     - row.prompt (2-line clamp)
 *     - role chips (KitChip)
 *   trailing — KitSwitch (row.enabled, pessimistic — parent flips on ack)
 *   menu — RowKebabMenu → Run now + Edit + Delete
 *
 * Row hue: `row.colorHue ?? 190` — from the backend's role-file cascade.
 *
 * Disabled state: `row.enabled === false` renders the row dimmed.
 *
 * D-XX preserved verbatim:
 *   D-09: host-chip removal — dropped per tasting; host context lives in
 *         the filter bar when in multi-host mode.
 *   D-11: toggle + kebab stopPropagation so row.onClick (edit entry) does
 *         NOT fire on their clicks. (Kebab stop-prop now lives inside the
 *         shared RowKebabMenu — see D-14 there.)
 *   D-12: two-state visual only. No spinner glyph; parent uses pessimistic
 *         write + inline error banner on failure.
 *   D-13: kebab popover has Edit + Delete only.
 *   D-28: no streaming affordances.
 *   D-29 (2026-10-01, UAT item 3): kebab replaced with the shared
 *         `RowKebabMenu` so every kebab in the app looks the same — same
 *         trigger, same menu surface, same cursor affordance. Props
 *         `kebabOpen` and `onKebabClick` dropped; the shared component
 *         owns its own open-state via Radix.
 *
 * Pure presentation — all interactive callbacks are prop callbacks.
 */

import type { ScheduledAgentListItem } from "@/api/scheduled-agents-api";
import { KitChip, KitListRow, KitSwitch } from "@/components/kit";
import { RowKebabMenu, useRowKebabContextMenu, type RowKebabMenuItem } from "./RowKebabMenu";
import {
  formatAbsolute,
  formatRelativeFuture,
  formatRelativePast,
} from "./scheduled-agents-time-fmt";
import { SENSOR_MARK, SensorStateChip } from "@/features/pretty-view/SensorStatusView";
import { isOnceSensorSchedule } from "@/features/pretty-view/WakeupFormShared";

const FALLBACK_HUE = 190;

/** Sensor state → kit chip tone. Off / not live stay calm (neutral). */
/** Render-only de-slug. Hyphens/underscores → spaces, capitalize first char.
 *  Kept in sync with `_prettify_name` in substrate/scripts/wakeup-scheduler.py
 *  (the ⏰ task-prefix on scheduled-agent-spawned identities). */
export function prettifyScheduledAgentName(name: string): string {
  const spaced = name.replace(/[-_]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function avatarLetterFor(row: ScheduledAgentListItem): string {
  const firstRole = row.roles[0];
  if (typeof firstRole === "string" && firstRole.length > 0) {
    return firstRole.charAt(0).toUpperCase();
  }
  // Fallback to the row's schedule name if no roles are declared.
  return row.name.charAt(0).toUpperCase() || "?";
}

export interface ScheduledAgentsModalRowProps {
  row: ScheduledAgentListItem;
  onRowClick: (row: ScheduledAgentListItem) => void;
  onToggleClick: (row: ScheduledAgentListItem) => void;
  onEditFromKebab: (row: ScheduledAgentListItem) => void;
  onDeleteFromKebab: (row: ScheduledAgentListItem) => void;
  /** Fire once now, outside the schedule. Hidden for one_shot specs (firing
   *  one early would consume it) — the server rejects those too. */
  onRunNowFromKebab: (row: ScheduledAgentListItem) => void;
  /** True while a run-now request for this row is in flight. */
  runNowPending?: boolean;
}

const Dot = () => <span className="mx-1.5 opacity-55">·</span>;

/** "📡 Sensor · <status chip> · Last fired … · N waiting" — the row line for
 *  a sensor-triggered task (sensors shape 2: no Next). */
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
        {typeof lastFiredAt === "number"
          ? `Last fired ${formatRelativePast(lastFiredAt, nowSecs)}`
          : "Never fired"}
      </span>
      {sensor.waitingFires > 0 && (
        <>
          <Dot />
          <span data-testid={`${testId}-waiting`}>{`${sensor.waitingFires} waiting`}</span>
        </>
      )}
    </span>
  );
}

export function ScheduledAgentsModalRow({
  row,
  onRowClick,
  onToggleClick,
  onEditFromKebab,
  onDeleteFromKebab,
  onRunNowFromKebab,
  runNowPending = false,
}: ScheduledAgentsModalRowProps): JSX.Element {
  const isOneShot =
    (row.schedule as { type?: unknown } | null)?.type === "one_shot";
  const hue = row.colorHue ?? FALLBACK_HUE;
  const letter = avatarLetterFor(row);
  const kebabItems: RowKebabMenuItem[] = [
    ...(isOneShot
      ? []
      : [
          {
            label: runNowPending ? "Starting…" : "Run now",
            disabled: runNowPending,
            onClick: () => onRunNowFromKebab(row),
            testId: `scheduled-agents-modal-row-${row.slug}-run-now`,
          },
        ]),
    {
      label: "Edit",
      onClick: () => onEditFromKebab(row),
      testId: `scheduled-agents-modal-row-${row.slug}-edit`,
    },
    {
      label: "Delete",
      danger: true,
      onClick: () => onDeleteFromKebab(row),
      testId: `scheduled-agents-modal-row-${row.slug}-delete`,
    },
  ];
  // Right-click the row → same kebab menu at the cursor.
  const kebabContextMenu = useRowKebabContextMenu(kebabItems);

  const nowSecs = Math.floor(Date.now() / 1000);
  const hasLast = row.lastFiredAt !== null;
  const hasNext = row.nextFireAt !== null;

  const subtitle = (
    <>
      <span className="block">
        {row.sensor ? (
          <SensorLine
            row={row as ScheduledAgentListItem & { sensor: NonNullable<ScheduledAgentListItem["sensor"]> }}
            testId={`scheduled-agents-modal-row-${row.slug}-sensor`}
          />
        ) : (
          row.scheduleHuman
        )}
      </span>
      {!row.sensor && (hasLast || hasNext) && (
        <span className="block">
          {hasLast && (
            <span title={formatAbsolute(row.lastFiredAt!, nowSecs)}>
              Last: {formatRelativePast(row.lastFiredAt!, nowSecs)}
            </span>
          )}
          {hasLast && hasNext && <Dot />}
          {hasNext && (
            <span title={formatAbsolute(row.nextFireAt!, nowSecs)}>
              Next: {formatRelativeFuture(row.nextFireAt!, nowSecs)}
            </span>
          )}
        </span>
      )}
      <span className="mt-0.5 text-[var(--k-t2)] line-clamp-2 break-words">{row.prompt}</span>
      {row.roles.length > 0 && (
        <span className="flex flex-wrap gap-1.5 mt-1.5">
          {row.roles.map((r) => (
            <KitChip key={`role-${r}`}>{r}</KitChip>
          ))}
        </span>
      )}
    </>
  );

  return (
    <KitListRow
      data-testid={`scheduled-agents-modal-row-${row.slug}`}
      onActivate={() => onRowClick(row)}
      onContextMenu={kebabContextMenu.onContextMenu}
      avatar={letter}
      avatarColor={`hsl(${hue}, 42%, 40%)`}
      title={prettifyScheduledAgentName(row.name)}
      subtitle={subtitle}
      wrapSubtitle
      dim={!row.enabled}
      className="items-start"
      trailing={
        <>
          <KitSwitch
            checked={row.enabled}
            onCheckedChange={() => onToggleClick(row)}
            aria-label={row.enabled ? "Disable scheduled task" : "Enable scheduled task"}
            title={row.enabled ? "Enabled — click to disable" : "Disabled — click to enable"}
            data-testid={`scheduled-agents-modal-row-${row.slug}-toggle`}
          />
          {kebabContextMenu.menu}
        </>
      }
      menu={
        <RowKebabMenu
          items={kebabItems}
          ariaLabel="More actions"
          testId={`scheduled-agents-modal-row-${row.slug}-kebab`}
        />
      }
    />
  );
}
