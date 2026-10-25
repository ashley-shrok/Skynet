/**
 * Parity lock (shape-search-matches-conversation): conversation search finds
 * exactly what the conversation shows, attributed the way it attributes it.
 *
 * The transcript below holds one line of every kind the 2026-10-25 audit
 * found, in the shapes the harness actually writes. Each is run through the
 * conversation's own path (parser → wire frame → queued-send dedup → bubble
 * text) and through the search judge; they must agree on whether the line
 * shows, whose bubble it is, and the words it displays. A search-only rule
 * about what counts — or a conversation change search doesn't follow — fails
 * here.
 */
import { describe, it, expect } from "vitest";
import { createSearchLineJudge, type JudgedLine } from "./search-line-judge.js";
import { parseSessionLine } from "./session-file-parser.js";
import {
  __applyQueueDedupForTests,
  __reshapeParsedLineToWireFrameForTests as reshape,
} from "./claude-session-server.js";
import { agentBubbleText, userBubbleText } from "../../ui/features/pretty-view/bubble-text.js";

const T0 = Date.parse("2026-10-25T12:00:00Z");
let n = 0;
const ts = () => new Date(T0 + 1000 * n++).toISOString();
const user = (content: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "user", uuid: `u${n}`, timestamp: ts(), message: { role: "user", content }, ...extra });
const agent = (content: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "assistant",
    uuid: `a${n}`,
    timestamp: ts(),
    message: { role: "assistant", model: "claude-opus-5-5", content },
    ...extra,
  });
const pasted = (inner: string) => `\n\n<pasted_content id="bd96">\n${inner}\n</pasted_content id="bd96">\n`;
const ambient = (event: string) =>
  `<task-notification>\n<summary>Ambient watcher event (finch) — delivered by agent-supervisor</summary>\n<event>${event}</event>\n</task-notification>`;
const relayEvent = (sender: string, eventId: string, body: string) =>
  `[room !abcDEF:t1000.example] [${sender}] (event $${eventId}): ${body}`;

/** [label, line, expected search result (null = hidden)]. File order matters. */
const CASES: Array<[string, string, Omit<JudgedLine, "relayFrom" | "relayTo"> & Partial<JudgedLine> | null]> = [
  ["/id load command", user("<command-message>id</command-message>\n<command-name>/id</command-name>\n<command-args>finch</command-args>"), null],
  ["skill body (isMeta)", user([{ type: "text", text: "Base directory for this skill: … drama masks …" }], { isMeta: true }), null],
  ["plain user text", user("Can we search for cheese?"), { speaker: "user", text: "Can we search for cheese?" }],
  ["voice-mode send", user("Ship it.\n\n[sent by voice — your reply will be read aloud]"), { speaker: "user", text: "Ship it." }],
  ["tray answer", user("```answer\nask: ship\nquestion: Ship now or tonight?\nanswer: Ship now\n```\n\nafter lunch"), { speaker: "user", text: "Ship now\n\nafter lunch" }],
  ["tray notice + words", user("[tray] I replied in words instead of using the tray for your question \"Ship?\".\n\nhold it"), { speaker: "user", text: "hold it" }],
  [
    "attached files",
    user("see this\n\n--- attached files ---\n1. plz.txt (890 B, text/plain) → `/home/ubuntu/pretty-view-uploads/2026-10-25/055102-plz.txt`\n   uploaded 2026-10-25T05:51:02Z\n"),
    { speaker: "user", text: "see this\nplz.txt" },
  ],
  ["slash command", user("<command-name>/review</command-name>\n<command-message>review</command-message>\n<command-args>42</command-args>"), { speaker: "user", text: "/review 42" }],
  [
    "compaction summary",
    user("This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\n1. The user asked about cheese.", { isCompactSummary: true, isVisibleInTranscriptOnly: true }),
    null,
  ],
  ["condense command with guidance", user("<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args>keep the cheese notes</command-args>"), null],
  ["condense output", user("<local-command-stdout>\u001b[2mCompacted (ctrl+o to see full summary)\u001b[22m</local-command-stdout>"), null],
  ["exit command", user("<command-name>/exit</command-name>\n<command-message>exit</command-message>\n<command-args></command-args>"), null],
  ["goodbye echo", user("<local-command-stdout>See ya!</local-command-stdout>"), null],
  ["interrupt marker", user([{ type: "text", text: "[Request interrupted by user]" }]), null],
  ["supervisor resume note", user("Your session was just resumed by the agent-supervisor after a restart."), null],
  [
    "background job notice",
    user("<task-notification>\n<task-id>bexv3bmi5</task-id>\n<status>completed</status>\n<summary>Background command \"Run the cheese suite\" completed (exit code 0)</summary>\n</task-notification>"),
    null,
  ],
  ["wake-up", user(pasted(ambient("⏰ [scheduled: cheese-check @ 2026-10-19T15:01:21Z] Check the cheese."))), null],
  [
    "teammate message",
    user("Another Claude session sent a message:\n<teammate-message teammate_id=\"exec\" color=\"green\" summary=\"done\">\ncheese done\n</teammate-message>"),
    null,
  ],
  ["tool output", user([{ type: "tool_result", tool_use_id: "t1", content: "cheese.txt" }]), null],
  ["agent text", agent([{ type: "text", text: "Searching for cheese now." }]), { speaker: "agent", text: "Searching for cheese now." }],
  ["agent thinking", agent([{ type: "thinking", thinking: "cheese?" }]), null],
  ["agent tool call", agent([{ type: "tool_use", id: "t2", name: "Read", input: { file_path: "/cheese" } }]), null],
  [
    "agent ask",
    agent([{ type: "text", text: "Ready.\n\n```ask\nid: ship\nquestion: Ship the cheese now?\nyes: Ship\nno: Hold\n```" }]),
    { speaker: "agent", text: "Ready.\n\nAsked you: Ship the cheese now?" },
  ],
  ["harness filler", agent([{ type: "text", text: "No response requested." }], { message: { role: "assistant", model: "<synthetic>", content: [{ type: "text", text: "No response requested." }] } }), null],
  [
    "relay message in",
    user(pasted(ambient(relayEvent("@stacy:t1000.example", "ev1", "cheese is ready")))),
    { speaker: "relay", text: "cheese is ready", relayFrom: "@stacy:t1000.example", relayTo: null },
  ],
  [
    "same relay message, second envelope",
    JSON.stringify({ type: "queue-operation", operation: "enqueue", timestamp: ts(), content: pasted(ambient(relayEvent("@stacy:t1000.example", "ev1", "cheese is ready"))) }),
    null,
  ],
  [
    "relay message out",
    agent([{ type: "tool_use", id: "t3", name: "mcp__relay__send", input: { to: "@ashley:t1000.example", body: "Cheese shipped." } }]),
    { speaker: "relay", text: "Cheese shipped.", relayFrom: null, relayTo: "@ashley:t1000.example" },
  ],
  [
    "message sent while busy (enqueue)",
    JSON.stringify({ type: "queue-operation", operation: "enqueue", timestamp: ts(), content: "also add crackers" }),
    { speaker: "user", text: "also add crackers" },
  ],
  ["same message at dequeue", user("also add crackers"), null],
  [
    "relay message arriving while busy",
    JSON.stringify({ type: "queue-operation", operation: "enqueue", timestamp: ts(), content: pasted(ambient(relayEvent("@kraken:t1000.example", "ev2", "crackers too"))) }),
    { speaker: "relay", text: "crackers too", relayFrom: "@kraken:t1000.example", relayTo: null },
  ],
];

/**
 * The conversation's own verdict for each line, in order. Two steps here are
 * written out rather than called, because the conversation does them outside
 * the backend pipeline: the browser drops a relay message seen a second time
 * (same relay event), and search leaves out the "Interrupted" status bubble —
 * a status marker, not something anyone said (agreed with Ashley 2026-10-25).
 */
function conversationView(lines: string[]): Array<{ speaker: string; text: string } | null> {
  const dedup = new Map<string, number>();
  const seenRelay = new Set<string>();
  return lines.map((line, i) => {
    const parsed = parseSessionLine(line);
    const frame = reshape(parsed, line, i + 1);
    if (frame === null) return null;
    const raw = JSON.parse(line) as Record<string, unknown>;
    if (frame.type === "message" || frame.type === "image") {
      if (frame.type === "message" && frame.interrupted) return null; // status, not words
      if (frame.role !== "user" && frame.role !== "assistant") return null;
      const now = Date.parse(String(raw.timestamp));
      if (__applyQueueDedupForTests({ parsedFrame: parsed, rawObj: raw, dedupMap: dedup, now }).suppress) return null;
      const content = frame.type === "message" ? frame.content : frame.text;
      return {
        speaker: frame.role === "user" ? "user" : "agent",
        text: frame.role === "user" ? userBubbleText(content) : agentBubbleText(content),
      };
    }
    if (frame.type === "relay_inbound") {
      if (seenRelay.has(frame.matrixEventId)) return null;
      seenRelay.add(frame.matrixEventId);
      return { speaker: "relay", text: frame.body };
    }
    if (frame.type === "relay_outbound") return frame.body ? { speaker: "relay", text: frame.body } : null;
    return null;
  });
}

describe("search line judge — parity with the conversation", () => {
  const lines = CASES.map((c) => c[1]);

  it("labels every audited line shape as expected", () => {
    const judge = createSearchLineJudge();
    for (const [label, line, expected] of CASES) {
      const got = judge.judge(line);
      expect({ label, got }).toEqual({ label, got: expected === null ? null : expect.objectContaining(expected) });
    }
  });

  it("agrees with the conversation on every line: shown or hidden, whose bubble, which words", () => {
    const judge = createSearchLineJudge();
    const view = conversationView(lines);
    CASES.forEach(([label], i) => {
      const got = judge.judge(lines[i]);
      expect({ label, search: got && { speaker: got.speaker, text: got.text } }).toEqual({ label, search: view[i] });
    });
  });
});
