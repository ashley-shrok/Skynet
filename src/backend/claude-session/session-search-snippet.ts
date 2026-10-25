/**
 * Windowed previews for /conversation-search hits.
 *
 * Every hit has already been judged (search-line-judge.ts): it is a bubble the
 * conversation shows, with the words that bubble displays and who it belongs
 * to. This module windows those words around the query for the result row —
 * a short single snippet (the row's fallback) and the multi-passage preview.
 *
 * SECURITY (T-122-06 client-side reflected XSS): every return value is plain
 * text. The frontend MUST render via React text children + `<span>` splits
 * around the match — NEVER `dangerouslySetInnerHTML`. Nothing here emits or
 * escapes markup.
 */

import type { JudgedLine, SearchSpeaker } from "./search-line-judge.js";

const SNIPPET_HALF_WINDOW = 80;
const PASSAGE_HALF_WINDOW = 220;

export interface SnippetResult {
  snippet: string;
  /** Offset of the match inside `snippet`, or -1 when the query isn't in it. */
  hitStart: number;
  hitLength: number;
}

export type SearchPassageSpeaker = SearchSpeaker;

export interface SearchPassage {
  speaker: SearchPassageSpeaker;
  /** Plain text, whitespace-collapsed, windowed ±PASSAGE_HALF_WINDOW around
   *  the first match. The frontend highlights every query occurrence. */
  text: string;
  /** relay only — see JudgedLine. */
  relayFrom?: string | null;
  relayTo?: string | null;
  relayRoom?: string | null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * First case-insensitive match of `query` in `text`. A regex over the ORIGINAL
 * text, not indexOf on a toLowerCase() copy: some characters change length
 * when lowercased (e.g. "İ"), which would shift the window off the match.
 */
export function findQuery(text: string, query: string): { index: number; length: number } | null {
  if (query.length === 0) return null;
  const m = new RegExp(escapeRegExp(query), "iu").exec(text);
  return m === null ? null : { index: m.index, length: m[0].length };
}

function windowAround(
  text: string,
  hit: { index: number; length: number },
  half: number,
): { text: string; hitStart: number } {
  const start = Math.max(0, hit.index - half);
  const end = Math.min(text.length, hit.index + hit.length + half);
  const left = start > 0 ? "…" : "";
  const right = end < text.length ? "…" : "";
  return { text: left + text.slice(start, end) + right, hitStart: hit.index - start + left.length };
}

/** Single ±80-char snippet around the first match in a judged bubble. */
export function snippetForJudged(judged: JudgedLine, query: string): SnippetResult {
  const hit = findQuery(judged.text, query);
  if (hit === null) {
    return { snippet: judged.text.slice(0, SNIPPET_HALF_WINDOW * 2), hitStart: -1, hitLength: 0 };
  }
  const w = windowAround(judged.text, hit, SNIPPET_HALF_WINDOW);
  return { snippet: w.text, hitStart: w.hitStart, hitLength: hit.length };
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** True when the query is in the words a judged bubble displays — compared
 *  with runs of whitespace collapsed on both sides, as the passage shows them. */
export function judgedMatches(judged: JudgedLine, query: string): boolean {
  return findQuery(collapse(judged.text), collapse(query)) !== null;
}

/** Preview passage for a judged bubble, or null when the query isn't in the
 *  words it displays. */
export function passageForJudged(judged: JudgedLine, query: string): SearchPassage | null {
  const text = collapse(judged.text);
  const hit = findQuery(text, collapse(query));
  if (hit === null) return null;
  const passage: SearchPassage = {
    speaker: judged.speaker,
    text: windowAround(text, hit, PASSAGE_HALF_WINDOW).text,
  };
  if (judged.speaker === "relay") {
    passage.relayFrom = judged.relayFrom ?? null;
    passage.relayTo = judged.relayTo ?? null;
    passage.relayRoom = judged.relayRoom ?? null;
  }
  return passage;
}
