/**
 * Phase 97 UAT batch #6 (2026-09-10) — RelayInboundBubble speak tests.
 *
 * Mirror of ChatMessage.speak.test.tsx for the relay-source (alwaysExpanded=true)
 * left-side bubbles. Truths 5, 6, 8, 9 from PLAN.md.
 *
 * Mock rules (mirror ChatMessage.speak.test.tsx):
 * - postSpeakStream mocked to return a streaming Response
 * - createWebAudioStreamPlayer mocked to return {play, stop, pause, resume} spies
 * - useIdentities mocked so tests can control resolution vs unresolved paths
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";
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

// ---------------------------------------------------------------------------
// Mock useIdentities
// ---------------------------------------------------------------------------
vi.mock("@/state/identities-store", () => ({
  useIdentities: vi.fn(() => ({
    identities: [],
    byKey: new Map(),
    loaded: true,
    refresh: vi.fn(),
  })),
}));

import { useIdentities } from "@/state/identities-store";
import { RelayInboundBubble } from "./RelayInboundBubble";
import { ChatMessage } from "./ChatMessage";

const mockedUseIdentities = vi.mocked(useIdentities);
const mockedPostSpeakStream = vi.mocked(postSpeakStream);
const mockedCreatePlayer = vi.mocked(createWebAudioStreamPlayer);

function makeIdentity(
  identityKey: string,
  displayName: string,
  colorHue: number,
  voice: string | null = null,
): Identity {
  return {
    identityKey,
    displayName,
    title: null,
    colorHue,
    voice,
    role: null,
    avatarMime: "image/png",
    avatarUrl: "/avatar.png",
    avatarEtag: "abc",
    coordinator: false,
  };
}

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
  // Default: empty identity store (unresolved)
  mockedUseIdentities.mockReturnValue({
    identities: [],
    byKey: new Map(),
    loaded: true,
    refresh: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Truth 5 + Truth 7 partial: presence / absence of speak button per mode.
// ---------------------------------------------------------------------------

describe("RelayInboundBubble speak apparatus (Phase 97 UAT batch #6)", () => {
  it("Truth 5 — alwaysExpanded=true renders exactly one speak button", () => {
    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@tina:matrix.example.com"
        body="Speak this text"
        hostId={1}
        alwaysExpanded={true}
      />,
    );
    const buttons = screen.queryAllByLabelText(/speak message/i);
    expect(buttons).toHaveLength(1);
  });

  it("Truth 7 partial — alwaysExpanded=false renders NO speak button", () => {
    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@tina:matrix.example.com"
        body="Speak this text"
        hostId={1}
      />,
    );
    expect(screen.queryByLabelText(/speak message/i)).toBeNull();
  });

  it("Truth 5 — clicking speak calls postSpeakStream", async () => {
    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@tina:matrix.example.com"
        body="Speak this text"
        hostId={1}
        alwaysExpanded={true}
      />,
    );
    const btn = screen.getByLabelText(/speak message/i);
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockedPostSpeakStream).toHaveBeenCalled();
    });
  });

  it("Truth 5 — loading state renders Loader2; after resolution shows Pause (playing)", async () => {
    let resolveStream!: (r: Response) => void;
    mockedPostSpeakStream.mockReturnValueOnce(
      new Promise<Response>((resolve) => { resolveStream = resolve; }),
    );

    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@tina:matrix.example.com"
        body="Loading test"
        hostId={1}
        alwaysExpanded={true}
      />,
    );
    const btn = screen.getByLabelText(/speak message/i);
    fireEvent.click(btn);

    // During loading — Loader2 spinner visible (animate-spin class).
    await waitFor(() => {
      const spinner = document.querySelector(".animate-spin");
      expect(spinner).not.toBeNull();
    });

    resolveStream(new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 }));

    // After resolution — spinner gone.
    await waitFor(() => {
      const spinner = document.querySelector(".animate-spin");
      expect(spinner).toBeNull();
    });

    // Playing state — aria-label swaps to "Pause speaking".
    await waitFor(() => {
      expect(screen.queryByLabelText(/pause speaking/i)).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Truth 9 — voice resolution paths.
  // ---------------------------------------------------------------------------

  it("Truth 9 — resolved sender with identity.voice → postSpeakStream(text, 'sarah')", async () => {
    const tina = makeIdentity("tina", "Tina", 45, "sarah");
    mockedUseIdentities.mockReturnValue({
      identities: [tina],
      byKey: new Map([["tina", tina]]),
      loaded: true,
      refresh: vi.fn(),
    });

    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@tina:matrix.example.com"
        body="Hello Tina"
        hostId={1}
        alwaysExpanded={true}
      />,
    );

    const btn = screen.getByLabelText(/speak message/i);
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockedPostSpeakStream).toHaveBeenCalled();
    });
    // First positional argument (spoken text) is the message body ONLY —
    // NOT the sender display name from the header. Regression pin: a prior
    // version read innerText from the outer bubble container, which
    // included the header text (dot + displayName) and would have spoken
    // "Tina Hello Tina" in a real browser. JSDOM does not implement
    // innerText so the earlier tests silently passed via the ?? fallback.
    const call = mockedPostSpeakStream.mock.calls[0];
    expect(call[0]).toBe("Hello Tina");
    expect(call[0]).not.toMatch(/^Tina/);
    // Second positional argument should be "sarah".
    expect(call[1]).toBe("sarah");
  });

  it("Truth 9 — unresolved sender → postSpeakStream(text, undefined); button STILL renders (not hidden)", async () => {
    // byKey empty (default beforeEach). No identity resolution → identity=null,
    // so identity?.voice is undefined.
    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@unknown:matrix.example.com"
        body="A message from nobody"
        hostId={1}
        alwaysExpanded={true}
      />,
    );

    // Button IS present even with unresolved sender.
    const btn = screen.getByLabelText(/speak message/i);
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockedPostSpeakStream).toHaveBeenCalled();
    });
    // Second positional argument should be undefined (default voice
    // fallback lives in postSpeakStream contract).
    const call = mockedPostSpeakStream.mock.calls[0];
    expect(call[1]).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Truth 6 — long-press-arms-autoplay lives on the speak button (not the
  // bubble body). Phase 97 UAT batch #7 (2026-09-10): the bubble-root
  // pointer-handler wiring introduced in batch #6 was removed — it duplicated
  // the button's own internal handlers and diverged from ChatMessage's
  // pattern. Only button-anchored long-press remains.
  // ---------------------------------------------------------------------------

  it("Truth 6 — long-press on speak button fires onLongPressSpeak(eventId) and starts speak", async () => {
    vi.useFakeTimers();

    const onLongPressSpeak = vi.fn();

    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@tina:matrix.example.com"
        body="Long-press-on-button"
        hostId={1}
        alwaysExpanded={true}
        eventId="evt-xyz"
        onLongPressSpeak={onLongPressSpeak}
      />,
    );

    const speakBtn = screen.getByLabelText(/speak message/i);
    // Long-press ON the speak button — the button's own handler owns the
    // gesture (mirrors ChatMessage's pattern; batch #7 removed the redundant
    // bubble-root wiring).
    fireEvent.pointerDown(speakBtn, { clientX: 0, clientY: 0 });
    vi.advanceTimersByTime(500);
    fireEvent.pointerUp(speakBtn);

    // Long-press fires onLongPressSpeak with the bubble's eventId.
    expect(onLongPressSpeak).toHaveBeenCalledWith("evt-xyz");

    await vi.runAllTimersAsync();

    // Speak fires exactly once (button's timer).
    expect(mockedPostSpeakStream).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("Truth 6 (batch #7) — pointerDown on bubble root does NOT fire onLongPressSpeak (bubble-root handler removed)", async () => {
    vi.useFakeTimers();

    const onLongPressSpeak = vi.fn();

    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@tina:matrix.example.com"
        body="Long-press me"
        hostId={1}
        alwaysExpanded={true}
        eventId="evt-abc"
        onLongPressSpeak={onLongPressSpeak}
      />,
    );

    const bubble = screen.getByTestId("relay-inbound-bubble");

    // pointerDown on bubble root — no long-press timer arms because the
    // bubble-root handlers were removed in batch #7.
    fireEvent.pointerDown(bubble, { clientX: 0, clientY: 0 });
    vi.advanceTimersByTime(500);
    fireEvent.pointerUp(bubble);

    // onLongPressSpeak NOT called — no bubble-root wiring exists anymore.
    expect(onLongPressSpeak).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    // No speak fired either.
    expect(mockedPostSpeakStream).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Truth 8 — cross-bubble singleton preempt with ChatMessage.
  // ---------------------------------------------------------------------------

  it("Truth 8 — speak on RelayInboundBubble stops speak on a ChatMessage (shared singleton preempt)", async () => {
    const { container } = render(
      <div>
        <ChatMessage role="assistant" content="First bubble (assistant)" />
        <RelayInboundBubble
          room="!roomAlias:server.tld"
          sender="@tina:matrix.example.com"
          body="Second bubble (relay inbound)"
          hostId={1}
          alwaysExpanded={true}
        />
      </div>,
    );

    // Two buttons: [0] assistant speak, [1] relay-inbound speak.
    const buttons = container.querySelectorAll("button[aria-label='Speak message']");
    expect(buttons.length).toBe(2);
    const assistantBtn = buttons[0] as HTMLElement;
    const relayBtn = buttons[1] as HTMLElement;

    // Click assistant → wait for it to transition to playing state
    // (aria-label swaps to "Pause speaking" once the postSpeakStream promise
    // resolves and setSpeakState("playing") runs).
    fireEvent.click(assistantBtn);
    await waitFor(() => {
      expect(assistantBtn.getAttribute("aria-label")).toBe("Pause speaking");
    });

    // Reset the stop spy so we detect the shared-singleton preempt call
    // triggered by clicking the second (relay-inbound) bubble.
    mockStop.mockClear();

    // Click relay-inbound → should call stop() on the previous (assistant)
    // player via the shared speak-singleton (Task 1 extraction).
    fireEvent.click(relayBtn);
    await waitFor(() => {
      expect(mockStop).toHaveBeenCalled();
    });
  });

  it("Truth 8 (reverse) — speak on ChatMessage stops speak on RelayInboundBubble (shared singleton preempt)", async () => {
    const { container } = render(
      <div>
        <RelayInboundBubble
          room="!roomAlias:server.tld"
          sender="@tina:matrix.example.com"
          body="First bubble (relay inbound)"
          hostId={1}
          alwaysExpanded={true}
        />
        <ChatMessage role="assistant" content="Second bubble (assistant)" />
      </div>,
    );

    const buttons = container.querySelectorAll("button[aria-label='Speak message']");
    expect(buttons.length).toBe(2);
    const relayBtn = buttons[0] as HTMLElement;
    const assistantBtn = buttons[1] as HTMLElement;

    fireEvent.click(relayBtn);
    await waitFor(() => {
      expect(relayBtn.getAttribute("aria-label")).toBe("Pause speaking");
    });

    mockStop.mockClear();

    fireEvent.click(assistantBtn);
    await waitFor(() => {
      expect(mockStop).toHaveBeenCalled();
    });
  });
});
