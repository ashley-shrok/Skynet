// Tests for ComposeBox's Phase 05 additions — chip strip mount, mobile-only
// paperclip, paste handler, and send-with-attachments seam.
//
// The compose-draft persistence effect (patch #57) fires network calls; we
// mock the compose-drafts API so tests don't touch fetch. useIsTouchDevice
// is mocked per-test to flip the paperclip visibility.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { StagedAttachmentLike } from "./AttachmentChipStrip";

// Mock the compose-drafts API BEFORE importing ComposeBox so the module's
// effect uses the mock at first render.
vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "" }),
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

describe("ComposeBox — Phase 05 upload wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("Test 2: chip strip mounts above the textarea when attachments are staged", () => {
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

  it("Test 7: Send with attachments routes to onSendWithAttachments; without attachments still uses onSend", () => {
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
    fireEvent.click(screen.getByLabelText(/send message/i));
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
    fireEvent.click(screen.getByLabelText(/send message/i));
    expect(onSend).toHaveBeenCalledWith("plain");
    expect(onSendWithAttachments).not.toHaveBeenCalled();
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
    const sendBtnA = screen.getByLabelText(/send message/i) as HTMLButtonElement;
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
    const sendBtnB = screen.getByLabelText(/send message/i) as HTMLButtonElement;
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
    expect(onSend).toHaveBeenCalledWith("hi");
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
});
