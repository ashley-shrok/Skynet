/**
 * Pure helper for scraping Claude Code's context-usage % from a
 * `tmux capture-pane -p` output. Ported out of the setInterval callback
 * in claude-session-server.ts so the false-positive fix (patch #187) can
 * be locked under vitest.
 *
 * ─── History ────────────────────────────────────────────────────────────
 *
 * Original bug (pre-patch #187): regex `/(\d{1,3})%/g` matched ANY NN% on
 * the status line, so a weekly-limit warning ("... 29% ┃ youve used 95%
 * of your weekly limit") let rightmost-wins return 95 (weekly limit)
 * instead of 29 (real context meter).
 *
 * Patch #187 fix: bar-anchored regex — the `%` had to be immediately
 * preceded (with optional whitespace) by a Claude Code meter glyph
 * (`█`/`░` + defensive partial-fill glyphs).
 *
 * ─── 2026-08-06 statusline hook rework ─────────────────────────────────
 *
 * Ashley reworked the Claude Code statusline hook fleet-wide so the
 * context % now renders as the FIRST 2 CHARS of the line (Nelly handoff
 * 2026-08-06). New contract (chars 0-1 of the statusline):
 *   "00".."99" → literal percent, zero-padded ("04", "24", "85")
 *   "!!"       → 100 (unambiguously non-numeric so the leading-two-chars
 *                probe can distinguish it from a real percent)
 * Full line shape (colored in real render):
 *   `<PP> <bar>[ · <task>][ · <gsd-update-warning>][ · last: /cmd]`
 * Line disambiguation: `^(\d\d|!!) ` AND contains a bar char (`█`/`░`).
 * The AND kills the two historical false-positive shapes (weekly-limit
 * "95%" warnings, old GSD milestone `[██░░] NN%` bars mid-line).
 *
 * Strategy: NEW PRIMARY (new statusline shape) → OLD PRIMARY
 * (context)-labeled + bar-anchored NN%) → OLD FALLBACK (any bar-anchored
 * NN%). During the fleet rollout window a single pane may briefly hold
 * lines in both shapes; new-shape wins because it's the authoritative
 * post-rework source. Legacy paths stay as regression-safe fallbacks so
 * pre-hook captures + hosts on stale claude-code installs keep working.
 *
 * ─── Preserved semantics (patch #56 + patch #59 + patch #187) ──────────
 *   * BOTTOM 8 LINES: only look at the footer region so transcript
 *     quotes of "context) NN%" elsewhere in the pane can't win.
 *   * PER-LINE + RIGHTMOST-% anchored on `context)` (old-primary path):
 *     for each labeled line, take the rightmost bar-anchored NN%.
 *     Last matching line across the 8-line slice wins.
 *   * FALLBACK: bar-glyph pattern (same rightmost-per-line rule) for
 *     hosts where "(1M context)" is absent but the visual bar remains.
 *   * RANGE GUARD: null for anything outside 0..100 (defensive against
 *     garbled captures).
 */

// New statusline: `\d\d` or `!!` head, followed by a space. Some tmux
// configs render the line with leading whitespace before the pct
// (Stacy 2026-08-06 via Nelly — silent-failure mode, `int("  ")` would
// throw / read nothing on those hosts), so allow optional leading
// whitespace. Anchored ^ so mid-line matches (e.g. transcript quoting a
// statusline) don't trigger. The subsequent AND-with-bar-glyph filter
// kills any line that happens to start with two digits but isn't a
// statusline.
const NEW_STATUS_HEAD_RE = /^\s*(\d\d|!!) /;

// Bar-glyph presence check for the new-statusline disambiguation. Kept
// narrow to the two glyphs Claude Code actually renders (`█` and `░`) —
// the wider partial-fill set below is defensive against future variants.
const BAR_GLYPH_ANYWHERE_RE = /[█░]/;

// Bar-anchored: `%` must be immediately preceded (with optional
// whitespace) by a Claude Code meter glyph. `█` and `░` are the two
// glyphs live Claude Code actually renders today; the partial-fill
// glyphs (`▉▊▋▌▍▎▏`) are defensive against future variants and match
// nelly's regex for cross-project consistency. `/g` for matchAll.
const BAR_PCT_RE = /[█▉▊▋▌▍▎▏░]\s*(\d{1,3})%/g;

function parseNewStatuslineLine(line: string): number | null {
  const m = line.match(NEW_STATUS_HEAD_RE);
  if (!m) return null;
  if (!BAR_GLYPH_ANYWHERE_RE.test(line)) return null;
  const head = m[1];
  return head === "!!" ? 100 : parseInt(head, 10);
}

export function parseContextPct(paneText: string): number | null {
  const lines = paneText.split("\n").slice(-8);

  // NEW PRIMARY: statusline hook (2026-08-06 rework). Last matching line
  // across the 8-line slice wins — mirrors the existing rightmost-per-
  // scan-window semantic.
  let pct: number | null = null;
  for (const line of lines) {
    const v = parseNewStatuslineLine(line);
    if (v !== null) pct = v;
  }

  // OLD PRIMARY: context)-labeled lines with bar-anchored NN%. Only runs
  // when the new statusline shape wasn't found (legacy sessions, panes
  // without the reworked hook active).
  if (pct === null) {
    for (const line of lines) {
      if (!line.includes("context)")) continue;
      const pcts = [...line.matchAll(BAR_PCT_RE)];
      if (pcts.length === 0) continue;
      pct = parseInt(pcts[pcts.length - 1][1], 10);
    }
  }

  // OLD FALLBACK: bar-glyph anchor, same rightmost-per-line rule. The
  // pre-fix inline scan had a `!/[░█]/.test(line)` guard here — it
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
