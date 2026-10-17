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

import type { ReactNode } from "react";
import { KitCheckbox, KitList, KitListHead, KitListRow } from "@/components/kit";
import { AvatarImage } from "@/components/avatar-image";
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
    <KitList role="listbox" aria-label="Participant picker">
      {/* ─── Humans section ─────────────────────────────────────────── */}
      <SectionHeader
        label="Humans"
        filterActive={filterActive}
        filteredCount={humans.length}
        totalCount={humansTotal}
      />
      {humans.length === 0 ? (
        <EmptyLine>No humans available</EmptyLine>
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
        <EmptyLine>No agents available</EmptyLine>
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
    </KitList>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <div className="text-[13px] text-[var(--k-t3)] px-2.5 py-2">{children}</div>;
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
    <KitListHead role="separator">
      {showCount
        ? `${label} (${filteredCount} of ${totalCount})`
        : label}
    </KitListHead>
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

  // Avatar disc background colour — hsl(${hue}, 60%, 45%) or fallback 210.
  // data-avatar-color attr preserves the HSL string (jsdom converts inline style to RGB).
  const avatarBg = `hsl(${hue ?? 210}, 60%, 45%)`;

  const displayName = participant.displayName;

  return (
    <KitListRow
      role="option"
      aria-selected={selected}
      selected={selected}
      onActivate={() => onToggle(participant.mxid)}
      avatarColor={avatarBg}
      avatar={
        <span
          data-testid="row-avatar-disc"
          data-avatar-color={avatarBg}
          className="contents"
        >
          <AvatarImage src={participant.avatarUrl} name={displayName} />
        </span>
      }
      title={displayName}
      subtitle={
        participant.role === "agent" && participant.subtitle ? (
          <span data-testid="row-subtitle">{participant.subtitle}</span>
        ) : undefined
      }
      trailing={
        // Decorative tick — the row itself is the control.
        <KitCheckbox
          checked={selected}
          onCheckedChange={() => {}}
          readOnly
          tabIndex={-1}
          aria-hidden
          data-testid="check-circle"
          data-selected={selected ? "true" : "false"}
          className="pointer-events-none"
        />
      }
    />
  );
}
