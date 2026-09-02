// Regression suite: queued-slot attachment send (quick-260829-nt9).
//
// 6 tests covering three queued-slot send entry points + two guardrails:
//   Test 1 — handleQueueSlotSend WITH attachment → onSendWithAttachments
//   Test 2 — handleQueueSlotSend WITH attachment, outcome.ok=false → slot + chips preserved, error shown
//   Test 3 — fireNextQueued (cadence) WITH attachment → onSendWithAttachments
//   Test 4 — handleVoiceSend slot-target WITH attachment → onSendWithAttachments
//   Test 5 — handleQueueSlotSend with NO attachment → text-only onSend path preserved
//   Test 6 — primary compose send with attachment still works (backward-compat)
//
// Tests 1-4 fail RED before the production changes in Task 2 land (those entry
// points currently route through text-only onSend and discard staged
// attachments). Tests 5-6 pass from the start (guardrails — preserved paths).
//
// Voice mock choice (Test 4): uses full MediaRecorder + fetch stub matching
// ComposeBox.voice.test.tsx. Reason: the voice-send path in ComposeBox calls
// voice.endSend() (from useVoiceRecording) which itself does the STT fetch
// round-trip. Mocking the hook module would diverge from the real integration;
// the MediaRecorder + fetch stub approach exercises the real hook and keeps
// this suite consistent with the adjacent voice test.
//
// Cadence mock choice (Test 3): uses isIdle=true prop + vi.useFakeTimers() +
// vi.advanceTimersByTime(3001) — the same seam the idle watchdog effect
// uses. The slot is armed via its "Send when idle" button before advancing
// time. This mirrors how ComposeBox.test.tsx exercises the arm-idle feature.

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

  it("Test 3: fireNextQueued WITH attachment on head-of-queue routes to onSendWithAttachments", async () => {
    vi.useFakeTimers();
    // Note: Test 3 uses fake timers specifically to advance the 3000ms idle
    // watchdog timer. waitFor calls in this test use flushMicrotasks/act
    // instead of waitFor so there is no fake-timer / waitFor conflict.

    const onSend = vi.fn(() => true);
    const clearStagedForTarget = vi.fn();
    const onSendWithAttachments = vi.fn(() =>
      Promise.resolve({ ok: true as const }),
    );

    // We don't know the auto-generated slot IDs ahead of time, so we
    // capture the slot IDs after adding slots and return an attachment
    // for the first slot only (head). The getStagedAttachmentsForTarget
    // mock is set up dynamically after slots are rendered.
    // Start with an empty implementation; we'll update it after rendering.
    let headSlotTarget = "";
    const getStagedAttachmentsForTarget = vi.fn((target: string) =>
      target === headSlotTarget ? [mkAtt("f1", "doc.pdf")] : [],
    );

    render(
      <ComposeBox
        {...baseProps({
          onSend,
          onSendWithAttachments,
          getStagedAttachmentsForTarget,
          clearStagedForTarget,
          onRemoveAttachment: vi.fn(),
          // isIdle=true enables the idle watchdog once queue is armed.
          isIdle: true,
        })}
      />,
    );
    await flushMountEffect();

    // Add two slots.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });

    // Capture the auto-generated slot IDs via data-slot-id so we can configure
    // getStagedAttachmentsForTarget to return an attachment for the head slot.
    const slotContainers = document.querySelectorAll("[data-slot-id]");
    expect(slotContainers.length).toBeGreaterThanOrEqual(2);
    // slots render before primary: index 0 = first slot (head)
    headSlotTarget = `queued:${slotContainers[0].getAttribute("data-slot-id")}`;

    const allTextareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    // slots render before primary: index 0 = first slot (head), index 1 = second slot (tail).
    const headTextarea = allTextareas[0];
    const tailTextarea = allTextareas[1];

    await act(async () => {
      fireEvent.change(headTextarea, { target: { value: "first" } });
    });
    await act(async () => {
      fireEvent.change(tailTextarea, { target: { value: "second" } });
    });

    // Arm the head slot for idle-send by clicking its "Send when idle" button.
    const armButtons = screen.getAllByRole("button", { name: /send when idle/i });
    // The first arm button corresponds to the first (head) slot.
    await act(async () => {
      fireEvent.click(armButtons[0]);
    });

    // Advance 3001ms to fire the idle watchdog timer.
    await act(async () => {
      vi.advanceTimersByTime(3001);
    });
    await flushMicrotasks();

    // onSendWithAttachments called for the head slot.
    expect(onSendWithAttachments).toHaveBeenCalledTimes(1);
    const [captionArg, targetArg] = onSendWithAttachments.mock.calls[0] as [string, string];
    expect(captionArg).toBe("first");
    // target must be the queued slot target for head.
    expect(targetArg).toMatch(/^queued:/);

    // text-only onSend NOT called.
    expect(onSend).not.toHaveBeenCalled();

    // Head slot removed (was armed; tail still present + primary = 2 textareas).
    // Use act+microtask flush instead of waitFor to avoid fake-timer conflict.
    await flushMicrotasks();
    expect(screen.getAllByRole("textbox").length).toBe(2); // tail + primary

    // clearStagedForTarget called for the head slot's target.
    expect(clearStagedForTarget).toHaveBeenCalledTimes(1);
    expect(clearStagedForTarget.mock.calls[0][0]).toBe(headSlotTarget);

    vi.useRealTimers();
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
});
