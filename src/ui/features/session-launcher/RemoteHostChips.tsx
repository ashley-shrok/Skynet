import { Monitor } from "lucide-react";
import type { Host, TabType } from "@/types/ui-types";

interface RemoteHostChipsProps {
  hosts: Host[];
  onSelect: (host: Host, type: TabType) => void;
}

// Helpers exported so callers can filter/check without duplicating the
// enable-flag fan-out logic.
export function isProtocolHost(h: Host): boolean {
  return Boolean(h.enableRdp || h.enableVnc || h.enableTelnet);
}

export function protocolFor(h: Host): TabType {
  if (h.enableRdp) return "rdp";
  if (h.enableVnc) return "vnc";
  return "telnet";
}

// Compact row of clickable chips for RDP/VNC/Telnet hosts. Rendered above
// the tmux-session list on both the dashboard and the command-palette so
// the user has the same one-click access to remote-desktop hosts that
// sessions already give them for SSH hosts.
export function RemoteHostChips({ hosts, onSelect }: RemoteHostChipsProps) {
  if (hosts.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">
        Remote Desktops
      </div>
      <div className="flex flex-wrap gap-2">
        {hosts.map((h) => {
          const protocol = protocolFor(h);
          return (
            <button
              key={h.id}
              onClick={() => onSelect(h, protocol)}
              className="inline-flex items-center gap-2 px-3 py-1.5 border border-border bg-muted hover:bg-muted/50 text-xs cursor-pointer transition-colors"
            >
              <Monitor className="size-3 text-accent-brand shrink-0" />
              <span className="truncate">{h.name}</span>
              {protocol !== "rdp" && (
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
                  {protocol}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
