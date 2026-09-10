import { describe, it, expect } from "vitest";
import {
  stitchChunks,
  longestCommonRun,
  type ChunkResult,
} from "./word-stitcher.js";
import type { Item } from "@aws-sdk/client-transcribe-streaming";

/**
 * Phase 100 Plan 02 — word-stitcher truth-table test suite.
 *
 * Pure-function tests — no mocks, no I/O, no external state.
 * Every `it()` block maps to a behavior case from 100-02-PLAN.md § Task 1
 * <behavior> specification.
 *
 * Coverage:
 *   Test 1  — Normal overlap: matching word run deduplicated at seam
 *   Test 2  — Zero-match fallback: hard-cut when no common run found
 *   Test 3  — Empty-Items fallback / Pitfall 6: string join, no crash
 *   Test 4  — Gap-marker passthrough / D-08: "[...]" appears verbatim
 *   Test 5  — Single chunk: returns transcript verbatim
 *   Test 6  — Empty array: returns ""
 *   Test 7  — Punctuation filter: commas excluded from run matching
 *   Test 8  — Case-insensitive match: "The" matches "the"
 *   Test 9  — longestCommonRun pure function edge cases
 *   Test 10 — Timestamp adjustment / Pitfall 1: global ordering preserved
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(
  content: string,
  startTime: number,
  type: "pronunciation" | "punctuation" = "pronunciation",
): Item {
  return {
    Content: content,
    StartTime: startTime,
    EndTime: startTime + 0.3,
    Type: type,
  };
}

// ---------------------------------------------------------------------------
// Test 9: longestCommonRun pure function (tested first since other tests depend
// on understanding it)
// ---------------------------------------------------------------------------

describe("longestCommonRun", () => {
  it("finds run of 2 at end of a and start of b: ['a','b','c','d'] vs ['c','d','e','f'] === 2", () => {
    expect(longestCommonRun(["a", "b", "c", "d"], ["c", "d", "e", "f"])).toBe(2);
  });

  it("returns 0 when no common words: ['a','b'] vs ['c','d']", () => {
    expect(longestCommonRun(["a", "b"], ["c", "d"])).toBe(0);
  });

  it("returns 0 for empty arrays: [] vs []", () => {
    expect(longestCommonRun([], [])).toBe(0);
  });

  it("returns 0 when one side is empty", () => {
    expect(longestCommonRun(["a", "b"], [])).toBe(0);
    expect(longestCommonRun([], ["a", "b"])).toBe(0);
  });

  it("finds a single-word common run", () => {
    expect(longestCommonRun(["hello"], ["hello"])).toBe(1);
  });

  it("finds a run that starts in the middle of a and start of b", () => {
    // "b c" appears in both: end of a (positions 1-2) and start of b (positions 0-1)
    expect(longestCommonRun(["a", "b", "c"], ["b", "c", "d"])).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Test 6: Empty array
// ---------------------------------------------------------------------------

describe("stitchChunks — empty array", () => {
  it("returns empty string for []", () => {
    expect(stitchChunks([], 1.5)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Test 5: Single chunk
// ---------------------------------------------------------------------------

describe("stitchChunks — single chunk", () => {
  it("returns the transcript verbatim when items are present", () => {
    const chunk: ChunkResult = {
      startOffsetSec: 0,
      endOffsetSec: 3,
      transcript: "hello world",
      items: [makeItem("hello", 0), makeItem("world", 0.5)],
    };
    expect(stitchChunks([chunk], 1.5)).toBe("hello world");
  });

  it("returns the transcript verbatim when items are empty", () => {
    const chunk: ChunkResult = {
      startOffsetSec: 0,
      endOffsetSec: 3,
      transcript: "hello world",
      items: [],
    };
    expect(stitchChunks([chunk], 1.5)).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// Test 1: Normal overlap — matching run deduplicated
// ---------------------------------------------------------------------------

describe("stitchChunks — normal overlap deduplication", () => {
  it("deduplicates 'the store' appearing in both A's tail and B's head", () => {
    // chunkA: items ["I","went","to","the","store"] at times [0,0.5,1.0,1.5,2.0]
    // chunkA spans 0–3s; chunkB starts at 2.0s (seamAt=2.0, overlapEnd=3.5)
    // chunkB: items ["the","store","yesterday"] at chunk-relative [0,0.5,1.0]
    // After offset +2.0: global [2.0, 2.5, 3.0]
    // Overlap window [2.0, 3.5):
    //   aOverlap = ["the"(1.5)? no, 1.5 < 2.0 ... "store"(2.0) yes] → aOverlap = ["store"]
    // Wait — let's build so "the"(1.5) and "store"(2.0) are in overlap window seamAt=2.0:
    // seamAt = chunkB.startOffsetSec = 2.0
    // So overlap window = [2.0, 3.5)
    // aOverlap = items with StartTime >= 2.0 AND < 3.5 → "store" at 2.0 ✓
    // bOverlap (globally) = "the" at 2.0, "store" at 2.5 → both ✓
    // lcRun("store", "the store") — longestCommonRun(["store"], ["the","store"]) = 1
    //
    // To get both "the" and "store" in the overlap, let's set seamAt such that
    // chunkA's "the"(1.5) and "store"(2.0) fall in [seamAt, seamAt+overlapSec).
    // If seamAt=1.5 and overlapSec=1.5 → overlapEnd=3.0
    //   aOverlap = items with StartTime in [1.5, 3.0) → "the"(1.5), "store"(2.0) ✓
    //   bOverlap (globally = +1.5 offset) → "the"(1.5), "store"(2.0) ✓
    //   lcRun(["the","store"], ["the","store"]) = 2 ✓ → drop first 2 from B → keep "yesterday"

    const chunkA: ChunkResult = {
      startOffsetSec: 0,
      endOffsetSec: 3.0,
      transcript: "I went to the store",
      items: [
        makeItem("I", 0),
        makeItem("went", 0.5),
        makeItem("to", 1.0),
        makeItem("the", 1.5),
        makeItem("store", 2.0),
      ],
    };

    const chunkB: ChunkResult = {
      startOffsetSec: 1.5, // seamAt = 1.5, so overlap window = [1.5, 3.0)
      endOffsetSec: 5.0,
      transcript: "the store yesterday",
      // chunk-relative timestamps: 0, 0.5, 1.0
      // global after +1.5: 1.5, 2.0, 3.5
      items: [
        makeItem("the", 0.0),    // global: 1.5
        makeItem("store", 0.5),  // global: 2.0
        makeItem("yesterday", 1.5), // global: 3.0 (outside overlap window [1.5, 3.0))
      ],
    };

    const result = stitchChunks([chunkA, chunkB], 1.5);
    // Expected: "I went to the store yesterday" — "the store" appears exactly once
    expect(result).toBe("I went to the store yesterday");
    // Sanity: "the" appears exactly twice in original; should appear once in output
    const theCount = result.split(" ").filter((w) => w === "the").length;
    expect(theCount).toBe(1);
    const storeCount = result.split(" ").filter((w) => w === "store").length;
    expect(storeCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Zero-match fallback — hard cut
// ---------------------------------------------------------------------------

describe("stitchChunks — zero-match fallback", () => {
  it("concatenates all of A and all of B when overlap words differ", () => {
    const chunkA: ChunkResult = {
      startOffsetSec: 0,
      endOffsetSec: 3.0,
      transcript: "I went to the store",
      items: [
        makeItem("I", 0),
        makeItem("went", 0.5),
        makeItem("to", 1.0),
        makeItem("the", 1.5),
        makeItem("store", 2.0),
      ],
    };

    // chunkB's overlap words are completely different ("a car") — no common run
    const chunkB: ChunkResult = {
      startOffsetSec: 1.5,
      endOffsetSec: 5.0,
      transcript: "a car yesterday",
      items: [
        makeItem("a", 0.0),          // global: 1.5
        makeItem("car", 0.5),        // global: 2.0
        makeItem("yesterday", 2.0),  // global: 3.5
      ],
    };

    const result = stitchChunks([chunkA, chunkB], 1.5);
    // Hard cut: should contain words from both A and B
    expect(result).toContain("store");
    expect(result).toContain("a");
    expect(result).toContain("car");
    expect(result).toContain("yesterday");
  });
});

// ---------------------------------------------------------------------------
// Test 3: Empty-Items fallback (Pitfall 6)
// ---------------------------------------------------------------------------

describe("stitchChunks — empty-Items fallback / Pitfall 6", () => {
  it("falls back to string-join when chunkB has items=[] but transcript='hmm'", () => {
    const chunkA: ChunkResult = {
      startOffsetSec: 0,
      endOffsetSec: 3,
      transcript: "hello world",
      items: [makeItem("hello", 0), makeItem("world", 0.5)],
    };

    const chunkB: ChunkResult = {
      startOffsetSec: 3,
      endOffsetSec: 5,
      transcript: "hmm",
      items: [], // empty — Pitfall 6 triggers
    };

    const result = stitchChunks([chunkA, chunkB], 1.5);
    expect(result).toContain("hello");
    expect(result).toContain("world");
    expect(result).toContain("hmm");
    // Must not throw — no crash
  });

  it("does not crash when both chunks have empty items", () => {
    const chunkA: ChunkResult = {
      startOffsetSec: 0,
      endOffsetSec: 3,
      transcript: "hello",
      items: [],
    };
    const chunkB: ChunkResult = {
      startOffsetSec: 3,
      endOffsetSec: 5,
      transcript: "world",
      items: [],
    };

    const result = stitchChunks([chunkA, chunkB], 1.5);
    expect(result).toContain("hello");
    expect(result).toContain("world");
  });
});

// ---------------------------------------------------------------------------
// Test 4: Gap-marker passthrough (D-08)
// ---------------------------------------------------------------------------

describe("stitchChunks — gap-marker passthrough / D-08", () => {
  it("passes '[...]' through unchanged as a string when chunkB has transcript='[...]' and items=[]", () => {
    const chunkA: ChunkResult = {
      startOffsetSec: 0,
      endOffsetSec: 3,
      transcript: "hello",
      items: [makeItem("hello", 0.5)],
    };

    const chunkB: ChunkResult = {
      startOffsetSec: 3,
      endOffsetSec: 5,
      transcript: "[...]", // gap marker — D-08
      items: [],
    };

    const result = stitchChunks([chunkA, chunkB], 1.5);
    expect(result).toContain("[...]");
    // Must not throw
  });

  it("gap marker at the start (chunkA has items=[], transcript='[...]')", () => {
    const chunkA: ChunkResult = {
      startOffsetSec: 0,
      endOffsetSec: 3,
      transcript: "[...]",
      items: [],
    };
    const chunkB: ChunkResult = {
      startOffsetSec: 3,
      endOffsetSec: 6,
      transcript: "and then she said",
      items: [
        makeItem("and", 0),
        makeItem("then", 0.5),
        makeItem("she", 1.0),
        makeItem("said", 1.5),
      ],
    };

    const result = stitchChunks([chunkA, chunkB], 1.5);
    expect(result).toContain("[...]");
    expect(result).toContain("said");
  });
});

// ---------------------------------------------------------------------------
// Test 7: Punctuation filter
// ---------------------------------------------------------------------------

describe("stitchChunks — punctuation filter", () => {
  it("ignores punctuation items during overlap run matching; inserts them in output without leading space", () => {
    // chunkA items: ["hello", ",", "world"] with the comma being Type="punctuation"
    // chunkB items: [",", "world", "today"] — matching should find "world" as common run
    //               ignoring the commas in the comparison
    // Overlap window: chunkB.startOffsetSec=2.0, overlapEnd=3.5
    const chunkA: ChunkResult = {
      startOffsetSec: 0,
      endOffsetSec: 4.0,
      transcript: "hello, world",
      items: [
        makeItem("hello", 0.5),
        makeItem(",", 0.8, "punctuation"),
        makeItem("world", 1.0),  // global: 1.0 (not in overlap window [2.0, 3.5))
      ],
    };

    // To get "world" in both overlap windows, set seamAt so global "world" from A is >=2.0
    // Let's put chunkA's "world" at 2.1 and chunkB's "world" globally at 2.6
    const chunkA2: ChunkResult = {
      startOffsetSec: 0,
      endOffsetSec: 4.0,
      transcript: "hello, world",
      items: [
        makeItem("hello", 0.5),
        makeItem(",", 0.8, "punctuation"),
        makeItem("world", 2.1),  // global 2.1, in overlap [2.0, 3.5)
      ],
    };

    const chunkB2: ChunkResult = {
      startOffsetSec: 2.0, // seamAt=2.0
      endOffsetSec: 5.0,
      transcript: ", world today",
      // chunk-relative: comma at 0.1, world at 0.6, today at 1.5
      // global after +2.0: comma at 2.1, world at 2.6, today at 3.5
      items: [
        makeItem(",", 0.1, "punctuation"),  // global: 2.1
        makeItem("world", 0.6),             // global: 2.6 — in overlap [2.0, 3.5)
        makeItem("today", 1.5),             // global: 3.5 — at boundary (>= 3.5 excluded)
      ],
    };

    const result = stitchChunks([chunkA2, chunkB2], 1.5);
    // "world" should appear exactly once (deduplicated)
    const wordCount = result.split(" ").filter((w) => w.toLowerCase() === "world").length;
    expect(wordCount).toBe(1);
    // The punctuation cleanup regex should remove space before comma
    expect(result).not.toMatch(/\s,/);
    // Output should contain "hello" and "world"
    expect(result.toLowerCase()).toContain("hello");
    expect(result.toLowerCase()).toContain("world");
  });

  it("applies /\\s+([.,!?;:])/g cleanup to remove space before punctuation in output", () => {
    // Direct test: two pronunciation items + punctuation → no " ," artifact
    const chunk: ChunkResult = {
      startOffsetSec: 0,
      endOffsetSec: 3,
      transcript: "hello, world",
      items: [
        makeItem("hello", 0.5),
        makeItem(",", 0.8, "punctuation"),
        makeItem("world", 1.0),
      ],
    };
    const result = stitchChunks([chunk], 1.5);
    // Single chunk fast-path returns transcript directly
    expect(result).toBe("hello, world");

    // For multi-chunk path, verify the regex fires on items reconstruction
    const chunkA: ChunkResult = {
      startOffsetSec: 0,
      endOffsetSec: 3,
      transcript: "hello,",
      items: [
        makeItem("hello", 0.5),
        makeItem(",", 0.8, "punctuation"),
      ],
    };
    const chunkB: ChunkResult = {
      startOffsetSec: 2.5,
      endOffsetSec: 5.0,
      transcript: "world",
      items: [
        makeItem("world", 0.5),  // global: 3.0
      ],
    };
    const result2 = stitchChunks([chunkA, chunkB], 1.5);
    // "hello , world" → "hello, world" (space before comma removed)
    expect(result2).not.toMatch(/\s,/);
    expect(result2).toContain("hello");
    expect(result2).toContain("world");
  });
});

// ---------------------------------------------------------------------------
// Test 8: Case-insensitive match
// ---------------------------------------------------------------------------

describe("stitchChunks — case-insensitive overlap matching", () => {
  it("matches 'The' in chunkA with 'the' in chunkB (case-insensitive)", () => {
    // chunkA ends with "The" (capital), chunkB starts with "the" (lowercase)
    // These should be treated as identical for matching purposes
    const chunkA: ChunkResult = {
      startOffsetSec: 0,
      endOffsetSec: 3.0,
      transcript: "I saw The",
      items: [
        makeItem("I", 0.1),
        makeItem("saw", 0.5),
        makeItem("The", 1.5),  // global 1.5 — in overlap window [1.5, 3.0)
      ],
    };

    const chunkB: ChunkResult = {
      startOffsetSec: 1.5, // seamAt=1.5, overlapEnd=3.0
      endOffsetSec: 5.0,
      transcript: "the store",
      items: [
        makeItem("the", 0.0),   // global: 1.5 — in overlap [1.5, 3.0)
        makeItem("store", 1.0), // global: 2.5 — in overlap [1.5, 3.0)
      ],
    };

    const result = stitchChunks([chunkA, chunkB], 1.5);
    // "The"/"the" should be deduplicated — appears once
    const theCount = result.toLowerCase().split(" ").filter((w) => w === "the").length;
    expect(theCount).toBe(1);
    expect(result.toLowerCase()).toContain("store");
    expect(result.toLowerCase()).toContain("i");
    expect(result.toLowerCase()).toContain("saw");
  });
});

// ---------------------------------------------------------------------------
// Test 10: Timestamp adjustment (Pitfall 1) — global ordering preserved
// ---------------------------------------------------------------------------

describe("stitchChunks — timestamp adjustment / Pitfall 1", () => {
  it("orders merged items by global timestamp even when chunk-relative times look similar", () => {
    // chunkA starts at global 0, has a word at chunk-relative 5.0 (global 5.0)
    // chunkB starts at global 8, has a word at chunk-relative 0.5 (global 8.5)
    // After offset adjustment: chunkA's word should precede chunkB's word in output.
    //
    // Use non-overlapping chunks (no common run) with a large time gap
    // to test pure timestamp ordering via hard-cut fallback.
    const chunkA: ChunkResult = {
      startOffsetSec: 0,
      endOffsetSec: 7,
      transcript: "early",
      items: [makeItem("early", 5.0)], // global: 5.0
    };

    const chunkB: ChunkResult = {
      startOffsetSec: 8.0, // seamAt=8.0, overlapEnd=9.5
      endOffsetSec: 12.0,
      transcript: "later",
      items: [makeItem("later", 0.5)], // global: 8.5
    };

    const result = stitchChunks([chunkA, chunkB], 1.5);
    // "early" (global 5.0) should come before "later" (global 8.5)
    const words = result.split(" ");
    const earlyIdx = words.indexOf("early");
    const laterIdx = words.indexOf("later");
    expect(earlyIdx).toBeGreaterThanOrEqual(0);
    expect(laterIdx).toBeGreaterThanOrEqual(0);
    expect(earlyIdx).toBeLessThan(laterIdx);
  });

  it("does not mutate the input ChunkResult items arrays", () => {
    const originalStartTime = 2.0;
    const chunkA: ChunkResult = {
      startOffsetSec: 10.0,
      endOffsetSec: 15.0,
      transcript: "hello",
      items: [makeItem("hello", originalStartTime)],
    };
    const chunkB: ChunkResult = {
      startOffsetSec: 14.0,
      endOffsetSec: 18.0,
      transcript: "world",
      items: [makeItem("world", 0.5)],
    };

    stitchChunks([chunkA, chunkB], 2.0);

    // The original items should be unchanged (not mutated by offset adjustment)
    expect(chunkA.items[0].StartTime).toBe(originalStartTime);
    expect(chunkB.items[0].StartTime).toBe(0.5);
  });
});
