import { useState } from "react";
import { Flame, ChevronsUp, ChevronUp, Minus, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/checkbox";
import { Button } from "@/components/button";
import type { Bounty } from "@/api/claude-session-api";

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

const STATUS_CLASSES: Record<string, string> = {
  in_progress:
    "bg-emerald-500/25 text-emerald-200 border border-emerald-500/40",
  on_deck: "bg-amber-500/25 text-amber-200 border border-amber-500/40",
  waiting_on_someone_else:
    "bg-violet-500/25 text-violet-200 border border-violet-500/40",
  done: "bg-slate-500/25 text-slate-300 border border-slate-500/40",
  dropped:
    "bg-rose-500/20 text-rose-300 border border-rose-500/30 line-through",
};

const STATUS_LABELS: Record<string, string> = {
  in_progress: "In Progress",
  on_deck: "On Deck",
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
    default:
      return null;
  }
}

export function BountyCard({
  bounty,
  hue,
  archived = false,
}: {
  bounty: Bounty;
  hue: number;
  archived?: boolean;
}) {
  const [premiseExpanded, setPremiseExpanded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const isLongPremise = bounty.premise.length > 400;

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
        <span
          className="font-semibold text-[15px] text-[#f0ebe0] flex-1 min-w-0"
        >
          {bounty.title}
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
