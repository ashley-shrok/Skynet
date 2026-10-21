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
 * apple-ux shape-preferences-modal: Send waits for text; after sending the
 * dialog shows "Thanks — sent." and closes itself after FEEDBACK_SENT_MS;
 * thumbs-down has "Send without a note"; the vote is sent exactly once.
 *
 * Rerender pattern (D-30 open-close-reopen empty check):
 *   render(<Modal open={true} />) → rerender(<Modal open={false} />) → type text
 *   → rerender(<Modal open={true} />) — draft must NOT persist.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { afterEach } from "vitest";

import { FeedbackModal, FEEDBACK_SENT_MS } from "./FeedbackModal";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

  it("says what it's for, and Send stays greyed until something is typed", () => {
    render(
      <FeedbackModal open={true} onOpenChange={vi.fn()} variant="general" onSubmit={vi.fn()} />,
    );
    expect(
      screen.getByText(
        "What's working, what's not, or what you'd change — every note shapes the beta.",
      ),
    ).toBeTruthy();
    const send = screen.getByTestId("feedback-send") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("What's on your mind?"), {
      target: { value: "   " },
    });
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("What's on your mind?"), {
      target: { value: "hi" },
    });
    expect(send.disabled).toBe(false);
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

  it("footer has Send without a note + Send (greyed until text) — no Cancel", () => {
    render(
      <FeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        variant="thumbs_down"
        onSubmit={vi.fn()}
        onDismissWithoutSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Send without a note" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("tells the truth about closing: the thumbs-down is sent either way", () => {
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
      screen.getByText("Your thumbs-down is sent either way. Add a note if it helps."),
    ).toBeTruthy();
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

  it("Send click without typed text does nothing (Send is greyed)", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onDismissWithoutSubmit).not.toHaveBeenCalled();
  });

  it("Esc on an unsent thumbs-down sends the vote without a note, once", () => {
    const onOpenChange = vi.fn();
    const onDismissWithoutSubmit = vi.fn();
    render(
      <FeedbackModal
        open={true}
        onOpenChange={onOpenChange}
        variant="thumbs_down"
        onSubmit={vi.fn()}
        onDismissWithoutSubmit={onDismissWithoutSubmit}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismissWithoutSubmit).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
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
  it("textarea is labelled, and the dialog title carries its id", () => {
    render(
      <FeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        variant="general"
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Feedback message" })).toBeTruthy();
    const title = screen.getByText("Send feedback");
    expect(title.getAttribute("id")).toBe("feedback-modal-title");
  });

  it("thumbs_down textarea is labelled 'What went wrong'", () => {
    render(
      <FeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        variant="thumbs_down"
        onSubmit={vi.fn()}
        onDismissWithoutSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole("textbox", { name: "What went wrong" })).toBeTruthy();
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
    fireEvent.change(screen.getByPlaceholderText("What's on your mind?"), {
      target: { value: "hello" },
    });
    const sendBtn = screen.getByRole("button", { name: "Send" });
    fireEvent.click(sendBtn);
    fireEvent.click(sendBtn);
    // Give React a microtask to flush state updates.
    await Promise.resolve();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("FeedbackModal — sent state", () => {
  it("general: Send shows 'Thanks — sent.' then closes itself after FEEDBACK_SENT_MS", async () => {
    vi.useFakeTimers();
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <FeedbackModal open={true} onOpenChange={onOpenChange} variant="general" onSubmit={onSubmit} />,
    );
    fireEvent.change(screen.getByPlaceholderText("What's on your mind?"), {
      target: { value: "love it" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("feedback-send"));
    });
    expect(onSubmit).toHaveBeenCalledWith("love it");
    const sent = screen.getByTestId("feedback-sent");
    expect(sent.textContent).toContain("Thanks — sent.");
    expect(screen.queryByPlaceholderText("What's on your mind?")).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(FEEDBACK_SENT_MS - 1);
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("thumbs_down: Send with a note shows the sent state and never fires the dismiss callback", async () => {
    vi.useFakeTimers();
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
    fireEvent.change(screen.getByPlaceholderText("Anything you want to add?"), {
      target: { value: "wrong file" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("feedback-send"));
    });
    expect(screen.getByTestId("feedback-sent")).toBeTruthy();
    // Esc during the sent moment closes but doesn't send a second vote.
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => {
      vi.advanceTimersByTime(FEEDBACK_SENT_MS);
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onDismissWithoutSubmit).not.toHaveBeenCalled();
  });

  it("thumbs_down: Send without a note fires the dismiss callback once, shows sent, then closes", async () => {
    vi.useFakeTimers();
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
    const withoutNote = screen.getByTestId("feedback-send-without-note");
    fireEvent.click(withoutNote);
    expect(onDismissWithoutSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("feedback-sent").textContent).toContain("Thanks — sent.");
    // The sent state has no X to click.
    expect(screen.queryByTestId("feedback-close")).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(FEEDBACK_SENT_MS);
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onDismissWithoutSubmit).toHaveBeenCalledTimes(1);
  });

  it("thumbs_down: closing (Esc / X path) after Send without a note doesn't fire the dismiss callback again", async () => {
    vi.useFakeTimers();
    const onOpenChange = vi.fn();
    const onDismissWithoutSubmit = vi.fn();
    render(
      <FeedbackModal
        open={true}
        onOpenChange={onOpenChange}
        variant="thumbs_down"
        onSubmit={vi.fn()}
        onDismissWithoutSubmit={onDismissWithoutSubmit}
      />,
    );
    fireEvent.click(screen.getByTestId("feedback-send-without-note"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onDismissWithoutSubmit).toHaveBeenCalledTimes(1);
  });

  it("closing during the sent moment (no X is shown, so Esc) closes once and never fires the dismiss callback", async () => {
    vi.useFakeTimers();
    const onOpenChange = vi.fn();
    const onDismissWithoutSubmit = vi.fn();
    const { rerender } = render(
      <FeedbackModal
        open={true}
        onOpenChange={onOpenChange}
        variant="thumbs_down"
        onSubmit={vi.fn()}
        onDismissWithoutSubmit={onDismissWithoutSubmit}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("Anything you want to add?"), {
      target: { value: "x" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("feedback-send"));
    });
    // Parent closes early (e.g. X/Esc during the sent moment) → no stray timer close.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    rerender(
      <FeedbackModal
        open={false}
        onOpenChange={onOpenChange}
        variant="thumbs_down"
        onSubmit={vi.fn()}
        onDismissWithoutSubmit={onDismissWithoutSubmit}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(FEEDBACK_SENT_MS * 2);
    });
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onDismissWithoutSubmit).not.toHaveBeenCalled();
  });

  it("reopening after a send starts fresh (empty, not in the sent state)", async () => {
    vi.useFakeTimers();
    const onDismissWithoutSubmit = vi.fn();
    const props = {
      onOpenChange: vi.fn(),
      variant: "thumbs_down" as const,
      onSubmit: vi.fn(),
      onDismissWithoutSubmit,
    };
    const { rerender } = render(<FeedbackModal open={true} {...props} />);
    fireEvent.click(screen.getByTestId("feedback-send-without-note"));
    await act(async () => {
      vi.advanceTimersByTime(FEEDBACK_SENT_MS);
    });
    rerender(<FeedbackModal open={false} {...props} />);
    rerender(<FeedbackModal open={true} {...props} />);
    expect(screen.queryByTestId("feedback-sent")).toBeNull();
    // A fresh vote can be sent again on the next open.
    fireEvent.click(screen.getByTestId("feedback-close"));
    expect(onDismissWithoutSubmit).toHaveBeenCalledTimes(2);
  });
});

describe("FeedbackModal — a send that fails", () => {
  it("stays open, lets Send try again, and closing still sends the thumbs-down once", async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(undefined);
    const onDismiss = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <FeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        variant="thumbs_down"
        onSubmit={onSubmit}
        onDismissWithoutSubmit={onDismiss}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "wrong answer" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("feedback-sent")).toBeNull();
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
