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

// Phase 24 Plan 03: widened frame shape. Backend emits presence + path
// immediately (planContent=null) then re-emits with populated planContent
// OR contentError after the async SFTP side-channel fetch resolves. All
// three inner fields are nullable so the frontend renders defensively:
//   - planFilePath === null → skip the middle plan-contents section
//   - planContent === null && !contentError → "Loading plan…" italic
//   - contentError !== null → dim "Plan contents unavailable ({error})"
//   - planContent !== null → render in <pre> monospace block
// The outer `pending: null` still means "no plan-approval prompt visible".
export type PlanPendingEvent = {
  type: "plan_pending";
  pending: {
    planFilePath: string | null;
    planContent: string | null;
    contentError: string | null;
  } | null;
};

export type SessionHoldingEvent = {
  type: "session_holding";
};

// Fix B (2026-07-30): emitted by the backend when the repoll active-branch
// sees the SAME sessionFile while changeoverState === "holding" — meaning
// the overlay was armed by a transient false alarm, not a real recycle.
// Frontend handler surgically clears isHolding + holdingTimeoutError only;
// the message stream, contextPct, harnessTasks, backgroundedAgents,
// plan_pending, and asideText are all preserved verbatim (contrast with
// session_changed which is a heavy-reset for a real recycle).
export type SessionHoldingClearedEvent = {
  type: "session_holding_cleared";
};

export type SessionChangedEvent = {
  type: "session_changed";
  newSessionFile: string;
};

// Phase 17 (RELAYBUB-01, RELAYBUB-02) — relay event wire types.
//
// RelayOutboundEvent: emitted when the backend parser detects a Bash tool_use
// that is a real Matrix relay send (curl + -X PUT + rooms/X/send/m.room.message/Y
// conjunction). Field notes:
//   rawCommand:   IS the body (Option D, Ashley 2026-07-28) — rendered faithfully
//                 as a scrollable mono block. Full Bash command; may contain curl
//                 bearer tokens (accepted disclosure, same surface as tmux pane;
//                 T-17-01-02). No body extraction, no extractError field.
//
// RelayInboundEvent: emitted when a task-notification user turn matches
// the recv.sh event-line format [room X] [@sender] (event $Y): BODY.
//   matrixEventId: the $event_id from the recv.sh line (distinct from
//                  the outer JSONL eventId which is the JSONL uuid).
export type RelayOutboundEvent = {
  type: "relay_outbound";
  room: string | null;
  rawCommand: string;
  eventId: string;
  ts: number;
};

export type RelayInboundEvent = {
  type: "relay_inbound";
  room: string;
  sender: string;
  matrixEventId: string;
  body: string;
  raw: string;
  eventId: string;
  ts: number;
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

/** quick 260808-cd6 — dormancy overlay + wake button */
export type DormantEvent = { type: "dormant"; dormant: boolean };
/** quick 260808-cd6 — dormancy overlay + wake button */
export type WakeResultEvent = { type: "wake_result"; ok: boolean; error?: string };

/**
 * Phase 30 (PS30-01 + PS30-04): backend-authoritative pane-entry verdict.
 *
 * Emitted by the backend on every WS attach (fresh clients get current
 * truth) and on every state change. Consolidates the five legacy racing
 * frame types (session_holding / session_holding_cleared / session_changed
 * / dormant / inactive) into a single authoritative wire surface — see
 * src/backend/claude-session/pane-state-emitter.ts for the emitter.
 *
 * `state` values match the backend emitter's PaneState union exactly:
 * active | holding | dormant | inactive | error. `reason` is optional
 * free-form diagnostic text (string | undefined) — the frontend treats
 * it as opaque and currently does not surface it in the UI (T-30-03-03
 * information-disclosure mitigation per Plan 30-03 threat model).
 *
 * The frontend consumer stores parsed.state into a paneState React state
 * slot; the trivial usePaneResolvingMachine hook + pure resolveRenderedState
 * reducer derive the rendered overlay from (wsTransportState, paneState).
 * Legacy frame types stay on the wire for backward compat (D-migration in
 * 30-CONTEXT.md); their captureFirstFrame client-inference calls are all
 * DELETED per Plan 30-03 Task 3.
 */
export type PaneStateEvent = {
  type: "pane_state";
  state: "active" | "holding" | "dormant" | "inactive" | "error";
  reason?: string;
};

/**
 * pv-malformed-jsonl-placeholder-bubble (2026-08-10) — surfaced when
 * parseSessionLine returns kind:"malformed" (JSON.parse threw on the raw
 * line). The truncated turn's content is unrecoverable (Claude Code's
 * JSONL writer occasionally races an assistant record and a
 * file-history-snapshot onto the same line and cuts the first mid-string).
 * `bytes` carries the trimmed byte length of the unparseable line for
 * diagnostic display; `eventId` is fabricated backend-side (no uuid was
 * parseable). Rendered as a compact placeholder bubble so Ashley sees
 * that something was dropped instead of silently losing the turn.
 */
export type MalformedLineEvent = {
  type: "malformed_line";
  bytes: number;
  eventId: string;
  ts: number;
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
  | SessionHoldingClearedEvent
  | SessionChangedEvent
  | AsideReadyEvent
  | AsideDismissedEvent
  | TailErrorEvent
  | ErrorEvent
  // quick 260808-cd6 — dormancy overlay + wake button
  | DormantEvent
  | WakeResultEvent
  // Phase 30 (PS30-01 + PS30-04) — backend-authoritative pane-entry verdict
  | PaneStateEvent
  | IdentityBountiesEvent
  | IdentityIdentityFileEvent
  // Phase 22 SRIC-06 / Plan 22-06: role-file read + update events (mirror
  // shape of IdentityIdentityFileEvent + IdentityIdentityFileUpdatedEvent)
  | IdentityRoleFileEvent
  | IdentityRoleFileUpdatedEvent
  | IdentityHistoryEvent
  | IdentityWakeupsEvent
  | IdentityHandoffEvent
  | IdentityWakeupUpdatedEvent
  | IdentityBountyPriorityUpdatedEvent
  | IdentityBountyStatusUpdatedEvent
  | IdentityBountyPinnedUpdatedEvent
  | IdentityBountyArchivedEvent
  | IdentityBountyDeletedEvent
  // Phase 17 relay events — handlers added in plan 17-03; PrettyView's
  // non-exhaustive switch silently ignores these until then.
  | RelayOutboundEvent
  | RelayInboundEvent
  // pv-malformed-jsonl-placeholder-bubble (2026-08-10)
  | MalformedLineEvent;

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

// Phase 24 — client -> server. One-shot write to the PTY of raw keystroke
// bytes. Used by PlanPendingBubble Approve ("1\r") + Feedback modal Submit
// ("3<feedback>\r"). Deliberately NOT the ComposeBox split-send path
// (patch #44's body+\r-with-60ms-gap) — Ink Plan Mode does NOT recognize
// split-send as a keystroke selection (see PlanPendingBubble.tsx L14-21).
// Backend writes via `tmux send-keys -l` in a single call.
//
// Trust boundary (mirrors AsideDismissedPayload per T-14-02-01): the
// backend derives the send target from the connection's captured
// currentTmuxSession, NOT from any client-supplied field. This payload
// carries only the bytes to send; the pane binding is implicit.
export type RawKeystrokesPayload = {
  type: "raw_keystrokes";
  bytes: string;
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
  /** Patch #168 / #172: independent of status; true if pinned. Backend
   *  normalizeBounty defaults to false when the field is absent from
   *  bounty.json. Flipped via identity:update-bounty-pinned WS write. */
  pinned: boolean;
  /** Phase 26 / this quick: independent user-reserved boolean — true when
   *  Ashley flagged the bounty as needing a desk (real browser/keyboard) to
   *  work on next. Orthogonal to status and pinned. Backend normalizeBounty
   *  defaults to false when absent. Flipped via identity:update-bounty-
   *  needs-desk WS write. */
  needs_desk: boolean;
  keywords: string[];
  requested_by: string | null;
  created_at: string;
  updated_at: string;
  timeline: string[];
  todos: { text: string; done: boolean }[];
  // Phase 18 / IDMEDIT-04: three new fields for the bounty field editor
  // (Plan 18-04/18-05). Populated by normalizeBounty with safe defaults
  // ([] / null) so pre-existing bounty.json files without these fields
  // still produce a valid Bounty on reads. Additive — existing consumers
  // continue to work unchanged.
  source_links: string[];
  deadline: string | null;
  meeting_questions: { text: string; answered: boolean }[];
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
//     // Phase 18 / IDMEDIT-06: markdown write surfaces (full-overwrite, tmp+rename atomic):
//     { type: "identity:update-identity-file", identityKey: string, hostId: number, contents: string }
//     { type: "identity:update-history", identityKey: string, hostId: number, contents: string }
//     { type: "identity:update-handoff", identityKey: string, hostId: number, contents: string }
//
//   server -> client (UNCHANGED — only request payloads gain hostId):
//     { type: "identity:identity-file", markdown: string, error?: string }
//     { type: "identity:history", entries: string[], error?: string }
//     { type: "identity:wakeups", wakeups: Wakeup[], error?: string }
//     { type: "identity:handoff", markdown: string, error?: string }
//     // Phase 18 / IDMEDIT-06: post-write echoes (server re-reads for client rehydration):
//     { type: "identity:identity-file-updated", markdown: string, error?: string }
//     { type: "identity:history-updated", entries: string[], error?: string }
//     { type: "identity:handoff-updated", markdown: string, error?: string }
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

// Phase 22 SRIC-06 / Plan 22-06: role-file WS wire types.
//
// Byte-shape mirror of the identity-file pair above. Backend does the two-step
// (identity file → role: frontmatter → open ~/.claude/roles/<role>/<role>.md);
// the frontend contract stays (identityKey, hostId) — role name never crosses
// the wire, per D-CONTEXT § "Backend does the two-step" lock.
//
// hostId is optional on read for parity with identity-file (LOCAL bind-mount
// fallback when hostId omitted or in IDENTITIES_LOCAL_HOST_IDS); required on
// write since a write always targets a specific host.

export type IdentityGetRoleFilePayload = {
  type: "identity:get-role-file";
  identityKey: string;
  /** Pane's SSH host id — backend routes reads to the pane's box. Omit for LOCAL bind-mount. */
  hostId?: number;
};
export type IdentityRoleFileEvent = { type: "identity:role-file"; markdown: string; error?: string };

export type IdentityGetHistoryPayload = {
  type: "identity:get-history";
  identityKey: string;
  /** patch #92: pane's SSH host id — backend routes reads to the pane's box. */
  hostId: number;
};
// Phase 18 / IDMEDIT-02: widened to carry `markdown` (raw file body) alongside
// `entries` (parsed reverse-chronological lines). markdown is optional for
// backward compat with any payload pre-dating the widening; the server WILL
// always emit it now. Consumers that only read `entries` are unaffected.
export type IdentityHistoryEvent = { type: "identity:history"; entries: string[]; markdown?: string; error?: string };

// Patch #154: Wakeup gains `slug` (filename stem — the address the update
// path uses) and raw `schedule` (unknown — so the modal renders + edits it
// without a wire-side re-humanization round-trip). Existing consumers get
// a superset; nothing they read went away.
export type Wakeup = {
  slug: string;
  name: string;
  enabled: boolean;
  scheduleHuman: string;
  schedule: unknown;
  instruction: string;
};
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

// Patch #154: identity mutation wire types. Both are one-shot request/response
// like the read handlers — client opens a WS, sends the update, receives the
// FRESH list, closes. Fresh-list-in-response saves a follow-up read round-trip
// and gives the modal an atomic swap.
//
// Quick 260731-2pa: `IdentityUpdateWakeupPayload.updates` widened to also
// carry `name?: string` and `instruction?: string` — the form-based editor
// in WakeupsTab.tsx writes the full spec on Save (all four fields), so the
// wire type has to allow all four. Backend server + WakeupUpdate type mirror
// the widening.

export const BOUNTY_PRIORITY_VALUES = [
  "urgent",
  "high",
  "medium",
  "low",
  "unprioritized",
] as const;
export type BountyPriority = (typeof BOUNTY_PRIORITY_VALUES)[number];

// Quick 260727-v0b: allowed status set for bounty-status updates. Mirrors
// BOUNTY_PRIORITY_VALUES's shape — a const tuple + derived union — so the
// StatusRow editor and the WS validation guard reference the same source.
// Order here is the order pills render in BountyCard (done/dropped last
// since they're the terminal states).
// Patch #168: "pinned" removed — it is now an independent boolean field
// orthogonal to the lifecycle status (fleet schema migration 2026-07-28).
export const BOUNTY_STATUS_VALUES = [
  "in_progress",
  "waiting_on_someone_else",
  "done",
  "dropped",
] as const;
export type BountyStatus = (typeof BOUNTY_STATUS_VALUES)[number];

export type IdentityUpdateWakeupPayload = {
  type: "identity:update-wakeup";
  identityKey: string;
  hostId: number;
  /** filename stem of wakeups/<slug>.json — regex-validated on the server. */
  wakeupSlug: string;
  updates: {
    enabled?: boolean;
    schedule?: unknown;
    // Quick 260731-2pa: `name` (non-empty string) and `instruction` (string)
    // added — form-based wakeup editor writes the full spec on Save.
    name?: string;
    instruction?: string;
  };
};
export type IdentityWakeupUpdatedEvent = {
  type: "identity:wakeup-updated";
  wakeups: Wakeup[];
  error?: string;
};

// Phase 18 / IDMEDIT-06: markdown write wire types.
//
// Contents carries the FULL FILE — Save is a full-overwrite on the markdown
// side, not a diff or patch (D-IDMEDIT-01/02/03 shape lock). The *-updated
// echo carries the confirmed post-write markdown or entries so the client
// rehydrates from server-side truth rather than trusting its own draft.
//
// The server caps contents at IDMEDIT_MAX_MARKDOWN_BYTES = 2_000_000 UTF-8
// bytes (2MB). Oversized payloads are rejected before SFTP is opened — the
// error surfaces via the *-updated event's error field.

export type IdentityUpdateIdentityFilePayload = {
  type: "identity:update-identity-file";
  identityKey: string;
  /** Pane SSH host id — backend uses it to route writes to the pane's box. */
  hostId: number;
  /** UTF-8 markdown payload (full-overwrite). Server caps at IDMEDIT_MAX_MARKDOWN_BYTES (2MB). */
  contents: string;
};
export type IdentityIdentityFileUpdatedEvent = {
  type: "identity:identity-file-updated";
  /** Server-echoed confirmed markdown post-write; source of truth for client rehydrate. */
  markdown: string;
  error?: string;
};

// Phase 22 SRIC-06 / Plan 22-06: role-file update wire types. Byte-shape mirror
// of the identity-file update pair above. Backend does the two-step; frontend
// contract stays (identityKey, hostId, contents). Same byte cap
// (IDMEDIT_MAX_MARKDOWN_BYTES = 2MB) enforced server-side.

export type IdentityUpdateRoleFilePayload = {
  type: "identity:update-role-file";
  identityKey: string;
  /** Pane SSH host id — backend uses it to route writes to the pane's box. */
  hostId: number;
  /** UTF-8 markdown payload (full-overwrite of ~/.claude/roles/<role>/<role>.md). */
  contents: string;
};
export type IdentityRoleFileUpdatedEvent = {
  type: "identity:role-file-updated";
  /** Server-echoed confirmed markdown post-write; source of truth for client rehydrate. */
  markdown: string;
  error?: string;
};

export type IdentityUpdateHistoryPayload = {
  type: "identity:update-history";
  identityKey: string;
  /** Pane SSH host id — backend uses it to route writes to the pane's box. */
  hostId: number;
  /** UTF-8 markdown payload (full-overwrite of history.md). Server caps at IDMEDIT_MAX_MARKDOWN_BYTES (2MB). */
  contents: string;
};
// Phase 18 / IDMEDIT-02: widened same as IdentityHistoryEvent to carry `markdown`
// alongside `entries`. Both fields carried in the echo so HistoryTab rehydrates
// from server truth (entries for read-mode list, markdown for edit-mode textarea).
export type IdentityHistoryUpdatedEvent = {
  type: "identity:history-updated";
  /** Server re-reads history.md and returns parsed entries — mirrors identity:history event shape. */
  entries: string[];
  /** Raw file body for HistoryTab editor textarea rehydration. */
  markdown?: string;
  error?: string;
};

export type IdentityUpdateHandoffPayload = {
  type: "identity:update-handoff";
  identityKey: string;
  /** Pane SSH host id — backend uses it to route writes to the pane's box. */
  hostId: number;
  /** UTF-8 markdown payload (full-overwrite of handoff.md). Server caps at IDMEDIT_MAX_MARKDOWN_BYTES (2MB). */
  contents: string;
};
export type IdentityHandoffUpdatedEvent = {
  type: "identity:handoff-updated";
  markdown: string;
  error?: string;
};

export type IdentityUpdateBountyPriorityPayload = {
  type: "identity:update-bounty-priority";
  identityKey: string;
  hostId: number;
  bountySlug: string;
  priority: BountyPriority;
};
export type IdentityBountyPriorityUpdatedEvent = {
  type: "identity:bounty-priority-updated";
  bounties: Bounty[];
  archivedBounties: Bounty[];
  error?: string;
};

// Quick 260727-v0b: byte-shape mirror of the priority payload/event pair
// above, for the parallel `status` write surface. Same one-shot request /
// fresh-list response convention — server patches bounty.json in place
// (folder NOT moved even when transitioning to/from done/dropped) and
// returns both bounty lists so the modal atomically re-renders.
export type IdentityUpdateBountyStatusPayload = {
  type: "identity:update-bounty-status";
  identityKey: string;
  hostId: number;
  bountySlug: string;
  status: BountyStatus;
};
export type IdentityBountyStatusUpdatedEvent = {
  type: "identity:bounty-status-updated";
  bounties: Bounty[];
  archivedBounties: Bounty[];
  error?: string;
};

// Quick 260728-sqk / patch #172: byte-shape mirror of the status payload
// above for the parallel `pinned` write surface. `pinned` is an independent
// boolean orthogonal to lifecycle `status` (fleet schema post-#168 by Nelly
// 2026-07-28). Same one-shot request / fresh-list response convention —
// server patches bounty.json in place (folder NOT moved) and returns both
// bounty lists so the modal atomically re-renders.
export type IdentityUpdateBountyPinnedPayload = {
  type: "identity:update-bounty-pinned";
  identityKey: string;
  hostId: number;
  bountySlug: string;
  pinned: boolean;
};
export type IdentityBountyPinnedUpdatedEvent = {
  type: "identity:bounty-pinned-updated";
  bounties: Bounty[];
  archivedBounties: Bounty[];
  error?: string;
};

// This quick: byte-shape mirror of the pinned payload above for the parallel
// `needs_desk` write surface. Independent user-reserved boolean orthogonal
// to both `status` and `pinned`. Same one-shot request / fresh-list response
// convention — server patches bounty.json in place (folder NOT moved) and
// returns both bounty lists so the modal atomically re-renders.
export type IdentityUpdateBountyNeedsDeskPayload = {
  type: "identity:update-bounty-needs-desk";
  identityKey: string;
  hostId: number;
  bountySlug: string;
  needs_desk: boolean;
};
export type IdentityBountyNeedsDeskUpdatedEvent = {
  type: "identity:bounty-needs-desk-updated";
  bounties: Bounty[];
  archivedBounties: Bounty[];
  error?: string;
};

// Phase 18 / IDMEDIT-04: partial-JSON-patch write surface for bounty fields.
//
// Partial patch semantics (not full-object replacement): only the keys present
// in the `patch` object are written; unmentioned fields are untouched. This
// avoids races with server-owned fields (updated_at, timeline) that the client
// never holds a complete view of.
//
// Server-side behavior (writeIdentityBountyFields in identity-artifact-reader.ts):
//   - changedFields enumerated from patch's own keys (id/created_at/updated_at/
//     timeline/pinned/requested_by are never writable via this handler)
//   - updated_at bumped unconditionally to new Date().toISOString()
//   - One timeline entry appended per changed field key:
//     `${nowIso} ${field} updated via identity modal`
//   - Byte-cap: IDMEDIT_MAX_BOUNTY_JSON_BYTES = 100_000 before write
//   - pinned explicitly rejected (use identity:update-bounty-pinned instead)
//
// `meeting_questions` writes are accepted from any authenticated WS caller;
// user-only-authored semantics are a UI convention, not wire enforcement
// (IDMEDIT-08 semantics locked in SCRATCH-REPORT.md).
export type BountyFieldsPatch = {
  title?: string;
  premise?: string;
  todos?: { text: string; done: boolean }[];
  keywords?: string[];
  source_links?: string[];
  deadline?: string | null;
  meeting_questions?: { text: string; answered: boolean }[];
};

export type IdentityUpdateBountyFieldsPayload = {
  type: "identity:update-bounty-fields";
  identityKey: string;
  hostId: number;
  bountySlug: string;
  /** Partial JSON patch — only fields present are written; unmentioned fields untouched. */
  patch: BountyFieldsPatch;
};

export type IdentityBountyFieldsUpdatedEvent = {
  type: "identity:bounty-fields-updated";
  bounties: Bounty[];         // fresh open list — rehydrate BountyCard from server truth
  archivedBounties: Bounty[]; // fresh archive list
  error?: string;
};

// Quick 260727-wd0: archive is a one-way write surface. Server decides the
// new status internally (flip live→done, preserve done/dropped) — payload
// has no client-supplied status field. Same one-shot request / fresh-list
// response convention; the writer atomically patches bounty.json in place
// at the CURRENT path, then mv's bounties/<slug>/ under bounties/archive/
// <slug>/ (mkdir -p archive/ if absent). See PLAN's locked semantics.
export type IdentityArchiveBountyPayload = {
  type: "identity:archive-bounty";
  identityKey: string;
  hostId: number;
  bountySlug: string;
};
export type IdentityBountyArchivedEvent = {
  type: "identity:bounty-archived";
  bounties: Bounty[];
  archivedBounties: Bounty[];
  error?: string;
};

// Quick 260729-g5r: delete is a hard rm -rf of the bounty folder. Applies
// to BOTH open and archived cards (contrast with archive which only applies
// to open). Server returns fresh {bounties, archivedBounties} so the modal
// atomically re-renders and the deleted card unmounts naturally when its
// slug drops out of both lists. window.confirm() gate lives in BountyCard,
// not here.
export type IdentityDeleteBountyPayload = {
  type: "identity:delete-bounty";
  identityKey: string;
  hostId: number;
  bountySlug: string;
};
export type IdentityBountyDeletedEvent = {
  type: "identity:bounty-deleted";
  bounties: Bounty[];
  archivedBounties: Bounty[];
  error?: string;
};

// ─── Quick 260727-tb1 / Phase 26: batched bounty counts (pinned + needs-desk) ─
//
// Piggybacks on the patch #92 identity-artifact reader to power the per-row
// bounty badge in pretty-conversations. ONE WS request carrying every visible
// identity's (identityKey, hostId), ONE response with per-target counts.
// Response uses Promise.allSettled server-side so one dead SSH host cannot
// block the batch — dead-host entries carry {pinnedCount: 0, needsDeskCount: 0, error: string}
// while other targets still return live counts.
//
// Phase 26 widening: per-target results carry BOTH pinnedCount and needsDeskCount
// from the same single fs walk (no double backend IO).
//
//   client -> server:
//     { type: "identity:count-bounties", targets: [{identityKey, hostId}, ...] }
//
//   server -> client:
//     { type: "identity:bounty-counts", counts: [{identityKey, hostId, pinnedCount, needsDeskCount, error?}, ...] }
//
// hostId=null means "read from skynet-ec2 local bind-mount" (patch #92 D-4).

export type BountyCountTarget = {
  identityKey: string;
  hostId: number | null;
};

export type IdentityCountBountiesPayload = {
  type: "identity:count-bounties";
  targets: BountyCountTarget[];
};

export type BountyCountResult = {
  identityKey: string;
  hostId: number | null;
  pinnedCount: number;
  needsDeskCount: number;
  error?: string;
};

export type IdentityBountyCountsEvent = {
  type: "identity:bounty-counts";
  counts: BountyCountResult[];
};

/**
 * Fire a one-shot batched bounty count request. Opens its own WS, sends one
 * identity:count-bounties frame on open, resolves on the first matching
 * identity:bounty-counts response, then closes the socket. Follows the same
 * one-shot request/response pattern IdentityModal uses for
 * identity:list-bounties.
 *
 * Phase 26: per-target results carry BOTH pinnedCount and needsDeskCount —
 * the server computes both on a single fs walk (single-walk invariant).
 *
 * Rejects on onerror / onclose-before-response with "Connection failed" so
 * callers can distinguish transport failures from per-target errors (the
 * latter surface in individual counts[i].error fields).
 */
export function countIdentityBounties(
  targets: BountyCountTarget[],
): Promise<IdentityBountyCountsEvent> {
  return new Promise((resolve, reject) => {
    let responded = false;
    const sock = openClaudeSessionSocket();
    sock.onopen = () => {
      const payload: IdentityCountBountiesPayload = {
        type: "identity:count-bounties",
        targets,
      };
      try {
        sock.send(JSON.stringify(payload));
      } catch {
        /* ws may be mid-close */
      }
    };
    sock.onmessage = (event: MessageEvent<string>) => {
      if (responded) return;
      try {
        const raw = JSON.parse(event.data) as { type?: string };
        if (raw.type !== "identity:bounty-counts") return; // ignore unrelated frames
        responded = true;
        resolve(raw as IdentityBountyCountsEvent);
        try {
          sock.close();
        } catch {
          /* ignore */
        }
      } catch {
        /* ignore parse errors — wait for a valid frame */
      }
    };
    const handleFail = () => {
      if (responded) return;
      responded = true;
      reject(new Error("Connection failed"));
    };
    sock.onerror = handleFail;
    sock.onclose = () => {
      if (!responded) handleFail();
    };
  });
}
