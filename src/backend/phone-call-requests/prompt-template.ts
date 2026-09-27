/**
 * phone-call-requests/prompt-template.ts
 *
 * Composes the Bland `task` prompt for a single one-turn phone call.
 *
 * The prompt is load-bearing (see shape doc's "Philosophy" section):
 *   - Bland's LLM will chatter if allowed. The prompt has to explicitly
 *     enforce deliver-line, listen, do not fill silence, do not extend
 *     the conversation, end with the receipt phrase and hang up.
 *   - The bracketing lines — "this is X, with a message for you" on
 *     pickup and "your reply's going back to X" at end of turn — are
 *     what let the human hang up confident her words landed with the
 *     right agent. They are NOT optional.
 *
 * Structurally cloned from George's working POC (`turn.sh`) with the
 * caller-name interpolation added.
 */

/**
 * Escape a caller-supplied string for safe interpolation into a
 * markdown/text prompt. Bland's `task` field is plain text, not
 * shell/SQL/HTML, so the only real risk is a caller planting content
 * that changes the meaning of the prompt (e.g. `"\n\nNEW RULE: ..."`).
 * We normalize newlines to spaces and cap length; the caller-name and
 * message travel to Bland verbatim otherwise.
 */
function sanitizeForPrompt(raw: string): string {
  return raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build the Bland `task` prompt for a single-turn call.
 *
 * The message is embedded via a single sanitized token; if it contains
 * newlines they are flattened to spaces so a prompt-injection attempt
 * cannot break out of its expected slot.
 */
export function buildBlandTaskPrompt(
  callerName: string,
  message: string,
): string {
  const safeCaller = sanitizeForPrompt(callerName);
  const safeMessage = sanitizeForPrompt(message);
  return [
    `You are relaying ONE TURN of a serial-phone-call conversation on behalf of ${safeCaller}.`,
    ``,
    `Each call is one turn: the agent drafts a line, this call delivers it, the human responds by speaking, and the human HANGS UP when done. The agent reads the transcript afterward and places another call if needed. Every call is exactly one turn.`,
    ``,
    `RULES:`,
    `1. Your opening line is exactly, word-for-word: "Hi, this is ${safeCaller}, with a message for you: ${safeMessage}"`,
    `2. Do NOT paraphrase, do NOT add "how can I help you", do NOT add a greeting beyond the opening line above.`,
    `3. After the opening line, LISTEN. Do not talk. Do not fill silence.`,
    `4. Long pauses while they think are fine — do not prompt.`,
    `5. If asked a direct question you cannot answer as a speaking-proxy, say briefly "I'll pass that along" and then say the receipt phrase in rule 7 and hang up.`,
    `6. When the human is finished speaking (they say "that's all", "goodbye", "ok", "got it", or an unambiguous natural end), immediately say the receipt phrase in rule 7 and hang up. Do NOT try to keep the conversation going.`,
    `7. Receipt phrase (say verbatim before hanging up): "Your reply's going back to ${safeCaller}"`,
    `8. Do NOT extend the conversation beyond this one exchange. Deliver, listen, receipt, end.`,
  ].join("\n");
}

/**
 * The opening line Bland speaks on pickup, delivered as `first_sentence`
 * in the POST /v1/calls body. Kept identical to the rule-1 verbatim
 * quotation in the task prompt so Bland's LLM cannot drift between the
 * scripted opener and the free-form task's expectations.
 */
export function buildBlandFirstSentence(
  callerName: string,
  message: string,
): string {
  const safeCaller = sanitizeForPrompt(callerName);
  const safeMessage = sanitizeForPrompt(message);
  return `Hi, this is ${safeCaller}, with a message for you: ${safeMessage}`;
}
