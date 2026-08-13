/**
 * Phase 34 plan 01 — server-side "slash <skill-name> <args>" matcher (pure kernel).
 *
 * Voice-first origin: Ashley dictates via Whisper STT and doesn't want to
 * reach for the "/" key. This module is the pure kernel that lets her say
 * "slash bounty add a banana button" (or "slash gsd quick fix the bug") and
 * the STT route rewrites the wire payload to "/bounty add a banana button"
 * (or "/gsd-quick fix the bug") before returning the transcript to the
 * client. Both endSend (direct-send) and endAppend (into-textarea) paths in
 * `useVoiceRecording.ts` will consume the pre-transformed transcript.
 *
 * This module is the pure matcher — no I/O, no async, no side effects, no
 * runtime imports. The skill catalog is injected as a Set<string>. Plan
 * 34-02 owns the SSH fetcher that produces that Set; plan 34-03 wires the
 * two together at the STT route. Shipping the matcher standalone lets it be
 * truth-table tested exhaustively without any SSH mocking or Express
 * harness.
 *
 * Design invariants (locked from CONTEXT.md § Decisions + § Specific Ideas
 * — do NOT deviate; the WAKE_WORD_REGEX literal below is verbatim from
 * CONTEXT.md § Specific Ideas):
 *
 * - Front-only anchoring (`^\s*`). The "slash <content>" pattern must
 *   appear at the start of the transcript. Mid-message occurrences ("not
 *   slash gsd status") pass through unchanged. This is the primary defense
 *   against accidental rewrites of natural sentences that happen to
 *   contain the word "slash" (e.g. "make a slash to the mesh").
 *
 * - Requires-content clause (`\S.*`). Bare "slash" (or "slash   " with
 *   only trailing whitespace) passes through unchanged with matched:false
 *   — that shape is a probable accidental send, not an intent. Mirrors
 *   the requires-content contract from the retired client-side
 *   composeIntentTransform.ts.
 *
 * - Punctuation-tolerance class `[\s.,;:!?\-]+` — used identically in the
 *   wake-word regex AND in the tokenizer split. Whisper habitually inserts
 *   commas/periods around "slash" ("slash. gsd status", "slash, bounty
 *   add a thing") and between the post-slash words; the class matches all
 *   of those without breaking the transform.
 *
 * - Case-insensitive gate (`i` flag). "SLASH GSD status" and "Slash gsd
 *   status" both hit the gate. Tokens are lowercased before catalog
 *   lookup so the on-disk skill name (which is already kebab-case
 *   lowercase per Claude's convention) is what wins.
 *
 * - Multi-line rest (`s` flag). The `.` in `(\S.*)` crosses newlines so
 *   multi-line content ("slash bounty add a thing\nand more") is
 *   preserved verbatim in the rewritten payload.
 *
 * - Greedy longest-prefix match. For catalog {gsd, gsd-quick} and
 *   transcript "slash gsd quick fix the login bug", the 2-token candidate
 *   "gsd-quick" wins over the 1-token candidate "gsd". This is achieved
 *   by iterating K from `min(tokens.length, MAX_SKILL_WORDS)` DOWN to 1
 *   and breaking on the first hit — the first hit is by construction the
 *   longest one.
 *
 * - MAX_SKILL_WORDS cap (defensive). Real skill names on disk are almost
 *   always ≤3 words; capping the prefix-join at 5 prevents pathological
 *   inputs ("slash a b c d e f g h i j …") from doing O(N) catalog lookups
 *   per STT call.
 *
 * - Verbatim tail preservation. The rewritten string preserves the
 *   post-slash tail EXACTLY as spoken, minus the matched-prefix tokens
 *   and their trailing delimiter run. So "slash gsd quick.  Fix the
 *   login bug" → "/gsd-quick Fix the login bug" — the leading period+
 *   spaces after "quick" are eaten as delimiters, but "Fix" keeps its
 *   uppercase F and any mid-content punctuation carries through.
 *
 * - Passthrough shape. When the wake-word regex misses, or when the
 *   regex hits but no catalog prefix matches, the function returns
 *   `{ transformed: transcript, matched: false, command: null }` — the
 *   caller's payload is byte-identical to the input.
 *
 * - Empty tail. When the matched prefix consumes the entire post-slash
 *   content (e.g. "slash queue" or "slash queue   "), the transformed
 *   output is `"/{command}"` with no trailing space. This mirrors what
 *   the retired client-side transform did at
 *   composeIntentTransform.ts:100–104 (where the doubled-word regex's
 *   `\S.*` clause guaranteed a non-empty rest and the shape was always
 *   `${command} ${rest}`; here we have to guard the empty case
 *   explicitly because the matched prefix may consume the entire post-
 *   slash content).
 *
 * ReDoS note: the wake-word regex uses only a bounded `[\s.,;:!?\-]+`
 *   punctuation class and a single unbounded `.*` inside a capture group
 *   with no nested quantifiers and no backreferences, so catastrophic
 *   backtracking is not a concern on chat-message-sized input. The
 *   tokenizer split uses the same bounded class. Threat surface is
 *   equivalent to the retired composeIntentTransform.ts (STRIDE T-54e-03).
 */

/**
 * Front-anchored, punctuation-tolerant, case-insensitive "slash <content>"
 * wake-word gate. Verbatim from CONTEXT.md § Specific Ideas.
 *
 * Single capture group = the post-slash content (guaranteed non-empty by
 * the `\S.*` clause). Feed that capture into the tokenizer + matcher.
 *
 * See module JSDoc for the full invariant breakdown.
 */
export const WAKE_WORD_REGEX = /^\s*slash[\s.,;:!?\-]+(\S.*)$/is;

/**
 * Defensive cap on the prefix-join length. Real on-disk skill names are
 * almost always ≤3 kebab-cased words; K > 5 would just do wasted catalog
 * lookups on pathological input.
 */
export const MAX_SKILL_WORDS = 5;

/**
 * Result shape returned by `applyServerSlashTransform`. Mirrors the retired
 * client-side `IntentTransformResult` for symmetry between the two
 * transform layers.
 *
 * - `transformed`: the rewritten string (byte-equal to `transcript` on
 *   passthrough).
 * - `matched`: true iff a wake-word HIT was followed by a catalog HIT and
 *   an actual rewrite happened.
 * - `command`: the slash-command that was applied (e.g. "/gsd-quick"), or
 *   null on passthrough.
 */
export interface SlashTransformResult {
  transformed: string;
  matched: boolean;
  command: string | null;
}

/**
 * Same punctuation-tolerance class as the wake-word regex, exposed as a
 * standalone RegExp for tokenizer splitting AND for the verbatim-tail
 * consumer below. Kept local (not exported) — it's an implementation
 * detail of the two-step (regex-gate then tokenize) pipeline.
 */
const DELIMITER_CLASS_SPLIT = /[\s.,;:!?\-]+/;

/**
 * Anchored delimiter-run matcher, used by the verbatim-tail consumer to
 * skip a run of leading delimiters at a specific offset in the original
 * post-slash string. `y` flag = sticky (matches only at `lastIndex`), so
 * we can advance a cursor without allocating substrings.
 */
const DELIMITER_RUN_ANCHORED = /[\s.,;:!?\-]+/y;

/**
 * Anchored non-delimiter-run matcher, used by the verbatim-tail consumer
 * to skip a single token at a specific offset in the original post-slash
 * string. Same `y` flag semantics.
 */
const TOKEN_RUN_ANCHORED = /[^\s.,;:!?\-]+/y;

/**
 * Pure server-side "slash <skill-name> <args>" matcher.
 *
 * 7-step contract (mirrors CONTEXT.md § Decisions § Matcher):
 *
 *   1. Run `WAKE_WORD_REGEX.exec(transcript)`. On null (no wake-word),
 *      return byte-identical passthrough.
 *   2. Extract capture group [1] as `postSlash` — the content after the
 *      wake-word and its trailing delimiter run.
 *   3. Tokenize `postSlash` by splitting on the punctuation-tolerance
 *      class, lowercasing each token, and dropping empties. An empty
 *      token list (unreachable in practice because `\S.*` guarantees at
 *      least one non-whitespace char, but guarded here anyway for
 *      safety) passes through as no-match.
 *   4. Iterate K from `min(tokens.length, MAX_SKILL_WORDS)` DOWN to 1.
 *      Build `candidate = tokens.slice(0, K).join("-")`. On the first K
 *      where `catalog.has(candidate)`, break — greedy longest-prefix
 *      wins by construction.
 *   5. If no K yielded a hit, return byte-identical passthrough.
 *   6. On hit: compute `tail` by walking the ORIGINAL post-slash string
 *      (NOT the lowercased tokens, which would lose capitalization and
 *      mid-content punctuation) — skip the leading delimiter run, then
 *      skip K token-runs each followed by a delimiter run. What remains
 *      from the current cursor position to end-of-string is `tail`.
 *   7. Return `/{candidate}` if `tail` is empty or whitespace-only;
 *      otherwise `/{candidate} {tail}`.
 *
 * Pure function: no I/O, no async, no side effects. Safe to call in any
 * context.
 */
export function applyServerSlashTransform(
  transcript: string,
  catalog: Set<string>,
): SlashTransformResult {
  // Step 1: wake-word gate.
  const match = WAKE_WORD_REGEX.exec(transcript);
  if (!match) {
    return { transformed: transcript, matched: false, command: null };
  }

  // Step 2: extract the post-slash content.
  const postSlash = match[1];

  // Step 3: tokenize + lowercase + drop-empties.
  const tokens = postSlash
    .split(DELIMITER_CLASS_SPLIT)
    .map((s) => s.toLowerCase())
    .filter((s) => s.length > 0);

  if (tokens.length === 0) {
    // Defensive — unreachable in practice given the `\S.*` clause on the
    // wake-word regex, but graceful passthrough on the edge case.
    return { transformed: transcript, matched: false, command: null };
  }

  // Step 4: greedy longest-prefix. Iterate K from largest to smallest;
  // first hit wins by construction.
  const maxK = Math.min(tokens.length, MAX_SKILL_WORDS);
  let matchedK = 0;
  let matchedCandidate = "";
  for (let k = maxK; k >= 1; k--) {
    const candidate = tokens.slice(0, k).join("-");
    if (catalog.has(candidate)) {
      matchedK = k;
      matchedCandidate = candidate;
      break;
    }
  }

  // Step 5: no catalog hit → passthrough.
  if (matchedK === 0) {
    return { transformed: transcript, matched: false, command: null };
  }

  // Step 6: walk the ORIGINAL post-slash string to compute the verbatim
  // tail. We use sticky-flag anchored regexes to advance a cursor
  // without allocating substrings until we snip the final tail.
  //
  // Layout: [delim*] token [delim+ token]{K-1} [delim+] tail
  //         ^cursor moves through this sequence, K token-runs total
  let cursor = 0;

  // Skip leading delimiter run (if any). The wake-word regex already
  // consumed the "slash <delims>" prefix, so postSlash starts with a
  // non-whitespace char (the `\S.*` clause guarantees this). But we run
  // the sticky match anyway to be defensive against any adapter that
  // widens the capture group.
  DELIMITER_RUN_ANCHORED.lastIndex = cursor;
  if (DELIMITER_RUN_ANCHORED.test(postSlash)) {
    cursor = DELIMITER_RUN_ANCHORED.lastIndex;
  }

  // Skip K token-runs each followed by a delimiter run.
  for (let i = 0; i < matchedK; i++) {
    TOKEN_RUN_ANCHORED.lastIndex = cursor;
    if (!TOKEN_RUN_ANCHORED.test(postSlash)) {
      // Defensive — should not happen because tokens.length >= matchedK
      // and we constructed tokens by splitting the same string. If it
      // does, degrade gracefully to passthrough.
      return { transformed: transcript, matched: false, command: null };
    }
    cursor = TOKEN_RUN_ANCHORED.lastIndex;

    // Skip the delimiter run after this token — but only if there is
    // one. On the last token, there may be no trailing delimiter (e.g.
    // "slash queue" — postSlash is "queue", cursor lands at end).
    DELIMITER_RUN_ANCHORED.lastIndex = cursor;
    if (DELIMITER_RUN_ANCHORED.test(postSlash)) {
      cursor = DELIMITER_RUN_ANCHORED.lastIndex;
    }
  }

  const tail = postSlash.slice(cursor);

  // Step 7: assemble output. Empty or whitespace-only tail → no trailing
  // space.
  const commandStr = "/" + matchedCandidate;
  if (tail.length === 0 || /^\s*$/.test(tail)) {
    return { transformed: commandStr, matched: true, command: commandStr };
  }
  return {
    transformed: commandStr + " " + tail,
    matched: true,
    command: commandStr,
  };
}
