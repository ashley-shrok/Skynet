import { describe, it, expect } from "vitest";
import { applyIntentTransform } from "./composeIntentTransform";

/**
 * Quick task 260801-54e — composeIntentTransform test suite.
 *
 * 25 vitest cases in two describe blocks (10 passthrough + 15 bounty-transform,
 * including 4 Whisper-shape UAT cases per PLAN <behavior>).
 *
 * Coverage rationale:
 * - Passthrough block guards the false-positive rate — natural English doubled
 *   words ("hello hello world", "no no do not do that") and edge shapes (glued,
 *   already-slashed, mid-message, bare with no content) must all pass through
 *   unchanged with `matched:false`.
 * - Bounty-transform block covers the happy path, case-insensitivity (both the
 *   first `[a-z]+` capture AND the `\1` backref must honor the `i` flag),
 *   punctuation-both-sides tolerance (Whisper transcripts habitually insert
 *   commas/periods between the doubled words AND after the second one),
 *   whitespace normalization, multi-line rest via `s` flag, and the exact 4
 *   Whisper-shape UAT strings Ashley provided in scratch/UAT.
 */

describe("passthrough (no transform)", () => {
  it("empty string", () => {
    const result = applyIntentTransform("");
    expect(result.matched).toBe(false);
    expect(result.transformed).toBe("");
    expect(result.command).toBe(null);
  });

  it("single word 'bounty' (no doubling)", () => {
    const result = applyIntentTransform("bounty");
    expect(result.matched).toBe(false);
    expect(result.transformed).toBe("bounty");
  });

  it("single 'bounty' followed by content (no doubling)", () => {
    const result = applyIntentTransform("bounty add a banana button");
    expect(result.matched).toBe(false);
    expect(result.transformed).toBe("bounty add a banana button");
  });

  it("doubled word NOT in registry ('hello hello world')", () => {
    const result = applyIntentTransform("hello hello world");
    expect(result.matched).toBe(false);
    expect(result.transformed).toBe("hello hello world");
  });

  it("common English doubling NOT in registry ('no no do not do that')", () => {
    const result = applyIntentTransform("no no do not do that");
    expect(result.matched).toBe(false);
    expect(result.transformed).toBe("no no do not do that");
  });

  it("doubled 'bounty bounty' NOT at the front", () => {
    const result = applyIntentTransform("foo bounty bounty add a thing");
    expect(result.matched).toBe(false);
    expect(result.transformed).toBe("foo bounty bounty add a thing");
  });

  it("glued 'bountybounty' with no separator", () => {
    const result = applyIntentTransform("bountybounty add a thing");
    expect(result.matched).toBe(false);
    expect(result.transformed).toBe("bountybounty add a thing");
  });

  it("bare 'bounty bounty' with no content after", () => {
    const result = applyIntentTransform("bounty bounty");
    expect(result.matched).toBe(false);
    expect(result.transformed).toBe("bounty bounty");
  });

  it("bare 'bounty bounty   ' with only trailing whitespace", () => {
    const result = applyIntentTransform("bounty bounty   ");
    expect(result.matched).toBe(false);
    expect(result.transformed).toBe("bounty bounty   ");
  });

  it("already slash-prefixed ('/bounty add a thing')", () => {
    const result = applyIntentTransform("/bounty add a thing");
    expect(result.matched).toBe(false);
    expect(result.transformed).toBe("/bounty add a thing");
  });
});

describe("bounty transform (registry match)", () => {
  it("plain 'bounty bounty add a banana button'", () => {
    const result = applyIntentTransform("bounty bounty add a banana button");
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/bounty");
    expect(result.transformed).toBe("/bounty add a banana button");
  });

  it("case-insensitive first word ('Bounty bounty add a thing')", () => {
    const result = applyIntentTransform("Bounty bounty add a thing");
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/bounty");
    expect(result.transformed).toBe("/bounty add a thing");
  });

  it("both uppercase ('BOUNTY BOUNTY high priority thing')", () => {
    const result = applyIntentTransform("BOUNTY BOUNTY high priority thing");
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/bounty");
    expect(result.transformed).toBe("/bounty high priority thing");
  });

  it("backref respects i flag ('bounty Bounty add a thing')", () => {
    const result = applyIntentTransform("bounty Bounty add a thing");
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/bounty");
    expect(result.transformed).toBe("/bounty add a thing");
  });

  it("comma between ('bounty, bounty add a thing')", () => {
    const result = applyIntentTransform("bounty, bounty add a thing");
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/bounty");
    expect(result.transformed).toBe("/bounty add a thing");
  });

  it("period between ('bounty. bounty add a thing')", () => {
    const result = applyIntentTransform("bounty. bounty add a thing");
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/bounty");
    expect(result.transformed).toBe("/bounty add a thing");
  });

  it("hyphen between ('bounty-bounty add a thing')", () => {
    const result = applyIntentTransform("bounty-bounty add a thing");
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/bounty");
    expect(result.transformed).toBe("/bounty add a thing");
  });

  it("extra whitespace ('bounty   bounty add a thing')", () => {
    const result = applyIntentTransform("bounty   bounty add a thing");
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/bounty");
    expect(result.transformed).toBe("/bounty add a thing");
  });

  it("leading whitespace ('   bounty bounty add a thing')", () => {
    const result = applyIntentTransform("   bounty bounty add a thing");
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/bounty");
    expect(result.transformed).toBe("/bounty add a thing");
  });

  it("content punctuation preserved verbatim", () => {
    const result = applyIntentTransform(
      "bounty bounty high priority: add a banana button, if you can",
    );
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/bounty");
    expect(result.transformed).toBe(
      "/bounty high priority: add a banana button, if you can",
    );
  });

  it("multi-line rest via s flag ('bounty bounty add a thing\\nand more')", () => {
    const result = applyIntentTransform("bounty bounty add a thing\nand more");
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/bounty");
    expect(result.transformed).toBe("/bounty add a thing\nand more");
  });

  it("WHISPER UAT — 'Bounty, bounty. Buzz, buzz, I'm a bee.'", () => {
    const result = applyIntentTransform("Bounty, bounty. Buzz, buzz, I'm a bee.");
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/bounty");
    expect(result.transformed).toBe("/bounty Buzz, buzz, I'm a bee.");
  });

  it("WHISPER UAT — 'Bounty bounty, bananas are delicious.'", () => {
    const result = applyIntentTransform("Bounty bounty, bananas are delicious.");
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/bounty");
    expect(result.transformed).toBe("/bounty bananas are delicious.");
  });

  it("period-after-second-word tolerance ('bounty bounty. add a thing')", () => {
    const result = applyIntentTransform("bounty bounty. add a thing");
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/bounty");
    expect(result.transformed).toBe("/bounty add a thing");
  });

  it("comma-after-second-word tolerance ('bounty bounty, add a thing')", () => {
    const result = applyIntentTransform("bounty bounty, add a thing");
    expect(result.matched).toBe(true);
    expect(result.command).toBe("/bounty");
    expect(result.transformed).toBe("/bounty add a thing");
  });
});
