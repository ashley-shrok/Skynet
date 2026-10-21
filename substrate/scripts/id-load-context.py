#!/usr/bin/env python3
"""id-load-context — UserPromptSubmit hook.

When the prompt is `/id <name>` (an identity load — the first message of every
supervised session, and of any hand-typed load), hand the agent everything the
id skill's load steps would otherwise have it look up with tool calls:

  - its identity file
  - each role's role file, its role skills (name, description, and where
    each lives — or a line saying one couldn't be read), and the scheduled
    tasks that run with that role (name, schedule, on/off, last fired)
  - its own wake-ups (name, schedule, on/off, last fired)
  - its project chain, top-down: each project.md and the project folder's
    top-level listing

Claude Code caps a hook's additionalContext at 10,000 characters (more is
saved to a file with only a short preview injected), so the lists always go
in and whole files are added in priority order — identity file, role files,
project files — while they fit; a file that doesn't fit is named for the agent
to Read instead.

The reserved keywords (`/id save`, `/id reset`, `/id archive`) and names with
no identity file stay silent. Never fails the parent turn.

Canonical copy in the app's source repo at substrate/scripts/id-load-context.py;
distributed to every managed host by the fleet substrate distributor (see
src/backend/distributor/catalog.ts). Installed at ~/.local/bin/id-load-context.
Do NOT hand-edit the installed copy.
"""

import datetime
import json
import os
import re
import sys

CONTEXT_LIMIT = 9500  # under Claude Code's 10,000-char additionalContext cap
LISTING_MAX = 40  # names shown per project folder listing
RESERVED = ("save", "reset", "archive")
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_PROJECT_SLUG_RE = re.compile(r"^[a-z0-9-]{1,64}$")
FLEET = os.path.expanduser("~/fleet")


# --- `roles:` frontmatter parser -------------------------------------------
# COPY of tests/fixtures/roles_frontmatter_reference.py (parse_roles_frontmatter).
# It MUST stay identical in behavior to the reference — `roles:` only (the
# singular `role:` key is NOT read), every shape in
# tests/fixtures/roles-frontmatter-cases.json, slug regex below. Checked by
# tests/roles-frontmatter-conformance.test.sh. Change the reference first, then
# re-copy; never edit this copy alone.
ROLES_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def parse_roles_frontmatter(text):
    lines = text.lstrip("﻿").replace("\r\n", "\n").split("\n")
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


def _read(path):
    try:
        with open(path, encoding="utf-8-sig") as f:
            return f.read()
    except (OSError, UnicodeDecodeError):
        return None


def _frontmatter_lines(text):
    lines = text.split("\n")
    fences = [i for i, ln in enumerate(lines) if ln.strip() == "---"]
    if len(fences) < 2:
        return []
    return lines[fences[0] + 1: fences[1]]


def _project_slug(identity_text):
    # Same reading as file-watch.py _parse_project_from_frontmatter.
    for line in _frontmatter_lines(identity_text):
        m = re.match(r"^project:\s*(.*?)\s*(#.*)?$", line)
        if m:
            slug = (m.group(1) or "").strip().strip('"').strip("'").strip()
            return slug if _PROJECT_SLUG_RE.match(slug) else None
    return None


# --- project chain ----------------------------------------------------------
# Same rules as file-watch.py's nested-projects block (which mirrors the
# sidebar): a project is a non-symlink folder under ~/fleet/projects/ with a
# valid slug other than `archive`; a parent that isn't one ends the chain; a
# parent loop ends at the first member reached.

def _project_dir(slug):
    return os.path.join(FLEET, "projects", slug)


def _project_exists(slug):
    if slug is None or slug == "archive" or not _PROJECT_SLUG_RE.match(slug):
        return False
    d = _project_dir(slug)
    return os.path.isdir(d) and not os.path.islink(d)


def _yaml_parent_value(line):
    # COPY of file-watch.py _yaml_parent_value.
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


def _project_head(slug):
    text = _read(os.path.join(_project_dir(slug), "project.md")) or ""
    return _frontmatter_lines(text[:65536])


def _project_parent(slug):
    parent = None
    for line in _project_head(slug):
        if line.lstrip().startswith("#"):
            continue
        matched, val = _yaml_parent_value(line)
        if matched:
            parent = val
    return None if parent == slug else parent


def _project_display_name(slug):
    name = slug
    for line in _project_head(slug):
        m = re.match(r"^displayName:\s*(.+?)\s*(#.*)?$", line)
        if m:
            val = m.group(1).strip().strip('"').strip("'").strip()
            if val:
                name = val
    return name


def _project_chain(own_slug):
    if not _project_exists(own_slug):
        return []
    path = [own_slug]
    cur = _project_parent(own_slug)
    while _project_exists(cur):
        if cur in path:
            path = path[: path.index(cur) + 1]
            break
        path.append(cur)
        cur = _project_parent(cur)
    path.reverse()
    return path


# --- schedules --------------------------------------------------------------

def _load_json(path):
    try:
        with open(path) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else None
    except (OSError, ValueError):
        return None


def _last_fired(path):
    try:
        with open(path) as f:
            ts = float(f.read().strip())
    except (OSError, ValueError):
        return "never fired"
    return "last fired " + datetime.datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")


def _schedule_line(slug, spec, last_path):
    name = spec.get("name") or slug
    head = slug if name == slug else "%s (%s)" % (slug, name)
    sched = json.dumps(spec.get("schedule"), separators=(", ", ": "))
    # Python truthiness, as the scheduler reads it.
    on = "enabled" if spec.get("enabled", True) else "disabled"
    return "- %s — %s · %s · %s" % (head, sched, on, _last_fired(last_path))


def _scheduled_tasks_for(role):
    root = os.path.join(FLEET, "scheduled-agents")
    out = []
    try:
        slugs = sorted(os.listdir(root))
    except OSError:
        return out
    for slug in slugs:
        spec = _load_json(os.path.join(root, slug, "scheduled-agent.json"))
        if spec is None:
            continue
        roles = spec.get("roles")
        if isinstance(roles, list) and role in roles:
            out.append(_schedule_line(slug, spec, os.path.join(root, ".state", slug + ".last")))
    return out


def _own_wakeups(name):
    root = os.path.join(FLEET, "identities", name, "wakeups")
    out = []
    try:
        slugs = sorted(os.listdir(root))
    except OSError:
        return out
    for slug in slugs:
        spec = _load_json(os.path.join(root, slug, "wakeup.json"))
        if spec is not None:
            out.append(_schedule_line(slug, spec, os.path.join(root, slug, ".state", slug + ".last")))
    return out


ROLE_SKILL_DESCRIPTION_MAX = 300  # chars of a description shown in the listing


def _unquote(value):
    v = value.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        inner = v[1:-1]
        if v[0] == '"':
            inner = inner.replace('\\"', '"').replace("\\\\", "\\")
        else:
            inner = inner.replace("''", "'")
        return inner
    return v


def _skill_frontmatter(text):
    """(name, description) from a skill file's frontmatter, or None when it has
    no readable frontmatter block. Either value may be "" when absent. Reads
    plain, quoted and block-scalar (`>`, `|`) values — enough for skill files,
    not a general YAML parser."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return None
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        return None
    block = lines[1:end]
    values = {}
    i = 0
    while i < len(block):
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_-]*):(.*)$", block[i])
        i += 1
        if not m or m.group(1) not in ("name", "description"):
            continue
        raw = m.group(2).strip()
        cont = []
        while i < len(block) and (block[i].startswith((" ", "\t")) or not block[i].strip()):
            cont.append(block[i].strip())
            i += 1
        if raw[:1] in (">", "|"):
            joiner = "\n" if raw[0] == "|" else " "
            value = joiner.join(c for c in cont if c)
        else:
            value = " ".join([raw] + [c for c in cont if c])
            value = _unquote(value)
        values[m.group(1)] = " ".join(value.split())
    return values.get("name", ""), values.get("description", "")


def _role_skills_text(role):
    """The role's skills: one line each with its description, or a line saying
    the skill couldn't be read so the agent goes and fixes it."""
    root = os.path.join(FLEET, "roles", role, "skills")
    try:
        slugs = sorted(n for n in os.listdir(root)
                       if not n.startswith(".") and os.path.isdir(os.path.join(root, n)))
    except OSError:
        slugs = []
    if not slugs:
        return "Role skills: none"
    lines = []
    for slug in slugs:
        path = os.path.join(root, slug, "SKILL.md")
        text = _read(path)
        if text is None:
            lines.append("- %s — ⚠️ couldn't be read: it has no readable SKILL.md. Open %s/ and "
                         "give it one with name and description frontmatter." % (slug, _display(os.path.join(root, slug))))
            continue
        fm = _skill_frontmatter(text)
        if fm is None:
            lines.append("- %s — ⚠️ couldn't be read: its SKILL.md has no frontmatter block. Open %s "
                         "and fix the frontmatter (name and description)." % (slug, _display(path)))
            continue
        desc = fm[1]
        if not desc:
            lines.append("- %s — ⚠️ couldn't be read: its frontmatter has no description. Open %s "
                         "and add one." % (slug, _display(path)))
            continue
        if len(desc) > ROLE_SKILL_DESCRIPTION_MAX:
            desc = desc[:ROLE_SKILL_DESCRIPTION_MAX - 1].rstrip() + "…"
        lines.append("- %s — %s" % (slug, desc))
    return ("Role skills — each is %s/<name>/SKILL.md; when one's description fits the "
            "situation, read it and follow it:\n" % _display(root)) + "\n".join(lines)


def _listdir_visible(path, skip=()):
    try:
        names = sorted(os.listdir(path))
    except OSError:
        return []
    return [n + ("/" if os.path.isdir(os.path.join(path, n)) else "")
            for n in names if not n.startswith(".") and n not in skip]


def _listing_text(names):
    if len(names) <= LISTING_MAX:
        return ", ".join(names) or "none"
    return "%s, … and %d more" % (", ".join(names[:LISTING_MAX]), len(names) - LISTING_MAX)


def _length(text):
    # Claude Code measures the cap in JavaScript string length (UTF-16 units),
    # where an emoji counts twice.
    return len(text.encode("utf-16-le")) // 2


# --- assembly ---------------------------------------------------------------

def _display(path):
    home = os.path.expanduser("~")
    return "~" + path[len(home):] if path.startswith(home + "/") else path


class _File:
    """A whole file that goes in if the budget allows, else a Read pointer."""

    def __init__(self, label, path, text):
        self.path = path
        # A fence longer than any backtick run inside, so a file's own code
        # blocks can't close it early.
        runs = re.findall(r"`+", text)
        fence = "`" * max(3, max((len(r) for r in runs), default=0) + 1)
        self.full = "%s — %s\n%s\n%s\n%s" % (label, _display(path), fence, text.rstrip("\n"), fence)
        self.pointer = "%s — %s (too large to include here; Read it)" % (label, _display(path))
        self.inline = False

    def render(self):
        return self.full if self.inline else self.pointer


def build(name):
    ident_path = os.path.join(FLEET, "identities", name, name + ".md")
    ident_text = _read(ident_path)
    if ident_text is None:
        return None
    roles = parse_roles_frontmatter(ident_text)
    chain = _project_chain(_project_slug(ident_text))

    files = [_File("Identity file", ident_path, ident_text)]
    parts = ["Gathered by the id-load hook for `%s` — this is what the id skill's "
             "load steps would have you read and list; it is current as of this "
             "message." % name, files[0]]

    for role in roles:
        role_path = os.path.join(FLEET, "roles", role, role + ".md")
        role_text = _read(role_path)
        parts.append("## Role: %s" % role)
        if role_text is None:
            parts.append("Role file %s is missing." % _display(role_path))
        else:
            f = _File("Role file", role_path, role_text)
            files.append(f)
            parts.append(f)
        parts.append(_role_skills_text(role))
        tasks = _scheduled_tasks_for(role)
        parts.append("Scheduled tasks with this role:\n" + "\n".join(tasks) if tasks
                     else "Scheduled tasks with this role: none")

    wakeups = _own_wakeups(name)
    parts.append("## Your wake-ups\n" + "\n".join(wakeups) if wakeups else "## Your wake-ups\nnone")

    if chain:
        parts.append("## Project chain (top-down): " + " › ".join(
            "%s (%s)" % (_project_display_name(s), s) for s in chain))
        for slug in chain:
            pdir = _project_dir(slug)
            text = _read(os.path.join(pdir, "project.md"))
            if text is not None:
                f = _File("project.md of %s" % slug, os.path.join(pdir, "project.md"), text)
                files.append(f)
                parts.append(f)
            listing = _listdir_visible(pdir, skip=("project.md",))
            parts.append("Other files in %s: %s" % (_display(pdir) + "/", _listing_text(listing)))

    def render():
        return "\n\n".join(p.render() if isinstance(p, _File) else p for p in parts)

    # Files are listed in priority order: identity, roles, projects top-down.
    for f in files:
        f.inline = True
        if _length(render()) > CONTEXT_LIMIT:
            f.inline = False
    return render()


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        return
    m = re.match(r"^/id\s+(\S+)\s*$", str(payload.get("prompt") or "").strip())
    if not m:
        return
    name = m.group(1).lower()
    if name in RESERVED or not NAME_RE.match(name):
        return
    context = build(name)
    if context is None:
        return
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "UserPromptSubmit",
        "additionalContext": context,
    }}))


if __name__ == "__main__":
    try:
        main()
    except Exception:  # noqa: BLE001 — a hook must never fail the turn
        pass
