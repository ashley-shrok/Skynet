---
name: role
description: >-
  Create a role — the shared knowledge/bounty/history home that
  identities will adopt.
---

# Role Skill

## Self-update first — every time this skill is invoked

This skill is distributed pull-based, so the copy on this machine may be stale while a
newer one sits on the home server. **Before doing anything else, do a REAL
diff-and-replace.** A reachability ping is NOT enough:

1. **Fetch the skill BODY** from the exact raw-markdown endpoint:
   **`http://thenasty/vms/home/skill/role`** (use
   `http://100.113.23.63/vms/home/skill/role` if `thenasty` maps to loopback because
   you're ON the server). ⚠️ Do **NOT** fetch `http://thenasty/` (the home page) — it's
   a dynamic app whose HTML does **not** contain the skill text.
2. **Compare** the fetched body against your installed copy at
   `~/.claude/skills/role/SKILL.md`.
3. **If they differ, overwrite** the installed copy with the fetched body and **re-read
   it** — the fresh version supersedes whatever is in your context.

If the fetch fails (server unreachable), keep the cached copy and carry on:

    S=~/.claude/skills/role/SKILL.md
    if curl -fsS http://thenasty/vms/home/skill/role -o /tmp/role.new 2>/dev/null \
       || curl -fsS http://100.113.23.63/vms/home/skill/role -o /tmp/role.new 2>/dev/null; then
      cmp -s /tmp/role.new "$S" || { cp /tmp/role.new "$S"; echo "skill updated — RE-READ $S now"; }
    fi

---

## What this skill does

`/role <name>` creates a fresh ROLE folder — the shared knowledge home that identities
will adopt.

Under the two-folder layout (see the id skill for the full picture):

- `~/.claude/roles/<role>/` — the ROLE: role file, bounty pool, history, deeper
  reference files. Shared across every identity holding this role.
- `~/.claude/identities/<name>/` — the IDENTITY: slim per-clone state.

Multiple identities can point at the same role — clones running in parallel on the
same domain. `/role` handles **authoring** the role; `/id` handles **adopting** it via
an identity. Deliberately separate commands so authoring stays a rare, deliberate act
and adopting stays a frequent, lightweight one.

---

## On `/role <name>`

### 1. Resolve the role name

**Role names are ALWAYS lowercase** (same rule as identity names — filesystem is
case-sensitive, and a mixed-case folder produces silent duplicates). Before doing
anything, lowercase `<name>`.

```
name=$(printf '%s' "<name>" | tr '[:upper:]' '[:lower:]')
ROLE_DIR=~/.claude/roles/$name
```

Reject any name that isn't `[a-z0-9-]+` (kebab-case only; no dots, no slashes, no
underscores). Reserved keywords are the same as `/id`'s reserved list — refuse
`save`, `reset` as role names.

### 2. Refusal on collision

**If `$ROLE_DIR` already exists, REFUSE**:

> "Role **<name>** already exists at `~/.claude/roles/<name>/`. Not clobbering. If
> you want to adopt it as an identity, run `/id <some-identity-name>` and answer
> `<name>` when it asks which role to clone. If you want to modify the role, edit
> `~/.claude/roles/<name>/<name>.md` directly (mind the id skill's approval flow —
> `remember X` / `forget X`, or explicit hand-edit under user greenlight)."

Do NOT offer to overwrite. Do NOT auto-adopt as an identity — that's the user's
explicit call via `/id`.

### 3. Create the role folder

Create the folder + starter files, all empty of content the user didn't provide:

```bash
mkdir -p "$ROLE_DIR/bounties"
touch "$ROLE_DIR/history.md"
```

Write `$ROLE_DIR/<name>.md` — the starter role file — using this **skeleton**:

```markdown
# <Name>

## Role
[Tell me about this role and I'll fill this in.]

## Scope
[What's in this role's lane; what's out.]

## Standing directives
[One line per rule/directive. Add via `remember X` / `forget X`.]

## Learned preferences
[One line per preference. Added over time as the role gathers experience.]
```

⚠️ **Do NOT seed content the user didn't provide.** Leave the placeholders as literal
brackets. The user (via a `/id <name>` load + conversation) fills these in as the role
develops. The id-skill's leanness rules apply — keep the role file lean; war-stories
live in bounties, not here.

### 4. Confirm + point at next step

Announce:

> "Role **<name>** created at `~/.claude/roles/<name>/` (empty starter file + empty
> bounties/ + empty history.md). Next step: run `/id <name>` to create an identity
> that clones this role."

Then stop — do NOT invoke `/id` yourself. The user runs it when ready.
