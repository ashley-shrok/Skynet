import { Terminal } from "lucide-react";
import type { Host } from "@/types/ui-types";

interface NewSessionHostChipsProps {
  hosts: Host[];
  onSelect: (host: Host) => void;
}

// SSH+autoTmux hosts only — clicking a chip kicks off the
// name-only NewSessionDialog flow.
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
        {hosts.map((h) => (
          <button
            key={h.id}
            onClick={() => onSelect(h)}
            className="inline-flex items-center gap-2 px-3 py-1.5 border border-border bg-muted hover:bg-muted/50 text-xs cursor-pointer transition-colors"
          >
            <Terminal className="size-3 text-accent-brand shrink-0" />
            <span className="truncate">{h.name || h.ip}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
