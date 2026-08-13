import { describe, it, expect } from "vitest";
import {
  applyServerSlashTransform,
  MAX_SKILL_WORDS,
} from "./slashCommandTransform.js";

/**
 * Phase 34 plan 01 — slashCommandTransform truth-table test suite.
 *
 * Two describe blocks (passthrough + matches), one `it()` per truth-table
 * row. Every row of CONTEXT.md § Specific Ideas has a dedicated `it()`
 * block for grep-ability and failure-message clarity — DO NOT combine
 * rows into a single parameterized test; each row is a locked design
 * contract row.
 *
 * Coverage rationale:
 *
 * - Passthrough block guards the false-positive rate — natural English
 *   ("hello world", "not slash gsd status"), edge shapes (empty, bare
 *   wake-word with no content, wake-word HIT but no catalog prefix
 *   match), and case-insensitivity of the gate (where the tokens still
 *   need to lowercase for catalog lookup) must all behave correctly.
 *
 * - Matches block covers the CONTEXT.md § Specific Ideas truth table
 *   verbatim (greedy longest-prefix, 1-token fallback when the longer
 *   candidate is not in catalog, verbatim-tail preservation across
 *   whitespace / punctuation / capitalization, punctuation-tolerant wake-
 *   word gate, multi-line `s` flag), plus the defensive MAX_SKILL_WORDS
 *   cap and empty-catalog degeneracy.
 *
 * Shared CATALOG fixture matches CONTEXT.md § Specific Ideas exactly so
 * every truth-table row is reproducible by pasting into the file.
 */

const CATALOG = new Set(["gsd-quick", "gsd", "explain", "bounty", "queue"]);

describe("applyServerSlashTransform — passthrough (no wake-word / no catalog hit)", () => {
  it("empty string", () => {
    const result = applyServerSlashTransform("", CATALOG);
    expect(result.matched).toBe(false);
    expect(result.transformed).toBe("");
    expect(result.command).toBe(null);
  });

  it("'hello world' (no wake-word)", () => {
    const result = applyServerSlashTransform("hello world", CATALOG);
    expect(result.matched).toBe(false);
    expect(result.transformed).toBe("hello world");
    expect(result.command).toBe(null);
  });

  it("'not slash gsd status' (mid-message wake-word — front-anchor rejects)", () => {
    const input = "not slash gsd status";
    const result = applyServerSlashTransform(input, CATALOG);
    expect(result.matched).toBe(false);
    expect(result.transformed).toBe(input);
    expect(result.command).toBe(null);
  });

  it("'slash' (bare wake-word, no content — `\\S.*` clause rejects)", () => {
    const result = applyServerSlashTransform("slash", CATALOG);
    expect(result.matched).toBe(false);
    expect(result.transformed).toBe("slash");
    expect(result.command).toBe(null);
  });

  it("'slash   ' (bare + trailing whitespace — `\\S.*` clause rejects)", () => {
    const result = applyServerSlashTransform("slash   ", CATALOG);
    expect(result.matched).toBe(false);
    expect(result.transformed).toBe("slash   ");
    expect(result.command).toBe(null);
  });

  it("'slash nonesuch do a thing' (wake-word HIT but no catalog prefix matches)", () => {
    const input = "slash nonesuch do a thing";
    const result = applyServerSlashTransform(input, CATALOG);
    expect(result.matched).toBe(false);
    // Byte-identical passthrough — the whole point of the fail-open
    // posture is that Ashley still sees her transcript when a
    // slash-invocation misses.
    expect(result.transformed).toBe(input);
    expect(result.command).toBe(null);
  });

  it("'SLASH GSD status' (case-insensitive gate HIT, catalog lowercase lookup MATCHES)", () => {
    // Verifies case-insensitivity of the gate AND lowercasing of tokens
    // for catalog lookup — this is a MATCH case, not a passthrough. Kept
    // in the passthrough block because it directly follows from the
    // gate-case-insensitivity acceptance criteria; the assertion is that
    // the gate case + lowercase-tokens together produce the transform.
    const result = applyServerSlashTransform("SLASH GSD status", CATALOG);
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/gsd");
    expect(result.transformed).toBe("/gsd status");
  });

  it("wake-word regex satisfied but tokens degenerate (defensive passthrough)", () => {
    // Edge case: the `\S.*` clause on the wake-word regex guarantees at
    // least one non-whitespace char in postSlash, so the tokenizer
    // should never produce an empty list on a wake-word HIT. But the
    // matcher guards against it anyway — this test asserts that
    // defensive posture stays a passthrough. We can't easily construct
    // an input that hits the guard organically (the regex prevents it),
    // so we assert on the closest neighbor: a wake-word HIT with a
    // token that starts a candidate but doesn't match any catalog key.
    const input = "slash zzz";
    const result = applyServerSlashTransform(input, CATALOG);
    expect(result.matched).toBe(false);
    expect(result.transformed).toBe(input);
    expect(result.command).toBe(null);
  });
});

describe("applyServerSlashTransform — matches from CONTEXT.md § Specific Ideas truth table", () => {
  it("'slash gsd quick fix the login bug' (longest-prefix wins: gsd-quick > gsd)", () => {
    const result = applyServerSlashTransform(
      "slash gsd quick fix the login bug",
      CATALOG,
    );
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/gsd-quick");
    expect(result.transformed).toBe("/gsd-quick fix the login bug");
  });

  it("'slash gsd status' (1-token match — gsd-status not in catalog)", () => {
    const result = applyServerSlashTransform("slash gsd status", CATALOG);
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/gsd");
    expect(result.transformed).toBe("/gsd status");
  });

  it("'slash explain the NDA thing.' (trailing period on tail preserved verbatim)", () => {
    const result = applyServerSlashTransform(
      "slash explain the NDA thing.",
      CATALOG,
    );
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/explain");
    expect(result.transformed).toBe("/explain the NDA thing.");
  });

  it("'slash bounty, add a banana button' (leading comma+space after matched token eaten by delimiter-skip)", () => {
    const result = applyServerSlashTransform(
      "slash bounty, add a banana button",
      CATALOG,
    );
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/bounty");
    expect(result.transformed).toBe("/bounty add a banana button");
  });

  it("'slash queue' (empty tail → no trailing space)", () => {
    const result = applyServerSlashTransform("slash queue", CATALOG);
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/queue");
    expect(result.transformed).toBe("/queue");
  });

  it("'slash queue   ' (whitespace-only tail → no trailing space)", () => {
    const result = applyServerSlashTransform("slash queue   ", CATALOG);
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/queue");
    expect(result.transformed).toBe("/queue");
  });

  it("'slash gsd quick.  Fix the login bug' (verbatim-tail: leading period+spaces eaten, uppercase F preserved)", () => {
    const result = applyServerSlashTransform(
      "slash gsd quick.  Fix the login bug",
      CATALOG,
    );
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/gsd-quick");
    expect(result.transformed).toBe("/gsd-quick Fix the login bug");
  });

  it("'slash. gsd status' (Whisper-inserted period after wake-word — punctuation-tolerant gate)", () => {
    const result = applyServerSlashTransform("slash. gsd status", CATALOG);
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/gsd");
    expect(result.transformed).toBe("/gsd status");
  });

  it("'slash, bounty add a thing' (Whisper-inserted comma after wake-word)", () => {
    const result = applyServerSlashTransform(
      "slash, bounty add a thing",
      CATALOG,
    );
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/bounty");
    expect(result.transformed).toBe("/bounty add a thing");
  });

  it("'  slash bounty add a thing' (leading whitespace tolerated by `^\\s*`)", () => {
    const result = applyServerSlashTransform(
      "  slash bounty add a thing",
      CATALOG,
    );
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/bounty");
    expect(result.transformed).toBe("/bounty add a thing");
  });

  it("multi-line tail via `s` flag ('slash bounty add a thing\\nand more')", () => {
    const result = applyServerSlashTransform(
      "slash bounty add a thing\nand more",
      CATALOG,
    );
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/bounty");
    expect(result.transformed).toBe("/bounty add a thing\nand more");
  });

  it("MAX_SKILL_WORDS cap enforced (7-token skill exceeds cap → passthrough)", () => {
    // With a catalog whose only entry is 6 kebab-tokens long, the
    // matcher's prefix-join loop only considers K ≤ MAX_SKILL_WORDS (5),
    // so the 6-token candidate is never even looked up. Result:
    // passthrough. This asserts the defensive cap does what it claims.
    const bigSkillCatalog = new Set(["a-b-c-d-e-f"]);
    const input = "slash a b c d e f rest";
    const result = applyServerSlashTransform(input, bigSkillCatalog);
    expect(result.matched).toBe(false);
    expect(result.transformed).toBe(input);
    expect(result.command).toBe(null);
    // Sanity: MAX_SKILL_WORDS is the value the cap enforces.
    expect(MAX_SKILL_WORDS).toBe(5);
  });

  it("empty catalog — any wake-word HIT → passthrough, no crash", () => {
    const emptyCatalog = new Set<string>();
    const input = "slash gsd status";
    const result = applyServerSlashTransform(input, emptyCatalog);
    expect(result.matched).toBe(false);
    expect(result.transformed).toBe(input);
    expect(result.command).toBe(null);
  });
});
