/**
 * Phase 17 Plan 03 — RelayOutboundBubble unit tests.
 *
 * Tests: RELAYBUB-01 (outbound bubble render matrix).
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RelayOutboundBubble } from "./RelayOutboundBubble";

describe("RelayOutboundBubble", () => {
  it("Test 1: happy path with body populated → renders body text, no ⚠, correct justify-end wrapper", () => {
    render(
      <RelayOutboundBubble
        room="!roomAlias:server.tld"
        body="Hey @ashley, the deploy is green."
        extractError={null}
        rawCommand="curl -X PUT ..."
      />,
    );

    // Body text is visible
    expect(screen.getByText(/Hey @ashley, the deploy is green/)).toBeTruthy();

    // No warning line
    expect(screen.queryByText(/extraction failed/i)).toBeNull();

    // Wrapper must be flex justify-end (right-aligned)
    const wrapper = document.querySelector(".justify-end");
    expect(wrapper).not.toBeNull();
  });

  it("Test 2: extractError populated + body null → renders ⚠ line + show source button; clicking button reveals rawCommand", () => {
    const raw = "curl -X PUT https://matrix.example.com/rooms/!x:s/send/m.room.message/txid --data \"$body\"";
    render(
      <RelayOutboundBubble
        room="!roomAlias:server.tld"
        body={null}
        extractError="shell variable interpolation"
        rawCommand={raw}
      />,
    );

    // Warning line is rendered
    expect(screen.getByText(/extraction failed/i)).toBeTruthy();
    expect(screen.getByText(/shell variable interpolation/i)).toBeTruthy();

    // Raw command is NOT visible initially (collapsed)
    expect(screen.queryByText(raw)).toBeNull();

    // Click "show source" to expand
    const btn = screen.getByRole("button", { name: /show source/i });
    expect(btn).toBeTruthy();
    fireEvent.click(btn);

    // Raw command is now visible
    expect(screen.getByText(raw)).toBeTruthy();

    // Button text flips to "hide source"
    expect(screen.getByRole("button", { name: /hide source/i })).toBeTruthy();
  });

  it("Test 3: room null → header shows '→ unknown room'", () => {
    render(
      <RelayOutboundBubble
        room={null}
        body="hello"
        extractError={null}
        rawCommand=""
      />,
    );

    expect(screen.getByText(/unknown room/i)).toBeTruthy();
  });
});
