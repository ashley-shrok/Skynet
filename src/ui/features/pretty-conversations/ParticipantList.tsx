// Phase 91 Plan 04 — ParticipantList.tsx
//
// Sectioned participant picker list (Humans + Agents) with tap-to-toggle
// selection, avatar discs (hue-tinted), keyboard support, and N-of-M counts.
//
// Analog A (avatar disc + --pv-hue emission): PrettyConversationRow.tsx L1083-1089 + L1195-1217
// Analog B (section header structure): 91-PATTERNS.md § ParticipantList.tsx
//
// Security: displayName and subtitle are React text-content only — never raw HTML
// (T-91-04-T1, shared pattern #1 from PATTERNS.md).

import { type CSSProperties } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PickedParticipant } from "./participant-types";

// ─── ParticipantList (public export) ─────────────────────────────────────────

export function ParticipantList({
  humans,
  agents,
  pickedMxids,
  onToggle,
  filterActive = false,
  humansTotal,
  agentsTotal,
}: {
  humans: PickedParticipant[];
  agents: PickedParticipant[];
  pickedMxids: Set<string>;
  onToggle: (mxid: string) => void;
  filterActive?: boolean;
  humansTotal?: number;
  agentsTotal?: number;
}) {
  return (
    <div
      className="flex flex-col overflow-y-auto"
      role="listbox"
      aria-label="Participant picker"
    >
      {/* ─── Humans section ─────────────────────────────────────────── */}
      <SectionHeader
        label="Humans"
        filterActive={filterActive}
        filteredCount={humans.length}
        totalCount={humansTotal}
      />
      {humans.length === 0 ? (
        <div className="text-xs text-[color:var(--color-pv-fg-muted)] italic px-3 py-2">
          No humans available
        </div>
      ) : (
        humans.map((p) => (
          <ParticipantRow
            key={p.mxid}
            participant={p}
            selected={pickedMxids.has(p.mxid)}
            onToggle={onToggle}
          />
        ))
      )}

      {/* ─── Agents section ─────────────────────────────────────────── */}
      <SectionHeader
        label="Agents"
        filterActive={filterActive}
        filteredCount={agents.length}
        totalCount={agentsTotal}
      />
      {agents.length === 0 ? (
        <div className="text-xs text-[color:var(--color-pv-fg-muted)] italic px-3 py-2">
          No agents available
        </div>
      ) : (
        agents.map((p) => (
          <ParticipantRow
            key={p.mxid}
            participant={p}
            selected={pickedMxids.has(p.mxid)}
            onToggle={onToggle}
          />
        ))
      )}
    </div>
  );
}

// ─── SectionHeader (private sub-component) ────────────────────────────────────

function SectionHeader({
  label,
  filterActive,
  filteredCount,
  totalCount,
}: {
  label: string;
  filterActive: boolean;
  filteredCount: number;
  totalCount: number | undefined;
}) {
  const showCount = filterActive && totalCount !== undefined;
  return (
    <div
      role="separator"
      className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)] px-3 pt-3 pb-1"
    >
      {showCount
        ? `${label} (${filteredCount} of ${totalCount})`
        : label}
    </div>
  );
}

// ─── ParticipantRow (private sub-component) ───────────────────────────────────

function ParticipantRow({
  participant,
  selected,
  onToggle,
}: {
  participant: PickedParticipant;
  selected: boolean;
  onToggle: (mxid: string) => void;
}) {
  const hue = participant.colorHue;

  // --pv-hue inline emission per PrettyConversationRow.tsx L1083-1089 pattern.
  const rowStyle: CSSProperties =
    hue !== null ? ({ "--pv-hue": hue } as CSSProperties) : {};

  // Avatar disc background colour — hsl(${hue}, 60%, 45%) or fallback 210.
  // data-avatar-color attr preserves the HSL string (jsdom converts inline style to RGB).
  const avatarBg = `hsl(${hue ?? 210}, 60%, 45%)`;

  const displayName = participant.displayName;
  const initialLetter = displayName.charAt(0).toUpperCase();

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={() => onToggle(participant.mxid)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle(participant.mxid);
        }
      }}
      style={rowStyle}
      className={cn(
        "flex items-center gap-3 px-3 py-2 cursor-pointer",
        "border border-transparent rounded-lg",
        "hover:bg-white/5",
        selected &&
          "bg-[hsla(var(--pv-hue,210),50%,38%,0.20)] border-[hsla(var(--pv-hue,210),65%,55%,0.32)]",
      )}
    >
      {/* Avatar disc — hue-tinted circle with img or initial fallback */}
      <div
        data-testid="row-avatar-disc"
        data-avatar-color={avatarBg}
        className="size-8 rounded-full shrink-0 overflow-hidden"
        style={{ background: avatarBg }}
      >
        {participant.avatarUrl ? (
          <img
            src={participant.avatarUrl}
            alt=""
            className="size-full object-cover"
          />
        ) : (
          <span className="flex items-center justify-center size-full text-sm font-medium text-white">
            {initialLetter}
          </span>
        )}
      </div>

      {/* Body — displayName + optional agent subtitle */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-[#e8e4d8] truncate">{displayName}</div>
        {participant.role === "agent" && participant.subtitle && (
          <div
            data-testid="row-subtitle"
            className="text-xs text-[color:var(--color-pv-fg-muted)] truncate"
          >
            {participant.subtitle}
          </div>
        )}
      </div>

      {/* Check circle — filled emerald when selected, quiet ring when not */}
      <div
        aria-hidden
        data-testid="check-circle"
        data-selected={selected ? "true" : "false"}
        className={cn(
          "size-5 rounded-full border-2 shrink-0 flex items-center justify-center",
          selected
            ? "border-emerald-400 bg-emerald-400"
            : "border-white/20 bg-transparent",
        )}
      >
        {selected && <Check className="size-3 text-black" />}
      </div>
    </div>
  );
}
