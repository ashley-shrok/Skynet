import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Hourglass, Lightbulb, Paperclip, RefreshCw, RotateCcw, Square, Terminal, ThumbsUp, X } from "lucide-react";
import { Button } from "@/components/button";
import { Textarea } from "@/components/textarea";
import { cn } from "@/lib/utils";
import {
  flushComposeDraftKeepalive,
  getComposeDraft,
  putComposeDraft,
} from "@/api/compose-drafts-api";
import { AttachmentChipStrip, type StagedAttachmentLike } from "./AttachmentChipStrip";
import { useVoiceRecording } from "./useVoiceRecording";
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
  // Optional callback for the aux-row Terminal-icon button that toggles
  // pretty-view OFF (falls back to the raw xterm.js). Wires to the same
  // handle.togglePrettyMode() path as the Ctrl+Shift+O shortcut so the
  // button and the shortcut are byte-identical in behavior. Only renders
  // when supplied — read-only PrettyView callers stay clean.
  onTogglePrettyMode?: () => void;
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
  onSendWithAttachments,
  onRetryBatch,
  asideActive,
  onAsideDismiss,
  onTogglePrettyMode,
  className,
}: ComposeBoxProps) {
  // Phase 05 — hidden file input driven by the paperclip button. When the
  // input's change event fires, we normalize the FileList to a plain array
  // and hand it to onAttachFiles (which the parent hook's stageAttachments
  // then consumes). Clearing input.value after selection allows the same
  // file to be re-picked later — some browsers otherwise no-op a repeat
  // selection because the "value hasn't changed."
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleOpenFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);
  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) onAttachFiles?.(files);
      // Reset so the same file can be picked again in the same session.
      e.target.value = "";
    },
    [onAttachFiles],
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
  const voice = useVoiceRecording();

  // Phase 05 — derived state for the Send-routing decision + Retry button.
  const hasAttachments = (stagedAttachments?.length ?? 0) > 0;
  const hasErroredChip = !!stagedAttachments?.some((a) => a.status === "error");
  const [text, setText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Patch #135: cache of the 6-row height cap (px), computed once on mount
  // from getComputedStyle(el).lineHeight × 6. Null until first useLayoutEffect
  // pass consults the DOM. 144px fallback (24 × 6) covers the JSDOM `normal`
  // keyword branch where parseFloat resolves to NaN.
  const maxHeightPxRef = useRef<number | null>(null);

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
    // Patch #119 — draft-loss belt-and-suspenders diagnostic. One
    // console.warn per attempted server save so the next post-restart
    // repro reveals whether the server-side save fired at all.
    console.warn(
      "[compose-draft] save hostId=%s tmuxSession=%s bodyLen=%d",
      hostId,
      tmuxSessionKey ?? "(null)",
      body.length,
    );
    try {
      await putComposeDraft(hostId, tmuxSessionKey, body);
      // Patch #119 — mirror the confirmed-saved body to localStorage so
      // ls stays in sync with the server after every successful autosave.
      try {
        localStorage.setItem(composeDraftLsKey(hostId, tmuxSessionKey), body);
      } catch {
        // localStorage can throw on quota / private browsing — non-fatal.
      }
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
      // Patch #119 — draft-loss belt-and-suspenders: mirror every
      // keystroke (well, every scheduled autosave, which is every
      // keystroke via handleTextChange) to localStorage so the draft
      // survives any server-side failure mode. try/catch keeps
      // storage-quota / private-browsing throws non-fatal.
      try {
        localStorage.setItem(
          composeDraftLsKey(hostId, tmuxSessionKey),
          nextBody,
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

        // Patch #119 — draft-loss belt-and-suspenders hydrate. Cross-
        // check localStorage against the server seed:
        //   - server non-empty → server wins; mirror seed → ls so ls
        //     stays fresh.
        //   - server empty + ls non-empty → restore from ls and
        //     schedule an autosave so the server catches up on the
        //     next debounce tick.
        //   - both empty → nothing to do.
        // Diagnostic console.warn reveals serverLen vs lsLen for the
        // next post-restart repro.
        let lsBody: string | null = null;
        try {
          lsBody = localStorage.getItem(
            composeDraftLsKey(hostId, tmuxSessionKey),
          );
        } catch {
          lsBody = null;
        }

        let hydratedBody = seed;
        if (seed !== "") {
          try {
            localStorage.setItem(
              composeDraftLsKey(hostId, tmuxSessionKey),
              seed,
            );
          } catch {}
        } else if (lsBody && lsBody.length > 0) {
          hydratedBody = lsBody;
        }

        console.warn(
          "[compose-draft] load hostId=%s tmuxSession=%s serverLen=%d lsLen=%d",
          hostId,
          tmuxSessionKey ?? "(null)",
          seed.length,
          lsBody?.length ?? 0,
        );

        setText(hydratedBody);
        latestBodyRef.current = hydratedBody;

        // If we restored from ls, kick off an autosave so the server
        // catches up on the next 400ms tick. scheduleAutosave also
        // re-mirrors to ls (idempotent — same body) which is fine.
        if (seed === "" && lsBody && lsBody.length > 0) {
          scheduleAutosave(hydratedBody);
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
  }, [hostId, tmuxSessionKey, clearDebounce, scheduleAutosave]);

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
    // Patch #119 — draft-loss belt-and-suspenders: clear the ls mirror
    // on submit so a successful send doesn't leave stale content that
    // would resurrect on a subsequent post-restart hydrate.
    try {
      localStorage.removeItem(composeDraftLsKey(hostId, tmuxSessionKey));
    } catch {}
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
  }, [text]);

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

  // overridePayload: Phase 16 D-16-05 — voice.endSend passes the glued
  // transcript here so it reaches the send path synchronously, bypassing
  // React's async setState batching on text. When present it is used in place
  // of the current `text` state. All other handleSend logic (attachment
  // branching, D-50 newline collapse, COMPOSE-04 hard-lock) still applies.
  function handleSend(overridePayload?: string) {
    // Patch #84: immediate action wins — cancel any armed queue silently
    // and proceed with the direct send. No error UI on the dropped queue.
    if (queuedText !== null) {
      if (dispatchTimerRef.current) {
        clearTimeout(dispatchTimerRef.current);
        dispatchTimerRef.current = null;
      }
      setQueuedText(null);
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
      const captionPayload = trimmed.replace(/\r?\n/g, " ");
      onSendWithAttachments(captionPayload);
      setText("");
      clearAfterSend();
      return;
    }

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

  // Phase 16: voice handler callbacks — wired to RecordingControls's onCancel /
  // onAppend / onSend props. Each delegates to voice.* and handles the result.

  function handleVoiceCancel() {
    // Drop the audio clip and return to idle — no textarea change, no fetch.
    void voice.cancel();
  }

  async function handleVoiceAppend() {
    // Stop recording, transcribe, append the result to the current textarea
    // value. Does NOT call handleSend — send is left to the user.
    const result = await voice.endAppend(text);
    if (result) {
      setText(result.glued);
      scheduleAutosave(result.glued);
    }
    // On null result: voice.errorMessage is set by the hook; no textarea change.
  }

  async function handleVoiceSend() {
    // Stop recording, transcribe, then send through the SAME handleSend path
    // (D-16-05). Pass result.glued as overridePayload so the payload is correct
    // even though setText(result.glued) is async.
    const result = await voice.endSend(text);
    if (result) {
      setText(result.glued);
      scheduleAutosave(result.glued);
      // D-16-05: route through the SAME handleSend — attachment branching,
      // D-50 newline collapse, COMPOSE-04 hard-lock all still apply.
      handleSend(result.glued);
    }
    // On null result: voice.errorMessage is set by the hook; no send.
  }

  // Reset-send: mirrors handleSend (clears textarea on success, surfaces
  // inline error on failure) except (a) it wraps the trimmed body in
  // parentheses appended to "/id reset " so the reset carries a hint
  // through to the fresh session, and (b) it fires even when the body is
  // blank — in which case it sends just "/id reset".
  function handleResetSend() {
    // Patch #122: fire the PrettyView `isHolding` signal synchronously so
    // `SessionHoldingOverlay`'s 350ms delay-arm timer starts NOW, not when
    // the backend's `session_holding` WS frame arrives (~seconds later).
    // The `/id reset` payload still routes through the normal `onSend`
    // path below — this is purely a UI-latency shortcut.
    onResetClicked?.();

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

  // Patch #84: derived state for the Queue (Hourglass) button. Armed
  // when queuedText !== null. Disabled when either the transport is
  // down (mirrors the canSend gate the removed Send button used) OR
  // when text is empty AND we're not already armed — an armed button
  // must always be clickable so the user can cancel.
  const queueArmed = queuedText !== null;
  const queueDisabled =
    canSend === false || (queuedText === null && text.trim() === "");

  // Phase 16: send-button slot visibility gates.
  //
  // showMicButton: mic replaces the send button ONLY when all conditions hold:
  //   - navigator.mediaDevices is available (browser supports getUserMedia; also
  //     serves as the JSDOM guard so existing tests that don't mock mediaDevices
  //     still see the Send button — those tests exercise the non-voice path)
  //   - voice is idle (not recording, not transcribing)
  //   - textarea is blank (whitespace-only counts as empty)
  //   - aside-morph is NOT active (X-for-Resume owns the slot when true)
  //   - queue is NOT armed (pending-overlay owns the slot when armed)
  //   - no attachments staged (send-with-attachment path owns the slot)
  // In every other idle scenario the existing send/X-for-Resume button renders.
  //
  // showRecordingControls: while recording, the three-button controls own the slot.
  //   MicButton and send button are both hidden.
  //
  // showTranscribingSend: during the STT round-trip, the existing send button
  //   renders disabled so rapid-tap cannot double-fire (T-16-16 mitigation).
  const showMicButton =
    typeof navigator !== "undefined" &&
    navigator.mediaDevices != null &&
    voice.state === "idle" &&
    text.trim().length === 0 &&
    !asideActive &&
    !queueArmed &&
    !hasAttachments;
  const showRecordingControls = voice.state === "recording";
  const showTranscribingSend = voice.state === "transcribing";

  // Phase 16: merge voice.errorMessage into the existing displayError. The error
  // display block renders only one message at a time; voice errors are transient
  // (cleared when recording starts again), so they coexist safely with compose errors.
  const displayError = errorMessage ?? voice.errorMessage;

  // Patch #129: inside-textarea Send button disabled predicate. Locked with
  // Ashley 2026-07-23 (console-iterated visual). Truth table:
  //   - queueArmed → disabled (button lives under the queueArmed overlay
  //     but native disabled is belt-and-suspenders vs the overlay's
  //     pointer-events-none).
  //   - canSend === false && !hasAttachments → disabled (text-only send
  //     would fail with no transport; attachment path routes independently
  //     via onSendWithAttachments so it survives a canSend===false WS state).
  //     STRICT === false (not `!canSend`): canSend is optional and defaults
  //     to undefined at the read-only PrettyView call sites; treating undefined
  //     as "not sendable" would over-disable. Matches every other button in
  //     this file (see `disabled={canSend === false}` on the aux-row buttons).
  //   - text.trim() === "" && !hasAttachments → disabled (nothing to send).
  const sendDisabled =
    queueArmed ||
    (canSend === false && !hasAttachments) ||
    (text.trim() === "" && !hasAttachments);

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
      {/* Phase 05: chip strip mounts above the compose rows when at
          least one attachment is staged (UPLOAD-04 mounting rule).
          AttachmentChipStrip returns null when the list is empty,
          so no wrapper conditional needed here (Row 3 ephemeral). */}
      <AttachmentChipStrip
        attachments={stagedAttachments ?? []}
        onRemove={onRemoveAttachment ?? (() => {})}
      />
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
      <div className={cn("flex items-center gap-2", isTouchDevice ? "min-h-[44px]" : "min-h-8")}>
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
          className="h-7 w-[var(--meter-width)] rounded-md flex flex-row p-[3px] bg-[rgba(10,12,20,0.6)] border border-[rgba(220,225,245,0.1)] shadow-[inset_0_2px_6px_rgba(0,0,0,0.55),_0_1px_0_rgba(220,225,245,0.05)]"
          style={{"--seg-count": SEG_COUNT, "--meter-width": "160px"} as React.CSSProperties}
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
            onClick={handleResetSend}
            disabled={canSend === false || asideActive === true}
            aria-label="Send with /id reset prefix"
            title="Send with /id reset prefix"
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
        {/* Aux-button group — least-used (paperclip) on the left,
            most-used (Queue) on the right, mirroring distance-from-
            meter logic. Converted from flex-col to flex-row for the
            horizontal Row 1 layout.
            Patch #83 marker: RotateCcw lives in the meter's reset cell.
            Patch #84 marker: Queue button arms the idle-watchdog. */}
        <div className="flex flex-row gap-1">
          {/* Toggle-pretty-off button — flips pretty view off, revealing
              the raw xterm.js underneath (same effect as Ctrl+Shift+O).
              Not gated on canSend or asideActive: it's a view-mode
              escape hatch and must stay reachable regardless of send
              state or aside display. Same warm-neutral Glass treatment
              as the paperclip/stop cluster. */}
          {onTogglePrettyMode && (
            <Button
              size="icon-sm"
              variant="outline"
              onClick={() => onTogglePrettyMode?.()}
              aria-label="Switch to terminal view (Ctrl+Shift+O)"
              title="Switch to terminal view (Ctrl+Shift+O)"
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
              <Terminal className="size-4" />
            </Button>
          )}
          {/* Paperclip attach button (Phase 05 UPLOAD-03). Gated by
              `showPaperclip` only. Patch #123 decoupled visibility from
              the touch-device row-height gate so desktop can also opt
              in — original patch #102 / patch #104 context still applies
              for the mobile use case (touch devices lack drag-drop and
              file-shape paste, so the paperclip is their primary attach
              entry point). Matches ThumbsUp's warm-neutral Glass
              treatment. */}
          {showPaperclip && (
            <Button
              size="icon-sm"
              variant="outline"
              onClick={handleOpenFilePicker}
              disabled={canSend === false || asideActive === true}
              aria-label="Attach file"
              title="Attach file"
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
              <Paperclip className="size-4" />
            </Button>
          )}
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
              variant="outline"
              onClick={() => onInterrupt?.()}
              aria-label="Interrupt (send Ctrl-C)"
              title="Interrupt (Ctrl-C)"
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
            variant="outline"
            onClick={() => { onGoodToGo?.(); handleQuickSend("let's go"); }}
            disabled={canSend === false || asideActive === true}
            aria-label="Send 'let's go'"
            title="Send 'let's go'"
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
          {/* Patch #152: Lightbulb "explain" quick-reply — mirrors the
              ThumbsUp pattern (same warm-neutral Glass treatment, same
              disable rule) but its payload is a canned /explain prompt
              asking for a concise re-explanation of the turns since
              Ashley's last message. Semantically distinct: ThumbsUp is
              "proceed", this is "make it legible for me". */}
          <Button
            size="icon-sm"
            variant="outline"
            onClick={() => handleQuickSend("/explain concisely whatever's gone on since my last message (and ONLY since my last message) without using code symbols, in a conceptual model style. Not a metaphor and don't recast it as an extended analogy.")}
            disabled={canSend === false || asideActive === true}
            aria-label="Ask for a concise re-explanation"
            title="Ask for a concise re-explanation"
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
            <Lightbulb className="size-4" />
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
            disabled={queueDisabled || asideActive === true}
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
        </div>
      </div>
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
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={queueArmed}
          placeholder={`Message ${identityName || "Claude"}…`}
          rows={1}
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
        {/* Phase 16: send-button slot — conditional rendering based on voice state.
            The slot hosts exactly ONE of: RecordingControls (while recording),
            MicButton (idle + empty text + not morphed/queued/attached), or
            the existing Send/X-for-Resume button (all other cases). Only one
            renders at a time — do NOT render multiple simultaneously. */}
        {showRecordingControls ? (
          /* Phase 16: while recording, the three-button controls OWN the slot.
             RecordingControls is absolutely positioned at right-1 bottom-0.5
             (same anchor as MicButton) and handles its own flex layout.
             D-16-06: no timer, no waveform, no level meter here. */
          <RecordingControls
            onCancel={handleVoiceCancel}
            onAppend={() => { void handleVoiceAppend(); }}
            onSend={() => { void handleVoiceSend(); }}
          />
        ) : showMicButton ? (
          /* Phase 16: idle + empty text + not morphed/queued/attached →
             render the mic button. voice.start() is passed directly (NOT
             wrapped in async) so the first statement inside is the
             synchronous getUserMedia call (D-16-02 iOS Safari constraint). */
          <MicButton onClick={voice.start} title="Record voice" />
        ) : (
          /* Phase 14 Wave 4 (Task 2): SAME BUTTON, branched attributes.
             When asideActive=true the button morphs to a Resume affordance —
             X icon + identity-hue color + onClick fires onAsideDismiss?.()
             instead of handleSend(). Per PATTERNS.md L186-234, we morph in
             place (same <button> element) so DOM identity is preserved
             across the morph transition — focus, keyboard tab order, and
             parent-CSS selectors don't blink. Do NOT split into two sibling
             buttons; do NOT wrap in a conditional-render component.
             Phase 16: showTranscribingSend=true adds disabled={true} during
             the STT round-trip so rapid-tap cannot double-fire (T-16-16). */
          <button
            type="button"
            onClick={() => {
              if (asideActive) { onAsideDismiss?.(); return; }
              if (!sendDisabled) handleSend();
            }}
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
                  different icon (patch #130 write-up). */
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
