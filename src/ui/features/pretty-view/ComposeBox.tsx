import { useCallback, useEffect, useRef, useState } from "react";
import { Hourglass, RotateCcw, Send, ThumbsUp } from "lucide-react";
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

// Patch #83: number of vertical segments in the compose meter well.
// The well always mounts (even when contextPct is null) so the compose
// row's geometry doesn't jitter on first attach. Segments light bottom-to-
// top per contextPct at `litCount = round(contextPct / 100 * SEG_COUNT)`.
const SEG_COUNT = 12;

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
  // Optional: pane's registered identity displayName (e.g. "Tina"). Used to personalize the "Message …" textarea placeholder. Falls back to "Claude" when omitted or empty.
  identityName?: string;
  // Patch #84: PTY-side "Claude is currently working" signal from the
  // terminal WebSocket (patch #13 mechanism). `false` = Claude quiet
  // ≥4s AND foreground = claude → session idle. `true` = actively
  // working. `null` = backend has not spoken yet on the current
  // attach → do not treat as idle.
  //
  // Used by the Queue (Hourglass) button watchdog: while a message is
  // queued, we wait for isIdle === true to hold continuously for 3s
  // before dispatching. Combined with the backend's ~4s isIdle
  // debounce this yields ~7s effective delay from Claude's last
  // output — locked with Ashley 2026-07-19.
  isIdle?: boolean | null;
  className?: string;
}

export function ComposeBox({
  onSend,
  canSend,
  contextPct,
  hostId,
  tmuxSession,
  identityName,
  isIdle,
  className,
}: ComposeBoxProps) {
  const [text, setText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Patch #84: single-slot "queue send for when session goes idle" state.
  // queuedText === null → nothing queued (button rests). queuedText === string →
  // armed: overlay is up, textarea disabled, watchdog effect will fire dispatch
  // after `isIdle === true` holds continuously for 3s. dispatchTimerRef holds
  // the pending setTimeout id (mirrors the drainEndTimerRef pattern above).
  // Single-slot by design: no queue depth, no retry, no configurable threshold.
  const [queuedText, setQueuedText] = useState<string | null>(null);
  const dispatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Patch #83: drain-sweep animation state for the reset cell click.
  // isDraining triggers "all segments render as dim" so the well
  // visually empties (each segment's transition-delay is
  // (SEG_COUNT - 1 - i) * 35ms, so the topmost segment fades first and
  // the bottommost last — top→bottom sweep). isPulsing peaks the reset
  // cell's lit-green styling near the end of the drain (~420–770ms)
  // rather than at click-time, so the cell reads as "flushing the well
  // through itself" rather than a naked hover flash.
  const [isDraining, setIsDraining] = useState(false);
  const [isPulsing, setIsPulsing] = useState(false);
  const drainEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseOnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseOffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearDrainTimers = useCallback(() => {
    if (drainEndTimerRef.current) {
      clearTimeout(drainEndTimerRef.current);
      drainEndTimerRef.current = null;
    }
    if (pulseOnTimerRef.current) {
      clearTimeout(pulseOnTimerRef.current);
      pulseOnTimerRef.current = null;
    }
    if (pulseOffTimerRef.current) {
      clearTimeout(pulseOffTimerRef.current);
      pulseOffTimerRef.current = null;
    }
  }, []);
  useEffect(() => {
    return () => {
      clearDrainTimers();
    };
  }, [clearDrainTimers]);

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

  // Patch #83: how many meter-well segments should be lit right now.
  // Null contextPct → 0 (well mounts all-dim so the row geometry is
  // stable, and role="meter"'s aria-valuenow stays undefined so
  // assistive tech reports "unknown" rather than "0%").
  const litCount =
    contextPct != null ? Math.round((contextPct / 100) * SEG_COUNT) : 0;

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

  // Patch #84: dispatch the queued message when the idle watchdog fires.
  // Guaranteed queuedText !== null when this runs (watchdog effect gates
  // on that). D-50 Ink safety: collapse newlines to spaces before send,
  // matching handleSend. Fail-loud on dispatch failure per Ashley
  // 2026-07-19 (do NOT retry silently). useCallback is REQUIRED here —
  // the watchdog effect keeps a ref to this function via its dependency
  // array, and a bare function decl would capture a stale queuedText
  // between the arm and the timer fire.
  const fireQueuedDispatch = useCallback(() => {
    if (queuedText === null) return;
    const payload = queuedText.replace(/\r?\n/g, " ");
    const dispatched = onSend(payload);
    if (dispatched) {
      setText("");
      setQueuedText(null);
      clearAfterSend();
    } else {
      setQueuedText(null);
      setErrorMessage("Not connected — queued send failed");
    }
  }, [queuedText, onSend, clearAfterSend]);

  // Patch #84: idle watchdog — while a queue is armed, wait for
  // isIdle === true to hold continuously for 3s before firing dispatch.
  // Strict `=== true` — `null` (unknown / backend hasn't spoken) does
  // NOT trigger, matching the ergonomic contract that the queue only
  // fires when we KNOW the session went idle. Combined with the
  // backend's ~4s isIdle debounce this yields ~7s effective delay from
  // Claude's last output. Locked with Ashley 2026-07-19.
  useEffect(() => {
    if (queuedText === null) return;
    if (isIdle !== true) {
      // Session is working (or unknown) — cancel any pending fire so
      // the 3s window resets from the NEXT idle=true transition.
      if (dispatchTimerRef.current) {
        clearTimeout(dispatchTimerRef.current);
        dispatchTimerRef.current = null;
      }
      return;
    }
    // Idle. If a timer is already pending, keep it — this effect is
    // idempotent; do NOT restart the countdown just because the deps
    // rerendered (e.g. via a parent-driven re-render carrying the same
    // isIdle=true).
    if (dispatchTimerRef.current !== null) return;
    dispatchTimerRef.current = setTimeout(() => {
      dispatchTimerRef.current = null;
      fireQueuedDispatch();
    }, 3000);
    return () => {
      if (dispatchTimerRef.current) {
        clearTimeout(dispatchTimerRef.current);
        dispatchTimerRef.current = null;
      }
    };
  }, [queuedText, isIdle, fireQueuedDispatch]);

  // Patch #84: unmount cleanup — belt-and-suspenders against the
  // unmount-while-idle-transitioning race. The watchdog effect's own
  // cleanup fires on every deps change and would already handle the
  // common case; this extra effect (empty deps) guarantees a final
  // timer clear if the component unmounts between deps ticks.
  useEffect(() => {
    return () => {
      if (dispatchTimerRef.current) {
        clearTimeout(dispatchTimerRef.current);
        dispatchTimerRef.current = null;
      }
    };
  }, []);

  function handleTextChange(next: string) {
    setText(next);
    scheduleAutosave(next);
  }

  function handleBlur() {
    clearDebounce();
    void flushDirty();
  }

  // Patch #84: Queue button click. If armed → cancel (clear timer, drop
  // queue, refocus textarea). If idle → arm with the current trimmed
  // text (empty text is a no-op, matching handleSend's early return).
  // Silent cancel — no error UI on cancel branch.
  function handleQueue() {
    if (queuedText !== null) {
      if (dispatchTimerRef.current) {
        clearTimeout(dispatchTimerRef.current);
        dispatchTimerRef.current = null;
      }
      setQueuedText(null);
      textareaRef.current?.focus();
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) return;
    setErrorMessage(null);
    setQueuedText(trimmed);
  }

  function handleSend() {
    // Patch #84: immediate action wins — cancel any armed queue silently
    // and proceed with the direct send. No error UI on the dropped queue.
    if (queuedText !== null) {
      if (dispatchTimerRef.current) {
        clearTimeout(dispatchTimerRef.current);
        dispatchTimerRef.current = null;
      }
      setQueuedText(null);
    }

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
    // Patch #84: immediate action wins — cancel any armed queue silently.
    if (queuedText !== null) {
      if (dispatchTimerRef.current) {
        clearTimeout(dispatchTimerRef.current);
        dispatchTimerRef.current = null;
      }
      setQueuedText(null);
    }

    setErrorMessage(null);

    // Patch #83: fire the drain-sweep animation IMMEDIATELY on click,
    // regardless of dispatch success. Visual feedback on click reads
    // better than post-hoc gating; the /id reset payload is dispatched
    // synchronously in the same function anyway, so the drain matches
    // reality within the ~800ms window. Clear any in-flight drain
    // first so back-to-back clicks restart cleanly rather than
    // stacking timers.
    clearDrainTimers();
    setIsDraining(true);
    setIsPulsing(false);
    pulseOnTimerRef.current = setTimeout(() => {
      pulseOnTimerRef.current = null;
      setIsPulsing(true);
    }, 420);
    pulseOffTimerRef.current = setTimeout(() => {
      pulseOffTimerRef.current = null;
      setIsPulsing(false);
    }, 770);
    drainEndTimerRef.current = setTimeout(() => {
      drainEndTimerRef.current = null;
      setIsDraining(false);
    }, 800);

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
    // Patch #84: immediate action wins — cancel any armed queue silently.
    if (queuedText !== null) {
      if (dispatchTimerRef.current) {
        clearTimeout(dispatchTimerRef.current);
        dispatchTimerRef.current = null;
      }
      setQueuedText(null);
    }

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
    // Patch #84: while a queue is armed the textarea is disabled (Edit K
    // adds `disabled={queuedText !== null}`), so keydown normally cannot
    // reach us. Defense in depth against any focus-restoration race —
    // swallow all keys silently while armed.
    if (queuedText !== null) return;

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

  // Patch #84: derived state for the Queue (Hourglass) button. Armed
  // when queuedText !== null. Disabled when either the transport is
  // down (mirrors sendDisabled's canSend gate) OR when text is empty
  // AND we're not already armed — an armed button must always be
  // clickable so the user can cancel.
  const queueArmed = queuedText !== null;
  const queueDisabled =
    canSend === false || (queuedText === null && text.trim() === "");

  // Layout: textarea and send button share a single horizontal row so the
  // compose area stays as short as possible and yields more vertical space
  // to the conversation above (Ashley feedback 2026-07-17). Error text, when
  // present, sits below the row.
  return (
    <div
      className={cn(
        // Phase 4 Glass: QUIET compose surround (VISUAL-06) — still no
        // card, no border, no hard separator; compose does NOT compete
        // with the chat above for attention. But the previous
        // pure-black low-alpha gradient (rgba(0,0,0,0.15/0.3)) read as
        // FLAT SOLID BLACK against every other pretty-view surface
        // (chat bubbles, panels, badges — all warm-glass). This
        // revision (patch #79) gives compose the same warm-glass
        // character as the rest of pretty view: a warm-dark tint
        // (rgba(38,30,18)/rgba(20,15,8) instead of rgba(0,0,0)) so it
        // reads as "warm shelf darker than the pane" rather than "hole
        // in the pane," plus a very faint warm-cream 1px inset top
        // highlight — the same glass-rim trick used at high alpha on
        // the send button and at low alpha elsewhere. Deepened top
        // inset shadow reinforces the shelf depth. Result: textured,
        // dimensional, but still quiet.
        "flex flex-col gap-1 px-2 py-2 shrink-0",
        // Patch #82 palette shift: warm-brown → cool blue-black to
        // match the mock. RGB polarity flipped (was R>G>B, now B>R>G)
        // with the same alpha structure so the shelf still reads at
        // the same visual weight. Warm-cream inset rim shifted to
        // cool-cream (220,225,245) to match.
        "bg-[linear-gradient(180deg,rgba(28,30,40,0.55),rgba(18,20,28,0.62))]",
        "shadow-[inset_0_1px_0_rgba(220,225,245,0.06),_inset_0_2px_12px_rgba(0,0,0,0.4)]",
        className,
      )}
    >
      <div className="flex items-end gap-2">
        {/* Patch #83: cohesive segmented-well meter with integrated reset
            cell. The well ALWAYS mounts (12 dim segments show when
            contextPct is null so the row geometry never jitters on
            first attach). Segments light bottom-to-top per
            litCount = round(contextPct / 100 * SEG_COUNT), colored by
            position band: bottom green (< 45%) → middle amber (45-77%)
            → top red (≥ 78%). The bottom slot of the well is a native
            <button> reset cell — clicking it dispatches /id reset AND
            fires a top-to-bottom drain sweep animation (~600ms) with
            the reset cell pulsing lit-green at the drain peak. The
            meter and reset read as one instrument, not two widgets. */}
        <div
          className="w-7 self-stretch rounded-md flex flex-col p-[3px] bg-[rgba(10,12,20,0.6)] border border-[rgba(220,225,245,0.1)] shadow-[inset_0_2px_6px_rgba(0,0,0,0.55),_0_1px_0_rgba(220,225,245,0.05)]"
          role="meter"
          aria-label="Context window"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={contextPct ?? undefined}
          title={
            contextPct != null ? `Context ${contextPct}%` : "Context (unknown)"
          }
        >
          {/* Segments: flex-col-reverse so index 0 renders at the
              bottom of the well and index SEG_COUNT-1 at the top.
              transition-delay = (SEG_COUNT - 1 - i) * 35ms so the
              topmost segment transitions first — during a drain
              (isDraining=true, all segments render dim) this reads
              as a top→bottom sweep; when contextPct rises during
              normal use it reads as a bottom→top fill. */}
          <div className="flex-1 flex flex-col-reverse gap-[2px] min-h-[30px]">
            {Array.from({ length: SEG_COUNT }, (_, i) => {
              const posPct = (i / (SEG_COUNT - 1)) * 100;
              const band =
                posPct >= 78 ? "red" : posPct >= 45 ? "amber" : "green";
              const litGreenBg =
                "linear-gradient(90deg, hsla(155,45%,52%,1), hsla(155,45%,42%,1))";
              const litAmberBg =
                "linear-gradient(90deg, hsla(38,75%,55%,1), hsla(38,75%,45%,1))";
              const litRedBg =
                "linear-gradient(90deg, hsla(0,72%,55%,1), hsla(0,72%,42%,1))";
              const litGreenShadow =
                "0 0 5px hsla(155,45%,45%,0.5), inset 0 0 2px rgba(220,255,235,0.45)";
              const litAmberShadow =
                "0 0 5px hsla(38,75%,55%,0.55), inset 0 0 2px rgba(255,240,200,0.5)";
              const litRedShadow =
                "0 0 6px hsla(0,72%,55%,0.7), inset 0 0 2px rgba(255,220,200,0.5)";
              const dimGreenBg = "hsla(155,35%,20%,0.4)";
              const dimAmberBg = "hsla(38,45%,22%,0.4)";
              const dimRedBg = "hsla(0,50%,22%,0.4)";
              const isLit =
                typeof contextPct === "number" &&
                i < litCount &&
                !isDraining;
              let background: string;
              let boxShadow: string;
              if (isLit) {
                background =
                  band === "red"
                    ? litRedBg
                    : band === "amber"
                      ? litAmberBg
                      : litGreenBg;
                boxShadow =
                  band === "red"
                    ? litRedShadow
                    : band === "amber"
                      ? litAmberShadow
                      : litGreenShadow;
              } else {
                background =
                  band === "red"
                    ? dimRedBg
                    : band === "amber"
                      ? dimAmberBg
                      : dimGreenBg;
                boxShadow = "none";
              }
              return (
                <div
                  key={i}
                  className="flex-1 min-h-[2px] rounded-[1.5px] transition-[background,box-shadow] duration-[220ms] ease-out"
                  style={{
                    transitionDelay: `${(SEG_COUNT - 1 - i) * 35}ms`,
                    background,
                    boxShadow,
                  }}
                />
              );
            })}
          </div>
          {/* Divider between segment stack and reset cell — a hair-
              line inset that reads as a shelf seam inside the well. */}
          <div className="h-px my-[3px] bg-[rgba(220,225,245,0.09)] shadow-[0_1px_0_rgba(0,0,0,0.55)]" />
          {/* Reset cell: native <button> (NOT shadcn Button — the
              outline variant's `dark:bg-input/30` would force `!`
              gymnastics per patch #81-fix, and the icon-sm size-7
              rounded-none default doesn't fit the w-full h-6
              rounded-[2px] cell shape we need inside the w-7 well).
              Rests as unlit-green; hover brightens to lit-green;
              during a drain the cell holds lit-green while
              isPulsing (~420-770ms after click) so it reads as the
              flush-point of the emptying meter. */}
          <button
            type="button"
            onClick={handleResetSend}
            disabled={canSend === false}
            aria-label="Send with /id reset prefix"
            title="Send with /id reset prefix"
            className={cn(
              "w-full h-6 rounded-[2px] border-0 flex items-center justify-center p-0 cursor-pointer",
              "transition-[background,box-shadow,color] duration-[180ms]",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              isPulsing
                ? [
                    "bg-[linear-gradient(90deg,hsla(155,45%,52%,1),hsla(155,45%,42%,1))]",
                    "shadow-[0_0_8px_hsla(155,45%,45%,0.6),_inset_0_0_3px_rgba(220,255,235,0.4)]",
                    "text-[#f0f8f4]",
                  ]
                : [
                    "bg-[hsla(155,35%,20%,0.5)]",
                    "shadow-[inset_0_0_3px_rgba(0,0,0,0.4)]",
                    "text-[rgba(220,255,235,0.55)]",
                    // Only offer hover styling when NOT draining, so
                    // the pulse-peak lit-green isn't being fought by
                    // a hover selector at the same time.
                    !isDraining &&
                      "hover:bg-[linear-gradient(90deg,hsla(155,45%,52%,1),hsla(155,45%,42%,1))]",
                    !isDraining &&
                      "hover:shadow-[0_0_8px_hsla(155,45%,45%,0.6),_inset_0_0_3px_rgba(220,255,235,0.4)]",
                    !isDraining && "hover:text-[#f0f8f4]",
                  ],
            )}
          >
            <RotateCcw className="size-3.5" />
          </button>
        </div>
        {/* Patch #84: textarea wrapper. The wrapper owns flex sizing
            (`flex-1 self-stretch`) so the pending overlay can position
            absolute-inset over the Textarea while the Textarea itself
            fills the wrapper. `relative` is the positioning context for
            the overlay. */}
        <div className="relative flex-1 self-stretch">
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          disabled={queueArmed}
          placeholder={`Message ${identityName || "Claude"}…`}
          rows={rows}
          // Phase 4 Glass: recessed textarea well (patch #81) +
          // identity-hue focus ring (VISUAL-03/VISUAL-07). Fill is a
          // warm-black rgba(15,10,5,0.42) — sits DEEPER than #79's
          // warm-glass surround, so the textarea reads as a well
          // pressed INTO the shelf, not a raised patch ON it. Ashley
          // 2026-07-19: at rest the textarea should not draw
          // attention; focus IS the moment attention is wanted, so
          // brightening on focus reads correctly against the darker
          // resting state. The 1px warm-cream 7% border is now the
          // SECONDARY affordance — the darker fill's contrast
          // against the surround does the primary work of finding
          // the textarea. Focus reveals a brightened warm-cream
          // border + identity-hue outer glow — subtle grow-into-
          // view, not a sudden pop. `focus-visible:ring-0` and
          // `focus-visible:outline-none` disable the shadcn Textarea's
          // default focus ring (`focus-visible:border-ring
          // focus-visible:ring-ring/50 focus-visible:ring-[3px]`) so
          // our own hue ring wins cleanly.
          className={cn(
            "resize-none w-full h-full",
            // `!` (Tailwind v4 important suffix) is required on the bg
            // arbitrary class: the shadcn `Textarea` wrapper's base
            // className carries `dark:bg-input/30` (see
            // src/ui/components/textarea.tsx), which compiles to the
            // selector `.dark .dark\:bg-input\/30` — specificity 0-2-0.
            // A plain arbitrary `.bg-\[rgba\(...\)\]` is only 0-1-0 and
            // silently LOSES the cascade even though it appears later in
            // the classList (tailwind-merge preserves both because the
            // variant differs). `!` promotes ours to !important so it
            // beats the dark: variant. Verified via a DOM diag snippet
            // 2026-07-19: without `!`, computed bg was
            // `oklab(1 0 0 / 0.045)` (dark:bg-input/30 winning); with
            // `!` it resolves to rgba(15,10,5,0.42) as intended.
            // Border does NOT need `!` — shadcn's base is plain
            // `border-input` (no dark: variant → same specificity as
            // ours → tailwind-merge dedupes → later class wins cleanly).
            // Patch #82 palette shift: warm-black well → cool-black
            // well (rgba(15,10,5) → rgba(10,12,20)), alpha bumped
            // 0.42→0.5 to preserve visibility on the cool-tinted
            // surround. Warm-cream border/focus glow shifted to
            // cool-cream (220,225,245). `!` load-bearing on bg per
            // #81-fix (see comment above).
            "bg-[rgba(10,12,20,0.5)]! text-[#f0ebe0]",
            "border border-[rgba(220,225,245,0.07)]",
            "rounded-[10px] px-4 py-3",
            "placeholder:text-[var(--color-pv-fg-dim)]",
            "shadow-[inset_0_2px_6px_rgba(0,0,0,0.4),_0_1px_0_rgba(220,225,245,0.04)]",
            "transition-[box-shadow,border-color] duration-200",
            "focus:border-[rgba(220,225,245,0.28)]",
            "focus:shadow-[inset_0_3px_10px_rgba(0,0,0,0.55),_inset_0_1px_2px_rgba(0,0,0,0.35),_0_1px_0_rgba(220,225,245,0.07),_0_0_0_1px_rgba(220,225,245,0.2),_0_0_22px_rgba(220,225,245,0.12)]",
            "focus-visible:ring-0 focus-visible:outline-none",
          )}
          // Note: NOT disabled when canSend===false — user can compose
          // during a transient disconnect and send when WS reconnects.
          // The send button is disabled; the error will surface on attempt.
          // (Patch #84 DOES disable via `disabled={queueArmed}` above —
          // that gate is orthogonal: it applies only while the queue is
          // armed, restoring editability the instant the queue clears
          // or is cancelled.)
        />
        {/* Patch #84: pending overlay. Mounts only while queue is armed.
            `pointer-events-none` so the Textarea underneath still owns
            all interaction (it's already disabled, but this keeps the
            overlay from stealing pointer focus). `rounded-[10px]`
            matches the Textarea's own rounded-[10px] so corners align.
            Dark warm-cool scrim + tight blur reads as "held, waiting"
            without hiding whatever the user composed. */}
        {queueArmed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 pointer-events-none rounded-[10px] bg-[rgba(10,12,20,0.72)] backdrop-blur-[2px]">
            <Hourglass className="size-5 text-[hsla(38,70%,72%,0.9)]" />
            <span className="text-sm text-[hsla(38,60%,80%,0.85)] font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif]">
              Queued — waiting for idle
            </span>
          </div>
        )}
        </div>
        {/* Icon-button column: thumbs-up "go ahead" quick-reply on top,
            paper-airplane Send on the bottom. Ordered least-used at top,
            most-used at bottom (closest to the mouse arriving from the
            textarea). Bottom-aligned to the textarea via the parent's
            items-end. If the textarea grows past the stack's height,
            empty space appears above ThumbsUp rather than pushing Send
            up. Patch #83: RotateCcw moved OUT of this column into the
            meter well's bottom slot — the reset lives with the meter
            it drains, not with the send/quick-reply buttons. */}
        <div className="flex flex-col gap-1">
          {/* Phase 4 Glass: ThumbsUp adopts the mock's `.pv-icon-btn`
              quiet treatment (warm-neutral gradient + hue-tinted hover
              glow). Send gets a saturated warm-AMBER treatment (fixed
              hue 38°) — VISUAL-08 HARD LOCK: send is the ONE compose
              attention grab-point AND it's the USER's button, so it
              deliberately does NOT wear the assistant's identity hue.
              Kept vibrant (90% sat + brighter hover) so it still
              dominates the composer visually. */}
          <Button
            size="icon-sm"
            variant="outline"
            onClick={() => handleQuickSend("go ahead")}
            disabled={canSend === false}
            aria-label="Send 'go ahead'"
            title="Send 'go ahead'"
            className={cn(
              "rounded-md cursor-pointer",
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
          {/* Patch #84: Queue button — arms a single-slot "send when
              session goes idle" queue. Rests warm-neutral (matches
              ThumbsUp's `.pv-icon-btn` treatment). When armed, glows
              amber + pulses to signal "waiting" — semantically distinct
              from Send's saturated warm-amber (VISUAL-08 send is
              always-on attention grab; Queue's amber is TRANSIENT
              status). `!` load-bearing on all bg-[linear-gradient(...)]
              classes: the shadcn `outline` variant carries
              `dark:bg-input/30 dark:hover:bg-input/50` (specificity
              0-2-0) which would beat plain 0-1-0 arbitrary bg. Same
              trap as patch #81-fix on the Textarea. */}
          <Button
            size="icon-sm"
            variant="outline"
            onClick={handleQueue}
            disabled={queueDisabled}
            aria-label={
              queueArmed
                ? "Cancel queued send"
                : "Queue send for when session goes idle"
            }
            title={
              queueArmed
                ? "Cancel queued send"
                : "Queue send for when session goes idle"
            }
            className={cn(
              "rounded-md cursor-pointer",
              queueArmed
                ? [
                    "bg-[linear-gradient(180deg,hsla(38,55%,50%,0.9),hsla(38,60%,32%,0.95))]!",
                    "border-[hsla(38,70%,55%,0.5)]",
                    "text-[#fff5e0]",
                    "shadow-[0_2px_6px_rgba(0,0,0,0.45),_inset_0_1px_0_rgba(255,235,190,0.35),_0_0_16px_hsla(38,70%,52%,0.35)]",
                    "animate-pulse",
                  ]
                : [
                    "border-white/10",
                    "bg-[linear-gradient(180deg,rgba(70,66,58,0.5),rgba(38,34,28,0.6))]!",
                    "text-[#e8e4d8]",
                    "shadow-[0_2px_4px_rgba(0,0,0,0.4),_inset_0_1px_0_rgba(255,240,210,0.12)]",
                    "hover:bg-[linear-gradient(180deg,rgba(100,85,55,0.7),rgba(60,50,32,0.8))]!",
                    "hover:border-[rgba(255,240,215,0.22)]",
                    "hover:shadow-[0_4px_8px_rgba(0,0,0,0.5),_inset_0_1px_0_rgba(255,240,210,0.2),_0_0_20px_rgba(255,240,215,0.14)]",
                  ],
            )}
          >
            <Hourglass className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            onClick={handleSend}
            disabled={sendDisabled}
            aria-label="Send message"
            title="Send (Enter)"
            className={cn(
              "rounded-md cursor-pointer",
              "border-[rgba(255,220,170,0.5)]",
              "bg-[linear-gradient(180deg,hsla(38,90%,66%,0.92),hsla(38,90%,44%,0.94))]",
              "text-[#1a0f04]",
              "shadow-[0_4px_12px_rgba(0,0,0,0.5),_inset_0_1px_0_rgba(255,235,190,0.5),_0_0_24px_hsla(38,90%,55%,0.42)]",
              "hover:bg-[linear-gradient(180deg,hsla(38,95%,72%,0.96),hsla(38,95%,50%,0.98))]",
              "hover:shadow-[0_6px_16px_rgba(0,0,0,0.6),_inset_0_1px_0_rgba(255,235,190,0.6),_0_0_32px_hsla(38,90%,55%,0.5)]",
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
