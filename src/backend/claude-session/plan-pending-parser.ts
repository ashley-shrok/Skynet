/**
 * Pure helpers for observing Claude Code's plan-approval Ink prompt from a
 * `tmux capture-pane -p` output. Wired into the setInterval pane-scrape in
 * claude-session-server.ts alongside `parseContextPct` so PlanPendingBubble
 * can render live while Ashley is deciding on a proposed plan.
 *
 * Two exports:
 *   - `isPlanPending(paneText)` — presence detection (was here since
 *     quick 260802-rps; strings corrected in Phase 24 Plan 01 to match
 *     the pinned fleet Ink variant, which had never actually fired in
 *     production).
 *   - `parsePlanFilePath(paneText)` — tilde-relative plan-file path
 *     extraction from the prompt footer (added Phase 24 Plan 01, feeds
 *     the SFTP side-channel fetch in Plan 02).
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
 * these helpers are what make it observable.
 *
 * FINGERPRINT (Phase 24 Plan 01 correction):
 *
 * The fleet is pinned to a single Claude Code Ink variant (Ashley verified
 * 2026-08-04). The correct anchor strings for THAT variant — verbatim from
 * Amelia's pane on the same day — are:
 *
 *   Header (anywhere in pane):
 *     `Claude has written up a plan and is ready to execute. Would you like to proceed?`
 *
 *   Bottom-slice marker (last ~30 lines):
 *     `shift+tab to approve with this feedback`
 *
 * The two-condition SHAPE stays (bottom-slice marker AND header-anywhere).
 * Anchoring the marker to the bottom slice mirrors `parseContextPct`'s
 * bottom-8 slice rationale — the Ink prompt always renders in the pane
 * footer, so transcript quotes elsewhere in the scrollback can't
 * false-positive. Header-anywhere is safe because it's paired with the
 * bottom-slice check. Neither condition alone would be strong enough.
 *
 * The previous (dead) fingerprint targeted the reject-option label and
 * two header variants from an OLD Ink revision. None of those strings
 * appear in the pinned fleet variant, so `isPlanPending` had been silently
 * returning `false` on every live pane since it landed in quick 260802-rps
 * two days before this correction.
 *
 * Returns `false` immediately for empty/whitespace input as a fast path.
 * Zero imports, zero I/O — same pure-helper posture as
 * `context-pct-parser.ts` so the vitest suite can drive it with synthetic
 * pane strings.
 */

export function isPlanPending(paneText: string): boolean {
  // Fast path: empty or whitespace-only pane has no prompt.
  if (paneText.trim() === "") return false;

  // (a) Bottom ~30 lines must contain the footer-only marker. Anchoring
  //     at the bottom keeps prose/transcript quotes of the marker
  //     elsewhere in the pane from causing false positives — same
  //     rationale as parseContextPct's bottom-8 slice.
  const bottomSlice = paneText.split("\n").slice(-30).join("\n");
  if (!bottomSlice.includes("shift+tab to approve with this feedback"))
    return false;

  // (b) The single pinned-variant header must appear anywhere in the
  //     pane. Header-anywhere is safe because (a) is already anchored to
  //     the bottom, so the pair `(a) AND (b)` remains prose-quote-proof.
  if (
    !paneText.includes(
      "Claude has written up a plan and is ready to execute. Would you like to proceed?",
    )
  ) {
    return false;
  }

  return true;
}

/**
 * Extract the plan file's tilde-relative path from the pane footer.
 *
 * The plan-approval prompt renders a footer line of the form:
 *
 *     ctrl-g to edit in  Vim  · ~/.claude/plans/<slug>.md
 *
 * (Verbatim from Amelia's pane 2026-08-04: DOUBLE space between "in" and
 * "Vim", middle-dot `·` U+00B7 between "Vim" and the path, single-space
 * separators on either side of the middle dot.)
 *
 * Slugs are always kebab-case English words joined by hyphens, e.g.
 * `groovy-watching-leaf.md`, `twinkling-strolling-eclipse.md`. The regex
 * accepts only the slug charset `[a-z0-9-]+` — uppercase letters, dots
 * (other than the `.md` extension), slashes, backticks, quotes, `$`, and
 * any other character all cause the extraction to fall through to `null`.
 *
 * Returns `null` when the footer is absent, when the slug fails the
 * charset check, when the extension is not `.md`, or when the path prefix
 * is not `~/.claude/plans/`. Never throws.
 *
 * SECURITY NOTE: Path validation for the SFTP-fetch caller (Plan 02)
 * lives in the fetch module, NOT in this parser. This function is pure
 * text extraction. The parser's slug regex is a first-pass sanity check;
 * the SFTP layer re-validates by string-comparing the full resolved path
 * against `<resolvedHome>/.claude/plans/<slug>.md`. Defense-in-depth: an
 * attacker who somehow got past the parser regex would still be blocked
 * by the SFTP layer, and vice versa.
 */
export function parsePlanFilePath(paneText: string): string | null {
  // WR-01 fix: anchor to the bottom-30 slice, same rationale as
  // `isPlanPending` above and `parseContextPct`'s bottom-8 slice — the
  // Ink footer only ever renders in the pane tail, so a whole-pane match
  // could false-positive on transcript prose that quotes a plan path
  // ("look at ~/.claude/plans/old-slug.md"). Prior to this fix, such a
  // quote could steer the SFTP fetch toward the WRONG slug (i.e. show
  // Ashley plan contents for a plan she isn't being prompted on), even
  // though `isPlanPending` correctly returned true for the real footer.
  const bottomSlice = paneText.split("\n").slice(-30).join("\n");
  const match = bottomSlice.match(
    /ctrl-g to edit in\s+Vim\s+·\s+(~\/\.claude\/plans\/[a-z0-9-]+\.md)/,
  );
  return match ? match[1] : null;
}
