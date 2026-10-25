import { describe, it, expect } from "vitest";
import { findQuery, passageForJudged, snippetForJudged } from "./session-search-snippet.js";

describe("snippetForJudged", () => {
  it("windows ±80 chars around the first match with ellipses", () => {
    const text = "a".repeat(200) + "cheese" + "b".repeat(200);
    const r = snippetForJudged({ speaker: "user", text }, "CHEESE");
    expect(r.snippet).toBe("…" + "a".repeat(80) + "cheese" + "b".repeat(80) + "…");
    expect(r.snippet.slice(r.hitStart, r.hitStart + r.hitLength)).toBe("cheese");
  });

  it("no ellipsis when the whole text fits", () => {
    expect(snippetForJudged({ speaker: "agent", text: "say cheese" }, "cheese")).toEqual({
      snippet: "say cheese",
      hitStart: 4,
      hitLength: 6,
    });
  });

  it("head of the text with hitStart -1 when the query isn't in it", () => {
    expect(snippetForJudged({ speaker: "user", text: "crackers" }, "cheese")).toEqual({
      snippet: "crackers",
      hitStart: -1,
      hitLength: 0,
    });
  });
});

describe("passageForJudged", () => {
  it("keeps the speaker and relay parties, collapses whitespace, windows ±220", () => {
    const text = "x".repeat(300) + "\n\n cheese \n" + "y".repeat(300);
    const p = passageForJudged({ speaker: "relay", text, relayFrom: "@s:x", relayTo: null }, "cheese")!;
    expect(p.speaker).toBe("relay");
    expect(p.relayFrom).toBe("@s:x");
    expect(p.text).toBe("…" + "x".repeat(219) + " cheese " + "y".repeat(219) + "…");
  });

  it("null when the query isn't in the displayed words", () => {
    expect(passageForJudged({ speaker: "user", text: "crackers" }, "cheese")).toBeNull();
  });

  it("no relay fields on non-relay passages", () => {
    expect(passageForJudged({ speaker: "user", text: "cheese" }, "cheese")).toEqual({ speaker: "user", text: "cheese" });
  });
});

describe("findQuery", () => {
  it("matches on the original text even when lowercasing changes length (İ)", () => {
    expect(findQuery("İİİ cheese", "cheese")).toEqual({ index: 4, length: 6 });
  });
  it("treats regex metacharacters literally", () => {
    expect(findQuery("a+b (c)", "+b (c")).toEqual({ index: 1, length: 5 });
    expect(findQuery("abc", "a.c")).toBeNull();
  });
});
