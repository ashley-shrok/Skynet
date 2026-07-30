/**
 * Phase 17 Plan 03 — RelayOutboundBubble unit tests.
 *
 * Tests: RELAYBUB-01 (outbound bubble render matrix).
 * Updated 2026-07-28 (UAT Bug 1 fix): extractor deleted, rawCommand is always
 * the bubble body (Option D per Ashley). extractError/showSource state removed.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RelayOutboundBubble } from "./RelayOutboundBubble";

describe("RelayOutboundBubble", () => {
  it("Test 1: renders room-id header + rawCommand in mono block", () => {
    const cmd = "curl -X PUT https://matrix.org/_matrix/client/r0/rooms/!roomAlias:server.tld/send/m.room.message/txn -d '{\"body\":\"hello\"}'";
    render(
      <RelayOutboundBubble
        room="!roomAlias:server.tld"
        rawCommand={cmd}
      />,
    );

    // rawCommand text is visible
    expect(screen.getByText(cmd)).toBeTruthy();

    // Header contains room
    expect(screen.getByText(/relay send.*roomAlias/)).toBeTruthy();

    // Wrapper must be flex justify-start (left-aligned per patch #200)
    const wrapper = document.querySelector(".justify-start");
    expect(wrapper).not.toBeNull();
  });

  it("Test 2: long command with newlines preserves them via whitespace-pre", () => {
    const cmd = "curl \\\n  -X PUT \\\n  https://matrix.org/rooms/!x:s/send/m.room.message/T";
    render(
      <RelayOutboundBubble
        room="!x:s"
        rawCommand={cmd}
      />,
    );

    // The pre/mono container should have whitespace-pre class
    const preEl = document.querySelector(".whitespace-pre");
    expect(preEl).not.toBeNull();

    // The command text is rendered — use custom matcher because getByText normalises whitespace
    // but our pre element preserves the raw string including \n characters.
    const preWithCmd = screen.getByText((_content, el) => {
      return el?.tagName === "PRE" && el.textContent === cmd;
    });
    expect(preWithCmd).toBeTruthy();
  });

  it("Test 3: room null → header shows '→ unknown room'", () => {
    render(
      <RelayOutboundBubble
        room={null}
        rawCommand="curl -X PUT ..."
      />,
    );

    expect(screen.getByText(/unknown room/i)).toBeTruthy();
  });

  it("Test 4: very long single-line command has overflow-x-auto class on container", () => {
    const longCmd = "curl " + "x".repeat(500);
    render(
      <RelayOutboundBubble
        room="!r:s"
        rawCommand={longCmd}
      />,
    );

    // Structural assertion: overflow-x-auto must be present (layout enforcement)
    const overflowEl = document.querySelector(".overflow-x-auto");
    expect(overflowEl).not.toBeNull();
  });
});
