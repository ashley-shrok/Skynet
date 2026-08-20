// Tests for ComposeBox's Phase 05 additions — chip strip mount, mobile-only
// paperclip, paste handler, and send-with-attachments seam.
//
// The compose-draft persistence effect (patch #57) fires network calls; we
// mock the compose-drafts API so tests don't touch fetch. useIsTouchDevice
// is mocked per-test to flip the paperclip visibility.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import type { StagedAttachmentLike } from "./AttachmentChipStrip";

// Mock the compose-drafts API BEFORE importing ComposeBox so the module's
// effect uses the mock at first render.
vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "", queueSlots: [] }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

import { ComposeBox, type ComposeBoxProps } from "./ComposeBox";

function baseProps(overrides: Partial<ComposeBoxProps> = {}): ComposeBoxProps {
  return {
    onSend: vi.fn(() => true),
    hostId: 1,
    tmuxSession: "s1",
    ...overrides,
  };
}

const mkAtt = (
  tempId: string,
  name: string,
  size: number = 100,
  status: StagedAttachmentLike["status"] = "staged",
): StagedAttachmentLike => ({
  tempId,
  file: { name, size, type: "text/plain" },
  status,
  bytesUploaded: 0,
  error: null,
});

// Quick 260814-1hz: the primary + slot Send buttons no longer host the
// useHoldToRecord hook — that gesture has moved to MicButton. Send buttons
// are back to plain onClick={handleSend} / onClick={handleQueueSlotSend}
// (primary preserves the aside-morph onAsideDismiss branch). Consequently,
// exercising the enabled send path in tests is once again a fireEvent.click
// on the button. The Phase 32 short-tap pointer-sequence (pointerdown +
// pointerup < HOLD_THRESHOLD_MS) is now specific to the MicButton and is
// exercised by ComposeBox.hold-to-mic.test.tsx.
//
// Name preserved so the surrounding tests keep their intent-clear invocation;
// implementation dispatches a click event (plus microtask flushes for the
// handleSend success branch's async cleanup effects).
async function shortTapSendButton(sendBtn: HTMLButtonElement): Promise<void> {
  fireEvent.click(sendBtn);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// Install/uninstall a navigator.mediaDevices stub around a scope. Returns the
// restore closure — call it in a `finally` block. Used by tests that drive
// the pointer-gesture send path.
function withMediaDevicesStub(): () => void {
  const originalNavigator = globalThis.navigator;
  const getUserMediaMock = vi.fn(() => new Promise(() => {}));
  Object.defineProperty(globalThis, "navigator", {
    value: { mediaDevices: { getUserMedia: getUserMediaMock } },
    writable: true,
    configurable: true,
  });
  return () => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  };
}

describe("ComposeBox — Phase 05 upload wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Patch #129 test-hygiene fix: localStorage persists across tests in a
    // shared JSDOM instance, and patch #119's compose-draft-ls mirror writes
    // to it on every keystroke. Without a clear, tests that mount ComposeBox
    // hydrate from the previous test's leftover draft and the initial
    // `text=""` state gets overridden by an async setText from the hydrate
    // effect — which flips `sendDisabled` unexpectedly and silently makes
    // subsequent Send-button clicks no-op.
    localStorage.clear();
  });

  it("Test 1: no chip strip when stagedAttachments is empty", () => {
    render(
      <ComposeBox
        {...baseProps({
          stagedAttachments: [],
          onRemoveAttachment: vi.fn(),
          showPaperclip: false,
          onAttachFiles: vi.fn(),
        })}
      />,
    );
    expect(screen.queryByTestId("attachment-chip-strip")).toBeNull();
  });

  it("Test 2: chip strip mounts INSIDE the textarea wrapper (still document-precedes the textarea, but as a sibling of it, not a parent-container sibling)", () => {
    // Quick 260802-wxy: the chip strip was relocated from a Row-3 sibling
    // above Row 1 to an absolutely-positioned child at the TOP of the
    // primary textarea's wrapper (the same `<div className="relative
    // flex-1 self-stretch">` that hosts the Send button and paperclip).
    // The strip renders FIRST inside the wrapper, so DOM_POSITION_FOLLOWING
    // still holds (textarea comes after strip in document order) — but the
    // relationship is now SIBLING inside the wrapper, not sibling of the
    // wrapper. Test 2b below asserts the sibling-of-textarea invariant
    // explicitly; this test preserves the document-order regression guard
    // and adds an `absolute` className assertion to prove overlay
    // positioning (not stacked layout).
    render(
      <ComposeBox
        {...baseProps({
          stagedAttachments: [mkAtt("a", "one.txt"), mkAtt("b", "two.txt")],
          onRemoveAttachment: vi.fn(),
          showPaperclip: false,
          onAttachFiles: vi.fn(),
        })}
      />,
    );
    const strip = screen.getByTestId("attachment-chip-strip");
    expect(strip).toBeTruthy();
    const textarea = screen.getByPlaceholderText(/message/i);
    // DOM_POSITION_FOLLOWING (0x04) means textarea comes AFTER strip.
    // eslint-disable-next-line no-bitwise
    expect(strip.compareDocumentPosition(textarea) & 0x04).toBeTruthy();
    // Overlay positioning: the strip's absolutely-positioned wrapper
    // (chipStripRef target) carries `absolute` — proves the visual
    // treatment is overlay, not stacked block layout. The strip element
    // itself lives INSIDE that wrapper, so we walk one level up to the
    // wrapper div and check its className.
    const stripWrapper = strip.parentElement;
    expect(stripWrapper).not.toBeNull();
    expect(stripWrapper!.className).toMatch(/absolute/);
  });

  it("Test 2b: chip strip's parent wrapper is the same wrapper that contains the primary textarea (regression guard for the overlay-in-wrapper invariant)", () => {
    // Quick 260802-wxy: load-bearing structural assertion. If a future
    // refactor moves the strip back out of the wrapper (e.g. re-parents
    // it above Row 1 as a Row-3 sibling), `stripWrapper.contains(textarea)`
    // will be false and this test will fail hard. Keep it.
    render(
      <ComposeBox
        {...baseProps({
          stagedAttachments: [mkAtt("a", "one.txt"), mkAtt("b", "two.txt")],
          onRemoveAttachment: vi.fn(),
          showPaperclip: false,
          onAttachFiles: vi.fn(),
        })}
      />,
    );
    const strip = screen.getByTestId("attachment-chip-strip");
    const textarea = screen.getByPlaceholderText(/message/i);
    // Walk up until we hit the `relative flex-1 self-stretch` wrapper —
    // the same one that contains the Textarea and the Send button.
    const stripWrapper = strip.closest("div.relative.flex-1.self-stretch");
    const textareaWrapper = textarea.closest(
      "div.relative.flex-1.self-stretch",
    );
    expect(stripWrapper).not.toBeNull();
    expect(textareaWrapper).not.toBeNull();
    expect(stripWrapper).toBe(textareaWrapper);
  });

  it("Test 3: paperclip hidden when showPaperclip=false (desktop)", () => {
    render(
      <ComposeBox
        {...baseProps({
          stagedAttachments: [],
          onRemoveAttachment: vi.fn(),
          showPaperclip: false,
          onAttachFiles: vi.fn(),
        })}
      />,
    );
    expect(screen.queryByLabelText(/attach file/i)).toBeNull();
  });

  it("Test 4: paperclip visible when showPaperclip=true (touch)", () => {
    render(
      <ComposeBox
        {...baseProps({
          stagedAttachments: [],
          onRemoveAttachment: vi.fn(),
          showPaperclip: true,
          onAttachFiles: vi.fn(),
        })}
      />,
    );
    expect(screen.getByLabelText(/attach file/i)).toBeTruthy();
  });

  it("Test 4b: paperclip renders INSIDE the textarea wrapper (sibling of Send), not in the Row 1 aux group", () => {
    render(
      <ComposeBox
        {...baseProps({
          stagedAttachments: [],
          onRemoveAttachment: vi.fn(),
          showPaperclip: true,
          onAttachFiles: vi.fn(),
        })}
      />,
    );
    const paperclip = screen.getByLabelText(/attach file/i);
    const sendButton = screen.getByRole("button", { name: "Send" });
    // Regression guard: paperclip and send must share the same
    // `.relative.flex-1` textarea wrapper ancestor. If a future
    // refactor moves paperclip back to Row 1 or into a separate
    // wrapper, `.closest` returns null OR the ancestor won't
    // contain the send button — either way this test fails.
    const wrapper = paperclip.closest(".relative.flex-1");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.contains(sendButton)).toBe(true);
  });

  it("Test 5: paperclip click opens the file picker (native input.click)", () => {
    const onAttachFiles = vi.fn();
    render(
      <ComposeBox
        {...baseProps({
          stagedAttachments: [],
          onRemoveAttachment: vi.fn(),
          showPaperclip: true,
          onAttachFiles,
        })}
      />,
    );
    // Grab the hidden file input via data-testid so we can spy on its click().
    const input = screen.getByTestId("compose-file-picker") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");
    fireEvent.click(screen.getByLabelText(/attach file/i));
    expect(clickSpy).toHaveBeenCalled();
  });

  it("Test 6: pasting file-shaped clipboardData invokes onAttachFiles; text paste is untouched", () => {
    const onAttachFiles = vi.fn();
    render(
      <ComposeBox
        {...baseProps({
          stagedAttachments: [],
          onRemoveAttachment: vi.fn(),
          showPaperclip: false,
          onAttachFiles,
        })}
      />,
    );
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;

    // Paste with a file. JSDOM 29 doesn't ship DataTransfer, so we use
    // a minimal duck-typed stub — the handler only reads .files.
    const file = new File(["hello"], "pasted.png", { type: "image/png" });
    const pasteEvt = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvt, "clipboardData", {
      value: { files: [file] as unknown as FileList },
      writable: false,
    });
    fireEvent(textarea, pasteEvt);
    expect(onAttachFiles).toHaveBeenCalledTimes(1);
    expect(onAttachFiles.mock.calls[0][0]).toHaveLength(1);
    expect(onAttachFiles.mock.calls[0][0][0].name).toBe("pasted.png");

    // Text paste (no files) — must not fire onAttachFiles.
    onAttachFiles.mockClear();
    const textPaste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(textPaste, "clipboardData", {
      value: { files: [] as unknown as FileList },
      writable: false,
    });
    fireEvent(textarea, textPaste);
    expect(onAttachFiles).not.toHaveBeenCalled();
  });

  it("Test 7: Send with attachments routes to onSendWithAttachments; without attachments still uses onSend", async () => {
    const restore = withMediaDevicesStub();
    try {
      const onSend = vi.fn(() => true);
      const onSendWithAttachments = vi.fn();

      // With attachments — Send should call onSendWithAttachments, not onSend.
      const { rerender } = render(
        <ComposeBox
          {...baseProps({
            onSend,
            stagedAttachments: [mkAtt("a", "one.txt")],
            onRemoveAttachment: vi.fn(),
            showPaperclip: false,
            onAttachFiles: vi.fn(),
            onSendWithAttachments,
          })}
        />,
      );
      const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "hey" } });
      // Patch #129: selector updated from getByLabelText(/send message/i) to
      // getByRole('button', { name: 'Send' }) — the retired amber-Send from
      // patch #121 wore aria-label="Send message"; the new inside-textarea
      // Send button wears aria-label="Send" (exact match, no regex).
      // Phase 32: short-tap-pointer sequence replaces fireEvent.click (see
      // shortTapSendButton helper comment above).
      await shortTapSendButton(screen.getByRole("button", { name: "Send" }) as HTMLButtonElement);
      expect(onSendWithAttachments).toHaveBeenCalledWith("hey");
      expect(onSend).not.toHaveBeenCalled();

      // Rerender WITHOUT attachments — Send should use onSend.
      onSendWithAttachments.mockClear();
      onSend.mockClear();
      rerender(
        <ComposeBox
          {...baseProps({
            onSend,
            stagedAttachments: [],
            onRemoveAttachment: vi.fn(),
            showPaperclip: false,
            onAttachFiles: vi.fn(),
            onSendWithAttachments,
          })}
        />,
      );
      fireEvent.change(textarea, { target: { value: "plain" } });
      await shortTapSendButton(screen.getByRole("button", { name: "Send" }) as HTMLButtonElement);
      // Phase 50 D-18: onSend now receives (text, mqid) — mqid is the
      // ComposeBox-generated pv-optim-<...> identifier. Match text arg only.
      expect(onSend).toHaveBeenCalledWith("plain", expect.stringMatching(/^pv-optim-/));
      expect(onSendWithAttachments).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("Test 8: Send button ENABLED with attachments even when caption text is empty; disabled without either", () => {
    // Case A: attachments present, text empty → Send enabled.
    const { rerender } = render(
      <ComposeBox
        {...baseProps({
          stagedAttachments: [mkAtt("a", "one.txt")],
          onRemoveAttachment: vi.fn(),
          showPaperclip: false,
          onAttachFiles: vi.fn(),
          onSendWithAttachments: vi.fn(),
        })}
      />,
    );
    // Patch #129: selector updated per Test 7 rationale.
    const sendBtnA = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(sendBtnA.disabled).toBe(false);

    // Case B: no attachments, empty text → Send disabled.
    rerender(
      <ComposeBox
        {...baseProps({
          stagedAttachments: [],
          onRemoveAttachment: vi.fn(),
          showPaperclip: false,
          onAttachFiles: vi.fn(),
        })}
      />,
    );
    const sendBtnB = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(sendBtnB.disabled).toBe(true);
  });

  it("Test 13: existing behavior preserved — Enter still sends text-only messages via onSend, Shift-Enter still inserts newline", () => {
    const onSend = vi.fn(() => true);
    render(
      <ComposeBox
        {...baseProps({
          onSend,
          stagedAttachments: [],
          onRemoveAttachment: vi.fn(),
          showPaperclip: false,
          onAttachFiles: vi.fn(),
        })}
      />,
    );
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hi" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    // Phase 50 D-18: onSend now receives (text, mqid).
    expect(onSend).toHaveBeenCalledWith("hi", expect.stringMatching(/^pv-optim-/));
  });

  it("Test 15: Retry button appears only when at least one chip is in error state; click fires onRetryBatch", () => {
    const onRetryBatch = vi.fn();
    // No error state — no Retry button.
    const { rerender } = render(
      <ComposeBox
        {...baseProps({
          stagedAttachments: [mkAtt("a", "one.txt")],
          onRemoveAttachment: vi.fn(),
          showPaperclip: false,
          onAttachFiles: vi.fn(),
          onSendWithAttachments: vi.fn(),
          onRetryBatch,
        })}
      />,
    );
    expect(screen.queryByLabelText(/retry upload/i)).toBeNull();

    // One chip errored — Retry appears.
    rerender(
      <ComposeBox
        {...baseProps({
          stagedAttachments: [
            mkAtt("a", "one.txt", 100, "error"),
            mkAtt("b", "two.txt"),
          ],
          onRemoveAttachment: vi.fn(),
          showPaperclip: false,
          onAttachFiles: vi.fn(),
          onSendWithAttachments: vi.fn(),
          onRetryBatch,
        })}
      />,
    );
    const retryBtn = screen.getByLabelText(/retry upload/i);
    fireEvent.click(retryBtn);
    expect(onRetryBatch).toHaveBeenCalledTimes(1);
  });

  // ============================================================
  // Patch #129 — inside-textarea send button (Ashley-locked visual)
  // ============================================================

  it("inside-textarea send button: renders as a bare <button> inside the textarea wrapper", () => {
    render(<ComposeBox {...baseProps()} />);
    const sendBtn = screen.getByRole("button", { name: "Send" });
    expect(sendBtn).toBeTruthy();
    // Bare <button>, not a shadcn <Button> composition. shadcn Button
    // resolves to a <button> too, but the plan requires a bare element
    // — assert tagName so any accidental Button-wrapping regresses loudly.
    expect(sendBtn.tagName).toBe("BUTTON");

    // Walk up until we hit the textarea's flex-1 self-stretch wrapper.
    // Must contain BOTH the textarea and the button.
    let wrapper: Element | null = sendBtn.parentElement;
    while (wrapper) {
      const cls = wrapper.className || "";
      if (typeof cls === "string" && /relative/.test(cls) && /flex-1/.test(cls)) {
        break;
      }
      wrapper = wrapper.parentElement;
    }
    expect(wrapper).not.toBeNull();
    const textarea = screen.getByPlaceholderText(/message/i);
    expect(wrapper!.contains(textarea)).toBe(true);
    expect(wrapper!.contains(sendBtn)).toBe(true);
  });

  it("inside-textarea send button: short-tap with text present calls onSend with trimmed payload and clears the textarea (Phase 50 D-18)", async () => {
    const restore = withMediaDevicesStub();
    try {
      const onSend = vi.fn(() => true);
      render(<ComposeBox {...baseProps({ onSend })} />);
      const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "hi there  " } });
      // Phase 32: short-tap-pointer sequence replaces fireEvent.click. Wrap
      // in act so React commits the setText("") state update triggered inside
      // handleSend's success branch before we assert on textarea.value.
      await act(async () => {
        await shortTapSendButton(screen.getByRole("button", { name: "Send" }) as HTMLButtonElement);
      });
      // handleSend trims trailing whitespace before dispatch. Phase 50 D-18
      // widened onSend to (text, mqid) — text arg matches, mqid is the
      // ComposeBox-generated pv-optim-<...> identifier.
      expect(onSend).toHaveBeenCalledWith("hi there", expect.stringMatching(/^pv-optim-/));
      // Phase 50 D-01 clear-on-success: textarea is empty after a truthy dispatch.
      expect(textarea.value).toBe("");
    } finally {
      restore();
    }
  });

  it("inside-textarea send button: disabled state — button reports disabled and click is a no-op", () => {
    // Case A: empty text, no attachments, canSend not set → disabled.
    const onSendA = vi.fn(() => true);
    const { unmount } = render(<ComposeBox {...baseProps({ onSend: onSendA })} />);
    const btnA = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(btnA.disabled).toBe(true);
    fireEvent.click(btnA);
    expect(onSendA).not.toHaveBeenCalled();
    unmount();

    // Case B: canSend=false, no attachments, empty text → disabled.
    const onSendB = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend: onSendB, canSend: false })} />);
    const btnB = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(btnB.disabled).toBe(true);
    fireEvent.click(btnB);
    expect(onSendB).not.toHaveBeenCalled();
  });
});

// ============================================================
// Queue slots (bounty: message-queue-in-pretty-view)
// ============================================================

describe("queue slots (bounty: message-queue-in-pretty-view)", () => {
  // Access the mocked compose-drafts-api module
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let getComposeDraftMock: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let putComposeDraftMock: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let flushComposeDraftKeepaliveMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();

    // Re-import to get fresh mock references after clearAllMocks.
    const apiMod = await import("@/api/compose-drafts-api");
    getComposeDraftMock = apiMod.getComposeDraft as ReturnType<typeof vi.fn>;
    putComposeDraftMock = apiMod.putComposeDraft as ReturnType<typeof vi.fn>;
    flushComposeDraftKeepaliveMock = apiMod.flushComposeDraftKeepalive as ReturnType<typeof vi.fn>;

    // Default: hydrate with empty body + empty queueSlots
    getComposeDraftMock.mockResolvedValue({ body: "", queueSlots: [] });
    putComposeDraftMock.mockResolvedValue(undefined);
    flushComposeDraftKeepaliveMock.mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper: flush all pending microtasks (Promise resolution) so async mount
  // effects (getComposeDraft.then(...)) complete before we do user interactions.
  async function flushMountEffect() {
    await act(async () => {
      // Two rounds to cover nested microtasks (useEffect → fetch → .then → setState)
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  // QS 1: Plus button appends a queue slot with empty text
  it("QS 1 — Plus button appends a queue slot with empty textarea", async () => {
    render(<ComposeBox {...baseProps()} />);
    await flushMountEffect();

    const plusBtn = screen.getByRole("button", { name: /queue a message/i });
    expect(plusBtn).toBeTruthy();

    fireEvent.click(plusBtn);

    // After clicking Plus, a new queue slot textarea should appear
    // (in addition to the primary textarea)
    const allTextareas = screen.getAllByRole("textbox");
    // Should have primary + at least 1 queue slot
    expect(allTextareas.length).toBeGreaterThanOrEqual(2);
  });

  // QS 2: Typing into a queue slot updates that slot's text
  it("QS 2 — typing into a queue slot textarea updates its text", async () => {
    render(<ComposeBox {...baseProps()} />);
    await flushMountEffect();

    fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));

    const allTextareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    // The FIRST textarea is the newly added queue slot (queue slot stack renders above
    // Row 2 primary textarea in DOM order — slot = index 0, primary = last)
    const slotTextarea = allTextareas[0];

    fireEvent.change(slotTextarea, { target: { value: "queued message" } });
    expect(slotTextarea.value).toBe("queued message");
  });

  // QS 3: X button on a queue slot removes only that slot
  it("QS 3 — clicking the X (delete) button on a slot removes only that slot", async () => {
    render(<ComposeBox {...baseProps()} />);
    await flushMountEffect();

    const plusBtn = screen.getByRole("button", { name: /queue a message/i });
    fireEvent.click(plusBtn);
    fireEvent.click(plusBtn);

    // Should have 2 queue slots now (plus primary = 3 total textareas)
    expect(screen.getAllByRole("textbox").length).toBe(3);

    // Delete the first queue slot
    const deleteButtons = screen.getAllByRole("button", { name: /delete queued message/i });
    expect(deleteButtons.length).toBe(2);
    fireEvent.click(deleteButtons[0]);

    // Now should have 2 textareas (primary + 1 remaining slot)
    expect(screen.getAllByRole("textbox").length).toBe(2);
  });

  // QS 4: Send slot success — onSend called with text, slot disappears
  it("QS 4 — short-tap slot Send with text calls onSend and removes the slot on success (true)", async () => {
    // Phase 32 Plan 32-02: slot send button is now pointer-gesture-owned
    // (onClick removed; hook onShortTap → handleQueueSlotSend). Drive short-
    // tap sequence, mock mediaDevices for voice.start() in the hook.
    const restore = withMediaDevicesStub();
    try {
      const onSend = vi.fn(() => true);
      render(<ComposeBox {...baseProps({ onSend })} />);
      await flushMountEffect();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
      });

      const allTextareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
      // Slot renders ABOVE primary in DOM: slot = index 0, primary = last.
      const slotTextarea = allTextareas[0];

      await act(async () => {
        fireEvent.change(slotTextarea, { target: { value: "send this" } });
      });

      // Find the slot's Send button (not the primary Send)
      const slotSendBtn = screen.getByRole("button", { name: /send queued message/i }) as HTMLButtonElement;
      await act(async () => {
        await shortTapSendButton(slotSendBtn);
      });

      expect(onSend).toHaveBeenCalledWith("send this");
      // Slot should be removed after successful send
      expect(screen.getAllByRole("textbox").length).toBe(1); // only primary
    } finally {
      restore();
    }
  });

  // QS 5: Send slot failure — slot persists, errorMessage surfaces
  it("QS 5 — short-tap slot Send when onSend returns false keeps the slot and shows error", async () => {
    const restore = withMediaDevicesStub();
    try {
      const onSend = vi.fn(() => false);
      render(<ComposeBox {...baseProps({ onSend })} />);
      await flushMountEffect();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
      });

      const allTextareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
      // Slot renders ABOVE primary in DOM: slot = index 0, primary = last.
      const slotTextarea = allTextareas[0];

      await act(async () => {
        fireEvent.change(slotTextarea, { target: { value: "failing send" } });
      });

      const slotSendBtn = screen.getByRole("button", { name: /send queued message/i }) as HTMLButtonElement;
      await act(async () => {
        await shortTapSendButton(slotSendBtn);
      });

      expect(onSend).toHaveBeenCalledWith("failing send");
      // Slot persists
      expect(screen.getAllByRole("textbox").length).toBe(2);
      // Error message surfaces
      expect(screen.getByText(/not connected/i)).toBeTruthy();
    } finally {
      restore();
    }
  });

  // QS 6: Send slot disabled when empty
  it("QS 6 — slot Send button is disabled when slot.text.trim() is empty", async () => {
    render(<ComposeBox {...baseProps()} />);
    await flushMountEffect();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });

    const slotSendBtn = screen.getByRole("button", { name: /send queued message/i }) as HTMLButtonElement;
    expect(slotSendBtn.disabled).toBe(true);

    // Type some text — button should become enabled.
    // Slot renders ABOVE primary in DOM: slot = index 0, primary = last.
    const allTextareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const slotTextarea = allTextareas[0];

    await act(async () => {
      fireEvent.change(slotTextarea, { target: { value: "  hello  " } });
    });

    // Re-query to get updated state
    const updatedSlotSendBtn = screen.getByRole("button", { name: /send queued message/i }) as HTMLButtonElement;
    expect(updatedSlotSendBtn.disabled).toBe(false);

    // Clear text → disabled again
    await act(async () => {
      fireEvent.change(slotTextarea, { target: { value: "   " } });
    });
    const disabledAgain = screen.getByRole("button", { name: /send queued message/i }) as HTMLButtonElement;
    expect(disabledAgain.disabled).toBe(true);
  });

  // QS 7: Persistence — hydrate queueSlots on mount from getComposeDraft
  it("QS 7 — mount hydrates queueSlots from getComposeDraft response", async () => {
    getComposeDraftMock.mockResolvedValue({
      body: "",
      queueSlots: [{ id: "seed-a", text: "seeded slot" }],
    });

    render(<ComposeBox {...baseProps()} />);

    // Wait for hydration async effect to complete
    await flushMountEffect();

    // After hydration, the seeded slot should appear
    const allTextareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    expect(allTextareas.length).toBeGreaterThanOrEqual(2);
    const slotTextarea = allTextareas.find((t) => t.value === "seeded slot");
    expect(slotTextarea).toBeTruthy();
  });

  // QS 8: Autosave — putComposeDraft called with queueSlots after 400ms debounce
  it("QS 8 — adding a slot schedules putComposeDraft with queueSlots after 400ms debounce", async () => {
    render(<ComposeBox {...baseProps()} />);
    await flushMountEffect();
    putComposeDraftMock.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });

    // Type in the new slot. Slot renders ABOVE primary in DOM: slot = index 0.
    const allTextareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const slotTextarea = allTextareas[0];

    await act(async () => {
      fireEvent.change(slotTextarea, { target: { value: "autosave me" } });
    });

    // Advance past debounce and flush the flushDirty() async call
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(putComposeDraftMock).toHaveBeenCalled();
    // The call should include queueSlots as the 4th argument
    const lastCall = putComposeDraftMock.mock.calls[putComposeDraftMock.mock.calls.length - 1];
    expect(lastCall).toBeDefined();
    expect(Array.isArray(lastCall[3])).toBe(true); // 4th arg = queueSlots
    const savedSlots = lastCall[3] as Array<{ id: string; text: string }>;
    expect(savedSlots.some((s) => s.text === "autosave me")).toBe(true);
  });

  // QS 9: localStorage mirror — extended payload {body, queueSlots}
  it("QS 9 — after autosave, localStorage contains extended {body, queueSlots} payload", async () => {
    render(<ComposeBox {...baseProps({ hostId: 99, tmuxSession: "ls-test" })} />);

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));

    // Slot renders ABOVE primary in DOM: slot = index 0, primary = last.
    const allTextareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const slotTextarea = allTextareas[0];
    fireEvent.change(slotTextarea, { target: { value: "ls-slot" } });

    // Advance past debounce
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });

    const lsKey = `skynet:compose-draft:99:ls-test`;
    const lsValue = localStorage.getItem(lsKey);
    expect(lsValue).not.toBeNull();

    // Should be JSON with body and queueSlots
    const parsed = JSON.parse(lsValue!);
    expect(parsed).toHaveProperty("body");
    expect(parsed).toHaveProperty("queueSlots");
    expect(Array.isArray(parsed.queueSlots)).toBe(true);
  });

  // QS 10: Mic per-slot — mic button on slot starts recording for that slot
  it("QS 10 — mic button on queue slot: voice.start called when slot mic tapped", async () => {
    // Set up MediaDevices mock so showMicButton is visible
    const originalMediaDevices = navigator.mediaDevices;
    const startMock = vi.fn();
    // We can't easily test voice per-slot wiring without the full voice mock
    // from ComposeBox.voice.test.tsx. This test verifies the mic button IS rendered
    // on queue slots when mediaDevices is available.
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn() },
      configurable: true,
    });

    render(<ComposeBox {...baseProps()} />);

    fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));

    // Should have a mic button on the slot (aria-label "Record voice for queued slot" or similar)
    // The key assertion: a Record voice button appears associated with the slot
    const micButtons = screen.queryAllByRole("button", { name: /record voice/i });
    // In idle state with mediaDevices, mic button(s) should appear
    expect(micButtons.length).toBeGreaterThanOrEqual(1);

    // Restore
    if (originalMediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", {
        value: originalMediaDevices,
        configurable: true,
      });
    }
  });
});

// ============================================================
// Quick 260803-05i: queued-row per-slot paperclip, top-left delete corner
// tab, padding parity, per-slot chip overlay (Task 2), one-line armed
// header (Task 3). This describe block accumulates across all three tasks
// so the mount/setup boilerplate is defined once.
// ============================================================

describe("ComposeBox — Quick B: queued-row per-slot paperclip + top-left delete tab + padding parity + overlay chip + one-line armed header", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function flushMountEffect() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  // ── Task 1: paperclip + top-left delete tab + padding parity ────────────

  it("QB-1: queued row renders a paperclip attach button at absolute left-1 bottom-0.5 with 30% opacity default", async () => {
    render(<ComposeBox {...baseProps()} />);
    await flushMountEffect();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });
    const paperclip = screen.getByRole("button", {
      name: /attach file to queued message/i,
    });
    expect(paperclip).toBeTruthy();
    expect(paperclip.className).toMatch(/\bleft-1\b/);
    expect(paperclip.className).toMatch(/\bbottom-0\.5\b/);
    // 30% opacity treatment — matches the main-composebox paperclip.
    // Post-1503c40c the icon uses the Tailwind `opacity-30` utility instead
    // of the semi-transparent rgba stroke (rgba composited additively on
    // overlapping SVG paths, producing visible seams — see commit message).
    expect(paperclip.className).toMatch(/\bopacity-30\b/);
  });

  it("QB-2: paperclip click on queued slot routes file-picker output to onAttachFilesForTarget(`queued:${slotId}`, files) — NOT primary", async () => {
    const onAttachFilesForTarget = vi.fn();
    render(
      <ComposeBox
        {...baseProps({ onAttachFilesForTarget })}
      />,
    );
    await flushMountEffect();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });
    // Click the queued paperclip — arms activeStagingTargetRef with the
    // slot's target BEFORE opening the hidden file input.
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /attach file to queued message/i }),
      );
    });
    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    expect(fileInput).not.toBeNull();
    const f = new File(["hello"], "hello.txt", { type: "text/plain" });
    Object.defineProperty(fileInput, "files", {
      value: [f],
      configurable: true,
    });
    await act(async () => {
      fireEvent.change(fileInput);
    });
    expect(onAttachFilesForTarget).toHaveBeenCalledTimes(1);
    const [target, files] = onAttachFilesForTarget.mock.calls[0];
    expect(target).toMatch(/^queued:/);
    expect(files).toEqual([f]);
  });

  it("QB-3: queued row renders a delete × in the top-left corner OUTSIDE the textarea wrapper (tab protrudes via -top-* + -left-*)", async () => {
    render(<ComposeBox {...baseProps()} />);
    await flushMountEffect();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });
    const deleteBtn = screen.getByRole("button", {
      name: /delete queued message/i,
    });
    // Corner-tab positioning: -top-* + -left-* protrudes OUTSIDE the
    // textarea's border (Ashley moved from -right-2 to -left-2 on 2026-08-12).
    expect(deleteBtn.className).toMatch(/-top-/);
    expect(deleteBtn.className).toMatch(/-left-/);
    // Delete tab must be a descendant of the slot outer container.
    const outer = deleteBtn.closest("[data-slot-id]");
    expect(outer).not.toBeNull();
  });

  it("QB-4: clicking the delete × removes the slot AND calls clearStagedForTarget for that slot's target", async () => {
    const clearStagedForTarget = vi.fn();
    render(
      <ComposeBox {...baseProps({ clearStagedForTarget })} />,
    );
    await flushMountEffect();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });
    expect(screen.getAllByRole("textbox").length).toBe(2); // slot + primary
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /delete queued message/i }),
      );
    });
    expect(screen.getAllByRole("textbox").length).toBe(1); // primary only
    expect(clearStagedForTarget).toHaveBeenCalledTimes(1);
    expect(clearStagedForTarget.mock.calls[0][0]).toMatch(/^queued:/);
  });

  it("QB-5: queued textarea className carries pl-11 (padding parity for the left-side paperclip clearance)", async () => {
    render(<ComposeBox {...baseProps()} />);
    await flushMountEffect();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });
    // Slot renders BEFORE primary in DOM order.
    const allTextareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const slotTextarea = allTextareas[0];
    expect(slotTextarea.className).toMatch(/\bpl-11\b/);
  });

  it("QB-6: the old left-1 bottom-0.5 delete × is GONE — the delete button now lives at the top-left corner (className MUST NOT contain 'left-1'; `-left-2` is fine, that's the corner-tab protrusion, distinct from the `left-1 bottom-0.5` bottom-left in-textarea position)", async () => {
    render(<ComposeBox {...baseProps()} />);
    await flushMountEffect();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });
    const deleteBtn = screen.getByRole("button", {
      name: /delete queued message/i,
    });
    expect(deleteBtn.className).not.toMatch(/\bleft-1\b/);
  });

  // ── Task 2: per-slot overlay chip strip via QueuedRow extraction ─────────

  it("QB-7: queued slot with staged attachments renders overlay chip strip INSIDE the slot's inner textarea wrapper (mirrors Quick A's Test 2b for the primary)", async () => {
    const getStagedAttachmentsForTarget = vi.fn((target: string) =>
      target.startsWith("queued:")
        ? [mkAtt("q1", "queued-file-1.txt"), mkAtt("q2", "queued-file-2.txt")]
        : [],
    );
    render(
      <ComposeBox
        {...baseProps({
          getStagedAttachmentsForTarget,
          onRemoveAttachment: vi.fn(),
        })}
      />,
    );
    await flushMountEffect();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });
    // At least one chip strip should render — inside the slot.
    const strips = screen.getAllByTestId("attachment-chip-strip");
    expect(strips.length).toBeGreaterThanOrEqual(1);
    // The slot's chip strip lives inside the slot's `.relative.flex-1
    // .self-stretch` inner wrapper (Task 2's QueuedRow extraction added it).
    const slotTextarea = (screen.getAllByRole(
      "textbox",
    ) as HTMLTextAreaElement[])[0];
    const slotInnerWrapper = slotTextarea.closest(
      "div.relative.flex-1.self-stretch",
    );
    expect(slotInnerWrapper).not.toBeNull();
    // At least ONE strip is a descendant of that inner wrapper.
    const inSlotStrip = strips.find((s) => slotInnerWrapper!.contains(s));
    expect(inSlotStrip).toBeTruthy();
    // Overlay positioning check — parent wrapper carries `absolute`.
    expect(inSlotStrip!.parentElement!.className).toMatch(/absolute/);
  });

  it("QB-8: queued slot with NO staged attachments renders no chip strip in that slot (empty state adds no DOM element)", async () => {
    const getStagedAttachmentsForTarget = vi.fn(() => []);
    render(
      <ComposeBox
        {...baseProps({ getStagedAttachmentsForTarget })}
      />,
    );
    await flushMountEffect();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });
    const strips = screen.queryAllByTestId("attachment-chip-strip");
    // Primary is also empty (baseProps doesn't set stagedAttachments), so
    // AttachmentChipStrip's return-null-when-empty contract yields 0 total.
    expect(strips.length).toBe(0);
  });

  it("QB-9: primary chip strip regression guard — extracting QueuedRow does NOT break the primary's Quick A overlay", async () => {
    render(
      <ComposeBox
        {...baseProps({
          stagedAttachments: [
            mkAtt("a", "primary-1.txt"),
            mkAtt("b", "primary-2.txt"),
          ],
          onRemoveAttachment: vi.fn(),
        })}
      />,
    );
    await flushMountEffect();
    const strip = screen.getByTestId("attachment-chip-strip");
    const textarea = screen.getByPlaceholderText(/message/i);
    const stripWrapper = strip.closest("div.relative.flex-1.self-stretch");
    const textareaWrapper = textarea.closest(
      "div.relative.flex-1.self-stretch",
    );
    expect(stripWrapper).not.toBeNull();
    expect(textareaWrapper).not.toBeNull();
    expect(stripWrapper).toBe(textareaWrapper);
  });

  // ── Task 3: one-line armed overlay header + click-to-cancel + fire-order badge

  it("QB-10: queued armed overlay is one inline row — icon + label + 'click to cancel' in the same flex-row parent", async () => {
    render(<ComposeBox {...baseProps()} />);
    await flushMountEffect();
    // Add a slot, type text, arm it.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });
    const slotTextareas = screen.getAllByRole(
      "textbox",
    ) as HTMLTextAreaElement[];
    // Slot renders BEFORE primary — slots are indices 0..N-1, primary is
    // last. Type into the ONLY slot.
    const slotTextarea = slotTextareas[0];
    await act(async () => {
      fireEvent.change(slotTextarea, { target: { value: "first queued" } });
    });
    // Click the slot's arm-idle button. QB-10 has ONE slot so QB-12 asserts
    // the badge is absent; but the layout structure (flex-row + label + "click
    // to cancel") is the assertion here.
    const armButtons = screen.getAllByRole("button", {
      name: /send when idle/i,
    });
    await act(async () => {
      fireEvent.click(armButtons[0]);
    });
    const overlay = screen.getByRole("button", { name: /cancel queued send/i });
    expect(overlay.className).toMatch(/flex-row/);
    expect(overlay.className).not.toMatch(/flex-col/);
    expect(overlay.textContent).toMatch(/Queued.*waiting for idle/);
    expect(overlay.textContent).toMatch(/click to cancel/);
  });

  it("QB-11: fire-order badge PRESENT when queueSlots.length >= 2 and this slot is armed — reads `${idx+1}/${queueSlots.length}`", async () => {
    render(<ComposeBox {...baseProps()} />);
    await flushMountEffect();
    // Add TWO slots (so queueSlots.length >= 2), then arm the FIRST one.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });
    const slotTextareas = screen.getAllByRole(
      "textbox",
    ) as HTMLTextAreaElement[];
    // slots are indices 0 and 1; primary is index 2.
    await act(async () => {
      fireEvent.change(slotTextareas[0], { target: { value: "first" } });
    });
    // Arm the FIRST slot — its arm button is the FIRST "send when idle"
    // button in the DOM.
    const armButtons = screen.getAllByRole("button", {
      name: /send when idle/i,
    });
    await act(async () => {
      fireEvent.click(armButtons[0]);
    });
    const badge = screen.getByTestId("fire-order-badge");
    expect(badge).toBeTruthy();
    // Fire-order text is `${idx+1}/${queueSlots.length}` — total = 2.
    expect(badge.textContent).toMatch(/^\d+\/2$/);
  });

  it("QB-12: fire-order badge ABSENT when queueSlots.length === 1 (single queued slot needs no 1/1 badge)", async () => {
    render(<ComposeBox {...baseProps()} />);
    await flushMountEffect();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });
    const slotTextareas = screen.getAllByRole(
      "textbox",
    ) as HTMLTextAreaElement[];
    await act(async () => {
      fireEvent.change(slotTextareas[0], { target: { value: "only slot" } });
    });
    const armButtons = screen.getAllByRole("button", {
      name: /send when idle/i,
    });
    await act(async () => {
      fireEvent.click(armButtons[0]);
    });
    expect(screen.queryByTestId("fire-order-badge")).toBeNull();
  });

  it("QB-13: 'click to cancel' literal lowercase copy is present in the armed overlay (regression guard for Ashley's exact phrase)", async () => {
    render(<ComposeBox {...baseProps()} />);
    await flushMountEffect();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });
    const slotTextareas = screen.getAllByRole(
      "textbox",
    ) as HTMLTextAreaElement[];
    await act(async () => {
      fireEvent.change(slotTextareas[0], { target: { value: "test" } });
    });
    const armButtons = screen.getAllByRole("button", {
      name: /send when idle/i,
    });
    await act(async () => {
      fireEvent.click(armButtons[0]);
    });
    // Case-sensitive matcher — Ashley asked for the literal lowercase phrase.
    expect(screen.getByText(/click to cancel/)).toBeTruthy();
  });

  it("QB-14: clicking the armed overlay STILL cancels — click-to-cancel behavior preserved after the header restructure", async () => {
    render(<ComposeBox {...baseProps()} />);
    await flushMountEffect();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
    });
    const slotTextareas = screen.getAllByRole(
      "textbox",
    ) as HTMLTextAreaElement[];
    await act(async () => {
      fireEvent.change(slotTextareas[0], { target: { value: "cancel me" } });
    });
    const armButtons = screen.getAllByRole("button", {
      name: /send when idle/i,
    });
    await act(async () => {
      fireEvent.click(armButtons[0]);
    });
    const overlayBefore = screen.getByRole("button", {
      name: /cancel queued send/i,
    });
    expect(overlayBefore).toBeTruthy();
    await act(async () => {
      fireEvent.click(overlayBefore);
    });
    // After cancel, the overlay is gone (slot text is intact, slot is
    // re-editable).
    expect(
      screen.queryByRole("button", { name: /cancel queued send/i }),
    ).toBeNull();
  });
});

describe("ComposeBox — Phase 9 layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Patch #129 test-hygiene fix (see Phase 05 describe for rationale).
    localStorage.clear();
  });

  // Helper: walk el.parentElement upward until a parent's className matches
  // pattern, or return null if we reach the document root without a match.
  function closestFlexRowAncestor(el: Element, pattern: RegExp): Element | null {
    let current: Element | null = el.parentElement;
    while (current) {
      if (pattern.test(current.className)) return current;
      current = current.parentElement;
    }
    return null;
  }

  it("Phase 9 Layout: aux button group renders in a row that precedes the Send button's row", () => {
    render(<ComposeBox {...baseProps()} />);
    // Patch #14-04 test-fix: aria-label was renamed to "Send 'let's go'"
    // (see ComposeBox.tsx around L1245); the regex needed refreshing.
    const thumbsUp = screen.getByLabelText(/send 'let's go'/i);
    // Patch #129: selector updated per Test 7 rationale. The new inside-
    // textarea Send button lives in Row 2's textarea wrapper (line ~1250);
    // Row 1's aux-group (ThumbsUp) still precedes it in DOM order — the
    // assertion holds; only the selector needed refreshing.
    const sendBtn = screen.getByRole("button", { name: "Send" });

    const pattern = /flex items-(?:center|end) gap-2/;
    const thumbsUpRow = closestFlexRowAncestor(thumbsUp, pattern);
    const sendRow = closestFlexRowAncestor(sendBtn, pattern);

    expect(thumbsUpRow).not.toBeNull();
    expect(sendRow).not.toBeNull();
    // The two rows must be distinct DOM nodes.
    expect(thumbsUpRow).not.toBe(sendRow);
    // Row 1 (thumbsUp) must precede Row 2 (send) in document order.
    // Node.DOCUMENT_POSITION_FOLLOWING (0x04): sendRow comes after thumbsUpRow.
    // eslint-disable-next-line no-bitwise
    expect(thumbsUpRow!.compareDocumentPosition(sendRow!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Phase 9 Layout: meter is horizontal — role='meter' present with flex-row", () => {
    render(<ComposeBox {...baseProps({ contextPct: 50 })} />);
    const meter = screen.getByRole("meter");
    expect(meter.className).toContain("flex-row");
    expect(meter.className).not.toContain("flex-col");
  });

  it("Phase 9 Layout: mobile touch target — top row carries min-h-[44px] when isTouchDevice=true", () => {
    render(
      <ComposeBox
        {...baseProps({
          isTouchDevice: true,
          showPaperclip: true,
          onAttachFiles: vi.fn(),
          stagedAttachments: [],
          onRemoveAttachment: vi.fn(),
        })}
      />,
    );
    // Quick 260730-vtk: Paperclip moved OUT of Row 1 into the Row 2
    // textarea wrapper — so we can no longer use the paperclip as the
    // Row 1 anchor here. Use ThumbsUp (aria-label "Send 'let's go'")
    // instead, which still lives in Row 1's aux group — same anchor as
    // the sibling desktop test just below.
    const thumbsUp = screen.getByLabelText(/send 'let's go'/i);
    const row1 = closestFlexRowAncestor(thumbsUp, /flex items-center gap-2/);
    expect(row1).not.toBeNull();
    expect(row1!.className).toContain("min-h-[44px]");
    expect(row1!.className).not.toContain("min-h-8");
  });

  it("Phase 9 Layout: desktop top row carries min-h-8 when isTouchDevice=false", () => {
    render(
      <ComposeBox
        {...baseProps({
          isTouchDevice: false,
          showPaperclip: false,
          onAttachFiles: vi.fn(),
          stagedAttachments: [],
          onRemoveAttachment: vi.fn(),
        })}
      />,
    );
    // Patch #14-04 test-fix: aria-label was renamed to "Send 'let's go'"
    // (see ComposeBox.tsx around L1245); the regex needed refreshing.
    const thumbsUp = screen.getByLabelText(/send 'let's go'/i);
    const row1 = closestFlexRowAncestor(thumbsUp, /flex items-center gap-2/);
    expect(row1).not.toBeNull();
    expect(row1!.className).toContain("min-h-8");
    expect(row1!.className).not.toContain("min-h-[44px]");
  });

  it("Phase 9 Layout: textarea rows starts at 1 with empty text", () => {
    render(<ComposeBox {...baseProps()} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    expect(textarea.rows).toBe(1);
  });
});

describe("ComposeBox — patch #135 auto-grow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Patch #129 test-hygiene fix (see Phase 05 describe for rationale).
    localStorage.clear();
  });

  it("auto-grow: on mount with empty text, textarea height is at or below the min-h-8 floor", () => {
    // JSDOM has no layout so scrollHeight=0 → useLayoutEffect sets height='0px';
    // real browser sets it to the ~24-28px single-row height; both satisfy ≤32
    // (min-h-8 floor). Key assertion: height is NOT set to some large value.
    render(<ComposeBox {...baseProps()} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    const h = parseFloat(textarea.style.height || "0");
    expect(h).toBeLessThanOrEqual(32);
  });

  it("auto-grow: on text change, style.height is driven off scrollHeight (JSDOM scrollHeight mock)", () => {
    // scrollHeight mocked to 100; MAX_PX falls back to 144 in JSDOM because
    // getComputedStyle(el).lineHeight returns 'normal' → NaN. 100 < 144 so
    // overflowY stays 'hidden' (only flips to 'auto' at the cap).
    render(<ComposeBox {...baseProps()} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    Object.defineProperty(textarea, "scrollHeight", {
      value: 100,
      configurable: true,
    });
    fireEvent.change(textarea, {
      target: {
        value: "a much longer line of text that would wrap in the real DOM",
      },
    });
    expect(parseFloat(textarea.style.height)).toBe(100);
    expect(textarea.style.overflowY).toBe("hidden");
  });
});

// Vehicle B (quick 260801-62m): the /bounty (Target) and /queue (ListPlus
// prefix-send) buttons introduced by patch #204 (quick 260730-l34) have been
// DELETED. Rationale: /bounty is superseded by the natural-language
// "bounty bounty" voice trigger shipped as patch #241 (composeIntentTransform);
// /queue is superseded by the queued-message textareas managed by the
// "Queue a message" (ListPlus) add-textarea button in Row 2. The prior
// describe block ("ComposeBox — quick 260730-l34: /bounty and /queue prefix
// buttons") has been replaced by the removal-assertion block below.
describe("ComposeBox — Vehicle B strip: /queue and /bounty prefix buttons removed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Patch #129 test-hygiene fix: localStorage carries compose-draft
    // between tests otherwise, corrupting the initial-text-empty predicate.
    localStorage.clear();
  });

  it("no longer renders the /bounty (Target) prefix-send button", () => {
    render(<ComposeBox {...baseProps({ canSend: true })} />);
    expect(screen.queryByLabelText(/send with \/bounty prefix/i)).toBeNull();
  });

  it("no longer renders the /queue (ListPlus prefix-send) button", () => {
    render(<ComposeBox {...baseProps({ canSend: true })} />);
    expect(screen.queryByLabelText(/send with \/queue prefix/i)).toBeNull();
  });
});

// ============================================================
// quick-260802-w9e — session-queue-pending-store publish integration
// ============================================================
//
// Verifies ComposeBox is the SOLE publisher for the new store and publishes
// on every queue mutation:
//   (a) mounting publishes `false` (initial empty queue).
//   (b) arming the primary textarea via "Send when idle" publishes `true`.
//   (c) cancelling the armed primary (click the "Cancel queued send"
//       overlay) publishes `false`.
//   (d) unmount publishes `false` (cleanup effect).
//
// Uses getSessionQueuePendingSnapshot() from the store's test helpers to
// inspect the raw internal Map without going through the hook. Resets the
// store via __resetForTest() in beforeEach so each test starts empty.
describe("ComposeBox — quick-260802-w9e session-queue-pending-store publish integration", () => {
  // Import the store's test surface. Kept inside the describe block so the
  // top-level module import list stays scoped to production seams.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let getSnapshot: () => ReadonlyMap<string, boolean>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let resetStore: () => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    const storeMod = await import("@/state/session-queue-pending-store");
    getSnapshot = storeMod.getSessionQueuePendingSnapshot;
    resetStore = storeMod.__resetForTest;
    resetStore();
  });

  afterEach(() => {
    // Belt-and-suspenders — the next describe block's beforeEach may not
    // touch this store; leave a clean slate on exit.
    resetStore();
  });

  it("(a) mount publishes false to the store (initial empty queue) — key `${hostId}:${tmuxSession ?? ''}` matches sessionWorkingKey shape", () => {
    render(<ComposeBox {...baseProps({ hostId: 42, tmuxSession: "sess-alpha" })} />);
    const snap = getSnapshot();
    // Key shape MUST match `${hostId}:${tmuxSession ?? ""}` — same shape as
    // sessionWorkingKey() at PrettyConversationsPanel.tsx:95-98.
    expect(snap.has("42:sess-alpha")).toBe(true);
    expect(snap.get("42:sess-alpha")).toBe(false);
  });

  it("(b) arming the primary textarea for send-when-idle publishes true", async () => {
    render(<ComposeBox {...baseProps({ hostId: 42, tmuxSession: "sess-alpha" })} />);
    // (a) baseline: false is published on mount.
    expect(getSnapshot().get("42:sess-alpha")).toBe(false);

    // Type text into the primary textarea so the "Send when idle" arm button
    // renders (showPrimaryArmButton predicate: text.trim() !== "").
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "arm me for idle" } });
    });

    // Click "Send when idle" (aria-label locks the selector; there is exactly
    // ONE per-textarea arm-idle button in the render tree since only the
    // primary has content).
    const armBtn = screen.getByRole("button", { name: /send when idle/i });
    await act(async () => {
      fireEvent.click(armBtn);
    });

    // Queue mutation → publish effect deps `[queue, sessionKey]` fires → the
    // store snapshot flips to true.
    expect(getSnapshot().get("42:sess-alpha")).toBe(true);
  });

  it("(c) clicking the primary armed overlay ('Cancel queued send') publishes false again", async () => {
    render(<ComposeBox {...baseProps({ hostId: 42, tmuxSession: "sess-alpha" })} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "arm me for idle" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send when idle/i }));
    });
    // Sanity check: armed → true.
    expect(getSnapshot().get("42:sess-alpha")).toBe(true);

    // Cancel the armed primary via the overlay button (aria-label
    // "Cancel queued send"). cancelSourceArmed("primary") filters the entry
    // out of the queue → queue.length === 0 → publish effect fires false.
    const cancelBtn = screen.getByRole("button", { name: /cancel queued send/i });
    await act(async () => {
      fireEvent.click(cancelBtn);
    });

    expect(getSnapshot().get("42:sess-alpha")).toBe(false);
  });

  it("(d) unmount publishes false via the cleanup effect", async () => {
    const { unmount } = render(
      <ComposeBox {...baseProps({ hostId: 42, tmuxSession: "sess-alpha" })} />,
    );
    // Arm first so the state is true → unmount MUST reset it to false.
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "arm me for idle" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send when idle/i }));
    });
    expect(getSnapshot().get("42:sess-alpha")).toBe(true);

    // Unmount fires the cleanup effect (deps `[sessionKey]`) → publishes
    // false. Belt-and-suspenders even against the publish effect's own
    // cleanup: the dedicated cleanup effect fires exactly once with the
    // final `false` state regardless of queue mutation cadence.
    await act(async () => {
      unmount();
    });
    expect(getSnapshot().get("42:sess-alpha")).toBe(false);
  });

  it("(e) tmuxSession=null (Windows / no-tmux host) publishes with the `${hostId}:` key shape", () => {
    // Regression guard for the key-shape contract: sessionWorkingKey at
    // PrettyConversationsPanel.tsx:95-98 emits `${hostId}:` (trailing colon,
    // empty tmux segment) when targetTmuxSession is null. The compose-box
    // publisher MUST emit the identical shape so a consumer that resolves
    // one string finds both stores.
    render(<ComposeBox {...baseProps({ hostId: 99, tmuxSession: null })} />);
    expect(getSnapshot().has("99:")).toBe(true);
    expect(getSnapshot().get("99:")).toBe(false);
  });
});

/**
 * Phase 50 Plan 03 Task 2 — optimistic-bubble seeding tests.
 *
 * D-01/D-03/D-18/D-20 + Warning #6 + Blocker #3 + Blocker #4 pre-req.
 *
 * These tests exercise the new onOptimisticSend + overrideText +
 * onOverrideTextConsumed contract and the widened onSend(text, mqid?)
 * prop signature added by Task 2. The COMPOSE-04 sweep is verified by
 * grep gates in the plan acceptance criteria (not by unit tests) since
 * comment-removal cannot fail a runtime assertion.
 */
describe("ComposeBox — optimistic bubble seeding (Phase 50 Plan 03 Task 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("Test 2: onOptimisticSend fires synchronously with successful onSend, mqid forwarded", async () => {
    const onSend = vi.fn(() => true);
    const onOptimisticSend = vi.fn();
    render(
      <ComposeBox {...baseProps({ onSend, onOptimisticSend })} />,
    );
    // Type into textarea and press Enter.
    const textarea = screen.getByPlaceholderText(/^Message/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello world" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await Promise.resolve();
    // onOptimisticSend fired at least once with immediateFailure:false.
    expect(onOptimisticSend).toHaveBeenCalled();
    const firstCall = onOptimisticSend.mock.calls[0]![0] as {
      payload: string;
      mqid: string;
      immediateFailure: boolean;
    };
    expect(firstCall.payload).toBe("hello world");
    expect(firstCall.immediateFailure).toBe(false);
    expect(firstCall.mqid).toMatch(/^pv-optim-\d+-[0-9a-z]{8}$/);
    // onSend received the same mqid as second arg.
    expect(onSend).toHaveBeenCalled();
    const [sendText, sendMqid] = onSend.mock.calls[0]!;
    expect(sendText).toBe("hello world");
    expect(sendMqid).toBe(firstCall.mqid);
  });

  it("Test 3: onSend returning false triggers onOptimisticSend with immediateFailure:true and preserves text", async () => {
    const onSend = vi.fn(() => false); // WS down
    const onOptimisticSend = vi.fn();
    render(
      <ComposeBox {...baseProps({ onSend, onOptimisticSend })} />,
    );
    const textarea = screen.getByPlaceholderText(/^Message/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "failing send" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await Promise.resolve();
    // Two calls: first immediateFailure:false (pre-onSend), second true.
    expect(onOptimisticSend).toHaveBeenCalledTimes(2);
    const firstCall = onOptimisticSend.mock.calls[0]![0] as {
      immediateFailure: boolean;
      mqid: string;
    };
    const secondCall = onOptimisticSend.mock.calls[1]![0] as {
      immediateFailure: boolean;
      mqid: string;
    };
    expect(firstCall.immediateFailure).toBe(false);
    expect(secondCall.immediateFailure).toBe(true);
    // Same mqid across both calls (single-source per send).
    expect(firstCall.mqid).toBe(secondCall.mqid);
    // Text preserved (draft stays for user to retry-and-resend).
    expect(textarea.value).toBe("failing send");
  });

  it("Test 5: mqid format matches pv-optim-<timestamp>-<random8hex>", async () => {
    const onSend = vi.fn(() => true);
    const onOptimisticSend = vi.fn();
    render(
      <ComposeBox {...baseProps({ onSend, onOptimisticSend })} />,
    );
    const textarea = screen.getByPlaceholderText(/^Message/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hi" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await Promise.resolve();
    const { mqid } = onOptimisticSend.mock.calls[0]![0] as { mqid: string };
    expect(mqid).toMatch(/^pv-optim-\d+-[0-9a-z]{8}$/);
  });

  it("Test 6: overrideText populates textarea and fires onOverrideTextConsumed synchronously", async () => {
    const onOverrideTextConsumed = vi.fn();
    const { rerender } = render(
      <ComposeBox
        {...baseProps({ overrideText: null, onOverrideTextConsumed })}
      />,
    );
    const textarea = screen.getByPlaceholderText(/^Message/) as HTMLTextAreaElement;
    // Wait for hydrate effect to settle (async getComposeDraft mock resolves).
    await waitFor(() => expect(textarea.value).toBe(""));
    expect(onOverrideTextConsumed).not.toHaveBeenCalled();
    // Now override with a non-empty value → useEffect populates + acks.
    rerender(
      <ComposeBox
        {...baseProps({
          overrideText: "recovered text",
          onOverrideTextConsumed,
        })}
      />,
    );
    await waitFor(() => expect(textarea.value).toBe("recovered text"));
    expect(onOverrideTextConsumed).toHaveBeenCalledTimes(1);
  });

  it("Test 7: onSend prop signature is (text, mqid?) — call site forwards mqid as second arg", async () => {
    // Regression against Blocker #4 — the mqid MUST flow through onSend.
    const onSend = vi.fn(() => true);
    const onOptimisticSend = vi.fn();
    render(
      <ComposeBox {...baseProps({ onSend, onOptimisticSend })} />,
    );
    const textarea = screen.getByPlaceholderText(/^Message/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "mqid check" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await Promise.resolve();
    expect(onSend).toHaveBeenCalledTimes(1);
    const call = onSend.mock.calls[0]!;
    expect(call.length).toBeGreaterThanOrEqual(2);
    expect(call[0]).toBe("mqid check");
    expect(typeof call[1]).toBe("string");
    expect(call[1]).toMatch(/^pv-optim-\d+-[0-9a-z]{8}$/);
  });
});
