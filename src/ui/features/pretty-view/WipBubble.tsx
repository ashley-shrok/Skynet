// Patch #51 introduced the WIP indicator; patch #72 reworked it.
//
// Mounted by PrettyView.tsx as the last child of the content wrapper when
// EITHER (a) the Terminal PTY reports non-idle (Claude is mid-turn) OR
// (b) backgrounded agents/shells are running. All three states share one
// practical meaning to the operator: "session is busy, come back later."
//
// Deliberately NOT a bubble. WIP is a naked, floating, assistant-aligned
// spinner so at-a-glance parsing distinguishes "session is busy" (spinner,
// no bubble) from "assistant said something" (bubble). Contrast with
// PlanPendingBubble, which KEEPS its bubble because plan-pending semantics
// are "idle, waiting on you" — message-shaped, message chrome.
//
// aria-label + role="status" carry the semantic for assistive technology.

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function WipBubble() {
  return (
    <div className={cn("flex", "justify-start")}>
      <Loader2
        role="status"
        aria-label="Claude is working"
        className="h-5 w-5 animate-spin motion-reduce:animate-none text-[rgba(150,180,220,0.9)]"
      />
    </div>
  );
}
