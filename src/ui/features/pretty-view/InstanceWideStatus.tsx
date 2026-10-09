import { useState } from "react";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { syncSummary, type InstanceWideItem } from "@/api/instance-wide-api";

// Marker + quiet sync status for an instance-wide skill or role.
//
// Always shows an "instance-wide" chip. When every host is current that's all
// it shows; otherwise a warning chip ("2 hosts behind", "1 conflict") that
// toggles a per-host detail list. No alerts — visible when you look.

export function InstanceWideChip({ className }: { className?: string }): JSX.Element {
  return (
    <span
      title="Managed instance-wide: one master copy, kept in step on every host"
      data-testid="instance-wide-chip"
      className={cn(
        "shrink-0 inline-flex items-center gap-1 whitespace-nowrap text-[11px] px-2 py-0.5 rounded-full",
        "text-[#d9f2e6] bg-[rgba(52,168,120,0.28)] border border-[rgba(90,200,150,0.45)]",
        className,
      )}
    >
      <Globe size={11} /> instance-wide
    </span>
  );
}

export function InstanceWideSyncStatus({ item }: { item: InstanceWideItem }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const summary = syncSummary(item);
  if (!summary) return null;
  // Non-admins get counts only (no per-host detail), so nothing to open.
  if (item.hosts.length === 0) {
    return (
      <span
        data-testid="instance-wide-sync-warning"
        className="shrink-0 whitespace-nowrap text-[11px] px-2 py-0.5 rounded-full text-[#fde7c2] bg-[rgba(200,130,40,0.30)] border border-[rgba(230,160,70,0.5)]"
      >
        {summary}
      </span>
    );
  }
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="instance-wide-sync-warning"
        title="Show which hosts"
        className={cn(
          "whitespace-nowrap text-[11px] px-2 py-0.5 rounded-full cursor-pointer",
          "text-[#fde7c2] bg-[rgba(200,130,40,0.30)] border border-[rgba(230,160,70,0.5)]",
        )}
      >
        {summary}
      </button>
      {open && (
        <div
          data-testid="instance-wide-sync-detail"
          className={cn(
            "absolute right-0 top-full mt-1 z-50 w-72 max-w-[80vw] rounded-md p-2",
            "bg-[#1a1a1a] border border-white/15 shadow-lg text-[12px] text-[#e8e4d8]",
          )}
        >
          {item.hosts
            .filter((h) => h.state !== "current")
            .map((h) => (
              <div key={h.machineId} className="py-1 border-b border-white/5 last:border-b-0">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{h.hostName}</span>
                  <span className="opacity-70">{h.state}</span>
                </div>
                {h.detail && <div className="opacity-60 text-[11px]">{h.detail}</div>}
                {h.conflicts && h.conflicts.length > 0 && (
                  <div className="opacity-60 text-[11px] break-all">
                    Set-aside copies: {h.conflicts.join(", ")} — delete them once resolved.
                  </div>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
