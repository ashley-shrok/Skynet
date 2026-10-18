# Shape: Identities without any roles

**Opened:** 2026-10-18
**Campaign:** campaign-roleless-identities (one shape)

## What this is

An agent no longer needs a role to exist. A new agent can start as a plain
assistant with no roles, and roles become optional specializations layered on
top — picked at creation, added later, or removed all the way back down to
none. "No roles" becomes a normal, fully supported state everywhere in the
system, instead of the data-integrity error it is treated as today.

## Shape

**Creating one — the new-conversation picker.** The roles dropdown gains a
"No roles" entry. When the user has one machine, it sits at the top of the
flat list and is preselected, so opening the picker and pressing Create
yields a plain agent. When the user has several machines, every machine's
section has its own "No roles" entry at the top, nothing is preselected, and
Create stays disabled until something is picked — "No roles" on some machine,
or one or more roles. Nothing is remembered between openings. "No roles" and
roles are mutually exclusive: picking "No roles" clears picked roles; picking
a role clears "No roles"; picking from a different machine replaces earlier
picks as today; unticking the last role falls back to "No roles" on that
machine. The old behavior of auto-selecting a machine's only role goes away.
The agent is born on the machine whose entry was picked.

**Creating one — other ways in.** Agent-to-agent spawn requests may name no
roles. Scheduled tasks may name no roles — both saving one and running it
(on its clock or via Run now) work and birth a plain agent.

**Naming.** A roleless agent's auto-generated name is just the word, with a
number added if taken (e.g. "duet", "duet-2") — no role suffix.

**Visibility.** A roleless agent made through the picker is visible only to
the person who created it: they are recorded on the agent's own visibility
list, on every host, single-user or not. A roleless agent spawned by another
agent copies the spawning agent's own visibility list (unless the request
names its own). A roleless agent born from a scheduled task uses the task's
visibility list if it has one, and is otherwise open, as today.

**Appearance.** With no role to borrow a look from, a roleless agent uses
plain defaults: an avatar showing its initial on a neutral circle, and one
consistent neutral color across every surface (sidebar row, conversation
header, identity modal, pane), distinct from the gold used for multi-role
agents. That initial-on-a-circle avatar is also what any agent shows if its
avatar image fails to load. Once a role is added, the agent takes on that
role's look as usual.

**Sidebar row.** When a row shows the agent's task, the secondary line
normally names its roles; for a roleless agent it shows the machine name
instead — what the row already shows when there's no task.

**Living with no roles.** A roleless agent loads, works, saves, resets and
archives like any other. Its file-change watcher keeps running — it still
watches its own identity file, its project file(s) and the agent
instructions; there are simply no role files to watch. Removing an agent's
last role from its identity file is a supported edit; adding a role to a
roleless agent works as it does today. Un-archiving a roleless agent works
(both the server's check and the supervisor's).

**The agent instructions every agent loads.** Updated so nothing assumes a
role: loading with no roles skips the role-reading steps; the greeting for a
roleless agent is "Hi, I'm an agent with no roles — a plain assistant. Ask me
to take on a role any time." followed by the usual "what we're working on"
line when there is one; the new-conversation picker description, the spawn
request description, and the scheduled-task description all say roles are
optional (zero or more).

## Philosophy

Roles are layered on top of an agent; they are not what makes an agent. The
absence of a role is the natural starting point, not a special case. This is
deliberately NOT achieved by shipping a blank "general assistant" role:
such a role would sit in the roles list without being a real specialization,
would need distributing to every machine, and would drift as people added
instructions to it. The earlier locked decision that there are "no no-role
fallback branches anywhere" is explicitly reversed — the code's own comments
stating that rule come out with it.

## Prior context

Since August, every agent has been required to hold at least one role, and
the code enforced that as an invariant: creation refused it, loading treated
it as corrupt data, un-archiving refused it because it would leave the agent
unwatched and visible to everyone. Most display and read paths already
tolerate zero roles; the hard breaks are creation (picker, creation step,
spawns, scheduled tasks' Run now and clock-fired spawns), the role-lookup
step that throws, un-archive (server and supervisor), and the file-change
watcher, which exits — taking the agent's own-file and project-file notices
down with it and leaving a "watcher died" warning on every launch. Avatars
404 with no role to fall back to, and colors fall through to inconsistent
per-surface defaults. The picker very recently lost its machine step; the
machine is now inferred from the picked roles, which is why "No roles" lives
per machine section. Cloning was removed upstream and is no longer a concern.

## What would make it wrong

- A roleless agent ends up visible to people it shouldn't be — in particular,
  a picker-made roleless agent visible to anyone but its creator.
- A roleless agent silently loses its file-change notices, or gets a warning
  on every launch.
- Anything new appears in the roles list, or a hidden "default" role is
  introduced under the hood.
- The picker lets a user create an agent without having made a choice when
  they have several machines, or forces a role on a one-machine user.
- A roleless agent shows a broken image, an empty bold gap, or a color that
  differs from surface to surface.
- The agent instructions still tell agents that a role is required anywhere.
- An agent with roles behaves or looks any differently than it does today.

## Scope edges

**In:** the picker's "No roles" entries and default; creation step, spawns,
scheduled tasks (save, Run now, clock-fired) accepting no roles; bare naming;
visibility rules above; default avatar (initial on a circle, also as the
fallback when any agent's avatar fails to load) and neutral color; sidebar
row secondary line; role lookup no longer throwing; file-change watcher
running with no roles; un-archive accepting no roles; removing the last role
working; agent instructions updated; tests that encoded the old invariant
updated.

**Out / deferred:** a button or menu for adding/removing roles on an existing
agent (still done by editing the agent's file); any shipped "general
assistant" role; remembering the last-used machine in the picker.

**Tempting but no:** reworking how multi-role agents look; changing
visibility rules for agents that have roles.

## Handoff notes

Implemented by duet-box-maintainer-2 in its own Skynet tree, on the shared
branch. Follows the box-maintainer deploy boundary: commit with scoped tests
green, then stop and report — push and deploy need separate greenlights. The
agent instructions live in the repo's substrate copy and reach machines via
the distributor; the supervisor and file-change watcher scripts likewise.
The upstream new-conversation picker change (no machine step) landed
2026-10-18 and is the base this builds on.
