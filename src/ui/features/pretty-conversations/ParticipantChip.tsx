// Phase 91 Plan 04 — ParticipantChip.tsx
//
// Single participant chip: color swatch + displayName (truncated) + X-remove button.
// Analog: AttachmentChipStrip.tsx L103-193 (chip primitive with X-remove).
//
// Security: displayName is React text-content only — never raw HTML injection
// (T-91-04-T1, shared pattern #1 from PATTERNS.md, T-17-03-01 provenance).

import { X } from "lucide-react";
import { Button } from "@/components/button";
import { cn } from "@/lib/utils";
import type { PickedParticipant } from "./participant-types";

// NEUTRAL_GREY fallback — locked from RelayInboundBubble.tsx:82.
const NEUTRAL_GREY = "hsl(210, 8%, 50%)";

export function ParticipantChip({
  participant,
  onRemove,
}: {
  participant: PickedParticipant;
  onRemove: (mxid: string) => void;
}) {
  // Hue → swatch formula verbatim from RelayInboundBubble.tsx:82.
  // hsl(${colorHue}, 80%, 60%) for resolved hue; NEUTRAL_GREY fallback.
  const swatchColor =
    participant.colorHue !== null
      ? `hsl(${participant.colorHue}, 80%, 60%)`
      : NEUTRAL_GREY;

  return (
    <div
      data-testid="participant-chip"
      data-role={participant.role}
      className={cn(
        "inline-flex items-center gap-2 px-2 py-1 rounded-md text-xs",
        "border shadow-[inset_0_1px_0_rgba(220,225,245,0.05)]",
        "bg-[rgba(10,12,20,0.5)] border-white/10 text-[#e8e4d8]",
      )}
      role="listitem"
    >
      {/* Color swatch — aria-hidden; purely decorative.
          data-swatch-color preserves the HSL string for test assertions
          (jsdom normalizes inline style to RGB). */}
      <span
        aria-hidden
        className="inline-block size-3 rounded-full shrink-0"
        data-swatch-color={swatchColor}
        style={{ background: swatchColor }}
      />
      {/* Display name — truncated; text-content only (no innerHTML) */}
      <span className="max-w-[220px] truncate">{participant.displayName}</span>
      {/* X-remove button */}
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        onClick={() => onRemove(participant.mxid)}
        aria-label={`Remove ${participant.displayName}`}
        title={`Remove ${participant.displayName}`}
        className="ml-1 opacity-70 hover:opacity-100 max-md:opacity-100"
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}
