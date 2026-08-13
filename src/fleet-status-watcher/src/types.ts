/**
 * Shared types for the fleet-status watcher pipeline.
 *
 * SessionJson       - wire shape of ~/.claude/sessions/<pid>.json (v2.1.150 schema)
 * BackgroundTask    - discriminated union from Stop hook background_tasks[] entries
 * StopHookPayload   - complete Stop hook payload shape
 * SessionState      - outbound shape emitted by the watcher to stdout / WS transport
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// SessionJson — ~/.claude/sessions/<pid>.json (Claude Code v2.1.119+)
// ---------------------------------------------------------------------------

export const SessionJsonSchema = z.object({
  pid: z.number().int().positive(),
  sessionId: z.string().min(1),
  cwd: z.string().min(1),
  startedAt: z.number(),
  procStart: z.string().min(1),
  version: z.string().min(1),
  status: z.enum(["busy", "shell", "idle", "waiting"]),
  updatedAt: z.number(),
  // Optional fields
  waitingFor: z.string().optional(),
  peerProtocol: z.number().optional(),
  kind: z.string().optional(),
  entrypoint: z.string().optional(),
  bridgeSessionId: z.string().optional(),
});

export type SessionJson = z.infer<typeof SessionJsonSchema>;

// ---------------------------------------------------------------------------
// BackgroundTask — discriminated union on `type` per Stop hook field table
// ---------------------------------------------------------------------------

/** Base fields present on ALL background task types */
const BackgroundTaskBase = z.object({
  id: z.string(),
  status: z.string(),
  description: z.string().optional(),
});

export const ShellTaskSchema = BackgroundTaskBase.extend({
  type: z.literal("shell"),
  command: z.string().optional(),
});

export const SubagentTaskSchema = BackgroundTaskBase.extend({
  type: z.literal("subagent"),
  agent_type: z.string().optional(),
});

export const MonitorTaskSchema = BackgroundTaskBase.extend({
  type: z.literal("monitor"),
  server: z.string().optional(),
  tool: z.string().optional(),
});

export const WorkflowTaskSchema = BackgroundTaskBase.extend({
  type: z.literal("workflow"),
  name: z.string().optional(),
});

export const TeammateTaskSchema = BackgroundTaskBase.extend({
  type: z.literal("teammate"),
});

export const CloudSessionTaskSchema = BackgroundTaskBase.extend({
  type: z.literal("cloud session"),
});

export const McpTaskSchema = BackgroundTaskBase.extend({
  type: z.literal("MCP task"),
  server: z.string().optional(),
  tool: z.string().optional(),
});

export const BackgroundTaskSchema = z.discriminatedUnion("type", [
  ShellTaskSchema,
  SubagentTaskSchema,
  MonitorTaskSchema,
  WorkflowTaskSchema,
  TeammateTaskSchema,
  CloudSessionTaskSchema,
  McpTaskSchema,
]);

export type ShellTask = z.infer<typeof ShellTaskSchema>;
export type SubagentTask = z.infer<typeof SubagentTaskSchema>;
export type MonitorTask = z.infer<typeof MonitorTaskSchema>;
export type WorkflowTask = z.infer<typeof WorkflowTaskSchema>;
export type TeammateTask = z.infer<typeof TeammateTaskSchema>;
export type CloudSessionTask = z.infer<typeof CloudSessionTaskSchema>;
export type McpTask = z.infer<typeof McpTaskSchema>;
export type BackgroundTask = z.infer<typeof BackgroundTaskSchema>;

// ---------------------------------------------------------------------------
// StopHookPayload — complete Stop hook event sent via Unix socket
// ---------------------------------------------------------------------------

export const StopHookPayloadSchema = z.object({
  session_id: z.string(),
  transcript_path: z.string(),
  cwd: z.string(),
  permission_mode: z.string(),
  hook_event_name: z.string(),
  stop_hook_active: z.boolean(),
  last_assistant_message: z.string().optional(),
  background_tasks: z.array(z.unknown()).default([]),
});

export type StopHookPayload = z.infer<typeof StopHookPayloadSchema>;

// ---------------------------------------------------------------------------
// SessionState — outbound shape emitted to stdout / WS transport
// ---------------------------------------------------------------------------

export type SessionState = {
  /** Hostname of the box this session lives on */
  hostId: string;
  /** tmux session name (e.g. "tina", "tanya") — null if outside tmux */
  tmuxSession: string | null;
  /** Claude Code session UUID */
  sessionId: string;
  /** OS process ID */
  pid: number;
  /** Current harness status */
  status: "busy" | "shell" | "idle" | "waiting";
  /** Waiting reason — only present when status === "waiting" */
  waitingFor?: string;
  /** Non-ambient background tasks from last Stop hook payload */
  backgroundTasks: BackgroundTask[];
  /** Millisecond timestamp of last session JSON update */
  updatedAt: number;
};
