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

/**
 * Entry returned by `listArchivedIdentityEntriesOnHost`.
 *
 * `mtimeMs` is the archive folder's modification time in milliseconds since
 * epoch. Per Phase 128 § "The retire process's implicit 'when did I move this?'
 * is already the canonical signal", the folder mtime IS the retire-time —
 * archived folders are never touched post-retirement, so nothing else can shift
 * it. Used by the tiered pool ranker (rank-pool-candidates.ts) to sort recycled
 * names LRU-oldest-first.
 */
export interface ArchivedIdentityEntry {
  name: string;
  mtimeMs: number;
}

/**
 * List archived-identity folders with their mtimes — same shape/semantics as
 * `listArchivedIdentityKeysOnHost`, but each returned entry carries the archive
 * folder's mtime for LRU ranking (Phase 128 tiered pool selection).
 *
 * LOCAL branch (conn === null):
 *   - Reads getLocalArchivedIdentitiesRoot() via fs.readdir({withFileTypes:true}).
 *   - For each dir entry that matches IDENTITY_KEY_RE, fs.stat() to get mtime.
 *   - A stat failure on one folder skips that entry (does NOT fail the whole
 *     call) — matches the "graceful degrade on partial trouble" idiom.
 *   - ENOENT on the root dir returns [] (host has never archived anyone).
 *
 * REMOTE branch (conn !== null):
 *   - `find "$HOME/fleet/identities-archive" -mindepth 1 -maxdepth 1 -type d
 *      -printf '%f\t%T@\n' 2>/dev/null || true` — GNU find's %T@ is epoch
 *      seconds as a float, converted to milliseconds here.
 *   - `|| true` handles missing dir as empty stdout.
 *   - Any line that fails to parse (missing tab, non-numeric mtime, name that
 *      doesn't match IDENTITY_KEY_RE) is skipped — never fails the call.
 *
 * Errors on unexpected filesystem/SSH conditions propagate — callers wrap
 * per-host calls in try/catch for silent-swallow degradation.
 */
export async function listArchivedIdentityEntriesOnHost(
  conn: SSHClientType | null,
): Promise<ArchivedIdentityEntry[]> {
  if (conn === null) {
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
    const results: ArchivedIdentityEntry[] = [];
    for (const e of entries) {
      if (!e.isDirectory() || !IDENTITY_KEY_RE.test(e.name)) continue;
      try {
        const st = await fs.stat(path.join(root, e.name));
        results.push({ name: e.name, mtimeMs: st.mtimeMs });
      } catch {
        // Skip entries whose stat fails (permissions, race with removal).
        // A missing mtime is better handled as "not present" than as a hard
        // failure of the whole enumeration.
      }
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  // REMOTE — %T@ is GNU find's "epoch seconds with fractional part" (e.g.
  // 1737600000.1234567). Split on TAB, parse the float, multiply by 1000.
  const cmd =
    `find "$HOME/fleet/identities-archive" -mindepth 1 -maxdepth 1 -type d -printf '%f\\t%T@\\n' 2>/dev/null || true`;
  const stdout = await Promise.race([
    execCommand(conn, cmd),
    new Promise<string>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `listArchivedIdentityEntriesOnHost: remote exec timeout after ${REMOTE_LIST_TIMEOUT_MS}ms`,
            ),
          ),
        REMOTE_LIST_TIMEOUT_MS,
      ),
    ),
  ]);
  const results: ArchivedIdentityEntry[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const name = line.slice(0, tab);
    const mtimeStr = line.slice(tab + 1);
    if (!IDENTITY_KEY_RE.test(name)) continue;
    const mtimeSec = Number(mtimeStr);
    if (!Number.isFinite(mtimeSec)) continue;
    results.push({ name, mtimeMs: mtimeSec * 1000 });
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}
