import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  openClaudeSessionSocket,
  type ClaudeSessionServerEvent,
  type ConnectToPanePayload,
  type MessageEvent as ChatMessageEvent,
} from "@/api/claude-session-api";
import { ChatMessage } from "./ChatMessage";
import { useAutoScroll } from "./use-auto-scroll";

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
//   2. RENDER-03 auto-scroll: `wasPinnedRef` captures isPinnedToBottom
//      BEFORE each setMessages call. The post-add effect only pins to
//      the bottom when the user was already there — scrolled-up users
//      are not yanked back on new messages.
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
}: PrettyViewProps) {
  const [messages, setMessages] = useState<ChatMessageEvent[]>([]);
  const [status, setStatus] = useState<Status>("connecting");
  const [inactiveReason, setInactiveReason] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wasPinnedRef = useRef<boolean>(true);

  const { scrollToBottom, isPinnedToBottom } = useAutoScroll(listRef);

  useEffect(() => {
    // Reset all state for this (hostId, tmuxSession) mount.
    setMessages([]);
    setStatus("connecting");
    setInactiveReason(null);
    setErrorMessage(null);
    wasPinnedRef.current = true;

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
          // Session-info frame — flip to streaming and note the file
          // for dev debugging. Not rendered.
          // eslint-disable-next-line no-console
          console.debug(
            "[PrettyView] session",
            parsed.pid,
            parsed.sessionFile,
          );
          setStatus("streaming");
          break;
        }
        case "message": {
          wasPinnedRef.current = isPinnedToBottom;
          setMessages((prev) => appendDedup(prev, parsed));
          break;
        }
        case "inactive": {
          setStatus("inactive");
          setInactiveReason(parsed.reason);
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
  }, [hostId, tmuxSession, isPinnedToBottom]);

  // Chat-app auto-scroll — only pin to bottom if the user was already
  // there immediately before the setMessages call that added this row.
  useEffect(() => {
    if (wasPinnedRef.current) scrollToBottom();
  }, [messages.length, scrollToBottom]);

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
          ref={listRef}
          className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3"
        >
          {messages.map((m) => (
            <ChatMessage key={m.eventId} role={m.role} content={m.content} />
          ))}
        </div>
      )}

      {errorMessage && status === "streaming" && (
        <div className="border-t border-border bg-destructive/10 text-destructive text-xs px-3 py-1">
          {errorMessage}
        </div>
      )}

      {/* inactiveReason is captured in state for potential future use
          (e.g. Phase 2 diagnostic tooltip) but MUST NOT render as
          visible text — FALLBACK-01 says the inactive branch renders
          exactly the string above and nothing else. */}
      {false && inactiveReason}
    </div>
  );
}
