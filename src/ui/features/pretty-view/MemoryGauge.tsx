// Agent memory — the composer's small pie for how full the agent's context
// window is. Grey and silent while there's room, amber with the percentage
// from 45%, red from 78% (the old meter's bands, so the colours mean the same
// thing). A tap opens a pop-over: how full, what that means, and Start fresh
// (the composer's reset). Styles: conversation.css (.pv-mem*).

import { useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/popover";

export type MemoryBand = "grey" | "amber" | "red";

export function memoryBand(pct: number | null | undefined): MemoryBand {
  if (pct == null) return "grey";
  if (pct >= 78) return "red";
  if (pct >= 45) return "amber";
  return "grey";
}

const WORDS: Record<MemoryBand | "unknown", string> = {
  unknown: "The agent hasn't said how full its memory is yet.",
  grey: "Plenty of room. Starting fresh saves the agent's notes, then reloads it with a clean slate.",
  amber:
    "Filling up. When this piece of work wraps up is a good moment to start fresh — the agent saves its notes first.",
  red:
    "Nearly full. Soon the agent will compact on its own, and older detail gets summarised — things said only in chat are the first to go. Start fresh at the next good stopping point.",
};

export interface MemoryGaugeProps {
  /** 0–100, or null while unknown. */
  pct: number | null;
  /** Show as empty (a reset is draining, or the agent is restarting). */
  emptied?: boolean;
  /** Start fresh is unavailable (recycling, reconnecting, …). */
  resetDisabled?: boolean;
  onStartFresh: () => void;
}

export function MemoryGauge({ pct, emptied = false, resetDisabled = false, onStartFresh }: MemoryGaugeProps) {
  const [open, setOpen] = useState(false);
  // A reading can drop out for a moment (the status line isn't always
  // readable mid-turn) — hold the last one rather than flicker to unknown.
  // A reset (emptied) clears it: the fresh session reports its own.
  const lastRef = useRef<number | null>(null);
  if (emptied) lastRef.current = null;
  else if (pct != null) lastRef.current = pct;
  const shown = emptied ? null : lastRef.current;
  const band = memoryBand(shown);
  const label = shown == null ? "Agent memory" : `Agent memory: ${shown}% used`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="pv-cbtn pv-mem"
          data-testid="memory-gauge"
          data-band={band}
          aria-label={label}
          title={label}
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={shown ?? undefined}
        >
          <i className="pv-mem-pie" style={{ ["--pv-mem-p" as string]: String(shown ?? 0) }} aria-hidden="true" />
          {band !== "grey" && <span>{shown}%</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="pv-mem-pop"
        data-band={band}
        data-testid="memory-pop"
      >
        <h4>Agent memory</h4>
        <div className="pv-mem-pop-big">{shown == null ? "—" : `${shown}% used`}</div>
        <div className="pv-mem-pop-bar" aria-hidden="true">
          <i style={{ width: `${shown ?? 0}%` }} />
        </div>
        <p>{WORDS[shown == null ? "unknown" : band]}</p>
        <button
          type="button"
          className="k-btn"
          style={{ width: "100%" }}
          disabled={resetDisabled}
          onClick={() => {
            setOpen(false);
            onStartFresh();
          }}
        >
          Start fresh
        </button>
      </PopoverContent>
    </Popover>
  );
}
