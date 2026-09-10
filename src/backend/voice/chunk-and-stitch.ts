/**
 * Phase 98 plan 02 — Polly chunk-and-stitch (pure kernel).
 *
 * This module is the pure text splitter — no I/O, no async, no side effects,
 * no runtime imports. It's consumed by handleSpeakStream (Phase 98 Plan 06)
 * to keep individual Polly SynthesizeSpeech calls under the 3000-billed-char
 * ceiling (see 98-RESEARCH.md § Pattern 3 + § Pitfall 5).
 *
 * Design invariants (locked from 98-CONTEXT.md § Backend-owned
 * orchestration + 98-RESEARCH.md — do NOT deviate):
 *
 * - CHUNK_MAX_CHARS = 2900. Polly's per-call ceiling is 3000 billed chars;
 *   the 100-char safety margin exists because SSML tags don't count as
 *   billed but plain text does, and if any future planner experiments with
 *   SSML the margin stays useful. Do NOT tune this above 2999 — that
 *   invites `TextLengthExceededException` under edge cases.
 *
 * - Sentence-boundary split via lookbehind regex (`/(?<=[.!?])\s+/`).
 *   Node 12+ has native lookbehind support so this is safe on the backend
 *   runtime. Preserves terminators (the split matches only whitespace
 *   AFTER the terminator, so "Hello." stays as "Hello." not "Hello").
 *
 * - Abbreviation guard is a small hand-curated `ABBREVIATIONS` Set of ~15
 *   common English abbreviations (Mr, Mrs, Ms, Dr, Sr, Jr, Prof, St, Mt,
 *   vs, etc, e.g, i.e, a.m, p.m, U.S, U.K). This is deliberately NOT an
 *   NLP tokenizer — 98-RESEARCH.md § Anti-Patterns forbids pulling in
 *   `sbd` or similar (500KB+ bundle vs a 15-entry Set is sufficient for
 *   chat-message text; not for legal-doc parsing).
 *
 * - Word-boundary fallback in `packChunks` for the edge case where a
 *   single sentence exceeds CHUNK_MAX_CHARS. Splits on whitespace and
 *   greedily fills sub-chunks. Termination guarantee: every word in a
 *   normally-formatted input is < CHUNK_MAX_CHARS, so the loop always
 *   advances and produces at least 1 sub-chunk per over-length sentence.
 *
 * Empty-input contracts (locked from PLAN.md behavior spec):
 *
 * - `splitIntoSentences("")` returns `[]`, NOT `[""]`. Testable.
 * - `packChunks([])` returns `[]`. Testable.
 *
 * This module is pure — no SDK imports, no NLP libs, no async. Safe to
 * import from the /voice/speak-stream handler on hot-path requests.
 */

/**
 * Polly per-call ceiling is 3000 BILLED chars; 2900 leaves a 100-char
 * safety margin. See 98-RESEARCH.md § Pattern 3 lines 388-391 for the
 * rationale on why the margin matters even with plain-text-only input.
 */
export const CHUNK_MAX_CHARS = 2900;

/**
 * Common English abbreviations that end in a period but do NOT terminate
 * a sentence. Kept module-local (not exported) mirroring the constant-
 * privacy convention in `slashCommandTransform.ts`.
 *
 * Adding entries: keep it small. If you find yourself wanting to add > 5
 * new entries, the chat text has drifted into legal/scientific territory
 * and the correct fix is to swap to a real NLP tokenizer — but that's a
 * NEW phase decision, not a silent expansion here.
 */
const ABBREVIATIONS = new Set([
  "Mr",
  "Mrs",
  "Ms",
  "Dr",
  "Sr",
  "Jr",
  "Prof",
  "St",
  "Mt",
  "vs",
  "etc",
  "e.g",
  "i.e",
  "a.m",
  "p.m",
  "U.S",
  "U.K",
]);

/**
 * Split `text` into sentences on `.`, `!`, `?` terminators followed by
 * whitespace. Preserves each sentence's terminator. Guards common English
 * abbreviations (Mr, Mrs, Dr, etc.) so they don't create spurious splits.
 *
 * Contract:
 *   - `splitIntoSentences("")` returns `[]` (NOT `[""]`).
 *   - Single sentence without a terminator returns `[text]`.
 *   - "Dr. Smith went home." returns 1 element ("Dr" in ABBREVIATIONS).
 *   - "Hello.\nWorld." returns 2 elements (newline is whitespace).
 */
export function splitIntoSentences(text: string): string[] {
  if (text.length === 0) return [];

  // Split on terminator followed by whitespace, using lookbehind to
  // preserve the terminator on the LEFT side of the split.
  const parts = text.split(/(?<=[.!?])\s+/);

  // Merge parts where the previous segment ended in a known abbreviation.
  const out: string[] = [];
  for (const part of parts) {
    if (out.length === 0) {
      out.push(part);
      continue;
    }
    const prev = out[out.length - 1];
    // Extract the last word before the terminator to check against ABBREVIATIONS.
    // e.g. "Dr." → lastWord = "Dr"; "Prof. Johnson teaches CS." → lastWord = "CS".
    const lastWord = (prev.match(/(\S+)[.!?]$/)?.[1] ?? "").replace(/\.$/, "");
    if (ABBREVIATIONS.has(lastWord)) {
      out[out.length - 1] = prev + " " + part;
    } else {
      out.push(part);
    }
  }
  return out;
}

/**
 * Greedily pack `sentences` into chunks that stay under `CHUNK_MAX_CHARS`.
 *
 * Contract:
 *   - `packChunks([])` returns `[]`.
 *   - Multiple short sentences pack into a single chunk when the combined
 *     length (with space separators) is ≤ CHUNK_MAX_CHARS.
 *   - When adding the next sentence would exceed CHUNK_MAX_CHARS, the
 *     current chunk is closed and a new chunk starts with that sentence.
 *   - When a SINGLE sentence exceeds CHUNK_MAX_CHARS, it falls back to
 *     word-boundary split producing multiple sub-chunks each ≤
 *     CHUNK_MAX_CHARS. Any in-flight current chunk is closed first.
 *   - Every output chunk satisfies `chunk.length <= CHUNK_MAX_CHARS`.
 */
export function packChunks(sentences: string[]): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > CHUNK_MAX_CHARS) {
      // Over-length single sentence — close in-flight chunk first, then
      // word-boundary fallback split.
      if (current) {
        chunks.push(current);
        current = "";
      }
      const words = sentence.split(/\s+/);
      let sub = "";
      for (const w of words) {
        const separator = sub ? " " : "";
        if ((sub + separator + w).length > CHUNK_MAX_CHARS) {
          if (sub) chunks.push(sub);
          // Defensive: a single word longer than CHUNK_MAX_CHARS would
          // violate the invariant if pushed whole. Hard-slice into cap-
          // sized pieces. Preserves the "every output chunk <= CHUNK_MAX
          // _CHARS" contract even for pathological input (e.g. base64
          // blob glued into a message).
          if (w.length > CHUNK_MAX_CHARS) {
            for (let off = 0; off < w.length; off += CHUNK_MAX_CHARS) {
              chunks.push(w.slice(off, off + CHUNK_MAX_CHARS));
            }
            sub = "";
          } else {
            sub = w;
          }
        } else {
          sub = sub + separator + w;
        }
      }
      if (sub) chunks.push(sub);
      continue;
    }

    const separator = current ? " " : "";
    if ((current + separator + sentence).length > CHUNK_MAX_CHARS) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current + separator + sentence;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
