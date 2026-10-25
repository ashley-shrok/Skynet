// Agent memory — the composer's small pie for how full the agent's context
// window is. Grey and silent while there's room, amber with the percentage
// from 45%, red from 78% (the old meter's bands, so the colours mean the same
// thing). A tap opens a pop-over: how full, what that means, and Condense
// conversation. While a condense is under way the pie reads "Condensing…".
// Styles: conversation.css (.pv-mem*).

import { useRef, useState } from "react";
import { Minimize2 } from "lucide-react";
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
  grey: "Plenty of room. Agents can only hold so much of a conversation at once — condensing summarises it so the agent has more room to work.",
  amber:
    "Filling up. When this piece of work wraps up is a good moment to condense — the agent carries on with a summary of everything so far.",
  red:
    "Nearly full. At 95% the agent condenses on its own. Condensing at a good stopping point means less is lost mid-task.",
};

const CONDENSING_WORDS =
  "The agent is summarising the conversation to make room. Anything you send now reaches it once that's done.";

/** The confirm both Condense buttons ask before requesting a condense. */
export function condenseConfirm(typedTextGuides: boolean) {
  return {
    title: "Condense this conversation?",
    body:
      "The agent summarises everything so far to make room, then carries on as the same agent, in the same conversation." +
      (typedTextGuides ? " Anything you've typed guides what the summary keeps." : ""),
    confirmLabel: "Condense",
  };
}

export interface MemoryGaugeProps {
  /** 0–100, or null while unknown. */
  pct: number | null;
  /** A condense has been requested and hasn't finished yet. */
  condensing?: boolean;
  /** Condense conversation is unavailable (reconnecting, …). */
  condenseDisabled?: boolean;
  onCondense: () => void;
}

export function MemoryGauge({ pct, condensing = false, condenseDisabled = false, onCondense }: MemoryGaugeProps) {
  const [open, setOpen] = useState(false);
  // A reading can drop out for a moment (the status line isn't always
  // readable mid-turn) — hold the last one rather than flicker to unknown.
  const lastRef = useRef<number | null>(null);
  if (pct != null) lastRef.current = pct;
  const shown = lastRef.current;
  const band = memoryBand(shown);
  const label = condensing
    ? "Agent memory: condensing"
    : shown == null
      ? "Agent memory"
      : `Agent memory: ${shown}% used`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="pv-cbtn pv-mem"
          data-testid="memory-gauge"
          data-band={band}
          data-condensing={condensing ? "true" : undefined}
          // A button (it opens the pop-over); the reading is in its label.
          aria-label={label}
          title={label}
          data-pct={shown ?? undefined}
        >
          <i className="pv-mem-pie" style={{ ["--pv-mem-p" as string]: String(shown ?? 0) }} aria-hidden="true" />
          {condensing ? <span>Condensing…</span> : band !== "grey" && <span>{shown}%</span>}
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
        <div className="pv-mem-pop-big">{condensing ? "Condensing…" : shown == null ? "—" : `${shown}% used`}</div>
        <div className="pv-mem-pop-bar" aria-hidden="true">
          <i style={{ width: `${shown ?? 0}%` }} />
        </div>
        <p>{condensing ? CONDENSING_WORDS : WORDS[shown == null ? "unknown" : band]}</p>
        <button
          type="button"
          className="k-btn pv-mem-condense"
          style={{ width: "100%" }}
          disabled={condenseDisabled || condensing}
          onClick={() => {
            setOpen(false);
            onCondense();
          }}
        >
          <Minimize2 aria-hidden="true" />
          {condensing ? "Condensing…" : "Condense conversation"}
        </button>
      </PopoverContent>
    </Popover>
  );
}
