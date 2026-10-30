/**
 * Shell script + output parser for POST /workspace/search (name search across
 * the folder tree under a Files-tab folder). Pure: no I/O, so the script ↔
 * parser contract is testable by running the script in a local shell.
 *
 * The script runs on the agent's host over an exec channel. It:
 *   - cds into the target root, then into the start folder, and refuses a
 *     start folder that resolves outside the root (symlink escape)
 *   - runs GNU find from there: never follows symlinks, prunes bulky
 *     package / environment / git-internal folders, skips the target's
 *     hidden root file when searching from the root, matches every query word
 *     as a case-insensitive substring of the entry's own name (-iname)
 *   - is bounded by `timeout` (exit 124 = stopped early) and niced; a host
 *     without `timeout` is refused rather than searched unbounded
 *   - runs find under a UTF-8 locale so case folding covers non-ASCII names
 *
 * Output (stdout):
 *   failure:  \x1eX\x1f<class>                                — nothing else
 *   success:  \x1eR\x1f  then one record per match:
 *               <type>\x1f<size>\x1f<mtime-seconds>\x1f<path>\0
 *             then the trailer \x1eE\x1f<find exit code>
 *   <path> is relative to the start folder. NUL can't occur in a path, so it
 *   is the only safe record terminator; the trailer follows the last NUL.
 *   The caller may stop reading early (result cap); the trailer is then absent.
 */

import { stopOnInputEof } from "../../ssh/channel-hangup.js";
import { archivedIdentityRootShellWord, type TargetSpec } from "./workspace-routes.js";

/** Folders never descended into. The folder itself is not reported either. */
export const SEARCH_PRUNED_DIRS = ["node_modules", ".venv", "venv", ".git"] as const;

/** Seconds find may run before it is stopped and the result marked incomplete. */
export const SEARCH_TIME_LIMIT_S = 5;

/** Most results returned; one more is read to detect truncation. */
export const SEARCH_MAX_RESULTS = 200;

/** Longest query accepted; the search box stops typing at the same length. */
export const SEARCH_MAX_QUERY_CHARS = 200;

/** Exit status `timeout` reports when it stopped the command. */
const TIMEOUT_EXIT = 124;

export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** Target root as a shell word, expanded by the remote shell. */
function targetRootWord(target: TargetSpec): string {
  // An archived agent: the host decides (live folder wins, else the archive).
  if (target.kind === "archived-identity") return archivedIdentityRootShellWord(target.identityKey);
  if (target.kind === "host") return `"$HOME"`;
  const rel =
    target.kind === "role"
      ? `fleet/roles/${target.roleSlug}`
      : target.kind === "project"
        ? `fleet/projects/${target.projectSlug}`
        : `fleet/identities/${target.identityKey}/workspace`;
  return `"$HOME"/${shellEscape(rel)}`;
}

/**
 * Split a query into match words: whitespace-separated, empty pieces dropped.
 * Returns null when the query is unusable (empty, too long, or contains a NUL).
 */
export function parseSearchQuery(raw: unknown): string[] | null {
  if (typeof raw !== "string") return null;
  if (raw.length > SEARCH_MAX_QUERY_CHARS || raw.includes("\0")) return null;
  const words = raw.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return null;
  return words;
}

/** Escape fnmatch metacharacters so a word matches literally inside -iname. */
function globLiteral(word: string): string {
  return word.replace(/[\\*?[\]]/g, (c) => `\\${c}`);
}

/**
 * @param hiddenRootName - the target's file hidden from the Files tab (role
 *   file / project.md), or null. Required so no caller forgets it: it is
 *   skipped by find itself whenever the search starts at the target root, so
 *   it never counts toward the result cap.
 */
export function buildSearchScript(
  target: TargetSpec,
  startPath: string,
  words: string[],
  hiddenRootName: string | null,
): string {
  const prune = SEARCH_PRUNED_DIRS.map((d) => `-name ${shellEscape(d)}`).join(" -o ");
  const match = words.map((w) => `-iname ${shellEscape(`*${globLiteral(w)}*`)}`).join(" ");
  return [
    `fail() { printf '\\036X\\037%s' "$1"; exit 0; }`,
    // A host CDPATH could redirect a relative cd; "./" also stops a start
    // folder named "-" or "-P" being read as a cd option.
    `unset CDPATH`,
    `cd ${targetRootWord(target)} 2>/dev/null || fail not_found`,
    `root=$(pwd -P)`,
    // A login whose home is "/" would make a whole-host search the whole system.
    target.kind === "host" ? `[ "$root" = / ] && fail path_forbidden` : "",
    startPath === "" ? "" : `cd ./${shellEscape(startPath)} 2>/dev/null || fail not_found`,
    `here=$(pwd -P)`,
    `case "$here" in "$root"|"$root"/*) ;; *) fail path_traversal ;; esac`,
    // Decided on the resolved path, so "." or a link back to the root can't
    // dodge it. "/" never matches a find path (they all start with "./").
    `hide=/`,
    hiddenRootName === null ? "" : `[ "$here" = "$root" ] && hide=./${shellEscape(hiddenRootName)}`,
    // -printf is GNU find; without it every search would look like "no matches".
    `find . -maxdepth 0 -printf '' >/dev/null 2>&1 || fail search_unsupported`,
    `command -v timeout >/dev/null 2>&1 || fail search_unsupported`,
    `run="timeout ${SEARCH_TIME_LIMIT_S}"; command -v nice >/dev/null 2>&1 && run="$run nice -n 10"`,
    `printf '\\036R\\037'`,
    // A UTF-8 locale so -iname folds case beyond ASCII (Ü matches ü); if the
    // host lacks it, find falls back to ASCII-only folding.
    // Only folders are pruned by name — a file called "venv" is still found.
    // Stoppable through stdin once the result cap is reached (channel-hangup.ts).
    stopOnInputEof(`LC_ALL=C.UTF-8 $run find . -mindepth 1 \\( -type d \\( ${prune} \\) \\) -prune -o -ipath "$hide" -prune -o \\( ${match} \\) -printf '%y\\037%s\\037%T@\\037%P\\000' 2>/dev/null`),
    `printf '\\036E\\037%s' "$?"`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export class SearchScriptError extends Error {}

export type SearchMatch = {
  name: string;
  type: "file" | "directory" | "symlink";
  size: number | null;
  mtimeMs: number;
  /** Relative to the start folder. */
  path: string;
};

export type SearchParseResult = {
  matches: SearchMatch[];
  /** find was stopped by the time limit. */
  timedOut: boolean;
};

/**
 * Parse the script's stdout. Throws SearchScriptError(<class>) on an X
 * record or output that doesn't start with the R marker. A missing trailer
 * (reader stopped early) is fine; a partial final record is dropped.
 */
export function parseSearchOutput(stdout: string): SearchParseResult {
  if (stdout.startsWith("\x1eX\x1f")) {
    throw new SearchScriptError(stdout.slice(3) || "search_failed");
  }
  if (!stdout.startsWith("\x1eR\x1f")) throw new SearchScriptError("search_failed");
  const pieces = stdout.slice(3).split("\0");
  // Everything after the last NUL is either the trailer or a cut-off record.
  const tail = pieces.pop() ?? "";
  const trailer = /^\x1eE\x1f(\d+)$/.exec(tail);
  const timedOut = trailer !== null && Number(trailer[1]) === TIMEOUT_EXIT;

  const matches: SearchMatch[] = [];
  for (const rec of pieces) {
    const parts = rec.split("\x1f");
    if (parts.length < 4) continue;
    const [kind, sizeStr, mtimeStr] = parts;
    // The path is last; rejoin in case a name contains the field separator.
    const path = parts.slice(3).join("\x1f");
    if (!path) continue;
    const type = kind === "d" ? "directory" : kind === "l" ? "symlink" : "file";
    const size = Number(sizeStr);
    const mtime = Number(mtimeStr);
    matches.push({
      name: path.slice(path.lastIndexOf("/") + 1),
      type,
      size: type === "directory" || !Number.isFinite(size) ? null : size,
      mtimeMs: Number.isFinite(mtime) ? Math.round(mtime * 1000) : 0,
      path,
    });
  }
  return { matches, timedOut };
}
