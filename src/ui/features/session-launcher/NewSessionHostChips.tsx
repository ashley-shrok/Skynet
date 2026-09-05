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
  return Boolean(h.enableSsh && h.terminalConfig?.autoTmux !== false);
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
      <div className="text-[10px] uppercase tracking-widest font-semibold text-[color:var(--color-pv-fg-muted)]">
        New Session
      </div>
      <div className="flex flex-wrap gap-2">
        {hosts.map((h) => {
          const tmux = isAutoTmuxHost(h);
          return (
            <button
              key={h.id}
              onClick={() => onSelect(h)}
              className="inline-flex items-center gap-2 px-3 py-1.5 border border-[color:var(--color-pv-border-quiet-strong)] bg-[color:var(--color-pv-surface-quiet)] hover:bg-[hsla(var(--pv-hue,35),40%,25%,0.18)] text-xs cursor-pointer transition-colors"
              title={
                tmux
                  ? "Open named tmux session"
                  : "Open terminal (no tmux on this host)"
              }
            >
              <Terminal className="size-3 text-[color:var(--color-pv-code-fg)] shrink-0" />
              <span className="truncate">{h.name || h.ip}</span>
              {tmux && (
                <span className="text-[9px] uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]">
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
