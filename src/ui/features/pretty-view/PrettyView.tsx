import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
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
} from "@/api/claude-session-api";
import { ChatMessage } from "./ChatMessage";
import { ImageBubble } from "./ImageBubble";
import { WipBubble } from "./WipBubble";
import { PlanPendingBubble } from "./PlanPendingBubble";
import { AsideBubble } from "./AsideBubble";
import { SessionHoldingOverlay } from "./SessionHoldingOverlay";
import { IdentityModal } from "./IdentityModal";
import { useAutoScroll } from "./use-auto-scroll";
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
//   2. RENDER-03 auto-scroll: handled entirely by `useAutoScroll` via a
//      ResizeObserver on the inner content wrapper (`contentRef`). Any
//      resize — initial mount, appended message, font swap, viewport
//      change — re-pins to the bottom iff the user was pinned just
//      before. Scrolled-up users are never yanked back.
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
  // Optional callback for the ComposeBox aux-row Terminal-icon button
  // that flips pretty view OFF (revealing the raw xterm.js). Terminal
  // wires this to the same handle.togglePrettyMode() path as the
  // Ctrl+Shift+O shortcut. Omit for read-only PrettyView callers — the
  // button then never renders.
  onTogglePrettyMode?: () => void;
}

type Status = "connecting" | "streaming" | "inactive" | "error";

// Patch #86: pretty-view's message stream now interleaves text messages
// and image bubbles in strict wire order (the whole point of the patch —
// Ashley sees "the agent read this image" at the correct chronological
// position). Both event shapes share `eventId` + `ts`, so appendDedup's
// dedup logic remains a one-line hash check.
type StreamEvent = ChatMessageEvent | ImageEvent;

function appendDedup(
  prev: StreamEvent[],
  next: StreamEvent,
): StreamEvent[] {
  if (prev.some((m) => m.eventId === next.eventId)) return prev;
  return [...prev, next];
}

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
  // null` when the tool_result closes the pair. Only the presence
  // of a pending value drives the indicator — `planFilePath` is
  // tracked but not displayed (Plan Mode is between Ashley and
  // Claude Code; pretty view surfaces only THAT the prompt is open).
  const [planPending, setPlanPending] = useState<
    { planFilePath: string } | null
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
  // Phase 3: session-changeover holding state. True during the ~5s gap
  // between the old Claude session's death and the new one's launch (per
  // Plan 03-01 backend's Layer 1 raw-line /exit scan OR Layer 2 discovery-
  // repoll's SIGTERM-fallback path). Cleared by `session_changed` (recycle
  // completed) or `inactive` with reason "holding_timeout" (recycle failed).
  // WebSocket is NOT closed during holding — the tail restart is server-side
  // and transparent to this client (see CONTEXT.md § Frontend event handling).
  const [isHolding, setIsHolding] = useState(false);
  // Patch #87: identity modal open state. Clicking the lg IdentityBadge sets
  // this to true; the IdentityModal handles close via onOpenChange (Esc,
  // backdrop, X button all route through shadcn Dialog's onOpenChange).
  const [isIdentityModalOpen, setIsIdentityModalOpen] = useState(false);
  // Patch #74: `showOverlay` gates the full-surface SessionHoldingOverlay
  // mount. It is delay-armed (~350ms) after `isHolding` flips true — see
  // the useEffect below. Held separately from `isHolding` because
  // genuinely-instant resets (tiny JSONL rewrites, sub-second recycles)
  // should NEVER flash the overlay. If `isHolding` flips false before
  // the 350ms timer fires, `showOverlay` stays false and no overlay ever
  // renders.
  const [showOverlay, setShowOverlay] = useState(false);
  // Patch #122: when true, `SessionHoldingOverlay` renders in its warm-red
  // 'recycle failed — refresh to check' variant. Set by either the client-
  // side 120s watchdog (see effect below) OR by the backend
  // `inactive { reason: 'holding_timeout' }` WS frame (see `case 'inactive'`
  // handler). Persists until `isHolding` flips back to false (via
  // `session_changed`, another reset click, or user-initiated refresh).
  const [holdingTimeoutError, setHoldingTimeoutError] = useState(false);
  // Patch #122: synchronous session-holding trigger fired by the meter
  // well's Reset button BEFORE `/id reset` reaches the WS. Flipping
  // isHolding here starts the SessionHoldingOverlay's 350ms delay-arm
  // timer immediately instead of waiting for the backend `session_holding`
  // frame. If the backend confirms with its own `session_holding` frame
  // later, setIsHolding(true) is idempotent — no double-fire. If Ashley
  // clicks reset a second time while the overlay is up (e.g. after a
  // red-bubble failure), the error state is intentionally reset to give
  // the fresh attempt a clean 120s window.
  const onResetClicked = useCallback(() => {
    setIsHolding(true);
    setHoldingTimeoutError(false);
  }, []);
  // Phase 14 Wave 3: dismiss callback for the aside (X/Resume click in
  // ComposeBox — Wave 4 wires the button). Two steps per CONTEXT.md
  // § Dismiss:
  //   1. Optimistic clear of asideText so the AsideBubble unmounts
  //      immediately (no visible latency waiting for the WS round-trip).
  //   2. WS-send {type:'aside_dismissed', hostId, tmuxSession} — Wave 2
  //      backend receives this, sendEscapeToBtw's into tmux, then
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
  const handleAsideDismiss = useCallback(() => {
    setAsideText(null);
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
  // WIP indicator is driven by the PTY-side `isIdle` prop from Terminal
  // (patch #51 rework — was previously state fed by a JSONL classifier
  // over the claude-session WS, which turned out to be unreliable
  // because Claude Code 2.1 emits many `type:"user"` events that are
  // not real user speech).
  const wipActive = isIdle === false;

  const wsRef = useRef<WebSocket | null>(null);
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
  // Phase 14 Wave 3: previous-value ref for the isIdle-transition
  // arm-emitter useEffect below. Holds the isIdle value from the
  // previous render so we can detect a real false→true transition
  // (agent settled after a completed turn — the WIP-indicator idle
  // window). Initialized to the current isIdle prop so a mount with
  // isIdle already true does NOT fire arm on first paint (per
  // CONTEXT.md § Trigger — only real transitions arm, not the initial
  // steady-state observation).
  const prevIsIdleRef = useRef<boolean | null | undefined>(isIdle);

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

  const { scrollRef, contentRef, anchorRefCallback, scrollToBottomAndFollow, isPinnedToBottom } =
    useAutoScroll(messages);

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

  useEffect(() => {
    // Patch #148: distinguish a fresh pane mount from a retryKey-triggered re-run.
    // On a fresh pane (hostId/tmuxSession changed), reset ALL state and the attempt
    // counter. On a retry re-run (same pane, retryKey bumped), preserve messages/
    // status so the UI does not flash blank while reconnecting.
    const paneKey = `${hostId}::${tmuxSession}`;
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
      setPlanPending(null);
      setIsHolding(false);
      setShowOverlay(false);
      // Phase 14 Wave 3: fresh-pane mount must clear any aside carried
      // over from the prior pane. The backend's connect-time re-attach
      // probe (ASIDE-09) will re-emit `aside_ready` if the NEW pane's
      // tmux still has an open BTW overlay — so this reset is safe.
      setAsideText(null);
      reconnectAttemptsRef.current = 0;
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
      let parsed: ClaudeSessionServerEvent;
      try {
        parsed = JSON.parse(event.data) as ClaudeSessionServerEvent;
      } catch {
        return;
      }
      switch (parsed.type) {
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
        case "inactive": {
          // Patch #122: backend fires
          // `inactive { reason: 'holding_timeout' }` from
          // claude-session-server.ts transitionToDead() (line 1645) when
          // the holding timeout expires without a fresh session. Flip the
          // overlay to its red-bubble variant instead of taking the
          // normal inactive path — the surface should stay covered so
          // Ashley sees the failure explicitly, not drop back to the
          // "no active Claude session" fallback where the compose box
          // silently disappears. Deliberately do NOT setIsHolding(false)
          // here — the overlay must stay mounted showing the red bubble
          // until session_changed (recycle actually completed after all)
          // OR another reset click clears it. Deliberately do NOT
          // setStatus("inactive") either for the same reason — flipping
          // to inactive would unmount the compose box and the overlay's
          // parent surface flex layout.
          if (parsed.reason === "holding_timeout") {
            setHoldingTimeoutError(true);
            setInactiveReason(parsed.reason);
            break;
          }
          setStatus("inactive");
          setInactiveReason(parsed.reason);
          setIsHolding(false);
          break;
        }
        case "context_pct": {
          setContextPct(parsed.pct);
          break;
        }
        case "harness_tasks": {
          setHarnessTasks(parsed.tasks);
          break;
        }
        case "backgrounded_agents": {
          setBackgroundedAgents(parsed.agents);
          break;
        }
        case "backgrounded_shells": {
          setBackgroundedShells(parsed.shells);
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
          setAsideText(parsed.text);
          break;
        }
        case "aside_dismissed": {
          // Phase 14 Wave 3: backend observed the BTW overlay
          // disappearing — either from THIS client's earlier X-click
          // (handleAsideDismiss sent aside_dismissed, backend
          // sendEscapeToBtw'd, poller saw marker vanish and broadcast
          // dismissed) OR from any other cause (Ashley SSH-attached
          // and pressed Escape herself, tmux died, peer tab dismissed).
          // Idempotent: if THIS client already optimistically cleared
          // asideText in handleAsideDismiss, this setState is a no-op.
          setAsideText(null);
          break;
        }
        case "session_holding": {
          // Phase 3 Layer 1 / Layer 2 SIGTERM-fallback edge. Show the banner;
          // do NOT clear messages yet (Ashley may want to scroll back through
          // the old conversation while the new one starts). Do NOT close the
          // WS — the tail restart is server-side and transparent (CONTEXT.md
          // § Frontend event handling).
          setIsHolding(true);
          break;
        }
        case "session_changed": {
          // Phase 3 recycle completed: server has stopped the old tail and
          // started a fresh one on the new sessionFile. Reset ALL per-session
          // state; the incoming `message` events from the fresh tail (which
          // uses `tail -F -n +1`) will re-hydrate the conversation from line 1.
          // Auto-dismiss the holding banner. Do NOT touch IdentityBadge (pane-
          // scoped, owned by Terminal.tsx) or ComposeBox draft (per patch #57's
          // key is userId+hostId+tmuxSession, so it correctly survives).
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
          // closes the edge case at zero cost. Do NOT clear errorMessage
          // here — if the executor decides errorMessage cleanup is needed too,
          // add it in a follow-up (the plan does not require it).
          setMessages([]);
          setHarnessTasks([]);
          setContextPct(null);
          setBackgroundedAgents([]);
          setBackgroundedShells([]);
          setPlanPending(null);
          setIsHolding(false);
          // Patch #122: safe reset — if user clicks reset again after
          // this success, error state must not persist.
          setHoldingTimeoutError(false);
          setStatus("streaming");
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
      setStatus("error");
      setErrorMessage((prev) => prev ?? "Connection closed");
      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(2000 * (reconnectAttemptsRef.current + 1), 8000);
        reconnectAttemptsRef.current += 1;
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
      if (wsRef.current?.readyState === 1) return; // still OPEN
      // Fresh budget for this foreground event (Ashley iOS PWA fix).
      reconnectAttemptsRef.current = 0;
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

  // Patch #74: delay-armed gate for the SessionHoldingOverlay. When
  // `isHolding` becomes true, arm a ~350ms timer; only after it fires
  // does `showOverlay` flip true (and the overlay mounts). When
  // `isHolding` becomes false, clear the pending timer AND drop
  // `showOverlay` immediately — so genuinely-instant resets (tiny
  // JSONL rewrites, sub-second recycles) NEVER flash the overlay. If
  // `isHolding` clears before 350ms elapses, `showOverlay` stays false
  // and no overlay ever renders. Effect cleanup also clears the timer,
  // so an unmount mid-hold never leaves an orphaned setState.
  useEffect(() => {
    if (!isHolding) {
      setShowOverlay(false);
      return;
    }
    const t = setTimeout(() => {
      setShowOverlay(true);
    }, 350);
    return () => {
      clearTimeout(t);
    };
  }, [isHolding]);

  // Patch #122: client-side belt-and-suspenders holding_timeout watchdog.
  // When isHolding flips true, start a 300000ms timer (5 minutes); when it
  // fires, flip the overlay to its red-bubble variant. Redundant with the
  // backend's own `inactive { reason: 'holding_timeout' }` frame
  // (claude-session-server.ts line 1645), but survives the case where the
  // WS connection drops during the hold — the backend can't deliver the
  // frame if the socket is gone. Cleanup clears the timer on unmount OR
  // when isHolding flips back false (session_changed, another reset click).
  // Patch #127: bumped from 120000ms (2 min) to 300000ms (5 min) — real
  // backend recycles under load legitimately exceeded 2 min, tripping the
  // red-bubble prematurely. 5 min preserves the WS-drop safety net while
  // cutting false-positive rate.
  useEffect(() => {
    if (!isHolding) return;
    const t = setTimeout(() => {
      setHoldingTimeoutError(true);
    }, 300000);
    return () => {
      clearTimeout(t);
    };
  }, [isHolding]);

  // Patch #122: reset error state when isHolding clears via any path
  // (session_changed, `inactive` non-holding_timeout reason, component
  // unmount). Kept as a dedicated effect rather than inlined into each
  // clear-site so future code that flips isHolding false can't forget the
  // paired cleanup. Guard on !isHolding so this NEVER runs while
  // isHolding is still true — the entire window in which the error can
  // be displayed is exactly the isHolding=true window.
  useEffect(() => {
    if (!isHolding) setHoldingTimeoutError(false);
  }, [isHolding]);

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
    const prev = prevIsIdleRef.current;
    prevIsIdleRef.current = isIdle;
    if (prev === false && isIdle === true && pvIdentity != null) {
      // Suppress the trailing false→true transition that follows a
      // user-initiated dismiss (Escape into tmux → pane activity →
      // isIdle bounce). See dismissCooldownUntilRef declaration.
      if (Date.now() < dismissCooldownUntilRef.current) return;
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "aside_arm" }));
        } catch {
          /* swallow — best-effort; backend re-arms on next transition */
        }
      }
    }
  }, [isIdle, pvIdentity]);

  return (
    <div
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
          uploads.stageAttachments(items);
        } else if (files.length > 0) {
          uploads.stageAttachments(files);
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
          size="lg"
          onClick={() => setIsIdentityModalOpen(true)}
        />
      )}
      {/* Patch #74: full-surface session-recycle overlay. Absolute-
          positioned via SessionHoldingOverlay's own `absolute inset-0`,
          anchored to this root's `relative overflow-hidden`. Mount gate
          is `showOverlay` (delay-armed by ~350ms after isHolding=true)
          rather than raw `isHolding` — see the useEffect above for the
          gate rationale. Sits above IdentityBadge (z-[110] > z-[101])
          but below app-modal dialogs (z-[500]), which is intentional:
          session-recycle is component-local state, not an app-modal
          event. Replaces the previous sticky top-of-scroll banner
          (retired in patch #74) per Ashley's live 2026-07-19 design
          read — the old bar was too subtle for how significant the
          state actually is. */}
      {showOverlay && <SessionHoldingOverlay error={holdingTimeoutError} />}
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
      {status === "connecting" && (
        <div className="p-4 text-sm text-[var(--color-pv-fg-muted)]">
          Connecting…
        </div>
      )}

      {status === "inactive" && (
        <div className="flex-1 flex items-center justify-center p-4 text-sm text-[var(--color-pv-fg-muted)]">
          no active Claude session
        </div>
      )}

      {status === "error" && errorMessage && (
        <div className="p-4 text-sm text-[color:var(--color-pv-code-fg)]">{errorMessage}</div>
      )}

      {(status === "streaming" ||
        (status === "connecting" && messages.length > 0)) && (
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto px-4 py-3"
        >
          {/* Inner content wrapper: the ResizeObserver in useAutoScroll
              watches THIS element for content-size changes (new messages,
              markdown re-layout, Inter font swap). The outer scrollRef div
              is watched separately for viewport-size changes. */}
          <div ref={contentRef} className="flex flex-col gap-[18px]">
            {(() => {
              // Find last user-role message index for anchor ref attachment.
              // Manual reverse loop because ES2022 lib does not include findLastIndex (ES2023).
              let lastUserMsgIdx = -1;
              for (let i = messages.length - 1; i >= 0; i--) {
                const e = messages[i];
                if (e.type === "message" && (e as { role?: string }).role === "user") {
                  lastUserMsgIdx = i;
                  break;
                }
              }
              return messages.map((m, idx) => (
                <div
                  key={m.eventId}
                  ref={idx === lastUserMsgIdx ? anchorRefCallback : undefined}
                >
                  {m.type === "image" ? (
                    <ImageBubble
                      role={m.role}
                      images={m.images}
                      text={m.text}
                      eventId={m.eventId}
                      ts={m.ts}
                    />
                  ) : (
                    <ChatMessage
                      role={m.role}
                      content={m.content}
                    />
                  )}
                </div>
              ));
            })()}
            {(wipActive || backgroundedAgents.length > 0 || backgroundedShells.length > 0) && <WipBubble />}
            {planPending && <PlanPendingBubble />}
            {/* Phase 14 Wave 3: aside bubble mounts as the last child of
                the contentRef flex column so useAutoScroll's ResizeObserver
                pins the viewport to it on mount (in-flow, per ASIDE-05 —
                NOT an overlay, popup, or fixed-position element). */}
            {asideText !== null && <AsideBubble text={asideText} />}
          </div>
          {/* Jump-to-bottom pill — sibling of the content wrapper, still
              inside the scroll container so `sticky bottom-2` anchors it
              to the bottom-right of the visible viewport. Shown only when
              the user has scrolled up. `scrollToBottomAndFollow` jumps to
              bottom AND enters user-driving/followBottom=true so subsequent
              growth stays stuck to the tail (same semantic as GTG). */}
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

      {onSend && status === "streaming" && (
        <ComposeBox
          onSend={onSend}
          onResetClicked={onResetClicked}
          canSend={status === "streaming"}
          isHolding={isHolding}
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
          onAttachFiles={uploads.stageAttachments}
          // Phase 14 Wave 3: aside props. Wave 3 owns the interface
          // (Task 2 above added asideActive + onAsideDismiss to
          // ComposeBoxProps). Wave 4 will consume them in the
          // ComposeBox body — until then, passing them is a no-op
          // rendering-wise but the wire is in place.
          asideActive={asideText !== null}
          onAsideDismiss={handleAsideDismiss}
          onTogglePrettyMode={onTogglePrettyMode}
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
