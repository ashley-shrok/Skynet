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
 * - Log rotation mirrors debug.ts: file > 5 MB → overwrite with rotation marker,
 *   then append. Simultaneous rotation with frontend handler is safe on Linux
 *   (both use synchronous fs.writeFileSync/appendFileSync; T-31-17).
 * - File writes are best-effort: errors are swallowed after a stderr note (D-19).
 * - getLogPath() is imported lazily at flush time so tests can override
 *   SKYNET_CONSOLE_FORWARD_LOG_PATH per-test without module-reset gymnastics.
 */

import fs from "fs";
import { getLogPath } from "../database/routes/debug.js";

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

// --- internal flush ---

const MAX_FILE_BYTES = 5 * 1024 * 1024;

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

    // Mirror debug.ts rotation logic
    let currentSize = 0;
    try {
      currentSize = fs.statSync(logPath).size;
    } catch {
      // File does not exist yet — treat as size 0
      currentSize = 0;
    }

    if (currentSize > MAX_FILE_BYTES) {
      fs.writeFileSync(
        logPath,
        "[LOG_ROTATED at " + new Date().toISOString() + "]\n",
      );
    }

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
