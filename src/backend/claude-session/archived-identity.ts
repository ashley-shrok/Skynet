/**
 * archived-identity.ts — where an agent's folder is: live
 * (`~/fleet/identities/<name>/`) or archived (`~/fleet/identities-archive/<name>/`).
 *
 * The server always decides this itself from the agent's name; nothing the
 * browser sends names a folder. The archived conversation view and the
 * view-only agent window read from the archived folder; a live folder wins
 * when both exist (an un-archive in progress has already moved it back).
 */

import { IDENTITY_KEY_RE } from "./identity-artifact-reader.js";

export type IdentityFolderState = "live" | "archived" | "gone";

/** Folder (relative to $HOME) holding an agent's identity folder. */
export function identityFolderParent(archived: boolean): string {
  return archived ? "fleet/identities-archive" : "fleet/identities";
}

/**
 * One-line shell probe: prints `live`, `archived` or `gone`. An agent counts
 * as live only when its live folder holds its identity file — a bare folder
 * (say a stray write) never makes an archived agent look live.
 */
export function buildIdentityFolderStateScript(identityKey: string): string {
  return (
    `L="$HOME/fleet/identities/${identityKey}"; ` +
    `if [ -f "$L/${identityKey}.md" ] || [ -f "$L/identity.md" ]; then echo live; ` +
    `elif [ -d "$HOME/fleet/identities-archive/${identityKey}" ]; then echo archived; ` +
    `else echo gone; fi`
  );
}

/** Shell test (exit 0) for "this agent's live folder holds its identity file". */
export function liveIdentityShellTest(identityKey: string): string {
  const l = `"$HOME/fleet/identities/${identityKey}`;
  return `{ [ -f ${l}/${identityKey}.md" ] || [ -f ${l}/identity.md" ]; }`;
}

/**
 * Which folder the agent is in. Throws on transport failure (callers tell
 * "couldn't look" apart from "gone"); an invalid name is "gone".
 */
export async function probeIdentityFolderState(
  exec: (cmd: string) => Promise<string>,
  identityKey: string,
): Promise<IdentityFolderState> {
  if (!IDENTITY_KEY_RE.test(identityKey)) return "gone";
  const out = (await exec(buildIdentityFolderStateScript(identityKey))).trim();
  if (out === "live" || out === "archived") return out;
  return "gone";
}

/** Local: does this agent folder hold its identity file (i.e. is it live)? */
export async function hasLocalIdentityFile(dir: string, identityKey: string): Promise<boolean> {
  const { promises: fsp } = await import("node:fs");
  const path = await import("node:path");
  for (const f of [`${identityKey}.md`, "identity.md"]) {
    if (await fsp.stat(path.join(dir, f)).then((st) => st.isFile(), () => false)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// An archived agent's conversation apps — listed in its view-only window.
// They live in the agent's own folder (`apps/<slug>/`), so archiving moved
// them along; they aren't served while archived, so only what's on disk is
// shown: title, description and picture.
// ---------------------------------------------------------------------------

/** Largest app picture sent inline (bytes); bigger ones show the plain glyph. */
export const ARCHIVED_APP_ICON_MAX_BYTES = 256 * 1024;

export type ArchivedApp = {
  slug: string;
  title: string;
  description: string | null;
  /** `data:image/webp;base64,…`, or null when there's no (small enough) picture. */
  iconDataUrl: string | null;
};

const APP_SEP = "---ARCHIVED-APP---";

/** One round-trip: per app folder, `slug`, app.json, then the base64 icon. */
export function buildArchivedAppsScript(identityKey: string): string {
  return (
    // Where to read is decided here: the live folder if the agent is back,
    // else its archived one.
    `D="$HOME/fleet/identities/${identityKey}"; ${liveIdentityShellTest(identityKey)} || D="$HOME/fleet/identities-archive/${identityKey}"; ` +
    `cd "$D/apps" 2>/dev/null && { shopt -s nullglob; ` +
    // Symlinked app folders, manifests and pictures are never read.
    `for d in */; do s="\${d%/}"; [ -L "$s" ] && continue; [ -f "$s/app.json" ] && [ ! -L "$s/app.json" ] || continue; ` +
    `printf '%s\\n' '${APP_SEP}' "$s"; head -c 65536 "$s/app.json"; printf '\\n%s\\n' '---ICON---'; ` +
    `if [ -f "$s/icon.webp" ] && [ ! -L "$s/icon.webp" ] && [ "$(stat -c %s "$s/icon.webp" 2>/dev/null || echo 0)" -le ${ARCHIVED_APP_ICON_MAX_BYTES} ]; then base64 -w0 "$s/icon.webp"; fi; printf '\\n'; ` +
    `done; }; true`
  );
}

function appFromParts(slug: string, manifest: string, iconB64: string): ArchivedApp | null {
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) return null;
  let parsed: Record<string, unknown> = {};
  try {
    const p = JSON.parse(manifest) as unknown;
    if (p && typeof p === "object" && !Array.isArray(p)) parsed = p as Record<string, unknown>;
  } catch {
    // unreadable manifest — still list the app under its slug
  }
  const title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title : slug;
  const description = typeof parsed.description === "string" && parsed.description.trim() ? parsed.description : null;
  const b64 = iconB64.trim();
  return {
    slug,
    title,
    description,
    iconDataUrl: /^[A-Za-z0-9+/=]+$/.test(b64) ? `data:image/webp;base64,${b64}` : null,
  };
}

export function parseArchivedAppsStdout(stdout: string): ArchivedApp[] {
  const out: ArchivedApp[] = [];
  for (const chunk of stdout.split(`${APP_SEP}\n`).slice(1)) {
    const nl = chunk.indexOf("\n");
    if (nl === -1) continue;
    const slug = chunk.slice(0, nl);
    const rest = chunk.slice(nl + 1);
    const iconAt = rest.lastIndexOf("\n---ICON---\n");
    if (iconAt === -1) continue;
    const app = appFromParts(slug, rest.slice(0, iconAt), rest.slice(iconAt + "\n---ICON---\n".length));
    if (app) out.push(app);
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/** Local (bind-mount) variant: same rule via node fs. */
export async function readArchivedAppsLocal(
  archiveRoot: string,
  identityKey: string,
  liveRoot?: string,
): Promise<ArchivedApp[]> {
  const { promises: fsp } = await import("node:fs");
  const path = await import("node:path");
  // The live folder wins when the agent is back.
  const isLive = liveRoot !== undefined && (await hasLocalIdentityFile(path.join(liveRoot, identityKey), identityKey));
  const appsDir = path.join(isLive ? liveRoot! : archiveRoot, identityKey, "apps");
  let names: string[];
  try {
    // Real folders only — symlinks are skipped, as below.
    names = (await fsp.readdir(appsDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return [];
  }
  const out: ArchivedApp[] = [];
  for (const slug of names) {
    let manifest: string;
    try {
      const manifestPath = path.join(appsDir, slug, "app.json");
      if (!(await fsp.lstat(manifestPath)).isFile()) continue;
      manifest = (await fsp.readFile(manifestPath, "utf8")).slice(0, 65536);
    } catch {
      continue;
    }
    let icon = "";
    try {
      const iconPath = path.join(appsDir, slug, "icon.webp");
      const st = await fsp.lstat(iconPath);
      if (st.isFile() && st.size <= ARCHIVED_APP_ICON_MAX_BYTES) {
        icon = (await fsp.readFile(iconPath)).toString("base64");
      }
    } catch {
      // no picture
    }
    const app = appFromParts(slug, manifest, icon);
    if (app) out.push(app);
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------------------
// An archived agent's look — picture, name, colour, task line, roles — read
// from its archived identity file, the same way search builds an archived
// row. Sent with the archived conversation so the tab paints correctly after
// a reload, without search.
// ---------------------------------------------------------------------------

export type ArchivedIdentityLook = {
  identityKey: string;
  hostId: number;
  displayName: string;
  title: string | null;
  colorHue: number | null;
  voice: string | null;
  task: string | null;
  role: string | null;
  roles: string[];
  /** Roles whose role folder is itself archived (shown as plain text). */
  archivedRoles: string[];
  /** Role display names, by slug (null when the role names none). */
  roleDisplayNames: Record<string, string | null>;
  /** The single live role's picture, or "" — the identity's own avatar
   *  route only reads the live folder. */
  avatarUrl: string;
};

export async function readArchivedIdentityLook(
  conn: import("ssh2").Client,
  hostId: number,
  identityKey: string,
): Promise<ArchivedIdentityLook> {
  const { readIdentityFrontmattersBatch, readRoleFrontmattersBatch } = await import("./search-frontmatter-batch.js");
  const { extractCosmeticsFromFrontmatter, extractRolesFromMarkdown, extractRoleFromMarkdown } = await import(
    "./identity-artifact-reader.js"
  );
  const { resolveIdentityAppearance } = await import("../fleet-status/identity-appearance.js");
  const md = (await readIdentityFrontmattersBatch(conn, [identityKey], new Set([identityKey]))).get(identityKey) ?? "";
  const roles = extractRolesFromMarkdown(md);
  const role = extractRoleFromMarkdown(md);
  const roleMd = await readRoleFrontmattersBatch(conn, roles);
  const roleCos = new Map<string, ReturnType<typeof extractCosmeticsFromFrontmatter> | null>();
  for (const [name, { markdown }] of roleMd) roleCos.set(name, markdown ? extractCosmeticsFromFrontmatter(markdown) : null);
  const appearance = resolveIdentityAppearance({
    identityKey,
    hostId,
    cosmetics: extractCosmeticsFromFrontmatter(md),
    roleCosmetics: role !== null ? (roleCos.get(role) ?? null) : null,
    role,
    roles,
    pinned: false,
  });
  const onlyRole = roles.length === 1 ? roles[0] : null;
  const only = onlyRole !== null ? roleMd.get(onlyRole) : undefined;
  return {
    identityKey,
    hostId,
    displayName: appearance.displayName,
    title: appearance.title,
    colorHue: appearance.colorHue,
    voice: appearance.voice,
    task: appearance.task,
    role: appearance.role,
    roles,
    archivedRoles: roles.filter((r) => roleMd.get(r)?.archived === true),
    roleDisplayNames: Object.fromEntries(
      roles.map((r) => [r, (roleCos.get(r)?.displayName as string | undefined) ?? null]),
    ),
    avatarUrl:
      onlyRole !== null && only && !only.archived && roleCos.get(onlyRole)?.avatar
        ? `/roles/${onlyRole}/avatar?hostId=${hostId}`
        : "",
  };
}
