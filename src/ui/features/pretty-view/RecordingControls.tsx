// Phase 16 Wave 2 (Plan 02) — RecordingControls component.
//
// Three-button recording controls rendered in the ComposeBox send-button slot
// while state === "recording". Replaces the mic button (and later the send button)
// with a horizontal flex row of bare-glyph buttons:
//   [mute (Mic / MicOff)]  [cancel (X)]  [append (ArrowDownToLine)]  [send (Send)]
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
//   mute   → Mic (unmuted) / MicOff (muted, cancel's red tint)
//   cancel → X (strokeWidth=2.25 — matches ComposeBox aside-morph X icon)
//   append → ArrowDownToLine
//   send   → Send
//
// Plan 03 wires this into ComposeBox.tsx — do NOT modify ComposeBox in this plan.

import { ArrowDownToLine, Mic, MicOff, Send, X } from "lucide-react";

export interface RecordingControlsProps {
  onCancel: () => void;
  onAppend: () => void;
  onSend: () => void;
  /** The mic is muted: the recording carries on, hearing silence. */
  muted: boolean;
  onToggleMute: () => void;
}

export function RecordingControls({
  onCancel,
  onAppend,
  onSend,
  muted,
  onToggleMute,
}: RecordingControlsProps) {
  return (
    <div className="absolute right-1 bottom-0.5 flex items-center gap-1">
      {/* Mute — off: neutral like append; on: cancel's red tint */}
      <button
        type="button"
        onClick={onToggleMute}
        aria-label={muted ? "Unmute mic" : "Mute mic"}
        aria-pressed={muted}
        title={muted ? "Unmute mic" : "Mute mic"}
        data-testid="recording-mute"
        className={
          muted
            ? "p-2 text-[hsla(0,72%,72%,0.95)] transition-[color,transform] duration-120 active:scale-95 cursor-pointer"
            : "p-2 text-[#f0ebe0] opacity-60 hover:opacity-95 transition-[opacity,transform] duration-120 active:scale-95 cursor-pointer"
        }
      >
        {muted ? <MicOff className="size-6" aria-hidden="true" /> : <Mic className="size-6" aria-hidden="true" />}
      </button>

      {/* Cancel — red-tinted per pv-danger accent (hsla hue-0 = red) */}
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel recording"
        title="Cancel recording"
        className="p-2 text-[hsla(0,72%,72%,0.85)] hover:text-[hsla(0,80%,82%,1)] transition-[color,transform] duration-120 active:scale-95 cursor-pointer"
      >
        <X className="size-6" strokeWidth={2.25} aria-hidden="true" />
      </button>

      {/* Append — neutral warm off-white */}
      <button
        type="button"
        onClick={onAppend}
        aria-label="Append transcript"
        title="Append transcript"
        className="p-2 text-[#f0ebe0] opacity-60 hover:opacity-95 transition-[opacity,transform] duration-120 active:scale-95 cursor-pointer"
      >
        <ArrowDownToLine className="size-6" aria-hidden="true" />
      </button>

      {/* Send — coral-tinted per pv-coral accent (--color-pv-code-fg = #ffb896) */}
      <button
        type="button"
        onClick={onSend}
        aria-label="Send transcript"
        title="Send transcript"
        className="p-2 text-[color:var(--color-pv-code-fg)] hover:text-[hsla(19,100%,80%,1)] transition-[color,transform] duration-120 active:scale-95 cursor-pointer"
      >
        <Send className="size-6" aria-hidden="true" />
      </button>
    </div>
  );
}
