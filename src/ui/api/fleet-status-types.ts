/**
 * fleet-status-types.ts — browser-side mirror of the Plan 02 wire protocol.
 *
 * These types are intentionally DUPLICATED from src/backend/fleet-status/wire-protocol.ts
 * rather than imported from it. The frontend treats the wire protocol as its
 * own contract; reaching into src/backend/ from src/ui/ would break the build
 * boundary and the tsconfig alias isolation.
 *
 * CONSTRAINT: Field names and discriminants must match wire-protocol.ts EXACTLY.
 * Any change to the backend wire-protocol MUST be mirrored here.
 *
 * The backend validates outbound frames via zod before sending them.
 * The browser trusts frame contents but wraps JSON.parse in try/catch
 * (T-34-18 mitigate — malformed frames logged + dropped, connection stays open).
 * No zod on the browser side — avoids a 10KB+ bundle cost for a validation
 * layer the backend already provides.
 */

// ---------------------------------------------------------------------------
// Schema version — must match FRAME_SCHEMA_VERSION in wire-protocol.ts
// ---------------------------------------------------------------------------

export const FRAME_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// BackgroundTask — mirrors Stop hook background_tasks[] entry
// ---------------------------------------------------------------------------

interface BackgroundTaskBase {
  id: string;
  status: string;
  description?: string;
}

export interface ShellTask extends BackgroundTaskBase {
  type: "shell";
  command?: string;
}

export interface SubagentTask extends BackgroundTaskBase {
  type: "subagent";
  agent_type?: string;
}

export interface MonitorTask extends BackgroundTaskBase {
  type: "monitor";
  server?: string;
  tool?: string;
}

export interface WorkflowTask extends BackgroundTaskBase {
  type: "workflow";
  name?: string;
}

export interface TeammateTask extends BackgroundTaskBase {
  type: "teammate";
}

export interface CloudSessionTask extends BackgroundTaskBase {
  type: "cloud session";
}

export interface McpTask extends BackgroundTaskBase {
  type: "MCP task";
  server?: string;
  tool?: string;
}

export interface UnknownTask extends BackgroundTaskBase {
  type: string;
}

export type BackgroundTask =
  | ShellTask
  | SubagentTask
  | MonitorTask
  | WorkflowTask
  | TeammateTask
  | CloudSessionTask
  | McpTask
  | UnknownTask;

// ---------------------------------------------------------------------------
// SessionState — published state for a (host, tmuxSession)
// ---------------------------------------------------------------------------

export interface SessionState {
  hostId: string;
  tmuxSession: string | null;
  sessionId: string;
  pid: number;
  status: "busy" | "shell" | "idle" | "waiting";
  waitingFor?: string;
  backgroundTasks: BackgroundTask[];
  updatedAt: number;
  // Phase 41 Plan 03 (2026-08-15): the "message either direction" recency
  // signal. Mirrors the backend `SessionStateSchema.lastMessageAt` field
  // (wire-protocol.ts) — carries unix millis of the newest message-bearing
  // JSONL frame (user OR assistant, ignoring tool_use / thinking / lifecycle
  // events). `null` = session has no message-bearing history known;
  // `undefined` = emitting watcher pre-dates Phase 41 Plan 03. Both are
  // treated identically by session-working-store (both cache as null) and
  // both cause the row's compareByRecencyDesc branch to sort no-history-to-top
  // per Ashley's lock. MUST stay in lockstep with the backend schema.
  lastMessageAt?: number | null;
  // Phase 47 Plan 01 (2026-08-20): the inline current-work hint carried
  // from the harness-produced ai-title JSONL line
  // (`{"type":"ai-title","aiTitle":"…","sessionId":"…"}` — see Phase 47
  // CONTEXT.md § domain). Mirrors the backend `SessionStateSchema.aiTitle`
  // field (wire-protocol.ts) — carries the LAST-emitted ai-title string
  // for this session. `null` = session has no ai-title yet (fresh session,
  // or empty/malformed JSONL); `undefined` = emitting watcher pre-dates
  // Phase 47 Plan 01. The frontend consumer treats undefined and null
  // IDENTICALLY (both → working-store cache holds null → row subtitle
  // renders the fallback ellipsis per the LOCKED v14 design). MUST stay
  // in lockstep with the backend schema.
  aiTitle?: string | null;
  // Phase 52 (mirror gap-closure per Phase 53 Plan 02 Task 1): the inline
  // supervisor-dormancy signal. Source: the
  // ~/.claude/identities/<tmuxSession>/.dormant sentinel file on the target
  // host. Semantics: `true` = sentinel present (identity parked by
  // supervisor), `false` = sentinel absent (normal operation), `null` =
  // normalised-null in transit (SSH error), `undefined` = emitting backend
  // pre-dates Phase 52. Frontend treats undefined and null identically (both
  // → false at the session-working-store boundary). Mirrors backend
  // `SessionStateSchema.dormant`. Added only now (Phase 53 Plan 02) because
  // the field was previously undocumented on the browser mirror —
  // tsconfig.app.json's `strict: false` allowed the omission to compile
  // silently; adding it now gives future readers a canonical browser-side
  // type. MUST stay in lockstep with the backend schema.
  dormant?: boolean | null;
  // Phase 53 Plan 02 (2026-08-21): the backend-authoritative recycling signal.
  // Source: the caretaker's ~/.claude/identities/<tmuxSession>/.recycled-at
  // sentinel file on the target host — renamed from `.recycle-requested` at
  // recycle-intent detection (before the outgoing claude PID exits), removed
  // with an 8s delay after the fresh claude is up and driven through `/id`.
  // Scope is EXCLUSIVELY /id-reset-initiated identity replacement — NOT
  // memory-cap restarts, NOT dormancy-wake, NOT connection drops. Semantics:
  // `true` = sentinel present (recycle in flight), `false` = sentinel absent
  // (any other state), `null` = normalised-null in transit (SSH error),
  // `undefined` = emitting backend pre-dates Phase 53. Frontend treats
  // undefined and null identically (both → false at the session-working-store
  // boundary — see session-working-store.ts Axis E block added in Task 2
  // below). Mirrors backend `SessionStateSchema.recycling`. MUST stay in
  // lockstep with the backend schema.
  recycling?: boolean | null;
}

// ---------------------------------------------------------------------------
// FrontendInboundFrame — frames sent FROM frontend client TO backend
// ---------------------------------------------------------------------------

export interface FrontendSubscribeFrame {
  schemaVersion: typeof FRAME_SCHEMA_VERSION;
  type: "subscribe";
}

export interface FrontendPingFrame {
  schemaVersion: typeof FRAME_SCHEMA_VERSION;
  type: "ping";
}

export type FrontendInboundFrame = FrontendSubscribeFrame | FrontendPingFrame;

// ---------------------------------------------------------------------------
// FrontendOutboundFrame — frames sent FROM backend TO frontend clients
// ---------------------------------------------------------------------------

export interface FrontendSnapshotFrame {
  schemaVersion: typeof FRAME_SCHEMA_VERSION;
  type: "snapshot";
  states: SessionState[];
}

export interface FrontendUpdateFrame {
  schemaVersion: typeof FRAME_SCHEMA_VERSION;
  type: "update";
  state: SessionState;
}

export interface FrontendGoneFrame {
  schemaVersion: typeof FRAME_SCHEMA_VERSION;
  type: "gone";
  hostId: string;
  tmuxSession: string | null;
  sessionId: string;
}

export interface FrontendPongFrame {
  schemaVersion: typeof FRAME_SCHEMA_VERSION;
  type: "pong";
}

export type FrontendOutboundFrame =
  | FrontendSnapshotFrame
  | FrontendUpdateFrame
  | FrontendGoneFrame
  | FrontendPongFrame;
