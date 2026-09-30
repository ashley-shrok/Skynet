// ─── FeedbackModal (translated to canonical Modal container 2026-09-29) ─────
// Shared composition modal for the feedback pipeline. Two variants:
//
//   general — title "Send feedback", subtitle "What's working, what's not, or
//             what you'd change — every note shapes the beta.", placeholder
//             "What's on your mind?". Foot: Cancel + Send. Cancel or backdrop
//             click closes WITHOUT submitting.
//
//   thumbs_down — title "What went wrong?", placeholder "Anything you want
//             to add?", no subtitle. Foot: Send only. The close-X in the
//             header, backdrop click, and ESC all fire ONE email via the
//             onDismissWithoutSubmit callback (the parent sends the thumbs-
//             down vote WITHOUT a note); the Send button sends the vote
//             WITH the note.
//
// Composes from the canonical Modal container (src/ui/components/modal.tsx).
// Hue default 220 (neutral cool) — feedback is app-level, not agent-scoped.
//
// D-11 lock retained: the message being reacted to is NOT rendered back to
// the user in the modal. No quote element, no "Reply:" mini-preview.
//
// D-12 revision: the "NO subtitle" lock is REPLACED for the general variant
// per user 2026-09-29 — beta feedback benefits from one line of user-facing
// direction, so the subtitle carries "What's working, what's not, or what
// you'd change — every note shapes the beta." Thumbs_down keeps no subtitle
// (title + placeholder are self-carrying).
//
// D-30 lock retained: draft state is local useState — the modal does NOT
// preserve typed text across close/reopen. The `open` transition to true
// resets the draft via the useEffect below.
//
// Threat model (from 121-04-PLAN.md), unchanged by this translation:
//   T-121-19 (Info Disclosure) — draft state is local + cleared on every
//     open-transition; second-open renders empty textarea after prior submit.
//   T-121-20 (Repudiation, accepted) — thumbs-down backdrop / close-X / ESC
//     fires onDismissWithoutSubmit which the parent turns into a real POST.

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/button";
import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal";

// ─── Public types ────────────────────────────────────────────────────────────

export type FeedbackModalProps = {
  /** Controlled open state — parent owns lifecycle. */
  open: boolean;
  /** Called when the modal should close. For thumbs_down, this fires AFTER
   * onDismissWithoutSubmit when the close was via backdrop/close-X/ESC. */
  onOpenChange: (next: boolean) => void;
  /** Which entry variant to render. D-09 lock: one component, two variants. */
  variant: "general" | "thumbs_down";
  /** Fires when the user clicks Send with the current draft text. Empty
   * string is valid — thumbs-down Send without text still fires ONE email
   * per D-11. Parent decides whether to await or fire-and-forget. */
  onSubmit: (userNote: string) => Promise<void> | void;
  /** Fires when the user dismisses the thumbs_down variant WITHOUT clicking
   * Send (close-X, backdrop, ESC). Parent sends the thumbs-down vote with
   * an empty userNote — D-11 lock: one email fires either way. Ignored for
   * the general variant, where dismissing sends nothing. */
  onDismissWithoutSubmit?: () => void;
};

// ─── Component ───────────────────────────────────────────────────────────────

export function FeedbackModal({
  open,
  onOpenChange,
  variant,
  onSubmit,
  onDismissWithoutSubmit,
}: FeedbackModalProps): JSX.Element | null {
  const [draft, setDraft] = useState("");
  // LOW-1: double-submit guard. Disabled while a submit is in flight to
  // prevent duplicate emails from rapid double-click.
  const [isSubmitting, setIsSubmitting] = useState(false);

  // D-30: clear the draft on every open transition. Second-open after a prior
  // submit starts empty. The `if (!open) return null` guard below unmounts the
  // tree so useState resets anyway; this effect covers the rerender-with-
  // open=true-after-close-via-prop-flip case.
  useEffect(() => {
    if (open) {
      setDraft("");
      setIsSubmitting(false);
    }
  }, [open]);

  // Hard-guard the DOM: only render the tree when open. Keeps test queries
  // simple (queries for absence work naturally).
  if (!open) return null;

  const title = variant === "general" ? "Send feedback" : "What went wrong?";
  const subtitle =
    variant === "general"
      ? "What's working, what's not, or what you'd change — every note shapes the beta."
      : undefined;
  const placeholder =
    variant === "general"
      ? "What's on your mind?"
      : "Anything you want to add?";

  const handleSend = async () => {
    // Send path: fires onSubmit(draft). Parent's onSubmit is responsible for
    // calling onOpenChange(false) to close the modal. Because Send does NOT
    // route through Modal's onOpenChange wrapper, the dismiss-with-vote branch
    // (which fires onDismissWithoutSubmit for thumbs_down) is never invoked
    // on Send — exactly the disambiguation D-11 requires.
    //
    // NOTE: onSubmit intentionally does not receive draft.trim() — preserve
    // the user's whitespace exactly. Server-side owns any normalization.
    // Empty string is a valid send for thumbs_down (D-11).
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onSubmit(draft);
    } finally {
      // Modal typically unmounts before this fires (parent closes on submit).
      // useState updates after unmount are no-ops in React 18.
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        // D-11: thumbs_down variant fires onDismissWithoutSubmit BEFORE
        // onOpenChange so the parent's POST fires while the modal is still
        // visually present. General variant just closes; no side effect.
        if (!next && variant === "thumbs_down") {
          onDismissWithoutSubmit?.();
        }
        onOpenChange(next);
      }}
      size="lg"
      data-testid="feedback-dialog"
    >
      <ModalHead
        title={title}
        subtitle={subtitle}
        titleId="feedback-modal-title"
        closeTestId={variant === "thumbs_down" ? "feedback-close" : undefined}
        closeAriaLabel={
          variant === "thumbs_down" ? "Close without note" : "Close"
        }
      />
      <ModalBody>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          aria-labelledby="feedback-modal-title"
          aria-label={
            variant === "general" ? "Feedback message" : "What went wrong"
          }
          className={cn(
            "w-full bg-black/30 text-[#fbf5e8]",
            "border border-[hsla(var(--pv-id-hue),65%,55%,0.22)]",
            "focus:outline-none focus:border-[hsla(var(--pv-id-hue),70%,60%,0.45)]",
            "focus:ring-2 focus:ring-[hsla(var(--pv-id-hue),70%,55%,0.12)]",
            "rounded-lg px-3 py-2 text-sm leading-relaxed",
            "min-h-[120px] resize-y",
            "placeholder:text-[hsla(var(--pv-id-hue),22%,88%,0.55)]",
          )}
        />
      </ModalBody>
      <ModalFoot>
        {variant === "general" && (
          <Button
            type="button"
            variant="outline"
            data-testid="feedback-cancel"
            onClick={() => onOpenChange(false)}
            className="cursor-pointer h-8"
          >
            Cancel
          </Button>
        )}
        <Button
          type="button"
          variant="default"
          data-testid="feedback-send"
          disabled={isSubmitting}
          onClick={() => {
            void handleSend();
          }}
          className="cursor-pointer h-8"
        >
          Send
        </Button>
      </ModalFoot>
    </Modal>
  );
}
