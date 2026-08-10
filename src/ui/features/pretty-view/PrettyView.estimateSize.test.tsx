/**
 * Unit tests for estimatePvBubbleSize — the type-aware estimateSize helper
 * introduced in quick task 260810-ia4 (Fix 1).
 *
 * Tests the pure function in isolation — does NOT mount PrettyView, does NOT
 * use @testing-library, does NOT render any DOM.
 */

import { describe, it, expect } from "vitest";
import { estimatePvBubbleSize } from "./PrettyView";
import type {
  MessageEvent as ChatMessageEvent,
  ImageEvent,
  RelayOutboundEvent,
  RelayInboundEvent,
  MalformedLineEvent,
} from "@/api/claude-session-api";

// ── Helpers to build minimal StreamEvent literals ─────────────────────────

function makeImage(): ImageEvent {
  return {
    type: "image",
    role: "assistant",
    images: [{ data: "abc", mediaType: "image/png" }],
    text: "",
    eventId: "img-1",
    ts: 1_000_000,
  };
}

function makeChatMessage(content: string): ChatMessageEvent {
  return {
    type: "message",
    role: "assistant",
    content,
    eventId: "msg-1",
    ts: 1_000_000,
  };
}

function makeRelayOutbound(rawCommand: string): RelayOutboundEvent {
  return {
    type: "relay_outbound",
    room: "test-room",
    rawCommand,
    eventId: "ro-1",
    ts: 1_000_000,
  };
}

function makeRelayInbound(body: string): RelayInboundEvent {
  return {
    type: "relay_inbound",
    room: "test-room",
    sender: "@user:matrix.org",
    matrixEventId: "$mat-1",
    body,
    raw: body,
    eventId: "ri-1",
    ts: 1_000_000,
  };
}

function makeMalformed(): MalformedLineEvent {
  return {
    type: "malformed_line",
    bytes: 512,
    eventId: "mal-1",
    ts: 1_000_000,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("estimatePvBubbleSize — quick 260810-ia4 Fix 1", () => {
  it("image event returns 400", () => {
    expect(estimatePvBubbleSize(makeImage())).toBe(400);
  });

  it("short text (~20 chars, no newlines, no fences) returns 80 (clamped by Math.max floor)", () => {
    // 20 chars * 0.4 = 8 → Math.max(80, 8) = 80
    const msg = makeChatMessage("Hello, this is short!");
    expect(estimatePvBubbleSize(msg)).toBe(80);
  });

  it("long text (~600 chars, no fences) returns 240 (bounded by textLength * 0.4, still under 400 cap)", () => {
    // 600 chars * 0.4 = 240 → Math.max(80, Math.min(400, 240)) = 240
    const content = "a".repeat(600);
    const msg = makeChatMessage(content);
    expect(estimatePvBubbleSize(msg)).toBe(240);
  });

  it("text with a fenced code block spanning 10 newlines returns Math.max(120, 11 * 22 + 40) = 282", () => {
    // 10 newlines → lineCount = 10 + 1 = 11; 11 * 22 + 40 = 282; Math.max(120, 282) = 282
    // String: "```\n" (1 newline) + "line\n".repeat(9) (9 newlines) + "end```" (0 newlines) = 10 total
    const codeContent = "```\n" + "line\n".repeat(9) + "end```";
    const msg = makeChatMessage(codeContent);
    expect(estimatePvBubbleSize(msg)).toBe(282);
  });

  it("very long text (~2000 chars, no fences) clamps at 400 (Math.min upper bound)", () => {
    // 2000 chars * 0.4 = 800 → Math.max(80, Math.min(400, 800)) = 400
    const content = "b".repeat(2000);
    const msg = makeChatMessage(content);
    expect(estimatePvBubbleSize(msg)).toBe(400);
  });

  it("distinct-value sanity: image estimate, short-text estimate, and code-block estimate are all different from each other", () => {
    const imageEst = estimatePvBubbleSize(makeImage());
    const shortEst = estimatePvBubbleSize(makeChatMessage("Hello, this is short!"));
    const codeEst = estimatePvBubbleSize(
      makeChatMessage("```\n" + "line\n".repeat(9) + "end```"),
    );
    // All three must be distinct — proves estimatePvBubbleSize discriminates by shape
    expect(imageEst).not.toBe(shortEst);
    expect(imageEst).not.toBe(codeEst);
    expect(shortEst).not.toBe(codeEst);
  });

  it("RelayOutbound uses rawCommand text for estimation", () => {
    // rawCommand 600 chars → 240 estimate (no fences)
    const relayOut = makeRelayOutbound("x".repeat(600));
    expect(estimatePvBubbleSize(relayOut)).toBe(240);
  });

  it("RelayInbound uses body text for estimation", () => {
    // body 600 chars → 240 estimate (no fences)
    const relayIn = makeRelayInbound("y".repeat(600));
    expect(estimatePvBubbleSize(relayIn)).toBe(240);
  });

  it("MalformedLine falls back to empty string and returns 80", () => {
    // No text field → empty string → textLength 0 → Math.max(80, Math.min(400, 0)) = 80
    const mal = makeMalformed();
    expect(estimatePvBubbleSize(mal)).toBe(80);
  });
});
