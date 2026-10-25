// What an ask leaves in the conversation history: in the agent's bubble a
// quiet "Asked you: …" line where the block was (never controls), and on your
// side an answer bubble — the question quoted small, your choices as chips,
// your note beneath. A block the app can't read shows as plain text.
import { MessageCircleQuestion } from "lucide-react";
import { askSpeech, parseAskBlock } from "./ask-format";
import type { ParsedAnswerMessage } from "./answer-format";
import { SPEAK_SKIP_ATTR } from "../speakable-text";
import "./ask.css";

export function AskMarker({ body }: { body: string }) {
  const res = parseAskBlock(body);
  if (!res.ok) {
    // Unreadable: no tray; show what was asked so it can be answered in words.
    return (
      <div className="pv-ask-fallback" data-testid="ask-fallback">
        {body.replace(/\n$/, "")}
      </div>
    );
  }
  const { questions } = res.ask;
  return (
    <div className="pv-ask-marker" data-testid="ask-marker">
      <MessageCircleQuestion aria-hidden="true" />
      <span>
        <span aria-hidden="true" {...{ [SPEAK_SKIP_ATTR]: "" }}>
          Asked you{questions.length > 1 ? ` ${questions.length} questions` : ""}:{" "}
          <b>{questions.map((q) => q.question).join(" · ")}</b>
        </span>
        {/* Read aloud (speak button, voice mode) hears the whole question. */}
        <span className="sr-only">Asked you: {askSpeech(res.ask)}</span>
      </span>
    </div>
  );
}

export function AnswerBubbleBody({ answer }: { answer: ParsedAnswerMessage }) {
  return (
    <div className="pv-answer" data-testid="answer-bubble">
      {answer.answers.map((a, i) => (
        <div key={i} className="pv-answer-item">
          {a.question && <div className="pv-answer-q">{a.question}</div>}
          <ul className="pv-answer-chips">
            {a.chips.map((c, j) => (
              <li key={j} className="pv-answer-chip">
                {a.ordered && <span className="pv-answer-chip-n">{j + 1}.</span>}
                {c}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {answer.note && <div className="pv-answer-note">{answer.note}</div>}
    </div>
  );
}
