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
import { getComposeDraft, putComposeDraft } from "@/api/compose-drafts-api";

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

// Quick 260814-1hz: the Send button no longer hosts the useHoldToRecord
// hook — that gesture has moved to MicButton. Send is back to a plain
// onClick={handleSend} (preserving the aside-morph onAsideDismiss branch). Consequently,
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
    // Cross-user leak fix: compose draft keys are namespaced by the
    // currently-logged-in user (`skynet:compose-draft:<user>:<hostId>:<key>`).
    // Seed skynet_auth so the key factory emits the canonical production
    // shape; without this the factory falls back to the "__anon" guard.
    localStorage.setItem(
      "skynet_auth",
      JSON.stringify({ loggedIn: true, username: "test-user" }),
    );
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
    // Walk up to the composer's text field — the same one that contains
    // the textarea (shape-conversation-view: one card, text on top).
    const stripWrapper = strip.closest('[data-testid="compose-primary-wrapper"]');
    const textareaWrapper = textarea.closest(
      '[data-testid="compose-primary-wrapper"]',
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

  it("Test 4b: paperclip renders in the control row (with the main button), not in the text field", () => {
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
    // shape-conversation-view: one card — text on top, every control on one
    // row underneath. With nothing typed the main button is the thumbs-up.
    const row = screen.getByTestId("compose-row");
    expect(row.contains(paperclip)).toBe(true);
    expect(row.contains(screen.getByRole("button", { name: "Send 'thumbs up'" }))).toBe(true);
    expect(screen.getByTestId("compose-primary-wrapper").contains(paperclip)).toBe(false);
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
      // Quick 260823-8ji: onSendWithAttachments now returns Promise<BatchOutcome>.
      // Mock resolves ok so the awaited chain inside handleSend's attachment
      // path completes without an unhandled-rejection warning.
      const onSendWithAttachments = vi.fn(() =>
        Promise.resolve({ ok: true as const }),
      );

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
      expect(onSendWithAttachments).toHaveBeenCalledWith("hey", "typed");
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
    // shape-conversation-view: with nothing to send, the main button is the
    // thumbs-up — Send isn't rendered at all.
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    expect(screen.getByRole("button", { name: "Send 'thumbs up'" })).toBeTruthy();
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
  // Patch #129 — inside-textarea send button (user-locked visual)
  // ============================================================

  it("main Send button: a bare <button> in the control row, rendered once there is something to send", () => {
    render(<ComposeBox {...baseProps()} />);
    // shape-conversation-view: nothing typed → no Send (the thumbs-up is main).
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: "hi" } });
    const sendBtn = screen.getByRole("button", { name: "Send" });
    expect(sendBtn.tagName).toBe("BUTTON");
    expect(sendBtn.getAttribute("data-main")).toBe("true");
    expect(screen.getByTestId("compose-row").contains(sendBtn)).toBe(true);
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

  // ============================================================
  // Quick 260823-8ji: attachment-path outcome gating.
  //
  // handleSend's attachment branch used to fire-and-forget:
  //   onSendWithAttachments(caption); setText(""); clearAfterSend();
  // silently clearing the compose textarea + attachment chips even when
  // the batch never reached upload_ready_to_inject (WS drop, upload_failed,
  // timeout). user hit this four times on 2026-08-23 across wanda + nelly.
  //
  // These tests lock the new contract: onSendWithAttachments returns a
  // Promise<BatchOutcome>; handleSend awaits it and only clears on
  // outcome.ok. On !outcome.ok it preserves textarea + chips and surfaces
  // an inline error via setErrorMessage(reason-specific string).
  // ============================================================

  it("attachment outcome-gating T1 (happy): outcome ok clears the textarea", async () => {
    const restore = withMediaDevicesStub();
    try {
      const onRemoveAttachment = vi.fn();
      const onSendWithAttachments = vi.fn(() =>
        Promise.resolve({ ok: true as const }),
      );
      render(
        <ComposeBox
          {...baseProps({
            stagedAttachments: [mkAtt("a", "one.txt")],
            onRemoveAttachment,
            showPaperclip: false,
            onAttachFiles: vi.fn(),
            onSendWithAttachments,
          })}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        /message/i,
      ) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "hey" } });
      await act(async () => {
        await shortTapSendButton(
          screen.getByRole("button", { name: "Send" }) as HTMLButtonElement,
        );
      });
      // Give the awaited outcome one more microtask hop to settle.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(onSendWithAttachments).toHaveBeenCalledWith("hey", "typed");
      expect(textarea.value).toBe(""); // cleared on ok
      // No error surface rendered.
      expect(screen.queryByText(/Upload failed/i)).toBeNull();
      expect(screen.queryByText(/timed out/i)).toBeNull();
      expect(screen.queryByText(/Not connected/i)).toBeNull();
    } finally {
      restore();
    }
  });

  it("attachment outcome-gating T2 (upload_failed): outcome !ok preserves textarea + surfaces 'Upload failed'", async () => {
    const restore = withMediaDevicesStub();
    try {
      const onRemoveAttachment = vi.fn();
      const onSendWithAttachments = vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          reason: "upload_failed" as const,
          message: "sftp_error: connection lost",
        }),
      );
      render(
        <ComposeBox
          {...baseProps({
            stagedAttachments: [mkAtt("a", "one.txt")],
            onRemoveAttachment,
            showPaperclip: false,
            onAttachFiles: vi.fn(),
            onSendWithAttachments,
          })}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        /message/i,
      ) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "hey" } });
      await act(async () => {
        await shortTapSendButton(
          screen.getByRole("button", { name: "Send" }) as HTMLButtonElement,
        );
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(onSendWithAttachments).toHaveBeenCalledWith("hey", "typed");
      // Textarea PRESERVED — user may want to retry.
      expect(textarea.value).toBe("hey");
      // Chips PRESERVED — parent's onRemoveAttachment was NOT invoked.
      expect(onRemoveAttachment).not.toHaveBeenCalled();
      // Inline error surface rendered.
      expect(screen.getByText("Upload failed — try again.")).toBeTruthy();
    } finally {
      restore();
    }
  });

  it("attachment outcome-gating T3 (timeout): outcome !ok reason=timeout preserves + surfaces timeout error", async () => {
    const restore = withMediaDevicesStub();
    try {
      const onRemoveAttachment = vi.fn();
      const onSendWithAttachments = vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          reason: "timeout" as const,
        }),
      );
      render(
        <ComposeBox
          {...baseProps({
            stagedAttachments: [mkAtt("a", "one.txt")],
            onRemoveAttachment,
            showPaperclip: false,
            onAttachFiles: vi.fn(),
            onSendWithAttachments,
          })}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        /message/i,
      ) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "hey" } });
      await act(async () => {
        await shortTapSendButton(
          screen.getByRole("button", { name: "Send" }) as HTMLButtonElement,
        );
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(textarea.value).toBe("hey");
      expect(onRemoveAttachment).not.toHaveBeenCalled();
      expect(
        screen.getByText("Upload timed out — check connection and try again."),
      ).toBeTruthy();
    } finally {
      restore();
    }
  });

  it("attachment outcome-gating T4 (ws_not_open): outcome !ok reason=ws_not_open preserves + surfaces connection error", async () => {
    const restore = withMediaDevicesStub();
    try {
      const onRemoveAttachment = vi.fn();
      const onSendWithAttachments = vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          reason: "ws_not_open" as const,
        }),
      );
      render(
        <ComposeBox
          {...baseProps({
            stagedAttachments: [mkAtt("a", "one.txt")],
            onRemoveAttachment,
            showPaperclip: false,
            onAttachFiles: vi.fn(),
            onSendWithAttachments,
          })}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        /message/i,
      ) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "hey" } });
      await act(async () => {
        await shortTapSendButton(
          screen.getByRole("button", { name: "Send" }) as HTMLButtonElement,
        );
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(textarea.value).toBe("hey");
      expect(onRemoveAttachment).not.toHaveBeenCalled();
      expect(
        screen.getByText("Not connected — try again in a moment."),
      ).toBeTruthy();
    } finally {
      restore();
    }
  });

  it("main Send button: disabled state — relay mode with empty text reports disabled and click is a no-op", () => {
    // Relay rooms always render Send (mic + Send only), disabled while empty.
    const onSendA = vi.fn(() => true);
    const { unmount } = render(<ComposeBox {...baseProps({ onSend: onSendA, mode: "relay" })} />);
    const btnA = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(btnA.disabled).toBe(true);
    fireEvent.click(btnA);
    expect(onSendA).not.toHaveBeenCalled();
    unmount();

    // Harness mode, canSend=false, empty text → no Send at all (thumbs-up is
    // the main button) — so nothing can dispatch.
    const onSendB = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend: onSendB, canSend: false })} />);
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    expect(onSendB).not.toHaveBeenCalled();
  });
});

// ============================================================
// Drafts saved before "Queue a message" was retired may still carry queued
// messages; their text is folded into the main box and saved back without them.
// ============================================================

describe("ComposeBox — legacy queued messages fold into the draft body", () => {
  const lsKey = "skynet:compose-draft:test-user:1:s1";

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem(
      "skynet_auth",
      JSON.stringify({ loggedIn: true, username: "test-user" }),
    );
    vi.mocked(getComposeDraft).mockResolvedValue({ body: "", queueSlots: [] });
    vi.mocked(putComposeDraft).mockResolvedValue(undefined);
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

  async function flushAutosave() {
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("server draft: body then each non-blank queued message, a blank line between; the next save sends no queued messages", async () => {
    const info = vi.spyOn(console, "info");
    vi.mocked(getComposeDraft).mockResolvedValueOnce({
      body: "a",
      queueSlots: [
        { id: "q1", text: "b" },
        { id: "q2", text: "  " },
        { id: "q3", text: "c" },
      ],
    });
    render(<ComposeBox {...baseProps()} />);
    await flushMountEffect();

    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    expect(textareas).toHaveLength(1);
    expect(textareas[0].value).toBe("a\n\nb\n\nc");
    expect(
      info.mock.calls.filter((c) => String(c[0]).includes("operation=compose_draft_queue_slots_folded")),
    ).toHaveLength(1);

    await flushAutosave();
    expect(putComposeDraft).toHaveBeenCalledTimes(1);
    expect(putComposeDraft).toHaveBeenLastCalledWith(1, "s1", "a\n\nb\n\nc", []);
    expect(JSON.parse(localStorage.getItem(lsKey)!)).toEqual({ body: "a\n\nb\n\nc" });
    info.mockRestore();
  });

  it("localStorage-only legacy draft {body: \"\", queueSlots: [{text: \"x\"}]} restores as \"x\"", async () => {
    localStorage.setItem(lsKey, JSON.stringify({ body: "", queueSlots: [{ text: "x" }] }));
    render(<ComposeBox {...baseProps()} />);
    await flushMountEffect();

    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("x");
    await flushAutosave();
    expect(putComposeDraft).toHaveBeenLastCalledWith(1, "s1", "x", []);
  });

  it("a draft without queued messages loads as-is and is not re-saved", async () => {
    vi.mocked(getComposeDraft).mockResolvedValueOnce({ body: "plain", queueSlots: [] });
    render(<ComposeBox {...baseProps()} />);
    await flushMountEffect();

    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("plain");
    await flushAutosave();
    expect(putComposeDraft).not.toHaveBeenCalled();
  });
});

describe("ComposeBox — Phase 9 layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Patch #129 test-hygiene fix (see Phase 05 describe for rationale).
    localStorage.clear();
    // Cross-user leak fix: compose-draft keys include the username; seed
    // skynet_auth so the key factory emits the canonical production shape.
    localStorage.setItem(
      "skynet_auth",
      JSON.stringify({ loggedIn: true, username: "test-user" }),
    );
  });

  it("Layout: one card — text field on top, one control row underneath and Send replacing the thumbs-up while typing", () => {
    render(<ComposeBox {...baseProps()} />);
    const field = screen.getByTestId("compose-primary-wrapper");
    const row = screen.getByTestId("compose-row");
    // Text field precedes the control row in document order.
    // eslint-disable-next-line no-bitwise
    expect(field.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Nothing typed: the thumbs-up is the main button; no Send.
    const thumbsMain = screen.getByRole("button", { name: "Send 'thumbs up'" });
    expect(thumbsMain.getAttribute("data-main")).toBe("true");
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();

    // Text typed: Send becomes the main button and the thumbs-up goes away.
    fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: "hi" } });
    const send = screen.getByRole("button", { name: "Send" });
    expect(send.getAttribute("data-main")).toBe("true");
    expect(row.contains(send)).toBe(true);
    expect(screen.queryByRole("button", { name: "Send 'thumbs up'" })).toBeNull();
  });

  it("Layout: the composer holds no agent memory — no pie, no memory edge (it lives in the task pill)", () => {
    const { container } = render(<ComposeBox {...baseProps()} />);
    expect(screen.queryByTestId("memory-gauge")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Agent memory/ })).toBeNull();
    expect(container.querySelector(".pv-composebox")!.hasAttribute("data-memory")).toBe(false);
  });

  it("Layout: touch devices flag the composer root (data-touch) so CSS sizes touch targets", () => {
    const { container, rerender } = render(
      <ComposeBox {...baseProps({ isTouchDevice: true })} />,
    );
    const root = container.querySelector(".pv-composebox")!;
    expect(root.getAttribute("data-touch")).toBe("true");
    rerender(<ComposeBox {...baseProps({ isTouchDevice: false })} />);
    expect(container.querySelector(".pv-composebox")!.getAttribute("data-touch")).toBeNull();
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
    // Cross-user leak fix: compose-draft keys include the username; seed
    // skynet_auth so the key factory emits the canonical production shape.
    localStorage.setItem(
      "skynet_auth",
      JSON.stringify({ loggedIn: true, username: "test-user" }),
    );
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
    // scrollHeight mocked to 100; MAX_PX falls back to 360 in JSDOM because
    // getComputedStyle(el).lineHeight returns 'normal' → NaN. 100 < 360 so
    // overflowY stays 'hidden' (flips to 'auto' only when the text doesn't fit).
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
    // Cross-user leak fix: compose-draft keys include the username; seed
    // skynet_auth so the key factory emits the canonical production shape.
    localStorage.setItem(
      "skynet_auth",
      JSON.stringify({ loggedIn: true, username: "test-user" }),
    );
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

/**
 * Phase 50 Plan 03 Task 2 — optimistic-bubble seeding tests.
 *
 * D-01/D-03/D-18/D-20 + Warning #6 + Blocker #3 + Blocker #4 pre-req.
 *
 * These tests exercise the new onOptimisticSend + overrideText +
 * onOverrideTextConsumed contract and the widened onSend(text, mqid?)
 * prop signature added by Task 2. The prior HARD LOCK sweep is verified
 * by grep gates in the plan acceptance criteria (not by unit tests)
 * since comment-removal cannot fail a runtime assertion.
 */
describe("ComposeBox — optimistic bubble seeding (Phase 50 Plan 03 Task 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Cross-user leak fix: compose-draft keys include the username; seed
    // skynet_auth so the key factory emits the canonical production shape.
    localStorage.setItem(
      "skynet_auth",
      JSON.stringify({ loggedIn: true, username: "test-user" }),
    );
  });

  it("Test 2: onOptimisticSend fires synchronously with successful onSend, mqid forwarded", async () => {
    const onSend = vi.fn(() => true);
    const onOptimisticSend = vi.fn();
    render(
      <ComposeBox {...baseProps({ onSend, onOptimisticSend })} />,
    );
    // Type into textarea and press Enter.
    const textarea = screen.getByPlaceholderText(/^Write a message/) as HTMLTextAreaElement;
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

  it("Test 3: onSend returning false triggers onOptimisticSend with immediateFailure:true and clears textarea", async () => {
    const onSend = vi.fn(() => false); // WS down
    const onOptimisticSend = vi.fn();
    render(
      <ComposeBox {...baseProps({ onSend, onOptimisticSend })} />,
    );
    const textarea = screen.getByPlaceholderText(/^Write a message/) as HTMLTextAreaElement;
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
    // Textarea CLEARED — red bubble in transcript is the record of the send;
    // no draft-preservation for retry (user 2026-09-02).
    expect(textarea.value).toBe("");
  });

  it("Test 5: mqid format matches pv-optim-<timestamp>-<random8hex>", async () => {
    const onSend = vi.fn(() => true);
    const onOptimisticSend = vi.fn();
    render(
      <ComposeBox {...baseProps({ onSend, onOptimisticSend })} />,
    );
    const textarea = screen.getByPlaceholderText(/^Write a message/) as HTMLTextAreaElement;
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
    const textarea = screen.getByPlaceholderText(/^Write a message/) as HTMLTextAreaElement;
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
    const textarea = screen.getByPlaceholderText(/^Write a message/) as HTMLTextAreaElement;
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

// ---------------------------------------------------------------------------
// Newline policy: LF preserved, CR eliminated.
//
// Supersedes the original D-50 rule (collapse ALL newlines to spaces). D-50's
// stated hazard was Ink's REPL treating an embedded CR as a mid-message
// submit, and it predated patch #118, which made the transport multi-line-safe
// by dispatching Enter as a real key event over a separate `tmux send-keys`
// channel. Re-verified empirically 2026-09-16 against live claude v2.1.150:
// an LF-bearing body renders as real lines in the composer with NO premature
// submit, while a bare CR fires a submit at the CR and splits one user message
// into two. So CR is the hazard; LF is safe and must survive.
//
// The trailing-CR submit sentinel is NOT this helper's business — it is
// appended downstream at IdentitySessionPane.tsx (`send(text + "\r", mqid)`),
// so onSend here only ever receives interior newlines.
// ---------------------------------------------------------------------------
describe("ComposeBox — newline normalization on send (LF kept, CR dropped)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Cross-user leak fix: compose-draft keys include the username; seed
    // skynet_auth so the key factory emits the canonical production shape.
    localStorage.setItem(
      "skynet_auth",
      JSON.stringify({ loggedIn: true, username: "test-user" }),
    );
  });

  async function sendAndCapture(value: string): Promise<string> {
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend })} />);
    const textarea = screen.getByPlaceholderText(
      /^Write a message/,
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await Promise.resolve();
    expect(onSend).toHaveBeenCalledTimes(1);
    return onSend.mock.calls[0]![0] as string;
  }

  it("preserves interior LFs — a multi-line message reaches onSend with newlines intact", async () => {
    const payload = await sendAndCapture("LINE-ONE\nLINE-TWO\nLINE-THREE");
    expect(payload).toBe("LINE-ONE\nLINE-TWO\nLINE-THREE");
    // The load-bearing assertion: this is what the old collapse destroyed.
    expect(payload).toContain("\n");
    expect(payload).not.toBe("LINE-ONE LINE-TWO LINE-THREE");
  });

  it("normalizes CRLF to a bare LF", async () => {
    const payload = await sendAndCapture("WIN-ONE\r\nWIN-TWO");
    expect(payload).toBe("WIN-ONE\nWIN-TWO");
    expect(payload).not.toContain("\r");
  });

  it("converts a lone interior CR to LF — no CR survives to the transport", async () => {
    // A bare CR is the actual Ink hazard: it fires a premature submit and
    // splits one message in two. It must never reach send-keys.
    const payload = await sendAndCapture("CR-ONE\rCR-TWO");
    expect(payload).not.toContain("\r");
    expect(payload).toBe("CR-ONE\nCR-TWO");
  });

  it("leaves a single-line message byte-identical (no regression for the common case)", async () => {
    const payload = await sendAndCapture("just one line");
    expect(payload).toBe("just one line");
  });

  it("preserves blank lines inside a multi-line message (paragraph breaks survive)", async () => {
    const payload = await sendAndCapture("PARA-ONE\n\nPARA-TWO");
    expect(payload).toBe("PARA-ONE\n\nPARA-TWO");
  });

  it("mixed CRLF + LF + lone CR all normalize to LF uniformly", async () => {
    const payload = await sendAndCapture("a\r\nb\nc\rd");
    expect(payload).toBe("a\nb\nc\nd");
    expect(payload).not.toContain("\r");
  });
});
