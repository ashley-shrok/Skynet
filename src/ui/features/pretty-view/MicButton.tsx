// Phase 16 Wave 2 (Plan 02) — MicButton component.
//
// The mic button in the ComposeBox control row: a round conversation.css
// .pv-cbtn beside Send. Uses lucide-react Mic icon.

import type React from "react";
import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MicButtonProps {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  /**
   * Optional pointer handlers — supplied by ComposeBox to wire the
   * useHoldToRecord hook onto the MicButton (Quick 260814-1hz). onPointerUp
   * accepts a Promise return so the hook's async release path type-checks
   * verbatim.
   */
  onPointerDown?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerMove?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp?: (e: React.PointerEvent<HTMLButtonElement>) => void | Promise<void>;
  onPointerCancel?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerLeave?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  /**
   * When defined, emits `data-hold-active={dataHoldActive ? "true" : "false"}`
   * on the rendered button. When undefined the attribute is omitted entirely
   * so pre-260814-1hz zero-arg callers get byte-identical DOM output.
   */
  dataHoldActive?: boolean;
  /**
   * Committed-hold ring around the button: "recording" (red, breathing) while
   * a release would send, "outside" (grey) once slid off so a release would
   * cancel. Undefined = no ring.
   */
  holdRing?: "recording" | "outside";
}

export function MicButton({
  onClick,
  disabled,
  title,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  dataHoldActive,
  holdRing,
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
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerLeave}
      disabled={disabled}
      aria-label="Record voice"
      title={title || "Record voice"}
      {...(dataHoldActive !== undefined
        ? { "data-hold-active": dataHoldActive ? "true" : "false" }
        : {})}
      data-holding={holdRing === "recording" ? "true" : undefined}
      className="pv-cbtn select-none touch-none [-webkit-touch-callout:none]"
    >
      {holdRing && (
        <span
          aria-hidden="true"
          data-testid="mic-hold-ring"
          className={cn("pv-hold-ring", holdRing === "outside" && "pv-hold-ring-outside")}
        />
      )}
      <Mic aria-hidden="true" />
    </button>
  );
}
