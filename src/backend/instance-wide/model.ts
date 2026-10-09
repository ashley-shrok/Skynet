/**
 * instance-wide/model.ts — shared vocabulary for instance-wide skills and roles.
 *
 * An instance-wide item is a whole skill folder or a whole role folder whose
 * master copy lives in the app's data volume. Every fleet-substrate machine
 * holds a copy at the same place agents already use (skills in
 * ~/.claude/skills/<name>, roles in ~/fleet/roles/<name>), and the sync
 * engine (engine.ts) keeps those copies in step with the master.
 *
 * Shape: .planning/shapes/shape-instance-wide-roles-and-skills.md
 */

export type ItemKind = "skill" | "role";

export const ITEM_KINDS: readonly ItemKind[] = ["skill", "role"];

/** `<kind>/<name>` — the key used in every map/state file. */
export type ItemKey = string;

export function itemKey(kind: ItemKind, name: string): ItemKey {
  return `${kind}/${name}`;
}

export function parseItemKey(key: ItemKey): { kind: ItemKind; name: string } | null {
  const slash = key.indexOf("/");
  if (slash === -1) return null;
  const kind = key.slice(0, slash);
  const name = key.slice(slash + 1);
  if (!isItemKind(kind) || !isValidItemName(name)) return null;
  return { kind, name };
}

export function isItemKind(v: unknown): v is ItemKind {
  return v === "skill" || v === "role";
}

/** Same character class the skills editor and role slugs already accept. */
const ITEM_NAME_RE = /^[a-zA-Z0-9._-]{1,128}$/;

export function isValidItemName(v: unknown): v is string {
  return typeof v === "string" && v !== "." && v !== ".." && ITEM_NAME_RE.test(v);
}

/** Folder of an item on a host, relative to that host's $HOME. */
export function hostRelDir(kind: ItemKind, name: string): string {
  return kind === "skill" ? `.claude/skills/${name}` : `fleet/roles/${name}`;
}

/** Relative path inside an item: no leading slash, no `.`/`..`/empty segments. */
export function isSafeRelPath(p: unknown): p is string {
  if (typeof p !== "string") return false;
  if (p.length === 0 || p.length > 512) return false;
  if (p.startsWith("/") || p.includes("\0") || p.includes("\n") || p.includes("\t")) return false;
  for (const part of p.split("/")) {
    if (part === "" || part === "." || part === "..") return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Files that never travel
// ---------------------------------------------------------------------------

/** Suffix of a set-aside conflict copy: `<file>.conflict-<host>-<stamp>`. */
export const CONFLICT_MARKER = ".conflict-";

export function isConflictCopy(relPath: string): boolean {
  const base = relPath.slice(relPath.lastIndexOf("/") + 1);
  return base.includes(CONFLICT_MARKER);
}

const IGNORED_DIR_SEGMENTS = new Set(["__pycache__", ".cache"]);

/**
 * Editor-backup and cache files are ignored by name pattern; so are conflict
 * copies (they are reported, never synced). Everything else in a folder travels.
 */
export function isIgnoredPath(relPath: string): boolean {
  const parts = relPath.split("/");
  for (const seg of parts.slice(0, -1)) {
    if (IGNORED_DIR_SEGMENTS.has(seg)) return true;
  }
  const base = parts[parts.length - 1];
  if (base.endsWith("~")) return true;
  if (/^\..*\.sw[a-p]$/.test(base)) return true;
  if (/\.bak$/.test(base) || /\.bak\./.test(base)) return true;
  if (base.endsWith(".orig") || base.endsWith(".pyc")) return true;
  if (base === ".DS_Store") return true;
  if (base.endsWith(".iw-tmp")) return true;
  if (base.includes(CONFLICT_MARKER)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Promotion (and write-back) refuses folders larger than this. */
export const MAX_ITEM_FILES = 2000;
export const MAX_ITEM_BYTES = 25 * 1024 * 1024;

/** Catch-up cadence. */
export const CATCH_UP_INTERVAL_MS = 5 * 60 * 1000;

/** A machine not contacted for this long is "offline" and never counted as behind. */
export const OFFLINE_AFTER_MS = 24 * 60 * 60 * 1000;

/** path → sha256 hex. */
export type Manifest = Record<string, string>;

export function manifestsEqual(a: Manifest, b: Manifest): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}
