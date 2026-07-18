import { useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/button";
import {
  openClaudeSessionSocket,
  type ClaudeSessionServerEvent,
  type ConnectToPanePayload,
  type HarnessTask,
  type BackgroundedAgent,
  type MessageEvent as ChatMessageEvent,
} from "@/api/claude-session-api";
import { ChatMessage } from "./ChatMessage";
import { WipBubble } from "./WipBubble";
import { PlanPendingBubble } from "./PlanPendingBubble";
import { SessionHoldingBanner } from "./SessionHoldingBanner";
import { useAutoScroll } from "./use-auto-scroll";
import { ComposeBox } from "./ComposeBox";
import { HarnessTasksPanel } from "./HarnessTasksPanel";
import { BackgroundedAgentsPanel } from "./BackgroundedAgentsPanel";

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
  // PTY-side "Claude is currently working" signal from the terminal
  // WebSocket (patch #13 mechanism). `false` = Claude quiet ≥4s AND
  // foreground = claude → hide the WIP bubble. `true` = actively
  // working → show the WIP bubble. `null` = backend has not spoken
  // yet on the current attach → do not show (unknown).
  isIdle?: boolean | null;
}

type Status = "connecting" | "streaming" | "inactive" | "error";

function appendDedup(
  prev: ChatMessageEvent[],
  next: ChatMessageEvent,
): ChatMessageEvent[] {
  if (prev.some((m) => m.eventId === next.eventId)) return prev;
  return [...prev, next];
}

export function PrettyView({
  hostId,
  tmuxSession,
  className,
  style,
  onSend,
  isIdle,
}: PrettyViewProps) {
  const [messages, setMessages] = useState<ChatMessageEvent[]>([]);
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
  // Phase 3: session-changeover holding state. True during the ~5s gap
  // between the old Claude session's death and the new one's launch (per
  // Plan 03-01 backend's Layer 1 raw-line /exit scan OR Layer 2 discovery-
  // repoll's SIGTERM-fallback path). Cleared by `session_changed` (recycle
  // completed) or `inactive` with reason "holding_timeout" (recycle failed).
  // WebSocket is NOT closed during holding — the tail restart is server-side
  // and transparent to this client (see CONTEXT.md § Frontend event handling).
  const [isHolding, setIsHolding] = useState(false);
  // WIP indicator is driven by the PTY-side `isIdle` prop from Terminal
  // (patch #51 rework — was previously state fed by a JSONL classifier
  // over the claude-session WS, which turned out to be unreliable
  // because Claude Code 2.1 emits many `type:"user"` events that are
  // not real user speech).
  const wipActive = isIdle === false;

  const wsRef = useRef<WebSocket | null>(null);

  const { scrollRef, contentRef, scrollToBottom, isPinnedToBottom } =
    useAutoScroll();

  useEffect(() => {
    // Reset all state for this (hostId, tmuxSession) mount.
    setMessages([]);
    setStatus("connecting");
    setInactiveReason(null);
    setErrorMessage(null);
    setContextPct(null);
    setHarnessTasks([]);
    setBackgroundedAgents([]);
    setPlanPending(null);
    setIsHolding(false);

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
        case "inactive": {
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
        case "plan_pending": {
          setPlanPending(parsed.pending);
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
          setPlanPending(null);
          setIsHolding(false);
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
      // Do NOT auto-reopen. If we're already inactive, that stays the
      // final terminal state — any resumption logic would risk
      // stepping past a legitimate inactive frame.
      setStatus((prev) => {
        if (prev === "inactive") return prev;
        return "error";
      });
      setErrorMessage((prev) => prev ?? "Connection closed");
    };

    return () => {
      cancelled = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    };
  }, [hostId, tmuxSession]);

  return (
    <div
      className={cn("h-full w-full flex flex-col bg-background", className)}
      style={style}
    >
      {status === "connecting" && (
        <div className="p-4 text-sm text-muted-foreground">Connecting…</div>
      )}

      {status === "inactive" && (
        <div className="flex-1 flex items-center justify-center p-4 text-sm text-muted-foreground">
          no active Claude session
        </div>
      )}

      {status === "error" && errorMessage && (
        <div className="p-4 text-sm text-destructive">{errorMessage}</div>
      )}

      {(status === "streaming" ||
        (status === "connecting" && messages.length > 0)) && (
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto px-4 py-3"
        >
          {/* Session-holding banner — sticky at the top of the scroll region
              so scrolling up through the old conversation during the ~5s
              recycle gap still shows the status. Mounted only when the
              backend has flagged holding; auto-dismissed on session_changed
              or inactive (per Task 3 handlers above). Positioned BEFORE the
              content wrapper so it visually sits above the messages list.
              Uses sticky top-0 with a small negative margin (-mx-4 -mt-3)
              to cancel the scroll container's own px-4 py-3 padding on the
              top and horizontal edges so the banner reads as a full-width
              band rather than a pill inset inside the messages.
              z-10 keeps it above scrolling content.

              FRAGILITY WARNING (W4 fix from plan-checker 2026-07-18): the
              `sticky top-0` positioning silently breaks if ANY ancestor
              gains a CSS `transform` or `will-change` property — those
              establish a new containing block for fixed/sticky descendants
              and the banner will scroll away with the content rather than
              sticking. If a future patch adds `transform`, `will-change`,
              `filter`, `perspective`, or `backdrop-filter` to Terminal.tsx's
              flex-column wrapper, PrettyView's outer div, or any element
              between them and the scroll container HERE, this sticky banner
              stops working correctly. If that happens, options:
                (a) find and remove the transform-inducing ancestor property.
                (b) hoist the banner OUT of the scroll container as a sibling
                    of the scroll container inside PrettyView's flex-column
                    (would need `shrink-0` and to relocate the {isHolding &&}
                    gate to PrettyView's outer JSX). See CONTEXT.md § W4
                    discussion for the option-(b) restructure.
              The sticky pattern is proven elsewhere in Termix so option-(a)
              is preferred; option-(b) is a bigger refactor. Note:
              `backdrop-filter` on THIS sticky element itself is fine — it
              establishes a containing block only for its own descendants,
              not for the sticky element itself. The W4 fragility is about
              ancestors, not the sticky element's own filter properties. */}
          {isHolding && (
            <div className="sticky top-0 z-10 -mx-4 -mt-3 mb-3 px-4 py-2 bg-background/95 backdrop-blur-sm border-b border-border">
              <SessionHoldingBanner />
            </div>
          )}
          {/* Inner content wrapper: the ResizeObserver in useAutoScroll
              watches THIS element for content-size changes (new messages,
              markdown re-layout, Inter font swap). The outer scrollRef div
              is watched separately for viewport-size changes. */}
          <div ref={contentRef} className="flex flex-col gap-3">
            {messages.map((m) => (
              <ChatMessage key={m.eventId} role={m.role} content={m.content} />
            ))}
            {wipActive && <WipBubble />}
            {planPending && <PlanPendingBubble />}
          </div>
          {/* Jump-to-bottom pill — sibling of the content wrapper, still
              inside the scroll container so `sticky bottom-2` anchors it
              to the bottom-right of the visible viewport. Shown only when
              the user has scrolled up. `scrollToBottom` itself flips the
              internal pin ref+state, so the next incoming message pins. */}
          {!isPinnedToBottom && messages.length > 0 && (
            <div className="sticky bottom-2 pointer-events-none flex justify-end">
              <Button
                size="icon-sm"
                variant="secondary"
                onClick={scrollToBottom}
                aria-label="Jump to latest"
                title="Jump to latest"
                className="pointer-events-auto shadow-md"
              >
                <ArrowDown className="size-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {errorMessage && status === "streaming" && (
        <div className="border-t border-border bg-destructive/10 text-destructive text-xs px-3 py-1">
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

      {onSend && status === "streaming" && (
        <ComposeBox
          onSend={onSend}
          canSend={status === "streaming"}
          contextPct={contextPct}
          hostId={hostId}
          tmuxSession={tmuxSession}
          className="shrink-0"
        />
      )}

      {/* inactiveReason is captured in state for potential future use
          (e.g. Phase 2 diagnostic tooltip) but MUST NOT render as
          visible text — FALLBACK-01 says the inactive branch renders
          exactly the string above and nothing else. */}
      {false && inactiveReason}
    </div>
  );
}
