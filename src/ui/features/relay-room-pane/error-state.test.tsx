/**
 * Phase 90 Plan 05 Task 1 — RelayRoomErrorState tests (D-18).
 *
 * Friendly error state for the relay-room pane: rendered when the pane opens
 * against a room that is no longer available (403/404 from Plan 04 REST
 * participants endpoint OR an `inactive` WS frame). D-18 explicit:
 *   - Copy: "This conversation is no longer available."
 *   - Optional subline (e.g. "You may have been removed from this room.").
 *   - NO retry button (there is nothing to retry — the row filters itself
 *     out on the next observation-loop tick).
 *   - React text children only — T-17-03-01 discipline preserved.
 */
import { describe, it, expect } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { RelayRoomErrorState } from "./error-state";

describe("RelayRoomErrorState (Phase 90 Plan 05 Task 1)", () => {
  it("Test 5: renders the default D-18 copy as visible text", () => {
    render(<RelayRoomErrorState />);
    expect(
      screen.getByText("This conversation is no longer available."),
    ).toBeInTheDocument();
  });

  it("Test 6: does NOT render a retry button (D-18 recommendation — nothing to retry)", () => {
    const { container } = render(<RelayRoomErrorState />);
    // No buttons rendered at all.
    expect(container.querySelectorAll("button").length).toBe(0);
    // No role="button" either (defensive against future non-<button> UI).
    expect(container.querySelectorAll('[role="button"]').length).toBe(0);
  });

  it("Test 7: renders the optional subline when provided", () => {
    render(
      <RelayRoomErrorState subline="You may have been removed from this room." />,
    );
    expect(
      screen.getByText("You may have been removed from this room."),
    ).toBeInTheDocument();
  });

  it("Test 7b: default render omits the subline element entirely", () => {
    const { container } = render(<RelayRoomErrorState />);
    // Only the title text should be present in the card body.
    expect(
      container.querySelector('[data-testid="relay-room-error-subline"]'),
    ).toBeNull();
  });

  it("Test 7c: custom title overrides the default", () => {
    render(<RelayRoomErrorState title="Session expired" />);
    expect(screen.getByText("Session expired")).toBeInTheDocument();
    expect(
      screen.queryByText("This conversation is no longer available."),
    ).not.toBeInTheDocument();
  });

  it("Test 8: body content rendered via React text children — no dangerouslySetInnerHTML", () => {
    // Render with title that includes characters that would be interpreted as HTML
    // if we were using dangerouslySetInnerHTML.
    render(
      <RelayRoomErrorState
        title="<script>alert('xss')</script>"
        subline="<b>bold</b>"
      />,
    );
    // The raw text must appear verbatim (React text child renders it as text,
    // not as HTML). If dangerouslySetInnerHTML were used, these would render
    // as HTML tags and screen.getByText would not find them.
    expect(
      screen.getByText("<script>alert('xss')</script>"),
    ).toBeInTheDocument();
    expect(screen.getByText("<b>bold</b>")).toBeInTheDocument();
  });
});
