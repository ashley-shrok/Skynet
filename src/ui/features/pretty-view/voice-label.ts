// Voice-mode label (2026-10-18). Hands-free voice mode appends this line to
// every transcript it sends, so the receiving agent knows its reply will be
// read aloud and should be written to be heard. Plain English on purpose: an
// agent that has never been taught the rule still gets the idea. The id skill
// carries the actual rule. User bubbles strip it at render — the session file
// stays faithful, same posture as the attached-files block.

export const VOICE_LABEL = "[sent by voice — your reply will be read aloud]";

const VOICE_LABEL_TAIL_RE = /\s*\[sent by voice — your reply will be read aloud\]\s*$/;

export function appendVoiceLabel(text: string): string {
  return `${text}\n\n${VOICE_LABEL}`;
}

export function stripVoiceLabel(text: string): string {
  return text.replace(VOICE_LABEL_TAIL_RE, "");
}
