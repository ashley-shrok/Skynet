// Enter-to-submit for single-line inputs in simple dialogs (type a name →
// press Enter). Ignores Enter while an IME composition is in progress (e.g.
// confirming a Japanese candidate) and when the dialog can't submit yet.
// keyCode 229: older Safari ends a composition with an Enter that doesn't
// report isComposing.

import type { KeyboardEvent } from "react";

export function submitOnEnter(canSubmit: boolean, submit: () => void) {
  return (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    if (canSubmit) submit();
  };
}
