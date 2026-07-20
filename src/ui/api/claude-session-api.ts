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

// Patch #86: WS-inline base64 image payload. `data` is raw base64 — the
// consumer prepends `data:${mediaType};base64,` when building `<img src>`.
// `toolUseId` is populated only for images that arrived via the canonical
// Anthropic tool_result path; absent for bare image content blocks and
// for the Claude-Code-local `toolUseResult.file.base64` convenience path.
export type ImageBlock = {
  data: string;
  mediaType: string;
  toolUseId?: string;
};

export type ImageEvent = {
  type: "image";
  role: "user" | "assistant" | "tool_result";
  images: ImageBlock[];
  text: string;
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

export interface BackgroundedShell {
  toolUseId: string;
  description: string; // input.description; may be ""
  command: string; // input.command, truncated to ~120 chars
  ts: number; // ms epoch of the tool_use turn
}

export interface BackgroundedShellsEvent {
  type: "backgrounded_shells";
  shells: BackgroundedShell[]; // currently-running only; empty = none
}

export type PlanPendingEvent = {
  type: "plan_pending";
  pending: { planFilePath: string } | null;
};

export type SessionHoldingEvent = {
  type: "session_holding";
};

export type SessionChangedEvent = {
  type: "session_changed";
  newSessionFile: string;
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
  | ImageEvent
  | InactiveEvent
  | ContextPctEvent
  | HarnessTasksEvent
  | BackgroundedAgentsEvent
  | BackgroundedShellsEvent
  | PlanPendingEvent
  | SessionHoldingEvent
  | SessionChangedEvent
  | TailErrorEvent
  | ErrorEvent
  | IdentityBountiesEvent
  | IdentityIdentityFileEvent
  | IdentityHistoryEvent
  | IdentityWakeupsEvent
  | IdentityHandoffEvent;

export type ConnectToPanePayload = {
  type: "connectToPane";
  hostId: number;
  tmuxSession: string;
};

// Patch #87: identity bounties WS wire types.
//
//   client -> server:
//     { type: "identity:list-bounties", identityKey: string }
//
//   server -> client:
//     { type: "identity:bounties", bounties: Bounty[], archivedBounties: Bounty[], error?: string }
//
// `identityKey` is the lowercased identity name (matches the identity dir under
// ~/.claude/identities/<key>/bounties/). The client passes it from the resolved
// `identity.identityKey` from `useSessionIdentity()` — no additional backend
// resolution needed (D-01).

export type Bounty = {
  id: string;
  title: string;
  premise: string;
  status: string;
  priority: string;
  keywords: string[];
  requested_by: string | null;
  created_at: string;
  updated_at: string;
  timeline: string[];
  todos: { text: string; done: boolean }[];
};

export type IdentityListBountiesPayload = {
  type: "identity:list-bounties";
  identityKey: string;
};

export type IdentityBountiesEvent = {
  type: "identity:bounties";
  bounties: Bounty[];
  archivedBounties: Bounty[];
  error?: string;
};

// Patch #17g: identity artifact WS wire types.
//
//   client -> server:
//     { type: "identity:get-identity-file", identityKey: string }
//     { type: "identity:get-history", identityKey: string }
//     { type: "identity:list-wakeups", identityKey: string }
//     { type: "identity:get-handoff", identityKey: string }
//
//   server -> client:
//     { type: "identity:identity-file", markdown: string, error?: string }
//     { type: "identity:history", entries: string[], error?: string }
//     { type: "identity:wakeups", wakeups: Wakeup[], error?: string }
//     { type: "identity:handoff", markdown: string, error?: string }

export type IdentityGetIdentityFilePayload = { type: "identity:get-identity-file"; identityKey: string };
export type IdentityIdentityFileEvent = { type: "identity:identity-file"; markdown: string; error?: string };

export type IdentityGetHistoryPayload = { type: "identity:get-history"; identityKey: string };
export type IdentityHistoryEvent = { type: "identity:history"; entries: string[]; error?: string };

export type Wakeup = { name: string; enabled: boolean; scheduleHuman: string; instruction: string };
export type IdentityListWakeupsPayload = { type: "identity:list-wakeups"; identityKey: string };
export type IdentityWakeupsEvent = { type: "identity:wakeups"; wakeups: Wakeup[]; error?: string };

export type IdentityGetHandoffPayload = { type: "identity:get-handoff"; identityKey: string };
export type IdentityHandoffEvent = { type: "identity:handoff"; markdown: string; error?: string };
