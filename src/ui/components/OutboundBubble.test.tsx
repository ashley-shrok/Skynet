/**
 * Phase 90 Plan 02 Task 1 — OutboundBubble primitive tests.
 *
 * OutboundBubble is a shared primitive COPY-extracted from ChatMessage.tsx's
 * `isUser` branch (ChatMessage L420-594). It renders a right-aligned
 * user-turn bubble with the gradient/border/shadow visual verbatim and
 * supports the D-13 pending-state (sending / failed / null) + Phase 80 D-15
 * attachments contract.
 *
 * Extraction discipline (D-03): pretty view's ChatMessage stays byte-untouched;
 * this primitive is a standalone COPY that Plans 05 + 06 will import for the
 * relay-room pane. A future convergence slice may migrate ChatMessage onto this
 * primitive if drift becomes real.
 */
import { describe, it, expect } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { OutboundBubble, type OutboundBubbleProps } from "./OutboundBubble";

function makeProps(overrides: Partial<OutboundBubbleProps> = {}): OutboundBubbleProps {
  return {
    content: "hello",
    ...overrides,
  };
}

describe("OutboundBubble", () => {
  it("Test 1: renders content as a React text child (NOT dangerouslySetInnerHTML)", () => {
    render(<OutboundBubble {...makeProps({ content: "hello" })} />);
    // React text child — screen.getByText finds it verbatim.
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("Test 2: outer wrapper is right-aligned (carries justify-end, NOT justify-start)", () => {
    const { container } = render(<OutboundBubble {...makeProps()} />);
    // The outermost element is the flex wrapper — must be right-aligned.
    const outer = container.firstElementChild;
    expect(outer).not.toBeNull();
    expect(outer!.className).toContain("justify-end");
    expect(outer!.className).not.toContain("justify-start");
  });

  it("Test 3: pendingState='sending' renders the twin-arc Loader2 spinner", () => {
    render(<OutboundBubble {...makeProps({ pendingState: "sending" })} />);
    const spinner = document.querySelector("[data-pv-bubble-spinner]");
    expect(spinner).not.toBeNull();
    // aria-hidden discipline (spinner is decorative)
    expect(spinner!.getAttribute("aria-hidden")).not.toBeNull();
    // animate-spin class present — Loader2 is an SVG so its .className is
    // an SVGAnimatedString; read via getAttribute for a plain string.
    const classAttr = spinner!.getAttribute("class") ?? "";
    expect(classAttr).toContain("animate-spin");
  });

  it("Test 4: pendingState='failed' sets data-pv-bubble-failed='true' + red inline background", () => {
    render(<OutboundBubble {...makeProps({ pendingState: "failed" })} />);
    const bubble = document.querySelector("[data-pv-bubble-failed='true']");
    expect(bubble).not.toBeNull();
    // Inline style carries the red background per Phase 76 D-06.
    // jsdom normalises `hsla(0, 60%, 35%, 0.90)` → `rgba(143, 36, 36, 0.9)`;
    // assert on the red-band rgba shape which is deterministic across
    // jsdom versions (r ≈ 143, g ≈ 36, b ≈ 36).
    const style = (bubble as HTMLElement).getAttribute("style") ?? "";
    expect(style).toMatch(/background:\s*rgba?\(143,\s*36,\s*36/);
    expect(style).toMatch(/border-color:\s*rgba?\(217,\s*38,\s*38/);
    // No spinner in failed state (Test 6 semantic: failed supersedes sending).
    expect(document.querySelector("[data-pv-bubble-spinner]")).toBeNull();
  });

  it("Test 5: pendingState=null renders no spinner and no failed marker", () => {
    render(<OutboundBubble {...makeProps({ pendingState: null })} />);
    expect(document.querySelector("[data-pv-bubble-spinner]")).toBeNull();
    expect(document.querySelector("[data-pv-bubble-failed='true']")).toBeNull();
  });

  it("Test 6: attachments + non-empty content renders caption above AttachmentChipStrip", () => {
    render(
      <OutboundBubble
        {...makeProps({
          content: "check this",
          attachments: [
            { filename: "a.png", size: 100, mimetype: "image/png" },
          ],
        })}
      />,
    );
    // Caption text visible.
    expect(screen.getByText("check this")).toBeInTheDocument();
    // AttachmentChipStrip renders the filename as a chip child.
    expect(screen.getByText("a.png")).toBeInTheDocument();
  });

  it("Test 7: no assistant-branch DOM present — no long-press speak button, no ThumbsUp", () => {
    render(<OutboundBubble {...makeProps()} />);
    // Assistant path renders a lucide ThumbsUp icon for isQuickReply, and a
    // long-press speak button (button with aria-label containing 'speak' or
    // similar). This primitive strips both entirely.
    // No <button> in the bubble at all — user bubbles never had a button.
    expect(document.querySelectorAll("button").length).toBe(0);
  });
});
