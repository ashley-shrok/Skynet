import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { parseAskBlock, type Ask } from "./ask-format";
import {
  buildAnswerMessage,
  parseAnswerMessage,
  replacedNotice,
  stripTrayNotices,
  withWordsNotice,
  type QuestionAnswer,
} from "./answer-format";

function ask(body: string): Ask {
  const r = parseAskBlock(body);
  if (!r.ok) throw new Error(r.error);
  return r.ask;
}

/** The YAML inside the answer fence, as the agent would read it. */
function yamlOf(message: string): Record<string, unknown> {
  const m = /```answer\n([\s\S]*?)\n```/.exec(message);
  if (!m) throw new Error("no answer block");
  return parseYaml(m[1]) as Record<string, unknown>;
}

const ship = ask("id: ship\nquestion: How should I ship it?\noptions: [Ship now, Hold it]");

describe("buildAnswerMessage", () => {
  it("restates the question and gives the answer", () => {
    const msg = buildAnswerMessage(ship, [{ kind: "options", picked: [ship.questions[0].options[0]] }], "");
    expect(yamlOf(msg)).toEqual({ ask: "ship", question: "How should I ship it?", answer: "Ship now" });
    expect(msg.endsWith("```")).toBe(true);
  });

  it("adds the typed note after the block", () => {
    const msg = buildAnswerMessage(ship, [{ kind: "options", picked: [ship.questions[0].options[1]] }], "  after lunch please \n");
    expect(msg.endsWith("```\n\nafter lunch please")).toBe(true);
  });

  it("carries values only where they differ from labels", () => {
    const a = ask("question: Delete those?\nyes: Delete them\nno: Not now");
    const msg = buildAnswerMessage(a, [{ kind: "options", picked: [a.questions[0].options[0]] }], "");
    expect(yamlOf(msg)).toMatchObject({ answer: "Delete them", value: "yes" });
  });

  it("answers several questions at once", () => {
    const a = ask(`id: box
questions:
  - question: Size?
    options: [4 GB, 8 GB]
  - question: Which agents?
    kind: pick-several
    options: [Jarvis, Sparrow, Willa]
  - question: Name?
    kind: text
  - question: Priority order?
    kind: order
    items: [a, b, c]`);
    const [q1, q2, , q4] = a.questions;
    const answers: QuestionAnswer[] = [
      { kind: "options", picked: [q1.options[1]] },
      { kind: "options", picked: [q2.options[0], q2.options[2]] },
      { kind: "other", text: "not sure yet" },
      { kind: "order", ordered: [q4.options[2], q4.options[0], q4.options[1]] },
    ];
    expect(yamlOf(buildAnswerMessage(a, answers, ""))).toEqual({
      ask: "box",
      answers: [
        { question: "Size?", answer: "8 GB" },
        { question: "Which agents?", answer: ["Jarvis", "Willa"] },
        { question: "Name?", answer: "not sure yet", other: true },
        { question: "Priority order?", answer: ["c", "a", "b"], ranked: true },
      ],
    });
  });

  it("formats money, numbers with units, dates, decide and split", () => {
    const money = ask("question: Budget?\nkind: money");
    expect(yamlOf(buildAnswerMessage(money, [{ kind: "number", value: 1200 }], ""))).toMatchObject({ answer: "$1,200.00", value: 1200 });
    const mins = ask("question: How long?\nkind: number\nunit: minutes");
    expect(yamlOf(buildAnswerMessage(mins, [{ kind: "number", value: 30 }], ""))).toMatchObject({ answer: "30 minutes", value: 30 });
    const date = ask("question: When?\nkind: date");
    expect(yamlOf(buildAnswerMessage(date, [{ kind: "date", value: "2026-10-27" }], ""))).toMatchObject({ value: "2026-10-27" });
    const tri = ask("question: Triage?\nkind: decide\nitems: [Bug A, Bug B]\nchoices: [Keep, Drop]");
    const [ba, bb] = tri.questions[0].options;
    expect(yamlOf(buildAnswerMessage(tri, [{ kind: "decide", decided: [{ item: ba, choice: "Keep" }, { item: bb, choice: "Drop" }] }], ""))).toMatchObject({
      answer: { "Bug A": "Keep", "Bug B": "Drop" },
    });
    const split = ask("question: Split?\nkind: split\ntotal: 10\nitems: [x, y]");
    const [x, y] = split.questions[0].options;
    expect(yamlOf(buildAnswerMessage(split, [{ kind: "split", parts: [{ item: x, amount: 7 }, { item: y, amount: 3 }] }], ""))).toMatchObject({
      answer: { x: 7, y: 3 },
    });
  });

  it("puts replaced-question notices on top", () => {
    const old = ask("id: old\nquestion: Old one?\noptions: [a, b]");
    const msg = buildAnswerMessage(ship, [{ kind: "options", picked: [ship.questions[0].options[0]] }], "", [old]);
    expect(msg.startsWith(`${replacedNotice(old)}\n\n\`\`\`answer`)).toBe(true);
  });

  it("survives labels that need quoting", () => {
    const a = ask('question: "Pick: one?"\noptions: ["yes: sure", "#2 - no"]');
    const msg = buildAnswerMessage(a, [{ kind: "options", picked: [a.questions[0].options[0]] }], "");
    expect(yamlOf(msg)).toMatchObject({ question: "Pick: one?", answer: "yes: sure" });
  });
});

describe("parseAnswerMessage", () => {
  it("reads an answer back for the bubble", () => {
    const msg = buildAnswerMessage(ship, [{ kind: "options", picked: [ship.questions[0].options[0]] }], "thanks");
    expect(parseAnswerMessage(msg)).toEqual({
      askId: "ship",
      answers: [{ question: "How should I ship it?", chips: ["Ship now"], other: false, ordered: false }],
      note: "thanks",
    });
  });

  it("numbers ranked answers and shows decisions as pairs", () => {
    const parsed = parseAnswerMessage("```answer\nask: r\nanswers:\n  - question: Order?\n    answer: [b, a]\n    ranked: true\n  - question: Triage?\n    answer: { x: Keep }\n```");
    expect(parsed?.answers).toEqual([
      { question: "Order?", chips: ["b", "a"], other: false, ordered: true },
      { question: "Triage?", chips: ["x → Keep"], other: false, ordered: false },
    ]);
  });

  it("ignores ordinary messages and broken blocks", () => {
    expect(parseAnswerMessage("hello")).toBeNull();
    expect(parseAnswerMessage("```answer\nnot: [closed\n```")).toBeNull();
    expect(parseAnswerMessage("before\n```answer\nask: x\nanswer: y\n```")).toBeNull();
  });
});

describe("tray notices", () => {
  it("tells the agent a reply came in words, and strips cleanly", () => {
    const old = ask("id: old\nquestion: Old?\noptions: [a, b]");
    const sent = withWordsNotice("Let's not ship yet", ship, [old]);
    expect(sent).toContain("(ask old) was replaced");
    expect(sent).toContain('I replied in words instead of using the tray for your question "How should I ship it?" (ask ship).');
    expect(stripTrayNotices(sent)).toBe("Let's not ship yet");
  });

  it("leaves slash commands alone", () => {
    expect(withWordsNotice("/id save", ship, [])).toBe("/id save");
  });

  it("leaves messages without notices untouched", () => {
    expect(stripTrayNotices("[trayish] hi")).toBe("[trayish] hi");
  });
});

describe("notices for multi-line questions (review fix)", () => {
  it("stay one line, so they strip and the answer still reads back", () => {
    const multi = ask("id: m\nquestion: |\n  First line\n  second line?\noptions: [a, b]");
    const words = withWordsNotice("ok", ship, [multi]);
    expect(stripTrayNotices(words)).toBe("ok");
    const answer = buildAnswerMessage(ship, [{ kind: "options", picked: [ship.questions[0].options[0]] }], "", [multi]);
    expect(parseAnswerMessage(answer)?.askId).toBe("ship");
  });
});
