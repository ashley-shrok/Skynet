import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import fs from "fs";
import { apiLogger } from "../../utils/logger.js";
import { rotateIfExceeds } from "../../utils/console-forward-rotator.js";
import { AuthManager } from "../../utils/auth-manager.js";

// Patch #146: log-forwarder prototype — backend POST endpoint.
//
// Accepts batched frontend console log entries, stores them in an
// in-process ring buffer (last 1000), and mirrors each entry as a
// JSON line to a server-side file greppable via (host-side, since the
// default path is a bind-mount from /opt/skynet/console-forward-logs):
//   sudo cat /opt/skynet/console-forward-logs/console-forward.log
//
// File path is configured via SKYNET_CONSOLE_FORWARD_LOG_PATH (env var
// read lazily inside the handler, not at module load, so tests can
// override per test without module-reset gymnastics). Default lives
// under /var/log/skynet/console-forward/ so the compose bind-mount
// makes it durable across container recreates — /tmp inside the
// container is wiped on every --force-recreate and the whole point of
// forwarding logs is post-hoc inspection across restarts.
//
// File writes are best-effort: errors are logged but never surfaced to
// the caller. File rotation delegated to console-forward-rotator.ts
// (N-file rename chain, N=20 → ~100 MB rolling retention) — history is
// preserved, never truncated (quick-260821-kyf).

// --- types ---

export type LogLevel = "log" | "info" | "warn" | "error";

export type LogEntry = {
  ts: string;
  level: LogLevel;
  tabId: string;
  hostId?: number;
  sessionKey?: string;
  msg: string;
  /** Phase 31 D-03: optional origin marker. Absent = frontend (backward compat). */
  source?: "frontend" | "backend";
};

// --- runtime validator ---

export function isValidEntry(x: unknown): x is LogEntry {
  if (typeof x !== "object" || x === null) return false;
  const e = x as Record<string, unknown>;
  if (typeof e.ts !== "string") return false;
  if (e.level !== "log" && e.level !== "info" && e.level !== "warn" && e.level !== "error") return false;
  if (typeof e.tabId !== "string") return false;
  if (typeof e.msg !== "string") return false;
  if ("hostId" in e && typeof e.hostId !== "number") return false;
  if ("sessionKey" in e && typeof e.sessionKey !== "string") return false;
  if ("source" in e && e.source !== "frontend" && e.source !== "backend") return false;
  return true;
}

// --- module-scoped ring buffer ---

const MAX_RING = 1000;
export const ring: LogEntry[] = [];

// --- lazy log path accessor (called inside handler so tests can override env) ---

export const DEFAULT_LOG_PATH =
  "/var/log/skynet/console-forward/console-forward.log";

export function getLogPath(): string {
  return process.env.SKYNET_CONSOLE_FORWARD_LOG_PATH ?? DEFAULT_LOG_PATH;
}

// --- core handler (exported for direct testing without Express harness) ---

export function handleConsoleLog(req: Request, res: Response): Response {
  // 1. Validate entries array
  const rawEntries: unknown = (req.body as Record<string, unknown>)?.entries;
  if (!Array.isArray(rawEntries)) {
    return res.status(400).json({ error: "entries array required" });
  }

  // 2. Filter valid entries
  const validEntries = rawEntries.filter(isValidEntry);
  if (rawEntries.length > 0 && validEntries.length === 0) {
    return res.status(400).json({ error: "no valid entries" });
  }

  // If entries array was empty, nothing to do but still succeed
  if (validEntries.length === 0) {
    return res.status(204).end();
  }

  // 3. Push into ring buffer, trim to MAX_RING
  for (const entry of validEntries) {
    ring.push(entry);
  }
  while (ring.length > MAX_RING) {
    ring.shift();
  }

  // 4. Best-effort file mirror
  try {
    const logPath = getLogPath();
    rotateIfExceeds(logPath);

    fs.appendFileSync(
      logPath,
      validEntries.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );
  } catch (err) {
    apiLogger.error("console-forward file mirror failed", err, {
      operation: "console_forward_write",
    });
    // DO NOT rethrow — file writes are best-effort, never crash the process
  }

  // 5. Return 204 — no response body
  return res.status(204).end();
}

// --- Express router ---

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

router.post(
  "/console-log",
  authenticateJWT,
  (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    void authReq; // userId is validated by authenticateJWT middleware
    return handleConsoleLog(req, res);
  },
);

export default router;
