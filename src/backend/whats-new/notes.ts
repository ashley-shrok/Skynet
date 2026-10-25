// What's new — the user-facing notes shown once to each person after an
// instance updates (see whats-new-state.ts for who sees what, and
// src/ui/features/whats-new/ for the pop-up).
//
// Rules for adding a note:
//   - Only for a change an ordinary user would notice. No notes for internal,
//     agent-only or admin-only changes.
//   - One or two short, plain sentences — just what is different. Not a
//     commit message.
//   - The instance owner approves the exact text before it is committed.
//   - Append to the END of the list (the pop-up shows newest first).
//   - `id` is a short lowercase slug (e.g. "unread-marks"), unique and
//     permanent: never reuse, rename or delete an id, and never rewrite a
//     shipped note into something different — people's "seen" records refer
//     to it. notes.test.ts checks ids are unique and the text is short.

export interface WhatsNewNote {
  id: string;
  text: string;
}

export const WHATS_NEW_NOTES: readonly WhatsNewNote[] = [
  {
    id: "voice-send-phrase-over",
    text: "If you've set voice mode to send when you say a phrase: the default phrase is now \"over\" instead of \"send it\". You can change it under Preferences → Voice.",
  },
];
