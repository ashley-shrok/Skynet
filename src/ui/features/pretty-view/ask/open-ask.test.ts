import { describe, expect, it } from "vitest";
import { deriveOpenAsk } from "./open-ask";

const askMsg = (id: string, q = `Question ${id}?`) =>
  `Here you go.\n\n\`\`\`ask\nid: ${id}\nquestion: ${q}\noptions: [a, b]\n\`\`\`\n`;

let n = 0;
const agent = (content: string) => ({ type: "message", role: "assistant", content, eventId: `e${++n}` });
const user = (content: string) => ({ type: "message", role: "user", content, eventId: `e${++n}` });
const relay = () => ({ type: "relay_inbound", eventId: `e${++n}` });

describe("deriveOpenAsk", () => {
  it("is the latest ask with no user message after it", () => {
    const m = agent(askMsg("one"));
    const open = deriveOpenAsk([user("hi"), m], false);
    expect(open?.ask.id).toBe("one");
    expect(open?.eventId).toBe(m.eventId);
    expect(open?.replaced).toEqual([]);
  });

  it("stays open through agent replies, other agents and events", () => {
    const open = deriveOpenAsk([agent(askMsg("one")), relay(), agent("Build finished."), agent("Still waiting on you.")], false);
    expect(open?.ask.id).toBe("one");
  });

  it("closes once the user sends anything", () => {
    expect(deriveOpenAsk([agent(askMsg("one")), user("never mind")], false)).toBeNull();
    expect(deriveOpenAsk([agent(askMsg("one")), user("```answer\nask: one\n```")], false)).toBeNull();
  });

  it("closes while a user send is in flight", () => {
    expect(deriveOpenAsk([agent(askMsg("one"))], true)).toBeNull();
  });

  it("a newer ask replaces older unanswered ones", () => {
    const open = deriveOpenAsk([user("go"), agent(askMsg("one")), agent("hm"), agent(askMsg("two")), agent(askMsg("three"))], false);
    expect(open?.ask.id).toBe("three");
    expect(open?.replaced.map((a) => a.id)).toEqual(["one", "two"]);
  });

  it("does not count asks from before the user's last message as replaced", () => {
    const open = deriveOpenAsk([agent(askMsg("old")), user("words"), agent(askMsg("new"))], false);
    expect(open?.replaced).toEqual([]);
  });

  it("ignores unreadable asks", () => {
    expect(deriveOpenAsk([agent("```ask\nquestion:\n```")], false)).toBeNull();
  });
});
