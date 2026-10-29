// Agent memory — the small pie, in the task pill, for how full the agent's context
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

/** The confirm every Condense button asks before requesting a condense. */
export function condenseConfirm() {
  return {
    title: "Condense this conversation?",
    body: "The agent summarises everything so far to make room, then carries on as the same agent, in the same conversation.",
    confirmLabel: "Condense",
  };
}

// A failed Condense request → what to tell the user. Only a request that
// never got an answer is "Not connected"; a server that answered gets a line
// saying what went wrong instead.
export function condenseFailureMessage(err: unknown, hostName?: string): string {
  const status = (err as { response?: { status?: unknown } } | null | undefined)?.response?.status;
  if (typeof status !== "number") return "Not connected — try again in a moment";
  if (status === 504) {
    return `Couldn't reach ${hostName ? hostName : "this agent's machine"} — try again in a moment`;
  }
  if (status === 404) return "Couldn't find this agent's machine — it may have been removed";
  return "Couldn't condense — something went wrong on Skynet's side";
}

export interface MemoryGaugeProps {
  /** 0–100, or null while unknown. */
  pct: number | null;
  /** A condense has been requested and hasn't finished yet. */
  condensing?: boolean;
  /** Too narrow for the word: while condensing, the pie pulses instead of
   *  reading "Condensing…" (the label and pop-over still say it). */
  compact?: boolean;
  /** Condense conversation is unavailable (reconnecting, …). */
  condenseDisabled?: boolean;
  onCondense: () => void;
}

export function MemoryGauge({ pct, condensing = false, compact = false, condenseDisabled = false, onCondense }: MemoryGaugeProps) {
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
          data-compact={compact ? "true" : undefined}
          // A button (it opens the pop-over); the reading is in its label.
          aria-label={label}
          title={label}
          data-pct={shown ?? undefined}
        >
          <i className="pv-mem-pie" style={{ ["--pv-mem-p" as string]: String(shown ?? 0) }} aria-hidden="true" />
          {condensing ? !compact && <span>Condensing…</span> : band !== "grey" && <span>{shown}%</span>}
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
