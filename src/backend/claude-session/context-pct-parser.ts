/**
 * Pure helper for scraping Claude Code's context-usage % from a
 * `tmux capture-pane -p` output. Ported out of the setInterval callback
 * in claude-session-server.ts so the false-positive fix (patch #187) can
 * be locked under vitest.
 *
 * Bug closed: pre-fix regex `/(\d{1,3})%/g` would match ANY NN% on the
 * status line, so a weekly-limit warning appended to the same line
 * ("... 29% ┃ youve used 95% of your weekly limit") caused rightmost-wins
 * to return 95 (weekly limit) instead of 29 (real context meter).
 *
 * Fix: bar-anchor the regex — the `%` must be immediately preceded (with
 * optional whitespace) by a Claude Code meter glyph. Live Claude Code
 * uses only `█` and `░` today; the wider glyph set is defensive against
 * future partial-fill glyphs and matches nelly's regex for consistency.
 *
 * Semantics preserved from the inline scan (patch #56 + patch #59):
 *   * BOTTOM 8 LINES: only look at the footer region so transcript
 *     quotes of "context) NN%" elsewhere in the pane can't win.
 *   * PER-LINE + RIGHTMOST-% anchored on `context)` (primary path):
 *     for each labeled line, take the rightmost bar-anchored NN%.
 *     Last matching line across the 8-line slice wins.
 *   * FALLBACK: bar-glyph pattern (same rightmost-per-line rule) for
 *     hosts where "(1M context)" is absent but the visual bar remains.
 *   * RANGE GUARD: null for anything outside 0..100 (defensive against
 *     garbled captures).
 */

// Bar-anchored: `%` must be immediately preceded (with optional
// whitespace) by a Claude Code meter glyph. `█` and `░` are the two
// glyphs live Claude Code actually renders today; the partial-fill
// glyphs (`▉▊▋▌▍▎▏`) are defensive against future variants and match
// nelly's regex for cross-project consistency. `/g` for matchAll.
const BAR_PCT_RE = /[█▉▊▋▌▍▎▏░]\s*(\d{1,3})%/g;

export function parseContextPct(paneText: string): number | null {
  const lines = paneText.split("\n").slice(-8);

  // Primary pass: per-line, rightmost NN% wins on lines containing the
  // `context)` label. Last matching line across the 8-line slice wins.
  let pct: number | null = null;
  for (const line of lines) {
    if (!line.includes("context)")) continue;
    const pcts = [...line.matchAll(BAR_PCT_RE)];
    if (pcts.length === 0) continue;
    pct = parseInt(pcts[pcts.length - 1][1], 10);
  }

  // Fallback pass: bar-glyph anchor, same rightmost-per-line rule.
  // The pre-fix inline scan had a `!/[░█]/.test(line)` guard here — it
  // becomes redundant now that the regex itself is bar-anchored (a line
  // without any bar glyph can't match), so the guard is dropped.
  if (pct === null) {
    for (const line of lines) {
      const pcts = [...line.matchAll(BAR_PCT_RE)];
      if (pcts.length === 0) continue;
      pct = parseInt(pcts[pcts.length - 1][1], 10);
    }
  }

  if (pct === null || !Number.isFinite(pct) || pct < 0 || pct > 100)
    return null;
  return pct;
}
