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
 *     - kebab button → Edit + Delete popover
 *
 * Row hue: `row.colorHue ?? 190` — from the backend's role-file cascade.
 *
 * Disabled state: `row.enabled === false` applies opacity 0.55 to the row.
 *
 * D-XX preserved verbatim:
 *   D-09: host-chip removal — dropped per tasting; host context lives in
 *         the filter bar when in multi-host mode.
 *   D-11: toggle + kebab stopPropagation so row.onClick (edit entry) does
 *         NOT fire on their clicks.
 *   D-12: two-state visual only. No spinner glyph; parent uses pessimistic
 *         write + inline error banner on failure.
 *   D-13: kebab popover has Edit + Delete only.
 *   D-28: no streaming affordances.
 *
 * Pure presentation — all interactive callbacks are prop callbacks.
 */

import { MoreHorizontal } from "lucide-react";
import type { ScheduledAgentListItem } from "@/api/scheduled-agents-api";

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
  onKebabClick: (row: ScheduledAgentListItem) => void;
  kebabOpen: boolean;
  onEditFromKebab: (row: ScheduledAgentListItem) => void;
  onDeleteFromKebab: (row: ScheduledAgentListItem) => void;
}

export function ScheduledAgentsModalRow({
  row,
  onRowClick,
  onToggleClick,
  onKebabClick,
  kebabOpen,
  onEditFromKebab,
  onDeleteFromKebab,
}: ScheduledAgentsModalRowProps): JSX.Element {
  const hue = row.colorHue ?? FALLBACK_HUE;
  const letter = avatarLetterFor(row);
  const rowClass = row.enabled ? "pv-agent-row" : "pv-agent-row disabled";

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`scheduled-agents-modal-row-${row.slug}`}
      onClick={() => onRowClick(row)}
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
              ? "Disable scheduled agent"
              : "Enable scheduled agent"
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
        <button
          type="button"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={kebabOpen}
          data-testid={`scheduled-agents-modal-row-${row.slug}-kebab`}
          onClick={(e) => {
            e.stopPropagation();
            onKebabClick(row);
          }}
          className="pv-agent-row-kebab"
        >
          <MoreHorizontal size={14} />
        </button>

        {kebabOpen && (
          <div role="menu" className="pv-agent-row-kebab-menu">
            <button
              type="button"
              role="menuitem"
              data-testid={`scheduled-agents-modal-row-${row.slug}-edit`}
              onClick={(e) => {
                e.stopPropagation();
                onEditFromKebab(row);
              }}
              className="pv-agent-row-kebab-item"
            >
              Edit
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid={`scheduled-agents-modal-row-${row.slug}-delete`}
              onClick={(e) => {
                e.stopPropagation();
                onDeleteFromKebab(row);
              }}
              className="pv-agent-row-kebab-item destructive"
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
