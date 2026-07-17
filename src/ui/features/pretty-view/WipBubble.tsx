// Patch #51: work-in-progress spinner bubble for the pretty view.
//
// Mounted by PrettyView.tsx as the last child of the content wrapper when
// the claude-session WebSocket reports {type:"wip", active:true}. Unmounted
// when the session returns {type:"wip", active:false} (i.e. when Claude Code
// returns control to the user).
//
// The visual is intentionally text-free: a Loader2 spinner inside an
// assistant-aligned bubble is self-explanatory in the chat context — it means
// "Claude Code is working." Adding a text label ("Thinking…", "Working…")
// would be guesswork about what stage the session is in, which the JSONL does
// not expose at this resolution. The aria-label carries the semantic for
// assistive technology.

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function WipBubble() {
  return (
    <div className={cn("flex", "justify-start")}>
      <div
        role="status"
        className={cn(
          "rounded-lg px-3 py-2 leading-relaxed",
          "bg-card text-card-foreground border border-border",
        )}
      >
        <Loader2
          className="h-4 w-4 animate-spin"
          aria-label="Claude is working"
        />
      </div>
    </div>
  );
}
