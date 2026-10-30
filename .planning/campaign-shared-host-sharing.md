# Campaign: Shared-host sharing — see and change who can see an agent, role, project, app or scheduled task, from the app

**Opened:** 2026-10-30
**Status:** in_progress
**Workspace:** /home/ubuntu/fleet/identities/artemis-box-maintainer-4/workspace/skynet/.planning/ (tasting at /home/ubuntu/fleet/identities/artemis-box-maintainer-4/workspace/tasting/)

## Concept

On a machine several people use, anything an agent, role, project, app or
scheduled task can be limited to some of those people — but today the only
way to see or change who is by editing the file on disk, and an agent can be
"shared" on its own list while its role's list still hides it (an agent shared
with someone whose role still hides it). This campaign puts a "Shared with" control on every
one of those five things: a button showing who it is shared with, opening a
ticked list of everyone on that machine (the user marked "you"). Sharing
writes the person onto each thing it covers — version one keeps the existing
"you must see the agent AND its role" rule rather than redesigning it — so:
ticking someone on an agent whose role they can't see offers to share the
role too ("Share both"); sharing a project shares its sub-projects and every
agent inside (and offers their roles), and unsharing a project unshares the
same set; a scheduled task's conversations are shared with the same people
as the task. Anyone who can see a thing can change its list, including taking
themselves off (with a warning); the last person can't be unticked, since an
empty list means everyone. Machines with a single user show none of this.

Agreed look (tasted 2026-10-30 via console snippet, the user: "this kicks ass.
Let's go with it"): `workspace/tasting/share-tasting.js` — agent window and
role view: people button beside Voice; project window: under the count line
with an "also shares its sub-projects and the agents in them" hint; scheduled
task: a "Shared with" field under Project; app: a "Share…" item in the app's
menu opening the same list in a small window.

## Success criteria

1. Every agent, role, project, app and scheduled task on a multi-user machine
   can be shared and unshared entirely from the app — no file editing.
2. Once something is shared with a person, it actually shows up for them —
   no second list quietly keeps it hidden (role offered alongside the agent;
   project sharing reaches everything inside).
3. Anything limited to some people says so and names who can see it.
4. Single-user machines look exactly as they do today.
5. Wording names people without pronouns and fits any user on any instance.

## Shapes

- **[declared] shape-sharing-agents-roles-projects** — the shared "Shared with" control and the read/write of who-can-see on agents, roles and projects, with the share-the-role-too offer and project sharing reaching its sub-projects and agents — closed
- **[declared] shape-sharing-apps-tasks** — the same control on apps (Share… in the app menu) and scheduled tasks (field under Project), with a task's conversations born shared with the task's people — closed

## Other work

- What's-new note for the whole sharing feature — draft it and get the user's yes at campaign close, before the deploy — open
- Roleless agents made inside a project stay private to their maker (the user 2026-10-30) — shape 2's scheduled-task conversations should be checked against this — noted-only (checked in shape 2: a task's conversations follow the task, not their maker; the user agreed)

## Lingerers (explicitly approved)

(none)

## Open questions

- Should conversations rows / project headers in the sidebar also get a "Share…" menu item, or is the window control enough? — answered in shape 1: no, the window buttons are enough for now (the user agreed).
