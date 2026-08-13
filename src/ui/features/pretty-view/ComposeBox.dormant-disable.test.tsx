/**
 * quick 260808-cd6 — dormancy overlay + wake button.
 *
 * ComposeBox behavior when dormantActive=true — mirrors the
 * recycleActive / planPendingActive / reconnectingActive disable pattern.
 * During the dormant/waking window (identity pane is asleep OR the local
 * 'waking…' window is active), Send + reset + ThumbsUp + Recap are disabled
 * because onSend would silently no-op (the pane's Claude session is not live).
 * Textarea, mic, and paperclip stay usable so Ashley can pre-draft the next
 * message while the wake proceeds.
 *
 * Mirror of ComposeBox.reconnecting-disable.test.tsx (quick 260808-cd6).
 *
 * Truth table (mirrors ComposeBox.reconnecting-disable.test.tsx D1-D7):
 *   - Send: STAYS as Send (aria-label "Send", NOT morphed) but disabled=true.
 *   - Aux WS-side-effect buttons (reset, ThumbsUp, Recap): disabled=true.
 *   - Textarea: STAYS typeable.
 *   - Enter key: does NOT fire onSend.
 *   - Mic: STAYS enabled (records locally, no WS side-effect).
 *   - Paperclip: STAYS enabled (attaches locally, no WS side-effect).
 *   - Baseline (dormantActive=false / undefined): all gates revert.
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

describe("ComposeBox — dormantActive gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("D1: dormantActive=true — Send button is disabled but NOT morphed (still aria-label 'Send')", () => {
    const { container } = render(
      <ComposeBox {...baseProps({ dormantActive: true })} />,
    );
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello while dormant" } });

    const sendBtn = screen.getByLabelText("Send") as HTMLButtonElement;
    expect(sendBtn).toBeTruthy();
    expect(sendBtn.disabled).toBe(true);
    // Paper-plane inline SVG still renders (NOT the lucide X — aside morph).
    const paperPlanePath = container.querySelector('path[d^="M14.536"]');
    expect(paperPlanePath).not.toBeNull();
    expect(screen.queryByLabelText("Resume")).toBeNull();
  });

  it("D2: dormantActive=true — aux WS-side-effect buttons (reset, ThumbsUp, Recap) all disabled", () => {
    render(<ComposeBox {...baseProps({ dormantActive: true })} />);
    const resetBtn = screen.getByLabelText("Reset context window") as HTMLButtonElement;
    const thumbsUpBtn = screen.getByLabelText("Send 'let's go'") as HTMLButtonElement;
    const recapBtn = screen.getByLabelText("Recap the current situation") as HTMLButtonElement;
    expect(resetBtn.disabled).toBe(true);
    expect(thumbsUpBtn.disabled).toBe(true);
    expect(recapBtn.disabled).toBe(true);
  });

  it("D3: dormantActive=true — textarea stays typeable", () => {
    render(<ComposeBox {...baseProps({ dormantActive: true })} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
    fireEvent.change(textarea, { target: { value: "draft during dormant" } });
    expect(textarea.value).toBe("draft during dormant");
  });

  it("D4: dormantActive=true — Enter key does NOT fire onSend", () => {
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend, dormantActive: true })} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "should not send on enter" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("D5: dormantActive=false (default) — baseline sanity, Send enabled and short-tap fires onSend", async () => {
    // Phase 32 Plan 32-02: the primary send button's onClick prop is now
    // `asideActive ? () => onAsideDismiss?.() : undefined`; the non-aside
    // send path is served exclusively by useHoldToRecord's pointer handlers.
    // Drive the short-tap (elapsedMs < 250ms) sequence which triggers the
    // hook's onShortTap → handleSend. Stub navigator.mediaDevices because the
    // hook calls voice.start() → getUserMedia inside onPointerDown (D-16-02).
    // Short-tap awaits voice.cancel() which takes the Plan 32-01
    // pendingCancelRef synchronous branch; the never-resolving getUserMedia
    // promise is discarded by that teardown, so state never leaves "idle".
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
      fireEvent.pointerDown(sendBtn, { pointerId: 1, clientX: 20, clientY: 20, timeStamp: 0 });
      fireEvent.pointerUp(sendBtn, { pointerId: 1, clientX: 20, clientY: 20, timeStamp: 50 });
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

// Mic + paperclip stay usable during dormant/waking — same guarantee that
// bounty mic-available-when-composebox-disabled gave for recycleActive.
describe("ComposeBox — dormantActive=true, mic + paperclip usable", () => {
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

  it("D6: dormantActive=true + showPaperclip=true — Paperclip renders and is NOT disabled", () => {
    render(
      <ComposeBox
        {...baseProps({
          dormantActive: true,
          showPaperclip: true,
          onAttachFiles: vi.fn(),
        })}
      />,
    );
    const attachBtn = screen.getByLabelText("Attach file") as HTMLButtonElement;
    expect(attachBtn).toBeTruthy();
    expect(attachBtn.disabled).toBe(false);
  });

  it("D7: dormantActive=true — primary MicButton renders and is NOT disabled", () => {
    render(<ComposeBox {...baseProps({ dormantActive: true })} />);
    const micBtn = screen.getByRole("button", { name: "Record voice" }) as HTMLButtonElement;
    expect(micBtn).toBeTruthy();
    expect(micBtn.disabled).toBe(false);
  });
});
