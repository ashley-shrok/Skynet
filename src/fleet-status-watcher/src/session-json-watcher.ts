/**
 * Directory-scoped inotify watcher over ~/.claude/sessions/.
 *
 * Provides:
 *   - Initial scan at startup (reads every <pid>.json, emits one onSessionState per live PID)
 *   - Real-time inotify events (create/modify/delete via fs.watch on Linux)
 *   - Periodic 30-second liveness sweep (catches SIGKILL victims that stop writing)
 *
 * Integration:
 *   - Calls isPidAlive(pid, procStart) before emitting any SessionState
 *   - Calls resolveTmuxSessionForPid(pid) on first sighting of a new PID
 *   - Calls clearPidCache(pid) when a PID is reaped
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { isPidAlive } from "./liveness-check.js";
import { resolveTmuxSessionForPid, clearPidCache } from "./pid-to-tmux.js";
import { watcherLogger, extractErrorFields } from "./logger.js";
import { SessionJsonSchema } from "./types.js";
import type { SessionState, SessionJson } from "./types.js";

const LIVENESS_SWEEP_INTERVAL_MS = 30_000;

/** pid.json filename pattern */
const PID_JSON_REGEX = /^(\d+)\.json$/;

export interface SessionJsonWatcherOptions {
  sessionsDir: string;
  hostId: string;
  onSessionState(state: SessionState): void;
  onSessionGone(
    hostId: string,
    tmuxSession: string | null,
    sessionId: string,
    pid: number,
  ): void;
}

export interface SessionJsonWatcherHandle {
  close(): void;
}

/** Tracked session info for liveness checks */
interface TrackedSession {
  sessionId: string;
  tmuxSession: string | null;
  procStart: string;
}

/**
 * Parse a session JSON string into a SessionJson object.
 * Returns null on invalid JSON or missing required fields — never throws.
 */
export function parseSessionJson(raw: string): SessionJson | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = SessionJsonSchema.safeParse(parsed);
    if (!result.success) {
      return null;
    }
    return result.data;
  } catch {
    return null;
  }
}

/**
 * Create and start the session JSON directory watcher.
 *
 * Returns a handle with a `close()` method to stop the watcher and sweep timer.
 */
export function createSessionJsonWatcher(
  opts: SessionJsonWatcherOptions,
): SessionJsonWatcherHandle {
  const { sessionsDir, hostId, onSessionState, onSessionGone } = opts;
  const tracked = new Map<number, TrackedSession>();

  watcherLogger.info("session_watcher_open", { hostId, sessionsDir });

  // -------------------------------------------------------------------------
  // Process a single session file — shared by initial scan + inotify events
  // -------------------------------------------------------------------------
  async function processFile(filename: string): Promise<void> {
    const match = PID_JSON_REGEX.exec(filename);
    if (!match || !match[1]) return;
    const pid = parseInt(match[1], 10);
    if (isNaN(pid) || pid <= 0) return;

    const filePath = path.join(sessionsDir, filename);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf-8");
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") {
        watcherLogger.warn("session_file_read_error", {
          hostId,
          pid,
          filePath,
          err: extractErrorFields(e),
        });
      }
      return;
    }

    watcherLogger.info("session_file_open", { hostId, pid, filePath });

    const json = parseSessionJson(raw);
    if (!json) {
      watcherLogger.warn("session_file_parse_error", { hostId, pid, filePath });
      return;
    }

    // Liveness check: confirm PID is alive and procStart matches
    const alive = await isPidAlive(pid, json.procStart);
    if (!alive) {
      const existing = tracked.get(pid);
      watcherLogger.info("session_stale_reaped", {
        hostId,
        pid,
        sessionId: json.sessionId,
        operation: "session_stale_reaped",
      });
      if (existing) {
        clearPidCache(pid);
        tracked.delete(pid);
        onSessionGone(hostId, existing.tmuxSession, existing.sessionId, pid);
      }
      return;
    }

    // Resolve tmux session name (cached after first resolution)
    const tmuxSession = await resolveTmuxSessionForPid(pid);

    // Update tracked state
    tracked.set(pid, {
      sessionId: json.sessionId,
      tmuxSession,
      procStart: json.procStart,
    });

    // Build and emit SessionState
    const state: SessionState = {
      hostId,
      tmuxSession,
      sessionId: json.sessionId,
      pid,
      status: json.status,
      backgroundTasks: [],
      updatedAt: json.updatedAt,
    };
    if (json.status === "waiting" && json.waitingFor !== undefined) {
      state.waitingFor = json.waitingFor;
    }

    watcherLogger.info("session_file_close", {
      hostId,
      pid,
      sessionId: json.sessionId,
      status: json.status,
    });

    onSessionState(state);
  }

  // -------------------------------------------------------------------------
  // Reap a PID that has gone stale (no delete event — procStart check failed)
  // -------------------------------------------------------------------------
  async function reapPid(pid: number): Promise<void> {
    const existing = tracked.get(pid);
    if (!existing) return;

    const alive = await isPidAlive(pid, existing.procStart);
    if (alive) return;

    watcherLogger.info("session_stale_reaped", {
      hostId,
      pid,
      sessionId: existing.sessionId,
      operation: "session_stale_reaped",
    });
    clearPidCache(pid);
    tracked.delete(pid);
    onSessionGone(hostId, existing.tmuxSession, existing.sessionId, pid);
  }

  // -------------------------------------------------------------------------
  // Initial directory scan
  // -------------------------------------------------------------------------
  async function initialScan(): Promise<void> {
    let files: string[];
    try {
      files = await fs.readdir(sessionsDir);
    } catch (e: unknown) {
      watcherLogger.warn("session_dir_read_error", {
        hostId,
        sessionsDir,
        err: extractErrorFields(e),
      });
      return;
    }

    const jsonFiles = files.filter((f) => PID_JSON_REGEX.test(f));
    watcherLogger.info("session_initial_scan", {
      hostId,
      sessionsDir,
      fileCount: jsonFiles.length,
    });

    await Promise.all(jsonFiles.map((f) => processFile(f)));
  }

  // -------------------------------------------------------------------------
  // Periodic liveness sweep (every 30s)
  // -------------------------------------------------------------------------
  const sweepTimer = setInterval(async () => {
    const pids = Array.from(tracked.keys());
    watcherLogger.info("session_liveness_sweep", { hostId, pidCount: pids.length });
    await Promise.all(pids.map((pid) => reapPid(pid)));
  }, LIVENESS_SWEEP_INTERVAL_MS);
  // Don't let the timer keep the process alive if nothing else does
  sweepTimer.unref();

  // -------------------------------------------------------------------------
  // inotify watcher (fs.watch — uses inotify on Linux natively)
  // -------------------------------------------------------------------------
  let watcher: fsSync.FSWatcher | null = null;
  try {
    watcher = fsSync.watch(
      sessionsDir,
      { persistent: true },
      (eventType, filename) => {
        if (!filename) return;
        const match = PID_JSON_REGEX.exec(filename);
        if (!match) return;
        const pid = parseInt(match[1]!, 10);
        if (eventType === "rename") {
          // rename covers both create and delete on Linux inotify
          // If the file no longer exists, reap the PID
          void reapPid(pid).then(() => {
            // Also try to process in case it was a create event
            void processFile(filename);
          });
        } else {
          // change event — file was modified
          void processFile(filename);
        }
      },
    );
    watcherLogger.info("session_watcher_started", { hostId, sessionsDir });
  } catch (e: unknown) {
    watcherLogger.error("session_watcher_start_error", {
      hostId,
      sessionsDir,
      err: extractErrorFields(e),
    });
  }

  // Run initial scan after setting up the watcher
  void initialScan();

  return {
    close() {
      clearInterval(sweepTimer);
      if (watcher) {
        watcher.close();
        watcher = null;
      }
      watcherLogger.info("session_watcher_closed", { hostId, sessionsDir });
    },
  };
}
