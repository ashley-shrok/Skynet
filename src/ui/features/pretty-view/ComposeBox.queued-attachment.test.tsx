// Regression suite: queued-slot attachment send (quick-260829-nt9).
//
// 5 tests covering queued-slot send entry points + guardrails:
//   Test 1 — handleQueueSlotSend WITH attachment → onSendWithAttachments
//   Test 2 — handleQueueSlotSend WITH attachment, outcome.ok=false → slot + chips preserved, error shown
//   Test 4 — handleVoiceSend slot-target WITH attachment → onSendWithAttachments
//   Test 5 — handleQueueSlotSend with NO attachment → text-only onSend path preserved
//   Test 6 — primary compose send with attachment still works (backward-compat)
//   Test 7 — attachment-only slot (empty text) is sendable, parity with primary
//
// Voice mock choice (Test 4): uses full MediaRecorder + fetch stub matching
// ComposeBox.voice.test.tsx. Reason: the voice-send path in ComposeBox calls
// voice.endSend() (from useVoiceRecording) which itself does the STT fetch
// round-trip. Mocking the hook module would diverge from the real integration;
// the MediaRecorder + fetch stub approach exercises the real hook and keeps
// this suite consistent with the adjacent voice test.
//
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import type { StagedAttachmentLike } from "./AttachmentChipStrip";
import type { ComposeBoxProps } from "./ComposeBox";

// Mock the compose-drafts API BEFORE importing ComposeBox (same rationale as
// ComposeBox.test.tsx — the module's mount effect uses the mock at first render).
vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "", queueSlots: [] }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

import { ComposeBox } from "./ComposeBox";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function baseProps(overrides: Partial<ComposeBoxProps> = {}): ComposeBoxProps {
  return {
    onSend: vi.fn(() => true),
    hostId: 1,
    tmuxSession: "s1",
    ...overrides,
  };
}

function mkAtt(
  tempId: string,
  name: string,
  size = 100,
  status: StagedAttachmentLike["status"] = "staged",
): StagedAttachmentLike {
  return {
    tempId,
    file: { name, size, type: "application/pdf" },
    status,
    bytesUploaded: 0,
    error: null,
  };
}

/** Flush async mount effects (getComposeDraft.then → setState). */
async function flushMountEffect() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Flush several microtask rounds for async-closure resolution. */
async function flushMicrotasks(rounds = 6) {
  await act(async () => {
    for (let i = 0; i < rounds; i++) await Promise.resolve();
  });
}

// ---------------------------------------------------------------------------
// MediaRecorder stub (mirrors ComposeBox.voice.test.tsx exactly)
// ---------------------------------------------------------------------------

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

  start = vi.fn().mockImplementation(() => {
    this.state = "recording";
  });
  stop = vi.fn().mockImplementation(() => {
    this.state = "inactive";
    if (this.onstop) this.onstop();
  });

  constructor(public stream: MediaStream) {
    MockMediaRecorder.instances.push(this);
  }

  emitData(blob: Blob) {
    if (this.ondataavailable) this.ondataavailable({ data: blob });
  }
}

// ---------------------------------------------------------------------------
// beforeEach / afterEach — install MediaRecorder + navigator stubs
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  MockMediaRecorder.instances = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).MediaRecorder = MockMediaRecorder;

  const mockStream = makeMockStream();
  const getUserMediaMock = vi.fn().mockResolvedValue(mockStream);
  Object.defineProperty(globalThis, "navigator", {
    value: { mediaDevices: { getUserMedia: getUserMediaMock } },
    writable: true,
    configurable: true,
  });

  // Default STT fetch: successful, returns "voice text".
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ text: "voice text" }),
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (vi.isFakeTimers()) vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ComposeBox — queued-slot attachment send (quick-260829-nt9)", () => {
  it("Test 1: handleQueueSlotSend WITH attachment routes to onSendWithAttachments", async () => {
    // No fake timers needed — handleQueueSlotSend is synchronously triggered;
    // no setTimeout advance required. Using real timers so waitFor works cleanly.

    const onSend = vi.fn(() => true);
    const clearStagedForTarget = vi.fn();
    const onSendWithAttachments = vi.fn(() =>
      Promise.resolve({ ok: true as const }),
    );

    // Slot IDs are auto-generated UUIDs; we capture the actual ID after render
    // via data-slot-id and configure the mock dynamically.
    let slotTarget = "";
    const getStagedAttachmentsForTarget = vi.fn((target: string) =>
      target === slotTarget ? [mkAtt("f1", "doc.pdf")] : [],
    );

    render(
      <ComposeBox
        {...baseProps({
          onSend,
          onSendWithAttachments,
          getStagedAttachmentsForTarget,
          clearStagedForTarget,
          onRemoveAttachment: vi.fn(),
        })}
      />,
    );
    await flushMountEffect();

    // Add one slot.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });

    // Capture the auto-generated slot ID so the mock returns an attachment for it.
    const slotContainer = document.querySelector("[data-slot-id]") as HTMLElement;
    expect(slotContainer).not.toBeNull();
    slotTarget = `queued:${slotContainer.getAttribute("data-slot-id")}`;

    const allTextareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const slotTextarea = allTextareas[0]; // slot renders before primary
    await act(async () => {
      fireEvent.change(slotTextarea, { target: { value: "hello" } });
    });

    // Click the slot Send button.
    const slotSendBtn = screen.getByRole("button", {
      name: /send queued message/i,
    }) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(slotSendBtn);
    });
    await flushMicrotasks();

    // onSendWithAttachments called once with (caption, target).
    expect(onSendWithAttachments).toHaveBeenCalledTimes(1);
    const [captionArg, targetArg] = onSendWithAttachments.mock.calls[0] as [string, string];
    expect(captionArg).toBe("hello");
    expect(targetArg).toBe(slotTarget);

    // text-only onSend NOT called.
    expect(onSend).not.toHaveBeenCalled();

    // After outcome.ok=true: slot removed from DOM.
    await waitFor(() => {
      expect(screen.getAllByRole("textbox").length).toBe(1); // primary only
    });

    // clearStagedForTarget called with the slot's target.
    expect(clearStagedForTarget).toHaveBeenCalledWith(slotTarget);
  });

  it("Test 2: handleQueueSlotSend WITH attachment, outcome.ok=false preserves slot + chips + surfaces error", async () => {
    // No fake timers needed — synchronous click path, no timer advance required.

    const onSend = vi.fn(() => true);
    const clearStagedForTarget = vi.fn();
    const onSendWithAttachments = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        reason: "upload_failed" as const,
        message: "boom",
      }),
    );

    // Same dynamic slot ID capture pattern as Test 1.
    let slotTarget = "";
    const getStagedAttachmentsForTarget = vi.fn((target: string) =>
      target === slotTarget ? [mkAtt("f1", "doc.pdf")] : [],
    );

    render(
      <ComposeBox
        {...baseProps({
          onSend,
          onSendWithAttachments,
          getStagedAttachmentsForTarget,
          clearStagedForTarget,
          onRemoveAttachment: vi.fn(),
        })}
      />,
    );
    await flushMountEffect();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });

    // Capture slot ID after render.
    const slotContainer2 = document.querySelector("[data-slot-id]") as HTMLElement;
    expect(slotContainer2).not.toBeNull();
    slotTarget = `queued:${slotContainer2.getAttribute("data-slot-id")}`;

    const allTextareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const slotTextarea = allTextareas[0];
    await act(async () => {
      fireEvent.change(slotTextarea, { target: { value: "hello" } });
    });

    const slotSendBtn = screen.getByRole("button", {
      name: /send queued message/i,
    }) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(slotSendBtn);
    });
    await flushMicrotasks();

    // onSendWithAttachments was called.
    expect(onSendWithAttachments).toHaveBeenCalledTimes(1);

    // Slot STILL in DOM after failure.
    expect(screen.getAllByRole("textbox").length).toBe(2);

    // clearStagedForTarget NOT called on failure.
    expect(clearStagedForTarget).not.toHaveBeenCalled();

    // Error message surfaced (upload_failed → "Upload failed — try again.").
    await waitFor(() => {
      expect(screen.getByText("Upload failed — try again.")).toBeTruthy();
    });
  });

  it("Test 4: handleVoiceSend slot-target WITH attachment routes to onSendWithAttachments", async () => {
    const onSend = vi.fn(() => true);
    const clearStagedForTarget = vi.fn();
    const onSendWithAttachments = vi.fn(() =>
      Promise.resolve({ ok: true as const }),
    );

    const getStagedAttachmentsForTarget = vi.fn((target: string) =>
      target.includes("queued:") ? [mkAtt("f1", "doc.pdf")] : [],
    );

    render(
      <ComposeBox
        {...baseProps({
          onSend,
          onSendWithAttachments,
          getStagedAttachmentsForTarget,
          clearStagedForTarget,
          onRemoveAttachment: vi.fn(),
        })}
      />,
    );
    await flushMountEffect();

    // Add one slot.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });

    // Tap the slot's MicButton to start recording.
    // Multiple "Record voice" buttons may be present (primary + slot).
    const micButtons = screen.getAllByRole("button", { name: /record voice/i });
    // Slot renders before primary in DOM; the first mic button belongs to the slot.
    await act(async () => {
      fireEvent.click(micButtons[0]);
    });

    // Wait for RecordingControls to appear (recording state).
    const sendTranscriptBtn = await screen.findByRole("button", {
      name: "Send transcript",
    });

    // Emit audio data and click Send transcript.
    await act(async () => {
      const recorder = MockMediaRecorder.instances[0];
      recorder.emitData(new Blob(["audio"], { type: "audio/webm" }));
    });

    await act(async () => {
      fireEvent.click(sendTranscriptBtn);
    });

    // Wait for STT fetch to resolve and the send path to complete.
    await flushMicrotasks(10);

    // onSendWithAttachments must have been called for the slot target.
    await waitFor(() => {
      expect(onSendWithAttachments).toHaveBeenCalledTimes(1);
    });

    const [captionArg, targetArg] = onSendWithAttachments.mock.calls[0] as [string, string];
    // Caption is the STT result "voice text" (collapsed).
    expect(captionArg).toBe("voice text");
    // Target is the queued slot's target.
    expect(targetArg).toMatch(/^queued:/);

    // text-only onSend NOT called for the slot.
    expect(onSend).not.toHaveBeenCalled();

    // Slot removed from DOM on success.
    await waitFor(() => {
      expect(screen.getAllByRole("textbox").length).toBe(1); // primary only
    });

    // clearStagedForTarget called with the slot's target.
    expect(clearStagedForTarget).toHaveBeenCalledTimes(1);
    expect(clearStagedForTarget.mock.calls[0][0]).toMatch(/^queued:/);
  });

  it("Test 5: handleQueueSlotSend with NO attachment preserves existing text-only path", async () => {
    // No vi.useFakeTimers() needed — this test exercises the synchronous
    // text-only onSend path, no timer advance required. waitFor stays on
    // real timers, which avoids the fake-timer / waitFor conflict.

    const onSend = vi.fn(() => true);
    const onSendWithAttachments = vi.fn(() =>
      Promise.resolve({ ok: true as const }),
    );
    // No attachments for any target.
    const getStagedAttachmentsForTarget = vi.fn(() => []);

    render(
      <ComposeBox
        {...baseProps({
          onSend,
          onSendWithAttachments,
          getStagedAttachmentsForTarget,
          onRemoveAttachment: vi.fn(),
        })}
      />,
    );
    await flushMountEffect();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });

    const allTextareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const slotTextarea = allTextareas[0];
    await act(async () => {
      fireEvent.change(slotTextarea, { target: { value: "just text" } });
    });

    const slotSendBtn = screen.getByRole("button", {
      name: /send queued message/i,
    }) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(slotSendBtn);
    });
    await flushMicrotasks();

    // text-only onSend called exactly once with the collapsed payload.
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("just text", expect.stringMatching(/^pv-optim-/));

    // onSendWithAttachments NOT called (no attachments staged).
    expect(onSendWithAttachments).not.toHaveBeenCalled();

    // Slot removed on success.
    await waitFor(() => {
      expect(screen.getAllByRole("textbox").length).toBe(1); // primary only
    });
  });

  it("Test 6: primary compose send with attachment still works (backward-compat)", async () => {
    const onSend = vi.fn(() => true);
    const onSendWithAttachments = vi.fn(() =>
      Promise.resolve({ ok: true as const }),
    );

    render(
      <ComposeBox
        {...baseProps({
          onSend,
          onSendWithAttachments,
          stagedAttachments: [mkAtt("p1", "primary.pdf")],
          onRemoveAttachment: vi.fn(),
          showPaperclip: false,
          onAttachFiles: vi.fn(),
        })}
      />,
    );
    await flushMountEffect();

    const textarea = screen.getByPlaceholderText(
      /message/i,
    ) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "primary caption" } });
    });

    const primarySendBtn = screen.getByRole("button", {
      name: "Send",
    }) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(primarySendBtn);
    });
    await flushMicrotasks();

    // onSendWithAttachments called for the primary path (caption present, attachment present).
    await waitFor(() => {
      expect(onSendWithAttachments).toHaveBeenCalledTimes(1);
    });

    const [captionArg] = onSendWithAttachments.mock.calls[0] as [string, string?];
    expect(captionArg).toBe("primary caption");

    // text-only onSend NOT called when attachment is present.
    expect(onSend).not.toHaveBeenCalled();
  });

  it("Test 7: attachment-only slot (empty text) enables Send and routes to onSendWithAttachments", async () => {
    const onSend = vi.fn(() => true);
    const onSendWithAttachments = vi.fn(() =>
      Promise.resolve({ ok: true as const }),
    );
    let slotTarget = "";
    const getStagedAttachmentsForTarget = vi.fn((target: string) =>
      target === slotTarget ? [mkAtt("f1", "doc.pdf")] : [],
    );
    const props = baseProps({
      onSend,
      onSendWithAttachments,
      getStagedAttachmentsForTarget,
      clearStagedForTarget: vi.fn(),
      onRemoveAttachment: vi.fn(),
    });

    const { rerender } = render(<ComposeBox {...props} />);
    await flushMountEffect();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });

    const slotSendBtn = () =>
      screen.getByRole("button", { name: /send queued message/i }) as HTMLButtonElement;
    // Empty slot with no attachments: nothing to send.
    expect(slotSendBtn().disabled).toBe(true);

    const slotContainer = document.querySelector("[data-slot-id]") as HTMLElement;
    slotTarget = `queued:${slotContainer.getAttribute("data-slot-id")}`;
    // Re-render so the slot picks up its staged attachment (in the app the
    // staged-attachment store change drives this re-render).
    rerender(<ComposeBox {...props} />);

    expect(slotSendBtn().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(slotSendBtn());
    });
    await flushMicrotasks();

    expect(onSendWithAttachments).toHaveBeenCalledTimes(1);
    const [captionArg, targetArg] = onSendWithAttachments.mock.calls[0] as [string, string];
    expect(captionArg).toBe("");
    expect(targetArg).toBe(slotTarget);
    expect(onSend).not.toHaveBeenCalled();
  });
});
