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

// ---------------------------------------------------------------------------
// Phase 47 Plan 01 (2026-08-20): added `aiTitle` as an OPTIONAL, NULLABLE
// string field carrying the harness-produced current-work hint for a session.
// Source: the LAST JSONL line matching `{"type":"ai-title","aiTitle":"…",
// "sessionId":"…"}` in the session's `.claude/projects/<hash>/<uuid>.jsonl`,
// discovered via the same Phase 32 `discoverIdentitySessionFile` flow the
// lastMessageAt scan uses (see Phase 47 CONTEXT.md § domain). Semantics:
//   - string  → the current ai-title from the session harness (evolves
//               across turns — the LAST line wins).
//   - null    → session has no ai-title yet (fresh session pre-harness-write,
//               or empty JSONL, or malformed line).
//   - undefined → emitting watcher pre-dates Phase 47 Plan 01; the frontend
//               consumer treats undefined and null identically (both flow
//               into the working-store as null → row subtitle renders the
//               fallback ellipsis per the LOCKED v14 design).
// Reconciliation rule at the working-store is LAST-WINS (not max-wins like
// lastMessageAt) — ai-titles evolve as the topic drifts (CONTEXT.md § working-
// store third axis). This schema is purely the wire; reconciliation lives
// downstream in Plan 47-03.
// Because the field is `.optional().nullable()`, FRAME_SCHEMA_VERSION is
// deliberately HELD AT 1 — additive+optional extensions never require a
// version bump (same T-41-03-05 mitigation invariant that Phase 41 Plan 03
// established for lastMessageAt).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase 52 Plan 01 (2026-08-20): added `dormant` as an OPTIONAL, NULLABLE
// boolean field carrying the inline supervisor-dormancy signal for a session.
// Source: the `~/.claude/identities/<tmuxSession>/.dormant` sentinel file on
// the target host. Presence of the sentinel ⇔ identity is dormant
// (supervisor-managed pause). Semantics:
//   - true      → sentinel file present; the identity has been parked by the
//                 supervisor and has no live claude process.
//   - false     → sentinel file absent; the identity is in normal operation.
//   - null      → normalised-null in transit (backend may emit null when it
//                 cannot distinguish true/false due to SSH error — treated as
//                 false by the frontend per the AND-of-negations Ready predicate).
//   - undefined → emitting watcher pre-dates Phase 52 Plan 01; frontend
//                 treats undefined and null identically (both → false).
// This field is published by TWO sources in ssh-poll-orchestrator:
//   Source A: per-PID tick — stats the sentinel for live-PID identities.
//   Source B: per-host tick — enumerates ~/.claude/identities/*/ and stats
//             each sentinel for dormant-only identities with no live PID.
// Because the field is `.optional().nullable()`, FRAME_SCHEMA_VERSION is
// deliberately HELD AT 1 — additive+optional extensions never require a
// version bump (same T-41-03-05 mitigation invariant established for
// lastMessageAt and inherited by aiTitle).
//
// Phase 52 Plan 01 Task 3 relaxes `pid` to z.number().int().nullable() so
// source B (dormant-only identities with no live claude process) can publish
// frames with pid:null. Source A still publishes numeric PIDs. Frontend
// consumers treat pid as opaque (Plan 03 only reads dormant + isWorking).
// ---------------------------------------------------------------------------

export const SessionStateSchema = z.object({
  hostId: z.string(),
  tmuxSession: z.string().nullable(),
  sessionId: z.string(),
  // Phase 52 Plan 01 Task 3 — relaxed from z.number() to z.number().int().nullable()
  // so source B (dormant-only identity frames with no live claude process) can
  // publish pid:null. Source A still publishes numeric PIDs from /proc enumeration.
  pid: z.number().int().nullable(),
  status: z.enum(["busy", "shell", "idle", "waiting"]),
  waitingFor: z.string().optional(),
  backgroundTasks: z.array(BackgroundTaskSchema),
  updatedAt: z.number(),
  // Phase 41 Plan 03 — recency signal (see block comment above).
  lastMessageAt: z.number().nullable().optional(),
  // Phase 47 Plan 01 — inline current-work hint (see block comment above).
  aiTitle: z.string().nullable().optional(),
  // Phase 52 Plan 01 — inline supervisor-dormancy signal (see block comment above).
  dormant: z.boolean().nullable().optional(),
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
