/**
 * Phase 80 Plan 01 — vetted-pool loader (D-01 storage substrate).
 *
 * Where the pool lives:
 *   - Baked into the Docker image at /app/pool-defaults/pool.json via the
 *     Dockerfile `COPY --chown=node:node docker/pool-defaults /app/pool-defaults`
 *     line (see docker/Dockerfile L79). File is checked into the repo at
 *     docker/pool-defaults/pool.json and never mutated at runtime.
 *
 * Shape contract (D-01):
 *   { "names": string[] }   — non-empty PascalCase name strings.
 *
 * Error handling contract (no exceptions ever escape):
 *   - ENOENT (missing file) → return [] silently. A missing pool.json is
 *     expected for legacy deploys shipped before the Dockerfile COPY landed
 *     on the target box; NOT an error to log.
 *   - Malformed JSON (SyntaxError from JSON.parse) → sshLogger.error +
 *     return []. Log payload contains only the path + error message; the
 *     raw file body is NEVER logged (T-80-01-04 mitigation).
 *   - Shape invalid (top-level not object, `names` not array, `names`
 *     contains non-string entries) → sshLogger.error + return [].
 *   - Any other filesystem error (EACCES, EIO, …) → sshLogger.error +
 *     return [].
 *   - No exceptions ever escape this function; every failure branch
 *     returns the safe default (empty array). T-80-01-02 mitigation.
 *
 * Memoization contract (T-80-01-03 mitigation):
 *   - Result is memoized at module scope. First call reads the file
 *     synchronously; subsequent calls return the cached array.
 *   - Consequence: hot-editing /app/pool-defaults/pool.json at runtime
 *     does NOT change behavior — a container restart is required. This is
 *     the intended semantic (D-01: "loaded on boot").
 *
 * Byte-shape mirror of src/backend/branding/branding-config-loader.ts
 * (getBundledDefaults, L118-155) — same module-scope memoization + inline
 * shape guard + sshLogger discipline.
 *
 * Pure I/O: no Express, no SSH — safe to import from any context.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { sshLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const POOL_FILENAME = "pool.json";

// ---------------------------------------------------------------------------
// Path helper (fixed absolute path — Dockerfile COPY target)
// ---------------------------------------------------------------------------

function getPoolDir(): string {
  return "/app/pool-defaults";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PoolFile {
  names: string[];
}

// ---------------------------------------------------------------------------
// Memoized loader
// ---------------------------------------------------------------------------

let cachedPool: string[] | null = null;

/**
 * Return the vetted pool of name strings. On first call, reads
 * /app/pool-defaults/pool.json synchronously and memoizes the result;
 * subsequent calls return the cached array without touching the filesystem.
 *
 * No exceptions escape — every failure branch returns []. See file header
 * for the full error-handling contract.
 */
export function getVettedPool(): string[] {
  if (cachedPool !== null) return cachedPool;
  const poolPath = path.join(getPoolDir(), POOL_FILENAME);
  try {
    const raw = readFileSync(poolPath, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      // T-80-01-04: log only path + error message; NEVER include the raw
      // file body (would leak potentially sensitive pool contents into logs).
      sshLogger.error("pool-loader: JSON parse error, returning []", {
        operation: "pool_loader_parse",
        error: err instanceof Error ? err.message : String(err),
        path: poolPath,
      });
      cachedPool = [];
      return cachedPool;
    }
    if (isValidPoolShape(parsed)) {
      cachedPool = (parsed as PoolFile).names;
      return cachedPool;
    }
    sshLogger.error("pool-loader: shape invalid, returning []", {
      operation: "pool_loader_shape",
      error: "pool.json does not have shape { names: string[] } with non-empty entries",
      path: poolPath,
    });
    cachedPool = [];
    return cachedPool;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // Missing pool.json is expected for legacy deploys — silent.
      cachedPool = [];
      return cachedPool;
    }
    sshLogger.error("pool-loader: read failed, returning []", {
      operation: "pool_loader_read",
      error: err instanceof Error ? err.message : String(err),
      path: poolPath,
    });
    cachedPool = [];
    return cachedPool;
  }
}

// ---------------------------------------------------------------------------
// Shape guard (inline typeof / Array.isArray — matches house style)
// ---------------------------------------------------------------------------

function isValidPoolShape(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.names)) return false;
  for (const entry of o.names as unknown[]) {
    if (typeof entry !== "string" || entry.length === 0) return false;
  }
  return true;
}
