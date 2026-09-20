/**
 * Phase 121 Plan 04 Task 1 — FeedbackModal tests (RED-phase in TDD sequence).
 *
 * Covers the D-10 general variant + D-11 thumbs-down variant + D-30 no-draft-
 * preservation locks + D-11 no-message-quote lock. See 121-04-PLAN.md Task 1
 * <behavior> block for the full behavior list.
 *
 * The modal is a pure presentational component — parent owns open state, submit
 * handler, and dismiss handler. These tests mock nothing beyond spy callbacks
 * (`vi.fn`) so we exercise the same Radix Dialog primitive the app uses at
 * runtime.
 *
 * Rerender pattern (D-30 open-close-reopen empty check):
 *   render(<Modal open={true} />) → rerender(<Modal open={false} />) → type text
 *   → rerender(<Modal open={true} />) — draft must NOT persist.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { FeedbackModal } from "./FeedbackModal";

afterEach(() => {
  cleanup();
});

describe("FeedbackModal — general variant (D-10)", () => {
  it("renders title 'Send feedback'", () => {
    render(
      <FeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        variant="general"
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText("Send feedback")).toBeTruthy();
  });

  it("textarea placeholder is 'What's on your mind?'", () => {
    render(
      <FeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        variant="general"
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText("What's on your mind?")).toBeTruthy();
  });

  it("renders both Cancel and Send footer buttons", () => {
    render(
      <FeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        variant="general"
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("does NOT render close-X icon-button (only thumbs-down has it)", () => {
    render(
      <FeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        variant="general"
        onSubmit={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Close without note" }),
    ).toBeNull();
  });

  it("user types then clicks Send → onSubmit called with typed text", () => {
    const onSubmit = vi.fn();
    render(
      <FeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        variant="general"
        onSubmit={onSubmit}
      />,
    );
    const textarea = screen.getByPlaceholderText("What's on your mind?");
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("hello");
  });

  it("Cancel click → onOpenChange(false), onSubmit NOT called, onDismissWithoutSubmit NOT called", () => {
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn();
    const onDismissWithoutSubmit = vi.fn();
    render(
      <FeedbackModal
        open={true}
        onOpenChange={onOpenChange}
        variant="general"
        onSubmit={onSubmit}
        onDismissWithoutSubmit={onDismissWithoutSubmit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onDismissWithoutSubmit).not.toHaveBeenCalled();
  });
});

describe("FeedbackModal — thumbs_down variant (D-11)", () => {
  it("renders title 'What went wrong?'", () => {
    render(
      <FeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        variant="thumbs_down"
        onSubmit={vi.fn()}
        onDismissWithoutSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText("What went wrong?")).toBeTruthy();
  });

  it("textarea placeholder is 'Anything you want to add?'", () => {
    render(
      <FeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        variant="thumbs_down"
        onSubmit={vi.fn()}
        onDismissWithoutSubmit={vi.fn()}
      />,
    );
    expect(
      screen.getByPlaceholderText("Anything you want to add?"),
    ).toBeTruthy();
  });

  it("renders ONLY Send button in footer — no Cancel button", () => {
    render(
      <FeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        variant="thumbs_down"
        onSubmit={vi.fn()}
        onDismissWithoutSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("renders close-X icon-button with aria-label 'Close without note'", () => {
    render(
      <FeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        variant="thumbs_down"
        onSubmit={vi.fn()}
        onDismissWithoutSubmit={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Close without note" }),
    ).toBeTruthy();
  });

  it("close-X click → onDismissWithoutSubmit called, onSubmit NOT called, onOpenChange(false)", () => {
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn();
    const onDismissWithoutSubmit = vi.fn();
    render(
      <FeedbackModal
        open={true}
        onOpenChange={onOpenChange}
        variant="thumbs_down"
        onSubmit={onSubmit}
        onDismissWithoutSubmit={onDismissWithoutSubmit}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Close without note" }),
    );
    expect(onDismissWithoutSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Send click without typed text → onSubmit called with empty string (still fires one email per D-11)", () => {
    const onSubmit = vi.fn();
    render(
      <FeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        variant="thumbs_down"
        onSubmit={onSubmit}
        onDismissWithoutSubmit={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("");
  });

  it("types then clicks Send → onSubmit called with typed text, onDismissWithoutSubmit NOT called", () => {
    const onSubmit = vi.fn();
    const onDismissWithoutSubmit = vi.fn();
    render(
      <FeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        variant="thumbs_down"
        onSubmit={onSubmit}
        onDismissWithoutSubmit={onDismissWithoutSubmit}
      />,
    );
    const textarea = screen.getByPlaceholderText("Anything you want to add?");
    fireEvent.change(textarea, { target: { value: "broken" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).toHaveBeenCalledWith("broken");
    expect(onDismissWithoutSubmit).not.toHaveBeenCalled();
  });
});

describe("FeedbackModal — draft discipline (D-30) and no-message-quote (D-11)", () => {
  it("open→close→reopen: textarea is empty on second open (no draft preservation)", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <FeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        variant="general"
        onSubmit={onSubmit}
      />,
    );
    // Type into the textarea.
    let textarea = screen.getByPlaceholderText(
      "What's on your mind?",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "typed but then closed" } });
    expect(textarea.value).toBe("typed but then closed");

    // Close (open=false triggers unmount guard).
    rerender(
      <FeedbackModal
        open={false}
        onOpenChange={vi.fn()}
        variant="general"
        onSubmit={onSubmit}
      />,
    );

    // Reopen.
    rerender(
      <FeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        variant="general"
        onSubmit={onSubmit}
      />,
    );
    textarea = screen.getByPlaceholderText(
      "What's on your mind?",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
  });

  it("does NOT render a message-preview / quoted-message element (D-11 explicit)", () => {
    render(
      <FeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        variant="thumbs_down"
        onSubmit={vi.fn()}
        onDismissWithoutSubmit={vi.fn()}
      />,
    );
    // No blockquote, no "Reply:" text, no message-preview role — D-11 locks
    // that the message being reacted to is NOT quoted back to the user.
    expect(document.querySelector("blockquote")).toBeNull();
    expect(screen.queryByText(/Reply:/i)).toBeNull();
    expect(screen.queryByText(/User asked:/i)).toBeNull();
    expect(screen.queryByText(/Assistant replied:/i)).toBeNull();
  });
});

describe("FeedbackModal — accessibility (MED-4)", () => {
  it("textarea has aria-labelledby pointing at the DialogPrimitive.Title id", () => {
    render(
      <FeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        variant="general"
        onSubmit={vi.fn()}
      />,
    );
    const textarea = screen.getByPlaceholderText(
      "What's on your mind?",
    ) as HTMLTextAreaElement;
    expect(textarea.getAttribute("aria-labelledby")).toBe(
      "feedback-modal-title",
    );
    // And the title carries the matching id.
    const title = screen.getByText("Send feedback");
    expect(title.getAttribute("id")).toBe("feedback-modal-title");
  });
});

describe("FeedbackModal — data-testids (LOW-5)", () => {
  it("Send and Cancel buttons carry stable data-testids", () => {
    render(
      <FeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        variant="general"
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByTestId("feedback-send")).toBeTruthy();
    expect(screen.getByTestId("feedback-cancel")).toBeTruthy();
  });

  it("thumbs_down variant: close-X carries data-testid='feedback-close'", () => {
    render(
      <FeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        variant="thumbs_down"
        onSubmit={vi.fn()}
        onDismissWithoutSubmit={vi.fn()}
      />,
    );
    expect(screen.getByTestId("feedback-close")).toBeTruthy();
  });
});

describe("FeedbackModal — double-submit guard (LOW-1)", () => {
  it("rapid double-click on Send → onSubmit called exactly once (double-submit guard)", async () => {
    // Use a promise that never resolves in the test window so the
    // isSubmitting flag stays true between the two clicks.
    const onSubmit = vi.fn(
      () => new Promise<void>(() => {}),
    );
    render(
      <FeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        variant="general"
        onSubmit={onSubmit}
      />,
    );
    const sendBtn = screen.getByRole("button", { name: "Send" });
    fireEvent.click(sendBtn);
    fireEvent.click(sendBtn);
    // Give React a microtask to flush state updates.
    await Promise.resolve();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
