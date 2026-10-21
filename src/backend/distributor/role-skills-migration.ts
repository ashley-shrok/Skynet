/**
 * role-skills-migration.ts — runbooks become role skills.
 *
 * Shared by both bootstrap surfaces, same split as roles-key-migration.ts:
 *   - run-bootstrap.ts (SSH, remote managed hosts) sends ROLE_SKILLS_MIGRATION_CMD
 *     — a single `python3 -` heredoc — over the channel. One exec per host.
 *   - local-fleet-install.ts (the distributor's own box; the container image
 *     has no python3, and runs as root) calls migrateRoleSkillsUnder(homeRoot),
 *     a TS port. role-skills-migration.test.ts runs one case table against
 *     BOTH implementations so they cannot drift.
 *
 * Rules (identical in both), per live role `~/fleet/roles/<role>/`:
 *   - `skills/` is created if missing (owned like the role folder), so every
 *     role has the folder its watchers and the app look in.
 *   - Each real (non-link) entry of `runbooks/` is converted to
 *     `skills/<slug>/` whose main file is `SKILL.md`:
 *       * folder `<slug>/` — main is `runbook.md`, else `<slug>.md`, else
 *         `SKILL.md`, else a loose `runbooks/<slug>.md` beside it, else none
 *         (a name-only SKILL.md is written; the load listing flags it).
 *       * loose `<slug>.md` with no folder — becomes `skills/<slug>/SKILL.md`.
 *     The main file's frontmatter gets `name: <slug>` (added, or corrected
 *     when it names something else); a file with no frontmatter gets a block
 *     prepended. Description and everything else are left as found.
 *   - Forwarding links (relative, so they resolve from the container too):
 *     the old main file name inside the folder → `SKILL.md`;
 *     `runbooks/<slug>` → `../skills/<slug>`; a loose `runbooks/<slug>.md` →
 *     `<slug>/SKILL.md` (or `../skills/<slug>/SKILL.md` when it had no folder).
 *     Old paths therefore keep resolving to the same content.
 *   - Watcher silence: every identity's file-watch baseline
 *     `last-snapshot.runbook.<role>.<slug>` gets the same frontmatter transform
 *     FIRST, and the main file is replaced by a link (never removed), so a
 *     running pre-conversion watcher re-reads identical bytes and stays quiet.
 *     The new watcher renames those baselines onto `last-snapshot.role-skill.*`.
 *   - `skills/<slug>` already existing → conflict (reported, left alone).
 *   - The main file changing between read and replace → deferred (the sweep
 *     fails the host and retries).
 * Then, across the box: wake-up specs (`identities/<n>/wakeups/<slug>/wakeup.json`
 * and legacy `wakeups/*.json`) and scheduled tasks
 * (`scheduled-agents/<slug>/scheduled-agent.json`) that name a converted
 * runbook's location are repointed: `fleet/roles/<role>/runbooks/<slug>` →
 * `fleet/roles/<role>/skills/<slug>`, with the main file name (`runbook.md`,
 * `<slug>.md`, or the loose `<slug>.md`) → `SKILL.md`. Only those path bytes
 * change; a file that parsed as JSON must still parse or it is left alone.
 * A folder wake-up's baseline `file-watch/last-snapshot.wakeup.<slug>` is
 * transformed first, for the same watcher-silence reason.
 *
 * Idempotent: converted entries are links, which are skipped; steady state is
 * a listdir per role plus a read of each spec, parsed only when it contains
 * `/runbooks/`.
 */
import path from "path";
import fs from "fs/promises";
import { systemLogger } from "../utils/logger.js";

export const ROLE_SKILLS_MIGRATION_SENTINEL = "__ROLE_SKILLS_MIGRATION_OK__";
export const ROLE_SKILLS_MIGRATION_RESULT_PREFIX = "ROLE_SKILLS_MIGRATION_RESULT ";
export const ROLE_SKILLS_MIGRATION_LIST_CAP = 20;

export interface RoleSkillsMigrationCounts {
  /** Runbooks converted into role skills. */
  converted: number;
  /** `skills/` folders created for roles that had none. */
  skillsDirsCreated: number;
  /** file-watch baselines rewritten (runbook + wake-up). */
  baselinesUpdated: number;
  /** Wake-up / scheduled-task specs repointed at the new locations. */
  specsRepointed: number;
  /** Runbooks left alone because `skills/<slug>` already exists. */
  conflicts: number;
  conflictPaths: string[];
  errorCount: number;
  errors: Array<{ path: string; error: string }>;
  /** Main files that changed mid-conversion (retried next sweep). */
  deferred: number;
}

// ---------------------------------------------------------------------------
// Remote implementation — python3 over the SSH channel. Byte-level, any
// python3 (no f-strings / walrus). String.raw: backslashes reach python
// verbatim; must never contain a backtick or the heredoc delimiter line.
// ---------------------------------------------------------------------------

export const ROLE_SKILLS_MIGRATION_PY = String.raw`
import json, os, re, stat, sys

HOME = os.path.expanduser("~")
FLEET = os.path.join(HOME, "fleet")
CAP = ${String(ROLE_SKILLS_MIGRATION_LIST_CAP)}
out = {"converted": 0, "skillsDirsCreated": 0, "baselinesUpdated": 0,
       "specsRepointed": 0, "conflicts": 0, "conflictPaths": [],
       "errorCount": 0, "errors": [], "deferred": 0}
seq = [0]


class Deferred(Exception):
    pass


def note_error(p, e):
    out["errorCount"] += 1
    if len(out["errors"]) < CAP:
        out["errors"].append({"path": p, "error": str(e)[:300]})


def note_conflict(p):
    out["conflicts"] += 1
    if len(out["conflictPaths"]) < CAP:
        out["conflictPaths"].append(p)


def ensure_frontmatter(data, slug):
    """data with name: <slug> in its frontmatter (block prepended if none)."""
    bom = b""
    if data.startswith(b"\xef\xbb\xbf"):
        bom, data = data[:3], data[3:]
    lines = data.split(b"\n")
    end = None
    if lines[0].strip() == b"---":
        for i in range(1, len(lines)):
            if lines[i].strip() == b"---":
                end = i
                break
    if end is None:
        return bom + b"---\nname: " + slug + b"\n---\n\n" + data
    cr = b"\r" if lines[0].endswith(b"\r") else b""
    for i in range(1, end):
        if lines[i].startswith(b"name:"):
            v = lines[i][5:].strip()
            if len(v) >= 2 and v[:1] == v[-1:] and v[:1] in (b"'", b'"'):
                v = v[1:-1]
            if v != slug:
                lines[i] = b"name: " + slug + cr
            return bom + b"\n".join(lines)
    lines.insert(1, b"name: " + slug + cr)
    return bom + b"\n".join(lines)


def chown_like(p, st, link=False):
    try:
        if link:
            os.lchown(p, st.st_uid, st.st_gid)
        else:
            os.chown(p, st.st_uid, st.st_gid)
    except (OSError, AttributeError):
        pass


def tmp_name(p):
    seq[0] += 1
    return os.path.join(os.path.dirname(p), ".%s.%d.%d.rs-tmp" % (os.path.basename(p), os.getpid(), seq[0]))


def write_new(p, data, mode, owner_st):
    """Atomically create/overwrite p with data, given mode + owner."""
    tmp = tmp_name(p)
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, mode)
        chown_like(tmp, owner_st)
        os.replace(tmp, p)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def link_over(p, target, owner_st, expect_st=None):
    """Replace p (or create it) with a symlink to target, atomically. With
    expect_st, refuse (Deferred) if p changed since that stat."""
    tmp = tmp_name(p)
    os.symlink(target, tmp)
    try:
        chown_like(tmp, owner_st, link=True)
        if expect_st is not None:
            now = os.lstat(p)
            if now.st_size != expect_st.st_size or now.st_mtime_ns != expect_st.st_mtime_ns:
                raise Deferred()
        os.replace(tmp, p)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def is_real_dir(p):
    return os.path.isdir(p) and not os.path.islink(p)


def is_real_file(p):
    return os.path.isfile(p) and not os.path.islink(p)


def read(p):
    with open(p, "rb") as f:
        return f.read()


def identity_dirs():
    root = os.path.join(FLEET, "identities")
    try:
        names = sorted(os.listdir(root))
    except OSError:
        return []
    return [os.path.join(root, n) for n in names if is_real_dir(os.path.join(root, n))]


def update_runbook_baselines(role, slug):
    """Each identity's watcher baseline for this runbook gets the converted
    content under its old name (a running pre-conversion watcher re-reads the
    old path and sees no change) AND under the role-skill name (a running
    post-conversion watcher sees the folder appear already baselined)."""
    old = "last-snapshot.runbook.%s.%s" % (role, slug)
    new_name = "last-snapshot.role-skill.%s.%s" % (role, slug)
    for d in identity_dirs():
        fw = os.path.join(d, "file-watch")
        b = os.path.join(fw, old)
        try:
            if not is_real_file(b):
                continue
            st = os.stat(b)
            data = read(b)
            new = ensure_frontmatter(data, slug.encode("utf-8"))
            if new != data:
                write_new(b, new, stat.S_IMODE(st.st_mode), st)
            write_new(os.path.join(fw, new_name), new, stat.S_IMODE(st.st_mode), st)
            out["baselinesUpdated"] += 1
        except Exception as e:
            note_error(b, e)


def place_dir_link(rb, slug, owner_st):
    """runbooks/<slug> -> ../skills/<slug>, via a pending link so a crash
    between the folder move and the link can be finished next sweep."""
    pending = os.path.join(rb, ".%s.rs-pending" % slug)
    if os.path.lexists(pending):
        os.unlink(pending)
    os.symlink("../skills/%s" % slug, pending)
    chown_like(pending, owner_st, link=True)
    return pending


def finish_pending(rb):
    for n in os.listdir(rb):
        if not (n.startswith(".") and n.endswith(".rs-pending")):
            continue
        p = os.path.join(rb, n)
        slug = n[1:-len(".rs-pending")]
        if not os.path.lexists(os.path.join(rb, slug)) and os.path.isdir(p):
            os.rename(p, os.path.join(rb, slug))
        else:
            os.unlink(p)


def convert(role, role_dir, rb, sk, slug, kind):
    """kind: "dir" (runbooks/<slug>/) or "loose" (runbooks/<slug>.md only)."""
    bslug = slug.encode("utf-8")
    dst = os.path.join(sk, slug)
    if os.path.lexists(dst):
        note_conflict(dst)
        return
    role_st = os.stat(role_dir)
    if kind == "loose":
        src_file = os.path.join(rb, slug + ".md")
        st = os.stat(src_file)
        data = read(src_file)
        os.mkdir(dst)
        os.chmod(dst, stat.S_IMODE(os.stat(sk).st_mode))
        chown_like(dst, role_st)
        try:
            write_new(os.path.join(dst, "SKILL.md"), ensure_frontmatter(data, bslug), stat.S_IMODE(st.st_mode), st)
            link_over(src_file, "../skills/%s/SKILL.md" % slug, st, expect_st=st)
        except BaseException:
            for p in (os.path.join(dst, "SKILL.md"), dst):
                try:
                    (os.rmdir if p == dst else os.unlink)(p)
                except OSError:
                    pass
            raise
        out["converted"] += 1
        return
    src = os.path.join(rb, slug)
    src_st = os.stat(src)
    skill = os.path.join(src, "SKILL.md")
    olds = [os.path.join(src, c) for c in ("runbook.md", slug + ".md") if is_real_file(os.path.join(src, c))]
    if is_real_file(skill):
        if olds:
            # Two candidate main files — a person has to pick.
            note_conflict(src)
            return
        main = skill
    else:
        main = olds[0] if olds else None
    loose = os.path.join(rb, slug + ".md")
    if main is None and is_real_file(loose):
        main = loose
    update_runbook_baselines(role, slug)
    if main is None:
        write_new(skill, b"---\nname: " + bslug + b"\n---\n", 0o664 & stat.S_IMODE(src_st.st_mode | 0o444), src_st)
    else:
        st = os.stat(main)
        data = read(main)
        new = ensure_frontmatter(data, bslug)
        if main == skill:
            if new != data:
                now = os.stat(main)
                if now.st_size != st.st_size or now.st_mtime_ns != st.st_mtime_ns:
                    raise Deferred()
                write_new(skill, new, stat.S_IMODE(st.st_mode), st)
        else:
            write_new(skill, new, stat.S_IMODE(st.st_mode), st)
            try:
                link_over(main, "SKILL.md" if main != loose else "%s/SKILL.md" % slug, st, expect_st=st)
            except BaseException:
                try:
                    os.unlink(skill)
                except OSError:
                    pass
                raise
    pending = place_dir_link(rb, slug, src_st)
    os.rename(src, dst)
    os.rename(pending, src)
    out["converted"] += 1


def convert_role(role, role_dir):
    sk = os.path.join(role_dir, "skills")
    if not os.path.lexists(sk):
        os.mkdir(sk)
        st = os.stat(role_dir)
        os.chmod(sk, stat.S_IMODE(st.st_mode))
        chown_like(sk, st)
        out["skillsDirsCreated"] += 1
    rb = os.path.join(role_dir, "runbooks")
    if not is_real_dir(rb) or not is_real_dir(sk):
        return
    finish_pending(rb)
    names = sorted(n for n in os.listdir(rb) if not n.startswith("."))
    dirs = set(n for n in names if is_real_dir(os.path.join(rb, n)))
    todo = [(n, "dir") for n in sorted(dirs)]
    for n in names:
        # A loose <slug>.md beside a folder of the same name is either that
        # folder's main file (taken by its conversion) or its companion —
        # never a runbook of its own.
        if (n.endswith(".md") and len(n) > 3 and not os.path.lexists(os.path.join(rb, n[:-3]))
                and is_real_file(os.path.join(rb, n))):
            todo.append((n[:-3], "loose"))
    for slug, kind in todo:
        try:
            convert(role, role_dir, rb, sk, slug, kind)
        except Deferred:
            out["deferred"] += 1
        except Exception as e:
            note_error(os.path.join(rb, slug), e)


SKILL_TARGET = re.compile(r"^\.\./skills/([^/]+)/SKILL\.md$")
DIR_TARGET = re.compile(r"^\.\./skills/([^/]+)$")
REL_TARGET = re.compile(r"^([^/]+)/SKILL\.md$")


def repoint_rules():
    """(compiled regex, replacement) per forwarding link on the box. The new
    location comes from where the link points (so a renamed role skill
    repoints to its new name); an old main-file name is mapped to SKILL.md
    only where that name is itself a forwarding link (not a companion)."""
    rules = []
    root = os.path.join(FLEET, "roles")
    try:
        roles = sorted(os.listdir(root))
    except OSError:
        return rules
    # End of the path: not followed by more path — a sentence's closing
    # period still ends it.
    tail = b"(?![A-Za-z0-9_-]|\\.[A-Za-z0-9_-])"
    for role in roles:
        rb = os.path.join(root, role, "runbooks")
        sk = os.path.join(root, role, "skills")
        if not is_real_dir(rb):
            continue
        r = re.escape(role.encode("utf-8"))
        links = {}
        for n in os.listdir(rb):
            if os.path.islink(os.path.join(rb, n)) and not n.startswith("."):
                links[n] = os.readlink(os.path.join(rb, n))
        for n in sorted(links):
            target = links[n]
            m = DIR_TARGET.match(target)
            if m:
                dest = m.group(1)
                mains = [c for c in ("runbook.md", n + ".md")
                         if os.path.islink(os.path.join(sk, dest, c))
                         and os.readlink(os.path.join(sk, dest, c)) == "SKILL.md"]
                prefix = b"fleet/roles/" + r + b"/runbooks/" + re.escape(n.encode("utf-8"))
                if mains:
                    alt = b"|".join(b"/" + re.escape(c.encode("utf-8")) for c in mains)
                    rules.append((re.compile(prefix + b"(?:" + alt + b")" + tail),
                                  b"fleet/roles/" + role.encode("utf-8") + b"/skills/" + dest.encode("utf-8") + b"/SKILL.md"))
                rules.append((re.compile(prefix + tail),
                              b"fleet/roles/" + role.encode("utf-8") + b"/skills/" + dest.encode("utf-8")))
                continue
            if not n.endswith(".md"):
                continue
            m = SKILL_TARGET.match(target)
            dest = m.group(1) if m else None
            if dest is None:
                m = REL_TARGET.match(target)
                inner = links.get(m.group(1)) if m else None
                m2 = DIR_TARGET.match(inner) if inner else None
                dest = m2.group(1) if m2 else None
            if dest is None:
                continue
            rules.append((re.compile(b"fleet/roles/" + r + b"/runbooks/" + re.escape(n.encode("utf-8")) + tail),
                          b"fleet/roles/" + role.encode("utf-8") + b"/skills/" + dest.encode("utf-8") + b"/SKILL.md"))
    return rules


def repoint_bytes(data, rules):
    if b"/runbooks/" not in data:
        return data
    for pat, repl in rules:
        data = pat.sub(lambda m: repl, data)
    return data


def repoint_file(p, rules, baseline=None):
    try:
        if not is_real_file(p):
            return
        data = read(p)
        new = repoint_bytes(data, rules)
        if new == data:
            return
        try:
            json.loads(data.decode("utf-8"))
            parsed = True
        except Exception:
            parsed = False
        if parsed:
            json.loads(new.decode("utf-8"))
        st = os.stat(p)
        if baseline is not None and is_real_file(baseline):
            bdata = read(baseline)
            bnew = repoint_bytes(bdata, rules)
            if bnew != bdata:
                bst = os.stat(baseline)
                write_new(baseline, bnew, stat.S_IMODE(bst.st_mode), bst)
                out["baselinesUpdated"] += 1
        now = os.stat(p)
        if now.st_size != st.st_size or now.st_mtime_ns != st.st_mtime_ns:
            out["deferred"] += 1
            return
        write_new(p, new, stat.S_IMODE(st.st_mode), st)
        out["specsRepointed"] += 1
    except Exception as e:
        note_error(p, e)


roles_root = os.path.join(FLEET, "roles")
try:
    role_names = sorted(os.listdir(roles_root))
except OSError:
    role_names = []
for role in role_names:
    role_dir = os.path.join(roles_root, role)
    if role.startswith(".") or not is_real_dir(role_dir):
        continue
    try:
        convert_role(role, role_dir)
    except Exception as e:
        note_error(role_dir, e)

rules = repoint_rules()
if rules:
    for d in identity_dirs():
        wd = os.path.join(d, "wakeups")
        if not is_real_dir(wd):
            continue
        for n in sorted(os.listdir(wd)):
            p = os.path.join(wd, n)
            if n.endswith(".json"):
                repoint_file(p, rules)
            elif is_real_dir(p):
                repoint_file(os.path.join(p, "wakeup.json"), rules,
                             baseline=os.path.join(d, "file-watch", "last-snapshot.wakeup." + n))
    sa = os.path.join(FLEET, "scheduled-agents")
    entries = sorted(os.listdir(sa)) if is_real_dir(sa) else []
    for n in entries:
        if not n.startswith(".") and is_real_dir(os.path.join(sa, n)):
            repoint_file(os.path.join(sa, n, "scheduled-agent.json"), rules)

sys.stdout.write("${ROLE_SKILLS_MIGRATION_RESULT_PREFIX}" + json.dumps(out) + "\n")
sys.stdout.write("${ROLE_SKILLS_MIGRATION_SENTINEL}\n")
`;

const HEREDOC_DELIM = "__ROLE_SKILLS_MIGRATION_PY_EOF__";

/** The one shell command run per remote host. */
export const ROLE_SKILLS_MIGRATION_CMD =
  `python3 - <<'${HEREDOC_DELIM}'\n${ROLE_SKILLS_MIGRATION_PY}\n${HEREDOC_DELIM}`;

/**
 * Step 7b activity log — emitted only when something was converted, created,
 * repointed, or a conflict exists (steady state logs nothing).
 */
export function logRoleSkillsMigration(
  host: { id: string; name: string },
  counts: RoleSkillsMigrationCounts,
  operation = "fleet_substrate_role_skills_migration",
  prefix = "Fleet-substrate bootstrap",
): void {
  const { converted, skillsDirsCreated, baselinesUpdated, specsRepointed, conflicts, conflictPaths } = counts;
  if (converted + skillsDirsCreated + baselinesUpdated + specsRepointed + conflicts === 0) return;
  systemLogger[conflicts > 0 ? "warn" : "info"](
    `${prefix}: runbooks → role skills on ${host.name}` +
      ` (${converted} converted, ${skillsDirsCreated} skills folder(s) created,` +
      ` ${specsRepointed} spec(s) repointed, ${baselinesUpdated} baseline(s), ${conflicts} conflict(s))`,
    {
      operation,
      fleetHostId: host.id,
      hostName: host.name,
      converted,
      skillsDirsCreated,
      baselinesUpdated,
      specsRepointed,
      conflicts,
      ...(conflicts > 0 ? { conflictPaths } : {}),
    },
  );
}

function emptyCounts(): RoleSkillsMigrationCounts {
  return {
    converted: 0,
    skillsDirsCreated: 0,
    baselinesUpdated: 0,
    specsRepointed: 0,
    conflicts: 0,
    conflictPaths: [],
    errorCount: 0,
    errors: [],
    deferred: 0,
  };
}

/** Parse the remote script's output; null when the sentinel/counts are missing. */
export function parseRoleSkillsMigrationOutput(
  raw: string,
): RoleSkillsMigrationCounts | null {
  const trimmed = raw.trimEnd();
  if (!trimmed.endsWith(ROLE_SKILLS_MIGRATION_SENTINEL)) return null;
  const line = trimmed
    .split("\n")
    .find((l) => l.startsWith(ROLE_SKILLS_MIGRATION_RESULT_PREFIX));
  if (!line) return null;
  try {
    const parsed = JSON.parse(
      line.slice(ROLE_SKILLS_MIGRATION_RESULT_PREFIX.length),
    ) as Partial<RoleSkillsMigrationCounts>;
    const num = (v: unknown) => (typeof v === "number" ? v : 0);
    return {
      converted: num(parsed.converted),
      skillsDirsCreated: num(parsed.skillsDirsCreated),
      baselinesUpdated: num(parsed.baselinesUpdated),
      specsRepointed: num(parsed.specsRepointed),
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
// Local implementation — TS port of the script above. Works on Buffers via
// latin1 so every byte round-trips.
// ---------------------------------------------------------------------------

class Deferred extends Error {}

/** Pure transform: `name: <slug>` in the frontmatter (block prepended if none). */
export function ensureRoleSkillFrontmatter(data: Buffer, slug: string): Buffer {
  const bslug = Buffer.from(slug, "utf-8").toString("latin1");
  let text = data.toString("latin1");
  let bom = "";
  if (text.startsWith("ï»¿")) {
    bom = text.slice(0, 3);
    text = text.slice(3);
  }
  const lines = text.split("\n");
  let end = -1;
  if (lines[0].trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        end = i;
        break;
      }
    }
  }
  if (end === -1) {
    return Buffer.from(bom + "---\nname: " + bslug + "\n---\n\n" + text, "latin1");
  }
  const cr = lines[0].endsWith("\r") ? "\r" : "";
  for (let i = 1; i < end; i++) {
    if (lines[i].startsWith("name:")) {
      let v = lines[i].slice(5).trim();
      if (v.length >= 2 && v[0] === v[v.length - 1] && (v[0] === "'" || v[0] === '"')) {
        v = v.slice(1, -1);
      }
      if (v !== bslug) lines[i] = "name: " + bslug + cr;
      return Buffer.from(bom + lines.join("\n"), "latin1");
    }
  }
  lines.splice(1, 0, "name: " + bslug + cr);
  return Buffer.from(bom + lines.join("\n"), "latin1");
}

function errMsg(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}

let tmpSeq = 0;
function tmpName(p: string): string {
  return path.join(path.dirname(p), `.${path.basename(p)}.${process.pid}.${++tmpSeq}.rs-tmp`);
}

type Owner = { uid: number; gid: number };

async function chownLike(p: string, st: Owner, link = false): Promise<void> {
  try {
    if (link) await fs.lchown(p, st.uid, st.gid);
    else await fs.chown(p, st.uid, st.gid);
  } catch {
    /* best effort — non-root can't chown */
  }
}

async function writeNew(p: string, data: Buffer, mode: number, owner: Owner): Promise<void> {
  const tmp = tmpName(p);
  try {
    await fs.writeFile(tmp, data, { flag: "wx", mode: 0o600 });
    await fs.chmod(tmp, mode);
    await chownLike(tmp, owner);
    await fs.rename(tmp, p);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

function sameStat(a: { size: number; mtimeMs: number }, b: { size: number; mtimeMs: number }) {
  return a.size === b.size && a.mtimeMs === b.mtimeMs;
}

async function linkOver(
  p: string,
  target: string,
  owner: Owner,
  expect?: { size: number; mtimeMs: number },
): Promise<void> {
  const tmp = tmpName(p);
  await fs.symlink(target, tmp);
  try {
    await chownLike(tmp, owner, true);
    if (expect && !sameStat(await fs.lstat(p), expect)) throw new Deferred();
    await fs.rename(tmp, p);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

async function lstatOrNull(p: string) {
  try {
    return await fs.lstat(p);
  } catch {
    return null;
  }
}

async function isRealDir(p: string): Promise<boolean> {
  const st = await lstatOrNull(p);
  return !!st && st.isDirectory();
}

async function isRealFile(p: string): Promise<boolean> {
  const st = await lstatOrNull(p);
  return !!st && st.isFile();
}

async function listSorted(p: string): Promise<string[]> {
  try {
    return (await fs.readdir(p)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  } catch {
    return [];
  }
}

function noteError(out: RoleSkillsMigrationCounts, p: string, err: unknown) {
  out.errorCount++;
  if (out.errors.length < ROLE_SKILLS_MIGRATION_LIST_CAP) out.errors.push({ path: p, error: errMsg(err) });
}

async function identityDirs(fleet: string): Promise<string[]> {
  const root = path.join(fleet, "identities");
  const outDirs: string[] = [];
  for (const n of await listSorted(root)) {
    if (await isRealDir(path.join(root, n))) outDirs.push(path.join(root, n));
  }
  return outDirs;
}

/** See the python's update_runbook_baselines: converted content under the
 *  old runbook baseline name AND the role-skill name. */
async function updateRunbookBaselines(
  fleet: string,
  role: string,
  slug: string,
  out: RoleSkillsMigrationCounts,
): Promise<void> {
  const oldName = `last-snapshot.runbook.${role}.${slug}`;
  const newName = `last-snapshot.role-skill.${role}.${slug}`;
  for (const d of await identityDirs(fleet)) {
    const fw = path.join(d, "file-watch");
    const b = path.join(fw, oldName);
    try {
      if (!(await isRealFile(b))) continue;
      const st = await fs.stat(b);
      const data = await fs.readFile(b);
      const next = ensureRoleSkillFrontmatter(data, slug);
      if (!next.equals(data)) await writeNew(b, next, st.mode & 0o7777, st);
      await writeNew(path.join(fw, newName), next, st.mode & 0o7777, st);
      out.baselinesUpdated++;
    } catch (err) {
      noteError(out, b, err);
    }
  }
}

async function placeDirLink(rb: string, slug: string, owner: Owner): Promise<string> {
  const pending = path.join(rb, `.${slug}.rs-pending`);
  if (await lstatOrNull(pending)) await fs.unlink(pending);
  await fs.symlink(`../skills/${slug}`, pending);
  await chownLike(pending, owner, true);
  return pending;
}

async function finishPending(rb: string): Promise<void> {
  for (const n of await listSorted(rb)) {
    if (!(n.startsWith(".") && n.endsWith(".rs-pending"))) continue;
    const p = path.join(rb, n);
    const slug = n.slice(1, -".rs-pending".length);
    let targetIsDir = false;
    try {
      targetIsDir = (await fs.stat(p)).isDirectory();
    } catch {
      targetIsDir = false;
    }
    if (!(await lstatOrNull(path.join(rb, slug))) && targetIsDir) await fs.rename(p, path.join(rb, slug));
    else await fs.unlink(p);
  }
}

async function convert(
  fleet: string,
  role: string,
  roleDir: string,
  rb: string,
  sk: string,
  slug: string,
  kind: "dir" | "loose",
  out: RoleSkillsMigrationCounts,
): Promise<void> {
  const dst = path.join(sk, slug);
  if (await lstatOrNull(dst)) {
    out.conflicts++;
    if (out.conflictPaths.length < ROLE_SKILLS_MIGRATION_LIST_CAP) out.conflictPaths.push(dst);
    return;
  }
  const roleSt = await fs.stat(roleDir);
  if (kind === "loose") {
    const srcFile = path.join(rb, `${slug}.md`);
    const st = await fs.stat(srcFile);
    const data = await fs.readFile(srcFile);
    await fs.mkdir(dst);
    await fs.chmod(dst, (await fs.stat(sk)).mode & 0o7777);
    await chownLike(dst, roleSt);
    try {
      await writeNew(path.join(dst, "SKILL.md"), ensureRoleSkillFrontmatter(data, slug), st.mode & 0o7777, st);
      await linkOver(srcFile, `../skills/${slug}/SKILL.md`, st, st);
    } catch (err) {
      await fs.unlink(path.join(dst, "SKILL.md")).catch(() => {});
      await fs.rmdir(dst).catch(() => {});
      throw err;
    }
    out.converted++;
    return;
  }
  const src = path.join(rb, slug);
  const srcSt = await fs.stat(src);
  const skill = path.join(src, "SKILL.md");
  const olds: string[] = [];
  for (const cand of ["runbook.md", `${slug}.md`]) {
    if (await isRealFile(path.join(src, cand))) olds.push(path.join(src, cand));
  }
  let main: string | null;
  if (await isRealFile(skill)) {
    if (olds.length > 0) {
      // Two candidate main files — a person has to pick.
      out.conflicts++;
      if (out.conflictPaths.length < ROLE_SKILLS_MIGRATION_LIST_CAP) out.conflictPaths.push(src);
      return;
    }
    main = skill;
  } else {
    main = olds[0] ?? null;
  }
  const loose = path.join(rb, `${slug}.md`);
  if (main === null && (await isRealFile(loose))) main = loose;
  await updateRunbookBaselines(fleet, role, slug, out);
  if (main === null) {
    await writeNew(
      skill,
      Buffer.from(`---\nname: ${slug}\n---\n`, "utf-8"),
      0o664 & ((srcSt.mode | 0o444) & 0o7777),
      srcSt,
    );
  } else {
    const st = await fs.stat(main);
    const data = await fs.readFile(main);
    const next = ensureRoleSkillFrontmatter(data, slug);
    if (main === skill) {
      if (!next.equals(data)) {
        if (!sameStat(await fs.stat(main), st)) throw new Deferred();
        await writeNew(skill, next, st.mode & 0o7777, st);
      }
    } else {
      await writeNew(skill, next, st.mode & 0o7777, st);
      try {
        await linkOver(main, main !== loose ? "SKILL.md" : `${slug}/SKILL.md`, st, st);
      } catch (err) {
        await fs.unlink(skill).catch(() => {});
        throw err;
      }
    }
  }
  const pending = await placeDirLink(rb, slug, srcSt);
  await fs.rename(src, dst);
  await fs.rename(pending, src);
  out.converted++;
}

async function convertRole(
  fleet: string,
  role: string,
  roleDir: string,
  out: RoleSkillsMigrationCounts,
): Promise<void> {
  const sk = path.join(roleDir, "skills");
  if (!(await lstatOrNull(sk))) {
    await fs.mkdir(sk);
    const st = await fs.stat(roleDir);
    await fs.chmod(sk, st.mode & 0o7777);
    await chownLike(sk, st);
    out.skillsDirsCreated++;
  }
  const rb = path.join(roleDir, "runbooks");
  if (!(await isRealDir(rb)) || !(await isRealDir(sk))) return;
  await finishPending(rb);
  const names = (await listSorted(rb)).filter((n) => !n.startsWith("."));
  const dirs = new Set<string>();
  for (const n of names) if (await isRealDir(path.join(rb, n))) dirs.add(n);
  const todo: Array<[string, "dir" | "loose"]> = [...dirs].sort().map((n) => [n, "dir"]);
  for (const n of names) {
    // A loose <slug>.md beside a folder of the same name is that folder's
    // main file or its companion — never a runbook of its own.
    if (
      n.endsWith(".md") &&
      n.length > 3 &&
      !(await lstatOrNull(path.join(rb, n.slice(0, -3)))) &&
      (await isRealFile(path.join(rb, n)))
    ) {
      todo.push([n.slice(0, -3), "loose"]);
    }
  }
  for (const [slug, kind] of todo) {
    try {
      await convert(fleet, role, roleDir, rb, sk, slug, kind, out);
    } catch (err) {
      if (err instanceof Deferred) out.deferred++;
      else noteError(out, path.join(rb, slug), err);
    }
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}

/** latin1 view of a UTF-8 string, matching how file bytes are decoded. */
function l1(s: string): string {
  return Buffer.from(s, "utf-8").toString("latin1");
}

type Rule = { re: RegExp; repl: string };

/** See the python's repoint_rules: destinations come from where each
 *  forwarding link points; an old main-file name maps to SKILL.md only where
 *  that name is itself a forwarding link. */
async function repointRules(fleet: string): Promise<Rule[]> {
  const rules: Rule[] = [];
  const root = path.join(fleet, "roles");
  // End of the path: not followed by more path — a sentence's closing
  // period still ends it.
  const tail = "(?![A-Za-z0-9_-]|\\.[A-Za-z0-9_-])";
  for (const role of await listSorted(root)) {
    const rb = path.join(root, role, "runbooks");
    const sk = path.join(root, role, "skills");
    if (!(await isRealDir(rb))) continue;
    const r = escapeRe(l1(role));
    const links = new Map<string, string>();
    for (const n of await listSorted(rb)) {
      const st = await lstatOrNull(path.join(rb, n));
      if (st?.isSymbolicLink() && !n.startsWith(".")) links.set(n, await fs.readlink(path.join(rb, n)));
    }
    for (const [n, target] of links) {
      const dm = /^\.\.\/skills\/([^/]+)$/.exec(target);
      if (dm) {
        const dest = dm[1];
        const mains: string[] = [];
        for (const c of ["runbook.md", `${n}.md`]) {
          const lp = path.join(sk, dest, c);
          const lst = await lstatOrNull(lp);
          if (lst?.isSymbolicLink() && (await fs.readlink(lp)) === "SKILL.md") mains.push(c);
        }
        const prefix = `fleet/roles/${r}/runbooks/${escapeRe(l1(n))}`;
        if (mains.length > 0) {
          rules.push({
            re: new RegExp(`${prefix}(?:${mains.map((c) => "/" + escapeRe(l1(c))).join("|")})${tail}`, "g"),
            repl: l1(`fleet/roles/${role}/skills/${dest}/SKILL.md`),
          });
        }
        rules.push({ re: new RegExp(`${prefix}${tail}`, "g"), repl: l1(`fleet/roles/${role}/skills/${dest}`) });
        continue;
      }
      if (!n.endsWith(".md")) continue;
      let dest: string | null = /^\.\.\/skills\/([^/]+)\/SKILL\.md$/.exec(target)?.[1] ?? null;
      if (dest === null) {
        const rel = /^([^/]+)\/SKILL\.md$/.exec(target);
        const inner = rel ? links.get(rel[1]) : undefined;
        dest = inner ? (/^\.\.\/skills\/([^/]+)$/.exec(inner)?.[1] ?? null) : null;
      }
      if (dest === null) continue;
      rules.push({
        re: new RegExp(`fleet/roles/${r}/runbooks/${escapeRe(l1(n))}${tail}`, "g"),
        repl: l1(`fleet/roles/${role}/skills/${dest}/SKILL.md`),
      });
    }
  }
  return rules;
}

function repointText(text: string, rules: Rule[]): string {
  if (!text.includes("/runbooks/")) return text;
  for (const { re, repl } of rules) text = text.replace(re, () => repl);
  return text;
}

async function repointFile(
  p: string,
  rules: Rule[],
  out: RoleSkillsMigrationCounts,
  baseline?: string,
): Promise<void> {
  try {
    if (!(await isRealFile(p))) return;
    const data = await fs.readFile(p);
    const text = data.toString("latin1");
    const nextText = repointText(text, rules);
    if (nextText === text) return;
    const next = Buffer.from(nextText, "latin1");
    let parsed = true;
    try {
      JSON.parse(data.toString("utf-8"));
    } catch {
      parsed = false;
    }
    if (parsed) JSON.parse(next.toString("utf-8"));
    const st = await fs.stat(p);
    if (baseline && (await isRealFile(baseline))) {
      const bdata = await fs.readFile(baseline);
      const btext = bdata.toString("latin1");
      const bnext = repointText(btext, rules);
      if (bnext !== btext) {
        const bst = await fs.stat(baseline);
        await writeNew(baseline, Buffer.from(bnext, "latin1"), bst.mode & 0o7777, bst);
        out.baselinesUpdated++;
      }
    }
    if (!sameStat(await fs.stat(p), st)) {
      out.deferred++;
      return;
    }
    await writeNew(p, next, st.mode & 0o7777, st);
    out.specsRepointed++;
  } catch (err) {
    noteError(out, p, err);
  }
}

/**
 * Run the conversion under `homeRoot` (the host user's home). Never throws;
 * failures are reported in `errorCount` / `errors`.
 */
export async function migrateRoleSkillsUnder(homeRoot: string): Promise<RoleSkillsMigrationCounts> {
  const out = emptyCounts();
  const fleet = path.join(homeRoot, "fleet");
  const rolesRoot = path.join(fleet, "roles");
  for (const role of await listSorted(rolesRoot)) {
    const roleDir = path.join(rolesRoot, role);
    if (role.startsWith(".") || !(await isRealDir(roleDir))) continue;
    try {
      await convertRole(fleet, role, roleDir, out);
    } catch (err) {
      noteError(out, roleDir, err);
    }
  }
  const rules = await repointRules(fleet);
  if (rules.length > 0) {
    for (const d of await identityDirs(fleet)) {
      const wd = path.join(d, "wakeups");
      if (!(await isRealDir(wd))) continue;
      for (const n of await listSorted(wd)) {
        const p = path.join(wd, n);
        if (n.endsWith(".json")) await repointFile(p, rules, out);
        else if (await isRealDir(p)) {
          await repointFile(
            path.join(p, "wakeup.json"),
            rules,
            out,
            path.join(d, "file-watch", `last-snapshot.wakeup.${n}`),
          );
        }
      }
    }
    const sa = path.join(fleet, "scheduled-agents");
    for (const n of (await isRealDir(sa)) ? await listSorted(sa) : []) {
      if (!n.startsWith(".") && (await isRealDir(path.join(sa, n)))) {
        await repointFile(path.join(sa, n, "scheduled-agent.json"), rules, out);
      }
    }
  }
  return out;
}
