/**
 * TouchDesktopButtons — the touch-mode switch and the keyboard button for a
 * remote desktop's bar. Touch screens only; the caller decides that.
 *
 * Both buttons act on the finger's lift (touchend) and cancel what the
 * browser would do next: no focus moves (so the phone keyboard stays up
 * while switching modes), and no click follows — Safari doesn't send one
 * after a prevented press anyway. Acting inside the touch's own handler is
 * also the only place a phone lets a page raise its keyboard. A mouse
 * click does the same.
 */

import type { ReactElement, TouchEvent as ReactTouchEvent } from "react";
import { Keyboard, MousePointer2, Pointer } from "lucide-react";
import { setTouchMode, useTouchMode } from "./touch-mode";

export function TouchDesktopButtons({
  showModeSwitch,
  onToggleKeyboard,
  buttonClassName,
  buttonAttrs,
  testIdPrefix,
}: {
  /** Telnet has no mouse — only the keyboard button. */
  showModeSwitch: boolean;
  onToggleKeyboard: () => void;
  buttonClassName: string;
  /** Extra attributes for each button (e.g. a kit button's data-variant). */
  buttonAttrs?: Record<string, string>;
  testIdPrefix: string;
}): ReactElement {
  const mode = useTouchMode();
  const onLift = (action: () => void) => (e: ReactTouchEvent) => {
    e.preventDefault();
    action();
  };
  const switchMode = () => setTouchMode(next);
  const next = mode === "trackpad" ? "direct" : "trackpad";
  const modeLabel =
    mode === "trackpad"
      ? "Trackpad mode — tap to switch to direct (tap where you click)"
      : "Direct mode — tap to switch to trackpad (slide a cursor)";
  return (
    <>
      {showModeSwitch && (
        <button
          type="button"
          data-testid={`${testIdPrefix}-touch-mode`}
          data-mode={mode}
          aria-label={modeLabel}
          title={modeLabel}
          draggable={false}
          onPointerDown={(e) => e.preventDefault()}
          onTouchEnd={onLift(switchMode)}
          onClick={switchMode}
          className={buttonClassName}
          {...buttonAttrs}
        >
          {mode === "trackpad" ? (
            <MousePointer2 width={14} height={14} aria-hidden="true" />
          ) : (
            <Pointer width={14} height={14} aria-hidden="true" />
          )}
        </button>
      )}
      <button
        type="button"
        data-testid={`${testIdPrefix}-keyboard`}
        aria-label="Keyboard"
        title="Show or hide the keyboard"
        draggable={false}
        onPointerDown={(e) => e.preventDefault()}
        onTouchEnd={onLift(onToggleKeyboard)}
        onClick={onToggleKeyboard}
        className={buttonClassName}
        {...buttonAttrs}
      >
        <Keyboard width={14} height={14} aria-hidden="true" />
      </button>
    </>
  );
}
