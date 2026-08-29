/**
 * ChatMessage autoplay tests — quick 260811-8we.
 *
 * Covers:
 *   LP1-LP5: long-press detection on the speak button
 *   AP1-AP3: autoplay effect (autoplayTargetEventId → startSpeak)
 *   TINT1-TINT2: armed-tint visual on the speak button
 *   REGRESSION: targeted regression assertions proving startSpeak extraction
 *               is behavior-preserving (complements ChatMessage.speak.test.tsx)
 *
 * Mock setup mirrors ChatMessage.speak.test.tsx (postSpeakStream +
 * createWebAudioStreamPlayer). Long-press describe block uses vi.useFakeTimers()
 * so timer-advance tests are deterministic; restores to real timers in afterEach.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ChatMessage } from "./ChatMessage";
import { postSpeakStream } from "@/api/voice-api";
import { createWebAudioStreamPlayer } from "./webAudioStreamPlayer";

// ---------------------------------------------------------------------------
// Mock voice-api
// ---------------------------------------------------------------------------

vi.mock("@/api/voice-api", () => ({
  postSpeakStream: vi.fn(async () => {
    const stream = new ReadableStream({ start(c) { c.close(); } });
    return new Response(stream, { status: 200 });
  }),
  postSpeak: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" })),
  getVoices: vi.fn(async () => []),
  SAMPLE_PHRASE: "Hi, this is your voice.",
}));

// ---------------------------------------------------------------------------
// Mock WebAudioStreamPlayer
// ---------------------------------------------------------------------------

const mockPlay = vi.fn(async () => {});
const mockStop = vi.fn();
const mockPause = vi.fn(async () => {});
const mockResume = vi.fn(async () => {});

vi.mock("./webAudioStreamPlayer", () => ({
  createWebAudioStreamPlayer: vi.fn(() => ({
    play: mockPlay,
    stop: mockStop,
    pause: mockPause,
    resume: mockResume,
  })),
}));

const mockedPostSpeakStream = vi.mocked(postSpeakStream);
const mockedCreatePlayer = vi.mocked(createWebAudioStreamPlayer);

beforeEach(() => {
  vi.clearAllMocks();
  mockedPostSpeakStream.mockResolvedValue(
    new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 }),
  );
  mockedCreatePlayer.mockImplementation(() => ({
    play: mockPlay,
    stop: mockStop,
    pause: mockPause,
    resume: mockResume,
  }));
  mockPlay.mockResolvedValue(undefined);
  mockPause.mockResolvedValue(undefined);
  mockResume.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Long-press detection tests (LP1-LP5)
// ---------------------------------------------------------------------------

describe("ChatMessage long-press detection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("LP1: pointerdown + 500ms fires onLongPressSpeak once with eventId AND starts speak", async () => {
    const onLongPressSpeak = vi.fn();
    render(
      <ChatMessage
        role="assistant"
        content="Test bubble"
        eventId="msg-lp1"
        onLongPressSpeak={onLongPressSpeak}
      />,
    );
    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal speak button.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));
    const btn = screen.getByLabelText(/speak message/i);

    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10 });

    // Before timer fires: nothing yet
    expect(onLongPressSpeak).not.toHaveBeenCalled();

    // Advance the timer and drain all pending microtasks/promises
    await act(async () => {
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();
    });

    expect(onLongPressSpeak).toHaveBeenCalledTimes(1);
    expect(onLongPressSpeak).toHaveBeenCalledWith("msg-lp1");
    expect(mockedPostSpeakStream).toHaveBeenCalledTimes(1);
  });

  it("LP2: pointerup BEFORE 500ms fires tap path only (postSpeakStream called, onLongPressSpeak NOT called)", async () => {
    const onLongPressSpeak = vi.fn();
    render(
      <ChatMessage
        role="assistant"
        content="Test bubble"
        eventId="msg-lp2"
        onLongPressSpeak={onLongPressSpeak}
      />,
    );
    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal speak button.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));
    const btn = screen.getByLabelText(/speak message/i);

    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10 });
    // Advance only 200ms (well before the 500ms threshold)
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.pointerUp(btn);
    // Fire the click (tap path)
    fireEvent.click(btn);

    expect(onLongPressSpeak).not.toHaveBeenCalled();

    // Drain microtasks so the async onSpeakClick has time to call postSpeakStream
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mockedPostSpeakStream).toHaveBeenCalledTimes(1);
  });

  it("LP3: pointerdown + pointermove(dx=15) + advance 500ms does NOT fire long-press", async () => {
    const onLongPressSpeak = vi.fn();
    render(
      <ChatMessage
        role="assistant"
        content="Test bubble"
        eventId="msg-lp3"
        onLongPressSpeak={onLongPressSpeak}
      />,
    );
    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal speak button.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));
    const btn = screen.getByLabelText(/speak message/i);

    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10 });
    // Move beyond 10px threshold → cancels timer
    fireEvent.pointerMove(btn, { clientX: 25, clientY: 10 });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();
    });

    expect(onLongPressSpeak).not.toHaveBeenCalled();
    expect(mockedPostSpeakStream).not.toHaveBeenCalled();
  });

  it("LP4: pointerdown + pointercancel + advance 500ms does NOT fire long-press (iOS-safe)", async () => {
    const onLongPressSpeak = vi.fn();
    render(
      <ChatMessage
        role="assistant"
        content="Test bubble"
        eventId="msg-lp4"
        onLongPressSpeak={onLongPressSpeak}
      />,
    );
    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal speak button.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));
    const btn = screen.getByLabelText(/speak message/i);

    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10 });
    fireEvent.pointerCancel(btn);
    await act(async () => {
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();
    });

    expect(onLongPressSpeak).not.toHaveBeenCalled();
    expect(mockedPostSpeakStream).not.toHaveBeenCalled();
  });

  it("LP5: long-press fires, subsequent browser-synthetic click is suppressed (no double-fire)", async () => {
    const onLongPressSpeak = vi.fn();
    render(
      <ChatMessage
        role="assistant"
        content="Test bubble"
        eventId="msg-lp5"
        onLongPressSpeak={onLongPressSpeak}
      />,
    );
    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal speak button.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));
    const btn = screen.getByLabelText(/speak message/i);

    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10 });
    // Advance timer to fire long-press
    await act(async () => {
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();
    });

    // postSpeakStream called once so far (from long-press)
    expect(mockedPostSpeakStream).toHaveBeenCalledTimes(1);

    // Now simulate the browser-synthetic click that follows pointerup
    fireEvent.pointerUp(btn);
    fireEvent.click(btn);

    // Drain any remaining async
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Still exactly once — the synthetic click was suppressed
    expect(mockedPostSpeakStream).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Autoplay effect tests (AP1-AP3)
// ---------------------------------------------------------------------------

describe("ChatMessage autoplay effect", () => {
  it("AP1: matching autoplayTargetEventId fires startSpeak once", async () => {
    render(
      <ChatMessage
        role="assistant"
        content="Autoplay test"
        eventId="msg-A"
        autoplayArmed={true}
        autoplayTargetEventId="msg-A"
      />,
    );

    await waitFor(() => {
      expect(mockedPostSpeakStream).toHaveBeenCalledTimes(1);
    });
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });

  it("AP2: non-matching autoplayTargetEventId does NOT fire startSpeak", async () => {
    render(
      <ChatMessage
        role="assistant"
        content="Autoplay test"
        eventId="msg-A"
        autoplayArmed={true}
        autoplayTargetEventId="msg-B"
      />,
    );

    // Wait a tick to ensure effects have run
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockedPostSpeakStream).not.toHaveBeenCalled();
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it("AP3: re-render with same target does NOT double-fire (guard prevents double-fire)", async () => {
    const { rerender } = render(
      <ChatMessage
        role="assistant"
        content="Autoplay test"
        eventId="msg-A"
        autoplayArmed={true}
        autoplayTargetEventId="msg-A"
      />,
    );

    await waitFor(() => {
      expect(mockedPostSpeakStream).toHaveBeenCalledTimes(1);
    });

    // Re-render with the same target — should NOT fire again
    rerender(
      <ChatMessage
        role="assistant"
        content="Autoplay test"
        eventId="msg-A"
        autoplayArmed={true}
        autoplayTargetEventId="msg-A"
      />,
    );

    // Wait another tick to ensure effects settled
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Still exactly once — no double-fire
    expect(mockedPostSpeakStream).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Armed-tint visual tests (TINT1-TINT2)
// ---------------------------------------------------------------------------

describe("ChatMessage armed-tint visual", () => {
  it("TINT1: autoplayArmed=true applies hue-cream tint to the speak button background", () => {
    render(
      <ChatMessage
        role="assistant"
        content="Tint test"
        eventId="msg-tint1"
        autoplayArmed={true}
      />,
    );
    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal speak button.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));
    const btn = screen.getByLabelText(/speak message/i);
    // The inline style sets background to the hue-cream value when armed.
    // Check for the hsla CSS var signature — JSDOM preserves var() references
    // without normalization since it cannot resolve them.
    const style = btn.getAttribute("style") ?? "";
    expect(style).toContain("--pv-id-hue");
  });

  it("TINT2: autoplayArmed=false shows default background; pv-speak-btn class still present", () => {
    render(
      <ChatMessage
        role="assistant"
        content="Tint test"
        eventId="msg-tint2"
        autoplayArmed={false}
      />,
    );
    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal speak button.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));
    const btn = screen.getByLabelText(/speak message/i);
    // Default background when not armed.
    // JSDOM normalizes rgba(0,0,0,0.28) → rgba(0, 0, 0, 0.28) so check for
    // the background property without the exact whitespace form.
    const style = btn.getAttribute("style") ?? "";
    expect(style).toMatch(/background:\s*rgba\(0,\s*0,\s*0,\s*0\.28\)/);
    // Base class still present
    expect(btn.className).toContain("pv-speak-btn");
  });
});

// ---------------------------------------------------------------------------
// Regression tests — prove startSpeak extraction is behavior-preserving
// ---------------------------------------------------------------------------

describe("ChatMessage speak regression (post-startSpeak-extract)", () => {
  it("REG1: clicking speak button calls postSpeakStream (fresh-play path preserved)", async () => {
    render(<ChatMessage role="assistant" content="Regression test" />);
    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal speak button.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));
    const btn = screen.getByLabelText(/speak message/i);
    fireEvent.click(btn);
    await waitFor(() => {
      expect(mockedPostSpeakStream).toHaveBeenCalledTimes(1);
    });
  });

  it("REG2: same-bubble pause/resume cycle calls pause() then resume() — never stop()", async () => {
    render(<ChatMessage role="assistant" content="Pause resume test" />);
    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal speak button.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));
    const btn = screen.getByLabelText(/speak message/i);
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.queryByLabelText(/pause speaking/i)).not.toBeNull();
    });

    fireEvent.click(screen.getByLabelText(/pause speaking/i));
    await waitFor(() => {
      expect(mockPause).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByLabelText(/resume speaking/i));
    await waitFor(() => {
      expect(mockResume).toHaveBeenCalled();
    });

    expect(mockStop).not.toHaveBeenCalled();
  });

  it("REG3: cross-bubble preempt calls stop() on first player (startSpeak extraction preserves preempt)", async () => {
    const { container } = render(
      <div>
        <ChatMessage role="assistant" content="First bubble" />
        <ChatMessage role="assistant" content="Second bubble" />
      </div>,
    );

    // Both assistant bubbles start collapsed (quick-260829-qb9) — expand both to reveal speak buttons.
    for (const header of screen.queryAllByTestId("chatmessage-collapsed-header")) {
      fireEvent.click(header);
    }

    const buttons = container.querySelectorAll("button[aria-label='Speak message']");
    const firstBtn = buttons[0] as HTMLElement;
    const secondBtn = buttons[1] as HTMLElement;

    fireEvent.click(firstBtn);
    await waitFor(() => {
      expect(firstBtn.getAttribute("aria-label")).toBe("Pause speaking");
    });

    mockStop.mockClear();

    fireEvent.click(secondBtn);
    await waitFor(() => {
      expect(mockStop).toHaveBeenCalled();
    });
  });
});
