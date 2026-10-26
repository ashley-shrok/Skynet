// Which sends came out of the compose box's text area — the only place the
// user types freely, and so the only sends the server checks for blocked
// commands (see src/types/blocked-commands.ts). Everything a button sends
// (Skills menu, thumbs-up, answer tray, Condense, asides) is never marked and
// never checked.
//
// Keyed by the send's message id, which every layer between the composer and
// the WebSocket already carries; the frame builder reads the mark from here
// so a resend after a dropped connection is marked too.

/** "typed" words go back into the box if refused; "spoken" ones are dropped. */
export type TextAreaSendKind = "typed" | "spoken";

// Bounded: entries are only needed until the send has landed or been refused.
const MAX_ENTRIES = 200;
const sends = new Map<string, TextAreaSendKind>();

export function markTextAreaSend(mqid: string, kind: TextAreaSendKind): void {
  sends.delete(mqid);
  sends.set(mqid, kind);
  while (sends.size > MAX_ENTRIES) {
    const oldest = sends.keys().next().value;
    if (oldest === undefined) break;
    sends.delete(oldest);
  }
}

export function textAreaSendKind(mqid: string | undefined): TextAreaSendKind | null {
  if (mqid === undefined) return null;
  return sends.get(mqid) ?? null;
}

/** Test-only: forget every mark. */
export function __resetTextAreaSendsForTests(): void {
  sends.clear();
}
