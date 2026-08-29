/**
 * Phase 40 Plan 40-04 Task 1 — ChatMessage wiring tests for the editable-file
 * affordance.
 *
 * These tests exercise the wiring seam only:
 *   - useEditableFileEligibility is called and its returned Set gates the
 *     EditableFileAffordance render inside the ReactMarkdown `<a>` override.
 *   - The anchor's target/rel semantics remain untouched (D-03
 *     additive-not-replacive).
 *   - The bubble container div carries the `pv-bubble` class so the
 *     desktop hover-reveal selector (`.pv-bubble:hover &`) baked into the
 *     affordance component can target it.
 *   - The onOpenEditor prop is invoked with the right {messageEventId,url,filename}
 *     tuple when the affordance is clicked.
 *
 * Mock strategy:
 *   - vi.mock("./use-editable-file-eligibility") — controllable per-test via
 *     mockReturnValueOnce.
 *   - Do NOT mock EditableFileAffordance — the real component is used so the
 *     wiring is exercised end-to-end (Plan 40-03 already unit-tested the
 *     component in isolation).
 *   - The speak-button branches call postSpeakStream + createWebAudioStreamPlayer
 *     from module scope; stub both to no-op so the ChatMessage assistant-side
 *     render is exercised without side effects (matches existing
 *     ChatMessage.test.tsx pattern).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatMessage } from "./ChatMessage";
import { useEditableFileEligibility } from "./use-editable-file-eligibility";

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

// The hook is mocked at module scope so per-test overrides via
// .mockReturnValueOnce control what the ChatMessage `a` override sees.
vi.mock("./use-editable-file-eligibility", () => ({
  useEditableFileEligibility: vi.fn(() => new Set()),
}));

const mockedHook = vi.mocked(useEditableFileEligibility);

beforeEach(() => {
  vi.clearAllMocks();
  mockedHook.mockReturnValue(new Set());
});

const URL_A = "http://100.64.0.1:8000/notes.md";
const URL_B = "http://100.64.0.1:8000/report.md";
const URL_QS = "http://100.64.0.1:8000/notes.md?nocache=1";

describe("ChatMessage — editable-file affordance wiring (Plan 40-04)", () => {
  it("Test 1: assistant message + whitelist-hit URL renders anchor AND affordance as siblings", () => {
    mockedHook.mockReturnValue(new Set([URL_A]));
    const onOpenEditor = vi.fn();
    render(
      <ChatMessage
        role="assistant"
        eventId="e1"
        content={`here [notes.md](${URL_A})`}
        onOpenEditor={onOpenEditor}
      />,
    );

    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal markdown body.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));

    const anchor = screen.getByRole("link", { name: /notes\.md/i });
    const button = screen.getByRole("button", { name: /edit notes\.md/i });

    // Sibling-not-wrapper regression assertion (D-03).
    expect(button.parentElement).toBe(anchor.parentElement);
    // Direct sibling check: both are direct children of the same parent.
    expect(Array.from(anchor.parentElement!.children)).toEqual(
      expect.arrayContaining([anchor, button]),
    );
  });

  it("Test 2: user message with tailnet URL — no affordance renders (hook empty Set)", () => {
    // The hook fires but returns empty for user messages (message content has
    // no eligible URLs from the hook's viewpoint). The wiring asserts the
    // affordance stays absent.
    mockedHook.mockReturnValue(new Set());
    const onOpenEditor = vi.fn();
    render(
      <ChatMessage
        role="user"
        eventId="u1"
        content={`here [notes.md](${URL_A})`}
        onOpenEditor={onOpenEditor}
      />,
    );

    expect(screen.getByRole("link", { name: /notes\.md/i })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /edit/i }),
    ).toBeNull();
  });

  it("Test 3: assistant + non-eligible URL — link only, no affordance", () => {
    mockedHook.mockReturnValue(new Set()); // URL not in eligible set
    const onOpenEditor = vi.fn();
    render(
      <ChatMessage
        role="assistant"
        eventId="e3"
        content={`link [notes.md](${URL_A})`}
        onOpenEditor={onOpenEditor}
      />,
    );

    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal markdown body.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));

    expect(screen.getByRole("link", { name: /notes\.md/i })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /edit/i }),
    ).toBeNull();
  });

  it("Test 4: anchor semantics preserved — target=_blank, rel=noopener noreferrer, href unchanged", () => {
    mockedHook.mockReturnValue(new Set([URL_A]));
    render(
      <ChatMessage
        role="assistant"
        eventId="e4"
        content={`link [notes.md](${URL_A})`}
        onOpenEditor={vi.fn()}
      />,
    );

    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal markdown body.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));

    const anchor = screen.getByRole("link", { name: /notes\.md/i });
    expect(anchor.getAttribute("target")).toBe("_blank");
    expect(anchor.getAttribute("rel")).toBe("noopener noreferrer");
    expect(anchor.getAttribute("href")).toBe(URL_A);
  });

  it("Test 5: affordance onClick fires onOpenEditor with {messageEventId,url,filename}", () => {
    mockedHook.mockReturnValue(new Set([URL_A]));
    const onOpenEditor = vi.fn();
    render(
      <ChatMessage
        role="assistant"
        eventId="e5"
        content={`link [notes.md](${URL_A})`}
        onOpenEditor={onOpenEditor}
      />,
    );

    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal markdown body.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));

    const button = screen.getByRole("button", { name: /edit notes\.md/i });
    fireEvent.click(button);

    expect(onOpenEditor).toHaveBeenCalledTimes(1);
    expect(onOpenEditor).toHaveBeenCalledWith({
      messageEventId: "e5",
      url: URL_A,
      filename: "notes.md",
    });
  });

  it("Test 6: multi-URL message — one affordance per eligible URL", () => {
    mockedHook.mockReturnValue(new Set([URL_A, URL_B]));
    render(
      <ChatMessage
        role="assistant"
        eventId="e6"
        content={`one [notes.md](${URL_A}) two [report.md](${URL_B})`}
        onOpenEditor={vi.fn()}
      />,
    );

    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal markdown body.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));

    expect(screen.getByRole("button", { name: /edit notes\.md/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /edit report\.md/i })).toBeTruthy();
  });

  it("Test 7: bubble container has pv-bubble class", () => {
    mockedHook.mockReturnValue(new Set());
    const { container } = render(
      <ChatMessage
        role="assistant"
        eventId="e7"
        content="just some prose"
        onOpenEditor={vi.fn()}
      />,
    );

    expect(container.querySelector(".pv-bubble")).not.toBeNull();
  });

  it("Test 8: onOpenEditor prop is optional — no crash + no affordance renders when omitted", () => {
    mockedHook.mockReturnValue(new Set([URL_A]));
    // Do NOT pass onOpenEditor — safe degrade.
    render(
      <ChatMessage
        role="assistant"
        eventId="e8"
        content={`link [notes.md](${URL_A})`}
      />,
    );

    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal markdown body.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));

    expect(screen.getByRole("link", { name: /notes\.md/i })).toBeTruthy();
    // Without a handler the affordance MUST NOT render (safe degrade).
    expect(
      screen.queryByRole("button", { name: /edit/i }),
    ).toBeNull();
  });

  it("Test 9: query-string URL — filename decoded from pathname (Pitfall 8 defense)", () => {
    mockedHook.mockReturnValue(new Set([URL_QS]));
    render(
      <ChatMessage
        role="assistant"
        eventId="e9"
        content={`link [notes.md](${URL_QS})`}
        onOpenEditor={vi.fn()}
      />,
    );

    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal markdown body.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));

    // Filename should be "notes.md" (query stripped) — NOT "notes.md?nocache=1".
    const button = screen.getByRole("button", { name: /edit notes\.md/i });
    expect(button).toBeTruthy();
    expect(button.getAttribute("aria-label")).toBe("Edit notes.md");
  });

  it("Test 10: hook called with (eventId, content) — asserts wiring signature", () => {
    mockedHook.mockReturnValue(new Set());
    render(
      <ChatMessage
        role="assistant"
        eventId="e10"
        content="test body"
        onOpenEditor={vi.fn()}
      />,
    );

    expect(mockedHook).toHaveBeenCalled();
    // Signature: (messageEventId, messageBody)
    const [eid, body] = mockedHook.mock.calls[0];
    expect(eid).toBe("e10");
    expect(body).toBe("test body");
  });
});
