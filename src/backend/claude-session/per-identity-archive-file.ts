/**
 * per-identity-archive-file.ts — Phase 143 Plan 143-01 (D-08 archive-tree writer),
 * extended 2026-10-01 (identity-unarchive matrix-cred-location correction).
 *
 * Per-identity ARCHIVE-TREE file-touch primitive. Sibling of per-identity-file.ts
 * (which targets the LIVE tree). Deliberately a separate module — NOT a boolean
 * flag on the existing writer — because the whitelists differ cleanly:
 *   - Live tree:    ALLOWED_REL_PATHS = { "relay.json", ".pinned", ".archive-requested" }
 *   - Archive tree: ALLOWED_IDENTITY_ARCHIVE_REL_PATHS = { ".unarchive-requested", "relay.json" }
 *
 * Adding a "which tree?" parameter to a live-tree call site that only ever writes
 * one file obscures intent at the call site. Sibling functions are unambiguous.
 *
 * Exports:
 *   - writeIdentityArchiveFile(name, relPath, contents, opts)
 *   - readIdentityArchiveFile(name, relPath, opts)
 *   - ALLOWED_IDENTITY_ARCHIVE_REL_PATHS (bounded whitelist)
 *
 * Gates (defense-in-depth, both fire BEFORE any I/O):
 *   1. IDENTITY_KEY_RE /^[a-z0-9_-]{1,64}$/ — imported (not redefined) from
 *      ./identity-artifact-reader.js, the single source of truth (H1 lock:
 *      same regex writer + readers = no silent write-succeeds-read-fails
 *      divergence). See T-143-01-02.
 *   2. ALLOWED_IDENTITY_ARCHIVE_REL_PATHS — bounded whitelist. Any other value
 *      throws before I/O (T-143-01-01). Expansion to a new entry requires a
 *      deliberate CONTEXT-locked decision.
 *
 * 2026-10-01 whitelist expansion — "relay.json":
 *   The identity-unarchive matrix-cred-location correction moves Matrix
 *   reactivate + token mint + relay.json rewrite from the agent-supervisor
 *   into the backend `identity-unarchive.ts` route. The backend must rewrite
 *   the archived identity's relay.json (preserving mxid/password/base,
 *   replacing access_token + token alias with a freshly-minted one) BEFORE
 *   dropping the sentinel. This primitive owns archive-tree file writes;
 *   extending the whitelist here is the right vehicle rather than inventing
 *   a parallel writer. The chmod opt mirrors per-identity-file.ts's
 *   per-call lockdown shape (identity-birth Step 8 passes 0o600 for relay.json;
 *   the un-archive route does the same).
 *
 * Routing (mirrors per-identity-file.ts's LOCAL vs REMOTE split):
 *   - isLocalHostId(hostId) === true → LOCAL: node fs tmp+rename against
 *     getLocalArchivedIdentitiesRoot()/<name>/<relPath>. The
 *     getLocalArchivedIdentitiesRoot() helper is imported from
 *     ./list-archived-identity-keys.js (it is already exported there — NOT
 *     redefined here).
 *   - isLocalHostId(hostId) === false → REMOTE: SFTP via writeMarkdownFileAtomic
 *     (tmp+ext_openssh_rename discipline lives inside that helper — do NOT
 *     re-implement here per the one-audit-surface pattern). REMOTE reads use
 *     `cat` via execCommand (small files; same discipline as the role-frontmatter
 *     read in identity-unarchive.ts). REMOTE branches require opts.conn non-null;
 *     throws "conn required for remote host" verbatim if the caller violates
 *     this (contract-matches per-identity-file.ts:234).
 *     REMOTE path shape: `fleet/identities-archive/${name}/${relPath}` — a
 *     RELATIVE path; SFTP resolves against the SSH user's $HOME automatically.
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
import { execCommand } from "../ssh/tmux-helper.js";

// ---------------------------------------------------------------------------
// relPath whitelist
// ---------------------------------------------------------------------------

/**
 * Bounded set of basenames this archive-tree primitive is allowed to touch:
 *   - ".unarchive-requested" (D-08 original entry — presence-is-meaning sentinel)
 *   - "relay.json" (2026-10-01 — un-archive route rewrites token in-place before
 *     dropping the sentinel; see module docblock)
 *
 * Any other value throws before I/O (T-143-01-01).
 */
export const ALLOWED_IDENTITY_ARCHIVE_REL_PATHS: ReadonlySet<string> = new Set([
  ".unarchive-requested",
  "relay.json",
]);

/** Shell escape (mirrors per-identity-file.ts:95 shellSingleQuote). */
function shellSingleQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

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
      `invalid relPath — allowed: ${[...ALLOWED_IDENTITY_ARCHIVE_REL_PATHS].join(", ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public: writeIdentityArchiveFile
// ---------------------------------------------------------------------------

export interface WriteIdentityArchiveFileOpts {
  hostId: number;
  conn: SSHClientType | null;
  /**
   * Octal mode for post-write chmod. Omit to skip chmod entirely.
   *
   * The un-archive route passes 0o600 for relay.json rewrites to preserve
   * the lockdown identity-birth Step 8 established at birth time (the file
   * contains a Matrix access_token — S-1 lock parity).
   */
  chmod?: number;
}

/**
 * Write a file inside `~/fleet/identities-archive/<name>/<relPath>`.
 *
 * Callers:
 *   - POST un-archive endpoint (plan 143-04): drops `.unarchive-requested`
 *     after the Matrix reactivate + mint + relay.json rewrite steps succeed.
 *     The reconciler picks up the sentinel on its next tick and moves the
 *     folder back to the live tree.
 *   - POST un-archive endpoint (2026-10-01 matrix-cred-location correction):
 *     rewrites relay.json's access_token + token alias in-place with a
 *     freshly-minted token, passing chmod: 0o600 to preserve the lockdown.
 *
 * LOCAL branch (isLocalHostId(hostId) true): tmp+rename via node fs against
 *   getLocalArchivedIdentitiesRoot()/<name>/<relPath>.
 * REMOTE branch (otherwise): delegates to writeMarkdownFileAtomic — the
 *   SFTP tmp+atomic-rename discipline lives inside that helper (do NOT
 *   re-implement here per the one-audit-surface rule).
 *
 * Gates (defense-in-depth — T-143-01-01, T-143-01-02):
 *   1. IDENTITY_KEY_RE — excludes `.`, `/`, and every path-traversal shape.
 *   2. ALLOWED_IDENTITY_ARCHIVE_REL_PATHS whitelist.
 * Both fire BEFORE any I/O.
 *
 * chmod: when set, LOCAL uses fs.chmod on the final path; REMOTE issues
 *   `chmod <octal> <shell-quoted-path>` via execCommand — mirrors
 *   per-identity-file.ts's tagged-error shape so callers can match
 *   /chmod_<mode>_failed/ regardless of which branch executed.
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
    if (opts.chmod !== undefined) {
      const modeStr = opts.chmod.toString(8);
      try {
        await fs.chmod(finalPath, opts.chmod);
      } catch (chmodErr) {
        throw new Error(
          `chmod_${modeStr}_failed: ${chmodErr instanceof Error ? chmodErr.message : String(chmodErr)}`,
        );
      }
    }
    return;
  }

  // REMOTE branch
  if (opts.conn === null) {
    throw new Error("conn required for remote host");
  }
  const targetPath = remoteTargetPath(name, relPath);
  await writeMarkdownFileAtomic(opts.conn, targetPath, contents);
  if (opts.chmod !== undefined) {
    const modeStr = opts.chmod.toString(8);
    const quoted = shellSingleQuote(targetPath);
    try {
      await execCommand(opts.conn, `chmod ${modeStr} ${quoted}`);
    } catch (chmodErr) {
      throw new Error(
        `chmod_${modeStr}_failed: ${chmodErr instanceof Error ? chmodErr.message : String(chmodErr)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Public: readIdentityArchiveFile
// ---------------------------------------------------------------------------

export interface ReadIdentityArchiveFileOpts {
  hostId: number;
  conn: SSHClientType | null;
}

/**
 * Read a file inside `~/fleet/identities-archive/<name>/<relPath>`.
 *
 * Added 2026-10-01 for the identity-unarchive matrix-cred-location correction:
 * the POST un-archive endpoint reads the archived relay.json to extract mxid +
 * password before calling the Matrix admin API, then rewrites it with the
 * freshly-minted access_token via writeIdentityArchiveFile.
 *
 * LOCAL branch: fs.readFile.
 * REMOTE branch: `cat <path>` via execCommand (relay.json is small, and this
 *   mirrors the role-frontmatter read discipline already in identity-unarchive.ts).
 *
 * Same gates as the writer (IDENTITY_KEY_RE + whitelist). Returns UTF-8 string.
 * Throws ENOENT / cat-failure directly — callers decide whether to treat
 * missing-file as a precondition failure or an internal error.
 */
export async function readIdentityArchiveFile(
  name: string,
  relPath: string,
  opts: ReadIdentityArchiveFileOpts,
): Promise<string> {
  assertValidIdentityKey(name);
  assertValidRelPath(relPath);

  if (isLocalHostId(opts.hostId)) {
    const finalPath = localTargetPath(name, relPath);
    return await fs.readFile(finalPath, "utf-8");
  }

  if (opts.conn === null) {
    throw new Error("conn required for remote host");
  }
  const targetPath = remoteTargetPath(name, relPath);
  const quoted = shellSingleQuote(targetPath);
  return await execCommand(opts.conn, `cat ${quoted}`);
}
