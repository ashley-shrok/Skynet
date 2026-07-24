import { Skeleton } from "@/components/skeleton";
import { cn } from "@/lib/utils";
import type { Wakeup } from "@/api/claude-session-api";
import type { TabState } from "./IdentityFileTab";

// Patch #17g: tab renderer for the identity's wakeups/*.json files.
//
// Card treatment mirrors BountyCard's glass token family:
//   rounded-[var(--radius-pv-bubble)], backdrop-blur-lg saturate-[1.3],
//   Inter font, hue linear-gradient background, hue border + boxShadow.
//
// scheduleHuman is server-humanized (humanizeWakeupSchedule in backend) —
// no client-side re-humanization here.

export function WakeupsTab({
  state,
  hue,
}: {
  state: TabState<Wakeup[]>;
  hue: number;
}) {
  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full rounded-[var(--radius-pv-bubble)]" />
        <Skeleton className="h-24 w-full rounded-[var(--radius-pv-bubble)]" />
        <Skeleton className="h-24 w-full rounded-[var(--radius-pv-bubble)]" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="text-sm text-[color:var(--color-pv-code-fg)]">
        Couldn&apos;t load wakeups: {state.error}
      </div>
    );
  }

  if (state.data.length === 0) {
    return (
      <div className="text-sm text-[var(--color-pv-fg-muted)]">
        No scheduled wake-ups.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {state.data.map((wakeup, i) => (
        <div
          key={i}
          className={cn(
            "rounded-[var(--radius-pv-bubble)] px-4 py-3 flex flex-col gap-2",
            "backdrop-blur-lg saturate-[1.3] [-webkit-backdrop-filter:blur(16px)_saturate(1.3)]",
            "font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif]",
          )}
          style={{
            background: `linear-gradient(160deg, hsla(${hue}, 40%, 22%, 0.5), hsla(${hue}, 35%, 14%, 0.55))`,
            border: `1px solid hsla(${hue}, 60%, 50%, 0.24)`,
            boxShadow: "0 4px 16px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,220,170,0.10)",
          }}
        >
          {/* Row 1: name + enabled chip */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[15px] text-[#f0ebe0] flex-1">
              {wakeup.name}
            </span>
            {wakeup.enabled ? (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-medium uppercase tracking-wide bg-emerald-500/25 text-emerald-200 border border-emerald-500/40">
                on
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-medium uppercase tracking-wide bg-slate-500/25 text-slate-300 border border-slate-500/40">
                off
              </span>
            )}
          </div>
          {/* Row 2: schedule human */}
          <div>
            <span className="text-xs text-[var(--color-pv-fg-muted)] font-mono">
              {wakeup.scheduleHuman}
            </span>
          </div>
          {/* Row 3: instruction prose */}
          {wakeup.instruction && (
            <div className="whitespace-pre-wrap text-sm text-[#e8e4d8]/90 leading-relaxed">
              {wakeup.instruction}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
