/**
 * Fleet-status harness payload types — INBOUND-from-harness shapes.
 *
 * This file defines the shapes of JSON documents authored by the Claude Code
 * harness (on identity-hosting boxes) that the Skynet backend parses after
 * reading them over SSH:
 *
 *   - SessionJson:      `~/.claude/sessions/<pid>.json` — per-PID status file
 *                       updated by the harness continuously (status, waitingFor,
 *                       procStart, etc.). Primary signal for working state.
 *
 *   - StopHookPayload: the Stop hook payload delivered via stdin to the
 *                      fleet-status Stop hook script. Carries background_tasks[]
 *                      so the backend can compute `hasBgWork` for sessions that
 *                      are nominally idle but have background Monitors running.
 *
 * HOW THIS RELATES TO wire-protocol.ts:
 *   - wire-protocol.ts defines the OUTBOUND (Skynet→frontend) wire frame shape.
 *   - types.ts (this file) defines the INBOUND (harness→Skynet) raw payload shapes.
 *   - BackgroundTaskSchema is RE-IMPORTED from wire-protocol.ts (not redefined) so
 *     the parse layer and wire layer share a single source of truth for the
 *     discriminated union. Plan 04's ssh-poll-orchestrator imports both freely.
 *
 * USAGE (Plan 04):
 *   const session = parseSessionJson(rawString);    // null on failure; safe to call without try/catch
 *   const payload = parseStopHookPayload(rawString); // null on failure; safe to call without try/catch
 *
 * SCHEMA VERSION: v2.1.150 (verified live; stable since v2.1.119 per RESEARCH §3).
 */
import { z } from "zod";
import { systemLogger } from "../utils/logger.js";
import {
  BackgroundTaskSchema,
  type BackgroundTask,
} from "./wire-protocol.js";

// Re-export for Plan 04 convenience — single source of truth lives in wire-protocol.ts
export { BackgroundTaskSchema };
export type { BackgroundTask };

// ---------------------------------------------------------------------------
// SessionJson — harness-authored ~/.claude/sessions/<pid>.json
// ---------------------------------------------------------------------------

/**
 * Zod schema for the session JSON file written by Claude Code v2.1.150.
 * Required fields match every verified live sample (RESEARCH §3).
 * Optional fields appear on some boxes or some harness configurations only.
 */
export const SessionJsonSchema = z.object({
  // --- Required fields ---
  pid: z.number(),
  sessionId: z.string().min(1),
  cwd: z.string(),
  startedAt: z.number(),
  /** /proc/<pid>/stat field 22 (starttime in jiffies since boot) as a decimal string */
  procStart: z.string().min(1),
  version: z.string(),
  status: z.enum(["busy", "shell", "idle", "waiting"]),
  updatedAt: z.number(),

  // --- Optional fields ---
  /** Present only when status === "waiting"; reason string from harness */
  waitingFor: z.string().optional(),
  /** Present on some boxes using Claude Code network bridge/team mode */
  bridgeSessionId: z.string().optional(),
  /** e.g. "interactive" — harness launch mode */
  kind: z.string().optional(),
  /** e.g. "cli" — harness entrypoint */
  entrypoint: z.string().optional(),
  /** Peer-protocol version integer */
  peerProtocol: z.number().optional(),
});

export type SessionJson = z.infer<typeof SessionJsonSchema>;

// ---------------------------------------------------------------------------
// StopHookPayload — Stop hook stdin payload (Claude Code v2.1.150)
// ---------------------------------------------------------------------------

/**
 * Zod schema for the Stop hook payload delivered by the harness.
 * Top-level fields per official Claude Code hooks docs (RESEARCH §1).
 * background_tasks[] reuses BackgroundTaskSchema from wire-protocol.ts.
 */
export const StopHookPayloadSchema = z.object({
  // --- Required fields ---
  session_id: z.string(),
  transcript_path: z.string(),
  cwd: z.string(),
  permission_mode: z.string(),
  hook_event_name: z.literal("Stop"),
  stop_hook_active: z.boolean(),
  background_tasks: z.array(BackgroundTaskSchema),

  // --- Optional fields ---
  last_assistant_message: z.string().optional(),
  session_crons: z.array(z.unknown()).optional(),
});

export type StopHookPayload = z.infer<typeof StopHookPayloadSchema>;

// ---------------------------------------------------------------------------
// Safe-parse helpers — always log on failure, safe to call without try/catch
// ---------------------------------------------------------------------------

/**
 * Parse a raw JSON string as a SessionJson.
 *
 * Returns the typed SessionJson on success, null on any failure.
 * Logs a structured WARN (never ERROR — parse failures are expected for
 * corrupt/partial writes) with an `operation` field for grep-ability.
 * NEVER propagates exceptions — the caller does not need a try/catch.
 */
export function parseSessionJson(raw: string): SessionJson | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    systemLogger.warn("Fleet-status: failed to parse session JSON string", {
      operation: "fleet_status_session_json_parse_failed",
      error: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }

  const result = SessionJsonSchema.safeParse(parsed);
  if (!result.success) {
    systemLogger.warn(
      "Fleet-status: session JSON failed schema validation",
      {
        operation: "fleet_status_session_json_schema_validation_failed",
        issues: result.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
    );
    return null;
  }

  return result.data;
}

/**
 * Parse a raw JSON string as a StopHookPayload.
 *
 * Returns the typed StopHookPayload on success, null on any failure.
 * Logs a structured WARN with an `operation` field for grep-ability.
 * NEVER propagates exceptions — the caller does not need a try/catch.
 */
export function parseStopHookPayload(raw: string): StopHookPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    systemLogger.warn(
      "Fleet-status: failed to parse Stop hook payload JSON string",
      {
        operation: "fleet_status_stop_hook_payload_json_parse_failed",
        error: err instanceof Error ? err.message : "unknown",
      },
    );
    return null;
  }

  const result = StopHookPayloadSchema.safeParse(parsed);
  if (!result.success) {
    systemLogger.warn(
      "Fleet-status: Stop hook payload failed schema validation",
      {
        operation: "fleet_status_stop_hook_payload_schema_validation_failed",
        issues: result.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
    );
    return null;
  }

  return result.data;
}
