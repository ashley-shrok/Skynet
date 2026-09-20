/**
 * Tests for snippetForHit — Phase 122 Plan 122-02 Task 1.
 *
 * Contract (from PLAN.md Task 1 <behavior>):
 *   1. JSONL line whose `message.content` is a string containing the query at
 *      char index 200 → snippet windowed ±80 chars (length ≤ 161) with `…`
 *      ellipsis prefix and `hitStart` pointing to the query inside the snippet.
 *   2. JSONL line whose `message.content` is an array of blocks including
 *      `{ type: "text", text: "..." }` — the concatenated block text is what
 *      gets windowed.
 *   3. Case-insensitive: query `"HELLO"` finds `hello` in text and reports
 *      `hitLength = 5`.
 *   4. Query not present in extracted text (rare — grep matched JSON syntax not
 *      the extracted human text) → first 160 chars of extracted text with
 *      `hitStart = -1`, `hitLength = 0`.
 *   5. JSON.parse throws (malformed line) → first 160 chars of raw line with
 *      `hitStart = -1`, `hitLength = 0` — degraded but non-crashing.
 *   6. Ellipsis: only prefixed if `start > 0`, only suffixed if
 *      `end < rawText.length`.
 */

import { describe, it, expect } from "vitest";
import { snippetForHit } from "./session-search-snippet.js";

describe("snippetForHit", () => {
  // ---------------------------------------------------------------------
  // Behavior 1: string content, hit at index 200 → windowed ±80 chars
  // ---------------------------------------------------------------------
  it("windows a string message.content around a hit at char index 200 with ±80-char window", () => {
    const before = "a".repeat(200);
    const query = "needle";
    const after = "b".repeat(200);
    const rawText = before + query + after;
    const line = JSON.stringify({ message: { content: rawText } });

    const result = snippetForHit(line, query);

    // ±80 chars gives 80 + 6 (query) + 80 = 166 raw, plus two `…` chars = 168.
    // Length is a soft ceiling — must be windowed, not full-text.
    expect(result.snippet.length).toBeLessThanOrEqual(168);
    expect(result.hitLength).toBe(query.length);
    // Snippet begins with `…` (start > 0) and includes the query.
    expect(result.snippet.startsWith("…")).toBe(true);
    // hitStart points to `needle` inside the snippet string, accounting for
    // the leading ellipsis character.
    expect(result.snippet.slice(result.hitStart, result.hitStart + result.hitLength)).toBe(query);
  });

  // ---------------------------------------------------------------------
  // Behavior 2: array-of-blocks content — extractText concatenation wins
  // ---------------------------------------------------------------------
  it("uses extractText concatenation when message.content is an array of blocks", () => {
    const query = "target";
    const line = JSON.stringify({
      message: {
        content: [
          { type: "text", text: "prefix text before " },
          { type: "tool_use", input: { irrelevant: true } }, // non-text block ignored by extractText
          { type: "text", text: `middle contains ${query} inside` },
          { type: "text", text: " and trailing text" },
        ],
      },
    });

    const result = snippetForHit(line, query);

    // Expected extracted text:
    //   "prefix text before middle contains target inside and trailing text"
    // hit at char index 34 (well within a single-window slice — no ellipsis).
    expect(result.snippet).toContain(query);
    expect(result.hitLength).toBe(query.length);
    // Snippet must NOT contain the tool_use JSON scaffolding (extractText
    // strips non-text blocks).
    expect(result.snippet).not.toContain("tool_use");
    expect(result.snippet).not.toContain("irrelevant");
    // hitStart correctly indexes into the returned snippet
    expect(result.snippet.slice(result.hitStart, result.hitStart + result.hitLength)).toBe(query);
  });

  // ---------------------------------------------------------------------
  // Behavior 3: case-insensitive lookup
  // ---------------------------------------------------------------------
  it("is case-insensitive: query 'HELLO' matches 'hello' with hitLength=5", () => {
    const line = JSON.stringify({ message: { content: "greetings, hello world!" } });
    const result = snippetForHit(line, "HELLO");
    expect(result.hitLength).toBe(5);
    // The returned snippet contains the original-case 'hello' text.
    expect(result.snippet).toContain("hello");
    // hitStart lands on 'hello' (case-preserved in the snippet)
    expect(result.snippet.slice(result.hitStart, result.hitStart + result.hitLength).toLowerCase()).toBe("hello");
  });

  // ---------------------------------------------------------------------
  // Behavior 4: query not present in extracted text (grep matched JSON syntax)
  // ---------------------------------------------------------------------
  it("returns first 160 chars with hitStart=-1 when query does not appear in extracted text", () => {
    // The extracted text is short and does NOT contain the query.
    const rawText = "some short body without the term";
    const line = JSON.stringify({ message: { content: rawText } });
    const result = snippetForHit(line, "not-there");
    expect(result.hitStart).toBe(-1);
    expect(result.hitLength).toBe(0);
    // Snippet is first 160 chars of extracted text (in this case the full body).
    expect(result.snippet).toBe(rawText.slice(0, 160));
  });

  // ---------------------------------------------------------------------
  // Behavior 5: JSON.parse throws → degraded raw-line fallback
  // ---------------------------------------------------------------------
  it("falls back to raw line first-160 chars with hitStart=-1 when JSON.parse throws", () => {
    const malformed = "this is {not valid JSON but includes the query needle plus more text after";
    const result = snippetForHit(malformed, "needle");
    expect(result.hitStart).toBe(-1);
    expect(result.hitLength).toBe(0);
    expect(result.snippet).toBe(malformed.slice(0, 160));
  });

  // ---------------------------------------------------------------------
  // Behavior 5b: extractText doesn't include the query (structural-JSON
  // hit — grep matched in a tool_result content block, toolUseResult
  // file path, or top-level metadata that extractText doesn't traverse).
  // Fallback: window ±80 chars around the match position IN THE RAW LINE
  // so the user sees the match context, not a dump of the JSON head
  // (parentUuid / isSidechain / promptId noise).
  // ---------------------------------------------------------------------
  it("falls back to a windowed raw-line snippet around the match when extracted text is empty (structural-JSON hit)", () => {
    // A tool_use record — extractText returns empty for these because
    // there's no message-content text. Grep matched 'banana' because it
    // appears inside the tool input JSON.
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_banana_x",
            name: "some_tool",
            input: { fruit: "banana" },
          },
        ],
      },
    });
    const result = snippetForHit(line, "banana");
    // Snippet must contain the query (case-insensitively).
    expect(result.snippet.toLowerCase()).toContain("banana");
    // Match indices point at the query INSIDE the returned snippet.
    expect(result.hitStart).toBeGreaterThanOrEqual(0);
    expect(result.hitLength).toBe(6);
    expect(
      result.snippet
        .slice(result.hitStart, result.hitStart + result.hitLength)
        .toLowerCase(),
    ).toBe("banana");
  });

  it("emits raw-line head as last-resort fallback if the query is nowhere in the raw line either", () => {
    // Extractable content is empty and the raw line does not contain the
    // query (defensive: grep matched inside the first 4KB but our
    // toLowerCase().indexOf disagrees — hypothetical edge case).
    // Force this by giving a raw line that JSON-parses but has empty
    // message.content AND does not literally contain the query.
    const line = JSON.stringify({
      type: "system",
      message: { content: [] },
    });
    const result = snippetForHit(line, "banana");
    expect(result.hitStart).toBe(-1);
    expect(result.hitLength).toBe(0);
    expect(result.snippet).toBe(line.slice(0, 160));
  });

  // ---------------------------------------------------------------------
  // Behavior 6a: ellipsis prefix only when start > 0
  // ---------------------------------------------------------------------
  it("does NOT prefix ellipsis when the hit is at the very start of the text", () => {
    const rawText = "needle at the head" + "z".repeat(200);
    const line = JSON.stringify({ message: { content: rawText } });
    const result = snippetForHit(line, "needle");
    expect(result.snippet.startsWith("…")).toBe(false);
    // With start=0 and end < text.length, we should have a trailing ellipsis only.
    expect(result.snippet.endsWith("…")).toBe(true);
    // hitStart should be 0 (no leading ellipsis shift)
    expect(result.hitStart).toBe(0);
  });

  // ---------------------------------------------------------------------
  // Behavior 6b: ellipsis suffix only when end < rawText.length
  // ---------------------------------------------------------------------
  it("does NOT suffix ellipsis when the hit is at the very end of the text", () => {
    const rawText = "z".repeat(200) + "needle at the tail";
    const line = JSON.stringify({ message: { content: rawText } });
    const result = snippetForHit(line, "needle");
    // With end === rawText.length, no trailing ellipsis.
    expect(result.snippet.endsWith("…")).toBe(false);
    // With start > 0, we should have a leading ellipsis.
    expect(result.snippet.startsWith("…")).toBe(true);
  });

  // ---------------------------------------------------------------------
  // Behavior 6c: no ellipsis when text is shorter than window
  // ---------------------------------------------------------------------
  it("emits no ellipsis on either side when the entire extracted text fits in the window", () => {
    const rawText = "short body containing needle only";
    const line = JSON.stringify({ message: { content: rawText } });
    const result = snippetForHit(line, "needle");
    expect(result.snippet.startsWith("…")).toBe(false);
    expect(result.snippet.endsWith("…")).toBe(false);
    expect(result.snippet).toBe(rawText);
    expect(result.hitLength).toBe(6);
    // hitStart lands on 'needle' inside the snippet
    expect(result.snippet.slice(result.hitStart, result.hitStart + result.hitLength)).toBe("needle");
  });
});
