/**
 * Phase 93 Slice 3 — ChatSurfaceErrorState tests (ported from Slice D's
 * error-state.test.tsx per D-10). Byte-preserved assertion set; only the
 * import path, component name, and testid values updated.
 *
 * Friendly error state (D-18/D-20). Rendered when the pane opens against a
 * room that is no longer available (403/404 from Plan 04 REST participants
 * endpoint OR an `inactive` WS frame). D-18 explicit:
 *   - Copy: "This conversation is no longer available."
 *   - Optional subline (e.g. "You may have been removed from this room.").
 *   - NO retry button (there is nothing to retry — the row filters itself
 *     out on the next observation-loop tick).
 *   - React text children only — T-17-03-01 discipline preserved.
 */
import { describe, it, expect } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { ChatSurfaceErrorState } from "./ChatSurfaceErrorState";

describe("ChatSurfaceErrorState (Phase 93 Slice 3)", () => {
  it("Test 5: renders the default D-18 copy as visible text", () => {
    render(<ChatSurfaceErrorState />);
    expect(
      screen.getByText("This conversation is no longer available."),
    ).toBeInTheDocument();
  });

  it("Test 6: does NOT render a retry button (D-18 recommendation — nothing to retry)", () => {
    const { container } = render(<ChatSurfaceErrorState />);
    // No buttons rendered at all.
    expect(container.querySelectorAll("button").length).toBe(0);
    // No role="button" either (defensive against future non-<button> UI).
    expect(container.querySelectorAll('[role="button"]').length).toBe(0);
  });

  it("Test 7: renders the optional subline when provided", () => {
    render(
      <ChatSurfaceErrorState subline="You may have been removed from this room." />,
    );
    expect(
      screen.getByText("You may have been removed from this room."),
    ).toBeInTheDocument();
  });

  it("Test 7b: default render omits the subline element entirely", () => {
    const { container } = render(<ChatSurfaceErrorState />);
    // Only the title text should be present in the card body.
    expect(
      container.querySelector('[data-testid="chat-surface-error-subline"]'),
    ).toBeNull();
  });

  it("Test 7c: custom title overrides the default", () => {
    render(<ChatSurfaceErrorState title="Session expired" />);
    expect(screen.getByText("Session expired")).toBeInTheDocument();
    expect(
      screen.queryByText("This conversation is no longer available."),
    ).not.toBeInTheDocument();
  });

  it("Test 8: body content rendered via React text children — no dangerouslySetInnerHTML", () => {
    // Render with title that includes characters that would be interpreted as HTML
    // if we were using dangerouslySetInnerHTML.
    render(
      <ChatSurfaceErrorState
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

  it("Test 8b (Slice 6 reshape): renders as an overlay — scrim with absolute inset-0 + z-[99] + backdrop-blur, matching PrettyViewErrorOverlay pattern", () => {
    const { container } = render(<ChatSurfaceErrorState />);
    const scrim = container.querySelector('[data-testid="chat-surface-error-state"]');
    expect(scrim).not.toBeNull();
    // Same scrim tokens as PrettyViewErrorOverlay + SessionHoldingOverlay
    // (post-close reshape ask 2026-09-09: match existing overlay pattern
    // rather than in-flow flex-1 replacement of the message list).
    expect(scrim!.className).toContain("absolute");
    expect(scrim!.className).toContain("inset-0");
    expect(scrim!.className).toContain("z-[99]");
    expect(scrim!.className).toContain("backdrop-blur-md");
    expect(scrim!.className).toContain("bg-black/40");
    // iOS Safari backdrop-filter hardening — patch #333 lesson, non-negotiable
    // for any backdrop-filter surface in this fork.
    expect(scrim!.className).toContain("isolate");
    expect(scrim!.className).toContain("[transform:translateZ(0)]");
    // Scrim blocks clicks / typing on what it covers.
    expect(scrim!.className).toContain("pointer-events-auto");
  });

  it("Test 8c (Slice 6 reshape): renders the static warm-red glyph (motion-channel guardrail — no spinner)", () => {
    const { container } = render(<ChatSurfaceErrorState />);
    // Sibling overlays (PrettyViewErrorOverlay + SessionHoldingOverlay error
    // variant) both use a static RefreshCcw with warm-red hue; motion-channel
    // guardrail: NO spin-animation class here. Guarding against a future
    // refactor that adds `animate-spin` (would blur the semantic between
    // "something is happening" and "state").
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
    expect(svg!.className.baseVal).toContain("text-[hsl(0,72%,60%)]");
    expect(svg!.className.baseVal).not.toContain("animate-spin");
  });

  it("Test 10 (D-20 existence-oracle discipline): renders same title regardless of underlying reason", () => {
    // The D-20 discipline: no per-status branching. If a caller passes no
    // custom title, the default copy fires regardless of whether the source
    // error is "room-not-found", "auth-expired", "protocol", or any other
    // reason — no existence oracle.
    const { rerender } = render(<ChatSurfaceErrorState />);
    expect(
      screen.getByText("This conversation is no longer available."),
    ).toBeInTheDocument();
    // Rerender — copy stays identical.
    rerender(<ChatSurfaceErrorState />);
    expect(
      screen.getByText("This conversation is no longer available."),
    ).toBeInTheDocument();
  });
});
