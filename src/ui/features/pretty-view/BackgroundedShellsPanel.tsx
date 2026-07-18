import { Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BackgroundedShell } from "@/api/claude-session-api";

// Read-only display of currently-running Bash{run_in_background:true}
// shell invocations from the tailed Claude Code session. Sits directly
// above the ComposeBox as a sibling to BackgroundedAgentsPanel and takes
// real layout space — it is NOT an overlay. Mounts only when the input
// list is non-empty; callers guard on that so this component never renders
// empty.
//
// Design decisions (locked with Ashley 2026-07-18):
//   - Above compose, in-flow — matches BackgroundedAgentsPanel's placement.
//   - Sibling to BackgroundedAgentsPanel, not folded in — different mental
//     models (agents are LLM subagents; shells are raw commands).
//   - Hidden entirely when no running shells. Zero-chrome empty state.
//   - Static Terminal glyph — motion channel is owned by WipBubble
//     (patch #53's rationale). Stacking spinners is visually ambiguous.
//   - Label: description as primary; if description is empty, use the
//     truncated command as primary. If BOTH are present, description is
//     primary and command renders as a small muted-monospace line below.
//   - Scope (patch #68): Bash{run_in_background:true} ONLY. NEVER Monitor.

export interface BackgroundedShellsPanelProps {
  shells: BackgroundedShell[]; // already-filtered (currently running)
  className?: string;
}

export function BackgroundedShellsPanel({
  shells,
  className,
}: BackgroundedShellsPanelProps) {
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
      aria-label="Backgrounded shells"
    >
      <div className="py-1 text-xs font-medium text-[var(--color-pv-fg-muted)] uppercase tracking-wide flex items-center gap-2">
        <span>Shells</span>
        <span className="text-[var(--color-pv-fg-dim)] normal-case font-normal">
          ({shells.length})
        </span>
      </div>
      <ul className="pb-1 flex flex-col gap-1">
        {shells.map((s) => {
          const primary = s.description || s.command || "Shell";
          const showCommandLine =
            !!s.description && !!s.command && s.command !== s.description;
          return (
            <li
              key={s.toolUseId}
              className="flex items-start gap-2 text-sm leading-snug"
              title={s.command || undefined}
            >
              <Terminal className="size-3.5 shrink-0 text-primary mt-0.5" />
              <span className="min-w-0 flex flex-col gap-0.5">
                <span className="text-[var(--color-pv-fg)]/90 break-words">
                  {primary}
                </span>
                {showCommandLine && (
                  <code className="text-xs text-[var(--color-pv-fg-dim)] font-mono break-all">
                    {s.command}
                  </code>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
