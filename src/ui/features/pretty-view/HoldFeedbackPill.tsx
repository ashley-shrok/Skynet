// Recording feedback chip — sits in the composer's control row (after attach
// and skills) while dictation records. For a mic hold: "● Recording 0:03 ∿∿∿ · release to
// send · slide off to cancel", switching to "Release to cancel" once the
// pointer slides outside the release-to-send zone; after release it briefly
// shows "Sending…" or "Cancelled". For a tapped recording (`tap`) it is just
// "● Recording 0:03 ∿∿∿" — the controls live in the send slot. The ∿∿∿ is a
// live MicWaveform when `readLevel` is given, so a dead mic shows as a flat
// line. Visual only — the hold gesture lives in useHoldToRecord.

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { HoldOutcome } from "./useHoldToRecord";
import { MicWaveform } from "./MicWaveform";

export interface HoldFeedback {
  committed: boolean;
  outside: boolean;
  outcome: HoldOutcome | null;
  /** A tapped (not held) recording: no release/slide hints. */
  tap?: boolean;
}

export interface HoldFeedbackPillProps extends HoldFeedback {
  /** Live mic level for the waveform; omitted = no waveform. */
  readLevel?: () => number | null;
}

export function HoldFeedbackPill({ committed, outside, outcome, tap, readLevel }: HoldFeedbackPillProps) {
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

  let dotTone: "rec" | "off" | "send";
  let message: string;
  let elapsed = "";
  let hint = "";
  if (committed) {
    message = outside ? "Release to cancel" : "Recording";
    hint = tap ? "" : outside ? "slide back to keep" : "release to send · slide off to cancel";
    dotTone = outside ? "off" : "rec";
    if (!outside && startedAt !== null) {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      elapsed = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }
  } else {
    message = outcome === "send" ? "Sending…" : "Cancelled";
    dotTone = outcome === "send" ? "send" : "off";
  }

  return (
    <div data-testid="hold-feedback-pill" className="pv-rec-chip" aria-live="polite">
      <span className={cn("pv-rec-dot", dotTone === "rec" && "pv-hold-dot")} data-tone={dotTone} aria-hidden="true" />
      <span>{message}</span>
      {elapsed && <span className="pv-rec-time">{elapsed}</span>}
      {committed && readLevel && <MicWaveform read={readLevel} className={outside ? "text-[#888]" : undefined} />}
      {hint && <span className="pv-rec-hint">{hint}</span>}
    </div>
  );
}
