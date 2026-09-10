import { describe, it, expect } from "vitest";
import {
  splitIntoSentences,
  packChunks,
  CHUNK_MAX_CHARS,
} from "./chunk-and-stitch.js";

/**
 * Phase 98 plan 02 — chunk-and-stitch truth-table test suite.
 *
 * Two pure kernels consumed by `voice.ts::handleSpeakStream`:
 *
 *   1. `splitIntoSentences` — sentence-boundary regex with an abbreviation
 *      guard set. Guards common English abbreviations (Mr, Mrs, Dr, etc.)
 *      so "Dr. Smith went home." parses as ONE sentence, not two.
 *
 *   2. `packChunks` — greedy packer that fills chunks up to
 *      `CHUNK_MAX_CHARS` (2900 — 100-char safety margin under Polly's
 *      3000-billed-char ceiling per 98-CONTEXT.md § Backend-owned
 *      orchestration).
 *
 * Coverage rationale:
 *
 * - Every truth-table row in 98-02-PLAN.md § Task 2 behavior gets a
 *   dedicated `it()` block for grep-ability and failure-message clarity.
 *
 * - The over-length single sentence test asserts the word-boundary
 *   fallback works and produces multiple sub-chunks all ≤ CHUNK_MAX_CHARS.
 *
 * - The abbreviation guard set is exercised across Mr, Mrs, Dr, and a
 *   compound sentence ("Mr. and Mrs. Smith are here.") to prove multiple
 *   abbreviations in a single sentence don't create spurious splits.
 */

describe("CHUNK_MAX_CHARS constant", () => {
  it("equals 2900 (100-char safety margin under Polly's 3000-billed ceiling)", () => {
    expect(CHUNK_MAX_CHARS).toBe(2900);
  });
});

describe("splitIntoSentences — edge cases", () => {
  it("empty string returns [] (NOT [''])", () => {
    expect(splitIntoSentences("")).toEqual([]);
  });

  it("single sentence with period", () => {
    expect(splitIntoSentences("Hello.")).toEqual(["Hello."]);
  });

  it("two sentences separated by period + space", () => {
    expect(splitIntoSentences("Hello. World!")).toEqual(["Hello.", "World!"]);
  });

  it("three sentences with mixed terminators (. ! ?)", () => {
    const result = splitIntoSentences("Hello. World! How are you?");
    expect(result.length).toBe(3);
    expect(result[0]).toBe("Hello.");
    expect(result[1]).toBe("World!");
    expect(result[2]).toBe("How are you?");
  });

  it("newline after terminator is treated as whitespace", () => {
    const result = splitIntoSentences("Hello.\nWorld.");
    expect(result.length).toBe(2);
    expect(result[0]).toBe("Hello.");
    expect(result[1]).toBe("World.");
  });
});

describe("splitIntoSentences — abbreviation guards", () => {
  it("'Dr. Smith went home.' → 1 sentence (Dr guarded)", () => {
    const result = splitIntoSentences("Dr. Smith went home.");
    expect(result).toEqual(["Dr. Smith went home."]);
  });

  it("'Mr. and Mrs. Smith are here.' → 1 sentence (Mr + Mrs both guarded)", () => {
    const result = splitIntoSentences("Mr. and Mrs. Smith are here.");
    expect(result.length).toBe(1);
    expect(result[0]).toBe("Mr. and Mrs. Smith are here.");
  });

  it("'Prof. Johnson teaches CS. Students love it.' → 2 sentences (Prof guarded, then real terminator)", () => {
    const result = splitIntoSentences("Prof. Johnson teaches CS. Students love it.");
    expect(result.length).toBe(2);
    expect(result[0]).toBe("Prof. Johnson teaches CS.");
    expect(result[1]).toBe("Students love it.");
  });

  it("'She works at St. Mary. It is downtown.' → 2 sentences (St guarded)", () => {
    const result = splitIntoSentences("She works at St. Mary. It is downtown.");
    expect(result.length).toBe(2);
  });
});

describe("packChunks — basic behavior", () => {
  it("empty array returns []", () => {
    expect(packChunks([])).toEqual([]);
  });

  it("single short sentence returns 1 chunk with that sentence", () => {
    expect(packChunks(["Hello."])).toEqual(["Hello."]);
  });

  it("multiple short sentences pack into a single chunk when combined ≤ 2900", () => {
    const sentences = ["Hello.", "World!", "How are you?"];
    const chunks = packChunks(sentences);
    expect(chunks.length).toBe(1);
    // All sentences preserved in the single chunk
    expect(chunks[0]).toContain("Hello.");
    expect(chunks[0]).toContain("World!");
    expect(chunks[0]).toContain("How are you?");
  });

  it("closes current chunk and starts new one when adding a sentence would exceed 2900", () => {
    // Build 3 sentences of ~1500 chars each. First 2 fit in chunk 1 (3000 > 2900,
    // so second one starts a new chunk). Actually 1500+1500+separator > 2900, so
    // sentence 1 → chunk 1, sentence 2 → chunk 2, sentence 3 → chunk 3.
    const s1 = "A".repeat(1500) + ".";
    const s2 = "B".repeat(1500) + ".";
    const s3 = "C".repeat(1500) + ".";
    const chunks = packChunks([s1, s2, s3]);
    // Each 1501-char sentence stands alone (1501 + 1 + 1501 = 3003 > 2900).
    expect(chunks.length).toBe(3);
    expect(chunks[0]).toBe(s1);
    expect(chunks[1]).toBe(s2);
    expect(chunks[2]).toBe(s3);
  });

  it("no chunk exceeds CHUNK_MAX_CHARS across a mix of sizes", () => {
    const sentences = [
      "A".repeat(500) + ".",
      "B".repeat(500) + ".",
      "C".repeat(500) + ".",
      "D".repeat(500) + ".",
      "E".repeat(500) + ".",
      "F".repeat(500) + ".",
    ];
    const chunks = packChunks(sentences);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
    }
  });
});

describe("packChunks — word-boundary fallback for over-length single sentence", () => {
  it("5000-char single sentence produces ≥ 2 sub-chunks, all ≤ CHUNK_MAX_CHARS", () => {
    // Build a 5000-char sentence composed of 500 words of 9 chars + 1 space = 10 chars.
    const words: string[] = [];
    for (let i = 0; i < 500; i++) {
      words.push("wordwordw"); // 9 chars
    }
    const bigSentence = words.join(" ") + "."; // 500*9 + 499 spaces + 1 period = 5000
    expect(bigSentence.length).toBe(5000);

    const chunks = packChunks([bigSentence]);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
    }
  });

  it("over-length single sentence with current chunk in-flight closes current first", () => {
    const short = "Hello world.";
    const bigWords: string[] = [];
    for (let i = 0; i < 500; i++) {
      bigWords.push("wordwordw");
    }
    const bigSentence = bigWords.join(" ") + "."; // 5000 chars
    const chunks = packChunks([short, bigSentence]);
    // First chunk is "Hello world." (current at time of over-length trigger),
    // then the over-length sentence splits into multiple sub-chunks.
    expect(chunks[0]).toBe(short);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
    }
  });
});
