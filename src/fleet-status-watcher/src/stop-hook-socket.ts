/**
 * Unix-domain-socket server that accepts Claude Code Stop hook payloads.
 *
 * Protocol:
 *   - 4-byte big-endian length header
 *   - N bytes of UTF-8 JSON body
 *   - Server reads, parses, invokes onPayload, closes the connection
 *
 * Security (STRIDE T-34-01):
 *   - Socket is uid-scoped (/tmp/fleet-status-hook-<uid>.sock)
 *   - Payload is validated via zod schema before use
 *   - Malformed payloads are logged and dropped
 *   - Errors are logged and ignored (hook write must not block Claude Code)
 */

import net from "node:net";
import fs from "node:fs";
import { watcherLogger, extractErrorFields } from "./logger.js";
import { StopHookPayloadSchema } from "./types.js";
import type { BackgroundTask, StopHookPayload } from "./types.js";

export interface StopHookSocketOptions {
  socketPath: string;
  onPayload(payload: StopHookPayload): void;
}

/**
 * Filter out ambient background tasks.
 *
 * Ambient tasks are those where description starts with '[ambient]'.
 * Tasks with no description are NOT treated as ambient (must be preserved).
 */
export function filterAmbientTasks(tasks: BackgroundTask[]): BackgroundTask[] {
  return tasks.filter((t) => {
    if (t.description === undefined || t.description === null) {
      return true; // No description → keep
    }
    return !t.description.startsWith("[ambient]");
  });
}

/**
 * Create and start the Stop hook Unix domain socket server.
 *
 * Returns the net.Server instance (call .close() to stop).
 */
export function createStopHookSocketServer(
  opts: StopHookSocketOptions,
): net.Server {
  const { socketPath, onPayload } = opts;

  // Unlink stale socket from a previous run (ENOENT is fine)
  try {
    fs.unlinkSync(socketPath);
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      watcherLogger.warn("hook_socket_unlink_error", {
        socketPath,
        err: extractErrorFields(e),
      });
    }
  }

  const server = net.createServer((socket) => {
    watcherLogger.info("hook_socket_connect", { socketPath });

    const chunks: Buffer[] = [];
    let expectedLength: number | null = null;
    let headerBuf = Buffer.alloc(0);

    socket.on("data", (chunk: Buffer) => {
      if (expectedLength === null) {
        // Accumulate header bytes until we have 4
        headerBuf = Buffer.concat([headerBuf, chunk]);
        if (headerBuf.length < 4) return;
        expectedLength = headerBuf.readUInt32BE(0);
        // Any bytes after the 4-byte header are part of the body
        const bodyStart = headerBuf.slice(4);
        if (bodyStart.length > 0) {
          chunks.push(bodyStart);
        }
      } else {
        chunks.push(chunk);
      }

      // Check if we have received the full body
      const received = chunks.reduce((sum, c) => sum + c.length, 0);
      if (expectedLength !== null && received >= expectedLength) {
        const body = Buffer.concat(chunks).slice(0, expectedLength);
        processPayload(body.toString("utf-8"), socketPath, onPayload);
        socket.end();
      }
    });

    socket.on("error", (e: unknown) => {
      watcherLogger.warn("hook_socket_error", {
        socketPath,
        err: extractErrorFields(e),
      });
    });

    socket.on("close", () => {
      // Connection closed — nothing to do
    });
  });

  server.on("error", (e: unknown) => {
    watcherLogger.error("hook_socket_server_error", {
      socketPath,
      err: extractErrorFields(e),
    });
  });

  server.listen(socketPath, () => {
    watcherLogger.info("hook_socket_listening", { socketPath });
  });

  return server;
}

/** Parse and validate a raw JSON payload string, invoke callback if valid. */
function processPayload(
  raw: string,
  socketPath: string,
  onPayload: (p: StopHookPayload) => void,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: unknown) {
    watcherLogger.warn("hook_socket_json_parse_error", {
      socketPath,
      err: extractErrorFields(e),
    });
    return;
  }

  const result = StopHookPayloadSchema.safeParse(parsed);
  if (!result.success) {
    watcherLogger.warn("hook_socket_schema_error", {
      socketPath,
      errors: result.error.issues.map((i) => i.message),
    });
    return;
  }

  onPayload(result.data);
}
