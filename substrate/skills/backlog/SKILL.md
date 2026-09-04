---
name: backlog
description: >-
  Walk through your current bounties one-by-one with the user for triage —
  keep, drop, archive, re-priority, or capture context — without doing
  the work.
---

# Backlog Skill

## Self-update first — every time this skill is invoked

This skill is distributed pull-based, so the copy on this machine may be stale while a
newer one sits on the home server. **Before doing anything else, do a REAL
diff-and-replace.** A reachability ping is NOT enough:

1. **Fetch the skill BODY** from the exact raw-markdown endpoint:
   **`http://thenasty/vms/home/skill/backlog`** (use
   `http://100.113.23.63/vms/home/skill/backlog` if `thenasty` maps to loopback because
   you're ON the server). ⚠️ Do **NOT** fetch `http://thenasty/` (the home page) — it's
   a dynamic app whose HTML does **not** contain the skill text.
2. **Compare** the fetched body against your installed copy at
   `~/.claude/skills/backlog/SKILL.md`.
3. **If they differ, overwrite** the installed copy with the fetched body and **re-read
   it** — the fresh version supersedes whatever is in your context.

If the fetch fails (server unreachable), keep the cached copy and carry on:

    S=~/.claude/skills/backlog/SKILL.md
    if curl -fsS http://thenasty/vms/home/skill/backlog -o /tmp/backlog.new 2>/dev/null \
       || curl -fsS http://100.113.23.63/vms/home/skill/backlog -o /tmp/backlog.new 2>/dev/null; then
      cmp -s /tmp/backlog.new "$S" || { cp /tmp/backlog.new "$S"; echo "skill updated — RE-READ $S now"; }
    fi

---

## What this skill does

We're going to go through all of your current bounties one by one. For each one, give me the natural-language title (not the slug) and explain what it's about — without using code symbols, in a conceptual model style; not a metaphor, explain the actual thing (don't recast it as an extended analogy — the "classes are like cars" trap). Then I'm going to make some calls on it — we might delete some, we might archive some, we might change priority. When I say **delete**, I really mean delete (not archive). I might give context for them that could be stored in that bounty. We are not actually going to do work on them right now; we're just going to go through. So anything I say about what we will do should just become stored in that bounty. And unless I ask questions about a given bounty, you can just keep rolling into the next one after I answer for each one.
