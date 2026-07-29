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
