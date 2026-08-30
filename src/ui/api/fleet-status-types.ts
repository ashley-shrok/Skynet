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
  // Phase 52 Plan 01 Task 3 — source B (dormant-only identity frames with no
  // live claude process) publishes pid:null. Backend wire schema is
  // z.number().int().nullable(); mirror was missed at Phase 52 and surfaced
  // by Phase 59 unbiased review.
  pid: number | null;
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
  // Phase 59 Plan 01 (WIP-shell-idle-gate 2026-08-29): the two axes that
  // back the WIP-shell-idle-gate predicate. Together they let the frontend
  // decide whether a `shell` status is real mid-turn work or leftover stale
  // state from a completed turn that the harness never rewrote back to idle.
  //
  // `lastStopAt`: unix millis derived UNCONDITIONALLY from the mtime of
  // `~/.claude/fleet-status/stop-<sessionId>.json` on the target host (a
  // per-session file written by the additive Stop hook — separate from the
  // box-wide `last-stop-payload.json` which continues to carry
  // background-tasks for the box-wide consumer path).
  //
  // `lastStatusChangeAt`: unix millis of the most recent poll tick where
  // `sessionJson.status` transitioned to a different value — derived
  // SERVER-SIDE by comparing this-tick status to the previous-tick cached
  // status. NOT sourced from `sessionJson.updatedAt` (which the harness
  // bumps on compose-box typing without a real state transition).
  //
  // Semantics for BOTH fields:
  //   `number` = value present; `null` = normalised-null in transit (backend
  //   may emit when it cannot distinguish); `undefined` = emitting backend
  //   pre-dates Phase 59. Frontend treats undefined and null identically at
  //   the session-working-store boundary — a no-signal `lastStopAt` triggers
  //   the default-on rollout-safety branch of the shell-idle-gate predicate.
  //
  // Mirrors backend `SessionStateSchema.lastStopAt` and
  // `SessionStateSchema.lastStatusChangeAt`. MUST stay in lockstep with the
  // backend schema.
  lastStopAt?: number | null;
  lastStatusChangeAt?: number | null;
  // Phase 62 Plan 04 (WIP hook-based rewrite 2026-08-30): mirror of
  // wire-protocol.ts SessionStateSchema.activityMtime +
  // SessionStateSchema.stoppedMtime (added by Plan 62-03 Task 1 as
  // `z.number().nullable().optional()` — sixth iteration of the
  // T-41-03-05 additive-optional discipline holding FRAME_SCHEMA_VERSION at 1).
  //
  // Source: per-session marker files touched by the Plan 62-01 hook scripts,
  // installed onto managed boxes via Plan 62-02:
  //   - `activityMtime` bumps on `UserPromptSubmit` (Ashley submitted a prompt)
  //     and `PreToolUse` (agent began invoking a tool) via activity-hook.sh.
  //   - `stoppedMtime` bumps on `Stop` (turn finished cleanly), `StopFailure`
  //     (turn ended in error), and `PermissionRequest` (agent blocked waiting on
  //     Ashley for a permission decision — same as done from the affordance's
  //     perspective per CONTEXT.md §Philosophy) via stopped-hook.sh.
  //
  // Consumed by session-working-store's new direct-signal predicate branch
  // (Plan 62-04 Task 2), which computes:
  //   `activityMtime > stoppedMtime` → isWorking = true; else → false.
  // No state machine, no smoothing, no shell-idle gate — just one comparison.
  //
  // Semantics (both fields):
  //   `number`    = mtime present (unix millis).
  //   `null`      = marker file absent OR SSH-hiccup normalised-null. BOTH
  //                 cases trigger the session-working-store's fallback to the
  //                 retained Phase 59 shell-idle-gate predicate (Option-1
  //                 rollout: unupgraded boxes see zero behavior change).
  //   `undefined` = emitting backend pre-dates Phase 62. Frontend treats
  //                 undefined and null identically at the store boundary
  //                 (same convention as Phase 59 lastStopAt).
  //
  // Mirrors backend `SessionStateSchema.activityMtime` and
  // `SessionStateSchema.stoppedMtime`. MUST stay in lockstep with the backend
  // schema — any change to wire-protocol.ts MUST be mirrored here.
  activityMtime?: number | null;
  stoppedMtime?: number | null;
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
