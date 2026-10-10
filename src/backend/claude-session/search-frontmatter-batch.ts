/**
 * Batched frontmatter reads for POST /conversation-search.
 *
 * WHY THIS EXISTS: the search visibility gate + appearance resolution used to
 * call readIdentityFile / readRoleFileByName once per unique identity key, all
 * in parallel on ONE ssh2 connection. A broad query hits hundreds of keys;
 * sshd's per-connection MaxSessions (default 10) refuses the excess with
 * "(SSH) Channel open failure: open failed", and the fail-closed gate then
 * DROPPED every one of those hits — plus the role reads failed, so rows lost
 * their role color. One exec per batch keeps the channel count at one.
 *
 * Also reads ARCHIVED identities from `~/fleet/identities-archive/` (the
 * per-key reader only knew the live folder, so archived rows resolved to
 * empty frontmatter: no name, no task, no role look), and falls back to
 * `~/fleet/roles-archive/` for a role that's no longer live.
 *
 * Only the frontmatter block (opening `---` through closing `---`) is
 * returned — callers feed it to the same extract* helpers that parse full
 * files, which only look at the frontmatter anyway.
 */

import type { Client } from "ssh2";
import { execCommand } from "../ssh/tmux-helper.js";

/** Names travel as positional args (never shell syntax); this gate is
 *  defense-in-depth against path games like `..`. */
const NAME_RE = /^[a-z0-9_-][a-z0-9._-]{0,63}$/;

/** ASCII record separator — cannot appear in a markdown frontmatter line. */
const RS = "\x1e";

function shellSingleQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Each arg is `<dir>/<name>`; for each, if `$HOME/fleet/<dir>/<name>/<name>.md`
 * exists, emit `RS<dir>/<name>\n` followed by its frontmatter block.
 */
const SCRIPT =
  'for e in "$@"; do ' +
  '  n="${e#*/}"; f="$HOME/fleet/$e/$n.md"; ' +
  '  [ -f "$f" ] || continue; ' +
  `  printf '${"\\036"}%s\\n' "$e"; ` +
  "  awk 'NR==1 && !/^---/ {exit} {print} NR>1 && /^---/ {exit}' \"$f\" 2>/dev/null; " +
  "done";

async function readBatch(
  conn: Client,
  entries: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (entries.length === 0) return out;
  const cmd = [
    "sh",
    "-c",
    shellSingleQuote(SCRIPT),
    "--",
    ...entries.map(shellSingleQuote),
  ].join(" ");
  const stdout = await execCommand(conn, cmd);
  for (const record of stdout.split(RS)) {
    const nl = record.indexOf("\n");
    const head = (nl === -1 ? record : record.slice(0, nl)).trim();
    if (!head) continue;
    out.set(head, nl === -1 ? "" : record.slice(nl + 1));
  }
  return out;
}

/**
 * Frontmatter for each identity key, read from the live folder or — for keys
 * in `archivedKeys` — the archive folder. Keys with no file map to "" (same
 * contract as readIdentityFile's ENOENT branch); keys failing the name gate
 * are ABSENT from the map so the caller can treat them as unverifiable.
 * Throws when the exec itself fails; the caller decides the fail-closed
 * policy.
 */
export async function readIdentityFrontmattersBatch(
  conn: Client,
  keys: string[],
  archivedKeys: ReadonlySet<string>,
): Promise<Map<string, string>> {
  const valid = keys.filter((k) => NAME_RE.test(k));
  const dirOf = (k: string) =>
    archivedKeys.has(k) ? "identities-archive" : "identities";
  const raw = await readBatch(
    conn,
    valid.map((k) => `${dirOf(k)}/${k}`),
  );
  const out = new Map<string, string>();
  for (const k of valid) out.set(k, raw.get(`${dirOf(k)}/${k}`) ?? "");
  return out;
}

/**
 * Frontmatter for each role, preferring `~/fleet/roles/` and falling back to
 * `~/fleet/roles-archive/`. Roles with neither map to "". `archived` marks
 * roles that only exist in the archive (their avatar route won't serve).
 */
export async function readRoleFrontmattersBatch(
  conn: Client,
  roles: string[],
): Promise<Map<string, { markdown: string; archived: boolean }>> {
  const valid = [...new Set(roles)].filter((r) => NAME_RE.test(r));
  const raw = await readBatch(
    conn,
    valid.flatMap((r) => [`roles/${r}`, `roles-archive/${r}`]),
  );
  const out = new Map<string, { markdown: string; archived: boolean }>();
  for (const r of valid) {
    const live = raw.get(`roles/${r}`);
    if (live !== undefined) out.set(r, { markdown: live, archived: false });
    else out.set(r, { markdown: raw.get(`roles-archive/${r}`) ?? "", archived: true });
  }
  return out;
}
