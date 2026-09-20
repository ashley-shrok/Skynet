// ─── FeedbackModal (Phase 121 Plan 04 Task 1) ────────────────────────────────
// Shared composition modal for the feedback pipeline. Two variants:
//
//   general — title "Send feedback", placeholder "What's on your mind?",
//             footer buttons Cancel + Send (per D-10). Cancel or backdrop
//             click closes WITHOUT submitting anything.
//
//   thumbs_down — title "What went wrong?", placeholder "Anything you want
//             to add?", close-X in top-right corner, single primary Send
//             button in the footer (per D-11). Close-X or backdrop click
//             STILL fires ONE email via the onDismissWithoutSubmit callback
//             (the parent sends the thumbs-down vote WITHOUT a note); Send
//             sends the vote WITH the note.
//
// Visual language (D-13) — reuses AddWakeupDialog.tsx L142-168 chrome:
//   - Gradient: linear-gradient(160deg, hsla(hue, 45%, 25%, 0.82),
//                                        hsla(hue, 40%, 15%, 0.88))
//   - backdrop-filter: blur(28px) saturate(1.4)
//   - Border:   1px solid hsla(hue, 65%, 55%, 0.32)
//   - Text:     #e8e4d8 (warm off-white)
//   - Default hue = 220 (neutral, matches DeleteConfirmDialog.tsx)
//
// D-12 lock: NO category selector, NO subtitle, NO footer disclaimer line.
// Title + placeholder carry all guidance.
//
// D-11 lock: the message being reacted to is NOT rendered back to the user in
// the modal. No quote element, no "Reply:" mini-preview, no "User asked /
// Assistant replied" element rendered inside the dialog.
//
// D-30 lock: draft state is local useState — the modal does NOT preserve the
// typed text across close/reopen. The `open` transition to true resets the
// draft to "" via the useEffect below. Parent lifting the state would defeat
// the discipline; keep it local.
//
// Deliberate divergence from AddWakeupDialog.tsx: we do NOT block backdrop /
// pointer-down-outside interactions on the Radix Content. Backdrop click MUST
// trigger Radix's onOpenChange(false) so the thumbs-down dismiss-with-vote
// flow (D-11) fires via the wrapper handler below.
//
// Threat model (from 121-04-PLAN.md):
//   T-121-19 (Info Disclosure) — draft state is local + cleared on every
//     open-transition; second-open renders empty textarea after prior submit.
//   T-121-20 (Repudiation, accepted) — thumbs-down backdrop / close-X fires
//     onDismissWithoutSubmit which the parent turns into a real POST; the
//     "backdrop-click-cancels" metaphor is deliberately overridden here per
//     D-11 shape-agreement lock.

import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/button";

// ─── Public types ────────────────────────────────────────────────────────────

export type FeedbackModalProps = {
  /** Controlled open state — parent owns lifecycle. */
  open: boolean;
  /** Called when the modal should close. For thumbs_down, this fires AFTER
   * onDismissWithoutSubmit when the close was via backdrop/close-X/ESC. */
  onOpenChange: (next: boolean) => void;
  /** Which entry variant to render. D-09 lock: one component, two variants. */
  variant: "general" | "thumbs_down";
  /** Optional hue for the modal chrome (D-13). Defaults to 220 (neutral,
   * matches DeleteConfirmDialog.tsx). Callers can pass a scoped hue when
   * the modal is being opened from a hue-colored surface. */
  hue?: number;
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
  hue = 220,
  onSubmit,
  onDismissWithoutSubmit,
}: FeedbackModalProps): JSX.Element | null {
  const [draft, setDraft] = useState("");
  // LOW-1: double-submit guard. Disabled while a submit is in flight to
  // prevent duplicate emails from rapid double-click. Because the modal
  // unmounts on parent close (`if (!open) return null` below), the
  // `finally` block that resets this may never fire — that's fine, the
  // guard's job is just to hold the button disabled during the small
  // window before unmount.
  const [isSubmitting, setIsSubmitting] = useState(false);

  // D-30: clear the draft on every open transition to true. Second-open after
  // a prior submit starts empty. Also acts as belt-and-suspenders alongside
  // the `if (!open) return null` guard below (which unmounts the tree so
  // useState resets anyway) — the effect covers the case where the modal is
  // rerendered with open=true after having been closed via prop flip.
  useEffect(() => {
    if (open) {
      setDraft("");
      setIsSubmitting(false);
    }
  }, [open]);

  // Hard-guard the DOM: only render the tree when open. Matches
  // AddWakeupDialog.tsx L140 pattern — keeps test queries simple (queries
  // for absence work naturally without probing Radix's internal open state).
  if (!open) return null;

  const title = variant === "general" ? "Send feedback" : "What went wrong?";
  const placeholder =
    variant === "general"
      ? "What's on your mind?"
      : "Anything you want to add?";

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        // D-11: if the thumbs_down variant is being CLOSED (not by clicking
        // Send — see handleSend below which calls onOpenChange directly),
        // fire the dismiss-without-note callback BEFORE onOpenChange so the
        // parent's POST fires while the modal is still visually present.
        // General variant just closes; no side effect on dismiss.
        if (!next && variant === "thumbs_down") {
          onDismissWithoutSubmit?.();
        }
        onOpenChange(next);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[130] bg-black/60 backdrop-blur-sm"
        />
        <DialogPrimitive.Content
          data-testid="feedback-dialog"
          className={cn(
            "fixed top-1/2 left-1/2 z-[131] -translate-x-1/2 -translate-y-1/2",
            "w-full max-w-lg max-h-[90vh] overflow-y-auto",
            "rounded-[20px] px-5 py-4 flex flex-col gap-3",
            "text-[#e8e4d8]",
          )}
          style={{
            background: `linear-gradient(160deg, hsla(${hue}, 45%, 25%, 0.82), hsla(${hue}, 40%, 15%, 0.88))`,
            backdropFilter: "blur(28px) saturate(1.4)",
            WebkitBackdropFilter: "blur(28px) saturate(1.4)",
            border: `1px solid hsla(${hue}, 65%, 55%, 0.32)`,
            boxShadow: `0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,220,170,0.15), 0 0 80px hsla(${hue}, 65%, 55%, 0.2)`,
          }}
        >
          <DialogPrimitive.Title
            id="feedback-modal-title"
            className="font-heading text-sm font-semibold text-[#f0ebe0]"
          >
            {title}
          </DialogPrimitive.Title>

          {variant === "thumbs_down" && (
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close without note"
                data-testid="feedback-close"
                className="absolute top-2 right-2 p-1 rounded hover:bg-white/10 text-[#e8e4d8] cursor-pointer"
              >
                <XIcon className="w-4 h-4" />
              </button>
            </DialogPrimitive.Close>
          )}

          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            aria-labelledby="feedback-modal-title"
            aria-label={
              variant === "general" ? "Feedback message" : "What went wrong"
            }
            className={cn(
              "bg-black/30 text-[#e8e4d8] border border-white/10",
              "focus:outline-none focus:border-white/25 rounded px-2 py-1.5 text-xs",
              "min-h-[120px] resize-y",
            )}
          />

          <div className="flex items-center gap-2 flex-wrap pt-1 justify-end">
            {variant === "general" && (
              <Button
                type="button"
                variant="outline"
                data-testid="feedback-cancel"
                onClick={() => onOpenChange(false)}
                className="cursor-pointer h-7"
              >
                Cancel
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              data-testid="feedback-send"
              disabled={isSubmitting}
              onClick={async () => {
                // Send path: fires onSubmit(draft) only. The parent's onSubmit
                // handler is responsible for calling setOpen(false) (or
                // equivalent) to close the modal. Because the button does
                // NOT route through Radix's onOpenChange, the dismiss-with-
                // vote branch of our Root wrapper (which fires
                // onDismissWithoutSubmit for thumbs_down) is never invoked
                // on Send — exactly the disambiguation D-11 requires.
                //
                // LOW-1: double-submit guard. Prevents rapid double-click
                // from firing two POSTs before the parent closes the modal.
                //
                // NOTE: onSubmit intentionally does not receive draft.trim() —
                // preserve user's whitespace exactly. Server-side (Plan 03)
                // owns any body normalization. Empty string is a valid send
                // for thumbs_down (D-11).
                if (isSubmitting) return;
                setIsSubmitting(true);
                try {
                  await onSubmit(draft);
                } finally {
                  // Modal typically unmounts before this fires (parent
                  // closes on submit). Safe to reset either way — useState
                  // updates after unmount are no-ops in React 18.
                  setIsSubmitting(false);
                }
              }}
              className="cursor-pointer h-7"
              style={{
                background: `hsla(${hue}, 55%, 40%, 0.55)`,
                borderColor: `hsla(${hue}, 60%, 55%, 0.55)`,
                color: "#f0ebe0",
              }}
            >
              Send
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
