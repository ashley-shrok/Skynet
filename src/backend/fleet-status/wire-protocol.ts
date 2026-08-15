/**
 * Fleet-status wire protocol — versioned zod schemas for every frame shape
 * the fleet-status channel carries (frontend↔backend AND watcher↔backend).
 *
 * schemaVersion is stamped on every frame so future changes can be gated
 * without breaking already-deployed watchers on managed boxes.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

export const FRAME_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// BackgroundTask — mirrors Stop hook background_tasks[] entry (RESEARCH §1)
// ---------------------------------------------------------------------------

const BackgroundTaskBaseSchema = z.object({
  id: z.string(),
  status: z.string(),
  description: z.string().optional(),
});

const ShellTaskSchema = BackgroundTaskBaseSchema.extend({
  type: z.literal("shell"),
  command: z.string().optional(),
});

const SubagentTaskSchema = BackgroundTaskBaseSchema.extend({
  type: z.literal("subagent"),
  agent_type: z.string().optional(),
});

const MonitorTaskSchema = BackgroundTaskBaseSchema.extend({
  type: z.literal("monitor"),
  server: z.string().optional(),
  tool: z.string().optional(),
});

const WorkflowTaskSchema = BackgroundTaskBaseSchema.extend({
  type: z.literal("workflow"),
  name: z.string().optional(),
});

const TeammateTaskSchema = BackgroundTaskBaseSchema.extend({
  type: z.literal("teammate"),
});

const CloudSessionTaskSchema = BackgroundTaskBaseSchema.extend({
  type: z.literal("cloud session"),
});

const McpTaskSchema = BackgroundTaskBaseSchema.extend({
  type: z.literal("MCP task"),
  server: z.string().optional(),
  tool: z.string().optional(),
});

// Fallback for unknown task types
const UnknownTaskSchema = BackgroundTaskBaseSchema.extend({
  type: z.string(),
});

export const BackgroundTaskSchema = z.union([
  ShellTaskSchema,
  SubagentTaskSchema,
  MonitorTaskSchema,
  WorkflowTaskSchema,
  TeammateTaskSchema,
  CloudSessionTaskSchema,
  McpTaskSchema,
  UnknownTaskSchema,
]);

export type BackgroundTask = z.infer<typeof BackgroundTaskSchema>;

// ---------------------------------------------------------------------------
// SessionState — mirrors the watcher's published state for a (host, tmuxSession)
//
// Phase 41 Plan 03 (2026-08-15): added `lastMessageAt` as an OPTIONAL,
// NULLABLE numeric field carrying the unix-millis timestamp of the newest
// message-bearing frame in the underlying session JSONL, EITHER DIRECTION
// (user-sent OR assistant-sent). Tool-use, thinking blocks, streaming ticks,
// lifecycle events, and background-task starts/stops do NOT contribute to
// this signal — the recency signal is edge-triggered ONLY on messages either
// direction (Ashley 2026-08-14 lock: "activity = message either direction,
// and only that"). Semantics:
//   - number (unix millis) → newest message-bearing frame timestamp.
//   - null                → no message-bearing history known for this session.
//   - undefined           → emitting watcher pre-dates Phase 41 Plan 03; the
//                           frontend consumer treats undefined and null
//                           identically (both flip the row to the top of the
//                           middle zone per Ashley's no-history-to-top rule).
// Because the field is `.optional().nullable()`, FRAME_SCHEMA_VERSION is
// deliberately HELD AT 1 — additive+optional extensions never require a
// version bump (T-41-03-05 mitigation). If a future breaking change lands,
// THAT change bumps the version.
// ---------------------------------------------------------------------------

export const SessionStateSchema = z.object({
  hostId: z.string(),
  tmuxSession: z.string().nullable(),
  sessionId: z.string(),
  pid: z.number(),
  status: z.enum(["busy", "shell", "idle", "waiting"]),
  waitingFor: z.string().optional(),
  backgroundTasks: z.array(BackgroundTaskSchema),
  updatedAt: z.number(),
  // Phase 41 Plan 03 — recency signal (see block comment above).
  lastMessageAt: z.number().nullable().optional(),
});

export type SessionState = z.infer<typeof SessionStateSchema>;

// ---------------------------------------------------------------------------
// WatcherInboundFrame — frames sent FROM watcher TO backend
// ---------------------------------------------------------------------------

const WatcherHelloFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  type: z.literal("hello"),
  hostname: z.string(),
});

const WatcherSessionStateFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  type: z.literal("session_state"),
  state: SessionStateSchema,
});

const WatcherSessionGoneFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  type: z.literal("session_gone"),
  tmuxSession: z.string().nullable(),
  sessionId: z.string(),
});

export const WatcherInboundFrame = z.discriminatedUnion("type", [
  WatcherHelloFrameSchema,
  WatcherSessionStateFrameSchema,
  WatcherSessionGoneFrameSchema,
]);

export type WatcherInboundFrameType = z.infer<typeof WatcherInboundFrame>;

// ---------------------------------------------------------------------------
// FrontendInboundFrame — frames sent FROM frontend client TO backend
// ---------------------------------------------------------------------------

const FrontendSubscribeFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  type: z.literal("subscribe"),
});

const FrontendPingFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  type: z.literal("ping"),
});

export const FrontendInboundFrame = z.discriminatedUnion("type", [
  FrontendSubscribeFrameSchema,
  FrontendPingFrameSchema,
]);

export type FrontendInboundFrameType = z.infer<typeof FrontendInboundFrame>;

// ---------------------------------------------------------------------------
// FrontendOutboundFrame — frames sent FROM backend TO frontend clients
// ---------------------------------------------------------------------------

const FrontendSnapshotFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  type: z.literal("snapshot"),
  states: z.array(SessionStateSchema),
});

const FrontendUpdateFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  type: z.literal("update"),
  state: SessionStateSchema,
});

const FrontendGoneFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  type: z.literal("gone"),
  hostId: z.string(),
  tmuxSession: z.string().nullable(),
  sessionId: z.string(),
});

const FrontendPongFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  type: z.literal("pong"),
});

export const FrontendOutboundFrame = z.discriminatedUnion("type", [
  FrontendSnapshotFrameSchema,
  FrontendUpdateFrameSchema,
  FrontendGoneFrameSchema,
  FrontendPongFrameSchema,
]);

export type FrontendOutboundFrameType = z.infer<typeof FrontendOutboundFrame>;

// ---------------------------------------------------------------------------
// Helper: build outbound frames with schemaVersion stamped automatically
// ---------------------------------------------------------------------------

export function makeSnapshotFrame(
  states: SessionState[],
): FrontendOutboundFrameType {
  return { schemaVersion: FRAME_SCHEMA_VERSION, type: "snapshot", states };
}

export function makeUpdateFrame(state: SessionState): FrontendOutboundFrameType {
  return { schemaVersion: FRAME_SCHEMA_VERSION, type: "update", state };
}

export function makeGoneFrame(
  hostId: string,
  tmuxSession: string | null,
  sessionId: string,
): FrontendOutboundFrameType {
  return {
    schemaVersion: FRAME_SCHEMA_VERSION,
    type: "gone",
    hostId,
    tmuxSession,
    sessionId,
  };
}

export function makePongFrame(): FrontendOutboundFrameType {
  return { schemaVersion: FRAME_SCHEMA_VERSION, type: "pong" };
}
