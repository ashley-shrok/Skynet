// Phase 135 Plan 135-01 Task 2 — WakeupsModalRow: presentational row for
// the fleet-wide wake-ups list rendered inside WakeupsModal.
//
// Pure presentation: no API calls, no useEffect, no local state writes that
// mutate wake-up data. All interactive callbacks are prop callbacks so the
// parent (WakeupsModal) owns the state machine + pessimistic writes (D-12)
// + delete-confirm (D-14) + list refetch (D-03).
//
// Locked layout (per D-08 + prototype § B + RESEARCH § Chrome Token
// Dictionary):
//   - Line 1: name headline (bold, --color-pv-fg).
//   - Line 2: metadata — scheduleHuman (dim) + host chip (subtle grey-blue,
//             D-09).
//   - Line 3: prompt body (2-line clamp via -webkit-line-clamp, muted).
//   - Line 4: chip row — role chips magenta, skill chips blue (skills only
//             when non-empty; hand-edit-only per Phase 134 D-04).
//   - Right-side actions column: enable toggle + kebab (Edit/Delete
//             popover). Both stopPropagation so their clicks don't bubble
//             to the row body (D-11).
//
// D-28 (no streaming affordances): the toggle is a two-state visual only.
// No lucide spinner glyph, no "flipping..." intermediate — the parent uses
// pessimistic write semantics + inline error banner on failure.

import { MoreHorizontal } from "lucide-react";
import type { WakeupListItem } from "@/api/wakeups-api";

// ---------------------------------------------------------------------------
// Chrome tokens (RESEARCH § Chrome Token Dictionary, verified against
// prototype.html + ConversationSearchModal.tsx)
// ---------------------------------------------------------------------------

const ROLE_CHIP_STYLE = {
  background: "hsla(285, 55%, 55%, 0.14)",
  border: "1px solid hsla(285, 55%, 60%, 0.30)",
  color: "hsla(285, 60%, 82%, 1)",
} as const;

const SKILL_CHIP_STYLE = {
  background: "hsla(200, 55%, 55%, 0.12)",
  border: "1px solid hsla(200, 55%, 60%, 0.28)",
  color: "hsla(200, 60%, 82%, 1)",
} as const;

const HOST_CHIP_STYLE = {
  background: "hsla(220, 25%, 55%, 0.12)",
  border: "1px solid hsla(220, 25%, 60%, 0.24)",
  color: "hsla(220, 30%, 78%, 1)",
} as const;

const CHIP_BASE_CLASS =
  "inline-flex items-center rounded-full px-2 py-[1px] text-[11px] leading-[16px] font-medium";

const ROW_BASE_CLASS =
  "flex flex-row items-start gap-3 px-3 py-3 rounded-[var(--radius-pv-bubble)] outline-none cursor-pointer";

// Two-state toggle styling — pill with a small dot; no spinner (D-28).
function toggleStyle(enabled: boolean): React.CSSProperties {
  return enabled
    ? {
        background: "hsla(220, 65%, 55%, 0.35)",
        border: "1px solid hsla(220, 65%, 60%, 0.55)",
        color: "#f4f1e8",
      }
    : {
        background: "rgba(255, 255, 255, 0.04)",
        border: "1px solid rgba(220, 225, 245, 0.10)",
        color: "var(--color-pv-fg-dim)",
      };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface WakeupsModalRowProps {
  row: WakeupListItem;
  onRowClick: (row: WakeupListItem) => void;
  onToggleClick: (row: WakeupListItem) => void;
  onKebabClick: (row: WakeupListItem) => void;
  kebabOpen: boolean;
  onEditFromKebab: (row: WakeupListItem) => void;
  onDeleteFromKebab: (row: WakeupListItem) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WakeupsModalRow({
  row,
  onRowClick,
  onToggleClick,
  onKebabClick,
  kebabOpen,
  onEditFromKebab,
  onDeleteFromKebab,
}: WakeupsModalRowProps): JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`wakeups-modal-row-${row.slug}`}
      onClick={() => onRowClick(row)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onRowClick(row);
        }
      }}
      className={ROW_BASE_CLASS}
      style={{
        color: "#f0ebe0",
        transition: "background 120ms ease-out, border-color 120ms ease-out",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.04)";
        e.currentTarget.style.boxShadow =
          "inset 0 0 0 1px rgba(220,225,245,0.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {/* ─── Body column (name / meta / prompt / chips) ─────────────── */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {/* Line 1: name headline */}
        <div
          className="text-[14px] font-semibold truncate"
          style={{ color: "#f0ebe0" }}
        >
          {row.name}
        </div>

        {/* Line 2: metadata (scheduleHuman + host chip) */}
        <div className="flex flex-row items-center gap-2 text-[12px]">
          <span style={{ color: "var(--color-pv-fg-dim)" }}>
            {row.scheduleHuman}
          </span>
          <span
            className={CHIP_BASE_CLASS}
            style={HOST_CHIP_STYLE}
            data-testid={`wakeups-modal-row-${row.slug}-host`}
          >
            {row.host}
          </span>
        </div>

        {/* Line 3: prompt body (2-line clamp) */}
        <div
          className="text-[13px]"
          style={{
            color: "var(--color-pv-fg-muted)",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
            overflow: "hidden",
            wordBreak: "break-word",
          }}
        >
          {row.prompt}
        </div>

        {/* Line 4: chip row (roles magenta + skills blue only when
            non-empty; skills exist only when hand-edited on disk per
            Phase 134 D-04 + D-08). */}
        {(row.roles.length > 0 || row.skills.length > 0) && (
          <div className="flex flex-row flex-wrap items-center gap-1.5 mt-0.5">
            {row.roles.map((r) => (
              <span
                key={`role-${r}`}
                className={CHIP_BASE_CLASS}
                style={ROLE_CHIP_STYLE}
              >
                {r}
              </span>
            ))}
            {row.skills.length > 0 &&
              row.skills.map((s) => (
                <span
                  key={`skill-${s}`}
                  className={CHIP_BASE_CLASS}
                  style={SKILL_CHIP_STYLE}
                >
                  {s}
                </span>
              ))}
          </div>
        )}
      </div>

      {/* ─── Actions column (toggle + kebab) ─────────────────────────── */}
      <div className="flex flex-row items-center gap-1 shrink-0 relative">
        {/* Enable toggle — pessimistic per D-12; the parent flips state
            only after server ack. D-11: stopPropagation so the row's
            onClick (edit-mode entry) does NOT fire. */}
        <button
          type="button"
          aria-label={row.enabled ? "Disable wake-up" : "Enable wake-up"}
          title={row.enabled ? "Enabled — click to disable" : "Disabled — click to enable"}
          data-testid={`wakeups-modal-row-${row.slug}-toggle`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleClick(row);
          }}
          className={`px-2 py-1 rounded-full text-[11px] font-medium leading-[14px] transition-colors duration-150 cursor-pointer`}
          style={toggleStyle(row.enabled)}
        >
          {row.enabled ? "On" : "Off"}
        </button>

        {/* Kebab — D-13 menu with Edit + Delete only. D-11: both the
            kebab button and popover items stopPropagation. */}
        <button
          type="button"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={kebabOpen}
          data-testid={`wakeups-modal-row-${row.slug}-kebab`}
          onClick={(e) => {
            e.stopPropagation();
            onKebabClick(row);
          }}
          className="size-7 rounded-full flex items-center justify-center text-[color:var(--color-pv-fg-muted)] hover:text-[#f0ebe0] cursor-pointer transition-colors duration-150"
          style={{
            background: "rgba(255, 255, 255, 0.04)",
            border: "1px solid rgba(220, 225, 245, 0.10)",
          }}
        >
          <MoreHorizontal size={16} />
        </button>

        {kebabOpen && (
          <div
            role="menu"
            className="absolute right-0 top-[calc(100%+4px)] z-10 min-w-[128px] rounded-md py-1 flex flex-col"
            style={{
              background:
                "linear-gradient(160deg, hsla(220, 40%, 22%, 0.94), hsla(220, 40%, 15%, 0.94))",
              border: "1px solid rgba(220, 225, 245, 0.12)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            }}
          >
            <button
              type="button"
              role="menuitem"
              data-testid={`wakeups-modal-row-${row.slug}-edit`}
              onClick={(e) => {
                e.stopPropagation();
                onEditFromKebab(row);
              }}
              className="text-left px-3 py-1.5 text-[13px] cursor-pointer hover:bg-white/5 transition-colors duration-100"
              style={{ color: "#e8e4d8" }}
            >
              Edit
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid={`wakeups-modal-row-${row.slug}-delete`}
              onClick={(e) => {
                e.stopPropagation();
                onDeleteFromKebab(row);
              }}
              className="text-left px-3 py-1.5 text-[13px] cursor-pointer hover:bg-white/5 transition-colors duration-100"
              style={{ color: "hsla(0, 60%, 76%, 1)" }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
