/**
 * Speak-a-file helpers for the file viewer's speak button.
 *
 * Only prose files get the button — hearing JSON or source code read aloud
 * is noise. Markdown is spoken as the text it reads as (no `#`, `**`, link
 * URLs or code blocks). Text longer than one speak request allows is split
 * into pieces that play back to back.
 *
 * The voice is the user's fallback voice (Preferences → Agent voices), not
 * any identity's: files aren't tied to the agent that shared them. AppShell
 * pushes it in via setFileSpeakVoice, same pattern as setTtsPlaybackRate.
 */

const PROSE_EXTENSIONS = new Set(["md", "markdown", "txt", "text"]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);

/**
 * Per-request character cap for the pieces. The server rejects text over
 * SPEAK_TEXT_MAX (25000, routes/voice.ts); stay well under it.
 */
export const FILE_SPEAK_PIECE_MAX = 20000;

let fileSpeakVoice: string | null = null;

export function setFileSpeakVoice(voice: string | null | undefined): void {
  fileSpeakVoice = typeof voice === "string" && voice.length > 0 ? voice : null;
}

/** Voice candidates for a file: the fallback voice, else [] (provider default). */
export function fileSpeakVoices(): string[] {
  return fileSpeakVoice ? [fileSpeakVoice] : [];
}

function extOf(filename: string): string {
  const base = filename.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function isSpeakableFile(filename: string): boolean {
  return PROSE_EXTENSIONS.has(extOf(filename));
}

/** Markdown → the plain text a reader hears. Best-effort, line-oriented. */
export function markdownToSpeech(md: string): string {
  let s = md.replace(/\r\n?/g, "\n");
  // Frontmatter block at the very top.
  s = s.replace(/^---\n[\s\S]*?\n---\n/, "");
  // Fenced code blocks (at any indent, e.g. under a list item) and HTML
  // comments are skipped entirely; an unclosed fence runs to the end.
  s = s.replace(
    /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(^[ \t]*\1[^\n]*$|(?![\s\S]))/gm,
    "",
  );
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  // Images drop; links keep their text (inline, reference); URLs drop.
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  s = s.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");
  s = s.replace(/^[ \t]*\[[^\]]+\]:\s*\S+.*$/gm, "");
  s = s.replace(/<https?:\/\/[^>]+>/g, "");
  s = s.replace(/\bhttps?:\/\/[^\s)>\]]+/g, "");
  // Remaining HTML tags (lowercase names only, so prose like <T> survives).
  s = s.replace(/<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/g, "");
  // Horizontal rules and setext underlines — before list stripping, which
  // would otherwise eat the first "- " of "- - -".
  s = s.replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, "");
  s = s.replace(/^[ \t]*=+[ \t]*$/gm, "");
  // Block markers: headings (a period marks the pause unless the heading
  // already ends in punctuation), blockquotes, list bullets, task boxes.
  s = s.replace(
    /^[ \t]{0,3}#{1,6}[ \t]+(.*?)[ \t]*#*[ \t]*$/gm,
    (_m, h: string) => (/[.!?:;]$/.test(h) ? h : `${h}.`),
  );
  s = s.replace(/^[ \t]*>\s?/gm, "");
  s = s.replace(/^[ \t]*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, "");
  // Table separator rows drop; table pipes become pauses.
  s = s.replace(
    /^[ \t]*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-*:?\s*\|?[ \t]*(?:\n|$)/gm,
    "",
  );
  s = s.replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_m, row: string) =>
    row
      .split("|")
      .map((c) => c.trim())
      .join(", "),
  );
  // Inline code spans keep their text verbatim: set aside before the
  // emphasis passes so `__init__` / `*args` aren't stripped, restored after.
  const spans: string[] = [];
  s = s.replace(
    /`([^`\n]+)`/g,
    (_m, code: string) => `\u0000${spans.push(code) - 1}\u0000`,
  );
  // Emphasis / strikethrough markers. Underscore emphasis only at word
  // edges, so snake_case stays intact.
  s = s.replace(/\*\*(.+?)\*\*/g, "$1");
  s = s.replace(/(^|[^\w_])__(?=\S)(.+?)__(?![\w_])/g, "$1$2");
  s = s.replace(/(^|[^\w*])\*(?=\S)([^*\n]+?)\*(?![\w*])/g, "$1$2");
  s = s.replace(/(^|[^\w_])_(?=\S)([^_\n]+?)_(?![\w_])/g, "$1$2");
  s = s.replace(/~~(.+?)~~/g, "$1");
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => spans[Number(i)]);
  // Collapse leftover blank runs.
  s = s.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** The text to speak for a file's content. */
export function fileSpeechText(filename: string, content: string): string {
  return MARKDOWN_EXTENSIONS.has(extOf(filename))
    ? markdownToSpeech(content)
    : content.trim();
}

/**
 * Split text into pieces of at most `max` chars, breaking at the last
 * paragraph break, else sentence end, else whitespace before the cap.
 */
export function splitForSpeech(
  text: string,
  max = FILE_SPEAK_PIECE_MAX,
): string[] {
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf("\n\n");
    if (cut < max / 2) {
      cut = -1;
      for (let i = window.length - 2; i >= max / 2; i--) {
        if (/[.!?]/.test(window[i]) && /\s/.test(window[i + 1])) {
          cut = i + 1;
          break;
        }
      }
    }
    if (cut < max / 2) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = max;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length > 0) pieces.push(rest);
  return pieces;
}
