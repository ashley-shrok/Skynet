/**
 * Phase 137 Plan 04 Task 3 — ChatMessage wiring tests for WidgetBubble.
 *
 * Tests exercise the URL-type dispatch in the `a` markdown override:
 *   - 'interactive-message' → WidgetBubble iframe (NOT anchor)
 *   - 'file' → anchor + EditableFileAffordance (existing behavior preserved)
 *   - null/plain URL → plain anchor with target=_blank rel=noopener noreferrer
 *
 * Mock strategy:
 *   - vi.mock("./use-editable-file-eligibility") — controllable per-test via
 *     mockReturnValue, returning Map<string, "file" | "interactive-message">
 *   - vi.mock("./WidgetBubble") — lightweight mock to detect render and capture props
 *   - Do NOT mock EditableFileAffordance — real component used for wiring test
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
const FILE_URL = "http://100.64.0.1:8000/notes.md";
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

  it("Test 2: file URL in body still renders anchor + EditableFileAffordance (existing behavior preserved)", () => {
    mockedHook.mockReturnValue(
      new Map([[FILE_URL, "file"]]),
    );

    render(
      <ChatMessage
        role="assistant"
        eventId="e2"
        content={`See [notes.md](${FILE_URL})`}
        onOpenEditor={vi.fn()}
      />,
    );

    // Anchor renders
    const anchor = screen.getByRole("link", { name: /notes\.md/i });
    expect(anchor).toBeTruthy();
    expect(anchor.getAttribute("href")).toBe(FILE_URL);

    // Edit affordance renders (file type → EditableFileAffordance)
    const editBtn = screen.queryByRole("button", { name: /edit notes\.md/i });
    expect(editBtn).not.toBeNull();

    // No iframe rendered
    expect(screen.queryByTitle("Interactive widget")).toBeNull();
  });

  it("Test 3: body with BOTH widget URL and file URL renders BOTH (iframe + anchor-with-affordance)", () => {
    mockedHook.mockReturnValue(
      new Map([
        [WIDGET_URL, "interactive-message"],
        [FILE_URL, "file"],
      ]),
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

    // File renders as anchor + affordance
    expect(screen.getByRole("link", { name: /notes\.md/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /edit notes\.md/i })).not.toBeNull();
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
    // No edit affordance
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
