/**
 * ScheduledAgentsModalRow — presentational row for the fleet-wide
 * scheduled-agents list. Modal-unification 2026-09-29 anatomy per
 * .planning/design/modal-tasting.html § scheduled-agents.
 *
 * Layout:
 *   avatar-sm (32px hue-tinted, first letter of first-role uppercased)
 *   body-column
 *     - Line 1: row.name (schedule name alone, NO role prefix)
 *     - Line 2: row.scheduleHuman (muted)
 *     - Line 3: row.prompt (2-line clamp)
 *     - Line 4: role chip (magenta) + skill chips (blue, only when non-empty)
 *   top-right actions bar (aligned with the name baseline):
 *     - toggle pill (row.enabled, pessimistic — parent flips on server ack)
 *     - RowKebabMenu → Edit + Delete popover
 *
 * Row hue: `row.colorHue ?? 190` — from the backend's role-file cascade.
 *
 * Disabled state: `row.enabled === false` applies opacity 0.55 to the row.
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
import { RowKebabMenu, useRowKebabContextMenu, type RowKebabMenuItem } from "./RowKebabMenu";
import {
  formatAbsolute,
  formatRelativeFuture,
  formatRelativePast,
} from "./scheduled-agents-time-fmt";

const FALLBACK_HUE = 190;

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
  const rowClass = row.enabled ? "pv-agent-row" : "pv-agent-row disabled";
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

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`scheduled-agents-modal-row-${row.slug}`}
      onClick={() => onRowClick(row)}
      onContextMenu={kebabContextMenu.onContextMenu}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onRowClick(row);
        }
      }}
      className={rowClass}
      style={{ ["--pv-agent-row-hue" as string]: String(hue) }}
    >
      <div className="pv-agent-row-avatar" aria-hidden="true">
        {letter}
      </div>

      <div className="pv-agent-row-body">
        <div className="pv-agent-row-name">{prettifyScheduledAgentName(row.name)}</div>
        <div className="pv-agent-row-sub">{row.scheduleHuman}</div>
        {(row.lastFiredAt !== null || row.nextFireAt !== null) && (() => {
          const nowSecs = Math.floor(Date.now() / 1000);
          const hasLast = row.lastFiredAt !== null;
          const hasNext = row.nextFireAt !== null;
          return (
            <div className="pv-agent-row-runs">
              {hasLast && (
                <span title={formatAbsolute(row.lastFiredAt!, nowSecs)}>
                  Last: {formatRelativePast(row.lastFiredAt!, nowSecs)}
                </span>
              )}
              {hasLast && hasNext && <span className="pv-agent-row-runs-dot">·</span>}
              {hasNext && (
                <span title={formatAbsolute(row.nextFireAt!, nowSecs)}>
                  Next: {formatRelativeFuture(row.nextFireAt!, nowSecs)}
                </span>
              )}
            </div>
          );
        })()}
        <div className="pv-agent-row-prompt">{row.prompt}</div>
        {(row.roles.length > 0 || row.skills.length > 0) && (
          <div className="pv-agent-row-chips">
            {row.roles.map((r) => (
              <span key={`role-${r}`} className="pv-agent-row-chip role">
                {r}
              </span>
            ))}
            {row.skills.map((s) => (
              <span key={`skill-${s}`} className="pv-agent-row-chip skill">
                {s}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="pv-agent-row-actions" style={{ position: "relative" }}>
        <button
          type="button"
          aria-label={
            row.enabled
              ? "Disable scheduled task"
              : "Enable scheduled task"
          }
          title={
            row.enabled ? "Enabled — click to disable" : "Disabled — click to enable"
          }
          data-testid={`scheduled-agents-modal-row-${row.slug}-toggle`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleClick(row);
          }}
          className={
            row.enabled
              ? "pv-agent-row-toggle on"
              : "pv-agent-row-toggle"
          }
        />
        {/* D-29: shared RowKebabMenu — Run now + Edit + Delete items. The component
            owns its own open state (Radix) and stop-propagation discipline
            (D-14 revised 2026-10-01), so no `kebabOpen`/`onKebabClick`
            threading is needed from the parent anymore. testId overridden
            to preserve the existing scheduled-agents namespacing. */}
        <RowKebabMenu
          items={kebabItems}
          ariaLabel="More actions"
          testId={`scheduled-agents-modal-row-${row.slug}-kebab`}
        />
        {kebabContextMenu.menu}
      </div>
    </div>
  );
}
