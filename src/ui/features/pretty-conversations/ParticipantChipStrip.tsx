// Phase 91 Plan 04 — ParticipantChipStrip.tsx
//
// Strip wrapper for picked participant chips.
// Analog: AttachmentChipStrip.tsx L52-83 (strip wrapper + ARIA list).
//
// Empty state: renders "No participants selected yet" placeholder text.
// Populated: role='list' with aria-label='Selected participants'.
//
// Security: No raw HTML injection — text-content only (T-91-04-T1).

import { cn } from "@/lib/utils";
import type { PickedParticipant } from "./participant-types";
import { ParticipantChip } from "./ParticipantChip";

export function ParticipantChipStrip({
  picked,
  onRemove,
  className,
}: {
  picked: PickedParticipant[];
  onRemove: (mxid: string) => void;
  className?: string;
}) {
  // Empty state: placeholder text, no role='list' (empty list is not a list)
  if (picked.length === 0) {
    return (
      <div className="text-xs text-[color:var(--color-pv-fg-muted)] italic px-1 py-2">
        No participants selected yet
      </div>
    );
  }

  return (
    <div
      data-testid="participant-chip-strip"
      className={cn("flex flex-wrap gap-2 px-1 py-1", className)}
      role="list"
      aria-label="Selected participants"
    >
      {picked.map((p) => (
        <ParticipantChip key={p.mxid} participant={p} onRemove={onRemove} />
      ))}
    </div>
  );
}
