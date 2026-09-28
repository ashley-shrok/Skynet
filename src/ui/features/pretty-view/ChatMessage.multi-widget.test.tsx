/**
 * Phase 139 Plan 08 — ChatMessage multi-widget rendering tests.
 *
 * Verifies that a single agent message containing multiple interactive-message
 * URLs renders one <iframe> per URL, with distinct src attrs, and that
 * onWidgetSubmit dispatch is routed to the correct per-mount callback without
 * cross-widget contamination.
 *
 * Mock strategy: identical to ChatMessage.WidgetBubble.test.tsx (Phase 137
 * Plan 04 Task 3) — vi.mock use-editable-file-eligibility, vi.mock voice-api,
 * vi.mock webAudioStreamPlayer. WidgetBubble is NOT mocked — we exercise the
 * real component so the source-guard in WidgetBubble.tsx (Guard 1:
 * e.source !== iframeRef.current?.contentWindow) is exercised with meaningful
 * per-iframe contentWindow identity checks.
 *
 * Test coverage (5 tests):
 *   1. Two widget URLs → two iframes with distinct src attrs (multi-widget)
 *   2. Three widget URLs → three iframes, each src correct per-index
 *   3. Mixed content (widget + file + widget) → 2 iframes + 1 anchor with Edit
 *   4. onWidgetSubmit routed to right mount (per-widget dispatch)
 *   5. Cross-source message does NOT reach any onSubmit (source-guard on N mounts)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { ChatMessage } from "./ChatMessage";
import { useEditableFileEligibility } from "./use-editable-file-eligibility";

// Standard ChatMessage audio mocks (same as ChatMessage.WidgetBubble.test.tsx)
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

const WIDGET_URL_1 = "https://term.example.com/interactive/3/poll-abc/pane/";
const WIDGET_URL_2 = "https://term.example.com/interactive/3/color-xyz/pane/";
const WIDGET_URL_3 = "https://term.example.com/interactive/3/rating-def/pane/";
const FILE_URL = "http://100.64.0.1:8000/notes.md";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mockedHook.mockReturnValue(new Map());
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  cleanup();
});

describe("ChatMessage — multi-widget rendering (Phase 139 Plan 08)", () => {
  it("Test 1: two widget URLs in one message render two iframes with distinct src attrs (multi-widget)", () => {
    mockedHook.mockReturnValue(
      new Map([
        [WIDGET_URL_1, "interactive-message"],
        [WIDGET_URL_2, "interactive-message"],
      ]),
    );

    render(
      <ChatMessage
        role="assistant"
        eventId="e1"
        content={`First widget: [poll](${WIDGET_URL_1}) and second: [color](${WIDGET_URL_2})`}
        onOpenEditor={vi.fn()}
      />,
    );

    const iframes = screen.getAllByTitle("Interactive widget");
    expect(iframes).toHaveLength(2);

    const srcs = iframes.map((el) => el.getAttribute("src"));
    expect(srcs).toContain(WIDGET_URL_1);
    expect(srcs).toContain(WIDGET_URL_2);
    expect(srcs[0]).not.toBe(srcs[1]);

    iframes.forEach((el) => expect(el.tagName).toBe("IFRAME"));

    // No anchor links rendered for widget URLs
    expect(screen.queryByRole("link", { name: /poll/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /color/i })).toBeNull();
  });

  it("Test 2: three widget URLs in one message render three iframes, each with correct src", () => {
    mockedHook.mockReturnValue(
      new Map([
        [WIDGET_URL_1, "interactive-message"],
        [WIDGET_URL_2, "interactive-message"],
        [WIDGET_URL_3, "interactive-message"],
      ]),
    );

    render(
      <ChatMessage
        role="assistant"
        eventId="e2"
        content={`Widget A: [poll](${WIDGET_URL_1}), Widget B: [color](${WIDGET_URL_2}), Widget C: [rating](${WIDGET_URL_3})`}
        onOpenEditor={vi.fn()}
      />,
    );

    const iframes = screen.getAllByTitle("Interactive widget");
    expect(iframes).toHaveLength(3);

    const srcs = iframes.map((el) => el.getAttribute("src"));
    expect(srcs).toContain(WIDGET_URL_1);
    expect(srcs).toContain(WIDGET_URL_2);
    expect(srcs).toContain(WIDGET_URL_3);

    // All three are distinct
    expect(new Set(srcs).size).toBe(3);

    iframes.forEach((el) => expect(el.tagName).toBe("IFRAME"));
  });

  it("Test 3: mixed content (widget URL + file URL + widget URL) renders 2 iframes + 1 anchor with Edit affordance", () => {
    mockedHook.mockReturnValue(
      new Map([
        [WIDGET_URL_1, "interactive-message"],
        [FILE_URL, "file"],
        [WIDGET_URL_2, "interactive-message"],
      ]),
    );

    render(
      <ChatMessage
        role="assistant"
        eventId="e3"
        content={`Poll: [poll](${WIDGET_URL_1}), File: [notes.md](${FILE_URL}), Color: [color](${WIDGET_URL_2})`}
        onOpenEditor={vi.fn()}
      />,
    );

    // Two iframes for the two widget URLs
    const iframes = screen.getAllByTitle("Interactive widget");
    expect(iframes).toHaveLength(2);

    const srcs = iframes.map((el) => el.getAttribute("src"));
    expect(srcs).toContain(WIDGET_URL_1);
    expect(srcs).toContain(WIDGET_URL_2);

    // One anchor for the file URL
    const anchor = screen.getByRole("link", { name: /notes\.md/i });
    expect(anchor).toBeTruthy();
    expect(anchor.getAttribute("href")).toBe(FILE_URL);

    // Edit affordance for file URL
    const editBtn = screen.queryByRole("button", { name: /edit notes\.md/i });
    expect(editBtn).not.toBeNull();

    // No iframes for the file URL
    iframes.forEach((el) => {
      expect(el.getAttribute("src")).not.toBe(FILE_URL);
    });
  });

  it("Test 4: onWidgetSubmit is dispatched to the RIGHT widget mount when one of two iframes posts a widget-submit", () => {
    mockedHook.mockReturnValue(
      new Map([
        [WIDGET_URL_1, "interactive-message"],
        [WIDGET_URL_2, "interactive-message"],
      ]),
    );

    const onWidgetSubmit = vi.fn();

    render(
      <ChatMessage
        role="assistant"
        eventId="e4"
        content={`Poll: [poll](${WIDGET_URL_1}) Color: [color](${WIDGET_URL_2})`}
        onWidgetSubmit={onWidgetSubmit}
      />,
    );

    const iframes = screen.getAllByTitle("Interactive widget") as HTMLIFrameElement[];
    expect(iframes).toHaveLength(2);

    // Assign distinct fake contentWindows to each iframe
    const fakeContentWindow0 = {} as Window;
    const fakeContentWindow1 = {} as Window;
    Object.defineProperty(iframes[0], "contentWindow", {
      value: fakeContentWindow0,
      configurable: true,
    });
    Object.defineProperty(iframes[1], "contentWindow", {
      value: fakeContentWindow1,
      configurable: true,
    });

    // Dispatch a widget-submit from iframe[0]'s contentWindow
    const msg0 = new MessageEvent("message", {
      data: { type: "widget-submit", widgetId: "widget-1", value: "pickA" },
      origin: window.location.origin,
      source: fakeContentWindow0,
    });
    act(() => { window.dispatchEvent(msg0); });

    // onWidgetSubmit called once with iframe[0]'s payload
    expect(onWidgetSubmit).toHaveBeenCalledTimes(1);
    expect(onWidgetSubmit).toHaveBeenCalledWith("widget-1", "pickA");

    // Dispatch a widget-submit from iframe[1]'s contentWindow
    const msg1 = new MessageEvent("message", {
      data: { type: "widget-submit", widgetId: "widget-2", value: "pickB" },
      origin: window.location.origin,
      source: fakeContentWindow1,
    });
    act(() => { window.dispatchEvent(msg1); });

    // onWidgetSubmit now called twice total — second call with iframe[1]'s payload
    expect(onWidgetSubmit).toHaveBeenCalledTimes(2);
    expect(onWidgetSubmit).toHaveBeenNthCalledWith(2, "widget-2", "pickB");
  });

  it("Test 5: source-guard enforcement — a cross-source message does NOT reach any onSubmit callback", () => {
    mockedHook.mockReturnValue(
      new Map([
        [WIDGET_URL_1, "interactive-message"],
        [WIDGET_URL_2, "interactive-message"],
      ]),
    );

    const onWidgetSubmit = vi.fn();

    render(
      <ChatMessage
        role="assistant"
        eventId="e5"
        content={`Poll: [poll](${WIDGET_URL_1}) Color: [color](${WIDGET_URL_2})`}
        onWidgetSubmit={onWidgetSubmit}
      />,
    );

    // Dispatch a MessageEvent with a foreign source (not matching any iframe's contentWindow)
    // The two WidgetBubble iframes have contentWindow = null in JSDOM (not set
    // automatically), so {} is a third distinct object that matches neither.
    const foreignSource = {} as Window;
    const msg = new MessageEvent("message", {
      data: { type: "widget-submit", widgetId: "widget-x", value: "evil" },
      origin: window.location.origin,
      source: foreignSource,
    });
    act(() => { window.dispatchEvent(msg); });

    // Source guard rejected — neither widget's onSubmit was called
    expect(onWidgetSubmit).not.toHaveBeenCalled();
  });
});
