/**
 * listArchivedIdentityKeysOnHost — Phase 122 Plan 122-02 Task 1.
 *
 * Enumerates identity keys under `~/fleet/identities-archive/` on a host,
 * mirroring the shape of `listIdentityKeysOnHost` at
 * `identity-artifact-reader.ts:1144` but rooted at the archive directory.
 *
 * WHY THIS EXISTS:
 *
 * Phase 122 (conversation-search-modal) D-08 mandates the search corpus
 * enumerate BOTH the live identities directory AND the archive directory
 * so an archived conversation can still be found by content search. The
 * archive dir is a metadata-only sibling created by Phase 115's retire
 * flow — the actual JSONL transcripts remain in `~/.claude/projects/`
 * (see Phase 122 Plan 122-01 Wave 0 empirical checkpoint, verdict
 * `go-same-helper`), so this helper only needs to enumerate the identity
 * KEYS. The caller (route in Plan 122-02 Task 2) then feeds each key to
 * `discoverIdentitySessionFile` — the same primitive used for live keys.
 *
 * LOCAL vs REMOTE BRANCH split mirrors listIdentityKeysOnHost byte-for-byte
 * so the two enumerators are behaviorally consistent from the caller's
 * perspective. LOCAL walks the bind-mounted host directory via node fs;
 * REMOTE shells out over an existing SSH connection with the same
 * `find ... 2>/dev/null || true` graceful-degrade idiom used in
 * `identity-artifact-reader.ts:1171`.
 *
 * GRACEFUL DEGRADE:
 *   - LOCAL, dir missing (ENOENT) → returns [].
 *   - REMOTE, dir missing → shell's `|| true` produces empty stdout → returns [].
 *
 * Both branches return keys that match `IDENTITY_KEY_RE` (`/^[a-z0-9_-]{1,64}$/`)
 * — same regex the identity reader uses, so downstream discovery calls receive
 * shell-safe strings by construction (defense-in-depth for
 * `discoverIdentitySessionFile`'s shell-quoting).
 *
 * ERROR PROPAGATION: on unexpected errors (e.g., permission-denied, SSH mid-
 * flight throws not swallowed by `|| true`), the error propagates. The caller
 * (route handler) wraps each host call in try/catch for per-host
 * silent-swallow, matching the discipline established at
 * `sessions.ts:319-566`.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Client as SSHClientType } from "ssh2";

import {
  IDENTITY_KEY_RE,
} from "./identity-artifact-reader.js";
import { execCommand } from "../ssh/tmux-helper.js";

/**
 * Hard ceiling on the REMOTE find exec — matches the sibling
 * `REMOTE_EXEC_TIMEOUT_MS` constant used by `identity-artifact-reader.ts`
 * (15s). A 15s cap is generous for a one-level directory walk; it exists to
 * keep a stuck SSH channel from stalling the whole fan-out beyond the
 * route's PER_HOST_TIMEOUT_MS (30s) enclosing budget.
 */
const REMOTE_LIST_TIMEOUT_MS = 15_000;

/**
 * Returns the local home root — matches the private `getLocalHomeRoot`
 * helper at `identity-artifact-reader.ts:267`. Duplicated here rather than
 * exported from the sibling module so the archive enumerator does not
 * couple to the reader's export surface.
 */
function getLocalHomeRoot(): string {
  return process.env.HOME_HOST_DIR || os.homedir();
}

/**
 * Returns the local archived-identities root directory.
 *
 * Precedence mirrors `getLocalIdentitiesRoot` — an env-var escape hatch for
 * tests (`IDENTITIES_ARCHIVE_HOST_DIR`) falls back to the HOME_HOST_DIR-
 * derived default (`<home>/fleet/identities-archive`).
 */
export function getLocalArchivedIdentitiesRoot(): string {
  return (
    process.env.IDENTITIES_ARCHIVE_HOST_DIR ||
    path.join(getLocalHomeRoot(), "fleet", "identities-archive")
  );
}

/**
 * List the archived-identity folder names on a host.
 *
 * LOCAL branch (conn === null):
 *   - Reads getLocalArchivedIdentitiesRoot() via fs.readdir({ withFileTypes: true }).
 *   - ENOENT → returns [] (host has never had any archived identity).
 *   - Keeps entries where isDirectory() === true AND IDENTITY_KEY_RE.test(name).
 *   - Returns sorted (lexicographic) array of names.
 *
 * REMOTE branch (conn !== null):
 *   - Runs `find "$HOME/fleet/identities-archive" -mindepth 1 -maxdepth 1
 *      -type d -printf '%f\n' 2>/dev/null || true` via a Promise.race
 *      timeout mirror of `execWithTimeout` (15s).
 *   - `|| true` handles "archive dir missing" as empty stdout.
 *   - Splits stdout by newline, trims, drops empty strings.
 *   - Filters through IDENTITY_KEY_RE.
 *   - Returns sorted array.
 *
 * @param conn — an open SSH client, or null for a LOCAL read.
 */
export async function listArchivedIdentityKeysOnHost(
  conn: SSHClientType | null,
): Promise<string[]> {
  if (conn === null) {
    // LOCAL branch
    const root = getLocalArchivedIdentitiesRoot();
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
      .filter((e) => e.isDirectory() && IDENTITY_KEY_RE.test(e.name))
      .map((e) => e.name)
      .sort();
  }

  // REMOTE branch — find prints basenames only; `|| true` swallows a missing
  // directory as empty stdout. The Promise.race timeout keeps a stuck SSH
  // channel from consuming the caller's per-host budget.
  const cmd =
    `find "$HOME/fleet/identities-archive" -mindepth 1 -maxdepth 1 -type d -printf '%f\\n' 2>/dev/null || true`;
  const stdout = await Promise.race([
    execCommand(conn, cmd),
    new Promise<string>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `listArchivedIdentityKeysOnHost: remote exec timeout after ${REMOTE_LIST_TIMEOUT_MS}ms`,
            ),
          ),
        REMOTE_LIST_TIMEOUT_MS,
      ),
    ),
  ]);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((name) => name.length > 0 && IDENTITY_KEY_RE.test(name))
    .sort();
}
