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
//
// Phase 24 expansion (2026-08-04): the bubble is no longer a bare
// presence indicator. It now grows downward into a card with:
//   1. Header (preserved verbatim from patch #63): ClipboardList
//      glyph + "Plan proposed — awaiting your approval" line.
//   2. Middle plan-contents section: renders `planContent` (the
//      plan file body, fetched async via SFTP side-channel by the
//      backend — Phase 24 Plans 02/03) in a `<pre>` monospace
//      block with `whitespace-pre-wrap` so plan-file formatting
//      survives while still allowing word-boundary wraps. Bounded
//      by `max-h-[40vh] overflow-y-auto` so a very long plan does
//      not push the footer buttons off-screen. Four render states
//      per CONTEXT § Bubble UI:
//        (a) `planFilePath === null` → skip the middle section
//            entirely; buttons still work.
//        (b) `contentError !== null` → small dim
//            "Plan contents unavailable ({error})" line; buttons
//            still work.
//        (c) `planContent === null` (path known, fetch in-flight)
//            → italic "Loading plan…" text. NO spinner glyph —
//            respects the L23-27 "waiting on you" rationale
//            above; motion channel stays owned by WipBubble.
//        (d) `planContent` non-null → `<pre>` monospace render.
//   3. Footer: [Approve] primary + [Feedback] secondary buttons,
//      side-by-side. Approve fires `onApprove` which the parent
//      (PrettyView) forwards as a `{type:"raw_keystrokes",
//      bytes:"1\r"}` WS frame. Feedback opens an inline modal
//      (textarea + Submit + Cancel); Submit fires `onFeedback(text)`
//      which the parent forwards as `{type:"raw_keystrokes",
//      bytes:"3" + text + "\r"}`.
//
// CRITICAL — the `raw_keystrokes` WS path (Phase 24 Plan 03) was
// added SPECIFICALLY because the ComposeBox split-send (patch #44)
// does NOT work with Ink Plan Mode (patch #67 retraction lesson,
// re-stated at L14-21 above). The backend `raw_keystrokes` handler
// writes the bytes in ONE call via `tmux send-keys -l` (literal
// flag), no split, no gap. Do NOT "optimize" the send path back
// through ComposeBox — that's the exact anti-pattern we retracted.
//
// Approve = option 1 only (CONTEXT § "NOT in this phase" —
// option 2 button explicitly excluded; Ashley picks option 1
// exclusively). Both Approve's `1\r` and Feedback's `3<text>\r`
// select the choice by numeric key, which is deterministic
// regardless of Ink cursor position.
//
// Props-in, callbacks-out: this component does NOT know about the
// WebSocket. The parent PrettyView owns the wsRef and fires the
// `raw_keystrokes` frames. This keeps the bubble a pure
// presentational component with a testable prop contract.

import { useState } from "react";
import { ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PlanPendingBubbleProps {
  /**
   * Tilde-relative path to the plan file, e.g.
   * `~/.claude/plans/groovy-watching-leaf.md`. Extracted from the
   * tmux pane footer by the backend (Phase 24 Plan 01
   * `parsePlanFilePath`). Null when the footer format changed or
   * the pane scrape missed it — in which case the middle
   * plan-contents section is skipped entirely (buttons still work).
   */
  planFilePath: string | null;
  /**
   * The plan file body, fetched asynchronously by the backend via
   * SFTP side-channel on the pane's existing SSH connection
   * (Phase 24 Plan 02 `fetchPlanFile`). Null while the fetch is
   * in-flight OR when the fetch failed (see `contentError`).
   */
  planContent: string | null;
  /**
   * SFTP fetch error string when the plan file could not be read
   * (invalid path, missing, permission denied, etc.). Null on
   * success or while the fetch is in-flight. Non-null → render a
   * small dim error line; buttons still work so Ashley can act on
   * the prompt she can see in the tmux pane.
   */
  contentError: string | null;
  /**
   * Fired when Ashley clicks the Approve button. The parent
   * (PrettyView) sends `{type:"raw_keystrokes", bytes:"1\r"}` via
   * WS. Component itself does NOT reach into the WS — see docblock
   * L74-82 for the props-in/callbacks-out rationale.
   */
  onApprove: () => void;
  /**
   * Fired when Ashley submits the Feedback modal. The parent
   * (PrettyView) sends `{type:"raw_keystrokes", bytes:"3" +
   * feedback + "\r"}` via WS. Feedback text is passed through
   * as-is; parent forwards to the PTY via `tmux send-keys -l`
   * (literal flag) so any character in the string is safe.
   */
  onFeedback: (feedback: string) => void;
}

export function PlanPendingBubble(props: PlanPendingBubbleProps) {
  const { planFilePath, planContent, contentError, onApprove, onFeedback } =
    props;
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");

  const closeFeedback = () => {
    setFeedbackOpen(false);
    setFeedbackText("");
  };

  const submitFeedback = () => {
    const trimmed = feedbackText.trim();
    if (trimmed.length === 0) return;
    onFeedback(trimmed);
    setFeedbackOpen(false);
    setFeedbackText("");
  };

  return (
    <div className={cn("flex", "justify-start")}>
      <div
        role="status"
        aria-label="Plan waiting for your approval"
        className={cn(
          // Phase 4 Glass: identity-hue assistant-bubble treatment (matches
          // ChatMessage's assistant branch). Plan-pending is the identity
          // speaking — "here is a plan, waiting on you" — so the bubble
          // wears the identity hue, not the user blue-gray. Static
          // ClipboardList glyph preserved per patch #63 — motion channel
          // stays owned by WipBubble.
          //
          // Phase 24: layout switched from `flex items-center gap-2 text-sm`
          // (single-line indicator) to `flex flex-col gap-2 text-sm` so the
          // container grows vertically to hold header + plan contents +
          // footer buttons. All OTHER Phase 4 Glass tokens are preserved
          // verbatim (rounding, backdrop-blur, gradient, border, shadow,
          // text color) — the aesthetic is identical, just taller.
          // `max-w-[min(720px,80vw)]` caps the width so long plan lines
          // don't push the bubble past the pretty-view content column.
          "leading-relaxed",
          "rounded-[var(--radius-pv-bubble)] px-3 py-2",
          "backdrop-blur-xl saturate-150",
          "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          "bg-[linear-gradient(160deg,hsla(var(--pv-id-hue),50%,38%,0.55),hsla(var(--pv-id-hue),45%,24%,0.6))]",
          "text-[#fbf5e8]",
          "border border-[hsla(var(--pv-id-hue),65%,55%,0.32)]",
          "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,220,170,0.18)_inset,_0_0_0_0.5px_hsla(var(--pv-id-hue),70%,55%,0.2),_0_0_32px_hsla(var(--pv-id-hue),70%,52%,0.18)]",
          "flex flex-col gap-2 text-sm max-w-[min(720px,80vw)]",
        )}
      >
        {/* Header row — preserved verbatim from patch #63 */}
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Plan proposed — awaiting your approval</span>
        </div>

        {/* Middle plan-contents section — Phase 24, four render states.
            Skipped entirely when planFilePath is null (buttons still work). */}
        {planFilePath !== null && (
          contentError !== null ? (
            <div className="text-xs italic opacity-75">
              Plan contents unavailable ({contentError})
            </div>
          ) : planContent === null ? (
            // Loading state — italic text, NO spinner glyph. See docblock
            // L23-27: motion channel is owned by WipBubble; plan-pending is
            // "waiting on you", opposite of "Claude is working" semantics.
            <div className="text-xs italic opacity-75">Loading plan…</div>
          ) : (
            <pre className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-sm bg-black/20 p-3 text-xs font-mono">
              {planContent}
            </pre>
          )
        )}

        {/* Footer row — Approve (primary) + Feedback (secondary) */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            aria-label="Approve plan"
            onClick={onApprove}
            className="px-3 py-1.5 rounded-sm bg-[hsla(var(--pv-id-hue),70%,50%,0.85)] text-[#fbf5e8] text-xs font-medium border border-[hsla(var(--pv-id-hue),80%,60%,0.55)] hover:brightness-110 transition-[filter]"
          >
            Approve
          </button>
          <button
            type="button"
            aria-label="Provide feedback on plan"
            onClick={() => setFeedbackOpen(true)}
            className="px-3 py-1.5 rounded-sm border border-[color:var(--color-pv-border-quiet)] bg-[color:var(--color-pv-surface-quiet)] text-[color:var(--color-pv-fg)] text-xs font-medium hover:brightness-110 transition-[filter]"
          >
            Feedback
          </button>
        </div>
      </div>

      {/* Inline Feedback modal — MVP: plain textarea + Submit + Cancel.
          Per 24-PATTERNS.md § Feedback modal: the simpler inline-overlay
          option (not radix DialogPrimitive) — the modal only needs textarea +
          two buttons and doesn't warrant portal/focus-trap complexity. Click
          on the backdrop OR Cancel closes without firing. Submit disabled
          while trimmed empty. */}
      {feedbackOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Provide feedback for Claude"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeFeedback();
          }}
        >
          <div className="w-[min(520px,90vw)] rounded-md bg-[color:var(--color-pv-surface)] p-4 shadow-xl border border-[color:var(--color-pv-border-quiet)]">
            <label
              htmlFor="plan-feedback-textarea"
              className="block text-xs font-medium text-[color:var(--color-pv-fg)] mb-2"
            >
              Feedback for Claude
            </label>
            <textarea
              id="plan-feedback-textarea"
              aria-label="Feedback"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="What should Claude change about the plan?"
              rows={4}
              autoFocus
              className="w-full rounded-sm border border-[color:var(--color-pv-border-quiet)] bg-[color:var(--color-pv-surface-quiet)] px-3 py-2 text-xs text-[color:var(--color-pv-fg)] placeholder:text-[color:var(--color-pv-fg-dim)] outline-none resize-none"
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeFeedback}
                className="px-3 py-1.5 rounded-sm text-xs text-[color:var(--color-pv-fg-dim)] hover:text-[color:var(--color-pv-fg)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={feedbackText.trim().length === 0}
                onClick={submitFeedback}
                className="px-3 py-1.5 rounded-sm bg-[hsla(var(--pv-id-hue),70%,50%,0.85)] text-[#fbf5e8] text-xs font-medium border border-[hsla(var(--pv-id-hue),80%,60%,0.55)] disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 transition-[filter]"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
