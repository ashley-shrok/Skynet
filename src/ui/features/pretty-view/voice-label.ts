// Voice-mode label (2026-10-18). Hands-free voice mode appends this line to
// every transcript it sends, so the receiving agent knows its reply will be
// read aloud and should be written to be heard. Plain English on purpose: an
// agent that has never been taught the rule still gets the idea. The id skill
// carries the actual rule. User bubbles strip it at render — the session file
// stays faithful, same posture as the attached-files block.
//
// The label can be followed by a heard note (heard-note.ts) in its own
// brackets on the same line; the label itself stays word-for-word, and the
// note never contains square brackets, so the tail match finds both.

export const VOICE_LABEL = "[sent by voice — your reply will be read aloud]";

const VOICE_LABEL_TAIL_RE = /\s*\[sent by voice — your reply will be read aloud\](?: \[[^[\]]*\])?\s*$/;

export function appendVoiceLabel(text: string, heardNote?: string): string {
  const note = heardNote?.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim();
  return `${text}\n\n${VOICE_LABEL}${note ? ` [${note}]` : ""}`;
}

export function stripVoiceLabel(text: string): string {
  return text.replace(VOICE_LABEL_TAIL_RE, "");
}
