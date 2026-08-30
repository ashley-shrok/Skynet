/**
 * Phase 17 Plan 03 — RelayOutboundBubble unit tests.
 *
 * Tests: RELAYBUB-01 (outbound bubble render matrix).
 * Updated 2026-07-28 (UAT Bug 1 fix): extractor deleted, rawCommand is always
 * the bubble body (Option D per Ashley). extractError/showSource state removed.
 * Updated 2026-08-18 (bounty pretty-view-outgoing-relay-render): body prop
 * added. Tests pass body: null to exercise the fallback (always-visible rawCommand)
 * path — preserving today's rendering behavior byte-for-byte in the null branch.
 */
import { describe, it, expect } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RelayOutboundBubble } from "./RelayOutboundBubble";

describe("RelayOutboundBubble", () => {
  it("Test 1: renders room-id header + rawCommand in mono block (body null = fallback)", () => {
    const cmd = "curl -X PUT https://matrix.org/_matrix/client/r0/rooms/!roomAlias:server.tld/send/m.room.message/txn -d '{\"body\":\"hello\"}'";
    render(
      <RelayOutboundBubble
        room="!roomAlias:server.tld"
        rawCommand={cmd}
        body={null}
      />,
    );

    // Header contains room (always visible even when collapsed)
    expect(screen.getByText(/relay send.*roomAlias/)).toBeTruthy();

    // Wrapper must be flex justify-start (left-aligned per patch #200)
    const wrapper = document.querySelector(".justify-start");
    expect(wrapper).not.toBeNull();

    // Bubble starts collapsed — expand first to see rawCommand
    fireEvent.click(screen.getByTestId("relay-outbound-header"));

    // rawCommand text is visible (fallback path — body null)
    expect(screen.getByText(cmd)).toBeTruthy();
  });

  it("Test 2: long command with newlines preserves them via whitespace-pre (body null = fallback)", () => {
    const cmd = "curl \\\n  -X PUT \\\n  https://matrix.org/rooms/!x:s/send/m.room.message/T";
    render(
      <RelayOutboundBubble
        room="!x:s"
        rawCommand={cmd}
        body={null}
      />,
    );

    // Bubble starts collapsed — expand first to see body content
    fireEvent.click(screen.getByTestId("relay-outbound-header"));

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
        body={null}
      />,
    );

    expect(screen.getByText(/unknown room/i)).toBeTruthy();
  });

  it("Test 4: very long single-line command has overflow-x-auto class on container (body null = fallback)", () => {
    const longCmd = "curl " + "x".repeat(500);
    render(
      <RelayOutboundBubble
        room="!r:s"
        rawCommand={longCmd}
        body={null}
      />,
    );

    // Bubble starts collapsed — expand first to see body content
    fireEvent.click(screen.getByTestId("relay-outbound-header"));

    // Structural assertion: overflow-x-auto must be present (layout enforcement)
    const overflowEl = document.querySelector(".overflow-x-auto");
    expect(overflowEl).not.toBeNull();
  });

  // C1-C4: Collapse-by-default tests (quick 260829-qb9)
  it("C1: renders collapsed on mount — header visible, body NOT in DOM, footer NOT in DOM", () => {
    render(
      <RelayOutboundBubble
        room="!roomAlias:server.tld"
        rawCommand="curl -X PUT ..."
        body={null}
      />,
    );

    // Header must be visible
    expect(screen.getByTestId("relay-outbound-header")).toBeTruthy();
    expect(screen.getByText(/relay send.*roomAlias/)).toBeTruthy();

    // Body content (rawCommand) must NOT be in DOM
    expect(screen.queryByText("curl -X PUT ...")).toBeNull();
    // Footer must NOT be in DOM
    expect(screen.queryByText(/via curl/)).toBeNull();
  });

  it("C2: aria-expanded='false' on outer header button when collapsed", () => {
    render(
      <RelayOutboundBubble
        room="!roomAlias:server.tld"
        rawCommand="curl -X PUT ..."
        body={null}
      />,
    );

    const header = screen.getByTestId("relay-outbound-header");
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });

  it("C3: click header → body renders, footer renders; aria-expanded='true'; inner raw toggle visible and defaults collapsed", () => {
    render(
      <RelayOutboundBubble
        room="!roomAlias:server.tld"
        rawCommand="curl -X PUT ..."
        body="Hello from relay"
      />,
    );

    fireEvent.click(screen.getByTestId("relay-outbound-header"));

    // Body text visible
    expect(screen.getByText("Hello from relay")).toBeTruthy();
    // Footer visible
    expect(screen.getByText(/via curl/)).toBeTruthy();
    // aria-expanded is true
    expect(screen.getByTestId("relay-outbound-header").getAttribute("aria-expanded")).toBe("true");
    // Inner raw command toggle visible and defaults to collapsed (▸ raw command)
    expect(screen.getByText(/▸ raw command/)).toBeTruthy();
    // Raw pre NOT visible yet
    expect(screen.queryByText("curl -X PUT ...")).toBeNull();
  });

  it("C4: inner raw toggle independent; outer re-collapse hides body and inner toggle; re-expand resets inner to collapsed", () => {
    render(
      <RelayOutboundBubble
        room="!roomAlias:server.tld"
        rawCommand="curl -X PUT ..."
        body="Hello from relay"
      />,
    );

    const outerHeader = screen.getByTestId("relay-outbound-header");

    // Expand outer
    fireEvent.click(outerHeader);
    // Expand inner raw toggle
    fireEvent.click(screen.getByText(/▸ raw command/));
    // Raw pre now visible
    expect(screen.getByText("curl -X PUT ...")).toBeTruthy();

    // Collapse outer — body AND inner toggle AND raw pre all gone
    fireEvent.click(outerHeader);
    expect(screen.queryByText("Hello from relay")).toBeNull();
    expect(screen.queryByText(/raw command/)).toBeNull();
    expect(screen.queryByText("curl -X PUT ...")).toBeNull();

    // Re-expand outer — inner state resets (fresh mount of inner button)
    fireEvent.click(outerHeader);
    // Body visible
    expect(screen.getByText("Hello from relay")).toBeTruthy();
    // Inner toggle defaults to collapsed again (▸ raw command)
    expect(screen.getByText(/▸ raw command/)).toBeTruthy();
    // Raw pre NOT visible (inner reset to collapsed)
    expect(screen.queryByText("curl -X PUT ...")).toBeNull();
  });

  // quick-260830-e6i Part B: shrink collapsed padding to match ChatMessage pill.
  it("C5: collapsed bubble uses tight padding (12/7); expanded bubble uses roomy padding (18/14)", () => {
    render(
      <RelayOutboundBubble
        room="!roomAlias:server.tld"
        rawCommand="curl -X PUT ..."
        body="Hello from relay"
      />,
    );

    const header = screen.getByTestId("relay-outbound-header");
    // No dedicated bubble testid — navigate up via header.parentElement.
    const bubble = header.parentElement as HTMLElement;
    expect(bubble).not.toBeNull();

    // Collapsed by default — tight padding.
    expect(bubble).toHaveClass("px-[12px]");
    expect(bubble).toHaveClass("py-[7px]");
    expect(bubble).not.toHaveClass("px-[18px]");
    expect(bubble).not.toHaveClass("py-[14px]");

    // Expand — roomy padding.
    fireEvent.click(header);
    expect(bubble).toHaveClass("px-[18px]");
    expect(bubble).toHaveClass("py-[14px]");
    expect(bubble).not.toHaveClass("px-[12px]");
    expect(bubble).not.toHaveClass("py-[7px]");
  });
});
