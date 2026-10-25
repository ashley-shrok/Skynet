import { describe, it, expect } from "vitest";
import { parseSessionLine, stripCompactSummaryPreamble } from "./session-file-parser";

// Shapes as Claude Code 2.1.310 writes them (e2e transcript, 2026-10-25):
// typed prompt → marker → summary → caveat (meta) → /compact command → "Compacted" output.
const PREAMBLE =
  "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\n";
const TOOLS_LINE = "<tools-used-before-summary>Bash</tools-used-before-summary>\n";
const SUMMARY_BODY = "Summary:\n1. Primary Request and Intent:\n   - Remember OSPREY.";

function userLine(content: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "user",
    uuid: extra.uuid ?? "u-1",
    timestamp: "2026-10-25T15:00:00.000Z",
    message: { role: "user", content },
    ...extra,
  });
}

describe("parseSessionLine — compaction", () => {
  it("the compaction marker stays a skip", () => {
    const line = JSON.stringify({ type: "system", subtype: "compact_boundary", content: "Conversation compacted", uuid: "b-1" });
    expect(parseSessionLine(line).kind).toBe("skip");
  });

  it("the summary becomes a compaction with the preamble and tools line removed", () => {
    const p = parseSessionLine(
      userLine(PREAMBLE + TOOLS_LINE + SUMMARY_BODY, { uuid: "s-1", isCompactSummary: true, isVisibleInTranscriptOnly: true }),
    );
    expect(p).toEqual({
      kind: "compaction",
      summary: SUMMARY_BODY,
      eventId: "s-1",
      ts: Date.parse("2026-10-25T15:00:00.000Z"),
    });
  });

  it("a summary in block form is read the same way", () => {
    const line = JSON.stringify({
      type: "user",
      uuid: "s-2",
      isCompactSummary: true,
      message: { role: "user", content: [{ type: "text", text: PREAMBLE + "Summary:\nhi" }] },
    });
    const p = parseSessionLine(line);
    expect(p.kind).toBe("compaction");
    if (p.kind === "compaction") expect(p.summary).toBe("Summary:\nhi");
  });

  it("the compact command with guidance becomes compaction_guidance", () => {
    const p = parseSessionLine(
      userLine(
        "<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args>keep the pending file question</command-args>",
        { uuid: "c-1" },
      ),
    );
    expect(p).toMatchObject({ kind: "compaction_guidance", guidance: "keep the pending file question", eventId: "c-1" });
  });

  it("the compact command without guidance is skipped", () => {
    const p = parseSessionLine(
      userLine("<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args></command-args>"),
    );
    expect(p).toEqual({ kind: "skip", why: "compact_command" });
  });

  it("the Compacted output (with ANSI dimming and hook chatter) is skipped", () => {
    const p = parseSessionLine(
      userLine("<local-command-stdout>\u001b[2mCompacted (ctrl+o to see full summary)\u001b[22m\n\u001b[2mPreCompact [/x/hook] completed\u001b[22m</local-command-stdout>"),
    );
    expect(p).toEqual({ kind: "skip", why: "compact_output" });
  });

  it("the /compact prompt as typed, recorded before the condense, is skipped", () => {
    expect(parseSessionLine(userLine("/compact Keep: codeword OSPREY"))).toEqual({ kind: "skip", why: "compact_prompt" });
    expect(parseSessionLine(userLine("/compact"))).toEqual({ kind: "skip", why: "compact_prompt" });
    expect(parseSessionLine(userLine("/compactor is a word")).kind).toBe("message");
  });

  it("the /compact prompt queued while busy (enqueue or queued attachment) is skipped", () => {
    const enqueue = JSON.stringify({ type: "queue-operation", operation: "enqueue", timestamp: "2026-10-25T16:45:53.270Z", sessionId: "s", content: "/compact keep the codeword" });
    expect(parseSessionLine(enqueue, "s").kind).toBe("skip");
    const attachment = JSON.stringify({ type: "attachment", uuid: "q-1", attachment: { type: "queued_command", prompt: "/compact" } });
    expect(parseSessionLine(attachment)).toEqual({ kind: "skip", why: "compact_prompt" });
  });

  it("a user message quoting the compact command tag mid-text is still a message", () => {
    const p = parseSessionLine(userLine("Look at this line: <command-name>/compact</command-name> — why?"));
    expect(p.kind).toBe("message");
  });

  it("other local command output still renders", () => {
    const p = parseSessionLine(userLine("<local-command-stdout>Set model to opus</local-command-stdout>"));
    expect(p.kind).toBe("message");
  });

  it("a user message that merely mentions compaction is still a message", () => {
    const p = parseSessionLine(userLine("Compacted? This session is being continued from a previous conversation, I think"));
    expect(p.kind).toBe("message");
  });

  it("stripCompactSummaryPreamble leaves a summary without the preamble alone", () => {
    expect(stripCompactSummaryPreamble("Summary:\nx")).toBe("Summary:\nx");
    // A tools line later in the body is the summary's own text and stays.
    expect(stripCompactSummaryPreamble("Summary:\n<tools-used-before-summary>x</tools-used-before-summary>")).toContain("tools-used");
  });
});
