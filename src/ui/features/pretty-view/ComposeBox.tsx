import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, Send, ThumbsUp } from "lucide-react";
import { Button } from "@/components/button";
import { Textarea } from "@/components/textarea";
import { cn } from "@/lib/utils";
import {
  flushComposeDraftKeepalive,
  getComposeDraft,
  putComposeDraft,
} from "@/api/compose-drafts-api";

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
//
// 6. Draft body persistence (patch #57).
//
//    Body is autosaved to the server on every keystroke via a 400ms
//    debounced PUT /compose-drafts, mirroring MessageQueueDrawer's
//    autosave/flush/retry machinery (patches #39/#49/#55). onBlur
//    flushes immediately. pagehide + visibilitychange fire a
//    fetch(keepalive:true) so a mid-typing tab close survives. A 10s
//    setInterval retries any dirty body after failed saves. Successful
//    send (any of Send / go-ahead / reset-send) clears the persisted
//    draft.
//
//    NO ERROR UI on failed autosave — mirrors the COMPOSE-04 HARD LOCK
//    posture: no ghost UI that lies about state. The retry loop is the
//    recovery mechanism.

const DEBOUNCE_MS = 400;

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
  // Patch #57: identity of the pane the compose box belongs to. Draft
  // body is persisted server-side keyed on (userId, hostId, tmuxSession)
  // — tmuxSession null for non-tmux SSH hosts (Windows / no-tmux).
  hostId: number;
  tmuxSession?: string | null;
  className?: string;
}

export function ComposeBox({
  onSend,
  canSend,
  contextPct,
  hostId,
  tmuxSession,
  className,
}: ComposeBoxProps) {
  const [text, setText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Patch #57 persistence refs.
  // dirtyBodyRef: null = no pending save; string (including "") = the
  // most-recent unsaved value that needs to reach the server. Mirrors
  // MessageQueueDrawer's dirtyBodiesRef per-item semantics but scoped
  // to the single draft this component owns.
  const dirtyBodyRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror of `text` so async callbacks (interval tick, pagehide handler)
  // can read the latest value without stale-closure surprises.
  const latestBodyRef = useRef<string>("");
  latestBodyRef.current = text;

  // Normalize the nullable prop for storage-boundary calls.
  const tmuxSessionKey: string | null = tmuxSession ?? null;

  const clearDebounce = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  // Flush the pending dirty body (if any). Best-effort — on error,
  // re-queue the LATEST body (prefer latestBodyRef over the captured
  // dirty snapshot; user may have typed more while the request was
  // in flight) so the next flush chance retries with the freshest
  // content.
  const flushDirty = useCallback(async () => {
    if (dirtyBodyRef.current === null) return;
    const body = dirtyBodyRef.current;
    dirtyBodyRef.current = null;
    try {
      await putComposeDraft(hostId, tmuxSessionKey, body);
    } catch {
      // Re-queue latest — prefer newer edits over the snapshot we just
      // tried to send. No error UI (COMPOSE-04 HARD LOCK).
      const latest = latestBodyRef.current;
      dirtyBodyRef.current = latest;
    }
  }, [hostId, tmuxSessionKey]);

  const scheduleAutosave = useCallback(
    (nextBody: string) => {
      dirtyBodyRef.current = nextBody;
      clearDebounce();
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        void flushDirty();
      }, DEBOUNCE_MS);
    },
    [clearDebounce, flushDirty],
  );

  // Load-on-mount: seed text state from the persisted draft for this
  // (hostId, tmuxSession). On a key change (host or session switches),
  // flush the previous key's dirty body via keepalive BEFORE loading
  // the new key — otherwise a mid-typing switch would silently drop
  // the draft. Any load error silently keeps the empty seed (no error
  // UI on autosave/autoload failures).
  useEffect(() => {
    let cancelled = false;

    // Reset per-key local state.
    setText("");
    clearDebounce();
    dirtyBodyRef.current = null;
    latestBodyRef.current = "";

    getComposeDraft(hostId, tmuxSessionKey)
      .then((data) => {
        if (cancelled) return;
        const seed = data.body ?? "";
        setText(seed);
        latestBodyRef.current = seed;
      })
      .catch(() => {
        // Silent — the empty seed is a safe default; the 10s retry
        // loop won't fire until the user actually types (dirtyBodyRef
        // stays null).
      });

    // The pagehide / visibilitychange / interval effects capture the
    // SAME hostId/tmuxSessionKey via their own closures, so when this
    // effect re-runs on key change, those effects also re-run and
    // capture the new key. This cleanup fires BEFORE the new run of
    // those effects, flushing any dirty body under the OLD key.
    return () => {
      cancelled = true;
      if (dirtyBodyRef.current !== null) {
        flushComposeDraftKeepalive(
          hostId,
          tmuxSessionKey,
          dirtyBodyRef.current,
        );
        dirtyBodyRef.current = null;
      }
      clearDebounce();
    };
  }, [hostId, tmuxSessionKey, clearDebounce]);

  // pagehide + visibilitychange keepalive flush. Fires only when there's
  // a dirty body pending — idle panes cost zero unload-time bandwidth.
  useEffect(() => {
    const onPageHide = () => {
      if (dirtyBodyRef.current !== null) {
        flushComposeDraftKeepalive(
          hostId,
          tmuxSessionKey,
          dirtyBodyRef.current,
        );
        dirtyBodyRef.current = null;
      }
    };
    const onVisChange = () => {
      if (document.visibilityState === "hidden") onPageHide();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisChange);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisChange);
    };
  }, [hostId, tmuxSessionKey]);

  // 10s retry loop. Debounced saves that fail re-queue into
  // dirtyBodyRef with no pending timer; without this interval, the
  // only recovery paths are another keystroke (which resets the
  // debounce) or unload. Users who typed then walked away sit
  // orphaned. Interval catches that case.
  useEffect(() => {
    const interval = setInterval(() => {
      if (dirtyBodyRef.current !== null) void flushDirty();
    }, 10000);
    return () => clearInterval(interval);
  }, [flushDirty]);

  // Auto-focus on mount so Ashley can start typing immediately after
  // flipping to pretty mode (COMPOSE-01 ergonomic requirement).
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Auto-grow rows: 2 minimum, 6 maximum, based on line count.
  // Matches MessageQueueDrawer's simple approach (no ResizeObserver).
  const rows = Math.min(6, Math.max(2, text.split("\n").length));

  // Clear both local state and persisted draft after a successful send.
  // Best-effort: the PUT is fire-and-forget; the 10s retry loop will
  // recover if it fails. latestBodyRef is updated so any interval tick
  // between now and the next render sees the empty body.
  const clearAfterSend = useCallback(() => {
    clearDebounce();
    dirtyBodyRef.current = null;
    latestBodyRef.current = "";
    putComposeDraft(hostId, tmuxSessionKey, "").catch(() => {
      // Best-effort; on failure the next flushDirty tick will re-try
      // once the user types again OR the next 10s tick fires (though
      // dirtyBodyRef is null here, the retry gate skips it — the
      // server-side state may be stale-non-empty until the next real
      // save). Acceptable tradeoff: worst case is a stale draft
      // pre-populating a future reload, which is exactly the state
      // the retry loop was already tolerating.
    });
  }, [clearDebounce, hostId, tmuxSessionKey]);

  function handleTextChange(next: string) {
    setText(next);
    scheduleAutosave(next);
  }

  function handleBlur() {
    clearDebounce();
    void flushDirty();
  }

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed) return;

    setErrorMessage(null); // clear any prior error

    // D-50 policy: collapse newlines to spaces on send. Ink safety.
    const payload = trimmed.replace(/\r?\n/g, " ");

    const dispatched = onSend(payload);
    if (dispatched) {
      setText(""); // clear compose textarea on success
      clearAfterSend();
      // COMPOSE-04 HARD LOCK: do NOT emit any local optimistic bubble.
      // The message will render in the conversation when the
      // session-file tail confirms it (Phase 1 WS bridge).
    } else {
      setErrorMessage("Not connected — try again in a moment");
      // COMPOSE-04 + D-56: do NOT clear text; user may want to retry.
      // Do NOT clear the persisted draft either — failed send should
      // leave the composition intact server-side too.
    }
  }

  // Reset-send: mirrors handleSend (clears textarea on success, surfaces
  // inline error on failure) except (a) it wraps the trimmed body in
  // parentheses appended to "/id reset " so the reset carries a hint
  // through to the fresh session, and (b) it fires even when the body is
  // blank — in which case it sends just "/id reset".
  function handleResetSend() {
    setErrorMessage(null);
    const trimmed = text.trim();
    const payload = trimmed
      ? `/id reset (${trimmed.replace(/\r?\n/g, " ")})`
      : "/id reset";
    const dispatched = onSend(payload);
    if (dispatched) {
      setText("");
      clearAfterSend();
    } else {
      setErrorMessage("Not connected — try again in a moment");
    }
  }

  // Quick-reply: fires a canned message through onSend without touching the
  // compose textarea's text/focus state. Independent of what the user is
  // currently composing — same disabled gate as Send (canSend===false only).
  //
  // The persisted DRAFT is still cleared on successful dispatch: Ashley
  // may have been composing something in the textarea, then decided to
  // fire "go ahead" instead. Textarea `text` state is untouched (the
  // user's in-progress composition stays visible) but the persisted
  // draft resets to '' so a reload doesn't resurrect it. Failed
  // dispatch leaves both intact.
  function handleQuickSend(quickText: string) {
    setErrorMessage(null);
    const dispatched = onSend(quickText);
    if (dispatched) {
      // NOTE: intentionally does NOT setText("") — the user's typed
      // draft stays visible for continued editing (the quick reply
      // fires independently of composed text). But the persisted
      // draft still clears per plan spec so a reload doesn't
      // surface stale content Ashley abandoned in favour of the
      // canned reply.
      clearAfterSend();
    } else {
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
        // Phase 4 Glass: QUIET compose surround (VISUAL-06) — NO card
        // treatment, NO bright top rim, NO hard separator. Compose
        // blends into the atmosphere; the only visual cue that this
        // is a distinct region is a subtle inset shadow that shades
        // the bottom strip. The compose intentionally does NOT compete
        // with the chat above for attention.
        "flex flex-col gap-1 px-3 py-3 shrink-0",
        "bg-[linear-gradient(180deg,rgba(0,0,0,0.15),rgba(0,0,0,0.3))]",
        "shadow-[inset_0_2px_10px_rgba(0,0,0,0.35)]",
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
            // Phase 4 Glass: track is a dark inset well; fill is the
            // per-pane identity hue (with red as the ≥80 breakout for
            // "approaching-full is alarming regardless of pane identity"
            // per plan HARD LOCK).
            className="w-1.5 self-stretch rounded-sm relative overflow-hidden bg-black/55 shadow-[inset_0_0_4px_rgba(0,0,0,0.7),_0_1px_0_rgba(255,240,215,0.08)]"
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
                  ? "bg-[linear-gradient(180deg,hsla(140,65%,55%,1),hsla(140,60%,38%,1))] shadow-[0_0_10px_hsla(140,60%,45%,0.55),_inset_0_1px_0_rgba(220,255,220,0.4)]"
                  : contextPct < 80
                    ? "bg-[linear-gradient(180deg,hsla(45,90%,60%,1),hsla(40,85%,45%,1))] shadow-[0_0_10px_hsla(45,85%,55%,0.55),_inset_0_1px_0_rgba(255,240,180,0.4)]"
                    : "bg-[linear-gradient(180deg,hsla(0,75%,60%,1),hsla(0,75%,40%,1))] shadow-[0_0_10px_hsla(0,75%,50%,0.6),_inset_0_1px_0_rgba(255,220,150,0.4)]",
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
          onChange={(e) => handleTextChange(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder="Message Claude…"
          rows={rows}
          // Phase 4 Glass: lightest-touch textarea outline (VISUAL-07) +
          // identity-hue focus ring (VISUAL-03/VISUAL-07). The 1px warm-
          // white 9% border is the ONLY affordance that makes the textarea
          // findable within the otherwise-blending compose surround.
          // Focus reveals a hue-tinted border + soft outer glow — subtle
          // grow-into-view, not a sudden pop. `focus-visible:ring-0` and
          // `focus-visible:outline-none` disable the shadcn Textarea's
          // default focus ring (`focus-visible:border-ring
          // focus-visible:ring-ring/50 focus-visible:ring-[3px]`) so our
          // own hue ring wins cleanly.
          className={cn(
            "resize-none flex-1",
            "bg-white/[0.03] text-[#f0ebe0]",
            "border border-[rgba(255,240,215,0.09)]",
            "rounded-[10px] px-4 py-3",
            "placeholder:text-[var(--color-pv-fg-dim)]",
            "shadow-[inset_0_2px_6px_rgba(0,0,0,0.4),_0_1px_0_rgba(255,240,215,0.04)]",
            "transition-[box-shadow,border-color] duration-200",
            "focus:border-[rgba(255,240,215,0.28)]",
            "focus:shadow-[inset_0_3px_10px_rgba(0,0,0,0.55),_inset_0_1px_2px_rgba(0,0,0,0.35),_0_1px_0_rgba(255,240,215,0.07),_0_0_0_1px_rgba(255,240,215,0.2),_0_0_22px_rgba(255,240,215,0.12)]",
            "focus-visible:ring-0 focus-visible:outline-none",
          )}
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
          {/* Phase 4 Glass: RotateCcw + ThumbsUp adopt the mock's
              `.pv-icon-btn` quiet treatment (warm-neutral gradient +
              hue-tinted hover glow). Only Send gets the saturated
              identity-hue treatment — VISUAL-08 HARD LOCK: send is
              the ONE compose attention grab-point. */}
          <Button
            size="icon-sm"
            variant="outline"
            onClick={handleResetSend}
            disabled={canSend === false}
            aria-label="Send with /id reset prefix"
            title="Send with /id reset prefix"
            className={cn(
              "rounded-md",
              "border-white/10",
              "bg-[linear-gradient(180deg,rgba(70,66,58,0.5),rgba(38,34,28,0.6))]",
              "text-[#e8e4d8]",
              "shadow-[0_2px_4px_rgba(0,0,0,0.4),_inset_0_1px_0_rgba(255,240,210,0.12)]",
              "hover:bg-[linear-gradient(180deg,rgba(100,85,55,0.7),rgba(60,50,32,0.8))]",
              "hover:border-[rgba(255,240,215,0.22)]",
              "hover:shadow-[0_4px_8px_rgba(0,0,0,0.5),_inset_0_1px_0_rgba(255,240,210,0.2),_0_0_20px_rgba(255,240,215,0.14)]",
            )}
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
            className={cn(
              "rounded-md",
              "border-white/10",
              "bg-[linear-gradient(180deg,rgba(70,66,58,0.5),rgba(38,34,28,0.6))]",
              "text-[#e8e4d8]",
              "shadow-[0_2px_4px_rgba(0,0,0,0.4),_inset_0_1px_0_rgba(255,240,210,0.12)]",
              "hover:bg-[linear-gradient(180deg,rgba(100,85,55,0.7),rgba(60,50,32,0.8))]",
              "hover:border-[rgba(255,240,215,0.22)]",
              "hover:shadow-[0_4px_8px_rgba(0,0,0,0.5),_inset_0_1px_0_rgba(255,240,210,0.2),_0_0_20px_rgba(255,240,215,0.14)]",
            )}
          >
            <ThumbsUp className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            onClick={handleSend}
            disabled={sendDisabled}
            aria-label="Send message"
            title="Send (Enter)"
            className={cn(
              "rounded-md",
              "border-[rgba(255,220,170,0.5)]",
              "bg-[linear-gradient(180deg,hsla(var(--pv-id-hue),75%,66%,0.9),hsla(var(--pv-id-hue),75%,42%,0.92))]",
              "text-[#1a0f04]",
              "shadow-[0_4px_12px_rgba(0,0,0,0.5),_inset_0_1px_0_rgba(255,235,190,0.45),_0_0_24px_hsla(var(--pv-id-hue),75%,52%,0.4)]",
              "hover:bg-[linear-gradient(180deg,hsla(var(--pv-id-hue),80%,72%,0.95),hsla(var(--pv-id-hue),80%,48%,0.97))]",
              "hover:shadow-[0_6px_16px_rgba(0,0,0,0.6),_inset_0_1px_0_rgba(255,235,190,0.55),_0_0_32px_hsla(var(--pv-id-hue),75%,52%,0.5)]",
              "disabled:opacity-40 disabled:cursor-not-allowed",
            )}
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
