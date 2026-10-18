# Campaign: Identities without any roles

**Opened:** 2026-10-16
**Status:** in_progress
**Workspace:** /home/ubuntu/fleet/identities/duet-box-maintainer-2/workspace/skynet/.planning/

## Concept

A new agent starts out as a plain assistant with no roles. Roles are optional
specializations layered on top — picked at creation if wanted, added later,
and removable all the way back down to none. "No roles" is a first-class,
normal state everywhere in the system rather than a data-integrity error.
This is deliberately NOT done by shipping a blank "general assistant" role:
that would put a non-role in the roles list, need distributing to every host,
and invite drift.

## Success criteria

1. A user can start a new conversation without picking any role and get a
   working, plain agent; "no roles" is the default in the picker, with roles
   as an optional zero-or-more selection.
2. A roleless agent loads, greets, works, and saves like any other; the
   agent-facing instructions it loads don't assume it has a role.
3. Every surface that currently refuses a roleless agent accepts it: loading,
   cloning, un-archiving, agent spawns, scheduled tasks, the sidebar.
   Removing an agent's last role is allowed.
4. Visibility: a roleless agent created by a user is visible only to that
   user (creator recorded on the agent's own visibility list).
5. Appearance: plain app defaults — default avatar and a neutral color,
   distinct from the multi-role gold. Adding a role makes it take on that
   role's look as usual.
6. Naming: a roleless agent's auto-generated name is just the word (no role
   suffix).
7. Nothing new appears in the roles list.

## Shapes

- **[declared] shape-roleless-identities** — first-class support for agents with zero roles, end to end, plus the new-conversation picker defaulting to none — closed

## Other work

- Cross-machine spawns of a plain agent that name their requester are refused (requester's file isn't on the target machine, so its visibility can't be read) — noted-only; fail-closed by design, revisit if cross-box roleless spawns become common.
- Code-review fixes applied: un-archive refuses an unreadable identity file; strict role reads for spawn visibility; picker default tracks machine count / shell toggle / failed role load; `roles: null` / `~` / `""` mean zero roles in every parser; spawn example names its requester — done.

## Lingerers (explicitly approved)

## Open questions
