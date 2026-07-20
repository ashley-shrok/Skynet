import { Skeleton } from "@/components/skeleton";
import type { TabState } from "./IdentityFileTab";

// Patch #17g: tab renderer for the identity's history.md (reverse-chronological list).
//
// Each line is parsed on `·` (space-middle-dot-space) into:
//   date (muted mono) | gist (main text) | slugs (pill chips, not clickable in v1).
// Lines that don't match the format fall back to raw text in the gist slot.
//
// History.md format (per ~/.claude/skills/id/SKILL.md):
//   YYYY-MM-DD · gist · slugs: foo,bar
// The slugs field is optional — 2-field variant is valid.

function parseHistoryLine(line: string): { date?: string; gist: string; slugs: string[] } {
  const parts = line.split(" · ");
  if (parts.length >= 3) {
    const date = parts[0];
    const gist = parts[1];
    const slugField = parts.slice(2).join(" · "); // rejoin in case gist had · in it — take last part as slugs
    const slugsRaw = slugField.replace(/^slugs:\s*/i, "");
    const slugs = slugsRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return { date, gist, slugs };
  }
  if (parts.length === 2) {
    return { date: parts[0], gist: parts[1], slugs: [] };
  }
  // Fallback: raw line, no date or slugs
  return { gist: line, slugs: [] };
}

export function HistoryTab({ state }: { state: TabState<string[]> }) {
  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-full rounded-[var(--radius-pv-bubble)]" />
        <Skeleton className="h-8 w-full rounded-[var(--radius-pv-bubble)]" />
        <Skeleton className="h-8 w-full rounded-[var(--radius-pv-bubble)]" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="text-sm text-destructive">
        Couldn&apos;t load history: {state.error}
      </div>
    );
  }

  if (state.data.length === 0) {
    return (
      <div className="text-sm text-[var(--color-pv-fg-muted)]">
        No history yet.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {state.data.map((line, i) => {
        const { date, gist, slugs } = parseHistoryLine(line);
        return (
          <li
            key={i}
            className="flex items-start gap-2 flex-wrap py-1 border-b border-white/[0.04]"
          >
            {date && (
              <span className="text-xs text-[var(--color-pv-fg-dim)] font-mono shrink-0">
                {date}
              </span>
            )}
            <span className="text-sm text-[#e8e4d8]/90 flex-1">{gist}</span>
            {slugs.map((slug) => (
              <span
                key={slug}
                className="px-2 py-0.5 rounded-full text-[10px] bg-white/[0.08] border border-white/10 text-[#a89a80]"
              >
                {slug}
              </span>
            ))}
          </li>
        );
      })}
    </ul>
  );
}
