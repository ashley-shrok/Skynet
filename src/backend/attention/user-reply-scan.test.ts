/**
 * user-reply-scan.test.ts — which transcript lines count as the user replying.
 * Line shapes are taken from real fleet transcripts.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { userReplyAt, scanTailForLatestUserReply } from "./user-reply-scan.js";

const TS = "2026-10-25T15:00:00.000Z";
const TS_MS = Date.parse(TS);

function userLine(content: unknown, extra: Record<string, unknown> = {}, ts = TS): string {
  return JSON.stringify({ type: "user", message: { role: "user", content }, timestamp: ts, ...extra });
}

const ambient =
  '<pasted_content id="cb5d">\n<task-notification>\n<summary>Ambient watcher event (aspen) — delivered by agent-supervisor</summary>\n<event>⏰ [scheduled: standup] check</event>\n</task-notification>\n</pasted_content id="cb5d">';

describe("userReplyAt — counts", () => {
  it.each([
    ["typed text", "thumbs up"],
    ["an orchestrator relay (bare inbox paste)", "Yeah, go ahead and ship it"],
    ["a long message wrapped in pasted_content", '<pasted_content id="4e5b">\nHey, I logged into Skynet on a new browser\n</pasted_content id="4e5b">'],
    ["a short message that starts with a tag", "<div> is the wrong element here, use a span"],
    ["a skill the user ran", "<command-message>light-review</command-message>\n<command-name>/light-review</command-name>"],
    ["a message that starts with a word like compact", "/compactor settings look off"],
  ])("%s", (_label, content) => {
    expect(userReplyAt(userLine(content))).toBe(TS_MS);
  });

  it("a message with an image attached (list content)", () => {
    const content = [
      { type: "image", source: { type: "base64", media_type: "image/png", data: "x" } },
      { type: "text", text: '[Image #1]\n\n<pasted_content id="d5f2">\nOkay, looking through it\n</pasted_content id="d5f2">' },
    ];
    expect(userReplyAt(userLine(content))).toBe(TS_MS);
  });
});

describe("userReplyAt — does not count", () => {
  it.each([
    ["an ambient watcher event", ambient],
    ["a bare task notification", "<task-notification>\n<summary>Move to sidebar — delivered by the app</summary>\n</task-notification>"],
    ["the supervisor's /id", "<command-message>id</command-message>\n<command-name>/id</command-name>\n<command-args>aspen</command-args>"],
    ["the supervisor's /exit", "<command-name>/exit</command-name>\n<command-message>exit</command-message>"],
    ["/compact", "<command-name>/compact</command-name>\n<command-message>compact</command-message>"],
    ["the /compact prompt as typed, before a condense", "/compact keep the codeword"],
    ["a bare /compact prompt", "/compact"],
    ["a /compact prompt pasted in a pasted_content wrapper", '<pasted_content id="aa11">\n/compact keep it\n</pasted_content id="aa11">'],
    // Shown in the user's bubble, but the harness wrote it; the command
    // before it is what counts.
    ["a command's output", "<local-command-stdout>Set model to Opus</local-command-stdout>"],
    ["a changed goodbye after the supervisor's /exit", "<local-command-stdout>Later!</local-command-stdout>"],
    ["an interrupt marker", "[Request interrupted by user]"],
    ["Ctrl-C noise", "\x03\x03"],
    ["the resumed sentinel", "Your session was just resumed by the agent-supervisor after a restart."],
  ])("%s", (_label, content) => {
    expect(userReplyAt(userLine(content))).toBeNull();
  });

  it("a skill-body injection (isMeta)", () => {
    expect(userReplyAt(userLine([{ type: "text", text: "Base directory for this skill" }], { isMeta: true }))).toBeNull();
  });

  it("a compaction summary (real shape: plain text, not isMeta)", () => {
    const line = userLine("This session is being continued from a previous conversation that ran out of context.", {
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
    });
    expect(userReplyAt(line)).toBeNull();
  });

  it("a tool result", () => {
    expect(userReplyAt(userLine([{ type: "tool_result", tool_use_id: "t", content: "ok" }]))).toBeNull();
  });

  it("an assistant line, malformed JSON, or a missing timestamp", () => {
    expect(userReplyAt(JSON.stringify({ type: "assistant", message: { content: "hi" }, timestamp: TS }))).toBeNull();
    expect(userReplyAt("{not json")).toBeNull();
    expect(userReplyAt(JSON.stringify({ type: "user", message: { content: "hi" } }))).toBeNull();
  });
});

describe("scanTailForLatestUserReply", () => {
  it("returns the newest reply, skipping later non-reply lines", () => {
    const tail = [
      userLine("first", {}, "2026-10-25T14:00:00.000Z"),
      userLine("second", {}, "2026-10-25T14:30:00.000Z"),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "ok" }] }, timestamp: "2026-10-25T14:31:00.000Z" }),
      userLine(ambient, {}, "2026-10-25T14:40:00.000Z"),
      "",
    ].join("\n");
    expect(scanTailForLatestUserReply(tail)).toBe(Date.parse("2026-10-25T14:30:00.000Z"));
  });

  it("a compaction (summary then /compact) after a reply does not count as a newer reply", () => {
    const tail = [
      userLine("real reply", {}, "2026-10-25T14:00:00.000Z"),
      userLine("This session is being continued from a previous conversation.", { isCompactSummary: true, isVisibleInTranscriptOnly: true }, "2026-10-25T15:00:00.000Z"),
      userLine("<command-name>/compact</command-name>\n<command-message>compact</command-message>", {}, "2026-10-25T15:00:01.000Z"),
    ].join("\n");
    expect(scanTailForLatestUserReply(tail)).toBe(Date.parse("2026-10-25T14:00:00.000Z"));
  });

  it("is null when the tail has no reply (and survives a cut first line)", () => {
    expect(scanTailForLatestUserReply('ent":"half a line"}\n' + userLine(ambient))).toBeNull();
  });

  it("a message the user cancelled is not a reply", () => {
    const tail = [
      userLine("kept", { uuid: "u1", parentUuid: "a0" }, "2026-10-25T14:00:00.000Z"),
      JSON.stringify({ type: "assistant", uuid: "a1", parentUuid: "u1", message: { role: "assistant", content: [{ type: "text", text: "ok" }] }, timestamp: "2026-10-25T14:01:00.000Z" }),
      // Sent, then cancelled before the agent did anything: the next prompt
      // branches from the same point.
      userLine("withdrawn", { uuid: "u2", parentUuid: "a1" }, "2026-10-25T14:30:00.000Z"),
      userLine(ambient, { uuid: "u3", parentUuid: "a1" }, "2026-10-25T14:40:00.000Z"),
    ].join("\n");
    expect(scanTailForLatestUserReply(tail)).toBe(Date.parse("2026-10-25T14:00:00.000Z"));
  });

  it("the newest message still counts while nothing has followed it", () => {
    const tail = [
      JSON.stringify({ type: "assistant", uuid: "a1", parentUuid: null, message: { role: "assistant", content: [{ type: "text", text: "ok" }] }, timestamp: "2026-10-25T14:01:00.000Z" }),
      userLine("just sent", { uuid: "u2", parentUuid: "a1" }, "2026-10-25T14:30:00.000Z"),
    ].join("\n");
    expect(scanTailForLatestUserReply(tail)).toBe(Date.parse("2026-10-25T14:30:00.000Z"));
  });

  it("a message sent while the agent was busy counts from when it was sent", () => {
    const tail = [
      JSON.stringify({ type: "queue-operation", operation: "enqueue", timestamp: "2026-10-25T14:10:00.000Z", content: "and also this" }),
      JSON.stringify({ type: "queue-operation", operation: "dequeue", timestamp: "2026-10-25T14:20:00.000Z" }),
      userLine("and also this", { uuid: "u2", parentUuid: "a1" }, "2026-10-25T14:20:00.000Z"),
    ].join("\n");
    expect(scanTailForLatestUserReply(tail)).toBe(Date.parse("2026-10-25T14:10:00.000Z"));
  });

  it("an answer to the agent's question counts", () => {
    const answer = "```answer\nask: ship\nquestion: Ship it?\nanswer: Ship now\n```";
    expect(scanTailForLatestUserReply(userLine(answer))).toBe(TS_MS);
  });
});
