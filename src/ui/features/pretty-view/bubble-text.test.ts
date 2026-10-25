import { describe, it, expect } from "vitest";
import { agentBubbleText, userBubbleContent, userBubbleText } from "./bubble-text";

describe("bubble text — the words a bubble shows", () => {
  it("drops the voice label and tray notices from user messages", () => {
    expect(userBubbleContent("hi\n\n[sent by voice — your reply will be read aloud]")).toBe("hi");
    expect(userBubbleText("[tray] I replied in words instead.\n\nno thanks")).toBe("no thanks");
  });

  it("reads a tray answer as its picks and note, never the question", () => {
    const multi =
      "```answer\nask: a\nanswers:\n  - question: Which?\n    answer:\n      - Red\n      - Blue\n  - question: When?\n    answer: Now\n```";
    expect(userBubbleText(multi)).toBe("Red, Blue, Now");
  });

  it("names attached files by file name, not landing path", () => {
    const t =
      "\n--- attached files ---\n1. a b.png (1 KB, image/png) → `/home/u/pretty-view-uploads/x/a b.png`\n   uploaded 2026-10-25T00:00:00Z\n";
    expect(userBubbleText(t.slice(1))).toBe("a b.png");
  });

  it("reads slash-command tags as the command pill", () => {
    expect(userBubbleText("<command-name>/review</command-name><command-args>42</command-args>")).toBe("/review 42");
  });

  it("reads the tray's ask block as its question; other ask-looking text stays", () => {
    const md = "Pick.\n\n```ask\nquestion: Red or blue?\noptions:\n  - Red\n  - Blue\n```\n";
    expect(agentBubbleText(md)).toBe("Pick.\n\nAsked you: Red or blue?\n");
    expect(agentBubbleText("plain")).toBe("plain");
  });
});
