// Patch #63: plan-mode pending indicator bubble for the pretty view.
//
// Mounted by PrettyView.tsx as a sibling of WipBubble at the tail of
// the content wrapper when the claude-session WebSocket reports
// {type:"plan_pending", pending: {...}} with a non-null pending
// object. Unmounted when the session returns pending: null (Claude
// Code recorded the plan-mode reply's tool_result).
//
// The visual is intentionally compact and text-light: a
// ClipboardList glyph in an assistant-aligned bubble matching
// ChatMessage's assistant treatment, plus a single line stating
// that a plan is waiting for approval. Copy DELIBERATELY does NOT
// mention typing "1" or "2" (patch #67 correction): those keys are
// consumed by Claude Code's Ink Plan Mode prompt directly in the
// tmux pane, NOT by pretty view's ComposeBox. The ComposeBox's
// split-send (patch #44) writes a body event + a separate \r event
// with a 60ms gap, which Ink does NOT recognize as a plan-mode
// selection. So do NOT surface "reply 1/2" copy — it's misleading
// (Ashley verified 2026-07-18 by trying it). This bubble is a
// pure PRESENCE indicator; the reply UI lives in the tmux pane
// (which she can flip to with Ctrl+Shift+O — patch #44).
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
        <span>Plan proposed — awaiting your approval</span>
      </div>
    </div>
  );
}
