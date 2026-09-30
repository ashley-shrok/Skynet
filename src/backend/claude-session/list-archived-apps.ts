/**
 * list-archived-apps.ts — Phase 143 Plan 143-02 (D-06 companion primitives).
 *
 * Enumerates app slug folder names under `~/fleet/apps-archive/` on a host,
 * mirroring the shape of `listArchivedIdentityKeysOnHost` at
 * `list-archived-identity-keys.ts:106-155` byte-for-byte but rooted at the
 * apps archive directory. Sibling of `list-archived-roles.ts`.
 *
 * WHY THIS EXISTS:
 *
 * Phase 143 D-06 specifies that the identity list endpoint exposes the
 * existing primitive at `list-archived-identity-keys.ts`. Roles + apps list
 * endpoints are NEW — companion internal primitives are added here and in
 * `list-archived-roles.ts`. The GET list route (plan 143-03) calls this
 * primitive directly.
 *
 * LOCAL vs REMOTE BRANCH split mirrors `listArchivedIdentityKeysOnHost`
 * byte-for-byte so the two enumerators are behaviorally consistent from the
 * caller's perspective. LOCAL walks the bind-mounted host directory via node
 * fs; REMOTE shells out over an existing SSH connection with the same
 * `find ... 2>/dev/null || true` graceful-degrade idiom.
 *
 * GRACEFUL DEGRADE:
 *   - LOCAL, dir missing (ENOENT) → returns [].
 *   - REMOTE, dir missing → shell's `|| true` produces empty stdout → returns [].
 *
 * Both branches return names that match `APP_SLUG_RE` (`/^[a-z0-9-]{1,64}$/`)
 * — same regex app-scoped surfaces use, so downstream callers receive
 * shell-safe strings by construction (T-143-02-02).
 *
 * ERROR PROPAGATION: on unexpected errors, the error propagates. The caller
 * (route handler) wraps each host call in try/catch for per-host
 * silent-swallow, matching the discipline established at `sessions.ts:319-566`.
 *
 * Root helper: `getLocalArchivedAppsRoot` is IMPORTED from
 * `./per-app-archive-file.js` (plan 143-01 task 3 exports it) — NOT
 * redefined here — so the archive path is consistent between writer + lister.
 */

import { promises as fs } from "node:fs";
import type { Client as SSHClientType } from "ssh2";

import { getLocalArchivedAppsRoot } from "./per-app-archive-file.js";
import { APP_SLUG_RE } from "./identity-artifact-reader.js";
import { execCommand } from "../ssh/tmux-helper.js";

/**
 * Hard ceiling on the REMOTE find exec — matches the sibling
 * `REMOTE_LIST_TIMEOUT_MS` constant used by `list-archived-identity-keys.ts`
 * (15s). A 15s cap is generous for a one-level directory walk; it exists to
 * keep a stuck SSH channel from stalling the whole fan-out beyond the
 * route's PER_HOST_TIMEOUT_MS (30s) enclosing budget.
 */
const REMOTE_LIST_TIMEOUT_MS = 15_000;

/**
 * List the archived-app folder names on a host.
 *
 * LOCAL branch (conn === null):
 *   - Reads getLocalArchivedAppsRoot() via fs.readdir({ withFileTypes: true }).
 *   - ENOENT → returns [] (host has never had any archived app).
 *   - Keeps entries where isDirectory() === true AND APP_SLUG_RE.test(name).
 *   - Returns sorted (lexicographic) array of names.
 *
 * REMOTE branch (conn !== null):
 *   - Runs `find "$HOME/fleet/apps-archive" -mindepth 1 -maxdepth 1
 *      -type d -printf '%f\n' 2>/dev/null || true` via a Promise.race
 *      timeout mirror of `execWithTimeout` (15s).
 *   - `|| true` handles "archive dir missing" as empty stdout.
 *   - Splits stdout by newline, trims, drops empty strings.
 *   - Filters through APP_SLUG_RE.
 *   - Returns sorted array.
 *
 * @param conn — an open SSH client, or null for a LOCAL read.
 */
export async function listArchivedAppsOnHost(
  conn: SSHClientType | null,
): Promise<string[]> {
  if (conn === null) {
    // LOCAL branch
    const root = getLocalArchivedAppsRoot();
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return [];
      }
      throw err;
    }
    return entries
      .filter((e) => e.isDirectory() && APP_SLUG_RE.test(e.name))
      .map((e) => e.name)
      .sort();
  }

  // REMOTE branch — find prints basenames only; `|| true` swallows a missing
  // directory as empty stdout. The Promise.race timeout keeps a stuck SSH
  // channel from consuming the caller's per-host budget.
  const cmd =
    `find "$HOME/fleet/apps-archive" -mindepth 1 -maxdepth 1 -type d -printf '%f\\n' 2>/dev/null || true`;
  const stdout = await Promise.race([
    execCommand(conn, cmd),
    new Promise<string>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `listArchivedAppsOnHost: remote exec timeout after ${REMOTE_LIST_TIMEOUT_MS}ms`,
            ),
          ),
        REMOTE_LIST_TIMEOUT_MS,
      ),
    ),
  ]);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((name) => name.length > 0 && APP_SLUG_RE.test(name))
    .sort();
}
