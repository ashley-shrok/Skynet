/**
 * per-identity-file.ts — Phase 92 Plan 92-01 (D-05 wire generalization).
 *
 * Per-identity file-touch primitive. Generalizes the identity-birth SFTP
 * wire (Phase 77) into ONE audit surface with two callers:
 *   - identity-birth-orchestrator Step 8 (existing — refactored in Task 2)
 *   - pin-action write/remove/read (new — wired in Plan 02)
 *
 * Exports three async functions:
 *   - writeIdentityFile(name, relPath, contents, opts)
 *   - removeIdentityFile(name, relPath, opts)
 *   - identityFileExists(name, relPath, opts)
 *
 * H1 write⇔read parity lock (see plan 92-01 CRITICAL invariant):
 *   The identityKey gate uses the STRICTER identity-artifact-reader regex
 *   IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/ — imported (not redefined) from
 *   identity-artifact-reader so a single source of truth guarantees that
 *   every key this primitive accepts is also readable by every existing
 *   on-disk reader (agent-supervisor.sh `[ -f $dir/.pinned ]`, publicIdentity
 *   fanout, this module's own identityFileExists probe).
 *
 *   The looser identity-birth.ts:64 route-level regex — which permits
 *   the extra characters `.`, `/`, `+`, `=` — is intentionally NOT used
 *   here. Using it would open a silent write-succeeds-read-fails
 *   divergence class of bug (loose write vs strict read).
 *
 * relPath whitelist:
 *   ALLOWED_REL_PATHS = { "relay.json", ".pinned" } — bounded to the two
 *   file basenames this phase's callers touch (D-01 filename lock). Any
 *   other value throws before I/O — belt-and-suspenders vs identityKey
 *   traversal (the reader regex already excludes `.` and `/` characters).
 *
 * Routing (mirrors identity-artifact-reader's LOCAL vs REMOTE split):
 *   - isLocalHostId(hostId) === true → LOCAL: node fs against
 *     `${os.homedir()}/fleet/identities/${name}/${relPath}` (tmp+rename
 *     for writes, unlink for removes, stat for exists).
 *   - isLocalHostId(hostId) === false → REMOTE: SFTP via
 *     writeMarkdownFileAtomic (writes; the atomic tmp+POSIX-rename discipline
 *     lives inside that helper — do NOT re-implement here per D-05
 *     one-audit-surface), sftp.unlink (removes), sftp.stat (exists). All REMOTE branches
 *     require opts.conn non-null; the primitive throws "conn required for
 *     remote host" if the caller violates this.
 *
 * chmod:
 *   opts.chmod is opt-in. Identity-birth's Step 8 passes 0o600 (relay.json
 *   contains a Matrix access_token — S-1 lock). Pin action passes nothing
 *   (`.pinned` is an empty presence-only sentinel, no secret material —
 *   parallel to `.no-dormancy` treatment).
 */

import os from "os";
import path from "path";
import fs from "node:fs/promises";
import type { Client as SSHClientType } from "ssh2";
type SFTPWrapper = import("ssh2").SFTPWrapper;

import {
  IDENTITY_KEY_RE,
  isLocalHostId,
  writeMarkdownFileAtomic,
  getLocalIdentitiesRoot,
} from "./identity-artifact-reader.js";
import { execCommand } from "../ssh/tmux-helper.js";

// Re-export IDENTITY_KEY_RE for test observability (Test 11 imports from BOTH
// this module and identity-artifact-reader and asserts .source + .flags parity).
// The regex VALUE lives in identity-artifact-reader.ts:174 — this line is a
// pure re-export, never a redefinition. H1 lock.
export { IDENTITY_KEY_RE };

// ---------------------------------------------------------------------------
// relPath whitelist (D-01 filename lock)
// ---------------------------------------------------------------------------

/**
 * The bounded set of basenames the per-identity file primitive is allowed to
 * touch. Any other value throws before I/O. Kept intentionally tiny — only
 * "relay.json" (identity-birth Step 8) and ".pinned" (pin action, Plan 02)
 * are legitimate targets under D-05's one-audit-surface rule.
 */
export const ALLOWED_REL_PATHS: ReadonlySet<string> = new Set([
  "relay.json",
  ".pinned",
]);

// ---------------------------------------------------------------------------
// Shell escape (mirrors identity-artifact-reader.ts:336 shellEscape)
// ---------------------------------------------------------------------------

function shellSingleQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Local absolute path to the target file under the current user's HOME.
 * Uses os.homedir() (NOT $HOME) for test-determinism — mirrors the
 * getLocalIdentitiesRoot pattern at identity-artifact-reader.ts:217.
 */
function localTargetPath(name: string, relPath: string): string {
  // 2026-09-11: use getLocalIdentitiesRoot() so IDENTITIES_HOST_DIR env
  // (bind-mount path inside the Skynet container, e.g. `/fleet/identities`)
  // is honored. Prior `path.join(os.homedir(), "fleet", "identities", ...)`
  // hardcoded the fallback and wrote to `/home/node/fleet/identities/...`
  // inside the container — ephemeral overlay storage the supervisor on
  // the host can't see. Symptom: Step 8's `relay.json.tmp` fs.writeFile
  // ENOENT'd because the parent dir only existed under the (correct)
  // bind-mounted path.
  return path.join(getLocalIdentitiesRoot(), name, relPath);
}

/**
 * Remote path to the target file under $HOME.
 *
 * PATH SHAPE: `$HOME/fleet/identities/${name}/${relPath}` — the
 * `$HOME` prefix is passed to the SFTP layer as a literal string, NOT
 * resolved via `echo $HOME`. Phase 96 migrated this from the legacy
 * hidden-dot-claude tree to the fleet tree (D-01).
 *
 * Note: identity-artifact-reader's OTHER writers (writeIdentityFile at :2604,
 * writeAvatarSiblingFile at :2084) DO resolve $HOME via execCommand — a
 * different design choice for a different set of files. This primitive
 * matches Phase 77 Step 8's literal-$HOME shape because THAT is the wire
 * being generalized.
 */
function remoteTargetPath(name: string, relPath: string): string {
  return `$HOME/fleet/identities/${name}/${relPath}`;
}

// ---------------------------------------------------------------------------
// Gate helpers (H1 fix: same regex writer + readers, single source of truth)
// ---------------------------------------------------------------------------

function assertValidIdentityKey(name: string): void {
  if (!IDENTITY_KEY_RE.test(name)) {
    throw new Error(
      `invalid identityKey — must match ${IDENTITY_KEY_RE.source}`,
    );
  }
}

function assertValidRelPath(relPath: string): void {
  if (!ALLOWED_REL_PATHS.has(relPath)) {
    throw new Error(
      `invalid relPath — allowed: ${[...ALLOWED_REL_PATHS].join(", ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public: writeIdentityFile
// ---------------------------------------------------------------------------

export interface WriteIdentityFileOpts {
  hostId: number;
  conn: SSHClientType | null;
  /** Octal mode for post-write chmod. Omit to skip chmod entirely. */
  chmod?: number;
}

/**
 * Write a per-identity file at `~/fleet/identities/<name>/<relPath>`.
 *
 * LOCAL branch (isLocalHostId(hostId) true): tmp+rename via node fs, mirrors
 *   identity-artifact-reader's LOCAL writers.
 * REMOTE branch (otherwise): delegates to writeMarkdownFileAtomic — same
 *   SFTP tmp+atomic-rename discipline identity-birth Step 8 uses today. Do
 *   NOT re-implement the SFTP tmp+rename logic here (D-05: one audit surface).
 *
 * Gates (defense-in-depth):
 *   1. IDENTITY_KEY_RE (imported from identity-artifact-reader) — H1 lock.
 *   2. ALLOWED_REL_PATHS whitelist — bounded to {relay.json, .pinned}.
 * Both fire BEFORE any I/O.
 *
 * Contents:
 *   Threaded through verbatim — empty string for `.pinned` is intentional
 *   (D-01: presence IS the meaning; body is never read). No `contents || " "`
 *   fallback.
 *
 * chmod:
 *   opts.chmod is opt-in. When set, LOCAL uses fs.chmod on the final path;
 *   REMOTE issues `chmod <octal> <shell-quoted-path>` via execCommand — same
 *   shape identity-birth-orchestrator's Step 8 uses today for relay.json 0o600.
 */
export async function writeIdentityFile(
  name: string,
  relPath: string,
  contents: string,
  opts: WriteIdentityFileOpts,
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
        // Tagged failure — same shape as REMOTE branch so callers can match
        // /chmod_<mode>_failed/ regardless of which branch executed.
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
      // Preserve the identity-birth-orchestrator's pre-refactor tagged
      // failure semantics (Test C2 in identity-birth-orchestrator.test.ts
      // asserts /chmod_<mode>_failed/). Rewrap so a mode-specific tag lands
      // in the runStep(8) rejection reason instead of the raw ssh2 message.
      throw new Error(
        `chmod_${modeStr}_failed: ${chmodErr instanceof Error ? chmodErr.message : String(chmodErr)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Public: removeIdentityFile
// ---------------------------------------------------------------------------

export interface RemoveIdentityFileOpts {
  hostId: number;
  conn: SSHClientType | null;
}

/**
 * Remove a per-identity file. Idempotent: absent-file (ENOENT / SSH_FX_NO_SUCH_FILE)
 * errors are swallowed silently — unpinning a not-yet-pinned identity is a
 * legitimate no-op per D-01's "presence is meaning" semantics.
 *
 * Any OTHER error propagates.
 */
export async function removeIdentityFile(
  name: string,
  relPath: string,
  opts: RemoveIdentityFileOpts,
): Promise<void> {
  assertValidIdentityKey(name);
  assertValidRelPath(relPath);

  if (isLocalHostId(opts.hostId)) {
    // LOCAL branch
    const finalPath = localTargetPath(name, relPath);
    try {
      await fs.unlink(finalPath);
    } catch (err) {
      if (isEnoent(err)) return;
      throw err;
    }
    return;
  }

  // REMOTE branch
  if (opts.conn === null) {
    throw new Error("conn required for remote host");
  }
  const targetPath = remoteTargetPath(name, relPath);
  await removeRemoteFileIdempotent(opts.conn, targetPath);
}

async function removeRemoteFileIdempotent(
  conn: SSHClientType,
  targetPath: string,
): Promise<void> {
  const sftp: SFTPWrapper = await new Promise<SFTPWrapper>(
    (resolve, reject) => {
      conn.sftp((err, s) => {
        if (err) return reject(err);
        resolve(s);
      });
    },
  );
  try {
    await new Promise<void>((resolve, reject) => {
      sftp.unlink(targetPath, (err) => {
        if (err && !isEnoent(err)) return reject(err);
        resolve();
      });
    });
  } finally {
    sftp.end();
  }
}

// ---------------------------------------------------------------------------
// Public: identityFileExists
// ---------------------------------------------------------------------------

export type IdentityFileExistsOpts = RemoveIdentityFileOpts;

/**
 * Probe whether a per-identity file exists. Fail-closed: any stat error
 * (ENOENT, EACCES, network, whatever) returns false so a transient failure
 * does not accidentally paint an identity as pinned when it isn't.
 *
 * The read-side gate mirrors agent-supervisor.sh's `[ -f $dir/.sentinel ]`
 * one-liner semantics.
 */
export async function identityFileExists(
  name: string,
  relPath: string,
  opts: IdentityFileExistsOpts,
): Promise<boolean> {
  assertValidIdentityKey(name);
  assertValidRelPath(relPath);

  if (isLocalHostId(opts.hostId)) {
    const finalPath = localTargetPath(name, relPath);
    try {
      await fs.stat(finalPath);
      return true;
    } catch {
      return false;
    }
  }

  if (opts.conn === null) {
    throw new Error("conn required for remote host");
  }
  const targetPath = remoteTargetPath(name, relPath);
  return await remoteStatExists(opts.conn, targetPath);
}

async function remoteStatExists(
  conn: SSHClientType,
  targetPath: string,
): Promise<boolean> {
  const sftp: SFTPWrapper = await new Promise<SFTPWrapper>(
    (resolve, reject) => {
      conn.sftp((err, s) => {
        if (err) return reject(err);
        resolve(s);
      });
    },
  );
  try {
    return await new Promise<boolean>((resolve) => {
      sftp.stat(targetPath, (err) => {
        // Fail-closed: any error (ENOENT / EACCES / network / etc.) → false.
        // Rationale (plan 92-01 Test 8): a stat failure MUST NOT paint an
        // identity as pinned. Better to under-report than over-report.
        if (err) return resolve(false);
        resolve(true);
      });
    });
  } finally {
    sftp.end();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isEnoent(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  // Node fs errors: string "ENOENT"; ssh2 SFTP errors: numeric 2 (SSH_FX_NO_SUCH_FILE).
  return code === "ENOENT" || code === 2;
}
