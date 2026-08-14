import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createLogDedup } from "@/lib/log-dedup";
import { CircleHelp, ListPlus, Loader2, Paperclip, RefreshCw, RotateCcw, RotateCwFadingClock, Square, ThumbsUp, X } from "lucide-react";
import { Button } from "@/components/button";
import { Textarea } from "@/components/textarea";
import { cn } from "@/lib/utils";
import {
  flushComposeDraftKeepalive,
  getComposeDraft,
  putComposeDraft,
} from "@/api/compose-drafts-api";
import { publishSessionQueuePending } from "@/state/session-queue-pending-store";
import { AttachmentChipStrip, type StagedAttachmentLike } from "./AttachmentChipStrip";
import { useVoiceRecording } from "./useVoiceRecording";
import { useHoldToRecord } from "./useHoldToRecord";
import { MicButton } from "./MicButton";
import { RecordingControls } from "./RecordingControls";

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
// Phase 16 (voice input, plan 03): Mic button lives in the SAME slot as the
// send button (D-16-01). Visibility rule (computed as `showMicButton`):
//   voice.state === "idle" && text.trim() === "" && !asideActive && !queueArmed && !hasAttachments
// In every other idle scenario the existing send/X-for-Resume button renders.
// While `voice.state === "recording"`, RecordingControls own the slot.
// While `voice.state === "transcribing"`, the existing send button renders disabled.
//
// handleSend accepts an optional `overridePayload?: string` (D-16-05): when
// provided, it is used as the send payload instead of the current `text` state.
// This lets voice.endSend pass the glued transcript synchronously without
// fighting React's async setState batching. ALL handleSend behavior (attachment
// branching, D-50 newline collapse, COMPOSE-04 hard-lock) still applies.
//
// Sync-getUserMedia constraint (D-16-02): the hook's `start()` is a plain
// function that calls getUserMedia as its FIRST statement — ComposeBox simply
// passes `voice.start` directly to MicButton's onClick so no await is inserted.
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

// Phase 31 D-17: module-scoped dedup for [tap] events — tap events fire
// frequently on scroll/pointer flicker so we suppress repeats within 3s
// windows (N=5, W=3000ms — slightly higher N than default because tap volume
// is chatter, shorter W because taps cluster in bursts).
const tapDedup = createLogDedup({ N: 5, W: 3000 });

// Patch #119 — draft-loss belt-and-suspenders: localStorage mirror for the
// compose draft body. Single-user-per-browser tool, so no userId in the key.
// Survives any server-side failure mode (bad load key, DB not ready, auth,
// container recreate mid-typing). Hydrate path: if server returns empty AND
// localStorage has content, restore from ls and schedule an autosave so the
// server catches up. Diagnostic console.warns on save/load help narrow the
// still-unknown root cause of post-restart draft loss.
function composeDraftLsKey(
  hostId: number,
  tmuxSessionKey: string | null | undefined,
): string {
  return `skynet:compose-draft:${hostId}:${tmuxSessionKey ?? ""}`;
}

// Patch #83: segmented meter well with integrated reset cell (one instrument).
// Phase 9 (09-02): rotated 90° from vertical (28px wide × stretched-tall)
// to horizontal (160px wide × 28px tall). Segments now fill LEFT→RIGHT;
// index 0 = leftmost = lowest context %; index SEG_COUNT-1 = rightmost =
// highest %. The reset cell is now the LEFTMOST cell (was BOTTOMMOST).
// Drain sweep empties RIGHT→LEFT (rightmost dims first, leftmost last).
// See UI-SPEC.md § Interaction Contract → Drain-Sweep Animation.
//
// SEG_COUNT = 12 (back to the pre-patch-#89 count, per prototype 2026-07-22).
// Patch #89 bumped 12 → 11 to fix sub-pixel rounding artifacts at ~2.5px/
// segment in the vertical well. The horizontal orientation at 160px removes
// that concern: 160px / 12 segments ≈ 13px/segment — no rounding hazard.
// Ashley endorsed 12 segments in prototype review (UI-SPEC.md § Segment Count).
//
// `litCount = round(contextPct / 100 * SEG_COUNT)` — segments 0..litCount-1 are
// lit, litCount..SEG_COUNT-1 are dim. Color bands by position:
// green (< 45%), amber (45-77%), red (≥ 78%).
//
// CSS custom properties `--seg-count` and `--meter-width` are set on the
// meter well's inline style for live DevTools tuning without a rebuild.
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
  // Patch #122: fired synchronously when the meter well's Reset button is
  // clicked, BEFORE the `/id reset` payload is dispatched via `onSend`.
  // Lets PrettyView flip `isHolding` true immediately instead of waiting
  // for the backend `session_holding` WS frame (~seconds delayed).
  // Optional — omitted when the caller isn't wiring the session-holding
  // overlay.
  onResetClicked?: () => void;
  // Patch #96: invoked by the ThumbsUp "good to go" button BEFORE dispatching
  // the message text. Jumps scrollTop to bottom and enters Slack-follow mode
  // so the reply comes in stuck to the tail without waiting for the JSONL echo.
  // Optional: omitted when PrettyView is read-only (no onSend prop supplied).
  onGoodToGo?: () => void;
  // Patch #120: optional interrupt callback. When provided, renders a
  // Square-icon "stop" button to the left of the ThumbsUp button that
  // sends Ctrl-C into the attached tmux session via a new WS
  // `interrupt` message (backend fires `tmux send-keys ... C-c`, with a
  // raw `\x03`-byte PTY fallback for non-tmux panes). When omitted the
  // button does not render — read-only PrettyView callers stay clean.
  onInterrupt?: () => void;
  // When false, Enter is still accepted for typing (textarea not disabled)
  // but Send button is visually disabled. The send attempt will fail and
  // show the inline error — the component does not need to pre-emptively
  // block the attempt since onSend returns false when WS is not ready.
  canSend?: boolean;
  // Patch #122: when true, force all meter well segments to their unlit
  // state (well glow, border, and background stay intact). Ashley UX rule:
  // during session recycle the meter should read as `powered but empty`,
  // not `powered and filled` — segments only re-populate when the backend
  // emits `context_pct` on the fresh session.
  isHolding?: boolean;
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
  // ============================================================
  // Phase 05 upload wiring — all optional so existing read-only /
  // no-uploads callers stay backward-compatible.
  // ============================================================
  // The staged attachments to render as chips above the textarea.
  // When absent or empty, the chip strip does not mount at all.
  stagedAttachments?: StagedAttachmentLike[];
  // Called when the × on a chip is clicked. The parent hook
  // (usePrettyViewUploads) removes the entry and emits upload_abort
  // if the file was in flight.
  onRemoveAttachment?: (tempId: string) => void;
  // Gates whether the paperclip attach button renders in the aux row.
  // Independent of `isTouchDevice`; either or both may be true.
  // Threaded from PrettyView. Patch #123 decoupled paperclip visibility
  // from the touch-target row-height gate so desktop can also show the
  // paperclip in a compact row (post-#121 aux row has room).
  showPaperclip?: boolean;
  // Gates the Row 1 top-row min-h between `min-h-[44px]` (touch, WCAG
  // 2.5.5 touch-target compliance) and `min-h-8` (desktop compact).
  // Sourced from PrettyView's useIsTouchDevice() call (patch #102 — the
  // SOLE mobile-vs-desktop discriminator, pointer:coarse + hover:none).
  // Independent of `showPaperclip` — see patch #123 for the decoupling
  // rationale.
  isTouchDevice?: boolean;
  // One callback for BOTH entry points (paperclip picker + textarea
  // paste). The parent hook's stageAttachments handler consumes this.
  onAttachFiles?: (files: File[]) => void;
  // Quick 260803-05i: target-aware staging entry point. Queued slots pass their
  // own target string `queued:${slot.id}` so per-slot attachments stay isolated.
  // Legacy `onAttachFiles` remains for backward-compat + primary paste path.
  onAttachFilesForTarget?: (target: string, files: File[]) => void;
  // Quick 260803-05i: per-slot read of staged attachments. Task 2 uses this to
  // render the overlay chip strip inside each queued textarea's wrapper.
  getStagedAttachmentsForTarget?: (target: string) => StagedAttachmentLike[];
  // Quick 260803-05i: per-slot clear. QueuedRow's top-left delete × calls
  // this when a slot is removed so its staged attachments don't linger in
  // the hook.
  clearStagedForTarget?: (target: string) => void;
  // Called instead of onSend when Send is clicked and at least one
  // attachment is staged. The caller (PrettyView) invokes
  // usePrettyViewUploads.startBatch(caption). Send remains ENABLED
  // when attachments are staged even if caption text is empty
  // (UPLOAD-13).
  onSendWithAttachments?: (caption: string) => void;
  // Called when the user clicks the Retry button that appears when at
  // least one chip has status='error'. Parent hook re-issues the
  // batch. Empty batches or all-complete batches do not surface this
  // button (parent hook returns null in those cases, but the button
  // wouldn't have been visible anyway).
  onRetryBatch?: () => void;
  // ============================================================
  // Phase 14 (plain-language-translation-asides) Wave 3 Task 2 —
  // interface-only extension. Body consumption (button gates + Send→X
  // morph + lucide-react X import) is Wave 4 (14-04) — see CONTEXT.md
  // § ComposeBox morph for semantics. Split into two waves per plan-
  // checker W3 so PrettyView (Wave 3 Task 3) can pass these props
  // typesafely; Wave 4 then implements only the body without any
  // interface risk.
  // ============================================================
  //
  // asideActive — when true, ComposeBox is in ASIDE-DISPLAYED mode per
  // ASIDE-06. Wave 4 will (a) extend each aux-button `disabled`
  // predicate to also gate on this flag being true, and (b) morph the
  // Send button to X (Resume) with the id-hue tint. Textarea remains
  // editable per CONTEXT.md § ComposeBox morph — Wave 4 must NOT
  // gate the textarea on this.
  //
  // Doc-comment note: negative-grep gate on the plan verify block
  // deliberately checks for the literal expression that Wave 4 will
  // add to the disable predicates. This comment describes the future
  // Wave 4 edit in prose, without using the literal comparison
  // expression itself, so the grep gate stays clean here. Precedent:
  // 14-02-SUMMARY.md § Deviations #2 (same doc-comment-vs-negative-
  // grep rewrite pattern from Wave 2).
  asideActive?: boolean;
  // onAsideDismiss — fired when the user clicks the morphed X (Resume)
  // affordance. Wave 4 will wire the Send button's onClick to call
  // this instead of handleSend when asideActive is true. Parent
  // (PrettyView Task 3) supplies the callback that optimistically
  // clears the aside display and WS-sends {type:'aside_dismissed',
  // hostId, tmuxSession} per CONTEXT.md § Dismiss.
  onAsideDismiss?: () => void;
  // Quick 260729-j8l: session-recycle-in-flight signal from PrettyView.
  // When true, every WS-side-effecting compose control is disabled or
  // hidden (Send button, reset cell, paperclip, ThumbsUp, Recap,
  // Queue, Mic). Textarea REMAINS typeable so Ashley can pre-draft the
  // next message during the 2-15s recycle window (autosave path
  // patches #57/#119 untouched → the draft survives the recycle by the
  // existing mechanism).
  //
  // Why SEPARATE from asideActive: aside MORPHS Send into an X/Resume
  // affordance (identity-hue X icon, onClick fires onAsideDismiss).
  // Recycle wants Send to STAY as Send but be DISABLED (no morph, no
  // dismiss handler — there is nothing to dismiss). Because the Send-
  // button behavior differs, the two props are kept independent — do
  // NOT collapse into a combined `interactionsDisabled` flag.
  //
  // For the aux buttons (attach, ThumbsUp, Recap, Queue) and Send-
  // when-not-morphed, the disable EFFECT is identical to asideActive
  // (just render `disabled=true`), so those predicates OR-in
  // `|| recycleActive === true` matching the existing
  // `|| asideActive === true` pattern verbatim.
  //
  // Value is `showOverlay` in PrettyView (delay-armed by ~350ms after
  // `isHolding` flips true, patch #74). Using `showOverlay` not
  // `isHolding` here matches the overlay's own visibility gate so the
  // controls disable exactly when the scrim mounts.
  recycleActive?: boolean;
  // Phase 24: plan-mode approval prompt is pending. When true, every WS-side-
  // effecting compose control is disabled (Send button STAYS as Send but
  // disabled=true; reset, ThumbsUp, Recap, Queue all disabled). Textarea
  // REMAINS typeable so Ashley can pre-draft her feedback message while the
  // plan-approval prompt is open — matches the recycleActive behavior verbatim.
  //
  // Why SEPARATE from asideActive AND recycleActive (per CONTEXT § "Do NOT
  // collapse"): asideActive MORPHS Send into X/Resume; recycleActive keeps
  // Send as Send but disabled; planPendingActive follows the recycleActive
  // treatment. Because the Send-button behavior differs across the three,
  // props stay independent. For every aux-button disable predicate that
  // reads `|| recycleActive === true`, also OR-in `|| planPendingActive === true`.
  //
  // Value from PrettyView: `planPending !== null` — flipped by the WS
  // `plan_pending` frame handler.
  planPendingActive?: boolean;
  // Pretty-view WS reconnect window (patch #148 auto-retry between an old
  // socket's onclose and a fresh session frame). During that ~2s window the
  // WS is not open so onSend would no-op silently; disable Send + reset +
  // ThumbsUp + Recap + Queue exactly like recycleActive/planPendingActive.
  // Textarea, mic, and attach stay usable (mic records locally; attach
  // stores locally until Send). Independent prop rather than OR'd into
  // recycleActive so future readers of either prop keep their documented
  // semantics.
  //
  // Value from PrettyView: `status === "error"`.
  reconnectingActive?: boolean;
  // quick 260808-cd6 — dormancy overlay + wake button.
  // Identity pane is dormant OR the local 'waking…' window is active (after
  // the user clicks Wake, until a live JSONL frame auto-dismisses the overlay).
  // Disables all WS-side-effecting controls (Send, reset, ThumbsUp, Recap, Queue)
  // while textarea, mic, and attach remain live — same guarantee as recycleActive.
  // Value from PrettyView: `dormant || waking` — flipped by the WS `dormant`
  // frame handler + the local waking state set by handleWake.
  // INDEPENDENT-from-other-props: same "Do NOT collapse" rule as recycleActive
  // (per CONTEXT § "Do NOT collapse") — the disable topology is intentionally
  // symmetric with reconnectingActive (dormantActive mirrors it 1:1; every site
  // that reads reconnectingActive also OR-in dormantActive).
  dormantActive?: boolean;
  className?: string;
}

export function ComposeBox({
  onSend,
  onResetClicked,
  canSend,
  isHolding,
  contextPct,
  hostId,
  tmuxSession,
  identityName,
  isIdle,
  onGoodToGo,
  onInterrupt,
  stagedAttachments,
  onRemoveAttachment,
  showPaperclip,
  isTouchDevice,
  onAttachFiles,
  onAttachFilesForTarget,
  getStagedAttachmentsForTarget,
  clearStagedForTarget,
  onSendWithAttachments,
  onRetryBatch,
  asideActive,
  onAsideDismiss,
  recycleActive,
  planPendingActive,
  reconnectingActive,
  dormantActive,
  className,
}: ComposeBoxProps) {
  // Phase 05 — hidden file input driven by the paperclip button. When the
  // input's change event fires, we normalize the FileList to a plain array
  // and hand it to onAttachFiles (which the parent hook's stageAttachments
  // then consumes). Clearing input.value after selection allows the same
  // file to be re-picked later — some browsers otherwise no-op a repeat
  // selection because the "value hasn't changed."
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Quick 260803-05i: records which target owns the currently-open file picker.
  // The main-composebox paperclip sets this to "primary" on click; each queued
  // slot's paperclip sets this to `queued:${slot.id}`. handleFileInputChange
  // reads the ref, defaults to "primary" if null (safety), and routes to the
  // target-aware onAttachFilesForTarget prop (falling back to onAttachFiles if
  // the target-aware prop isn't threaded — backward-compat).
  const activeStagingTargetRef = useRef<string | null>(null);
  const handleOpenFilePicker = useCallback((target: string = "primary") => {
    activeStagingTargetRef.current = target;
    fileInputRef.current?.click();
  }, []);
  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      const target = activeStagingTargetRef.current ?? "primary";
      activeStagingTargetRef.current = null;
      if (files.length > 0) {
        if (onAttachFilesForTarget) {
          onAttachFilesForTarget(target, files);
        } else {
          onAttachFiles?.(files);
        }
      }
      // Reset so the same file can be picked again in the same session.
      e.target.value = "";
    },
    [onAttachFiles, onAttachFilesForTarget],
  );
  // Phase 05 — clipboard paste of file-shaped payloads (screenshots,
  // dragged-from-Files.app, etc.). Text pastes fall through to the
  // browser default so the existing "[pasted N lines]" collapse-
  // avoidance path (COMPOSE-05) is unchanged.
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length > 0) {
        e.preventDefault();
        onAttachFiles?.(files);
      }
    },
    [onAttachFiles],
  );

  // Phase 16 — voice recording state machine. Owns MediaRecorder lifecycle,
  // fetch to /voice/transcribe, and transcript-to-text glue rule.
  // Pass logContext so voice log lines carry hostId/sessionId per D-12.
  const voice = useVoiceRecording({ hostId: hostId ?? undefined, sessionId: tmuxSession ?? undefined });

  // Phase 05 — derived state for the Send-routing decision + Retry button.
  const hasAttachments = (stagedAttachments?.length ?? 0) > 0;
  const hasErroredChip = !!stagedAttachments?.some((a) => a.status === "error");
  const [text, setText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composeRootRef = useRef<HTMLDivElement>(null);
  // Quick 260802-wxy: refs + state for the overlaid chip strip inside the
  // primary textarea wrapper. The strip is absolutely positioned at top-0
  // and the textarea's paddingTop grows to accommodate its rendered height
  // so composed text never underlaps the chips. ResizeObserver drives the
  // measurement (chips wrap when the strip's flex-wrap runs out of width).
  const chipStripRef = useRef<HTMLDivElement | null>(null);
  const [chipStripHeight, setChipStripHeight] = useState(0);
  // Patch #135: cache of the 6-row height cap (px), computed once on mount
  // from getComputedStyle(el).lineHeight × 6. Null until first useLayoutEffect
  // pass consults the DOM. 144px fallback (24 × 6) covers the JSDOM `normal`
  // keyword branch where parseFloat resolves to NaN.
  const maxHeightPxRef = useRef<number | null>(null);

  // Vehicle C v2 (2026-08-01): per-source FIFO queue for "send when idle".
  // Each entry pairs a source key ("primary" for the main textarea, or a
  // queueSlot id string) with the trimmed text captured at arm-time.
  // Idle watchdog fires ONE head entry per idle event — sequential cadence
  // across N armed textareas emerges naturally from the session cycling
  // working→idle between dispatches. Retires patch #84's single-slot
  // `queuedText: string | null` — that design blocked "arm N textareas and
  // walk away" because arming a second textarea would overwrite the first.
  // 3s idle threshold + strict `isIdle !== true` gate carry over unchanged.
  type QueueEntry = { source: "primary" | string; text: string };
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const dispatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Helpers for the per-source queue. `isSourceArmed` answers the
  // per-textarea overlay/disabled-gate questions. `queueArmed` is the
  // any-armed roll-up (mostly for the idle watchdog effect's gate).
  // `armSourceForIdle` trims the text, no-ops on empty, upserts in place
  // on an existing source (preserves FIFO position — user retype does
  // NOT jump the queue), and clears errorMessage. `cancelSourceArmed`
  // filters out one source (source-scoped cancel; other armed sources
  // persist).
  function isSourceArmed(source: "primary" | string): boolean {
    return queue.some((e) => e.source === source);
  }
  const queueArmed = queue.length > 0;
  function armSourceForIdle(source: "primary" | string, sourceText: string): void {
    const trimmed = sourceText.trim();
    if (!trimmed) return;
    setErrorMessage(null);
    setQueue((prev) => {
      const existingIdx = prev.findIndex((e) => e.source === source);
      if (existingIdx >= 0) {
        const next = prev.slice();
        next[existingIdx] = { source, text: trimmed };
        return next;
      }
      return [...prev, { source, text: trimmed }];
    });
  }
  function cancelSourceArmed(source: "primary" | string): void {
    setQueue((prev) => prev.filter((e) => e.source !== source));
  }

  // Bounty message-queue-in-pretty-view: per-slot message queue state.
  // queueSlots: array of {id, text} objects rendered as stacked textareas
  // above Row 2. micTarget tracks which slot (or "primary") owns the mic.
  const [queueSlots, setQueueSlots] = useState<Array<{ id: string; text: string }>>([]);
  const [micTarget, setMicTarget] = useState<"primary" | string>("primary");
  // Mirror queueSlots into a ref so pagehide/visibilitychange handlers and
  // the 10s retry interval read the latest value without stale-closure issues.
  const latestQueueSlotsRef = useRef<Array<{ id: string; text: string }>>([]);
  latestQueueSlotsRef.current = queueSlots;

  // makeSlotId: unique short id for each new queue slot.
  // Uses crypto.randomUUID() when available (modern browsers, secure context);
  // falls back to Date.now() + random suffix for older environments.
  const makeSlotId = (): string => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  };

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

  // Patch #181: press feedback on every composebox button. Delegated
  // handler on the compose root adds `.pv-btn-pressed` to whatever
  // <button> was tapped for a fixed 250ms window, regardless of how long
  // the tap is held or when :active drops. Rationale: pretty-view buttons
  // like ThumbsUp ("let's go") produce message bubbles asynchronously —
  // the underlying session decides when the message lands — so Ashley
  // needs an immediate local ack that her tap registered. The `:active`
  // pseudo-class alone drops the moment the finger releases (very short
  // on mobile), so we drive the styling from a JS-added class with a
  // fixed decay window. Skip disabled buttons — no action fired, no
  // reason to flash.
  //
  // PATCH #339 (textarea-tap-coordinate-mismatch-ios-diag arc):
  // Original patch #181 listener used `pointerdown` at CAPTURE phase.
  // Diagnostic (patch #338) confirmed a shared iOS PWA symptom class
  // with tanya's context-menu-item-first-tap-suppressed-on-ios bug:
  // capture-phase mousedown/pointerdown listeners at parent scope cause
  // iOS Safari to silently drop the native tap→action synthesis (caret
  // positioning for textareas; click synthesis for buttons/menu items)
  // some percentage of the time (30% no-op rate captured across 20
  // pointerdowns on the compose textarea). Fix: move to `pointerup` at
  // BUBBLE phase — fires AFTER iOS has already committed its native
  // tap action, so it can't sit in the intercept path. Flash timing
  // shifts from press-down (pointerdown) to press-release (pointerup),
  // a delta of typically 50-150ms — indistinguishable from the caller's
  // perspective for the "immediate ack" use case since :active from
  // browser default still fires on press-down as usual. Same delegation
  // pattern, same 250ms fixed decay, same button.closest + disabled
  // guard — only the event name + capture flag change.
  useEffect(() => {
    const root = composeRootRef.current;
    if (!root) return;
    const onUp = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || typeof target.closest !== "function") return;
      const btn = target.closest("button") as HTMLButtonElement | null;
      if (!btn || !root.contains(btn)) return;
      if (btn.disabled) return;
      btn.classList.add("pv-btn-pressed");
      window.setTimeout(() => {
        btn.classList.remove("pv-btn-pressed");
      }, 250);
    };
    root.addEventListener("pointerup", onUp);
    return () => {
      root.removeEventListener("pointerup", onUp);
    };
  }, []);

  // Patch #57 persistence refs.
  // dirtyBodyRef: null = no pending save; string (including "") = the
  // most-recent unsaved value that needs to reach the server. Mirrors
  // MessageQueueDrawer's dirtyBodiesRef per-item semantics but scoped
  // to the single draft this component owns.
  // Bounty message-queue-in-pretty-view: dirty tracking extended — either
  // body OR queueSlots mutations count as "dirty" for the retry loop.
  const dirtyBodyRef = useRef<string | null>(null);
  const dirtyQueueSlotsRef = useRef<Array<{ id: string; text: string }> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror of `text` so async callbacks (interval tick, pagehide handler)
  // can read the latest value without stale-closure surprises.
  const latestBodyRef = useRef<string>("");
  latestBodyRef.current = text;

  // Normalize the nullable prop for storage-boundary calls.
  const tmuxSessionKey: string | null = tmuxSession ?? null;

  // quick-260802-w9e: composite key for the session-queue-pending-store.
  // Shape `${hostId}:${tmuxSession ?? ""}` MATCHES sessionWorkingKey() at
  // PrettyConversationsPanel.tsx:95-98 verbatim so both the working-store
  // and the queue-pending-store are looked up with the SAME string. Guarded
  // on `hostId` truthiness — 0 is not a valid host id in the fork's schema
  // but the extra guard covers the "props not yet wired" edge case at zero
  // cost. Nullish when unable to publish; the effects below early-return.
  const sessionKey: string | null = hostId
    ? `${hostId}:${tmuxSession ?? ""}`
    : null;

  const clearDebounce = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  // Flush the pending dirty body/queueSlots (if any). Best-effort — on error,
  // re-queue the LATEST values (prefer latestBodyRef / latestQueueSlotsRef over
  // the captured dirty snapshot; user may have typed more while the request was
  // in flight) so the next flush chance retries with the freshest content.
  //
  // Bounty message-queue-in-pretty-view: flushDirty now includes queueSlots
  // alongside body in every PUT. If either is dirty, both are included so the
  // server receives a consistent snapshot.
  const flushDirty = useCallback(async () => {
    if (dirtyBodyRef.current === null && dirtyQueueSlotsRef.current === null) return;
    const body = dirtyBodyRef.current ?? latestBodyRef.current;
    const slots = dirtyQueueSlotsRef.current ?? latestQueueSlotsRef.current;
    dirtyBodyRef.current = null;
    dirtyQueueSlotsRef.current = null;
    // Patch #119 — draft-loss belt-and-suspenders diagnostic. One
    // console.warn per attempted server save so the next post-restart
    // repro reveals whether the server-side save fired at all.
    console.warn(`[compose] draft-save hostId=${hostId} tmuxSession=${tmuxSessionKey ?? "null"} bodyLen=${body.length} slotsLen=${slots.length}`);
    try {
      await putComposeDraft(hostId, tmuxSessionKey, body, slots);
      // Patch #119 — mirror the confirmed-saved body+queueSlots to localStorage
      // so ls stays in sync with the server after every successful autosave.
      // Extended payload: {body, queueSlots} (was bare body string pre-bounty).
      try {
        localStorage.setItem(
          composeDraftLsKey(hostId, tmuxSessionKey),
          JSON.stringify({ body, queueSlots: slots }),
        );
      } catch {
        // localStorage can throw on quota / private browsing — non-fatal.
      }
    } catch {
      // Re-queue latest — prefer newer edits over the snapshot we just
      // tried to send. No error UI (COMPOSE-04 HARD LOCK).
      const latestBody = latestBodyRef.current;
      const latestSlots = latestQueueSlotsRef.current;
      dirtyBodyRef.current = latestBody;
      dirtyQueueSlotsRef.current = latestSlots;
    }
  }, [hostId, tmuxSessionKey]);

  const scheduleAutosave = useCallback(
    (nextBody: string, nextSlots?: Array<{ id: string; text: string }>) => {
      dirtyBodyRef.current = nextBody;
      // Bounty message-queue-in-pretty-view: also mark queueSlots dirty
      // when provided; use latest ref snapshot when not provided.
      dirtyQueueSlotsRef.current = nextSlots ?? latestQueueSlotsRef.current;
      // Patch #119 — draft-loss belt-and-suspenders: mirror every
      // keystroke to localStorage as extended {body, queueSlots} payload
      // so the draft survives any server-side failure mode.
      // Legacy-string fallback comment: pre-bounty LS entries stored body
      // as a bare string; hydrate logic below handles that format.
      try {
        localStorage.setItem(
          composeDraftLsKey(hostId, tmuxSessionKey),
          JSON.stringify({ body: nextBody, queueSlots: dirtyQueueSlotsRef.current }),
        );
      } catch {}
      clearDebounce();
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        void flushDirty();
      }, DEBOUNCE_MS);
    },
    [clearDebounce, flushDirty, hostId, tmuxSessionKey],
  );

  // Load-on-mount: seed text + queueSlots state from the persisted draft for
  // this (hostId, tmuxSession). On a key change (host or session switches),
  // flush the previous key's dirty body via keepalive BEFORE loading the new
  // key — otherwise a mid-typing switch would silently drop the draft.
  // Any load error silently keeps the empty seed.
  //
  // Bounty message-queue-in-pretty-view: hydrate queueSlots from server seed.
  // localStorage payload extended to {body, queueSlots}; legacy entries that
  // stored bare body strings are handled via a JSON.parse try/catch fallback.
  useEffect(() => {
    let cancelled = false;

    // Reset per-key local state.
    setText("");
    setQueueSlots([]);
    clearDebounce();
    dirtyBodyRef.current = null;
    dirtyQueueSlotsRef.current = null;
    latestBodyRef.current = "";
    latestQueueSlotsRef.current = [];

    getComposeDraft(hostId, tmuxSessionKey)
      .then((data) => {
        if (cancelled) return;
        const seed = data.body ?? "";
        const seedSlots: Array<{ id: string; text: string }> = data.queueSlots ?? [];

        // Patch #119 — draft-loss belt-and-suspenders hydrate. Cross-
        // check localStorage against the server seed for BOTH body AND
        // queueSlots. LS payload is now {body, queueSlots}; legacy bare-
        // string entries (pre-bounty) are handled by the fallback below.
        let lsRaw: string | null = null;
        try {
          lsRaw = localStorage.getItem(composeDraftLsKey(hostId, tmuxSessionKey));
        } catch {
          lsRaw = null;
        }

        let lsBody: string = "";
        let lsSlots: Array<{ id: string; text: string }> = [];
        if (lsRaw && lsRaw.length > 0) {
          try {
            const parsed = JSON.parse(lsRaw);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              // Extended {body, queueSlots} payload
              lsBody = typeof parsed.body === "string" ? parsed.body : "";
              lsSlots = Array.isArray(parsed.queueSlots) ? parsed.queueSlots : [];
            } else {
              // Not an object — treat as invalid
              lsBody = "";
              lsSlots = [];
            }
          } catch {
            // Legacy-string fallback: pre-bounty LS entries stored body as
            // a bare JSON string or plain string. Treat as body, queueSlots=[].
            lsBody = lsRaw;
            lsSlots = [];
          }
        }

        // Determine hydrated values: server non-empty wins; otherwise use LS.
        const serverHasBody = seed !== "";
        const serverHasSlots = seedSlots.length > 0;
        const lsHasBody = lsBody.length > 0;
        const lsHasSlots = lsSlots.length > 0;

        let hydratedBody = seed;
        let hydratedSlots = seedSlots;

        if (!serverHasBody && !serverHasSlots && (lsHasBody || lsHasSlots)) {
          // Server empty + LS has content → restore from LS and schedule autosave.
          hydratedBody = lsBody;
          hydratedSlots = lsSlots;
        } else if (serverHasBody || serverHasSlots) {
          // Server has content → mirror to LS so it stays fresh.
          try {
            localStorage.setItem(
              composeDraftLsKey(hostId, tmuxSessionKey),
              JSON.stringify({ body: seed, queueSlots: seedSlots }),
            );
          } catch {}
        }

        console.warn(`[compose] draft-load hostId=${hostId} tmuxSession=${tmuxSessionKey ?? "null"} serverBodyLen=${seed.length} serverSlotsLen=${seedSlots.length} lsBodyLen=${lsBody.length} lsSlotsLen=${lsSlots.length}`);

        setText(hydratedBody);
        setQueueSlots(hydratedSlots);
        latestBodyRef.current = hydratedBody;
        latestQueueSlotsRef.current = hydratedSlots;

        // If we restored from LS, kick off an autosave so the server catches up.
        if (!serverHasBody && !serverHasSlots && (lsHasBody || lsHasSlots)) {
          scheduleAutosave(hydratedBody, hydratedSlots);
        }
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
    // those effects, flushing any dirty state under the OLD key.
    return () => {
      cancelled = true;
      if (dirtyBodyRef.current !== null || dirtyQueueSlotsRef.current !== null) {
        flushComposeDraftKeepalive(
          hostId,
          tmuxSessionKey,
          dirtyBodyRef.current ?? latestBodyRef.current,
          dirtyQueueSlotsRef.current ?? latestQueueSlotsRef.current,
        );
        dirtyBodyRef.current = null;
        dirtyQueueSlotsRef.current = null;
      }
      clearDebounce();
    };
  }, [hostId, tmuxSessionKey, clearDebounce, scheduleAutosave]);

  // pagehide + visibilitychange keepalive flush. Fires only when there's
  // a dirty body or queueSlots pending — idle panes cost zero unload-time bandwidth.
  // Bounty message-queue-in-pretty-view: queueSlots included in the keepalive
  // payload alongside body.
  useEffect(() => {
    const onPageHide = () => {
      if (dirtyBodyRef.current !== null || dirtyQueueSlotsRef.current !== null) {
        flushComposeDraftKeepalive(
          hostId,
          tmuxSessionKey,
          dirtyBodyRef.current ?? latestBodyRef.current,
          dirtyQueueSlotsRef.current ?? latestQueueSlotsRef.current,
        );
        dirtyBodyRef.current = null;
        dirtyQueueSlotsRef.current = null;
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
  // dirtyBodyRef / dirtyQueueSlotsRef with no pending timer; without this
  // interval, the only recovery paths are another keystroke or unload.
  // Bounty message-queue-in-pretty-view: check both dirty flags so
  // queueSlots mutations trigger the retry path too.
  useEffect(() => {
    const interval = setInterval(() => {
      if (dirtyBodyRef.current !== null || dirtyQueueSlotsRef.current !== null) {
        void flushDirty();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [flushDirty]);

  // Auto-focus on mount so Ashley can start typing immediately after
  // flipping to pretty mode (COMPOSE-01 ergonomic requirement).
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Phase 31 D-02: log aside-morph transitions (false→true and true→false).
  // asideActive is a prop, so we use useEffect + ref to detect edges.
  const prevAsideActiveRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const prev = prevAsideActiveRef.current;
    const next = asideActive ?? false;
    if (prev !== undefined && prev !== next) {
      console.info(`[compose] aside-morph edge=${prev}→${next} hostId=${hostId} tmuxSession=${tmuxSession ?? "null"}`);
    }
    prevAsideActiveRef.current = next;
  }, [asideActive, hostId, tmuxSession]);

  // PATCH #338 DIAG (TEMPORARY): textarea-tap-coordinate-mismatch-ios-diag.
  // Ashley reports 3 correlated iOS PWA symptoms: (a) bottom 2 of 5 lines
  // dismiss the keyboard on tap-to-reposition, (b) cursor lands INSIDE a
  // letter on multi-line, (c) single-line ignores tap-to-reposition but
  // keeps the keyboard open. All point to a coordinate-system mismatch
  // between iOS's tap-to-caret math and the textarea's actual rendered
  // box. Passive listeners only — NO preventDefault, NO state writes.
  // Logs go through the console-forwarder (patch #146) → durable path at
  // /opt/skynet/console-forward-logs/console-forward.log (patch #326).
  // Revert after Ashley reproduces + we have data on the actual offset.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const snap = () => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const vv = typeof window !== "undefined" ? window.visualViewport : null;
      return {
        rect: { t: Math.round(r.top), l: Math.round(r.left), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) },
        styleH: el.style.height,
        compH: cs.height,
        scrollH: el.scrollHeight,
        lh: cs.lineHeight,
        fs: cs.fontSize,
        pt: cs.paddingTop,
        pb: cs.paddingBottom,
        lines: (el.value.match(/\n/g)?.length ?? 0) + 1,
        textLen: el.value.length,
        sel: [el.selectionStart, el.selectionEnd],
        vv: vv ? { w: Math.round(vv.width), h: Math.round(vv.height), ot: Math.round(vv.offsetTop), ol: Math.round(vv.offsetLeft), pt: Math.round(vv.pageTop), pl: Math.round(vv.pageLeft), scale: vv.scale } : null,
        scrollY: Math.round(window.scrollY),
        docFocus: document.activeElement === el,
      };
    };
    const onPointerDown = (e: PointerEvent) => {
      const targetTag = (e.target as Element | null)?.tagName ?? "?";
      const s = snap();
      // Phase 31 D-13: tap-diag prefix renamed to [tap], flattened key=value shape per D-11.
      // D-17: dedup opt-in — tap events fire frequently on scroll/pointer flicker.
      const pdKey = `tap:pointerdown:${e.pointerType}:${targetTag}`;
      // eslint-disable-next-line no-console
      if (tapDedup.shouldEmit(pdKey, () => `[tap] pointerdown x=${Math.round(e.clientX)} y=${Math.round(e.clientY)} pointerType=${e.pointerType} targetTag=${targetTag} selfTarget=${e.target === el} rectT=${s.rect.t} rectL=${s.rect.l} rectW=${s.rect.w} rectH=${s.rect.h} textLen=${s.textLen} scrollY=${s.scrollY}`).emit) {
        console.log(`[tap] pointerdown x=${Math.round(e.clientX)} y=${Math.round(e.clientY)} pointerType=${e.pointerType} targetTag=${targetTag} selfTarget=${e.target === el} rectT=${s.rect.t} rectL=${s.rect.l} rectW=${s.rect.w} rectH=${s.rect.h} textLen=${s.textLen} scrollY=${s.scrollY}`);
      }
      setTimeout(() => {
        const s30 = snap();
        const p30Key = `tap:post-30ms:${e.pointerType}`;
        // eslint-disable-next-line no-console
        if (tapDedup.shouldEmit(p30Key, () => `[tap] post-30ms pointerType=${e.pointerType} rectT=${s30.rect.t} rectH=${s30.rect.h} scrollH=${s30.scrollH} sel=${s30.sel[0]},${s30.sel[1]} docFocus=${s30.docFocus}`).emit) {
          console.log(`[tap] post-30ms pointerType=${e.pointerType} rectT=${s30.rect.t} rectH=${s30.rect.h} scrollH=${s30.scrollH} sel=${s30.sel[0]},${s30.sel[1]} docFocus=${s30.docFocus}`);
        }
      }, 30);
      setTimeout(() => {
        const s300 = snap();
        const p300Key = `tap:post-300ms:${e.pointerType}`;
        // eslint-disable-next-line no-console
        if (tapDedup.shouldEmit(p300Key, () => `[tap] post-300ms pointerType=${e.pointerType} rectT=${s300.rect.t} rectH=${s300.rect.h} scrollH=${s300.scrollH} sel=${s300.sel[0]},${s300.sel[1]} docFocus=${s300.docFocus}`).emit) {
          console.log(`[tap] post-300ms pointerType=${e.pointerType} rectT=${s300.rect.t} rectH=${s300.rect.h} scrollH=${s300.scrollH} sel=${s300.sel[0]},${s300.sel[1]} docFocus=${s300.docFocus}`);
        }
      }, 300);
    };
    const onFocus = () => {
      const s = snap();
      const focusKey = "tap:focus";
      // eslint-disable-next-line no-console
      if (tapDedup.shouldEmit(focusKey, () => `[tap] focus rectT=${s.rect.t} rectH=${s.rect.h} textLen=${s.textLen} sel=${s.sel[0]},${s.sel[1]}`).emit) {
        console.log(`[tap] focus rectT=${s.rect.t} rectH=${s.rect.h} textLen=${s.textLen} sel=${s.sel[0]},${s.sel[1]}`);
      }
    };
    const onBlur = () => {
      const s = snap();
      const blurKey = "tap:blur";
      // eslint-disable-next-line no-console
      if (tapDedup.shouldEmit(blurKey, () => `[tap] blur rectT=${s.rect.t} rectH=${s.rect.h} textLen=${s.textLen} sel=${s.sel[0]},${s.sel[1]}`).emit) {
        console.log(`[tap] blur rectT=${s.rect.t} rectH=${s.rect.h} textLen=${s.textLen} sel=${s.sel[0]},${s.sel[1]}`);
      }
    };
    const onSelChange = () => {
      if (document.activeElement !== el) return;
      const selKey = `tap:selchange:${el.selectionStart},${el.selectionEnd}`;
      // eslint-disable-next-line no-console
      if (tapDedup.shouldEmit(selKey, () => `[tap] selchange sel=${el.selectionStart},${el.selectionEnd}`).emit) {
        console.log(`[tap] selchange sel=${el.selectionStart},${el.selectionEnd}`);
      }
    };
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("focus", onFocus);
    el.addEventListener("blur", onBlur);
    document.addEventListener("selectionchange", onSelChange);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("focus", onFocus);
      el.removeEventListener("blur", onBlur);
      document.removeEventListener("selectionchange", onSelChange);
    };
  }, []);

  // Patch #83: how many meter-well segments should be lit right now.
  // Null contextPct → 0 (well mounts all-dim so the row geometry is
  // stable, and role="meter"'s aria-valuenow stays undefined so
  // assistive tech reports "unknown" rather than "0%").
  const litCount =
    contextPct != null ? Math.round((contextPct / 100) * SEG_COUNT) : 0;

  // Clear body local state and persisted body draft after a successful primary send.
  // Best-effort: the PUT is fire-and-forget; the 10s retry loop will recover if
  // it fails. latestBodyRef is updated so any interval tick between now and the
  // next render sees the empty body.
  //
  // Bounty message-queue-in-pretty-view: DO NOT clear queueSlots here — queue-slot
  // sends clear THAT slot individually (see handleQueueSlotSend). The autosave
  // then persists the updated queueSlots. The LS entry is also preserved (not
  // removed) so queueSlots survive primary-send + page reload.
  const clearAfterSend = useCallback(() => {
    clearDebounce();
    dirtyBodyRef.current = null;
    latestBodyRef.current = "";
    // Patch #119 — persist cleared body alongside existing queueSlots.
    // Update LS to reflect the cleared body while preserving queueSlots.
    const currentSlots = latestQueueSlotsRef.current;
    try {
      localStorage.setItem(
        composeDraftLsKey(hostId, tmuxSessionKey),
        JSON.stringify({ body: "", queueSlots: currentSlots }),
      );
    } catch {}
    putComposeDraft(hostId, tmuxSessionKey, "", currentSlots).catch(() => {
      // Best-effort; on failure the next flushDirty tick will re-try
      // once the user types again OR the next 10s tick fires.
    });
  }, [clearDebounce, hostId, tmuxSessionKey]);

  // Vehicle C v2 (2026-08-01): dispatch queue[0] (head-of-FIFO) when the
  // idle watchdog fires. Only ONE entry per idle event — sequential cadence
  // across N armed textareas emerges from the session cycling working→idle
  // between dispatches. D-50 Ink safety: collapse newlines to spaces before
  // send, matching handleSend. Fail-loud on dispatch failure per Ashley
  // 2026-07-19 (do NOT retry silently). Source-specific cleanup on success:
  // primary → clear text + clearAfterSend(); slot → drop slot from
  // queueSlots + scheduleAutosave. useCallback is REQUIRED — the watchdog
  // effect keeps a ref via its dependency array; a bare function decl would
  // capture a stale `queue` between arm and timer fire.
  const fireNextQueued = useCallback(() => {
    if (queue.length === 0) return;
    const head = queue[0];
    const payload = collapseNewlinesForSend(head.text);
    const dispatched = onSend(payload);
    if (dispatched) {
      setQueue((prev) => prev.filter((_, i) => i !== 0));
      if (head.source === "primary") {
        setText("");
        clearAfterSend();
      } else {
        const slotId = head.source;
        const nextSlots = latestQueueSlotsRef.current.filter((s) => s.id !== slotId);
        setQueueSlots(nextSlots);
        scheduleAutosave(latestBodyRef.current, nextSlots);
      }
    } else {
      setQueue((prev) => prev.filter((_, i) => i !== 0));
      setErrorMessage("Not connected — queued send failed");
    }
  }, [queue, onSend, clearAfterSend]);

  // Vehicle C v2 (2026-08-01): FIFO-aware idle watchdog. Gate on
  // `queue.length === 0` (no armed sources → nothing to fire). Strict
  // `isIdle !== true` — `null` (unknown / backend hasn't spoken) does NOT
  // trigger, matching the ergonomic contract that the queue only fires when
  // we KNOW the session went idle. Combined with the backend's ~4s isIdle
  // debounce this yields ~7s effective delay from Claude's last output.
  // 3s idle threshold preserved from patch #84 (Ashley 2026-07-19 lock).
  // fireNextQueued() dispatches ONE head entry per firing — the session's
  // subsequent working→idle cycle re-runs this effect to fire the next.
  useEffect(() => {
    if (queue.length === 0) return;
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
      fireNextQueued();
    }, 3000);
    return () => {
      if (dispatchTimerRef.current) {
        clearTimeout(dispatchTimerRef.current);
        dispatchTimerRef.current = null;
      }
    };
  }, [queue, isIdle, fireNextQueued]);

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

  // ─── session-queue-pending-store publishers (quick-260802-w9e) ─────────────
  // These two effects publish to `session-queue-pending-store` so
  // PrettyConversationRow can suppress its patch #137 ready-dot when this
  // ComposeBox has any armed idle-send messages. Extends the dot predicate at
  // PrettyConversationRow.tsx:507 with the fourth gate `!hasQueuePending`.
  // Closes pinned bounty `hide-idle-dot-when-queued-message-waiting-to-send`.
  //
  // Key shape (`${hostId}:${tmuxSession ?? ""}`) mirrors sessionWorkingKey()
  // at PrettyConversationsPanel.tsx:95-98 verbatim so both stores share the
  // same lookup string.
  //
  // We publish `queue` (the armed-for-idle FIFO at line 358) — NOT
  // `queueSlots` (visual textareas; not all are armed for idle-send). The
  // bounty targets Ashley's exact ask: "if a queued message is armed to
  // auto-send the moment the agent goes idle."
  //
  // Two separate effects:
  //   (a) publish effect: deps `[queue, sessionKey]` — fires on every queue
  //       mutation. The store's own no-op notify guard dedupes redundant
  //       publishes (e.g. re-renders that don't change queue.length > 0's
  //       boolean value).
  //   (b) cleanup effect: deps `[sessionKey]` — fires the cleanup on unmount
  //       AND on sessionKey changes (host/tmux switch). Kept separate from
  //       the publish effect so unmount cleanup fires exactly ONCE with the
  //       final state, not per-mutation.
  useEffect(() => {
    if (sessionKey === null) return;
    publishSessionQueuePending(sessionKey, queue.length > 0);
  }, [queue, sessionKey]);

  useEffect(() => {
    if (sessionKey === null) return;
    return () => {
      publishSessionQueuePending(sessionKey, false);
    };
  }, [sessionKey]);

  // Patch #135: auto-grow the textarea with its CONTENTS (not just newlines).
  // The prior newline-count `rows` heuristic left long single-line messages
  // clipped because wrapped visual lines never added a \n. We set height
  // imperatively from scrollHeight, capped at 6 line-heights, with overflow-y
  // switching to 'auto' only at the cap so a scrollbar appears there.
  // Setting height='auto' first is REQUIRED — without it, scrollHeight only
  // grows (never shrinks) as text is deleted.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (maxHeightPxRef.current === null) {
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      maxHeightPxRef.current = Number.isFinite(lh) && lh > 0 ? lh * 6 : 144;
    }
    el.style.height = "auto";
    const clamped = Math.min(el.scrollHeight, maxHeightPxRef.current);
    el.style.height = clamped + "px";
    el.style.overflowY = clamped >= maxHeightPxRef.current ? "auto" : "hidden";
  }, [text, chipStripHeight]);

  // Quick 260802-wxy: measure the overlaid chip strip's rendered height so
  // the textarea's paddingTop can grow to accommodate it (chips wrap, so the
  // height is content-dependent — a static padding value would clip long
  // filename lists). AttachmentChipStrip returns null when the list is
  // empty, so chipStripRef.current transitions null↔element as the user
  // stages/unstages files; we key the effect on stagedAttachments.length so
  // the observer is (re)attached when the strip mounts and torn down when
  // it unmounts.
  const stagedAttachmentsCount = stagedAttachments?.length ?? 0;
  useLayoutEffect(() => {
    const el = chipStripRef.current;
    if (!el) {
      // Strip not mounted (empty state) — reset padding to zero so the
      // textarea reverts to its base `py-3` inline-style-free height.
      setChipStripHeight(0);
      return;
    }
    // Prime with an immediate measurement so the first paint carries
    // paddingTop; ResizeObserver will only fire on subsequent size
    // changes (chip add/remove, viewport width changes that trigger
    // wrap).
    setChipStripHeight(Math.ceil(el.getBoundingClientRect().height));
    // JSDOM does not implement ResizeObserver — guard so tests don't crash.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const h = entry.contentRect?.height ?? 0;
      setChipStripHeight(Math.ceil(h));
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [stagedAttachmentsCount]);

  function handleTextChange(next: string) {
    setText(next);
    scheduleAutosave(next, latestQueueSlotsRef.current);
  }

  function handleBlur() {
    clearDebounce();
    void flushDirty();
  }

  // Vehicle C v2 (2026-08-01): the aux-row Queue (Hourglass) button and
  // its handleQueue click handler were retired. Arm-idle is now per-
  // textarea via `armSourceForIdle(source, text)` (see the state block
  // above); each textarea has its own Arm button and click-to-cancel
  // overlay. See the primary/queueSlot render blocks below for wiring.

  // D-50 policy helper: collapse newlines to spaces on send. Ink safety.
  // Extracted from handleSend so queue-slot sends reuse the same logic.
  function collapseNewlinesForSend(s: string): string {
    return s.replace(/\r?\n/g, " ");
  }

  // Bounty message-queue-in-pretty-view: per-slot send handler.
  // Routes through the same onSend(text) prop the primary uses:
  // - D-50 newline collapse applied
  // - COMPOSE-04 hard-lock: no optimistic bubble (same as primary)
  // - On success: remove slot from state + trigger autosave
  // - On failure: keep slot + surface errorMessage (mirrors primary handleSend)
  function handleQueueSlotSend(slotId: string) {
    // Vehicle C v2: source-scoped cancel — send-on-X dequeues X only;
    // other armed sources persist through the cadence.
    if (isSourceArmed(slotId)) {
      cancelSourceArmed(slotId);
    }

    const slot = queueSlots.find((s) => s.id === slotId);
    if (!slot) return;
    const trimmed = slot.text.trim();
    if (!trimmed) return;

    setErrorMessage(null);

    const payload = collapseNewlinesForSend(trimmed);
    const dispatched = onSend(payload);
    if (dispatched) {
      const nextSlots = queueSlots.filter((s) => s.id !== slotId);
      setQueueSlots(nextSlots);
      // Persist the updated slots immediately via scheduleAutosave.
      scheduleAutosave(latestBodyRef.current, nextSlots);
    } else {
      setErrorMessage("Not connected — try again in a moment");
      // Keep the slot — same as primary handleSend's COMPOSE-04 posture.
    }
  }

  // overridePayload: Phase 16 D-16-05 — voice.endSend passes the glued
  // transcript here so it reaches the send path synchronously, bypassing
  // React's async setState batching on text. When present it is used in place
  // of the current `text` state. All other handleSend logic (attachment
  // branching, D-50 newline collapse, COMPOSE-04 hard-lock) still applies.
  function handleSend(overridePayload?: string, trigger: "enter-key" | "send-button" | "queue-item" | "unknown" = "unknown") {
    // Vehicle C v2: source-scoped cancel — send on primary dequeues
    // primary only; other armed sources persist through the cadence.
    if (isSourceArmed("primary")) {
      cancelSourceArmed("primary");
    }

    // D-16-05: use override payload if provided (voice send path), otherwise
    // derive from current text state (normal typed-send path).
    const trimmed = overridePayload !== undefined ? overridePayload.trim() : text.trim();

    // Phase 05 — attachment path: Send routes to onSendWithAttachments
    // whenever at least one attachment is staged. Empty caption is
    // permitted (UPLOAD-13); the caption we pass is `trimmed` (may be
    // empty string). The parent hook owns the batch lifecycle from
    // here; it does NOT return a boolean the way onSend does, so we
    // clear the textarea unconditionally on the attachment path.
    // Note: draft persistence still uses caption = the empty string
    // after clearing, which is exactly the desired behavior — patch
    // #57 draft goes to '' on any send, attachment or not.
    if (hasAttachments && onSendWithAttachments) {
      setErrorMessage(null);
      const captionPayload = collapseNewlinesForSend(trimmed);
      // Phase 31 D-02: compose submit instrumentation — attachment path.
      console.info(`[compose] submit-entry hostId=${hostId} tmuxSession=${tmuxSession ?? "null"} bodyLen=${trimmed.length} attachmentCount=${stagedAttachments?.length ?? 0} trigger=${trigger}`);
      onSendWithAttachments(captionPayload);
      console.info(`[compose] submit-success hostId=${hostId} tmuxSession=${tmuxSession ?? "null"} bodyLen=${trimmed.length}`);
      setText("");
      clearAfterSend();
      return;
    }

    if (!trimmed) return;

    setErrorMessage(null); // clear any prior error

    // D-50 policy: collapse newlines to spaces on send. Ink safety.
    const payload = collapseNewlinesForSend(trimmed);

    // Phase 31 D-02: compose submit instrumentation — normal send path.
    console.info(`[compose] submit-entry hostId=${hostId} tmuxSession=${tmuxSession ?? "null"} bodyLen=${payload.length} attachmentCount=0 trigger=${trigger}`);
    const dispatched = onSend(payload);
    if (dispatched) {
      console.info(`[compose] submit-success hostId=${hostId} tmuxSession=${tmuxSession ?? "null"} bodyLen=${payload.length}`);
      setText(""); // clear compose textarea on success
      clearAfterSend();
      // COMPOSE-04 HARD LOCK: do NOT emit any local optimistic bubble.
      // The message will render in the conversation when the
      // session-file tail confirms it (Phase 1 WS bridge).
    } else {
      console.warn(`[compose] submit-failed hostId=${hostId} tmuxSession=${tmuxSession ?? "null"} bodyLen=${payload.length} err="not-connected"`);
      setErrorMessage("Not connected — try again in a moment");
      // COMPOSE-04 + D-56: do NOT clear text; user may want to retry.
      // Do NOT clear the persisted draft either — failed send should
      // leave the composition intact server-side too.
    }
  }

  // Phase 16: voice handler callbacks — wired to RecordingControls's onCancel /
  // onAppend / onSend props. Each delegates to voice.* and handles the result.

  function handleVoiceCancel() {
    // Drop the audio clip and return to idle — no textarea change, no fetch.
    // Reset micTarget to "primary" so the next tap is clean.
    setMicTarget("primary");
    void voice.cancel();
  }

  // Voice handlers are target-aware (bounty message-queue-in-pretty-view).
  // target === "primary" → existing behavior; target === slotId → route to slot.

  async function handleVoiceAppend(target: "primary" | string = "primary") {
    // Stop recording, transcribe, append the result to the correct target.
    const baseText = target === "primary"
      ? text
      : (queueSlots.find((s) => s.id === target)?.text ?? "");
    const result = await voice.endAppend(baseText);
    if (result) {
      if (target === "primary") {
        setText(result.glued);
        scheduleAutosave(result.glued, latestQueueSlotsRef.current);
      } else {
        setQueueSlots((prev) =>
          prev.map((s) => s.id === target ? { ...s, text: result.glued } : s),
        );
        // Mark slots dirty so autosave picks up the change.
        const nextSlots = latestQueueSlotsRef.current.map((s) =>
          s.id === target ? { ...s, text: result.glued } : s,
        );
        scheduleAutosave(latestBodyRef.current, nextSlots);
      }
    }
    // On null result: voice.errorMessage is set by the hook; no change.
  }

  async function handleVoiceSend(target: "primary" | string = "primary") {
    // Stop recording, transcribe, then send through the appropriate send path.
    const baseText = target === "primary"
      ? text
      : (queueSlots.find((s) => s.id === target)?.text ?? "");
    const result = await voice.endSend(baseText);
    if (result) {
      if (target === "primary") {
        setText(result.glued);
        scheduleAutosave(result.glued, latestQueueSlotsRef.current);
        // Bounty mic-available-when-composebox-disabled (quick 260731-ulo): during recycle, land transcript in textarea but skip auto-send — Ashley sends manually once the overlay clears.
        // Phase 24: same treatment during plan-mode pending — text lands, no auto-send.
        // Reconnect window: same treatment — text lands, no auto-send while WS is between sockets.
        // quick 260808-cd6: same treatment during dormant/waking — text lands, no auto-send.
        if (!recycleActive && !planPendingActive && !reconnectingActive && !dormantActive) {
          // D-16-05: route through the SAME handleSend — attachment branching,
          // D-50 newline collapse, COMPOSE-04 hard-lock all still apply.
          handleSend(result.glued, "queue-item");
        }
      } else {
        // For a queue slot: update slot text then send it.
        setQueueSlots((prev) =>
          prev.map((s) => s.id === target ? { ...s, text: result.glued } : s),
        );
        // Bounty mic-available-when-composebox-disabled (quick 260731-ulo): during recycle,
        // text lands in slot, no dispatch, slot not removed — Ashley sends manually once overlay clears.
        // Phase 24: same treatment during plan-mode pending — text lands in slot, no dispatch.
        // Reconnect window: same treatment — text lands in slot, no dispatch while WS is between sockets.
        // quick 260808-cd6: same treatment during dormant/waking — text lands in slot, no dispatch.
        if (!recycleActive && !planPendingActive && !reconnectingActive && !dormantActive) {
          // handleQueueSlotSend reads from queueSlots state, but due to async
          // batching we pass the glued text directly via onSend to avoid stale reads.
          const payload = collapseNewlinesForSend(result.glued.trim());
          if (payload) {
            const dispatched = onSend(payload);
            if (dispatched) {
              const nextSlots = latestQueueSlotsRef.current.filter((s) => s.id !== target);
              setQueueSlots(nextSlots);
              scheduleAutosave(latestBodyRef.current, nextSlots);
            } else {
              setErrorMessage("Not connected — try again in a moment");
            }
          }
        } else {
          // Mirror handleVoiceAppend's slot-only write pattern: text into the slot,
          // scheduleAutosave with the updated slots, slot preserved.
          const nextSlots = latestQueueSlotsRef.current.map((s) =>
            s.id === target ? { ...s, text: result.glued } : s,
          );
          scheduleAutosave(latestBodyRef.current, nextSlots);
        }
      }
    }
    setMicTarget("primary");
    // On null result: voice.errorMessage is set by the hook; no send.
  }

  // beginRecord(target): sets micTarget then calls voice.start({ autoCommit: true }) synchronously.
  // NO await before voice.start() — D-16-02 iOS Safari constraint.
  // setMicTarget is a synchronous React setState (no microtask boundary), safe
  // to precede voice.start().
  //
  // autoCommit:true preserves mic-tap UX parity: the .then() callback transitions
  // directly to state="recording" and plays start.mp3 without requiring an external
  // commitStartVisibility() call. The hold-to-record path (useHoldToRecord) uses
  // voice.start() WITHOUT autoCommit (default false), deferring the state transition
  // and audio cue until the 250ms threshold-timer fires and calls commitStartVisibility().
  function beginRecord(target: "primary" | string) {
    setMicTarget(target);
    voice.start({ autoCommit: true });
  }

  // Reset-send: mirrors handleSend (clears textarea on success, surfaces
  // inline error on failure) except (a) it wraps the trimmed body in
  // parentheses appended to "/id reset " so the reset carries a hint
  // through to the fresh session, and (b) it fires even when the body is
  // blank — in which case it sends just "/id reset".
  //
  // Quick 260803-7vf: split into fireResetSyncFx (synchronous UI effects)
  // + dispatchResetPayload (payload construction + dispatch tail) so
  // handleVoiceResetSend can compose them with an await in between —
  // syncFx runs BEFORE the STT round-trip (patch #122 latency guarantee),
  // dispatch runs AFTER the transcript resolves so the glued payload
  // reaches onSend.

  // Synchronous UI effects — MUST run BEFORE any await in the recording
  // branch (patch #122 latency guarantee: SessionHoldingOverlay pops on
  // click, not after the ~1-3s STT round-trip).
  function fireResetSyncFx() {
    // Patch #122: fire the PrettyView `isHolding` signal synchronously so
    // `SessionHoldingOverlay`'s 350ms delay-arm timer starts NOW, not when
    // the backend's `session_holding` WS frame arrives (~seconds later).
    // The `/id reset` payload still routes through the normal `onSend`
    // path in dispatchResetPayload below — this is purely a UI-latency
    // shortcut.
    onResetClicked?.();

    // Vehicle C v2: source-scoped cancel — reset dequeues primary only
    // (reset acts on the primary textarea's context). Other armed
    // sources persist through the cadence.
    if (isSourceArmed("primary")) {
      cancelSourceArmed("primary");
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
  }

  // Payload construction + dispatch tail. Body is the raw textarea/glued
  // string; trim + collapse mirror the pre-refactor behavior exactly.
  function dispatchResetPayload(body: string) {
    const trimmed = body.trim();
    const payload = trimmed
      ? `/id reset (${collapseNewlinesForSend(trimmed)})`
      : "/id reset";
    const dispatched = onSend(payload);
    if (dispatched) {
      setText("");
      clearAfterSend();
    } else {
      setErrorMessage("Not connected — try again in a moment");
    }
  }

  function handleResetSend() {
    fireResetSyncFx();
    dispatchResetPayload(text);
  }

  // Quick 260803-7vf: recording-state reset — combines send-while-recording
  // (stop → transcribe → glue) with reset dispatch. fireResetSyncFx runs
  // FIRST (before any await) so onResetClicked/drain-sweep don't wait on
  // the STT round-trip. Then await endSend, then dispatch the glued
  // payload. On STT failure (endSend returns null) we fall back to the
  // existing textarea body — reset ALWAYS dispatches, never silent no-op
  // (locked design decision #4).
  async function handleVoiceResetSend() {
    fireResetSyncFx();
    const baseText = text;
    const result = await voice.endSend(baseText);
    const body = result ? result.glued : baseText;
    dispatchResetPayload(body);
  }

  // Router: branch on voice.state so the meter-well reset button does the
  // right thing in either idle or recording state. Wired into the reset
  // button's onClick below.
  function handleResetClick() {
    if (voice.state === "recording") {
      void handleVoiceResetSend();
    } else {
      handleResetSend();
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
    // Vehicle C v2: quick-reply (thumbs-up, recap) is textarea-independent —
    // it does NOT touch the per-source queue. Armed sources persist across
    // quick-replies so Ashley can fire a canned reply without losing any
    // arm-idle state on the primary or queueSlots.

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
    // Patch #313: skip re-focus on touch devices — .focus() on a textarea
    // pops the on-screen keyboard, which is exactly what Ashley doesn't
    // want after tapping ThumbsUp/Recap (quick-replies are meant to fire
    // WITHOUT dragging the user into text composition). Desktop keeps the
    // re-focus so a mouse click doesn't lose the caret from an in-progress
    // draft.
    if (isTouchDevice !== true) textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Vehicle C v2: while primary is armed the textarea is disabled
    // (`disabled={primaryArmed}` on the primary Textarea below), so
    // keydown normally cannot reach us. Defense in depth against any
    // focus-restoration race — swallow all keys silently while the
    // primary source is armed. Slot arm state is orthogonal and does
    // NOT gate the primary textarea's key handling.
    if (isSourceArmed("primary")) return;
    // Quick 260729-j8l: during session recycle the Send button is
    // disabled (via sendDisabled below) but the textarea stays typeable
    // so Ashley can pre-draft the next message. Swallow the Enter-send
    // path too so a bare Enter can't slip past the disabled button.
    // Phase 24: same treatment during plan-mode pending — textarea stays
    // typeable but Enter-send is swallowed.
    // Reconnect window: same treatment — Enter can't slip past disabled Send.
    if (recycleActive || planPendingActive || reconnectingActive || dormantActive) return;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault(); // suppress default newline insertion on plain Enter
      handleSend(undefined, "enter-key");
    }
    // Shift-Enter: do NOT preventDefault. Browser default inserts a newline,
    // which is exactly the COMPOSE-02 behavior.
    //
    // Do NOT stopPropagation on any event — the AppShell document-capture-
    // phase hooks (Ctrl+Shift+O, Ctrl+Shift+L, Ctrl+Shift+;) intercept
    // before this handler and MUST continue to work while the compose
    // textarea is focused.
  }

  // Vehicle C v2 (2026-08-01): the derived queueArmed / queueDisabled
  // block for the retired aux-row Queue (Hourglass) button was removed.
  // The `queueArmed` roll-up is declared once inside the per-source
  // state block above (const queueArmed = queue.length > 0) and is used
  // by the idle watchdog. Per-textarea gates use `isSourceArmed(source)`.

  // Vehicle C v2 (2026-08-01): send-button slot visibility gates. Mic and
  // arm-idle COEXIST — 260729-3y1 lock: mic stays reachable regardless of
  // textarea contents. Mic hides only while the PRIMARY source is armed
  // (the overlay covers the slot). Arm-idle button appears only when there
  // IS text to arm and the primary is not already armed.
  //
  // showMicButton: mic CO-RENDERS beside the send button when:
  //   - navigator.mediaDevices is available (browser supports getUserMedia;
  //     JSDOM guard so tests that don't mock mediaDevices still see Send)
  //   - primary is NOT the active mic target (other textareas may be
  //     recording/transcribing; mic stays visible on the primary but is
  //     disabled via the disabled prop so a second concurrent recording
  //     cannot start — Quick 260802-uow bounty 1)
  //   - aside-morph is NOT active (X-for-Resume owns the slot when true)
  //   - primary source is NOT armed (armed overlay covers the slot)
  //
  // showPrimaryArmButton: per-textarea arm-idle button appears at right-21
  // (one slot LEFT of Mic at right-11) when:
  //   - aside-morph is NOT active
  //   - primary is NOT already armed (would be redundant)
  //   - textarea has trimmed content to arm
  //   - recycle is NOT active (recycle disables all WS-side-effect actions)
  //   Quick 260802-uow bounty 1: voice.state is INTENTIONALLY not gated
  //   here — send-when-idle while recording on another textarea is a
  //   valid workflow (Ashley).
  //   Ashley 2026-08-10: dormantActive is INTENTIONALLY not gated here —
  //   arm-idle is pure client-state (armSourceForIdle just upserts the
  //   queue array; no WS touching) and the watchdog is already isIdle-gated
  //   so the message naturally sits until the woken pane's Claude reports
  //   idle, then fires. Sibling recycleActive/planPendingActive/
  //   reconnectingActive gates deliberately kept — Ashley scoped this ask
  //   to the waking case only (see bounty queue-send-when-idle-available-
  //   during-waking; the parallel recycle-case bounty stays open).
  //
  // showRecordingControls: while recording, the three-button controls own the slot.
  //   MicButton and send button are both hidden. Gated on isPrimaryRecording
  //   (voice.state === "recording" && micTarget === "primary") so a slot
  //   recording does not steal the primary's controls.
  //
  // showTranscribingSend: during the STT round-trip on THIS textarea, the
  //   existing send button renders disabled so rapid-tap cannot double-fire
  //   (T-16-16 mitigation). Quick 260802-uow bounty 2: also gated on
  //   micTarget === "primary" so a slot's transcribing spinner doesn't
  //   render on the primary send button.
  const primaryArmed = isSourceArmed("primary");
  const isPrimaryRecording = voice.state === "recording" && micTarget === "primary";
  const isPrimaryTranscribing = voice.state === "transcribing" && micTarget === "primary";
  const showTranscribingSend = isPrimaryTranscribing;

  // Patch #129: inside-textarea Send button disabled predicate. Locked with
  // Ashley 2026-07-23 (console-iterated visual). Vehicle C v2 (2026-08-01):
  // gate on `primaryArmed` (source-scoped) instead of `queueArmed` — Send
  // lives on the primary textarea, so a slot being armed must NOT disable
  // the primary Send. Truth table:
  //   - primaryArmed → disabled (button lives under the primary armed overlay
  //     but native disabled is belt-and-suspenders vs any pointer-events edge).
  //   - canSend === false && !hasAttachments → disabled (text-only send
  //     would fail with no transport; attachment path routes independently
  //     via onSendWithAttachments so it survives a canSend===false WS state).
  //     STRICT === false (not `!canSend`): canSend is optional and defaults
  //     to undefined at the read-only PrettyView call sites; treating undefined
  //     as "not sendable" would over-disable. Matches every other button in
  //     this file (see `disabled={canSend === false}` on the aux-row buttons).
  //   - text.trim() === "" && !hasAttachments → disabled (nothing to send).
  //
  // NOTE (Quick 260814-1hz): moved above `showMicButton` so it is in scope
  // for the primaryHold construction (which itself moved up so its
  // holdInitiatedRef can be read inside showMicButton).
  const sendDisabled =
    primaryArmed ||
    recycleActive === true ||
    planPendingActive === true ||
    reconnectingActive === true ||
    dormantActive === true ||
    (canSend === false && !hasAttachments) ||
    (text.trim() === "" && !hasAttachments);

  // Quick 260814-1hz: hold-to-record gesture MOVED from the primary send
  // button to the MicButton. The Send button gets its direct onClick back
  // (see below). The hook still lives here and the pointer handlers spread
  // onto MicButton at ~L2530.
  //
  // quick-260814-iwy update: onShortTap is now a NO-OP (was beginRecord).
  // The hook's short-tap-keep branch (keepRecordingOnShortTap: true) preserves
  // the pointerdown-started recording via voice.commitStartVisibility(),
  // which advances state "starting" → "recording" and plays start.mp3 (NOT
  // cancel.mp3). Fixes the iPhone "first mic tap plays cancel.mp3 + requires
  // double-tap" regression. voice.state !== "idle" guard inside the hook
  // still makes short-tap idempotent against MicButton's own onClick={() =>
  // beginRecord("primary")} (kept as the mic-tap fallback path from
  // quick-260814-1hz's decisions.md). holdInitiatedRef is consumed at
  // showRecordingControls (B-3, keeps RecordingControls hidden during a
  // hold) AND at showMicButton (keeps MicButton mounted during a hold so
  // setPointerCapture stays attached and the hook's onPointerUp fires on
  // release).
  //
  // NOTE (Quick 260814-1hz): moved above `showMicButton` so the predicate
  // below can read primaryHold.holdInitiatedRef.current.
  const primaryHold = useHoldToRecord({
    voice,
    // quick-260814-iwy: no-op — voice is already recording from pointerdown's
    // voice.start(). Hook's short-tap-keep branch (keepRecordingOnShortTap:
    // true, below) fired commitStartVisibility() to advance the state →
    // "recording" + play start.mp3. resetGestureState clears holdInitiatedRef,
    // which makes showRecordingControls (L1735) evaluate true and swap
    // RecordingControls in. beginRecord("primary") is UNNECESSARY here (would
    // be a no-op anyway — hook's guard chain short-circuits when voice.state
    // !== "idle") and explicitly avoided to make the intent legible.
    onShortTap: () => {},
    onLongPressSend: () => {
      void handleVoiceSend("primary");
    },
    // quick-260814-iwy: opt in to the short-tap-keep branch. Preserves the
    // pointerdown-started recording so a sub-threshold tap on the mic advances
    // "starting" → "recording" (start.mp3) instead of cancel.mp3.
    keepRecordingOnShortTap: true,
    asideActive,
    // Quick 260814-1hz [Rule 1 auto-fix]: the hook now lives on the MicButton
    // (not the Send button), so sendDisabled — which gates on typed-text /
    // canSend / attachments — no longer applies. The mic must be pressable
    // even with an empty textarea: press-and-hold to record, release to send
    // the transcript (Task 3's holdInitiatedRef disjunct keeps the mic
    // mounted through the flow). Retain showTranscribingSend so a fresh
    // press cannot arm while the previous STT round-trip is still in
    // flight. voice.state !== "idle" (checked inside the hook, L219) is the
    // primary double-arm guard.
    disabled: showTranscribingSend,
  });

  // showMicButton — see comment above (L1587). Quick 260814-1hz adds the
  // holdInitiatedRef disjuncts: during a hold-initiated recording,
  // holdInitiatedRef is true, so keep MicButton mounted through the
  // voice.state transitions (idle → starting → recording → transcribing).
  // Symmetric to showRecordingControls's B-3 gate below (which keeps
  // RecordingControls HIDDEN during a hold); together they preserve the
  // CONTEXT.md § "Visual during hold" LOCKED rule "the button the user is
  // pressing does not morph" under the mic-hosted-gesture design.
  // Both isPrimaryRecording AND isPrimaryTranscribing disjuncts are needed:
  // after release-to-send, state transitions "recording" → "transcribing"
  // during the STT round-trip and holdInitiatedRef stays true until the
  // hook's resetGestureState() runs at the end of the send flow.
  const showMicButton =
    typeof navigator !== "undefined" &&
    navigator.mediaDevices != null &&
    (!isPrimaryRecording || primaryHold.holdInitiatedRef.current) &&
    (!isPrimaryTranscribing || primaryHold.holdInitiatedRef.current) &&
    !asideActive &&
    !primaryArmed;
  const showPrimaryArmButton =
    !asideActive &&
    !primaryArmed &&
    text.trim() !== "" &&
    !recycleActive &&
    !planPendingActive &&
    !reconnectingActive;
  // Quick 260802-uow bounty 3: when 3 buttons render on the primary
  // (send at right-1 + mic at right-11 + arm-idle at right-21), pr-10
  // is undersized — typed text visually crowds under the mic and
  // arm-idle icons. Bump right padding to pr-32 (128px) only when the
  // 3-button state is active. 2-button states keep pr-10.
  const primaryThreeButtonState = showMicButton && showPrimaryArmButton;

  // Phase 16: merge voice.errorMessage into the existing displayError. The error
  // display block renders only one message at a time; voice errors are transient
  // (cleared when recording starts again), so they coexist safely with compose errors.
  const displayError = errorMessage ?? voice.errorMessage;

  // B-3 (Phase 32): gate on !holdInitiatedRef so a hold-initiated recording
  // does NOT swap in RecordingControls under the pointer (CONTEXT.md § Visual
  // during hold — LOCKED). The mic-tap path leaves holdInitiatedRef false, so
  // it retains its existing RecordingControls swap behavior.
  const showRecordingControls = isPrimaryRecording && !primaryHold.holdInitiatedRef.current;

  // Layout: 2-row shell per UI-SPEC.md § Layout Contract (Phase 9 / 09-01).
  //
  //   Row 3 — chip strip (ephemeral): AttachmentChipStrip mounts above Row 1
  //            when stagedAttachments.length > 0; component returns null when
  //            empty so no conditional wrapper needed here (UPLOAD-04).
  //   Retry button — conditional, transient: surfaces above chip strip when
  //            at least one chip is in error state.
  //   Row 1 — instrument bar (~32px): meter well (reset cell + segments),
  //            flex-1 spacer (reserves room for future top-row buttons),
  //            aux button group (paperclip conditional, ThumbsUp, Queue).
  //   Row 2 — compose bar: textarea (flex-1, auto-grows 1→6 rows) + Send.
  //            items-end so Send pins to the textarea's bottom edge as the
  //            textarea grows.
  //   Error text — conditional, below Row 2.
  return (
    <div
      ref={composeRootRef}
      className={cn(
        // Patch #181: identifies the compose root for the delegated
        // pointerdown listener (see the useEffect above) that adds a
        // 250ms `.pv-btn-pressed` window to any button tapped inside.
        // CSS styles live in src/ui/index.css.
        "pv-composebox",
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
        "flex flex-col gap-1 px-2 pt-2 pb-[env(safe-area-inset-bottom)] md:pb-2 shrink-0",
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
      {/* Quick 260802-wxy: chip strip relocated INSIDE the primary textarea
          wrapper (see the wrapper block at line ~2009 below). Previously
          rendered as a Row-3 sibling above Row 1; now overlaid absolutely at
          the top of the textarea so chips visually attach to the message
          being composed. The retry affordance below STAYS at this Row-3
          location — it is a compose-level control, not a per-textarea one. */}
      {/* Phase 05: retry affordance surfaces only when at least one
          chip is in the error state. Clicking re-issues the upload
          batch via the parent hook's retryBatch. Kept in-flow (not
          floating) so it lives inside the ComposeBox chrome and
          shares its Glass treatment. */}
      {hasErroredChip && onRetryBatch && (
        <div className="px-1">
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={onRetryBatch}
            aria-label="Retry upload"
            title="Retry failed upload"
            className="gap-1 text-xs"
          >
            <RefreshCw className="size-3" />
            Retry upload
          </Button>
        </div>
      )}
      {/* Phase 05: hidden file input driven by the paperclip. Kept
          outside the row wrappers so it doesn't leak flex sizing;
          `hidden` keeps it out of tab order and layout entirely. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
        data-testid="compose-file-picker"
        aria-hidden="true"
        tabIndex={-1}
      />
      {/* Row 1 — instrument bar: meter well + spacer + aux buttons.
          Touch-target height is gated on `isTouchDevice` (patch #102's
          touch discriminator: pointer:coarse + hover:none) — min-h-[44px]
          satisfies WCAG 2.5.5, min-h-8 matches Row 2's rest height on
          desktop. Paperclip visibility is a SEPARATE concern gated on
          `showPaperclip`. Patch #123 decoupled the two: `showPaperclip`
          used to double as the height proxy, which prevented desktop
          from opting into the paperclip without also inheriting the
          chunky 44px row. */}
      <div className={cn("flex items-center gap-2 mb-[3px]", isTouchDevice ? "min-h-[44px]" : "min-h-8")}>
        {/* Patch #83: cohesive segmented-well meter with integrated reset
            cell (one instrument). The well ALWAYS mounts (segments show
            dim when contextPct is null so the row geometry never jitters
            on first attach).
            Phase 9 (09-02): rotated 90° to horizontal. Segments fill
            LEFT→RIGHT (index 0 = leftmost = lowest %; index SEG_COUNT-1 =
            rightmost = highest %). Reset cell is now the LEFTMOST cell.
            Drain sweep empties RIGHT→LEFT (rightmost dims first, leftmost
            dims last — "flushing the well toward the reset cell").
            SEG_COUNT bumped 11→12 per prototype 2026-07-22 (horizontal
            orientation moots patch #89's sub-pixel concern at ~13px/seg).
            CSS vars `--seg-count` and `--meter-width` expose tuning via
            DevTools without a rebuild. */}
        <div
          className="self-stretch w-[var(--meter-width)] rounded-md flex flex-row p-[3px] bg-[rgba(10,12,20,0.6)] border border-[rgba(220,225,245,0.1)] shadow-[inset_0_2px_6px_rgba(0,0,0,0.55),_0_1px_0_rgba(220,225,245,0.05)]"
          style={{"--seg-count": SEG_COUNT, "--meter-width": "12rem"} as React.CSSProperties}
          role="meter"
          aria-label="Context window"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={contextPct ?? undefined}
          title={
            contextPct != null ? `Context ${contextPct}%` : "Context (unknown)"
          }
        >
          {/* Phase 9 UAT fix (Ashley 2026-07-22): Reset cell moved BEFORE
              segments so it renders as the LEFTMOST cell of the flex-row
              well (was rendering rightmost because 09-02 kept the original
              flex-col child order after flipping to flex-row — segments-
              then-reset which used to be top-then-bottom now became left-
              then-right). Divider stays between them. */}
          <button
            type="button"
            onClick={handleResetClick}
            disabled={canSend === false || asideActive === true || recycleActive === true || planPendingActive === true || reconnectingActive === true || dormantActive === true || voice.state === "transcribing"}
            aria-label="Reset context window"
            title="Reset context window"
            className={cn(
              "h-full w-6 rounded-[2px] border-0 flex items-center justify-center p-0 cursor-pointer",
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
          <div className="w-px mx-[3px] h-full bg-[rgba(220,225,245,0.09)] shadow-[0_1px_0_rgba(0,0,0,0.55)]" />
          {/* Segments: flex-row so index 0 renders at the LEFT of the
              well and index SEG_COUNT-1 at the RIGHT. Phase 9 (09-02)
              rotation from flex-col-reverse (vertical) to flex-row
              (horizontal). transitionDelay = (SEG_COUNT - 1 - i) * 35ms
              so the rightmost segment (i=SEG_COUNT-1) gets 0ms (dims
              first) and leftmost (i=0) gets the longest delay (dims last)
              — reads as a right→left drain sweep toward the reset cell.
              Segment width uses the same explicit-calc-per-segment idiom
              as patch #89's height fix, but now on the horizontal axis
              (13px/seg at 160px/12 — no sub-pixel concern).

              Phase 9 UAT fix (Ashley 2026-07-22): color mode is now
              UNIFORM by current-band, not per-position. All lit segments
              wear the color of contextPct's band (green <45, amber 45-77,
              red ≥78). Unlit segments wear a neutral warm-dim. Matches
              the prototype behavior Ashley endorsed. */}
          <div className="flex flex-row gap-[2px] min-w-[100px] flex-1 h-full">
            {Array.from({ length: SEG_COUNT }, (_, i) => {
              // Band from contextPct (was: from per-segment posPct).
              const band =
                contextPct == null
                  ? "green"
                  : contextPct >= 78
                    ? "red"
                    : contextPct >= 45
                      ? "amber"
                      : "green";
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
              // Phase 9 UAT fix (Ashley 2026-07-22): single neutral dim
              // for all unlit segments (was per-position dim-green/amber/
              // red). Matches prototype where the well reads as ONE color
              // per moment, not three-tones-at-once.
              const dimNeutralBg = "hsla(0,0%,100%,0.06)";
              // Patch #122: during session recycle (`isHolding` from
              // PrettyView, flipped synchronously by the meter well's own
              // Reset click or by the backend `session_holding` WS frame),
              // lock every segment to unlit so the well reads as `powered
              // but empty`. The well container, border, glow, and reset-
              // cell styling stay intact — only the per-segment lit branch
              // flips off.
              const isLit =
                typeof contextPct === "number" &&
                i < litCount &&
                !isDraining &&
                !isHolding;
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
                background = dimNeutralBg;
                boxShadow = "none";
              }
              return (
                <div
                  key={i}
                  className="rounded-[1.5px] transition-[background,box-shadow] duration-[220ms] ease-out"
                  style={{
                    // Phase 9 (09-02): explicit calc width per segment,
                    // same expression for all 12, mirroring patch #89's
                    // height-calc fix but on the horizontal axis.
                    // At 160px / 12 segs ≈ 13px/seg the sub-pixel round
                    // concern that motivated #89's 11-seg odd-count is no
                    // longer relevant. `flex: "0 0 auto"` disables
                    // flex-grow/shrink so the explicit width is authoritative.
                    // height: '100%' fills the well's 28px vertical dimension.
                    width: `calc((100% - ${(SEG_COUNT - 1) * 2}px) / ${SEG_COUNT})`,
                    height: '100%',
                    flex: "0 0 auto",
                    transitionDelay: `${(SEG_COUNT - 1 - i) * 35}ms`,
                    background,
                    boxShadow,
                  }}
                />
              );
            })}
          </div>
        </div>
        {/* Spacer: reserves horizontal room for future top-row buttons
            between the meter well and the aux group (UI-SPEC §
            "fixed-width meter with future-buttons spacer"). Patch #83
            placed RotateCcw in the meter's reset cell; patch #84 added
            the Queue button in the aux group — this spacer is where the
            NEXT batch of top-row controls will accumulate without
            forcing the meter to shrink. aria-hidden so AT skips it. */}
        <div className="flex-1" aria-hidden="true" />
        {/* Aux-button group — Paperclip moved OUT to inside the Row 2
            textarea (2026-07-30 vtk, mirroring Send on the LEFT); this
            group now hosts Queue-a-message (ListPlus), Stop, ThumbsUp,
            Recap (CircleHelp), Hourglass with most-used (Hourglass) on
            the right, mirroring distance-from-meter logic. Vehicle B
            (quick 260801-62m) stripped the /queue and /bounty prefix-
            send buttons formerly between Recap and Hourglass.
            Patch #83 marker: RotateCcw lives in the meter's reset cell.
            Patch #84 marker: Queue button arms the idle-watchdog. */}
        <div className="flex flex-row gap-1">
          {/* Bounty message-queue-in-pretty-view: Queue-a-message button
              (ListPlus icon) — appends a new queue-slot textarea stacked
              above Row 2. Leftmost of the aux buttons. Same warm-neutral
              Glass treatment as neighbors. Mobile size (bounty
              composebox-aux-buttons-75-percent-size-on-mobile,
              2026-08-01): max-md:size-9 [&_svg]:max-md:size-[1.125rem] —
              75% of the original #165 max-md:size-12 bump per Ashley
              mobile UAT ("could probably be like 75% of their current
              size. And that would be comfortable"). Vehicle B (quick
              260801-62m) renamed from "Add queued message textarea" /
              Plus icon to "Queue a message" / ListPlus icon. */}
          <Button
            size="icon-sm"
            variant="secondary"
            onClick={() => setQueueSlots((prev) => [...prev, { id: makeSlotId(), text: "" }])}
            aria-label="Queue a message"
            title="Queue a message"
            className={cn(
              "cursor-pointer max-md:size-9 [&_svg]:max-md:size-[1.125rem]",
              // Same dark blue-gray treatment as the mobile back-to-list
              // button (AppShell.tsx:1651-1654, patch #272). Hue 218 at
              // 25% sat — "part of the scheme" per Ashley, ambient chrome
              // that doesn't compete with blue-190 CTAs.
              "bg-[linear-gradient(160deg,hsla(218,25%,22%,0.85),hsla(218,25%,14%,0.9))]",
              "text-[color:var(--color-pv-fg)]",
              "border-[hsla(218,35%,55%,0.35)]",
              "shadow-[0_4px_12px_rgba(0,0,0,0.6),inset_0_2px_0_rgba(220,225,245,0.3),0_0_24px_hsla(218,40%,55%,0.3)]",
              "hover:brightness-110 hover:shadow-[0_6px_16px_rgba(0,0,0,0.65),inset_0_2px_0_rgba(220,225,245,0.35),0_0_28px_hsla(218,40%,55%,0.4)]",
            )}
          >
            <ListPlus className="size-4" />
          </Button>
          {/* Patch #120: Stop button — safety valve for Ctrl-C into the
              attached tmux session. Shares ThumbsUp's warm-neutral Glass
              treatment (VISUAL-08 HARD LOCK — Send remains the sole
              saturated-amber attention grab-point; Stop is a rarely-used
              safety valve, quiet treatment is correct). NOT gated on
              canSend — the stop button must be reachable even when the
              WS is in a half-state; the parent's onInterrupt silently
              no-ops on WS-not-ready. */}
          {onInterrupt && (
            <Button
              size="icon-sm"
              variant="secondary"
              onClick={() => onInterrupt?.()}
              aria-label="Interrupt"
              title="Interrupt"
              className={cn(
              "cursor-pointer max-md:size-9 [&_svg]:max-md:size-[1.125rem]",
              // Same dark blue-gray treatment as the mobile back-to-list
              // button (AppShell.tsx:1651-1654, patch #272). Hue 218 at
              // 25% sat — "part of the scheme" per Ashley, ambient chrome
              // that doesn't compete with blue-190 CTAs.
              "bg-[linear-gradient(160deg,hsla(218,25%,22%,0.85),hsla(218,25%,14%,0.9))]",
              "text-[color:var(--color-pv-fg)]",
              "border-[hsla(218,35%,55%,0.35)]",
              "shadow-[0_4px_12px_rgba(0,0,0,0.6),inset_0_2px_0_rgba(220,225,245,0.3),0_0_24px_hsla(218,40%,55%,0.3)]",
              "hover:brightness-110 hover:shadow-[0_6px_16px_rgba(0,0,0,0.65),inset_0_2px_0_rgba(220,225,245,0.35),0_0_28px_hsla(218,40%,55%,0.4)]",
            )}
            >
              <Square className="size-4" />
            </Button>
          )}
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
            variant="secondary"
            onClick={() => { onGoodToGo?.(); handleQuickSend("let's go"); }}
            disabled={canSend === false || asideActive === true || recycleActive === true || planPendingActive === true || reconnectingActive === true || dormantActive === true}
            aria-label="Send 'let's go'"
            title="Send 'let's go'"
            className={cn(
              "cursor-pointer max-md:size-9 [&_svg]:max-md:size-[1.125rem]",
              // Same dark blue-gray treatment as the mobile back-to-list
              // button (AppShell.tsx:1651-1654, patch #272). Hue 218 at
              // 25% sat — "part of the scheme" per Ashley, ambient chrome
              // that doesn't compete with blue-190 CTAs.
              "bg-[linear-gradient(160deg,hsla(218,25%,22%,0.85),hsla(218,25%,14%,0.9))]",
              "text-[color:var(--color-pv-fg)]",
              "border-[hsla(218,35%,55%,0.35)]",
              "shadow-[0_4px_12px_rgba(0,0,0,0.6),inset_0_2px_0_rgba(220,225,245,0.3),0_0_24px_hsla(218,40%,55%,0.3)]",
              "hover:brightness-110 hover:shadow-[0_6px_16px_rgba(0,0,0,0.65),inset_0_2px_0_rgba(220,225,245,0.35),0_0_28px_hsla(218,40%,55%,0.4)]",
            )}
          >
            <ThumbsUp className="size-4" />
          </Button>
          {/* Patch #152 → Vehicle B (quick 260801-62m): Recap (CircleHelp)
              quick-reply — mirrors the ThumbsUp pattern (same warm-neutral
              Glass treatment, same disable rule) but its payload is a
              canned /explain prompt asking for a recap of the current
              situation. Semantically distinct: ThumbsUp is "proceed", this
              is "make it legible for me". Renamed from Lightbulb/Explain
              and shortened prompt payload per Vehicle B. */}
          <Button
            size="icon-sm"
            variant="secondary"
            // Phase 32: /explain is a send path — fire onGoodToGo?.() (parent-bound to
            // scrollToBottomAndFollow) alongside handleQuickSend, matching the 'let's go'
            // quick-button above. Per 32-CONTEXT.md § Wire into PrettyView "ALL send paths"
            // rule + 32-PATTERNS.md § 2d Send-path callsite swaps table.
            onClick={() => { onGoodToGo?.(); handleQuickSend("/explain the current situation"); }}
            disabled={canSend === false || asideActive === true || recycleActive === true || planPendingActive === true || reconnectingActive === true || dormantActive === true}
            aria-label="Recap the current situation"
            title="Recap"
            className={cn(
              "cursor-pointer max-md:size-9 [&_svg]:max-md:size-[1.125rem]",
              // Same dark blue-gray treatment as the mobile back-to-list
              // button (AppShell.tsx:1651-1654, patch #272). Hue 218 at
              // 25% sat — "part of the scheme" per Ashley, ambient chrome
              // that doesn't compete with blue-190 CTAs.
              "bg-[linear-gradient(160deg,hsla(218,25%,22%,0.85),hsla(218,25%,14%,0.9))]",
              "text-[color:var(--color-pv-fg)]",
              "border-[hsla(218,35%,55%,0.35)]",
              "shadow-[0_4px_12px_rgba(0,0,0,0.6),inset_0_2px_0_rgba(220,225,245,0.3),0_0_24px_hsla(218,40%,55%,0.3)]",
              "hover:brightness-110 hover:shadow-[0_6px_16px_rgba(0,0,0,0.65),inset_0_2px_0_rgba(220,225,245,0.35),0_0_28px_hsla(218,40%,55%,0.4)]",
            )}
          >
            <CircleHelp className="size-4" />
          </Button>
          {/* Vehicle C: the aux-row Queue (Hourglass) button was retired —
              send-when-idle is now per-textarea. See per-textarea Arm
              button in the queueSlot map below AND in the primary
              textarea's send-button slot further down (at right-21, one
              slot LEFT of mic at right-11). Mic and Arm-idle COEXIST —
              260729-3y1 lock: mic stays reachable regardless of text
              content. */}
        </div>
      </div>
      {/* Bounty message-queue-in-pretty-view: queue-slot stack.
          Renders between Row 1 and Row 2. Each slot is an independent
          textarea with its own Send, Delete (X), and Mic button.
          Slots stack vertically; oldest at top, newest at bottom
          (adjacent to the primary Row 2 textarea below). */}
      {queueSlots.length > 0 && (
        <div className="flex flex-col gap-2 mb-1">
          {queueSlots.map((slot) => (
            <QueuedRow
              key={slot.id}
              slot={slot}
              voice={voice}
              micTarget={micTarget}
              isSourceArmed={isSourceArmed}
              asideActive={asideActive}
              recycleActive={recycleActive}
              planPendingActive={planPendingActive}
              reconnectingActive={reconnectingActive}
              dormantActive={dormantActive}
              canSend={canSend}
              queueSlots={queueSlots}
              onSlotsChange={(next) => {
                setQueueSlots(next);
                scheduleAutosave(latestBodyRef.current, next);
              }}
              scheduleAutosave={scheduleAutosave}
              latestBody={latestBodyRef.current}
              queue={queue}
              handleQueueSlotSend={handleQueueSlotSend}
              armSourceForIdle={armSourceForIdle}
              cancelSourceArmed={cancelSourceArmed}
              handleVoiceCancel={handleVoiceCancel}
              handleVoiceAppend={handleVoiceAppend}
              handleVoiceSend={handleVoiceSend}
              beginRecord={beginRecord}
              handleOpenFilePicker={handleOpenFilePicker}
              getStagedAttachmentsForTarget={getStagedAttachmentsForTarget}
              clearStagedForTarget={clearStagedForTarget}
              onRemoveAttachment={onRemoveAttachment}
              flushDirty={flushDirty}
              clearDebounce={clearDebounce}
            />
          ))}
        </div>
      )}
      {/* Row 2 — compose bar: textarea (flex-1, auto-grows 1→6 rows) +
          Send button. items-end so Send pins to the textarea bottom edge
          as the textarea grows. VISUAL-08 HARD LOCK on Send's amber
          gradient — never change. */}
      <div className="flex items-end gap-2">
        {/* Patch #84: textarea wrapper. The wrapper owns flex sizing
            (`flex-1 self-stretch`) so the pending overlay can position
            absolute-inset over the Textarea while the Textarea itself
            fills the wrapper. `relative` is the positioning context for
            the overlay. */}
        <div className="relative flex-1 self-stretch">
        {/* Quick 260802-wxy: overlaid chip strip. Renders as an
            absolutely-positioned child at the TOP of the wrapper (before
            the Textarea) so it visually attaches to the message being
            composed. AttachmentChipStrip returns null when the list is
            empty (UPLOAD-04 mounting rule), so no wrapper conditional is
            needed — the chipStripRef simply becomes null and the
            useLayoutEffect resets chipStripHeight to 0, restoring the
            Textarea's base padding. z-10 keeps chips above the Textarea
            body; the Send button (right-1 bottom-0.5) and Paperclip
            (left-1 bottom-0.5) sit at BOTTOM so they never collide with
            the top-anchored chips. */}
        <div
          ref={chipStripRef}
          className="absolute top-0 left-0 right-0 z-10 px-2 pt-2 pointer-events-auto"
        >
          <AttachmentChipStrip
            attachments={stagedAttachments ?? []}
            onRemove={onRemoveAttachment ?? (() => {})}
          />
        </div>
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={primaryArmed}
          placeholder={`Message ${identityName || "Claude"}…`}
          rows={1}
          // Quick 260802-wxy: dynamic paddingTop grows with the overlaid
          // chip strip's measured height so composed text never underlaps
          // the chips. Base `py-3` (12px top) is preserved via the
          // className below; this inline style only applies when at least
          // one attachment is staged (chipStripHeight > 0). `+ 12`
          // preserves the base 12px comfort gap between chips and text.
          style={
            chipStripHeight > 0
              ? { paddingTop: `${chipStripHeight + 12}px` }
              : undefined
          }
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
            // Phase 9 UAT fix (Ashley 2026-07-22): shadcn Textarea base
            // className carries `min-h-[80px]` (see textarea.tsx L12) —
            // that's ~2.5 button-heights and floods any `rows={1}` prop
            // regardless of value. `min-h-8!` (32px = one icon-sm button
            // height) beats it via Tailwind v4 `!` important suffix, same
            // #81-fix mechanism as the `bg-[...]!` below (shadcn base
            // wraps a `dark:*` variant → specificity 0-2-0 → plain
            // `min-h-8` at 0-1-0 loses without `!`). One-line rest;
            // auto-grow to 6 rows still works via the useLayoutEffect above (patch #135).
            "min-h-8!",
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
            // Patch #129: 40px right padding reserves space for the
            // inside-textarea Send button (24×24 icon in a 40×40 hit
            // target at absolute right-3 bottom-2.5). Placed AFTER
            // `px-4` so tailwind-merge's later-wins dedupe keeps the
            // 40px right padding while the 16px left padding survives.
            // No `!` needed — no dark: variant conflict on padding.
            "pr-10",
            // Quick 260802-uow bounty 3: bump right padding to clear
            // mic (right-11) + arm-idle (right-21) when all 3 buttons
            // render on the primary. tailwind-merge later-wins dedupes
            // pr-10 vs pr-32. 2-button states keep pr-10.
            primaryThreeButtonState && "pr-32",
            // Quick 260730-vtk: mirrors the `pr-10` above on the LEFT
            // when the inside-textarea Paperclip is present
            // (showPaperclip=true → 44px matching left padding on the
            // Textarea so text doesn't underlap the icon at absolute
            // left-1 bottom-0.5). Quick 260731-ulo: bumped 40px→44px
            // (pl-10→pl-11) per Ashley for a few more px of clearance.
            showPaperclip && "pl-11",
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
          // (Vehicle C v2 DOES disable via `disabled={primaryArmed}` above —
          // that gate is orthogonal: it applies only while the PRIMARY source
          // is armed, restoring editability the instant the primary clears
          // or is cancelled via the overlay click below.)
        />
        {/* Vehicle C v2 (2026-08-01): primary armed overlay. Rendered as a
            <button> with pointer-events-auto so the entire scrim is
            click-to-cancel (source-scoped — cancels ONLY the primary
            source; slot arm states persist). `rounded-[10px]` matches the
            Textarea's rounded-[10px] so corners align. Dark warm-cool
            scrim + tight blur reads as "held, waiting" without hiding
            whatever the user composed. */}
        {primaryArmed && (
          /* Quick 260803-05i (Task 3, bounty adjust-visual-on-queued-
             messages): restructured from a vertical icon-above-label stack
             to a single inline row: icon + label + fire-order badge (when
             queueSlots.length >= 2) + literal lowercase "click to cancel"
             copy. Unified gate `queueSlots.length >= 2` on both primary
             and queued overlays for visual consistency (see plan
             deviation note). Icon shrunk from size-5 → size-4 to sit
             inline. Cancel onClick unchanged. */
          <button
            type="button"
            onClick={() => cancelSourceArmed("primary")}
            aria-label="Cancel queued send"
            title="Cancel queued send"
            className={cn(
              "absolute inset-0 flex flex-row items-center justify-center gap-2 px-3",
              "rounded-[10px] bg-[rgba(10,12,20,0.72)] backdrop-blur-[2px]",
              "cursor-pointer",
            )}
          >
            <RotateCwFadingClock className="size-4 text-[hsla(38,70%,72%,0.9)]" />
            <span className="text-sm text-[hsla(38,60%,80%,0.85)] font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif]">
              Queued — waiting for idle
            </span>
            {queueSlots.length >= 2 && (() => {
              const idx = queue.findIndex((e) => e.source === "primary");
              if (idx < 0) return null;
              return (
                <span
                  data-testid="fire-order-badge"
                  className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[rgba(220,225,245,0.10)] text-[hsla(38,60%,80%,0.9)]"
                >
                  {idx + 1}/{queueSlots.length}
                </span>
              );
            })()}
            <span className="text-xs text-[hsla(38,60%,80%,0.7)]">click to cancel</span>
          </button>
        )}
        {/* Quick 260730-vtk: Paperclip attach button moved from Row 1
            aux group to here per Ashley 2026-07-30. Mirrors Send's
            inside-textarea pattern on the LEFT (Send is right-1
            bottom-0.5; Paperclip is left-1 bottom-0.5). Bare <button>
            not shadcn Button — same reason as Send (#129 wrapper-
            specificity trap). aria-label / title / onClick preserved
            verbatim from the old aux-group Paperclip so Tests 3/4/5
            keep passing. */}
        {showPaperclip && (
          <button
            type="button"
            onClick={() => handleOpenFilePicker("primary")}
            disabled={canSend === false || asideActive === true}
            aria-label="Attach file"
            title="Attach file"
            className={cn(
              "absolute left-1 bottom-0.5",
              "p-2",
              "text-[rgba(240,235,224,0.3)] hover:text-[rgba(240,235,224,0.9)]",
              "disabled:text-[rgba(240,235,224,0.15)]",
              "disabled:cursor-not-allowed",
              "transition-[color,transform] duration-120",
              "active:scale-95",
              "cursor-pointer",
            )}
          >
            <Paperclip className="size-6" />
          </button>
        )}
        {/* Patch #129 + #130-fix: subtle inside-textarea Send button.
            Bare <button type="button"> (NOT shadcn Button — sidesteps
            the wrapper-specificity trap that bit patches #81 and #117
            with the queue button's `!` load-bearing bg classes).
            Position locked with Ashley 2026-07-23 (DevTools console
            iteration): the ICON sits at right:12px bottom:10px from the
            wrapper. Because the button has p-2 (=8px) for a 40×40 hit
            target around the 24×24 icon, the button itself is offset
            right:4px bottom:2px (= right-1 bottom-0.5) so the icon
            centers at 4+8=12, 2+8=10 — Ashley's locked values.
            Patch #130 fix: #129 originally used lucide's SendHorizontal
            component, which is a DIFFERENT SVG path (horizontal-
            pointing plane, plus a M6 12h16 fold line, and lucide's
            default stroke="currentColor" left the plane double-outlined
            with a stroked crease). Ashley's console-locked snippet was
            an inline raw SVG with a SINGLE path — the paper plane
            pointing up-and-right — with pure fill and no stroke. Also
            in #129 the button was at right-3 bottom-2.5 without
            accounting for p-2 offset, so the icon rendered at 20/18
            instead of 12/10. Both regressions caught on 2026-07-23
            deploy UAT; #130 replaces the lucide component with the
            raw inline SVG (verbatim from Ashley's snippet) and moves
            the button to right-1 bottom-0.5 so the icon lands at 12/10
            with hit target preserved. NOT the retired amber-Send from
            patch #121 — Ashley wants ChatGPT/iMessage-quiet here.
            LEAVE the VISUAL-08 comment block above (~line 1240) ALONE.
            onClick routes ALL send behavior through the existing
            handleSend() at line ~652 (attachment branching, D-50
            newline collapse, COMPOSE-04 clear-on-success — nothing
            duplicated). */}
        {/* Phase 16 + quick 260729-3y1: send-button slot — co-render pattern.
            The slot hosts RecordingControls ALONE while voice.state==="recording";
            otherwise the Send/X-for-Resume button ALWAYS renders (at right-1
            bottom-0.5) AND, when showMicButton is true, MicButton ALSO renders
            in the same slot (at right-11 bottom-0.5 — one 40px hit-target width
            to the left of Send). Both are absolutely positioned against the same
            relative parent, so they coexist without collision (40px separation).
            Ashley 260729-3y1: mic must stay tappable even when the textarea has
            typed text or attachments staged. */}
        {showRecordingControls && micTarget === "primary" ? (
          /* Phase 16: while recording, the three-button controls OWN the slot.
             RecordingControls is absolutely positioned at right-1 bottom-0.5
             (same anchor as Send) and handles its own flex layout.
             D-16-06: no timer, no waveform, no level meter here.
             Bounty message-queue-in-pretty-view: micTarget guard ensures
             RecordingControls only appear on the primary when the primary
             is the mic target (slot recording is handled in the slot stack above). */
          <RecordingControls
            onCancel={handleVoiceCancel}
            onAppend={() => { void handleVoiceAppend("primary"); }}
            onSend={() => { void handleVoiceSend("primary"); }}
          />
        ) : (
          <>
            {/* Phase 14 Wave 4 (Task 2): SAME BUTTON, branched attributes.
                When asideActive=true the button morphs to a Resume affordance —
                X icon + identity-hue color + onClick fires onAsideDismiss?.()
                instead of handleSend(). Per PATTERNS.md L186-234, we morph in
                place (same <button> element) so DOM identity is preserved
                across the morph transition — focus, keyboard tab order, and
                parent-CSS selectors don't blink. Do NOT split into two sibling
                buttons; do NOT wrap in a conditional-render component.
                Phase 16: showTranscribingSend=true adds disabled={true} during
                the STT round-trip so rapid-tap cannot double-fire (T-16-16).
                Patch #181 press-feedback (250ms .pv-btn-pressed class) is
                driven by the delegated pointerdown listener at the compose
                root — this button participates by default (no per-button
                wiring needed). */}
            <button
              type="button"
              // Quick 260814-1hz: onClick is now the SOLE driver for both
              // branches — the aside-dismiss branch (unchanged) AND the
              // normal typed-send branch (previously hosted on the
              // useHoldToRecord hook, now moved onto MicButton per the
              // bounty). Preserves the "send-button" origin marker from
              // Phase 35 and the aside-morph Resume/X behavior byte-for-byte.
              // The hold-to-record pointer handlers live on the MicButton
              // below (~L2530 primary, ~L2949 slot).
              onClick={asideActive ? () => onAsideDismiss?.() : () => handleSend(undefined, "send-button")}
              disabled={asideActive ? false : (sendDisabled || showTranscribingSend)}
              aria-label={asideActive ? "Resume" : "Send"}
              title={asideActive ? "Resume" : "Send"}
              className={cn(
                "absolute right-1 bottom-0.5",
                "p-2",
                // Phase 14 Wave 4 (Task 2): identity-hue color when morphed so
                // the X visually distinguishes from Send (Ashley 2026-07-26:
                // "Style change to visually distinguish from send" per
                // CONTEXT.md § ComposeBox morph). All other positional /
                // transition classes preserved.
                asideActive
                  ? "text-[hsla(var(--pv-id-hue),90%,72%,0.95)] hover:text-[hsla(var(--pv-id-hue),95%,82%,1)]"
                  : "text-[rgba(240,235,224,0.3)] hover:text-[rgba(240,235,224,0.9)]",
                "disabled:text-[rgba(240,235,224,0.15)]",
                "disabled:cursor-not-allowed",
                "transition-[color,transform] duration-120",
                "active:scale-95",
                "cursor-pointer",
              )}
            >
              {asideActive ? (
                /* Phase 14 Wave 4 (Task 2): lucide X sized to match the
                    paper-plane's 24×24 slot. strokeWidth=2.25 keeps the
                    mark visually heavy enough at 24px to read as a
                    dismiss glyph without overpowering the neon aside
                    bubble above. */
                <X className="size-6" strokeWidth={2.25} aria-hidden="true" />
              ) : (
                /* Raw inline SVG — verbatim from Ashley's DevTools console
                    snippet 2026-07-23. Single path (paper-plane silhouette
                    pointing up-and-right), pure fill, NO stroke, NO fold
                    line. Do NOT swap for lucide's SendHorizontal — that's a
                    different icon (patch #130 write-up).
                    Quick 260730-lur: when showTranscribingSend === true a
                    Loader2 spinner replaces the paper-plane for the STT
                    round-trip duration (in-button feedback that Send-transcript
                    registered). Idle branch keeps the paper-plane byte-for-byte. */
                showTranscribingSend ? (
                  <Loader2 className="size-6 animate-spin" aria-hidden="true" />
                ) : (
                  <svg
                    className="size-6"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
                  </svg>
                )
              )}
            </button>
            {/* Quick 260729-3y1: MicButton co-renders LEFT of Send at
                right-11 bottom-0.5 (one p-2 hit-target width away from Send's
                right-1 anchor). voice.start() is passed directly (NOT wrapped
                in async) so the first statement inside is the synchronous
                getUserMedia call (D-16-02 iOS Safari constraint). Guards are
                mediaDevices + voice.state==="idle" + !asideActive + !primaryArmed
                (see the showMicButton predicate above) — text length and
                attachment presence no longer factor in.
                Vehicle C v2 (2026-08-01): mic + arm-idle COEXIST on the
                primary textarea. Arm-idle sits at right-21 bottom-0.5 —
                one slot LEFT of mic (right-11) — gated on non-empty text
                and !primaryArmed. Both are absolutely positioned inside
                the same relative parent (40px separation). */}
            {showMicButton && (
              <MicButton
                // Quick 260814-1hz: hold-to-record now lives on MicButton.
                // primaryHold pointer handlers govern press-and-hold → voice
                // recording. The onClick below is the tap-to-record path;
                // the hook's onShortTap ALSO calls beginRecord("primary"),
                // which is safe because useHoldToRecord's voice.state !== "idle"
                // guard makes the second call a no-op (belt-and-suspenders
                // for browsers that fire click without a hook-observable
                // pointerup pair).
                onClick={() => beginRecord("primary")}
                onPointerDown={primaryHold.onPointerDown}
                onPointerUp={primaryHold.onPointerUp}
                onPointerCancel={primaryHold.onPointerCancel}
                onPointerLeave={primaryHold.onPointerLeave}
                dataHoldActive={primaryHold.holdActive}
                disabled={voice.state !== "idle"}
                title="Record voice"
                positionClass="right-11 bottom-0.5"
              />
            )}
            {showPrimaryArmButton && (
              <button
                type="button"
                onClick={() => armSourceForIdle("primary", text)}
                aria-label="Send when idle"
                title="Send when idle"
                className={cn(
                  "absolute right-21 bottom-0.5",
                  "p-2",
                  "text-[rgba(240,235,224,0.3)] hover:text-[rgba(240,235,224,0.9)]",
                  "transition-[color,transform] duration-120",
                  "active:scale-95",
                  "cursor-pointer",
                )}
              >
                <RotateCwFadingClock className="size-6" aria-hidden="true" />
              </button>
            )}
          </>
        )}
        </div>
      </div>
      {/* Phase 16: displayError merges errorMessage (compose errors) and
          voice.errorMessage (STT / mic-denied errors) — first non-null wins. */}
      {displayError && (
        <div className="text-xs text-[color:var(--color-pv-code-fg)]">{displayError}</div>
      )}
    </div>
  );
}

// ============================================================================
// Quick 260803-05i (Task 2): QueuedRow — extracted from ComposeBox's inline
// queueSlots.map body. Extraction is load-bearing because per-slot
// chipStripRef + chipStripHeight state + ResizeObserver are naturally scoped
// to each row instance (no Map-of-refs plumbing in the parent). Keeps
// existing per-slot behavior byte-for-byte; adds an inner `.relative.flex-1
// .self-stretch` wrapper hosting the overlaid chip strip (mirrors Quick A's
// primary composebox pattern at ~L2127 of the parent). The top-left delete
// × corner tab from Task 1 stays a SIBLING of the inner wrapper so it still
// protrudes OUTSIDE the textarea border.
// ============================================================================

interface QueuedRowProps {
  slot: { id: string; text: string };
  voice: ReturnType<typeof useVoiceRecording>;
  micTarget: "primary" | string;
  isSourceArmed: (source: "primary" | string) => boolean;
  asideActive?: boolean;
  recycleActive?: boolean;
  // Phase 24: OR-in sibling for the plan-mode approval prompt window.
  // Matches recycleActive verbatim — the queued-row aux buttons that already
  // read `recycleActive === true` also OR-in `planPendingActive === true`.
  planPendingActive?: boolean;
  // Reconnect window: same OR-in treatment — queued-row Send is disabled
  // while the pretty-view WS is between sockets.
  reconnectingActive?: boolean;
  // quick 260808-cd6: dormantActive mirrors reconnectingActive 1:1 in QueuedRow.
  dormantActive?: boolean;
  canSend?: boolean;
  queueSlots: Array<{ id: string; text: string }>;
  onSlotsChange: (next: Array<{ id: string; text: string }>) => void;
  scheduleAutosave: (nextBody: string, nextSlots?: Array<{ id: string; text: string }>) => void;
  latestBody: string;
  // Quick 260803-05i (Task 3): queue FIFO — used to compute this slot's
  // fire-order badge index inside the armed overlay.
  queue: Array<{ source: "primary" | string; text: string }>;
  handleQueueSlotSend: (slotId: string) => void;
  armSourceForIdle: (source: "primary" | string, sourceText: string) => void;
  cancelSourceArmed: (source: "primary" | string) => void;
  handleVoiceCancel: () => void;
  handleVoiceAppend: (target: "primary" | string) => void | Promise<void>;
  handleVoiceSend: (target: "primary" | string) => void | Promise<void>;
  beginRecord: (target: "primary" | string) => void;
  handleOpenFilePicker: (target?: string) => void;
  getStagedAttachmentsForTarget?: (target: string) => StagedAttachmentLike[];
  clearStagedForTarget?: (target: string) => void;
  onRemoveAttachment?: (tempId: string) => void;
  flushDirty: () => Promise<void> | void;
  clearDebounce: () => void;
}

function QueuedRow(props: QueuedRowProps) {
  const {
    slot,
    voice,
    micTarget,
    isSourceArmed,
    asideActive,
    recycleActive,
    planPendingActive,
    reconnectingActive,
    dormantActive,
    canSend,
    queueSlots,
    onSlotsChange,
    queue,
    handleQueueSlotSend,
    armSourceForIdle,
    cancelSourceArmed,
    handleVoiceCancel,
    handleVoiceAppend,
    handleVoiceSend,
    beginRecord,
    handleOpenFilePicker,
    getStagedAttachmentsForTarget,
    clearStagedForTarget,
    onRemoveAttachment,
    flushDirty,
    clearDebounce,
  } = props;

  // Quick 260803-05i: per-slot chip strip refs + measurement — same pattern
  // Quick A applied to the primary Textarea (see ComposeBox ~L954-979). Each
  // QueuedRow instance owns its own chipStripRef / chipStripHeight so there's
  // no Map-of-refs plumbing in the parent.
  const chipStripRef = useRef<HTMLDivElement | null>(null);
  const [chipStripHeight, setChipStripHeight] = useState(0);
  const target = `queued:${slot.id}`;
  const stagedForThisSlot = getStagedAttachmentsForTarget?.(target) ?? [];
  const stagedCount = stagedForThisSlot.length;

  useLayoutEffect(() => {
    const el = chipStripRef.current;
    if (!el) {
      setChipStripHeight(0);
      return;
    }
    setChipStripHeight(Math.ceil(el.getBoundingClientRect().height));
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const h = entry.contentRect?.height ?? 0;
      setChipStripHeight(Math.ceil(h));
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [stagedCount]);

  const isSlotRecording = voice.state === "recording" && micTarget === slot.id;
  const isSlotTranscribing = voice.state === "transcribing" && micTarget === slot.id;
  const slotArmed = isSourceArmed(slot.id);
  const slotHasText = slot.text.trim() !== "";
  const isSlotActiveMic = isSlotRecording || isSlotTranscribing;
  const showSlotTranscribingSend = isSlotTranscribing;
  // M-2 (Phase 32): extract disabled predicate as a shared local so the JSX
  // disabled prop and the useHoldToRecord disabled arg cannot silently drift.
  //
  // NOTE (Quick 260814-1hz): moved above `showSlotMic` so it is in scope for
  // the slotHold construction (which itself moved up so its holdInitiatedRef
  // can be read inside showSlotMic).
  const slotSendDisabled =
    showSlotTranscribingSend ||
    slot.text.trim() === "" ||
    slotArmed ||
    recycleActive === true ||
    planPendingActive === true ||
    reconnectingActive === true ||
    dormantActive === true;
  // Quick 260814-1hz: hold-to-record gesture MOVED from the slot send button
  // to the slot MicButton. The Send button gets its direct
  // onClick={handleQueueSlotSend} back below. Pointer handlers spread onto
  // MicButton at ~L2949.
  //
  // quick-260814-iwy update (parity with primary): slot onShortTap is now a
  // NO-OP (was beginRecord(slot.id)). Hook's short-tap-keep branch
  // (keepRecordingOnShortTap: true) preserves the pointerdown-started slot
  // recording via voice.commitStartVisibility(). Fixes the iPhone
  // "first-tap-plays-cancel.mp3 + double-tap-required" regression on the
  // slot mic. voice.state !== "idle" guard inside the hook makes short-tap
  // idempotent against MicButton's own onClick.
  //
  // NOTE (Quick 260814-1hz): moved above `showSlotMic` so the predicate
  // below can read slotHold.holdInitiatedRef.current — keeps the slot mic
  // mounted during a hold-initiated slot recording (parity with primary).
  const slotHold = useHoldToRecord({
    voice,
    // quick-260814-iwy (parity with primary): no-op — voice is already
    // recording from pointerdown's voice.start(). Hook's short-tap-keep
    // branch (keepRecordingOnShortTap: true, below) fired
    // commitStartVisibility() to advance the state → "recording" + play
    // start.mp3. resetGestureState clears holdInitiatedRef, which makes
    // showSlotRecording (L2796) evaluate true and swap RecordingControls in.
    // beginRecord(slot.id) is UNNECESSARY (hook guard short-circuits when
    // voice.state !== "idle") and explicitly avoided to make intent legible.
    onShortTap: () => {},
    onLongPressSend: () => {
      void handleVoiceSend(slot.id);
    },
    // quick-260814-iwy: opt in to the short-tap-keep branch (parity with
    // primary). Preserves the pointerdown-started slot recording.
    keepRecordingOnShortTap: true,
    asideActive: asideActive ?? false,
    // Quick 260814-1hz [Rule 1 auto-fix, parity with primary]: hook now
    // lives on the slot MicButton, so slotSendDisabled (which gates on
    // slot text emptiness / recycle / plan-pending / etc.) no longer
    // applies to the hold-record gesture. Retain showSlotTranscribingSend
    // so a fresh press cannot arm while STT is in-flight from a prior
    // send. voice.state !== "idle" guard inside the hook handles double-arm.
    disabled: showSlotTranscribingSend,
  });
  // Quick 260814-1hz: `|| slotHold.holdInitiatedRef.current` disjunct on the
  // isSlotActiveMic gate keeps the slot MicButton mounted through the voice
  // .state transitions of a hold-initiated slot recording (idle → starting
  // → recording → transcribing). Symmetric to showSlotRecording's B-3 gate
  // below. Preserves the CONTEXT.md § "Visual during hold" LOCKED rule "the
  // button the user is pressing does not morph" under the mic-hosted-gesture
  // design. The isSlotActiveMic local already collapses recording +
  // transcribing, so a single disjunct covers both states.
  const showSlotMic =
    typeof navigator !== "undefined" &&
    navigator.mediaDevices != null &&
    (!isSlotActiveMic || slotHold.holdInitiatedRef.current) &&
    !asideActive &&
    !slotArmed;
  // Ashley 2026-08-10: dormantActive gate removed here — parallel treatment
  // to showPrimaryArmButton (see comment there). Arm is pure client state;
  // dispatch is isIdle-gated so the armed slot naturally sits until the woken
  // pane's Claude reports idle, then fires. Sibling recycle/plan/reconnect
  // gates deliberately preserved (scoped ask).
  const showSlotArmButton =
    !asideActive &&
    !slotArmed &&
    slotHasText &&
    !planPendingActive &&
    !reconnectingActive;
  // Quick 260802-uow bounty 3 (parity with primary): bump right padding
  // when send + mic + arm-idle all render together.
  const slotThreeButtonState = showSlotMic && showSlotArmButton;
  // B-3 (Phase 32, slot variant): gate on !holdInitiatedRef so a hold-initiated
  // slot recording does NOT swap in RecordingControls under the pointer
  // (CONTEXT.md § Visual during hold — LOCKED). Mic-tap slot path leaves
  // holdInitiatedRef false, so it retains its existing swap behavior.
  const showSlotRecording = isSlotRecording && !slotHold.holdInitiatedRef.current;
  const showSlotSend = !showSlotRecording;

  return (
    <div className="relative flex-1" data-slot-id={slot.id}>
      {/* Quick 260803-05i: Delete × top-left corner tab. SIBLING of the
          inner content wrapper below so it protrudes OUTSIDE the textarea
          border (via -top-2 -left-2). Task 1 introduced this at top-right;
          Ashley moved it to top-left 2026-08-12. Task 2's extraction
          preserves the sibling-of-inner-wrapper invariant. */}
      <button
        type="button"
        onClick={() => {
          const nextSlots = queueSlots.filter((s) => s.id !== slot.id);
          onSlotsChange(nextSlots);
          clearStagedForTarget?.(target);
        }}
        aria-label="Delete queued message"
        title="Delete queued message"
        className={cn(
          "absolute -top-2 -left-2 z-20",
          "p-1 rounded-full",
          "bg-[rgba(10,12,20,0.85)] border border-[rgba(220,225,245,0.12)]",
          "text-[rgba(240,235,224,0.3)] hover:text-[rgba(240,235,224,0.9)]",
          "transition-[color,transform] duration-120",
          "active:scale-95",
          "cursor-pointer",
        )}
      >
        <X className="size-4" aria-hidden="true" />
      </button>
      {/* Quick 260803-05i (Task 2): inner wrapper mirrors the primary
          composebox's `.relative.flex-1.self-stretch` pattern so the
          absolute-positioned chip strip lives INSIDE the textarea's
          bounding box (via top-0 left-0 right-0). Hosts: chip strip
          overlay + Textarea + armed overlay + paperclip + Send/mic/
          arm-idle group. */}
      <div className="relative flex-1 self-stretch">
        {/* Overlay chip strip — mirrors Quick A's primary overlay at
            ComposeBox ~L2139-2150. AttachmentChipStrip returns null when
            the list is empty, so chipStripRef.current transitions
            null↔element as files stage/unstage; the useLayoutEffect above
            resets chipStripHeight to 0 in the null branch. */}
        <div
          ref={chipStripRef}
          className="absolute top-0 left-0 right-0 z-10 px-2 pt-2 pointer-events-auto"
        >
          <AttachmentChipStrip
            attachments={stagedForThisSlot}
            onRemove={onRemoveAttachment ?? (() => {})}
          />
        </div>
        <Textarea
          value={slot.text}
          disabled={slotArmed}
          onChange={(e) => {
            const nextText = e.target.value;
            const nextSlots = queueSlots.map((s) =>
              s.id === slot.id ? { ...s, text: nextText } : s,
            );
            onSlotsChange(nextSlots);
          }}
          onBlur={() => {
            clearDebounce();
            void flushDirty();
          }}
          placeholder="Queued message…"
          rows={1}
          data-testid={`queue-slot-textarea-${slot.id}`}
          // Quick 260803-05i (Task 2): dynamic paddingTop grows with the
          // overlaid chip strip's measured height so composed text never
          // underlaps the chips (same pattern Quick A applied to primary).
          // Base `py-3` (12px top) is preserved via className; this inline
          // style only applies when at least one attachment is staged
          // (chipStripHeight > 0). `+ 12` preserves the base 12px comfort
          // gap between chips and text.
          style={
            chipStripHeight > 0
              ? { paddingTop: `${chipStripHeight + 12}px` }
              : undefined
          }
          className={cn(
            "resize-none w-full",
            "min-h-8!",
            "bg-[rgba(10,12,20,0.5)]! text-[#f0ebe0]",
            "border border-[rgba(220,225,245,0.07)]",
            "rounded-[10px] px-4 py-3",
            // Quick 260803-05i (Task 1): paperclip clearance parity.
            "pr-10 pl-11",
            // Quick 260802-uow bounty 3: bump right padding when
            // send + mic + arm-idle all render.
            slotThreeButtonState && "pr-32",
            "placeholder:text-[var(--color-pv-fg-dim)]",
            "shadow-[inset_0_2px_6px_rgba(0,0,0,0.4),_0_1px_0_rgba(220,225,245,0.04)]",
            "transition-[box-shadow,border-color] duration-200",
            "focus:border-[rgba(220,225,245,0.28)]",
            "focus:shadow-[inset_0_3px_10px_rgba(0,0,0,0.55),_inset_0_1px_2px_rgba(0,0,0,0.35),_0_1px_0_rgba(220,225,245,0.07),_0_0_0_1px_rgba(220,225,245,0.2),_0_0_22px_rgba(220,225,245,0.12)]",
            "focus-visible:ring-0 focus-visible:outline-none",
          )}
        />
        {/* Vehicle C v2 (2026-08-01): per-slot armed overlay. Rendered as
            a <button> with pointer-events-auto so the entire scrim is
            click-to-cancel (source-scoped — cancels ONLY this slot).
            rounded-[10px] matches the slot Textarea's rounding so
            corners align.
            Quick 260803-05i (Task 3, bounty adjust-visual-on-queued-
            messages): restructured from a vertical icon-above-label stack
            to a single inline row: icon + label + fire-order badge (when
            queueSlots.length >= 2) + literal lowercase "click to cancel"
            copy. Icon shrunk from size-5 → size-4 to sit inline. Cancel
            onClick unchanged — the entire scrim is still the cancel
            affordance. */}
        {slotArmed && (
          <button
            type="button"
            onClick={() => cancelSourceArmed(slot.id)}
            aria-label="Cancel queued send"
            title="Cancel queued send"
            className={cn(
              "absolute inset-0 flex flex-row items-center justify-center gap-2 px-3",
              "rounded-[10px] bg-[rgba(10,12,20,0.72)] backdrop-blur-[2px]",
              "cursor-pointer",
            )}
          >
            <RotateCwFadingClock className="size-4 text-[hsla(38,70%,72%,0.9)]" />
            <span className="text-sm text-[hsla(38,60%,80%,0.85)] font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif]">
              Queued — waiting for idle
            </span>
            {queueSlots.length >= 2 && (() => {
              const idx = queue.findIndex((e) => e.source === slot.id);
              if (idx < 0) return null;
              return (
                <span
                  data-testid="fire-order-badge"
                  className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[rgba(220,225,245,0.10)] text-[hsla(38,60%,80%,0.9)]"
                >
                  {idx + 1}/{queueSlots.length}
                </span>
              );
            })()}
            <span className="text-xs text-[hsla(38,60%,80%,0.7)]">click to cancel</span>
          </button>
        )}
        {/* Quick 260803-05i (Task 1): Paperclip attach button — absolute
            left-1 bottom-0.5. Routes to onAttachFilesForTarget via
            handleOpenFilePicker(`queued:${slot.id}`).
            2026-08-06 (composebox-queued-recycle-disable-inverted): mirrors
            the primary attach's disable expression (canSend + asideActive
            only). Recycle/plan-pending do NOT disable attach — same rule
            as primary: attach stages locally, no WS side-effect, safe to
            prep during the recycle/approval window so the fire that lands
            after the window can carry attachments. */}
        <button
          type="button"
          onClick={() => handleOpenFilePicker(target)}
          disabled={canSend === false || asideActive === true}
          aria-label="Attach file to queued message"
          title="Attach file"
          className={cn(
            "absolute left-1 bottom-0.5",
            "p-2",
            "text-[rgba(240,235,224,0.3)] hover:text-[rgba(240,235,224,0.9)]",
            "disabled:text-[rgba(240,235,224,0.15)]",
            "disabled:cursor-not-allowed",
            "transition-[color,transform] duration-120",
            "active:scale-95",
            "cursor-pointer",
          )}
        >
          <Paperclip className="size-6" />
        </button>
        {/* Send / RecordingControls slot — absolute right-1 bottom-0.5 (mutex) */}
        {showSlotRecording ? (
          <RecordingControls
            onCancel={handleVoiceCancel}
            onAppend={() => { void handleVoiceAppend(slot.id); }}
            onSend={() => { void handleVoiceSend(slot.id); }}
          />
        ) : (
          <>
            {showSlotSend && (
              <button
                type="button"
                // Quick 260814-1hz: onClick restored as sole driver — the
                // hold-to-record hook now lives on the slot MicButton below.
                onClick={() => handleQueueSlotSend(slot.id)}
                disabled={slotSendDisabled}
                aria-label="Send queued message"
                title="Send queued message"
                className={cn(
                  "absolute right-1 bottom-0.5",
                  "p-2",
                  "text-[rgba(240,235,224,0.3)] hover:text-[rgba(240,235,224,0.9)]",
                  "disabled:text-[rgba(240,235,224,0.15)]",
                  "disabled:cursor-not-allowed",
                  "transition-[color,transform] duration-120",
                  "active:scale-95",
                  "cursor-pointer",
                )}
              >
                {showSlotTranscribingSend ? (
                  <Loader2 className="size-6 animate-spin" aria-hidden="true" />
                ) : (
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
                  </svg>
                )}
              </button>
            )}
            {showSlotMic && (
              <MicButton
                // Quick 260814-1hz: slotHold pointer handlers govern press-
                // and-hold → voice recording on the slot mic. onClick is the
                // tap-to-record path; hook's onShortTap also calls
                // beginRecord(slot.id) — idempotent via voice.state guard.
                onClick={() => beginRecord(slot.id)}
                onPointerDown={slotHold.onPointerDown}
                onPointerUp={slotHold.onPointerUp}
                onPointerCancel={slotHold.onPointerCancel}
                onPointerLeave={slotHold.onPointerLeave}
                dataHoldActive={slotHold.holdActive}
                disabled={voice.state !== "idle"}
                title="Record voice"
                positionClass="right-11 bottom-0.5"
              />
            )}
            {showSlotArmButton && (
              <button
                type="button"
                onClick={() => armSourceForIdle(slot.id, slot.text)}
                aria-label="Send when idle"
                title="Send when idle"
                className={cn(
                  "absolute right-21 bottom-0.5",
                  "p-2",
                  "text-[rgba(240,235,224,0.3)] hover:text-[rgba(240,235,224,0.9)]",
                  "transition-[color,transform] duration-120",
                  "active:scale-95",
                  "cursor-pointer",
                )}
              >
                <RotateCwFadingClock className="size-6" aria-hidden="true" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
