/**
 * Shared N-file rotation helper for the console-forward.log stream.
 *
 * Both src/backend/database/routes/debug.ts (frontend forwarder POST handler)
 * and src/backend/utils/console-forward-transport.ts (backend flush) share
 * one on-disk log file at getLogPath(). Previously each callsite duplicated
 * a destructive-truncation block: `fs.writeFileSync(logPath, "[LOG_ROTATED …]")`
 * once size crossed 5 MB, which destroyed all prior history and made
 * post-hoc grep debugging useless in production.
 *
 * quick-260821-kyf replaced both blocks with a single call to
 * `rotateIfExceeds(logPath)` which uses `fs.renameSync` to bump the base
 * file into a numbered suffix chain (.log → .log.1 → .log.2 → … → .log.N,
 * dropping .log.N off the end). Atomic on POSIX — a losing racer observes
 * size < threshold post-rename and no-ops without touching the new base.
 */

import fs from "fs";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROTATED_FILES = 20;

/**
 * Rotate the log file at `logPath` if it exceeds `maxBytes`.
 *
 * If the base file does not exist OR size ≤ maxBytes, this is a no-op
 * (ENOENT from statSync is swallowed as "no rotation needed").
 *
 * Otherwise, iterate from `maxFiles` down to 1:
 *   - If .log.maxFiles exists, unlink it (drop the oldest).
 *   - Rename .log.(i-1) → .log.i, treating index 0 as the base logPath.
 *
 * Rename ordering (highest index down to base) guarantees no rename
 * ever clobbers an existing file. Each fs op is wrapped in its own
 * try/catch so a single failed rename does not abort the chain, and
 * the helper never throws (callers are already best-effort).
 *
 * Never calls fs.writeFileSync — history is preserved, not truncated.
 */
export function rotateIfExceeds(
  logPath: string,
  opts?: { maxBytes?: number; maxFiles?: number },
): void {
  const maxBytes = opts?.maxBytes ?? MAX_FILE_BYTES;
  const maxFiles = opts?.maxFiles ?? MAX_ROTATED_FILES;

  let size = 0;
  try {
    size = fs.statSync(logPath).size;
  } catch {
    // ENOENT (or any stat error) → nothing to rotate.
    return;
  }
  if (size <= maxBytes) {
    return;
  }

  // Pre-loop: drop the oldest slot so incoming rename has a free target.
  try {
    fs.unlinkSync(`${logPath}.${maxFiles}`);
  } catch {
    // may not exist — fine
  }

  // Iterate high → low. At each step, rename .log.(i-1) → .log.i.
  // i-1 === 0 means the base logPath itself.
  for (let i = maxFiles; i >= 1; i--) {
    const source = i === 1 ? logPath : `${logPath}.${i - 1}`;
    const target = `${logPath}.${i}`;
    try {
      fs.renameSync(source, target);
    } catch {
      // source may not exist yet (chain not full) or POSIX race — swallow, keep chain going
    }
  }
}
