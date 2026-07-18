import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BackgroundedAgent } from "@/api/claude-session-api";

// Read-only display of currently-running Agent{run_in_background:true}
// subagent invocations from the tailed Claude Code session. Sits directly
// above the ComposeBox (and below HarnessTasksPanel when both are
// visible) and takes real layout space — it is NOT an overlay. Mounts
// only when the input list is non-empty; callers guard on that so this
// component never renders empty.
//
// Design decisions (locked with Ashley 2026-07-18):
//   - Above compose, in-flow — matches HarnessTasksPanel's placement.
//   - Sibling to HarnessTasksPanel, not folded in — different mental
//     models (tasks are planned; agents are happening right now).
//   - Hidden entirely when no running agents. Zero-chrome empty state.
//   - Static ArrowRight glyph — motion channel is owned by WipBubble
//     (patch #53's rationale). Stacking spinners is visually ambiguous.
//   - Label: subagentType (e.g. "Explore", "general-purpose") as a
//     muted small tag, then description as the main text. Fallback
//     shows just subagentType if description is empty, or the string
//     "Agent" if both are empty.

export interface BackgroundedAgentsPanelProps {
  agents: BackgroundedAgent[]; // already-filtered (currently running)
  className?: string;
}

export function BackgroundedAgentsPanel({
  agents,
  className,
}: BackgroundedAgentsPanelProps) {
  return (
    <div
      className={cn(
        "border-t border-border bg-muted/30 shrink-0 max-h-40 overflow-y-auto",
        className,
      )}
      aria-label="Backgrounded agents"
    >
      <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
        <span>Agents</span>
        <span className="text-muted-foreground/70 normal-case font-normal">
          ({agents.length})
        </span>
      </div>
      <ul className="px-3 pb-2 flex flex-col gap-1">
        {agents.map((a) => {
          const tag = a.subagentType || "Agent";
          const label = a.description || a.subagentType || "Agent";
          return (
            <li
              key={a.toolUseId}
              className="flex items-start gap-2 text-sm leading-snug"
              title={
                a.description && a.description !== a.subagentType
                  ? a.description
                  : undefined
              }
            >
              <ArrowRight className="size-3.5 shrink-0 text-primary mt-0.5" />
              <span className="min-w-0 flex items-baseline gap-2 flex-wrap">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0">
                  {tag}
                </span>
                <span className="text-foreground/90 break-words">{label}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
