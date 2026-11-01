import { describe, expect, it } from "vitest";
import { buildHeardNote, quoteReply, QUOTE_MAX_WORDS, type HeardReply, type RunEntry } from "./heard-note";

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
    expect(quoteReply(a, [a, b])).toBe('"Still working on it." (the second latest of your replies that start that way, as of when they spoke)');
    expect(quoteReply(b, [a, b])).toBe('"Still working on it." (the latest of your replies that start that way, as of when they spoke)');
  });

  it("stops extending at the cap", () => {
    const long = Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ");
    const a = r("a", `${long} alpha`);
    const b = r("b", `${long} beta`);
    const q = quoteReply(a, [a, b]);
    expect(q.split(" (")[0].split(" ")).toHaveLength(QUOTE_MAX_WORDS);
    expect(q).toContain("(the second latest of your replies that start that way, as of when they spoke)");
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
  const heard = (reply: HeardReply, complete = true): RunEntry => ({ kind: "heard", reply, complete });
  const said = (text: string): RunEntry => ({ kind: "said", text });

  it("the incident: a bare Okay. is placed by the run around it", () => {
    const costs = r("g", "I've started a new finance thread to check the role's avatar. If it isn't a dollar sign…");
    const okay = r("o1", "Okay.");
    const avatar = r("av", "For the finance avatar, you were right: it's currently a white wallet on purple.");
    const earlierOkay = r("o0", "Okay.");
    const note = buildHeardNote(
      {
        run: [heard(costs), said("Okay, then put together some steps for me to check what the usage has been and see"), heard(okay)],
        unheard: [avatar],
      },
      [earlierOkay, costs, okay, avatar],
    );
    expect(note).toBe(
      "What the user had heard when they spoke, with their own messages in between, oldest first: " +
        'your reply starting "I\'ve started a new finance thread to check the role\'s avatar. If…"; ' +
        'then they said "Okay, then put together some steps for me to check what the…"; ' +
        'then your reply "Okay." (the latest of your replies that start that way, as of when they spoke). ' +
        'Nothing you sent after your reply "Okay." (the latest of your replies that start that way, as of when they spoke) had been heard yet, ' +
        "including anything you send before you read this. " +
        'They had not heard your reply starting "For the finance avatar, you were right: it\'s currently a white wallet…"; it was not read aloud to them. ' +
        "Their words answer what they had heard, which may not be your latest message.",
    );
  });

  it("shows only the last three heard replies, with the user's messages after the first of them", () => {
    const d = r("d", "Fourth reply here.");
    const note = buildHeardNote(
      { run: [heard(a), said("too early"), heard(b), said("about b"), heard(c), heard(d), said("after d")], unheard: [] },
      [a, b, c, d],
    );
    expect(note).toContain(
      'in between, oldest first: your reply "Second reply here."; then they said "about b"; then your reply "Third reply here."; ' +
        'then your reply "Fourth reply here."; then they said "after d". ',
    );
    expect(note).not.toContain("First reply");
    expect(note).not.toContain("too early");
    expect(note).toContain('Nothing you sent after your reply "Fourth reply here." had been heard yet');
  });

  it("draws the line after the newest reply heard, even when an older one was replayed last", () => {
    const note = buildHeardNote({ run: [heard(a), heard(b), said("say the first again"), heard(a)], unheard: [] }, [a, b]);
    expect(note).toContain('then they said "say the first again"; then your reply "First reply here."');
    expect(note).toContain('Nothing you sent after your reply "Second reply here." had been heard yet');
  });

  it("keeps only the latest few of the user's own messages", () => {
    const run: RunEntry[] = [heard(a), ...Array.from({ length: 7 }, (_, i) => said(`message ${i}`))];
    const note = buildHeardNote({ run, unheard: [] }, [a]);
    expect(note).not.toContain('"message 2"');
    expect(note).toContain('then they said "message 3"; then they said "message 4"; then they said "message 5"; then they said "message 6".');
  });

  it("marks a reply cut off partway in place", () => {
    const note = buildHeardNote({ run: [heard(a, false), heard(b)], unheard: [] }, [a, b]);
    expect(note).toContain('your reply "First reply here." (cut off partway, so they may not have heard all of it); then your reply "Second reply here."');
  });

  it("says when nothing has been heard, still drawing the line, and leaves the user's messages out", () => {
    const note = buildHeardNote({ run: [said("hello")], unheard: [a] }, [a]);
    expect(note).toBe(
      "None of your replies had been read aloud to the user yet in this voice session. " +
        "That includes anything you send before you read this. " +
        'They had not heard your reply starting "First reply here."; it was not read aloud to them. ' +
        "Their words answer what they had heard, which may not be your latest message.",
    );
  });

  it("lists several unheard replies once each, and never calls a heard one unheard", () => {
    const note = buildHeardNote({ run: [heard(a)], unheard: [a, b, c, b] }, [a, b, c]);
    expect(note).toContain(
      'They had not heard your replies starting "Second reply here." and "Third reply here."; those were not read aloud to them.',
    );
  });

  it("names a few unheard replies and counts the rest", () => {
    const many = Array.from({ length: 6 }, (_, i) => r(`m${i}`, `Feed item number ${i}.`));
    const note = buildHeardNote({ run: [], unheard: many }, many);
    expect(note).toContain('"Feed item number 0.", "Feed item number 1.", "Feed item number 2." and 3 more');
  });

  it("keeps the user's quotes and brackets from breaking the label", () => {
    const note = buildHeardNote({ run: [heard(a), said('ship "it" [now]')], unheard: [] }, [a]);
    expect(note).toContain(`then they said "ship 'it' (now)".`);
  });
});
