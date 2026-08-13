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
