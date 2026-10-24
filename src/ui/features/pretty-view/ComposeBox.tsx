import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createLogDedup } from "@/lib/log-dedup";
import { AudioLines, Ban, Check, LoaderCircle, Mic, MicOff, Paperclip, Pause, Plus, RefreshCw, Square, ThumbsUp, Volume2, X } from "lucide-react";
import { Button } from "@/components/button";
import { Textarea } from "@/components/textarea";
import { cn } from "@/lib/utils";
import {
  flushComposeDraftKeepalive,
  getComposeDraft,
  putComposeDraft,
} from "@/api/compose-drafts-api";
import { stampIdentitySendLog } from "@/api/identity-send-log-api";
// Phase 90 Plan 00 Wave 0 Task 3 (D-03 mechanical rewire, user 2026-09-08):
// the reset button dispatches through the new backend `/agent-reset/:hostId/
// :tmuxSessionName` endpoint instead of routing through the pretty-view WS
// funnel. Same behavior end-to-end (drain-sweep + text-clear + onResetClicked
// + error-message discipline PRESERVED verbatim) — only the dispatch call
// target changes. Plan 06's relay-pane badge appendage will hit the SAME
// endpoint as a first-class caller (single seam for both surfaces).
import { authApi } from "@/main-axios";
import { seedSessionLastMessageAt } from "@/state/session-working-store";
import { AttachmentChipStrip, type StagedAttachmentLike } from "./AttachmentChipStrip";
// Quick 260823-8ji: attachment-path awaits the batch outcome to gate the
// compose textarea + attachment-chip clear on a genuine success signal.
import type { BatchOutcome } from "./use-pretty-view-uploads";
import { useVoiceRecording } from "./useVoiceRecording";
import { HOLD_OUTCOME_MS, useHoldToRecord } from "./useHoldToRecord";
import { useVoiceMode, type VoiceModeMessage, type VoiceModePhase } from "./useVoiceMode";
import {
  registerManualRecording,
  useManualRecordingAnywhere,
  useVoiceModeActiveAnywhere,
} from "./voice-mode-registry";
import { MicButton } from "./MicButton";
import { SkillActionsButton } from "./SkillActionsButton";
import { RecordingControls } from "./RecordingControls";
import { HoldFeedbackPill, type HoldFeedback } from "./HoldFeedbackPill";
import { MemoryGauge, memoryBand } from "./MemoryGauge";
import { appendVoiceLabel } from "./voice-label";

// Compose-and-send box for the pretty view.
//
// Design decisions (per plan 02-02 and D-46 through D-58):
//
// 1. Enter-sends, Shift-Enter-newlines (COMPOSE-02 per D-48).
//    handleKeyDown only intercepts plain Enter; Shift-Enter falls
//    through to browser default textarea behavior (newline insertion).
//    On touch devices Enter never sends — it always inserts a newline,
//    and the Send button is the only send path.
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
// 4. Optimistic display on send (Phase 50 D-18 — was HARD LOCK; reversed.
//    See .planning/phases/50-optimistic-message-bubbles/50-CONTEXT.md
//    D-01/D-18/D-19). handleSend now fires onOptimisticSend synchronously
//    with the WS write so PrettyView seeds a pending bubble that shows an
//    inline spinner until a matching kind:"message" role:"user" WS frame
//    arrives. On success: clear textarea. On failure: keep text and show
//    error (PrettyView also flips the pending bubble to red per D-20).
//
// 5. Newlines normalized on send: LF preserved, CR eliminated (Ink
//    safety). Supersedes D-50's collapse-to-spaces — see
//    normalizeNewlinesForSend for the full rationale.
//
// 6. Draft body persistence (patch #57).
//
// Phase 16 (voice input, plan 03): Mic button lives in the SAME slot as the
// send button (D-16-01). Visibility rule (computed as `showMicButton`):
//   voice.state === "idle" && text.trim() === "" && !asideActive && !hasAttachments
// In every other idle scenario the existing send/X-for-Resume button renders.
// While `voice.state === "recording"`, RecordingControls own the slot.
// While `voice.state === "transcribing"`, the existing send button renders disabled.
//
// handleSend accepts an optional `overridePayload?: string` (D-16-05): when
// provided, it is used as the send payload instead of the current `text` state.
// This lets voice.endSend pass the glued transcript synchronously without
// fighting React's async setState batching. ALL handleSend behavior (attachment
// branching, newline normalization, Phase 50 D-18 optimistic-bubble seeding)
// still applies.
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
//    NO ERROR UI on failed autosave — mirrors the same "no ghost UI that
//    lies about state" posture that Phase 50 D-19 keeps for the autosave
//    path (autosave has no optimistic surface, only the send path does).
//    The retry loop is the recovery mechanism.

const DEBOUNCE_MS = 400;

// Phase 31 D-17: module-scoped dedup for [tap] events — tap events fire
// frequently on scroll/pointer flicker so we suppress repeats within 3s
// windows (N=5, W=3000ms — slightly higher N than default because tap volume
// is chatter, shorter W because taps cluster in bursts).
const tapDedup = createLogDedup({ N: 5, W: 3000 });

// Patch #119 — draft-loss belt-and-suspenders: localStorage mirror for the
// compose draft body. Survives any server-side failure mode (bad load key,
// DB not ready, auth, container recreate mid-typing). Hydrate path: if
// server returns empty AND localStorage has content, restore from ls and
// schedule an autosave so the server catches up. Diagnostic console.warns
// on save/load help narrow the still-unknown root cause of post-restart
// draft loss.
//
// Key is namespaced by the currently-logged-in user. A draft typed by
// user A must not be visible when user B logs into the same browser
// (session content is already shared across users with host access, but a
// draft is unsent-private "what I was going to say" content). getCurrentUser()
// reads localStorage.skynet_auth which is set by storeAuth() on login and
// cleared by clearStoredAuth() on logout. Fallback to "__anon" is defensive:
// compose box is only mounted when logged in, so in practice this branch is
// unreachable; the fallback exists so a race between logout and the save
// debounce cannot write an un-ownerable key.
import { getCurrentUser } from "@/state/user-scoped-cache";
import { kitConfirm } from "@/components/kit";

function composeDraftLsKey(
  hostId: number,
  tmuxSessionKey: string | null | undefined,
): string {
  const user = getCurrentUser() ?? "__anon";
  return `skynet:compose-draft:${user}:${hostId}:${tmuxSessionKey ?? ""}`;
}

// ============================================================================
// Quick 260823-8ji: attachment-path outcome-failure → user-facing string.
//
// Mapping keeps the compose surface's language consistent with the non-
// attachment path's "Not connected — try again in a moment" convention
// while distinguishing between the four failure reasons so the user knows
// whether to check their connection, wait, or expect an upload retry.
//
// The "superseded" reason returns "" and is never surfaced — the branch
// that would have called this helper for a superseded outcome returns
// early (a newer send is already driving the UI state; stomping it with
// an error would confuse the user).
// ============================================================================
type BatchFailureReasonForCompose = Exclude<BatchOutcome, { ok: true }>["reason"];

function getBatchFailureUserMessage(reason: BatchFailureReasonForCompose): string {
  switch (reason) {
    case "upload_failed":
      return "Upload failed — try again.";
    case "timeout":
      return "Upload timed out — check connection and try again.";
    case "ws_not_open":
      return "Not connected — try again in a moment.";
    case "ws_send_threw":
      return "Connection dropped — try again.";
    case "superseded":
      // never surfaced — the branch that would call this returns early.
      return "";
    default: {
      const _exhaustive: never = reason;
      void _exhaustive;
      return "Send failed — try again.";
    }
  }
}

// Interrupt-button fast-path throttle window. Matches the server-side
// INTERRUPT_THROTTLE_MS (2500ms) so this client guard never lets through a
// tap the server would only drop anyway — measured basis: Claude Code's
// exit-confirm window is ~0.8s (v2.1.150, 2026-09-16); two Ctrl-C presses
// inside it terminate the harness; 2500ms is ~3× that for margin. Note: this
// client ref is only a cheap fast-path. The AUTHORITATIVE guard is the
// server-side per-pane throttle in claude-session-server.ts — see
// interruptLastFireRef below for why the client ref cannot be the guarantee.
export const INTERRUPT_THROTTLE_MS = 2500;

export interface ComposeBoxProps {
  // Called when the user presses Enter (no shift) with non-empty text.
  // The caller normalizes newlines before calling onSend (CR eliminated, LF
  // preserved), so this may receive a MULTI-LINE payload containing LFs but
  // never a CR.
  // Return true if the send WAS DISPATCHED to the underlying transport;
  // return false if the transport was unavailable (e.g., WS disconnected).
  // The component uses the return to decide whether to clear the textarea
  // (true) or preserve the text and show an inline error (false).
  //
  // Phase 50 D-18 (Blocker #4 pre-req): the second `mqid` arg carries the
  // ComposeBox-generated optimistic-send identifier so PrettyView →
  // IdentitySessionPane → pvSendInputRef → backend armPvSendWatchdog all
  // key their state under the SAME mqid. Optional at the prop-type level
  // for back-compat with existing test doubles that pass `(text) => true`
  // and for any caller that doesn't participate in the pending-bubble
  // flow.
  onSend: (text: string, mqid?: string) => boolean;
  // Phase 50 D-01/D-03: called synchronously from handleSend just before
  // onSend (immediateFailure:false), and again after onSend returns false
  // (immediateFailure:true, D-20 immediate-red-bubble on WS unavailable).
  // The same mqid flows into both calls so PrettyView can track a single
  // PendingSend record and just update its state on the second call.
  // Optional so read-only or non-PrettyView callers stay backward-compat.
  //
  // Phase 80 D-16: optional attachments field for attachment-carrying
  // pending seeds. Text-only funnel callsites (useComposeSend at L471 /
  // L487) omit the field — backward-compat by construction. The seed for
  // attachment sends does NOT fire from ComposeBox at all (per RESEARCH.md
  // § Option B): it fires from PrettyView's onUploadReadyToInject closure
  // in Plan 02, which passes attachments through to handleOptimisticSend.
  // The prop-type widening here is what lets that Plan-02 call typecheck
  // against the shared callback contract.
  onOptimisticSend?: (args: {
    payload: string;
    mqid: string;
    immediateFailure: boolean;
    attachments?: Array<{
      filename: string;
      size: number;
      mimetype: string;
    }>;
  }) => void;
  // Phase 50 D-03 failure-path repopulate surface. When this prop
  // transitions from null/undefined → non-empty string, the useEffect
  // populates the textarea with the value AND fires onOverrideTextConsumed
  // in the same effect (Warning #6 resolution: an ack callback lets the
  // parent transition composeOverrideText back to null cleanly without
  // the effect re-firing on unchanged references).
  overrideText?: string | null;
  // Phase 50 D-03 / Warning #6: ack callback for the overrideText one-way
  // trigger. Fires synchronously in the same useEffect as the setText
  // call. Parent (PrettyView) uses this to clear composeOverrideText
  // back to null so a subsequent parent re-render doesn't force-repopulate
  // the textarea with the same value.
  onOverrideTextConsumed?: () => void;
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
  // Square-icon "stop" button to the left of the ThumbsUp button. On
  // click it sends a WS `interrupt` message; the backend fires
  // `tmux send-keys ... C-c` into the attached tmux session. Ctrl-C is
  // used because it is the only keystroke that both interrupts mid-turn
  // work AND clears the entire multi-line draft in ONE press (measured:
  // 1x Ctrl-C cleared a 3-line draft; Escape needs a fast double-press
  // and the throttle blocks that, so it was never reachable). The
  // hazard Ctrl-C carries — two presses inside Claude Code's ~0.8s
  // exit-confirm window terminate the harness — is handled by the
  // server-side per-pane throttle in claude-session-server.ts, not by
  // this client ref. The button throttles onClick to at most one fire
  // per INTERRUPT_THROTTLE_MS as a cheap fast-path (see
  // interruptLastFireRef), but that is NOT the authoritative guard.
  // When omitted the button does not render — read-only PrettyView
  // callers stay clean.
  onInterrupt?: () => void;
  // The agent's main turn is working (background sub-agents don't count —
  // they run on through a Stop). The composer's main button is Stop then,
  // while nothing is typed.
  agentWorking?: boolean;
  // Claude Code is waiting on a dialog (permission prompt etc.): a quiet Stop
  // sits beside the thumbs-up so an interrupt is always reachable.
  agentWaiting?: boolean;
  // shape-interrupt-button: true while a send is still being delivered (its
  // message has not landed in the transcript yet) — there is nothing in the
  // harness to stop or cancel, so the button is greyed out. Static look only:
  // no label or tooltip changes.
  interruptDisabled?: boolean;
  // What the last press is doing: "stopping" until the server's verdict comes
  // back, then the outcome for a moment. Null = the plain Stop button.
  interruptFeedback?: InterruptFeedback | null;
  // shape-interrupt-button: words handed back by a cancelled send. Applied
  // once per id: into the primary box when it is empty, otherwise into a new
  // queued box at the top (never overwriting what the user is typing).
  // onRestoreApplied reports which box received them so the caller can put
  // the cancelled message's attachments back on the same box.
  restoreRequest?: { id: string; text: string } | null;
  onRestoreApplied?: (id: string, target: string) => void;
  // When false, Enter is still accepted for typing (textarea not disabled)
  // but Send button is visually disabled. The send attempt will fail and
  // show the inline error — the component does not need to pre-emptively
  // block the attempt since onSend returns false when WS is not ready.
  canSend?: boolean;
  // Patch #122: when true, force all meter well segments to their unlit
  // state (well glow, border, and background stay intact). user UX rule:
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
  // Optional: pane's registered identity displayName (e.g. "Tina"). Threaded
  // to the send funnel for stamped-log identity attribution + present/empty
  // gating (see useComposeSend). No longer feeds the textarea placeholder —
  // that copy is now universal ("Write a message…") since the identity badge
  // + project breadcrumb carry the who/where context.
  identityName?: string;
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
  /**
   * Phase 93 D-11: compose chrome mode. When "relay", the Row 1 instrument
   * bar (meter/reset/queue/stop/thumbs-up) AND the Paperclip attach
   * button are HIDDEN monolithically. Textarea + Send visual shell unchanged
   * per D-12. Default "harness" preserves today's behavior at every call site.
   */
  mode?: "harness" | "relay";
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
  //
  // Quick 260823-8ji: return shape widened from `void` to
  // `Promise<BatchOutcome>` so handleSend's attachment branch can await
  // a genuine success signal from the batch lifecycle before clearing the
  // compose textarea + attachment chips. On outcome.ok the compose state
  // clears; on !outcome.ok the state is PRESERVED (textarea keeps its
  // value, chips stay on-screen) and an inline error surfaces via
  // setErrorMessage(). Mirrors the non-attachment path's Phase 50 D-20 /
  // D-56 failure-preservation posture so user never loses a compose
  // draft to a silent-clear on WS drop / upload_failed / timeout again.
  // quick-260829-nt9: target param widened to optional string. Primary
  // handleSend passes no target (defaults to "primary" inside
  // usePrettyViewUploads.startBatch). Queued-slot entry points pass
  // "queued:<slotId>" so per-slot attachments route to the correct staging
  // area and don't collide with the primary target.
  onSendWithAttachments?: (caption: string, target?: string) => Promise<BatchOutcome>;
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
  // hidden (Send button, reset cell, paperclip, ThumbsUp,
  // Queue, Mic). Textarea REMAINS typeable so user can pre-draft the
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
  // For the aux buttons (attach, ThumbsUp, Queue) and Send-
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
  // disabled=true; reset, ThumbsUp, Queue all disabled). Textarea
  // REMAINS typeable so user can pre-draft her feedback message while the
  // plan-approval prompt is open — matches the recycleActive behavior verbatim.
  //
  // Why SEPARATE from asideActive AND recycleActive (per CONTEXT § "Do NOT
  // collapse"): asideActive MORPHS Send into X/Resume; recycleActive keeps
  // Send as Send but disabled. Because the Send-button behavior differs,
  // props stay independent. For every aux-button disable predicate that
  // reads `|| recycleActive === true`, also OR-in `|| reconnectingActive === true`.
  //
  // Pretty-view WS reconnect window (patch #148 auto-retry between an old
  // socket's onclose and a fresh session frame). During that ~2s window the
  // WS is not open so onSend would no-op silently; disable Send + reset +
  // ThumbsUp + Queue exactly like recycleActive.
  // Textarea, mic, and attach stay usable (mic records locally; attach
  // stores locally until Send). Independent prop rather than OR'd into
  // recycleActive so future readers of either prop keep their documented
  // semantics.
  //
  // Value from PrettyView: `status === "error"`.
  reconnectingActive?: boolean;
  /**
   * Hands-free voice mode feed (2026-10-06). When supplied, the aux row shows
   * the voice-mode toggle/status chip (see useVoiceMode, VoiceModeButton).
   * PrettyView supplies it for harness panes only.
   *   isWorking — agent-working signal (turn-end chime).
   *   messages  — pane message stream; new assistant replies are spoken.
   *   voices    — voice candidates, identity → role → fallback ([] = provider default).
   */
  voiceModeFeed?: {
    isWorking: boolean;
    messages: ReadonlyArray<VoiceModeMessage>;
    voices: readonly string[];
  };
  // Phase 56 (2026-08-23): the former dormancy-gate boolean prop was
  // DELETED. Compose stays enabled on dormant panes — send triggers invisible
  // wake at the backend send-path (Plan 56-01) with widened watchdog (Plan
  // 56-02). Dormancy is now invisible to the user; ComposeBox has no
  // dormancy-awareness.
  className?: string;
}

// ============================================================================
// Phase 68 Plan 01 D-01: co-located send-funnel hook.
//
// Extracts the core send transport from handleSend's text-only branch:
//   mqid generation → onOptimisticSend seed (pre-send + failure) → onSend
//   dispatch → submit-entry / submit-success / submit-failed logs.
//
// What the hook does NOT own (stays with each caller per PATTERNS.md §
// "Contract boundary"): setText, clearAfterSend, attachment branching,
// textarea focus, draft persistence, per-trigger UI cleanup.
//
// D-02: optional bubbleTextOverride — when provided, the optimistic bubble
// renders this text instead of the send payload. onSend always receives the
// original payload (e.g. the actual command text), not the override. Rationale:
// thumbs-up renders a 👍 icon; the bubble should show that from birth rather
// than "thumbs up" → icon flip.
//
// D-03: mqid is ALWAYS generated and threaded through — even for callers
// whose bubble will be render-blacklisted (reset). The backend Phase 56 wake
// gate fires on pretty-view submit shape (mqid presence); render-blacklist is
// honored by the render layer downstream, not by omitting the mqid here.
// ============================================================================
function useComposeSend(deps: {
  hostId: number;
  tmuxSession: string | null | undefined;
  identityName?: string;
  onSend: ComposeBoxProps["onSend"];
  onOptimisticSend: ComposeBoxProps["onOptimisticSend"];
}) {
  const { hostId, tmuxSession, identityName, onSend, onOptimisticSend } = deps;
  const send = useCallback(
    (
      payload: string,
      options?: { bubbleTextOverride?: string; trigger?: string },
    ): boolean => {
      const trigger = options?.trigger ?? "unknown";
      const bubbleText = options?.bubbleTextOverride ?? payload;

      // Phase 31 D-02: compose submit instrumentation — normal send path.
      // Format is verbatim from the pre-refactor handleSend L1493 so existing
      // test assertions on the log string continue to pass unmodified.
      console.info(
        `[compose] submit-entry hostId=${hostId} tmuxSession=${tmuxSession ?? "null"} bodyLen=${payload.length} attachmentCount=0 trigger=${trigger}`,
      );

      // Phase 85 (D-03/D-04/D-05/D-06): fire the universal send-log stamp.
      // (a) Backend POST to /identity-send-log/stamp — fire-and-forget so
      //     attempts count regardless of delivery success (D-05).
      // (b) Client-side optimistic advance of session-working-store so the
      //     row reorders instantly on this device (D-06), before the next
      //     fleet-status poll cadence would surface the backend change.
      // Guard: neither call fires when identityName or tmuxSession is
      // missing — the identity concept only applies inside a tmux session
      // and requires the identity name as the D-02 store key.
      if (identityName != null && identityName !== "" && tmuxSession != null) {
        const stampTs = Date.now();
        stampIdentitySendLog(identityName, stampTs);
        seedSessionLastMessageAt(hostId, tmuxSession, stampTs);
        console.info({
          operation: "compose_send_log_stamped",
          hostId,
          tmuxSession,
          identityName,
          ts: stampTs,
        });
      } else {
        console.info({
          operation: "compose_send_log_skipped",
          hostId,
          tmuxSession,
          identityName: identityName ?? null,
          reason:
            identityName == null || identityName === ""
              ? "missing_identity_name"
              : "missing_tmux_session",
        });
      }

      // Phase 50 D-01/D-18: generate the mqid ONCE per send. Pattern is
      // `pv-optim-<ms>-<8hex>` — deterministic-enough for FIFO ordering +
      // unique enough that concurrent sends don't collide.
      const mqid = `pv-optim-${Date.now()}-${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;

      // Phase 50 D-01: fire the optimistic-bubble seed BEFORE the WS send so
      // PrettyView renders the pending bubble on the same React frame as the
      // send dispatches. D-02: pass bubbleText (may be the override) to the
      // bubble; the raw payload goes to onSend unchanged.
      onOptimisticSend?.({ payload: bubbleText, mqid, immediateFailure: false });

      // D-03: mqid ALWAYS passed regardless of bubbleTextOverride or render-blacklist.
      const dispatched = onSend(payload, mqid);

      if (dispatched) {
        console.info(
          `[compose] submit-success hostId=${hostId} tmuxSession=${tmuxSession ?? "null"} bodyLen=${payload.length}`,
        );
      } else {
        console.warn(
          `[compose] submit-failed hostId=${hostId} tmuxSession=${tmuxSession ?? "null"} bodyLen=${payload.length} err="not-connected"`,
        );
        // Phase 50 D-20: fire a SECOND onOptimisticSend with immediateFailure
        // so PrettyView flips the just-seeded pending bubble to red state
        // immediately (no waiting on the 20s timer for the WS-not-open case).
        onOptimisticSend?.({ payload: bubbleText, mqid, immediateFailure: true });
      }

      return dispatched;
    },
    [hostId, tmuxSession, identityName, onSend, onOptimisticSend],
  );

  return { send };
}

const EMPTY_VOICE_MODE_MESSAGES: ReadonlyArray<VoiceModeMessage> = [];
const EMPTY_VOICE_MODE_VOICES: readonly string[] = [];

// Single words so the chip fits beside the meter, Stop and 👍 on a phone.
const VOICE_MODE_LABEL: Record<VoiceModePhase, string> = {
  off: "",
  starting: "Starting",
  listening: "Listening",
  hearing: "Hearing",
  transcribing: "Sending",
  speaking: "Speaking",
  paused: "Paused",
};

// Per-phase glyph tint. Deliberately not amber (VISUAL-08: Send owns amber).
const VOICE_MODE_COLOR: Record<VoiceModePhase, string> = {
  off: "var(--color-pv-fg)",
  starting: "#9fd3ff",
  listening: "#9fd3ff",
  hearing: "#d6f0ff",
  transcribing: "#c9c3ff",
  speaking: "#a8f0c8",
  paused: "#8a93a6",
};

/** Voice-mode chip tint while muted. */
const MUTED_COLOR = "#8a93a6";
/** A mute toggle that is on — the cancel button's red tint. */
const MUTE_ON_COLOR = "hsla(0,72%,72%,0.95)";

/** What the Stop button shows after a press (see PrettyView). */
export type InterruptFeedback = "stopping" | "stopped" | "cancelled" | "nothing" | "failed";

// Single words / short phrases so the chip fits in the aux row on a phone.
const INTERRUPT_FEEDBACK_LABEL: Record<InterruptFeedback, string> = {
  stopping: "Stopping",
  stopped: "Stopped",
  cancelled: "Cancelled",
  nothing: "Nothing to stop",
  failed: "Failed",
};

/**
 * Voice-mode toggle in the aux-button row (2026-10-09, replaced the mic
 * long-press + status pill). Off: an icon button that starts voice mode. On:
 * the button widens into a chip that IS the status display — phase glyph +
 * label (a tap on it skips speech while the agent is talking), a mute toggle
 * and an × that ends voice mode.
 */
/** Tooltip on mics / voice-mode buttons disabled because voice mode is on. */
const VOICE_MODE_ON_TITLE = "Voice mode is on";
/** Tooltip on voice-mode buttons disabled because a mic is recording somewhere. */
const MIC_RECORDING_TITLE = "A mic is recording";

function VoiceModeButton({
  phase,
  disabled,
  disabledTitle,
  onStart,
  onStop,
  onSkip,
  muted,
  onToggleMute,
}: {
  phase: VoiceModePhase;
  disabled: boolean;
  /** Tooltip shown instead of "Start voice mode" when disabled. */
  disabledTitle?: string;
  onStart: () => void;
  onStop: () => void;
  onSkip: () => void;
  muted: boolean;
  onToggleMute: () => void;
}) {
  if (phase === "off") {
    return (
      <button
        type="button"
        className="pv-cbtn"
        onClick={onStart}
        disabled={disabled}
        aria-label="Start voice mode"
        title={disabled && disabledTitle ? disabledTitle : "Start voice mode"}
        data-testid="voice-mode-button"
        data-phase="off"
      >
        <AudioLines aria-hidden="true" />
      </button>
    );
  }
  const busy = phase === "starting" || phase === "transcribing";
  // Muted while it would otherwise be listening: say so instead.
  const showMuted = muted && (phase === "listening" || phase === "hearing");
  const Glyph = busy
    ? LoaderCircle
    : phase === "speaking"
      ? Volume2
      : phase === "paused"
        ? Pause
        : showMuted
          ? MicOff
          : Mic;
  const label = showMuted ? "Muted" : VOICE_MODE_LABEL[phase];
  const speaking = phase === "speaking";
  return (
    <div
      data-testid="voice-mode-button"
      data-phase={phase}
      className="pv-voice-chip"
      style={{ color: VOICE_MODE_COLOR[phase] }}
    >
      <button
        type="button"
        onClick={speaking ? onSkip : muted || done ? onTalk : undefined}
        disabled={!speaking && !muted && !done}
        aria-label={speaking ? "Skip speech" : muted ? "Talk" : done ? "Done talking" : undefined}
        title={
          speaking ? "Skip" : muted ? "Talk (or press play on your headphones)" : done ? "Done — send and turn the mic off" : undefined
        }
      >
        <Glyph
          aria-hidden="true"
          className={cn(
            busy && "animate-spin",
            (phase === "hearing" || speaking) && "animate-pulse",
          )}
        />
        <span role="status" aria-live="polite">{label}</span>
      </button>
      <button
        type="button"
        onClick={onToggleMute}
        aria-label={muted ? "Unmute mic" : "Mute mic"}
        aria-pressed={muted}
        title={muted ? "Unmute mic" : "Mute mic"}
        data-testid="voice-mode-mute"
        className={cn(
          "flex items-center rounded p-1 cursor-pointer hover:bg-[rgba(220,225,245,0.12)]",
          !muted && "opacity-70 hover:opacity-100",
        )}
        style={muted ? { color: MUTE_ON_COLOR } : undefined}
      >
        {muted ? <MicOff aria-hidden="true" className="size-3.5" /> : <Mic aria-hidden="true" className="size-3.5" />}
      </button>
      <button
        type="button"
        onClick={onStop}
        aria-label="End voice mode"
        title="End voice mode"
      >
        <X aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Stands in for the Stop button from the press until a moment after the
 * outcome: a spinner while the verdict is pending, then what happened.
 */
function InterruptFeedbackChip({ feedback }: { feedback: InterruptFeedback }) {
  const Glyph = feedback === "stopping" ? LoaderCircle : feedback === "nothing" || feedback === "failed" ? Ban : Check;
  return (
    <div
      data-testid="interrupt-feedback"
      data-feedback={feedback}
      className="pv-cchip"
    >
      <Glyph aria-hidden="true" className={cn(feedback === "stopping" && "animate-spin")} />
      <span aria-hidden="true">{INTERRUPT_FEEDBACK_LABEL[feedback]}</span>
    </div>
  );
}

export function ComposeBox({
  onSend,
  onOptimisticSend,
  overrideText,
  onOverrideTextConsumed,
  onResetClicked,
  canSend,
  isHolding,
  contextPct,
  hostId,
  tmuxSession,
  identityName,
  onGoodToGo,
  onInterrupt,
  agentWorking,
  agentWaiting,
  interruptDisabled,
  interruptFeedback,
  restoreRequest,
  onRestoreApplied,
  stagedAttachments,
  onRemoveAttachment,
  showPaperclip,
  mode = "harness",
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
  reconnectingActive,
  voiceModeFeed,
  className,
}: ComposeBoxProps) {
  // Phase 05 — hidden file input driven by the paperclip button. When the
  // input's change event fires, we normalize the FileList to a plain array
  // and hand it to onAttachFiles (which the parent hook's stageAttachments
  // then consumes). Clearing input.value after selection allows the same
  // file to be re-picked later — some browsers otherwise no-op a repeat
  // selection because the "value hasn't changed."
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Interrupt-button fast-path double-tap guard. Holds the last-fire
  // timestamp; onClick silently no-ops any tap within
  // INTERRUPT_THROTTLE_MS of the previous fire. Button stays visually
  // clickable so it still feels responsive to a panic tap.
  //
  // WHY THIS REF CANNOT BE THE AUTHORITATIVE GUARD:
  //   1. Per-view, not per-pane: each ComposeBox instance holds its own
  //      ref. Phone + desktop on the same conversation are two independent
  //      refs; each can individually respect the window while still
  //      landing two Ctrl-Cs ~200ms apart at the same pane.
  //   2. It times the click, not the arrival: execCommand has no timeout
  //      and unbounded latency, so jitter can compress a compliant pair
  //      below the ~0.8s harness-death threshold in flight.
  //   3. A stale bundle enforces whatever constant it shipped with.
  // The AUTHORITATIVE guard is the server-side per-pane throttle in
  // claude-session-server.ts, keyed by (hostId, tmuxSession).
  //
  // Historical note: the original comment claimed a double-Escape would
  // open Claude Code's rewind menu "which pretty-view users have no way
  // to dismiss." Measured: the menu renders `Esc to cancel` and a single
  // Escape dismisses it — self-healing from the bubble surface. That
  // rationale was false. Post-change it is moot: the hazard is now
  // harness death via double Ctrl-C.
  const interruptLastFireRef = useRef<number>(0);
  // Guards async setState from firing after unmount. Load-bearing for
  // dispatchResetPayload's .then/.catch (line ~2029/2038) — under JSDOM
  // teardown a stale promise resolving after the component unmounts
  // schedules a React setState that hits `resolveUpdatePriority`, which
  // needs `window` — and JSDOM has already torn `window` down by then.
  // Result: unhandled-rejection false-positive in the full test suite.
  // The isMounted guard prevents the setState call entirely so React
  // never asks for update priority. Standard React defensive pattern.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
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
  // Phase 50 D-03 failure-path repopulate surface. Warning #6 (checker
  // feedback iteration 1): onOverrideTextConsumed acks the one-way
  // overrideText trigger so the parent (PrettyView) can transition
  // composeOverrideText back to null without the useEffect re-firing on
  // unchanged references. Fires ONLY when overrideText is a non-empty
  // string; null / undefined / "" no-op.
  useEffect(() => {
    if (typeof overrideText === "string" && overrideText.length > 0) {
      setText(overrideText);
      onOverrideTextConsumed?.();
    }
  }, [overrideText, onOverrideTextConsumed]);
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

  // Marks the id of a slot that was JUST created via the QueuePlusTab click
  // so QueuedRow can focus its textarea on mount. Not used for hydrated /
  // draft-restored slots — those keep whatever focus the user had on load.
  // QueuedRow clears the ref the moment it consumes it.
  const justAddedSlotIdRef = useRef<string | null>(null);

  const handleAddSlotAtTop = (): void => {
    const id = makeSlotId();
    justAddedSlotIdRef.current = id;
    setQueueSlots((prev) => [{ id, text: "" }, ...prev]);
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
  const heldPctRef = useRef<number | null>(null);
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
  // like ThumbsUp ("thumbs up") produce message bubbles asynchronously —
  // the underlying session decides when the message lands — so user
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
    // Phase 97 UAT follow-up (2026-09-10): relay-source panes have no
    // hostId + no tmuxSession, so a PUT to /compose-drafts would 400 with
    // "hostId is required". Skip the persist attempt in relay mode; clear
    // the dirty flags so we don't accumulate. (Relay-source drafts, if
    // needed, would use a separate storage key — separate design.)
    if (mode === "relay") {
      dirtyBodyRef.current = null;
      dirtyQueueSlotsRef.current = null;
      return;
    }
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
      // tried to send. No error UI on the AUTOSAVE path — send path
      // optimistic bubbles live on PrettyView per Phase 50 D-01.
      const latestBody = latestBodyRef.current;
      const latestSlots = latestQueueSlotsRef.current;
      dirtyBodyRef.current = latestBody;
      dirtyQueueSlotsRef.current = latestSlots;
    }
  }, [hostId, tmuxSessionKey, mode]);

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

  // shape-interrupt-button: give a cancelled send's words back. Applied once
  // per request id; the primary box only when it holds nothing (no text, no
  // staged attachments), otherwise a new queued box at the top.
  const appliedRestoreIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!restoreRequest || appliedRestoreIdsRef.current.has(restoreRequest.id)) return;
    appliedRestoreIdsRef.current.add(restoreRequest.id);
    const primaryEmpty = latestBodyRef.current.trim() === "" && !hasAttachments;
    if (primaryEmpty) {
      setText(restoreRequest.text);
      latestBodyRef.current = restoreRequest.text;
      scheduleAutosave(restoreRequest.text);
      console.info(`[interrupt-restore] applied id=${restoreRequest.id} target=primary textLen=${restoreRequest.text.length}`);
      onRestoreApplied?.(restoreRequest.id, "primary");
      return;
    }
    const slotId = makeSlotId();
    const nextSlots = [{ id: slotId, text: restoreRequest.text }, ...latestQueueSlotsRef.current];
    latestQueueSlotsRef.current = nextSlots;
    setQueueSlots(nextSlots);
    scheduleAutosave(latestBodyRef.current, nextSlots);
    console.info(`[interrupt-restore] applied id=${restoreRequest.id} target=queued:${slotId} textLen=${restoreRequest.text.length} reason=primary_in_use`);
    onRestoreApplied?.(restoreRequest.id, `queued:${slotId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreRequest]);

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

    // Phase 97 UAT follow-up (2026-09-10): relay-source panes have no
    // hostId + no tmuxSession, so a compose-drafts fetch always 400s with
    // "hostId is required" and pollutes the console tape. Skip the fetch
    // in relay mode — relay-source panes don't have per-tmux draft
    // persistence today (if that becomes a requirement, it'd be a
    // separate design with its own storage key, not this endpoint).
    if (mode === "relay") {
      return;
    }

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
      // Phase 97 UAT follow-up: skip keepalive in relay mode — the
      // endpoint requires hostId which is 0 for relay panes.
      if (
        mode !== "relay" &&
        (dirtyBodyRef.current !== null || dirtyQueueSlotsRef.current !== null)
      ) {
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
    // Phase 97 UAT follow-up: `mode` added so the effect re-runs when a
    // pane switches between harness / relay — the relay early-return
    // above must re-evaluate on mode change.
  }, [hostId, tmuxSessionKey, clearDebounce, scheduleAutosave, mode]);

  // pagehide + visibilitychange keepalive flush. Fires only when there's
  // a dirty body or queueSlots pending — idle panes cost zero unload-time bandwidth.
  // Bounty message-queue-in-pretty-view: queueSlots included in the keepalive
  // payload alongside body.
  useEffect(() => {
    const onPageHide = () => {
      // Phase 97 UAT follow-up: skip keepalive in relay mode — the
      // endpoint requires hostId which is 0 for relay panes. Same
      // rationale as the load-on-mount + flushDirty early-returns.
      if (mode === "relay") return;
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
  }, [hostId, tmuxSessionKey, mode]);

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

  // Auto-focus on mount so user can start typing immediately after
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
  // user reports 3 correlated iOS PWA symptoms: (a) bottom 2 of 5 lines
  // dismiss the keyboard on tap-to-reposition, (b) cursor lands INSIDE a
  // letter on multi-line, (c) single-line ignores tap-to-reposition but
  // keeps the keyboard open. All point to a coordinate-system mismatch
  // between iOS's tap-to-caret math and the textarea's actual rendered
  // box. Passive listeners only — NO preventDefault, NO state writes.
  // Logs go through the console-forwarder (patch #146) → durable path at
  // /opt/skynet/console-forward-logs/console-forward.log (patch #326).
  // Revert after user reproduces + we have data on the actual offset.
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

  const funnel = useComposeSend({ hostId, tmuxSession, identityName, onSend, onOptimisticSend });

  // Patch #135: auto-grow the textarea with its CONTENTS (not just newlines).
  // The prior newline-count `rows` heuristic left long single-line messages
  // clipped because wrapped visual lines never added a \n. We set height
  // imperatively from scrollHeight, capped at 15 line-heights (bumped from 6
  // on user request 2026-09-28 — long messages felt cramped in the old cap),
  // with overflow-y switching to 'auto' once the text no longer fits.
  // Setting height='auto' first is REQUIRED — without it, scrollHeight only
  // grows (never shrinks) as text is deleted.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (maxHeightPxRef.current === null) {
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      maxHeightPxRef.current = Number.isFinite(lh) && lh > 0 ? lh * 15 : 360;
    }
    el.style.height = "auto";
    const clamped = Math.min(el.scrollHeight, maxHeightPxRef.current);
    el.style.height = clamped + "px";
    // Scroll whenever the text doesn't fit as drawn — the stylesheet's
    // max-height (a share of the window) can cut in below the 15-line cap.
    const shown = el.clientHeight || clamped;
    el.style.overflowY = el.scrollHeight > shown + 1 ? "auto" : "hidden";
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

  // Newline policy helper: preserve LF, eliminate CR. Ink safety.
  // Extracted from handleSend so queue-slot sends reuse the same logic.
  //
  // Supersedes the original D-50 rule (collapse ALL newlines to spaces,
  // 2026-07-17). D-50's stated hazard was Ink's REPL treating an embedded
  // *CR* as a mid-message submit, and it landed BEFORE patch #118
  // (2026-07-22) made the transport multi-line-safe by dispatching Enter as
  // a real key event over a separate `tmux send-keys` exec channel. Since
  // #118, terminal.ts:680-683 has stated that internal CRs/LFs survive in
  // the body write so a multi-line message arrives as one submit. The
  // frontend collapse was never revisited and had become vestigial for LF.
  //
  // Re-verified empirically 2026-09-16 against live claude v2.1.150 on
  // tmux 3.4: an LF-bearing body sent via `send-keys -l` renders as real
  // lines in the composer with NO premature submit, and a following
  // separate `send-keys Enter` submits it as ONE message. A bare CR does
  // the opposite — it fires a submit at the CR, splitting one user message
  // into two. So CR is the actual hazard and LF is safe.
  //
  // Hence: map CRLF and lone CR to LF, leave LF alone. The trailing-CR
  // submit sentinel is NOT affected — it is appended downstream at
  // IdentitySessionPane.tsx:369 (`send(text + "\r", mqid)`), after this
  // transform, and the backend split gate reads it there
  // (claude-session-server.ts:3227). This helper only ever sees interior
  // newlines.
  function normalizeNewlinesForSend(s: string): string {
    return s.replace(/\r\n?/g, "\n");
  }

  // Bounty message-queue-in-pretty-view: per-slot send handler.
  // Routes through the same onSend(text) prop the primary uses:
  // - newline normalization applied (CR out, LF preserved)
  // - Phase 50 D-18: primary handleSend seeds an optimistic bubble via
  //   onOptimisticSend; queue-slot sends currently do NOT (out of scope
  //   for phase 50 — queue slots have their own visual affordance in the
  //   drawer, so the perceived-responsiveness gap this phase closes is
  //   scoped to the primary handleSend path). Revisit if queue-slot sends
  //   grow their own dead moment.
  // - On success: remove slot from state + trigger autosave
  // - On failure: keep slot + surface errorMessage (mirrors primary handleSend)
  function handleQueueSlotSend(slotId: string) {
    const slot = queueSlots.find((s) => s.id === slotId);
    if (!slot) return;
    const trimmed = slot.text.trim();
    const slotTarget = `queued:${slotId}`;
    const slotAttachments = getStagedAttachmentsForTarget?.(slotTarget) ?? [];
    // Attachment-only slots are sendable (parity with primary handleSend).
    if (!trimmed && slotAttachments.length === 0) return;

    // quick-260829-nt9: attachment branch — mirrors primary handleSend at
    // L1384-1415. If this slot has staged attachments and onSendWithAttachments
    // is wired, route through the attachment path (awaits upload_ready_to_inject
    // before removing the slot). Text-only path below is unchanged.
    if (slotAttachments.length > 0 && onSendWithAttachments) {
      setErrorMessage(null);
      const captionPayload = normalizeNewlinesForSend(trimmed);
      console.info(`[compose] submit-entry hostId=${hostId} tmuxSession=${tmuxSession ?? "null"} bodyLen=${trimmed.length} attachmentCount=${slotAttachments.length} trigger=send-button path=attachment mqid=pending target=${slotTarget}`);
      const runSlotAttachmentSend = async (): Promise<void> => {
        const outcome = await onSendWithAttachments!(captionPayload, slotTarget);
        if (outcome.ok) {
          console.info(`[compose] submit-success hostId=${hostId} tmuxSession=${tmuxSession ?? "null"} bodyLen=${trimmed.length} path=attachment target=${slotTarget}`);
          const nextSlots = latestQueueSlotsRef.current.filter((s) => s.id !== slotId);
          setQueueSlots(nextSlots);
          scheduleAutosave(latestBodyRef.current, nextSlots);
          clearStagedForTarget?.(slotTarget);
          return;
        }
        if (outcome.reason === "superseded") return;
        const userMessage = getBatchFailureUserMessage(outcome.reason);
        console.warn(`[compose] submit-failed hostId=${hostId} tmuxSession=${tmuxSession ?? "null"} bodyLen=${trimmed.length} path=attachment target=${slotTarget} reason=${outcome.reason} message=${outcome.message ?? ""}`);
        setErrorMessage(userMessage);
        // Deliberately DO NOT filter slot or clear chips — mirrors primary handleSend's
        // failure-preservation posture (quick-260823-8ji). user can retry.
      };
      void runSlotAttachmentSend();
      return;
    }

    // No attachment transport wired and no text — nothing to send.
    if (!trimmed) return;

    setErrorMessage(null);

    const payload = normalizeNewlinesForSend(trimmed);
    // Phase 68 Plan 02: route through the funnel so queue-slot sends carry
    // an mqid (D-03 invariant — backend Phase 56 wake gate fires on all
    // pretty-view sends) and seed an optimistic bubble (D-01).
    const dispatched = funnel.send(payload, { trigger: "queue-item" });
    if (dispatched) {
      const nextSlots = queueSlots.filter((s) => s.id !== slotId);
      setQueueSlots(nextSlots);
      // Persist the updated slots immediately via scheduleAutosave.
      scheduleAutosave(latestBodyRef.current, nextSlots);
    } else {
      setErrorMessage("Not connected — try again in a moment");
      // Keep the slot — same failure-preservation posture as primary
      // handleSend's D-20 path (Phase 50).
    }
  }

  // overridePayload: Phase 16 D-16-05 — voice.endSend passes the glued
  // transcript here so it reaches the send path synchronously, bypassing
  // React's async setState batching on text. When present it is used in place
  // of the current `text` state. All other handleSend logic (attachment
  // branching, newline normalization, Phase 50 D-18 optimistic-bubble
  // seeding) still applies.
  function handleSend(overridePayload?: string, trigger: "enter-key" | "send-button" | "queue-item" | "unknown" = "unknown") {
    // D-16-05: use override payload if provided (voice send path), otherwise
    // derive from current text state (normal typed-send path).
    const trimmed = overridePayload !== undefined ? overridePayload.trim() : text.trim();

    // Phase 05 — attachment path: Send routes to onSendWithAttachments
    // whenever at least one attachment is staged. Empty caption is
    // permitted (UPLOAD-13); the caption we pass is `trimmed` (may be
    // empty string).
    //
    // Quick 260823-8ji: attachment path is no longer fire-and-forget. The
    // onSendWithAttachments prop returns a Promise<BatchOutcome> (see the
    // prop's JSDoc + `BatchOutcome` in ./use-pretty-view-uploads.ts).
    // handleSend's outer signature stays synchronous (existing consumers
    // — queue-cadence + voice — call it without awaiting; changing that
    // is out of scope for this bug), so we extract the await into an
    // inner async closure that:
    //   - awaits the outcome Promise;
    //   - on outcome.ok: logs submit-success with path=attachment marker,
    //     clears the textarea + calls clearAfterSend() (mirrors today's
    //     silent-clear behavior — but only on genuine success);
    //   - on !outcome.ok (excluding "superseded" which returns early to
    //     avoid stomping a newer send's UI state): logs submit-failed at
    //     WARN with path=attachment + reason + message, calls
    //     setErrorMessage with a reason-specific user-facing string,
    //     and DELIBERATELY does NOT clear text or attachments so the
    //     user can retry without re-typing or re-attaching.
    //
    // The path=attachment marker on the log lines distinguishes them from
    // the non-attachment path's submit-entry/submit-success/submit-failed
    // lines (which do not carry a `path=` field — preserving the existing
    // log-assertion contracts across 7+ sibling tests).
    if (hasAttachments && onSendWithAttachments) {
      setErrorMessage(null);
      const captionPayload = normalizeNewlinesForSend(trimmed);
      // Phase 31 D-02 + quick-260823-8ji: compose submit instrumentation —
      // attachment path. mqid isn't known until the batch is minted inside
      // the hook; the submit-entry line logs mqid=pending and the follow-up
      // submit-success / submit-failed lines carry hostId + tmuxSession +
      // bodyLen for correlation.
      console.info(`[compose] submit-entry hostId=${hostId} tmuxSession=${tmuxSession ?? "null"} bodyLen=${trimmed.length} attachmentCount=${stagedAttachments?.length ?? 0} trigger=${trigger} path=attachment mqid=pending`);
      const runAttachmentSend = async (): Promise<void> => {
        // Definitely defined here — guarded by hasAttachments && onSendWithAttachments above.
        const outcome = await onSendWithAttachments!(captionPayload);
        if (outcome.ok) {
          console.info(`[compose] submit-success hostId=${hostId} tmuxSession=${tmuxSession ?? "null"} bodyLen=${trimmed.length} path=attachment`);
          setText("");
          clearAfterSend();
          return;
        }
        if (outcome.reason === "superseded") {
          // A newer send superseded this one — the newer send is driving
          // the UI state; do not stomp it with a stale error message.
          return;
        }
        const userMessage = getBatchFailureUserMessage(outcome.reason);
        console.warn(`[compose] submit-failed hostId=${hostId} tmuxSession=${tmuxSession ?? "null"} bodyLen=${trimmed.length} path=attachment reason=${outcome.reason} message=${outcome.message ?? ""}`);
        setErrorMessage(userMessage);
        // Deliberately DO NOT clear text or attachments — user may want
        // to retry the send with the same caption + same files (mirrors
        // the non-attachment path's Phase 50 D-20 / D-56 posture).
      };
      void runAttachmentSend();
      return;
    }

    if (!trimmed) return;

    setErrorMessage(null); // clear any prior error

    // Newline policy: preserve LF, eliminate CR on send. Ink safety.
    const payload = normalizeNewlinesForSend(trimmed);

    // Phase 68 Plan 01: delegate to the co-located useComposeSend hook.
    // The funnel handles mqid generation, onOptimisticSend seed (pre-send +
    // failure), onSend dispatch, and the three submit-entry/success/failed log
    // lines — all byte-identical to the pre-refactor inline code. Caller keeps
    // only the per-trigger UI cleanup (setText, clearAfterSend, setErrorMessage
    // on failure per PATTERNS.md § Contract boundary). The trigger label flows
    // through so the submit-entry log line carries the correct trigger field.
    const dispatched = funnel.send(payload, { trigger });
    // Clear the composebox on BOTH dispatched=true and dispatched=false.
    // The red-bordered failed bubble in the transcript is the record of
    // the send in either case — no need to also keep the text in the
    // textarea (user 2026-09-02, reversing Phase 50 D-20 / D-56 which
    // preserved the draft on WS-not-open for edit-and-resend).
    setText("");
    clearAfterSend();
    if (!dispatched) {
      setErrorMessage("Not connected — try again in a moment");
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
      // Empty transcript + empty baseText → do not dirty the textarea with a
      // lone trailing space. Error sound already played inside voice.endAppend.
      if (result.transcript === "" && baseText === "") {
        return;
      }
      // Trailing space so the next dictation chunk joins without needing a manual space.
      const appended = result.glued + " ";
      if (target === "primary") {
        setText(appended);
        scheduleAutosave(appended, latestQueueSlotsRef.current);
      } else {
        setQueueSlots((prev) =>
          prev.map((s) => s.id === target ? { ...s, text: appended } : s),
        );
        // Mark slots dirty so autosave picks up the change.
        const nextSlots = latestQueueSlotsRef.current.map((s) =>
          s.id === target ? { ...s, text: appended } : s,
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
      // Empty transcript + empty baseText → do not send an empty payload or
      // dirty a slot. Error sound already played inside voice.endSend.
      if (result.transcript === "" && baseText === "") {
        setMicTarget("primary");
        return;
      }
      if (target === "primary") {
        setText(result.glued);
        scheduleAutosave(result.glued, latestQueueSlotsRef.current);
        // Bounty mic-available-when-composebox-disabled (quick 260731-ulo): during recycle, land transcript in textarea but skip auto-send — user sends manually once the overlay clears.
        // Phase 24: same treatment during plan-mode pending — text lands, no auto-send.
        // Reconnect window: same treatment — text lands, no auto-send while WS is between sockets.
        // quick 260808-cd6: same treatment during dormant/waking — text lands, no auto-send.
        if (!recycleActive && !reconnectingActive) {
          // D-16-05: route through the SAME handleSend — attachment branching,
          // newline normalization, Phase 50 D-18 optimistic-bubble seeding
          // all still apply.
          handleSend(result.glued, "queue-item");
        }
      } else {
        // For a queue slot: update slot text then send it.
        setQueueSlots((prev) =>
          prev.map((s) => s.id === target ? { ...s, text: result.glued } : s),
        );
        // Bounty mic-available-when-composebox-disabled (quick 260731-ulo): during recycle,
        // text lands in slot, no dispatch, slot not removed — user sends manually once overlay clears.
        // Phase 24: same treatment during plan-mode pending — text lands in slot, no dispatch.
        // Reconnect window: same treatment — text lands in slot, no dispatch while WS is between sockets.
        // quick 260808-cd6: same treatment during dormant/waking — text lands in slot, no dispatch.
        if (!recycleActive && !reconnectingActive) {
          // handleQueueSlotSend reads from queueSlots state, but due to async
          // batching we pass the glued text directly via onSend to avoid stale reads.
          const payload = normalizeNewlinesForSend(result.glued.trim());
          if (payload) {
            // quick-260829-nt9: attachment branch for voice-slot sends — mirrors
            // handleQueueSlotSend's attachment branch. If this slot has staged
            // attachments and onSendWithAttachments is wired, route through the
            // attachment path. Text-only onSend path below is unchanged.
            const slotTarget = `queued:${target}`;
            const slotAttachments = getStagedAttachmentsForTarget?.(slotTarget) ?? [];
            if (slotAttachments.length > 0 && onSendWithAttachments) {
              setErrorMessage(null);
              console.info(`[compose] submit-entry hostId=${hostId} tmuxSession=${tmuxSession ?? "null"} bodyLen=${payload.length} attachmentCount=${slotAttachments.length} trigger=queue-item path=attachment mqid=pending target=${slotTarget}`);
              const runVoiceSlotAttachmentSend = async (): Promise<void> => {
                const outcome = await onSendWithAttachments!(payload, slotTarget);
                if (outcome.ok) {
                  console.info(`[compose] submit-success hostId=${hostId} tmuxSession=${tmuxSession ?? "null"} bodyLen=${payload.length} path=attachment target=${slotTarget}`);
                  const nextSlots = latestQueueSlotsRef.current.filter((s) => s.id !== target);
                  setQueueSlots(nextSlots);
                  scheduleAutosave(latestBodyRef.current, nextSlots);
                  clearStagedForTarget?.(slotTarget);
                  return;
                }
                if (outcome.reason === "superseded") return;
                const userMessage = getBatchFailureUserMessage(outcome.reason);
                console.warn(`[compose] submit-failed hostId=${hostId} tmuxSession=${tmuxSession ?? "null"} bodyLen=${payload.length} path=attachment target=${slotTarget} reason=${outcome.reason} message=${outcome.message ?? ""}`);
                setErrorMessage(userMessage);
                // Deliberately do NOT filter slot or clear chips.
              };
              void runVoiceSlotAttachmentSend();
              setMicTarget("primary");
              return;
            }
            // Phase 68 follow-up: route voice-slot text-only sends through the
            // funnel so voice-transcribed messages get optimistic bubbles +
            // dormancy wake, matching every other user-initiated send affordance.
            const dispatched = funnel.send(payload, { trigger: "voice-slot" });
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
  // branch (patch #122 latency guarantee: drain-sweep animation fires on
  // click, not after the ~1-3s STT round-trip).
  //
  // quick 260905-d79 invariant: onResetClicked is NOT called here any more.
  // It moved into dispatchResetPayload's `if (dispatched)` branch so that
  // a disconnected socket (funnel.send returns false) does NOT falsely mount
  // the overlay for 10 minutes. The drain-sweep / pulse animation below
  // still fires unconditionally on click as an always-fire visual affordance.
  function fireResetSyncFx() {
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
  //
  // Phase 90 Plan 00 Wave 0 Task 3 (D-03 mechanical rewire, user
  // 2026-09-08): the dispatch call target changed from `funnel.send` (which
  // routed through the pretty-view WS) to `authApi.post('/agent-reset/…')`
  // (which routes through the new backend endpoint that opens a one-shot
  // SSH + dispatches the same `tmux send-keys` split-send the WS path
  // does). Every OTHER observable is PRESERVED verbatim:
  //   - fireResetSyncFx already fired at the caller (drain-sweep +
  //     text-clear are unconditional-on-click affordances, unchanged).
  //   - onResetClicked STILL fires on dispatch SUCCESS ONLY (quick
  //     260905-d79 invariant — a disconnected/failed dispatch does NOT
  //     falsely mount the overlay for 10 minutes).
  //   - setText("") + clearAfterSend STILL fire on dispatch success.
  //   - "Not connected — try again in a moment" error message STILL surfaces
  //     on dispatch failure.
  // The endpoint constructs the `/id reset (<body>)` payload server-side
  // from the optional body — we pass the trimmed body verbatim.
  //
  // NB: this function's contract shifts from synchronous (funnel.send
  // returns bool) to fire-and-forget-async (authApi.post returns Promise).
  // Callers (handleResetSend, handleVoiceResetSend) don't await this — the
  // observable UX affordances all resolve inside the .then/.catch. Same
  // shape the AttachmentChipStrip's onSendWithAttachments path already uses.
  function dispatchResetPayload(body: string) {
    const trimmed = body.trim();
    // Phase 85 send-log parity (preserved across the Phase 90 rewire): the
    // OLD funnel-based dispatch fired stampIdentitySendLog + seedSession
    // LastMessageAt inside useComposeSend BEFORE onSend was called. The
    // rewire routes reset off the funnel so we call the same two primitives
    // directly here to preserve behavior for the row-recency signal on
    // user's device (D-06 optimistic-advance). Same guards as
    // useComposeSend (identityName + tmuxSession must both be present).
    if (identityName != null && identityName !== "" && tmuxSession != null) {
      const stampTs = Date.now();
      stampIdentitySendLog(identityName, stampTs);
      seedSessionLastMessageAt(hostId, tmuxSession, stampTs);
    }
    authApi
      .post(
        `/agent-reset/${hostId}/${encodeURIComponent(tmuxSession ?? "")}`,
        { body: trimmed },
      )
      .then((response) => {
        // 200 + {ok:true} → dispatch succeeded; run success-path effects.
        // Any other shape → surface the not-connected error message (matches
        // pre-rewire dispatched=false semantics).
        //
        // isMountedRef guard: swallow the state updates when a stale promise
        // resolves after the component unmounted (JSDOM teardown race —
        // see isMountedRef ref definition above).
        if (!isMountedRef.current) return;
        const okShape =
          response?.data &&
          typeof response.data === "object" &&
          (response.data as { ok?: unknown }).ok === true;
        if (okShape) {
          onResetClicked?.();
          setText("");
          clearAfterSend();
        } else {
          setErrorMessage("Not connected — try again in a moment");
        }
      })
      .catch(() => {
        if (!isMountedRef.current) return;
        setErrorMessage("Not connected — try again in a moment");
      });
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
  // Live voice state for handlers that await a confirm (the dialog doesn't
  // freeze the page, so recording can start or stop while it's open).
  const voiceStateRef = useRef(voice.state);
  voiceStateRef.current = voice.state;

  async function handleResetClick() {
    if (
      !(await kitConfirm({
        title: "Reset the agent's context window?",
        body: "It saves where it's up to, then restarts fresh.",
        confirmLabel: "Reset",
      }))
    )
      return;
    if (voiceStateRef.current === "recording") {
      void handleVoiceResetSend();
    } else {
      handleResetSend();
    }
  }

  // Quick-reply: fires a canned message through the funnel without touching
  // the compose textarea's text/focus state. Independent of what the user is
  // currently composing.
  //
  // Phase 68 Plan 02 D-02: accepts optional { bubbleTextOverride } so the
  // thumbs-up caller can seed a "👍" bubble instead of "thumbs up". onSend
  // always receives the literal payload (e.g. "thumbs up"); only the bubble
  // renders the override.
  //
  // The persisted DRAFT is still cleared on successful dispatch: user
  // may have been composing something in the textarea, then decided to
  // fire "go ahead" instead. Textarea `text` state is untouched (the
  // user's in-progress composition stays visible) but the persisted
  // draft resets to '' so a reload doesn't resurrect it. Failed
  // dispatch leaves both intact.
  function handleQuickSend(quickText: string, options?: { bubbleTextOverride?: string }) {
    setErrorMessage(null);
    // Phase 68 Plan 02: route through the funnel so quick-replies carry an
    // mqid (D-03 invariant) and seed an optimistic bubble (D-01). The
    // bubbleTextOverride flows through so the thumbs-up wire site can pass
    // "👍" and have the pending bubble display that from birth (D-02).
    const dispatched = funnel.send(quickText, { trigger: "quick-reply", bubbleTextOverride: options?.bubbleTextOverride });
    if (dispatched) {
      // NOTE: intentionally does NOT setText("") — the user's typed
      // draft stays visible for continued editing (the quick reply
      // fires independently of composed text). But the persisted
      // draft still clears per plan spec so a reload doesn't
      // surface stale content user abandoned in favour of the
      // canned reply.
      clearAfterSend();
    } else {
      setErrorMessage("Not connected — try again in a moment");
    }
    // Patch #313: skip re-focus on touch devices — .focus() on a textarea
    // pops the on-screen keyboard, which is exactly what user doesn't
    // want after tapping ThumbsUp (quick-replies are meant to fire
    // WITHOUT dragging the user into text composition). Desktop keeps the
    // re-focus so a mouse click doesn't lose the caret from an in-progress
    // draft.
    if (isTouchDevice !== true) textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Quick 260729-j8l: during session recycle the Send button is
    // disabled (via sendDisabled below) but the textarea stays typeable
    // so user can pre-draft the next message. Swallow the Enter-send
    // path too so a bare Enter can't slip past the disabled button.
    // Phase 24: same treatment during plan-mode pending — textarea stays
    // typeable but Enter-send is swallowed.
    // Reconnect window: same treatment — Enter can't slip past disabled Send.
    if (recycleActive || reconnectingActive) return;
    // Touch devices: Enter inserts a newline (browser default); Send button sends.
    if (isTouchDevice === true) return;

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

  // showMicButton: mic CO-RENDERS beside the send button when:
  //   - navigator.mediaDevices is available (browser supports getUserMedia;
  //     JSDOM guard so tests that don't mock mediaDevices still see Send)
  //   - primary is NOT the active mic target (other textareas may be
  //     recording/transcribing; mic stays visible on the primary but is
  //     disabled via the disabled prop so a second concurrent recording
  //     cannot start — Quick 260802-uow bounty 1)
  //   - aside-morph is NOT active (X-for-Resume owns the slot when true)
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
  const isPrimaryRecording = voice.state === "recording" && micTarget === "primary";
  const isPrimaryTranscribing = voice.state === "transcribing" && micTarget === "primary";
  const showTranscribingSend = isPrimaryTranscribing;

  // Patch #129: inside-textarea Send button disabled predicate. Locked with
  // user 2026-07-23 (console-iterated visual). Truth table:
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
    recycleActive === true ||
    reconnectingActive === true ||
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
  // Hands-free voice mode (2026-10-06). Runs alongside — never instead of —
  // the normal compose: it has its own mic stream and sends each transcript
  // straight through the funnel, leaving the textarea, attachments, queue
  // slots and Send untouched. While it is on every mic is disabled (see
  // voiceModeAnywhere below); `suspended` remains as a fallback.
  const voiceMode = useVoiceMode({
    hostId,
    tmuxSession,
    voices: voiceModeFeed?.voices ?? EMPTY_VOICE_MODE_VOICES,
    isWorking: voiceModeFeed?.isWorking ?? false,
    messages: voiceModeFeed?.messages ?? EMPTY_VOICE_MODE_MESSAGES,
    suspended: voice.state !== "idle",
    send: (transcript) => {
      // Same gate as handleVoiceSend's auto-send: no dispatch while the pane
      // is recycling or between sockets — onUndelivered parks the words.
      if (recycleActive || reconnectingActive) return false;
      const payload = normalizeNewlinesForSend(transcript.trim());
      if (!payload) return true;
      return funnel.send(appendVoiceLabel(payload), { trigger: "voice-mode" });
    },
    onUndelivered: (transcript) => {
      // Only time voice mode writes to the compose box: a transcript that
      // couldn't be sent is appended so it is never lost.
      const cur = latestBodyRef.current;
      const next = cur && !/\s$/.test(cur) ? `${cur} ${transcript}` : `${cur}${transcript}`;
      latestBodyRef.current = next;
      setText(next);
      scheduleAutosave(next, latestQueueSlotsRef.current);
      setErrorMessage("Voice mode couldn't send — your words are in the compose box");
    },
  });

  // 2026-10-10: one voice mode at a time. While it is on in ANY pane (this one
  // included) every mic is disabled, and the voice-mode button is disabled in
  // every pane but the one that owns it.
  const voiceModeAnywhere = useVoiceModeActiveAnywhere();
  // ...and the reverse: a manual recording in any pane blocks starting voice
  // mode anywhere (one `voice` instance per ComposeBox covers its queue slots).
  const manualRecordingAnywhere = useManualRecordingAnywhere();
  const manualRecordingHere = voice.state !== "idle";
  useEffect(() => {
    if (!manualRecordingHere) return;
    return registerManualRecording(Symbol("manual-recording"));
  }, [manualRecordingHere]);

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
    disabled: showTranscribingSend || voiceModeAnywhere,
  });

  // Slot mics report their hold feedback here so one pill serves the whole
  // compose box. A slot that is sent unmounts with its row, so the release
  // outcome is expired here rather than by the slot's hook.
  const [slotHoldFeedback, setSlotHoldFeedback] = useState<{ slotId: string; feedback: HoldFeedback } | null>(null);
  const slotOutcomeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSlotHoldFeedback = useCallback((slotId: string, feedback: HoldFeedback) => {
    if (feedback.committed) {
      setSlotHoldFeedback({ slotId, feedback });
    } else if (feedback.outcome) {
      setSlotHoldFeedback({ slotId, feedback });
      if (slotOutcomeTimerRef.current !== null) clearTimeout(slotOutcomeTimerRef.current);
      slotOutcomeTimerRef.current = setTimeout(() => {
        slotOutcomeTimerRef.current = null;
        setSlotHoldFeedback((prev) => (prev?.slotId === slotId && !prev.feedback.committed ? null : prev));
      }, HOLD_OUTCOME_MS);
    } else {
      // Idle report: clear only a live hold from this slot; a showing outcome
      // runs out on its own timer.
      setSlotHoldFeedback((prev) => (prev?.slotId === slotId && prev.feedback.committed ? null : prev));
    }
  }, []);
  useEffect(() => () => {
    if (slotOutcomeTimerRef.current !== null) clearTimeout(slotOutcomeTimerRef.current);
  }, []);
  // A tapped recording gets the same pill (no hold hints) so its live
  // waveform shows too.
  const holdFeedback: HoldFeedback | null =
    primaryHold.holdCommitted || primaryHold.holdOutcome
      ? { committed: primaryHold.holdCommitted, outside: primaryHold.holdOutside, outcome: primaryHold.holdOutcome }
      : (slotHoldFeedback?.feedback ??
        (voice.state === "recording" ? { committed: true, outside: false, outcome: null, tap: true } : null));

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
    !asideActive;

  // Phase 16: merge voice.errorMessage into the existing displayError. The error
  // display block renders only one message at a time; voice errors are transient
  // (cleared when recording starts again), so they coexist safely with compose errors.
  const displayError = errorMessage ?? voice.errorMessage ?? voiceMode.errorMessage;

  // B-3 (Phase 32): gate on !holdInitiatedRef so a hold-initiated recording
  // does NOT swap in RecordingControls under the pointer (CONTEXT.md § Visual
  // during hold — LOCKED). The mic-tap path leaves holdInitiatedRef false, so
  // it retains its existing RecordingControls swap behavior.
  const showRecordingControls = isPrimaryRecording && !primaryHold.holdInitiatedRef.current;

  // Layout (shape-conversation-view): one card — the text on top, every
  // control on one row under it. Left: attach, skills (harness only), and the
  // recording chip while dictating. Right: agent memory, voice mode, the mic,
  // and the round main button, which does the likely next thing — Send while
  // there's something to send, Stop while the agent works, otherwise 👍
  // (Resume while an aside is up). With text typed, 👍 (or Stop) steps aside
  // as a quiet button next to Send so a thumbs-up never needs the draft
  // cleared. Relay rooms get only the mic and Send.
  const harness = mode !== "relay";
  const hasDraft = text.trim() !== "" || hasAttachments || showTranscribingSend;
  // Stop stays where it is while its press is being answered (Stopping →
  // Stopped / Cancelled / …): working drops within milliseconds of a Stop,
  // and the same round button turning into 👍 under a second tap would
  // restart the agent that was just stopped.
  const working = agentWorking === true || interruptFeedback != null;
  const quickDisabled = asideActive === true || recycleActive === true || reconnectingActive === true;
  const mainAction: "resume" | "send" | "stop" | "thumbs" = asideActive
    ? "resume"
    : hasDraft || !harness
      ? "send"
      : working && onInterrupt
        ? "stop"
        : "thumbs";
  const asideAction: "stop" | "thumbs" | null = !harness
    ? null
    : mainAction === "send"
      ? working && onInterrupt
        ? "stop"
        : "thumbs"
      : mainAction === "thumbs" && agentWaiting === true && onInterrupt
        ? "stop"
        : null;
  // Mic open on this composer (a transcript round-trip is not "recording":
  // Send shows its spinner then).
  const recordingHere = micTarget === "primary" && (voice.state === "starting" || voice.state === "recording");
  // The card's red edge follows the memory pie, which holds its last reading
  // through brief dropouts — hold it here the same way.
  if (isDraining || isHolding === true) heldPctRef.current = null;
  else if (contextPct != null) heldPctRef.current = contextPct;

  const fireInterrupt = () => {
    const now = Date.now();
    if (now - interruptLastFireRef.current < INTERRUPT_THROTTLE_MS) {
      // Silent no-op — double-tap guard.
      return;
    }
    interruptLastFireRef.current = now;
    onInterrupt?.();
  };
  const fireThumbs = () => {
    onGoodToGo?.();
    handleQuickSend("thumbs up");
  };
  const renderAction = (action: "stop" | "thumbs", main: boolean) =>
    action === "stop" ? (
      interruptFeedback ? (
        <InterruptFeedbackChip key="stop" feedback={interruptFeedback} />
      ) : (
        <button
          key="stop"
          type="button"
          className="pv-cbtn"
          data-main={main ? "true" : undefined}
          data-action="stop"
          disabled={interruptDisabled === true}
          onClick={fireInterrupt}
          aria-label="Interrupt"
          title="Stop"
        >
          <Square aria-hidden="true" />
        </button>
      )
    ) : (
      <button
        key="thumbs"
        type="button"
        className="pv-cbtn"
        data-main={main ? "true" : undefined}
        data-action="thumbs"
        onClick={fireThumbs}
        disabled={quickDisabled}
        aria-label="Send 'thumbs up'"
        title="Send 'thumbs up'"
      >
        <ThumbsUp aria-hidden="true" />
      </button>
    );

  return (
    <div
      ref={composeRootRef}
      // Patch #181: `.pv-composebox` also identifies the compose root for the
      // delegated pointerdown listener (see the useEffect above) that adds a
      // 250ms `.pv-btn-pressed` window to any button tapped inside.
      className={cn("pv-composebox", className)}
      data-mode={mode}
      data-touch={isTouchDevice === true ? "true" : undefined}
      data-memory={harness ? memoryBand(heldPctRef.current) : undefined}
    >
      {/* Phase 05: retry affordance surfaces only when at least one chip is
          in the error state. Clicking re-issues the upload batch via the
          parent hook's retryBatch. */}
      {hasErroredChip && onRetryBatch && (
        <div className="px-1 pt-1">
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
      {/* Phase 05: hidden file input driven by the paperclip. */}
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
      {/* Queued messages saved before "Queue a message" was retired still
          show (and send) here; nothing adds new ones. */}
      {queueSlots.length > 0 && (
        <div className="pv-compose-queued">
          {queueSlots.map((slot, index) => (
            <QueuedRow
              key={slot.id}
              slot={slot}
              isTopmostInStack={index === 0}
              onAddSlotAtTop={handleAddSlotAtTop}
              justAddedSlotIdRef={justAddedSlotIdRef}
              voice={voice}
              micTarget={micTarget}
              setMicTarget={setMicTarget}
              asideActive={asideActive}
              recycleActive={recycleActive}
              reconnectingActive={reconnectingActive}
              canSend={canSend}
              isTouchDevice={isTouchDevice}
              queueSlots={queueSlots}
              onSlotsChange={(next) => {
                setQueueSlots(next);
                scheduleAutosave(latestBodyRef.current, next);
              }}
              scheduleAutosave={scheduleAutosave}
              latestBody={latestBodyRef.current}
              handleQueueSlotSend={handleQueueSlotSend}
              handleVoiceCancel={handleVoiceCancel}
              handleVoiceAppend={handleVoiceAppend}
              handleVoiceSend={handleVoiceSend}
              beginRecord={beginRecord}
              handleOpenFilePicker={handleOpenFilePicker}
              getStagedAttachmentsForTarget={getStagedAttachmentsForTarget}
              clearStagedForTarget={clearStagedForTarget}
              onAttachFilesForTarget={onAttachFilesForTarget}
              onRemoveAttachment={onRemoveAttachment}
              flushDirty={flushDirty}
              clearDebounce={clearDebounce}
              onHoldFeedbackChange={handleSlotHoldFeedback}
            />
          ))}
        </div>
      )}
      <div className="pv-compose-field" data-testid="compose-primary-wrapper">
        {/* Quick 260802-wxy: chip strip overlaid at the top of the field so
            chips attach to the message being composed; the textarea's top
            padding grows with the strip's measured height. Only captures
            pointer events while it has chips. */}
        <div
          ref={chipStripRef}
          className={cn(
            "absolute top-0 left-0 right-0 z-10 px-2 pt-2",
            (stagedAttachments?.length ?? 0) === 0 ? "pointer-events-none" : "pointer-events-auto",
          )}
        >
          <AttachmentChipStrip
            attachments={stagedAttachments ?? []}
            onRemove={onRemoveAttachment ?? (() => {})}
          />
        </div>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          enterKeyHint={isTouchDevice === true ? "enter" : "send"}
          placeholder="Write a message…"
          rows={1}
          style={chipStripHeight > 0 ? { paddingTop: `${chipStripHeight + 12}px` } : undefined}
          className="pv-compose-text"
          // Not disabled when canSend===false — the user can compose during a
          // transient disconnect and send when the socket reconnects.
        />
      </div>
      <div className="pv-compose-row" data-testid="compose-row">
        {harness && showPaperclip && (
          <button
            type="button"
            className="pv-cbtn"
            onClick={() => handleOpenFilePicker("primary")}
            disabled={canSend === false || asideActive === true}
            aria-label="Attach file"
            title="Attach file"
          >
            <Paperclip aria-hidden="true" />
          </button>
        )}
        {/* Skill-actions menu: a skill fires through the same quick-send path,
            same disabled gates. Renders nothing until the host is known to
            have skills; never in relay panes. */}
        <SkillActionsButton
          hostId={hostId}
          enabled={harness}
          disabled={quickDisabled}
          onFire={(skillName) => { onGoodToGo?.(); handleQuickSend(`/${skillName}`); }}
          buttonClassName="pv-cbtn"
        />
        {/* Dictating: the recording chip sits in the row, after attach and
            skills (which stay usable — files get picked mid-sentence). */}
        {holdFeedback && <HoldFeedbackPill {...holdFeedback} readLevel={voice.readLevel} />}
        <div className="pv-compose-spacer" aria-hidden="true" />
        {harness && (
          <MemoryGauge
            pct={contextPct ?? null}
            emptied={isDraining || isHolding === true}
            resetDisabled={canSend === false || asideActive === true || recycleActive === true || reconnectingActive === true || voice.state === "transcribing"}
            onStartFresh={() => { void handleResetClick(); }}
          />
        )}
        {/* Hands-free voice mode (harness only). Steps aside while this
            composer is dictating — a second mic can't open then anyway. */}
        {voiceModeFeed && !recordingHere && (
          <VoiceModeButton
            phase={voiceMode.phase}
            // voice.state: no second mic capture while dictating (iOS would
            // end the manual recording's track).
            disabled={
              asideActive === true ||
              recycleActive === true ||
              reconnectingActive === true ||
              manualRecordingAnywhere ||
              (voiceMode.phase === "off" && voiceModeAnywhere)
            }
            disabledTitle={
              voiceModeAnywhere ? VOICE_MODE_ON_TITLE : manualRecordingAnywhere ? MIC_RECORDING_TITLE : undefined
            }
            onStart={voiceMode.start}
            onStop={voiceMode.stop}
            onSkip={voiceMode.skipSpeech}
            onTalk={voiceMode.talk}
            pressToTalk={voiceMode.pressToTalk}
          />
        )}
        {showRecordingControls && micTarget === "primary" ? (
          // A tapped recording: Cancel · add to text · Send own the right side.
          <RecordingControls
            onCancel={handleVoiceCancel}
            onAppend={() => { void handleVoiceAppend("primary"); }}
            onSend={() => { void handleVoiceSend("primary"); }}
            muted={voice.muted}
            onToggleMute={voice.toggleMute}
          />
        ) : (
          <>
            {showMicButton && (
              <MicButton
                variant="row"
                // Tap records (the hold hook's short tap keeps the recording
                // too; its voice.state guard makes the second start a no-op).
                onClick={() => beginRecord("primary")}
                // quick-260814-o22: setMicTarget fires synchronously BEFORE the
                // hook's pointerdown — MicButton's preventDefault (iOS callout
                // suppression) also suppresses the synthesized click, so the
                // target must be set here for the hold path.
                onPointerDown={(e) => {
                  setMicTarget("primary");
                  primaryHold.onPointerDown(e);
                }}
                onPointerMove={primaryHold.onPointerMove}
                onPointerUp={primaryHold.onPointerUp}
                onPointerCancel={primaryHold.onPointerCancel}
                onPointerLeave={primaryHold.onPointerLeave}
                dataHoldActive={primaryHold.holdActive}
                holdRing={primaryHold.holdCommitted ? (primaryHold.holdOutside ? "outside" : "recording") : undefined}
                disabled={voice.state !== "idle" || voiceModeAnywhere}
                title={voiceModeAnywhere ? VOICE_MODE_ON_TITLE : undefined}
              />
            )}
            {/* While the mic is held, the buttons to its right keep their
                space (hidden, not removed): the row is right-aligned, so
                removing them would slide the mic out from under the finger
                and turn the release into a cancel. */}
            <span className="contents" style={recordingHere ? { visibility: "hidden" } : undefined} aria-hidden={recordingHere || undefined}>
            {asideAction && renderAction(asideAction, false)}
            {(mainAction === "stop" || mainAction === "thumbs") && renderAction(mainAction, true)}
            {(mainAction === "send" || mainAction === "resume") && (
              // Phase 14: SAME button morphs to Resume while an aside is up
              // (DOM identity preserved across the morph). Phase 16: disabled
              // with a spinner during this textarea's STT round-trip.
              <button
                type="button"
                className="pv-cbtn"
                data-main="true"
                data-action={asideActive ? "resume" : "send"}
                onClick={asideActive ? () => onAsideDismiss?.() : () => handleSend(undefined, "send-button")}
                disabled={asideActive ? false : (sendDisabled || showTranscribingSend)}
                aria-label={asideActive ? "Resume" : "Send"}
                title={asideActive ? "Resume" : "Send"}
              >
                {asideActive ? (
                  <X strokeWidth={2.25} aria-hidden="true" />
                ) : showTranscribingSend ? (
                  // Twin 90° arcs 180° apart — rotationally symmetric, so the
                  // spinner doesn't wobble.
                  <svg
                    className="animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M21 12 A9 9 0 0 0 12 3" />
                    <path d="M3 12 A9 9 0 0 0 12 21" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
                  </svg>
                )}
              </button>
            )}
            </span>
          </>
        )}
        {/* Mounted for as long as Stop can be, so screen readers hear
            "Stopping" too — a live region created along with its text is
            often not announced. */}
        {onInterrupt && (
          <span role="status" aria-live="polite" className="sr-only">
            {interruptFeedback ? INTERRUPT_FEEDBACK_LABEL[interruptFeedback] : ""}
          </span>
        )}
      </div>
      {/* Phase 16: displayError merges compose errors and voice errors. */}
      {displayError && <div className="pv-compose-error">{displayError}</div>}
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
  // Quick 260909-cdi: true only for the slot at index 0 of queueSlots. Gates
  // whether the QueuePlusTab pebble-notch renders inside this row's outer
  // wrapper. Exactly one row in the stack should have this true at any time;
  // when queueSlots is empty, the primary wrapper hosts the tab instead.
  isTopmostInStack: boolean;
  // Quick 260909-cdi: bound in the parent to a closure that prepends a new
  // empty slot at index 0 of queueSlots (locality: clicking a plus on top of
  // the stack adds a slot on top of the stack). Same closure body as the
  // primary wrapper's onAdd; threaded through so QueuedRow can wire its
  // (conditional) QueuePlusTab child without knowing about setQueueSlots.
  onAddSlotAtTop: () => void;
  // Parent-owned ref carrying the id of the slot that was JUST created via
  // handleAddSlotAtTop. QueuedRow focuses its textarea on mount when its
  // slot.id matches, then nulls the ref so the focus fires exactly once per
  // add (never on hydrated / draft-restored slots).
  justAddedSlotIdRef: React.MutableRefObject<string | null>;
  voice: ReturnType<typeof useVoiceRecording>;
  micTarget: "primary" | string;
  // quick-260814-o22: threaded from parent so the slot MicButton's onPointerDown
  // wrapper can setMicTarget(slot.id) synchronously before delegating to
  // slotHold.onPointerDown(e). See slot MicButton comment below (~L3060) for
  // the full rationale (MicButton's preventDefault-on-pointerdown suppresses
  // the synthesized click on iOS Safari, so beginRecord(slot.id)'s onClick
  // never runs — the pointerdown wrapper is the only reliable seam).
  setMicTarget: React.Dispatch<React.SetStateAction<"primary" | string>>;
  asideActive?: boolean;
  recycleActive?: boolean;
  // Reconnect window: same OR-in treatment — queued-row Send is disabled
  // while the pretty-view WS is between sockets.
  reconnectingActive?: boolean;
  // Phase 56 (2026-08-23): the former dormancy-gate boolean prop was
  // DELETED — compose (and queued rows) stay enabled on dormant panes;
  // invisible wake fires at the backend.
  canSend?: boolean;
  isTouchDevice?: boolean;
  queueSlots: Array<{ id: string; text: string }>;
  onSlotsChange: (next: Array<{ id: string; text: string }>) => void;
  scheduleAutosave: (nextBody: string, nextSlots?: Array<{ id: string; text: string }>) => void;
  latestBody: string;
  handleQueueSlotSend: (slotId: string) => void;
  handleVoiceCancel: () => void;
  handleVoiceAppend: (target: "primary" | string) => void | Promise<void>;
  handleVoiceSend: (target: "primary" | string) => void | Promise<void>;
  beginRecord: (target: "primary" | string) => void;
  handleOpenFilePicker: (target?: string) => void;
  getStagedAttachmentsForTarget?: (target: string) => StagedAttachmentLike[];
  clearStagedForTarget?: (target: string) => void;
  onAttachFilesForTarget?: (target: string, files: File[]) => void;
  onRemoveAttachment?: (tempId: string) => void;
  flushDirty: () => Promise<void> | void;
  clearDebounce: () => void;
  /** Reports this slot mic's hold feedback so ComposeBox renders the one pill. */
  onHoldFeedbackChange: (slotId: string, feedback: HoldFeedback) => void;
}

function QueuedRow(props: QueuedRowProps) {
  const voiceModeAnywhere = useVoiceModeActiveAnywhere();
  const {
    slot,
    isTopmostInStack,
    onAddSlotAtTop,
    justAddedSlotIdRef,
    voice,
    micTarget,
    setMicTarget,
    asideActive,
    recycleActive,
    reconnectingActive,
    canSend,
    isTouchDevice,
    queueSlots,
    onSlotsChange,
    handleQueueSlotSend,
    handleVoiceCancel,
    handleVoiceAppend,
    handleVoiceSend,
    beginRecord,
    handleOpenFilePicker,
    getStagedAttachmentsForTarget,
    clearStagedForTarget,
    onAttachFilesForTarget,
    onRemoveAttachment,
    flushDirty,
    clearDebounce,
    onHoldFeedbackChange,
  } = props;

  // Quick 260803-05i: per-slot chip strip refs + measurement — same pattern
  // Quick A applied to the primary Textarea (see ComposeBox ~L954-979). Each
  // QueuedRow instance owns its own chipStripRef / chipStripHeight so there's
  // no Map-of-refs plumbing in the parent.
  const chipStripRef = useRef<HTMLDivElement | null>(null);
  const [chipStripHeight, setChipStripHeight] = useState(0);
  const target = `queued:${slot.id}`;

  // 2026-09-28: per-slot auto-grow, byte-parallel to the primary Textarea's
  // patch #135 useLayoutEffect (~L1275). Before this, QueuedRow textareas
  // stayed at min-h-8 (32px) and scrolled internally, which felt cramped for
  // any queued message longer than ~one line. Cap = 15 line-heights (matches
  // primary's post-2026-09-28 cap), fallback 360px when getComputedStyle
  // returns a non-numeric lineHeight (JSDOM). Setting height='auto' first is
  // required so scrollHeight can shrink as text is deleted.
  const slotTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const slotMaxHeightPxRef = useRef<number | null>(null);

  // Focus-on-create: when this slot was JUST added via the QueuePlusTab
  // click, move focus into its textarea so the user can start typing without
  // a second click. Gated on the parent-owned justAddedSlotIdRef so hydrated
  // / draft-restored slots don't steal focus on mount. Clearing the ref
  // after we consume it makes the focus fire exactly once per add.
  useEffect(() => {
    if (justAddedSlotIdRef.current !== slot.id) return;
    justAddedSlotIdRef.current = null;
    slotTextareaRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // quick-260829-oxo: slot-scoped paste handler, byte-parallel to primary
  // handlePaste at ComposeBox.tsx:497-506. File pastes are routed to
  // onAttachFilesForTarget with this slot's target; text-only pastes fall
  // through to the browser default so the "[pasted N lines]" collapse-
  // avoidance path (COMPOSE-05 D-58/D-60) is preserved verbatim.
  const handlePasteForSlot = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length > 0) {
        e.preventDefault();
        console.info(`[compose-paste] target=${target} files=${files.length}`);
        onAttachFilesForTarget?.(target, files);
      }
      // Text-only pastes fall through to the browser default so the
      // "[pasted N lines]" collapse-avoidance path (COMPOSE-05
      // D-58/D-60) is preserved verbatim — same rule as primary
      // handlePaste at ComposeBox.tsx:497-506.
    },
    [target, onAttachFilesForTarget],
  );

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

  useLayoutEffect(() => {
    const el = slotTextareaRef.current;
    if (!el) return;
    if (slotMaxHeightPxRef.current === null) {
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      slotMaxHeightPxRef.current = Number.isFinite(lh) && lh > 0 ? lh * 15 : 360;
    }
    el.style.height = "auto";
    const clamped = Math.min(el.scrollHeight, slotMaxHeightPxRef.current);
    el.style.height = clamped + "px";
    el.style.overflowY = clamped >= slotMaxHeightPxRef.current ? "auto" : "hidden";
  }, [slot.text, chipStripHeight]);

  const isSlotRecording = voice.state === "recording" && micTarget === slot.id;
  const isSlotTranscribing = voice.state === "transcribing" && micTarget === slot.id;
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
    (slot.text.trim() === "" && stagedCount === 0) ||
    recycleActive === true ||
    reconnectingActive === true;
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
    // slot text emptiness / recycle / etc.) no longer
    // applies to the hold-record gesture. Retain showSlotTranscribingSend
    // so a fresh press cannot arm while STT is in-flight from a prior
    // send. voice.state !== "idle" guard inside the hook handles double-arm.
    disabled: showSlotTranscribingSend || voiceModeAnywhere,
  });
  // The hold-feedback pill renders once, above the whole compose box — report
  // this slot's hold state up to ComposeBox.
  const slotHoldCommitted = slotHold.holdCommitted;
  const slotHoldOutside = slotHold.holdOutside;
  const slotHoldOutcome = slotHold.holdOutcome;
  useEffect(() => {
    onHoldFeedbackChange(slot.id, { committed: slotHoldCommitted, outside: slotHoldOutside, outcome: slotHoldOutcome });
  }, [onHoldFeedbackChange, slot.id, slotHoldCommitted, slotHoldOutside, slotHoldOutcome]);
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
    !asideActive;
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
          user moved it to top-left 2026-08-12. Task 2's extraction
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
          "text-[#f0ebe0] opacity-90",
          "transition-[color,opacity,transform] duration-120",
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
          className={cn(
            "absolute top-0 left-0 right-0 z-10 px-2 pt-2",
            // Same fix as the primary wrapper: when the strip is empty, mark
            // it pointer-events-none so its invisible pt-2 hit-box doesn't
            // swallow hover on the QueuePlusTab pebble that rides above it
            // on the topmost QueuedRow.
            stagedCount === 0 ? "pointer-events-none" : "pointer-events-auto",
          )}
        >
          <AttachmentChipStrip
            attachments={stagedForThisSlot}
            onRemove={onRemoveAttachment ?? (() => {})}
          />
        </div>
        <Textarea
          ref={slotTextareaRef}
          value={slot.text}
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
          onKeyDown={(e) => {
            // Enter-to-send parity with the primary textarea (handleKeyDown
            // ~L1714). Plain Enter fires handleQueueSlotSend for this slot;
            // Shift+Enter falls through to the browser default (newline
            // insertion). Gated on `slotSendDisabled` — the same predicate
            // that disables the slot Send button — so transcribing / empty
            // text / recycle / reconnecting all no-op via one source of truth.
            // Touch devices: Enter inserts a newline; the slot Send button sends.
            if (isTouchDevice === true) return;
            if (e.key !== "Enter" || e.shiftKey) return;
            e.preventDefault();
            if (slotSendDisabled) return;
            handleQueueSlotSend(slot.id);
          }}
          onPaste={handlePasteForSlot}
          enterKeyHint={isTouchDevice === true ? "enter" : "send"}
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
            // 2026-09-28: bumped pr-10→pr-12 for a hair more clearance past
            // Send's left edge, and pr-[92px] when the slot mic is present
            // so text also clears the mic (Send occupies right 4-44px, Mic
            // occupies right 44-84px). Same idiom as primary Textarea's
            // pr-12 + showMicButton && pr-[92px] at ~L2662.
            "pr-12 pl-11",
            showSlotMic && "pr-[92px]",
            "placeholder:text-[var(--color-pv-fg-dim)]",
            "shadow-[inset_0_2px_6px_rgba(0,0,0,0.4),_0_1px_0_rgba(220,225,245,0.04)]",
            "transition-[box-shadow,border-color] duration-200",
            "focus:border-[rgba(220,225,245,0.28)]",
            "focus:shadow-[inset_0_3px_10px_rgba(0,0,0,0.55),_inset_0_1px_2px_rgba(0,0,0,0.35),_0_1px_0_rgba(220,225,245,0.07),_0_0_0_1px_rgba(220,225,245,0.2),_0_0_22px_rgba(220,225,245,0.12)]",
            "focus-visible:ring-0 focus-visible:outline-none",
          )}
        />
        {/* Quick 260803-05i (Task 1): Paperclip attach button — absolute
            left-1 bottom-0.5. Routes to onAttachFilesForTarget via
            handleOpenFilePicker(`queued:${slot.id}`).
            2026-08-06 (composebox-queued-recycle-disable-inverted): mirrors
            the primary attach's disable expression (canSend + asideActive
            only). Recycle does NOT disable attach — same rule
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
            "text-[#f0ebe0] opacity-30 hover:opacity-90",
            "disabled:opacity-[0.15]",
            "disabled:cursor-not-allowed",
            "transition-[color,opacity,transform] duration-120",
            "active:scale-95",
            "cursor-pointer",
          )}
        >
          <Paperclip className="size-6" />
        </button>
        {/* Send / RecordingControls slot — absolute right-1 bottom-0.5 (mutex) */}
        {showSlotRecording ? (
          <div className="absolute right-1 bottom-0.5">
            <RecordingControls
              onCancel={handleVoiceCancel}
              onAppend={() => { void handleVoiceAppend(slot.id); }}
              onSend={() => { void handleVoiceSend(slot.id); }}
            />
          </div>
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
                  "text-[#f0ebe0] opacity-30 hover:opacity-90",
                  "disabled:opacity-[0.15]",
                  "disabled:cursor-not-allowed",
                  "transition-[color,opacity,transform] duration-120",
                  "active:scale-95",
                  "cursor-pointer",
                )}
              >
                {showSlotTranscribingSend ? (
                  <svg
                    className="size-6 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M21 12 A9 9 0 0 0 12 3" />
                    <path d="M3 12 A9 9 0 0 0 12 21" />
                  </svg>
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
                // quick-260814-o22: setMicTarget MUST fire synchronously BEFORE
                // the hook's pointerdown for the slot path. Same MicButton
                // preventDefault interaction as the primary path above — the
                // synthesized click from onClick={() => beginRecord(slot.id)}
                // does NOT fire on iOS Safari (MicButton's wrappedPointerDown
                // preventDefault under quick-260814-iwy suppresses it), so
                // without this wrapper micTarget stays "primary" and
                // RecordingControls swap in on the PRIMARY compose area
                // instead of this slot. This is THE fix for quick-260814-o22
                // (the primary path only worked accidentally because "primary"
                // is the default). setMicTarget is a synchronous React
                // setState — does NOT break D-16-02's iOS Safari sync-gesture
                // invariant that voice.start() must be reachable synchronously
                // from the user gesture.
                onPointerDown={(e) => { setMicTarget(slot.id); slotHold.onPointerDown(e); }}
                onPointerMove={slotHold.onPointerMove}
                onPointerUp={slotHold.onPointerUp}
                onPointerCancel={slotHold.onPointerCancel}
                onPointerLeave={slotHold.onPointerLeave}
                dataHoldActive={slotHold.holdActive}
                holdRing={slotHold.holdCommitted ? (slotHold.holdOutside ? "outside" : "recording") : undefined}
                disabled={voice.state !== "idle" || voiceModeAnywhere}
                title={voiceModeAnywhere ? VOICE_MODE_ON_TITLE : "Record voice"}
                positionClass="right-11 bottom-0.5"
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
