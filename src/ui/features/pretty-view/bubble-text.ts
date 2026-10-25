// The words a conversation bubble shows, from the message text the session
// file carries. ChatMessage strips the same machinery before it renders; the
// backend conversation search matches against these words so a search hit is
// always something visible in the conversation (shape-search-matches-
// conversation). Pure — no React — so the backend can import it.

import { stripVoiceLabel } from "./voice-label.js";
import {
  parseAnswerMessage,
  stripTrayNotices,
  type ParsedAnswerMessage,
} from "./ask/answer-format.js";
import { lastAskBody, parseAskBlock } from "./ask/ask-format.js";
import { preprocessCommandTriplets } from "./commandTriplets.js";
import { parseInjectedUserTurn } from "../../api/pretty-view-upload-protocol.js";

/** A user message minus what the bubble never shows: the voice-mode label
 *  and the [tray] notices meant for the agent. */
export function userBubbleContent(raw: string): string {
  return stripTrayNotices(stripVoiceLabel(raw));
}

/** An answer bubble's words: the picked choices and the note. The question is
 *  the agent's, found on the agent's own message. */
function answerWords(answer: ParsedAnswerMessage): string {
  const chips = answer.answers.flatMap((a) => a.chips).join(", ");
  return [chips, answer.note].filter((s) => s.length > 0).join("\n\n");
}

const CMD_MARKER_TEXT_RE = /⟨cmd:([^⟩]+)⟩/g;

/** What a user bubble shows, as plain words. */
export function userBubbleText(raw: string): string {
  const content = userBubbleContent(raw);
  const answer = parseAnswerMessage(content);
  if (answer) return answerWords(answer);
  const injected = parseInjectedUserTurn(content);
  if (injected) {
    const captionAnswer = parseAnswerMessage(stripTrayNotices(injected.caption));
    const caption = captionAnswer ? answerWords(captionAnswer) : injected.caption;
    // Files show as chips naming the file, not the path they landed at.
    return [caption, ...injected.files.map((f) => f.filename)]
      .filter((s) => s.length > 0)
      .join("\n");
  }
  // Slash-command tags show as a command pill reading "/name args".
  return preprocessCommandTriplets(content).replace(CMD_MARKER_TEXT_RE, "$1");
}

const ASK_FENCE_RE = /^ {0,3}```[ \t]*ask[ \t]*\r?\n([\s\S]*?)^ {0,3}```[ \t]*$/gm;

/** What an agent bubble shows, as text: the tray's ask block reads as the
 *  "Asked you: …" line the bubble draws in its place. */
export function agentBubbleText(raw: string): string {
  const trayBody = lastAskBody(raw)?.trimEnd() ?? null;
  if (trayBody === null) return raw;
  return raw.replace(ASK_FENCE_RE, (block, body: string) => {
    if (body.trimEnd() !== trayBody) return block;
    const res = parseAskBlock(body);
    return res.ok
      ? `Asked you: ${res.ask.questions.map((q) => q.question).join(" ")}`
      : block;
  });
}
