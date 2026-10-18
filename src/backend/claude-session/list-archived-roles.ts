/**
 * list-archived-roles.ts — Phase 143 Plan 143-02 (D-06 companion primitives).
 *
 * Enumerates role folder names under `~/fleet/roles-archive/` on a host,
 * mirroring the shape of `listArchivedIdentityKeysOnHost` at
 * `list-archived-identity-keys.ts:106-155` byte-for-byte but rooted at the
 * roles archive directory.
 *
 * WHY THIS EXISTS:
 *
 * Phase 143 D-06 specifies that the identity list endpoint exposes the
 * existing primitive at `list-archived-identity-keys.ts`. Roles + apps list
 * endpoints are NEW — companion internal primitives are added here and in
 * `list-archived-apps.ts`. The GET list route (plan 143-03) calls this
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
 * Both branches return names that match `ROLE_NAME_PATTERN` (`/^[a-z0-9-]+$/`)
 * — same regex role-scoped surfaces use, so downstream callers receive
 * shell-safe strings by construction (T-143-02-02).
 *
 * ERROR PROPAGATION: on unexpected errors, the error propagates. The caller
 * (route handler) wraps each host call in try/catch for per-host
 * silent-swallow, matching the discipline established at `sessions.ts:319-566`.
 *
 * Root helper: `getLocalArchivedRolesRoot` is IMPORTED from
 * `./per-role-archive-file.js` (plan 143-01 task 2 exports it) — NOT
 * redefined here — so the archive path is consistent between writer + lister.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Client as SSHClientType } from "ssh2";

import { getLocalArchivedRolesRoot } from "./per-role-archive-file.js";
import { ROLE_NAME_PATTERN } from "../utils/role-name-pattern.js";
import { execCommand } from "../ssh/tmux-helper.js";
import { readRoleDescriptionFromMarkdown } from "../utils/role-description.js";
import { sshLogger } from "../utils/logger.js";

/**
 * Hard ceiling on the REMOTE find exec — matches the sibling
 * `REMOTE_LIST_TIMEOUT_MS` constant used by `list-archived-identity-keys.ts`
 * (15s). A 15s cap is generous for a one-level directory walk; it exists to
 * keep a stuck SSH channel from stalling the whole fan-out beyond the
 * route's PER_HOST_TIMEOUT_MS (30s) enclosing budget.
 */
const REMOTE_LIST_TIMEOUT_MS = 15_000;

/**
 * List the archived-role folder names on a host.
 *
 * LOCAL branch (conn === null):
 *   - Reads getLocalArchivedRolesRoot() via fs.readdir({ withFileTypes: true }).
 *   - ENOENT → returns [] (host has never had any archived role).
 *   - Keeps entries where isDirectory() === true AND ROLE_NAME_PATTERN.test(name).
 *   - Returns sorted (lexicographic) array of names.
 *
 * REMOTE branch (conn !== null):
 *   - Runs `find "$HOME/fleet/roles-archive" -mindepth 1 -maxdepth 1
 *      -type d -printf '%f\n' 2>/dev/null || true` via a Promise.race
 *      timeout mirror of `execWithTimeout` (15s).
 *   - `|| true` handles "archive dir missing" as empty stdout.
 *   - Splits stdout by newline, trims, drops empty strings.
 *   - Filters through ROLE_NAME_PATTERN.
 *   - Returns sorted array.
 *
 * @param conn — an open SSH client, or null for a LOCAL read.
 */
export async function listArchivedRolesOnHost(
  conn: SSHClientType | null,
): Promise<string[]> {
  if (conn === null) {
    // LOCAL branch
    const root = getLocalArchivedRolesRoot();
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
      .filter((e) => e.isDirectory() && ROLE_NAME_PATTERN.test(e.name))
      .map((e) => e.name)
      .sort();
  }

  // REMOTE branch — find prints basenames only; `|| true` swallows a missing
  // directory as empty stdout. The Promise.race timeout keeps a stuck SSH
  // channel from consuming the caller's per-host budget.
  const cmd =
    `find "$HOME/fleet/roles-archive" -mindepth 1 -maxdepth 1 -type d -printf '%f\\n' 2>/dev/null || true`;
  const stdout = await Promise.race([
    execCommand(conn, cmd),
    new Promise<string>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `listArchivedRolesOnHost: remote exec timeout after ${REMOTE_LIST_TIMEOUT_MS}ms`,
            ),
          ),
        REMOTE_LIST_TIMEOUT_MS,
      ),
    ),
  ]);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((name) => name.length > 0 && ROLE_NAME_PATTERN.test(name))
    .sort();
}

export interface ArchivedRoleSummary {
  name: string;
  /** Frontmatter `description:` of the archived role file; "" when absent. */
  description: string;
}

/**
 * listArchivedRolesOnHost plus each archived role's frontmatter description.
 * Descriptions are best-effort: a role file that can't be read (or a failed
 * batched read on a remote host) yields "" rather than dropping the role.
 */
export async function listArchivedRoleSummariesOnHost(
  conn: SSHClientType | null,
): Promise<ArchivedRoleSummary[]> {
  const names = await listArchivedRolesOnHost(conn);
  if (names.length === 0) return [];

  const descByName = new Map<string, string>();
  if (conn === null) {
    const root = getLocalArchivedRolesRoot();
    await Promise.all(
      names.map(async (name) => {
        try {
          const md = await fs.readFile(path.join(root, name, `${name}.md`), "utf-8");
          descByName.set(name, readRoleDescriptionFromMarkdown(md));
        } catch {
          /* unreadable → "" */
        }
      }),
    );
  } else {
    // Names are ROLE_NAME_PATTERN-gated above, so interpolation is shell-safe.
    // The trailing `echo ""` keeps the next marker at start-of-line when a
    // file lacks a final newline (same as roles-list-for-host).
    const cmd = names
      .map(
        (n) =>
          `echo "===ROLE:${n}==="; cat "$HOME/fleet/roles-archive/${n}/${n}.md" 2>/dev/null; echo ""`,
      )
      .join(" ; ");
    try {
      const stdout = await Promise.race([
        execCommand(conn, cmd),
        new Promise<string>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `listArchivedRoleSummariesOnHost: remote exec timeout after ${REMOTE_LIST_TIMEOUT_MS}ms`,
                ),
              ),
            REMOTE_LIST_TIMEOUT_MS,
          ),
        ),
      ]);
      const blocks = stdout.split(/^===ROLE:([a-z0-9-]+)===\s*$/m);
      for (let i = 1; i < blocks.length; i += 2) {
        const name = blocks[i];
        const body = (blocks[i + 1] ?? "").replace(/^\s*\r?\n/, "");
        descByName.set(name, readRoleDescriptionFromMarkdown(body));
      }
    } catch (err) {
      sshLogger.warn("listArchivedRoleSummariesOnHost: description read failed — returning names only", {
        operation: "roles_archive_list_descriptions_failed",
        roleCount: names.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return names.map((name) => ({ name, description: descByName.get(name) ?? "" }));
}
