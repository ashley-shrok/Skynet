/**
 * per-app-archive-file.ts — Phase 143 Plan 143-01 (D-08 archive-tree writer).
 *
 * Per-APP ARCHIVE-TREE file-touch primitive. Sibling of per-app-file.ts (which
 * targets the LIVE tree). Deliberately a separate module — NOT a boolean flag on
 * the existing writer — because the whitelists differ cleanly:
 *   - Live tree:    ALLOWED_APP_REL_PATHS  = { ".archive-requested" }
 *   - Archive tree: ALLOWED_APP_ARCHIVE_REL_PATHS = { ".unarchive-requested" }
 *
 * Different entry, different tree — hence sibling function rather than parameter.
 *
 * Exports:
 *   - writeAppArchiveFile(slug, relPath, contents, opts)
 *   - ALLOWED_APP_ARCHIVE_REL_PATHS (bounded whitelist — exactly one entry)
 *   - getLocalArchivedAppsRoot() (exported for reuse by plan 143-02's
 *     list-archived-apps.ts; mirrors the shape of getLocalArchivedRolesRoot
 *     in per-role-archive-file.ts)
 *
 * Gates (defense-in-depth, both fire BEFORE any I/O):
 *   1. APP_SLUG_RE /^[a-z0-9-]{1,64}$/ — imported (not redefined) from
 *      ./identity-artifact-reader.js, the canonical app-slug validator used
 *      by every other app-scoped surface (routes/apps.ts, app-pane-router.ts).
 *      Excludes `.`, `/`, uppercase, underscore, and every path-traversal shape.
 *      See T-143-01-04.
 *   2. ALLOWED_APP_ARCHIVE_REL_PATHS = { ".unarchive-requested" } — exactly one
 *      entry per D-08. Any other value throws before I/O.
 *
 * Routing (mirrors per-app-file.ts's LOCAL vs REMOTE split):
 *   - isLocalHostId(hostId) === true → LOCAL: node fs tmp+rename against
 *     getLocalArchivedAppsRoot()/<slug>/<relPath>. The getLocalArchivedAppsRoot()
 *     helper honors the APPS_ARCHIVE_HOST_DIR env override (containerized-Skynet
 *     bind-mount case) and falls back to <HOME_HOST_DIR>/fleet/apps-archive.
 *   - isLocalHostId(hostId) === false → REMOTE: SFTP via writeMarkdownFileAtomic
 *     (tmp+ext_openssh_rename discipline lives inside that helper — do NOT
 *     re-implement here per the one-audit-surface rule). REMOTE branch requires
 *     opts.conn non-null; throws "conn required for remote host" verbatim
 *     (contract-matches per-app-file.ts, per-role-file.ts, per-identity-file.ts:234).
 *     REMOTE path shape: `fleet/apps-archive/${slug}/${relPath}` — a RELATIVE path;
 *     SFTP resolves against the SSH user's $HOME automatically.
 *
 * No chmod:
 *   The sentinel is empty (presence IS the meaning); no secret material, no
 *   chmod parameter on opts. Matches per-app-file.ts's no-chmod invariant.
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
  APP_SLUG_RE,
  isLocalHostId,
  writeMarkdownFileAtomic,
} from "./identity-artifact-reader.js";

// ---------------------------------------------------------------------------
// Local home root helper (private — not exported)
// ---------------------------------------------------------------------------

/**
 * Returns the local home root. Matches the private `getLocalHomeRoot` helper at
 * list-archived-identity-keys.ts:68 and per-role-archive-file.ts. Kept private
 * in all three modules so no module's export surface grows an unconstrained
 * "give me $HOME" escape hatch.
 */
function getLocalHomeRoot(): string {
  return process.env.HOME_HOST_DIR || os.homedir();
}

// ---------------------------------------------------------------------------
// Archive root helper (exported for plan 143-02's list-archived-apps.ts)
// ---------------------------------------------------------------------------

/**
 * Returns the local archived-apps root directory.
 *
 * Precedence mirrors getLocalArchivedRolesRoot (per-role-archive-file.ts):
 *   APPS_ARCHIVE_HOST_DIR env (bind-mount / test override) falls back to
 *   <HOME_HOST_DIR>/fleet/apps-archive → <os.homedir()>/fleet/apps-archive.
 *
 * Exported so plan 143-02's list-archived-apps.ts can import it rather than
 * defining a second copy.
 */
export function getLocalArchivedAppsRoot(): string {
  return (
    process.env.APPS_ARCHIVE_HOST_DIR ||
    path.join(getLocalHomeRoot(), "fleet", "apps-archive")
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
export const ALLOWED_APP_ARCHIVE_REL_PATHS: ReadonlySet<string> = new Set([
  ".unarchive-requested",
]);

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Local absolute path to the target file under the local archived-apps root.
 * Delegates to getLocalArchivedAppsRoot() so APPS_ARCHIVE_HOST_DIR env is honored.
 */
function localTargetPath(slug: string, relPath: string): string {
  return path.join(getLocalArchivedAppsRoot(), slug, relPath);
}

/**
 * Remote path to the target file, relative to the SSH user's $HOME.
 *
 * PATH SHAPE: `fleet/apps-archive/${slug}/${relPath}` — a RELATIVE path (no
 * leading `/`, no `$HOME/` prefix). SFTP resolves relative paths against the SSH
 * user's home directory automatically.
 *
 * Do NOT insert `$HOME/` as a literal prefix — SFTP does not expand `$HOME` as
 * a shell variable (see per-identity-file.ts:143 Phase 107 hotfix).
 */
function remoteTargetPath(slug: string, relPath: string): string {
  return `fleet/apps-archive/${slug}/${relPath}`;
}

// ---------------------------------------------------------------------------
// Gate helpers
// ---------------------------------------------------------------------------

function assertValidAppSlug(slug: string): void {
  if (!APP_SLUG_RE.test(slug)) {
    throw new Error(
      `invalid slug — must match ${APP_SLUG_RE.source}`,
    );
  }
}

function assertValidRelPath(relPath: string): void {
  if (!ALLOWED_APP_ARCHIVE_REL_PATHS.has(relPath)) {
    throw new Error(
      `invalid relPath — allowed: .unarchive-requested`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public: writeAppArchiveFile
// ---------------------------------------------------------------------------

export interface WriteAppArchiveFileOpts {
  hostId: number;
  conn: SSHClientType | null;
}

/**
 * Write a file inside `~/fleet/apps-archive/<slug>/<relPath>`.
 *
 * Called by the POST un-archive endpoint (plan 143-04) to drop the
 * `.unarchive-requested` sentinel inside the archive folder. The reconciler
 * picks up the sentinel on its next tick and moves the folder back to the
 * live tree.
 *
 * LOCAL branch (isLocalHostId(hostId) true): tmp+rename via node fs against
 *   getLocalArchivedAppsRoot()/<slug>/<relPath>.
 * REMOTE branch (otherwise): delegates to writeMarkdownFileAtomic — the
 *   SFTP tmp+atomic-rename discipline lives inside that helper (do NOT
 *   re-implement here per the one-audit-surface pattern).
 *
 * Gates (defense-in-depth — T-143-01-04):
 *   1. APP_SLUG_RE — rejects uppercase, underscores, dots, slashes, and every
 *      path-traversal shape.
 *   2. ALLOWED_APP_ARCHIVE_REL_PATHS whitelist — locked to one entry.
 * Both fire BEFORE any I/O.
 */
export async function writeAppArchiveFile(
  slug: string,
  relPath: string,
  contents: string,
  opts: WriteAppArchiveFileOpts,
): Promise<void> {
  assertValidAppSlug(slug);
  assertValidRelPath(relPath);

  if (isLocalHostId(opts.hostId)) {
    // LOCAL branch — tmp+rename via node fs
    const finalPath = localTargetPath(slug, relPath);
    const tmpPath = finalPath + ".tmp";
    await fs.writeFile(tmpPath, contents, "utf-8");
    await fs.rename(tmpPath, finalPath);
    return;
  }

  // REMOTE branch
  if (opts.conn === null) {
    throw new Error("conn required for remote host");
  }
  const targetPath = remoteTargetPath(slug, relPath);
  await writeMarkdownFileAtomic(opts.conn, targetPath, contents);
}
