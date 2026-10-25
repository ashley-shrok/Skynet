// The tray above the compose box: the agent's open question, answered by tap,
// tick, order or fill-in (shape-interactive-responses). The app owns how each
// kind looks and behaves; the agent supplies only the content. Answering hands
// the finished answers to the compose box, which adds the typed note and sends
// an ordinary message. Look: ask.css.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, FileText, MessageCircleQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import { fileNameOfPath } from "../file-url";
import { faceUrl, initialDraft, isAnswered, splitLeft, type Draft } from "./tray-helpers";
import { formatSlotTime, type Ask, type AskOption, type AskQuestion } from "./ask-format";
import { formatMoney, type QuestionAnswer } from "./answer-format";
import type { OpenAsk } from "./open-ask";
import "./ask.css";

export interface AskTrayProps {
  open: OpenAsk;
  /** Target host, for picture and file option faces given as paths. */
  hostName?: string;
  /** Answers complete: the compose box adds the note and sends. */
  onAnswer: (ask: Ask, answers: QuestionAnswer[]) => void;
  /** Open a file option in the file window. */
  onOpenFile?: (url: string, filename: string) => void;
  disabled?: boolean;
}

export function AskTray({ open, hostName, onAnswer, onOpenFile, disabled }: AskTrayProps) {
  const { ask } = open;
  const multi = ask.questions.length > 1;
  const [drafts, setDrafts] = useState<Draft[]>(() => ask.questions.map(initialDraft));
  const [tab, setTab] = useState(0);
  // A collapse is remembered until the next question; a new one arrives open.
  const [collapsedFor, setCollapsedFor] = useState<string | null>(null);
  const collapsed = collapsedFor === open.eventId;

  // New ask (or a different message carrying one): fresh drafts, first tab.
  const askKey = `${open.eventId}:${ask.id}`;
  const lastKey = useRef(askKey);
  useEffect(() => {
    if (lastKey.current === askKey) return;
    lastKey.current = askKey;
    setDrafts(ask.questions.map(initialDraft));
    setTab(0);
  }, [askKey, ask.questions]);

  const allAnswered = ask.questions.every((q, i) => isAnswered(q, drafts[i]));
  const q = ask.questions[Math.min(tab, ask.questions.length - 1)];
  const draft = drafts[q.index] ?? null;
  // One plain pick-one question answers on tap — no Send needed.
  const tapToSend = !multi && (q.kind === "pick-one");

  function setDraft(i: number, d: Draft) {
    setDrafts((prev) => prev.map((x, j) => (j === i ? d : x)));
  }

  function send(ds: Draft[]) {
    if (disabled) return;
    if (!ask.questions.every((qq, i) => isAnswered(qq, ds[i]))) return;
    onAnswer(ask, ds as QuestionAnswer[]);
  }

  function pickOne(option: AskOption) {
    const d: Draft = { kind: "options", picked: [option] };
    if (tapToSend) {
      send([d]);
      return;
    }
    const next = drafts.map((x, j) => (j === q.index ? d : x));
    setDrafts(next);
    // Move on to the next unanswered question.
    const after = ask.questions.findIndex((qq, j) => j > q.index && !isAnswered(qq, next[j]));
    if (after >= 0) setTab(after);
  }

  if (collapsed) {
    return (
      <div className="pv-ask pv-ask-collapsed" data-testid="ask-tray" data-collapsed="true">
        <button type="button" className="pv-ask-strip" onClick={() => setCollapsedFor(null)} aria-label="Show the question">
          <MessageCircleQuestion aria-hidden="true" />
          <span className="pv-ask-strip-label">Question waiting:</span>
          <span className="pv-ask-strip-q">{ask.questions[0].question}{multi ? ` (+${ask.questions.length - 1})` : ""}</span>
          <ChevronUp aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="pv-ask" data-testid="ask-tray" role="group" aria-label="Question from the agent">
      <div className="pv-ask-head">
        {multi ? (
          <div className="pv-ask-tabs" role="tablist">
            {ask.questions.map((qq) => {
              const done = isAnswered(qq, drafts[qq.index]);
              return (
                <button
                  key={qq.index}
                  type="button"
                  role="tab"
                  aria-selected={qq.index === q.index}
                  data-done={done ? "true" : undefined}
                  className="pv-ask-tab"
                  onClick={() => setTab(qq.index)}
                >
                  {done ? <Check aria-label="answered" /> : <span className="pv-ask-tab-n">{qq.index + 1}</span>}
                  <span>{qq.header}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <span className="pv-ask-kicker"><MessageCircleQuestion aria-hidden="true" /> Question</span>
        )}
        <button type="button" className="pv-ask-collapse" onClick={() => setCollapsedFor(open.eventId)} aria-label="Hide the question for now">
          <ChevronDown aria-hidden="true" />
        </button>
      </div>
      <div className="pv-ask-q">{q.question}</div>
      <div className="pv-ask-body">
        <QuestionBody
          key={`${askKey}:${q.index}`}
          q={q}
          draft={draft}
          multi={multi}
          hostName={hostName}
          onOpenFile={onOpenFile}
          onPickOne={pickOne}
          onDraft={(d) => setDraft(q.index, d)}
          onEnter={() => send(drafts)}
          disabled={disabled}
        />
      </div>
      {!tapToSend && (
        <div className="pv-ask-foot">
          <span className="pv-ask-hint">
            {multi
              ? `${ask.questions.filter((qq) => isAnswered(qq, drafts[qq.index])).length} of ${ask.questions.length} answered`
              : "Anything you type below goes along as a note"}
          </span>
          <button
            type="button"
            className="pv-ask-send"
            disabled={!allAnswered || disabled}
            onClick={() => send(drafts)}
            data-testid="ask-send"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}

interface BodyProps {
  q: AskQuestion;
  draft: Draft;
  multi: boolean;
  hostName?: string;
  onOpenFile?: (url: string, filename: string) => void;
  onPickOne: (o: AskOption) => void;
  onDraft: (d: Draft) => void;
  onEnter: () => void;
  disabled?: boolean;
}

function QuestionBody(props: BodyProps) {
  const { q, draft, multi, onDraft } = props;
  const [otherOpen, setOtherOpen] = useState(draft?.kind === "other");
  const body = otherOpen ? null : <KindBody {...props} />;
  return (
    <>
      {body}
      {multi && (
        <div className="pv-ask-other">
          {otherOpen ? (
            <input
              className="pv-ask-input"
              autoFocus
              placeholder="Your answer to this one"
              aria-label="Something else"
              value={draft?.kind === "other" ? draft.text : ""}
              onChange={(e) => onDraft({ kind: "other", text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  props.onEnter();
                }
              }}
            />
          ) : null}
          <button
            type="button"
            className="pv-ask-link"
            onClick={() => {
              if (otherOpen) {
                setOtherOpen(false);
                onDraft(initialDraft(q));
              } else {
                setOtherOpen(true);
                onDraft({ kind: "other", text: "" });
              }
            }}
          >
            {otherOpen ? "Back to the choices" : "Something else…"}
          </button>
        </div>
      )}
    </>
  );
}

function KindBody({ q, draft, hostName, onOpenFile, onPickOne, onDraft, onEnter, disabled }: BodyProps) {
  switch (q.kind) {
    case "pick-one":
    case "pick-several": {
      const several = q.kind === "pick-several";
      const picked = draft?.kind === "options" ? draft.picked : [];
      const isOn = (o: AskOption) => picked.some((p) => p.value === o.value);
      const press = (o: AskOption) => {
        if (!several) return onPickOne(o);
        const next = isOn(o) ? picked.filter((p) => p.value !== o.value) : [...picked, o];
        // Keep the agent's order, not the tap order.
        onDraft(next.length ? { kind: "options", picked: q.options.filter((x) => next.some((n) => n.value === x.value)) } : null);
      };
      return (
        <OptionSet
          q={q}
          isOn={isOn}
          onPress={press}
          several={several}
          hostName={hostName}
          onOpenFile={onOpenFile}
          disabled={disabled}
        />
      );
    }
    case "dropdown": {
      const value = draft?.kind === "options" ? draft.picked[0]?.value ?? "" : "";
      return (
        <select
          className="pv-ask-input"
          aria-label={q.question}
          value={value}
          onChange={(e) => {
            const o = q.options.find((x) => x.value === e.target.value);
            onDraft(o ? { kind: "options", picked: [o] } : null);
          }}
        >
          <option value="" disabled>Choose…</option>
          {q.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    }
    case "order": {
      const ordered = draft?.kind === "order" ? draft.ordered : q.options;
      const move = (i: number, d: -1 | 1) => {
        const j = i + d;
        if (j < 0 || j >= ordered.length) return;
        const next = ordered.slice();
        [next[i], next[j]] = [next[j], next[i]];
        onDraft({ kind: "order", ordered: next });
      };
      return (
        <ol className="pv-ask-order">
          {ordered.map((o, i) => (
            <li key={o.value} className="pv-ask-order-row">
              <span className="pv-ask-order-n">{i + 1}</span>
              <span className="pv-ask-order-label">
                {o.label}
                {o.description && <span className="pv-ask-desc">{o.description}</span>}
              </span>
              <button type="button" className="pv-ask-icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${o.label} up`}>
                <ArrowUp aria-hidden="true" />
              </button>
              <button type="button" className="pv-ask-icon" disabled={i === ordered.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${o.label} down`}>
                <ArrowDown aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      );
    }
    case "decide": {
      const decided = draft?.kind === "decide" ? draft.decided : [];
      const choiceOf = (o: AskOption) => decided.find((d) => d.item.value === o.value)?.choice;
      const set = (o: AskOption, choice: string) => {
        const rest = decided.filter((d) => d.item.value !== o.value);
        const next = [...rest, { item: o, choice }];
        // Keep the agent's item order.
        next.sort((a, b) => q.options.indexOf(a.item) - q.options.indexOf(b.item));
        onDraft({ kind: "decide", decided: next });
      };
      return (
        <div className="pv-ask-decide">
          {q.options.map((o) => (
            <div key={o.value} className="pv-ask-decide-row">
              <span className="pv-ask-decide-label">
                {o.label}
                {o.description && <span className="pv-ask-desc">{o.description}</span>}
              </span>
              <span className="pv-ask-seg" role="radiogroup" aria-label={o.label}>
                {q.choices.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={choiceOf(o) === c}
                    data-on={choiceOf(o) === c ? "true" : undefined}
                    onClick={() => set(o, c)}
                  >
                    {c}
                  </button>
                ))}
              </span>
            </div>
          ))}
        </div>
      );
    }
    case "text":
    case "long-text": {
      const text = draft?.kind === "text" ? draft.text : "";
      const common = {
        className: "pv-ask-input",
        "aria-label": q.question,
        placeholder: q.placeholder ?? "",
        value: text,
      };
      return q.kind === "text" ? (
        <input
          {...common}
          onChange={(e) => onDraft({ kind: "text", text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onEnter();
            }
          }}
        />
      ) : (
        <textarea
          {...common}
          rows={5}
          className="pv-ask-input pv-ask-textarea"
          onChange={(e) => onDraft({ kind: "text", text: e.target.value })}
        />
      );
    }
    case "number":
    case "money":
      return <NumberField q={q} draft={draft} onDraft={onDraft} onEnter={onEnter} />;
    case "slider": {
      const min = q.min ?? 0;
      const max = q.max ?? 100;
      const value = draft?.kind === "number" ? draft.value : min;
      return (
        <div className="pv-ask-slider">
          <input
            type="range"
            min={min}
            max={max}
            step={q.step ?? 1}
            value={value}
            aria-label={q.question}
            onChange={(e) => onDraft({ kind: "number", value: Number(e.target.value) })}
          />
          <span className="pv-ask-slider-v">{q.unit ? `${value} ${q.unit}` : value}</span>
        </div>
      );
    }
    case "date": {
      const value = draft?.kind === "date" ? draft.value : "";
      return (
        <input
          type="date"
          className="pv-ask-input"
          aria-label={q.question}
          value={value}
          onChange={(e) => onDraft(e.target.value ? { kind: "date", value: e.target.value } : null)}
        />
      );
    }
    case "split":
      return <SplitField q={q} draft={draft} onDraft={onDraft} />;
  }
}

function NumberField({ q, draft, onDraft, onEnter }: { q: AskQuestion; draft: Draft; onDraft: (d: Draft) => void; onEnter: () => void }) {
  // The agent's default is already the draft (initialDraft), so it counts as
  // the answer even on a tab never opened.
  const [raw, setRaw] = useState(draft?.kind === "number" ? String(draft.value) : "");
  const money = q.kind === "money";
  const prefix = money ? formatMoney(0, q.currency ?? "USD").replace(/[\d.,\s]/g, "") : "";
  return (
    <div className="pv-ask-number">
      {prefix && <span className="pv-ask-affix">{prefix}</span>}
      <input
        className="pv-ask-input"
        inputMode="decimal"
        aria-label={q.question}
        placeholder={q.placeholder ?? (money ? "0.00" : "")}
        value={raw}
        onChange={(e) => {
          const v = e.target.value;
          setRaw(v);
          const n = Number(v.replace(/[,\s$€£¥]/g, ""));
          onDraft(v.trim() !== "" && Number.isFinite(n) ? { kind: "number", value: money ? Math.round(n * 100) / 100 : n } : null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter();
          }
        }}
      />
      {q.unit && <span className="pv-ask-affix">{q.unit}</span>}
      {(q.min !== undefined || q.max !== undefined) && (
        <span className="pv-ask-range">
          {q.min !== undefined && q.max !== undefined ? `${q.min}–${q.max}` : q.min !== undefined ? `at least ${q.min}` : `at most ${q.max}`}
        </span>
      )}
    </div>
  );
}

function SplitField({ q, draft, onDraft }: { q: AskQuestion; draft: Draft; onDraft: (d: Draft) => void }) {
  const total = q.total ?? 0;
  // The typed text per part, so "12." or a cleared field stays as typed.
  const [raws, setRaws] = useState<string[]>(() =>
    q.options.map((item) => {
      const p = draft?.kind === "split" ? draft.parts.find((x) => x.item.value === item.value) : undefined;
      return p && Number.isFinite(p.amount) && p.amount !== 0 ? String(p.amount) : "";
    }),
  );
  // Empty = 0; anything else must be a number of at least 0 (NaN blocks Send).
  const amountOf = (r: string): number => {
    const t = r.trim();
    if (t === "") return 0;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
  };
  const amounts = raws.map(amountOf);
  const allValid = amounts.every((a) => Number.isFinite(a));
  const left = splitLeft(total, amounts.map((a) => (Number.isFinite(a) ? a : 0)));
  const set = (i: number, r: string) => {
    const next = raws.map((x, j) => (j === i ? r : x));
    setRaws(next);
    onDraft({ kind: "split", parts: q.options.map((item, j) => ({ item, amount: amountOf(next[j]) })) });
  };
  return (
    <div className="pv-ask-split">
      {q.options.map((item, i) => (
        <label key={item.value} className="pv-ask-split-row">
          <span className="pv-ask-split-label">{item.label}</span>
          <input
            className="pv-ask-input"
            inputMode="decimal"
            aria-label={item.label}
            aria-invalid={Number.isFinite(amounts[i]) ? undefined : true}
            value={raws[i]}
            placeholder="0"
            onChange={(e) => set(i, e.target.value)}
          />
          {q.unit && <span className="pv-ask-affix">{q.unit}</span>}
        </label>
      ))}
      <div className="pv-ask-split-left" data-ok={allValid && left === 0 ? "true" : undefined}>
        {!allValid
          ? "Amounts must be numbers of 0 or more"
          : left === 0
            ? `Adds up to ${total}`
            : left > 0
              ? `${left} left to place of ${total}`
              : `${-left} over ${total}`}
      </div>
    </div>
  );
}

function OptionSet({
  q,
  isOn,
  onPress,
  several,
  hostName,
  onOpenFile,
  disabled,
}: {
  q: AskQuestion;
  isOn: (o: AskOption) => boolean;
  onPress: (o: AskOption) => void;
  several: boolean;
  hostName?: string;
  onOpenFile?: (url: string, filename: string) => void;
  disabled?: boolean;
}) {
  if (q.layout === "week") return <WeekGrid q={q} isOn={isOn} onPress={onPress} disabled={disabled} />;
  return (
    <div className={cn("pv-ask-opts", q.layout === "grid" && "pv-ask-grid")} role={several ? "group" : "radiogroup"}>
      {q.options.map((o, i) => (
        <OptionButton
          key={o.value}
          o={o}
          n={i + 1}
          on={isOn(o)}
          several={several}
          grid={q.layout === "grid"}
          hostName={hostName}
          onOpenFile={onOpenFile}
          onPress={() => onPress(o)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function OptionButton({
  o,
  n,
  on,
  several,
  grid,
  hostName,
  onOpenFile,
  onPress,
  disabled,
}: {
  o: AskOption;
  n: number;
  on: boolean;
  several: boolean;
  grid: boolean;
  hostName?: string;
  onOpenFile?: (url: string, filename: string) => void;
  onPress: () => void;
  disabled?: boolean;
}) {
  const img = o.color ? null : faceUrl(o.image, hostName);
  const fileUrl = o.color || img ? null : faceUrl(o.file, hostName);
  const fileName = o.file ? fileNameOfPath(o.file) : "";
  return (
    <div className={cn("pv-ask-opt-wrap", grid && "pv-ask-opt-wrap-grid")}>
      <button
        type="button"
        role={several ? "checkbox" : "radio"}
        aria-checked={on}
        data-on={on ? "true" : undefined}
        className={cn("pv-ask-opt", grid && "pv-ask-opt-tile")}
        onClick={onPress}
        disabled={disabled}
      >
        {o.color ? (
          <span className="pv-ask-swatch" style={{ background: o.color }} aria-hidden="true" />
        ) : img ? (
          <img className="pv-ask-img" src={img} alt="" loading="lazy" />
        ) : fileUrl ? (
          <FileText className="pv-ask-fileicon" aria-hidden="true" />
        ) : !grid ? (
          <span className="pv-ask-n" aria-hidden="true">{several ? (on ? <Check /> : null) : n}</span>
        ) : null}
        <span className="pv-ask-opt-text">
          <span className="pv-ask-opt-label">
            {o.label}
            {o.recommended && <span className="pv-ask-rec">recommended</span>}
          </span>
          {o.description && <span className="pv-ask-desc">{o.description}</span>}
          {fileUrl && fileName && fileName !== o.label && <span className="pv-ask-desc">{fileName}</span>}
        </span>
        {(grid || o.color || img || fileUrl) && several && on && <Check className="pv-ask-tick" aria-hidden="true" />}
      </button>
      {fileUrl && onOpenFile && (
        <button type="button" className="pv-ask-link pv-ask-open" onClick={() => onOpenFile(fileUrl, fileName || o.label)}>
          Open
        </button>
      )}
    </div>
  );
}

function WeekGrid({
  q,
  isOn,
  onPress,
  disabled,
}: {
  q: AskQuestion;
  isOn: (o: AskOption) => boolean;
  onPress: (o: AskOption) => void;
  disabled?: boolean;
}) {
  const { days, times, cell } = useMemo(() => {
    const byKey = new Map<string, AskOption>();
    const daySet = new Set<string>();
    const timeSet = new Set<string>();
    for (const o of q.options) {
      const [d, t] = (o.time ?? "").split("T");
      daySet.add(d);
      timeSet.add(t);
      byKey.set(`${d}T${t}`, o);
    }
    return {
      days: [...daySet].sort(),
      times: [...timeSet].sort(),
      cell: (d: string, t: string) => byKey.get(`${d}T${t}`),
    };
  }, [q.options]);
  const dayLabel = (d: string) => {
    const [y, m, dd] = d.split("-").map(Number);
    const date = new Date(y, m - 1, dd);
    return {
      wd: date.toLocaleDateString("en-US", { weekday: "short" }),
      md: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    };
  };
  return (
    <div className="pv-ask-week" style={{ gridTemplateColumns: `auto repeat(${days.length}, minmax(52px, 1fr))` }}>
      <span />
      {days.map((d) => {
        const l = dayLabel(d);
        return (
          <span key={d} className="pv-ask-week-day">
            <b>{l.wd}</b>
            {l.md}
          </span>
        );
      })}
      {times.map((t) => (
        <WeekRow key={t} t={t} days={days} cell={cell} isOn={isOn} onPress={onPress} disabled={disabled} />
      ))}
    </div>
  );
}

function WeekRow({
  t,
  days,
  cell,
  isOn,
  onPress,
  disabled,
}: {
  t: string;
  days: string[];
  cell: (d: string, t: string) => AskOption | undefined;
  isOn: (o: AskOption) => boolean;
  onPress: (o: AskOption) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <span className="pv-ask-week-time">{formatSlotTime(`xT${t}`)}</span>
      {days.map((d) => {
        const o = cell(d, t);
        if (!o) return <span key={d} className="pv-ask-week-empty" />;
        return (
          <button
            key={d}
            type="button"
            className="pv-ask-week-slot"
            data-on={isOn(o) ? "true" : undefined}
            aria-pressed={isOn(o)}
            aria-label={o.label}
            title={o.description ?? o.label}
            onClick={() => onPress(o)}
            disabled={disabled}
          >
            {isOn(o) ? <Check aria-hidden="true" /> : formatSlotTime(`xT${t}`)}
          </button>
        );
      })}
    </>
  );
}
