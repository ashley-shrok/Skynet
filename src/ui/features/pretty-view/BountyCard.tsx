import { useState } from "react";
import { Flame, ChevronsUp, ChevronUp, Minus, ChevronDown, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/checkbox";
import { Button } from "@/components/button";
import {
  BOUNTY_PRIORITY_VALUES,
  BOUNTY_STATUS_VALUES,
  type Bounty,
  type BountyPriority,
  type BountyStatus,
} from "@/api/claude-session-api";

// Patch #87: per-bounty card for the IdentityModal Bounties tab.
//
// Props:
//   bounty  — the Bounty object from the WS response
//   hue     — numeric identity hue (0-360), same source as IdentityBadge lg
//   archived — when true, the whole card is rendered at opacity-70 (de-emphasized)
//
// Todos are rendered as DISABLED shadcn Checkboxes (read-only per D-07).
// Premise collapses to 4 lines when > 400 chars; "Show more/less" toggle below.
// Timeline shows the LAST element of the timeline[] array (D-10).
// Priority indicator uses lucide glyphs only — no text glyph, bare icon (D-14 note on
// bare-glyph-for-indicator pattern from patch #72).

// Patch #168: "pinned" removed from STATUS_CLASSES and STATUS_LABELS —
// it is now an independent boolean field, not a status enum value.
// The per-row pin glyph (PrettyConversationRow + bounty badge) handles
// the pinned indicator separately.
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

export function BountyCard({
  bounty,
  hue,
  archived = false,
  onPriorityChange,
  onStatusChange,
  onArchive,
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
  /** Quick 260727-wd0: when supplied, expanded body renders an Archive
   *  button below the Priority row. Only supplied for OPEN cards; archived
   *  cards do NOT get the button (unarchive is a follow-up quick). */
  onArchive?: () => Promise<void>;
}) {
  const [premiseExpanded, setPremiseExpanded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [savingPriority, setSavingPriority] = useState(false);
  const [priorityError, setPriorityError] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [savingArchive, setSavingArchive] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
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
                className="text-xs text-[var(--color-pv-fg-muted)] hover:text-[#e8e4d8] self-start"
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

          {/* Premise block */}
          {bounty.premise && (
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
          )}

          {/* Todos */}
          {bounty.todos.length > 0 && (
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
