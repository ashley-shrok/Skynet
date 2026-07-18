// Patch #63: plan-mode pending indicator bubble for the pretty view.
//
// Mounted by PrettyView.tsx as a sibling of WipBubble at the tail of
// the content wrapper when the claude-session WebSocket reports
// {type:"plan_pending", pending: {...}} with a non-null pending
// object. Unmounted when the session returns pending: null (Ashley
// has replied "1" or "2" and Claude Code recorded the tool_result).
//
// The visual is intentionally compact and text-light: a
// ClipboardList glyph in an assistant-aligned bubble matching
// ChatMessage's assistant treatment, plus one line explaining the
// reply contract. No plan body is shown — this is a status
// indicator, not a preview. The planFilePath is not displayed
// either (Plan Mode is between Ashley and Claude Code; the pretty
// view surfaces only THAT the prompt is open).
//
// Static ClipboardList (not a spinner) — the motion channel is
// owned by WipBubble. A spinner reads as "Claude is working";
// plan-pending is the opposite ("Claude is waiting on you"), so
// a spinner would be semantically wrong. This mirrors patch #53's
// static-glyph choice for HarnessTasksPanel's in-progress rows.

import { ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";

export function PlanPendingBubble() {
  return (
    <div className={cn("flex", "justify-start")}>
      <div
        role="status"
        aria-label="Plan waiting for your approval"
        className={cn(
          "rounded-lg px-3 py-2 leading-relaxed",
          "bg-card text-card-foreground border border-border",
          "flex items-center gap-2 text-sm",
        )}
      >
        <ClipboardList className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          Plan proposed — reply <code>1</code> to accept,{" "}
          <code>2</code> to keep planning
        </span>
      </div>
    </div>
  );
}
