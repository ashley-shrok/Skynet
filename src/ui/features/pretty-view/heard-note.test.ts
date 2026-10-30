import { describe, expect, it } from "vitest";
import { buildHeardNote, quoteReply, QUOTE_MAX_WORDS, type HeardReply } from "./heard-note";

const r = (eventId: string, text: string): HeardReply => ({ eventId, text });

describe("quoteReply", () => {
  it("quotes the opening dozen words with an ellipsis when there is more", () => {
    const a = r("a", "one two three four five six seven eight nine ten eleven twelve thirteen fourteen");
    expect(quoteReply(a, [a])).toBe('"one two three four five six seven eight nine ten eleven twelve…"');
  });

  it("quotes a short reply whole, with whitespace collapsed", () => {
    const a = r("a", "Done.\n\n  All green.");
    expect(quoteReply(a, [a])).toBe('"Done. All green."');
  });

  it("runs on until it differs from another reply that starts the same way", () => {
    const head = "On the compaction work, I have traced the copy label to the";
    const a = r("a", `${head} button in the header bar and fixed it.`);
    const b = r("b", `${head} footer and it is still open.`);
    expect(quoteReply(a, [a, b])).toBe(`"${head} button in the header bar and…"`);
    expect(quoteReply(b, [a, b])).toBe(`"${head} footer and it is still open."`);
  });

  it("tells word-for-word identical replies apart by counting back from the latest", () => {
    const a = r("a", "Still working on it.");
    const b = r("b", "Still working on it.");
    expect(quoteReply(a, [a, b])).toBe('"Still working on it." (the second latest of your replies that start that way)');
    expect(quoteReply(b, [a, b])).toBe('"Still working on it." (the latest of your replies that start that way)');
  });

  it("stops extending at the cap", () => {
    const long = Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ");
    const a = r("a", `${long} alpha`);
    const b = r("b", `${long} beta`);
    const q = quoteReply(a, [a, b]);
    expect(q.split(" (")[0].split(" ")).toHaveLength(QUOTE_MAX_WORDS);
    expect(q).toContain("(the second latest of your replies that start that way)");
  });

  it("keeps quotes and brackets from breaking the label", () => {
    const a = r("a", 'She said "ship [it]" today');
    expect(quoteReply(a, [a])).toBe(`"She said 'ship (it)' today"`);
  });
});

describe("quoteReply without event ids", () => {
  it("matches a reply to its own copy by text instead of inventing a clash", () => {
    const a = { text: "Deploy finished cleanly." };
    expect(quoteReply(a, [{ text: "Deploy finished cleanly." }, { text: "Other." }])).toBe('"Deploy finished cleanly."');
  });

  it("gives no position for a reply that isn't in the list", () => {
    const a = r("x", "Still working on it.");
    expect(quoteReply(a, [r("b", "Still working on it.")])).toBe('"Still working on it."');
  });
});

describe("buildHeardNote", () => {
  const a = r("a", "First reply here.");
  const b = r("b", "Second reply here.");
  const c = r("c", "Third reply here.");

  it("lists several unheard replies once each", () => {
    const note = buildHeardNote({ last: { reply: a, complete: true }, unheard: [b, c, b] }, [a, b, c]);
    expect(note).toBe(
      'The last of your replies the user had heard was the one starting "First reply here.". ' +
        'They had not heard your replies starting "Second reply here." and "Third reply here."; those were not read aloud to them. ' +
        "Their words answer what they had heard, which may not be your latest message.",
    );
  });

  it("never calls the last-heard reply unheard", () => {
    const note = buildHeardNote({ last: { reply: a, complete: true }, unheard: [a, b] }, [a, b]);
    expect(note).toContain('They had not heard your reply starting "Second reply here."');
    expect(note).not.toContain('not heard your replies');
  });

  it("names an earlier reply that was only partly heard", () => {
    const note = buildHeardNote({ last: { reply: b, complete: true }, unheard: [], cutOff: [a] }, [a, b]);
    expect(note).toContain('Before that, they heard only part of your reply starting "First reply here.".');
  });

  it("names a few unheard replies and counts the rest", () => {
    const many = Array.from({ length: 6 }, (_, i) => r(`m${i}`, `Feed item number ${i}.`));
    const note = buildHeardNote({ last: null, unheard: many }, many);
    expect(note).toContain('"Feed item number 0.", "Feed item number 1.", "Feed item number 2." and 3 more');
  });
});
