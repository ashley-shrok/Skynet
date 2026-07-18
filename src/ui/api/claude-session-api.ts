/**
 * Live Claude-session WebSocket client wrapper.
 *
 * Opens a same-origin WebSocket to the backend `claude-session-server`
 * (Plan 01-02 output, listening on port 30011 behind nginx). The browser
 * attaches the `jwt` HttpOnly cookie automatically via same-origin, so no
 * query-string JWT fallback is appended here — that fallback in the
 * backend exists for wscat-based smoke testing, not for browsers.
 *
 * Callers construct payloads directly and `switch (event.type)` on
 * incoming frames — no runtime discriminator helper is exported.
 */

export function openClaudeSessionSocket(): WebSocket {
  const scheme =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "wss:"
      : "ws:";
  const host =
    typeof window !== "undefined" ? window.location.host : "localhost";
  const url = `${scheme}//${host}/claude-session/websocket/`;
  return new WebSocket(url);
}

export type SessionMetaEvent = {
  type: "session";
  pid: number;
  sessionFile: string;
};

export type MessageEvent = {
  type: "message";
  role: "user" | "assistant";
  content: string;
  eventId: string;
  ts: number;
};

export type InactiveEvent = {
  type: "inactive";
  reason: string;
};

export type ContextPctEvent = {
  type: "context_pct";
  pct: number; // 0-100 inclusive
};

export type HarnessTask = {
  id: string;
  subject: string;
  description?: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed" | string;
  blocks?: string[];
  blockedBy?: string[];
};

export type HarnessTasksEvent = {
  type: "harness_tasks";
  tasks: HarnessTask[]; // raw list — client filters completed for display
};

export type BackgroundedAgent = {
  toolUseId: string;
  subagentType: string; // input.subagent_type; may be ""
  description: string; // input.description; may be ""
  startedAt: number; // ms epoch
};

export type BackgroundedAgentsEvent = {
  type: "backgrounded_agents";
  agents: BackgroundedAgent[]; // currently-running only; empty = none
};

export type TailErrorEvent = {
  type: "tail_error";
  message: string;
};

export type ErrorEvent = {
  type: "error";
  message: string;
  code?: string;
};

export type ClaudeSessionServerEvent =
  | SessionMetaEvent
  | MessageEvent
  | InactiveEvent
  | ContextPctEvent
  | HarnessTasksEvent
  | BackgroundedAgentsEvent
  | TailErrorEvent
  | ErrorEvent;

export type ConnectToPanePayload = {
  type: "connectToPane";
  hostId: number;
  tmuxSession: string;
};
