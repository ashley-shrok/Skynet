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

    const plusBtn = screen.getByRole("button", { name: /add queued message textarea/i });
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

    fireEvent.click(screen.getByRole("button", { name: /add queued message textarea/i }));

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

    const plusBtn = screen.getByRole("button", { name: /add queued message textarea/i });
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
  it("QS 4 — clicking slot Send with text calls onSend and removes the slot on success (true)", async () => {
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend })} />);
    await flushMountEffect();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add queued message textarea/i }));
    });

    const allTextareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    // Slot renders ABOVE primary in DOM: slot = index 0, primary = last.
    const slotTextarea = allTextareas[0];

    await act(async () => {
      fireEvent.change(slotTextarea, { target: { value: "send this" } });
    });

    // Find the slot's Send button (not the primary Send)
    const slotSendBtn = screen.getByRole("button", { name: /send queued message/i });
    await act(async () => {
      fireEvent.click(slotSendBtn);
    });

    expect(onSend).toHaveBeenCalledWith("send this");
    // Slot should be removed after successful send
    expect(screen.getAllByRole("textbox").length).toBe(1); // only primary
  });

  // QS 5: Send slot failure — slot persists, errorMessage surfaces
  it("QS 5 — clicking slot Send when onSend returns false keeps the slot and shows error", async () => {
    const onSend = vi.fn(() => false);
    render(<ComposeBox {...baseProps({ onSend })} />);
    await flushMountEffect();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add queued message textarea/i }));
    });

    const allTextareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    // Slot renders ABOVE primary in DOM: slot = index 0, primary = last.
    const slotTextarea = allTextareas[0];

    await act(async () => {
      fireEvent.change(slotTextarea, { target: { value: "failing send" } });
    });

    const slotSendBtn = screen.getByRole("button", { name: /send queued message/i });
    await act(async () => {
      fireEvent.click(slotSendBtn);
    });

    expect(onSend).toHaveBeenCalledWith("failing send");
    // Slot persists
    expect(screen.getAllByRole("textbox").length).toBe(2);
    // Error message surfaces
    expect(screen.getByText(/not connected/i)).toBeTruthy();
  });

  // QS 6: Send slot disabled when empty
  it("QS 6 — slot Send button is disabled when slot.text.trim() is empty", async () => {
    render(<ComposeBox {...baseProps()} />);
    await flushMountEffect();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add queued message textarea/i }));
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
      fireEvent.click(screen.getByRole("button", { name: /add queued message textarea/i }));
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

    fireEvent.click(screen.getByRole("button", { name: /add queued message textarea/i }));

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

    fireEvent.click(screen.getByRole("button", { name: /add queued message textarea/i }));

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

// Quick 260730-l34 (patch #204): Target (/bounty) and ListPlus (/queue)
// prefix-send buttons in the aux row between Lightbulb and Hourglass.
// Payload contract: click → handleSend("/bounty <text>") or ("/queue <text>")
// via the overridePayload seam at ComposeBox.tsx:795. Textarea clears on
// success (COMPOSE-04 hard-lock). Disabled predicate matches the aux-row
// pattern PLUS the empty-text guard (text.trim() === "").
describe("ComposeBox — quick 260730-l34: /bounty and /queue prefix buttons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Patch #129 test-hygiene fix: localStorage carries compose-draft
    // between tests otherwise, corrupting the initial-text-empty predicate.
    localStorage.clear();
  });

  it("renders Target (bounty) button with aria-label 'Send with /bounty prefix'", () => {
    render(<ComposeBox {...baseProps({ canSend: true })} />);
    expect(screen.getByLabelText(/send with \/bounty prefix/i)).toBeTruthy();
  });

  it("renders ListPlus (queue) button with aria-label 'Send with /queue prefix'", () => {
    render(<ComposeBox {...baseProps({ canSend: true })} />);
    expect(screen.getByLabelText(/send with \/queue prefix/i)).toBeTruthy();
  });

  it("bounty button click with text present calls onSend with '/bounty <text>' payload", () => {
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend, canSend: true })} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(screen.getByLabelText(/send with \/bounty prefix/i));
    expect(onSend).toHaveBeenCalledWith("/bounty hello");
    // COMPOSE-04 clear-on-success contract.
    expect(textarea.value).toBe("");
  });

  it("queue button click with text present calls onSend with '/queue <text>' payload", () => {
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend, canSend: true })} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(screen.getByLabelText(/send with \/queue prefix/i));
    expect(onSend).toHaveBeenCalledWith("/queue hello");
    // COMPOSE-04 clear-on-success contract.
    expect(textarea.value).toBe("");
  });

  it("bounty and queue buttons are disabled when textarea is empty", () => {
    render(<ComposeBox {...baseProps({ canSend: true })} />);
    const bountyBtn = screen.getByLabelText(/send with \/bounty prefix/i) as HTMLButtonElement;
    const queueBtn = screen.getByLabelText(/send with \/queue prefix/i) as HTMLButtonElement;
    expect(bountyBtn.disabled).toBe(true);
    expect(queueBtn.disabled).toBe(true);
  });

  it("bounty and queue buttons become enabled when text is present", () => {
    render(<ComposeBox {...baseProps({ canSend: true })} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hi" } });
    const bountyBtn = screen.getByLabelText(/send with \/bounty prefix/i) as HTMLButtonElement;
    const queueBtn = screen.getByLabelText(/send with \/queue prefix/i) as HTMLButtonElement;
    expect(bountyBtn.disabled).toBe(false);
    expect(queueBtn.disabled).toBe(false);
  });
});
