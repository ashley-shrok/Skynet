#!/usr/bin/env bash
# shellcheck shell=bash
#
# Hermetic test driver for substrate/scripts/id-load-context.py — the
# UserPromptSubmit hook that hands an `/id <name>` load its identity, role,
# role-skill, scheduled-task, wake-up and project context.
#
# Each test builds a scratch ~/fleet under a temp HOME, feeds the hook a
# UserPromptSubmit payload, and asserts on the additionalContext it emits.
#
# Exits 0 on all-pass; exits 1 on any failure with a diagnostic naming
# the failing test.
#
# Usage: bash substrate/scripts/tests/id-load-context.test.sh
#   Run from the repo root.
#
# Requirements: bash, jq, python3.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
HOOK="$REPO_ROOT/substrate/scripts/id-load-context.py"

if [ ! -x "$HOOK" ]; then
  printf 'FATAL: hook script not found or not executable at %s\n' "$HOOK" >&2
  exit 1
fi

PASS=0
FAIL=0
FAILED_TESTS=()

fail() {
  FAIL=$((FAIL + 1))
  FAILED_TESTS+=("$1")
  printf 'FAIL: %s — %s\n' "$1" "$2" >&2
}

pass() {
  PASS=$((PASS + 1))
}

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

# Fresh fleet tree per test.
reset_home() {
  rm -rf "${SCRATCH:?}/home"
  F="$SCRATCH/home/fleet"
  mkdir -p "$F/identities" "$F/roles" "$F/projects" "$F/scheduled-agents/.state"
}

identity() {  # name, frontmatter body lines (already \n-joined)
  mkdir -p "$F/identities/$1"
  printf -- '---\n%s\n---\n\n# %s\n' "$2" "$1" > "$F/identities/$1/$1.md"
}

role() {  # slug, body
  mkdir -p "$F/roles/$1"
  printf -- '---\ndisplayName: %s\n---\n\n%s\n' "$1" "$2" > "$F/roles/$1/$1.md"
}

# Run the hook; prints the additionalContext (empty when the hook is silent).
run_hook() {
  printf '%s' "$(jq -n --arg p "$1" '{prompt: $p}')" \
    | HOME="$SCRATCH/home" "$HOOK" \
    | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null
}

assert_contains() {  # test, haystack, needle
  case "$2" in
    *"$3"*) return 0 ;;
  esac
  fail "$1" "expected output to contain: $3"
  return 1
}

assert_not_contains() {
  case "$2" in
    *"$3"*) fail "$1" "expected output NOT to contain: $3"; return 1 ;;
  esac
  return 0
}

# Run the hook as a PostToolUse payload: tool name, skill, args.
run_skill_hook() {  # tool, skill, args, [agent_id]
  printf '%s' "$(jq -n --arg t "$1" --arg s "$2" --arg a "$3" --arg g "${4:-}" \
      '{hook_event_name: "PostToolUse", tool_name: $t, tool_input: {skill: $s, args: $a}}
       + (if $g == "" then {} else {agent_id: $g} end)')" \
    | HOME="$SCRATCH/home" "$HOOK"
}

# ---- tests ----

test_agent_invoked_id_skill() {
  local t=test_agent_invoked_id_skill
  reset_home
  identity alpha 'roles: [keeper]'
  role keeper "keeper directives"
  local raw out
  raw="$(run_skill_hook Skill id Alpha)"
  [ "$(printf '%s' "$raw" | jq -r '.hookSpecificOutput.hookEventName')" = "PostToolUse" ] \
    || { fail $t "hookEventName is not PostToolUse"; return; }
  out="$(printf '%s' "$raw" | jq -r '.hookSpecificOutput.additionalContext')"
  assert_contains $t "$out" "for \`alpha\`" || return
  assert_contains $t "$out" "keeper directives" || return
  # Only the first word of the args names the identity.
  out="$(run_skill_hook Skill id "alpha please" | jq -r '.hookSpecificOutput.additionalContext')"
  assert_contains $t "$out" "for \`alpha\`" || return
  local case_
  for case_ in "Skill|build|alpha|" "Skill|id||" "Skill|id|save|" "Skill|id|nobody|" "Read|id|alpha|" "Skill|id|alpha|sub-1"; do
    IFS='|' read -r tn sk ar ag <<< "$case_"
    if [ -n "$(run_skill_hook "$tn" "$sk" "$ar" "$ag")" ]; then
      fail $t "hook spoke on: $case_"
      return
    fi
  done
  pass
}

test_silent_on_other_prompts() {
  reset_home
  identity alpha 'roles: []'
  local p out
  for p in "hello" "/id" "/id save" "/id reset" "/id archive" "/id nobody" "/idalpha" "/id alpha extra"; do
    out="$(run_hook "$p")"
    if [ -n "$out" ]; then
      fail test_silent_on_other_prompts "hook spoke on prompt: $p"
      return
    fi
  done
  pass
}

test_full_context() {
  local t=test_full_context
  reset_home
  identity alpha 'roles: [keeper, gardener]
project: child'
  role keeper "keeper directives"
  role gardener "gardener directives"
  mkdir -p "$F/roles/keeper/skills/deploy" "$F/roles/keeper/skills/restore" \
    "$F/roles/keeper/skills/empty" "$F/roles/keeper/skills/nofm" "$F/roles/keeper/skills/nodesc" \
    "$F/roles/keeper/skills/.hidden" "$F/roles/keeper/runbooks/old"
  printf -- '---\nname: deploy\ndescription: "Ship the app. Use when told to deploy."\n---\n# Deploy\n' \
    > "$F/roles/keeper/skills/deploy/SKILL.md"
  printf -- '---\nname: restore\ndescription: >-\n  Bring a backup\n  back.\n---\n' \
    > "$F/roles/keeper/skills/restore/SKILL.md"
  printf -- '# No frontmatter\n' > "$F/roles/keeper/skills/nofm/SKILL.md"
  printf -- '---\nname: nodesc\n---\n' > "$F/roles/keeper/skills/nodesc/SKILL.md"
  touch "$F/roles/keeper/skills/stray.txt"
  mkdir -p "$F/scheduled-agents/nightly" "$F/scheduled-agents/other-role"
  printf '{"name":"nightly","enabled":true,"roles":["keeper"],"prompt":"p","schedule":{"type":"daily","at":"02:00"}}' \
    > "$F/scheduled-agents/nightly/scheduled-agent.json"
  printf '{"name":"other","enabled":true,"roles":["stranger"],"prompt":"p","schedule":{"type":"daily","at":"03:00"}}' \
    > "$F/scheduled-agents/other-role/scheduled-agent.json"
  printf '1790000000.5' > "$F/scheduled-agents/.state/nightly.last"
  mkdir -p "$F/identities/alpha/wakeups/ping/.state"
  printf '{"name":"ping","enabled":false,"schedule":{"type":"interval","every":"2h"},"instruction":"x"}' \
    > "$F/identities/alpha/wakeups/ping/wakeup.json"
  printf '1790000000' > "$F/identities/alpha/wakeups/ping/.state/ping.last"
  mkdir -p "$F/projects/parent" "$F/projects/child/notes"
  printf -- '---\ndisplayName: Parent Proj\n---\nparent rules\n' > "$F/projects/parent/project.md"
  printf -- '---\ndisplayName: Child Proj\nparent: parent\n---\nchild rules\n' > "$F/projects/child/project.md"
  touch "$F/projects/child/ref.txt"

  local out
  out="$(run_hook "/id Alpha")"
  assert_contains $t "$out" "for \`alpha\`" || return
  assert_contains $t "$out" "# alpha" || return
  assert_contains $t "$out" "## Role: keeper" || return
  assert_contains $t "$out" "keeper directives" || return
  assert_contains $t "$out" "gardener directives" || return
  assert_contains $t "$out" "Role skills — each is ~/fleet/roles/keeper/skills/<name>/SKILL.md; when one's description fits the situation, read it and follow it:" || return
  assert_contains $t "$out" "- deploy — Ship the app. Use when told to deploy." || return
  assert_contains $t "$out" "- restore — Bring a backup back." || return
  assert_contains $t "$out" "- empty — ⚠️ couldn't be read: it has no readable SKILL.md." || return
  assert_contains $t "$out" "- nofm — ⚠️ couldn't be read: its SKILL.md has no frontmatter block." || return
  assert_contains $t "$out" "- nodesc — ⚠️ couldn't be read: its frontmatter has no description." || return
  assert_not_contains $t "$out" ".hidden" || return
  assert_not_contains $t "$out" "stray.txt" || return
  assert_not_contains $t "$out" "- old" || return
  assert_not_contains $t "$out" "Runbooks" || return
  # gardener has no skills folder at all.
  assert_contains $t "$out" "Role skills: none" || return
  assert_contains $t "$out" '- nightly — {"type": "daily", "at": "02:00"} · enabled · last fired' || return
  assert_not_contains $t "$out" "other-role" || return
  assert_contains $t "$out" '- ping — {"type": "interval", "every": "2h"} · disabled · last fired' || return
  assert_contains $t "$out" "Project chain (top-down): Parent Proj (parent) › Child Proj (child)" || return
  assert_contains $t "$out" "parent rules" || return
  assert_contains $t "$out" "child rules" || return
  assert_contains $t "$out" "notes/, ref.txt" || return
  # Parent project comes before the child.
  case "$out" in
    *"parent rules"*"child rules"*) ;;
    *) fail $t "project files not in top-down order"; return ;;
  esac
  pass
}

test_no_roles_no_project() {
  local t=test_no_roles_no_project
  reset_home
  identity solo 'roles: []'
  local out
  out="$(run_hook "/id solo")"
  assert_contains $t "$out" "# solo" || return
  assert_not_contains $t "$out" "## Role:" || return
  assert_not_contains $t "$out" "Project chain" || return
  assert_contains $t "$out" "## Your wake-ups
none" || return
  pass
}

test_never_fired_and_no_role_skills() {
  local t=test_never_fired_and_no_role_skills
  reset_home
  identity beta 'roles: [keeper]'
  role keeper "k"
  mkdir -p "$F/scheduled-agents/weekly"
  printf '{"name":"Weekly Sweep","roles":["keeper"],"prompt":"p","schedule":{"type":"weekly","day":"mon","at":"09:00"}}' \
    > "$F/scheduled-agents/weekly/scheduled-agent.json"
  local out
  out="$(run_hook "/id beta")"
  assert_contains $t "$out" "Role skills: none" || return
  assert_contains $t "$out" "- weekly (Weekly Sweep) — " || return
  assert_contains $t "$out" "· enabled · never fired" || return
  pass
}

test_budget_points_at_large_files() {
  local t=test_budget_points_at_large_files
  reset_home
  identity gamma 'roles: [big, small]'
  role big "$(head -c 12000 /dev/zero | tr '\0' 'x')"
  role small "small directives"
  local out
  out="$(run_hook "/id gamma")"
  assert_contains $t "$out" "# gamma" || return
  assert_contains $t "$out" "/fleet/roles/big/big.md (too large to include here; Read it)" || return
  assert_contains $t "$out" "small directives" || return
  if [ "${#out}" -gt 9500 ]; then
    fail $t "context is ${#out} chars, over the 9500 budget"
    return
  fi
  pass
}

test_fences_enabled_and_listing_cap() {
  local t=test_fences_enabled_and_listing_cap
  reset_home
  identity delta 'roles: [keeper]
project: big'
  role keeper 'Example:
```bash
echo hi
```
after the block'
  mkdir -p "$F/scheduled-agents/off"
  printf '{"name":"off","enabled":0,"roles":["keeper"],"prompt":"p","schedule":{"type":"daily","at":"02:00"}}' \
    > "$F/scheduled-agents/off/scheduled-agent.json"
  mkdir -p "$F/projects/big"
  printf -- '---\ndisplayName: Big\n---\n' > "$F/projects/big/project.md"
  local i
  for i in $(seq -w 1 60); do touch "$F/projects/big/file$i.txt"; done
  local out
  out="$(run_hook "/id delta")"
  assert_contains $t "$out" '````
---
displayName: keeper' || return
  assert_contains $t "$out" '- off — {"type": "daily", "at": "02:00"} · disabled' || return
  assert_contains $t "$out" "file40.txt, … and 20 more" || return
  assert_not_contains $t "$out" "file41.txt" || return
  pass
}

test_silent_on_other_prompts
test_agent_invoked_id_skill
test_fences_enabled_and_listing_cap
test_full_context
test_no_roles_no_project
test_never_fired_and_no_role_skills
test_budget_points_at_large_files

printf '\n===============================\nPASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:\n'
  printf '  - %s\n' "${FAILED_TESTS[@]}"
  exit 1
fi
exit 0
