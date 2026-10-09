// 2026-10-06 — integration tests for hands-free voice mode on the ComposeBox.
// 2026-10-09: voice mode moved off the mic long-press onto its own button in
// the aux row (left of Stop); the status pill was folded into that button,
// which widens into a chip (phase + label, × to end) while voice mode is on.
// The user's requirement still holds: voice mode must not take over anything
// it doesn't have to — e.g. paste into the compose box and hit Send while
// voice mode is on.
//
// Audio stack stubs mirror ComposeBox.hold-to-mic.test.tsx, plus an
// AudioContext/AnalyserNode whose level the test drives for VAD.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { ComposeBoxProps } from "./ComposeBox";
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
    voiceModeFeed: { isWorking: false, messages: [], voices: ["Ruth"] },
    ...overrides,
  };
}

function mic(): HTMLButtonElement {
  const btn = screen.getByRole("button", { name: "Record voice" }) as HTMLButtonElement;
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

async function startVoiceMode() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Start voice mode" }));
  });
  await flush();
}

function chipPhase(): string | null {
  return screen.getByTestId("voice-mode-button").getAttribute("data-phase");
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

describe("ComposeBox — hands-free voice mode (aux-row button)", () => {
  it("the button turns voice mode on and becomes the status chip; × turns it off", async () => {
    const onSend = vi.fn((_text: string, _mqid?: string) => true);
    render(<ComposeBox {...props({ onSend })} />);
    expect(chipPhase()).toBe("off");

    await startVoiceMode();
    expect(chipPhase()).toBe("listening");
    expect(screen.getByRole("status").textContent).toBe("Listening");
    expect(screen.queryByRole("button", { name: "Start voice mode" })).toBeNull();
    // Starting sent nothing and left no RecordingControls behind.
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Cancel recording" })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "End voice mode" }));
    });
    expect(chipPhase()).toBe("off");
    expect(screen.getByRole("button", { name: "Start voice mode" })).toBeTruthy();
  });

  it("the voice-mode button sits left of Stop in the aux row", () => {
    render(<ComposeBox {...props({ onInterrupt: vi.fn() })} />);
    const vm = screen.getByTestId("voice-mode-button");
    const stop = screen.getByRole("button", { name: "Interrupt" });
    expect(vm.nextElementSibling).toBe(stop);
  });

  it("the chip shows when the agent is working while listening", async () => {
    render(<ComposeBox {...props({ voiceModeFeed: { isWorking: true, messages: [], voices: [] } })} />);
    await startVoiceMode();
    expect(screen.getByRole("status").textContent).toBe("Listening · agent working");
  });

  it("pasted text + Send still works while voice mode is on, and spoken words go out separately without touching the textarea", async () => {
    const onSend = vi.fn((_text: string, _mqid?: string) => true);
    render(<ComposeBox {...props({ onSend })} />);
    await startVoiceMode();

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
    expect(chipPhase()).toBe("listening");
  });

  it("tapping the mic while voice mode is on records manually and pauses voice mode", async () => {
    render(<ComposeBox {...props()} />);
    await startVoiceMode();

    const btn = mic();
    await act(async () => {
      fireEvent.pointerDown(btn, { pointerId: 2, clientX: 20, clientY: 20, timeStamp: 0 });
      fireEvent.pointerUp(btn, { pointerId: 2, clientX: 20, clientY: 20, timeStamp: 80 });
    });
    await flush(50);
    expect(screen.getByRole("button", { name: "Cancel recording" })).toBeTruthy();
    expect(chipPhase()).toBe("paused");
  });

  it("long-pressing the mic is hold-to-record-and-send again, with or without a voiceModeFeed", async () => {
    for (const voiceModeFeed of [props().voiceModeFeed, undefined]) {
      const onSend = vi.fn((_text: string, _mqid?: string) => true);
      const { unmount } = render(<ComposeBox {...props({ onSend, voiceModeFeed })} />);
      const btn = mic();
      fireEvent.pointerDown(btn, { pointerId: 1, clientX: 20, clientY: 20, timeStamp: 0 });
      await flush(700);
      await act(async () => {
        fireEvent.pointerUp(btn, { pointerId: 1, clientX: 20, clientY: 20, timeStamp: 700 });
      });
      await flush(50);
      expect(onSend).toHaveBeenCalledWith("spoken words", expect.any(String));
      if (voiceModeFeed) expect(chipPhase()).toBe("off");
      unmount();
    }
  });

  it("without a voiceModeFeed (relay) there is no voice-mode button", () => {
    render(<ComposeBox {...props({ voiceModeFeed: undefined })} />);
    expect(screen.queryByTestId("voice-mode-button")).toBeNull();
  });
});
