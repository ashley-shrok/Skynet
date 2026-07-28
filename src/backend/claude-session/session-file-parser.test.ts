import { describe, it, expect } from "vitest";
import {
  parseSessionLine,
  detectRelayOutbound,
  detectRelayInbound,
} from "./session-file-parser.js";

// Test scaffolding: each test constructs a synthetic JSONL turn as a JS
// literal, JSON.stringify's it, passes to parseSessionLine, and asserts
// the returned discriminated-union shape. Short placeholder base64 strings
// ("AAA", "BBB", etc.) are used — the tests validate the extraction &
// discrimination logic, not real b64 shape validation.

function line(obj: Record<string, unknown>): string {
  return JSON.stringify(obj);
}

describe("parseSessionLine — image support (patch #86)", () => {
  it("Test 1: canonical tool_result path (image inside tool_result.content)", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-1",
        timestamp: "2026-07-19T12:00:00.000Z",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_A",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    data: "AAA",
                    media_type: "image/png",
                  },
                },
              ],
            },
          ],
        },
      }),
    );
    expect(parsed.kind).toBe("image");
    if (parsed.kind !== "image") throw new Error("unreachable");
    expect(parsed.role).toBe("tool_result");
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0].data).toBe("AAA");
    expect(parsed.images[0].mediaType).toBe("image/png");
    expect(parsed.images[0].toolUseId).toBe("toolu_A");
    expect(parsed.text).toBe("");
    expect(parsed.eventId).toBe("u-1");
  });

  it("Test 2: bare image content-block path (role stays user)", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-2",
        timestamp: "2026-07-19T12:00:01.000Z",
        message: {
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                data: "BBB",
                media_type: "image/jpeg",
              },
            },
          ],
        },
      }),
    );
    expect(parsed.kind).toBe("image");
    if (parsed.kind !== "image") throw new Error("unreachable");
    expect(parsed.role).toBe("user");
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0].data).toBe("BBB");
    expect(parsed.images[0].mediaType).toBe("image/jpeg");
    expect(parsed.images[0].toolUseId).toBeUndefined();
    expect(parsed.text).toBe("");
  });

  it("Test 3: CC-local-only path (toolUseResult.file.base64, no canonical block)", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-3",
        timestamp: "2026-07-19T12:00:02.000Z",
        message: {
          content: [],
        },
        toolUseResult: {
          type: "image",
          file: {
            base64: "CCC",
            type: "image/png",
            originalSize: 12345,
          },
        },
      }),
    );
    expect(parsed.kind).toBe("image");
    if (parsed.kind !== "image") throw new Error("unreachable");
    // CC-local path is by construction a tool_result payload — Claude Code
    // never populates `obj.toolUseResult` for user-typed or bare
    // assistant-generated images. Presence of `obj.toolUseResult` is the
    // parser's signal to set role="tool_result" even without a toolUseId.
    expect(parsed.role).toBe("tool_result");
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0].data).toBe("CCC");
    expect(parsed.images[0].mediaType).toBe("image/png");
    expect(parsed.images[0].toolUseId).toBeUndefined();
  });

  it("Test 4: dedup — canonical AND CC-local both present emits ONE ref (canonical wins)", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-4",
        timestamp: "2026-07-19T12:00:03.000Z",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_D",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    data: "DDD",
                    media_type: "image/png",
                  },
                },
              ],
            },
          ],
        },
        toolUseResult: {
          type: "image",
          file: {
            base64: "DDD",
            type: "image/png",
            originalSize: 54321,
          },
        },
      }),
    );
    expect(parsed.kind).toBe("image");
    if (parsed.kind !== "image") throw new Error("unreachable");
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0].data).toBe("DDD");
    expect(parsed.images[0].toolUseId).toBe("toolu_D");
  });

  it("Test 5: mixed text + image (assistant turn)", () => {
    const parsed = parseSessionLine(
      line({
        type: "assistant",
        uuid: "u-5",
        timestamp: "2026-07-19T12:00:04.000Z",
        message: {
          content: [
            { type: "text", text: "hello" },
            {
              type: "image",
              source: {
                type: "base64",
                data: "EEE",
                media_type: "image/png",
              },
            },
          ],
        },
      }),
    );
    expect(parsed.kind).toBe("image");
    if (parsed.kind !== "image") throw new Error("unreachable");
    expect(parsed.role).toBe("assistant");
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0].data).toBe("EEE");
    expect(parsed.text).toBe("hello");
  });

  it("Test 6: multi-image single turn (tool_result with 2 images)", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-6",
        timestamp: "2026-07-19T12:00:05.000Z",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_F",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    data: "F1",
                    media_type: "image/png",
                  },
                },
                {
                  type: "image",
                  source: {
                    type: "base64",
                    data: "F2",
                    media_type: "image/png",
                  },
                },
              ],
            },
          ],
        },
      }),
    );
    expect(parsed.kind).toBe("image");
    if (parsed.kind !== "image") throw new Error("unreachable");
    expect(parsed.images).toHaveLength(2);
    expect(parsed.images[0].data).toBe("F1");
    expect(parsed.images[1].data).toBe("F2");
    expect(parsed.role).toBe("tool_result");
  });

  it("Test 7: no-image regression — text-only assistant turn stays kind:message", () => {
    const parsed = parseSessionLine(
      line({
        type: "assistant",
        uuid: "u-7",
        timestamp: "2026-07-19T12:00:06.000Z",
        message: {
          content: [{ type: "text", text: "just words" }],
        },
      }),
    );
    expect(parsed.kind).toBe("message");
    if (parsed.kind !== "message") throw new Error("unreachable");
    expect(parsed.role).toBe("assistant");
    expect(parsed.content).toBe("just words");
  });

  it("Test 8: harness_wrapper STILL filters when no images present", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-8",
        timestamp: "2026-07-19T12:00:07.000Z",
        message: {
          content: "<system-reminder>foo</system-reminder>",
        },
      }),
    );
    expect(parsed.kind).toBe("skip");
    if (parsed.kind !== "skip") throw new Error("unreachable");
    expect(parsed.why).toBe("harness_wrapper");
  });

  it("Test 9: harness_wrapper does NOT filter when images present in the same turn", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-9",
        timestamp: "2026-07-19T12:00:08.000Z",
        message: {
          content: [
            { type: "text", text: "<system-reminder>foo</system-reminder>" },
            {
              type: "image",
              source: {
                type: "base64",
                data: "GGG",
                media_type: "image/png",
              },
            },
          ],
        },
      }),
    );
    expect(parsed.kind).toBe("image");
    if (parsed.kind !== "image") throw new Error("unreachable");
    expect(parsed.text).toBe("<system-reminder>foo</system-reminder>");
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0].data).toBe("GGG");
  });
});

describe("parseSessionLine — harness_wrapper filter (patch #97)", () => {
  // Combined-wrapper skip cases — must return { kind: "skip", why: "harness_wrapper" }

  it("Test A: combined wrappers — system-reminder first", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-a",
        timestamp: "2026-07-20T10:00:00.000Z",
        message: {
          content:
            "<system-reminder>alpha</system-reminder><task-notification>beta</task-notification>",
        },
      }),
    );
    expect(parsed.kind).toBe("skip");
    if (parsed.kind !== "skip") throw new Error("unreachable");
    expect(parsed.why).toBe("harness_wrapper");
  });

  it("Test B: combined wrappers — task-notification first", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-b",
        timestamp: "2026-07-20T10:00:01.000Z",
        message: {
          content:
            "<task-notification>beta</task-notification><system-reminder>alpha</system-reminder>",
        },
      }),
    );
    expect(parsed.kind).toBe("skip");
    if (parsed.kind !== "skip") throw new Error("unreachable");
    expect(parsed.why).toBe("harness_wrapper");
  });

  it("Test C: two identical wrapper blocks back-to-back", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-c",
        timestamp: "2026-07-20T10:00:02.000Z",
        message: {
          content:
            "<task-notification>one</task-notification><task-notification>two</task-notification>",
        },
      }),
    );
    expect(parsed.kind).toBe("skip");
    if (parsed.kind !== "skip") throw new Error("unreachable");
    expect(parsed.why).toBe("harness_wrapper");
  });

  it("Test D: combined wrappers with surrounding and interleaved whitespace/newlines", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-d",
        timestamp: "2026-07-20T10:00:03.000Z",
        message: {
          content:
            "  <system-reminder>alpha</system-reminder>\n\n  <task-notification>beta</task-notification>  ",
        },
      }),
    );
    expect(parsed.kind).toBe("skip");
    if (parsed.kind !== "skip") throw new Error("unreachable");
    expect(parsed.why).toBe("harness_wrapper");
  });

  it("Test E: multi-line wrapper body spans newlines (dotall handling via [\\s\\S]*?)", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-e",
        timestamp: "2026-07-20T10:00:04.000Z",
        message: {
          content: "<system-reminder>multi\nline\nbody</system-reminder>",
        },
      }),
    );
    expect(parsed.kind).toBe("skip");
    if (parsed.kind !== "skip") throw new Error("unreachable");
    expect(parsed.why).toBe("harness_wrapper");
  });

  // Preserve-user-speech cases — must NOT skip

  it("Test F: wrapper followed by real user speech — speech is preserved", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-f",
        timestamp: "2026-07-20T10:00:05.000Z",
        message: {
          content:
            "<task-notification>wake</task-notification> then actually typed text",
        },
      }),
    );
    expect(parsed.kind).not.toBe("skip");
    if (parsed.kind !== "message") throw new Error("unreachable");
    expect(parsed.content).toContain("then actually typed text");
  });

  it("Test G: user speech surrounds a wrapper block — all speech survives", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-g",
        timestamp: "2026-07-20T10:00:06.000Z",
        message: {
          content: "hello <system-reminder>noise</system-reminder> world",
        },
      }),
    );
    expect(parsed.kind).not.toBe("skip");
    if (parsed.kind !== "message") throw new Error("unreachable");
    expect(parsed.content).toContain("hello");
    expect(parsed.content).toContain("world");
  });

  // Regression cases — old behaviours must still hold

  it("Test H: lone system-reminder still filtered (regression from Test 8)", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-h",
        timestamp: "2026-07-20T10:00:07.000Z",
        message: {
          content: "<system-reminder>foo</system-reminder>",
        },
      }),
    );
    expect(parsed.kind).toBe("skip");
    if (parsed.kind !== "skip") throw new Error("unreachable");
    expect(parsed.why).toBe("harness_wrapper");
  });

  it("Test I: lone task-notification still filtered", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-i",
        timestamp: "2026-07-20T10:00:08.000Z",
        message: {
          content: "<task-notification>foo</task-notification>",
        },
      }),
    );
    expect(parsed.kind).toBe("skip");
    if (parsed.kind !== "skip") throw new Error("unreachable");
    expect(parsed.why).toBe("harness_wrapper");
  });

  it("Test J: image-bearing turn whose text is a combined wrapper still emits image (patch #86 preserved)", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-j",
        timestamp: "2026-07-20T10:00:09.000Z",
        message: {
          content: [
            {
              type: "text",
              text: "<system-reminder>alpha</system-reminder><task-notification>beta</task-notification>",
            },
            {
              type: "image",
              source: {
                type: "base64",
                data: "HHH",
                media_type: "image/png",
              },
            },
          ],
        },
      }),
    );
    expect(parsed.kind).toBe("image");
    if (parsed.kind !== "image") throw new Error("unreachable");
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0].data).toBe("HHH");
  });
});

// ---------------------------------------------------------------------------
// Phase 17 relay detection tests — RELAYBUB-01, RELAYBUB-02, RELAYBUB-05
//
// Test corpus mirrors the 6/6 acceptance battery Ashley walked through on
// 2026-07-28 with the prototype.html detectors. Ported byte-for-byte —
// do not weaken the detection or loosen the false-positive gates.
// ---------------------------------------------------------------------------

describe("parseSessionLine — relay detection (Phase 17 / RELAYBUB-01, RELAYBUB-02, RELAYBUB-05)", () => {
  // Helper: build a synthetic assistant Bash tool_use turn.
  function assistantBashTurn(
    command: string,
    uuidVal = "relay-out-1",
    ts = "2026-07-28T15:30:00.000Z",
  ): string {
    return line({
      type: "assistant",
      uuid: uuidVal,
      timestamp: ts,
      message: {
        content: [
          {
            type: "tool_use",
            name: "Bash",
            id: "toolu_relay_1",
            input: { command },
          },
        ],
      },
    });
  }

  // Helper: build a synthetic user task-notification turn.
  function taskNotificationTurn(
    content: string,
    uuidVal = "relay-in-1",
    ts = "2026-07-28T15:31:00.000Z",
  ): string {
    return line({
      type: "user",
      uuid: uuidVal,
      timestamp: ts,
      origin: { kind: "task-notification" },
      message: { content },
    });
  }

  it("Test 1: outbound-happy-path — real Matrix relay send emits kind:relay_outbound", () => {
    const cmd =
      "curl -X PUT https://matrix.org/_matrix/client/r0/rooms/!ROOMID:server/send/m.room.message/TXNID -d '{\"body\":\"hello\",\"msgtype\":\"m.text\"}'";
    const parsed = parseSessionLine(assistantBashTurn(cmd));
    expect(parsed.kind).toBe("relay_outbound");
    if (parsed.kind !== "relay_outbound") throw new Error("unreachable");
    expect(parsed.room).toBe("!ROOMID:server");
    expect(parsed.body).toBe("hello");
    expect(parsed.extractError).toBeNull();
    expect(parsed.rawCommand).toBe(cmd);
    expect(parsed.eventId).toBe("relay-out-1");
  });

  it("Test 2: outbound-false-positive-heredoc — cat heredoc mentioning path returns kind:message NOT relay_outbound", () => {
    // prototype acceptance case #1: cat > bounty.json <<JSON ... send/m.room.message ... JSON
    // lacks curl + -X PUT → must not fire outbound detector
    const cmd =
      "cat > bounty.json <<JSON\n{\"premise\":\"send/m.room.message to relay\"}\nJSON";
    const parsed = parseSessionLine(assistantBashTurn(cmd));
    // The Bash tool_use has no text content — assistant turns with ONLY tool_use
    // (no text block) have empty extractText output, so they skip on empty_content.
    // The key assertion is that it is NOT relay_outbound.
    expect(parsed.kind).not.toBe("relay_outbound");
  });

  it("Test 3: outbound-false-positive-grep — grep mentioning path returns kind:message NOT relay_outbound", () => {
    // prototype acceptance case #2: grep -n 'send/m.room.message' # PUT it in the plan
    // no /\bcurl\b/ → rejected by OUTBOUND_CURL_RE
    const cmd = "grep -n 'send/m.room.message' README.md # PUT it in the plan";
    const parsed = parseSessionLine(assistantBashTurn(cmd));
    expect(parsed.kind).not.toBe("relay_outbound");
  });

  it("Test 4: outbound-extract-fail-shellvar — shell-var -d arg: detection fires, extraction fails gracefully", () => {
    const cmd =
      "curl -X PUT https://matrix.org/_matrix/client/r0/rooms/!R:srv/send/m.room.message/T -d $body";
    const parsed = parseSessionLine(assistantBashTurn(cmd));
    expect(parsed.kind).toBe("relay_outbound");
    if (parsed.kind !== "relay_outbound") throw new Error("unreachable");
    expect(parsed.body).toBeNull();
    expect(parsed.extractError).toBe("no -d single/double quoted arg found");
    expect(parsed.rawCommand).toBe(cmd);
  });

  it("Test 5: outbound-extract-fail-dataraw — --data-raw variant: detection fires, extraction fails gracefully", () => {
    const cmd =
      "curl -X PUT https://matrix.org/_matrix/client/r0/rooms/!R:srv/send/m.room.message/T --data-raw '{\"body\":\"x\"}'";
    const parsed = parseSessionLine(assistantBashTurn(cmd));
    expect(parsed.kind).toBe("relay_outbound");
    if (parsed.kind !== "relay_outbound") throw new Error("unreachable");
    // --data-raw does not match /-d\s+'/  so extraction falls to error path
    expect(parsed.body).toBeNull();
    expect(parsed.extractError).toBe("no -d single/double quoted arg found");
    expect(parsed.rawCommand).toBe(cmd);
  });

  it("Test 6: inbound-happy-path — recv.sh event line emits kind:relay_inbound", () => {
    const body = "banana banana banana";
    const content = `<task-notification>[room !ROOMID:server] [@ashley:server] (event $EVID): ${body}</event></task-notification>`;
    const parsed = parseSessionLine(taskNotificationTurn(content));
    expect(parsed.kind).toBe("relay_inbound");
    if (parsed.kind !== "relay_inbound") throw new Error("unreachable");
    expect(parsed.room).toBe("!ROOMID:server");
    expect(parsed.sender).toBe("@ashley:server");
    expect(parsed.matrixEventId).toBe("$EVID");
    expect(parsed.body).toBe(body);
    expect(parsed.eventId).toBe("relay-in-1");
  });

  it("Test 7: inbound-false-positive-wakeup — plain wakeup fire still returns kind:skip why:harness_wrapper", () => {
    // task-notification body that does NOT match the recv.sh [room X] prefix
    const content =
      "<task-notification>WAKE UP! The agent is waiting for input.</task-notification>";
    const parsed = parseSessionLine(taskNotificationTurn(content));
    expect(parsed.kind).toBe("skip");
    if (parsed.kind !== "skip") throw new Error("unreachable");
    expect(parsed.why).toBe("harness_wrapper");
  });

  it("Test 8: regression — plain assistant text turn still returns kind:message", () => {
    const parsed = parseSessionLine(
      line({
        type: "assistant",
        uuid: "reg-asst-1",
        timestamp: "2026-07-28T15:40:00.000Z",
        message: {
          content: [{ type: "text", text: "Here is my plan." }],
        },
      }),
    );
    expect(parsed.kind).toBe("message");
    if (parsed.kind !== "message") throw new Error("unreachable");
    expect(parsed.role).toBe("assistant");
    expect(parsed.content).toBe("Here is my plan.");
    expect(parsed.eventId).toBe("reg-asst-1");
  });

  it("Test 9: regression — plain user text turn still returns kind:message", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "reg-user-1",
        timestamp: "2026-07-28T15:41:00.000Z",
        message: {
          content: "What is the status?",
        },
      }),
    );
    expect(parsed.kind).toBe("message");
    if (parsed.kind !== "message") throw new Error("unreachable");
    expect(parsed.role).toBe("user");
    expect(parsed.content).toBe("What is the status?");
    expect(parsed.eventId).toBe("reg-user-1");
  });
});
