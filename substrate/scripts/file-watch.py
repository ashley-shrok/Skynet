#!/usr/bin/env python3
"""file-watch.py — ambient watcher for edits to an identity's role file, identity file, id skill, role skills, AND project file.

Started as a role-file watcher (hence the `role-file` event tag); it now covers
every file an identity holds in context. Sibling of the relay receiver, the
wake-up scheduler, and the context-watch — but unlike them it never WAKES the
agent. Its events are queued in <identity>/pending-context/ and handed over by
the pending-context-drain hook at the agent's next turn or tool call (see
Deferred delivery below), so mid-session edits become visible to a running
identity without a recycle and without spending a turn on an idle one.

Why this exists: closes the mid-session gap where an agent's in-context copy of its
role file, its own identity file, the id skill, or a role skill has
diverged from disk. For the role file, that's a peer identity of the same role
editing it in another session. For the identity file, that's almost always user
editing it directly (cosmetic frontmatter changes, an identity-scope `remember`)
— peer sessions of the SAME identity are essentially impossible. For the id skill
(user-wide, distributed by fleet-substrate), the driver was the 2026-09-29
incident where a workstation agent grepped the current on-disk SKILL.md but
mis-read it against its in-context copy from a pre-rename version, spending
turns chasing a mismatch that was purely stale-memory. For role skills, the driver
was the 2026-09-19 canonical-deploy-command update: an identity edited the deploy
role skill to include a load-bearing `-f` flag, and a peer identity deployed with
the OLD command minutes later because the role skill edit fired no ambient event
and stale memory of the command outweighed re-reading the updated role skill. Every
fresh /id load STILL reads role + identity + id skill + lists role skills;
this is purely additive.

Role coverage: the identity file's frontmatter `roles:` key (zero or more role
slugs, any YAML shape — see parse_roles_frontmatter; the singular `role:` key is
NOT read) names the roles whose `~/fleet/roles/<role>/<role>.md` files and
role skills are watched. An identity with no roles (`roles: []`, an empty `roles:`,
or no key) is normal: there are no role targets, and everything else below is
watched as usual. Editing `roles:` mid-session re-execs the watcher so the
targets follow: an added role (including a first one) emits a pointer to read
its role file, a removed role (including the last one) emits a notice and its
baselines are dropped. A malformed `roles:` edit (it names something, but no
valid slug) does not re-exec — the old set stays watched and stderr says why.

Project coverage: when the identity file's frontmatter has `project: <slug>`, the
watch includes `~/fleet/projects/<slug>/project.md` (event tag `project-file`).
Moving into, between, or out of a project re-execs the watcher so the target
follows; joining mid-session emits a pointer to read the new project file.
Nested projects: every ancestor's project.md is watched too (event tag
`parent-project`), with its member-list churn never reported. A parent-line
change anywhere in the chain, or an ancestor's folder going away, re-resolves
the chain and emits one `project-chain` notice instead of a raw diff.

Role-skill coverage extends to the sentinel file only — `~/fleet/roles/<role>/skills/<slug>/SKILL.md`
per the id skill's role-skill convention. Companion files in the same subfolder
(checklists, prompt archives, scripts) are IGNORED — their churn is not a signal
that the canonical procedure changed. The old `runbooks/` folder (forwarding
links left by the conversion) is not watched. Role-skill events (same shape rule
as role/identity — see _emit_event):
  - `📝 [role-skill: <role>/<slug>] your <slug> role skill changed — <diff>` (small edit, inline)
  - `📝 [role-skill: <role>/<slug>] your <slug> role skill changed — READ NOW before continuing — <path>` (large edit, spilled)
  - `📝 [role-skill: <role>/<slug>] added — <description> — Read <path>` — new role skill appeared
  - `📝 [role-skill: <role>/<slug>] deleted`  — SKILL.md OR its parent slug folder removed

Wake-up coverage: the identity's own `<identity>/wakeups/<slug>/wakeup.json`
specs (event tag `wakeup`). Same sentinel-per-subfolder shape as role skills, but
the agent also creates and deletes these itself — the self-edit hook claims a
`wakeups/<slug>` the moment a tool call names it, existing or not, so the
agent's own add / edit / delete stays silent. A spec the scheduler removed
after its one fire (one_shot, one-time sensor) is not reported either: the
agent already got the ⏰/📡 line. Unlike role skills, specs added or deleted while
the watcher was down are reported at the next start (only the very first run,
marked by `wakeups-armed`, snapshots silently).
  - `📝 [wakeup: <slug>] your <slug> wake-up changed — <diff>`
  - `📝 [wakeup: <slug>] added — <spec as one line>` (or `— Read <path>` when long)
  - `📝 [wakeup: <slug>] deleted`

The watch is diff-first and dumb on purpose: it fires the unified diff of what
changed (inline when small, spilled to a file pointer when large), and lets the AGENT
decide whether the change is its own echo, a peer's, or user's. See the design
rationale in:
  .planning/shapes/shape-role-file-watch.md (in the app's source repo)

Vendored into the app's substrate and distributed to every host running agent substrate
via the substrate distributor. Stdlib + inotifywait subprocess only.

Usage:  python3 file-watch.py <identity_dir>
Env:    FILE_WATCH_POLL_SEC (default 2) — fallback polling loop granularity (only
        engaged when inotifywait is not on PATH).
"""

import datetime
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import traceback

# Inline threshold: a diff whose event line fits under INLINE_MAX bytes is delivered
# inline; a bigger one spills to a file and the event carries the path instead.
INLINE_MAX = 460

# Every event is ONE line (see _flatten_diff): the drain hook delivers each queued
# line as one entry of the agent's additional context, and a flattened diff keeps a
# burst of edits compact.
POLL = int(os.environ.get("FILE_WATCH_POLL_SEC", "2"))

# Self-edit suppression — settle window before diffing. When the agent's own
# tool call touches a watched file, the PostToolUse hook
# (self-edit-baseline-sync.sh) atomically refreshes the baseline and writes a
# sha256 marker at `<baseline>.self-edit-hash`. This settle window gives the
# hook time to complete before the watcher does its comparison; the hash-guard
# in _is_self_edit then confirms the current content matches what the hook
# recorded. Env-override so operators can tune without redeploy.
# Shape rationale: .planning/shapes/shape-stop-self-edit-events.md.
SELF_EDIT_SETTLE_MS = int(os.environ.get("FILE_WATCH_SELF_EDIT_SETTLE_MS", "200"))

# Self-edit claims — the settle window alone only covers tool calls that
# return within it, because the PostToolUse hook fires when the WHOLE call
# returns. A Bash call that edits a watched file and then keeps running
# (`sed -i … && git log …`, an edit followed by a build) outlived it and the
# agent's own edit emitted. The PreToolUse side of the same hook drops
# `<baseline_dir>/claims/<baseline-name>.<tool_use_id>` for each watched file
# the call names; while a live claim exists on a CHANGED file we hold the
# comparison until the hook releases it (after syncing), then run the normal
# settle + hash-guard. Claims older than CLAIM_MAX_SEC are ignored — covers a
# call interrupted before any Post* hook could release it. 600s = the
# harness's max foreground Bash timeout.
CLAIM_MAX_SEC = int(os.environ.get("FILE_WATCH_CLAIM_MAX_SEC", "600"))
CLAIM_POLL_SEC = 0.1

# Harness PID for the orphan check inside the claim hold (set in main()). The
# hold can last as long as a tool call; a dead harness must still end us.
_harness_pid = None

# Module-level inotifywait subprocess handle so signal handlers can clean it up.
_inotify_proc = None

# Self-reload — pick up a new version of this script without a session restart.
# The ambient-monitor never restarts its children, so a long-lived session
# (always-on identities especially) kept running whatever code it started
# with long after the distributor installed a newer copy. A daemon thread
# polls this file; once a change has held still for two polls AND compiles,
# it sets _reload_pending and terminates inotifywait. The main loop drains
# what inotifywait already printed, sees EOF, and re-execs in place: same
# PID (ambient-monitor's child handle and our stdout pipe survive, and
# _single_instance skips its own PID), fresh code. The new image's startup
# pass diffs every baseline, so a change that landed during the handoff
# still emits — nothing is lost, at worst a self-edit in flight at the exact
# moment of reload emits once.
SELF_RELOAD_POLL_SEC = float(os.environ.get("FILE_WATCH_SELF_RELOAD_POLL_SEC", "30"))
_SELF_PATH = os.path.realpath(__file__)
_reload_pending = threading.Event()


def _self_stat():
    try:
        st = os.stat(_SELF_PATH)
        return (st.st_ino, st.st_size, st.st_mtime_ns)
    except OSError:
        return None


# Taken at import — the version this process is actually running. Sampling
# later (after the startup pass) could mistake an install that landed during
# startup for the running code and never reload into it.
_SELF_START_STAT = _self_stat()


def _self_reload_watch(start_stat):
    """Daemon thread body — see SELF_RELOAD_POLL_SEC."""
    seen = start_stat
    while not _reload_pending.is_set():
        time.sleep(SELF_RELOAD_POLL_SEC)
        cur = _self_stat()
        if cur is None or cur == start_stat:
            seen = cur
            continue
        if cur != seen:
            seen = cur  # still changing (or first sight) — wait one more poll
            continue
        try:
            with open(_SELF_PATH) as f:
                compile(f.read(), _SELF_PATH, "exec")
        except Exception as e:
            # A broken install must not replace a working watcher; keep
            # running the old code and retry when the file changes again.
            print(
                "⚠️ [file-watch] new version at %s does not compile (%s) — "
                "staying on the running version" % (_SELF_PATH, e),
                file=sys.stderr,
                flush=True,
            )
            start_stat = cur
            continue
        _reload_pending.set()
        proc = _inotify_proc
        if proc is not None:
            try:
                proc.terminate()
            except Exception:
                pass


def _reexec_self(reason="new version installed"):
    print(
        "[file-watch] %s — reloading in place (pid %d)" % (reason, os.getpid()),
        file=sys.stderr,
        flush=True,
    )
    sys.stdout.flush()
    os.execv(sys.executable, [sys.executable, _SELF_PATH] + sys.argv[1:])


# --- `roles:` frontmatter parser -------------------------------------------
# COPY of tests/fixtures/roles_frontmatter_reference.py (parse_roles_frontmatter).
# It MUST stay identical in behavior to the reference — `roles:` only (the
# singular `role:` key is NOT read), every shape in
# tests/fixtures/roles-frontmatter-cases.json, slug regex below. Checked by
# tests/roles-frontmatter-conformance.test.sh. Change the reference first, then
# re-copy; never edit this copy alone.
ROLES_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def parse_roles_frontmatter(text):
    lines = text.lstrip("\ufeff").replace("\r\n", "\n").split("\n")
    if not lines or lines[0].strip() != "---":
        return []
    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end is None:
        return []

    def clean(s):
        s = re.sub(r"\s+#.*$", "", s).strip()
        return s.strip("\"'").strip()

    raw = []
    for i in range(1, end):
        m = re.match(r"^roles:(.*)$", lines[i])
        if not m:
            continue
        inline = re.sub(r"(^|\s)#.*$", "", m.group(1)).strip()
        if inline in ("~", "null", "Null", "NULL"):
            break  # YAML null (`roles: ~` / `roles: null`): zero roles
        if inline:
            if inline.startswith("[") and inline.endswith("]"):
                inline = inline[1:-1]
            raw = [clean(p) for p in inline.split(",")]
        else:
            for j in range(i + 1, end):
                s = lines[j].strip()
                if not s or s.startswith("#"):
                    continue
                m2 = re.match(r"^-\s*(.*)$", s)
                if not m2:
                    break
                raw.append(clean(m2.group(1)))
        break

    out = []
    for r in raw:
        if r and ROLES_SLUG_RE.match(r) and r not in out:
            out.append(r)
    return out
# --- end of reference copy --------------------------------------------------


def _parse_roles_from_frontmatter(identity_file_path):
    """Read the identity file and return (roles, None) or (None, err_msg).

    The role list comes solely from parse_roles_frontmatter (the reference
    copy above). An identity with no roles — no `roles:` key, `roles:` with
    no value, `roles: []`, `roles: ""`/`''`, or a YAML null (`roles: ~`,
    `roles: null`) — returns ([], None): holding zero roles is a
    normal state. The extra inspection below only tells that apart from a
    `roles:` line that names something but no valid slug (malformed), and
    shapes the diagnostic for it — it never changes which roles are
    returned."""
    try:
        with open(identity_file_path, encoding="utf-8", errors="replace") as f:
            text = f.read()
    except FileNotFoundError:
        return None, "identity file not found: %s" % identity_file_path
    except OSError as e:
        return None, "could not read identity file %s: %s" % (identity_file_path, e)

    roles = parse_roles_frontmatter(text)
    if roles:
        return roles, None

    lines = text.lstrip("\ufeff").replace("\r\n", "\n").split("\n")
    end = None
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                end = i
                break
    if end is None:
        return None, "no YAML frontmatter block found in %s" % identity_file_path
    fm = lines[1:end]
    idx = next((i for i, ln in enumerate(fm) if re.match(r"^roles:", ln)), None)
    if idx is None:
        return [], None
    inline = re.sub(r"(^|\s)#.*$", "", fm[idx][len("roles:"):]).strip()
    # Explicit "no roles" values: `[]`, an empty quoted string (`""` / `''`),
    # or a YAML null (`~`, `null`, `Null`, `NULL` — the 1.1/1.2 core forms
    # the parser above also reads as zero roles).
    if re.match(r"^\[\s*\]$", inline) or inline in (
        '""', "''", "~", "null", "Null", "NULL",
    ):
        return [], None
    if not inline:
        for ln in fm[idx + 1:]:
            s = ln.strip()
            if not s or s.startswith("#"):
                continue
            if ln[:1].isspace() or s.startswith("-"):
                break
            return [], None
        else:
            return [], None
    return None, "no valid role slug under `roles:` in frontmatter of %s" % (
        identity_file_path,
    )


# Project slug — mirrors the app's project-slug rule (/^[a-z0-9-]{1,64}$/).
_PROJECT_SLUG_RE = re.compile(r"^[a-z0-9-]{1,64}$")


def _parse_project_from_frontmatter(identity_file_path):
    """Return the `project:` slug from the identity file's frontmatter, or None.

    Absent key, empty value, unreadable file, or a value failing
    `_PROJECT_SLUG_RE` all read as "not in a project" — the project watch is
    optional, so ambiguity means don't-watch rather than an error.
    """
    try:
        with open(identity_file_path) as f:
            lines = f.readlines()
    except OSError:
        return None
    fence_indices = [i for i, ln in enumerate(lines) if ln.strip() == "---"]
    if len(fence_indices) < 2:
        return None
    for i in range(fence_indices[0] + 1, fence_indices[1]):
        m = re.match(r"^project:\s*(.*?)\s*(#.*)?$", lines[i].rstrip("\n"))
        if m:
            slug = (m.group(1) or "").strip().strip('"').strip("'").strip()
            return slug if _PROJECT_SLUG_RE.match(slug) else None
    return None


def _resolve_project(identity_file_path):
    """(slug, project.md path) for the identity's current project, or
    (None, None) when it has none or the project file isn't on disk (an
    archived project lives under ~/fleet/projects/archive/, so it resolves to
    None here too)."""
    slug = _parse_project_from_frontmatter(identity_file_path)
    if slug is None:
        return None, None
    path = os.path.expanduser("~/fleet/projects/%s/project.md" % slug)
    if not os.path.isfile(path):
        return None, None
    return slug, path


def _project_baseline_path(baseline_dir, slug):
    return os.path.join(baseline_dir, "last-snapshot.project.%s" % slug)


# ---------------------------------------------------------------------------
# Nested projects — the project chain.
#
# A project may name a parent project with a `parent:` line in its
# project.md; folders stay flat under ~/fleet/projects/. An identity's chain is
# its own project plus every ancestor, top first. The rules mirror the sidebar
# exactly (fleet-status-sweep.py reads the parent line; the app resolves the
# tree), so what an agent is told about its chain always matches what the user
# sees:
#   - a project is any non-symlink folder under ~/fleet/projects/ whose name
#     is a valid slug other than `archive` (project.md optional);
#   - a parent that isn't such a folder ends the chain (top level);
#   - a project caught in a parent loop is top level, so the chain stops at
#     the first loop member reached; when the identity's own project is in the
#     loop its chain is just itself.
# Ancestor project files are watched like the own one, but their member-list
# churn is never reported, and a parent-line change anywhere in the chain is
# told as one chain notice instead of a raw diff.
# ---------------------------------------------------------------------------

# Matches the sweep's PROJECT_FRONTMATTER_HEAD_BYTES — a parent line past this
# is invisible to the sidebar, so it must be invisible here too.
_PROJECT_HEAD_CHARS = 65536
_CHAIN_STATE_NAME = "last-chain"


def _project_dir(slug):
    return os.path.expanduser("~/fleet/projects/%s" % slug)


def _project_md_path(slug):
    return os.path.join(_project_dir(slug), "project.md")


def _project_exists(slug):
    """True iff `slug` is a live project the sidebar would list."""
    if slug is None or slug == "archive" or not _PROJECT_SLUG_RE.match(slug):
        return False
    d = _project_dir(slug)
    return os.path.isdir(d) and not os.path.islink(d)


def _project_frontmatter_lines(slug):
    """Frontmatter body lines of a project's project.md (sweep parity: first
    _PROJECT_HEAD_CHARS chars, utf-8-sig, first two `---` lines), or []."""
    try:
        with open(_project_md_path(slug), encoding="utf-8-sig") as f:
            raw = f.read(_PROJECT_HEAD_CHARS)
    except (OSError, UnicodeDecodeError):
        return []
    lines = raw.split("\n")
    fences = [i for i, ln in enumerate(lines) if ln.strip() == "---"]
    if len(fences) < 2:
        return []
    return lines[fences[0] + 1: fences[1]]


def _yaml_parent_value(line):
    """(matched, slug_or_None) for one frontmatter line, read the way the
    backend's YAML 1.2 parser reads a top-level `parent:` key: a space may
    precede the colon, `#` starts a comment only after whitespace, quotes make
    a string, and unquoted null / ~ / true / false / numbers (including -1
    and 1e3) are not strings. A line that isn't a `parent:` key → (False,
    None). The last `parent:` line wins, valid or not, as in the parser."""
    m = re.match(r"^parent\s*:(\s.*|)$", line.rstrip("\n").rstrip("\r"))
    if not m:
        return False, None
    raw = m.group(1).strip()
    quoted = raw[:1] in ("'", '"')
    if quoted:
        end = raw.find(raw[0], 1)
        if end == -1:
            return True, None
        val = raw[1:end].strip()
    else:
        if raw.startswith("#"):
            raw = ""
        c = re.search(r"\s#", raw)
        val = (raw[: c.start()] if c else raw).strip()
    if not quoted and (
        val in ("", "-", "~", "null", "true", "false")
        or re.fullmatch(r"-?[0-9]+([eE]-?[0-9]+)?|0o[0-7]+|0x[0-9a-f]+", val)
    ):
        return True, None
    return True, (val if _PROJECT_SLUG_RE.match(val) else None)


def _read_project_parent(slug):
    """The parent slug named in a project's project.md, or None — same
    reading as the sweep (see _yaml_parent_value; comment lines skipped, last
    `parent:` line wins), and the project's own slug reads as no parent."""
    parent = None
    for line in _project_frontmatter_lines(slug):
        if line.lstrip().startswith("#"):
            continue
        matched, val = _yaml_parent_value(line)
        if matched:
            parent = val
    return None if parent == slug else parent


def _read_project_display_name(slug):
    """A project's displayName (quotes stripped), falling back to its slug —
    the last non-empty `displayName:` line wins, as in the sweep."""
    name = slug
    for line in _project_frontmatter_lines(slug):
        m = re.match(r"^displayName:\s*(.+?)\s*(#.*)?$", line.rstrip("\n"))
        if m:
            val = m.group(1).strip().strip('"').strip("'").strip()
            if val:
                name = val
    return name


def _resolve_chain(own_slug):
    """The identity's project chain, top ancestor first and own project last;
    [] when it has no live project. See the nested-projects block above for
    the rules."""
    if not _project_exists(own_slug):
        return []
    path = [own_slug]
    cur = _read_project_parent(own_slug)
    while _project_exists(cur):
        if cur in path:
            # Loop: path[i:] are its members and render at top level, so the
            # chain ends at the first one reached (just the own project when
            # it is itself on the loop).
            path = path[: path.index(cur) + 1]
            break
        path.append(cur)
        cur = _read_project_parent(cur)
    path.reverse()
    return path


def _chain_text(chain):
    return " › ".join(_read_project_display_name(s) for s in chain)


# Display names of the chain last told to the agent, so a project it has left
# (perhaps archived since) is still named the way the sidebar showed it.
_told_names = {}


def _read_chain_state(baseline_dir):
    """The chain last told to the agent (top first), or None. Each line of the
    state file is `<slug>\t<display name>`; names land in _told_names."""
    try:
        with open(os.path.join(baseline_dir, _CHAIN_STATE_NAME), encoding="utf-8") as f:
            rows = [ln.split("\t", 1) for ln in f.read().splitlines() if ln]
    except (OSError, UnicodeDecodeError):
        return None
    chain = []
    for row in rows:
        if not _PROJECT_SLUG_RE.match(row[0]):
            return None
        chain.append(row[0])
        if len(row) == 2 and row[1].strip():
            _told_names[row[0]] = row[1].strip()
    return chain


def _write_chain_state(baseline_dir, chain):
    tmp = os.path.join(baseline_dir, "." + _CHAIN_STATE_NAME + ".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            for slug in chain:
                name = _read_project_display_name(slug).replace("\t", " ").replace("\n", " ")
                f.write("%s\t%s\n" % (slug, name))
        os.replace(tmp, os.path.join(baseline_dir, _CHAIN_STATE_NAME))
    except OSError:
        pass


def _left_name(slug):
    """Name for a project the agent is no longer inside: the one it was told
    (the project may be archived by now), else whatever is on disk."""
    return _told_names.get(slug) or _read_project_display_name(slug)


def _chain_files(chain):
    """Ancestors in `chain` whose project.md exists — the watched ancestor files."""
    return tuple(s for s in chain[:-1] if os.path.isfile(_project_md_path(s)))


def _scope_signature(identity_file_path):
    """Everything the watch targets depend on for the project chain: own
    project, resolved chain, and which ancestors have a file to watch."""
    own, _ = _resolve_project(identity_file_path)
    chain = _resolve_chain(own) if own else []
    return (own, tuple(chain), _chain_files(chain))


def _emit_chain_notice(old_chain, new_chain):
    """One plain notice for a rearranged chain (same own project, different
    ancestors): the whole new chain, the project files that are new above the
    agent, and the projects it is no longer under."""
    own = new_chain[-1]
    added = [s for s in new_chain[:-1] if s not in old_chain]
    removed = [s for s in old_chain[:-1] if s not in new_chain]
    if len(new_chain) == 1:
        line = "📝 [project-chain: %s] your project %s is now top level (no parent project)" % (
            own, _read_project_display_name(own),
        )
    else:
        line = "📝 [project-chain: %s] your project chain is now %s" % (own, _chain_text(new_chain))
    reads = []
    for s in added:
        pmd = _project_md_path(s)
        if os.path.isfile(pmd):
            reads.append("%s %s" % (_read_project_display_name(s), pmd))
    if reads:
        line += " — new above you, Read top-down: " + "; ".join(reads)
    if removed:
        line += " — no longer inside %s: drop their conventions" % ", ".join(
            _left_name(r) for r in removed
        )
    _out(line)


def _prune_project_baselines(baseline_dir, chain):
    """Drop project baselines (and queued notices) for projects no longer in
    the chain, so a later return cold-starts clean."""
    try:
        names = os.listdir(baseline_dir)
    except OSError:
        return
    prefix = "last-snapshot.project."
    gone = set()
    for n in names:
        if not n.startswith(prefix):
            continue
        slug = n[len(prefix):]
        if slug.endswith(".self-edit-hash"):
            slug = slug[: -len(".self-edit-hash")]
        if slug in chain:
            continue
        gone.add(slug)
        try:
            os.remove(os.path.join(baseline_dir, n))
        except OSError:
            pass
    if gone:
        _drop_pending(
            ["📝 [project-file: %s]" % s for s in gone]
            + ["📝 [parent-project: %s]" % s for s in gone]
        )


def _strip_frontmatter_keys(data, keys):
    """`data` (bytes) with the named top-level frontmatter keys removed. Used
    to judge a project-file change on what the agent should hear: never the
    parent line (chain notices cover it), and for ancestors never the member
    list. `parent` is a single line (as the app writes it); `members` is
    removed the way the agent-supervisor removes it when rewriting — the
    header, then for a block list every indented `-` item and any blank or
    comment line inside it."""
    text = data.decode("utf-8", errors="replace")
    lines = text.split("\n")
    fences = [i for i, ln in enumerate(lines) if ln.strip() == "---"]
    if len(fences) < 2:
        return data
    fm = lines[fences[0] + 1: fences[1]]
    kept, i = [], 0
    while i < len(fm):
        ln = fm[i]
        if "parent" in keys and re.match(r"^parent\s*:", ln):
            i += 1
            continue
        if "members" in keys and re.match(r"^members:(\s|$)", ln):
            i += 1
            if not re.match(r"^members:\s*\[", ln):
                while i < len(fm) and (
                    re.match(r"^\s+-", fm[i]) or not fm[i].strip()
                    or fm[i].lstrip().startswith("#")
                ):
                    i += 1
            continue
        kept.append(ln)
        i += 1
    out = lines[: fences[0] + 1] + kept + lines[fences[1]:]
    return "\n".join(out).encode("utf-8")


# Keys never reported for each project-file kind (see _strip_frontmatter_keys).
_PROJECT_HIDDEN_KEYS = {
    "project-file": ("parent",),
    "parent-project": ("parent", "members"),
}


def _role_file_path(role):
    return os.path.expanduser("~/fleet/roles/%s/%s.md" % (role, role))


def _remove_role_baselines(baseline_dir, role):
    """Drop every baseline this process kept for `role` — the role file's
    (`last-snapshot.role.<role>`) and its role skills'
    (`last-snapshot.role-skill.<role>.<slug>`), plus any self-edit markers on
    them — so a later re-add cold-starts clean instead of diffing against a
    stale snapshot."""
    role_prefix = "last-snapshot.role.%s" % role
    role_skill_prefix = "last-snapshot.role-skill.%s." % role
    try:
        names = os.listdir(baseline_dir)
    except OSError:
        return
    for n in names:
        if (
            n == role_prefix
            or n == role_prefix + ".self-edit-hash"
            or n.startswith(role_skill_prefix)
        ):
            try:
                os.remove(os.path.join(baseline_dir, n))
            except OSError:
                pass


# Last roles-parse diagnostic logged by _restart_if_scope_changed, so a broken
# `roles:` line is reported once per distinct problem rather than on every
# event while it stays broken.
_last_roles_err = None


def _roles_changed(identity_file_path, watched_roles):
    """(added, removed) role lists when the identity's `roles:` set differs
    from the one this process watches, else None.

    Dropping to zero roles is an ordinary change (every watched role comes
    back as removed). A malformed `roles:` line returns None after logging to
    stderr: the new process would exit at startup, so re-execing would trade
    a working watch for a dead one. We keep watching the old set until the
    line is fixed. Order-only changes are not a change — the same files are
    watched either way."""
    global _last_roles_err
    new_roles, err = _parse_roles_from_frontmatter(identity_file_path)
    if err is not None:
        if err != _last_roles_err:
            print(
                "⚠️ [file-watch] identity roles unusable (%s) — still watching %r"
                % (err, list(watched_roles)),
                file=sys.stderr,
                flush=True,
            )
            _last_roles_err = err
        return None
    _last_roles_err = None
    added = [r for r in new_roles if r not in watched_roles]
    removed = [r for r in watched_roles if r not in new_roles]
    if not added and not removed:
        return None
    return added, removed


def _restart_if_scope_changed(identity_file_path, watched_project, watched_roles, baseline_dir):
    """Re-exec when the identity's scope — its `project:` or its `roles:` set —
    differs from what this process is watching. The targets list and the
    inotifywait argv are fixed per process, so a restart is how the watch
    follows; the new process cold-snapshots any newly watched file.

    Project: moved into, between, or out of a project, or the watched project
    file vanished (archived). On a join, emit a pointer to the new project
    file: the agent read no project file at /id load (or read a different
    one), and the identity-file diff alone only shows the `project:` line
    changing. The old project's baseline is removed so a later re-join starts
    clean instead of diffing against a stale snapshot. When the new project
    sits inside others, the pointer names every file in the chain, top-down.

    Project chain: same project, but its ancestors changed — a parent line
    moved anywhere up the chain, or an ancestor's folder went away. The new
    process tells the agent (see the chain-state check in main()), so the
    notice holds even when the agent made the change itself.

    Roles: same idea per role. Each newly added role gets a pointer to its
    role file (and role skills folder, if any) since the agent never read it;
    each removed role gets a one-line notice and its baselines are dropped.
    Gaining a first role or losing the last one is no different. A malformed
    new `roles:` value never re-execs (see _roles_changed)."""
    reasons = []

    new_slug, new_path = _resolve_project(identity_file_path)
    if new_slug != watched_project:
        if watched_project is not None:
            try:
                os.remove(_project_baseline_path(baseline_dir, watched_project))
            except OSError:
                pass
            _drop_pending(["📝 [project-file: %s]" % watched_project])
        chain = _resolve_chain(new_slug) if new_slug is not None else []
        left = [s for s in _watched_chain[:-1] if s not in chain]
        left_text = (
            " — no longer inside %s: drop their conventions"
            % ", ".join(_left_name(s) for s in left)
        ) if left else ""
        if new_slug is not None:
            above = list(_chain_files(chain))
            if above:
                _out(
                    "📝 [project-file: %s] you're now in project %s, inside %s — Read top-down: %s%s"
                    % (new_slug, new_slug, _chain_text(chain[:-1]),
                       ", ".join([_project_md_path(s) for s in above] + [new_path]), left_text)
                )
            else:
                _out(
                    "📝 [project-file: %s] you're now in project %s — Read %s%s"
                    % (new_slug, new_slug, new_path, left_text)
                )
        elif left:
            _out("📝 [project-chain: %s] you left project %s%s" % (
                watched_project, _left_name(watched_project), left_text,
            ))
        reasons.append("project changed (%s → %s)" % (watched_project, new_slug))
    elif new_slug is not None and _scope_signature(identity_file_path) != _watched_signature:
        reasons.append("project chain changed (%s → %s)" % (
            " › ".join(_watched_chain), " › ".join(_resolve_chain(new_slug)),
        ))

    roles_delta = _roles_changed(identity_file_path, watched_roles)
    if roles_delta is not None:
        added, removed = roles_delta
        for role in added:
            rf = _role_file_path(role)
            if os.path.exists(rf):
                line = "📝 [role-file: %s] you now hold role %s — Read %s" % (role, role, rf)
                rd = os.path.expanduser("~/fleet/roles/%s/skills" % role)
                if os.path.isdir(rd):
                    line += " (role skills: %s)" % rd
            else:
                line = (
                    "📝 [role-file: %s] you now hold role %s — but its role file %s "
                    "does not exist" % (role, role, rf)
                )
            _out(line)
        for role in removed:
            _remove_role_baselines(baseline_dir, role)
            _drop_pending(["📝 [role-file: %s]" % role, "📝 [role-skill: %s/" % role])
            _out("📝 [role-file: %s] you no longer hold role %s" % (role, role))
        reasons.append("roles changed (+%s −%s)" % (
            ",".join(added) or "none", ",".join(removed) or "none",
        ))

    if not reasons:
        return
    global _inotify_proc
    proc = _inotify_proc
    if proc is not None:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            pass
        _inotify_proc = None
    _reexec_self("; ".join(reasons))


def _single_instance(state_dir, ident_dir):
    """Newest-wins guard: kill any prior file-watch for THIS identity, claim the pidfile."""
    pf = os.path.join(state_dir, "file-watch.pid")
    _kill_prior(pf, ident_dir)
    open(pf, "w").write(str(os.getpid()))


def _kill_prior(pf, ident_dir):
    """SIGTERM the watcher named in pidfile `pf` if it is still a watcher of
    THIS identity. The "file-watch" match also covers pre-rename
    role-file-watch processes."""
    try:
        old = int(open(pf).read().strip())
        if old != os.getpid():
            try:
                cmd = open("/proc/%d/cmdline" % old).read()
            except Exception:
                cmd = os.popen("ps -p %d -o command= 2>/dev/null" % old).read()
            if "file-watch" in cmd and ident_dir in cmd:
                os.kill(old, 15)
    except Exception:
        pass


def _read_bytes(path):
    """Read file bytes, return None on any error."""
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return None


def _atomic_write_baseline(baseline_dir, last_snapshot_path, data):
    """Atomically write `data` bytes to last_snapshot_path via a temp file."""
    tmp_path = os.path.join(baseline_dir, "last-snapshot.tmp")
    with open(tmp_path, "wb") as f:
        f.write(data)
    os.replace(tmp_path, last_snapshot_path)


def _run_diff(baseline_path, role_file_path):
    """Run unified diff between baseline and current role file. Returns stdout str.
    diff exits 1 when files differ — that is the normal/expected case; capture anyway.

    --label flags replace the file paths in the `---`/`+++` header lines so the event
    doesn't leak the internal snapshot path (~150-250 chars of noise per event) into
    every wake. The agent only cares that the two sides are baseline vs current.
    """
    result = subprocess.run(
        [
            "diff", "-u",
            "--label", "baseline",
            "--label", "current",
            str(baseline_path),
            str(role_file_path),
        ],
        capture_output=True,
        text=True,
    )
    return result.stdout


def _flatten_diff(diff_stdout):
    """Collapse a unified diff into ONE line suitable for a single wake.

    Drops the `---` / `+++` / `@@` header lines (no value to the agent — the file and
    identity are already named in the event tag) and joins the remaining content lines
    with a visible separator so the +/- structure survives the flattening.

    Returns "(no textual change)" for an empty/whitespace-only diff rather than an
    empty string, so the emitted event is never a bare tag with nothing after it.
    """
    kept = []
    for raw in diff_stdout.splitlines():
        if raw.startswith(("---", "+++", "@@")):
            continue
        stripped = raw.rstrip()
        if not stripped:
            continue
        kept.append(stripped)
    if not kept:
        return "(no textual change)"
    return " ⏎ ".join(kept)


# ---------------------------------------------------------------------------
# Deferred delivery. Nothing this watcher reports needs a turn of its own: an
# idle agent loses nothing by learning about a role-file edit when it next
# works, and a role-file edit used to wake EVERY running holder of the role
# just to say "noted, nothing to do". So events never go to stdout (which
# ambient-monitor would paste in as a wake). Each one is written as a file to
# <identity>/pending-context/, and the pending-context-drain hook hands the
# queue to the agent as additional context on its next UserPromptSubmit or
# PostToolUse — the next turn it takes, or the next tool call of the turn it
# is in. No wake, so no fan-out spread is needed either.
#
# Each line is a diff against the previous one for the same target, so order
# matters: names sort by write time (ns) and the drain delivers in name order.
# ---------------------------------------------------------------------------
_queue_dir = None   # set in main(); <identity>/pending-context
# Ancestor slug → levels above the own project (1 = parent); set in main().
_ancestor_levels = {}
# The project chain this process watches, top first (see _resolve_chain),
# and the full scope signature it was built from (see _scope_signature).
_watched_chain = []
_watched_signature = None

# Chain re-check. The chain depends on more than the files this process
# watches — a missing parent can be created, an archived one restored, a bare
# ancestor folder can gain its project.md, a loop can be broken from a project
# just off the chain, an ancestor's file can be deleted. Rather than watch the
# whole projects tree (every identity's watcher, recursively, over every
# project and the archive), a daemon thread re-resolves the scope signature
# every CHAIN_POLL_SEC; on a difference it ends inotifywait so the main loop
# runs the scope check, exactly as the self-reload thread does for code.
CHAIN_POLL_SEC = float(os.environ.get("FILE_WATCH_CHAIN_POLL_SEC", "3"))
_scope_recheck = threading.Event()


def _chain_poll_watch(identity_file_path):
    while True:
        time.sleep(CHAIN_POLL_SEC)
        try:
            changed = _scope_signature(identity_file_path) != _watched_signature
        except Exception:
            continue
        if not changed or _scope_recheck.is_set():
            continue
        _scope_recheck.set()
        proc = _inotify_proc
        if proc is not None:
            try:
                proc.terminate()
            except Exception:
                pass
_out_lock = threading.Lock()


def _out(line):
    """Queue one event line for the agent's next turn (see Deferred delivery).
    Falls back to stderr — never stdout — if the queue can't be written: a
    lost notice is better than a wake the design exists to prevent."""
    with _out_lock:
        try:
            os.makedirs(_queue_dir, exist_ok=True)
            name = "%d-%s.line" % (time.time_ns(), os.urandom(4).hex())
            tmp = os.path.join(_queue_dir, "." + name + ".tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(line)
            os.replace(tmp, os.path.join(_queue_dir, name))
        except (OSError, TypeError) as e:
            print("[file-watch] could not queue event (%s) — dropped: %s" % (e, line[:200]),
                  file=sys.stderr, flush=True)


def _drop_pending(tag_prefixes):
    """Discard queued lines whose tag starts with any of `tag_prefixes` — used
    when the identity stops watching a target (left a role or project)."""
    try:
        names = os.listdir(_queue_dir)
    except (OSError, TypeError):
        return
    for name in names:
        if not name.endswith(".line"):
            continue
        path = os.path.join(_queue_dir, name)
        try:
            with open(path, encoding="utf-8") as f:
                line = f.read()
            if line.startswith(tuple(tag_prefixes)):
                os.remove(path)
        except OSError:
            pass


def _migrate_legacy_state(ident_dir, baseline_dir, queue_dir):
    """One-time move from the pre-rename layout: <identity>/role-file-watch/
    becomes <identity>/file-watch/ (baselines kept, so the startup pass sees no
    spurious diff), and lines the old watcher was holding for its fan-out
    delay move into the deferred queue, in order, instead of being lost."""
    legacy = os.path.join(ident_dir, "role-file-watch")
    if not os.path.isdir(legacy) or os.path.exists(baseline_dir):
        return
    # A pre-rename watcher still running for this identity would keep writing
    # under the old path; newest wins, as in _single_instance.
    _kill_prior(os.path.join(legacy, ".state", "role-file-watch.pid"), ident_dir)
    try:
        os.rename(legacy, baseline_dir)
    except OSError as e:
        print("[file-watch] could not migrate %s → %s (%s)" % (legacy, baseline_dir, e),
              file=sys.stderr, flush=True)
        return
    held = os.path.join(baseline_dir, ".state", "pending")
    try:
        names = sorted(os.listdir(held))
    except OSError:
        return
    # Held names are <due-ms>-<hex>.line, due up to minutes ahead; queue
    # names are <write-ns>-<hex>.line. Renamed onto ns names just before now,
    # in their held order, so they sort ahead of anything queued from here on.
    held_lines = sorted(
        (n[:-len(".claimed")] if n.endswith(".claimed") else n, n) for n in names
    )
    held_lines = [(b, n) for b, n in held_lines if b.endswith(".line")]
    os.makedirs(queue_dir, exist_ok=True)
    first_ns = time.time_ns() - len(held_lines)
    for i, (_, name) in enumerate(held_lines):
        try:
            os.replace(os.path.join(held, name),
                       os.path.join(queue_dir, "%d-%s.line" % (first_ns + i, os.urandom(4).hex())))
        except OSError:
            pass
    shutil.rmtree(held, ignore_errors=True)


def _change_phrase(kind, label):
    """Return the natural-language "your X changed" phrase for each event kind.

    Makes the CHANGE the explicit subject of the event line, rather than leaving
    the agent to infer it from the tag + path — an inference some agents defer
    ("I'll read that after I finish what I'm doing") when the change might bear
    directly on what they're currently doing.

    For role skill, `label` is `<role>/<slug>` — we surface just the slug in the
    sentence since the tag already carries both.
    """
    if kind == "role-file":
        return "your role file"
    if kind == "identity-file":
        return "your identity file"
    if kind == "id-skill":
        return "your id skill"
    if kind == "user-claudemd":
        return "your user-wide CLAUDE.md"
    if kind == "project-file":
        return "your project file"
    if kind == "parent-project":
        return "your %s project %s's file" % (
            "parent" if _ancestor_levels.get(label, 1) == 1 else "ancestor",
            _read_project_display_name(label),
        )
    if kind == "role-skill":
        slug = label.split("/", 1)[-1]
        return "your %s role skill" % slug
    if kind == "wakeup":
        return "your %s wake-up" % label
    return "the file"  # defensive; kinds are closed-set today


def _emit_event(kind, label, diff_stdout, spill_dir):
    """Emit one event line (or spill to file if over INLINE_MAX).

    `kind` is "role-file", "identity-file", or "role-skill"; `label` is the role name,
    identity name, or `<role>/<slug>` respectively — the two together form the event
    tag the agent sees.

    Both shapes lead with "your X changed" so the agent doesn't have to infer the
    change from the tag/path alone.

    INLINE_MAX is a BYTE cap (the harness measures the emitted line in UTF-8 bytes),
    so we check `len(line.encode("utf-8"))` — not `len(line)`, which counts code points.
    Role/identity files routinely contain multi-byte chars (curly quotes, em-dashes,
    emoji in directives); a line at len==460 code points can be well over 460 bytes
    and get truncated by the harness — exactly the failure mode the spill exists to
    prevent.

    A unified diff is ALWAYS multi-line, so we cannot simply spill on line count —
    that would spill every event and force a file Read for even a one-word change,
    losing the whole point of inlining. Instead we FLATTEN the diff to a single line
    (newlines → ' ⏎ ') and inline it when the flattened form fits the byte budget.
    Only a genuinely large diff spills.

    Flattening also drops the `---`/`+++`/`@@` header lines: they carry no information
    the agent wants (the labels are already in the event tag, and hunk offsets are
    meaningless for a file it can just read) and they are most of the line budget on
    a small change.

    On spill we deliberately DO NOT include a preview snippet: if the diff was too
    big to inline, the agent has to Read the spill file anyway, so a truncated
    preview only clutters the line without informing the decision to read.
    """
    flat = _flatten_diff(diff_stdout)
    phrase = _change_phrase(kind, label)
    line = "📝 [%s: %s] %s changed — %s" % (kind, label, phrase, flat)
    if len(line.encode("utf-8")) <= INLINE_MAX:
        _out(line)
    else:
        # Spill: create spill_dir lazily, write full diff, emit pointer-only line.
        # Spill filenames include the kind so role + identity spills at the same
        # timestamp don't collide.
        os.makedirs(spill_dir, exist_ok=True)
        ts = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H-%M-%SZ")
        # Kind + label + ns: several ancestors share the parent-project kind,
        # and two large edits in one second must not share a spill file.
        spill_path = os.path.join(
            spill_dir, "%s.%s.%s.%d.diff" % (ts, kind, label.replace("/", "-"), time.time_ns()),
        )
        with open(spill_path, "w") as f:
            f.write(diff_stdout)
        _out(
            "📝 [%s: %s] %s changed — READ NOW before continuing — %s"
            % (kind, label, phrase, spill_path),
        )


def _is_self_edit(baseline_path, current_bytes):
    """Hash-guard for self-edit suppression. Returns True iff the sync hook
    (self-edit-baseline-sync.sh) recently recorded a fingerprint at
    <baseline_path>.self-edit-hash AND that fingerprint matches sha256 of the
    current file content — i.e. the agent's own tool call is what produced
    the change we're now looking at, AND nothing has changed since.

    Consumes the marker unconditionally (whether match or mismatch). Stale
    markers cannot linger and silently suppress a later peer edit.

    Rationale (why hash-guard, not just "marker exists"): the race we care
    about is `me edit → peer edit → my sync hook fires`. In that path, my
    sync hook would sync baseline to CURRENT content (which now includes
    peer's edit) and record a hash of that. The watcher's later comparison
    would find baseline==current, emit nothing, and the peer's edit would
    be silently absorbed. By comparing sha256(current) against what the
    hook actually observed at hook-time, we detect the "content changed
    again after hook ran" case and fall back to normal diff+emit. See
    .planning/shapes/shape-stop-self-edit-events.md § "peer edit during
    settle window".
    """
    marker_path = baseline_path + ".self-edit-hash"
    try:
        with open(marker_path) as f:
            recorded = f.read().strip()
    except OSError:
        return False
    matched = False
    if current_bytes is not None and recorded:
        current_hash = hashlib.sha256(current_bytes).hexdigest()
        matched = (recorded == current_hash)
    # Consume marker regardless — stale entries must not survive to affect
    # future events.
    try:
        os.remove(marker_path)
    except OSError:
        pass
    return matched


def _live_claims(baseline_path):
    """Claim files on this baseline younger than CLAIM_MAX_SEC (see
    CLAIM_MAX_SEC). Any OSError → treated as no claim (fail toward emitting)."""
    claim_dir = os.path.join(os.path.dirname(baseline_path), "claims")
    prefix = os.path.basename(baseline_path) + "."
    live = []
    try:
        names = os.listdir(claim_dir)
    except OSError:
        return live
    now = time.time()
    for name in names:
        if not name.startswith(prefix):
            continue
        try:
            if now - os.path.getmtime(os.path.join(claim_dir, name)) < CLAIM_MAX_SEC:
                live.append(name)
        except OSError:
            pass
    return live


def _wait_for_claim_release(target_path, baseline_path):
    """If the target has drifted from its baseline AND the agent's in-flight
    tool call has claimed it, block until the claim is released or goes stale.

    Only drifted files wait, so an event on one target never holds another
    target that merely got claimed by a call that hasn't written it yet. The
    loop is single-threaded, so other events queue behind the hold — they
    are delayed, never dropped: the hook's release step syncs only the files
    the call claimed, so a queued peer edit to another file is still a diff
    when we reach it."""
    current = _read_bytes(target_path)
    if current is None or current == _read_bytes(baseline_path):
        return
    claims = _live_claims(baseline_path)
    if not claims:
        return
    started = time.time()
    while claims:
        if _harness_pid is not None:
            try:
                os.kill(_harness_pid, 0)
            except OSError:
                sys.exit(0)
        time.sleep(CLAIM_POLL_SEC)
        claims = _live_claims(baseline_path)
    print(
        "[file-watch] held %s %.1fs for in-flight tool call claim"
        % (os.path.basename(baseline_path), time.time() - started),
        file=sys.stderr,
        flush=True,
    )


def _diff_and_emit(kind, label, target_path, baseline_dir, baseline_path, spill_dir, hold=True, settle=True):
    """Compare current target file against its baseline; if different, emit event
    and update baseline. Returns True if target file is gone (caller should exit).

    Self-edit suppression: sleeps SELF_EDIT_SETTLE_MS before comparison so the
    PostToolUse sync hook has time to refresh the baseline and drop its
    hash marker. Then _is_self_edit checks whether the current content matches
    what the hook recorded — if yes, silent baseline refresh, no emit; if no
    (marker absent, or content changed since hook ran), fall through to normal
    diff + emit. A changed file claimed by an in-flight tool call is held
    first (see _wait_for_claim_release) — except at cold start (hold=False):
    claims surviving a watcher restart belong to calls we can't see finish,
    and blocking there would delay arming inotifywait."""
    if hold:
        _wait_for_claim_release(target_path, baseline_path)
    if settle and SELF_EDIT_SETTLE_MS > 0:
        time.sleep(SELF_EDIT_SETTLE_MS / 1000.0)

    current = _read_bytes(target_path)
    if current is None:
        print(
            "⚠️ [file-watch] %s file disappeared: %s" % (kind, target_path),
            file=sys.stderr,
            flush=True,
        )
        # A project file is optional — its loss is a scope change, not fatal.
        return kind not in _PROJECT_HIDDEN_KEYS

    baseline = _read_bytes(baseline_path)

    # Consume any self-edit marker eagerly — stale markers must NOT linger
    # across events, or a stale hash from a prior tool call could silently
    # suppress an unrelated future peer edit whose content happens to match.
    is_self_edit = _is_self_edit(baseline_path, current)

    if baseline is None:
        # Baseline missing mid-run (unusual) — re-snapshot silently.
        _atomic_write_baseline(baseline_dir, baseline_path, current)
        return False

    if current != baseline:
        if is_self_edit:
            # Agent's own edit — refresh baseline silently, no wake.
            _atomic_write_baseline(baseline_dir, baseline_path, current)
            return False
        hidden = _PROJECT_HIDDEN_KEYS.get(kind)
        if hidden is None:
            diff_stdout = _run_diff(baseline_path, target_path)
        else:
            # Project files: judge only what the agent should hear. A change
            # confined to hidden keys (the parent line → a chain notice; an
            # ancestor's member list → nothing) refreshes silently.
            old_view = _strip_frontmatter_keys(baseline, hidden)
            new_view = _strip_frontmatter_keys(current, hidden)
            if old_view == new_view:
                _atomic_write_baseline(baseline_dir, baseline_path, current)
                return False
            diff_stdout = _run_view_diff(baseline_dir, old_view, new_view)
        _emit_event(kind, label, diff_stdout, spill_dir)
        _atomic_write_baseline(baseline_dir, baseline_path, current)

    return False


def _run_view_diff(baseline_dir, old_view, new_view):
    """Unified diff of two in-memory file views (see _run_diff)."""
    old_tmp = os.path.join(baseline_dir, ".view.baseline.tmp")
    new_tmp = os.path.join(baseline_dir, ".view.current.tmp")
    try:
        with open(old_tmp, "wb") as f:
            f.write(old_view)
        with open(new_tmp, "wb") as f:
            f.write(new_view)
        return _run_diff(old_tmp, new_tmp)
    finally:
        for t in (old_tmp, new_tmp):
            try:
                os.remove(t)
            except OSError:
                pass


def _diff_and_emit_all(targets, baseline_dir, spill_dir):
    """Run _diff_and_emit for every target. Returns True if ANY target is gone.

    A vanished project file is not fatal — the project was archived or the
    identity left it; _restart_if_scope_changed handles that. The self-edit
    settle window is waited once for the batch, not once per target, so a
    long project chain doesn't slow every notice down."""
    if SELF_EDIT_SETTLE_MS > 0:
        time.sleep(SELF_EDIT_SETTLE_MS / 1000.0)
    for kind, label, target_path, baseline_path in targets:
        if kind in _PROJECT_HIDDEN_KEYS and not os.path.exists(target_path):
            continue
        gone = _diff_and_emit(
            kind, label, target_path, baseline_dir, baseline_path, spill_dir, settle=False,
        )
        if gone:
            return True
    return False


# ---------------------------------------------------------------------------
# Role-skill helpers (added 2026-09-19).
# ---------------------------------------------------------------------------

# Slug regex — kebab-case per the id skill's slug rule (shared with bounties +
# apps). Applied when reading subfolder names off disk to reject anything that
# would traverse or otherwise not correspond to a legitimate role skill slug (a
# subfolder named "..", spaces, or garbage). Defence in depth on top of "the
# folder exists and contains a SKILL.md" — we simply skip anything the regex
# rejects, matching the sweep script's slug-injection defence.
_ROLE_SKILL_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
_ROLE_SKILL_SLUG_MAX_LEN = 64  # generous vs 40-char app cap; role-skill names skew descriptive


def _enumerate_role_skill_slugs(skills_dir):
    """Return sorted list of slugs whose `<slug>/SKILL.md` exists on disk.

    Slugs failing `_ROLE_SKILL_SLUG_RE` or exceeding `_ROLE_SKILL_SLUG_MAX_LEN` are
    skipped silently — a peer identity might have half-created a folder or
    dropped something oddly-named. The watch is deliberately conservative:
    ambiguous state means don't-watch, not surface-an-error.
    """
    if not os.path.isdir(skills_dir):
        return []
    slugs = []
    try:
        entries = sorted(os.listdir(skills_dir))
    except OSError:
        return []
    for entry in entries:
        if not _ROLE_SKILL_SLUG_RE.match(entry):
            continue
        if len(entry) > _ROLE_SKILL_SLUG_MAX_LEN:
            continue
        rb_path = os.path.join(skills_dir, entry, "SKILL.md")
        if not os.path.isfile(rb_path):
            continue
        slugs.append(entry)
    return slugs


def _role_skill_paths(skills_dir, baseline_dir, role, slug):
    """Return the (SKILL.md path, per-role/per-slug baseline path) tuple.

    Baselines are namespaced by role — `last-snapshot.role-skill.<role>.<slug>` —
    so an identity holding roles A and B whose role skill slugs happen to collide
    (both have a `deploy` role skill, say) don't stomp each other's baselines.
    """
    rb_path = os.path.join(skills_dir, slug, "SKILL.md")
    base_path = os.path.join(baseline_dir, "last-snapshot.role-skill.%s.%s" % (role, slug))
    return rb_path, base_path


def _existing_baseline_slugs(baseline_dir, role):
    """Return the set of role-skill slugs currently baselined for `role`.

    Reads `last-snapshot.role-skill.<role>.<slug>` files. Used at startup to detect
    role skills that were deleted while we were down (baselines with no matching
    on-disk SKILL.md).
    """
    prefix = "last-snapshot.role-skill.%s." % role
    slugs = set()
    try:
        for name in os.listdir(baseline_dir):
            if name.startswith(prefix):
                slugs.add(name[len(prefix):])
    except OSError:
        pass
    return slugs


def _role_skill_description(rb_path):
    """The `description:` from a SKILL.md's frontmatter, folded onto one line
    ("" when absent or unreadable). Plain, quoted and block-scalar values —
    the same reading as id-load-context's role-skill listing."""
    try:
        with open(rb_path, encoding="utf-8-sig") as f:
            lines = f.read().split("\n")
    except (OSError, UnicodeDecodeError):
        return ""
    if not lines or lines[0].strip() != "---":
        return ""
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        return ""
    block = lines[1:end]
    for i, line in enumerate(block):
        if not line.startswith("description:"):
            continue
        raw = line[len("description:"):].strip()
        cont = []
        for nxt in block[i + 1:]:
            if not (nxt.startswith((" ", "\t")) or not nxt.strip()):
                break
            if nxt.strip():
                cont.append(nxt.strip())
        if raw[:1] in (">", "|"):
            value = " ".join(cont)
        else:
            value = " ".join([raw] + cont)
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
        return " ".join(value.split())
    return ""


def _emit_role_skill_added(role, slug, rb_path):
    """New-role-skill event — its description plus a pointer to the file
    rather than a diff.

    Role skills are documents meant to be read in full; a diff-from-empty would
    be either large + spilled (equivalent to the pointer) or small and still
    not useful as a `+`-prefixed diff. Match the recv.sh long-message idiom
    of PATH-before-preview so the agent has an obvious next step.
    """
    desc = _role_skill_description(rb_path)
    if desc:
        _out("📝 [role-skill: %s/%s] added — %s — Read %s" % (role, slug, desc, rb_path))
    else:
        _out("📝 [role-skill: %s/%s] added — Read %s" % (role, slug, rb_path))


def _emit_role_skill_deleted(role, slug):
    """Role-skill-deleted event — no diff possible, one honest line."""
    _out("📝 [role-skill: %s/%s] deleted" % (role, slug))


def _slug_from_event(w_path, f_name, role_skill_roles):
    """Given an inotify event's `%w` (watched dir) and `%f` (filename), return
    (role, slug) for the role skill involved, or (None, None) if the event is not
    on a SKILL.md / slug-subfolder we care about.

    `role_skill_roles` is a list of `(role, skills_dir)` — one per role the
    identity holds. Event routing walks the list and returns as soon as a
    match is found, so an event fired inside role A's role skills tree is
    attributed to role A (never confused with role B).

    Two shapes we want to match, per role:
      1. `%w = skills_dir/<slug>`, `%f = SKILL.md`  → returns (role, <slug>)
         (the sentinel file itself changed / was created / deleted)
      2. `%w = skills_dir`, `%f = <slug>` with ISDIR event
         → returns (role, <slug>) (the whole slug subfolder was created or removed)
    Everything else — companion files inside a slug folder, nested subdirs,
    events on unrelated paths — returns (None, None).
    """
    # Normalize trailing slash (inotifywait sometimes emits with trailing slash
    # on %w for -r-watched dirs).
    w_norm = w_path.rstrip("/")

    for role, skills_dir in role_skill_roles:
        rb_root = skills_dir.rstrip("/")

        # Shape 1: event on <skills>/<slug>/SKILL.md
        if f_name == "SKILL.md":
            parent = os.path.dirname(w_norm)
            if parent == rb_root:
                slug = os.path.basename(w_norm)
                if _ROLE_SKILL_SLUG_RE.match(slug) and len(slug) <= _ROLE_SKILL_SLUG_MAX_LEN:
                    return role, slug
        # Shape 2: event on <skills>/<slug> directly (create/delete of folder)
        if w_norm == rb_root and f_name:
            if _ROLE_SKILL_SLUG_RE.match(f_name) and len(f_name) <= _ROLE_SKILL_SLUG_MAX_LEN:
                return role, f_name
    return None, None


def _handle_role_skill_event(
    role, slug, events, tracked_slugs, skills_dir, baseline_dir, spill_dir,
):
    """Route a role-skill event to add / edit / delete emission.

    `tracked_slugs` is a mutable set — the set of role skill slugs whose baseline
    exists in the state directory. This function mutates it in place:
      - Add: slug goes from untracked → tracked; write baseline, emit "added".
      - Edit: slug already tracked; diff baseline vs current, emit if changed.
      - Delete: slug goes from tracked → untracked; remove baseline, emit "deleted".

    Events we care about (uppercased set, matching inotifywait --format %e output):
      - CLOSE_WRITE / MODIFY / MOVED_TO on a SKILL.md → edit or add depending
        on whether the slug was already tracked.
      - CREATE on a SKILL.md (or MOVED_TO landing SKILL.md into the folder)
        → same handling; the CLOSE_WRITE case covers the write-then-close path.
      - DELETE / MOVED_FROM on a SKILL.md or on the slug subfolder → delete.
    """
    rb_path, base_path = _role_skill_paths(skills_dir, baseline_dir, role, slug)

    is_delete = bool(events & {"DELETE", "MOVED_FROM"})
    is_write = bool(events & {"CLOSE_WRITE", "CREATE", "MOVED_TO", "MODIFY"})

    if is_delete:
        # Confirm on disk — inotifywait can fire DELETE on transient files that
        # were briefly present (editor swap files). If SKILL.md is still
        # readable, treat as no-op.
        if os.path.isfile(rb_path):
            return
        if slug in tracked_slugs:
            try:
                os.remove(base_path)
            except OSError:
                pass
            tracked_slugs.discard(slug)
            _emit_role_skill_deleted(role, slug)
        return

    if is_write:
        # Settle window: give the PostToolUse sync hook time to refresh the
        # baseline + drop its hash marker before we compare (matches
        # _diff_and_emit's settle for role/identity events), after holding
        # for any in-flight tool call that claimed this role skill.
        if slug in tracked_slugs:
            _wait_for_claim_release(rb_path, base_path)
        if SELF_EDIT_SETTLE_MS > 0:
            time.sleep(SELF_EDIT_SETTLE_MS / 1000.0)
        current = _read_bytes(rb_path)
        if current is None:
            # File vanished between event fire and our read — likely an editor
            # swap-file interaction. Skip silently; a real delete will fire
            # its own event.
            return
        baseline = _read_bytes(base_path) if slug in tracked_slugs else None
        # Consume any self-edit marker eagerly (see _is_self_edit).
        is_self_edit = _is_self_edit(base_path, current)
        if baseline is None:
            # New role skill (either we've never seen it, or the baseline was
            # cleaned up). Snapshot; emit "added" unless the sync hook
            # confirmed this is the agent's own creation.
            _atomic_write_baseline(baseline_dir, base_path, current)
            tracked_slugs.add(slug)
            if not is_self_edit:
                _emit_role_skill_added(role, slug, rb_path)
            return
        if current != baseline:
            if is_self_edit:
                # Agent's own edit — refresh baseline silently, no wake.
                _atomic_write_baseline(baseline_dir, base_path, current)
                return
            diff_stdout = _run_diff(base_path, rb_path)
            _emit_event("role-skill", "%s/%s" % (role, slug), diff_stdout, spill_dir)
            _atomic_write_baseline(baseline_dir, base_path, current)


# ---------------------------------------------------------------------------
# Wake-up helpers — the identity's own `wakeups/<slug>/wakeup.json` specs.
# ---------------------------------------------------------------------------

# The app names wake-ups in kebab-case; agents may use underscores too. Dot
# folders (`.state`) are never wake-ups. Must match the self-edit hook's
# wake-up slug check.
_WAKEUP_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_WAKEUP_BASELINE_PREFIX = "last-snapshot.wakeup."
# Present once this identity's wake-ups have been snapshotted, so a later
# start reports specs added while the watcher was down instead of treating
# them as cold start.
_WAKEUPS_ARMED_NAME = "wakeups-armed"


def _enumerate_wakeup_slugs(wakeups_dir):
    """Sorted slugs whose `<slug>/wakeup.json` exists on disk."""
    try:
        entries = sorted(os.listdir(wakeups_dir))
    except OSError:
        return []
    return [
        e for e in entries
        if _WAKEUP_SLUG_RE.match(e) and os.path.isfile(os.path.join(wakeups_dir, e, "wakeup.json"))
    ]


def _wakeup_paths(wakeups_dir, baseline_dir, slug):
    return (
        os.path.join(wakeups_dir, slug, "wakeup.json"),
        os.path.join(baseline_dir, _WAKEUP_BASELINE_PREFIX + slug),
    )


def _existing_wakeup_baseline_slugs(baseline_dir):
    """Slugs with a wake-up baseline (markers like `<slug>.self-edit-hash`
    carry a dot and are skipped)."""
    slugs = set()
    try:
        for name in os.listdir(baseline_dir):
            if name.startswith(_WAKEUP_BASELINE_PREFIX):
                slug = name[len(_WAKEUP_BASELINE_PREFIX):]
                if _WAKEUP_SLUG_RE.match(slug):
                    slugs.add(slug)
    except OSError:
        pass
    return slugs


def _wakeup_self_retired(wakeups_dir, slug, base_path, folder_gone_counts):
    """True when the scheduler removed this spec itself after its one fire.

    It writes `.state/<slug>.fired` before unlinking the spec and sweeps the
    folder only later, so the marker is there whenever the delete is seen
    live. At startup the folder may already be swept; then
    `folder_gone_counts` lets a vanished folder whose last-known spec was
    self-retiring (one_shot, or a sensor with `once`) count as retired."""
    fired = os.path.join(wakeups_dir, slug, ".state", slug + ".fired")
    try:
        # A `.fired` older than our baseline belongs to an earlier wake-up of
        # the same name (the folder is swept only a day later).
        if os.path.getmtime(fired) >= os.path.getmtime(base_path):
            return True
    except OSError:
        pass
    if not folder_gone_counts or os.path.isdir(os.path.join(wakeups_dir, slug)):
        return False
    try:
        spec = json.loads(_read_bytes(base_path) or b"")
    except ValueError:
        return False
    sch = spec.get("schedule") if isinstance(spec, dict) else None
    if not isinstance(sch, dict):
        return False
    return sch.get("type") == "one_shot" or (sch.get("type") == "sensor" and sch.get("once") is True)


def _consume_self_delete(base_path):
    """True iff the self-edit hook marked this wake-up as deleted by the
    agent's own tool call; the marker is consumed either way."""
    marker = base_path + ".self-delete"
    try:
        os.remove(marker)
        return True
    except OSError:
        return False


def _drop_wakeup_baseline(base_path):
    for path in (base_path, base_path + ".self-edit-hash"):
        try:
            os.remove(path)
        except OSError:
            pass


def _emit_wakeup_added(slug, spec_path, current):
    """New wake-up — the spec is small, so show it rather than point at it."""
    try:
        flat = json.dumps(json.loads(current), ensure_ascii=False, separators=(", ", ": "))
    except ValueError:
        flat = None
    if flat is not None:
        line = "📝 [wakeup: %s] added — %s" % (slug, flat)
        if len(line.encode("utf-8")) <= INLINE_MAX:
            _out(line)
            return
    _out("📝 [wakeup: %s] added — Read %s" % (slug, spec_path))


def _emit_wakeup_deleted(slug):
    _out("📝 [wakeup: %s] deleted" % slug)


def _wakeup_slug_from_event(w_path, f_name, events, wakeups_dir):
    """Slug for an event on `<wakeups>/<slug>/wakeup.json`, or on the
    `<wakeups>/<slug>` folder itself; None for anything else (`.state`
    bookkeeping, sensor code, other companions)."""
    w_norm = w_path.rstrip("/")
    root = wakeups_dir.rstrip("/")
    if f_name == "wakeup.json" and os.path.dirname(w_norm) == root:
        slug = os.path.basename(w_norm)
    elif w_norm == root and "ISDIR" in events:
        slug = f_name
    else:
        return None
    return slug if _WAKEUP_SLUG_RE.match(slug) else None


def _handle_wakeup_event(slug, events, tracked_slugs, wakeups_dir, baseline_dir, spill_dir):
    """Route a wake-up event to add / edit / delete emission. Mutates
    `tracked_slugs` (the slugs with a baseline) like _handle_role_skill_event.

    Writes are taken on CLOSE_WRITE / MOVED_TO only (plus a whole folder moved
    or created in), never a bare CREATE of the file — a spec written with
    `cat >` would otherwise be read half-written."""
    spec_path, base_path = _wakeup_paths(wakeups_dir, baseline_dir, slug)

    if events & {"DELETE", "MOVED_FROM"}:
        if os.path.isfile(spec_path) or slug not in tracked_slugs:
            return
        # The agent's own delete: its tool call claimed the wake-up before it
        # ran; the hook marks the delete when the call returns.
        while _live_claims(base_path):
            if _harness_pid is not None:
                try:
                    os.kill(_harness_pid, 0)
                except OSError:
                    sys.exit(0)
            time.sleep(CLAIM_POLL_SEC)
        if os.path.isfile(spec_path):
            # Deleted and re-created within the call (`rm -rf … && cat > …`):
            # an edit, not a delete.
            _consume_self_delete(base_path)
            events = {"CLOSE_WRITE"}
        else:
            quiet = _consume_self_delete(base_path) or _wakeup_self_retired(
                wakeups_dir, slug, base_path, folder_gone_counts=False,
            )
            _drop_wakeup_baseline(base_path)
            tracked_slugs.discard(slug)
            if not quiet:
                _emit_wakeup_deleted(slug)
            return

    if not (events & {"CLOSE_WRITE", "MOVED_TO"} or ("CREATE" in events and "ISDIR" in events)):
        return
    # Claims are honored for new wake-ups too: the hook claims a slug the
    # call names even before its spec exists. A folder event can beat the
    # spec into the folder, so let it land before checking for a claim (a
    # spec written later still brings its own CLOSE_WRITE).
    if "ISDIR" in events and SELF_EDIT_SETTLE_MS > 0:
        time.sleep(SELF_EDIT_SETTLE_MS / 1000.0)
    _wait_for_claim_release(spec_path, base_path)
    if SELF_EDIT_SETTLE_MS > 0:
        time.sleep(SELF_EDIT_SETTLE_MS / 1000.0)
    current = _read_bytes(spec_path)
    if current is None:
        return
    baseline = _read_bytes(base_path) if slug in tracked_slugs else None
    is_self_edit = _is_self_edit(base_path, current)
    if baseline is None:
        _atomic_write_baseline(baseline_dir, base_path, current)
        tracked_slugs.add(slug)
        if not is_self_edit:
            _emit_wakeup_added(slug, spec_path, current)
        return
    if current != baseline:
        if not is_self_edit:
            _emit_event("wakeup", slug, _run_diff(base_path, spec_path), spill_dir)
        _atomic_write_baseline(baseline_dir, base_path, current)


def _wakeup_startup_pass(wakeups_dir, baseline_dir, spill_dir, tracked=None):
    """Snapshot / resume the identity's wake-ups before the watch arms;
    returns the tracked slug set. See the module docstring for what a
    restart reports.

    Passed the live `tracked` set, it is the rescan run each time
    inotifywait (re-)arms, catching changes made while no watch was live.
    The rescan leaves alone any wake-up an in-flight tool call has claimed —
    that is the agent's own change, and its events or the hook settle it."""
    rescan = tracked is not None
    if not rescan:
        tracked = _existing_wakeup_baseline_slugs(baseline_dir)
    armed_path = os.path.join(baseline_dir, _WAKEUPS_ARMED_NAME)
    armed = os.path.exists(armed_path)
    on_disk = set(_enumerate_wakeup_slugs(wakeups_dir))
    for slug in sorted(on_disk):
        spec_path, base_path = _wakeup_paths(wakeups_dir, baseline_dir, slug)
        if rescan and _live_claims(base_path):
            continue
        current = _read_bytes(spec_path)
        if current is None:
            continue
        is_self_edit = _is_self_edit(base_path, current)
        baseline = _read_bytes(base_path) if slug in tracked else None
        if baseline is None:
            _atomic_write_baseline(baseline_dir, base_path, current)
            tracked.add(slug)
            if armed and not is_self_edit:
                _emit_wakeup_added(slug, spec_path, current)
        elif current != baseline:
            if not is_self_edit:
                _emit_event("wakeup", slug, _run_diff(base_path, spec_path), spill_dir)
            _atomic_write_baseline(baseline_dir, base_path, current)
    for slug in sorted(tracked - on_disk):
        _, base_path = _wakeup_paths(wakeups_dir, baseline_dir, slug)
        if rescan and _live_claims(base_path):
            continue
        quiet = _consume_self_delete(base_path) or _wakeup_self_retired(
            wakeups_dir, slug, base_path, folder_gone_counts=True,
        )
        _drop_wakeup_baseline(base_path)
        tracked.discard(slug)
        if not quiet:
            _emit_wakeup_deleted(slug)
    if not armed:
        _atomic_write_baseline(baseline_dir, armed_path, b"")
    return tracked


def _make_signal_handler():
    """Return a SIGTERM/SIGINT handler that cleans up the inotifywait subprocess."""
    def _handler(signum, frame):
        global _inotify_proc
        if _inotify_proc is not None:
            try:
                _inotify_proc.terminate()
            except Exception:
                pass
        sys.exit(0)
    return _handler


def main():
    if len(sys.argv) < 2:
        print("usage: python3 file-watch.py <identity_dir>", file=sys.stderr)
        sys.exit(2)

    ident_dir = os.path.abspath(os.path.expanduser(sys.argv[1]))
    name = os.path.basename(ident_dir)

    # --- Resolve role name(s) from identity frontmatter ---
    identity_file_path = os.path.join(ident_dir, "%s.md" % name)
    roles, err = _parse_roles_from_frontmatter(identity_file_path)
    if err:
        # Watcher-health failures log to stderr only — box-maintainer notices via
        # the ambient-monitor log. The agent can't fix its own dead watcher
        # mid-turn, so waking it with a diagnostic it can't act on is noise.
        print("⚠️ [file-watch] %s" % err, file=sys.stderr, flush=True)
        sys.exit(1)
    # The role set this process watches. An identity-file edit that changes it
    # re-execs us (see _restart_if_scope_changed) — the targets list and the
    # inotifywait argv are fixed per process.
    watched_roles = list(roles)

    # --- Resolve role file paths — one per role. Missing role files are logged
    # to stderr and skipped rather than fatal, so a typo in a role list doesn't
    # kill the whole watcher. With no roles (or none whose file exists) there
    # are simply no role targets; the identity file, id skill and project
    # files below are still watched.
    role_files = []  # list of (role, role_file_path)
    for role in roles:
        role_file_path = _role_file_path(role)
        if os.path.exists(role_file_path):
            role_files.append((role, role_file_path))
        else:
            print(
                "⚠️ [file-watch] role file not found for role '%s' (%s) — skipping"
                % (role, role_file_path),
                file=sys.stderr,
                flush=True,
            )
    # Primary role: first in the list. Used for legacy baseline migration
    # (single-role installs get their old `last-snapshot.role` promoted onto
    # the first role in the new multi-role list). None with no role files —
    # the role-scoped migrations below are then skipped.
    primary_role = role_files[0][0] if role_files else None

    # Identity file path already resolved above (identity_file_path).
    # Each target: (kind, label-for-emit, source-file, per-file-baseline).
    # Role baselines are per-role: `last-snapshot.role.<role>`.
    baseline_dir = os.path.join(ident_dir, "file-watch")
    global _queue_dir
    _queue_dir = os.path.join(ident_dir, "pending-context")
    _migrate_legacy_state(ident_dir, baseline_dir, _queue_dir)
    identity_baseline_path = os.path.join(baseline_dir, "last-snapshot.identity")
    targets = []
    for role, role_file_path in role_files:
        role_baseline_path = os.path.join(baseline_dir, "last-snapshot.role.%s" % role)
        targets.append(("role-file", role, role_file_path, role_baseline_path))
    targets.append(
        ("identity-file", name, identity_file_path, identity_baseline_path)
    )

    # --- id skill target — user-wide, fleet-substrate-distributed. Watching
    # `~/.claude/skills/id/SKILL.md` catches the mid-session "in-context copy
    # drifted from disk" gap (2026-09-29 incident: workstation agent grepped
    # current on-disk file while running against pre-rename in-context copy).
    # Gated on file existence so a fresh box mid-distributor-install, or a
    # hermetic test env, doesn't fatal — same posture as role_skills_watched.
    # If the file lands later, the next watcher process pick it up on cold-start.
    id_skill_path = os.path.expanduser("~/.claude/skills/id/SKILL.md")
    id_skill_watched = os.path.isfile(id_skill_path)
    if id_skill_watched:
        id_skill_baseline_path = os.path.join(baseline_dir, "last-snapshot.id-skill")
        targets.append(("id-skill", "id", id_skill_path, id_skill_baseline_path))

    # --- user-wide CLAUDE.md target — the user's own always-on instruction file,
    # authored by the user (typically via the app's Gear → About you panel).
    # Loads at the start of every Claude session, so a mid-session edit means
    # every running identity's in-context copy has diverged from disk. Same
    # existence-gate as the id skill: on a fresh box where the user hasn't
    # authored one yet, this target is quietly skipped; if the file appears
    # later, the next watcher process picks it up on cold-start.
    user_claudemd_path = os.path.expanduser("~/.claude/CLAUDE.md")
    if os.path.isfile(user_claudemd_path):
        user_claudemd_baseline_path = os.path.join(
            baseline_dir, "last-snapshot.user-claudemd"
        )
        targets.append(
            ("user-claudemd", "user", user_claudemd_path, user_claudemd_baseline_path)
        )

    # --- Project file target — `~/fleet/projects/<slug>/project.md` for the
    # identity's `project:` frontmatter, if it has one and the file exists.
    # Watched like a role file; a move into / between / out of projects (an
    # identity-file edit) restarts the process so the target follows — see
    # _restart_if_scope_changed.
    watched_project, project_path = _resolve_project(identity_file_path)
    global _watched_chain, _watched_signature
    _watched_chain = _resolve_chain(watched_project) if watched_project else []
    _watched_signature = (watched_project, tuple(_watched_chain), _chain_files(_watched_chain))
    if watched_project is not None:
        targets.append((
            "project-file", watched_project, project_path,
            _project_baseline_path(baseline_dir, watched_project),
        ))
    # Ancestor project files — watched for content changes (member churn and
    # parent lines excluded; see _PROJECT_HIDDEN_KEYS). Chain changes the
    # watched files can't show are caught by the chain re-check thread.
    ancestors = _watched_chain[:-1]
    for levels, slug in enumerate(reversed(ancestors), start=1):
        _ancestor_levels[slug] = levels
        pmd = _project_md_path(slug)
        if os.path.isfile(pmd):
            targets.append((
                "parent-project", slug, pmd, _project_baseline_path(baseline_dir, slug),
            ))

    # --- Role skills trees — role-scope; one dir per role. Empty or nonexistent
    # is fine (skipped). `role_skill_roles` is the ordered list of (role, dir) that
    # actually exist on disk; `role_skills_watched` is true iff at least one does.
    role_skill_roles = []
    for role, _ in role_files:
        rd = os.path.expanduser("~/fleet/roles/%s/skills" % role)
        if os.path.isdir(rd):
            role_skill_roles.append((role, rd))
    role_skills_watched = len(role_skill_roles) > 0

    # --- Wake-ups folder — always watched; created if absent so the first
    # wake-up (agent- or app-made) lands inside an armed watch.
    wakeups_dir = os.path.join(ident_dir, "wakeups")
    try:
        os.makedirs(wakeups_dir, exist_ok=True)
    except OSError:
        pass
    wakeups_watched = os.path.isdir(wakeups_dir)

    # --- State dirs ---
    spill_dir = os.path.join(baseline_dir, "spilled")
    state_dir = os.path.join(baseline_dir, ".state")
    os.makedirs(state_dir, exist_ok=True)
    # `baseline_dir` may not exist yet on very first run (before role/identity
    # cold-start writes any baseline). Ensure it exists so role skill baselines
    # can be written even if the role/identity ones haven't landed yet.
    os.makedirs(baseline_dir, exist_ok=True)

    # --- Legacy baseline migrations — chained.
    # (1) Oldest: `last-snapshot` → `last-snapshot.role` (single-target → two-target scheme).
    # (2) Pre-multi-role: `last-snapshot.role` → `last-snapshot.role.<primary>`
    #     (single-role → per-role scheme). Promotes onto the primary role so
    #     existing single-role identities keep continuity.
    # (3) Runbook baselines → role-skill baselines (see below).
    # All migrations are best-effort — a failure logs to stderr and falls
    # through to cold-start (one silent snapshot instead of continuity).
    # (1) and (2) need a primary role, so a roleless identity skips them.
    legacy_bare_baseline = os.path.join(baseline_dir, "last-snapshot")
    legacy_role_baseline = os.path.join(baseline_dir, "last-snapshot.role")
    primary_role_baseline = os.path.join(
        baseline_dir, "last-snapshot.role.%s" % primary_role
    ) if primary_role is not None else None
    if (
        primary_role is not None
        and os.path.exists(legacy_bare_baseline)
        and not os.path.exists(legacy_role_baseline)
    ):
        try:
            os.replace(legacy_bare_baseline, legacy_role_baseline)
        except OSError as e:
            print(
                "⚠️ [file-watch] legacy baseline migration (bare→role) failed: %s" % e,
                file=sys.stderr,
                flush=True,
            )
    if (
        primary_role_baseline is not None
        and os.path.exists(legacy_role_baseline)
        and not os.path.exists(primary_role_baseline)
    ):
        try:
            os.replace(legacy_role_baseline, primary_role_baseline)
        except OSError as e:
            print(
                "⚠️ [file-watch] legacy baseline migration (role→role.<primary>) failed: %s"
                % e,
                file=sys.stderr,
                flush=True,
            )
    # Role-skill baseline migration: role skills were runbooks until
    # 2026-10, kept under `last-snapshot.runbook.<role>.<slug>` (or the older
    # unprefixed `last-snapshot.runbook.<slug>`). Rename onto
    # `last-snapshot.role-skill.<role>.<slug>` — the distributor's conversion
    # already rewrote their content to match the converted SKILL.md (and wrote
    # the role-skill one too), so the renamed baseline diffs clean. Self-edit
    # markers ride along by suffix.
    _legacy_prefix = "last-snapshot.runbook."
    try:
        _legacy_entries = [e for e in os.listdir(baseline_dir) if e.startswith(_legacy_prefix)]
    except OSError:
        _legacy_entries = []
    for entry in _legacy_entries:
        suffix = entry[len(_legacy_prefix):]
        if "." not in suffix:
            if primary_role is None:
                continue
            suffix = "%s.%s" % (primary_role, suffix)
        # Only once that runbook has actually been converted (its SKILL.md is
        # in place and its old folder is a forwarding link). Until then the
        # old baseline waits — renaming it early would report the runbook as
        # deleted now and added again when the conversion lands.
        _role, _, _slug = suffix.partition(".")
        _rd = os.path.expanduser("~/fleet/roles/%s" % _role)
        if not (
            os.path.isfile(os.path.join(_rd, "skills", _slug.split(".")[0], "SKILL.md"))
            and os.path.islink(os.path.join(_rd, "runbooks", _slug.split(".")[0]))
        ):
            continue
        src = os.path.join(baseline_dir, entry)
        dst = os.path.join(baseline_dir, "last-snapshot.role-skill." + suffix)
        try:
            if os.path.exists(dst):
                os.remove(src)  # a role-skill baseline already wins
            else:
                os.replace(src, dst)
        except OSError as e:
            print(
                "⚠️ [file-watch] role-skill baseline migration failed for %s: %s"
                % (entry, e),
                file=sys.stderr,
                flush=True,
            )

    # --- Single-instance guard ---
    _single_instance(state_dir, ident_dir)

    # --- Signal handlers (register early) ---
    handler = _make_signal_handler()
    signal.signal(signal.SIGTERM, handler)
    signal.signal(signal.SIGINT, handler)

    # --- Orphan-monitor guard (added 2026-09-05 after Noelle ate a Nelly dispatch;
    # env-override added 2026-09-13 for the ambient-monitor launcher).
    # See wakeup-scheduler.py for the full comment; short version:
    #   1) if AMBIENT_MONITOR_HARNESS_PID is set (parent is the launcher), honor it.
    #   2) else fall back to the grandparent walk (standalone launch case).
    harness_pid = None
    env_override = os.environ.get("AMBIENT_MONITOR_HARNESS_PID")
    if env_override:
        try:
            p = int(env_override)
            if p > 1:
                harness_pid = p
        except ValueError:
            pass
    if harness_pid is None:
        try:
            with open("/proc/%d/status" % os.getppid()) as f:
                for line in f:
                    if line.startswith("PPid:"):
                        p = int(line.split()[1])
                        if p > 1:
                            harness_pid = p
                        break
        except (OSError, ValueError):
            pass
    global _harness_pid
    _harness_pid = harness_pid

    if harness_pid is None:
        print(
            "file-watch: orphan-check disabled (couldn't resolve grandparent)",
            file=sys.stderr,
            flush=True,
        )

    # --- Project chain bookkeeping. Baselines for projects that left the chain
    # are dropped first, so a project that later rejoins cold-starts instead
    # of diffing against a stale snapshot. Then, if the chain this identity
    # was last told about has the same own project but different ancestors,
    # say so — whoever made the change, the agent included (a self-edit of a
    # parent line refreshes the baseline silently, but the chain still moved).
    _prune_project_baselines(baseline_dir, _watched_chain)
    prior_chain = _read_chain_state(baseline_dir)
    if (
        prior_chain
        and _watched_chain
        and prior_chain[-1] == _watched_chain[-1]
        and prior_chain != _watched_chain
    ):
        _emit_chain_notice(prior_chain, _watched_chain)
    _write_chain_state(baseline_dir, _watched_chain)

    # --- Cold-start rule: for each target, if no baseline, snapshot silently.
    # Otherwise diff at startup and emit if the file changed while we were down.
    # Cold start remains silent per shape invariant. This runs per-target
    # independently so a legacy install (role baseline exists, identity does not) does
    # the right thing: the role gets a startup diff, the identity gets a silent cold
    # snapshot.
    for kind, label, target_path, baseline_path in targets:
        if kind in _PROJECT_HIDDEN_KEYS and not os.path.exists(target_path):
            continue  # vanished since resolve — the post-arm check restarts us
        if not os.path.exists(baseline_path):
            current = _read_bytes(target_path)
            if current is None:
                msg = "%s file unreadable at startup: %s" % (kind, target_path)
                print("⚠️ [file-watch] %s" % msg, file=sys.stderr, flush=True)
                if kind in _PROJECT_HIDDEN_KEYS:
                    continue
                sys.exit(1)
            _atomic_write_baseline(baseline_dir, baseline_path, current)
            # Emit NOTHING to stdout on cold start (shape file "silent on cold start" invariant)
        else:
            gone = _diff_and_emit(
                kind, label, target_path, baseline_dir, baseline_path, spill_dir, hold=False,
            )
            if gone:
                sys.exit(1)

    # --- Role skill cold-start / resume pass — per-role.
    # For each role, enumerate on-disk role skills. For each: if no baseline →
    # snapshot silently (cold start); if baseline + file changed → emit edit
    # diff (resume); if baseline exists but file gone → emit "deleted"
    # (resume-delete). Runs BEFORE the inotifywait watch loop starts so events
    # landing during the watch's arming don't compete with cold-start baseline
    # writes. `tracked_role_skill_slugs` is keyed by role so role skill slugs
    # colliding across roles don't share a set.
    tracked_role_skill_slugs = {}
    for role, rb_dir in role_skill_roles:
        tracked_role_skill_slugs[role] = _existing_baseline_slugs(baseline_dir, role)
        on_disk_slugs = set(_enumerate_role_skill_slugs(rb_dir))

        # (a) On-disk role skills — diff or cold-snapshot.
        for slug in sorted(on_disk_slugs):
            rb_path, base_path = _role_skill_paths(rb_dir, baseline_dir, role, slug)
            if slug not in tracked_role_skill_slugs[role]:
                current = _read_bytes(rb_path)
                if current is None:
                    # Role skill file vanished between listdir and read — race
                    # with a peer identity's delete. Skip silently; the
                    # delete-side pass below cleans up any dangling baseline.
                    continue
                _atomic_write_baseline(baseline_dir, base_path, current)
                tracked_role_skill_slugs[role].add(slug)
                # Silent cold-start — no emit (shape invariant).
            else:
                # Baseline exists → treat as resume. Diff if changed.
                current = _read_bytes(rb_path)
                if current is None:
                    continue  # will be handled by (b) below
                baseline = _read_bytes(base_path)
                # Consume any self-edit marker eagerly — even at cold-start, a
                # marker left over from a pre-restart sync-hook run tells us the
                # last change was ours.
                is_self_edit = _is_self_edit(base_path, current)
                if baseline is None:
                    _atomic_write_baseline(baseline_dir, base_path, current)
                    continue
                if current != baseline:
                    if is_self_edit:
                        _atomic_write_baseline(baseline_dir, base_path, current)
                        continue
                    diff_stdout = _run_diff(base_path, rb_path)
                    _emit_event(
                        "role-skill", "%s/%s" % (role, slug), diff_stdout, spill_dir,
                    )
                    _atomic_write_baseline(baseline_dir, base_path, current)

        # (b) Baselines for slugs no longer on disk — the role skill was deleted
        # while we were down. Emit deletion + remove the baseline.
        for slug in sorted(tracked_role_skill_slugs[role] - on_disk_slugs):
            _, base_path = _role_skill_paths(rb_dir, baseline_dir, role, slug)
            try:
                os.remove(base_path)
            except OSError:
                pass
            tracked_role_skill_slugs[role].discard(slug)
            _emit_role_skill_deleted(role, slug)

    tracked_wakeup_slugs = (
        _wakeup_startup_pass(wakeups_dir, baseline_dir, spill_dir) if wakeups_watched else set()
    )

    # --- Watch loop ---
    use_inotify = shutil.which("inotifywait") is not None
    if not use_inotify:
        print(
            "⚠️ [file-watch] inotifywait not found — falling back to %ds polling "
            "(set FILE_WATCH_POLL_SEC to adjust)" % POLL,
            file=sys.stderr,
            flush=True,
        )

    global _inotify_proc

    if SELF_RELOAD_POLL_SEC > 0:
        threading.Thread(
            target=_self_reload_watch, args=(_SELF_START_STAT,), daemon=True,
        ).start()
    if CHAIN_POLL_SEC > 0:
        threading.Thread(
            target=_chain_poll_watch, args=(identity_file_path,), daemon=True,
        ).start()

    if use_inotify:
        # inotifywait-based watch loop with `--format` output so we can route
        # events by path. Three watched surfaces:
        #   1. role.md + identity.md + id-skill SKILL.md — passed as explicit
        #      file arguments (id skill conditionally, when present on box).
        #      Events on any of these are dispatched to
        #      _diff_and_emit_all(targets, …); we re-diff every fixed target on
        #      any of their events (cheap, no per-file bookkeeping needed).
        #   2. skills/ (if it exists) — passed with `-r` so newly-created
        #      slug subfolders get their inotify watches added automatically.
        #      Per-event routing via _slug_from_event isolates SKILL.md
        #      events + slug-subfolder create/delete from companion churn.
        #
        # Event set — union of what fixed targets and the role skill tree need:
        #   close_write: normal file save
        #   move_self:   fixed-target inode itself renamed away → respawn
        #   delete_self: fixed-target inode unlinked (backend atomic tmp+rename over
        #                the watched file unlinks the old inode; kernel fires
        #                DELETE_SELF on the OLD inode's watch, then IN_IGNORED
        #                auto-removes it). MOVE_SELF does NOT fire here — that's
        #                only for the watched inode being the SOURCE of a rename,
        #                whereas an atomic-rename-over makes it the DISPLACED
        #                target. Without delete_self + respawn, the watch dies
        #                silently and every subsequent edit is invisible.
        #   moved_to:    fixed-target replaced OR new file landed in skills/
        #   delete:      SKILL.md removed OR slug subfolder removed
        #   create:      slug subfolder created OR SKILL.md created
        #   moved_from:  SKILL.md renamed out OR slug subfolder renamed out
        fixed_target_paths = [t[2] for t in targets]
        watched_args = list(fixed_target_paths)
        if role_skills_watched:
            for _role, rb_dir in role_skill_roles:
                watched_args.append(rb_dir)
        if wakeups_watched:
            watched_args.append(wakeups_dir)
        inotify_events = "close_write,move_self,delete_self,moved_to,delete,create,moved_from"
        # `-r` must not descend below `wakeups/<slug>/`: sensor code (a
        # node_modules, a venv) and `.state` bookkeeping would spend the
        # box-wide inotify watch budget and flood the event stream.
        exclude_args = (
            ["--exclude", "^%s/[^/]+/[^/]+/" % re.sub(r"([.\[\](){}*+?|^$\\])", r"\\\1", wakeups_dir)]
            if wakeups_watched else []
        )
        # Exponential backoff between failed inotifywait starts (reset on any
        # successful event). Guards against a hot fork/exec loop when e.g.
        # fs.inotify.max_user_instances is saturated — inotifywait dies
        # instantly, python sees EOF, and without a backoff we chew CPU
        # forever while silently deaf.
        inotify_backoff_sec = 0
        INOTIFY_BACKOFF_MIN = 1
        INOTIFY_BACKOFF_MAX = 60
        failure_emitted = False
        while True:
            # Orphan check
            if harness_pid is not None:
                try:
                    os.kill(harness_pid, 0)
                except OSError:
                    sys.exit(0)

            if inotify_backoff_sec > 0:
                time.sleep(inotify_backoff_sec)

            if _reload_pending.is_set():
                _reexec_self()

            try:
                _inotify_proc = subprocess.Popen(
                    [
                        "inotifywait", "-m",
                    ] + (["-r"] if role_skills_watched or wakeups_watched else []) + [
                        "-e", inotify_events,
                        "--format", "%w|%f|%e",
                    ] + exclude_args + watched_args,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
                # The reload thread may have fired while no inotifywait was
                # running to terminate — end this one so the loop reaches EOF.
                if _reload_pending.is_set() or _scope_recheck.is_set():
                    _inotify_proc.terminate()
                # Close the arming gap: a change landing between our last
                # diff (the startup pass, or the MOVE_SELF/DELETE_SELF diff
                # just before a respawn) and inotifywait's watches going live
                # fires no event and would sit unseen until the next one.
                # Wait for "Watches established." (inotifywait's stderr), then
                # re-diff once. Error output stops the wait at EOF and is
                # still surfaced by the exit-code path below.
                for err_line in _inotify_proc.stderr:
                    if "Watches established" in err_line:
                        if _diff_and_emit_all(targets, baseline_dir, spill_dir):
                            sys.exit(1)
                        if wakeups_watched:
                            _wakeup_startup_pass(
                                wakeups_dir, baseline_dir, spill_dir, tracked_wakeup_slugs,
                            )
                        _restart_if_scope_changed(
                            identity_file_path, watched_project, watched_roles, baseline_dir,
                        )
                        break
                for event_line in _inotify_proc.stdout:
                    # Any event = healthy inotifywait. Reset backoff and emit
                    # a recovery event if the previous cycle surfaced a failure.
                    if failure_emitted:
                        print(
                            "⚠️ [file-watch] inotifywait recovered — watching resumed",
                            file=sys.stderr,
                            flush=True,
                        )
                        failure_emitted = False
                    inotify_backoff_sec = 0

                    # Orphan check inside inner loop
                    if harness_pid is not None:
                        try:
                            os.kill(harness_pid, 0)
                        except OSError:
                            if _inotify_proc is not None:
                                try:
                                    _inotify_proc.terminate()
                                except Exception:
                                    pass
                            sys.exit(0)

                    event_line = event_line.rstrip("\n").rstrip("\r")
                    if not event_line:
                        continue

                    # Parse `%w|%f|%e`. inotifywait guarantees these three
                    # fields separated by `|`; on rare malformed lines (e.g.
                    # rotated stderr leaking in), skip silently.
                    parts = event_line.split("|", 2)
                    if len(parts) != 3:
                        continue
                    w_path, f_name, e_str = parts
                    events = set(e_str.split(","))

                    # (A) Route fixed-target events (role.md / identity.md / id-skill SKILL.md).
                    # inotifywait emits `%w = <full file path>`, `%f = ""` when
                    # the watched target is a file argument (not a directory).
                    if not f_name and w_path in fixed_target_paths:
                        # MOVE_SELF: watched inode itself was renamed AWAY. New
                        # content may already be at the path (atomic-rename
                        # patterns overwriting the file), so emit any diff then
                        # respawn to re-arm on whatever inode now sits at the
                        # path.
                        #
                        # DELETE_SELF: watched inode was unlinked. Fires in two
                        # cases: (1) backend atomic tmp+rename over the file —
                        # a new inode is already at the path with new content;
                        # (2) genuine deletion (no replacement). If a file
                        # exists at the path shortly after the event, treat as
                        # case 1 (emit diff + respawn); otherwise treat as
                        # case 2 (fatal — the target is gone). This mirrors
                        # MOVE_SELF's respawn semantics: never silently deaf.
                        if "MOVE_SELF" in events or "DELETE_SELF" in events:
                            if _diff_and_emit_all(targets, baseline_dir, spill_dir):
                                # Target actually gone — fatal exit (same as
                                # pre-fix DELETE_SELF behavior). _diff_and_emit
                                # returns True when the file is unreadable.
                                sys.exit(1)
                            _restart_if_scope_changed(
                                identity_file_path, watched_project, watched_roles, baseline_dir,
                            )
                            # Respawn to re-arm on new inode.
                            try:
                                _inotify_proc.terminate()
                            except Exception:
                                pass
                            _inotify_proc = None
                            break
                        if _diff_and_emit_all(targets, baseline_dir, spill_dir):
                            sys.exit(1)
                        _restart_if_scope_changed(
                            identity_file_path, watched_project, watched_roles, baseline_dir,
                        )
                        continue

                    # (B) Route role skill-tree events. Only fires when we're
                    # actually watching at least one role skills dir. `_slug_from_event`
                    # walks every role's role skills tree and returns the (role, slug)
                    # match — event routing stays role-scoped even with multiple
                    # roles active.
                    if role_skills_watched:
                        rb_role, slug = _slug_from_event(w_path, f_name, role_skill_roles)
                        if slug is not None:
                            rb_dir = next(d for r, d in role_skill_roles if r == rb_role)
                            _handle_role_skill_event(
                                rb_role, slug, events, tracked_role_skill_slugs[rb_role],
                                rb_dir, baseline_dir, spill_dir,
                            )
                            continue

                    # (C) Route wake-up events.
                    if wakeups_watched:
                        wk_slug = _wakeup_slug_from_event(w_path, f_name, events, wakeups_dir)
                        if wk_slug is not None:
                            _handle_wakeup_event(
                                wk_slug, events, tracked_wakeup_slugs,
                                wakeups_dir, baseline_dir, spill_dir,
                            )
                            continue

                    # Anything else is companion churn or events on an
                    # unrelated path — ignore.

                # Self-reload: the watch thread terminated inotifywait and
                # everything it printed has been handled — swap in new code.
                if _reload_pending.is_set():
                    if _inotify_proc is not None:
                        try:
                            _inotify_proc.wait(timeout=5)
                        except Exception:
                            pass
                    _reexec_self()

                # The chain re-check thread ended inotifywait: run the scope
                # check (re-execs on a real change); a change that reverted
                # in between just re-arms, without the failure path below.
                if _scope_recheck.is_set():
                    _scope_recheck.clear()
                    _restart_if_scope_changed(
                        identity_file_path, watched_project, watched_roles, baseline_dir,
                    )
                    if _inotify_proc is not None:
                        try:
                            _inotify_proc.wait(timeout=5)
                        except Exception:
                            pass
                    _inotify_proc = None
                    continue

                # for-loop exited: either _inotify_proc is None (controlled
                # respawn via MOVE_SELF/DELETE_SELF above) or inotifywait died
                # on its own (EOF on stdout). In the death case, capture exit
                # code + stderr so a saturated inotify limit surfaces to the
                # agent instead of hot-looping deaf.
                # A fixed target deleted before inotifywait could arm on it
                # makes inotifywait die on startup ("No such file"); that is
                # the same genuine-delete case as DELETE_SELF, not a transient
                # inotify failure to back off from.
                if any(not os.path.exists(t[2]) for t in targets):
                    if _diff_and_emit_all(targets, baseline_dir, spill_dir):
                        sys.exit(1)
                    _restart_if_scope_changed(
                        identity_file_path, watched_project, watched_roles, baseline_dir,
                    )

                if _inotify_proc is not None:
                    try:
                        exit_code = _inotify_proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        try:
                            _inotify_proc.terminate()
                        except Exception:
                            pass
                        exit_code = -1
                    if exit_code != 0:
                        stderr_text = ""
                        try:
                            if _inotify_proc.stderr is not None:
                                stderr_text = _inotify_proc.stderr.read() or ""
                        except Exception:
                            pass
                        stderr_snippet = stderr_text.strip().replace("\n", " ⏎ ")[:200]
                        if not failure_emitted:
                            print(
                                "⚠️ [file-watch] inotifywait exited %d — "
                                "watcher deaf until this resolves. stderr: %s"
                                % (exit_code, stderr_snippet or "(empty)"),
                                file=sys.stderr,
                                flush=True,
                            )
                            failure_emitted = True
                        if inotify_backoff_sec == 0:
                            inotify_backoff_sec = INOTIFY_BACKOFF_MIN
                        else:
                            inotify_backoff_sec = min(
                                INOTIFY_BACKOFF_MAX, inotify_backoff_sec * 2
                            )

            except Exception:
                traceback.print_exc(file=sys.stderr)
                sys.exit(1)

    else:
        # Fallback: mtime polling loop over both targets.
        _restart_if_scope_changed(
            identity_file_path, watched_project, watched_roles, baseline_dir,
        )
        try:
            last_mtimes = {
                t[2]: (
                    os.path.getmtime(t[2])
                    if t[0] not in _PROJECT_HIDDEN_KEYS or os.path.exists(t[2])
                    else None
                )
                for t in targets
            }
        except OSError as e:
            print(
                "⚠️ [file-watch] target unreadable in polling loop: %s" % e,
                file=sys.stderr,
                flush=True,
            )
            sys.exit(1)

        while True:
            # Orphan check
            if harness_pid is not None:
                try:
                    os.kill(harness_pid, 0)
                except OSError:
                    sys.exit(0)

            if _reload_pending.is_set():
                _reexec_self()

            time.sleep(POLL)
            changed = _scope_recheck.is_set()
            _scope_recheck.clear()
            for kind, label, target_path, baseline_path in targets:
                try:
                    cur_mtime = os.path.getmtime(target_path)
                except OSError:
                    if kind in _PROJECT_HIDDEN_KEYS:
                        changed = True
                        continue
                    print(
                        "⚠️ [file-watch] %s file disappeared: %s"
                        % (kind, target_path),
                        file=sys.stderr,
                        flush=True,
                    )
                    sys.exit(1)
                if cur_mtime != last_mtimes[target_path]:
                    last_mtimes[target_path] = cur_mtime
                    changed = True

            if changed:
                if _diff_and_emit_all(targets, baseline_dir, spill_dir):
                    sys.exit(1)
                _restart_if_scope_changed(
                    identity_file_path, watched_project, watched_roles, baseline_dir,
                )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
