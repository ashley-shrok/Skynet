/**
 * snippetForHit — Phase 122 Plan 122-02 Task 1.
 *
 * JSON-aware snippet extractor for the /conversation-search endpoint's grep
 * hits. Given a raw JSONL line and the search query, returns a windowed
 * snippet of the humanized text (extracted from `message.content`) with
 * indices identifying where the match starts and ends inside that snippet
 * so the frontend can render a `<span>` highlight without re-scanning.
 *
 * WHY THIS EXISTS:
 *
 * Grep hits inside a JSONL transcript span raw JSON syntax like
 *   `{"parentUuid":"a1b2","type":"user","message":{"content":[{"type":"text","text":"...actual match..."}]}}`
 * Rendering that as-is shows curly braces and quote-marks to the user rather
 * than the readable prose. `snippetForHit` parses the hit line, pulls the
 * `message.content` through `extractText` (the same helper used by every
 * other JSONL consumer in the backend — session-file-parser.ts:150), and
 * windows ±80 chars around the query match inside that extracted text.
 *
 * FAIL-SAFE CONTRACT (Phase 122 RESEARCH.md Pitfall 4):
 *   - JSON.parse throw (malformed line) → first 160 chars of the RAW line
 *     with hitStart=-1, hitLength=0. Degraded, not crashing.
 *   - Query not present in the extracted text (grep matched JSON syntax not
 *     the human text) → first 160 chars of the EXTRACTED text with
 *     hitStart=-1, hitLength=0.
 *   - Otherwise: window ±80 chars around the case-insensitive match, prepend
 *     ellipsis if start > 0, append ellipsis if end < rawText.length,
 *     compute hitStart so the caller can slice(hitStart, hitStart+hitLength)
 *     out of the returned snippet string.
 *
 * SECURITY (T-122-06 client-side reflected XSS): the return value is a plain
 * string. The frontend (plan 03) MUST render via React text children +
 * `<span>` split around hit indices — NEVER via `dangerouslySetInnerHTML`.
 * This module emits no HTML markup and does not escape/encode; it is the
 * frontend's responsibility to render safely.
 */

import { extractText } from "./session-file-parser.js";

const SNIPPET_HALF_WINDOW = 80;
const FALLBACK_SNIPPET_LEN = 160;

/**
 * Return type intentionally matches the frontend contract in the Phase 122
 * RESEARCH.md `## Code Examples` section — `hitStart` and `hitLength` are the
 * substring bounds inside `snippet` (not inside the source text).
 */
export interface SnippetResult {
  snippet: string;
  hitStart: number;
  hitLength: number;
}

/**
 * Extract a windowed snippet around the first case-insensitive match of
 * `query` inside the JSONL line's `message.content` humanized text.
 *
 * @param rawLine — one line of a Claude Code transcript JSONL file.
 * @param query — the search query. Length is bounded by the calling route's
 *   MAX_QUERY_LEN (500) — this function does not re-validate.
 */
export function snippetForHit(rawLine: string, query: string): SnippetResult {
  // Guard: empty query is nonsense here (route short-circuits earlier), but
  // be defensive — an empty query would indexOf-return 0 for every string
  // and produce a snippet with a zero-length "match" at position 0.
  if (query.length === 0) {
    return { snippet: rawLine.slice(0, FALLBACK_SNIPPET_LEN), hitStart: -1, hitLength: 0 };
  }

  // Step 1: parse the JSONL line. On throw, degrade to raw-line snippet.
  let obj: unknown;
  try {
    obj = JSON.parse(rawLine);
  } catch {
    return {
      snippet: rawLine.slice(0, FALLBACK_SNIPPET_LEN),
      hitStart: -1,
      hitLength: 0,
    };
  }

  // Step 2: pull message.content through extractText. Non-user/assistant
  // lines (system, tool_result, etc.) may have message-less shapes — extract
  // returns "" in that case, which we handle uniformly below.
  const content =
    obj !== null && typeof obj === "object"
      ? (obj as { message?: { content?: unknown } }).message?.content
      : undefined;
  const rawText = extractText(content);

  // Step 3: case-insensitive substring search inside the extracted text.
  const idx = rawText.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) {
    return {
      snippet: rawText.slice(0, FALLBACK_SNIPPET_LEN),
      hitStart: -1,
      hitLength: 0,
    };
  }

  // Step 4: window ±SNIPPET_HALF_WINDOW chars around the hit.
  const start = Math.max(0, idx - SNIPPET_HALF_WINDOW);
  const end = Math.min(rawText.length, idx + query.length + SNIPPET_HALF_WINDOW);
  const leftEllipsis = start > 0 ? "…" : "";
  const rightEllipsis = end < rawText.length ? "…" : "";
  const snippet = leftEllipsis + rawText.slice(start, end) + rightEllipsis;

  // Step 5: hitStart is the position of the match INSIDE the snippet string.
  // The match starts at (idx - start) inside the sliced text, shifted right
  // by 1 if we prepended an ellipsis character.
  const hitStart = idx - start + (leftEllipsis.length > 0 ? 1 : 0);
  const hitLength = query.length;

  return { snippet, hitStart, hitLength };
}
