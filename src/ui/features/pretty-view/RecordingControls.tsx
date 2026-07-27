// Phase 16 Wave 2 (Plan 02) — RecordingControls component.
//
// Three-button recording controls rendered in the ComposeBox send-button slot
// while state === "recording". Replaces the mic button (and later the send button)
// with a horizontal flex row of three bare-glyph buttons:
//   [cancel (X)]  [append (ArrowDownToLine)]  [send (Send)]
//
// Positioned in the same slot as the mic/send button using absolute positioning
// (parent ComposeBox provides the relative container). Each button uses the same
// p-2 hit target and size-6 icon as MicButton.
//
// Palette (per src/ui/index.css:117-146 pv-palette tokens + prototype colors):
//   cancel: hsla(0, 72%, 72%, 0.85) — red-tint (hue 0, matches prototype's --pv-danger)
//   append: rgba(240, 235, 224, 0.6) — neutral warm off-white
//   send:   var(--color-pv-code-fg) — coral #ffb896 (from src/ui/index.css:129)
//
// Icons (all lucide-react):
//   cancel → X (strokeWidth=2.25 — matches ComposeBox aside-morph X icon)
//   append → ArrowDownToLine
//   send   → Send
//
// Plan 03 wires this into ComposeBox.tsx — do NOT modify ComposeBox in this plan.

import { ArrowDownToLine, Send, X } from "lucide-react";

export interface RecordingControlsProps {
  onCancel: () => void;
  onAppend: () => void;
  onSend: () => void;
}

export function RecordingControls({
  onCancel,
  onAppend,
  onSend,
}: RecordingControlsProps) {
  return (
    <div className="absolute right-1 bottom-0.5 flex items-center gap-1">
      {/* Cancel — red-tinted per pv-danger accent (hsla hue-0 = red) */}
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel recording"
        title="Cancel recording"
        className="p-2 max-md:p-3 text-[hsla(0,72%,72%,0.85)] hover:text-[hsla(0,80%,82%,1)] transition-[color,transform] duration-120 active:scale-95 cursor-pointer"
      >
        <X className="size-6 max-md:size-10" strokeWidth={2.25} aria-hidden="true" />
      </button>

      {/* Append — neutral warm off-white */}
      <button
        type="button"
        onClick={onAppend}
        aria-label="Append transcript"
        title="Append transcript"
        className="p-2 max-md:p-3 text-[rgba(240,235,224,0.6)] hover:text-[rgba(240,235,224,0.95)] transition-[color,transform] duration-120 active:scale-95 cursor-pointer"
      >
        <ArrowDownToLine className="size-6 max-md:size-10" aria-hidden="true" />
      </button>

      {/* Send — coral-tinted per pv-coral accent (--color-pv-code-fg = #ffb896) */}
      <button
        type="button"
        onClick={onSend}
        aria-label="Send transcript"
        title="Send transcript"
        className="p-2 max-md:p-3 text-[color:var(--color-pv-code-fg)] hover:text-[hsla(19,100%,80%,1)] transition-[color,transform] duration-120 active:scale-95 cursor-pointer"
      >
        <Send className="size-6 max-md:size-10" aria-hidden="true" />
      </button>
    </div>
  );
}
