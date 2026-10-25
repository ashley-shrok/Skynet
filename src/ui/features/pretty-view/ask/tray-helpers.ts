// Pure helpers behind the tray: starting answers, when a question counts as
// answered, and where a picture or file option loads from.
import { buildSkynetFileUrl, isSkynetFileUrl } from "../file-url";
import type { AskQuestion } from "./ask-format";
import type { QuestionAnswer } from "./answer-format";

export type Draft = QuestionAnswer | null;

/** The starting answer for kinds that always have one (order, slider). */
export function initialDraft(q: AskQuestion): Draft {
  if (q.kind === "order") return { kind: "order", ordered: q.options.slice() };
  if (q.kind === "slider") {
    const min = q.min ?? 0;
    const d = typeof q.default === "number" ? q.default : Number(q.default);
    return { kind: "number", value: Number.isFinite(d) ? d : min };
  }
  return null;
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
      return Math.abs(d.parts.reduce((s, p) => s + p.amount, 0) - (q.total ?? 0)) < 1e-9;
  }
}

/** A same-origin URL for a picture or file face: a Skynet file URL, or an absolute path on the agent's host. */
export function faceUrl(ref: string | undefined, hostName?: string): string | null {
  if (!ref) return null;
  if (/^https?:\/\//.test(ref)) return isSkynetFileUrl(ref) ? ref : null;
  if (ref.startsWith("/") && hostName) return buildSkynetFileUrl(hostName, ref);
  return null;
}

