import { useEffect, useRef, useState } from "react";
import { RotateCcw, Send, ThumbsUp } from "lucide-react";
import { Button } from "@/components/button";
import { Textarea } from "@/components/textarea";
import { cn } from "@/lib/utils";

// Compose-and-send box for the pretty view.
//
// Design decisions (per plan 02-02 and D-46 through D-58):
//
// 1. Enter-sends, Shift-Enter-newlines (COMPOSE-02 per D-48).
//    handleKeyDown only intercepts plain Enter; Shift-Enter falls
//    through to browser default textarea behavior (newline insertion).
//
// 2. Paste behavior satisfied by browser default — no custom paste
//    handler attached (COMPOSE-05 per D-58/D-60). The "[pasted N lines]"
//    collapse avoidance happens downstream: the send path uses WS
//    input events, not terminal paste, so Claude Code's Ink REPL
//    treats it as typed input.
//
// 3. Text selection intentionally unrestricted (RENDER-04 defense in
//    depth — do NOT add user-select restrictions here).
//
// 4. No optimistic display on send (COMPOSE-04 HARD LOCK per D-52).
//    On success: clear textarea. On failure: keep text and show error.
//
// 5. Newlines collapsed to spaces on send (per D-50 policy — Ink
//    safety; mirrors MessageQueueDrawer's established behavior).

export interface ComposeBoxProps {
  // Called when the user presses Enter (no shift) with non-empty text.
  // The caller collapses newlines to spaces before calling onSend, so
  // this always receives a single-line payload.
  // Return true if the send WAS DISPATCHED to the underlying transport;
  // return false if the transport was unavailable (e.g., WS disconnected).
  // The component uses the return to decide whether to clear the textarea
  // (true) or preserve the text and show an inline error (false).
  onSend: (text: string) => boolean;
  // When false, Enter is still accepted for typing (textarea not disabled)
  // but Send button is visually disabled. The send attempt will fail and
  // show the inline error — the component does not need to pre-emptively
  // block the attempt since onSend returns false when WS is not ready.
  canSend?: boolean;
  // Live Claude Code context-window percentage (0-100), scraped by the
  // backend from the tmux status line. null = unknown yet on this attach.
  // Rendered as a vertical fill bar to the left of the textarea:
  // <50 green, 50-79 yellow, >=80 red; hidden entirely when null so a
  // brief "unknown" flash doesn't distract on mount.
  contextPct?: number | null;
  className?: string;
}

export function ComposeBox({
  onSend,
  canSend,
  contextPct,
  className,
}: ComposeBoxProps) {
  const [text, setText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus on mount so Ashley can start typing immediately after
  // flipping to pretty mode (COMPOSE-01 ergonomic requirement).
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Auto-grow rows: 2 minimum, 6 maximum, based on line count.
  // Matches MessageQueueDrawer's simple approach (no ResizeObserver).
  const rows = Math.min(6, Math.max(2, text.split("\n").length));

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed) return;

    setErrorMessage(null); // clear any prior error

    // D-50 policy: collapse newlines to spaces on send. Ink safety.
    const payload = trimmed.replace(/\r?\n/g, " ");

    const dispatched = onSend(payload);
    if (dispatched) {
      setText(""); // clear compose textarea on success
      // COMPOSE-04 HARD LOCK: do NOT emit any local optimistic bubble.
      // The message will render in the conversation when the
      // session-file tail confirms it (Phase 1 WS bridge).
    } else {
      setErrorMessage("Not connected — try again in a moment");
      // COMPOSE-04 + D-56: do NOT clear text; user may want to retry.
    }
  }

  // Reset-send: mirrors handleSend (clears textarea on success, surfaces
  // inline error on failure) except (a) it prepends "/id reset " to the
  // trimmed body, and (b) it fires even when the body is blank — in which
  // case it sends just "/id reset".
  function handleResetSend() {
    setErrorMessage(null);
    const trimmed = text.trim();
    const payload = trimmed
      ? `/id reset ${trimmed.replace(/\r?\n/g, " ")}`
      : "/id reset";
    const dispatched = onSend(payload);
    if (dispatched) {
      setText("");
    } else {
      setErrorMessage("Not connected — try again in a moment");
    }
  }

  // Quick-reply: fires a canned message through onSend without touching the
  // compose textarea's text/focus state. Independent of what the user is
  // currently composing — same disabled gate as Send (canSend===false only).
  function handleQuickSend(quickText: string) {
    setErrorMessage(null);
    const dispatched = onSend(quickText);
    if (!dispatched) {
      setErrorMessage("Not connected — try again in a moment");
    }
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault(); // suppress default newline insertion on plain Enter
      handleSend();
    }
    // Shift-Enter: do NOT preventDefault. Browser default inserts a newline,
    // which is exactly the COMPOSE-02 behavior.
    //
    // Do NOT stopPropagation on any event — the AppShell document-capture-
    // phase hooks (Ctrl+Shift+O, Ctrl+Shift+L, Ctrl+Shift+;) intercept
    // before this handler and MUST continue to work while the compose
    // textarea is focused.
  }

  const sendDisabled = text.trim() === "" || canSend === false;

  // Layout: textarea and send button share a single horizontal row so the
  // compose area stays as short as possible and yields more vertical space
  // to the conversation above (Ashley feedback 2026-07-17). Error text, when
  // present, sits below the row.
  return (
    <div
      className={cn(
        "border-t border-border bg-background flex flex-col gap-1 px-3 py-2 shrink-0",
        className,
      )}
    >
      <div className="flex items-end gap-2">
        {/* Context-window fill bar: thin vertical strip left of the textarea.
            Fills from bottom to top. Green <50, yellow 50-79, red >=80.
            Mounts only when contextPct is a number — brief "unknown" state
            on mount stays visually quiet. self-stretch overrides the row's
            items-end so the bar spans full row height (grows with textarea
            rows). */}
        {typeof contextPct === "number" && (
          <div
            className="w-1.5 self-stretch bg-muted/40 rounded-sm relative overflow-hidden"
            role="meter"
            aria-label="Context window"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={contextPct}
            title={`Context ${contextPct}%`}
          >
            <div
              className={cn(
                "absolute bottom-0 left-0 right-0 transition-[height] duration-300",
                contextPct < 50
                  ? "bg-green-500"
                  : contextPct < 80
                    ? "bg-yellow-500"
                    : "bg-red-500",
              )}
              style={{
                height: `${Math.min(100, Math.max(0, contextPct))}%`,
              }}
            />
          </div>
        )}
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message Claude…"
          rows={rows}
          className="resize-none flex-1"
          // Note: NOT disabled when canSend===false — user can compose
          // during a transient disconnect and send when WS reconnects.
          // The send button is disabled; the error will surface on attempt.
        />
        {/* Icon-button column: rotate-ccw "/id reset" send on top,
            thumbs-up "go ahead" quick-reply in the middle, paper-airplane
            Send on the bottom. Ordered least-used at top, most-used at
            bottom (closest to the mouse arriving from the textarea).
            Bottom-aligned to the textarea via the parent's items-end.
            If the textarea grows past the stack's height, empty space
            appears above the top button rather than pushing Send up. */}
        <div className="flex flex-col gap-1">
          <Button
            size="icon-sm"
            variant="outline"
            onClick={handleResetSend}
            disabled={canSend === false}
            aria-label="Send with /id reset prefix"
            title="Send with /id reset prefix"
          >
            <RotateCcw className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            onClick={() => handleQuickSend("go ahead")}
            disabled={canSend === false}
            aria-label="Send 'go ahead'"
            title="Send 'go ahead'"
          >
            <ThumbsUp className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            onClick={handleSend}
            disabled={sendDisabled}
            aria-label="Send message"
            title="Send (Enter)"
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
      {errorMessage && (
        <div className="text-xs text-destructive">{errorMessage}</div>
      )}
    </div>
  );
}
