# Campaign: Roles an agent can borrow on its own, like a skill, without taking them on for good

**Opened:** 2026-11-06
**Status:** in_progress
**Workspace:** ~/fleet/identities/aster-box-maintainer-5/workspace/skynet/.planning/

## Concept

The user can mark a role as borrowable. Every agent on that box sees the borrowable roles it doesn't already hold listed, each with its one-line description, when it loads and again after every compaction. When a request fits one, the agent can borrow it on its own, the way it picks up a skill: it reads the role's file and its role skills, works under that role's rules (safety rules included) for that work, says in the conversation that it borrowed it, and never adds it to its own roles, so the role fades at the next compaction. If it keeps borrowing the same role it offers to take that role on for good. Unmarked roles behave exactly as today. The user can mark a role borrowable from the app, both when creating a role and on an existing role. This is a version one to try out and learn from.

## Success criteria

- A generalist agent asked to do something in a borrowable role's domain finds that role in its list, borrows it, and does the work with the existing setup that role knows about instead of improvising its own.
- Borrowing never adds the role to the agent's identity file; after a compaction the role is not reloaded automatically, but it is still listed as borrowable.
- An agent on a box with no borrowable roles sees nothing new, and agents only ever take roles on for good when the user says so.
- Roles the agent already holds are not listed as borrowable.
- The user can mark and unmark a role as borrowable in the app, on the new-role form and on an existing role, without editing files by hand.

## Shapes

- **[declared] shape-borrowable-roles** — the borrowable mark, the listing at load and after compaction, the borrowing guidance in the id skill, and the switch in the app — closed

## Other work

- After deploy, mark the media role borrowable on the user's home agent's box — needs the user's go-ahead (configuration on another box, not code) — open

## Lingerers (explicitly approved)

## Open questions
