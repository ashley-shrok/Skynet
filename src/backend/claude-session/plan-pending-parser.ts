/**
 * Pure helper for detecting Claude Code's plan-approval Ink prompt from a
 * `tmux capture-pane -p` output. Wired into the setInterval pane-scrape in
 * claude-session-server.ts alongside `parseContextPct` so PlanPendingBubble
 * can render live while Ashley is deciding on a proposed plan.
 *
 * WHY A PANE-SCRAPE INSTEAD OF THE JSONL:
 *
 * The legacy patch #63 approach scans the parent Claude Code JSONL for
 * unmatched `ExitPlanMode` tool_use entries. That path is effectively DEAD
 * for pending-window detection as of Claude Code 2.1.150. The new
 * `ExitPlanModeV2Tool` implementation BUFFERS the `tool_use` in Ink UI
 * memory and only flushes it to the parent JSONL AFTER the user resolves
 * the plan-approval prompt (approve or reject). During the entire pending
 * window — which is exactly when we want PlanPendingBubble to render — the
 * JSONL carries zero signal.
 *
 * Live confirmation on Moxie's workstation 2026-08-02: an `ExitPlanMode`
 * tool_use appeared in the parent JSONL 57 minutes after the model called
 * it, at the exact moment Ashley approved the prompt. The pane, in
 * contrast, showed the Ink prompt continuously for those 57 minutes.
 *
 * The pane is therefore the authoritative live signal for this state, and
 * this helper is what makes it observable.
 *
 * FINGERPRINT:
 *
 * We combine two conditions to keep the signal robust against transcript
 * quotes and prose that happen to mention plan-mode text elsewhere in the
 * scrollback:
 *
 *   (a) BOTTOM ~30 LINES: the load-bearing reject-option marker
 *       `No, keep planning` MUST appear in the bottom slice of the pane.
 *       Anchoring at the bottom mirrors `parseContextPct`'s bottom-8 slice
 *       rationale — the Ink prompt always renders in the pane footer, so
 *       transcript quotes elsewhere can't false-positive. The
 *       `No, keep planning` string is the reject-option line in EVERY
 *       plan-approval prompt variant regardless of whether Claude Code was
 *       launched with `--dangerously-skip-permissions` (that flag changes
 *       options 1/2 between "Yes, and bypass permissions"/"Yes, proceed"
 *       vs "Yes, proceed" alone — but the keep-planning line is always
 *       the last numbered option).
 *
 *   (b) HEADER ANYWHERE: at least one of `Here is Claude's plan:` OR
 *       `Ready to code?` must appear anywhere in the full pane text.
 *       These are the two header variants of the plan-approval box that
 *       Claude Code renders — header-anywhere is acceptable because the
 *       combination of (a) bottom-slice keep-planning marker AND
 *       (b) header-anywhere is a reliable signal. Either condition alone
 *       is materially weaker.
 *
 * Returns `false` immediately for empty/whitespace input as a fast path.
 * Zero imports, zero I/O — same pure-helper posture as
 * `context-pct-parser.ts` so the vitest suite can drive it with synthetic
 * pane strings.
 */

export function isPlanPending(paneText: string): boolean {
  // Fast path: empty or whitespace-only pane has no prompt.
  if (paneText.trim() === "") return false;

  // (a) Bottom ~30 lines must contain the reject-option marker. Anchoring
  //     at the bottom keeps prose/transcript quotes of "No, keep planning"
  //     elsewhere in the pane from causing false positives — same
  //     rationale as parseContextPct's bottom-8 slice.
  const bottomSlice = paneText.split("\n").slice(-30).join("\n");
  if (!bottomSlice.includes("No, keep planning")) return false;

  // (b) One of the two header variants must appear anywhere in the pane.
  //     `Here is Claude's plan:` is the header when
  //     --dangerously-skip-permissions is on (3-option variant);
  //     `Ready to code?` is the default (2-option variant). Header-
  //     anywhere is safe because (a) is already anchored to the bottom.
  if (
    !paneText.includes("Here is Claude's plan:") &&
    !paneText.includes("Ready to code?")
  ) {
    return false;
  }

  return true;
}
