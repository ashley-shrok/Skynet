import { describe, it, expect } from "vitest";
import { isPlanPending } from "./plan-pending-parser.js";

// Test scaffolding: each test constructs a synthetic tmux capture-pane
// output (single- or multi-line) and asserts the boolean returned by
// isPlanPending. Cases mirror the plan's <behavior> block for
// quick 260802-rps — 2 positive variants (3-option with
// --dangerously-skip-permissions, 2-option default) plus 4 negatives
// (header-only-no-prompt, options-in-prose, empty/whitespace, random
// terminal output).
//
// Shape mirrors context-pct-parser.test.ts: synthetic pane strings +
// boolean assertions, no I/O, no mocks. The pure-helper posture is what
// makes these cases meaningful — the helper knows nothing about SSH,
// tmux, or WS state.

describe("isPlanPending — pane-scrape plan-approval detection (quick 260802-rps)", () => {
  it("positive: 3-option variant (--dangerously-skip-permissions on)", () => {
    // Pane text with the "Here is Claude's plan:" header somewhere in the
    // pane and the 3-option prompt at the bottom. The load-bearing
    // `No, keep planning` marker is option 3.
    const pane = [
      "some earlier conversation lines",
      "Here is Claude's plan:",
      "```",
      "1. Do the first thing",
      "2. Do the second thing",
      "```",
      "",
      "╭──────────────────────────────────────────────────╮",
      "│ Would you like to proceed?                       │",
      "│                                                  │",
      "│ ❯ 1. Yes, and bypass permissions                 │",
      "│   2. Yes, proceed                                │",
      "│   3. No, keep planning                           │",
      "╰──────────────────────────────────────────────────╯",
    ].join("\n");
    expect(isPlanPending(pane)).toBe(true);
  });

  it("positive: 2-option variant (default, no --dangerously-skip-permissions)", () => {
    // Pane text with the "Ready to code?" header and the 2-option prompt
    // at the bottom. `No, keep planning` is option 2 in this variant.
    const pane = [
      "some earlier conversation lines",
      "Ready to code?",
      "",
      "╭──────────────────────────────────────────────────╮",
      "│ ❯ 1. Yes, proceed                                │",
      "│   2. No, keep planning                           │",
      "╰──────────────────────────────────────────────────╯",
    ].join("\n");
    expect(isPlanPending(pane)).toBe(true);
  });

  it("negative: header-only-no-prompt (transcript quote of header, no options)", () => {
    // A prior turn's transcript quotes `Here is Claude's plan:` as prose,
    // but there is no numbered-options prompt at the bottom and no
    // `No, keep planning` marker anywhere. Should be false.
    const pane = [
      "user: earlier I remember you said 'Here is Claude's plan:' before",
      "         listing steps, but I want to talk about something else now.",
      "",
      "assistant: sure, what would you like to discuss?",
      "",
      "$ ls",
      "file1  file2  file3",
    ].join("\n");
    expect(isPlanPending(pane)).toBe(false);
  });

  it("negative: options-in-prose (marker appears earlier but NOT in bottom slice)", () => {
    // `No, keep planning` appears in the middle of the pane as prose
    // (e.g. a code-review comment quoting the option), and there is no
    // header. The bottom-30 slice does NOT contain the marker, so the
    // fingerprint must reject.
    const proseLine =
      "assistant: yeah, I remember the 'No, keep planning' option from earlier";
    // Push the prose line WAY above the bottom-30 slice by padding with
    // 60 filler lines afterward.
    const filler: string[] = [];
    for (let i = 0; i < 60; i++) filler.push(`filler line ${i}`);
    const pane = [proseLine, ...filler].join("\n");
    expect(isPlanPending(pane)).toBe(false);
  });

  it("negative: empty and whitespace-only pane text", () => {
    expect(isPlanPending("")).toBe(false);
    expect(isPlanPending("   \n  \n")).toBe(false);
  });

  it("negative: random terminal output with no plan-mode markers", () => {
    const pane = [
      "$ npm run build",
      "> skynet@1.0.0 build",
      "> vite build && node scripts/build-backend.js",
      "",
      "vite v5.4.11 building for production...",
      "✓ 234 modules transformed.",
      "dist/index.html                  0.46 kB",
      "dist/assets/index-abc123.js    123.45 kB",
      "✓ built in 3.21s",
      "$ ",
    ].join("\n");
    expect(isPlanPending(pane)).toBe(false);
  });
});
