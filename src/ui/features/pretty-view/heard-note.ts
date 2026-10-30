// Heard note (shape-voice-heard-ordering, 2026-10-29). Every voice-mode send
// tells the agent what the user had actually heard when they spoke: the last
// reply read to them (and whether it was cut off), and any replies that had
// arrived but were never read aloud. The agent may reply again before it sees
// the user's words, so transcript order alone can't say what an answer is
// about. Plain English, so an agent never taught about it still reads it
// right; it rides right after the voice label, which bubbles strip.

/** One agent reply, as voice mode tracks it. */
export interface HeardReply {
  eventId?: string;
  /** The reply as the agent wrote it — what it can find in its own conversation. */
  text: string;
}

export interface HeardState {
  /** The last reply the user heard; `complete` false = cut off partway. */
  last: { reply: HeardReply; complete: boolean } | null;
  /** Replies that arrived but were not read aloud. */
  unheard: readonly HeardReply[];
  /** Earlier replies (before `last`) the user heard only part of. */
  cutOff?: readonly HeardReply[];
}

/** Opening words quoted by default — enough to find the reply. */
export const QUOTE_WORDS = 12;
/** Extend an ambiguous quote by this many words at a time… */
const QUOTE_STEP = 6;
/** …up to this many; past it, position tells identical replies apart. */
export const QUOTE_MAX_WORDS = 40;
/** Replies named per list; the rest are counted, so the note never buries the user's words. */
export const LIST_MAX = 3;

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

export function sameReply(a: HeardReply, b: HeardReply): boolean {
  return a.eventId !== undefined && b.eventId !== undefined ? a.eventId === b.eventId : a.text === b.text;
}

function startsWithWords(text: string[], prefix: string[]): boolean {
  if (text.length < prefix.length) return false;
  return prefix.every((w, i) => text[i] === w);
}

/** Quotes are wrapped in double quotes inside a bracketed note. */
function sanitize(text: string): string {
  return text.replace(/["“”]/g, "'").replace(/\[/g, "(").replace(/\]/g, ")");
}

/**
 * `"opening words…"` for one reply. The quote runs on until no other reply in
 * `replies` (chronological) starts the same way; replies identical that far
 * are told apart by counting back from the latest.
 */
export function quoteReply(reply: HeardReply, replies: readonly HeardReply[]): string {
  const own = words(reply.text);
  const others = replies.filter((r) => !sameReply(r, reply)).map((r) => ({ r, w: words(r.text) }));
  let n = Math.min(QUOTE_WORDS, own.length);
  const clashes = () => others.filter((o) => startsWithWords(o.w, own.slice(0, n)));
  while (n < own.length && n < QUOTE_MAX_WORDS && clashes().length > 0) {
    n = Math.min(n + QUOTE_STEP, own.length, QUOTE_MAX_WORDS);
  }
  const quote = `"${sanitize(own.slice(0, n).join(" "))}${n < own.length ? "…" : ""}"`;
  const clashing = clashes();
  if (clashing.length === 0) return quote;
  // Identical as far as the quote goes: say which one, counting back.
  const idx = replies.findIndex((r) => sameReply(r, reply));
  if (idx < 0) return quote; // not among the replies — no honest position to give
  const newer = clashing.filter((o) => replies.indexOf(o.r) > idx).length;
  const ordinal = ["latest", "second latest", "third latest"][newer] ?? `${newer + 1}th latest`;
  return `${quote} (the ${ordinal} of your replies that start that way)`;
}

function list(quotes: string[]): string {
  if (quotes.length > LIST_MAX) {
    return `${quotes.slice(0, LIST_MAX).join(", ")} and ${quotes.length - LIST_MAX} more`;
  }
  if (quotes.length <= 1) return quotes.join("");
  return `${quotes.slice(0, -1).join(", ")} and ${quotes[quotes.length - 1]}`;
}

/** One copy of each reply, leaving out any in `except`. */
function distinct(replies: readonly HeardReply[], except: readonly HeardReply[]): HeardReply[] {
  return replies.filter(
    (r, i, all) => all.findIndex((x) => sameReply(x, r)) === i && !except.some((x) => sameReply(x, r)),
  );
}

/** The note's sentences — goes in its own brackets right after the voice label. */
export function buildHeardNote(state: HeardState, replies: readonly HeardReply[]): string {
  const parts: string[] = [];
  const { last } = state;
  if (!last) {
    parts.push("None of your replies had been read aloud to the user yet in this voice session.");
  } else if (last.complete) {
    parts.push(`The last of your replies the user had heard was the one starting ${quoteReply(last.reply, replies)}.`);
  } else {
    parts.push(
      `The last of your replies the user heard was the one starting ${quoteReply(last.reply, replies)}, ` +
        "but it was cut off partway, so they may not have heard all of it.",
    );
  }
  const lastOnly = last ? [last.reply] : [];
  const cutOff = distinct(state.cutOff ?? [], lastOnly);
  if (cutOff.length === 1) {
    parts.push(`Before that, they heard only part of your reply starting ${quoteReply(cutOff[0], replies)}.`);
  } else if (cutOff.length > 1) {
    parts.push(`Before that, they heard only part of your replies starting ${list(cutOff.map((r) => quoteReply(r, replies)))}.`);
  }
  // Heard after all (e.g. played with a speak button) beats "not heard".
  const unheard = distinct(state.unheard, [...lastOnly, ...cutOff]);
  if (unheard.length === 1) {
    parts.push(`They had not heard your reply starting ${quoteReply(unheard[0], replies)}; it was not read aloud to them.`);
  } else if (unheard.length > 1) {
    parts.push(
      `They had not heard your replies starting ${list(unheard.map((r) => quoteReply(r, replies)))}; ` +
        "those were not read aloud to them.",
    );
  }
  parts.push("Their words answer what they had heard, which may not be your latest message.");
  return parts.join(" ");
}
