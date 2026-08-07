import { describe, it, expect } from "vitest";
import { parseContextPct } from "./context-pct-parser.js";

// Test scaffolding: each test constructs a synthetic pane-capture string
// (single- or multi-line) and asserts the returned number-or-null.
// Cases mirror nelly's vms-apps context-watch.py pre-fix bug (f88c928)
// plus the skynet-side primary/fallback split.

describe("parseContextPct — bar-anchored regex (patch #187)", () => {
  it("returns meter value when only the primary context)-labeled line is present", () => {
    const pane = "Opus 4.7 (1M context) │ skynet █████░ 29%";
    expect(parseContextPct(pane)).toBe(29);
  });

  it("returns meter value when weekly-limit warning is appended on the same line (bug repro)", () => {
    // THE BUG: current inline scan returns 95 (weekly limit) instead of 29 (meter).
    // Bar-anchored regex must reject the un-anchored 95%.
    const pane =
      "Opus 4.7 (1M context) │ skynet █████░ 29% ┃ youve used 95% of your weekly limit";
    expect(parseContextPct(pane)).toBe(29);
  });

  it("preserves rightmost-wins for GSD milestone-bar + real context meter collision (patch #59 semantic)", () => {
    // A single `context)`-labeled line with two bar-anchored NN% values.
    // GSD milestone-bar renders first, real Claude context meter renders far-right.
    // Rightmost bar-anchored value must win.
    const pane =
      "Opus 4.7 (1M context) │ ███░ 42% milestone ┃ skynet █████░ 71%";
    expect(parseContextPct(pane)).toBe(71);
  });

  it("returns null when line has `context)` label but no bar glyph adjacent to `%` (weekly-warning-only)", () => {
    // Primary path skips: no bar-anchored NN% on the line.
    // Fallback path skips: no bar glyph on line either.
    const pane = "Opus 4.7 (1M context) — 95% weekly limit remaining";
    expect(parseContextPct(pane)).toBeNull();
  });

  it("returns null when neither `context)` label nor bar glyph appear (weekly-warning-only, no label)", () => {
    const pane = "youve used 95% of your weekly limit";
    expect(parseContextPct(pane)).toBeNull();
  });

  it("returns 100 for upper-edge full meter", () => {
    const pane = "Opus 4.7 (1M context) │ skynet ██████████ 100%";
    expect(parseContextPct(pane)).toBe(100);
  });

  it("falls through to fallback (bar-glyph anchor) when line has bar but no `context)` label", () => {
    // No `context)` label → primary skips.
    // Fallback: bar-anchored regex matches on line with bar glyph → returns value.
    const pane = "skynet █████░ 37%";
    expect(parseContextPct(pane)).toBe(37);
  });

  it("only scans the last 8 lines (multi-line 8-line-tail behavior)", () => {
    // 10-line pane: only the last 8 should be scanned.
    // Line 1 (outside window) has a bar-anchored NN% that would be a distractor;
    // line 10 (inside window) has the real reading.
    const lines: string[] = [
      "Opus 4.7 (1M context) │ skynet █████░ 11%", // line 1 — outside 8-line window
      "filler 1",
      "filler 2",
      "filler 3",
      "filler 4",
      "filler 5",
      "filler 6",
      "filler 7",
      "filler 8",
      "Opus 4.7 (1M context) │ skynet █████░ 55%", // line 10 — inside window, real
    ];
    expect(parseContextPct(lines.join("\n"))).toBe(55);
  });

  it("last-matching-line wins across the 8-line window (multi-line last-wins semantic)", () => {
    const pane = [
      "Opus 4.7 (1M context) │ skynet █████░ 22%",
      "Opus 4.7 (1M context) │ skynet █████░ 33%", // later line wins
    ].join("\n");
    expect(parseContextPct(pane)).toBe(33);
  });

  it("returns null when the parsed value is out of the 0-100 range (range guard)", () => {
    // Injected 250% — bar-anchored regex matches (\d{1,3} allows 250),
    // but the range clamp must reject it.
    const pane = "Opus 4.7 (1M context) │ skynet ███░ 250%";
    expect(parseContextPct(pane)).toBeNull();
  });
});

// ─── 2026-08-06 new statusline hook shape ────────────────────────────────
// New contract from Ashley's Claude Code statusline hook rework: context %
// is the FIRST 2 chars of a line (zero-padded "00".."99" or literal "!!"
// = 100), followed by a space, followed by the bar. Disambiguation:
// `^(\d\d|!!) ` AND line contains a bar glyph.
describe("parseContextPct — new statusline hook (2026-08-06)", () => {
  it("returns int from leading 2-digit head when line starts with `\\d\\d ` and contains a bar", () => {
    expect(parseContextPct("24 ██░░░░░░░░")).toBe(24);
  });

  it("returns 4 from '04 ' (zero-padded, parsed as int)", () => {
    expect(parseContextPct("04 ░░░░░░░░░░ · Testing fix")).toBe(4);
  });

  it("returns 0 from '00 ' (zero-padded floor)", () => {
    expect(parseContextPct("00 ░░░░░░░░░░")).toBe(0);
  });

  it("returns 100 from '!! ' (literal-sentinel for full meter)", () => {
    expect(parseContextPct("!! ██████████")).toBe(100);
  });

  it("returns 99 from the 2-char-boundary case (highest non-sentinel)", () => {
    expect(parseContextPct("99 █████████░ · almost")).toBe(99);
  });

  it("ignores a leading `\\d\\d ` line WITHOUT a bar glyph (kills weekly-limit '95 %' false positive)", () => {
    // Even though "95" would parse as a percent, the AND-with-bar-glyph
    // filter rejects lines that lack any bar char — this is the whole
    // point of Nelly's disambiguation.
    const pane = "95 % of your weekly limit remains";
    expect(parseContextPct(pane)).toBeNull();
  });

  it("ignores a line that has a bar glyph but does NOT start with `\\d\\d ` (kills transcript-quote false positive)", () => {
    // Bar-anchored NN% not present either → all three passes miss.
    const pane = "> pasted transcript: ██░░ some bar chunk";
    expect(parseContextPct(pane)).toBeNull();
  });

  it("last matching new-statusline line wins across the 8-line window", () => {
    const pane = ["24 ██░░░░░░░░", "42 ████░░░░░░"].join("\n");
    expect(parseContextPct(pane)).toBe(42);
  });

  it("only scans the last 8 lines (new-shape line outside the window is ignored)", () => {
    const lines: string[] = [
      "99 █████████░", // line 1 — outside 8-line window
      "filler 1",
      "filler 2",
      "filler 3",
      "filler 4",
      "filler 5",
      "filler 6",
      "filler 7",
      "filler 8",
      "24 ██░░░░░░░░", // line 10 — inside window, real
    ];
    expect(parseContextPct(lines.join("\n"))).toBe(24);
  });

  it("new-shape line wins over legacy `context) NN%` line in the same pane (rollout-transition invariant)", () => {
    // During the fleet rollout a single pane can briefly hold both
    // shapes. The reworked statusline is authoritative — its value must
    // win regardless of the legacy line's presence or order.
    const legacyFirst = [
      "Opus 4.7 (1M context) │ skynet █████░ 71%",
      "24 ██░░░░░░░░",
    ].join("\n");
    expect(parseContextPct(legacyFirst)).toBe(24);

    const legacyLast = [
      "24 ██░░░░░░░░",
      "Opus 4.7 (1M context) │ skynet █████░ 71%",
    ].join("\n");
    // New-primary still wins — the pass order (new → old-primary → old-
    // fallback) short-circuits before old paths run.
    expect(parseContextPct(legacyLast)).toBe(24);
  });

  it("real-world statusline shape with trailing task label + gsd-update warning + last-cmd is parsed correctly", () => {
    // Approximation of `<PP> <bar>[ · <task>][ · <gsd-update-warning>][ · last: /cmd]`.
    const pane =
      "37 ███░░░░░░░ · Running vitest · gsd-update available · last: /gsd-quick";
    expect(parseContextPct(pane)).toBe(37);
  });

  it("legacy pane content still parses correctly when NO new-shape line is present (regression gate for pre-rollout sessions)", () => {
    // This is the Patch #187 primary path — must still work.
    const pane = "Opus 4.7 (1M context) │ skynet █████░ 29%";
    expect(parseContextPct(pane)).toBe(29);
  });

  it("tolerates leading whitespace before the head (Stacy 2026-08-06 portability fix — some tmux configs pad)", () => {
    // Two leading spaces before "42" — Nelly's own ctxwatch silent-failed
    // for ~5 min on this shape. Our regex now allows `^\s*(\d\d|!!) `.
    expect(parseContextPct("  42 ██████████")).toBe(42);
  });

  it("tolerates a single leading space before !! (leading-whitespace + sentinel combo)", () => {
    expect(parseContextPct(" !! ██████████")).toBe(100);
  });

  it("tolerates a tab before the head (defensive — any \\s covered by \\s*)", () => {
    expect(parseContextPct("\t17 ██░░░░░░░░")).toBe(17);
  });

  it("parses truncated narrow-pane statusline (Nicole 2026-08-07, pane width 8)", () => {
    // At ~8-column pane widths Claude Code truncates the bar glyph strip
    // to a horizontal ellipsis (U+2026), producing `  35 …` with NO bar
    // glyphs on the line. Before the fix, BAR_GLYPH_ANYWHERE_RE required
    // `[█░]` and returned null — the backend then never emitted, so the
    // frontend's initial null contextPct stayed null and the meter
    // rendered as 0-lit (visually identical to a real 0%). Fix accepts
    // `…` as an equivalent truncation cue.
    const pane = "  35 …\n  ⏵⏵ ·\n  new…";
    expect(parseContextPct(pane)).toBe(35);
  });
});
