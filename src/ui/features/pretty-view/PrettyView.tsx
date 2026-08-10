import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { isIosPwa } from "@/lib/is-ios-pwa";
import { registerPane, type PaneSnapshot } from "@/lib/diag-registry";
import { Button } from "@/components/button";
import {
  openClaudeSessionSocket,
  type ClaudeSessionServerEvent,
  type ConnectToPanePayload,
  type HarnessTask,
  type BackgroundedAgent,
  type BackgroundedShell,
  type MessageEvent as ChatMessageEvent,
  type ImageEvent,
  type RelayOutboundEvent,
  type RelayInboundEvent,
  type MalformedLineEvent,
} from "@/api/claude-session-api";
import { ChatMessage } from "./ChatMessage";
import { ImageBubble } from "./ImageBubble";
import { RelayOutboundBubble } from "./RelayOutboundBubble";
import { RelayInboundBubble } from "./RelayInboundBubble";
import { MalformedBubble } from "./MalformedBubble";
import { WipBubble } from "./WipBubble";
import { PlanPendingBubble } from "./PlanPendingBubble";
import { AsideBubble } from "./AsideBubble";
import { SessionHoldingOverlay } from "./SessionHoldingOverlay";
import { DormancyOverlay } from "./DormancyOverlay";
import { PrettyViewLoadingOverlay } from "./PrettyViewLoadingOverlay";
import { PrettyViewErrorOverlay } from "./PrettyViewErrorOverlay";
import { usePaneResolvingMachine } from "./usePaneResolvingMachine";
import type { WsTransportState, PaneState } from "./resolve-phase";
import { IdentityModal } from "./IdentityModal";
// TEMP 2026-08-10 (bounty pv-disable-auto-scroll-temp): useAutoScroll import
// removed; the hook call at ~line 608 is stubbed inline. use-auto-scroll.ts
// stays in-tree UNTOUCHED as reference for the eventual redesign (bounty
// pv-auto-scroll-redesign).
import { ComposeBox } from "./ComposeBox";
import { DropOverlay } from "./DropOverlay";
import { HarnessTasksPanel } from "./HarnessTasksPanel";
import { BackgroundedAgentsPanel } from "./BackgroundedAgentsPanel";
import { BackgroundedShellsPanel } from "./BackgroundedShellsPanel";
import { usePrettyViewUploads } from "./use-pretty-view-uploads";
import {
  sessionMatchKey,
  useSessionIdentity,
} from "@/features/terminal/session-hue";
import { IdentityBadge } from "@/features/terminal/IdentityBadge";
import { useIsTouchDevice } from "@/hooks/use-is-touch-device";
import { formatInjectedUserTurn } from "@/api/pretty-view-upload-protocol";
import { publishSessionRecycling } from "@/state/session-recycling-store";
import {
  publishSessionHasBackgroundedWork,
  useSessionIsWorking,
} from "@/state/session-working-store";

// Patch #148: mirror Terminal.tsx's proven WebSocket auto-reconnect pattern.
// When the claude-session bridge WS closes unexpectedly (deploy container
// recreate, iOS PWA backgrounding, transient network blip), PrettyView now
// retries up to MAX_RECONNECT_ATTEMPTS times with a linear-with-cap backoff
// schedule (2s, 4s, 6s, 8s, 8s ≈ 28s total window). On each retryKey bump,
// the WS-setup useEffect re-runs and opens a fresh WS. The "inactive" server
// state short-circuits ALL retry paths — it is the authoritative terminal
// frame and must not be overstepped by client-side reconnect logic.
// A separate visibilitychange handler (the direct Ashley iOS PWA fix) resets
// the attempt counter to 0 and triggers an immediate reconnect when the user
// foregrounds the PWA tab — so her next tap always gets a live connection.
const MAX_RECONNECT_ATTEMPTS = 5;

// Ashley 2026-07-27: automatic aside triggering DISABLED. The Phase 14
// isIdle-transition auto-fire of {type:"aside_arm"} was burning session
// tokens without delivering value; Ashley plans to switch to a different
// trigger mechanism. The aside subsystem itself (backend arm handler,
// poller, extract, dismiss, frontend AsideBubble render on aside_ready)
// stays wired — only the automatic frontend emit is off. Flip to `true`
// to restore the original Phase 14 behavior.
const AUTO_ASIDE_ARM_ENABLED = false;

// Minimal read-only pretty view for a live Claude Code session.
//
// Opens a WebSocket to the claude-session bridge (Plan 01-02), sends
// connectToPane with the given host + tmux session, and renders each
// incoming "message" frame as a chat bubble in a scrollable list.
//
// The three non-obvious behaviors:
//
//   1. RENDER-01 hard-lock (defense in depth): this component does NOT
//      branch on any block sub-type. Every frame whose top-level type
//      is "message" becomes a bubble; the parser (Plan 01-01) and the
//      WS server (Plan 01-02) already drop non-text blocks upstream.
//
//   2. RENDER-03 auto-scroll: TEMP-DISABLED 2026-08-10 per bounty
//      pv-disable-auto-scroll-temp. Historically handled by
//      `useAutoScroll` via a ResizeObserver on the inner content
//      wrapper (`contentRef`) — any resize re-pinned to the bottom
//      iff the user was pinned. Phase 27 virtualization made
//      snap-to-bottom unusable; the hook call is stubbed inline
//      (see line ~608 area) and use-auto-scroll.ts is kept in-tree
//      as reference for the eventual redesign (bounty
//      pv-auto-scroll-redesign).
//
//   3. FALLBACK-01 clean inactive render: on `type:"inactive"` we
//      render exactly one literal string (see the JSX below) inside a
//      single wrapper div — no message list, no session picker, no
//      retry affordance. Do NOT retry automatically: any resumption
//      logic here would risk stepping past an inactive frame and
//      violating the FALLBACK-01 letter.

export interface PrettyViewProps {
  hostId: number;
  tmuxSession: string;
  className?: string;
  style?: React.CSSProperties;
  // Optional; when omitted, PrettyView renders as read-only (Phase
  // 1 backward-compat). When provided, the compose box mounts at
  // the bottom and pipes typed messages through this callback.
  onSend?: (text: string) => boolean;
  // Patch #120: safety-valve Ctrl-C. Threaded straight through to
  // ComposeBox's onInterrupt — see ComposeBox for the full contract.
  // Omit when PrettyView is read-only; the Stop button then never
  // renders.
  onInterrupt?: () => void;
  // PTY-side "Claude is currently working" signal from the terminal
  // WebSocket (patch #13 mechanism). `false` = Claude quiet ≥4s AND
  // foreground = claude → hide the WIP bubble. `true` = actively
  // working → show the WIP bubble. `null` = backend has not spoken
  // yet on the current attach → do not show (unknown).
  isIdle?: boolean | null;
  // Phase 05: the terminal-pane's SSH WebSocket. When provided, the
  // upload orchestrator hook uses it to emit upload_start / upload_chunk
  // and to listen for upload_progress / upload_complete / upload_failed /
  // upload_ready_to_inject events. When null/undefined, uploads are
  // effectively disabled — chip strip / drop overlay still render but
  // startBatch will park pending until the WS arrives (in practice
  // Terminal.tsx passes the live ref; Plan 03 wires this end).
  terminalWs?: WebSocket | null;
  // Phase 05: fires when upload_ready_to_inject arrives from the backend
  // for a completed batch. The text is the formatInjectedUserTurn(...)
  // output (caption + delimiter + per-file metadata lines) and the
  // messageQueueItemId is the id patch #60 uses for atomic delete-on-send.
  // Plan 03 wires this to Terminal.tsx sendInput so the injected turn
  // flows through the existing split-and-delay path (patch #100) under
  // the same lifecycle key.
  onInjectedTurnReady?: (text: string, messageQueueItemId: string) => void;
  // Quick 260806-lzd — long-press-to-toggle-pretty-view. Terminal.tsx passes
  // `() => setIsPrettyMode(v => !v)` so the pretty-view-surface IdentityBadge
  // can flip back to terminal mode via the same tap-and-hold gesture the
  // terminal-surface badge uses. Optional so callers that don't own the
  // isPrettyMode state (e.g. tests, standalone previews) can omit it — the
  // badge then simply doesn't wire pointer handlers (see IdentityBadge).
  onTogglePrettyMode?: () => void;
  // Quick 260808-b74 (hidden-pane-cost-mitigation-empirical-rotation, iteration 1):
  // When false, the Claude-session WS is closed to eliminate the ~10-13
  // WS frames/30s per hidden pane. When flipped back to true, the existing
  // patch #148 reconnect scheduler reopens the WS. Terminal.tsx is the sole
  // caller and always has `isVisible` in scope — required, not optional.
  isVisible: boolean;
}

type Status = "connecting" | "streaming" | "inactive" | "error";

// Patch #86: pretty-view's message stream now interleaves text messages
// and image bubbles in strict wire order (the whole point of the patch —
// Ashley sees "the agent read this image" at the correct chronological
// position). Both event shapes share `eventId` + `ts`, so appendDedup's
// dedup logic remains a one-line hash check.
type StreamEvent =
  | ChatMessageEvent
  | ImageEvent
  | RelayOutboundEvent
  | RelayInboundEvent
  | MalformedLineEvent;

function appendDedup(
  prev: StreamEvent[],
  next: StreamEvent,
): StreamEvent[] {
  if (prev.some((m) => m.eventId === next.eventId)) return prev;
  return [...prev, next];
}

// Phase 14 followup + UAT amendment E41 (Ashley 2026-07-27): recognize both
// invocation forms of the /id command. (a) SSH-typed raw form: literal
// "/id " prefix (trailing space excludes /identity / /idle / bare /id).
// (b) Harness slash-UI form: pretty-view's slash-UI emits the command as
// literal XML tags into JSONL (<command-name>/id</command-name>...), NOT
// as raw text. The .includes check is safe — that XML tag string is not
// a legal substring of any prose user turn; it only appears when the
// harness itself constructs the wrapper. Module-local by design (no
// export, no shared-utils hoist) per Phase 14 no-new-shared-utils posture.
const isIdCommand = (content: string): boolean =>
  content.trimStart().startsWith("/id ") ||
  content.includes("<command-name>/id</command-name>");

export function PrettyView({
  hostId,
  tmuxSession,
  className,
  style,
  onSend,
  onInterrupt,
  isIdle,
  terminalWs,
  onInjectedTurnReady,
  onTogglePrettyMode,
  isVisible,
}: PrettyViewProps) {
  const [messages, setMessages] = useState<StreamEvent[]>([]);
  const [status, setStatus] = useState<Status>("connecting");
  const [inactiveReason, setInactiveReason] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Context-window fill %, scraped by the backend from Claude Code's tmux
  // status line every 3s. null = backend hasn't emitted a reading yet on
  // the current attach; hold-last is enforced upstream (the server doesn't
  // emit on regex miss), so once set this value only moves on a real read.
  const [contextPct, setContextPct] = useState<number | null>(null);
  // Claude Code harness task list (TaskCreate + /queue items). Empty array
  // = confirmed no tasks; the backend polls every 3s and emits on change.
  // The panel above the compose box mounts only when the FILTERED list
  // (pending + in_progress) is non-empty.
  const [harnessTasks, setHarnessTasks] = useState<HarnessTask[]>([]);
  // Currently-running background Agent invocations, derived by the backend
  // from parent-JSONL tool_use/tool_result correlation (patch #61). The
  // backend only sends this list when it CHANGES; unchanged ticks are
  // suppressed. The panel below mounts only when non-empty — a completed
  // subagent drops out within one tail line, so a session with no live
  // background work carries no chrome.
  const [backgroundedAgents, setBackgroundedAgents] = useState<
    BackgroundedAgent[]
  >([]);
  // Currently-running background Bash{run_in_background:true} invocations,
  // derived by the backend from parent-JSONL tool_use + task-notification
  // correlation (patch #68). The backend only sends this list when it
  // CHANGES; unchanged ticks are suppressed. The panel below mounts only
  // when non-empty — a completed shell drops out on the completion
  // task-notification event, so a session with no live background shells
  // carries no chrome. Scope: Bash-only; Monitor invocations are excluded.
  const [backgroundedShells, setBackgroundedShells] = useState<
    BackgroundedShell[]
  >([]);
  // Currently-pending ExitPlanMode prompt from the parent JSONL
  // (patch #63). Backend emits `pending: {...}` when Claude is
  // waiting on the user's "1"/"2" Plan Mode reply, and `pending:
  // null` when the tool_result closes the pair.
  //
  // Phase 24: presence detection still authoritative for bubble mount/
  // unmount, but the bubble now RENDERS the plan file contents (fetched
  // async by the backend via SFTP side-channel per Plan 03) plus
  // [Approve] + [Feedback] buttons. Approve fires raw_keystrokes with
  // "1\r"; Feedback Submit fires raw_keystrokes with "3<text>\r". Both
  // bypass ComposeBox's split-send because Ink Plan Mode does not
  // recognize split-send as a keystroke selection (patch #67 retraction
  // lesson — verified by Ashley 2026-07-18 on Amelia's pane).
  //
  // Shape widened from `{planFilePath: string}` to
  // `{planFilePath|null, planContent|null, contentError|null}` to match
  // Plan 03's widened PlanPendingEvent wire type — see claude-session-
  // api.ts. When planFilePath is null the bubble skips the middle
  // section entirely (buttons still work); when planContent is null
  // AND contentError is null the bubble shows "Loading plan…" italic;
  // when contentError is non-null the bubble shows the error dim.
  const [planPending, setPlanPending] = useState<
    {
      planFilePath: string | null;
      planContent: string | null;
      contentError: string | null;
    } | null
  >(null);
  // Phase 14 (plain-language-translation-asides) Wave 3: currently-
  // displayed plain-language aside for this session. `null` = no aside;
  // `string` = aside text extracted by the backend from the tmux BTW
  // overlay (delivered via `{type:'aside_ready', text}` WS frame) and
  // ready to render inside <AsideBubble />. Backend is the sole source
  // of truth (per CONTEXT.md § State model — the tmux overlay itself is
  // the sole source of truth; backend is a pure translator). This state
  // flips off via:
  //   1. `{type:'aside_dismissed'}` WS frame — server-authoritative
  //      cross-tab-coherent broadcast on marker-disappearance OR any
  //      client's dismiss.
  //   2. Optimistic clear in handleAsideDismiss (X-click) BEFORE the
  //      round-trip completes.
  //   3. Fresh-pane reset (paneKey change) so a new pane starts clean.
  // Refs: ASIDE-01 (arm→display), ASIDE-05 (in-flow at bottom of
  // message stream), ASIDE-09 (re-attach probe delivers aside_ready to
  // a late-mounting client).
  const [asideText, setAsideText] = useState<string | null>(null);
  // Phase 14 quick-task 260726-vbd — generation-window blocking parity.
  //
  // WHY: The aside-active blocking (ComposeBox aux buttons disabled +
  // send button morphs to X/Resume) currently only covers the DISPLAY
  // phase (post-aside_ready, pre-dismiss). This leaves the GENERATION
  // phase (from /btw submit through aside_ready arrival, typically a
  // few seconds to ~1 min) unblocked — Ashley can accidentally send
  // unrelated input that collides with Claude Code's in-flight /btw
  // handling. The same single-Escape-primitive (dismissBtw) works
  // to cancel an in-flight /btw OR clear a displayed aside, so a single
  // button + handler suffices. Only the "when is aside active?" predicate
  // needs to widen.
  //
  // asidePending: true from /btw submit until aside_ready arrives (or
  // handleAsideDismiss runs, or the 60s safety timeout fires).
  //
  // 60s safety timeout: belt-and-suspenders for "aside_ready never
  // arrives" (e.g. Claude Code died mid-answer). When it fires it just
  // calls clearAsidePending() — no backend broadcast, no retry.
  const [asidePending, setAsidePending] = useState(false);
  const asidePendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Phase 3: session-changeover holding state. True during the ~5s gap
  // between the old Claude session's death and the new one's launch (per
  // Plan 03-01 backend's Layer 1 raw-line /exit scan OR Layer 2 discovery-
  // repoll's SIGTERM-fallback path). Cleared by `session_changed` (recycle
  // completed) or `inactive` with reason "holding_timeout" (recycle failed).
  // WebSocket is NOT closed during holding — the tail restart is server-side
  // and transparent to this client (see CONTEXT.md § Frontend event handling).
  //
  // Phase 30 (PS30-04): isHolding local state slot DELETED — the
  // ComposeBox isHolding prop now derives from `renderedState === "holding"`
  // (backend-authoritative). setIsHolding sites in the WS handler cases
  // for session_holding / session_holding_cleared / session_changed /
  // inactive are also DELETED — the pane_state WS frame drives the
  // rendered state directly through the paneState React state slot below.
  // Patch #87: identity modal open state. Clicking the lg IdentityBadge sets
  // this to true; the IdentityModal handles close via onOpenChange (Esc,
  // backdrop, X button all route through shadcn Dialog's onOpenChange).
  const [isIdentityModalOpen, setIsIdentityModalOpen] = useState(false);
  // Phase 30: SessionHoldingOverlay mounts directly on
  // `renderedState === "holding"`. Patch #74's delay-arm boolean was
  // retired in Phase 29 (subsumed into the hook's 150ms spinner delay-arm)
  // and Phase 30 further deletes the spinner delay-arm itself — see the
  // hook rewrite in Task 2 of Plan 30-03.
  // phase-29: DELETED — patch #122 warm-red recycle-failed variant flag.
  // Retired with the 10-minute client watchdog per SPEC req 5. Backend
  // HOLDING_TIMEOUT_TICKS=200 (10min) remains the authoritative give-up
  // signal; when it fires, backend emits `pane_state` with state=inactive
  // and reason=holding_timeout (Phase 30 — was `inactive` frame in Phase
  // 29) which the state machine reads via paneState.
  // dormant/waking/etc. remain LOCAL because DormancyOverlay reads them as
  // props (waking, elapsedSeconds, onWake, error). The mount gate for
  // DormancyOverlay itself derives from `renderedState === "dormant"`
  // (Phase 30 — backend-authoritative); the `dormant` local state slot
  // is retained ONLY because the WS onmessage handler needs to observe
  // parsed.dormant to clear waking/wakingStartTs/wakeError on wake
  // completion (see the `dormantRef` live-frame auto-dismiss path).
  const [dormant, setDormant] = useState(false);
  const [waking, setWaking] = useState(false);
  const [wakingStartTs, setWakingStartTs] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [wakeError, setWakeError] = useState<string | null>(null);
  // Phase 30: loading-arm boolean + first-user-visible-frame auto-dismiss
  // are DELETED. PrettyViewLoadingOverlay mounts on
  // `renderedState === "resolving"` directly (no delay-arm — D-04 anti-
  // flash deferred per 30-CONTEXT.md; backend emits pane_state fast enough
  // that the flash risk is gone).
  // Phase 30 (PS30-05): patch #381's client-hint anti-pattern is DELETED.
  //
  // Pre-Phase-30 this callback synchronously flipped local isHolding=true
  // AND flipped the client-inferred first-frame axis to "session_holding"
  // so the SessionHoldingOverlay could mount BEFORE the backend confirmed
  // the /id reset — a user-gesture hint working around the client-
  // inference gap. Phase 30 removes that gap: the backend's session-file
  // parser (Plan 30-02) detects /id reset in the JSONL tail and the
  // pane_state emitter (Plan 30-01) fires `{type:"pane_state",
  // state:"holding", reason:"id_reset"}` within milliseconds — the
  // ~10-30ms round-trip includes SSH exec + tmux send-keys + Claude Code
  // processing + JSONL write, and dominates by 50-100× over the WS emit-
  // and-receive path. Patch #381 was working around a client-inference
  // sourcing gap, not a network-latency gap; with the sourcing gap
  // closed, the client hint is redundant and DELETED.
  //
  // If UAT surfaces a visible-flash regression, the documented fallback
  // (client-hint-with-backend-override) is: `onClick={() => {
  // setPaneState("holding"); /* tmux keystroke fires as normal */ }}` —
  // a one-line optimistic hint that the NEXT pane_state frame from the
  // backend overrides unconditionally. Distinct from patch #381 in that
  // patch #381 was a client-source-of-truth that could disagree with the
  // backend indefinitely (until a client-inference update overrode it);
  // this fallback design has the backend override on the very next frame
  // no matter what. Not implemented here; deferred to deploy-orchestrator
  // UAT loop per Plan 30-03 § F4 acknowledgment.
  //
  // The reset button's UI role (tmux keystroke firing /id reset into the
  // pane) lives elsewhere in the ComposeBox reset-cell component; this
  // callback is a no-op placeholder for the ComposeBox prop contract.
  const onResetClicked = useCallback(() => {
    // No-op — see comment above.
  }, []);
  // Phase 14 quick-task 260726-vbd: single clear-primitive for asidePending.
  // Clears both the boolean flag and the 60s safety timer. Used by:
  //   (a) aside_ready case — display state takes over, pending flag clears.
  //   (b) aside_dismissed case — backend observed marker disappear.
  //   (c) handleAsideDismiss — X/Resume click during pending or displayed phase.
  //   (d) session_changed — fresh pane starts with no in-flight aside.
  //   (e) the 60s timeout callback itself — self-fires and nulls the ref.
  const clearAsidePending = useCallback(() => {
    setAsidePending(false);
    if (asidePendingTimerRef.current !== null) {
      clearTimeout(asidePendingTimerRef.current);
      asidePendingTimerRef.current = null;
    }
  }, []);

  // Phase 14 Wave 3: dismiss callback for the aside (X/Resume click in
  // ComposeBox — Wave 4 wires the button). Two steps per CONTEXT.md
  // § Dismiss:
  //   1. Optimistic clear of asideText so the AsideBubble unmounts
  //      immediately (no visible latency waiting for the WS round-trip).
  //   2. WS-send {type:'aside_dismissed', hostId, tmuxSession} — Wave 2
  //      backend receives this, dismissBtw's into tmux, then
  //      broadcastAsideDismissed fans out to peer tabs on the same
  //      sessionKey (cross-tab dismiss coherence per ASIDE-11).
  // Idempotent: if the WS is closed or the send throws, the optimistic
  // clear still happened. The backend's next poller cycle will detect
  // marker-disappearance (Ashley may still have to Escape manually via
  // SSH in that failure mode) and broadcast dismissed; the WS
  // aside_dismissed handler above is idempotent so no double-render.
  // Per T-14-02-01 mitigation: the backend IGNORES msg.hostId +
  // msg.tmuxSession for send-keys routing (uses connection-scoped
  // currentHostId + currentTmuxSession only), so these fields are
  // informational-only from the backend's perspective. Included here
  // matching AsideDismissedPayload's exported type shape.
  // Dismiss-loop guard (Ashley 2026-07-26 UAT): dismissing an aside
  // sends Escape into tmux to close the /btw overlay, which produces
  // brief pane activity → Claude Code's isIdle flips false → 4s later
  // returns true. Without a cooldown, that trailing false→true
  // transition trips the arm-emitter useEffect and re-injects /btw,
  // creating a dismiss→arm→dismiss loop. 8s covers the ~4-5s
  // dismiss→settle→isIdle=true path with safety margin.
  const dismissCooldownUntilRef = useRef<number>(0);

  // Phase 14 followup (Ashley 2026-07-26): full aside-surface reset for
  // session-changeover paths. Extends clearAsidePending with the two
  // pieces the pending-only clear misses — the displayed asideText and
  // the 8s dismissCooldownUntilRef. Called from both changeover paths
  // (paneKey change and session_changed WS event) so a new pane or
  // recycled session starts with a genuinely blank aside surface. Safe
  // even if the new pane's tmux has a live BTW overlay: the backend's
  // connect-time re-attach probe (ASIDE-09) re-emits aside_ready.
  const clearAsideState = useCallback(() => {
    setAsideText(null);
    clearAsidePending();
    dismissCooldownUntilRef.current = 0;
  }, [clearAsidePending]);

  const handleAsideDismiss = useCallback(() => {
    setAsideText(null);
    // Phase 14 quick-task 260726-vbd: clear the pending flag and 60s timer
    // regardless of whether the aside was still pending or already displayed.
    // Same Escape-into-tmux payload closes an in-flight /btw OR a displayed one.
    clearAsidePending();
    dismissCooldownUntilRef.current = Date.now() + 8000;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(
          JSON.stringify({
            type: "aside_dismissed",
            hostId,
            tmuxSession,
          }),
        );
      } catch {
        /* swallow — best-effort; backend detects marker disappearance on its own cycle */
      }
    }
  }, [hostId, tmuxSession]);

  // quick 260808-cd6: wake handler. Sends {type:"wake"} to the backend
  // which SSH exec's rm -f on the .dormant sentinel. Backend trust-boundary
  // (T-cd6-01): uses connection-scoped currentTmuxSession, NOT any payload field.
  // Sets local waking=true + wakingStartTs so the elapsed-seconds ticker starts.
  const handleWake = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: "wake" }));
    } catch {
      /* swallow — best-effort; ws may be mid-close */
    }
    setWaking(true);
    setWakingStartTs(Date.now());
    setWakeError(null);
  }, []);

  // Phase 24: plan-mode replies use a NEW WS frame `raw_keystrokes` that
  // writes bytes to the PTY in one shot (no split-send). The split-send
  // ComposeBox uses is NOT recognized by Ink Plan Mode (patch #67 lesson).
  // Backend calls `tmux send-keys -l` (literal) so \r, 1, 3 are treated
  // as bytes, not tmux key-names. Trust-boundary: backend ignores any
  // client-supplied hostId/tmuxSession — uses connection-captured state
  // (T-14-02-01 pattern) — so we send bytes only.
  //
  // Both handlers mirror handleAsideDismiss's swallow-on-error shape:
  // best-effort dispatch, no retry, WS may be mid-close.
  const handlePlanApprove = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: "raw_keystrokes", bytes: "1\r" }));
    } catch {
      /* swallow — best-effort; ws may be mid-close */
    }
  }, []);

  const handlePlanFeedback = useCallback((feedback: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(
        JSON.stringify({ type: "raw_keystrokes", bytes: `3${feedback}\r` }),
      );
    } catch {
      /* swallow — best-effort; ws may be mid-close */
    }
  }, []);
  // Phase 14 quick-task 260726-vbd: onSend wrapper that detects /btw
  // submissions and arms the asidePending flag + 60s safety timer.
  //
  // Detection: `text.trim().startsWith('/btw ')` OR `text.trim() === '/btw'`
  // — `/btwXYZ` is NOT the aside slash-command; `/btw` alone or `/btw foo` are.
  //
  // Intentionally arms asidePending EVEN IF onSend returns false (WS not open).
  // Rationale: ComposeBox shows an inline error; the 60s timeout clears the
  // false alarm; X/Resume also clears immediately (sends Escape to a pane that
  // received no /btw — a no-op in tmux). Simpler than conditionally arming
  // based on the boolean return value.
  //
  // Always delegates to onSend(text) and returns its boolean result unchanged —
  // the send itself still needs to fire (that IS what triggers the aside).
  // handleComposeSend needs to trigger forceStickAndJump on send, but
  // useAutoScroll is called later in this render body. Route through a ref
  // that we assign post-useAutoScroll-call to avoid a TDZ on the const
  // closure capture (handleComposeSend is declared here, above the hook call).
  const forceStickAndJumpRef = useRef<() => void>(() => {});

  const handleComposeSend = useCallback((text: string): boolean => {
    const trimmed = text.trim();
    if (trimmed.startsWith('/btw ') || trimmed === '/btw') {
      // Clear any existing timer before arming a fresh one (in case the user
      // sends /btw twice before the first aside_ready arrives).
      if (asidePendingTimerRef.current !== null) {
        clearTimeout(asidePendingTimerRef.current);
      }
      setAsidePending(true);
      asidePendingTimerRef.current = setTimeout(() => {
        asidePendingTimerRef.current = null;
        setAsidePending(false);
      }, 60000);
    }
    // A send is the strongest possible "I want to see the reply" signal —
    // force stick + jump regardless of prior scroll position.
    forceStickAndJumpRef.current();
    return onSend ? onSend(text) : false;
  }, [onSend]);

  // WIP indicator: composite isWorking from session-working-store.
  // Patch #260806-ixl: both the PTY-side ttyBusy signal (Terminal.tsx) and
  // the backgrounded-work signal (PrettyView WS frames) now converge in the
  // shared store; useSessionIsWorking derives the OR. The key format MUST
  // match Terminal.tsx's `${hostId}:${tmuxSessionName ?? ""}` exactly —
  // single colon, not the double-colon paneKey used for auto-scroll.
  const sessionWorkingKey = `${hostId}:${tmuxSession ?? ""}`;
  const isWorking = useSessionIsWorking(sessionWorkingKey);

  const wsRef = useRef<WebSocket | null>(null);
  // Bounty pretty-view-per-pane-cost-diag: rolling counter of WS frames
  // received since the last diag emit. Snapshot fn reads + resets. Also
  // a ref-mirror of messages.length so the snapshot doesn't need to
  // touch React state (which would need a re-render dance to stay fresh).
  const wsFramesRef = useRef<number>(0);
  const messagesLenRef = useRef<number>(0);
  const pvRootRef = useRef<HTMLDivElement | null>(null);
  // Patch #148 reconnect state — mirrors Terminal.tsx's pattern.
  // reconnectAttemptsRef: persists across retryKey re-runs; resets on hostId/tmuxSession change
  //   and on visibilitychange:visible. NOT reset on ws.onopen (defeats the cap on rapid cycles).
  // reconnectTimeoutRef: pending retry timer; cleared on cleanup/unmount/visibility-hide.
  // paneKeyRef: "${hostId}::${tmuxSession}" mirror — used inside the WS effect to distinguish
  //   a fresh pane mount (full reset needed) from a retryKey-triggered re-run (preserve state).
  // retryKey: bumped by the retry scheduler and by the visibilitychange handler to trigger
  //   the WS-setup useEffect re-run without losing messages/status on a new-pane navigation.
  // statusRef: mirrors `status` via a dedicated useEffect so onclose can read current status
  //   without calling setStatus's functional-update form from inside a WS callback.
  const reconnectAttemptsRef = useRef<number>(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paneKeyRef = useRef<string>('');
  const [retryKey, setRetryKey] = useState<number>(0);
  const statusRef = useRef<Status>('connecting');
  // Quick 260808-b74: isVisibleRef mirrors the `isVisible` prop so the onclose
  // retry scheduler and visibilitychange handler can read current visibility
  // without adding isVisible to the main WS-setup effect deps (which would
  // tear down and rebuild the WS on every visibility flip — we want the dedicated
  // WS-pause effect to own that cleanly). Pattern mirrors statusRef above.
  const isVisibleRef = useRef<boolean>(isVisible);
  // quick 260808-cd6: dormantRef mirrors `dormant` state for stale-closure
  // protection inside the WS onmessage handler. The WS onmessage closure
  // captures state at closure-creation time; reading from a ref gives the
  // current value without re-creating the socket. Pattern mirrors isVisibleRef.
  const dormantRef = useRef<boolean>(false);
  // Phase 14 Wave 3: previous-value ref for the isIdle-transition
  // arm-emitter useEffect below. Holds the isIdle value from the
  // previous render so we can detect a real false→true transition
  // (agent settled after a completed turn — the WIP-indicator idle
  // window). Initialized to the current isIdle prop so a mount with
  // isIdle already true does NOT fire arm on first paint (per
  // CONTEXT.md § Trigger — only real transitions arm, not the initial
  // steady-state observation).
  const prevIsIdleRef = useRef<boolean | null | undefined>(isIdle);

  // phase-29: mirror reconnectAttemptsRef into state so the wsState derivation
  // below re-runs whenever the retry counter changes. reconnectAttemptsRef is
  // a ref (mutations do NOT trigger re-render); this state slot is the
  // observable projection consumed by the state machine's wsState input.
  const [reconnectAttempts, setReconnectAttempts] = useState<number>(0);

  // Phase 30 (PS30-04): paneState — the last received `pane_state.state`
  // value from the backend wire frame (see PaneStateEvent in
  // claude-session-api.ts). null = no pane_state frame received yet
  // (fresh mount + WS opening). Set by the `case "pane_state"` WS handler
  // below; reset to null on cold-mount (fresh pane) so the state machine
  // re-enters resolving until the backend re-emits.
  //
  // The paneState value drives every overlay mount gate below via the
  // trivial usePaneResolvingMachine hook + pure resolveRenderedState
  // reducer. No ref-mirror needed — the derivation is pure and reads
  // React state directly. No client-inference indirection — every
  // ~10 legacy client-hint call sites DELETED per PS30-04 + PS30-05.
  const [paneState, setPaneState] = useState<PaneState | null>(null);

  // Phase 05: touch-device gate for the mobile paperclip (UPLOAD-03).
  // The paperclip appears on touch devices only — desktop NEVER sees it
  // regardless of window width. Do NOT re-detect touch here; the shared
  // hook (patch #102) is the single source of truth.
  const isTouchDevice = useIsTouchDevice();

  // Phase 05: drag/drop state for the DropOverlay. `dragCounter` tracks
  // enter/leave events, which can misfire when the drag moves over child
  // elements (each child boundary fires dragenter then dragleave). We
  // only flip the overlay off when the counter reaches 0.
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  // Phase 05: upload orchestrator. Owns staged-attachment state, chunk
  // pump, batch atomicity, retry API, and the onUploadReadyToInject seam.
  // Wired to the terminalWs prop; when the caller doesn't provide a WS
  // (read-only PrettyView), uploads are effectively parked (startBatch
  // still works but sits in pending state).
  const uploads = usePrettyViewUploads({
    ws: terminalWs ?? null,
    onUploadReadyToInject: ({ messageQueueItemId, files, caption }) => {
      const injectedText = formatInjectedUserTurn({ caption, files });
      onInjectedTurnReady?.(injectedText, messageQueueItemId);
      // Clear staging after the injected turn is handed off.
      uploads.resetBatch();
    },
    getBufferedAmount: () => terminalWs?.bufferedAmount ?? 0,
  });

  // paneKey is retained because it is consumed by the WS effect's paneKeyRef
  // comparison (see ~L714/L746) to distinguish a fresh-pane mount from a
  // retryKey-triggered WS re-run. It is NO LONGER used for auto-scroll
  // reset — auto-scroll is TEMP-disabled (see stub block below).
  const paneKey = `${hostId}::${tmuxSession}`;
  // TEMP 2026-08-10: auto-scroll disabled per bounty pv-disable-auto-scroll-temp
  // after Phase 27 virtualization made snap-to-bottom unusable. use-auto-scroll.ts
  // is kept in-tree as reference for the eventual redesign (bounty
  // pv-auto-scroll-redesign — do not re-enable this stub without that redesign).
  //
  // EXCEPTION 2026-08-10 (Ashley): the jump-to-bottom pill is restored as a pure
  // MANUAL affordance — click scrolls the container to the bottom (imperative,
  // no pin/follow, no scroll-position ownership). `isPinnedToBottom` state is
  // tracked JUST for pill visibility (hide when at bottom, show when scrolled
  // up); it does NOT drive any auto-scroll behavior. `forceStickAndJump` stays
  // no-op (used by ComposeBox on send; that's still auto-scroll-adjacent).
  const stubScrollElRef = useRef<HTMLElement | null>(null);
  const [stubScrollNode, setStubScrollNode] = useState<HTMLElement | null>(null);
  const scrollRef = useCallback((el: HTMLElement | null) => {
    stubScrollElRef.current = el;
    setStubScrollNode(el);
  }, []);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState<boolean>(true);
  useEffect(() => {
    const el = stubScrollNode;
    if (!el) return;
    // 24px slack absorbs sub-pixel rounding + line-break growth without the
    // pill flickering visible at the true bottom.
    const AT_BOTTOM_THRESHOLD_PX = 24;
    const recompute = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setIsPinnedToBottom(distanceFromBottom <= AT_BOTTOM_THRESHOLD_PX);
    };
    recompute();
    el.addEventListener("scroll", recompute, { passive: true });
    return () => el.removeEventListener("scroll", recompute);
    // messages.length in deps re-runs recompute when new content arrives so
    // the pill appears if the bottom moved further away while the user was
    // stationary.
  }, [stubScrollNode, messages.length]);
  const scrollToBottomAndFollow = useCallback(() => {
    const el = stubScrollElRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  const forceStickAndJump = useCallback(() => {}, []);

  // Phase 27 virtualization (Plan 27-02): construct the virtualizer AFTER
  // useAutoScroll so any CapturingResizeObserver polyfill in tests captures
  // useAutoScroll's RO first (see 27-PATTERNS.md SURPRISE #3). The virtualizer
  // shares the outer scroll container with useAutoScroll via a composed
  // callback ref (composeScrollRefs below).
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollElRef.current,
    // Rough default; measureElement corrects per-item once real DOM heights
    // are known. TanStack Virtual defaults overscan to 5.
    estimateSize: () => 80,
    overscan: 5,
    // Phase 28 (M1): matches the outer scroll container's py-3 (= 12px)
    // top padding — the sized virtualizer container starts at scrollTop
    // offset 12, not 0. TanStack Virtual computes the visible slice via
    // `scrollTop - scrollMargin`, so without this the slice is off-by-12
    // (absorbed by overscan today, but scrollToIndex would land 12px too
    // high). Source-of-truth for the 12: the "px-4 py-3" className on the
    // composeScrollRefs div at PrettyView.tsx :1816 — UPDATE both if the
    // padding class changes.
    scrollMargin: 12,
    // Phase 28 (M4): diagnostic fallback. The review's M4 finding argued
    // the "race" the previous `?? i` fallback protected against is not
    // real (count and messages come from the same render). If TanStack
    // Virtual ever calls getItemKey with i >= messages.length, that
    // indicates a genuine bug — surface it via console.warn AND avoid the
    // eventId-collision hazard of returning `i` directly (a real integer
    // eventId "5" would collide with fallback 5, invalidating the
    // measurement cache). The __oob_${i} string prefix is loud enough to
    // spot in DOM inspection AND safe from collision. If the warn never
    // fires in ~1 week of production traffic, convert to a bare throw or
    // drop the fallback per the review's Option (a).
    getItemKey: (i) => {
      const evt = messages[i]?.eventId;
      if (evt !== undefined) return evt;
      // eslint-disable-next-line no-console
      console.warn(
        `[pv-virtual] getItemKey out-of-range i=${i} messages.length=${messages.length}`,
      );
      return `__oob_${i}`;
    },
    // Fallback viewport rect used until the first ResizeObserver callback
    // fires on the scroll container. In real browsers this is transient
    // (RO fires within a frame). In JSDOM (test env), ResizeObserver is a
    // no-op stub that never fires, so this becomes the permanent rect.
    // Phase 28 (M2): height reduced 4096→600 so the first paint mounts
    // ~5-10 real bubble subtrees (600/80 + 10 overscan ≈ 17) instead of
    // ~60 (4096/80 + 10 ≈ 61) — preserving the phase's bounded-DOM goal
    // through the transient pre-RO window on every mount / paneKey change /
    // reconnect. Width stays 1024 (only height affects virtualization
    // slicing per review L5).
    initialRect: { width: 1024, height: 600 },
    // Override the default observeElementRect (which reads offsetWidth /
    // offsetHeight) with one that falls back to a sensible rect whenever
    // the element reports zero-sized offsets. This matters in two cases:
    //   1. JSDOM (tests): offset{Width,Height} are always 0 → without this
    //      fallback the virtualizer computes an empty visible range and
    //      renders nothing, breaking any content-presence assertion.
    //   2. Hydration / first-paint-before-layout: transient zero-size read
    //      before browser layout resolves. With this fallback, the first
    //      paint uses a sensible slice rather than a blank box.
    // Once the real ResizeObserver fires with a non-zero rect (the browser
    // case), that value takes over as normal. Phase 28 (M2): the fallback
    // matches initialRect (see below) so the synchronous install-time
    // read() call does not silently balloon the visible slice past the
    // initialRect budget.
    observeElementRect: (instance, cb) => {
      // H3 fix: every early-return branch MUST return a () => void cleanup
      // (not bare undefined). TanStack Virtual stores the return value as
      // the cleanup and calls it on rebind (e.g., scrollElement flips from
      // null → element on first mount, or on status re-mount cycles). A
      // bare `return;` stored undefined would throw
      // `TypeError: undefined is not a function` when TanStack later
      // invokes cleanup — currently only masked by a defensive typeof
      // guard in the library. Do not rely on that.
      const bindEl = instance.scrollElement as HTMLElement | null;
      if (!bindEl) return () => {};
      const win = instance.targetWindow;
      if (!win) return () => {};
      // H4 fix: re-derive from instance.scrollElement on every fire so a
      // stale RO on the old scroll container reports current dimensions
      // (not the captured-at-bind stale one). If instance.scrollElement
      // is transiently null when the callback fires (mid-remount), bail
      // WITHOUT calling cb(...) so a spurious zero rect doesn't propagate.
      //
      // Phase 28 (M2 alignment): the offsetHeight fallback is 600 —
      // matching initialRect.height (see M2 comment below). Both fallbacks
      // MUST agree: the JSDOM/first-paint zero-offset path here must not
      // exceed the initialRect budget, or observeElementRect's synchronous
      // install-time read() would override initialRect with 4096, defeating
      // M2's bounded-DOM goal in the JSDOM test window. If you change
      // initialRect.height, update this literal too — they are the same
      // physical concept (transient viewport size before a real layout
      // measurement is available).
      const read = () => {
        const cur = instance.scrollElement as HTMLElement | null;
        if (!cur) return;
        const w = cur.offsetWidth || 1024;
        const h = cur.offsetHeight || 600;
        cb({ width: w, height: h });
      };
      read();
      if (!win.ResizeObserver) return () => {};
      const ro = new win.ResizeObserver(() => read());
      // Observe the element captured at bind-time so the OLD element
      // continues to be watched for its own resizes; the CALLBACK still
      // reports whichever element is current at fire-time (via read()).
      ro.observe(bindEl);
      return () => ro.disconnect();
    },
  });

  // Compose useAutoScroll's scrollRef and our own scrollElRef onto the same
  // outer scroll container DOM node so BOTH readers see the same element.
  const composeScrollRefs = useCallback(
    (el: HTMLDivElement | null) => {
      scrollElRef.current = el;
      scrollRef(el);
    },
    [scrollRef],
  );

  // Forward the current forceStickAndJump into the ref that handleComposeSend
  // (declared earlier in this render body) reads. Avoids the TDZ that would
  // hit if handleComposeSend captured the const directly.
  forceStickAndJumpRef.current = forceStickAndJump;

  // Patch #108: IdentityModal anchors its Radix Portal to this DOM element
  // (the chat-region wrapper below). Callback ref → state so the Portal
  // container prop updates reactively on ref bind. When null (transient
  // first render before the ref binds), Portal defaults to document.body —
  // harmless because the modal doesn't open until user clicks IdentityBadge,
  // by which point the ref is set. Wrapper needs `position: relative` for
  // the modal's `absolute inset-4` to resolve against it.
  const [chatRegionEl, setChatRegionEl] = useState<HTMLDivElement | null>(null);

  // Phase 4: derive per-pane identity + hue for the Glass reskin.
  //
  // useSessionIdentity(tmuxSession) reads the identities registry
  // (patch #17) via the shared session-hue helper (patch #30 lifted the
  // reader). Returns the matched identity or null; identityHue is the
  // identity's stored colorHue (0-360) or null when the identity has
  // no colorHue set.
  //
  // Fallback: hue 35 (warm neutral amber, matches the design mock's
  // Tina hue and the IdentityBadge lg treatment's own fallback). This
  // gives every pretty-view pane a coherent color chain even when the
  // pane's identity has no colorHue set OR the pane has no identity
  // at all. NOTE: this differs from the terminal pane (patch #26)
  // which uses hueFromSessionName as a hash-based fallback — pretty
  // view is deliberately more restrained per CONTEXT.md § Decisions 2.
  const { identity: pvIdentity, identityHue: pvIdentityHue } = useSessionIdentity(tmuxSession);
  const pvIdentityKey = sessionMatchKey(tmuxSession);
  const pvHue = pvIdentityHue ?? 35;

  // Phase 30 (PS30-04 + PS30-06): derive wsTransportState for the trivial
  // 2-input state machine from existing PrettyView state (D-13 — WS ladder
  // unchanged, observed only). The pretty-view WS layer's retry ladder
  // (patch #148) is untouched; this derivation reads only its observable
  // state signals:
  //   - status === "streaming" OR "inactive"                            → "open"
  //   - status === "error" AND reconnectAttempts >= MAX_RECONNECT_ATTEMPTS
  //     → "failed-permanently" (retry ladder terminally exhausted)
  //   - status === "error" AND reconnectAttempts <  MAX_RECONNECT_ATTEMPTS
  //     → "opening" (retry pending; a fresh WS is scheduled)
  //   - status === "connecting" AND reconnectAttempts === 0             → "not-connected"
  //   - status === "connecting" AND reconnectAttempts > 0               → "opening"
  //
  // Phase 30 note: the Phase-29 proof-of-life shortcut on the wsState
  // derivation (which recognized dormant/holding/inactive frames as WS-
  // open evidence when status hadn't flipped to streaming yet) is
  // REMOVED. Under Phase 30 the resolveRenderedState reducer's D-11
  // don't-flicker branch (transport transient drop + previous paneState
  // → last-known overlay) covers the same failure mode from a different
  // direction: if paneState !== null it renders the last-known overlay
  // regardless of wsTransportState. Backend also emits pane_state on
  // WS attach (see pane-state-emitter startActiveSessionFlow site), so
  // the `session` frame arrives alongside the initial pane_state:active
  // frame and status flips to "streaming" naturally.
  const wsTransportState: WsTransportState =
    status === "error" && reconnectAttempts >= MAX_RECONNECT_ATTEMPTS
      ? "failed-permanently"
      : status === "streaming" || status === "inactive"
        ? "open"
        : status === "connecting" && reconnectAttempts === 0
          ? "not-connected"
          : "opening";

  // Phase 30 (PS30-04): trivial 2-input derivation. Consumes exactly
  // (wsTransportState, paneState) → { renderedState, paneState }. The
  // hook body is a single pure function evaluation; every overlay mount
  // gate below reads `renderedState === "..."` directly.
  const { renderedState } = usePaneResolvingMachine({
    wsTransportState,
    paneState,
  });

  useEffect(() => {
    // Patch #148: distinguish a fresh pane mount from a retryKey-triggered re-run.
    // On a fresh pane (hostId/tmuxSession changed), reset ALL state and the attempt
    // counter. On a retry re-run (same pane, retryKey bumped), preserve messages/
    // status so the UI does not flash blank while reconnecting.
    // paneKey is computed in the render body (line 465) and passed into useAutoScroll;
    // reuse the same value here.
    if (paneKey !== paneKeyRef.current) {
      // Fresh pane mount — full reset.
      setMessages([]);
      setStatus("connecting");
      setInactiveReason(null);
      setErrorMessage(null);
      setContextPct(null);
      setHarnessTasks([]);
      setBackgroundedAgents([]);
      setBackgroundedShells([]);
      // Composite store: clear hasBgWork for this key on fresh-pane mount.
      // Guard on hostId being non-null — matches Terminal.tsx's pattern;
      // PrettyView is always mounted with a hostId in practice, but defensive.
      if (hostId != null) {
        const key = `${hostId}:${tmuxSession ?? ""}`;
        publishSessionHasBackgroundedWork(key, false);
      }
      setPlanPending(null);
      // Phase 30 (PS30-04): reset paneState on cold-mount (fresh pane needs
      // to re-resolve). Fresh pane clears its own paneState state slot so
      // the trivial state machine short-circuits to `resolving` per truth-
      // table row (c) until the backend emits pane_state on the fresh WS.
      setPaneState(null);
      // Phase 14 followup: full aside-surface reset for fresh-pane mount.
      // Clears displayed asideText + pending flag + 60s timer + 8s dismiss
      // cooldown. Backend's connect-time re-attach probe (ASIDE-09) re-emits
      // aside_ready if the NEW pane's tmux still has an open BTW overlay.
      clearAsideState();
      reconnectAttemptsRef.current = 0;
      // phase-29: mirror into state so wsState derivation re-runs on cold-mount
      // reconnect-counter reset.
      setReconnectAttempts(0);
      paneKeyRef.current = paneKey;
    }
    // retryKey-triggered re-runs skip the reset above — preserving messages/status
    // so the UI stays visible while the fresh WS is being opened.

    let cancelled = false;
    const ws = openClaudeSessionSocket();
    wsRef.current = ws;

    ws.onopen = () => {
      if (cancelled) return;
      const payload: ConnectToPanePayload = {
        type: "connectToPane",
        hostId,
        tmuxSession,
      };
      try {
        ws.send(JSON.stringify(payload));
      } catch {
        /* ws may be mid-close */
      }
      // Patch #148: clear any stale "Connection closed" banner from a prior
      // attempt now that the fresh WS is confirmed open. Do NOT reset
      // reconnectAttemptsRef here — a rapid open/close cycle would defeat the cap.
      setErrorMessage(null);
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      if (cancelled) return;
      // Bounty pretty-view-per-pane-cost-diag: count every landed frame
      // regardless of parse outcome — reflects raw WS message rate.
      wsFramesRef.current += 1;
      let parsed: ClaudeSessionServerEvent;
      try {
        parsed = JSON.parse(event.data) as ClaudeSessionServerEvent;
      } catch {
        return;
      }
      // quick 260808-cd6: live-frame auto-dismiss. When the dormant overlay is
      // up and a live-shape JSONL frame arrives, the supervisor's recover path
      // has relaunched claude + /id ran — dismiss the overlay immediately.
      // Uses dormantRef (not dormant state) to avoid stale-closure inside the WS
      // onmessage handler. Hidden-pane suppression is inherited from patch #344's
      // WS-pause on !isVisible; no additional gate needed here — a hidden pane's
      // WS is closed so dormant frames are never received.
      if (
        dormantRef.current &&
        (parsed.type === "message" ||
          parsed.type === "image" ||
          parsed.type === "relay_inbound" ||
          parsed.type === "relay_outbound" ||
          parsed.type === "malformed_line" ||
          parsed.type === "context_pct" ||
          parsed.type === "harness_tasks" ||
          parsed.type === "session")
      ) {
        setDormant(false);
        setWaking(false);
        setWakingStartTs(null);
        setElapsedSeconds(0);
        setWakeError(null);
        // Phase 30 note: the D-11 clean-swap back to "active" that Phase 29
        // needed at this site is now delivered by the backend's own
        // pane_state emit — the supervisor's recover-path live-shape frame
        // is preceded by an emit("active", "dormancy_cleared") from the
        // dormant-poll seam (see pane-state-emitter Plan 30-01 funnel
        // sites). The frontend just observes; no client-side inference
        // needed. Local dormant/waking/wakeError state slots still clear
        // above because DormancyOverlay reads them as props for its
        // transient waking-state UX (unchanged from Phase 29).
      }
      switch (parsed.type) {
        case "pane_state": {
          // Phase 30 (PS30-01 + PS30-04): backend-authoritative pane-entry
          // verdict. Backend emits on WS attach (after connectToPane
          // discovery via startActiveSessionFlow — see Plan 30-01 funnel
          // sites) + on every state change (holding / dormant / inactive /
          // active-recovery / session-changed all funnel through the
          // pane-state-emitter). Frontend just stores it — no inference,
          // no client hints. Overlay mount gates
          // below read paneState (via the trivial usePaneResolvingMachine
          // hook + resolveRenderedState pure reducer) directly.
          // parsed.state is one of "active"|"holding"|"dormant"|"inactive"|"error";
          // parsed.reason is optional diagnostic string, currently unused by
          // the UI (T-30-03-03 information-disclosure mitigation — future UI
          // enhancements that surface reason must go through a fresh threat
          // review).
          setPaneState(parsed.state);
          break;
        }
        case "session": {
          // Session-info frame — flip to streaming; not rendered.
          setStatus("streaming");
          break;
        }
        case "message": {
          setMessages((prev) => appendDedup(prev, parsed));
          break;
        }
        case "image": {
          // Patch #86: image bubbles interleave with text messages in strict
          // wire order — same state channel, same dedup on eventId. The
          // render branch below discriminates on `m.type`.
          setMessages((prev) => appendDedup(prev, parsed));
          break;
        }
        case "relay_outbound": {
          // RELAYBUB-01: outbound relay frame → RelayOutboundBubble (identity-hue, left-aligned per patch #200).
          setMessages((prev) => appendDedup(prev, parsed));
          break;
        }
        case "relay_inbound": {
          // RELAYBUB-02: inbound relay frame → RelayInboundBubble (blue-gray, right-aligned per patch #200).
          setMessages((prev) => appendDedup(prev, parsed));
          break;
        }
        case "malformed_line": {
          // pv-malformed-jsonl-placeholder-bubble (2026-08-10): interleave a
          // compact placeholder so a dropped turn is visible instead of silent.
          setMessages((prev) => appendDedup(prev, parsed));
          break;
        }
        case "inactive": {
          // Patch #122 background: backend fires
          // `inactive { reason: 'holding_timeout' }` from
          // claude-session-server.ts transitionToDead() when the holding
          // timeout expires without a fresh session. Phase 30 note: the
          // paneState "inactive" comes from the sibling pane_state emit
          // (funneled through the same transitionToDead site — see Plan
          // 30-01 Task 2). Here we only capture the reason string for
          // diagnostic display and set status to unmount the compose box
          // (the "no active Claude session" fallback banner is gated on
          // renderedState === "inactive" derived from the pane_state
          // frame, not from status).
          if (parsed.reason === "holding_timeout") {
            // Do NOT setStatus("inactive") on holding_timeout — keep the
            // compose surface flex layout intact so the overlay stays
            // covered until session_changed (recycle actually completed)
            // OR another reset click clears it via a fresh pane_state
            // emit from the backend.
            setInactiveReason(parsed.reason);
            break;
          }
          setStatus("inactive");
          setInactiveReason(parsed.reason);
          break;
        }
        case "context_pct": {
          setContextPct(parsed.pct);
          break;
        }
        // quick 260808-cd6 — dormancy overlay + wake button.
        // Hidden-pane suppression is inherited from patch #344's WS-pause on
        // !isVisible; no additional gate needed here — a hidden pane's WS is
        // closed so dormant frames are never received.
        case "dormant": {
          setDormant(parsed.dormant);
          if (parsed.dormant) {
            // quick 260809-ha3: server-driven wakingSince restores wake-progress
            // bar after Fix B (visibility false->true edge) wipes local
            // wakingStartTs. Loose-equality guards both undefined (older
            // servers pre-260809-ha3) and explicit null (natural-dormant path).
            // Non-null wakingSince means a user-initiated wake is in flight
            // server-side — enter waking state with the authoritative timestamp.
            //
            // Phase 30: the paneState "dormant" comes from the sibling
            // pane_state emit funneled through the dormant-poll seam (see
            // Plan 30-01 § L4214/L4216 + L4649 + L4738/L4740). Local
            // dormant/waking/wakingStartTs stay so DormancyOverlay can read
            // them as props for its wake-progress UX.
            if (parsed.wakingSince != null) {
              setWaking(true);
              setWakingStartTs(parsed.wakingSince);
              setWakeError(null);
              // elapsedSeconds ticker reacts to wakingStartTs going from
              // null to a number and picks up the count automatically.
            }
            // parsed.wakingSince == null (undefined OR explicit null): natural-
            // dormant path — leave waking/wakingStartTs untouched. The dormant:
            // false else-branch below handles clearing when the wake completes.
          } else {
            // Natural resume path: supervisor path 1/2 auto-wake, or race
            // with our own wake. Clear all waking state. The renderedState
            // transition off "dormant" comes from the sibling pane_state
            // emit("active", "dormancy_cleared") — no client-side inference
            // needed here.
            setWaking(false);
            setWakingStartTs(null);
            setElapsedSeconds(0);
            setWakeError(null);
          }
          break;
        }
        case "wake_result": {
          if (parsed.ok) {
            // Wake succeeded on the SSH side — wait for live-frame auto-dismiss.
            // Do nothing; overlay stays in "waking…" state until a live JSONL
            // frame arrives (supervisor recover path relaunched claude + /id ran).
          } else {
            // Wake failed: show warm-red error variant in the overlay.
            setWaking(false);
            setWakingStartTs(null);
            setElapsedSeconds(0);
            setWakeError(parsed.error ?? "wake failed");
          }
          break;
        }
        case "harness_tasks": {
          setHarnessTasks(parsed.tasks);
          break;
        }
        case "backgrounded_agents": {
          setBackgroundedAgents(parsed.agents);
          // Publish composite has-bg-work flag. Use the functional-setter
          // trick to read the CURRENT backgroundedShells synchronously —
          // the WS onmessage closure captures stale state, but the setter
          // callback receives the latest value from React.
          setBackgroundedShells((currentShells) => {
            const key = `${hostId}:${tmuxSession ?? ""}`;
            publishSessionHasBackgroundedWork(
              key,
              parsed.agents.length > 0 || currentShells.length > 0,
            );
            return currentShells; // no state change to shells
          });
          break;
        }
        case "backgrounded_shells": {
          setBackgroundedShells(parsed.shells);
          // Mirror: read the CURRENT backgroundedAgents to compute the
          // composite flag correctly when only shells arrive.
          setBackgroundedAgents((currentAgents) => {
            const key = `${hostId}:${tmuxSession ?? ""}`;
            publishSessionHasBackgroundedWork(
              key,
              parsed.shells.length > 0 || currentAgents.length > 0,
            );
            return currentAgents; // no state change to agents
          });
          break;
        }
        case "plan_pending": {
          setPlanPending(parsed.pending);
          break;
        }
        case "aside_ready": {
          // Phase 14 Wave 3: backend extracted a /btw answer from the
          // tmux BTW overlay (Wave 2's server-authoritative extraction
          // poller OR Wave 2's connect-time re-attach probe for a
          // late-mounting tab per ASIDE-09). Flip asideText to the
          // extracted text — AsideBubble mounts as the last child of
          // the message-stream flex column and useAutoScroll pins the
          // viewport to it. Cross-tab dismiss coherence (ASIDE-11) is
          // handled by the aside_dismissed case below fanned out from
          // the backend broadcast primitive.
          //
          // Phase 14 quick-task 260726-vbd: clear the pending flag and 60s timer
          // atomically with the display-state flip. The pending→displayed transition
          // is invisible to the user (ComposeBox stays morphed; only the flag that
          // drives the predicate changes from asidePending to asideText).
          clearAsidePending();
          setAsideText(parsed.text);
          break;
        }
        case "aside_dismissed": {
          // Phase 14 Wave 3: backend observed the BTW overlay
          // disappearing — either from THIS client's earlier X-click
          // (handleAsideDismiss sent aside_dismissed, backend
          // dismissBtw'd, poller saw marker vanish and broadcast
          // dismissed) OR from any other cause (Ashley SSH-attached
          // and pressed Escape herself, tmux died, peer tab dismissed).
          // Idempotent: if THIS client already optimistically cleared
          // asideText in handleAsideDismiss, this setState is a no-op.
          //
          // Phase 14 quick-task 260726-vbd: also clear asidePending — the
          // backend can broadcast aside_dismissed without this client having
          // sent it (peer-tab dismiss OR marker-disappearance), so the
          // pending flag must clear in this path too.
          setAsideText(null);
          clearAsidePending();
          break;
        }
        case "session_holding": {
          // Phase 3 Layer 1 / Layer 2 SIGTERM-fallback edge preserved on the
          // wire for backward compat (D-migration in 30-CONTEXT.md: legacy
          // frames stay alive alongside pane_state). The Phase-30 rendered-
          // state transition to "holding" comes from the sibling pane_state
          // emit funneled through transitionToHolding (see Plan 30-01
          // § L2191). This handler no longer manipulates any client-side
          // pane-state — the Phase-29 client-inference calls are gone.
          // Message
          // stream is preserved intentionally (Ashley may want to scroll
          // back through the old conversation while the new one starts).
          break;
        }
        case "session_holding_cleared": {
          // Fix B (2026-07-30): backend self-cleared holding because the same
          // sessionFile came back active on the next repoll tick (not a real
          // recycle). Phase 30: the rendered-state transition off "holding"
          // comes from the sibling pane_state emit("active",
          // "same_file_recovery") funneled through
          // transitionFromHoldingToActiveSameFile (see Plan 30-01 § L2260).
          // This handler is now a no-op — the message stream / contextPct /
          // harnessTasks / backgroundedAgents / plan_pending / asideText
          // preservation semantic (surgical vs. session_changed heavy reset)
          // is unchanged because THIS handler never touched them either.
          break;
        }
        case "session_changed": {
          // Phase 3 recycle completed: server has stopped the old tail and
          // started a fresh one on the new sessionFile. Reset ALL per-session
          // state; the incoming `message` events from the fresh tail (which
          // uses `tail -F -n +1`) will re-hydrate the conversation from line 1.
          // Do NOT touch IdentityBadge (pane-scoped, owned by Terminal.tsx)
          // or ComposeBox draft (per patch #57's key is
          // userId+hostId+tmuxSession, so it correctly survives).
          //
          // W3 fix from plan-checker: defensively setStatus("streaming"). Under
          // normal operation, status is already "streaming" when session_changed
          // arrives (holding only fires from active/streaming). But if a fatal
          // `error` frame from the WS layer landed in the same window (rare —
          // e.g. a network blip that produced a tail_error escalated to error
          // right before the recycle completed), status would be "error" and
          // the scroll region would not re-mount after our state reset,
          // stranding the user on the error banner even though the backend
          // has successfully switched to a fresh session. One extra line
          // closes the edge case at zero cost.
          //
          // Phase 30: the rendered-state transition off "holding" cleanly
          // into "active" comes from the sibling pane_state
          // emit("active", "session_changed") funneled through
          // transitionToActiveNew (see Plan 30-01 § L2345). This handler
          // still owns the HEAVY session-scoped state reset because the
          // pane_state emitter deliberately does not carry newSessionFile
          // (T-30-01 mitigation — no filesystem paths in reason); the
          // session_changed frame remains authoritative for the reset.
          setMessages([]);
          setHarnessTasks([]);
          setContextPct(null);
          setBackgroundedAgents([]);
          setBackgroundedShells([]);
          // Composite store: clear hasBgWork on session_changed (recycle).
          // A recycled session cannot carry backgrounded work from the OLD
          // session. Same hostId guard as the fresh-pane reset above.
          if (hostId != null) {
            const key = `${hostId}:${tmuxSession ?? ""}`;
            publishSessionHasBackgroundedWork(key, false);
          }
          setPlanPending(null);
          setStatus("streaming");
          // Phase 14 followup: full aside-surface reset — a recycled
          // session can't carry a live BTW overlay from the OLD session,
          // and any residual 8s dismiss cooldown is irrelevant across the
          // recycle. Backend re-attach probe re-emits aside_ready if the
          // new session somehow has one.
          clearAsideState();
          // Diagnostic: parsed.newSessionFile is available if a future console
          // log is wanted; do not add ambient debug logging in this patch.
          break;
        }
        case "tail_error": {
          // Recoverable — surface as a banner but keep the message list.
          setErrorMessage(parsed.message);
          break;
        }
        case "error": {
          setStatus("error");
          setErrorMessage(parsed.message);
          break;
        }
      }
    };

    ws.onerror = () => {
      if (cancelled) return;
      // The WS `error` event carries no useful details cross-browser;
      // rely on the subsequent `close` for the final status flip.
    };

    ws.onclose = () => {
      if (cancelled) return;
      // Patch #148: auto-reconnect on close, mirroring Terminal.tsx's pattern.
      //
      // INACTIVE short-circuit (FALLBACK-01 preservation): when the server has
      // sent an "inactive" frame (status === "inactive"), that is the authoritative
      // terminal-state signal. Client-side retry must NOT step past it. Preserve
      // both status and errorMessage exactly as the pre-patch code did — any more-
      // specific message from a prior "tail_error" frame survives the nullish-coalesce.
      //
      // NON-INACTIVE path — retry with linear-with-cap backoff:
      //   Attempt 1 → 2s, 2 → 4s, 3 → 6s, 4 → 8s, 5 → 8s (≈28s total window).
      //   After MAX_RECONNECT_ATTEMPTS consecutive closes, no further timer is
      //   scheduled and "Connection closed" persists. The visibilitychange handler
      //   (Ashley iOS PWA fix) resets the counter to 0 on foreground, giving a
      //   fresh 5-attempt budget per app reopen.
      if (statusRef.current === 'inactive') {
        // FALLBACK-01: preserve server-authoritative terminal state.
        // Do not schedule retry; do not overwrite a more-specific errorMessage.
        setStatus((prev) => (prev === "inactive" ? prev : "error"));
        setErrorMessage((prev) => prev ?? "Connection closed");
        return;
      }
      // Quick 260808-b74: if pane is hidden, the WS close was deliberate (from the
      // WS-pause effect below). Do NOT schedule a reconnect — patch #148's retry
      // loop must not fight the pause. status='error' + errorMessage are set
      // unconditionally because patch #339's render gates rely on status='error'
      // to keep bubbles visible during the pause (exact same UX as a real reconnect).
      setStatus("error");
      setErrorMessage((prev) => prev ?? "Connection closed");
      if (!isVisibleRef.current) return;
      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(2000 * (reconnectAttemptsRef.current + 1), 8000);
        reconnectAttemptsRef.current += 1;
        // phase-29: mirror into state so wsState derivation re-runs on
        // retry-attempt changes (transitions "not-connected" → "opening" and
        // may hit "failed-permanently" at the cap).
        setReconnectAttempts(reconnectAttemptsRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          if (cancelled) return;
          setRetryKey((k) => k + 1);
        }, delay);
      }
      // At cap: status stays "error", errorMessage stays "Connection closed".
      // No further timer scheduled. visibilitychange:visible gives a fresh budget.
    };

    return () => {
      cancelled = true;
      // Patch #148: clear any pending reconnect timer before closing the WS
      // so unmount never fires a retry against a stale wsRef.
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    };
  }, [hostId, tmuxSession, retryKey]);

  // Patch #148: visibilitychange handler — the direct Ashley iOS PWA fix.
  // Patch #156 hard-gates this effect on isIosPwa() because on Chrome desktop
  // / Android / non-PWA Safari, WebSockets survive tab-switches and
  // force-reconnect creates a session-attachment race that surfaces the
  // Reconnect/Close overlay (the old WS's ws.on("close") detachWs can arrive
  // AFTER the new WS attaches, causing destroySession to fire and the new
  // socket to receive `disconnected`). On non-iOS-PWA browsers this early
  // return means no listener is registered and cleanup is a no-op — exactly
  // what we want, because those browsers don't need the workaround at all.
  //
  // When the user foregrounds the PWA tab after backgrounding:
  //   - If status is "inactive", no-op (server-authoritative terminal state).
  //   - If WS is already OPEN (readyState 1), no-op (still connected).
  //   - Otherwise: reset reconnectAttemptsRef to 0 (fresh budget for this foreground
  //     event) and bump retryKey so the WS-setup useEffect opens a fresh connection.
  // When the tab hides: clear any pending reconnect timer (avoid a background
  //   wake after ~2-8s) but do NOT reset the attempt counter — a hide during a
  //   retry sequence should NOT drop the accumulated attempt count. The
  //   foreground path always gets a fresh counter anyway.
  // deps: [] — mount-once; reads only refs, no reactive state dependencies.
  // Do NOT add retryKey to deps — that would re-register listeners on every retry.
  useEffect(() => {
    if (!isIosPwa()) return;
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab hidden: cancel any pending reconnect timer.
        if (reconnectTimeoutRef.current !== null) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        return;
      }
      // Tab visible: reconnect if needed.
      if (statusRef.current === 'inactive') return;
      // Quick 260808-b74: if the pane itself is hidden (isVisible=false), a PWA
      // foreground event must NOT reopen the WS behind the WS-pause effect's back.
      // The WS-pause effect owns the reopen path — it fires when isVisible flips
      // true. This guard prevents the iOS visibilitychange foreground event from
      // fighting the pause (single-knob isVisibleRef gate per bounty design).
      if (!isVisibleRef.current) return;
      if (wsRef.current?.readyState === 1) return; // still OPEN
      // Fresh budget for this foreground event (Ashley iOS PWA fix).
      reconnectAttemptsRef.current = 0;
      // phase-29: mirror into state so wsState derivation re-runs on
      // retry-attempt reset.
      setReconnectAttempts(0);
      setRetryKey((k) => k + 1);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Patch #148: statusRef mirror — keeps statusRef.current in sync with the
  // `status` state so WS callbacks (onclose, visibilitychange handler) can
  // read the current status WITHOUT triggering functional-update double-renders.
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Quick 260808-b74: isVisibleRef mirror — keeps isVisibleRef.current in sync
  // with the `isVisible` prop so onclose retry scheduler and visibilitychange
  // handler can read current pane visibility without React closure-capture issues.
  // Pattern mirrors statusRef mirror above.
  useEffect(() => {
    isVisibleRef.current = isVisible;
  }, [isVisible]);

  // quick 260808-cd6: dormantRef mirror — keeps dormantRef.current in sync
  // with the `dormant` state so the WS onmessage auto-dismiss hook can read
  // current dormant state without stale-closure issues. Pattern mirrors isVisibleRef.
  useEffect(() => {
    dormantRef.current = dormant;
  }, [dormant]);

  // quick 260809-cnx: prevIsVisibleRef edge detector for the waking-reset
  // useEffect below. Initialized to current isVisible so the initial mount
  // (prev === isVisible) does NOT fire the reset — only true false→true
  // transitions (pane returning after being hidden) clear waking state.
  const prevIsVisibleRef = useRef<boolean>(isVisible);

  // quick 260809-cnx: reset local waking-related state on isVisible false→true.
  // Patch #344 closes the WS while isVisible=false, so any pre-hidden `waking`
  // state is unreliable on re-visibility. Clearing it lets the next backend
  // dormant frame (arrives within one 3s poll cycle) paint the accurate
  // overlay: "Session is asleep" + working Wake button, instead of a stuck
  // "Waking up…" indicator. Visibility transition is the truth signal —
  // do NOT use a time-based threshold (locked context).
  useEffect(() => {
    const prev = prevIsVisibleRef.current;
    prevIsVisibleRef.current = isVisible;
    if (!prev && isVisible) {
      setWaking(false);
      setWakingStartTs(null);
      setElapsedSeconds(0);
      setWakeError(null);
    }
  }, [isVisible]);

  // Phase 30 note: the Phase-29 loading-arm ref-mirror useEffect + its
  // backing state slot + ref are DELETED. The loading-overlay mount is
  // now driven by `renderedState === "resolving"` directly, derived from
  // (wsTransportState, paneState) via usePaneResolvingMachine.

  // quick 260808-cd6: elapsed-seconds ticker for the waking overlay.
  // Counts elapsed seconds since Wake was clicked (wakingStartTs).
  // Renders "this can take up to 60s" hint in DormancyOverlay after 15s.
  // Cleanup: clearInterval on unmount or when waking flips off.
  useEffect(() => {
    if (!waking || wakingStartTs === null) {
      setElapsedSeconds(0);
      return;
    }
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - wakingStartTs) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [waking, wakingStartTs]);

  // Quick 260808-b74 — WS-pause lifecycle effect (hidden-pane-cost-mitigation-
  // empirical-rotation, iteration 1).
  //
  // PURPOSE: close the Claude-session WS when this pane is hidden (isVisible=false)
  // and reopen it when the pane becomes visible again (isVisible=false→true).
  // Baseline: 3 hidden PrettyViews contribute 10+13+10 = 33 Claude WS frames/30s
  // combined. After this change, hidden panes emit ~0 frames.
  //
  // TEMPLATE: patch #339 (commit 50e96d6). The close+reopen UX is identical to
  // the reconnect fix — status='error' keeps bubbles visible via the existing
  // scroll-region and ComposeBox mount gates (nothing to duplicate here).
  //
  // GUARDS:
  //   - isVisibleRef gate on onclose retry scheduler: prevents patch #148's
  //     auto-reconnect loop from immediately reopening the WS behind our back
  //     while the pane is still hidden (single-knob isVisibleRef per bounty
  //     design — no pausedByHiddenRef needed).
  //   - isVisibleRef gate on visibilitychange handler: iOS PWA foreground events
  //     must not reopen a WS for a currently-hidden pane. The WS-pause effect
  //     below owns the reopen path exclusively.
  //
  // STATE PRESERVATION: messages/contextPct/harnessTasks/backgroundedAgents/
  // backgroundedShells/planPending/asideText/isHolding are NOT touched — they
  // survive the close and are immediately visible on re-show. appendDedup
  // absorbs any tail-replay dupes from the fresh tail on reopen (same as reconnect).
  //
  // INITIAL-MOUNT NO-OP: on the first effect run isVisible is already true
  // (Terminal.tsx only mounts PrettyView inside `isPrettyMode && ...`). The
  // main WS-setup effect (deps [hostId, tmuxSession, retryKey]) is already
  // opening the WS on mount — do not double-trigger.
  useEffect(() => {
    if (!isVisible) {
      // Pane became hidden — close the WS if it is open or connecting.
      const ws = wsRef.current;
      if (ws !== null && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        // Clear any in-flight reconnect timer first so it doesn't fire while
        // hidden and immediately reopen (the isVisibleRef guard on onclose's
        // retry scheduler is the belt; this clearTimeout is the suspenders).
        if (reconnectTimeoutRef.current !== null) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        ws.close();
        // onclose fires → setStatus('error') + setErrorMessage('Connection closed')
        // (unconditional path in onclose) → patch #339 render gates keep bubbles
        // visible and Send disabled, exactly as during a real reconnect pause.
        // isVisibleRef.current will be false (mirror effect ran synchronously
        // before this effect on the same render) → retry scheduler short-circuits.
      }
    } else {
      // Pane became visible — reopen the WS if it is gone or closing.
      const ws = wsRef.current;
      if (ws === null || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
        // Fresh budget for this re-show (mirrors visibilitychange handler at ~970).
        reconnectAttemptsRef.current = 0;
        // Mirror into state so wsTransportState derivation re-runs on
        // retry-attempt reset.
        setReconnectAttempts(0);
        // Phase 30: paneState reset on WS-pause reopen is INTENTIONALLY
        // OMITTED. Under Phase 29 this site reset the client-inferred
        // first-frame axis to "not-yet" to work around the rearm-snapshot
        // guard in the old hook. That guard is GONE (Task 2 deleted the
        // entire snapshot mechanism). Under Phase 30 semantics, keeping
        // the last-known paneState across a transient WS drop is EXACTLY
        // the D-11 don't-flicker rule — resolveRenderedState renders the
        // last-known overlay while transport is regressed rather than
        // reverting to the resolving spinner. When the fresh WS opens,
        // the backend emits pane_state on attach (see pane-state-emitter
        // startActiveSessionFlow site — Plan 30-01 § L3871) and paneState
        // updates to the fresh truth via the pane_state WS handler above.
        setRetryKey((k) => k + 1);
        // The WS-setup effect (deps [hostId, tmuxSession, retryKey]) fires and
        // opens a fresh WS via the existing patch #148 reconnect path. No new
        // connect path invented; same machinery as auto-reconnect.
      }
      // If WS is already OPEN or CONNECTING (e.g. initial mount with isVisible=true),
      // no-op — don't interfere with the WS-setup effect.
    }
  }, [isVisible]); // eslint-disable-line react-hooks/exhaustive-deps
  // deps: [isVisible] only. Reads only refs (wsRef, reconnectTimeoutRef,
  // reconnectAttemptsRef) and calls setRetryKey — all stable across renders.
  // Adding wsRef/setRetryKey would be superfluous (refs are stable; setRetryKey
  // is setState-stable). Do NOT add hostId/tmuxSession/retryKey — that would
  // conflate this effect with the main WS-setup effect.

  // Bounty pretty-view-per-pane-cost-diag: mirror messages.length + register
  // with the diag registry so the interval emitter can query this pane's
  // cost snapshot. Registration is keyed on hostId+tmuxSession so the same
  // pane across re-mounts reuses the slot; unregister runs on unmount /
  // hostId or tmuxSession change.
  useEffect(() => {
    messagesLenRef.current = messages.length;
  }, [messages]);
  useEffect(() => {
    const key = `pretty-view:${hostId}:${tmuxSession ?? ""}`;
    const snapshotFn = (): PaneSnapshot => {
      const framesSinceLast = wsFramesRef.current;
      wsFramesRef.current = 0;
      return {
        kind: "pretty-view",
        paneId: key,
        hostId,
        tmuxSession,
        // quick-260809-eqk: read isVisibleRef.current so the diag emit reflects
        // LIVE pane visibility rather than the closured value from first
        // registration. The mirror useEffect at lines ~1150-1156 (iter 1,
        // patch #344) keeps isVisibleRef.current fresh on every isVisible flip.
        // Do NOT add `isVisible` to this effect's deps array — the pane
        // registration key must stay stable across visibility flips
        // (registerPane replaces the entry keyed on hostId+tmuxSession;
        // re-registering on every flip would defeat the stable-slot design).
        isVisible: isVisibleRef.current,
        messageCount: messagesLenRef.current,
        wsFramesSinceLast: framesSinceLast,
        domNodeCount: pvRootRef.current
          ? pvRootRef.current.querySelectorAll("*").length
          : 0,
      };
    };
    return registerPane(key, snapshotFn);
  }, [hostId, tmuxSession]);

  // Phase 30 note: several Phase-29 useEffects that lived here are DELETED
  // (delay-arm timers, watchdog timers, 10s auto-dismiss). Rendered-state
  // now derives synchronously from the (wsTransportState, paneState) inputs
  // via the pure resolveRenderedState reducer; the backend's pane_state
  // emit is the authoritative signal for every terminal state and no
  // client-side wall-clock deadline can override it.

  // Publish session-recycling state to store keyed on
  // `renderedState === "holding"` (Phase-29 SPEC req 7 semantic preserved:
  // dot suppressed exactly when the holding overlay is visible; source of
  // truth is now backend-authoritative via paneState). Deliberately NO
  // cleanup — mirrors Terminal.tsx's patch #137 publish effect: preserve
  // last-known state across route changes so a remount doesn't stall on
  // null waiting for the next state flip.
  useEffect(() => {
    const key = `${hostId}:${tmuxSession ?? ""}`;
    publishSessionRecycling(key, renderedState === "holding");
  }, [renderedState, hostId, tmuxSession]);

  // Phase 14 (plain-language-translation-asides) Wave 3 — isIdle-transition
  // arm emitter. This is THE SOLE trigger source for the aside subsystem
  // per CONTEXT.md § Trigger LOCK 2026-07-26 (frontend-arm architecture,
  // decided post plan-checker B1/B2/B4): backend does NOT observe the
  // terminal WSS's idle-signal frame (the two WSSes live on separate
  // ports with no shared state). The frontend, which already receives
  // `isIdle` as a prop from Terminal.tsx (the WIP-indicator's idle-window
  // signal, established in Phase 9), emits `{type:"aside_arm"}` on the
  // pretty-view WS at the false→true transition — that IS the aside
  // trigger. Backend Wave 2's aside_arm handler receives it, guards
  // against overlap-in-flight via the module-scope asideState Map, and
  // if clear injects the fixed /btw prompt into tmux + arms the
  // extraction poller.
  //
  // Three guards on the fire:
  //   1. `prev === false && isIdle === true` — a REAL false→true
  //      transition. `prev === undefined` (initial mount) does NOT fire.
  //      `prev === null` (backend hasn't spoken yet) does NOT fire.
  //      Only a real transition where the previous frame was actively
  //      working AND the current frame is now settled qualifies.
  //   2. `pvIdentity != null` — identity gating happens FRONTEND-SIDE
  //      per CONTEXT.md § Trigger. Anonymous sessions never emit arm,
  //      so the backend never needs to know identity vs anonymous
  //      (aligned with ASIDE-02).
  //   3. `wsRef.current` is OPEN — otherwise the send throws / no-ops
  //      and is meaningless. Wrapped in try/catch anyway since the
  //      backend re-arms on the next transition (best-effort emit).
  //
  // Deps: [isIdle, pvIdentity] — re-run only when either flips. The
  // prevIsIdleRef.current update happens BEFORE the guard so consecutive
  // renders with the same value are correctly detected as "no transition."
  useEffect(() => {
    // Ashley 2026-07-27: kill switch for the Phase 14 auto-aside trigger.
    // Update the ref so isIdle keeps being tracked (avoids a spurious
    // "fresh false→true transition" on re-enable), then bail before the
    // emit. See the AUTO_ASIDE_ARM_ENABLED declaration for the full
    // disable rationale.
    if (!AUTO_ASIDE_ARM_ENABLED) {
      prevIsIdleRef.current = isIdle;
      return;
    }
    const prev = prevIsIdleRef.current;
    prevIsIdleRef.current = isIdle;
    if (prev === false && isIdle === true && pvIdentity != null) {
      // Suppress the trailing false→true transition that follows a
      // user-initiated dismiss (Escape into tmux → pane activity →
      // isIdle bounce). See dismissCooldownUntilRef declaration.
      if (Date.now() < dismissCooldownUntilRef.current) return;
      // Phase 14 followup (Ashley 2026-07-27): skip aside arm when the
      // user's most recent turn was an /id command. /id save, /id reset,
      // /id <name> are identity-plumbing operations whose completion
      // ("Saved: history +2 …", "I'm Tina. …") doesn't benefit from a
      // plain-language recap. Trailing space matters — matches `/id save`
      // but not `/identity` / `/idle` / bare `/id`. Walks backwards past
      // any assistant echoes so we're comparing against the last SUBMITTED
      // turn, not whatever landed last. Covers both ComposeBox submits
      // and SSH-attached direct-tmux submits (both round-trip through
      // JSONL — user turn is written before the assistant response
      // streams, so it's always in messages[] well before isIdle=true).
      // UAT amendment E41 (Ashley 2026-07-27): isIdCommand also matches
      // the harness slash-UI XML-wrapper form (<command-name>/id</command-name>)
      // — Ashley's PRIMARY /id invocation path from pretty-view slash-UI.
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.type === "message" && m.role === "user") {
          if (isIdCommand(m.content)) return;
          break;
        }
      }
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "aside_arm" }));
        } catch {
          /* swallow — best-effort; backend re-arms on next transition */
        }
      }
    }
  }, [isIdle, pvIdentity, messages]);

  // Phase 14 quick-task 260726-vbd: unmount cleanup for the 60s safety timer.
  // Ensures an asidePendingTimerRef pending during component unmount does not
  // fire a setState on an unmounted component. Mounted once ([] deps); the ref
  // is always current because React refs are mutable and don't need to be in deps.
  useEffect(() => {
    return () => {
      if (asidePendingTimerRef.current !== null) {
        clearTimeout(asidePendingTimerRef.current);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={pvRootRef}
      data-pv-root
      onDragEnter={(e) => {
        // Phase 05 (UPLOAD-01): show the drop overlay while any drag
        // hovers the pretty-view surface. We use a counter because
        // dragenter/dragleave fire on every child boundary during a
        // drag — only when the counter returns to 0 do we hide the
        // overlay.
        e.preventDefault();
        dragCounterRef.current += 1;
        if (dragCounterRef.current > 0) setIsDragOver(true);
      }}
      onDragOver={(e) => {
        // dragover MUST preventDefault to enable the subsequent drop.
        e.preventDefault();
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
        if (dragCounterRef.current === 0) setIsDragOver(false);
      }}
      onDrop={(e) => {
        // Phase 05: stage the dropped items. Prefer DataTransferItemList
        // (has webkitGetAsEntry so folder detection works) when available;
        // fall back to files.
        e.preventDefault();
        dragCounterRef.current = 0;
        setIsDragOver(false);
        const dt = e.dataTransfer;
        const items = dt.items;
        const files = Array.from(dt.files);
        if (items && items.length > 0) {
          // Quick 260802-wxy: primary target — drag/drop lands in the main
          // composebox's chip strip. Quick B will introduce per-slot targets.
          uploads.stageAttachments("primary", items);
        } else if (files.length > 0) {
          uploads.stageAttachments("primary", files);
        }
      }}
      className={cn(
        // Phase 4 Glass atmospheric base — warm-neutral dark with
        // radial-gradient depth cues. `relative overflow-hidden` gives
        // the IdentityBadge (absolute) a positioning anchor and clips
        // any glass-blur bleed at the edges.
        "h-full w-full flex flex-col relative overflow-hidden",
        "text-[var(--color-pv-fg)]",
        "font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif]",
        className,
      )}
      style={
        {
          // Phase 4: expose per-pane identity hue as a CSS custom
          // property that all descendants can consume via
          // `hsla(var(--pv-id-hue), 75%, 52%, X)`. Plan 04-02 wires
          // this into ChatMessage user-bubble accents, ComposeBox
          // ctxbar fill + send-button glow + textarea focus ring,
          // ambient panel tag styling, etc. The IdentityBadge (lg)
          // below reads identity.colorHue directly (not via this
          // var) because its accents apply per-pixel color values
          // rather than composing hsla — but they use the SAME
          // fallback of 35 for consistency.
          "--pv-id-hue": String(pvHue),
          // Atmospheric depth = TWO radial-gradient overlays (warm
          // hue-tinted from top-left, fixed cool violet from bottom-right)
          // over a warm-neutral linear-gradient base. HARD LOCK: this
          // uses `background-image` ONLY. Do NOT add backdropFilter,
          // filter, transform, willChange, or perspective to this root
          // div. Reason (patch #74 rewrite): the absolute-positioned
          // SessionHoldingOverlay (`absolute inset-0`) resolves against
          // this root's `relative` positioning. If the root gained
          // `transform` or `filter`, that would still create a valid
          // containing block for the overlay (it's absolute, so `inset-0`
          // would still land correctly) — BUT it would ALSO shift the
          // stacking context in ways that can steal IdentityBadge's
          // z-[101] out from under the app-modal z-band, and can trap
          // any future sticky/fixed descendants inside pretty-view.
          // `background-image` is safe (it never establishes a
          // containing block or a new stacking context).
          //
          // Note: the top-left warm radial uses the resolved `${pvHue}`
          // numeric literal rather than `hsla(var(--pv-id-hue),...)`
          // because CSS custom properties in gradient stops sometimes
          // need @property declarations to interpolate cleanly across
          // browsers; embedding the number at style-compute time avoids
          // that edge case. Inner components' arbitrary-value classes
          // that use `hsla(var(--pv-id-hue),...)` are FINE because they
          // resolve at paint time (custom props are dynamic per-cascade).
          backgroundImage: `
            radial-gradient(ellipse 800px 400px at 20% 0%, rgba(255,240,215,0.08), transparent 60%),
            radial-gradient(ellipse 700px 500px at 90% 100%, rgba(255,240,215,0.05), transparent 60%),
            linear-gradient(160deg, var(--color-pv-base) 0%, var(--color-pv-base-mid) 50%, var(--color-pv-base-end) 100%)
          `,
          ...style,
        } as React.CSSProperties
      }
    >
      {/* Phase 4: pretty-view IdentityBadge in the lg treatment.
          Mounts only when a matching identity is registered for this
          pane (sessionMatchKey → useIdentities().byKey lookup — same
          semantic as the terminal-pane mount). z-[101] matches the
          terminal-pane badge so layering is consistent when flipping
          between modes with Ctrl+Shift+O.
          Patch #87: onClick wires the lg badge as a click target that opens
          the IdentityModal. The md terminal-pane badge (patch #38) is
          unaffected — this onClick prop is lg-only and ignored by md. */}
      {pvIdentityKey && (
        <IdentityBadge
          identityKey={pvIdentityKey}
          onClick={() => setIsIdentityModalOpen(true)}
          onLongPress={onTogglePrettyMode}
        />
      )}
      {/* Patch #87: identity bounties modal. Portals to document.body via
          shadcn Dialog so it escapes this root's relative/overflow context.
          Mount guarded by pvIdentity non-null (Modal needs displayName,
          title, avatarUrl from the full Identity object). onOpenChange
          handles all close paths (Esc, backdrop click, X button). */}
      {pvIdentity && (
        <IdentityModal
          open={isIdentityModalOpen}
          onOpenChange={setIsIdentityModalOpen}
          identity={pvIdentity}
          hue={pvHue}
          hostId={hostId}
          container={chatRegionEl}
        />
      )}
      {/* Patch #108: chat-region wrapper. IdentityModal portals INTO this
          element so it covers only the bubble/tasks/shells area — composer
          below AND identity badge above stay uncovered/typable. Wrapper is
          `relative` for absolute-positioning of the modal, and `flex-1
          flex flex-col` so its children (status branches, chat-content,
          harness/agents/shells panels) arrange vertically as before with
          chat-content flex-1 filling remaining space. */}
      <div
        ref={setChatRegionEl}
        className="relative flex-1 min-h-0 flex flex-col"
      >
      {/* Patch #74 + quick 260729-j8l: session-recycle overlay.
          Absolute-positioned via SessionHoldingOverlay's own
          `absolute inset-0`. Quick 260729-j8l moved the mount from
          data-pv-root into THIS chat-region wrapper (the same wrapper
          IdentityModal portals INTO for the "modal covers only bubble/
          tasks/shells" treatment) so the scrim is geometrically
          constrained to messages/tasks/shells and leaves ComposeBox
          uncovered. That in turn lets Ashley pre-draft the next
          message during the 2-15s recycle window — the ComposeBox
          textarea stays typeable while every WS-side-effecting
          control (Send, reset cell, paperclip, ThumbsUp, Lightbulb,
          Queue, Mic) is disabled via ComposeBox's `recycleActive`
          prop wired below. Mount gate is `renderedState === "holding"`
          (Phase 30 rewire — backend-authoritative via paneState). Sits
          BELOW IdentityBadge (z-[99] < z-[101]) so the badge stays
          visible and clickable during a recycle (Ashley wants the
          identity affordance reachable mid-recycle — supersedes patch
          #111 rationale), still below app-modal dialogs (z-[500]) —
          component-local, not an app-modal event.
          Replaces the previous sticky top-of-scroll banner (retired
          in patch #74) per Ashley's live 2026-07-19 design read. */}
      {/* Phase 30 (PS30-06): SessionHoldingOverlay gated on
          `renderedState === "holding"` (backend-authoritative via the
          paneState React state slot fed by the `case "pane_state"` WS
          handler). `error` prop dropped — the warm-red-flip flag was
          retired in Phase 29. */}
      {renderedState === "holding" && <SessionHoldingOverlay />}
      {/* Phase 30 (PS30-06): DormancyOverlay gated on
          `renderedState === "dormant"`. Internal props (waking /
          elapsedSeconds / wakeError) stay local because DormancyOverlay
          reads them directly. */}
      {renderedState === "dormant" && (
        <DormancyOverlay
          waking={waking}
          elapsedSeconds={elapsedSeconds}
          onWake={handleWake}
          error={wakeError}
        />
      )}
      {/* Phase 30 (PS30-06): PrettyViewLoadingOverlay is the resolving-
          state spinner. Mount gate is `renderedState === "resolving"`
          directly — the Phase-29 150ms delay-arm is DELETED (Task 2 in
          Plan 30-03 removed it from the hook). Backend emits pane_state
          fast enough that the flash risk the delay-arm defended against
          is gone; if UAT surfaces a regression, D-04 anti-flash can be
          restored at THIS site (not in the hook) as a paint-delay. */}
      {renderedState === "resolving" && <PrettyViewLoadingOverlay />}

      {/* Phase 30 (PS30-06): inactive fallback gated on
          `renderedState === "inactive"`. */}
      {renderedState === "inactive" && (
        <div className="flex-1 flex items-center justify-center p-4 text-sm text-[var(--color-pv-fg-muted)]">
          no active Claude session
        </div>
      )}

      {/* Phase 30 (PS30-06): PrettyViewErrorOverlay gated on
          `renderedState === "error"`. Retry button wires to an inline
          handler that resets the retry counter, flips status back to
          "connecting", clears paneState (so we re-enter resolving until
          backend re-emits), and bumps retryKey to re-run the WS-setup
          useEffect. */}
      {renderedState === "error" && (
        <PrettyViewErrorOverlay
          onRetry={() => {
            reconnectAttemptsRef.current = 0;
            setReconnectAttempts(0);
            setStatus("connecting");
            setPaneState(null); // clear last-known so we re-enter resolving until backend re-emits pane_state
            setRetryKey((k) => k + 1);
          }}
        />
      )}

      {(status === "streaming" ||
        ((status === "connecting" || status === "error") && messages.length > 0)) && (
        <div
          ref={composeScrollRefs}
          // mobile-scroll-freeze-overscroll-behavior (2026-08-10): `overscroll-contain`
          // stops iOS Safari from routing rubber-band momentum to an ancestor scroller
          // on end-of-scroll. Without it, iOS locks the touch for 10-15s while its
          // arbitrator hunts for a scroll owner (AppShell's outer chain is all
          // overflow-hidden), and the surface becomes unresponsive to swipes.
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-3"
        >
          {/* Phase 27 virtualization (Plan 27-02, Step A): sized virtualizer
              container. The ResizeObserver in useAutoScroll still watches
              THIS element (contentRef) for content-size changes; the outer
              composeScrollRefs div is watched separately for viewport-size
              changes. `position: relative` lets the absolute-positioned
              virtualized items resolve their translateY() against this box.
              Note (Step A intermediate state): WipBubble/PlanPendingBubble/
              AsideBubble are kept inside this container as absolute-
              positioned siblings pinned immediately below the last
              virtualized item to preserve pre-Step-B test shape. Step B
              moves them OUT to an in-flow sibling below this container. */}
          <div
            ref={contentRef}
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              position: "relative",
              width: "100%",
            }}
          >
            {/* Phase 27: virtualized message rendering. Only the viewport
                slice (+ overscan) mounts real bubble subtrees. `getItemKey`
                is bound to `messages[i].eventId` so measurement cache stays
                stable across dedup / reorder / prepend paths. `data-pv-bubble`
                is the empirical DOM-count hook (Wave 3 tests + post-ship
                diag). `data-event-id` is the getItemKey identity witness.
                `data-index` is the row-index witness. */}
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const m = messages[virtualRow.index];
              if (!m) return null;
              return (
                <div
                  key={virtualRow.key}
                  data-pv-bubble
                  data-index={virtualRow.index}
                  data-event-id={m.eventId}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                    // Was the flex column's 18px vertical rhythm; flexbox
                    // does nothing on absolutely-positioned children, so the
                    // 18px rhythm is baked into the item box now.
                    paddingBottom: 18,
                  }}
                >
                  {/* RELAYBUB-01/RELAYBUB-02/RELAYBUB-06: relay_* frames route to their own bubble variants;
                      normal message frames stay on ChatMessage (locked interior per Ashley 2026-07-23).
                      hostId is drilled into RelayInboundBubble so its file-pointer fetch can identify
                      which pane's remote host to query. */}
                  {m.type === "image" ? (
                    <ImageBubble
                      role={m.role}
                      images={m.images}
                      text={m.text}
                      eventId={m.eventId}
                      ts={m.ts}
                    />
                  ) : m.type === "relay_outbound" ? (
                    <RelayOutboundBubble
                      room={m.room}
                      rawCommand={m.rawCommand}
                      ts={m.ts}
                    />
                  ) : m.type === "relay_inbound" ? (
                    <RelayInboundBubble
                      room={m.room}
                      sender={m.sender}
                      body={m.body}
                      ts={m.ts}
                      hostId={hostId}
                    />
                  ) : m.type === "malformed_line" ? (
                    <MalformedBubble bytes={m.bytes} ts={m.ts} />
                  ) : (
                    <ChatMessage
                      role={m.role}
                      content={m.content}
                      identityVoice={pvIdentity?.voice ?? null}
                      ts={m.ts}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {/* Phase 27 Plan 27-02 Step B: below-list accessories moved OUT
              of the sized virtualizer container into this in-flow sibling
              block. They remain INSIDE the outer composeScrollRefs-bound
              scroll container so useAutoScroll's ResizeObserver still sees
              their contribution to scrollHeight (pin-to-bottom keeps
              working uniformly across virtualized items + accessories).
              In-flow (no position: sticky, no position: absolute, no
              overlay) per ASIDE-05. Since they follow the sized container
              in normal document flow, they layer naturally below the last
              virtualized item at the visual bottom of the message column. */}
          {isWorking && <WipBubble />}
          {planPending && (
            <PlanPendingBubble
              planFilePath={planPending.planFilePath}
              planContent={planPending.planContent}
              contentError={planPending.contentError}
              onApprove={handlePlanApprove}
              onFeedback={handlePlanFeedback}
            />
          )}
          {/* Phase 27 Plan 27-02 Step B: AsideBubble mounts as an in-flow
              sibling immediately after the sized virtualizer container inside
              the scroll container. Post-refactor (Phase 27), it is no longer
              a child of the flex column that holds the messages — that column
              became the virtualizer's absolute-positioned sized container.
              AsideBubble stays visually below the message list.
              TEMP 2026-08-10 (bounty pv-disable-auto-scroll-temp): auto-scroll
              is disabled; NO observer currently watches accessories for
              scrollHeight-driven pin-to-bottom. In-flow, per ASIDE-05 — NOT
              an overlay, popup, or fixed-position element. */}
          {asideText !== null && <AsideBubble text={asideText} />}
          {/* Jump-to-bottom pill — sibling of the content wrapper, still
              inside the scroll container so `sticky bottom-2` anchors it
              to the bottom-right of the visible viewport. Shown only when
              the user has scrolled up.
              RESTORED 2026-08-10 (Ashley): under the TEMP auto-scroll
              disable, `scrollToBottomAndFollow` no longer follows — it is
              a pure imperative jump (sets scrollTop = scrollHeight, no
              pin, no follow-up on subsequent messages). `isPinnedToBottom`
              is tracked via a scroll listener in the stub above JUST for
              pill visibility. */}
          {!isPinnedToBottom && messages.length > 0 && (
            <div className="sticky bottom-2 pointer-events-none flex justify-end">
              <Button
                size="icon-sm"
                variant="secondary"
                onClick={scrollToBottomAndFollow}
                aria-label="Jump to latest"
                title="Jump to latest"
                className={cn(
                  "pointer-events-auto rounded-full cursor-pointer",
                  "border border-white/10",
                  "bg-[linear-gradient(180deg,rgba(70,66,58,0.75),rgba(38,34,28,0.85))]",
                  "text-[#e8e4d8]",
                  "backdrop-blur-md",
                  "shadow-[0_4px_12px_rgba(0,0,0,0.5),_inset_0_1px_0_rgba(255,240,210,0.15)]",
                  "hover:bg-[linear-gradient(180deg,rgba(100,85,55,0.85),rgba(60,50,32,0.9))]",
                  "hover:border-[rgba(255,240,215,0.22)]",
                  "hover:shadow-[0_6px_16px_rgba(0,0,0,0.6),_inset_0_1px_0_rgba(255,240,210,0.22),_0_0_20px_rgba(255,240,215,0.16)]",
                  // Bounty jump-to-bottom-button-bigger-on-mobile
                  // (2026-08-01): mobile-only bump matching the aux row's
                  // new 75%-of-#165 mobile size (54×54 wrapper + 27px
                  // icon at html=24 mobile) for a comfortable tap target
                  // on the floating jump-to-bottom action.
                  "max-md:size-9 [&_svg]:max-md:size-[1.125rem]",
                )}
              >
                <ArrowDown className="size-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {errorMessage && status === "streaming" && (
        <div className="border-t border-white/[0.08] bg-[rgba(255,240,215,0.04)] text-[color:var(--color-pv-code-fg)] text-xs px-3 py-1">
          {errorMessage}
        </div>
      )}

      {/* ComposeBox mounts only when onSend is provided (caller is wiring
          a live terminal WS) AND status is "streaming" (a Claude session
          is confirmed active). When status is "inactive" or "error", the
          compose box is intentionally absent — FALLBACK-01 ensures the
          inactive branch renders only the "no active Claude session" string. */}
      {/* Harness tasks panel — mounts directly above the compose area,
          in-flow (takes real layout space, not an overlay). Filtered to
          active tasks only (pending + in_progress); when the filtered list
          is empty the panel does NOT render, so no chrome / no empty state.
          Read-only for v1 — Claude Code owns writes to ~/.claude/tasks/. */}
      {status === "streaming" &&
        (() => {
          const active = harnessTasks.filter(
            (t) => t.status !== "completed",
          );
          return active.length > 0 ? (
            <HarnessTasksPanel tasks={active} />
          ) : null;
        })()}

      {/* Backgrounded-agents panel — sibling to HarnessTasksPanel, mounts
          BELOW it (agents are causally downstream of tasks — a task can
          spawn an agent). Mounts only when the currently-running-agents
          list is non-empty; the backend already filters completed
          invocations out via tool_result correlation (patch #61). */}
      {status === "streaming" && backgroundedAgents.length > 0 && (
        <BackgroundedAgentsPanel agents={backgroundedAgents} />
      )}

      {/* Backgrounded-shells panel — sibling to BackgroundedAgentsPanel, mounts
          directly below it (patch #68). Scope: Bash{run_in_background:true}
          ONLY — Monitor invocations are excluded by the backend. Mounts only
          when the currently-running-shells list is non-empty; the backend
          filters completed shells via task-notification correlation. */}
      {status === "streaming" && backgroundedShells.length > 0 && (
        <BackgroundedShellsPanel shells={backgroundedShells} />
      )}
      </div>
      {/* Patch #108 wrapper closes here — ComposeBox stays a peer of the
          wrapper (below it in flex-col), so it's outside the IdentityModal's
          coverage area. */}

      {/* Phase 30 ComposeBox mount gate: same shape as Phase 29, only the
          `renderedState === ...` names differ from the old `phase === ...`.
          `status === "streaming"` preserved (post-resolve active).
          `status === "error"` retained so ComposeBox stays mounted during
          the transient WS reconnect window (bubbles preserved, Send
          disabled per patch #339). `renderedState === "error"` covers the
          terminal-ladder-exhausted case (PrettyViewErrorOverlay up).
          `renderedState === "dormant"` mounts the reduced-state ComposeBox
          during the sleep window. */}
      {onSend && (status === "streaming" || status === "error" || renderedState === "error" || renderedState === "dormant") && (
        <ComposeBox
          onSend={handleComposeSend}
          onResetClicked={onResetClicked}
          canSend={status === "streaming"}
          // Phase 30 (PS30-04): isHolding derives from
          // `renderedState === "holding"` (backend-authoritative). The
          // local isHolding state slot is DELETED — see the "isHolding
          // local state slot DELETED" comment at the top of the render
          // body.
          isHolding={renderedState === "holding"}
          // Phase 30: recycleActive derives from `renderedState === "holding"`.
          // Semantic preserved (WS-side-effecting controls disabled while
          // the holding overlay is up).
          recycleActive={renderedState === "holding"}
          // Phase 24: same disable treatment as recycleActive but for
          // the plan-mode approval-prompt window. When the WS
          // plan_pending state is non-null (the [Approve]/[Feedback]
          // bubble is up), ComposeBox greys out every WS-side-effect
          // control (Send stays as Send but disabled=true; reset,
          // ThumbsUp, Recap, Queue all disabled) while the textarea
          // stays typeable so Ashley can pre-draft feedback. Kept
          // INDEPENDENT of recycleActive per CONTEXT § "Do NOT
          // collapse" — Send-button behavior differs across the
          // three disable modes (asideActive morphs; recycle + plan
          // keep Send as Send).
          planPendingActive={planPending !== null}
          // Phase 30: reconnectingActive derives from `status === "error"
          // || renderedState === "error"`. status="error" covers the
          // transient reconnect window (WS onclose fired, retry ladder
          // in-flight); renderedState="error" covers the terminal ladder-
          // exhausted state.
          reconnectingActive={status === "error" || renderedState === "error"}
          // Phase 30: dormantActive derives from
          // `renderedState === "dormant" || waking`. `waking` stays as
          // internal in-flight-wake signal (the DormancyOverlay reads it
          // as a prop; keeping it in the OR ensures the compose disable
          // stays active while the wake round-trip is in flight).
          dormantActive={renderedState === "dormant" || waking}
          contextPct={contextPct}
          isIdle={isIdle}
          hostId={hostId}
          tmuxSession={tmuxSession}
          identityName={pvIdentity?.displayName}
          onGoodToGo={scrollToBottomAndFollow}
          onInterrupt={onInterrupt}
          // Phase 05 upload wiring — all sourced from the local
          // usePrettyViewUploads hook. Patch #123 split the old single
          // paperclip-visibility-equals-touch-device line into two
          // independent props: paperclip is now shown universally
          // (desktop-visible too, after patch #121 freed aux-row space)
          // and the Row 1 min-h-[44px] WCAG touch target is gated
          // separately on the touch-device peer prop. The
          // useIsTouchDevice() hook (patch #102) is still the sole
          // mobile-vs-desktop discriminator, just no longer conflated
          // with paperclip visibility.
          stagedAttachments={uploads.stagedAttachments}
          onRemoveAttachment={uploads.removeAttachment}
          showPaperclip={true}
          isTouchDevice={isTouchDevice}
          // Quick 260802-wxy: wrap the target-aware hook API in a
          // ComposeBox-compatible (files-only) callback that always targets
          // "primary" — the paperclip picker and paste path in the main
          // composebox always stage to primary in Quick A. Quick B added
          // per-slot paperclips (below via onAttachFilesForTarget) but the
          // legacy callback stays for the paste path + backward-compat.
          onAttachFiles={(files) => uploads.stageAttachments("primary", files)}
          // Quick 260803-05i: target-aware wiring for the queued-row per-slot
          // paperclip + per-slot chip strip overlay (Task 2) + per-slot
          // clear-on-delete (Task 1). Legacy primary-only wiring above stays
          // in place — the target-aware props are additive.
          onAttachFilesForTarget={(target, files) => uploads.stageAttachments(target, files)}
          getStagedAttachmentsForTarget={uploads.getStagedAttachments}
          clearStagedForTarget={uploads.clearStagedForTarget}
          // Phase 14 quick-task 260726-vbd: widened asideActive predicate
          // covers both the GENERATION phase (asidePending=true, from /btw
          // submit through aside_ready arrival) and the DISPLAY phase
          // (asideText !== null, post-aside_ready pre-dismiss). Same visual
          // state for both phases — ComposeBox aux buttons disabled + send
          // button morphs to X/Resume. Same Escape-based dismiss primitive
          // cancels an in-flight /btw or clears a displayed aside.
          asideActive={asideText !== null || asidePending}
          onAsideDismiss={handleAsideDismiss}
          onSendWithAttachments={(caption) => {
            // Fire-and-forget: the promise resolves when upload_start has
            // been issued, not when uploads complete. The batch's
            // onUploadReadyToInject callback (wired above at hook
            // creation) handles the "ready to send injected turn" step.
            void uploads.startBatch(caption);
          }}
          onRetryBatch={() => {
            void uploads.retryBatch();
          }}
          className="shrink-0"
        />
      )}

      {/* Phase 05: full-surface drop overlay. Mounts inside data-pv-root
          so its `absolute inset-0` positioning resolves against the
          pretty-view container (which is `relative overflow-hidden`).
          The overlay is `pointer-events-none` — the drop event lands on
          data-pv-root's own handler. folderDropRejected is driven by
          the upload hook's ~3s auto-clearing state. */}
      <DropOverlay
        isDragOver={isDragOver}
        folderDropRejected={uploads.folderDropRejected}
      />

      {/* inactiveReason is captured in state for potential future use
          (e.g. Phase 2 diagnostic tooltip) but MUST NOT render as
          visible text — FALLBACK-01 says the inactive branch renders
          exactly the string above and nothing else. */}
      {false && inactiveReason}
    </div>
  );
}
