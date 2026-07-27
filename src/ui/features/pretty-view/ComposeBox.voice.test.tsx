// Integration tests for the ComposeBox voice flow (Phase 16, Plan 03).
//
// Covers the nine key behaviors:
//   1. MicButton present when text="" + asideActive=false + no attachments
//   2. MicButton absent when text is non-empty (Send button owns the slot)
//   3. MicButton absent when asideActive=true (X-for-Resume owns the slot)
//   4. Tapping MicButton calls navigator.mediaDevices.getUserMedia
//   5. After getUserMedia + MediaRecorder resolve, RecordingControls appear and MicButton is gone
//   6. Tapping Cancel returns to idle (MicButton visible, no fetch)
//   7. Tapping Append triggers fetch to /voice/transcribe and updates textarea
//   8. Tapping Send triggers fetch, then calls onSend prop (D-16-05 same-send-path assertion)
//   9. When fetch returns HTTP 500, state returns to idle with error visible
//
// Setup mirrors ComposeBox.test.tsx exactly:
//   - vi.mock("@/api/compose-drafts-api") before importing ComposeBox
//   - Same baseProps helper
//   - MockMediaRecorder + getUserMedia + fetch mocked in beforeEach
//
// Do NOT modify ComposeBox.test.tsx / ComposeBox.aside-morph.test.tsx /
// ComposeBox.aside-props.test.tsx — this file is the additive voice test suite.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import type { ComposeBoxProps } from "./ComposeBox";

// Mock the compose-drafts API BEFORE importing ComposeBox so the module's
// effect uses the mock at first render (same rationale as ComposeBox.test.tsx).
vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "" }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

import { ComposeBox } from "./ComposeBox";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function baseProps(overrides: Partial<ComposeBoxProps> = {}): ComposeBoxProps {
  return {
    onSend: vi.fn(() => true),
    hostId: 1,
    tmuxSession: "s1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock infrastructure (mirrors useVoiceRecording.test.ts patterns)
// ---------------------------------------------------------------------------

/** Minimal MediaStream stub: getTracks() returns one stoppable track. */
function makeMockStream() {
  const track = { stop: vi.fn() };
  return {
    getTracks: vi.fn(() => [track]),
    _track: track,
  };
}

/** Minimal MediaRecorder stub. Tests can trigger ondataavailable / onstop manually. */
class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];

  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  start = vi.fn();
  stop = vi.fn().mockImplementation(() => {
    // Automatically fire onstop after stop() is called (mirrors real behavior).
    if (this.onstop) this.onstop();
  });

  constructor(public stream: MediaStream) {
    MockMediaRecorder.instances.push(this);
  }

  /** Helper for tests to push a data chunk as if the recorder emitted it. */
  emitData(blob: Blob) {
    if (this.ondataavailable) this.ondataavailable({ data: blob });
  }
}

// ---------------------------------------------------------------------------
// beforeEach / afterEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();

  MockMediaRecorder.instances = [];
  // Assign stub MediaRecorder to globalThis.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).MediaRecorder = MockMediaRecorder;

  // Stub navigator.mediaDevices.getUserMedia to resolve with a mock stream.
  // This ALSO satisfies the showMicButton `navigator.mediaDevices != null` guard
  // so the MicButton renders in these tests (unlike the existing test suite
  // which does not mock mediaDevices and therefore still sees the Send button).
  const mockStream = makeMockStream();
  const getUserMediaMock = vi.fn().mockResolvedValue(mockStream);
  Object.defineProperty(globalThis, "navigator", {
    value: {
      mediaDevices: {
        getUserMedia: getUserMediaMock,
      },
    },
    writable: true,
    configurable: true,
  });

  // Default fetch mock: successful STT response returning "hello world".
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ text: "hello world" }),
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ComposeBox — Phase 16 voice flow", () => {

  it("Test 1: MicButton is present when text is empty, asideActive is false, and no attachments", () => {
    render(
      <ComposeBox
        {...baseProps({
          asideActive: false,
        })}
      />,
    );
    // MicButton renders with aria-label "Record voice" in the slot.
    const micBtn = screen.getByRole("button", { name: "Record voice" });
    expect(micBtn).toBeTruthy();
    // The Send button must NOT be present in the empty-text state
    // (the MicButton owns the slot; send comes back once text is typed).
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("Test 2: MicButton is NOT present when text is non-empty; Send button owns the slot", async () => {
    render(<ComposeBox {...baseProps()} />);
    const textarea = screen.getByPlaceholderText(/message/i);
    // Type some text into the textarea.
    fireEvent.change(textarea, { target: { value: "hello" } });
    // After typing, voice is still idle but text is non-empty → Send renders.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Record voice" })).toBeNull();
      expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    });
  });

  it("Test 3: MicButton is NOT present when asideActive=true; Resume button owns the slot", () => {
    render(
      <ComposeBox
        {...baseProps({
          asideActive: true,
          onAsideDismiss: vi.fn(),
        })}
      />,
    );
    // When asideActive, the button morphs to Resume — MicButton must NOT appear.
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record voice" })).toBeNull();
  });

  it("Test 4: Tapping the MicButton calls navigator.mediaDevices.getUserMedia with {audio: true}", () => {
    render(<ComposeBox {...baseProps()} />);
    const micBtn = screen.getByRole("button", { name: "Record voice" });
    fireEvent.click(micBtn);
    // getUserMedia must have been called synchronously inside the tap handler
    // (D-16-02 iOS Safari sync-getUserMedia constraint).
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it("Test 5: After getUserMedia + MediaRecorder resolve, RecordingControls appear and MicButton is gone", async () => {
    render(<ComposeBox {...baseProps()} />);
    const micBtn = screen.getByRole("button", { name: "Record voice" });
    fireEvent.click(micBtn);

    // After the getUserMedia promise resolves and MediaRecorder is set up,
    // the hook transitions to "recording" state. Use findByLabelText for
    // polling auto-wait.
    const cancelBtn = await screen.findByRole("button", { name: "Cancel recording" });
    const appendBtn = await screen.findByRole("button", { name: "Append transcript" });
    const sendBtn = await screen.findByRole("button", { name: "Send transcript" });

    expect(cancelBtn).toBeTruthy();
    expect(appendBtn).toBeTruthy();
    expect(sendBtn).toBeTruthy();
    // MicButton is gone while recording.
    expect(screen.queryByRole("button", { name: "Record voice" })).toBeNull();
    // The original send button (paper-plane) is also gone.
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("Test 6: Tapping Cancel returns to idle-with-empty-text state (MicButton visible, no fetch)", async () => {
    render(<ComposeBox {...baseProps()} />);
    const micBtn = screen.getByRole("button", { name: "Record voice" });
    fireEvent.click(micBtn);

    // Wait for recording state.
    const cancelBtn = await screen.findByRole("button", { name: "Cancel recording" });
    fireEvent.click(cancelBtn);

    // After cancel, voice returns to idle + text was never changed → MicButton shows again.
    await screen.findByRole("button", { name: "Record voice" });
    // No fetch to /voice/transcribe was made.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("Test 7: Tapping Append triggers fetch to /voice/transcribe and updates textarea; onSend NOT called", async () => {
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend })} />);

    const micBtn = screen.getByRole("button", { name: "Record voice" });
    fireEvent.click(micBtn);

    // Wait for recording controls.
    const appendBtn = await screen.findByRole("button", { name: "Append transcript" });

    // Push a data chunk before stopping so the blob is non-empty.
    act(() => {
      const recorder = MockMediaRecorder.instances[0];
      recorder.emitData(new Blob(["audio"], { type: "audio/webm" }));
    });

    fireEvent.click(appendBtn);

    // Wait for the fetch to complete and the textarea to update.
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(textarea.value).toBe("hello world");
    });

    // Fetch was called to /voice/transcribe.
    expect(fetch).toHaveBeenCalledTimes(1);
    const [fetchUrl] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(fetchUrl).toBe("/voice/transcribe");

    // onSend from props was NOT called — append does not send.
    expect(onSend).not.toHaveBeenCalled();

    // State returns to idle — MicButton visible again (text is now "hello world"
    // so showMicButton=false; but Send button should be present).
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    });
  });

  it("Test 8: Tapping Send triggers fetch and calls onSend with the transcribed payload (D-16-05 assertion)", async () => {
    // D-16-05: voice.endSend MUST route through the SAME handleSend() path
    // that typed sends use — this test proves it by asserting props.onSend
    // is called with the transcribed payload.
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend })} />);

    const micBtn = screen.getByRole("button", { name: "Record voice" });
    fireEvent.click(micBtn);

    // Wait for recording controls.
    const sendTranscriptBtn = await screen.findByRole("button", { name: "Send transcript" });

    // Push a data chunk.
    act(() => {
      const recorder = MockMediaRecorder.instances[0];
      recorder.emitData(new Blob(["audio"], { type: "audio/webm" }));
    });

    fireEvent.click(sendTranscriptBtn);

    // Wait for onSend to be called with the transcribed payload.
    // Starting text was "" and transcript is "hello world" → glued = "hello world".
    // handleSend trims the payload before dispatch, so onSend receives "hello world".
    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("hello world");
    });

    // Fetch was called to /voice/transcribe.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("Test 9: When fetch returns HTTP 500, state returns to idle and an error message is visible", async () => {
    // Override fetch mock to return a 500 error.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "internal server error" }),
      }),
    );

    render(<ComposeBox {...baseProps()} />);

    const micBtn = screen.getByRole("button", { name: "Record voice" });
    fireEvent.click(micBtn);

    // Wait for recording state.
    const appendBtn = await screen.findByRole("button", { name: "Append transcript" });

    act(() => {
      const recorder = MockMediaRecorder.instances[0];
      recorder.emitData(new Blob(["audio"], { type: "audio/webm" }));
    });

    fireEvent.click(appendBtn);

    // After the 500, state returns to idle and the voice.errorMessage is shown.
    // The hook sets errorMessage = "STT error: 500" on non-2xx responses.
    await waitFor(() => {
      const errorEl = screen.queryByText(/STT error/i);
      expect(errorEl).toBeTruthy();
    });
  });
});
