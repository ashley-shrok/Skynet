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
    // Patch #129: selector updated from getByLabelText(/send message/i) to
    // getByRole('button', { name: 'Send' }) — the retired amber-Send from
    // patch #121 wore aria-label="Send message"; the new inside-textarea
    // Send button wears aria-label="Send" (exact match, no regex).
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
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

  it("inside-textarea send button: click with text present calls onSend with trimmed payload and clears the textarea (COMPOSE-04)", () => {
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend })} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hi there  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    // handleSend trims trailing whitespace before dispatch.
    expect(onSend).toHaveBeenCalledWith("hi there");
    // COMPOSE-04 clear-on-success: textarea is empty after a truthy dispatch.
    expect(textarea.value).toBe("");
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
    const thumbsUp = screen.getByLabelText(/send 'yes'/i);
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
    const paperclip = screen.getByLabelText(/attach file/i);
    const row1 = closestFlexRowAncestor(paperclip, /flex items-center gap-2/);
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
    const thumbsUp = screen.getByLabelText(/send 'yes'/i);
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
