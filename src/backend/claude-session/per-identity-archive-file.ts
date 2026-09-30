/**
 * per-identity-archive-file.ts — Phase 143 Plan 143-01 (D-08 archive-tree writer).
 *
 * Per-identity ARCHIVE-TREE file-touch primitive. Sibling of per-identity-file.ts
 * (which targets the LIVE tree). Deliberately a separate module — NOT a boolean
 * flag on the existing writer — because the whitelists differ cleanly:
 *   - Live tree:    ALLOWED_REL_PATHS = { "relay.json", ".pinned", ".archive-requested" }
 *   - Archive tree: ALLOWED_IDENTITY_ARCHIVE_REL_PATHS = { ".unarchive-requested" }
 *
 * Adding a "which tree?" parameter to a live-tree call site that only ever writes
 * one file obscures intent at the call site. Sibling functions are unambiguous.
 *
 * Exports:
 *   - writeIdentityArchiveFile(name, relPath, contents, opts)
 *   - ALLOWED_IDENTITY_ARCHIVE_REL_PATHS (bounded whitelist — exactly one entry)
 *
 * Gates (defense-in-depth, both fire BEFORE any I/O):
 *   1. IDENTITY_KEY_RE /^[a-z0-9_-]{1,64}$/ — imported (not redefined) from
 *      ./identity-artifact-reader.js, the single source of truth (H1 lock:
 *      same regex writer + readers = no silent write-succeeds-read-fails
 *      divergence). See T-143-01-02.
 *   2. ALLOWED_IDENTITY_ARCHIVE_REL_PATHS = { ".unarchive-requested" } — exactly
 *      one entry per D-08. Any other value throws before I/O (T-143-01-01).
 *
 * Routing (mirrors per-identity-file.ts's LOCAL vs REMOTE split):
 *   - isLocalHostId(hostId) === true → LOCAL: node fs tmp+rename against
 *     getLocalArchivedIdentitiesRoot()/<name>/<relPath>. The
 *     getLocalArchivedIdentitiesRoot() helper is imported from
 *     ./list-archived-identity-keys.js (it is already exported there — NOT
 *     redefined here).
 *   - isLocalHostId(hostId) === false → REMOTE: SFTP via writeMarkdownFileAtomic
 *     (tmp+ext_openssh_rename discipline lives inside that helper — do NOT
 *     re-implement here per the one-audit-surface pattern). REMOTE branch
 *     requires opts.conn non-null; throws "conn required for remote host" verbatim
 *     if the caller violates this (contract-matches per-identity-file.ts:234).
 *     REMOTE path shape: `fleet/identities-archive/${name}/${relPath}` — a
 *     RELATIVE path; SFTP resolves against the SSH user's $HOME automatically.
 *
 * No chmod:
 *   The sentinel is empty (presence IS the meaning); no secret material, no
 *   chmod parameter on opts.
 *
 * No parent-mkdir:
 *   The archive folder MUST already exist — the reconciler moved it there.
 *   Writing a sentinel to a non-existent archive folder is a logic error; let
 *   the fs.writeFile ENOENT propagate so the caller discovers the invariant
 *   violation immediately.
 */

import path from "path";
import fs from "node:fs/promises";
import type { Client as SSHClientType } from "ssh2";

import {
  IDENTITY_KEY_RE,
  isLocalHostId,
  writeMarkdownFileAtomic,
} from "./identity-artifact-reader.js";
import { getLocalArchivedIdentitiesRoot } from "./list-archived-identity-keys.js";

// ---------------------------------------------------------------------------
// relPath whitelist (D-08 narrower archive-tree whitelist)
// ---------------------------------------------------------------------------

/**
 * Bounded set of basenames this archive-tree primitive is allowed to touch.
 * Exactly ONE entry — ".unarchive-requested" per Phase 143 D-08. Any other
 * value throws before I/O (T-143-01-01). Adding an entry requires a deliberate
 * CONTEXT-locked decision in a future phase.
 */
export const ALLOWED_IDENTITY_ARCHIVE_REL_PATHS: ReadonlySet<string> = new Set([
  ".unarchive-requested",
]);

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Local absolute path to the target file under the local archived-identities root.
 * Delegates to getLocalArchivedIdentitiesRoot() (imported from
 * list-archived-identity-keys.ts) so IDENTITIES_ARCHIVE_HOST_DIR env is honored.
 */
function localTargetPath(name: string, relPath: string): string {
  return path.join(getLocalArchivedIdentitiesRoot(), name, relPath);
}

/**
 * Remote path to the target file, relative to the SSH user's $HOME.
 *
 * PATH SHAPE: `fleet/identities-archive/${name}/${relPath}` — a RELATIVE path
 * (no leading `/`, no `$HOME/` prefix). SFTP's `open` resolves relative paths
 * against the SSH user's home directory automatically.
 *
 * Do NOT insert `$HOME/` as a literal prefix — SFTP does not expand `$HOME` as
 * a shell variable (see per-identity-file.ts:143 Phase 107 hotfix).
 */
function remoteTargetPath(name: string, relPath: string): string {
  return `fleet/identities-archive/${name}/${relPath}`;
}

// ---------------------------------------------------------------------------
// Gate helpers
// ---------------------------------------------------------------------------

function assertValidIdentityKey(name: string): void {
  if (!IDENTITY_KEY_RE.test(name)) {
    throw new Error(
      `invalid identity key — must match ${IDENTITY_KEY_RE.source}`,
    );
  }
}

function assertValidRelPath(relPath: string): void {
  if (!ALLOWED_IDENTITY_ARCHIVE_REL_PATHS.has(relPath)) {
    throw new Error(
      `invalid relPath — allowed: .unarchive-requested`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public: writeIdentityArchiveFile
// ---------------------------------------------------------------------------

export interface WriteIdentityArchiveFileOpts {
  hostId: number;
  conn: SSHClientType | null;
}

/**
 * Write a file inside `~/fleet/identities-archive/<name>/<relPath>`.
 *
 * Called by the POST un-archive endpoint (plan 143-04) to drop the
 * `.unarchive-requested` sentinel inside the archive folder. The reconciler
 * picks up the sentinel on its next tick and moves the folder back to the
 * live tree.
 *
 * LOCAL branch (isLocalHostId(hostId) true): tmp+rename via node fs against
 *   getLocalArchivedIdentitiesRoot()/<name>/<relPath>.
 * REMOTE branch (otherwise): delegates to writeMarkdownFileAtomic — the
 *   SFTP tmp+atomic-rename discipline lives inside that helper (do NOT
 *   re-implement here per the one-audit-surface rule).
 *
 * Gates (defense-in-depth — T-143-01-01, T-143-01-02):
 *   1. IDENTITY_KEY_RE — excludes `.`, `/`, and every path-traversal shape.
 *   2. ALLOWED_IDENTITY_ARCHIVE_REL_PATHS whitelist — locked to one entry.
 * Both fire BEFORE any I/O.
 */
export async function writeIdentityArchiveFile(
  name: string,
  relPath: string,
  contents: string,
  opts: WriteIdentityArchiveFileOpts,
): Promise<void> {
  assertValidIdentityKey(name);
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
