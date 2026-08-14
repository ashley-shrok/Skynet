// Phase 16 Wave 2 (Plan 02) — MicButton component.
//
// Idle-state mic button that lives in the ComposeBox's send-button slot.
// This component renders a single bare-glyph button using the same structural
// template as the ComposeBox send button (ComposeBox.tsx:1503-1554):
//   - absolute positioning (parent provides relative container); position tokens
//     are caller-controlled via the optional `positionClass` prop with a
//     backward-compat default of "right-1 bottom-0.5" (so zero-argument callers
//     get byte-identical output to the pre-260729-3y1 implementation).
//   - p-2 hit target (mobile scale handled globally via html font-size bump — patch #163)
//   - warm off-white text with hover and disabled states
//   - transition-[color,transform] + active:scale-95
//
// Aesthetic: bare-glyph per pretty-view visual language (bubble = content,
// bare-glyph = indicator). Uses lucide-react Mic icon.
//
// Quick 260729-3y1: `positionClass` prop added so ComposeBox can co-render
// MicButton at "right-11 bottom-0.5" (one 40px hit-target width left of the
// send anchor) alongside the send button, instead of the prior swap-in-single-
// slot pattern. Default preserves the original anchor for backward compat.

import type React from "react";
import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MicButtonProps {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  /**
   * Position tokens applied alongside `absolute`. Defaults to "right-1 bottom-0.5"
   * (the historical anchor). ComposeBox passes "right-11 bottom-0.5" so the mic
   * sits ~40px left of the send-button anchor (one p-2 hit-target width away).
   */
  positionClass?: string;
  /**
   * Optional pointer handlers — supplied by ComposeBox to wire the
   * useHoldToRecord hook onto the MicButton (Quick 260814-1hz). onPointerUp
   * accepts a Promise return so the hook's async release path type-checks
   * verbatim.
   */
  onPointerDown?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp?: (e: React.PointerEvent<HTMLButtonElement>) => void | Promise<void>;
  onPointerCancel?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerLeave?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  /**
   * When defined, emits `data-hold-active={dataHoldActive ? "true" : "false"}`
   * on the rendered button. When undefined the attribute is omitted entirely
   * so pre-260814-1hz zero-arg callers get byte-identical DOM output.
   */
  dataHoldActive?: boolean;
}

export function MicButton({
  onClick,
  disabled,
  title,
  positionClass = "right-1 bottom-0.5",
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  dataHoldActive,
}: MicButtonProps) {
  // quick-260814-iwy Bug 1 fix: wrap onPointerDown with e.preventDefault() so
  // the browser's native long-press gesture layer (iOS Safari callout menu,
  // magnifier, quick-note) is suppressed at the pointerdown seam. Guarded on
  // `onPointerDown defined && !disabled` so zero-arg / disabled callers see
  // byte-identical DOM output (no wrapper attached, no preventDefault side
  // effect on the disabled button). Paired with the `[-webkit-touch-callout:
  // none]` Tailwind class below (belt-and-suspenders — the class suppresses
  // the callout DOM surface; preventDefault suppresses the native gesture).
  const wrappedPointerDown =
    onPointerDown && disabled !== true
      ? (e: React.PointerEvent<HTMLButtonElement>) => {
          e.preventDefault();
          onPointerDown(e);
        }
      : onPointerDown;
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={wrappedPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerLeave}
      disabled={disabled}
      aria-label={title || "Record voice"}
      title={title || "Record voice"}
      {...(dataHoldActive !== undefined
        ? { "data-hold-active": dataHoldActive ? "true" : "false" }
        : {})}
      className={cn(
        "absolute",
        positionClass,
        "p-2",
        "select-none",
        "touch-none",
        // quick-260814-iwy Bug 1 fix (iOS Safari): suppress the native
        // long-press callout / magnifier / quick-note gesture surface at the
        // CSS layer. Sits alongside select-none + touch-none so all three
        // native long-press suppression utilities are grouped. Without this,
        // iOS Safari fires pointercancel mid-hold when the callout appears,
        // which the useHoldToRecord hook correctly routes to voice.cancel()
        // — audibly cancelling Ashley's hold-to-record attempt.
        "[-webkit-touch-callout:none]",
        "text-[rgba(240,235,224,0.3)] hover:text-[rgba(240,235,224,0.9)]",
        "disabled:text-[rgba(240,235,224,0.15)]",
        "disabled:cursor-not-allowed",
        "transition-[color,transform] duration-120",
        "active:scale-95",
        "cursor-pointer",
      )}
    >
      <Mic className="size-6" aria-hidden="true" />
    </button>
  );
}
