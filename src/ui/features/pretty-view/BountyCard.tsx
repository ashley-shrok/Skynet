import { useCallback, useRef, useState } from "react";
import { Flame, ChevronsUp, ChevronUp, Minus, ChevronDown, Circle, Star, Pencil, X, Plus, ChevronUp as ArrowUp, ChevronDown as ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/checkbox";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Textarea } from "@/components/textarea";
import { Badge } from "@/components/badge";
import {
  BOUNTY_PRIORITY_VALUES,
  BOUNTY_STATUS_VALUES,
  type Bounty,
  type BountyPriority,
  type BountyStatus,
  type BountyFieldsPatch,
} from "@/api/claude-session-api";

// Patch #87: per-bounty card for the IdentityModal Bounties tab.
//
// Props:
//   bounty  — the Bounty object from the WS response
//   hue     — numeric identity hue (0-360), same source as IdentityBadge lg
//   archived — when true, the whole card is rendered at opacity-70 (de-emphasized)
//
// Todos are rendered as DISABLED shadcn Checkboxes (read-only per D-07) when
// onFieldsChange is not supplied. When supplied, todos become an editable list.
// Premise collapses to 4 lines when > 400 chars; "Show more/less" toggle below.
// Timeline shows the LAST element of the timeline[] array (D-10).
// Priority indicator uses lucide glyphs only — no text glyph, bare icon (D-14 note on
// bare-glyph-for-indicator pattern from patch #72).

// Patch #168: "pinned" removed from STATUS_CLASSES and STATUS_LABELS —
// it is now an independent boolean field, not a status enum value.
// The per-row pin glyph (PrettyConversationRow + bounty badge) handles
// the pinned indicator separately.
// Patch #172: pin-toggle handled by the header-row star (not a status pill) —
// see onPinnedChange prop.
const STATUS_CLASSES: Record<string, string> = {
  in_progress:
    "bg-emerald-500/25 text-emerald-200 border border-emerald-500/40",
  waiting_on_someone_else:
    "bg-violet-500/25 text-violet-200 border border-violet-500/40",
  done: "bg-slate-500/25 text-slate-300 border border-slate-500/40",
  dropped:
    "bg-rose-500/20 text-rose-300 border border-rose-500/30 line-through",
};

const STATUS_LABELS: Record<string, string> = {
  in_progress: "In Progress",
  waiting_on_someone_else: "Waiting",
  done: "Done",
  dropped: "Dropped",
};

function PriorityIcon({ priority }: { priority: string }) {
  switch (priority) {
    case "urgent":
      return (
        <>
          <span className="sr-only">priority: urgent</span>
          <Flame className="h-3.5 w-3.5 text-rose-400" />
        </>
      );
    case "high":
      return (
        <>
          <span className="sr-only">priority: high</span>
          <ChevronsUp className="h-3.5 w-3.5 text-orange-300" />
        </>
      );
    case "medium":
      return (
        <>
          <span className="sr-only">priority: medium</span>
          <ChevronUp className="h-3.5 w-3.5 text-amber-300" />
        </>
      );
    case "low":
      return (
        <>
          <span className="sr-only">priority: low</span>
          <Minus className="h-3.5 w-3.5 text-slate-400" />
        </>
      );
    case "unprioritized":
      return (
        <>
          <span className="sr-only">priority: unprioritized</span>
          <Circle className="h-3.5 w-3.5 text-slate-500" />
        </>
      );
    default:
      return null;
  }
}

// Patch #154: expanded-row priority editor. Renders the 5 valid priorities
// as a click-to-set inline row (no dropdown chrome — matches the modal's
// glass-token minimalist treatment) that fires onPriorityChange with the
// picked value. Disabled while a save is in flight. Falls back to a static
// PriorityIcon display when no onChange is supplied (archived cards).
function PriorityRow({
  priority,
  onChange,
  saving,
}: {
  priority: string;
  onChange?: (p: BountyPriority) => void;
  saving?: boolean;
}) {
  if (!onChange) {
    return (
      <span className="flex items-center gap-1 text-xs text-[var(--color-pv-fg-muted)]">
        <PriorityIcon priority={priority} />
        <span className="capitalize">{priority}</span>
      </span>
    );
  }
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {BOUNTY_PRIORITY_VALUES.map((p) => {
        const active = p === priority;
        return (
          <button
            key={p}
            type="button"
            onClick={() => !active && onChange(p)}
            disabled={saving || active}
            title={`Set priority: ${p}`}
            aria-label={`Set priority: ${p}`}
            aria-pressed={active}
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] uppercase tracking-wide border transition-colors cursor-pointer",
              active
                ? "border-white/40 bg-white/10 text-[#f0ebe0] cursor-default"
                : "border-white/10 text-[var(--color-pv-fg-muted)] hover:border-white/25 hover:text-[#e8e4d8]",
              saving && !active && "opacity-50 cursor-wait",
            )}
          >
            <PriorityIcon priority={p} />
            <span>{p === "unprioritized" ? "none" : p}</span>
          </button>
        );
      })}
    </div>
  );
}

// Quick 260727-v0b: inline STATUS editor row — mirrors PriorityRow above
// but with a treatment tweak per Ashley's ask: status has no glyph (just
// the label), and each INACTIVE pill uses its own STATUS_CLASSES color
// for fill/border/text (rather than the common muted border PriorityRow
// uses). The ACTIVE pill still gets the "pressed white ring" treatment
// so it reads as selected against the colored inactive row. Editable for
// ALL bounties including archived. Read-only branch (no onChange) is a
// safety net; the caller in IdentityModal supplies onChange at every
// render site.
// Patch #168: shows 4 options (in_progress / waiting_on_someone_else /
// done / dropped). "pinned" removed — it is now a boolean field shown via
// the per-row pin glyph, not a lifecycle status option.
function StatusRow({
  status,
  onChange,
  saving,
}: {
  status: string;
  onChange?: (s: BountyStatus) => void;
  saving?: boolean;
}) {
  if (!onChange) {
    // Read-only display — matches the header row's status pill shape.
    const cls =
      STATUS_CLASSES[status] ??
      "bg-slate-500/20 text-slate-200 border border-slate-500/30";
    const label = STATUS_LABELS[status] ?? status;
    return (
      <span
        className={cn(
          "px-2 py-0.5 rounded-full text-[11px] font-medium uppercase tracking-wide inline-flex w-fit",
          cls,
        )}
      >
        {label}
      </span>
    );
  }
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {BOUNTY_STATUS_VALUES.map((s) => {
        const active = s === status;
        const inactiveCls =
          STATUS_CLASSES[s] ??
          "bg-slate-500/20 text-slate-200 border border-slate-500/30";
        return (
          <button
            key={s}
            type="button"
            onClick={() => !active && onChange(s)}
            disabled={saving || active}
            title={`Set status: ${STATUS_LABELS[s] ?? s}`}
            aria-label={`Set status: ${STATUS_LABELS[s] ?? s}`}
            aria-pressed={active}
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] uppercase tracking-wide border transition-colors",
              active
                ? "border-white/40 bg-white/10 text-[#f0ebe0] cursor-default"
                : cn(inactiveCls, "cursor-pointer hover:brightness-110"),
              saving && !active && "opacity-50 cursor-wait",
            )}
          >
            <span className="sr-only">Set status:</span>
            <span>{STATUS_LABELS[s] ?? s}</span>
          </button>
        );
      })}
    </div>
  );
}

// T-18-26: safeHref — rejects javascript: and data: schemes to prevent XSS
// via anchor href injection. Matches http / https / mailto / relative paths.
function safeHref(link: string): string {
  return /^(https?:|mailto:|\/)/i.test(link) ? link : "#";
}

export function BountyCard({
  bounty,
  hue,
  archived = false,
  onPriorityChange,
  onStatusChange,
  onPinnedChange,
  onArchive,
  onDelete,
  onFieldsChange,
}: {
  bounty: Bounty;
  hue: number;
  archived?: boolean;
  /** Patch #154: when supplied, expanded row renders an inline priority
   *  editor and dispatches this callback on click. Omit (e.g. for archived
   *  cards) to render the static PriorityIcon display only. */
  onPriorityChange?: (priority: BountyPriority) => Promise<void>;
  /** Quick 260727-v0b: when supplied, expanded row renders an inline
   *  status editor above the priority editor. Unlike onPriorityChange,
   *  this SHOULD be supplied for ALL bounties including terminal
   *  (done/dropped) and archived — status is the resurrect surface. */
  onStatusChange?: (status: BountyStatus) => Promise<void>;
  /** Quick 260728-sqk / patch #172: when supplied, header row renders a
   *  pin-toggle star; click fires this callback with the flipped boolean.
   *  Supplied for ALL bounties including archived (unpin an archived pinned
   *  bounty stays legal, re-pin is the resurrect signal on the pinned axis). */
  onPinnedChange?: (pinned: boolean) => Promise<void>;
  /** This quick: when supplied, expanded editor body renders a labeled
   *  "Needs desk" toggle; flip fires this callback with the new boolean.
   *  Supplied for ALL bounties including archived — user-reserved flag
   *  orthogonal to lifecycle. */
  onNeedsDeskChange?: (needsDesk: boolean) => Promise<void>;
  /** Quick 260727-wd0: when supplied, expanded body renders an Archive
   *  button below the Priority row. Only supplied for OPEN cards; archived
   *  cards do NOT get the button (unarchive is a follow-up quick). */
  onArchive?: () => Promise<void>;
  /** Quick 260729-g5r: when supplied, expanded body renders a destructive
   *  Delete button below the Archive button. Unlike onArchive, onDelete is
   *  supplied for BOTH open AND archived cards — permanent rm -rf applies
   *  regardless of location (locked design D-2). The window.confirm() gate
   *  lives inside handleDelete below. */
  onDelete?: () => Promise<void>;
  /** Plan 04/05: when supplied, expanded body renders inline editors for
   *  title, premise, todos, keywords, source_links, deadline, and
   *  meeting_questions. Each editor dispatches a partial patch via this
   *  callback. Threaded for ALL FOUR partitions (in_progress / rest /
   *  other / archive) since even archived bounties can have fields
   *  edited (e.g. retrospective meeting_question). */
  onFieldsChange?: (patch: BountyFieldsPatch) => Promise<void>;
}) {
  const [premiseExpanded, setPremiseExpanded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [savingPriority, setSavingPriority] = useState(false);
  const [priorityError, setPriorityError] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [savingPinned, setSavingPinned] = useState(false);
  const [pinnedError, setPinnedError] = useState<string | null>(null);
  const [savingNeedsDesk, setSavingNeedsDesk] = useState(false);
  const [needsDeskError, setNeedsDeskError] = useState<string | null>(null);
  const [savingArchive, setSavingArchive] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [savingDelete, setSavingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── Field editor state ────────────────────────────────────────────────────

  // title
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(bounty.title);
  const [savingTitle, setSavingTitle] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  // premise
  const [editingPremise, setEditingPremise] = useState(false);
  const [premiseDraft, setPremiseDraft] = useState(bounty.premise);
  const [savingPremise, setSavingPremise] = useState(false);
  const [premiseError, setPremiseError] = useState<string | null>(null);

  // todos — autosave, no explicit Save/Cancel; debounced for text edits
  const [todosDraft, setTodosDraft] = useState(bounty.todos);
  const [savingTodos, setSavingTodos] = useState(false);
  const [todosError, setTodosError] = useState<string | null>(null);
  const [newTodoText, setNewTodoText] = useState("");
  const todosDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // keywords — autosave
  const [keywordsDraft, setKeywordsDraft] = useState(bounty.keywords);
  const [savingKeywords, setSavingKeywords] = useState(false);
  const [keywordsError, setKeywordsError] = useState<string | null>(null);
  const [newKeyword, setNewKeyword] = useState("");

  // source_links — autosave
  const [sourceLinksDraft, setSourceLinksDraft] = useState(bounty.source_links);
  const [savingSourceLinks, setSavingSourceLinks] = useState(false);
  const [sourceLinksError, setSourceLinksError] = useState<string | null>(null);
  const [newSourceLink, setNewSourceLink] = useState("");
  const [newSourceLinkError, setNewSourceLinkError] = useState<string | null>(null);

  // deadline — autosave on change
  const [savingDeadline, setSavingDeadline] = useState(false);
  const [deadlineError, setDeadlineError] = useState<string | null>(null);

  // meeting_questions — autosave
  const [meetingQuestionsDraft, setMeetingQuestionsDraft] = useState(bounty.meeting_questions);
  const [savingMeetingQuestions, setSavingMeetingQuestions] = useState(false);
  const [meetingQuestionsError, setMeetingQuestionsError] = useState<string | null>(null);
  const [newMeetingQuestion, setNewMeetingQuestion] = useState("");

  // ── Generic fields dispatcher ─────────────────────────────────────────────

  async function handleFieldsChange(patch: BountyFieldsPatch): Promise<void> {
    if (!onFieldsChange) return;
    await onFieldsChange(patch);
  }

  // ── Existing edit surface handlers (byte-identical to original) ───────────

  const isLongPremise = bounty.premise.length > 400;

  async function handlePriorityChange(next: BountyPriority) {
    if (!onPriorityChange) return;
    setPriorityError(null);
    setSavingPriority(true);
    try {
      await onPriorityChange(next);
    } catch (e) {
      setPriorityError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPriority(false);
    }
  }

  async function handleStatusChange(next: BountyStatus) {
    if (!onStatusChange) return;
    setStatusError(null);
    setSavingStatus(true);
    try {
      await onStatusChange(next);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingStatus(false);
    }
  }

  // Quick 260728-sqk / patch #172: header-row star toggle handler.
  // Mirrors handleStatusChange — flip the boolean, surface backend errors
  // inline, reset saving flag in finally so the star re-enables even on
  // failure.
  async function handlePinnedChange(next: boolean) {
    if (!onPinnedChange) return;
    setPinnedError(null);
    setSavingPinned(true);
    try {
      await onPinnedChange(next);
    } catch (e) {
      setPinnedError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPinned(false);
    }
  }

  async function handleArchive() {
    if (!onArchive) return;
    setArchiveError(null);
    setSavingArchive(true);
    try {
      await onArchive();
    } catch (e) {
      setArchiveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingArchive(false);
    }
  }

  // Quick 260729-g5r: destructive delete handler. window.confirm() gates
  // BEFORE any state touch or WS call — Cancel is a no-op (locked D-3).
  // On OK, byte-shape mirror of handleArchive's try/catch/finally.
  async function handleDelete() {
    if (!onDelete) return;
    const ok = window.confirm(
      `Delete bounty "${bounty.title}"? This cannot be undone.`,
    );
    if (!ok) return;
    setDeleteError(null);
    setSavingDelete(true);
    try {
      await onDelete();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingDelete(false);
    }
  }

  // ── Title editor handlers ─────────────────────────────────────────────────

  function startEditTitle() {
    setTitleDraft(bounty.title);
    setTitleError(null);
    setEditingTitle(true);
  }

  function cancelEditTitle() {
    if (titleDraft !== bounty.title) {
      if (!window.confirm("Discard unsaved changes?")) return;
    }
    setEditingTitle(false);
    setTitleDraft(bounty.title);
    setTitleError(null);
  }

  async function saveTitle() {
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setTitleError("Title cannot be empty.");
      return;
    }
    if (trimmed === bounty.title) {
      setEditingTitle(false);
      return;
    }
    setTitleError(null);
    setSavingTitle(true);
    try {
      await handleFieldsChange({ title: trimmed });
      setEditingTitle(false);
    } catch (e) {
      setTitleError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingTitle(false);
    }
  }

  function onTitleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); void saveTitle(); }
    if (e.key === "Escape") { e.preventDefault(); cancelEditTitle(); }
  }

  // ── Premise editor handlers ───────────────────────────────────────────────

  function startEditPremise() {
    setPremiseDraft(bounty.premise);
    setPremiseError(null);
    setEditingPremise(true);
  }

  function cancelEditPremise() {
    if (premiseDraft !== bounty.premise) {
      if (!window.confirm("Discard unsaved changes?")) return;
    }
    setEditingPremise(false);
    setPremiseDraft(bounty.premise);
    setPremiseError(null);
  }

  async function savePremise() {
    if (premiseDraft === bounty.premise) {
      setEditingPremise(false);
      return;
    }
    setPremiseError(null);
    setSavingPremise(true);
    try {
      await handleFieldsChange({ premise: premiseDraft });
      setEditingPremise(false);
    } catch (e) {
      setPremiseError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPremise(false);
    }
  }

  function onPremiseKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") { e.preventDefault(); cancelEditPremise(); }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void savePremise(); }
  }

  // ── Todos editor handlers (autosave with debounce for text edits) ─────────

  const flushTodosSave = useCallback(async (nextTodos: typeof todosDraft) => {
    if (!onFieldsChange) return;
    setSavingTodos(true);
    setTodosError(null);
    try {
      await onFieldsChange({ todos: nextTodos });
    } catch (e) {
      setTodosError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingTodos(false);
    }
  }, [onFieldsChange]);

  function saveTodosImmediate(nextTodos: typeof todosDraft) {
    if (todosDebounceRef.current) clearTimeout(todosDebounceRef.current);
    void flushTodosSave(nextTodos);
  }

  function saveTodosDebounced(nextTodos: typeof todosDraft) {
    if (todosDebounceRef.current) clearTimeout(todosDebounceRef.current);
    todosDebounceRef.current = setTimeout(() => {
      void flushTodosSave(nextTodos);
    }, 400);
  }

  function handleTodoToggle(idx: number) {
    const next = todosDraft.map((t, i) =>
      i === idx ? { ...t, done: !t.done } : t,
    );
    setTodosDraft(next);
    saveTodosImmediate(next);
  }

  function handleTodoTextChange(idx: number, text: string) {
    const next = todosDraft.map((t, i) => (i === idx ? { ...t, text } : t));
    setTodosDraft(next);
    saveTodosDebounced(next);
  }

  function handleTodoTextBlur(idx: number) {
    const t = todosDraft[idx];
    if (!t) return;
    if (!t.text.trim()) {
      if (window.confirm("Remove this todo (text is empty)?")) {
        const next = todosDraft.filter((_, i) => i !== idx);
        setTodosDraft(next);
        saveTodosImmediate(next);
      } else {
        // restore from bounty
        const original = bounty.todos[idx];
        const next = todosDraft.map((todo, i) =>
          i === idx ? { ...todo, text: original?.text ?? todo.text } : todo,
        );
        setTodosDraft(next);
      }
    }
  }

  function handleTodoRemove(idx: number) {
    const next = todosDraft.filter((_, i) => i !== idx);
    setTodosDraft(next);
    saveTodosImmediate(next);
  }

  function handleTodoMoveUp(idx: number) {
    if (idx === 0) return;
    const next = [...todosDraft];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    setTodosDraft(next);
    saveTodosImmediate(next);
  }

  function handleTodoMoveDown(idx: number) {
    if (idx === todosDraft.length - 1) return;
    const next = [...todosDraft];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    setTodosDraft(next);
    saveTodosImmediate(next);
  }

  function handleAddTodo() {
    const text = newTodoText.trim();
    if (!text) return;
    const next = [...todosDraft, { text, done: false }];
    setTodosDraft(next);
    setNewTodoText("");
    saveTodosImmediate(next);
  }

  function onNewTodoKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); handleAddTodo(); }
  }

  // ── Keywords editor handlers (autosave) ───────────────────────────────────

  async function saveKeywords(next: string[]) {
    if (!onFieldsChange) return;
    setSavingKeywords(true);
    setKeywordsError(null);
    try {
      await onFieldsChange({ keywords: next });
    } catch (e) {
      setKeywordsError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingKeywords(false);
    }
  }

  function commitKeyword(raw: string) {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return;
    if (keywordsDraft.some((k) => k.toLowerCase() === trimmed)) return; // deduplicated
    if (keywordsDraft.length >= 20) return; // soft cap
    const next = [...keywordsDraft, trimmed];
    setKeywordsDraft(next);
    setNewKeyword("");
    void saveKeywords(next);
  }

  function onNewKeywordKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); commitKeyword(newKeyword); }
    if (e.key === ",") { e.preventDefault(); commitKeyword(newKeyword); }
  }

  function onNewKeywordChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    // Auto-commit on comma in value
    if (val.endsWith(",")) {
      commitKeyword(val.slice(0, -1));
    } else {
      setNewKeyword(val);
    }
  }

  function handleRemoveKeyword(idx: number) {
    const next = keywordsDraft.filter((_, i) => i !== idx);
    setKeywordsDraft(next);
    void saveKeywords(next);
  }

  // ── Source links editor handlers (autosave) ───────────────────────────────

  async function saveSourceLinks(next: string[]) {
    if (!onFieldsChange) return;
    setSavingSourceLinks(true);
    setSourceLinksError(null);
    try {
      await onFieldsChange({ source_links: next });
    } catch (e) {
      setSourceLinksError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSourceLinks(false);
    }
  }

  function commitSourceLink(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    // Validate: must start with http://, https://, or /
    if (!/^(https?:|\/)/i.test(trimmed)) {
      setNewSourceLinkError("URL must start with http://, https://, or /");
      return;
    }
    setNewSourceLinkError(null);
    const next = [...sourceLinksDraft, trimmed];
    setSourceLinksDraft(next);
    setNewSourceLink("");
    void saveSourceLinks(next);
  }

  function onNewSourceLinkKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); commitSourceLink(newSourceLink); }
  }

  function onNewSourceLinkBlur() {
    if (newSourceLink.trim()) commitSourceLink(newSourceLink);
  }

  function handleRemoveSourceLink(idx: number) {
    const next = sourceLinksDraft.filter((_, i) => i !== idx);
    setSourceLinksDraft(next);
    void saveSourceLinks(next);
  }

  // ── Needs-desk toggle handler (autosave on flip) ──────────────────────────

  async function handleNeedsDeskChange(next: boolean) {
    if (!onNeedsDeskChange) return;
    setNeedsDeskError(null);
    setSavingNeedsDesk(true);
    try {
      await onNeedsDeskChange(next);
    } catch (err) {
      setNeedsDeskError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingNeedsDesk(false);
    }
  }

  // ── Deadline editor handler (autosave on change) ──────────────────────────

  async function handleDeadlineChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value; // "YYYY-MM-DD" or "" when cleared
    const patch: BountyFieldsPatch = { deadline: val || null };
    setDeadlineError(null);
    setSavingDeadline(true);
    try {
      await handleFieldsChange(patch);
    } catch (err) {
      setDeadlineError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingDeadline(false);
    }
  }

  // ── Meeting questions editor handlers (autosave) ──────────────────────────

  async function saveMeetingQuestions(next: typeof meetingQuestionsDraft) {
    if (!onFieldsChange) return;
    setSavingMeetingQuestions(true);
    setMeetingQuestionsError(null);
    try {
      await onFieldsChange({ meeting_questions: next });
    } catch (e) {
      setMeetingQuestionsError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingMeetingQuestions(false);
    }
  }

  function handleAddMeetingQuestion() {
    const text = newMeetingQuestion.trim();
    if (!text) return;
    const next = [...meetingQuestionsDraft, { text, answered: false }];
    setMeetingQuestionsDraft(next);
    setNewMeetingQuestion("");
    void saveMeetingQuestions(next);
  }

  function onNewMeetingQuestionKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); handleAddMeetingQuestion(); }
  }

  function handleMeetingQuestionToggleAnswered(idx: number) {
    const next = meetingQuestionsDraft.map((q, i) =>
      i === idx ? { ...q, answered: !q.answered } : q,
    );
    setMeetingQuestionsDraft(next);
    void saveMeetingQuestions(next);
  }

  function handleRemoveMeetingQuestion(idx: number) {
    const next = meetingQuestionsDraft.filter((_, i) => i !== idx);
    setMeetingQuestionsDraft(next);
    void saveMeetingQuestions(next);
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  const statusClass =
    STATUS_CLASSES[bounty.status] ??
    "bg-slate-500/20 text-slate-200 border border-slate-500/30";
  const statusLabel = STATUS_LABELS[bounty.status] ?? bounty.status;

  const latestTimeline =
    bounty.timeline.length > 0
      ? bounty.timeline[bounty.timeline.length - 1]
      : null;
  const truncatedTimeline =
    latestTimeline && latestTimeline.length > 240
      ? latestTimeline.slice(0, 240) + "…"
      : latestTimeline;

  // deadline display value for the <input type="date"> — take YYYY-MM-DD prefix
  const deadlineValue = bounty.deadline
    ? bounty.deadline.slice(0, 10)
    : "";

  return (
    <div
      className={cn(
        "rounded-[var(--radius-pv-bubble)] px-4 py-3 flex flex-col gap-2",
        "backdrop-blur-lg saturate-[1.3] [-webkit-backdrop-filter:blur(16px)_saturate(1.3)]",
        "font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif]",
        archived && "opacity-70",
      )}
      style={{
        background: `linear-gradient(160deg, hsla(${hue}, 40%, 22%, 0.5), hsla(${hue}, 35%, 14%, 0.55))`,
        border: `1px solid hsla(${hue}, 60%, 50%, 0.24)`,
        boxShadow:
          "0 4px 16px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,220,170,0.10)",
      }}
    >
      {/* Row 1: title + status pill + priority + expand chevron.
          Whole row is the disclosure toggle — collapsed by default so a long
          list of bounties stays scannable without scrolling through each
          card's premise/todos/timeline. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex items-center gap-2 flex-wrap w-full text-left cursor-pointer"
      >
        <span className="flex flex-col min-w-0 flex-1 text-left">
          <span className="font-semibold text-[15px] text-[#f0ebe0] truncate">
            {bounty.title}
          </span>
          {/* Patch #109: slug line — folder basename, monospace + muted.
              Ashley refers to bounties by slug in conversation, so making
              it visible + copy-selectable next to the title is the fastest
              lookup. Second line (below title) keeps the primary title
              scannable at the same weight as before; slug never wraps —
              it's a single token by construction. */}
          {bounty.slug && (
            <span className="font-mono text-[11px] text-[#a89a80]/80 truncate leading-tight">
              {bounty.slug}
            </span>
          )}
        </span>
        <span
          className={cn(
            "px-2 py-0.5 rounded-full text-[11px] font-medium uppercase tracking-wide shrink-0",
            statusClass,
          )}
        >
          {statusLabel}
        </span>
        {/* Quick 260728-sqk / patch #172: pin toggle star. Lives in the
            meta cluster next to the status pill so it visually reads as
            "part of the header signals". stopPropagation prevents the
            disclosure toggle from firing on click. Disabled when no
            onPinnedChange is supplied (defensive — currently threaded
            everywhere, but the prop is optional). */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handlePinnedChange(!bounty.pinned);
          }}
          disabled={!onPinnedChange || savingPinned}
          aria-label={bounty.pinned ? "Unpin bounty" : "Pin bounty"}
          aria-pressed={bounty.pinned}
          title={bounty.pinned ? "Unpin bounty" : "Pin bounty"}
          className="shrink-0 rounded p-0.5 transition-colors cursor-pointer hover:brightness-125 disabled:opacity-60 disabled:cursor-default"
        >
          <Star
            className={cn(
              "h-3.5 w-3.5",
              bounty.pinned ? "text-amber-300" : "text-[#a89a80]",
            )}
            fill={bounty.pinned ? "currentColor" : "none"}
          />
        </button>
        {bounty.priority && bounty.priority !== "unprioritized" && (
          <span className="shrink-0 flex items-center">
            <PriorityIcon priority={bounty.priority} />
          </span>
        )}
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-[#a89a80] transition-transform duration-150",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded && (
        <>
          {/* Quick 260727-v0b: inline status editor mirroring patch #154
              priority editor. Placed ABOVE Priority per Ashley's ask —
              status change is the higher-frequency edit. Patch #168:
              shows 4 options (in_progress / waiting_on_someone_else /
              done / dropped); "pinned" removed from the status enum. */}
          {onStatusChange && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--color-pv-fg-muted)] uppercase">
                Status
              </span>
              <StatusRow
                status={bounty.status}
                onChange={handleStatusChange}
                saving={savingStatus}
              />
              {statusError && (
                <div className="text-xs text-rose-300 whitespace-pre-wrap">
                  {statusError}
                </div>
              )}
            </div>
          )}

          {/* Patch #154: inline priority editor. Sits above the premise so
              it's the first thing in the expanded body — matches the
              frequency Ashley re-prioritizes vs. reads the premise. */}
          {onPriorityChange && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--color-pv-fg-muted)] uppercase">
                Priority
              </span>
              <PriorityRow
                priority={bounty.priority}
                onChange={handlePriorityChange}
                saving={savingPriority}
              />
              {priorityError && (
                <div className="text-xs text-rose-300 whitespace-pre-wrap">
                  {priorityError}
                </div>
              )}
            </div>
          )}

          {/* Quick 260727-wd0: Archive button — sibling of v0b's inline
              status editor on the archive axis. Live-status bounties get
              flipped to done + moved to bounties/archive/; terminal-status
              bounties (done/dropped) are moved as-is (status preserved).
              Only rendered when the parent supplies onArchive — deliberately
              withheld for cards already under the Archive accordion. */}
          {onArchive && (
            <div className="flex flex-col gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-xs text-[var(--color-pv-fg-muted)] hover:text-[#e8e4d8] self-start cursor-pointer"
                aria-label={`Archive bounty: ${bounty.title}`}
                disabled={savingArchive}
                onClick={() => void handleArchive()}
              >
                {savingArchive ? "Archiving…" : "Archive"}
              </Button>
              {archiveError && (
                <div className="text-xs text-rose-300 whitespace-pre-wrap">
                  {archiveError}
                </div>
              )}
            </div>
          )}

          {/* Quick 260729-g5r: Delete button — destructive sibling of
              Archive above. Gated by window.confirm() inside handleDelete
              (Cancel is a no-op, locked design D-3). Threaded to BOTH
              open and archived cards from IdentityModal — appears
              standalone on archived cards where Archive is withheld. */}
          {onDelete && (
            <div className="flex flex-col gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-xs text-rose-400 hover:text-rose-300 border-rose-400/40 hover:border-rose-400/60 self-start cursor-pointer"
                aria-label={`Delete bounty: ${bounty.title}`}
                disabled={savingDelete}
                onClick={() => void handleDelete()}
              >
                {savingDelete ? "Deleting…" : "Delete"}
              </Button>
              {deleteError && (
                <div className="text-xs text-rose-300 whitespace-pre-wrap">
                  {deleteError}
                </div>
              )}
            </div>
          )}

          {/* ── Title editor (Plan 05 / IDMEDIT-04) ──────────────────────── */}
          {onFieldsChange && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-[var(--color-pv-fg-muted)] uppercase">
                  Title
                </span>
                {!editingTitle && (
                  <button
                    type="button"
                    title="Edit title"
                    aria-label="Edit title"
                    onClick={startEditTitle}
                    className="cursor-pointer text-[var(--color-pv-fg-muted)] hover:text-[#e8e4d8] p-0.5 rounded"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
              </div>
              {editingTitle ? (
                <>
                  <Input
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={onTitleKeyDown}
                    disabled={savingTitle}
                    autoFocus
                    className="text-sm bg-white/5 border-white/20 text-[#f0ebe0]"
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      className="cursor-pointer"
                      disabled={savingTitle || titleDraft.trim() === bounty.title}
                      onClick={() => void saveTitle()}
                    >
                      {savingTitle ? "Saving…" : "Save"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="cursor-pointer"
                      disabled={savingTitle}
                      onClick={cancelEditTitle}
                    >
                      Cancel
                    </Button>
                  </div>
                  {titleError && (
                    <div className="text-xs text-rose-300 mt-1">{titleError}</div>
                  )}
                </>
              ) : (
                <span className="text-sm text-[#e8e4d8]/90">{bounty.title}</span>
              )}
              {pinnedError && (
                <div className="text-xs text-rose-300 whitespace-pre-wrap">
                  {pinnedError}
                </div>
              )}
            </div>
          )}

          {/* ── Premise block (with editor when onFieldsChange supplied) ──── */}
          {onFieldsChange ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-[var(--color-pv-fg-muted)] uppercase">
                  Premise
                </span>
                {!editingPremise && (
                  <button
                    type="button"
                    title="Edit premise"
                    aria-label="Edit premise"
                    onClick={startEditPremise}
                    className="cursor-pointer text-[var(--color-pv-fg-muted)] hover:text-[#e8e4d8] p-0.5 rounded"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
              </div>
              {editingPremise ? (
                <>
                  <Textarea
                    value={premiseDraft}
                    onChange={(e) => setPremiseDraft(e.target.value)}
                    onKeyDown={onPremiseKeyDown}
                    disabled={savingPremise}
                    rows={8}
                    autoFocus
                    className="text-sm font-mono bg-white/5 border-white/20 text-[#f0ebe0] resize-y"
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      className="cursor-pointer"
                      disabled={savingPremise || premiseDraft === bounty.premise}
                      onClick={() => void savePremise()}
                    >
                      {savingPremise ? "Saving…" : "Save"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="cursor-pointer"
                      disabled={savingPremise}
                      onClick={cancelEditPremise}
                    >
                      Cancel
                    </Button>
                  </div>
                  {premiseError && (
                    <div className="text-xs text-rose-300 mt-1">{premiseError}</div>
                  )}
                </>
              ) : bounty.premise ? (
                <div>
                  <div
                    className={cn(
                      "whitespace-pre-wrap text-sm text-[#e8e4d8]/90 leading-relaxed",
                      isLongPremise && !premiseExpanded && "line-clamp-4",
                    )}
                  >
                    {bounty.premise}
                  </div>
                  {isLongPremise && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs text-[#a89a80] hover:text-[#e8e4d8]"
                      onClick={() => setPremiseExpanded((v) => !v)}
                    >
                      {premiseExpanded ? "Show less" : "Show more"}
                    </Button>
                  )}
                </div>
              ) : (
                <span className="text-xs text-[var(--color-pv-fg-dim)] italic">No premise</span>
              )}
            </div>
          ) : (
            /* Read-only premise (no onFieldsChange) — byte-identical to original */
            bounty.premise && (
              <div>
                <div
                  className={cn(
                    "whitespace-pre-wrap text-sm text-[#e8e4d8]/90 leading-relaxed",
                    isLongPremise && !premiseExpanded && "line-clamp-4",
                  )}
                >
                  {bounty.premise}
                </div>
                {isLongPremise && (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs text-[#a89a80] hover:text-[#e8e4d8]"
                    onClick={() => setPremiseExpanded((v) => !v)}
                  >
                    {premiseExpanded ? "Show less" : "Show more"}
                  </Button>
                )}
              </div>
            )
          )}

          {/* ── Todos (editable when onFieldsChange supplied) ─────────────── */}
          {onFieldsChange ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-[var(--color-pv-fg-muted)] uppercase">
                  Todos
                </span>
                {savingTodos && (
                  <span className="text-[10px] text-[var(--color-pv-fg-dim)]">saving…</span>
                )}
              </div>
              <ul className="flex flex-col gap-1.5">
                {todosDraft.map((t, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-sm group">
                    {/* Reorder arrows */}
                    <div className="flex flex-col shrink-0">
                      <button
                        type="button"
                        onClick={() => handleTodoMoveUp(i)}
                        disabled={i === 0 || savingTodos}
                        title="Move up"
                        aria-label="Move todo up"
                        className="cursor-pointer text-[var(--color-pv-fg-dim)] hover:text-[#e8e4d8] disabled:opacity-30 disabled:cursor-default"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTodoMoveDown(i)}
                        disabled={i === todosDraft.length - 1 || savingTodos}
                        title="Move down"
                        aria-label="Move todo down"
                        className="cursor-pointer text-[var(--color-pv-fg-dim)] hover:text-[#e8e4d8] disabled:opacity-30 disabled:cursor-default"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                    </div>
                    <Checkbox
                      checked={t.done}
                      onCheckedChange={() => handleTodoToggle(i)}
                      disabled={savingTodos}
                      className="mt-0.5 cursor-pointer"
                    />
                    <Input
                      value={t.text}
                      onChange={(e) => handleTodoTextChange(i, e.target.value)}
                      onBlur={() => handleTodoTextBlur(i)}
                      disabled={savingTodos}
                      className={cn(
                        "flex-1 text-sm bg-white/5 border-white/10 text-[#e8e4d8]/90 h-7 px-2",
                        t.done && "line-through opacity-60",
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => handleTodoRemove(i)}
                      disabled={savingTodos}
                      title="Remove todo"
                      aria-label="Remove todo"
                      className="shrink-0 cursor-pointer text-[var(--color-pv-fg-dim)] hover:text-rose-300 disabled:opacity-30 disabled:cursor-default"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
              {/* Add-todo control */}
              <div className="flex items-center gap-1.5 mt-1">
                <Input
                  value={newTodoText}
                  onChange={(e) => setNewTodoText(e.target.value)}
                  onKeyDown={onNewTodoKeyDown}
                  placeholder="Add todo…"
                  disabled={savingTodos}
                  className="flex-1 text-sm bg-white/5 border-white/10 text-[#f0ebe0] h-7 px-2 placeholder:text-[var(--color-pv-fg-dim)]"
                />
                <button
                  type="button"
                  onClick={handleAddTodo}
                  disabled={savingTodos || !newTodoText.trim()}
                  title="Add todo"
                  aria-label="Add todo"
                  className="cursor-pointer text-[var(--color-pv-fg-muted)] hover:text-[#e8e4d8] disabled:opacity-30 disabled:cursor-default"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              {todosError && (
                <div className="text-xs text-rose-300 mt-1">{todosError}</div>
              )}
            </div>
          ) : (
            /* Read-only todos (no onFieldsChange) — byte-identical to original */
            bounty.todos.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[var(--color-pv-fg-muted)] uppercase">
                  Todos
                </span>
                <ul className="flex flex-col gap-1">
                  {bounty.todos.map((t, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Checkbox
                        checked={t.done}
                        disabled
                        className="mt-0.5 cursor-default opacity-60"
                      />
                      <span
                        className={cn(
                          "text-[#e8e4d8]/90",
                          t.done && "line-through opacity-60",
                        )}
                      >
                        {t.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          )}

          {/* ── Keywords editor (Plan 05 / IDMEDIT-04) ───────────────────── */}
          {onFieldsChange && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-[var(--color-pv-fg-muted)] uppercase">
                  Keywords
                </span>
                {savingKeywords && (
                  <span className="text-[10px] text-[var(--color-pv-fg-dim)]">saving…</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 items-center">
                {keywordsDraft.map((kw, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="text-[11px] text-[#e8e4d8]/80 border-white/20 flex items-center gap-1 pr-1"
                  >
                    {kw}
                    <button
                      type="button"
                      onClick={() => handleRemoveKeyword(i)}
                      disabled={savingKeywords}
                      title={`Remove keyword: ${kw}`}
                      aria-label={`Remove keyword: ${kw}`}
                      className="cursor-pointer text-[var(--color-pv-fg-dim)] hover:text-rose-300 disabled:opacity-30 disabled:cursor-default"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </Badge>
                ))}
                <Input
                  value={newKeyword}
                  onChange={onNewKeywordChange}
                  onKeyDown={onNewKeywordKeyDown}
                  onBlur={() => { if (newKeyword.trim()) commitKeyword(newKeyword); }}
                  placeholder="Add keyword…"
                  disabled={savingKeywords || keywordsDraft.length >= 20}
                  className="w-32 text-xs bg-white/5 border-white/10 text-[#f0ebe0] h-6 px-2 placeholder:text-[var(--color-pv-fg-dim)]"
                />
              </div>
              {keywordsError && (
                <div className="text-xs text-rose-300 mt-1">{keywordsError}</div>
              )}
            </div>
          )}

          {/* ── Source links editor (Plan 05 / IDMEDIT-04, T-18-26) ───────── */}
          {onFieldsChange && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-[var(--color-pv-fg-muted)] uppercase">
                  Source Links
                </span>
                {savingSourceLinks && (
                  <span className="text-[10px] text-[var(--color-pv-fg-dim)]">saving…</span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                {sourceLinksDraft.map((link, i) => (
                  <div key={i} className="flex items-center gap-1.5 group">
                    <a
                      href={safeHref(link)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-300 hover:text-blue-200 underline truncate flex-1 min-w-0"
                      title={link}
                    >
                      {link}
                    </a>
                    <button
                      type="button"
                      onClick={() => handleRemoveSourceLink(i)}
                      disabled={savingSourceLinks}
                      title={`Remove link: ${link}`}
                      aria-label={`Remove link: ${link}`}
                      className="shrink-0 cursor-pointer text-[var(--color-pv-fg-dim)] hover:text-rose-300 disabled:opacity-30 disabled:cursor-default"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-1.5">
                  <Input
                    value={newSourceLink}
                    onChange={(e) => { setNewSourceLink(e.target.value); setNewSourceLinkError(null); }}
                    onKeyDown={onNewSourceLinkKeyDown}
                    onBlur={onNewSourceLinkBlur}
                    placeholder="Add link (URL)…"
                    disabled={savingSourceLinks}
                    className="flex-1 text-xs bg-white/5 border-white/10 text-[#f0ebe0] h-7 px-2 placeholder:text-[var(--color-pv-fg-dim)]"
                  />
                  <button
                    type="button"
                    onClick={() => commitSourceLink(newSourceLink)}
                    disabled={savingSourceLinks || !newSourceLink.trim()}
                    title="Add link"
                    aria-label="Add link"
                    className="cursor-pointer text-[var(--color-pv-fg-muted)] hover:text-[#e8e4d8] disabled:opacity-30 disabled:cursor-default"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                {newSourceLinkError && (
                  <div className="text-xs text-rose-300 mt-1">{newSourceLinkError}</div>
                )}
                {sourceLinksError && (
                  <div className="text-xs text-rose-300 mt-1">{sourceLinksError}</div>
                )}
              </div>
            </div>
          )}

          {/* ── Source links read-only display (no onFieldsChange) ─────────
              Per T-18-26: safeHref used even in read-only mode. */}
          {!onFieldsChange && bounty.source_links.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--color-pv-fg-muted)] uppercase">
                Source Links
              </span>
              <ul className="flex flex-col gap-0.5">
                {bounty.source_links.map((link, i) => (
                  <li key={i}>
                    <a
                      href={safeHref(link)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-300 hover:text-blue-200 underline break-all"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Deadline editor (Plan 05 / IDMEDIT-04) ───────────────────── */}
          {onFieldsChange && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-[var(--color-pv-fg-muted)] uppercase">
                  Deadline
                </span>
                {savingDeadline && (
                  <span className="text-[10px] text-[var(--color-pv-fg-dim)]">saving…</span>
                )}
              </div>
              <Input
                type="date"
                defaultValue={deadlineValue}
                key={deadlineValue} /* re-mount when bounty updates to sync value */
                onChange={handleDeadlineChange}
                disabled={savingDeadline}
                className="w-44 text-sm bg-white/5 border-white/20 text-[#f0ebe0] h-7 px-2"
              />
              {deadlineError && (
                <div className="text-xs text-rose-300 mt-1">{deadlineError}</div>
              )}
            </div>
          )}

          {/* ── Needs desk toggle (this quick) ────────────────────────────
              User-reserved boolean; flip is the whole write surface. Autosave
              on change, saving indicator + error line mirror the deadline row
              above. */}
          {onNeedsDeskChange && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-sm text-[#e8e4d8]/90 w-fit">
                <Checkbox
                  checked={bounty.needs_desk ?? false}
                  onCheckedChange={(v) => void handleNeedsDeskChange(v === true)}
                  disabled={savingNeedsDesk}
                  aria-label={(bounty.needs_desk ?? false) ? "Unset needs desk" : "Set needs desk"}
                />
                <span>Needs desk</span>
                {savingNeedsDesk && (
                  <span className="text-[10px] text-[var(--color-pv-fg-dim)]">saving…</span>
                )}
              </div>
              {needsDeskError && (
                <div className="text-xs text-rose-300">{needsDeskError}</div>
              )}
            </div>
          )}

          {/* ── Meeting questions editor (Plan 05 / IDMEDIT-08) ──────────── */}
          {onFieldsChange && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-[var(--color-pv-fg-muted)] uppercase">
                  Meeting Questions
                </span>
                {savingMeetingQuestions && (
                  <span className="text-[10px] text-[var(--color-pv-fg-dim)]">saving…</span>
                )}
              </div>
              <ul className="flex flex-col gap-1.5">
                {meetingQuestionsDraft.map((q, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Checkbox
                      checked={q.answered}
                      onCheckedChange={() => handleMeetingQuestionToggleAnswered(i)}
                      disabled={savingMeetingQuestions}
                      className="mt-0.5 cursor-pointer"
                      title="Mark as answered"
                    />
                    <span
                      className={cn(
                        "flex-1 text-[#e8e4d8]/90 text-sm leading-snug",
                        q.answered && "line-through opacity-60",
                      )}
                    >
                      {q.text}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveMeetingQuestion(i)}
                      disabled={savingMeetingQuestions}
                      title="Remove question"
                      aria-label="Remove question"
                      className="shrink-0 cursor-pointer text-[var(--color-pv-fg-dim)] hover:text-rose-300 disabled:opacity-30 disabled:cursor-default"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
              {/* Add question control */}
              <div className="flex items-center gap-1.5 mt-1">
                <Input
                  value={newMeetingQuestion}
                  onChange={(e) => setNewMeetingQuestion(e.target.value)}
                  onKeyDown={onNewMeetingQuestionKeyDown}
                  placeholder="Add meeting question…"
                  disabled={savingMeetingQuestions}
                  className="flex-1 text-sm bg-white/5 border-white/10 text-[#f0ebe0] h-7 px-2 placeholder:text-[var(--color-pv-fg-dim)]"
                />
                <button
                  type="button"
                  onClick={handleAddMeetingQuestion}
                  disabled={savingMeetingQuestions || !newMeetingQuestion.trim()}
                  title="Add question"
                  aria-label="Add question"
                  className="cursor-pointer text-[var(--color-pv-fg-muted)] hover:text-[#e8e4d8] disabled:opacity-30 disabled:cursor-default"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              {meetingQuestionsError && (
                <div className="text-xs text-rose-300 mt-1">{meetingQuestionsError}</div>
              )}
            </div>
          )}

          {/* Timeline tail */}
          {latestTimeline && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--color-pv-fg-muted)] uppercase">
                Latest
              </span>
              <div
                className="text-xs text-[var(--color-pv-fg-dim)] font-mono whitespace-pre-wrap break-words"
                title={latestTimeline}
              >
                {truncatedTimeline}
              </div>
            </div>
          )}

          {/* Footer: updated_at */}
          {bounty.updated_at && (
            <div className="text-[10px] text-[var(--color-pv-fg-dim)] font-mono">
              {new Date(bounty.updated_at).toLocaleString()}
            </div>
          )}
        </>
      )}
    </div>
  );
}
