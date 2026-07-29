/**
 * Quick 260729-j8l — ComposeBox recycleActive tests.
 *
 * Body consumption tests for the new `recycleActive?: boolean` prop
 * that flips every WS-side-effecting control off during a session
 * recycle while leaving the textarea typeable so Ashley can pre-draft
 * the next message during the 2-15s recycle window.
 *
 * Truth table pinned:
 *   - Send button: STAYS as Send (aria-label "Send", paper-plane icon,
 *     NOT morphed to X/Resume) but `disabled=true`. Send is orthogonal
 *     to aside — recycle disables, aside morphs.
 *   - Aux buttons (reset cell, paperclip, ThumbsUp, Lightbulb, Queue):
 *     ALL disabled=true when recycleActive=true. Predicates OR-in
 *     `|| recycleActive === true` in parallel with the existing
 *     `|| asideActive === true` clause.
 *   - Textarea: STAYS typeable (disabled unchanged). Draft survives the
 *     recycle by the existing autosave path (patches #57 / #119).
 *   - Enter key: does NOT fire onSend when recycleActive=true (the
 *     handleKeyDown early-return closes the "button disabled but
 *     Enter still fires" gap).
 *   - Baseline (recycleActive=false / undefined): every gate above
 *     reverts — Send fires on click, Enter fires, aux buttons enabled.
 *
 * Renders + mock setup mirror ComposeBox.aside-morph.test.tsx verbatim
 * (established fixture pattern for the file).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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
    canSend: true,
    ...overrides,
  };
}

describe("ComposeBox — quick 260729-j8l recycleActive gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Patch #129 test-hygiene: localStorage persists across tests in the
    // shared JSDOM instance and patch #119's compose-draft-ls mirror writes
    // to it on every keystroke. Clear so this file's tests don't hydrate
    // from a prior test's leftover draft.
    localStorage.clear();
  });

  it("B1: recycleActive=true — Send button is disabled but NOT morphed to X (still aria-label 'Send')", () => {
    const { container } = render(
      <ComposeBox {...baseProps({ recycleActive: true })} />,
    );
    // Type some text so `sendDisabled` is not driven by empty-text.
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello mid-recycle" } });

    // aria-label is "Send" (NOT "Resume"). Morph is aside-only.
    const sendBtn = screen.getByLabelText("Send") as HTMLButtonElement;
    expect(sendBtn).toBeTruthy();
    // Disabled by sendDisabled → recycleActive OR-in.
    expect(sendBtn.disabled).toBe(true);
    // Paper-plane inline SVG still renders (NOT the lucide X).
    const paperPlanePath = container.querySelector('path[d^="M14.536"]');
    expect(paperPlanePath).not.toBeNull();
    // No "Resume" button (morph is aside-only).
    expect(screen.queryByLabelText("Resume")).toBeNull();
  });

  it("B2: recycleActive=true — aux buttons all disabled", () => {
    render(
      <ComposeBox
        {...baseProps({
          recycleActive: true,
          showPaperclip: true,
          onAttachFiles: vi.fn(),
          // onInterrupt intentionally omitted — the stop button doesn't
          // participate in the recycleActive gate (not in the plan's
          // aux-button disable set).
        })}
      />,
    );
    const resetBtn = screen.getByLabelText("Send with /id reset prefix") as HTMLButtonElement;
    const attachBtn = screen.getByLabelText("Attach file") as HTMLButtonElement;
    const thumbsUpBtn = screen.getByLabelText("Send 'let's go'") as HTMLButtonElement;
    const explainBtn = screen.getByLabelText("Ask for a concise re-explanation") as HTMLButtonElement;
    const queueBtn = screen.getByLabelText("Queue send for when session goes idle") as HTMLButtonElement;
    expect(resetBtn.disabled).toBe(true);
    expect(attachBtn.disabled).toBe(true);
    expect(thumbsUpBtn.disabled).toBe(true);
    expect(explainBtn.disabled).toBe(true);
    expect(queueBtn.disabled).toBe(true);
  });

  it("B3: recycleActive=true — textarea stays typeable", () => {
    render(<ComposeBox {...baseProps({ recycleActive: true })} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
    fireEvent.change(textarea, { target: { value: "draft during recycle" } });
    expect(textarea.value).toBe("draft during recycle");
  });

  it("B4: recycleActive=true — Enter key does NOT fire onSend", () => {
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend, recycleActive: true })} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "should not send on enter" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("B5: recycleActive=false (default) — baseline sanity, Send enabled and click fires onSend", () => {
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend })} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "normal send" } });
    const sendBtn = screen.getByLabelText("Send") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);
    fireEvent.click(sendBtn);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("normal send");
  });

  it("B6: draft survives across a recycleActive true→false transition (textarea `disabled` never flipped by recycleActive)", () => {
    const { rerender } = render(
      <ComposeBox {...baseProps({ recycleActive: true })} />,
    );
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "pre-draft" } });
    expect(textarea.value).toBe("pre-draft");
    // Recycle completes — recycleActive flips back to false.
    rerender(<ComposeBox {...baseProps({ recycleActive: false })} />);
    // Same textarea DOM node (React preserved because `disabled` never
    // changed); value survives the transition.
    const textareaAfter = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    expect(textareaAfter.value).toBe("pre-draft");
  });
});
