/**
 * roles-key-migration.ts — identity frontmatter `role:` → `roles:` key rename.
 *
 * Shared by both bootstrap surfaces:
 *   - run-bootstrap.ts (SSH, remote managed hosts) sends ROLES_KEY_MIGRATION_CMD
 *     — a single `python3 -` heredoc — over the channel. One exec per host.
 *   - local-fleet-install.ts (the distributor's own box, where the container
 *     image has no python3) calls migrateRolesKeyUnder(homeRoot), a TS port of
 *     the same script. roles-key-migration.test.ts runs one case table against
 *     BOTH implementations so they cannot drift.
 *
 * Rules (identical in both):
 *   - Targets: `<name>/<name>.md` directly inside each folder of
 *     ~/fleet/identities and ~/fleet/identities-archive, plus each folder's
 *     role-file-watch baseline `<name>/role-file-watch/last-snapshot.identity`
 *     (the watcher's snapshot of the identity file — migrated in lockstep, and
 *     BEFORE the identity file, so the watcher sees no diff and doesn't wake
 *     the agent).
 *   - Only the FIRST frontmatter block: line 0 is `---` (whitespace-trimmed,
 *     same fence rule as the roles readers), ending at the next `---` line.
 *     No frontmatter / unterminated → file skipped.
 *   - Every line in that block starting with exactly `role:` becomes
 *     `roles:` + the remainder of the line byte-for-byte. Block-list item lines
 *     below it, everything else in the block, and the body are untouched.
 *     Bytes in == bytes out apart from that one-letter insertion (CRLF, BOM-
 *     free UTF-8, odd encodings all preserved — the transform is byte-level).
 *   - Block already has a `roles:` line → file left alone; if it ALSO has a
 *     `role:` line it's reported as a conflict (warned, not an error).
 *   - Atomic write: temp file in the same dir, original mode (and owner, best
 *     effort) applied to the temp file, then rename. If the file changed
 *     between read and rename (size/mtime), the write is skipped — the next
 *     sweep retries.
 *   - Cheap no-op: a file is only parsed if its bytes contain "\nrole:".
 *     Steady state is one listdir + one small read per identity.
 */
import path from "path";
import fs from "fs/promises";

/** Last line printed by the remote script on successful completion. */
export const ROLES_KEY_MIGRATION_SENTINEL = "__ROLES_KEY_MIGRATION_OK__";
/** Prefix of the JSON counts line printed just before the sentinel. */
export const ROLES_KEY_MIGRATION_RESULT_PREFIX = "ROLES_KEY_MIGRATION_RESULT ";

/** Cap on the path lists carried in the counts (keeps output/logs small). */
export const ROLES_KEY_MIGRATION_LIST_CAP = 20;

export interface RolesKeyMigrationCounts {
  /** Identity files (`<name>.md`) whose `role:` key was renamed. */
  filesMigrated: number;
  /** role-file-watch `last-snapshot.identity` baselines renamed. */
  baselinesMigrated: number;
  /** Files whose frontmatter has BOTH `role:` and `roles:` (left alone). */
  conflicts: number;
  /** Up to ROLES_KEY_MIGRATION_LIST_CAP conflict paths. */
  conflictPaths: string[];
  /** Per-file failures (read/write). Count, plus a capped detail list. */
  errorCount: number;
  errors: Array<{ path: string; error: string }>;
  /** Files that changed between read and rename (skipped; retried next sweep). */
  deferred: number;
}

// ---------------------------------------------------------------------------
// Remote implementation — python3, sent over the SSH channel as a heredoc.
// Works on bytes end to end so nothing but the key changes. Written for any
// python3 (no f-strings / walrus). It lives in a String.raw template literal:
// backslashes reach python verbatim, the only interpolations are the shared
// constants below, and it must never contain a backtick or a line equal to
// the heredoc delimiter.
// ---------------------------------------------------------------------------

export const ROLES_KEY_MIGRATION_PY = String.raw`
import json, os, stat, sys, tempfile

HOME = os.path.expanduser("~")
ROOTS = [os.path.join(HOME, "fleet", "identities"),
         os.path.join(HOME, "fleet", "identities-archive")]
CAP = ${String(ROLES_KEY_MIGRATION_LIST_CAP)}
out = {"filesMigrated": 0, "baselinesMigrated": 0, "conflicts": 0,
       "conflictPaths": [], "errorCount": 0, "errors": [], "deferred": 0}


def migrate(data):
    if b"\nrole:" not in data:
        return None, False
    lines = data.split(b"\n")
    if lines[0].lstrip(b"\xef\xbb\xbf").strip() != b"---":
        return None, False
    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() == b"---":
            end = i
            break
    if end is None:
        return None, False
    idx = [i for i in range(1, end) if lines[i].startswith(b"role:")]
    if not idx:
        return None, False
    if any(lines[i].startswith(b"roles:") for i in range(1, end)):
        return None, True
    # Only the first: readers take the first roles: line, and a second
    # one would be a duplicate key for the YAML-based writers.
    i = idx[0]
    lines[i] = b"roles:" + lines[i][5:]
    return b"\n".join(lines), False


def note_error(p, e):
    out["errorCount"] += 1
    if len(out["errors"]) < CAP:
        out["errors"].append({"path": p, "error": str(e)[:300]})


def process(p, counter):
    try:
        if os.path.islink(p):
            p = os.path.realpath(p)
        if not os.path.isfile(p):
            return
        st = os.stat(p)
        with open(p, "rb") as f:
            data = f.read()
        new, conflict = migrate(data)
        if conflict:
            out["conflicts"] += 1
            if len(out["conflictPaths"]) < CAP:
                out["conflictPaths"].append(p)
            return
        if new is None:
            return
        fd, tmp = tempfile.mkstemp(prefix="." + os.path.basename(p) + ".",
                                   suffix=".roles-tmp", dir=os.path.dirname(p))
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(new)
                f.flush()
                os.fsync(f.fileno())
            os.chmod(tmp, stat.S_IMODE(st.st_mode))
            try:
                os.chown(tmp, st.st_uid, st.st_gid)
            except OSError:
                pass
            now = os.stat(p)
            if now.st_size != st.st_size or now.st_mtime_ns != st.st_mtime_ns:
                os.unlink(tmp)
                out["deferred"] += 1
                return
            os.replace(tmp, p)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        out[counter] += 1
    except Exception as e:
        note_error(p, e)


for root in ROOTS:
    try:
        names = sorted(os.listdir(root))
    except FileNotFoundError:
        continue
    except Exception as e:
        note_error(root, e)
        continue
    for name in names:
        d = os.path.join(root, name)
        if not os.path.isdir(d):
            continue
        process(os.path.join(d, "role-file-watch", "last-snapshot.identity"),
                "baselinesMigrated")
        process(os.path.join(d, name + ".md"), "filesMigrated")

sys.stdout.write("${ROLES_KEY_MIGRATION_RESULT_PREFIX}" + json.dumps(out) + "\n")
sys.stdout.write("${ROLES_KEY_MIGRATION_SENTINEL}\n")
`;

const HEREDOC_DELIM = "__ROLES_KEY_MIGRATION_PY_EOF__";

/** The one shell command run per remote host. */
export const ROLES_KEY_MIGRATION_CMD =
  `python3 - <<'${HEREDOC_DELIM}'\n${ROLES_KEY_MIGRATION_PY}\n${HEREDOC_DELIM}`;

/**
 * Parse the remote script's output. Returns null when the sentinel is
 * missing or the counts line is absent / malformed.
 */
export function parseRolesKeyMigrationOutput(
  raw: string,
): RolesKeyMigrationCounts | null {
  const trimmed = raw.trimEnd();
  if (!trimmed.endsWith(ROLES_KEY_MIGRATION_SENTINEL)) return null;
  const line = trimmed
    .split("\n")
    .find((l) => l.startsWith(ROLES_KEY_MIGRATION_RESULT_PREFIX));
  if (!line) return null;
  try {
    const parsed = JSON.parse(
      line.slice(ROLES_KEY_MIGRATION_RESULT_PREFIX.length),
    ) as Partial<RolesKeyMigrationCounts>;
    const num = (v: unknown) => (typeof v === "number" ? v : 0);
    return {
      filesMigrated: num(parsed.filesMigrated),
      baselinesMigrated: num(parsed.baselinesMigrated),
      conflicts: num(parsed.conflicts),
      conflictPaths: Array.isArray(parsed.conflictPaths) ? parsed.conflictPaths : [],
      errorCount: num(parsed.errorCount),
      errors: Array.isArray(parsed.errors) ? parsed.errors : [],
      deferred: num(parsed.deferred),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Local implementation — TS port of the script above (the container image
// that runs the local-host bootstrap has no python3).
// ---------------------------------------------------------------------------

export type RolesKeyMigrationOutcome =
  | { kind: "none" }
  | { kind: "conflict" }
  | { kind: "migrated"; bytes: Buffer };

/**
 * Pure byte-level transform. latin1 round-trips every byte exactly, so
 * non-ASCII content and CRLF survive untouched.
 */
export function migrateRolesKeyBytes(data: Buffer): RolesKeyMigrationOutcome {
  if (!data.includes("\nrole:")) return { kind: "none" };
  const lines = data.toString("latin1").split("\n");
  if (lines[0].replace(/^\u00ef\u00bb\u00bf/, "").trim() !== "---") return { kind: "none" };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) return { kind: "none" };
  const idx: number[] = [];
  let hasRoles = false;
  for (let i = 1; i < end; i++) {
    if (lines[i].startsWith("role:")) idx.push(i);
    if (lines[i].startsWith("roles:")) hasRoles = true;
  }
  if (idx.length === 0) return { kind: "none" };
  if (hasRoles) return { kind: "conflict" };
  // Only the first: readers take the first `roles:` line, and a second one
  // would be a duplicate key for the YAML-based writers.
  lines[idx[0]] = "roles:" + lines[idx[0]].slice(5);
  return { kind: "migrated", bytes: Buffer.from(lines.join("\n"), "latin1") };
}

function errMsg(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}

function isEnoent(err: unknown): boolean {
  return (err as { code?: string } | undefined)?.code === "ENOENT";
}

let tmpSeq = 0;

async function processFile(
  p: string,
  counter: "filesMigrated" | "baselinesMigrated",
  out: RolesKeyMigrationCounts,
): Promise<void> {
  try {
    let target = p;
    try {
      const l = await fs.lstat(p);
      if (l.isSymbolicLink()) target = await fs.realpath(p);
    } catch (err) {
      if (isEnoent(err)) return;
      throw err;
    }
    const st = await fs.stat(target);
    if (!st.isFile()) return;
    const data = await fs.readFile(target);
    const outcome = migrateRolesKeyBytes(data);
    if (outcome.kind === "none") return;
    if (outcome.kind === "conflict") {
      out.conflicts++;
      if (out.conflictPaths.length < ROLES_KEY_MIGRATION_LIST_CAP) {
        out.conflictPaths.push(target);
      }
      return;
    }
    const tmp = path.join(
      path.dirname(target),
      `.${path.basename(target)}.${process.pid}.${++tmpSeq}.roles-tmp`,
    );
    try {
      await fs.writeFile(tmp, outcome.bytes, { flag: "wx" });
      await fs.chmod(tmp, st.mode & 0o7777);
      try {
        await fs.chown(tmp, st.uid, st.gid);
      } catch {
        /* best effort — non-root can't chown */
      }
      const now = await fs.stat(target);
      if (now.size !== st.size || now.mtimeMs !== st.mtimeMs) {
        await fs.unlink(tmp);
        out.deferred++; // changed under us — the sweep fails and retries
        return;
      }
      await fs.rename(tmp, target);
    } catch (err) {
      try {
        await fs.unlink(tmp);
      } catch {
        /* ignore */
      }
      throw err;
    }
    out[counter]++;
  } catch (err) {
    out.errorCount++;
    if (out.errors.length < ROLES_KEY_MIGRATION_LIST_CAP) {
      out.errors.push({ path: p, error: errMsg(err) });
    }
  }
}

/**
 * Run the migration under `homeRoot` (the host user's home). Never throws;
 * failures are reported in `errorCount` / `errors`.
 */
export async function migrateRolesKeyUnder(
  homeRoot: string,
): Promise<RolesKeyMigrationCounts> {
  const out: RolesKeyMigrationCounts = {
    filesMigrated: 0,
    baselinesMigrated: 0,
    conflicts: 0,
    conflictPaths: [],
    errorCount: 0,
    errors: [],
    deferred: 0,
  };
  for (const rootName of ["identities", "identities-archive"]) {
    const root = path.join(homeRoot, "fleet", rootName);
    let entries;
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (err) {
      if (!isEnoent(err)) {
        out.errorCount++;
        out.errors.push({ path: root, error: errMsg(err) });
      }
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const ent of entries) {
      const d = path.join(root, ent.name);
      let isDir = ent.isDirectory();
      if (!isDir && ent.isSymbolicLink()) {
        try {
          isDir = (await fs.stat(d)).isDirectory();
        } catch {
          isDir = false;
        }
      }
      if (!isDir) continue;
      // Baseline first, identity second — see module docstring.
      await processFile(
        path.join(d, "role-file-watch", "last-snapshot.identity"),
        "baselinesMigrated",
        out,
      );
      await processFile(path.join(d, `${ent.name}.md`), "filesMigrated", out);
    }
  }
  return out;
}
