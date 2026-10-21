// ─── FeedbackModal ───────────────────────────────────────────────────────────
// Shared composition dialog for the feedback pipeline. Two variants:
//
//   general — "Send feedback", one line of direction, a text box, Cancel +
//             Send (Send waits for text). Cancel / X / Esc send nothing.
//
//   thumbs_down — "What went wrong?", "Your thumbs-down is sent either way.
//             Add a note if it helps.", Send without a note + Send (Send
//             waits for text). X / Esc fire onDismissWithoutSubmit — the
//             parent still sends the vote, without a note.
//
// After Send (or Send without a note) the dialog shows "Thanks — sent." for a
// moment, then closes itself through onOpenChange(false). Once sent, closing
// never fires onDismissWithoutSubmit, so a vote is sent exactly once.
//
// The message being reacted to is NOT shown back in the dialog. The draft is
// local — reopening starts empty.

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal";
import { KitButton, KitTextarea } from "@/components/kit";

// ─── Public types ────────────────────────────────────────────────────────────

export type FeedbackModalProps = {
  /** Controlled open state — parent owns lifecycle. */
  open: boolean;
  /** Called when the dialog should close — including by itself, after the
   * "Thanks — sent." moment. For thumbs_down, a close via X / Esc fires
   * onDismissWithoutSubmit first. */
  onOpenChange: (next: boolean) => void;
  /** Which entry variant to render. D-09 lock: one component, two variants. */
  variant: "general" | "thumbs_down";
  /** Fires when the user clicks Send (always with some text). The parent
   * sends it and leaves the dialog open — it confirms, then closes itself. */
  onSubmit: (userNote: string) => Promise<void> | void;
  /** Fires when the thumbs_down variant ends without a note — Send without
   * a note, X or Esc. The parent sends the vote with an empty userNote: one
   * email either way. Ignored for the general variant. */
  onDismissWithoutSubmit?: () => void;
};

// ─── Component ───────────────────────────────────────────────────────────────

/** How long "Thanks — sent." shows before the dialog closes. */
export const FEEDBACK_SENT_MS = 1400;

export function FeedbackModal({
  open,
  onOpenChange,
  variant,
  onSubmit,
  onDismissWithoutSubmit,
}: FeedbackModalProps): JSX.Element | null {
  const [draft, setDraft] = useState("");
  // Double-submit guard while a send is in flight.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  // Set synchronously on Send so a racing Esc / X can't also send the vote.
  const sentRef = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset on close as well as open, so a reopened dialog never shows the
  // last "Thanks — sent." for a frame.
  useEffect(() => {
    setDraft("");
    setIsSubmitting(false);
    setSent(false);
    sentRef.current = false;
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = null;
    };
  }, [open]);

  if (!open) return null;

  const general = variant === "general";
  const hasText = draft.trim() !== "";

  const finish = () => {
    setSent(true);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      onOpenChange(false);
    }, FEEDBACK_SENT_MS);
  };

  const handleSend = async () => {
    if (sentRef.current || isSubmitting) return;
    sentRef.current = true;
    setIsSubmitting(true);
    try {
      // The user's whitespace is kept exactly; the server normalises.
      await onSubmit(draft);
    } catch (err) {
      // onSubmit threw: Send works again, and closing a thumbs-down still
      // sends the vote. (Today's callers post fire-and-forget and never throw.)
      sentRef.current = false;
      console.warn({ operation: "feedback_send_failed", variant, reason: err instanceof Error ? err.message : String(err) });
      return;
    } finally {
      setIsSubmitting(false);
    }
    finish();
  };

  const handleSendWithoutNote = () => {
    if (sentRef.current) return;
    sentRef.current = true;
    onDismissWithoutSubmit?.();
    finish();
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        // Closing an unsent thumbs-down still sends the vote (without a note).
        if (!next && variant === "thumbs_down" && !sentRef.current) {
          sentRef.current = true;
          onDismissWithoutSubmit?.();
        }
        onOpenChange(next);
      }}
      size="lg"
      data-testid="feedback-dialog"
    >
      {sent ? (
        <>
          <ModalHead
            title={<span className="sr-only">{general ? "Send feedback" : "What went wrong?"}</span>}
            hideClose
          />
          <div
            className="flex flex-col items-center gap-2 px-6 pt-4 pb-9 text-center"
            role="status"
            data-testid="feedback-sent"
          >
            <span className="grid place-items-center size-[52px] rounded-full bg-[var(--k-acc-soft)] text-[var(--k-acc-text)]">
              <Check size={26} strokeWidth={2.6} aria-hidden="true" />
            </span>
            <b className="text-[16px] text-[var(--k-t1)]">Thanks — sent.</b>
            <span className="text-[13px] text-[var(--k-t3)]">
              {general ? "Every note shapes the beta." : "This helps make replies better."}
            </span>
          </div>
        </>
      ) : (
        <>
          <ModalHead
            title={general ? "Send feedback" : "What went wrong?"}
            subtitle={
              general
                ? "What's working, what's not, or what you'd change — every note shapes the beta."
                : "Your thumbs-down is sent either way. Add a note if it helps."
            }
            titleId="feedback-modal-title"
            closeTestId={general ? undefined : "feedback-close"}
            closeAriaLabel={general ? "Close" : "Close without note"}
          />
          <ModalBody>
            <KitTextarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={general ? "What's on your mind?" : "Anything you want to add?"}
              aria-label={general ? "Feedback message" : "What went wrong"}
              autoFocus
              className="min-h-[130px] resize-y"
            />
          </ModalBody>
          <ModalFoot>
            {general ? (
              <KitButton data-testid="feedback-cancel" onClick={() => onOpenChange(false)}>
                Cancel
              </KitButton>
            ) : (
              <KitButton data-testid="feedback-send-without-note" onClick={handleSendWithoutNote}>
                Send without a note
              </KitButton>
            )}
            <KitButton
              variant="primary"
              data-testid="feedback-send"
              disabled={!hasText}
              busy={isSubmitting}
              onClick={() => {
                void handleSend();
              }}
            >
              Send
            </KitButton>
          </ModalFoot>
        </>
      )}
    </Modal>
  );
}
