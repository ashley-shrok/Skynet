"""Canonical `roles:` frontmatter parser — the reference every copy matches.

Identity files carry their role list under the `roles:` key. Agents write that
key in whatever shape comes to mind, so every reader accepts all of these
(see roles-frontmatter-cases.json for the full conformance set):

  roles: a              roles: "a"            roles: 'a'
  roles: [a, b]         roles: ["a", 'b']     roles: a, b
  roles:                roles:
    - a                 - a
    - b                 - b

Trailing `# comments` are ignored. Only the first `---` … `---` block is read.
The singular `role:` key is NOT read. Names failing ROLES_SLUG_RE are dropped;
duplicates collapse keeping first occurrence. Returns [] when nothing valid.

Copies live in: role-file-watch.py, fleet-status-sweep.py, ambient-monitor.py,
agent-supervisor.sh (embedded), and src/backend/database/routes/identity-unarchive.ts
(embedded). The TS reader in identity-artifact-reader.ts implements the same
contract. tests/roles-frontmatter-conformance.test.sh checks them all.
"""
import re

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
