#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317
# Test driver for sync_project_members() — the supervisor's per-tick rewrite of
# each project.md's derived `members:` list from live identities' `project:`
# frontmatter.
#
# Covers:
#   T-01 — members land sorted per project; a project with nobody gets
#          `members: []`; every other byte of the file is kept.
#   T-02 — steady state writes nothing (inode + mtime unchanged).
#   T-03 — leaving / moving updates the block in place (position kept).
#   T-04 — a hand-written flow-form `members: [..]` is replaced.
#   T-05 — project.md without frontmatter is left alone; `archive/` skipped.
#   T-06 — a rewrite past the frontmatter cap is refused and logged.
#   T-07 — DRY_RUN writes nothing.
#   T-08 — fleet-status-sweep still reads displayName + `users:` from a file
#          carrying a members block right after the users block.
#
# Exits 0 on all-pass; 1 on any failure.
#
# Usage: bash substrate/scripts/tests/agent-supervisor-project-members.test.sh
#   Run from the repo root.

export AGENT_SUPERVISOR_LIB_ONLY=1

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SUPERVISOR="${SUPERVISOR:-$REPO_ROOT/substrate/scripts/agent-supervisor.sh}"
SWEEP="$REPO_ROOT/substrate/scripts/fleet-status-sweep.py"

if [ ! -f "$SUPERVISOR" ]; then
  printf 'FATAL: supervisor not found at %s\n' "$SUPERVISOR" >&2
  exit 1
fi

PASS=0
FAIL=0
FAILURES=()
CURRENT_TEST=""

pass() { PASS=$((PASS+1)); printf 'PASS: %s\n' "$CURRENT_TEST"; }
fail() {
  FAIL=$((FAIL+1))
  FAILURES+=("$CURRENT_TEST: $1")
  printf 'FAIL: %s — %s\n' "$CURRENT_TEST" "$1" >&2
}

# shellcheck disable=SC1090
source "$SUPERVISOR" 2>/dev/null || true

if ! declare -F sync_project_members >/dev/null 2>&1; then
  printf 'FATAL: sync_project_members not defined after sourcing supervisor\n' >&2
  exit 1
fi

SCRATCH=""
LOGF=""
setup_scratch() {
  SCRATCH=$(mktemp -d)
  IDENTITIES_DIR="$SCRATCH/identities"
  FLEET_PROJECTS_DIR="$SCRATCH/projects"
  PROJECT_FRONTMATTER_CAP=4096
  DRY_RUN=0
  mkdir -p "$IDENTITIES_DIR" "$FLEET_PROJECTS_DIR"
  LOGF="$SCRATCH/log"
  : > "$LOGF"
}
teardown_scratch() {
  [ -n "$SCRATCH" ] && [ -d "$SCRATCH" ] && rm -rf "$SCRATCH"
  SCRATCH=""
}
run_case() {
  CURRENT_TEST="$1"; shift
  setup_scratch
  "$@"
  teardown_scratch
}

# Capture the supervisor's log lines for assertions.
sync() { sync_project_members >> "$LOGF" 2>&1; }

ident() {  # ident <name> [project-slug]
  mkdir -p "$IDENTITIES_DIR/$1"
  if [ -n "${2:-}" ]; then
    printf -- '---\nrole: r\nproject: %s\ntask: t\n---\n\nbody\n' "$2" > "$IDENTITIES_DIR/$1/$1.md"
  else
    printf -- '---\nrole: r\ntask: t\n---\n\nbody\n' > "$IDENTITIES_DIR/$1/$1.md"
  fi
}
project() {  # project <slug> [raw-file-content]
  mkdir -p "$FLEET_PROJECTS_DIR/$1"
  if [ $# -ge 2 ]; then
    printf '%s' "$2" > "$FLEET_PROJECTS_DIR/$1/project.md"
  else
    printf -- '---\ndisplayName: %s\n---\n\nShared notes.\n' "$1" > "$FLEET_PROJECTS_DIR/$1/project.md"
  fi
}
pmd() { cat "$FLEET_PROJECTS_DIR/$1/project.md"; }
NOTE="  # auto-maintained by agent-supervisor from identities' project: — edits are overwritten"

t01() {
  ident zed-r alpha; ident amy-r alpha; ident bob-r beta; ident cal-r
  project alpha; project beta; project gamma
  sync
  local want_a want_b want_g
  want_a=$(printf -- '---\ndisplayName: alpha\nmembers:%s\n  - amy-r\n  - zed-r\n---\n\nShared notes.' "$NOTE")
  want_b=$(printf -- '---\ndisplayName: beta\nmembers:%s\n  - bob-r\n---\n\nShared notes.' "$NOTE")
  want_g=$(printf -- '---\ndisplayName: gamma\nmembers: []%s\n---\n\nShared notes.' "$NOTE")
  [ "$(pmd alpha)" = "$want_a" ] || { fail "alpha: $(pmd alpha)"; return; }
  [ "$(pmd beta)" = "$want_b" ] || { fail "beta: $(pmd beta)"; return; }
  [ "$(pmd gamma)" = "$want_g" ] || { fail "gamma: $(pmd gamma)"; return; }
  pass
}

t02() {
  ident amy-r alpha; project alpha
  sync
  local before after
  before=$(stat -c '%i %Y.%y' "$FLEET_PROJECTS_DIR/alpha/project.md")
  sleep 1.1
  : > "$LOGF"
  sync
  after=$(stat -c '%i %Y.%y' "$FLEET_PROJECTS_DIR/alpha/project.md")
  [ "$before" = "$after" ] || { fail "file rewritten in steady state"; return; }
  [ ! -s "$LOGF" ] || { fail "logged in steady state: $(cat "$LOGF")"; return; }
  pass
}

t03() {
  ident amy-r alpha; ident bob-r alpha
  project alpha "$(printf -- '---\ndisplayName: Alpha\nusers: [ashley]\n---\n\nnotes\n')"
  sync
  # Move members key ahead of users by hand to check position is kept.
  python3 - "$FLEET_PROJECTS_DIR/alpha/project.md" <<'PY'
import sys; p=sys.argv[1]; L=open(p).read().split("\n")
m=[l for l in L if l.startswith("members:") or l.startswith("  - ")]
rest=[l for l in L if l not in m]
open(p,"w").write("\n".join(rest[:2]+m+rest[2:]))
PY
  ident bob-r beta
  sync
  local want
  want=$(printf -- '---\ndisplayName: Alpha\nmembers:%s\n  - amy-r\nusers: [ashley]\n---\n\nnotes' "$NOTE")
  [ "$(pmd alpha)" = "$want" ] || { fail "alpha after move: $(pmd alpha)"; return; }
  grep -q "project 'alpha' members → amy-r" "$LOGF" || { fail "no log line: $(cat "$LOGF")"; return; }
  pass
}

t04() {
  ident amy-r alpha
  project alpha "$(printf -- '---\ndisplayName: Alpha\nmembers: [ghost, amy-r]\n---\nx\n')"
  sync
  local want
  want=$(printf -- '---\ndisplayName: Alpha\nmembers:%s\n  - amy-r\n---\nx' "$NOTE")
  [ "$(pmd alpha)" = "$want" ] || { fail "flow form not replaced: $(pmd alpha)"; return; }
  pass
}

t05() {
  ident amy-r alpha; ident bob-r old
  project alpha "no frontmatter here
"
  mkdir -p "$FLEET_PROJECTS_DIR/archive/old"
  printf -- '---\ndisplayName: old\n---\n' > "$FLEET_PROJECTS_DIR/archive/old/project.md"
  sync
  [ "$(pmd alpha)" = "no frontmatter here" ] || { fail "frontmatter-less file changed: $(pmd alpha)"; return; }
  grep -q members "$FLEET_PROJECTS_DIR/archive/old/project.md" && { fail "archived project touched"; return; }
  pass
}

t06() {
  local i
  for i in $(seq 1 10); do ident "member-number-$i" alpha; done
  project alpha
  PROJECT_FRONTMATTER_CAP=200
  sync
  grep -q members "$FLEET_PROJECTS_DIR/alpha/project.md" && { fail "wrote past cap: $(pmd alpha)"; return; }
  grep -q "WARN project 'alpha'.*not written" "$LOGF" || { fail "no cap warning: $(cat "$LOGF")"; return; }
  pass
}

t07() {
  ident amy-r alpha; project alpha
  DRY_RUN=1
  sync
  grep -q members "$FLEET_PROJECTS_DIR/alpha/project.md" && { fail "DRY_RUN wrote"; return; }
  grep -q "DRY_RUN would set project 'alpha' members=amy-r" "$LOGF" || { fail "no DRY_RUN log: $(cat "$LOGF")"; return; }
  pass
}

t08() {
  ident amy-r alpha
  project alpha "$(printf -- '---\ndisplayName: Alpha Team\nusers:\n  - ashley\n  - zoey\n---\n\nnotes\n')"
  sync
  local got
  got=$(python3 - "$SWEEP" "$FLEET_PROJECTS_DIR/alpha/project.md" <<'PY'
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("sweep", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
c, _ = m._read_frontmatter_cosmetics(sys.argv[2], ("displayName", "users"))
print(json.dumps(c, sort_keys=True))
PY
)
  [ "$got" = '{"displayName": "Alpha Team", "users": ["ashley", "zoey"]}' ] || { fail "sweep read: $got / $(pmd alpha)"; return; }
  pass
}

run_case "T-01 members land sorted, rest kept" t01
run_case "T-02 steady state writes nothing" t02
run_case "T-03 move updates block in place" t03
run_case "T-04 flow-form members replaced" t04
run_case "T-05 no frontmatter / archive untouched" t05
run_case "T-06 cap refusal logged" t06
run_case "T-07 DRY_RUN writes nothing" t07
run_case "T-08 sweep still reads displayName + users" t08

printf '\n===============================\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:\n'
  for f in "${FAILURES[@]}"; do printf '  - %s\n' "$f"; done
  exit 1
fi
exit 0
