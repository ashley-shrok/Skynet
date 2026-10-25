// Pure helpers behind the tray: starting answers, when a question counts as
// answered, and where a picture or file option loads from.
import { buildSkynetFileUrl, isSkynetFileUrl } from "../file-url";
import type { AskQuestion } from "./ask-format";
import type { QuestionAnswer } from "./answer-format";

export type Draft = QuestionAnswer | null;

/** The starting answer: the order as given, a slider's position, or the agent's default. */
export function initialDraft(q: AskQuestion): Draft {
  if (q.kind === "order") return { kind: "order", ordered: q.options.slice() };
  const d = q.default;
  if (q.kind === "slider") {
    const n = typeof d === "number" ? d : Number(d);
    return { kind: "number", value: d !== undefined && Number.isFinite(n) ? n : q.min ?? 0 };
  }
  if (d === undefined || d === "") return null;
  if (q.kind === "text" || q.kind === "long-text") return { kind: "text", text: String(d) };
  if (q.kind === "date") return /^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? { kind: "date", value: String(d) } : null;
  if (q.kind === "number" || q.kind === "money") {
    const n = typeof d === "number" ? d : Number(String(d).replace(/[,\s$€£¥]/g, ""));
    return Number.isFinite(n) ? { kind: "number", value: n } : null;
  }
  return null;
}

/** A split adds up when its parts reach the total (to a millionth). */
export function splitLeft(total: number, amounts: number[]): number {
  return Math.round((total - amounts.reduce((s, a) => s + a, 0)) * 1e6) / 1e6;
}

export function isAnswered(q: AskQuestion, d: Draft): boolean {
  if (!d) return false;
  switch (d.kind) {
    case "other":
    case "text":
      return d.text.trim().length > 0;
    case "options":
      return d.picked.length > 0;
    case "order":
      return d.ordered.length === q.options.length;
    case "decide":
      return d.decided.length === q.options.length;
    case "number":
      return Number.isFinite(d.value) && (q.min === undefined || d.value >= q.min) && (q.max === undefined || d.value <= q.max);
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(d.value);
    case "split":
      return d.parts.every((p) => Number.isFinite(p.amount) && p.amount >= 0) && splitLeft(q.total ?? 0, d.parts.map((p) => p.amount)) === 0;
  }
}

/** A same-origin URL for a picture or file face: a Skynet file URL, or an absolute path on the agent's host. */
export function faceUrl(ref: string | undefined, hostName?: string): string | null {
  if (!ref) return null;
  if (/^https?:\/\//.test(ref)) return isSkynetFileUrl(ref) ? ref : null;
  if (ref.startsWith("/") && hostName) return buildSkynetFileUrl(hostName, ref);
  return null;
}

