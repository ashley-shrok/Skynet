/**
 * per-role-archive-file.ts — Phase 143 Plan 143-01 (D-08 archive-tree writer).
 *
 * Per-ROLE ARCHIVE-TREE file-touch primitive. Sibling of per-role-file.ts (which
 * targets the LIVE tree). Deliberately a separate module — NOT a boolean flag on
 * the existing writer — because the whitelists differ cleanly:
 *   - Live tree:    ALLOWED_ROLE_REL_PATHS  = { ".archive-requested" }
 *   - Archive tree: ALLOWED_ROLE_ARCHIVE_REL_PATHS = { ".unarchive-requested" }
 *
 * Different entry, different tree — hence sibling function rather than parameter.
 *
 * Exports:
 *   - writeRoleArchiveFile(name, relPath, contents, opts)
 *   - ALLOWED_ROLE_ARCHIVE_REL_PATHS (bounded whitelist — exactly one entry)
 *   - getLocalArchivedRolesRoot() (exported for reuse by plan 143-02's
 *     list-archived-roles.ts; mirrors the shape of getLocalArchivedIdentitiesRoot
 *     in list-archived-identity-keys.ts)
 *
 * Gates (defense-in-depth, both fire BEFORE any I/O):
 *   1. ROLE_NAME_PATTERN /^[a-z0-9-]+$/ — imported (not redefined) from
 *      ../utils/role-name-pattern.js, the single source of truth for role names
 *      across the backend (Phase 90 Plan 90-10 consolidation). Excludes `.`, `/`,
 *      uppercase, and every path-traversal shape. See T-143-01-03.
 *   2. ALLOWED_ROLE_ARCHIVE_REL_PATHS = { ".unarchive-requested" } — exactly one
 *      entry per D-08. Any other value throws before I/O.
 *
 * Routing (mirrors per-role-file.ts's LOCAL vs REMOTE split):
 *   - isLocalHostId(hostId) === true → LOCAL: node fs tmp+rename against
 *     getLocalArchivedRolesRoot()/<name>/<relPath>. The getLocalArchivedRolesRoot()
 *     helper honors the ROLES_ARCHIVE_HOST_DIR env override (containerized-Skynet
 *     bind-mount case) and falls back to <HOME_HOST_DIR>/fleet/roles-archive.
 *   - isLocalHostId(hostId) === false → REMOTE: SFTP via writeMarkdownFileAtomic
 *     (tmp+ext_openssh_rename discipline lives inside that helper — do NOT
 *     re-implement here per the one-audit-surface rule). REMOTE branch requires
 *     opts.conn non-null; throws "conn required for remote host" verbatim
 *     (contract-matches per-role-file.ts and per-identity-file.ts:234).
 *     REMOTE path shape: `fleet/roles-archive/${name}/${relPath}` — a RELATIVE path;
 *     SFTP resolves against the SSH user's $HOME automatically.
 *
 * No chmod:
 *   The sentinel is empty (presence IS the meaning); no secret material, no
 *   chmod parameter on opts. Matches per-role-file.ts's no-chmod invariant.
 *
 * No parent-mkdir:
 *   The archive folder MUST already exist — the reconciler moved it there.
 *   Writing a sentinel to a non-existent archive folder is a logic error; let
 *   the fs.writeFile ENOENT propagate so the caller discovers the invariant
 *   violation immediately.
 */

import path from "path";
import os from "os";
import fs from "node:fs/promises";
import type { Client as SSHClientType } from "ssh2";

import {
  isLocalHostId,
  writeMarkdownFileAtomic,
} from "./identity-artifact-reader.js";
import { ROLE_NAME_PATTERN } from "../utils/role-name-pattern.js";

// ---------------------------------------------------------------------------
// Local home root helper (private — not exported)
// ---------------------------------------------------------------------------

/**
 * Returns the local home root. Matches the private `getLocalHomeRoot` helper at
 * list-archived-identity-keys.ts:68. Kept private in both modules so neither
 * export surface grows an unconstrained "give me $HOME" escape hatch.
 */
function getLocalHomeRoot(): string {
  return process.env.HOME_HOST_DIR || os.homedir();
}

// ---------------------------------------------------------------------------
// Archive root helper (exported for plan 143-02's list-archived-roles.ts)
// ---------------------------------------------------------------------------

/**
 * Returns the local archived-roles root directory.
 *
 * Precedence mirrors getLocalArchivedIdentitiesRoot (list-archived-identity-keys.ts:79):
 *   ROLES_ARCHIVE_HOST_DIR env (bind-mount / test override) falls back to
 *   <HOME_HOST_DIR>/fleet/roles-archive → <os.homedir()>/fleet/roles-archive.
 *
 * Exported so plan 143-02's list-archived-roles.ts can import it rather than
 * defining a second copy.
 */
export function getLocalArchivedRolesRoot(): string {
  return (
    process.env.ROLES_ARCHIVE_HOST_DIR ||
    path.join(getLocalHomeRoot(), "fleet", "roles-archive")
  );
}

// ---------------------------------------------------------------------------
// relPath whitelist (D-08 narrower archive-tree whitelist)
// ---------------------------------------------------------------------------

/**
 * Bounded set of basenames this archive-tree primitive is allowed to touch.
 * Exactly ONE entry — ".unarchive-requested" per Phase 143 D-08. Any other
 * value throws before I/O. Adding an entry requires a deliberate CONTEXT-locked
 * decision in a future phase.
 */
export const ALLOWED_ROLE_ARCHIVE_REL_PATHS: ReadonlySet<string> = new Set([
  ".unarchive-requested",
]);

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Local absolute path to the target file under the local archived-roles root.
 * Delegates to getLocalArchivedRolesRoot() so ROLES_ARCHIVE_HOST_DIR env is honored.
 */
function localTargetPath(name: string, relPath: string): string {
  return path.join(getLocalArchivedRolesRoot(), name, relPath);
}

/**
 * Remote path to the target file, relative to the SSH user's $HOME.
 *
 * PATH SHAPE: `fleet/roles-archive/${name}/${relPath}` — a RELATIVE path (no
 * leading `/`, no `$HOME/` prefix). SFTP resolves relative paths against the SSH
 * user's home directory automatically.
 *
 * Do NOT insert `$HOME/` as a literal prefix — SFTP does not expand `$HOME` as
 * a shell variable (see per-identity-file.ts:143 Phase 107 hotfix).
 */
function remoteTargetPath(name: string, relPath: string): string {
  return `fleet/roles-archive/${name}/${relPath}`;
}

// ---------------------------------------------------------------------------
// Gate helpers
// ---------------------------------------------------------------------------

function assertValidRoleName(name: string): void {
  if (!ROLE_NAME_PATTERN.test(name)) {
    throw new Error(
      `invalid role name — must match ${ROLE_NAME_PATTERN.source}`,
    );
  }
}

function assertValidRelPath(relPath: string): void {
  if (!ALLOWED_ROLE_ARCHIVE_REL_PATHS.has(relPath)) {
    throw new Error(
      `invalid relPath — allowed: .unarchive-requested`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public: writeRoleArchiveFile
// ---------------------------------------------------------------------------

export interface WriteRoleArchiveFileOpts {
  hostId: number;
  conn: SSHClientType | null;
}

/**
 * Write a file inside `~/fleet/roles-archive/<name>/<relPath>`.
 *
 * Called by the POST un-archive endpoint (plan 143-04) to drop the
 * `.unarchive-requested` sentinel inside the archive folder. The reconciler
 * picks up the sentinel on its next tick and moves the folder back to the
 * live tree.
 *
 * LOCAL branch (isLocalHostId(hostId) true): tmp+rename via node fs against
 *   getLocalArchivedRolesRoot()/<name>/<relPath>.
 * REMOTE branch (otherwise): delegates to writeMarkdownFileAtomic — the
 *   SFTP tmp+atomic-rename discipline lives inside that helper (do NOT
 *   re-implement here per the one-audit-surface pattern).
 *
 * Gates (defense-in-depth — T-143-01-03):
 *   1. ROLE_NAME_PATTERN — rejects uppercase, underscores, dots, slashes, and
 *      every path-traversal shape.
 *   2. ALLOWED_ROLE_ARCHIVE_REL_PATHS whitelist — locked to one entry.
 * Both fire BEFORE any I/O.
 */
export async function writeRoleArchiveFile(
  name: string,
  relPath: string,
  contents: string,
  opts: WriteRoleArchiveFileOpts,
): Promise<void> {
  assertValidRoleName(name);
  assertValidRelPath(relPath);

  if (isLocalHostId(opts.hostId)) {
    // LOCAL branch — tmp+rename via node fs
    const finalPath = localTargetPath(name, relPath);
    const tmpPath = finalPath + ".tmp";
    await fs.writeFile(tmpPath, contents, "utf-8");
    await fs.rename(tmpPath, finalPath);
    return;
  }

  // REMOTE branch
  if (opts.conn === null) {
    throw new Error("conn required for remote host");
  }
  const targetPath = remoteTargetPath(name, relPath);
  await writeMarkdownFileAtomic(opts.conn, targetPath, contents);
}
