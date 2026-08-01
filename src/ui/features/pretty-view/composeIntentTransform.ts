/**
 * Quick task 260801-54e — compose intent-transform layer.
 *
 * Voice-first origin: Ashley dictates via Whisper STT and doesn't want to
 * reach for the "/" key (last keystroke-friction in her flow). This module
 * lets her say "bounty bounty add a banana button" and the ComposeBox send
 * pipeline rewrites the wire payload to "/bounty add a banana button" before
 * `onSend(payload)` fires. Whisper habitually inserts commas/periods between
 * doubled words ("Bounty, bounty.") and after the second word ("bounty bounty,")
 * so the regex tolerates punctuation on BOTH sides of the second word.
 *
 * Design invariants (locked from prior scratch/UAT — do NOT deviate):
 *
 * - Front-only anchoring (`^\s*`). The doubled-word pattern must appear at
 *   the start of the message. Mid-message occurrences ("foo bounty bounty add
 *   a thing") pass through unchanged. This is the primary defense against
 *   accidental rewrites of natural sentences and against injection-shaped
 *   input.
 *
 * - Registry gate. Only doubled words present as keys in `INTENT_REGISTRY`
 *   trigger a rewrite. Unknown doubled words ("hello hello world", "no no
 *   do not do that") pass through unchanged. Registry is currently { bounty }
 *   only — per YAGNI and the hard_constraints of the plan, do NOT add more
 *   entries speculatively.
 *
 * - Requires-content contract (`\S.*`). Bare "bounty bounty" (or
 *   "bounty bounty   " with only trailing whitespace) passes through
 *   unchanged — that shape is a probable accidental send, not an intent.
 *
 * - Punctuation-tolerance both sides. The class `[\s.,;:!?\-]+` matches
 *   between the doubled words AND between the second word and the content,
 *   so Whisper-inserted commas/periods do not break the match.
 *
 * - Case-insensitive first word AND backref (`i` flag). Both the initial
 *   `[a-z]+` capture and the `\1` backref honor the `i` flag, so all of
 *   "Bounty bounty", "bounty Bounty", and "BOUNTY BOUNTY" match.
 *
 * - Multi-line rest (`s` flag). The `.` in `(\S.*)` crosses newlines so
 *   multi-line content ("bounty bounty add a thing\nand more") is preserved
 *   verbatim in the rewritten payload.
 *
 * - Letters-only keyword (`[a-z]+` — with the `i` flag). No digits, no
 *   underscores — keyword precision.
 *
 * - Passthrough shape. When there is no regex match, or when the regex
 *   matches but the doubled word is not in `INTENT_REGISTRY`, the function
 *   returns `{ transformed: text, matched: false, command: null }` — the
 *   caller's payload is unchanged.
 *
 * ReDoS note: the regex uses only bounded `[a-z]+` + `\1` backref and a
 *   bounded `[\s.,;:!?\-]+` punctuation class, with no nested quantifiers,
 *   so catastrophic backtracking is not a concern on chat-message-sized
 *   input (threat T-54e-03 in the plan STRIDE register).
 */

/**
 * Registered doubled-word intents. Key is the lowercase doubled word;
 * value is the slash-command it rewrites to. Add new entries here (and add
 * corresponding test cases) when a new voice-first shortcut is desired.
 */
export const INTENT_REGISTRY: Record<string, string> = {
  bounty: "/bounty",
};

/**
 * Front-anchored, punctuation-tolerant, case-insensitive doubled-word regex.
 * See module JSDoc for the invariant breakdown.
 */
const INTENT_TRANSFORM_REGEX = /^\s*([a-z]+)[\s.,;:!?\-]+\1[\s.,;:!?\-]+(\S.*)$/is;

/**
 * Result shape returned by `applyIntentTransform`.
 * - `transformed`: the rewritten string (equals the input on passthrough).
 * - `matched`: true iff a registry-gated rewrite actually happened.
 * - `command`: the slash-command that was applied (e.g. "/bounty"), or null
 *   on passthrough.
 */
export interface IntentTransformResult {
  transformed: string;
  matched: boolean;
  command: string | null;
}

/**
 * Rewrite a message payload if it starts with a doubled INTENT_REGISTRY word.
 * See module JSDoc for the design invariants.
 */
export function applyIntentTransform(text: string): IntentTransformResult {
  const match = INTENT_TRANSFORM_REGEX.exec(text);
  if (!match) {
    return { transformed: text, matched: false, command: null };
  }
  const key = match[1].toLowerCase();
  const rest = match[2];
  const command = INTENT_REGISTRY[key];
  if (!command) {
    // Registry gate: doubled word exists but is not registered — passthrough.
    return { transformed: text, matched: false, command: null };
  }
  return {
    transformed: `${command} ${rest}`,
    matched: true,
    command,
  };
}
