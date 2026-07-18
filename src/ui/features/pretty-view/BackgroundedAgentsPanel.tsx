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
        // Phase 4 Glass: shared ambient-panel-shelf treatment (VISUAL-05).
        "shrink-0 max-h-40 overflow-y-auto",
        "mx-3 my-1 px-3 py-1.5",
        "bg-[linear-gradient(160deg,var(--color-pv-surface-quiet),var(--color-pv-surface-quiet-alt))]",
        "border border-[var(--color-pv-border-quiet)]",
        "rounded-[var(--radius-pv-card)]",
        "shadow-[var(--shadow-pv-quiet-card)]",
        "backdrop-blur-md",
        "[-webkit-backdrop-filter:blur(12px)]",
        className,
      )}
      aria-label="Backgrounded agents"
    >
      <div className="py-1 text-xs font-medium text-[var(--color-pv-fg-muted)] uppercase tracking-wide flex items-center gap-2">
        <span>Agents</span>
        <span className="text-[var(--color-pv-fg-dim)] normal-case font-normal">
          ({agents.length})
        </span>
      </div>
      <ul className="pb-1 flex flex-col gap-1">
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
                {/* Phase 4: subagentType tag picks up the per-pane identity
                    hue so the panel visually ties to the pane it belongs
                    to (VISUAL-03 color-chain). */}
                <span
                  className={cn(
                    "text-[10px] font-medium uppercase tracking-wide shrink-0",
                    "px-1.5 py-0.5 rounded-sm",
                    "bg-[rgba(255,240,215,0.08)]",
                    "border border-[rgba(255,240,215,0.16)]",
                    "text-[rgba(232,220,190,1)]",
                  )}
                >
                  {tag}
                </span>
                <span className="text-[var(--color-pv-fg)]/90 break-words">
                  {label}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
