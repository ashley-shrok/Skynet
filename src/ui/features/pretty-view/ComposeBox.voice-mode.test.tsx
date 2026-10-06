// 2026-10-06 — integration tests for hands-free voice mode on the ComposeBox
// primary mic. With a `voiceModeFeed` (harness panes), long-pressing the mic
// toggles voice mode instead of hold-to-record-and-send. The user's
// requirement: voice mode must not take over anything it doesn't have to —
// e.g. paste into the compose box and hit Send while voice mode is on.
//
// Audio stack stubs mirror ComposeBox.hold-to-mic.test.tsx, plus an
// AudioContext/AnalyserNode whose level the test drives for VAD.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { ComposeBoxProps } from "./ComposeBox";
import { LONG_PRESS_ACTION_THRESHOLD_MS } from "./useHoldToRecord";
import { SILENCE_END_MS } from "./useVoiceMode";

vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "", queueSlots: [] }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));
vi.mock("../../api/voice-api", () => ({ postSpeakStream: vi.fn().mockResolvedValue({ ok: true, status: 200 }) }));

import { ComposeBox } from "./ComposeBox";

let level = 0;

class MockAudioContext {
  state = "running";
  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
  createAnalyser() {
    return {
      fftSize: 1024,
      getFloatTimeDomainData: (buf: Float32Array) => buf.fill(level),
    };
  }
  createMediaStreamSource() {
    return { connect: vi.fn() };
  }
}

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  mimeType = "audio/webm";
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: unknown) {
    MockMediaRecorder.instances.push(this);
  }
  start = vi.fn(() => {
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
    this.onstop?.();
  });
}

let getUserMedia: ReturnType<typeof vi.fn>;

function makeStream() {
  const track = { stop: vi.fn(), onended: null };
  return { getTracks: () => [track], getAudioTracks: () => [track] };
}

function props(overrides: Partial<ComposeBoxProps> = {}): ComposeBoxProps {
  return {
    onSend: vi.fn(() => true),
    hostId: 1,
    tmuxSession: "s1",
    canSend: true,
    voiceModeFeed: { isWorking: false, messages: [], voice: "Ruth" },
    ...overrides,
  };
}

function mic(): HTMLButtonElement {
  const btn = screen.getByRole("button", { name: /Record voice|Voice mode on/ }) as HTMLButtonElement;
  Object.defineProperty(btn, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 0, right: 40, top: 0, bottom: 40, x: 0, y: 0, width: 40, height: 40, toJSON: () => ({}) }),
  });
  return btn;
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function longPressMic() {
  const btn = mic();
  fireEvent.pointerDown(btn, { pointerId: 1, clientX: 20, clientY: 20, timeStamp: 0 });
  await flush(LONG_PRESS_ACTION_THRESHOLD_MS + 50);
  await act(async () => {
    fireEvent.pointerUp(btn, {
      pointerId: 1,
      clientX: 20,
      clientY: 20,
      timeStamp: LONG_PRESS_ACTION_THRESHOLD_MS + 50,
    });
  });
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  level = 0;
  MockMediaRecorder.instances = [];
  vi.stubGlobal("MediaRecorder", MockMediaRecorder);
  vi.stubGlobal("AudioContext", MockAudioContext);
  getUserMedia = vi.fn().mockImplementation(() => Promise.resolve(makeStream()));
  Object.defineProperty(globalThis, "navigator", {
    value: { mediaDevices: { getUserMedia } },
    writable: true,
    configurable: true,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ text: "spoken words" }) }),
  );
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ComposeBox — hands-free voice mode (mic long-press)", () => {
  it("long-press turns voice mode on instead of recording-and-sending; long-press again turns it off", async () => {
    const onSend = vi.fn((_text: string, _mqid?: string) => true);
    render(<ComposeBox {...props({ onSend })} />);

    await longPressMic();
    expect(screen.getByTestId("voice-mode-pill")).toBeTruthy();
    expect(screen.getByTestId("voice-mode-pill").getAttribute("data-phase")).toBe("listening");
    expect(mic().getAttribute("data-voice-mode")).toBe("true");
    // The hold itself sent nothing and left no RecordingControls behind.
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Cancel recording" })).toBeNull();

    await longPressMic();
    expect(screen.queryByTestId("voice-mode-pill")).toBeNull();
    expect(mic().getAttribute("data-voice-mode")).toBe("false");
  });

  it("pasted text + Send still works while voice mode is on, and spoken words go out separately without touching the textarea", async () => {
    const onSend = vi.fn((_text: string, _mqid?: string) => true);
    render(<ComposeBox {...props({ onSend })} />);
    await longPressMic();

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "pasted stack trace" } });

    // Speak while there is a draft in the box.
    level = 0.2;
    await flush(500);
    level = 0;
    await flush(SILENCE_END_MS + 200);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).toBe("spoken words");
    expect(textarea.value).toBe("pasted stack trace");

    // Typed send through the regular Send button.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend.mock.calls[1][0]).toBe("pasted stack trace");
    // Voice mode is still on.
    expect(screen.getByTestId("voice-mode-pill")).toBeTruthy();
  });

  it("the pill's close button turns voice mode off", async () => {
    render(<ComposeBox {...props()} />);
    await longPressMic();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Turn off voice mode" }));
    });
    expect(screen.queryByTestId("voice-mode-pill")).toBeNull();
  });

  it("without a voiceModeFeed (relay) long-press keeps hold-to-record-and-send", async () => {
    const onSend = vi.fn((_text: string, _mqid?: string) => true);
    render(<ComposeBox {...props({ onSend, voiceModeFeed: undefined })} />);
    const btn = mic();
    fireEvent.pointerDown(btn, { pointerId: 1, clientX: 20, clientY: 20, timeStamp: 0 });
    await flush(400);
    await act(async () => {
      fireEvent.pointerUp(btn, { pointerId: 1, clientX: 20, clientY: 20, timeStamp: 400 });
    });
    await flush(50);
    expect(screen.queryByTestId("voice-mode-pill")).toBeNull();
    expect(onSend).toHaveBeenCalledWith("spoken words", expect.any(String));
  });
});
