/**
 * per-app-file.ts — app-archive shape.
 *
 * Per-APP file-touch primitive. NEW sibling of per-identity-file.ts's
 * writeIdentityFile and per-role-file.ts's writeRoleFile — deliberately
 * a separate module rather than an extension of either. The audit-surface
 * discipline is per-domain: widening an existing primitive's whitelist to
 * cover app paths would blur the invariant that each primitive's key regex
 * and allowed-basename set are scoped to one fleet subtree.
 *
 * Exports:
 *   - writeAppFile(slug, relPath, contents, opts)
 *   - updateAppTitle(slug, title, opts) — read-modify-write of app.json `title`
 *   - validateAppTitle(raw) — title gate shared by the route + updateAppTitle
 *   - AppManifestError — typed failure for missing / malformed app.json
 *   - ALLOWED_APP_REL_PATHS (bounded whitelist — two entries)
 *
 * Gates (defense-in-depth, both fire BEFORE any I/O):
 *   1. APP_SLUG_RE /^[a-z0-9-]{1,64}$/ — imported (not redefined) from
 *      identity-artifact-reader.ts, the canonical app-slug validator used
 *      by every other app-scoped surface (routes/apps.ts, app-pane-router.ts).
 *   2. ALLOWED_APP_REL_PATHS whitelist — bounded to the basenames the app
 *      shapes write (`.archive-requested`, `app.json`). Any other value
 *      throws before I/O. Additional entries must be added deliberately in
 *      a future shape (bounded-scope discipline).
 *
 * Routing (mirrors per-identity-file.ts and per-role-file.ts's LOCAL vs
 * REMOTE split):
 *   - isLocalHostId(hostId) === true → LOCAL: node fs tmp+rename against
 *     getLocalAppsRoot()/<slug>/<relPath>. The getLocalAppsRoot() helper
 *     honors the APPS_HOST_DIR env override (containerized-Skynet bind-mount
 *     case) and falls back to <HOME_HOST_DIR>/fleet/apps → <os.homedir()>/fleet/apps.
 *   - isLocalHostId(hostId) === false → REMOTE: SFTP via
 *     writeMarkdownFileAtomic (tmp+ext_openssh_rename discipline lives
 *     inside that helper — do NOT re-implement here). REMOTE branch
 *     requires opts.conn non-null; throws "conn required for remote host"
 *     verbatim if the caller violates this (contract-matches
 *     per-identity-file.ts and per-role-file.ts).
 *
 * No chmod:
 *   Apps don't hold credentials at the folder root (any per-app secrets
 *   live inside the app's own db or config, out of this primitive's reach)
 *   and the archive-request sentinel is empty, so no chmod field on opts.
 *
 * No parent-mkdir:
 *   The app directory must already exist when writeAppFile is called. App
 *   folder creation is the app-development skill's create-app.sh job.
 *   Writing an `.archive-requested` sentinel on a non-existent app folder
 *   should fail — the invariant is "archive-requested only makes sense on
 *   an existing app folder" (parallel to per-role-file.ts D-16).
 */

import path from "path";
import fs from "node:fs/promises";
import type { Client as SSHClientType } from "ssh2";

import { execCommand } from "../ssh/tmux-helper.js";
import {
  APP_SLUG_RE,
  isLocalHostId,
  writeMarkdownFileAtomic,
  getLocalAppsRoot,
} from "./identity-artifact-reader.js";

// ---------------------------------------------------------------------------
// relPath whitelist (bounded-scope discipline)
// ---------------------------------------------------------------------------

/**
 * Bounded set of basenames the per-app file primitive is allowed to touch.
 * Any other value throws before I/O. Entries:
 *   - `.archive-requested` — the app archival sentinel.
 *   - `app.json` — the app's metadata card, written ONLY via updateAppTitle
 *     (app-rename shape), which preserves every other field.
 * Additional entries must be added via a deliberate future-shape decision
 * (belt-and-suspenders alongside the app-slug gate).
 */
export const ALLOWED_APP_REL_PATHS: ReadonlySet<string> = new Set([
  ".archive-requested",
  "app.json",
]);

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Local absolute path to the target file under the local apps root.
 * Delegates to getLocalAppsRoot() so APPS_HOST_DIR env (bind-mount path
 * inside the Skynet container, e.g. `/fleet/apps`) is honored. Matches
 * the per-role-file.ts:97-99 pattern: hardcoding
 * `path.join(os.homedir(), "fleet", "apps", ...)` would silently write
 * to `/home/node/fleet/apps/...` inside the container — ephemeral overlay
 * storage the host supervisor can't see.
 */
function localAppTargetPath(slug: string, relPath: string): string {
  return path.join(getLocalAppsRoot(), slug, relPath);
}

/**
 * Remote path to the target file, relative to the SSH user's $HOME.
 *
 * PATH SHAPE: `fleet/apps/${slug}/${relPath}` — a RELATIVE path (no
 * leading `/`, no `$HOME/` prefix). SFTP's `open`/`stat` resolve relative
 * paths against the SSH user's home directory automatically.
 *
 * ⚠️ Do NOT insert `$HOME/` as a literal prefix — SFTP does not expand
 * `$HOME` as a shell variable; it would treat it as a directory literally
 * named `$HOME` at the filesystem root and every write would ENOENT
 * silently. Same discipline per-identity-file.ts:143 and
 * per-role-file.ts:114 document.
 */
function remoteAppTargetPath(slug: string, relPath: string): string {
  return `fleet/apps/${slug}/${relPath}`;
}

// ---------------------------------------------------------------------------
// Gate helpers (defense-in-depth — HTTP layer is primary defense, this is
// belt-and-suspenders at the write layer against path traversal)
// ---------------------------------------------------------------------------

function assertValidAppSlug(slug: string): void {
  if (!APP_SLUG_RE.test(slug)) {
    throw new Error(
      `invalid app slug — must match ${APP_SLUG_RE.source}`,
    );
  }
}

function assertValidAppRelPath(relPath: string): void {
  if (!ALLOWED_APP_REL_PATHS.has(relPath)) {
    throw new Error(
      `invalid relPath — allowed: ${[...ALLOWED_APP_REL_PATHS].join(", ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public: writeAppFile
// ---------------------------------------------------------------------------

export interface WriteAppFileOpts {
  hostId: number;
  conn: SSHClientType | null;
}

/**
 * Write a per-app file at `~/fleet/apps/<slug>/<relPath>`.
 *
 * LOCAL branch (isLocalHostId(hostId) true): tmp+rename via node fs against
 *   getLocalAppsRoot()/<slug>/<relPath>. Same discipline as per-role-file's
 *   LOCAL branch.
 * REMOTE branch (otherwise): delegates to writeMarkdownFileAtomic — the
 *   SFTP tmp+atomic-rename discipline lives inside that helper (do NOT
 *   re-implement here per the one-audit-surface pattern established in
 *   per-identity-file.ts).
 *
 * Gates (defense-in-depth):
 *   1. APP_SLUG_RE /^[a-z0-9-]{1,64}$/ — rejects uppercase, underscore,
 *      dots, slashes, and every path-traversal shape.
 *   2. ALLOWED_APP_REL_PATHS whitelist (`.archive-requested`, `app.json`).
 * Both fire BEFORE any I/O.
 *
 * Contents:
 *   Threaded through verbatim — empty string for `.archive-requested` is
 *   intentional (presence IS the meaning; body is never read).
 *
 * Does NOT parent-mkdir:
 *   App folder creation is the app-development skill's create-app.sh job.
 *   If the app folder doesn't exist yet, this write SHOULD fail (invariant:
 *   archive-requested only makes sense on an existing app folder).
 */
export async function writeAppFile(
  slug: string,
  relPath: string,
  contents: string,
  opts: WriteAppFileOpts,
): Promise<void> {
  assertValidAppSlug(slug);
  assertValidAppRelPath(relPath);

  if (isLocalHostId(opts.hostId)) {
    const finalPath = localAppTargetPath(slug, relPath);
    const tmpPath = finalPath + ".tmp";
    await fs.writeFile(tmpPath, contents, "utf-8");
    await fs.rename(tmpPath, finalPath);
    return;
  }

  if (opts.conn === null) {
    throw new Error("conn required for remote host");
  }
  const targetPath = remoteAppTargetPath(slug, relPath);
  await writeMarkdownFileAtomic(opts.conn, targetPath, contents);
}

// ---------------------------------------------------------------------------
// Public: app-rename shape — updateAppTitle
// ---------------------------------------------------------------------------

/** Max title length (in UTF-16 code units, matching the frontend gate). */
export const APP_TITLE_MAX_LEN = 80;

// C0 + DEL + C1 control characters. A title is a single display line.
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f-\u009f]/;

// `never` on the off-branch fields keeps `.error` / `.title` readable
// without discriminant narrowing (the backend tsconfig doesn't narrow it).
export type AppTitleCheck =
  | { ok: true; title: string; error?: never }
  | { ok: false; error: string; title?: never };

/**
 * Validate + normalise a user-supplied app title. Returns the trimmed title
 * or an error string. Mirrored client-side in src/ui/api/apps-rename-api.ts
 * (no shared module between the backend and UI builds) — keep the two in
 * lockstep.
 */
export function validateAppTitle(
  raw: unknown,
): AppTitleCheck {
  if (typeof raw !== "string") {
    return { ok: false, error: "title must be a string" };
  }
  const title = raw.trim();
  if (title.length === 0) {
    return { ok: false, error: "title must not be empty" };
  }
  if (title.length > APP_TITLE_MAX_LEN) {
    return {
      ok: false,
      error: `title must be at most ${APP_TITLE_MAX_LEN} characters`,
    };
  }
  if (CONTROL_CHAR_RE.test(title)) {
    return { ok: false, error: "title must not contain control characters" };
  }
  return { ok: true, title };
}

/**
 * Typed failure for app.json problems the caller should surface distinctly
 * from transport errors: `not_found` (no app.json — app gone or never
 * published) and `malformed` (not a JSON object — refusing to overwrite,
 * since the sweep drops apps whose card doesn't parse).
 */
export class AppManifestError extends Error {
  constructor(
    public readonly kind: "not_found" | "malformed",
    message: string,
  ) {
    super(message);
    this.name = "AppManifestError";
  }
}

async function readAppJson(
  slug: string,
  opts: WriteAppFileOpts,
): Promise<string> {
  if (isLocalHostId(opts.hostId)) {
    try {
      return await fs.readFile(localAppTargetPath(slug, "app.json"), "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        throw new AppManifestError("not_found", "app.json not found");
      }
      throw err;
    }
  }

  if (opts.conn === null) {
    throw new Error("conn required for remote host");
  }
  // Slug is APP_SLUG_RE-validated, so interpolation inside double quotes is
  // shell-safe (same argument as readProjectFile). The sentinel lets us tell
  // "file missing" apart from a transport failure — execCommand rejects on a
  // non-zero exit with empty stdout.
  const file = `$HOME/fleet/apps/${slug}/app.json`;
  const stdout = await execCommand(
    opts.conn,
    `if [ -f "${file}" ]; then cat "${file}"; else printf '__SKYNET_NO_APP_JSON__'; fi`,
  );
  if (stdout === "__SKYNET_NO_APP_JSON__") {
    throw new AppManifestError("not_found", "app.json not found");
  }
  return stdout;
}

/**
 * Rewrite the `title` field of `~/fleet/apps/<slug>/app.json`, preserving
 * every other field. Read-modify-write; the write is atomic (tmp+rename via
 * writeAppFile). The sweep picks the new title up on its next tick.
 *
 * Throws AppManifestError for missing / malformed app.json, a plain Error
 * for an invalid title or slug (both gated before I/O), and passes through
 * transport errors.
 */
export async function updateAppTitle(
  slug: string,
  rawTitle: string,
  opts: WriteAppFileOpts,
): Promise<{ title: string }> {
  assertValidAppSlug(slug);
  const v = validateAppTitle(rawTitle);
  if (!v.ok) throw new Error(v.error);

  const text = await readAppJson(slug, opts);
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw new AppManifestError("malformed", "app.json is not valid JSON");
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new AppManifestError("malformed", "app.json is not a JSON object");
  }

  const next = { ...(manifest as Record<string, unknown>), title: v.title };
  await writeAppFile(slug, "app.json", JSON.stringify(next, null, 2) + "\n", opts);
  return { title: v.title };
}
