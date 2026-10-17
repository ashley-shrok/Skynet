// Hold-to-record feedback pill — floats above the compose box, right-aligned,
// while a mic hold is committed: "● Recording 0:03 · release to send · slide
// off to cancel", switching to "Release to cancel" once the pointer slides
// outside the release-to-send zone. After release it briefly shows
// "Sending…" or "Cancelled". Visual only — the hold gesture lives in
// useHoldToRecord.

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { HoldOutcome } from "./useHoldToRecord";

export interface HoldFeedback {
  committed: boolean;
  outside: boolean;
  outcome: HoldOutcome | null;
}

export function HoldFeedbackPill({ committed, outside, outcome }: HoldFeedback) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!committed) {
      setStartedAt(null);
      return;
    }
    setStartedAt(Date.now());
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [committed]);

  if (!committed && !outcome) return null;

  let dotClass: string;
  let message: string;
  let elapsed = "";
  let hint = "";
  if (committed) {
    message = outside ? "Release to cancel" : "Recording";
    hint = outside ? "slide back to keep" : "release to send · slide off to cancel";
    dotClass = outside ? "bg-[#888]" : "bg-[#ff5c5c] pv-hold-dot";
    if (!outside && startedAt !== null) {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      elapsed = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }
  } else {
    message = outcome === "send" ? "Sending…" : "Cancelled";
    dotClass = outcome === "send" ? "bg-[var(--color-pv-code-fg)]" : "bg-[#888]";
  }

  // Zero-height anchor: adds no height and cancels the compose root's gap-1,
  // so mounting it never shifts the compose layout.
  return (
    <div className="relative h-0 -mb-1" aria-live="polite">
      <div
        data-testid="hold-feedback-pill"
        className={cn(
          "pv-hold-pill absolute bottom-full right-4 mb-1 z-50 pointer-events-none",
          "flex items-center gap-2.5 px-3.5 py-2 rounded-full whitespace-nowrap",
          "bg-[#1d1b19ee] text-[#f0ebe0] text-sm font-medium leading-tight",
          "shadow-[0_4px_18px_rgba(0,0,0,0.45)]",
        )}
      >
        <span className={cn("size-2.5 rounded-full", dotClass)} aria-hidden="true" />
        <span>{message}</span>
        {elapsed && <span className="tabular-nums opacity-70">{elapsed}</span>}
        {hint && <span className="text-xs opacity-60">{hint}</span>}
      </div>
    </div>
  );
}
