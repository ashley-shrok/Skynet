#!/usr/bin/env bash
# shellcheck shell=bash
# Conformance driver for every copy of the `roles:` frontmatter parser.
#
# Identity files name their roles under the `roles:` key (the singular `role:`
# is NOT read). The canonical parser is
#   substrate/scripts/tests/fixtures/roles_frontmatter_reference.py
# and its conformance set is
#   substrate/scripts/tests/fixtures/roles-frontmatter-cases.json
# This driver runs EVERY case through the reference and through each copy:
#
#   reference          fixtures/roles_frontmatter_reference.py parse_roles_frontmatter
#   fleet-status-sweep fleet-status-sweep.py _read_identity_roles (module import)
#   ambient-monitor    ambient-monitor.py _read_frontmatter[0] (functions extracted
#                      via ast — the module spawns children at import time)
#   role-file-watch    role-file-watch.py _parse_roles_from_frontmatter
#                      (returns (roles, err); err → [])
#   agent-supervisor   agent-supervisor.sh _extract_frontmatter_roles (sourced
#                      with AGENT_SUPERVISOR_LIB_ONLY=1; stdout JSON compared)
#   identity-unarchive src/backend/database/routes/identity-unarchive.ts
#                      EXTRACT_ROLES_PYTHON (line array regexed out of the TS
#                      source, joined, run as `python3 -c <src> <path>`)
#
# Every case is written byte-exact (CRLF preserved) to a temp file, since most
# copies take a path. Prints PASS/FAIL per parser per case; exits 0 on
# all-pass, 1 on any failure.
#
# Usage: bash substrate/scripts/tests/roles-frontmatter-conformance.test.sh
#   Run from the repo root. Override supervisor path:
#   SUPERVISOR=/path/to/agent-supervisor.sh bash <this>
#
# Requirements: bash, python3.

export AGENT_SUPERVISOR_LIB_ONLY=1

set -u

# ---- path resolution ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SUPERVISOR="${SUPERVISOR:-$REPO_ROOT/substrate/scripts/agent-supervisor.sh}"
CASES="$SCRIPT_DIR/fixtures/roles-frontmatter-cases.json"

for _f in "$SUPERVISOR" "$CASES"; do
  if [ ! -f "$_f" ]; then
    printf 'FATAL: not found: %s\n' "$_f" >&2
    exit 1
  fi
done
command -v python3 >/dev/null 2>&1 || { printf 'FATAL: python3 not found\n' >&2; exit 1; }

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH" "${SCRATCH}"-*' EXIT
mkdir -p "$SCRATCH/cases" "$SCRATCH/.state"

# ---- 1. materialize every case as <idx>.md (byte-exact) ----
python3 - "$CASES" "$SCRATCH/cases" <<'PYEOF' || { printf 'FATAL: could not materialize cases\n' >&2; exit 1; }
import json, os, sys
cases = json.load(open(sys.argv[1], encoding="utf-8"))
for i, c in enumerate(cases):
    with open(os.path.join(sys.argv[2], "%03d.md" % i), "wb") as f:
        f.write(c["md"].encode("utf-8"))
PYEOF

# ---- 2. agent-supervisor.sh: source once in a subshell, run every case ----
(
  export AGENT_IDENTITIES_DIR="$SCRATCH/ids"
  export AGENT_IDENTITIES_ARCHIVE_DIR="${SCRATCH}-archive"
  export AGENT_ROLES_DIR="${SCRATCH}-roles"
  export AGENT_ROLES_ARCHIVE_DIR="${SCRATCH}-roles-archive"
  export AGENT_APPS_DIR="${SCRATCH}-apps"
  export AGENT_APPS_ARCHIVE_DIR="${SCRATCH}-apps-archive"
  export AGENT_SYSTEMD_UNIT_DIR="${SCRATCH}-systemd-units"
  export AGENT_APP_CREATE_LOCK="$SCRATCH/.create-lock"
  export DORMANCY_STATE_DIR="$SCRATCH/.state"
  # shellcheck disable=SC1090
  source "$SUPERVISOR" >/dev/null 2>&1 || true
  if ! declare -F _extract_frontmatter_roles >/dev/null; then
    printf 'FATAL: _extract_frontmatter_roles not defined after sourcing %s\n' "$SUPERVISOR" >&2
    exit 1
  fi
  for f in "$SCRATCH"/cases/*.md; do
    _extract_frontmatter_roles "$f" > "${f%.md}.supervisor.out" 2>/dev/null || true
  done
) || exit 1

# ---- 3. compare every parser against the expected list ----
python3 - "$CASES" "$SCRATCH/cases" "$REPO_ROOT" <<'PYEOF'
import ast, importlib.util, json, os, re, subprocess, sys

cases_path, case_dir, repo = sys.argv[1], sys.argv[2], sys.argv[3]
scripts = os.path.join(repo, "substrate", "scripts")
cases = json.load(open(cases_path, encoding="utf-8"))


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def extract_defs(path, names):
    """Exec only the named top-level defs/assignments from a module whose
    import has side effects."""
    src = open(path, encoding="utf-8").read()
    tree = ast.parse(src)
    keep = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in names:
            keep.append(node)
        elif isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id in names for t in node.targets
        ):
            keep.append(node)
    ns = {"re": re}
    exec(compile(ast.Module(body=keep, type_ignores=[]), path, "exec"), ns)
    return ns


def ts_python(path):
    src = open(path, encoding="utf-8").read()
    m = re.search(r"const EXTRACT_ROLES_PYTHON = \[(.*?)\]\.join\(\"\\n\"\);", src, re.S)
    if not m:
        raise RuntimeError("EXTRACT_ROLES_PYTHON array not found in %s" % path)
    inner = re.sub(r",\s*$", "", m.group(1).strip())
    return "\n".join(json.loads("[" + inner + "]"))


parsers = {}
setup_errors = {}


def register(name, factory):
    try:
        parsers[name] = factory()
    except Exception as e:  # report as FAIL for every case
        setup_errors[name] = "%s: %s" % (type(e).__name__, e)


def _reference():
    mod = load_module("roles_ref", os.path.join(scripts, "tests", "fixtures",
                                                "roles_frontmatter_reference.py"))
    return lambda path: mod.parse_roles_frontmatter(open(path, encoding="utf-8", newline="").read())


def _sweep():
    mod = load_module("fleet_status_sweep", os.path.join(scripts, "fleet-status-sweep.py"))
    return mod._read_identity_roles


def _ambient():
    ns = extract_defs(os.path.join(scripts, "ambient-monitor.py"),
                      {"_ROLES_SLUG_RE", "_parse_roles_frontmatter", "_read_frontmatter"})
    if "_read_frontmatter" not in ns:
        raise RuntimeError("_read_frontmatter not found")
    return lambda path: ns["_read_frontmatter"](path)[0]


def _rfw():
    mod = load_module("role_file_watch", os.path.join(scripts, "role-file-watch.py"))

    def run(path):
        res = mod._parse_roles_from_frontmatter(path)
        if not (isinstance(res, tuple) and len(res) == 2):
            raise RuntimeError("expected (roles, err), got %r" % (res,))
        roles, err = res
        return [] if err is not None or roles is None else roles
    return run


def _supervisor():
    def run(path):
        out_path = path[:-3] + ".supervisor.out"
        return json.loads(open(out_path, encoding="utf-8").read() or "null")
    return run


def _unarchive_ts():
    code = ts_python(os.path.join(repo, "src", "backend", "database", "routes",
                                  "identity-unarchive.ts"))

    def run(path):
        p = subprocess.run(["python3", "-c", code, path], capture_output=True, text=True)
        if p.returncode != 0:
            raise RuntimeError("exit %d: %s" % (p.returncode, p.stderr.strip()[-200:]))
        return json.loads(p.stdout.strip() or "[]")
    return run


register("reference", _reference)
register("fleet-status-sweep", _sweep)
register("ambient-monitor", _ambient)
register("role-file-watch", _rfw)
register("agent-supervisor", _supervisor)
register("identity-unarchive", _unarchive_ts)

names = ["reference", "fleet-status-sweep", "ambient-monitor", "role-file-watch",
         "agent-supervisor", "identity-unarchive"]
npass = nfail = 0
failures = []
for name in names:
    print("== %s" % name)
    for i, c in enumerate(cases):
        path = os.path.join(case_dir, "%03d.md" % i)
        want = c["roles"]
        if name in setup_errors:
            got, err = None, "setup: " + setup_errors[name]
        else:
            try:
                got, err = parsers[name](path), None
            except Exception as e:
                got, err = None, "%s: %s" % (type(e).__name__, e)
        if err is None and got == want:
            npass += 1
            print("PASS  %-18s %s" % (name, c["name"]))
        else:
            nfail += 1
            detail = err if err is not None else "got %s, want %s" % (json.dumps(got), json.dumps(want))
            print("FAIL  %-18s %s — %s" % (name, c["name"], detail))
            failures.append("%s / %s" % (name, c["name"]))

print()
print("===============================")
print("PASS: %d  FAIL: %d" % (npass, nfail))
if failures:
    print("Failures:")
    for f in failures:
        print("  - %s" % f)
sys.exit(1 if nfail else 0)
PYEOF
