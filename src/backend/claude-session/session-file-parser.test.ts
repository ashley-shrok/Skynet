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

  it("Test 4: outbound-shellvar — shell-var -d arg still emits relay_outbound with rawCommand", () => {
    const cmd =
      "curl -X PUT https://matrix.org/_matrix/client/r0/rooms/!R:srv/send/m.room.message/T -d $body";
    const parsed = parseSessionLine(assistantBashTurn(cmd));
    expect(parsed.kind).toBe("relay_outbound");
    if (parsed.kind !== "relay_outbound") throw new Error("unreachable");
    expect(parsed.room).toBe("!R:srv");
    expect(parsed.rawCommand).toBe(cmd);
  });

  it("Test 5: outbound-dataraw — --data-raw variant still emits relay_outbound with rawCommand", () => {
    const cmd =
      "curl -X PUT https://matrix.org/_matrix/client/r0/rooms/!R:srv/send/m.room.message/T --data-raw '{\"body\":\"x\"}'";
    const parsed = parseSessionLine(assistantBashTurn(cmd));
    expect(parsed.kind).toBe("relay_outbound");
    if (parsed.kind !== "relay_outbound") throw new Error("unreachable");
    expect(parsed.room).toBe("!R:srv");
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

  // Sentinel-detector rescue tests (2026-08-28, bounty
  // detector-fleet-corpus-sentinel-eval). Corpus of 716 real fleet commands
  // showed the old three-way conjunction was over-fitted: the URL_RE
  // character class rejected 86 real sends where identities URL-encode the
  // room via `$(python3 -c '...quote...')` or `printf | jq -sRr @uri`.
  // Sentinel + curl + PUT: zero false positives fleet-wide, +86 rescues.

  it("Test 10 (rescue): python3-urllib-quote URL encoding (Yolanda-class) emits relay_outbound", () => {
    // Real fleet shape: yolanda 2026-08-28 and 40 other identities. The
    // `$(python3 -c '...urllib.parse.quote(...)...' "$ROOM")` substitution
    // puts slashes/quotes/whitespace in the URL segment, defeating the old
    // URL_RE character class. Sentinel-based detector recognizes it.
    const cmd =
      `BODY='hello world'\n` +
      `TXN="nelly-$(date +%s)-$$"\n` +
      `curl -sS -X PUT "$BASE/rooms/$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$ROOM")/send/m.room.message/$TXN" ` +
      `-H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' ` +
      `-d "$(jq -nc --arg b "$BODY" '{msgtype:"m.text", body:$b}')"`;
    const parsed = parseSessionLine(assistantBashTurn(cmd));
    expect(parsed.kind).toBe("relay_outbound");
    if (parsed.kind !== "relay_outbound") throw new Error("unreachable");
    // Room extraction regex still uses the strict shape → null is tolerated
    // for these rescued shapes (downstream wire type accepts room: null).
    expect(parsed.rawCommand).toBe(cmd);
  });

  it("Test 11 (rescue): printf-jq-uri URL encoding (hilda/nelly-class) emits relay_outbound", () => {
    // Real fleet shape: hilda + nelly one-liner form.
    // `$(printf %s "$ROOM" | jq -sRr @uri)` — same URL_RE-defeating idiom,
    // different implementation. Sentinel detector recognizes it.
    const cmd =
      `curl -sS -X PUT "$BASE/rooms/$(printf %s "$ROOM" | jq -sRr @uri)/send/m.room.message/$TXN" ` +
      `-H "Authorization: Bearer $TOK" -H "Content-Type: application/json" ` +
      `--data-binary "$BODY"`;
    const parsed = parseSessionLine(assistantBashTurn(cmd));
    expect(parsed.kind).toBe("relay_outbound");
    if (parsed.kind !== "relay_outbound") throw new Error("unreachable");
    expect(parsed.rawCommand).toBe(cmd);
  });

  it("Test 12 (fp-safety): grep for m.room.message in a doc file returns kind:message NOT relay_outbound", () => {
    // Real fleet false-positive class: 3 hits in corpus (t1000, thenasty,
    // workstation) — grepping the agent-relay SKILL.md for reference. No
    // curl. Sentinel matches but CURL_RE rejects → NOT relay_outbound.
    const cmd = `grep -n "sendMessage\\|send message\\|room/.*/send\\|m.room.message" ~/.claude/skills/agent-relay/SKILL.md | head -30`;
    const parsed = parseSessionLine(assistantBashTurn(cmd));
    expect(parsed.kind).not.toBe("relay_outbound");
  });

  it("Test 13 (fp-safety): coord-room GET (curl but no PUT) returns kind:message NOT relay_outbound", () => {
    // Real fleet false-positive class: fetching room message history. Has
    // curl + rooms/... in URL, but NO -X PUT (GET is default). Sentinel
    // matches but PUT_RE rejects → NOT relay_outbound. Comment mentions
    // m.room.message.
    const cmd =
      `# check recent coord-room activity — inspecting m.room.message events\n` +
      `curl -sS -H "Authorization: Bearer $TOK" "$BASE/rooms/$ROOM/messages?dir=b&limit=15"`;
    const parsed = parseSessionLine(assistantBashTurn(cmd));
    expect(parsed.kind).not.toBe("relay_outbound");
  });

  it("Test 14 (fp-safety): python heredoc analyzing session files (no curl) returns NOT relay_outbound", () => {
    // Real fleet false-positive class: agent introspection scripts that
    // grep session files for the sentinel string. Contains
    // m.room.message but no curl and no -X PUT → correctly rejected.
    const cmd =
      `python3 <<'EOF'\n` +
      `import json, glob\n` +
      `# Look for recent relay-outbound tool_use commands (contain m.room.message)\n` +
      `for f in glob.glob('/tmp/*.jsonl'):\n` +
      `    with open(f) as fh:\n` +
      `        for line in fh:\n` +
      `            if 'm.room.message' in line:\n` +
      `                print(f)\n` +
      `EOF`;
    const parsed = parseSessionLine(assistantBashTurn(cmd));
    expect(parsed.kind).not.toBe("relay_outbound");
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

// pv-parser-accept-queued-command-attachment (2026-08-10) — observed in
// Nelly's session where Ashley typed normally in pretty view and hit enter;
// the harness wrote it as type:"attachment" with attachment.type:
// "queued_command" and the message never rendered. Parser must accept this
// shape as a user turn with attachment.prompt as content.
describe("parseSessionLine — queued_command attachment (harness quirk)", () => {
  it("Test A: queued_command attachment renders as user message", () => {
    const parsed = parseSessionLine(
      line({
        parentUuid: "84c75621-4531-4520-ac60-125b26532a56",
        isSidechain: false,
        attachment: {
          type: "queued_command",
          prompt: "can you give me a tailnet link to download project hail mary movie",
          commandMode: "prompt",
        },
        type: "attachment",
        uuid: "8d41244c-938c-4542-903d-f61db595317c",
        timestamp: "2026-08-10T02:16:36.778Z",
        userType: "external",
      }),
    );
    expect(parsed.kind).toBe("message");
    if (parsed.kind !== "message") throw new Error("unreachable");
    expect(parsed.role).toBe("user");
    expect(parsed.content).toBe(
      "can you give me a tailnet link to download project hail mary movie",
    );
    expect(parsed.eventId).toBe("8d41244c-938c-4542-903d-f61db595317c");
    expect(parsed.ts).toBe(Date.parse("2026-08-10T02:16:36.778Z"));
  });

  it("Test B: attachment with unrelated type still skips (task_reminder)", () => {
    const parsed = parseSessionLine(
      line({
        type: "attachment",
        uuid: "u-att-tr",
        timestamp: "2026-08-10T02:27:37.865Z",
        attachment: { type: "task_reminder", content: [], itemCount: 0 },
      }),
    );
    expect(parsed.kind).toBe("skip");
    if (parsed.kind !== "skip") throw new Error("unreachable");
    expect(parsed.why).toBe("attachment");
  });

  it("Test C: queued_command attachment with empty prompt skips", () => {
    const parsed = parseSessionLine(
      line({
        type: "attachment",
        uuid: "u-att-empty",
        timestamp: "2026-08-10T02:16:36.778Z",
        attachment: { type: "queued_command", prompt: "" },
      }),
    );
    expect(parsed.kind).toBe("skip");
    if (parsed.kind !== "skip") throw new Error("unreachable");
    expect(parsed.why).toBe("attachment");
  });

  it("Test D: queued_command attachment missing prompt skips", () => {
    const parsed = parseSessionLine(
      line({
        type: "attachment",
        uuid: "u-att-nop",
        timestamp: "2026-08-10T02:16:36.778Z",
        attachment: { type: "queued_command" },
      }),
    );
    expect(parsed.kind).toBe("skip");
    if (parsed.kind !== "skip") throw new Error("unreachable");
    expect(parsed.why).toBe("attachment");
  });

  it("Test E1 (flipped, 2026-08-28): queued_command whose prompt carries a recv.sh event line emits relay_inbound", () => {
    // Flipped from the original "→ skip" assertion after the
    // inbound-detector-queued-envelopes-corpus bounty (2026-08-28) showed
    // 359 real inbound messages fleet-wide were silently dropped this way
    // in the last 2 weeks — every peer DM / coord-room reply that arrived
    // while the receiving agent was mid-turn. The 2026-08-10 comment
    // ("shipped patch #999 — clear") was documenting exactly the bug this
    // path exists to fix: recv.sh event content inside a queued_command
    // attachment IS a real inbound message and must render as a bubble.
    // Wrapper-only queued_commands (no recv.sh line) still skip — see
    // Test E1b + E2 below for the false-positive-safety coverage.
    const parsed = parseSessionLine(
      line({
        type: "attachment",
        uuid: "u-att-wrapper-tn",
        timestamp: "2026-08-10T02:16:36.778Z",
        attachment: {
          type: "queued_command",
          prompt:
            '<task-notification>\n<task-id>blyc1z61t</task-id>\n<summary>Monitor event: "tanya relay receiver"</summary>\n<event>[room !X:server] [@tina:server] (event $abc): shipped patch #999 — clear.</event>\n</task-notification>',
          commandMode: "prompt",
        },
      }),
    );
    expect(parsed.kind).toBe("relay_inbound");
    if (parsed.kind !== "relay_inbound") throw new Error("unreachable");
    expect(parsed.room).toBe("!X:server");
    expect(parsed.sender).toBe("@tina:server");
    expect(parsed.matrixEventId).toBe("$abc");
    expect(parsed.body).toBe("shipped patch #999 — clear.");
  });

  it("Test E1b (fp-safety): queued_command whose prompt is a wrapper-only task-notification (no recv.sh line) still skips", () => {
    // Genuine harness-wakeup case: task-notification wrapper contents that
    // DON'T carry a recv.sh event-line (bracket-form) must stay skipped —
    // the original 2026-08-10 patch intent. Only the recv.sh subset gets
    // rescued into relay_inbound.
    const parsed = parseSessionLine(
      line({
        type: "attachment",
        uuid: "u-att-wrapper-only",
        timestamp: "2026-08-10T02:16:36.778Z",
        attachment: {
          type: "queued_command",
          prompt:
            "<task-notification>\n<task-id>blyc1z61t</task-id>\n<summary>Monitor completion event</summary>\n<status>killed</status>\n</task-notification>",
          commandMode: "prompt",
        },
      }),
    );
    expect(parsed.kind).toBe("skip");
    if (parsed.kind !== "skip") throw new Error("unreachable");
    expect(parsed.why).toBe("attachment");
  });

  it("Test E2: queued_command whose prompt is a system-reminder wrapper skips", () => {
    const parsed = parseSessionLine(
      line({
        type: "attachment",
        uuid: "u-att-wrapper-sr",
        timestamp: "2026-08-10T02:16:36.778Z",
        attachment: {
          type: "queued_command",
          prompt:
            "<system-reminder>\ntask reminder body here\n</system-reminder>",
          commandMode: "prompt",
        },
      }),
    );
    expect(parsed.kind).toBe("skip");
  });

  it("Test E3: queued_command whose prompt mixes real speech + a pasted wrapper still renders (non-empty after strip)", () => {
    const parsed = parseSessionLine(
      line({
        type: "attachment",
        uuid: "u-att-mixed",
        timestamp: "2026-08-10T02:16:36.778Z",
        attachment: {
          type: "queued_command",
          prompt:
            'why is this rendering? example: <task-notification>foo</task-notification>',
          commandMode: "prompt",
        },
      }),
    );
    expect(parsed.kind).toBe("message");
    if (parsed.kind !== "message") throw new Error("unreachable");
    // Content preserves the FULL original prompt (wrapper kept for context —
    // matches isUser wrapper-strip which only gates on stripped emptiness,
    // does not rewrite content).
    expect(parsed.content).toContain("why is this rendering?");
    expect(parsed.content).toContain("<task-notification>");
  });

  it("Test F1: queued_command attachment falls back to messageId then random eventId when uuid missing", () => {
    const parsed = parseSessionLine(
      line({
        type: "attachment",
        messageId: "m-att-mid",
        timestamp: "2026-08-10T02:16:36.778Z",
        attachment: { type: "queued_command", prompt: "hello" },
      }),
    );
    expect(parsed.kind).toBe("message");
    if (parsed.kind !== "message") throw new Error("unreachable");
    expect(parsed.eventId).toBe("m-att-mid");
  });
});

// pv-malformed-jsonl-placeholder-bubble (2026-08-10) — Claude Code's JSONL
// writer occasionally concatenates records on the same line and truncates
// the first mid-string. Parser must return kind:"malformed" with the raw
// byte count so the consumer can surface a placeholder bubble.
describe("parseSessionLine — malformed line diagnostic bytes", () => {
  it("Test F: unparseable JSON returns kind:malformed with bytes=trimmed length", () => {
    const raw = '{"parentUuid":"e610c7c4","type":"assistant","content":[{"type":"thinking","signature":"AAA{"type":"file-history-snapshot"}';
    const parsed = parseSessionLine(raw);
    expect(parsed.kind).toBe("malformed");
    if (parsed.kind !== "malformed") throw new Error("unreachable");
    expect(parsed.bytes).toBe(raw.length);
  });

  it("Test G: malformed bytes reflects trimmed length (whitespace stripped)", () => {
    const raw = "   {broken json   ";
    const parsed = parseSessionLine(raw);
    expect(parsed.kind).toBe("malformed");
    if (parsed.kind !== "malformed") throw new Error("unreachable");
    expect(parsed.bytes).toBe(raw.trim().length);
  });
});

// Phase 50 Plan 01 Task 1 (D-09, D-10, D-11) — teach parseSessionLine to
// treat a normal-content type:"queue-operation" + operation:"enqueue" entry
// as a first-class kind:"message" (role:"user") emission. eventId is
// deterministic per (sessionId, timestamp, content). Task-notification and
// system-reminder wrapped enqueues still skip (patch #66 completion path
// unchanged). See 50-01-PLAN.md § objective "Hash-derivation contract" for
// the two-hash rationale (eventId here vs. contentHash used by Task 2's
// dedup Map + Plan 50-02 watchdog).
describe("parseSessionLine — queue-operation enqueue as kind:message (Phase 50 Plan 01 Task 1)", () => {
  it("Test QO-1 (positive): normal-content enqueue → kind:message role:user", () => {
    const parsed = parseSessionLine(
      line({
        type: "queue-operation",
        operation: "enqueue",
        content: "hello world",
        timestamp: "2026-08-20T12:00:00.000Z",
      }),
      "sess-A",
    );
    expect(parsed.kind).toBe("message");
    if (parsed.kind !== "message") throw new Error("unreachable");
    expect(parsed.role).toBe("user");
    expect(parsed.content).toBe("hello world");
    expect(typeof parsed.eventId).toBe("string");
    expect(parsed.eventId.length).toBe(32);
    expect(parsed.eventId).toMatch(/^[0-9a-f]{32}$/);
    expect(typeof parsed.ts).toBe("number");
    expect(parsed.ts).toBe(Date.parse("2026-08-20T12:00:00.000Z"));
  });

  it("Test QO-2 (positive, deterministic eventId): identical inputs → identical eventId", () => {
    const a = parseSessionLine(
      line({
        type: "queue-operation",
        operation: "enqueue",
        content: "same body",
        timestamp: "2026-08-20T12:00:01.000Z",
      }),
      "sess-A",
    );
    const b = parseSessionLine(
      line({
        type: "queue-operation",
        operation: "enqueue",
        content: "same body",
        timestamp: "2026-08-20T12:00:01.000Z",
      }),
      "sess-A",
    );
    expect(a.kind).toBe("message");
    expect(b.kind).toBe("message");
    if (a.kind !== "message" || b.kind !== "message") throw new Error("unreachable");
    expect(a.eventId).toBe(b.eventId);
    // Changing sessionId → different eventId (sessionId is part of the derivation)
    const c = parseSessionLine(
      line({
        type: "queue-operation",
        operation: "enqueue",
        content: "same body",
        timestamp: "2026-08-20T12:00:01.000Z",
      }),
      "sess-B",
    );
    if (c.kind !== "message") throw new Error("unreachable");
    expect(c.eventId).not.toBe(a.eventId);
  });

  it("Test QO-3 (negative — task-notification skipped): enqueue whose content starts with <task-notification> does NOT emit message", () => {
    const parsed = parseSessionLine(
      line({
        type: "queue-operation",
        operation: "enqueue",
        content: "<task-notification>\n<task-id>abc</task-id>\n</task-notification>",
        timestamp: "2026-08-20T12:00:02.000Z",
      }),
      "sess-A",
    );
    expect(parsed.kind).toBe("skip");
  });

  it("Test QO-3b (negative — system-reminder skipped): enqueue whose content starts with <system-reminder> does NOT emit message", () => {
    const parsed = parseSessionLine(
      line({
        type: "queue-operation",
        operation: "enqueue",
        content: "<system-reminder>reminder body</system-reminder>",
        timestamp: "2026-08-20T12:00:02.500Z",
      }),
      "sess-A",
    );
    expect(parsed.kind).toBe("skip");
  });

  it("Test QO-4 (negative — non-enqueue operation): operation:dequeue does NOT emit message", () => {
    const parsed = parseSessionLine(
      line({
        type: "queue-operation",
        operation: "dequeue",
        content: "hello world",
        timestamp: "2026-08-20T12:00:03.000Z",
      }),
      "sess-A",
    );
    expect(parsed.kind).toBe("skip");
  });

  it("Test QO-5 (timestamp derivation): missing timestamp → ts falls back to Date.now()", () => {
    const before = Date.now();
    const parsed = parseSessionLine(
      line({
        type: "queue-operation",
        operation: "enqueue",
        content: "no timestamp",
      }),
      "sess-A",
    );
    const after = Date.now();
    expect(parsed.kind).toBe("message");
    if (parsed.kind !== "message") throw new Error("unreachable");
    expect(parsed.ts).toBeGreaterThanOrEqual(before);
    expect(parsed.ts).toBeLessThanOrEqual(after);
  });

  it("Test QO-5b (timestamp derivation): unparseable timestamp → ts falls back to Date.now()", () => {
    const before = Date.now();
    const parsed = parseSessionLine(
      line({
        type: "queue-operation",
        operation: "enqueue",
        content: "garbage timestamp",
        timestamp: "not-a-date",
      }),
      "sess-A",
    );
    const after = Date.now();
    expect(parsed.kind).toBe("message");
    if (parsed.kind !== "message") throw new Error("unreachable");
    expect(parsed.ts).toBeGreaterThanOrEqual(before);
    expect(parsed.ts).toBeLessThanOrEqual(after);
  });

  it("Test QO-6 (edge — empty content): empty-string content does NOT emit; falls through to skip", () => {
    const parsed = parseSessionLine(
      line({
        type: "queue-operation",
        operation: "enqueue",
        content: "",
        timestamp: "2026-08-20T12:00:04.000Z",
      }),
      "sess-A",
    );
    expect(parsed.kind).toBe("skip");
  });

  it("Test QO-6b (edge — whitespace-only content): whitespace-only content does NOT emit; falls through to skip", () => {
    const parsed = parseSessionLine(
      line({
        type: "queue-operation",
        operation: "enqueue",
        content: "   \n\t  ",
        timestamp: "2026-08-20T12:00:04.500Z",
      }),
      "sess-A",
    );
    expect(parsed.kind).toBe("skip");
  });

  it("Test QO-7 (back-compat): sessionId omitted → still emits message (fallback eventId)", () => {
    const parsed = parseSessionLine(
      line({
        type: "queue-operation",
        operation: "enqueue",
        content: "back compat call",
        timestamp: "2026-08-20T12:00:05.000Z",
      }),
      // no second arg → sessionId undefined
    );
    expect(parsed.kind).toBe("message");
    if (parsed.kind !== "message") throw new Error("unreachable");
    expect(parsed.content).toBe("back compat call");
    // fallback eventId is a Date.now + random suffix string; just assert it's non-empty
    expect(typeof parsed.eventId).toBe("string");
    expect(parsed.eventId.length).toBeGreaterThan(0);
  });

  // Rescue tests — inbound-detector-queued-envelopes-corpus (2026-08-28).
  // Real fleet shape: task-notification-wrapped recv.sh event lines land in
  // queue-operation envelopes when the receiving agent is busy. Corpus
  // showed 1029 real inbounds arrived this way in the last 2 weeks fleet-
  // wide, all previously dropped by the QO-3 skip path. Zack's 2026-08-28
  // message to Poppy (workstation, session 2dbb6334 line 1158) was the
  // triggering incident.

  it("Test QO-6 (rescue): enqueue whose task-notification wrapper carries a recv.sh event line emits relay_inbound", () => {
    // Zack → Poppy 2026-08-28 shape (real recv.sh envelope emission by the
    // agent-relay skill's receiver script). The wrapper strip + INBOUND_REGEX
    // match happens in detectRelayInbound before the QO-3 <task-notification>
    // skip fires, so this envelope now surfaces as a bubble.
    const parsed = parseSessionLine(
      line({
        type: "queue-operation",
        operation: "enqueue",
        content:
          '<task-notification>\n<task-id>b8fgbx2pm</task-id>\n<summary>Monitor event: "[ambient] poppy relay receiver"</summary>\n<event>[room !eEmSaImJffvUZTwWcS:thenasty.taild9b663.ts.net] [@zack:thenasty.taild9b663.ts.net] (event $EA3MJ9B27m08TMGRackXQOIRTvwCbacS92t1itTLwd8): hi poppy — recon on the reference email</event>\n</task-notification>',
        timestamp: "2026-08-28T11:13:04.465Z",
      }),
      "sess-poppy",
    );
    expect(parsed.kind).toBe("relay_inbound");
    if (parsed.kind !== "relay_inbound") throw new Error("unreachable");
    expect(parsed.room).toBe("!eEmSaImJffvUZTwWcS:thenasty.taild9b663.ts.net");
    expect(parsed.sender).toBe("@zack:thenasty.taild9b663.ts.net");
    expect(parsed.matrixEventId).toBe(
      "$EA3MJ9B27m08TMGRackXQOIRTvwCbacS92t1itTLwd8",
    );
    expect(parsed.body).toBe("hi poppy — recon on the reference email");
  });

  it("Test QO-3 unchanged (fp-safety): enqueue with task-notification wrapper BUT no recv.sh event line still skips", () => {
    // Companion to QO-3 (the original bug-documenting test). Confirms the
    // rescue is narrow: ONLY envelopes whose stripped content matches
    // INBOUND_REGEX get the new relay_inbound treatment. Genuine harness
    // task-notifications (completion, wakeup, etc.) still hit the QO-3
    // skip path — the patch #66 completion-detection contract stays intact.
    const parsed = parseSessionLine(
      line({
        type: "queue-operation",
        operation: "enqueue",
        content:
          "<task-notification>\n<task-id>bxyz123</task-id>\n<status>killed</status>\n<summary>Monitor stopped</summary>\n</task-notification>",
        timestamp: "2026-08-28T11:14:00.000Z",
      }),
      "sess-A",
    );
    expect(parsed.kind).toBe("skip");
  });
});

describe("parseSessionLine — session-lifecycle noise skips (quick-260829-r9i)", () => {
  // Five negative tests — one per new skip reason. Each fixture mirrors a real
  // JSONL shape observed in the wild that Ashley wants hidden from PrettyView
  // bubbles.

  it("Test R9I-1: slash_exit — supervisor-injected /exit command turn is skipped", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-r9i-1",
        timestamp: "2026-08-29T10:00:00.000Z",
        message: {
          content:
            "<command-name>/exit</command-name>\n            <command-message>exit</command-message>\n            <command-args></command-args>",
        },
      }),
    );
    expect(parsed.kind).toBe("skip");
    if (parsed.kind !== "skip") throw new Error("unreachable");
    expect(parsed.why).toBe("slash_exit");
  });

  it("Test R9I-2: slash_id — /id invocation is skipped (args-agnostic)", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-r9i-2",
        timestamp: "2026-08-29T10:00:01.000Z",
        message: {
          content:
            "<command-message>id</command-message>\n<command-name>/id</command-name>\n<command-args>tina</command-args>",
        },
      }),
    );
    expect(parsed.kind).toBe("skip");
    if (parsed.kind !== "skip") throw new Error("unreachable");
    expect(parsed.why).toBe("slash_id");
  });

  it("Test R9I-3: goodbye_echo — literal Goodbye! stdout is skipped", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-r9i-3",
        timestamp: "2026-08-29T10:00:02.000Z",
        message: {
          content: "<local-command-stdout>Goodbye!</local-command-stdout>",
        },
      }),
    );
    expect(parsed.kind).toBe("skip");
    if (parsed.kind !== "skip") throw new Error("unreachable");
    expect(parsed.why).toBe("goodbye_echo");
  });

  // quick-260830-e6i: widen goodbye_echo predicate to 4 exit-echo variants.
  // Ashley's session-end routine emits three additional literals beyond Goodbye!
  // — all equally session-lifecycle noise. Set-membership is closed, so other
  // <local-command-stdout>...</local-command-stdout> bodies still render (see
  // Test R9I-3d below).

  it("Test R9I-3a: goodbye_echo — literal 'Catch you later!' stdout is skipped", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-r9i-3a",
        timestamp: "2026-08-30T10:00:00.000Z",
        message: {
          content: "<local-command-stdout>Catch you later!</local-command-stdout>",
        },
      }),
    );
    expect(parsed.kind).toBe("skip");
    if (parsed.kind !== "skip") throw new Error("unreachable");
    expect(parsed.why).toBe("goodbye_echo");
  });

  it("Test R9I-3b: goodbye_echo — literal 'See ya!' stdout is skipped", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-r9i-3b",
        timestamp: "2026-08-30T10:00:01.000Z",
        message: {
          content: "<local-command-stdout>See ya!</local-command-stdout>",
        },
      }),
    );
    expect(parsed.kind).toBe("skip");
    if (parsed.kind !== "skip") throw new Error("unreachable");
    expect(parsed.why).toBe("goodbye_echo");
  });

  it("Test R9I-3c: goodbye_echo — literal 'Bye!' stdout is skipped", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-r9i-3c",
        timestamp: "2026-08-30T10:00:02.000Z",
        message: {
          content: "<local-command-stdout>Bye!</local-command-stdout>",
        },
      }),
    );
    expect(parsed.kind).toBe("skip");
    if (parsed.kind !== "skip") throw new Error("unreachable");
    expect(parsed.why).toBe("goodbye_echo");
  });

  it("Test R9I-3d: non-exit <local-command-stdout>...</local-command-stdout> body passes through (Set is closed, not substring)", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-r9i-3d",
        timestamp: "2026-08-30T10:00:03.000Z",
        message: {
          content: "<local-command-stdout>output of /model</local-command-stdout>",
        },
      }),
    );
    expect(parsed.kind).toBe("message");
    if (parsed.kind !== "message") throw new Error("unreachable");
    expect(parsed.role).toBe("user");
    expect(parsed.content).toContain("output of /model");
  });

  it("Test R9I-4: resume_injection — agent-supervisor resume sentinel is skipped", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-r9i-4",
        timestamp: "2026-08-29T10:00:03.000Z",
        message: {
          content:
            "Your session was just resumed by the agent-supervisor. Continue with your task.",
        },
      }),
    );
    expect(parsed.kind).toBe("skip");
    if (parsed.kind !== "skip") throw new Error("unreachable");
    expect(parsed.why).toBe("resume_injection");
  });

  it("Test R9I-5: ctrl_c_kill — double Ctrl-C (\\x03\\x03) is skipped", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-r9i-5",
        timestamp: "2026-08-29T10:00:04.000Z",
        message: {
          content: "\x03\x03",
        },
      }),
    );
    expect(parsed.kind).toBe("skip");
    if (parsed.kind !== "skip") throw new Error("unreachable");
    expect(parsed.why).toBe("ctrl_c_kill");
  });

  // Three positive-passthrough tests — verify the skips don't over-match real
  // user speech.

  it("Test R9I-6: resume sentinel quoted inside real prose (not at position 0) passes through as message", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-r9i-6",
        timestamp: "2026-08-29T10:00:05.000Z",
        message: {
          content:
            "I was reading the logs and saw 'Your session was just resumed by the agent-supervisor' in the tail — is that expected?",
        },
      }),
    );
    expect(parsed.kind).toBe("message");
    if (parsed.kind !== "message") throw new Error("unreachable");
    expect(parsed.role).toBe("user");
    expect(parsed.content).toContain("Your session was just resumed by the agent-supervisor");
  });

  it("Test R9I-7: /gsd:quick slash-command invocation passes through as message (only /id and /exit are skipped)", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-r9i-7",
        timestamp: "2026-08-29T10:00:06.000Z",
        message: {
          content:
            "<command-name>/gsd:quick</command-name>\n<command-message>gsd:quick</command-message>\n<command-args>fix the tab titles</command-args>",
        },
      }),
    );
    expect(parsed.kind).toBe("message");
    if (parsed.kind !== "message") throw new Error("unreachable");
    expect(parsed.role).toBe("user");
    expect(parsed.content).toContain("/gsd:quick");
  });

  it("Test R9I-8: legitimate user prose containing angle brackets passes through as message", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-r9i-8",
        timestamp: "2026-08-29T10:00:07.000Z",
        message: {
          content: "< 100 rows returned > and the ratio is > 0.5",
        },
      }),
    );
    expect(parsed.kind).toBe("message");
    if (parsed.kind !== "message") throw new Error("unreachable");
    expect(parsed.role).toBe("user");
    expect(parsed.content).toBe("< 100 rows returned > and the ratio is > 0.5");
  });

  // Ashley 2026-09-02: relay-hygiene closer phrase — a bare "No response
  // requested." user turn is peer-agent signaling with no conversational
  // payload. Exact trim-match mirrors goodbye_echo's closed-set posture.
  it("Test R9I-9: no_response_requested — bare 'No response requested.' user turn is skipped", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-r9i-9",
        timestamp: "2026-09-02T10:00:00.000Z",
        message: {
          content: "No response requested.",
        },
      }),
    );
    expect(parsed.kind).toBe("skip");
    if (parsed.kind !== "skip") throw new Error("unreachable");
    expect(parsed.why).toBe("no_response_requested");
  });

  it("Test R9I-9a: no_response_requested — leading/trailing whitespace tolerated (trim match)", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-r9i-9a",
        timestamp: "2026-09-02T10:00:01.000Z",
        message: {
          content: "  \n No response requested.\n  ",
        },
      }),
    );
    expect(parsed.kind).toBe("skip");
    if (parsed.kind !== "skip") throw new Error("unreachable");
    expect(parsed.why).toBe("no_response_requested");
  });

  it("Test R9I-9b: substring / suffix does NOT trigger no_response_requested — real prose passes through", () => {
    // Guard against widening this to a substring/suffix match by accident —
    // a real informational user turn that ENDS with the phrase must still
    // render (would lose its whole body otherwise).
    const parsed = parseSessionLine(
      line({
        type: "user",
        uuid: "u-r9i-9b",
        timestamp: "2026-09-02T10:00:02.000Z",
        message: {
          content: "Deployed v3.4 to prod. No response requested.",
        },
      }),
    );
    expect(parsed.kind).toBe("message");
    if (parsed.kind !== "message") throw new Error("unreachable");
    expect(parsed.role).toBe("user");
    expect(parsed.content).toContain("Deployed v3.4 to prod");
  });
});
