/**
 * per-role-file.ts — Phase 133 Plan 133-01.
 *
 * Per-ROLE file-touch primitive. NEW sibling of per-identity-file.ts's
 * writeIdentityFile — deliberately a separate module rather than an
 * extension of the identity primitive (RESEARCH §5): the H1 write⇔read
 * parity lock on writeIdentityFile is identity-scoped by design, and
 * widening its ALLOWED_REL_PATHS whitelist to cover role paths would
 * blur that invariant. Roles get their own primitive with their own
 * bounded whitelist.
 *
 * Exports:
 *   - writeRoleFile(name, relPath, contents, opts)
 *   - ALLOWED_ROLE_REL_PATHS (bounded whitelist — currently one entry)
 *
 * Gates (defense-in-depth, both fire BEFORE any I/O):
 *   1. ROLE_NAME_PATTERN /^[a-z0-9-]+$/ — imported (not redefined) from
 *      utils/role-name-pattern.ts, the single source of truth for role
 *      names across the backend (Phase 90 Plan 90-10 consolidation).
 *   2. ALLOWED_ROLE_REL_PATHS whitelist — bounded to the ONE basename this
 *      phase writes (`.archive-requested`, D-05). Any other value throws
 *      before I/O. Additional entries must be added deliberately in a
 *      future phase (bounded-scope discipline per D-01).
 *
 * Routing (mirrors per-identity-file.ts's LOCAL vs REMOTE split):
 *   - isLocalHostId(hostId) === true → LOCAL: node fs tmp+rename against
 *     getLocalRolesRoot()/<name>/<relPath>. The getLocalRolesRoot() helper
 *     already honors the ROLES_HOST_DIR env override (containerized-Skynet
 *     bind-mount case, Phase 117 M-K) and falls back to
 *     <HOME_HOST_DIR>/fleet/roles → <os.homedir()>/fleet/roles.
 *   - isLocalHostId(hostId) === false → REMOTE: SFTP via
 *     writeMarkdownFileAtomic (tmp+ext_openssh_rename discipline lives
 *     inside that helper — do NOT re-implement here). REMOTE branch
 *     requires opts.conn non-null; throws "conn required for remote host"
 *     verbatim if the caller violates this (contract-matches
 *     per-identity-file.ts:234).
 *
 * No chmod:
 *   Unlike per-identity-file.ts (which supports opts.chmod for relay.json's
 *   0o600 lockdown), this module has no chmod field on its opts. Roles
 *   should not hold credentials as a hygiene invariant (per shape
 *   philosophy) and this phase adds no chmod call site.
 *
 * No parent-mkdir:
 *   The role directory must already exist when writeRoleFile is called.
 *   Role folder creation is roles-create.ts's job. Writing an
 *   `.archive-requested` sentinel on a non-existent role folder should
 *   fail — the invariant is "archive-requested only makes sense on an
 *   existing role folder" (D-16).
 *
 * Semantic contract:
 *   D-01 — single sentinel drop from the frontend
 *   D-05 — sentinel filename is exactly `.archive-requested`
 *   D-16 — roles live at ~/fleet/roles/<name>/, sibling of identities
 */

import path from "path";
import fs from "node:fs/promises";
import type { Client as SSHClientType } from "ssh2";

import {
  isLocalHostId,
  writeMarkdownFileAtomic,
  getLocalRolesRoot,
} from "./identity-artifact-reader.js";
import { ROLE_NAME_PATTERN } from "../utils/role-name-pattern.js";

// ---------------------------------------------------------------------------
// relPath whitelist (D-01 bounded-scope discipline)
// ---------------------------------------------------------------------------

/**
 * Bounded set of basenames the per-role file primitive is allowed to touch.
 * Any other value throws before I/O. Currently exactly ONE entry —
 * `.archive-requested` (the role archival sentinel per D-05). Additional
 * entries must be added via a deliberate CONTEXT-locked decision in a
 * future phase (belt-and-suspenders alongside the role-name gate).
 */
export const ALLOWED_ROLE_REL_PATHS: ReadonlySet<string> = new Set([
  ".archive-requested",
]);

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Local absolute path to the target file under the local roles root.
 * Delegates to getLocalRolesRoot() so ROLES_HOST_DIR env (bind-mount path
 * inside the Skynet container, e.g. `/fleet/roles`) is honored. Matches
 * the per-identity-file.ts:108-118 pattern (containerized-Skynet
 * bind-mount fix, adapted from 2026-09-11 arc): hardcoding
 * `path.join(os.homedir(), "fleet", "roles", ...)` would silently
 * write to `/home/node/fleet/roles/...` inside the container — ephemeral
 * overlay storage the host supervisor can't see.
 */
function localRoleTargetPath(name: string, relPath: string): string {
  return path.join(getLocalRolesRoot(), name, relPath);
}

/**
 * Remote path to the target file, relative to the SSH user's $HOME.
 *
 * PATH SHAPE: `fleet/roles/${name}/${relPath}` — a RELATIVE path (no
 * leading `/`, no `$HOME/` prefix). SFTP's `open`/`stat` resolve relative
 * paths against the SSH user's home directory automatically.
 *
 * ⚠️ Do NOT insert `$HOME/` as a literal prefix — SFTP does not expand
 * `$HOME` as a shell variable; it would treat it as a directory literally
 * named `$HOME` at the filesystem root and every write would ENOENT
 * silently. This is the same discipline that per-identity-file.ts:143
 * documents (Phase 107 hotfix 2026-09-12).
 */
function remoteRoleTargetPath(name: string, relPath: string): string {
  return `fleet/roles/${name}/${relPath}`;
}

// ---------------------------------------------------------------------------
// Gate helpers (defense-in-depth — HTTP layer is primary defense, this is
// belt-and-suspenders at the write layer against T-133-01-02 path traversal)
// ---------------------------------------------------------------------------

function assertValidRoleName(name: string): void {
  if (!ROLE_NAME_PATTERN.test(name)) {
    throw new Error(
      `invalid role name — must match ${ROLE_NAME_PATTERN.source}`,
    );
  }
}

function assertValidRoleRelPath(relPath: string): void {
  if (!ALLOWED_ROLE_REL_PATHS.has(relPath)) {
    throw new Error(
      `invalid relPath — allowed: ${[...ALLOWED_ROLE_REL_PATHS].join(", ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public: writeRoleFile
// ---------------------------------------------------------------------------

export interface WriteRoleFileOpts {
  hostId: number;
  conn: SSHClientType | null;
}

/**
 * Write a per-role file at `~/fleet/roles/<name>/<relPath>`.
 *
 * LOCAL branch (isLocalHostId(hostId) true): tmp+rename via node fs against
 *   getLocalRolesRoot()/<name>/<relPath>. Same discipline as
 *   per-identity-file.ts's LOCAL branch.
 * REMOTE branch (otherwise): delegates to writeMarkdownFileAtomic — the
 *   SFTP tmp+atomic-rename discipline lives inside that helper (do NOT
 *   re-implement here per the one-audit-surface pattern established in
 *   per-identity-file.ts D-05).
 *
 * Gates (defense-in-depth):
 *   1. ROLE_NAME_PATTERN /^[a-z0-9-]+$/ — rejects uppercase, underscore,
 *      dots, slashes, and every path-traversal shape.
 *   2. ALLOWED_ROLE_REL_PATHS whitelist — currently only `.archive-requested`.
 * Both fire BEFORE any I/O.
 *
 * Contents:
 *   Threaded through verbatim — empty string for `.archive-requested` is
 *   intentional (D-01: presence IS the meaning; body is never read).
 *
 * Does NOT parent-mkdir:
 *   Role folder creation is roles-create.ts's job. If the role folder
 *   doesn't exist yet, this write SHOULD fail (invariant: archive-requested
 *   only makes sense on an existing role folder — D-16).
 */
export async function writeRoleFile(
  name: string,
  relPath: string,
  contents: string,
  opts: WriteRoleFileOpts,
): Promise<void> {
  assertValidRoleName(name);
  assertValidRoleRelPath(relPath);

  if (isLocalHostId(opts.hostId)) {
    // LOCAL branch — tmp+rename via node fs
    const finalPath = localRoleTargetPath(name, relPath);
    const tmpPath = finalPath + ".tmp";
    await fs.writeFile(tmpPath, contents, "utf-8");
    await fs.rename(tmpPath, finalPath);
    return;
  }

  // REMOTE branch
  if (opts.conn === null) {
    throw new Error("conn required for remote host");
  }
  const targetPath = remoteRoleTargetPath(name, relPath);
  await writeMarkdownFileAtomic(opts.conn, targetPath, contents);
}
