/**
 * roles-create-core.ts — provision a role folder on a host. Shared by
 * POST /roles (the new-role dialog, roles-create.ts) and the role-request
 * file drop (spawn-requests/role-worker.ts).
 *
 * Callers validate input (role-input-validation.ts + their own cosmetic
 * gates) and own the connection; this module does the disk work:
 *   1. Collision-safe atomic mkdir with pretty-names auto-suffix
 *      (base, base-2, base-3, ...). An archived role holding the name also
 *      counts as a collision.
 *   2. Stub role file: frontmatter (displayName + cosmetics + avatar +
 *      users) and `# <slug> / ## Role / <description> / <seed comment>`.
 *   3. Optional avatar sibling `<slug>.<ext>`.
 *
 * `conn === null` is the LOCAL branch (Skynet's own host, via the container
 * bind mount). The container runs as root, so the LOCAL branch chowns what it
 * creates to the owner of the fleet dir — otherwise agents running as the
 * host user could not edit their own role file.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { SFTPWrapper } from "ssh2";
import type { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import {
  writeMarkdownFileAtomic,
  stringifyColorHueForYaml,
  getLocalRolesRoot,
} from "../../claude-session/identity-artifact-reader.js";
import { sshLogger } from "../../utils/logger.js";

type Conn = Awaited<ReturnType<typeof connectOneShot>>;

/** SSH exec race timeout — bounded so a hung remote can't stall the caller. */
const SSH_EXEC_TIMEOUT_MS = 5000;

const MAX_COLLISION_ATTEMPTS = 100;

/**
 * Seed comment embedded below the description so the first agent to hold
 * this role knows to flesh out the file on wake.
 *
 * Style constraints (verbatim from user — enforced by roles-create.test.ts):
 *   - Do NOT say "Skynet" (agents don't know what that is)
 *   - Do NOT reference §2 / §3 / "id skill" / SKILL.md (fragile skill refs)
 *   - Plain-terms instructions to the wake-up agent
 *   - Ends with "remove this comment" so the agent knows to clear it
 */
export const ROLE_STUB_SEED_COMMENT =
  "<!-- This role file was auto-generated with only a basic description. On first wake of an agent holding this role, please flesh out the role with standing directives, learned preferences, and a 10,000-foot view of the domain the role covers, then remove this comment. -->";

export interface CreateRoleInput {
  /** Derived slug (validateRoleDisplayName); may be auto-suffixed. */
  baseSlug: string;
  displayName: string;
  description: string;
  colorHue?: number;
  voice?: string;
  /** Visibility tag written as `users:` (multi-user hosts only). */
  users?: string[];
  /** Avatar bytes + extension; the filename becomes `<slug>.<ext>`. */
  avatar?: { ext: string; bytes: Buffer };
}

export type CreateRoleError =
  | "exec_failed"
  | "collision_cap_exhausted"
  | "write_failed"
  | "avatar_write_failed";

export type CreateRoleResult =
  | { ok: true; name: string; cosmetics: Record<string, unknown> }
  | { ok: false; error: CreateRoleError };

function execWithTimeout(conn: Conn, command: string): Promise<string> {
  return Promise.race([
    execCommand(conn, command),
    new Promise<string>((_, reject) =>
      setTimeout(
        () => reject(new Error(`SSH exec timeout after ${SSH_EXEC_TIMEOUT_MS}ms`)),
        SSH_EXEC_TIMEOUT_MS,
      ),
    ),
  ]);
}

/**
 * Promise-wrapped SFTP writeFile (conn.sftp → writeFile → end). Mirrors the
 * private sftpReadFile helper pattern in identity-artifact-reader.ts.
 */
async function sftpWriteFile(conn: Conn, remotePath: string, bytes: Buffer): Promise<void> {
  const sftp: SFTPWrapper = await new Promise<SFTPWrapper>((resolve, reject) => {
    conn.sftp((err: Error | undefined, s: SFTPWrapper) => {
      if (err) return reject(err);
      resolve(s);
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      sftp.writeFile(remotePath, bytes, (writeErr) => {
        if (writeErr) return reject(writeErr);
        resolve();
      });
    });
  } finally {
    try {
      sftp.end();
    } catch {
      /* best-effort — SFTP cleanup mustn't mask the underlying write result */
    }
  }
}

type MkdirOutcome = "ok" | "collide" | "fail";

/**
 * One atomic mkdir attempt. Plain (non `-p`) mkdir is atomic at the syscall
 * level, so a race loser sees a collision without touching the winner's dir.
 */
async function tryMkdirRole(conn: Conn | null, name: string): Promise<MkdirOutcome> {
  if (conn === null) {
    const rolesRoot = getLocalRolesRoot();
    const archiveDir = path.join(path.dirname(rolesRoot), "roles-archive", name);
    if (await pathExists(archiveDir)) return "collide";
    try {
      await fs.mkdir(path.join(rolesRoot, name));
      return "ok";
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === "EEXIST" ? "collide" : "fail";
    }
  }
  // Shell-side classifier emits a sentinel so we don't parse locale-dependent
  // stderr ("File exists" is English-only). On mkdir failure, a dir that now
  // exists is a collision; anything else is a real failure.
  const out = (
    await execWithTimeout(
      conn,
      `if [ -e "$HOME/fleet/roles-archive/${name}" ]; then echo __MKDIR_COLLIDE__; else mkdir "$HOME/fleet/roles/${name}" 2>/dev/null && echo __MKDIR_OK__ || { if [ -d "$HOME/fleet/roles/${name}" ]; then echo __MKDIR_COLLIDE__; else echo __MKDIR_FAIL__; fi; }; fi`,
    )
  ).trim();
  if (out === "__MKDIR_OK__") return "ok";
  if (out === "__MKDIR_COLLIDE__") return "collide";
  return "fail";
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** LOCAL branch: hand created paths to the fleet dir's owner (best-effort). */
async function chownToFleetOwner(paths: string[], logCtx: Record<string, unknown>): Promise<void> {
  try {
    const owner = await fs.stat(path.dirname(getLocalRolesRoot()));
    for (const p of paths) {
      await fs.chown(p, owner.uid, owner.gid);
    }
  } catch (err) {
    sshLogger.warn("roles-create: chown to fleet owner failed (local)", {
      operation: "roles_create_local_chown",
      ...logCtx,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Remove a role folder this call created, after a later step failed — a
 * half-made role (no file, or a file naming a missing avatar) would sit in
 * the roles list and push a retry onto `-2`. Best-effort.
 */
async function removeCreatedRoleDir(
  conn: Conn | null,
  name: string,
  logCtx: Record<string, unknown>,
): Promise<void> {
  try {
    if (conn === null) {
      await fs.rm(path.join(getLocalRolesRoot(), name), { recursive: true, force: true });
    } else {
      await execWithTimeout(conn, `rm -rf "$HOME/fleet/roles/${name}"`);
    }
  } catch (err) {
    sshLogger.warn("roles-create: cleanup of half-made role folder failed", {
      operation: "roles_create_cleanup",
      ...logCtx,
      name,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function buildRoleStubMarkdown(
  name: string,
  description: string,
  frontmatter: Record<string, unknown>,
): string {
  const bodyLines = `# ${name}\n\n## Role\n\n${description}\n\n${ROLE_STUB_SEED_COMMENT}\n`;
  if (Object.keys(frontmatter).length === 0) return bodyLines;
  return `---\n${yaml.dump(stringifyColorHueForYaml(frontmatter), {
    sortKeys: false,
    lineWidth: -1,
    noRefs: true,
    forceQuotes: false,
  })}---\n\n${bodyLines}`;
}

/**
 * Provision `~/fleet/roles/<slug>/` on the host behind `conn` (null = local).
 * Never throws for expected I/O failures — returns `{ok:false, error}` and
 * logs with context; callers map the error to their own surface.
 */
export async function createRoleOnHost(
  conn: Conn | null,
  input: CreateRoleInput,
  logCtx: { hostId: number; source: "dialog" | "role-request" },
): Promise<CreateRoleResult> {
  const branch = conn === null ? "local" : "remote";
  const { baseSlug } = input;

  // 1. Collision-safe mkdir with auto-suffix.
  if (conn !== null) {
    try {
      await execWithTimeout(conn, `mkdir -p "$HOME/fleet/roles"`);
    } catch (err) {
      sshLogger.warn("roles-create: parent roles-dir mkdir failed", {
        operation: "roles_create_atomic_mkdir",
        ...logCtx,
        baseSlug,
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, error: "exec_failed" };
    }
  } else {
    const rolesRoot = getLocalRolesRoot();
    if (!(await pathExists(rolesRoot))) {
      await fs.mkdir(rolesRoot, { recursive: true }).catch(() => {});
      await chownToFleetOwner([rolesRoot], logCtx);
    }
  }

  let name = baseSlug;
  for (let attempt = 0; ; ) {
    let outcome: MkdirOutcome;
    try {
      outcome = await tryMkdirRole(conn, name);
    } catch (err) {
      sshLogger.warn("roles-create: atomic mkdir exec failed", {
        operation: "roles_create_atomic_mkdir",
        ...logCtx,
        name,
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, error: "exec_failed" };
    }
    if (outcome === "ok") break;
    if (outcome === "fail") {
      sshLogger.warn("roles-create: atomic mkdir reported failure", {
        operation: "roles_create_atomic_mkdir",
        ...logCtx,
        name,
        branch,
      });
      return { ok: false, error: "exec_failed" };
    }
    attempt += 1;
    if (attempt >= MAX_COLLISION_ATTEMPTS) {
      sshLogger.error(
        "roles-create: collision auto-suffix cap exhausted",
        new Error("cap exhausted"),
        { operation: "roles_create_atomic_mkdir", ...logCtx, baseSlug, attempts: attempt },
      );
      return { ok: false, error: "collision_cap_exhausted" };
    }
    name = `${baseSlug}-${attempt + 1}`;
  }

  // 2. Resolve the role folder as an absolute path (SFTP doesn't tilde-expand).
  let roleDir: string;
  if (conn === null) {
    roleDir = path.join(getLocalRolesRoot(), name);
  } else {
    try {
      const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
      if (!remoteHome) throw new Error("could not resolve remote $HOME");
      roleDir = `${remoteHome}/fleet/roles/${name}`;
    } catch (err) {
      sshLogger.warn("roles-create: $HOME resolution failed", {
        operation: "roles_create_home",
        ...logCtx,
        error: err instanceof Error ? err.message : "Unknown",
      });
      await removeCreatedRoleDir(conn, name, logCtx);
      return { ok: false, error: "exec_failed" };
    }
  }

  // 3. Frontmatter: displayName first, then cosmetics, avatar, users.
  const cosmetics: Record<string, unknown> = { displayName: input.displayName };
  if (input.colorHue !== undefined) cosmetics.colorHue = input.colorHue;
  if (input.voice !== undefined) cosmetics.voice = input.voice;
  const avatarFilename = input.avatar ? `${name}.${input.avatar.ext}` : null;
  if (avatarFilename) cosmetics.avatar = avatarFilename;
  if (input.users && input.users.length > 0) cosmetics.users = input.users;

  const targetPath = `${roleDir}/${name}.md`;
  const stubMarkdown = buildRoleStubMarkdown(name, input.description, cosmetics);
  try {
    if (conn === null) {
      await fs.writeFile(`${targetPath}.tmp`, stubMarkdown, { mode: 0o644 });
      await fs.rename(`${targetPath}.tmp`, targetPath);
    } else {
      await writeMarkdownFileAtomic(conn, targetPath, stubMarkdown);
    }
  } catch (err) {
    sshLogger.error(
      "roles-create: role file write failed",
      err instanceof Error ? err : new Error(String(err)),
      { operation: "roles_create_sftp_write", ...logCtx, name, targetPath, branch },
    );
    await removeCreatedRoleDir(conn, name, logCtx);
    return { ok: false, error: "write_failed" };
  }

  // 4. Avatar sibling. Path is built from the server-derived slug + ext, so
  //    there is no injection surface (T-86-02-01).
  const createdLocal = [roleDir, targetPath];
  if (input.avatar && avatarFilename) {
    const avatarTargetPath = `${roleDir}/${avatarFilename}`;
    try {
      if (conn === null) {
        await fs.writeFile(avatarTargetPath, input.avatar.bytes);
        createdLocal.push(avatarTargetPath);
      } else {
        await sftpWriteFile(conn, avatarTargetPath, input.avatar.bytes);
      }
    } catch (err) {
      sshLogger.error(
        "roles-create: avatar write failed",
        err instanceof Error ? err : new Error(String(err)),
        {
          operation: "roles_create_sftp_avatar_write",
          ...logCtx,
          name,
          targetPath: avatarTargetPath,
          branch,
        },
      );
      await removeCreatedRoleDir(conn, name, logCtx);
      return { ok: false, error: "avatar_write_failed" };
    }
  }

  if (conn === null) {
    await chownToFleetOwner(createdLocal, { ...logCtx, name });
  }

  sshLogger.info("roles-create: role provisioned", {
    operation: "roles_create_provisioned",
    ...logCtx,
    name,
    baseSlug,
    branch,
    hasAvatar: avatarFilename !== null,
  });
  return { ok: true, name, cosmetics };
}
