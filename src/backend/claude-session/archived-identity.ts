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

/** One-line shell probe: prints `live`, `archived` or `gone`. */
export function buildIdentityFolderStateScript(identityKey: string): string {
  return (
    `if [ -d "$HOME/fleet/identities/${identityKey}" ]; then echo live; ` +
    `elif [ -d "$HOME/fleet/identities-archive/${identityKey}" ]; then echo archived; ` +
    `else echo gone; fi`
  );
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
    `cd "$HOME/fleet/identities-archive/${identityKey}/apps" 2>/dev/null && { shopt -s nullglob; ` +
    `for d in */; do s="\${d%/}"; [ -f "$s/app.json" ] || continue; ` +
    `printf '%s\\n' '${APP_SEP}' "$s"; head -c 65536 "$s/app.json"; printf '\\n%s\\n' '---ICON---'; ` +
    `if [ -f "$s/icon.webp" ] && [ "$(stat -c %s "$s/icon.webp" 2>/dev/null || echo 0)" -le ${ARCHIVED_APP_ICON_MAX_BYTES} ]; then base64 -w0 "$s/icon.webp"; fi; printf '\\n'; ` +
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
export async function readArchivedAppsLocal(archiveRoot: string, identityKey: string): Promise<ArchivedApp[]> {
  const { promises: fsp } = await import("node:fs");
  const path = await import("node:path");
  const appsDir = path.join(archiveRoot, identityKey, "apps");
  let names: string[];
  try {
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
      manifest = (await fsp.readFile(path.join(appsDir, slug, "app.json"), "utf8")).slice(0, 65536);
    } catch {
      continue;
    }
    let icon = "";
    try {
      const iconPath = path.join(appsDir, slug, "icon.webp");
      if ((await fsp.stat(iconPath)).size <= ARCHIVED_APP_ICON_MAX_BYTES) {
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
