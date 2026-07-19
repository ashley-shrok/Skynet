import { describe, it, expect } from "vitest";
import { parseSessionLine } from "./session-file-parser.js";

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
