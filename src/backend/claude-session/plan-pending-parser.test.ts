import { describe, it, expect } from "vitest";
import {
  isPlanPending,
  parsePlanFilePath,
} from "./plan-pending-parser.js";

// Test scaffolding: each test constructs a synthetic tmux capture-pane
// output (single- or multi-line) and asserts the boolean-or-string-or-null
// returned by the pure helpers. Cases mirror the plan's <behavior> block
// for Phase 24 Plan 01 — the fixtures drive both `isPlanPending` (with the
// pinned fleet Ink variant strings — the pre-Phase-24 fixtures targeted
// obsolete strings that never appeared in production) and the new
// `parsePlanFilePath` helper (footer path extraction).
//
// Shape mirrors context-pct-parser.test.ts: synthetic pane strings +
// simple assertions, no I/O, no mocks. The pure-helper posture is what
// makes these cases meaningful — the helpers know nothing about SSH,
// tmux, or WS state.

describe("isPlanPending — pane-scrape plan-approval detection (Phase 24 Plan 01, pinned fleet Ink variant)", () => {
  it("positive: pinned fleet Ink variant (header anywhere + shift+tab footer marker)", () => {
    // Pane text with the pinned-variant header string somewhere in the
    // middle/top and the pinned-variant footer marker in the last 30
    // lines. Optionally includes the footer path line (parsePlanFilePath
    // parses it, but isPlanPending only needs header + shift+tab marker).
    const pane = [
      "some earlier conversation lines",
      "",
      "Claude has written up a plan and is ready to execute. Would you like to proceed?",
      "",
      "1. Yes",
      "2. No, and tell Claude what to do differently",
      "",
      "ctrl-g to edit in  Vim  · ~/.claude/plans/groovy-watching-leaf.md",
      "shift+tab to approve with this feedback",
    ].join("\n");
    expect(isPlanPending(pane)).toBe(true);
  });

  it("negative: header-only (prose paraphrase of header, no shift+tab footer marker)", () => {
    // A prior turn's transcript paraphrases the header line as prose, but
    // there is no footer marker in the last 30 lines. The paired-condition
    // fingerprint (header-anywhere AND bottom-slice marker) must reject.
    const pane = [
      "user: earlier I remember Claude has written up a plan and is ready to execute. Would you like to proceed? was the header",
      "         but I want to talk about something else now.",
      "",
      "assistant: sure, what would you like to discuss?",
      "",
      "$ ls",
      "file1  file2  file3",
    ].join("\n");
    expect(isPlanPending(pane)).toBe(false);
  });

  it("negative: footer-marker-in-prose but NOT in bottom slice (padded past the 30-line tail)", () => {
    // `shift+tab to approve with this feedback` appears in the middle of
    // the pane as prose, and there is no header. The bottom-30 slice does
    // NOT contain the marker, so the fingerprint must reject.
    const proseLine =
      "assistant: yeah, `shift+tab to approve with this feedback` is the Ink footer";
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

describe("parsePlanFilePath — footer path extraction (Phase 24 Plan 01)", () => {
  it("extracts the tilde-relative plans path from the footer with the exact Ink spacing", () => {
    // Footer format is verbatim from Amelia's pane 2026-08-04:
    //   `ctrl-g to edit in  Vim  · ~/.claude/plans/<slug>.md`
    // Note: DOUBLE space between "in" and "Vim", middle-dot `·` U+00B7
    // between "Vim" and the path, single-space separators on either side
    // of the middle dot.
    const pane = [
      "some earlier lines",
      "ctrl-g to edit in  Vim  · ~/.claude/plans/groovy-watching-leaf.md",
      "shift+tab to approve with this feedback",
    ].join("\n");
    expect(parsePlanFilePath(pane)).toBe(
      "~/.claude/plans/groovy-watching-leaf.md",
    );
  });

  it("returns null when the footer is absent (presence detection stays authoritative)", () => {
    expect(parsePlanFilePath("no footer here")).toBeNull();
  });

  it("returns null when the slug contains uppercase letters", () => {
    const pane =
      "ctrl-g to edit in  Vim  · ~/.claude/plans/FooBar.md";
    expect(parsePlanFilePath(pane)).toBeNull();
  });

  it("returns null when the slug contains a slash (traversal attempt at the parser layer)", () => {
    // Defense-in-depth: even though the SFTP-fetch caller (Plan 02)
    // re-validates, the parser regex's slug charset `[a-z0-9-]+` already
    // refuses `/` inside the slug. `foo/bar` looks like a traversal shim.
    const pane =
      "ctrl-g to edit in  Vim  · ~/.claude/plans/foo/bar.md";
    expect(parsePlanFilePath(pane)).toBeNull();
  });

  it("returns null when the slug contains a backtick (shell-injection shim)", () => {
    const pane =
      "ctrl-g to edit in  Vim  · ~/.claude/plans/foo`bar.md";
    expect(parsePlanFilePath(pane)).toBeNull();
  });

  it("returns null when the extension is not .md", () => {
    const pane =
      "ctrl-g to edit in  Vim  · ~/.claude/plans/foo.txt";
    expect(parsePlanFilePath(pane)).toBeNull();
  });

  // WR-01 regression tests (Phase 24 code review). Prior to the fix,
  // `parsePlanFilePath` scanned the whole pane; a prose-earlier decoy
  // (e.g. a prior transcript turn that quoted a plan path) could win over
  // the real footer path. Anchoring to the bottom-30 slice — same rationale
  // as `isPlanPending` — closes that gap.
  it("WR-01: bottom-slice anchoring picks the FOOTER path over a prose-earlier decoy in the same pane", () => {
    // Line 1 is a prose "decoy" that references OLD-SLUG. Lines 2..79 are
    // filler so the decoy sits WELL above the bottom-30 window. The real
    // footer at the bottom carries REAL-SLUG. The bottom-slice anchor must
    // return REAL-SLUG, not OLD-SLUG.
    const decoyLine =
      "assistant: earlier I generated ~/.claude/plans/old-plan-slug.md but that's stale";
    const filler: string[] = [];
    for (let i = 0; i < 78; i++) filler.push(`filler line ${i}`);
    const pane = [
      decoyLine,
      ...filler,
      "ctrl-g to edit in  Vim  · ~/.claude/plans/real-current-slug.md",
      "shift+tab to approve with this feedback",
    ].join("\n");
    expect(parsePlanFilePath(pane)).toBe(
      "~/.claude/plans/real-current-slug.md",
    );
  });

  it("WR-01: returns null when the plan path only appears as prose above the bottom-30 slice (no real footer)", () => {
    // The plan path is quoted in transcript prose near the top of the
    // pane, but there is no footer in the last 30 lines. Presence detection
    // upstream would also return false; the parser must not extract the
    // prose path as a fallback.
    const proseLine =
      "assistant: check out ~/.claude/plans/prose-only-slug.md if you want the history";
    const filler: string[] = [];
    for (let i = 0; i < 60; i++) filler.push(`filler line ${i}`);
    const pane = [proseLine, ...filler].join("\n");
    expect(parsePlanFilePath(pane)).toBeNull();
  });
});
