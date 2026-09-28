/**
 * ChatMessage wiring tests for WidgetBubble + file-chip dispatch.
 *
 * Tests exercise the URL dispatch in the `a` markdown override:
 *   - Skynet file URL → FileChip (shape 2026-09-28)
 *   - 'interactive-message' URL → WidgetBubble iframe (NOT anchor)
 *   - anything else → plain anchor with target=_blank rel=noopener noreferrer
 *
 * Mock strategy:
 *   - vi.mock("./use-editable-file-eligibility") — controllable per-test via
 *     mockReturnValue, returning Map<string, "file" | "interactive-message">.
 *     Only the "interactive-message" mapping matters now — file dispatch is a
 *     synchronous URL-shape check inside ChatMessage's a-override.
 *   - Do NOT mock FileChip or WidgetBubble — real components used for wiring test
 *   - vi.mock voice-api and webAudioStreamPlayer (standard ChatMessage deps)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatMessage } from "./ChatMessage";
import { useEditableFileEligibility } from "./use-editable-file-eligibility";

// Standard ChatMessage audio mocks
vi.mock("@/api/voice-api", () => ({
  postSpeakStream: vi.fn(),
  postSpeak: vi.fn(),
  SAMPLE_PHRASE: "Hi, this is your voice.",
}));

vi.mock("./webAudioStreamPlayer", () => ({
  createWebAudioStreamPlayer: vi.fn(() => ({
    play: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  })),
}));

// Mock the hook to return a controlled Map
vi.mock("./use-editable-file-eligibility", () => ({
  useEditableFileEligibility: vi.fn(() => new Map()),
}));

const mockedHook = vi.mocked(useEditableFileEligibility);

const WIDGET_URL = "https://term.example.com/interactive/3/poll-abc/pane/";
// Skynet /file/<host>/<abs-path> — the pattern that renders as FileChip.
const FILE_URL = "https://term.example.com/file/t1000/home/ubuntu/notes.md";
const PLAIN_URL = "https://example.com/some-page";

beforeEach(() => {
  vi.clearAllMocks();
  mockedHook.mockReturnValue(new Map());
});

describe("ChatMessage — WidgetBubble URL-type dispatch (Phase 137 Plan 04)", () => {
  it("Test 1: widget URL in body renders WidgetBubble (iframe with title 'Interactive widget'), NOT an anchor", () => {
    mockedHook.mockReturnValue(
      new Map([[WIDGET_URL, "interactive-message"]]),
    );

    render(
      <ChatMessage
        role="assistant"
        eventId="e1"
        content={`Check out this poll: [widget](${WIDGET_URL})`}
        onOpenEditor={vi.fn()}
      />,
    );

    // Should render the iframe with our title
    const iframe = screen.queryByTitle("Interactive widget");
    expect(iframe).not.toBeNull();
    expect(iframe!.tagName).toBe("IFRAME");
    expect(iframe!.getAttribute("src")).toBe(WIDGET_URL);

    // Should NOT render as an anchor link
    const link = screen.queryByRole("link", { name: /widget/i });
    expect(link).toBeNull();
  });

  it("Test 2: Skynet file URL in body renders a FileChip anchor (no pencil affordance, no iframe)", () => {
    // Hook's file mapping is unused now (chip renders based on URL shape),
    // but we leave it empty to make that decoupling explicit.
    mockedHook.mockReturnValue(new Map());

    render(
      <ChatMessage
        role="assistant"
        eventId="e2"
        content={`See [notes.md](${FILE_URL})`}
        onOpenEditor={vi.fn()}
      />,
    );

    // FileChip renders as an anchor with the file URL and the filename
    // (underlined per the shape's affordance treatment). Both the plain
    // and media variants of FileChip surface the filename as the anchor
    // label; querying by name matches either.
    const chipAnchor = screen.getByRole("link", { name: /notes\.md/i });
    expect(chipAnchor.getAttribute("href")).toBe(FILE_URL);

    // The pencil affordance is gone — the chip is the entry point.
    expect(screen.queryByRole("button", { name: /edit notes\.md/i })).toBeNull();

    // No widget iframe
    expect(screen.queryByTitle("Interactive widget")).toBeNull();
  });

  it("Test 3: body with BOTH widget URL and file URL renders BOTH (iframe + FileChip)", () => {
    mockedHook.mockReturnValue(
      new Map([[WIDGET_URL, "interactive-message"]]),
    );

    render(
      <ChatMessage
        role="assistant"
        eventId="e3"
        content={`Poll: [widget](${WIDGET_URL}) and file: [notes.md](${FILE_URL})`}
        onOpenEditor={vi.fn()}
      />,
    );

    // Widget renders as iframe
    expect(screen.queryByTitle("Interactive widget")).not.toBeNull();

    // File URL renders as a FileChip anchor pointing at the file URL.
    // The pencil affordance no longer exists — the chip is the entry point.
    const chipAnchor = screen.getByRole("link", { name: /notes\.md/i });
    expect(chipAnchor.getAttribute("href")).toBe(FILE_URL);
    expect(screen.queryByRole("button", { name: /edit notes\.md/i })).toBeNull();
  });

  it("Test 4: plain URL (neither widget nor file) renders as plain anchor with target=_blank rel=noopener noreferrer", () => {
    // Hook returns empty map (no eligible URLs)
    mockedHook.mockReturnValue(new Map());

    render(
      <ChatMessage
        role="assistant"
        eventId="e4"
        content={`Visit [example](${PLAIN_URL})`}
        onOpenEditor={vi.fn()}
      />,
    );

    const anchor = screen.getByRole("link", { name: /example/i });
    expect(anchor.getAttribute("target")).toBe("_blank");
    expect(anchor.getAttribute("rel")).toBe("noopener noreferrer");
    expect(anchor.getAttribute("href")).toBe(PLAIN_URL);

    // No iframe
    expect(screen.queryByTitle("Interactive widget")).toBeNull();
    // No edit affordance (the pencil is gone entirely under the new shape)
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
  });

  it("Test 5: onWidgetSubmit prop is threaded to WidgetBubble — when WidgetBubble fires onSubmit, onWidgetSubmit is called", () => {
    mockedHook.mockReturnValue(
      new Map([[WIDGET_URL, "interactive-message"]]),
    );

    const onWidgetSubmit = vi.fn();

    render(
      <ChatMessage
        role="assistant"
        eventId="e5"
        content={`[poll](${WIDGET_URL})`}
        onWidgetSubmit={onWidgetSubmit}
      />,
    );

    const iframe = screen.getByTitle("Interactive widget") as HTMLIFrameElement;

    // Simulate a postMessage from the iframe
    const fakeContentWindow = {} as Window;
    Object.defineProperty(iframe, "contentWindow", {
      value: fakeContentWindow,
      configurable: true,
    });

    const msg = new MessageEvent("message", {
      data: { type: "widget-submit", widgetId: "poll-abc", value: "optA" },
      origin: window.location.origin,
      source: fakeContentWindow,
    });
    window.dispatchEvent(msg);

    expect(onWidgetSubmit).toHaveBeenCalledWith("poll-abc", "optA");
  });

  it("Test 6: markdownComponents useMemo deps include onWidgetSubmit — changing the prop recomputes", () => {
    mockedHook.mockReturnValue(
      new Map([[WIDGET_URL, "interactive-message"]]),
    );

    const onWidgetSubmit1 = vi.fn();
    const onWidgetSubmit2 = vi.fn();

    const { rerender } = render(
      <ChatMessage
        role="assistant"
        eventId="e6"
        content={`[poll](${WIDGET_URL})`}
        onWidgetSubmit={onWidgetSubmit1}
      />,
    );

    // Re-render with a different onWidgetSubmit — the iframe should now call the new one
    rerender(
      <ChatMessage
        role="assistant"
        eventId="e6"
        content={`[poll](${WIDGET_URL})`}
        onWidgetSubmit={onWidgetSubmit2}
      />,
    );

    const iframe = screen.getByTitle("Interactive widget") as HTMLIFrameElement;
    const fakeContentWindow = {} as Window;
    Object.defineProperty(iframe, "contentWindow", {
      value: fakeContentWindow,
      configurable: true,
    });

    const msg = new MessageEvent("message", {
      data: { type: "widget-submit", widgetId: "poll-abc", value: "optB" },
      origin: window.location.origin,
      source: fakeContentWindow,
    });
    window.dispatchEvent(msg);

    // onWidgetSubmit2 called (latest callback wired)
    expect(onWidgetSubmit2).toHaveBeenCalledWith("poll-abc", "optB");
    // onWidgetSubmit1 NOT called (stale closure rejected)
    expect(onWidgetSubmit1).not.toHaveBeenCalled();
  });
});
