/**
 * Phase 05 Plan 03 Task 2: sender-side chip render tests for ChatMessage.
 *
 * When a user-role message's content is an injected user turn (produced by
 * formatInjectedUserTurn during the pretty-view upload flow), ChatMessage
 * detects the shape via parseInjectedUserTurn and renders caption text +
 * inline chip strip in the SAME bubble instead of the normal markdown
 * render.
 *
 * Non-injected messages (plain text, all assistant messages) render
 * byte-identically to pre-Plan-03 behavior.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatMessage } from "./ChatMessage";
import { formatInjectedUserTurn } from "@/api/pretty-view-upload-protocol";

const F1 = {
  filename: "screenshot.png",
  size: 20480,
  mimetype: "image/png",
  uploadTimestamp: "2026-07-20T14:32:11",
  landingPath: "/home/ash/pretty-view-uploads/2026-07-20/143211-screenshot.png",
};

const F2 = {
  filename: "logs.txt",
  size: 3072,
  mimetype: "text/plain",
  uploadTimestamp: "2026-07-20T14:32:11",
  landingPath: "/home/ash/pretty-view-uploads/2026-07-20/143211-logs.txt",
};

describe("ChatMessage — sender-side injected-turn detection (Plan 05-03)", () => {
  it("Test 9: user message with injected-turn content renders caption + inline chip strip in one bubble", () => {
    const content = formatInjectedUserTurn({
      caption: "review these",
      files: [F1, F2],
    });
    render(<ChatMessage role="user" content={content} />);

    // Caption text renders (not through markdown — direct pv-injected-caption slot).
    // Assertion is on the caption text being present in the DOM anywhere in the bubble.
    expect(screen.getByText(/review these/)).toBeTruthy();

    // Two chips render, one per file, chips-only (filename + size), no thumbnails.
    const chips = screen.getAllByTestId("attachment-chip");
    expect(chips).toHaveLength(2);

    // Chip content: filename + human-size.
    expect(screen.getByText(/screenshot\.png/)).toBeTruthy();
    expect(screen.getByText(/20\.0 KB/)).toBeTruthy();
    expect(screen.getByText(/logs\.txt/)).toBeTruthy();
    expect(screen.getByText(/3\.0 KB/)).toBeTruthy();
  });

  it("Test 10: plain user message renders as markdown WITHOUT any chip strip", () => {
    render(<ChatMessage role="user" content="just a normal message" />);
    // No chip strip anywhere in the DOM.
    expect(screen.queryByTestId("attachment-chip-strip")).toBeNull();
    expect(screen.queryAllByTestId("attachment-chip")).toHaveLength(0);
    // Normal message content still renders.
    expect(screen.getByText(/just a normal message/)).toBeTruthy();
  });

  it("Test 11: assistant message never triggers chip detection even if content coincidentally matches injected format", () => {
    // If an assistant message contained the exact injected-turn shape (very
    // unlikely — but the role gate must be defense-in-depth), it must still
    // render as normal markdown, NOT as a chip strip. Chip rendering is a
    // sender-side affordance for the user's own messages only.
    const content = formatInjectedUserTurn({
      caption: "assistant echo",
      files: [F1],
    });
    render(<ChatMessage role="assistant" content={content} />);
    // No chip strip.
    expect(screen.queryByTestId("attachment-chip-strip")).toBeNull();
    expect(screen.queryAllByTestId("attachment-chip")).toHaveLength(0);
  });

  it("Test 12: injected turn with empty caption renders only the chip strip (no caption text slot)", () => {
    const content = formatInjectedUserTurn({
      caption: "",
      files: [F1],
    });
    render(<ChatMessage role="user" content={content} />);
    // One chip renders.
    expect(screen.getAllByTestId("attachment-chip")).toHaveLength(1);
    // No caption slot present (or it's empty). Since caption is "", the
    // pv-injected-caption div MUST NOT render — a zero-height slot would
    // still add unwanted margin. Assert the class name isn't in the DOM.
    const captionSlot = document.querySelector(".pv-injected-caption");
    expect(captionSlot).toBeNull();
  });

  it("Test 13: sender-side chips have NO × remove button (readOnly render)", () => {
    const content = formatInjectedUserTurn({
      caption: "hi",
      files: [F1],
    });
    render(<ChatMessage role="user" content={content} />);
    // The already-sent injected turn must never present a remove control —
    // the batch has landed; removal would only confuse the model of "sent".
    expect(
      screen.queryByLabelText(/Remove attachment screenshot\.png/i),
    ).toBeNull();
  });

  it("Test 14: quick-reply thumbs-up render still works (non-injected user message with the quick-reply payload)", () => {
    // Regression guard: the isQuickReply branch must not be disturbed by
    // the injected-turn detection ordering.
    render(<ChatMessage role="user" content="good to go" />);
    // ThumbsUp glyph is rendered with aria-label "quick reply".
    expect(screen.getByLabelText(/quick reply/i)).toBeTruthy();
    // And no chip strip.
    expect(screen.queryByTestId("attachment-chip-strip")).toBeNull();
  });

  it("Test 14b (patch #107): quick-reply thumbs-up renders for the new 'works for me' payload", () => {
    render(<ChatMessage role="user" content="works for me" />);
    expect(screen.getByLabelText(/quick reply/i)).toBeTruthy();
  });

  it("Test 14c (patch #107): quick-reply thumbs-up still renders for legacy 'go ahead' payload", () => {
    render(<ChatMessage role="user" content="go ahead" />);
    expect(screen.getByLabelText(/quick reply/i)).toBeTruthy();
  });
});

/**
 * Quick task 260730-ujq: copy button on code blocks and blockquotes.
 *
 * Tests G, H, I verify CopyableBlock wiring in ChatMessage's ReactMarkdown
 * component overrides. Test J (regression guard) is implicit — the existing
 * suite above continues to run untouched.
 */
describe("ChatMessage — copy button on code blocks and blockquotes (quick 260730-ujq)", () => {
  it("Test G: fenced code block renders exactly one copy button", () => {
    render(
      <ChatMessage
        role="assistant"
        content={"here is code:\n\n```\nnpm test\n```\n"}
      />,
    );
    const copyBtns = screen.queryAllByTestId("copyable-block-copy");
    expect(copyBtns).toHaveLength(1);
    expect(screen.getByRole("button", { name: /copy/i })).toBeTruthy();
  });

  it("Test H: blockquote renders exactly one copy button inside a blockquote element", () => {
    render(
      <ChatMessage role="assistant" content={"quote:\n\n> hello world\n"} />,
    );
    const copyBtns = screen.queryAllByTestId("copyable-block-copy");
    expect(copyBtns).toHaveLength(1);
    // The copy button must be a descendant of a <blockquote> element.
    const bq = document.querySelector("blockquote");
    expect(bq).not.toBeNull();
    expect(bq?.querySelector("[data-testid='copyable-block-copy']")).not.toBeNull();
  });

  it("Test I: plain prose does NOT get a copy button", () => {
    render(
      <ChatMessage role="assistant" content="just a plain paragraph." />,
    );
    const copyBtns = screen.queryAllByTestId("copyable-block-copy");
    expect(copyBtns).toHaveLength(0);
  });
});
