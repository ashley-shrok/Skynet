// Phase 16 Wave 2 (Plan 02) — MicButton component.
//
// Idle-state mic button that lives in the ComposeBox's send-button slot.
// This component renders a single bare-glyph button using the same structural
// template as the ComposeBox send button (ComposeBox.tsx:1503-1554):
//   - absolute right-1 bottom-0.5 positioning (parent provides relative container)
//   - p-2 / max-md:p-3 hit target
//   - warm off-white text with hover and disabled states
//   - transition-[color,transform] + active:scale-95
//
// Aesthetic: bare-glyph per pretty-view visual language (bubble = content,
// bare-glyph = indicator). Uses lucide-react Mic icon.
//
// Plan 03 wires this into ComposeBox.tsx — do NOT modify ComposeBox in this plan.

import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MicButtonProps {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}

export function MicButton({ onClick, disabled, title }: MicButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={title || "Record voice"}
      title={title || "Record voice"}
      className={cn(
        "absolute right-1 bottom-0.5",
        "p-2 max-md:p-3",
        "text-[rgba(240,235,224,0.3)] hover:text-[rgba(240,235,224,0.9)]",
        "disabled:text-[rgba(240,235,224,0.15)]",
        "disabled:cursor-not-allowed",
        "transition-[color,transform] duration-120",
        "active:scale-95",
        "cursor-pointer",
      )}
    >
      <Mic className="size-6 max-md:size-10" aria-hidden="true" />
    </button>
  );
}
