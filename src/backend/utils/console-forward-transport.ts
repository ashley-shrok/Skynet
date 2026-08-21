/**
 * Phase 31 D-03 backend→frontend log unification. Batches backend Logger.*
 * output and appends to the same console-forward.log file the frontend writes
 * to (via src/backend/database/routes/debug.ts's getLogPath). Each entry
 * carries source='backend' marker so `grep '"source":"backend"' console-forward.log`
 * filters. Buffer + FLUSH_INTERVAL_MS=500 + MAX_BATCH=20 mirrors the frontend
 * console-forwarder pattern (patch #146).
 *
 * Design notes:
 * - Writes DIRECTLY to the log file (no HTTP hop back to itself; same-process).
 * - Log rotation delegated to shared console-forward-rotator.ts (N-file rename
 *   chain, N=20). Concurrent rotation with debug.ts is safe: fs.renameSync is
 *   atomic on POSIX; a losing racer observes size < threshold via ENOENT after
 *   the base is renamed away and no-ops (T-31-17 concern preserved — history
 *   is never truncated).
 * - File writes are best-effort: errors are swallowed after a stderr note (D-19).
 * - Uses the same SKYNET_CONSOLE_FORWARD_LOG_PATH env var as debug.ts (same file).
 *   Path is resolved at flush time (not module load) so tests can override per-test
 *   without module-reset gymnastics. We intentionally do NOT import debug.ts here
 *   to avoid pulling in its Express router + AuthManager.getInstance() at module-load
 *   time (which breaks test environments that don't boot the full server stack).
 */

import fs from "fs";
import { rotateIfExceeds } from "./console-forward-rotator.js";

// --- types ---

export type BackendLogEntry = {
  ts: string;
  level: "log" | "info" | "warn" | "error";
  msg: string;
  source: "backend";
};

// --- module-scoped state (mirrors console-forwarder.ts) ---

const buffer: BackendLogEntry[] = [];
const MAX_BATCH = 20;
const FLUSH_INTERVAL_MS = 500;
let flushTimer: NodeJS.Timeout | null = null;

// --- internal path helper (mirrors debug.ts's getLogPath, avoids importing debug.ts) ---

const DEFAULT_LOG_PATH =
  "/var/log/skynet/console-forward/console-forward.log";

function getLogPath(): string {
  return process.env.SKYNET_CONSOLE_FORWARD_LOG_PATH ?? DEFAULT_LOG_PATH;
}

// --- internal flush ---

function flush(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  if (buffer.length === 0) {
    return; // no-op — do not touch the file
  }

  const entries = buffer.splice(0);

  try {
    const logPath = getLogPath();
    rotateIfExceeds(logPath);

    fs.appendFileSync(
      logPath,
      entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );
  } catch (err) {
    process.stderr.write(
      "[console-forward-transport] flush failed (best-effort): " +
        String(err instanceof Error ? err.message : err) +
        "\n",
    );
    // swallow — never propagate (D-19)
  }
}

// --- public API ---

/**
 * Enqueues a backend log entry into the buffer. Adds ts and source fields.
 * Auto-flushes synchronously when MAX_BATCH (20) entries accumulate, or
 * schedules a flush after FLUSH_INTERVAL_MS (500ms) otherwise.
 */
export function enqueueBackendLog(
  entry: Omit<BackendLogEntry, "ts" | "source">,
): void {
  buffer.push({
    ts: new Date().toISOString(),
    level: entry.level,
    msg: entry.msg,
    source: "backend",
  });

  if (buffer.length >= MAX_BATCH) {
    flush(); // synchronous — drain immediately
  } else if (flushTimer === null) {
    flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
  }
}

/**
 * Flushes all buffered entries synchronously to the log file.
 * Safe to call at graceful shutdown (SIGTERM) to drain any pending lines.
 */
export function flushBackendLogs(): void {
  flush();
}

// --- test helpers ---

/** @internal test-only — clears buffer and cancels any pending flush timer */
export function __test_reset(): void {
  buffer.splice(0);
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

/** @internal test-only — returns a shallow copy of the current buffer */
export function __test_getBuffer(): BackendLogEntry[] {
  return [...buffer];
}
