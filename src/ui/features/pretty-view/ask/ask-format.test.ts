import { describe, expect, it } from "vitest";
import { askSpeech, findAskBlocks, lastAskIn, parseAskBlock } from "./ask-format";

function ok(body: string) {
  const r = parseAskBlock(body);
  if (!r.ok) throw new Error(r.error);
  return r.ask;
}

describe("parseAskBlock", () => {
  it("reads a single pick-one question with shorthand options", () => {
    const ask = ok(`id: ship-relay
question: How should I ship the relay fix?
options:
  - Ship now (recommended) | Takes about 4 minutes
  - Tonight after 10pm
  - Hold it | Leave it committed, not pushed
`);
    expect(ask.id).toBe("ship-relay");
    expect(ask.questions).toHaveLength(1);
    const q = ask.questions[0];
    expect(q.kind).toBe("pick-one");
    expect(q.options.map((o) => o.label)).toEqual(["Ship now", "Tonight after 10pm", "Hold it"]);
    expect(q.options[0].recommended).toBe(true);
    expect(q.options[0].description).toBe("Takes about 4 minutes");
    expect(q.options[2].value).toBe("Hold it");
  });

  it("reads unquoted shorthand whose text holds a colon", () => {
    const q = ok(`id: wakeups-in-search
question: Wake-up instructions and sensor findings are hidden in the conversation. Drop them from search too?
options:
  - Drop them (recommended) | Strict rule: search only finds what the conversation shows
  - Keep them, faded | Exception to the rule: findable but shown faded as "Wake-up"
  - Ask later: 2
`).questions[0];
    expect(q.options.map((o) => o.label)).toEqual(["Drop them", "Keep them, faded", "Ask later: 2"]);
    expect(q.options[0].recommended).toBe(true);
    expect(q.options[0].description).toBe("Strict rule: search only finds what the conversation shows");
    expect(q.options[1].description).toBe('Exception to the rule: findable but shown faded as "Wake-up"');
  });

  it("still reads a one-key mapping option by its field", () => {
    const q = ok(`question: Pick
options:
  - label: First
  - value: second
`).questions[0];
    expect(q.options.map((o) => o.label)).toEqual(["First", "second"]);
  });

  it("reads mapping options with values and faces", () => {
    const q = ok(`question: Accent colour?
layout: grid
options:
  - { label: Teal, value: "#1aa", color: "#11aaaa" }
  - { label: Plum, value: "#a1a", color: "#aa11aa" }
`).questions[0];
    expect(q.layout).toBe("grid");
    expect(q.options[0]).toMatchObject({ label: "Teal", value: "#1aa", color: "#11aaaa" });
  });

  it("turns yes/no shorthand into a two-option pick-one", () => {
    const q = ok(`question: Delete those three?
yes: Delete them
no: Not now
`).questions[0];
    expect(q.kind).toBe("pick-one");
    expect(q.options).toEqual([
      { label: "Delete them", value: "yes" },
      { label: "Not now", value: "no" },
    ]);
  });

  it("reads several questions with headers and kinds", () => {
    const ask = ok(`id: newbox
questions:
  - question: What size?
    header: Size
    options: [4 GB, 8 GB]
  - question: Which agents move there?
    header: Agents
    kind: pick-several
    options: [Jarvis, Sparrow, Willa]
  - question: Name it?
    kind: text
`);
    expect(ask.questions.map((q) => [q.header, q.kind])).toEqual([
      ["Size", "pick-one"],
      ["Agents", "pick-several"],
      ["Name it", "text"],
    ]);
    expect(ask.questions[2].index).toBe(2);
  });

  it("accepts kind aliases", () => {
    expect(ok(`question: Rank these\nkind: rank\nitems: [a, b]`).questions[0].kind).toBe("order");
    expect(ok(`question: Write it\ntype: draft`).questions[0].kind).toBe("long-text");
    expect(ok(`question: Pick\npick: several\noptions: [a, b]`).questions[0].kind).toBe("pick-several");
  });

  it("reads decide, split, number, money, slider, date, dropdown", () => {
    const d = ok(`question: Triage these\nkind: decide\nitems: [Bug A, Bug B]\nchoices: [Keep, Drop, Later]`).questions[0];
    expect(d.choices).toEqual(["Keep", "Drop", "Later"]);
    const s = ok(`question: Split the budget\nkind: split\ntotal: 100\nunit: "%"\nitems: [Ads, Events]`).questions[0];
    expect(s.total).toBe(100);
    expect(s.unit).toBe("%");
    const n = ok(`question: How many?\nkind: number\nmin: 1\nmax: 9\ndefault: 3`).questions[0];
    expect([n.min, n.max, n.default]).toEqual([1, 9, 3]);
    expect(ok(`question: Budget?\nkind: money\ncurrency: eur`).questions[0].currency).toBe("EUR");
    expect(ok(`question: Volume?\nkind: slider\nmin: 0\nmax: 11`).questions[0].kind).toBe("slider");
    expect(ok(`question: When?\nkind: date`).questions[0].kind).toBe("date");
    expect(ok(`question: Region?\nkind: dropdown\noptions: [us-east, eu-west]`).questions[0].kind).toBe("dropdown");
  });

  it("infers a week layout from timed options", () => {
    const q = ok(`question: When can you talk?
kind: pick-several
options:
  - time: 2026-10-27T14:00
  - time: 2026-10-28T09:30
`).questions[0];
    expect(q.layout).toBe("week");
    expect(q.options[0].value).toBe("2026-10-27T14:00");
    expect(q.options[0].label).toMatch(/Oct 27/);
  });

  it("derives a stable id when none is given", () => {
    const a = ok("question: Same?\noptions: [a, b]");
    const b = ok("question: Same?\noptions: [a, b]");
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^q-/);
  });

  it.each([
    ["not yaml at all: [", /YAML/],
    ["- just\n- a list", /mapping/],
    ["options: [a, b]", /no question text/],
    ["question: Pick\nkind: pick-one\noptions: [only]", /two options/],
    ["question: Pick\nkind: wiggle", /unknown kind/],
    ["question: Triage\nkind: decide\nitems: [a, b]", /two to four choices/],
    ["question: Split\nkind: split\nitems: [a, b]", /total/],
    ["question: Dupes\noptions: [a, a]", /share/],
    ["questions:\n  - question: 1\n  - question: 2\n  - question: 3\n  - question: 4\n  - question: 5", /at most 4/],
    ["question: Slot\nlayout: week\noptions: [a, b]", /needs a time/],
  ])("rejects %j", (body, err) => {
    const r = parseAskBlock(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(err);
  });
});

describe("finding asks in a message", () => {
  const msg = "Fix is ready.\n\n```ask\nid: one\nquestion: First?\noptions: [a, b]\n```\n\nand later\n\n```ask\nid: two\nquestion: Second?\noptions: [c, d]\n```\n";

  it("finds every ask block", () => {
    expect(findAskBlocks(msg)).toHaveLength(2);
  });

  it("uses the last block", () => {
    expect(lastAskIn(msg)?.id).toBe("two");
  });

  it("ignores other fences and unreadable asks", () => {
    expect(lastAskIn("```yaml\nquestion: x\n```")).toBeNull();
    expect(lastAskIn("```ask\nquestion:\n```")).toBeNull();
    expect(lastAskIn("plain words, no block")).toBeNull();
  });
});

describe("askSpeech", () => {
  it("reads the question and its choices", () => {
    const ask = ok("question: Ship it?\noptions: [Now, Tonight, Hold]");
    expect(askSpeech(ask)).toBe("Ship it? Now, Tonight, or Hold.");
  });
});

describe("the id skill's examples", () => {
  it("every ask block in the id skill parses", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    // The skill wraps each example in a ```` fence so it never shows as a live
    // ask; unwrap those to check the examples themselves.
    const md = readFileSync(resolve(__dirname, "../../../../../substrate/skills/id/SKILL.md"), "utf8")
      .replace(/^````[a-z]*$/gm, "");
    const blocks = findAskBlocks(md);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    for (const b of blocks) {
      const r = parseAskBlock(b);
      expect(r.ok, r.error).toBe(true);
    }
  });
});

describe("finding asks the way markdown draws them (review fixes)", () => {
  const ask = "```ask\nid: x\nquestion: Q?\noptions: [a, b]\n```";
  it("an ask shown as an example inside another code block is not an ask", () => {
    expect(lastAskIn("Here's the format:\n\n````md\n" + ask + "\n````\n")).toBeNull();
  });
  it("asks inside quotes, indented, or with extra info words are not asks", () => {
    expect(lastAskIn("> ```ask\n> question: Q?\n> options: [a, b]\n> ```")).toBeNull();
    expect(lastAskIn("    ```ask\n    question: Q?\n    ```")).toBeNull();
    expect(lastAskIn("```ask yaml\nquestion: Q?\noptions: [a, b]\n```")).toBeNull();
  });
  it("an unclosed ask block runs to the end, as markdown draws it", () => {
    expect(lastAskIn("```ask\nid: open\nquestion: Q?\noptions: [a, b]\n")?.id).toBe("open");
  });
  it("a longer closing fence still closes it", () => {
    expect(lastAskIn("```ask\nid: long\nquestion: Q?\noptions: [a, b]\n`````\n")?.id).toBe("long");
  });
  it("rejects colours that aren't colours, and clashing time slots", () => {
    expect(parseAskBlock('question: c\noptions:\n  - { label: a, color: "url(https://x/y)" }\n  - { label: b, color: "#fff" }').ok).toBe(false);
    expect(parseAskBlock('question: c\noptions:\n  - { label: a, color: "rgb(1, 2, 3)" }\n  - { label: b, color: teal }').ok).toBe(true);
    expect(parseAskBlock("question: t\noptions:\n  - { time: 2026-10-27T09:00, value: x }\n  - { time: 2026-10-27T09:00, value: y }").ok).toBe(false);
  });
});
