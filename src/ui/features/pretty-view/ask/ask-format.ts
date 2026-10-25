// The ask block an agent writes in its reply: a fenced ```ask block holding
// YAML. One block holds one to four questions; the app draws them in the tray
// above the compose box (shape-interactive-responses). Parsing is strict about
// structure (an unreadable block gets no tray — the bubble shows it as plain
// text) and lenient about spelling (option shorthand, kind aliases).
import { parse as parseYaml } from "yaml";

export type AskKind =
  | "pick-one"
  | "pick-several"
  | "order"
  | "decide"
  | "text"
  | "long-text"
  | "number"
  | "money"
  | "date"
  | "dropdown"
  | "slider"
  | "split";

export const ASK_KINDS: readonly AskKind[] = [
  "pick-one", "pick-several", "order", "decide",
  "text", "long-text", "number", "money", "date", "dropdown", "slider", "split",
];

export type AskLayout = "list" | "grid" | "week";

export interface AskOption {
  label: string;
  /** What the agent gets back; defaults to the label. */
  value: string;
  description?: string;
  recommended?: boolean;
  /** Option faces — at most one is meaningful; color wins over image over file. */
  color?: string;
  image?: string;
  file?: string;
  /** Week layout: local date-time "YYYY-MM-DDTHH:MM". */
  time?: string;
}

export interface AskQuestion {
  /** 0-based position in the ask. */
  index: number;
  question: string;
  /** Short tab label in a several-question ask. */
  header: string;
  kind: AskKind;
  layout: AskLayout;
  /** pick-one / pick-several / dropdown options; order / decide / split items. */
  options: AskOption[];
  /** decide: the labels each item gets (2–4). */
  choices: string[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  currency?: string;
  /** split: what the parts must add up to. */
  total?: number;
  placeholder?: string;
  default?: string | number;
}

export interface Ask {
  /** The agent's id for the ask; derived from the question text when absent. */
  id: string;
  questions: AskQuestion[];
}

export type AskParseResult = { ok: true; ask: Ask; error?: undefined } | { ok: false; error: string; ask?: undefined };

export const MAX_QUESTIONS = 4;
export const MAX_OPTIONS = 24;

const KIND_ALIASES: Record<string, AskKind> = {
  one: "pick-one", "pick one": "pick-one", pick: "pick-one", single: "pick-one", "yes-no": "pick-one", yesno: "pick-one",
  several: "pick-several", "pick several": "pick-several", multi: "pick-several", multiple: "pick-several", many: "pick-several",
  rank: "order", ranking: "order", "put in order": "order",
  triage: "decide", "decide each": "decide",
  "short-text": "text", string: "text",
  longtext: "long-text", "long text": "long-text", draft: "long-text", textarea: "long-text",
  currency: "money",
  select: "dropdown",
  range: "slider",
  "must-sum": "split", allocate: "split",
};

function normKind(raw: unknown): AskKind | null {
  if (raw === undefined || raw === null) return null;
  const k = String(raw).trim().toLowerCase();
  if ((ASK_KINDS as readonly string[]).includes(k)) return k as AskKind;
  return KIND_ALIASES[k] ?? null;
}

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/** "Label | description" shorthand, or a mapping. */
function parseOption(raw: unknown, where: string): AskOption {
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    const s = String(raw);
    const bar = s.indexOf(" | ");
    const label = (bar >= 0 ? s.slice(0, bar) : s).trim();
    const description = bar >= 0 ? s.slice(bar + 3).trim() : undefined;
    if (!label) throw new Error(`${where}: empty option`);
    const rec = /\s*\((recommended)\)\s*$/i;
    const recommended = rec.test(label);
    const clean = label.replace(rec, "").trim();
    return { label: clean, value: clean, description: description || undefined, recommended: recommended || undefined };
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const time = str(o.time);
    const label = str(o.label) ?? str(o.name) ?? str(o.text) ?? (time ? formatSlot(time) : undefined) ?? str(o.value);
    if (!label) throw new Error(`${where}: an option has no label`);
    if (time !== undefined && !SLOT_RE.test(time)) throw new Error(`${where}: time "${time}" is not YYYY-MM-DDTHH:MM`);
    return {
      label,
      value: str(o.value) ?? (time ?? label),
      description: (str(o.description) ?? str(o.detail)) || undefined,
      recommended: o.recommended === true || undefined,
      color: str(o.color) ?? str(o.colour),
      image: str(o.image),
      file: str(o.file),
      time,
    };
  }
  throw new Error(`${where}: an option must be text or a mapping`);
}

const SLOT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** "2026-10-27T14:00" → "Tue Oct 27, 2:00 PM" (local, no timezone shift). */
export function formatSlot(time: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(time);
  if (!m) return time;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return `${day}, ${formatSlotTime(time)}`;
}

export function formatSlotTime(time: string): string {
  const m = /T(\d{2}):(\d{2})$/.exec(time);
  if (!m) return time;
  const h = Number(m[1]);
  const mm = m[2];
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${h < 12 ? "AM" : "PM"}`;
}

function optionList(raw: unknown, where: string): AskOption[] {
  if (!Array.isArray(raw)) throw new Error(`${where}: options must be a list`);
  if (raw.length > MAX_OPTIONS) throw new Error(`${where}: at most ${MAX_OPTIONS} options`);
  const opts = raw.map((r, i) => parseOption(r, `${where} option ${i + 1}`));
  const seen = new Set<string>();
  for (const o of opts) {
    if (seen.has(o.value)) throw new Error(`${where}: two options share "${o.value}"`);
    seen.add(o.value);
  }
  return opts;
}

function parseQuestion(raw: unknown, index: number, multi: boolean): AskQuestion {
  const where = multi ? `question ${index + 1}` : "the question";
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${where} must be a mapping`);
  const q = raw as Record<string, unknown>;
  const question = str(q.question) ?? str(q.q) ?? str(q.ask);
  if (!question) throw new Error(`${where} has no question text`);
  const explicitKind = q.kind ?? q.type ?? q.pick;
  let kind = normKind(explicitKind);
  if (explicitKind !== undefined && !kind) throw new Error(`${where}: unknown kind "${String(explicitKind)}"`);

  // yes/no shorthand: `yes: Delete them` / `no: Not now`.
  const yes = str(q.yes);
  const no = str(q.no);
  let options: AskOption[] = [];
  const rawOptions = q.options ?? q.items ?? q.parts;
  if (rawOptions !== undefined) options = optionList(rawOptions, where);
  else if (yes !== undefined || no !== undefined || String(explicitKind ?? "").toLowerCase().replace(/[\s_]/g, "-") === "yes-no") {
    options = [
      { label: yes ?? "Yes", value: "yes" },
      { label: no ?? "No", value: "no" },
    ];
  }
  if (!kind) kind = options.length > 0 ? "pick-one" : "text";

  const layoutRaw = str(q.layout)?.toLowerCase();
  let layout: AskLayout = "list";
  if (layoutRaw === "grid" || layoutRaw === "week") layout = layoutRaw;
  else if (layoutRaw !== undefined && layoutRaw !== "list") throw new Error(`${where}: unknown layout "${layoutRaw}"`);
  else if (options.length > 0 && options.every((o) => o.time)) layout = "week";

  const choices = Array.isArray(q.choices) ? q.choices.map((c) => str(c) ?? "").filter(Boolean) : [];

  const needsOptions = kind === "pick-one" || kind === "pick-several" || kind === "dropdown";
  const needsItems = kind === "order" || kind === "decide" || kind === "split";
  if (needsOptions && options.length < 2) throw new Error(`${where}: needs at least two options`);
  if (needsItems && options.length < 2) throw new Error(`${where}: needs at least two items`);
  if (kind === "decide" && (choices.length < 2 || choices.length > 4)) throw new Error(`${where}: decide needs two to four choices`);
  if (layout === "week" && !options.every((o) => o.time)) throw new Error(`${where}: every option in a week layout needs a time`);

  const total = num(q.total);
  if (kind === "split" && total === undefined) throw new Error(`${where}: split needs a total`);

  const header = str(q.header) ?? str(q.tab) ?? shortHeader(question);
  return {
    index,
    question,
    header,
    kind,
    layout,
    options,
    choices,
    min: num(q.min),
    max: num(q.max),
    step: num(q.step),
    unit: str(q.unit),
    currency: str(q.currency)?.toUpperCase(),
    total,
    placeholder: str(q.placeholder),
    default: typeof q.default === "number" ? q.default : str(q.default),
  };
}

function shortHeader(question: string): string {
  const words = question.replace(/[?.!:]+$/, "").split(/\s+/);
  return words.length <= 3 ? words.join(" ") : `${words.slice(0, 3).join(" ")}…`;
}

/** Short, stable id from the question text when the agent gave none. */
export function deriveAskId(questions: { question: string }[]): string {
  const text = questions.map((q) => q.question).join("\n");
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `q-${h.toString(36)}`;
}

export function parseAskBlock(body: string): AskParseResult {
  let doc: unknown;
  try {
    doc = parseYaml(body);
  } catch (e) {
    return { ok: false, error: `not readable YAML: ${(e as Error).message.split("\n")[0]}` };
  }
  try {
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("the block must be a mapping");
    const d = doc as Record<string, unknown>;
    let questions: AskQuestion[];
    if (Array.isArray(d.questions)) {
      if (d.questions.length < 1) throw new Error("questions is empty");
      if (d.questions.length > MAX_QUESTIONS) throw new Error(`at most ${MAX_QUESTIONS} questions`);
      const multi = d.questions.length > 1;
      questions = d.questions.map((q, i) => parseQuestion(q, i, multi));
    } else {
      questions = [parseQuestion(d, 0, false)];
    }
    const id = str(d.id) || deriveAskId(questions);
    return { ok: true, ask: { id, questions } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Every ```ask fenced block in a markdown message, in order (bodies only). */
export function findAskBlocks(markdown: string): string[] {
  const out: string[] = [];
  const re = /^ {0,3}(`{3,}|~{3,})[ \t]*ask[ \t]*\r?\n([\s\S]*?)^ {0,3}\1[ \t]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) out.push(m[2]);
  return out;
}

/** The message's last readable ask, or null (no block, or the last one is unreadable). */
export function lastAskIn(markdown: string): Ask | null {
  if (!markdown.includes("ask")) return null;
  const blocks = findAskBlocks(markdown);
  if (blocks.length === 0) return null;
  const res = parseAskBlock(blocks[blocks.length - 1]);
  return res.ok ? res.ask : null;
}

/** What voice mode and read-aloud say for an ask. */
export function askSpeech(ask: Ask): string {
  return ask.questions
    .map((q) => {
      const opts = q.options.map((o) => o.label);
      if (q.kind === "decide") return `${q.question} For each of ${listWords(opts)}: ${listWords(q.choices, "or")}.`;
      if (q.kind === "order") return `${q.question} Put in order: ${listWords(opts)}.`;
      if (q.kind === "split") return `${q.question} Split ${q.total} across ${listWords(opts)}.`;
      if (opts.length > 0 && opts.length <= 8) return `${q.question} ${listWords(opts, "or")}.`;
      return q.question;
    })
    .join(" ");
}

function listWords(words: string[], joiner = "and"): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")}, ${joiner} ${words[words.length - 1]}`;
}
