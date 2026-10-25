// The answer the tray sends: an ordinary user message holding a fenced
// ```answer block (YAML) that names the ask, restates each question in full and
// gives the answer — labels for people, `value` for the agent when it differs —
// followed by the note typed in the compose box, if any. Also the one-line
// [tray] notices that tell the agent the user replied in words, or that an
// earlier question was replaced before it was answered. The app draws an
// answer message as an answer bubble and hides the notices.
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Ask, AskOption, AskQuestion } from "./ask-format";

export type QuestionAnswer =
  | { kind: "other"; text: string }
  | { kind: "options"; picked: AskOption[] } // pick-one / pick-several / dropdown
  | { kind: "order"; ordered: AskOption[] }
  | { kind: "decide"; decided: Array<{ item: AskOption; choice: string }> }
  | { kind: "text"; text: string }
  | { kind: "number"; value: number }
  | { kind: "date"; value: string } // YYYY-MM-DD
  | { kind: "split"; parts: Array<{ item: AskOption; amount: number }> };

export const TRAY_NOTICE_PREFIX = "[tray] ";

function titleOf(ask: Ask): string {
  return ask.questions.map((q) => q.question).join(" / ");
}

export function wordsNotice(ask: Ask): string {
  const s = ask.questions.length > 1 ? "s" : "";
  return `${TRAY_NOTICE_PREFIX}I replied in words instead of using the tray for your question${s} "${titleOf(ask)}" (ask ${ask.id}).`;
}

export function replacedNotice(ask: Ask): string {
  return `${TRAY_NOTICE_PREFIX}Your earlier question "${titleOf(ask)}" (ask ${ask.id}) was replaced by a newer one before I answered it.`;
}

/** Leading [tray] notice lines removed — what the user's bubble shows. */
export function stripTrayNotices(content: string): string {
  if (!content.startsWith(TRAY_NOTICE_PREFIX)) return content;
  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].startsWith(TRAY_NOTICE_PREFIX)) i++;
  while (i < lines.length && lines[i].trim() === "") i++;
  return lines.slice(i).join("\n");
}

/** A typed message sent while a question was open: the notices go on top. */
export function withWordsNotice(text: string, open: Ask, replaced: readonly Ask[]): string {
  // Slash commands must stay first on the line or the harness won't run them.
  if (text.trimStart().startsWith("/")) return text;
  const notices = [...replaced.map(replacedNotice), wordsNotice(open)];
  return `${notices.join("\n")}\n\n${text}`;
}

const MONEY_SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", CAD: "$", AUD: "$" };

export function formatMoney(value: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return `${MONEY_SYMBOL[currency] ?? ""}${value.toFixed(2)}`;
  }
}

export function formatNumber(value: number, unit?: string): string {
  return unit ? `${value} ${unit}` : String(value);
}

export function formatDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** The YAML entry for one answered question: answer (people) + value (agent, when different). */
function answerEntry(q: AskQuestion, a: QuestionAnswer): Record<string, unknown> {
  const e: Record<string, unknown> = { question: q.question };
  const sameAll = (opts: AskOption[]) => opts.every((o) => o.value === o.label);
  switch (a.kind) {
    case "other":
      e.answer = a.text;
      e.other = true;
      break;
    case "options": {
      const single = q.kind !== "pick-several";
      e.answer = single ? a.picked[0]?.label ?? "" : a.picked.map((o) => o.label);
      if (!sameAll(a.picked)) e.value = single ? a.picked[0]?.value ?? "" : a.picked.map((o) => o.value);
      break;
    }
    case "order":
      e.answer = a.ordered.map((o) => o.label);
      if (!sameAll(a.ordered)) e.value = a.ordered.map((o) => o.value);
      e.ranked = true;
      break;
    case "decide": {
      const human: Record<string, string> = {};
      const machine: Record<string, string> = {};
      for (const d of a.decided) {
        human[d.item.label] = d.choice;
        machine[d.item.value] = d.choice;
      }
      e.answer = human;
      if (!sameAll(a.decided.map((d) => d.item))) e.value = machine;
      break;
    }
    case "text":
      e.answer = a.text;
      break;
    case "number":
      if (q.kind === "money") {
        e.answer = formatMoney(a.value, q.currency ?? "USD");
        e.value = a.value;
      } else if (q.unit) {
        e.answer = formatNumber(a.value, q.unit);
        e.value = a.value;
      } else {
        e.answer = a.value;
      }
      break;
    case "date":
      e.answer = formatDate(a.value);
      e.value = a.value;
      break;
    case "split": {
      const human: Record<string, number> = {};
      const machine: Record<string, number> = {};
      for (const p of a.parts) {
        human[p.item.label] = p.amount;
        machine[p.item.value] = p.amount;
      }
      e.answer = human;
      if (!sameAll(a.parts.map((p) => p.item))) e.value = machine;
      break;
    }
  }
  return e;
}

export function buildAnswerMessage(
  ask: Ask,
  answers: readonly QuestionAnswer[],
  note: string,
  replaced: readonly Ask[] = [],
): string {
  const doc: Record<string, unknown> = { ask: ask.id };
  if (ask.questions.length === 1) {
    Object.assign(doc, answerEntry(ask.questions[0], answers[0]));
  } else {
    doc.answers = ask.questions.map((q, i) => answerEntry(q, answers[i]));
  }
  const yaml = stringifyYaml(doc, { lineWidth: 0 }).trimEnd();
  const notices = replaced.map(replacedNotice);
  const head = notices.length > 0 ? `${notices.join("\n")}\n\n` : "";
  const tail = note.trim() ? `\n\n${note.trim()}` : "";
  return `${head}\`\`\`answer\n${yaml}\n\`\`\`${tail}`;
}

/** One answered question as the answer bubble shows it. */
export interface AnswerView {
  question: string;
  chips: string[];
  other: boolean;
  ordered: boolean;
}

export interface ParsedAnswerMessage {
  askId: string;
  answers: AnswerView[];
  note: string;
}

const ANSWER_RE = /^```answer[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*(?:\r?\n([\s\S]*))?$/;

function chipsOf(answer: unknown): { chips: string[] } {
  if (Array.isArray(answer)) return { chips: answer.map((x) => String(x)) };
  if (answer && typeof answer === "object") {
    return { chips: Object.entries(answer as Record<string, unknown>).map(([k, v]) => `${k} → ${String(v)}`) };
  }
  if (answer === undefined || answer === null) return { chips: [] };
  return { chips: [String(answer)] };
}

function viewOf(entry: Record<string, unknown>): AnswerView {
  const { chips } = chipsOf(entry.answer);
  return {
    question: typeof entry.question === "string" ? entry.question : "",
    chips,
    other: entry.other === true,
    ordered: entry.ranked === true,
  };
}

/** A user message that is a tray answer, read back for the answer bubble; null otherwise. */
export function parseAnswerMessage(content: string): ParsedAnswerMessage | null {
  const body = stripTrayNotices(content);
  if (!body.startsWith("```answer")) return null;
  const m = ANSWER_RE.exec(body.trimEnd());
  if (!m) return null;
  let doc: unknown;
  try {
    doc = parseYaml(m[1]);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const d = doc as Record<string, unknown>;
  const askId = typeof d.ask === "string" ? d.ask : String(d.ask ?? "");
  const entries = Array.isArray(d.answers) ? d.answers : [d];
  const answers = entries
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object" && !Array.isArray(e))
    .map((e) => viewOf(e));
  if (answers.length === 0) return null;
  return { askId, answers, note: (m[2] ?? "").trim() };
}
