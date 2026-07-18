import { Circle, CircleDot, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HarnessTask } from "@/api/claude-session-api";

// Read-only display of Claude Code's harness task list (populated by
// TaskCreate + /queue). Sits directly above the ComposeBox and takes
// real layout space — it is NOT an overlay. Mounts only when the
// filtered list (pending + in_progress) is non-empty; callers guard
// on that so this component never renders empty.
//
// Design decisions (locked with Ashley 2026-07-18):
//   - Above compose, in-flow — not a floating panel, not a chord-toggled drawer.
//   - Hidden entirely when no non-completed tasks. Zero-chrome empty state.
//   - Read-only for v1. No edit / complete / add affordances. The client
//     that owns writes to ~/.claude/tasks/ is Claude Code itself, and racing
//     it from Termix is not worth v1 complexity.
//   - Compact rows so N tasks don't devour vertical space. subject only,
//     one row each. activeForm swaps in for the in-progress task's subject.

export interface HarnessTasksPanelProps {
  tasks: HarnessTask[]; // already-filtered (pending + in_progress)
  className?: string;
}

function statusIcon(status: string) {
  if (status === "in_progress") {
    return <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />;
  }
  if (status === "completed") {
    // completed shouldn't reach us (parent filters), but render defensively
    return <CircleDot className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  return <Circle className="size-3.5 shrink-0 text-muted-foreground" />;
}

export function HarnessTasksPanel({ tasks, className }: HarnessTasksPanelProps) {
  return (
    <div
      className={cn(
        "border-t border-border bg-muted/30 shrink-0 max-h-40 overflow-y-auto",
        className,
      )}
      aria-label="Harness tasks"
    >
      <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
        <span>Tasks</span>
        <span className="text-muted-foreground/70 normal-case font-normal">
          ({tasks.length})
        </span>
      </div>
      <ul className="px-3 pb-2 flex flex-col gap-1">
        {tasks.map((t) => {
          // In-progress tasks: show activeForm ("Refactoring foo") over the
          // subject ("Refactor foo") when present — that's Claude Code's own
          // convention. Fall back to subject.
          const label =
            t.status === "in_progress" && t.activeForm ? t.activeForm : t.subject;
          return (
            <li
              key={t.id}
              className="flex items-start gap-2 text-sm leading-snug"
              title={t.description && t.description !== t.subject ? t.description : undefined}
            >
              {statusIcon(t.status)}
              <span
                className={cn(
                  "break-words",
                  t.status === "in_progress" && "text-foreground font-medium",
                  t.status === "pending" && "text-foreground/90",
                )}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
