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
          // Phase 4 Glass: shared assistant-bubble treatment (matches ChatMessage
          // assistant branch — same raised-object depth, so the WIP bubble reads
          // as belonging to the same visual family as the surrounding assistant
          // turns).
          "leading-relaxed",
          "rounded-[var(--radius-pv-bubble)] px-3 py-2",
          "backdrop-blur-xl saturate-150",
          "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          "bg-[linear-gradient(160deg,rgba(45,55,80,0.5),rgba(28,35,55,0.55))]",
          "text-[#dfe3ee]",
          "border border-white/[0.08]",
          "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,255,255,0.12)_inset,_0_0_0_0.5px_rgba(255,255,255,0.05)]",
        )}
      >
        <Loader2
          className="h-4 w-4 animate-spin motion-reduce:animate-none text-[rgba(150,180,220,0.9)]"
          aria-label="Claude is working"
        />
      </div>
    </div>
  );
}
