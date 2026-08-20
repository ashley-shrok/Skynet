// Integration tests for the ComposeBox voice flow (Phase 16, Plan 03).
//
// Covers ten key behaviors (post quick 260729-3y1 co-render refactor):
//   1. MicButton present when text="" + asideActive=false + no attachments
//   2. MicButton present when text is non-empty (co-renders with Send —
//      swap-in-single-slot pattern replaced by co-render at right-11 bottom-0.5)
//   3. MicButton absent when asideActive=true (X-for-Resume owns the slot)
//   4. Tapping MicButton calls navigator.mediaDevices.getUserMedia
//   5. After getUserMedia + MediaRecorder resolve, RecordingControls appear and MicButton is gone
//   6. Tapping Cancel returns to idle (MicButton visible, no fetch)
//   7. Tapping Append triggers fetch to /voice/transcribe and updates textarea
//   8. Tapping Send triggers fetch, then calls onSend prop (D-16-05 same-send-path assertion)
//   9. When fetch returns HTTP 500, state returns to idle with error visible
//  10. MicButton and Send both visible — co-render regression guard for the
//      idle + text-non-empty state (quick 260729-3y1)
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
  // Mirrors real MediaRecorder.state — starts "inactive", flips to "recording"
  // on start(), flips to "inactive" on stop(). useVoiceRecording's stopRecording()
  // guard reads this field (iOS Safari dropped-onstop cascade fix, quick-260808-1pa).
  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  start = vi.fn().mockImplementation(() => {
    this.state = "recording";
  });
  stop = vi.fn().mockImplementation(() => {
    // Automatically fire onstop after stop() is called (mirrors real behavior).
    this.state = "inactive";
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
    // Quick 260729-3y1: after the co-render refactor, Send button IS present
    // in the empty-text state (rendered disabled — nothing to send), because
    // the slot no longer uses a mutually-exclusive swap. Truth table row:
    // "idle, empty text | mic shown | Send shown (disabled — nothing to send)".
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("Test 2 (Vehicle C v2 2026-08-01): mic and arm-idle COEXIST on non-empty text (Ashley 260729-3y1 lock: mic always reachable)", async () => {
    // Vehicle C v2 (260801-75z): arm-idle affordance moved off the aux row
    // and onto each textarea. On non-empty primary text, three buttons
    // coexist: Mic (right-11), Arm-idle (right-21, one slot LEFT of mic),
    // and Send (right-1). Ashley UX rule: mic must stay reachable
    // regardless of textarea contents so voice capture can start without
    // clearing input first. Empty text hides ONLY the arm-idle button —
    // mic and Send still render (Send disabled when nothing to send).
    render(<ComposeBox {...baseProps()} />);
    const textarea = screen.getByPlaceholderText(/message/i);

    // Non-empty text → mic + arm-idle + Send all visible.
    fireEvent.change(textarea, { target: { value: "hello" } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Record voice" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Send when idle" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    });

    // Clear the text → mic + Send still visible; arm-idle hidden.
    fireEvent.change(textarea, { target: { value: "" } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Record voice" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Send when idle" })).toBeNull();
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

    // State returns to idle — MicButton + arm-idle + Send are ALL visible
    // after the append completes. Quick 260729-3y1: MicButton is no longer
    // gated by text length, so it co-renders alongside Send at right-11
    // bottom-0.5 even though the textarea now contains "hello world".
    // Vehicle C v2 (260801-75z): arm-idle button also renders on the
    // primary at right-21 bottom-0.5 whenever text.trim() !== "".
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Record voice" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Send when idle" })).toBeTruthy();
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
      // Phase 50 D-18: onSend widened to (text, mqid?).
      expect(onSend).toHaveBeenCalledWith("hello world", expect.stringMatching(/^pv-optim-/));
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

  it("Test 10 (Vehicle C v2 2026-08-01): mic + arm-idle + Send all coexist on non-empty text; empty text hides only arm-idle", async () => {
    // Vehicle C v2 (260801-75z) regression guard: the swap-in-single-slot
    // pattern (mic OR send depending on text length) was replaced by a
    // co-render pattern in patch 260729-3y1, and Vehicle C v2 adds a
    // third coexisting button (arm-idle) that appears whenever the
    // textarea has non-empty text. Empty text: mic + Send only. Non-empty
    // text: mic + arm-idle + Send. A future regression that
    // reintroduces mutual-exclusion between any of the three would fail
    // loudly here.
    render(<ComposeBox {...baseProps()} />);
    const textarea = screen.getByPlaceholderText(/message/i);

    // Empty text case: mic + Send visible, arm-idle hidden.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Record voice" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Send when idle" })).toBeNull();
    });

    // Non-empty text case: all three visible.
    fireEvent.change(textarea, { target: { value: "hello" } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Record voice" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Send when idle" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    });
  });

  it("Test 11: While STT fetch is in flight (voice.state === 'transcribing'), Send button renders a spinning Loader2, no paper-plane, still disabled with aria-label='Send' (quick 260730-lur)", async () => {
    // Quick 260730-lur: during the 1-3s STT round-trip we render a spinning
    // Loader2 in the send-button slot so Ashley gets in-button feedback that
    // her Send-transcript tap registered. Freeze the transcribing state by
    // stubbing fetch with a never-resolving promise (overrides the beforeEach
    // default). afterEach's vi.unstubAllGlobals() cleans up.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    render(<ComposeBox {...baseProps()} />);

    const micBtn = screen.getByRole("button", { name: "Record voice" });
    fireEvent.click(micBtn);

    // Wait for recording controls.
    const sendTranscriptBtn = await screen.findByRole("button", { name: "Send transcript" });

    // Push a data chunk so the emitted blob is non-empty (mirrors Test 8).
    act(() => {
      const recorder = MockMediaRecorder.instances[0];
      recorder.emitData(new Blob(["audio"], { type: "audio/webm" }));
    });

    fireEvent.click(sendTranscriptBtn);

    // With fetch frozen the hook stays in "transcribing" — RecordingControls
    // unmount and the disabled Send button re-appears with the spinner in its
    // icon slot. Wait for the Send button to re-appear.
    const sendBtn = await waitFor(() => {
      const btn = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      return btn;
    });

    // Assert the four properties per plan <behavior>:
    //   1. Contains a spinning Loader2 (svg.animate-spin).
    const spinner = sendBtn.querySelector("svg.animate-spin");
    expect(spinner).not.toBeNull();
    //   2. Does NOT contain the paper-plane path.
    const paperPlanePath = sendBtn.querySelector('path[d^="M14.536 21.686"]');
    expect(paperPlanePath).toBeNull();
    //   3. Is disabled (asserted above via waitFor).
    expect(sendBtn.disabled).toBe(true);
    //   4. Keeps aria-label="Send" (T-16-16 double-fire guard preserved —
    //      button semantics unchanged, only the icon swaps).
    expect(sendBtn.getAttribute("aria-label")).toBe("Send");
  });

  it("Test 12: Idle regression guard — Send button renders the paper-plane inline SVG and NO animate-spin (patch #130 byte-preservation guard, quick 260730-lur)", async () => {
    // Idle branch (no MicButton click, voice.state === "idle") MUST still
    // render the verbatim paper-plane inline SVG from Ashley's DevTools console
    // snippet (patch #130). Proves the spinner is scoped to the transcribing
    // branch and the paper-plane path is preserved byte-for-byte.
    render(<ComposeBox {...baseProps()} />);
    const sendBtn = await screen.findByRole("button", { name: "Send" });
    // Paper-plane path present.
    const paperPlanePath = sendBtn.querySelector('path[d^="M14.536 21.686"]');
    expect(paperPlanePath).not.toBeNull();
    // No animate-spin inside the send button.
    const spinner = sendBtn.querySelector("svg.animate-spin");
    expect(spinner).toBeNull();
  });

  it("Test 13 (quick 260803-7vf): reset-while-recording glues transcript onto textarea body and dispatches `/id reset (glued)`", async () => {
    // Ashley 2026-08-03: "if you are recording and you hit the reset button,
    // then it essentially combines the functionality of the send button when
    // you're recording and the functionality of the reset button." One click,
    // one motion, one dispatch. Fire sync fx immediately (patch #122 latency
    // guarantee: onResetClicked before the ~1-3s STT round-trip), then after
    // endSend resolves dispatch `/id reset (glued)` where glued = textarea
    // body + " " + transcript.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ text: "and one more thing" }),
      }),
    );
    const onSend = vi.fn(() => true);
    const onResetClicked = vi.fn();
    render(<ComposeBox {...baseProps({ onSend, onResetClicked })} />);

    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hi there" } });

    const micBtn = screen.getByRole("button", { name: "Record voice" });
    fireEvent.click(micBtn);

    // Wait for recording controls to confirm recording state.
    await screen.findByRole("button", { name: "Send transcript" });

    // Push a data chunk so the blob is non-empty (mirrors Test 8).
    act(() => {
      const recorder = MockMediaRecorder.instances[0];
      recorder.emitData(new Blob(["audio"], { type: "audio/webm" }));
    });

    const resetBtn = screen.getByRole("button", { name: "Reset context window" });
    fireEvent.click(resetBtn);

    // onResetClicked fires SYNC on click (patch #122 latency guarantee) —
    // no waitFor needed for this assertion; it MUST have fired before the
    // await voice.endSend even resolves.
    expect(onResetClicked).toHaveBeenCalled();

    // onSend fires with the glued payload after endSend resolves.
    await waitFor(() => {
      // /id reset path uses dispatchResetPayload (single-arg onSend),
      // NOT handleSend — Phase 50 D-18's mqid threading is scoped to
      // primary handleSend only. This assertion stays single-arg.
      expect(onSend).toHaveBeenCalledWith("/id reset (hi there and one more thing)");
    });

    // Textarea cleared after successful dispatch.
    await waitFor(() => {
      expect(textarea.value).toBe("");
    });
  });

  it("Test 14 (quick 260803-7vf): reset-while-recording with STT failure falls back to dispatch with existing textarea body", async () => {
    // Locked design decision #4: reset ALWAYS dispatches when the user
    // pressed reset. STT failure MUST NOT produce a silent no-op — fall
    // back to the existing textarea body so Ashley still gets a reset
    // with contextual hint attached.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "internal server error" }),
      }),
    );
    const onSend = vi.fn(() => true);
    const onResetClicked = vi.fn();
    render(<ComposeBox {...baseProps({ onSend, onResetClicked })} />);

    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "existing body" } });

    const micBtn = screen.getByRole("button", { name: "Record voice" });
    fireEvent.click(micBtn);

    await screen.findByRole("button", { name: "Send transcript" });

    act(() => {
      const recorder = MockMediaRecorder.instances[0];
      recorder.emitData(new Blob(["audio"], { type: "audio/webm" }));
    });

    const resetBtn = screen.getByRole("button", { name: "Reset context window" });
    fireEvent.click(resetBtn);

    expect(onResetClicked).toHaveBeenCalled();

    // KEY assertion: onSend fires with the EXISTING textarea body — NOT
    // plain "/id reset", NOT a silent no-op.
    await waitFor(() => {
      // /id reset path uses dispatchResetPayload (single-arg onSend),
      // NOT handleSend — Phase 50 D-18's mqid threading is scoped to
      // primary handleSend only. This assertion stays single-arg.
      expect(onSend).toHaveBeenCalledWith("/id reset (existing body)");
    });
  });

  it("Test 15 (quick 260803-7vf): transcribing state disables the reset button", async () => {
    // Locked design decision #5: transcribing gate mirrors the send-button
    // transcribing-disable pattern to prevent double-fire. Freeze the
    // transcribing state with a never-resolving fetch (mirrors Test 11).
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    render(<ComposeBox {...baseProps()} />);

    const micBtn = screen.getByRole("button", { name: "Record voice" });
    fireEvent.click(micBtn);

    const sendTranscriptBtn = await screen.findByRole("button", { name: "Send transcript" });

    act(() => {
      const recorder = MockMediaRecorder.instances[0];
      recorder.emitData(new Blob(["audio"], { type: "audio/webm" }));
    });

    fireEvent.click(sendTranscriptBtn);

    // With fetch frozen the hook stays in "transcribing" — the reset button
    // must render disabled.
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: "Reset context window" }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });
});
