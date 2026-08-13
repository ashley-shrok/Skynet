/**
 * Structured JSON logger for the fleet-status watcher.
 *
 * Design rules (per Ashley 2026-08-11 standing directive):
 *   - Every log call emits exactly ONE line of valid JSON to stderr.
 *   - Input fields are extracted explicitly — never pass an Error or DOM Event
 *     object through JSON.stringify (which produces `{}` for most Error props).
 *   - Error objects are extracted to { message, stack } only.
 *   - Standard fields: hostId, pid, sessionId (when known) appear at top level.
 */

/** Extract serialisable fields from an unknown error value. */
export function extractErrorFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      message: err.message,
      stack: err.stack,
      name: err.name,
    };
  }
  if (typeof err === "string") {
    return { message: err };
  }
  // Primitives or plain objects — stringify-safe, serialise directly
  return { raw: String(err) };
}

export type LogLevel = "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export interface WatcherLogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

/**
 * Write a single JSON log line to stderr.
 * Fields are merged into the top-level JSON object alongside level/message/timestamp.
 */
function writeLogLine(
  level: LogLevel,
  message: string,
  fields: LogFields,
): void {
  // Build the entry with explicit field extraction — never spread Error objects
  const entry: WatcherLogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...fields,
  };
  // JSON.stringify is safe here because fields has already been extracted —
  // no raw Error or DOM Event objects are in `fields` (callers use extractErrorFields).
  process.stderr.write(JSON.stringify(entry) + "\n");
}

export const watcherLogger = {
  info(message: string, fields: LogFields = {}): void {
    writeLogLine("info", message, fields);
  },
  warn(message: string, fields: LogFields = {}): void {
    writeLogLine("warn", message, fields);
  },
  error(message: string, fields: LogFields = {}): void {
    writeLogLine("error", message, fields);
  },
};
