/**
 * Bounty pretty-view-reconnect-preserve-bubbles-and-disable-send (2026-08-08).
 *
 * ComposeBox behavior when reconnectingActive=true — mirrors the
 * recycleActive / planPendingActive disable pattern. During the pretty-view
 * WS retry window (patch #148 auto-reconnect between an old socket's onclose
 * and a fresh session frame), Send + reset + ThumbsUp + Recap are disabled
 * because onSend would silently no-op (ws.readyState !== 1). Textarea, mic,
 * and paperclip stay usable so Ashley can pre-draft the next message while
 * the socket comes back.
 *
 * Truth table (mirrors ComposeBox.recycle-disable.test.tsx):
 *   - Send: STAYS as Send (aria-label "Send", NOT morphed) but disabled=true.
 *   - Aux WS-side-effect buttons (reset, ThumbsUp, Recap): disabled=true.
 *   - Textarea: STAYS typeable.
 *   - Enter key: does NOT fire onSend.
 *   - Mic: STAYS enabled (records locally, no WS side-effect).
 *   - Paperclip: STAYS enabled (attaches locally, no WS side-effect).
 *   - Baseline (reconnectingActive=false / undefined): all gates revert.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "" }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

import { ComposeBox, type ComposeBoxProps } from "./ComposeBox";

function baseProps(overrides: Partial<ComposeBoxProps> = {}): ComposeBoxProps {
  return {
    onSend: vi.fn(() => true),
    hostId: 1,
    tmuxSession: "s1",
    canSend: true,
    ...overrides,
  };
}

describe("ComposeBox — reconnectingActive gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("R1: reconnectingActive=true — Send button is disabled but NOT morphed (still aria-label 'Send')", () => {
    const { container } = render(
      <ComposeBox {...baseProps({ reconnectingActive: true })} />,
    );
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello mid-reconnect" } });

    const sendBtn = screen.getByLabelText("Send") as HTMLButtonElement;
    expect(sendBtn).toBeTruthy();
    expect(sendBtn.disabled).toBe(true);
    // Paper-plane inline SVG still renders (NOT the lucide X — aside morph).
    const paperPlanePath = container.querySelector('path[d^="M14.536"]');
    expect(paperPlanePath).not.toBeNull();
    expect(screen.queryByLabelText("Resume")).toBeNull();
  });

  it("R2: reconnectingActive=true — aux WS-side-effect buttons (reset, ThumbsUp, Recap) all disabled", () => {
    render(<ComposeBox {...baseProps({ reconnectingActive: true })} />);
    const resetBtn = screen.getByLabelText("Reset context window") as HTMLButtonElement;
    const thumbsUpBtn = screen.getByLabelText("Send 'let's go'") as HTMLButtonElement;
    const recapBtn = screen.getByLabelText("Recap the current situation") as HTMLButtonElement;
    expect(resetBtn.disabled).toBe(true);
    expect(thumbsUpBtn.disabled).toBe(true);
    expect(recapBtn.disabled).toBe(true);
  });

  it("R3: reconnectingActive=true — textarea stays typeable", () => {
    render(<ComposeBox {...baseProps({ reconnectingActive: true })} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
    fireEvent.change(textarea, { target: { value: "draft during reconnect" } });
    expect(textarea.value).toBe("draft during reconnect");
  });

  it("R4: reconnectingActive=true — Enter key does NOT fire onSend", () => {
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend, reconnectingActive: true })} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "should not send on enter" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("R5: reconnectingActive=false (default) — baseline sanity, Send enabled and short-tap fires onSend", async () => {
    // Phase 32 Plan 32-02: send path is now pointer-gesture-owned, not click-
    // owned. Stub navigator.mediaDevices so useHoldToRecord's onPointerDown ->
    // voice.start() -> getUserMedia does not crash; the short-tap branch awaits
    // voice.cancel() (Plan 32-01 pendingCancelRef synchronous teardown) which
    // discards the never-resolving getUserMedia promise.
    const originalNavigator = globalThis.navigator;
    const getUserMediaMock = vi.fn(() => new Promise(() => {}));
    Object.defineProperty(globalThis, "navigator", {
      value: { mediaDevices: { getUserMedia: getUserMediaMock } },
      writable: true,
      configurable: true,
    });
    try {
      const onSend = vi.fn(() => true);
      render(<ComposeBox {...baseProps({ onSend })} />);
      const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "normal send" } });
      const sendBtn = screen.getByLabelText("Send") as HTMLButtonElement;
      expect(sendBtn.disabled).toBe(false);
      // Quick 260814-1hz: Send button now uses plain onClick (hold gesture
      // moved to MicButton). Click fires handleSend directly.
      fireEvent.click(sendBtn);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(onSend).toHaveBeenCalledTimes(1);
      expect(onSend).toHaveBeenCalledWith("normal send");
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    }
  });
});

// Mic + paperclip stay usable during reconnect — same guarantee that
// bounty mic-available-when-composebox-disabled gave for recycleActive.
describe("ComposeBox — reconnectingActive=true, mic + paperclip usable", () => {
  function makeMockStream() {
    const track = { stop: vi.fn() };
    return {
      getTracks: vi.fn(() => [track]),
      _track: track,
    };
  }

  class MockMediaRecorder {
    static instances: MockMediaRecorder[] = [];
    mimeType = "audio/webm";
    state: "inactive" | "recording" | "paused" = "inactive";
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start = vi.fn().mockImplementation(() => { this.state = "recording"; });
    stop = vi.fn().mockImplementation(() => {
      this.state = "inactive";
      if (this.onstop) this.onstop();
    });
    constructor(public stream: MediaStream) {
      MockMediaRecorder.instances.push(this);
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    MockMediaRecorder.instances = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).MediaRecorder = MockMediaRecorder;
    const mockStream = makeMockStream();
    const getUserMediaMock = vi.fn().mockResolvedValue(mockStream);
    Object.defineProperty(globalThis, "navigator", {
      value: {
        mediaDevices: { getUserMedia: getUserMediaMock },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("R6: reconnectingActive=true + showPaperclip=true — Paperclip renders and is NOT disabled", () => {
    render(
      <ComposeBox
        {...baseProps({
          reconnectingActive: true,
          showPaperclip: true,
          onAttachFiles: vi.fn(),
        })}
      />,
    );
    const attachBtn = screen.getByLabelText("Attach file") as HTMLButtonElement;
    expect(attachBtn).toBeTruthy();
    expect(attachBtn.disabled).toBe(false);
  });

  it("R7: reconnectingActive=true — primary MicButton renders and is NOT disabled", () => {
    render(<ComposeBox {...baseProps({ reconnectingActive: true })} />);
    const micBtn = screen.getByRole("button", { name: "Record voice" }) as HTMLButtonElement;
    expect(micBtn).toBeTruthy();
    expect(micBtn.disabled).toBe(false);
  });
});
