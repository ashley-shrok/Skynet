/**
 * Fleet-status watcher entrypoint.
 *
 * Wires together:
 *   - Session JSON inotify watcher (session-json-watcher.ts)
 *   - Stop hook Unix-socket consumer (stop-hook-socket.ts)
 *   - Stdout transport (stdout only for now; Plan 04 replaces with WS client)
 *
 * Environment:
 *   HOME            - used to locate ~/.claude/sessions/ (defaults to /root)
 *   FLEET_HOST_ID   - overrides hostname for the hostId field (defaults to os.hostname())
 *   FLEET_SOCK_PATH - overrides the Unix socket path
 */

import os from "node:os";
import { createSessionJsonWatcher } from "./session-json-watcher.js";
import { createStopHookSocketServer, filterAmbientTasks } from "./stop-hook-socket.js";
import { watcherLogger } from "./logger.js";
import type { SessionState, BackgroundTask } from "./types.js";
import type { StopHookPayload } from "./types.js";

const HOME = process.env["HOME"] ?? "/root";
const hostId = process.env["FLEET_HOST_ID"] ?? os.hostname();
const sessionsDir = `${HOME}/.claude/sessions`;
const uid = process.getuid?.() ?? 0;
const socketPath =
  process.env["FLEET_SOCK_PATH"] ?? `/tmp/fleet-status-hook-${uid}.sock`;

// In-memory state map: sessionId → SessionState
const stateMap = new Map<string, SessionState>();

watcherLogger.info("watcher_start", { hostId, sessionsDir, socketPath });

// ---------------------------------------------------------------------------
// Session JSON watcher — primary signal
// ---------------------------------------------------------------------------
const sessionWatcher = createSessionJsonWatcher({
  sessionsDir,
  hostId,
  onSessionState(state) {
    stateMap.set(state.sessionId, state);
    process.stdout.write(JSON.stringify(state) + "\n");
    watcherLogger.info("session_state_emitted", {
      hostId: state.hostId,
      pid: state.pid,
      sessionId: state.sessionId,
      status: state.status,
    });
  },
  onSessionGone(hostId, tmuxSession, sessionId, pid) {
    stateMap.delete(sessionId);
    const gone = {
      event: "session_gone",
      hostId,
      tmuxSession,
      sessionId,
      pid,
      updatedAt: Date.now(),
    };
    process.stdout.write(JSON.stringify(gone) + "\n");
    watcherLogger.info("session_gone_emitted", { hostId, pid, sessionId, tmuxSession });
  },
});

// ---------------------------------------------------------------------------
// Stop hook socket — complementary background_tasks[] signal
// ---------------------------------------------------------------------------
createStopHookSocketServer({
  socketPath,
  onPayload(payload: StopHookPayload) {
    const existing = stateMap.get(payload.session_id);
    if (!existing) {
      watcherLogger.warn("stop_hook_unknown_session", {
        hostId,
        sessionId: payload.session_id,
      });
      return;
    }
    const rawTasks = payload.background_tasks as BackgroundTask[];
    const filtered = filterAmbientTasks(rawTasks);
    const merged: SessionState = { ...existing, backgroundTasks: filtered };
    stateMap.set(payload.session_id, merged);
    process.stdout.write(JSON.stringify(merged) + "\n");
    watcherLogger.info("stop_hook_merged", {
      hostId,
      sessionId: payload.session_id,
      pid: existing.pid,
      taskCount: filtered.length,
    });
  },
});

// Graceful shutdown
process.on("SIGTERM", () => {
  watcherLogger.info("watcher_stop", { hostId, signal: "SIGTERM" });
  sessionWatcher.close();
  process.exit(0);
});

process.on("SIGINT", () => {
  watcherLogger.info("watcher_stop", { hostId, signal: "SIGINT" });
  sessionWatcher.close();
  process.exit(0);
});
