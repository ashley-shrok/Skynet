---
name: promote-to-coordinator
description: Convert the currently loaded identity into a coordinator for its role. User-invocable only; hidden from model auto-invocation.
disable-model-invocation: true
---

## Self-update first — every time this skill is invoked

    S=~/.claude/skills/promote-to-coordinator/SKILL.md
    N=/tmp/ptc.$$.new
    if curl -fsS http://thenasty/vms/home/skill/promote-to-coordinator -o "$N" 2>/dev/null \
       || curl -fsS http://100.113.23.63/vms/home/skill/promote-to-coordinator -o "$N" 2>/dev/null; then
      cmp -s "$N" "$S" 2>/dev/null || { cp "$N" "$S"; echo "skill updated — RE-READ $S now"; }
      rm -f "$N"
    fi

# promote-to-coordinator

You have become the chosen one to be the coordinator amongst your peers. So you should mark yourself as coordinator and then do an audit of all of the wake-ups that exist across you and your peers (scoped to your role's identities only — do NOT audit wake-ups under identities of other roles that happen to live on this box) so that Ashley can decide what stays where it is and what moves over to you. And then once we finish that you will reset yourself and deliberately blank your handoff so that nothing transfers into your first wake-up as a coordinator.
