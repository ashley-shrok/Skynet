// Heard note (shape-voice-heard-ordering, 2026-10-29; heard run,
// shape-voice-heard-run, 2026-11-01). Every voice-mode send tells the agent
// what the user had actually lived through when they spoke: the last few
// replies read to them, with their own messages in between, in the order
// they happened — then that nothing after the last of those had been heard,
// that not heard yet isn't missed, which replies are still waiting to be read,
// and which were skipped or couldn't be played. The agent may reply
// again before it sees the user's words, and a bare "Okay." says nothing of
// its topic, so the run carries the context. Plain English, so an agent never
// taught about it still reads it right; it rides right after the voice label,
// which bubbles strip.

/** One agent reply, as voice mode tracks it. */
export interface HeardReply {
  eventId?: string;
  /** The reply as the agent wrote it — what it can find in its own conversation. */
  text: string;
}

/**
 * One step of what the user lived through this voice session: a reply read to
 * them (`complete` false = cut off partway), or a message they sent.
 */
export type RunEntry =
  | { kind: "heard"; reply: HeardReply; complete: boolean }
  | { kind: "said"; text: string };

export interface HeardState {
  /** Oldest first, in the order the user experienced it. */
  run: readonly RunEntry[];
  /** Replies waiting to be read aloud — the user will still hear them. */
  queued: readonly HeardReply[];
  /** Replies skipped or that couldn't be played — they won't be read aloud. */
  missed: readonly HeardReply[];
}

/** Opening words quoted by default — enough to find the reply. */
export const QUOTE_WORDS = 12;
/** Extend an ambiguous quote by this many words at a time… */
const QUOTE_STEP = 6;
/** …up to this many; past it, position tells identical replies apart. */
export const QUOTE_MAX_WORDS = 40;
/** Replies named per list; the rest are counted, so the note never buries the user's words. */
export const LIST_MAX = 3;
/** Heard replies shown in the run; the user's messages between them come along. */
export const RUN_REPLIES = 3;
/** The user's own messages shown in the run, latest kept — a long string of them would bury their words. */
export const RUN_SAID = 4;

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
  const { quote, position } = quoteParts(reply, replies);
  return position ? `${quote} ${position}` : quote;
}

function quoteParts(
  reply: HeardReply,
  replies: readonly HeardReply[],
): { quote: string; whole: boolean; position?: string } {
  const own = words(reply.text);
  const others = replies.filter((r) => !sameReply(r, reply)).map((r) => ({ r, w: words(r.text) }));
  let n = Math.min(QUOTE_WORDS, own.length);
  const clashes = () => others.filter((o) => startsWithWords(o.w, own.slice(0, n)));
  while (n < own.length && n < QUOTE_MAX_WORDS && clashes().length > 0) {
    n = Math.min(n + QUOTE_STEP, own.length, QUOTE_MAX_WORDS);
  }
  const whole = n >= own.length;
  const quote = `"${sanitize(own.slice(0, n).join(" "))}${whole ? "" : "…"}"`;
  const clashing = clashes();
  if (clashing.length === 0) return { quote, whole };
  // Identical as far as the quote goes: say which one, counting back.
  const idx = replies.findIndex((r) => sameReply(r, reply));
  if (idx < 0) return { quote, whole }; // not among the replies — no honest position to give
  const newer = clashing.filter((o) => replies.indexOf(o.r) > idx).length;
  const ordinal = ["latest", "second latest", "third latest"][newer] ?? `${newer + 1}th latest`;
  // "As of when they spoke": the agent may send another one before it reads this.
  return { quote, whole, position: `(the ${ordinal} of your replies that start that way, as of when they spoke)` };
}

/** `your reply "Okay."` / `your reply starting "On the AI costs…"`. */
function yourReply(reply: HeardReply, replies: readonly HeardReply[]): string {
  const { quote, whole, position } = quoteParts(reply, replies);
  return `your reply ${whole ? "" : "starting "}${quote}${position ? ` ${position}` : ""}`;
}

/** The user's own message, by its opening words. */
function theySaid(text: string): string {
  const w = words(text);
  const n = Math.min(QUOTE_WORDS, w.length);
  return `they said "${sanitize(w.slice(0, n).join(" "))}${n < w.length ? "…" : ""}"`;
}

/**
 * The tail of the run worth showing: from the RUN_REPLIES-th last heard reply
 * on, keeping only the latest RUN_SAID of the user's messages in it.
 */
function trimRun(run: readonly RunEntry[]): RunEntry[] {
  let seen = 0;
  let start = run.findIndex((e) => e.kind === "heard");
  for (let i = run.length - 1; i >= 0; i--) {
    if (run[i].kind === "heard" && ++seen === RUN_REPLIES) {
      start = i;
      break;
    }
  }
  if (start < 0) return [];
  const tail = run.slice(start);
  let said = tail.filter((e) => e.kind === "said").length;
  return tail.filter((e) => e.kind === "heard" || said-- <= RUN_SAID);
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
  const run = trimRun(state.run);
  const heard = run.flatMap((e) => (e.kind === "heard" ? [e] : []));
  // The line is drawn after the newest reply they had heard — a replay of an
  // older one doesn't make later replies they heard unheard.
  const newest = (e: { reply: HeardReply }) => replies.findIndex((r) => sameReply(r, e.reply));
  const last = heard.reduce<(typeof heard)[number] | undefined>(
    (best, e) => (!best || newest(e) >= newest(best) ? e : best),
    undefined,
  );
  if (!last) {
    parts.push(
      "None of your replies had been read aloud to the user yet in this voice session. " +
        "That includes anything you send before you read this.",
    );
  } else {
    const steps = run.map((e) =>
      e.kind === "said"
        ? theySaid(e.text)
        : `${yourReply(e.reply, replies)}${e.complete ? "" : " (cut off partway, so they may not have heard all of it)"}`,
    );
    const joined = steps.map((s, i) => (i === 0 ? s : `then ${s}`)).join("; ");
    const said = run.some((e) => e.kind === "said");
    parts.push(
      `What the user had heard when they spoke${said ? ", with their own messages in between" : ""}` +
        `${steps.length > 1 ? ", oldest first" : ""}: ${joined}.`,
    );
    parts.push(
      `Nothing you sent after ${yourReply(last.reply, replies)} had been heard yet, ` +
        "including anything you send before you read this.",
    );
  }
  // An agent once repeated a reply the user hadn't heard yet but was about to:
  // say plainly that not heard yet isn't missed.
  parts.push(
    "Not heard yet doesn't mean missed: voice mode reads your replies aloud to them in order, " +
      "so ones they haven't heard yet will still reach them. Don't repeat them.",
  );
  // Heard after all (e.g. played with a speak button) beats "not heard".
  const queued = distinct(state.queued, heard.map((e) => e.reply));
  const missed = distinct(state.missed, [...heard.map((e) => e.reply), ...queued]);
  if (queued.length === 1) {
    parts.push(`Your reply starting ${quoteReply(queued[0], replies)} hasn't been read to them yet; it's queued and will be read aloud to them next.`);
  } else if (queued.length > 1) {
    parts.push(
      `Your replies starting ${list(queued.map((r) => quoteReply(r, replies)))} haven't been read to them yet; ` +
        "they're queued and will be read aloud to them next, in order.",
    );
  }
  if (missed.length === 1) {
    parts.push(`Your reply starting ${quoteReply(missed[0], replies)} was skipped or couldn't be played, so it won't be read aloud to them.`);
  } else if (missed.length > 1) {
    parts.push(
      `Your replies starting ${list(missed.map((r) => quoteReply(r, replies)))} were skipped or couldn't be played, ` +
        "so they won't be read aloud to them.",
    );
  }
  parts.push("Their words answer what they had heard, which may not be your latest message.");
  return parts.join(" ");
}
