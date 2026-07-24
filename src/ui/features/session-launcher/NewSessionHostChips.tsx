import { Terminal } from "lucide-react";
import type { Host } from "@/types/ui-types";

interface NewSessionHostChipsProps {
  hosts: Host[];
  onSelect: (host: Host) => void;
}

// Any SSH host can be a terminal launch target. autoTmux hosts route through
// the named-session dialog; non-autoTmux ones (e.g. Windows) open a plain
// terminal directly — that branching lives at the callsite.
export function isSshLaunchableHost(h: Host): boolean {
  return Boolean(h.enableSsh);
}

// Subset of the above: hosts where Skynet will start/attach a named tmux
// session on connect. The click handler uses this to decide whether to pop
// the name dialog vs. open a plain terminal.
export function isAutoTmuxHost(h: Host): boolean {
  return Boolean(h.enableSsh && h.terminalConfig?.autoTmux === true);
}

// Mirrors RemoteHostChips visually (same chip styling, same row layout)
// so the two surfaces feel like a single chip rail of host actions.
export function NewSessionHostChips({
  hosts,
  onSelect,
}: NewSessionHostChipsProps) {
  if (hosts.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">
        New Session
      </div>
      <div className="flex flex-wrap gap-2">
        {hosts.map((h) => {
          const tmux = isAutoTmuxHost(h);
          return (
            <button
              key={h.id}
              onClick={() => onSelect(h)}
              className="inline-flex items-center gap-2 px-3 py-1.5 border border-border bg-muted hover:bg-muted/50 text-xs cursor-pointer transition-colors"
              title={
                tmux
                  ? "Open named tmux session"
                  : "Open terminal (no tmux on this host)"
              }
            >
              <Terminal className="size-3 text-accent-brand shrink-0" />
              <span className="truncate">{h.name || h.ip}</span>
              {tmux && (
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
                  tmux
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
