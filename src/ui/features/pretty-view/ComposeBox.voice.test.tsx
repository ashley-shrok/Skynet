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
import { autoAnswerKitDialogs, __resetKitDialogsForTests } from "@/components/kit";
import type { ComposeBoxProps } from "./ComposeBox";

// Mock the compose-drafts API BEFORE importing ComposeBox so the module's
// effect uses the mock at first render (same rationale as ComposeBox.test.tsx).
vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "" }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

// Condense conversation posts through authApi.post — mock it so voice tests
// can drive the condense-while-recording flow.
vi.mock("@/main-axios", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    authApi: {
      post: vi.fn().mockResolvedValue({ status: 200, data: { ok: true } }),
      get: vi.fn(),
    },
  };
});

import { ComposeBox } from "./ComposeBox";
import { authApi } from "@/main-axios";

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
  // Cross-user leak fix: compose-draft keys are namespaced by the
  // currently-logged-in user. Seed skynet_auth so the key factory emits the
  // canonical production shape (not the "__anon" fallback).
  localStorage.setItem(
    "skynet_auth",
    JSON.stringify({ loggedIn: true, username: "test-user" }),
  );

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

  // Condense shows a kit confirm (kitConfirm) first. Auto-accept in tests
  // that click it — the confirm gate itself is covered by
  // ComposeBox.condense.test.tsx.
  autoAnswerKitDialogs({ confirm: true });
});

afterEach(() => {
  __resetKitDialogsForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Condense conversation lives in the memory gauge's pop-over. Opens the
// pop-over and returns the Condense conversation button.
async function openCondense(): Promise<HTMLButtonElement> {
  fireEvent.click(screen.getByTestId("memory-gauge"));
  return (await screen.findByRole("button", { name: "Condense conversation" })) as HTMLButtonElement;
}

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
    // shape-conversation-view: with nothing typed the main button is the
    // thumbs-up (Send renders once there's something to send); the mic sits
    // beside it either way.
    expect(screen.getByRole("button", { name: "Send 'thumbs up'" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("Test 2 (user 260729-3y1 lock: mic always reachable): mic + main button coexist regardless of textarea content", async () => {
    // user UX rule: mic must stay reachable regardless of textarea contents
    // so voice capture can start without clearing input first.
    render(<ComposeBox {...baseProps()} />);
    const textarea = screen.getByPlaceholderText(/message/i);

    fireEvent.change(textarea, { target: { value: "hello" } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Record voice" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    });

    fireEvent.change(textarea, { target: { value: "" } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Record voice" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Send 'thumbs up'" })).toBeTruthy();
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
    // Trailing space appended per fix 49b5712d — enables seamless
    // multi-chunk dictation (subsequent chunks concatenate cleanly).
    await waitFor(() => {
      expect(textarea.value).toBe("hello world ");
    });

    // Fetch was called to /voice/transcribe.
    expect(fetch).toHaveBeenCalledTimes(1);
    const [fetchUrl] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(fetchUrl).toBe("/voice/transcribe");

    // onSend from props was NOT called — append does not send.
    expect(onSend).not.toHaveBeenCalled();

    // State returns to idle — MicButton + Send are both visible
    // after the append completes. Quick 260729-3y1: MicButton is no longer
    // gated by text length, so it co-renders alongside Send at right-11
    // bottom-0.5 even though the textarea now contains "hello world".
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Record voice" })).toBeTruthy();
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

  it("Test 10: mic + main button coexist regardless of text length (260729-3y1 lock)", async () => {
    // Regression guard against the pre-260729-3y1 swap-in-single-slot
    // pattern (mic OR send depending on text length) — both must coexist
    // whether the textarea is empty or non-empty.
    render(<ComposeBox {...baseProps()} />);
    const textarea = screen.getByPlaceholderText(/message/i);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Record voice" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Send 'thumbs up'" })).toBeTruthy();
    });

    fireEvent.change(textarea, { target: { value: "hello" } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Record voice" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    });
  });

  it("Test 11: While STT fetch is in flight (voice.state === 'transcribing'), Send button renders a spinning Loader2, no paper-plane, still disabled with aria-label='Send' (quick 260730-lur)", async () => {
    // Quick 260730-lur: during the 1-3s STT round-trip we render a spinning
    // Loader2 in the send-button slot so user gets in-button feedback that
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
    // render the verbatim paper-plane inline SVG from user's DevTools console
    // snippet (patch #130). Proves the spinner is scoped to the transcribing
    // branch and the paper-plane path is preserved byte-for-byte.
    render(<ComposeBox {...baseProps()} />);
    // Send renders once there's something to send.
    fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: "hi" } });
    const sendBtn = await screen.findByRole("button", { name: "Send" });
    // Paper-plane path present.
    const paperPlanePath = sendBtn.querySelector('path[d^="M14.536 21.686"]');
    expect(paperPlanePath).not.toBeNull();
    // No animate-spin inside the send button.
    const spinner = sendBtn.querySelector("svg.animate-spin");
    expect(spinner).toBeNull();
  });

  it("Test 13 (quick 260803-7vf): condense-while-recording glues transcript onto textarea body and sends it as guidance", async () => {
    // user 2026-08-03 (originally for reset): pressing it while recording
    // combines the send-while-recording behaviour with the button's own —
    // one click, one request. After endSend resolves, the condense request
    // carries guidance = textarea body + " " + transcript.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ text: "and one more thing" }),
      }),
    );
    const onSend = vi.fn(() => true);
    const onCondenseRequested = vi.fn();
    render(<ComposeBox {...baseProps({ onSend, onCondenseRequested })} />);

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

    fireEvent.click(await openCondense());

    // onCondenseRequested fires on request SUCCESS (authApi.post resolves
    // {ok:true}), after endSend resolves. No identityKey prop → the key
    // falls back to the tmux session.
    const postMock = authApi.post as ReturnType<typeof vi.fn>;
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        "/identities/s1/condense",
        { hostId: 1, guidance: "hi there and one more thing" },
      );
    });
    // onSend must NOT have been called (condense routes off the funnel).
    expect(onSend).not.toHaveBeenCalled();
    await waitFor(() => expect(onCondenseRequested).toHaveBeenCalled());

    // Textarea cleared after successful dispatch.
    await waitFor(() => {
      expect(textarea.value).toBe("");
    });
  });

  it("Test 14 (quick 260803-7vf): condense-while-recording with STT failure falls back to the existing textarea body as guidance", async () => {
    // Locked design decision #4: the request ALWAYS goes when the user
    // pressed the button. STT failure MUST NOT produce a silent no-op —
    // fall back to the existing textarea body as guidance.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "internal server error" }),
      }),
    );
    const onSend = vi.fn(() => true);
    const onCondenseRequested = vi.fn();
    render(<ComposeBox {...baseProps({ onSend, onCondenseRequested })} />);

    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "existing body" } });

    const micBtn = screen.getByRole("button", { name: "Record voice" });
    fireEvent.click(micBtn);

    await screen.findByRole("button", { name: "Send transcript" });

    act(() => {
      const recorder = MockMediaRecorder.instances[0];
      recorder.emitData(new Blob(["audio"], { type: "audio/webm" }));
    });

    fireEvent.click(await openCondense());

    // KEY assertion: the request goes with the EXISTING textarea body as
    // guidance — NOT a silent no-op.
    const postMock = authApi.post as ReturnType<typeof vi.fn>;
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        "/identities/s1/condense",
        { hostId: 1, guidance: "existing body" },
      );
    });
    expect(onSend).not.toHaveBeenCalled();
    await waitFor(() => expect(onCondenseRequested).toHaveBeenCalled());
  });

  it("Test 15 (quick 260803-7vf): transcribing state disables Condense conversation", async () => {
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

    // With fetch frozen the hook stays in "transcribing" — wait for the
    // transcribing Send spinner, then Condense conversation must render disabled.
    await waitFor(() => {
      const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
      expect(send.querySelector("svg.animate-spin")).not.toBeNull();
    });
    const btn = await openCondense();
    expect(btn.disabled).toBe(true);
  });

  it("Test 16: Append with empty transcript + empty textarea leaves textarea empty (no lone space)", async () => {
    // STT returns {text:""} — e.g. mic muted / silence / no speech detected.
    // With baseText also empty, the textarea MUST NOT gain a lone trailing
    // space (bounty voice-empty-transcript-silent-noop UX symptom fix).
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ text: "" }),
      }),
    );

    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend })} />);

    const micBtn = screen.getByRole("button", { name: "Record voice" });
    fireEvent.click(micBtn);

    const appendBtn = await screen.findByRole("button", { name: "Append transcript" });

    act(() => {
      const recorder = MockMediaRecorder.instances[0];
      recorder.emitData(new Blob(["audio"], { type: "audio/webm" }));
    });

    fireEvent.click(appendBtn);

    // State returns to idle (MicButton re-renders) — proves the append
    // round-trip completed.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Record voice" })).toBeTruthy();
    });

    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("Test 17: Send with empty transcript + empty textarea does not fire onSend and leaves textarea empty", async () => {
    // Symmetric to Test 16 for the Send button. Empty-empty send MUST NOT
    // dispatch an empty payload through handleSend.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ text: "" }),
      }),
    );

    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend })} />);

    const micBtn = screen.getByRole("button", { name: "Record voice" });
    fireEvent.click(micBtn);

    const sendTranscriptBtn = await screen.findByRole("button", { name: "Send transcript" });

    act(() => {
      const recorder = MockMediaRecorder.instances[0];
      recorder.emitData(new Blob(["audio"], { type: "audio/webm" }));
    });

    fireEvent.click(sendTranscriptBtn);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Record voice" })).toBeTruthy();
    });

    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
    expect(onSend).not.toHaveBeenCalled();
  });
  it("a cancelled send's words coming back mid-transcription are kept: the transcript lands after the draft as it is now", async () => {
    let resolveFetch!: (v: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((r) => { resolveFetch = r; })));
    const { rerender } = render(<ComposeBox {...baseProps()} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "draft" } });

    fireEvent.click(screen.getByRole("button", { name: "Record voice" }));
    const appendBtn = await screen.findByRole("button", { name: "Append transcript" });
    act(() => {
      MockMediaRecorder.instances[0].emitData(new Blob(["audio"], { type: "audio/webm" }));
    });
    fireEvent.click(appendBtn);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    rerender(<ComposeBox {...baseProps({ restoreRequest: { id: "r1", text: "older words" } })} />);
    expect(textarea.value).toBe("older words\n\ndraft");

    await act(async () => {
      resolveFetch({ ok: true, status: 200, json: () => Promise.resolve({ text: "hello world" }) });
    });
    await waitFor(() => expect(textarea.value).toBe("older words\n\ndraft hello world "));
  });

  it("a dictated blocked command sent straight from the mic is dropped: nothing sent, the box goes back to its draft, the refusal line shows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ text: "/clear" }) }),
    );
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend })} />);

    fireEvent.click(screen.getByRole("button", { name: "Record voice" }));
    const sendTranscriptBtn = await screen.findByRole("button", { name: "Send transcript" });
    act(() => {
      MockMediaRecorder.instances[0].emitData(new Blob(["audio"], { type: "audio/webm" }));
    });
    fireEvent.click(sendTranscriptBtn);

    await screen.findByText("That command can't be used here.");
    expect(onSend).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });
});
