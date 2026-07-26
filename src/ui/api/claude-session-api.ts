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

// Phase 14 (plain-language-translation-asides) Wave 2 — new WS wire types.
//
// aside_ready — server -> client. Backend has extracted a /btw answer from
// the tmux BTW overlay (per CONTEXT.md § Extraction: two consecutive stable
// poll reads containing ASIDE_END_MARKER) and is delivering it to this
// client for AsideBubble render. Refs: ASIDE-05 (aside surfaces post-turn)
// + ASIDE-09 (tab-close / re-attach recovery emits this to the mounting
// client immediately after connect-time pane probe finds an already-open
// BTW overlay).
export type AsideReadyEvent = {
  type: "aside_ready";
  text: string; // extracted /btw answer text; may span multiple lines
};

// aside_dismissed — server -> client. Backend observed the BTW overlay
// disappearing (either from a client-initiated Escape, or from any other
// cause — Ashley SSH-attaching and pressing Escape herself, tmux death,
// etc.). Broadcast to ALL clients subscribed to this session's WS stream
// for cross-tab dismiss coherence. Refs: ASIDE-07 (dismiss via Resume X) +
// ASIDE-11 (cross-tab dismiss coherence).
export type AsideDismissedEvent = {
  type: "aside_dismissed";
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
  | AsideReadyEvent
  | AsideDismissedEvent
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

// Phase 14 Wave 2 — client -> server payloads for the aside subsystem.
//
// AsideArmPayload — client -> server. Sent by PrettyView on the
// `isIdle:false -> true` transition when `pvIdentity !== null` (per
// CONTEXT.md § Trigger — locked 2026-07-26). This is the SOLE trigger
// source for the backend's /btw injection: the backend does NOT observe
// the terminal WSS's `type:"idle"` signal (the two WSSes live on separate
// ports with no shared state). The frontend gates identity BEFORE
// emitting; the backend accepts any aside_arm for a connected pretty-view
// WS without checking identity. No payload beyond the type tag — the
// backend derives hostId + tmuxSession from the connection's own captured
// state (set during connectToPane). Ref: ASIDE-01.
export type AsideArmPayload = {
  type: "aside_arm";
};

// AsideDismissedPayload — client -> server. Sent when user clicks the X
// (Resume) affordance on the ComposeBox. hostId + tmuxSession are
// informational for cross-tab-broadcast targeting; per T-14-02-01
// mitigation, the backend does NOT trust these fields for send-keys
// routing — it uses the connection's own captured currentHostId /
// currentTmuxSession (set at connectToPane discovery, validated against
// the pane's actual SSH context). Ref: ASIDE-07.
export type AsideDismissedPayload = {
  type: "aside_dismissed";
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
  /** Patch #109: folder basename. bounty.json's `id` field is a UUID —
   *  useless for humans. The FOLDER name is what Ashley references bounties
   *  by in conversation. Backend injects this from the directory listing;
   *  frontend renders it alongside `title` in BountyCard. Always present. */
  slug: string;
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
  /** patch #92: pane's SSH host id — backend routes reads to the pane's box (local bind-mount when hostId is in IDENTITIES_LOCAL_HOST_IDS). */
  hostId: number;
};

export type IdentityBountiesEvent = {
  type: "identity:bounties";
  bounties: Bounty[];
  archivedBounties: Bounty[];
  error?: string;
};

// Patch #17g/#92: identity artifact WS wire types.
//
//   client -> server:
//     { type: "identity:get-identity-file", identityKey: string, hostId: number }
//     { type: "identity:get-history", identityKey: string, hostId: number }
//     { type: "identity:list-wakeups", identityKey: string, hostId: number }
//     { type: "identity:get-handoff", identityKey: string, hostId: number }
//
//   server -> client (UNCHANGED — only request payloads gain hostId):
//     { type: "identity:identity-file", markdown: string, error?: string }
//     { type: "identity:history", entries: string[], error?: string }
//     { type: "identity:wakeups", wakeups: Wakeup[], error?: string }
//     { type: "identity:handoff", markdown: string, error?: string }
//
// hostId is the pane's SSH host id — backend uses it to route reads to the pane's box
// (or falls back to the local bind-mount when the hostId is in IDENTITIES_LOCAL_HOST_IDS).

export type IdentityGetIdentityFilePayload = {
  type: "identity:get-identity-file";
  identityKey: string;
  /** patch #92: pane's SSH host id — backend routes reads to the pane's box. */
  hostId: number;
};
export type IdentityIdentityFileEvent = { type: "identity:identity-file"; markdown: string; error?: string };

export type IdentityGetHistoryPayload = {
  type: "identity:get-history";
  identityKey: string;
  /** patch #92: pane's SSH host id — backend routes reads to the pane's box. */
  hostId: number;
};
export type IdentityHistoryEvent = { type: "identity:history"; entries: string[]; error?: string };

export type Wakeup = { name: string; enabled: boolean; scheduleHuman: string; instruction: string };
export type IdentityListWakeupsPayload = {
  type: "identity:list-wakeups";
  identityKey: string;
  /** patch #92: pane's SSH host id — backend routes reads to the pane's box. */
  hostId: number;
};
export type IdentityWakeupsEvent = { type: "identity:wakeups"; wakeups: Wakeup[]; error?: string };

export type IdentityGetHandoffPayload = {
  type: "identity:get-handoff";
  identityKey: string;
  /** patch #92: pane's SSH host id — backend routes reads to the pane's box. */
  hostId: number;
};
export type IdentityHandoffEvent = { type: "identity:handoff"; markdown: string; error?: string };
