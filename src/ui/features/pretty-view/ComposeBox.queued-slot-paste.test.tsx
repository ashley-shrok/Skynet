// Regression suite: queued-slot paste routing (quick-260829-oxo).
//
// 4 tests covering the queued-slot Textarea paste seam:
//   Test 1 — queued-slot Textarea paste with a file routes to onAttachFilesForTarget
//   Test 2 — queued-slot Textarea paste with TEXT ONLY falls through to browser default
//   Test 3 — primary composebox paste path still routes to onAttachFiles (backward-compat)
//   Test 4 — queued-slot paste with a file emits `[compose-paste]` log
//
// Tests 1, 2, 4 fail RED before the production changes in Task 2 land (the slot
// Textarea has no onPaste prop — pasting a file is silently dropped, no log fires,
// and there is nothing to fall-through from). Test 3 passes from the start
// (guardrail — primary path is unchanged).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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

/** Flush async mount effects (getComposeDraft.then → setState). */
async function flushMountEffect() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ---------------------------------------------------------------------------
// MediaRecorder stub (mirrors ComposeBox.queued-attachment.test.tsx exactly)
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

describe("ComposeBox — queued-slot paste routing (quick-260829-oxo)", () => {
  it("Test 1: queued-slot Textarea paste with a file routes to onAttachFilesForTarget", async () => {
    const onAttachFiles = vi.fn();
    const onAttachFilesForTarget = vi.fn();

    render(
      <ComposeBox
        {...baseProps({
          onAttachFiles,
          onAttachFilesForTarget,
        })}
      />,
    );
    await flushMountEffect();

    // Add one queued slot.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });

    // Capture the auto-generated slot ID via data-slot-id.
    const slotContainer = document.querySelector("[data-slot-id]") as HTMLElement;
    expect(slotContainer).not.toBeNull();
    const capturedId = slotContainer.getAttribute("data-slot-id")!;
    const slotTarget = `queued:${capturedId}`;

    // Grab the slot's Textarea via its test ID.
    const slotTextarea = screen.getByTestId(`queue-slot-textarea-${capturedId}`);

    // Construct a real File to paste.
    const file = new File([new Uint8Array([137, 80, 78, 71])], "screenshot.png", {
      type: "image/png",
    });

    // Dispatch paste event with the file in clipboardData.
    fireEvent.paste(slotTextarea, {
      clipboardData: {
        files: [file],
        getData: () => "",
      },
    });

    // onAttachFilesForTarget called exactly once with (slotTarget, [file]).
    expect(onAttachFilesForTarget).toHaveBeenCalledTimes(1);
    const [targetArg, filesArg] = onAttachFilesForTarget.mock.calls[0] as [string, File[]];
    expect(targetArg).toBe(slotTarget);
    expect(filesArg).toHaveLength(1);
    expect(filesArg[0]).toBe(file);

    // Primary onAttachFiles NOT called (proves primary handler wasn't invoked).
    expect(onAttachFiles).not.toHaveBeenCalled();
  });

  it("Test 2: queued-slot Textarea paste with TEXT ONLY falls through to browser default", async () => {
    const onAttachFiles = vi.fn();
    const onAttachFilesForTarget = vi.fn();

    render(
      <ComposeBox
        {...baseProps({
          onAttachFiles,
          onAttachFilesForTarget,
        })}
      />,
    );
    await flushMountEffect();

    // Add one queued slot.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });

    // Capture slot ID.
    const slotContainer = document.querySelector("[data-slot-id]") as HTMLElement;
    expect(slotContainer).not.toBeNull();
    const capturedId = slotContainer.getAttribute("data-slot-id")!;

    // Grab the slot's Textarea.
    const slotTextarea = screen.getByTestId(`queue-slot-textarea-${capturedId}`);

    // Dispatch a text-only paste event (no files).
    // fireEvent.paste returns false only if preventDefault was called.
    const notPrevented = fireEvent.paste(slotTextarea, {
      clipboardData: {
        files: [],
        getData: (_format: string) => "pasted text",
      },
    });

    // onAttachFilesForTarget NOT called (files.length was 0).
    expect(onAttachFilesForTarget).not.toHaveBeenCalled();

    // onAttachFiles NOT called.
    expect(onAttachFiles).not.toHaveBeenCalled();

    // preventDefault was NOT called — browser default was allowed.
    // fireEvent.paste returns false only when preventDefault() was invoked.
    expect(notPrevented).toBe(true);
  });

  it("Test 3: primary composebox paste path still routes to onAttachFiles (backward-compat)", async () => {
    const onAttachFiles = vi.fn();
    const onAttachFilesForTarget = vi.fn();

    render(
      <ComposeBox
        {...baseProps({
          onAttachFiles,
          onAttachFilesForTarget,
        })}
      />,
    );
    await flushMountEffect();

    // No queued slots added — only the primary Textarea is in the DOM.
    const allTextboxes = screen.getAllByRole("textbox");
    expect(allTextboxes).toHaveLength(1);
    const primaryTextarea = allTextboxes[0];

    // Construct a file to paste into the primary Textarea.
    const file = new File([new Uint8Array([1, 2, 3])], "photo.jpg", {
      type: "image/jpeg",
    });

    // Dispatch paste event on the primary Textarea.
    fireEvent.paste(primaryTextarea, {
      clipboardData: {
        files: [file],
        getData: () => "",
      },
    });

    // onAttachFiles called exactly once with the file array (legacy primary path).
    expect(onAttachFiles).toHaveBeenCalledTimes(1);
    const [filesArg] = onAttachFiles.mock.calls[0] as [File[]];
    expect(filesArg).toHaveLength(1);
    expect(filesArg[0]).toBe(file);

    // onAttachFilesForTarget NOT called (primary paste does NOT touch target-aware path).
    expect(onAttachFilesForTarget).not.toHaveBeenCalled();
  });

  it("Test 4: queued-slot paste with a file emits [compose-paste] log", async () => {
    const consoleSpy = vi.spyOn(console, "info");

    const onAttachFilesForTarget = vi.fn();

    render(
      <ComposeBox
        {...baseProps({
          onAttachFilesForTarget,
        })}
      />,
    );
    await flushMountEffect();

    // Add one queued slot.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });

    // Capture slot ID.
    const slotContainer = document.querySelector("[data-slot-id]") as HTMLElement;
    expect(slotContainer).not.toBeNull();
    const capturedId = slotContainer.getAttribute("data-slot-id")!;

    // Grab the slot's Textarea.
    const slotTextarea = screen.getByTestId(`queue-slot-textarea-${capturedId}`);

    // Paste one file into the slot textarea.
    const file = new File([new Uint8Array([1])], "shot.png", { type: "image/png" });
    fireEvent.paste(slotTextarea, {
      clipboardData: {
        files: [file],
        getData: () => "",
      },
    });

    // console.info called at least once with the expected [compose-paste] pattern.
    const composePasteCalls = consoleSpy.mock.calls.filter(
      (args) =>
        typeof args[0] === "string" &&
        /^\[compose-paste\] target=queued:.+ files=1$/.test(args[0]),
    );
    expect(composePasteCalls).toHaveLength(1);
  });
});
