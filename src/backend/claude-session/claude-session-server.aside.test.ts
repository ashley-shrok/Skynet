import { describe, it, expect } from "vitest";
import {
  BTW_PROMPT,
  ASIDE_END_MARKER,
  __asideShellQuoteForTests,
} from "./claude-session-server.js";

// Phase 14 Plan 01 Task 1 — RED-gate tests for the Wave 1 primitives.
//
// These tests validate the LOCKED contract from
// .planning/phases/14-plain-language-translation-asides/14-CONTEXT.md § Injection
// (BTW_PROMPT byte-for-byte) and § Specific Ideas (ASIDE_END_MARKER),
// plus the shellQuote parity with src/backend/ssh/terminal.ts L123.
//
// A `__asideShellQuoteForTests` re-export lets us verify the local helper
// without duplicating its 2-line body here. The two definitions (this file's
// consumer + terminal.ts L123) MUST remain byte-identical; if either shifts,
// this test file is one of the fail-loud tripwires.

describe("Phase 14 aside primitives — module-scope constants", () => {
  it("BTW_PROMPT is the EXACT literal from CONTEXT.md § Injection (character-for-character)", () => {
    // Do NOT paraphrase, do NOT tune, do NOT add framing (CONTEXT.md § Specifics).
    // The em-dash MUST be U+2014, not U+2013 or a hyphen-minus.
    expect(BTW_PROMPT).toBe(
      "/btw Re-explain whatever's currently going on to me without using code symbols, in a conceptual model style. Not a metaphor — explain the actual thing, don't recast it as an extended analogy.",
    );
  });

  it("BTW_PROMPT contains a real U+2014 em-dash (not U+2013 en-dash or hyphen-minus)", () => {
    expect(BTW_PROMPT.includes("—")).toBe(true);
    expect(BTW_PROMPT.includes("–")).toBe(false);
  });

  it("BTW_PROMPT starts with the exact `/btw ` slash-command prefix", () => {
    expect(BTW_PROMPT.startsWith("/btw ")).toBe(true);
  });

  it("ASIDE_END_MARKER is the literal substring `Esc to close`", () => {
    expect(ASIDE_END_MARKER).toBe("Esc to close");
  });
});

describe("Phase 14 aside primitives — shellQuote parity with terminal.ts L123", () => {
  it("wraps a plain string in single quotes", () => {
    expect(__asideShellQuoteForTests("hello")).toBe("'hello'");
  });

  it("escapes embedded single quotes via POSIX '\\'' idiom", () => {
    // Input:  it's
    // Output: 'it'\''s'  — closes the wrap, escapes literal ', re-opens the wrap.
    expect(__asideShellQuoteForTests("it's")).toBe("'it'\\''s'");
  });

  it("wraps empty string as ''", () => {
    expect(__asideShellQuoteForTests("")).toBe("''");
  });

  it("preserves other shell metacharacters inside the single-quoted string (they are literal inside single quotes)", () => {
    expect(__asideShellQuoteForTests("$FOO;rm -rf /")).toBe("'$FOO;rm -rf /'");
  });
});
