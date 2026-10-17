# Campaign: Nested projects

**Opened:** 2026-10-16
**Status:** in_progress
**Workspace:** /home/ubuntu/fleet/identities/cosmos-box-maintainer-5/workspace/skynet/.planning/campaigns/nested-projects/

## Concept

Let a project hold smaller projects, so a big project (SKYNET, with dozens of
agents) can be organized into sub-projects instead of being one long flat list.
A project names its parent with one optional line in its project file; project
folders stay side by side on disk exactly as today, so moving a project under
another (or back out) is a one-line edit and never moves a folder or breaks any
agent's pointer to its project. Nesting can go to any depth. A project with
sub-projects is still an ordinary project — agents and relay rooms can sit at
any level. An agent in a sub-project knows its own project and inherits the
conventions of every ancestor above it.

## Agreed design (from the concept beat)

- **Parent line, flat folders.** Each project file may name a parent project;
  no parent = top level. Folder layout, project names, and the rule for what a
  project name may look like are unchanged.
- **Any depth.** No artificial limit.
- **Membership at any level.** Agents and relay rooms can be in a parent
  project directly, not only in leaves. Each still belongs to exactly one
  project.
- **Member lists stay direct-only.** A project's member list lists the agents
  directly in it — not those in its sub-projects. The supervisor's per-tick
  member-list upkeep needs no change.
- **Visibility inherits downward.** A sub-project is visible only to users who
  can see every ancestor; a sub-project can narrow visibility further but never
  widen it.
- **Sidebar.** A sub-project renders as an indented, collapsible section inside
  its parent, above the parent's own conversations. Dragging a project header
  onto another project nests it; dragging onto the Projects super-header
  returns it to top level. The project menu gains "New sub-project" and a
  "Move to". Search matching a parent's name reveals its whole subtree.
- **Archive takes the subtree.** Archiving a parent archives every project
  beneath it and their member agents, with a confirm that states how many
  projects and agents that covers.
- **Guard rails.** No placing a project inside itself or its own descendant. A
  parent must be on the same machine. A project whose parent is missing (gone,
  archived) shows at top level rather than vanishing.
- **Agent side.** At load, an agent reads its whole project chain top-down
  (top ancestor first, own project last). The file watcher watches the own
  project file plus every ancestor's. When a parent line changes in any
  watched file, or an ancestor's file disappears, the watcher works out the
  chain again and tells the agent plainly ("your project is now inside X —
  read its file" / "your project is no longer inside X"). For the agent's own
  project, notices are as today, member changes included. For ancestor
  projects, the agent is told about changes to the file's content but never
  about member-list churn.

## Success criteria

- Ashley can turn SKYNET into a parent with sub-projects and move agents and
  relay rooms into those sub-projects from the sidebar — on desktop and mobile.
- Moving projects (nesting, un-nesting, re-parenting) and archiving behave
  predictably: nothing vanishes, nothing ends up in a loop, archiving a parent
  takes its subtree and says so first.
- Visibility restrictions on a parent hold for everything beneath it.
- An agent in a sub-project knows the conventions its ancestors set, and keeps
  knowing them as those files change or the chain is rearranged — without
  being flooded by member churn in ancestor projects.
- The id skill accurately describes nested projects for every agent.
- Nothing about today's flat projects regresses for anyone who never nests.

## Shapes

- **[declared] shape-nested-projects-structure** — the parent line, the project
  list the app receives carrying it, sidebar nesting, create sub-project, move
  (menu + drag), archive-the-subtree, visibility inheritance, guard rails, and
  the id skill's description of the new interface — closed (2026-10-17;
  shape-nested-projects-structure.closed.md)
- **[declared] shape-nested-projects-agent-side** — agents reading their
  ancestor chain at load, the file watcher covering ancestors and following
  chain changes, ancestor member-churn suppression, and the id skill's
  description of what agents see — not started (next)

Ordering: structure first (useful on its own; agents in sub-projects simply
behave as today until shape 2 lands), then agent side.

## Other work

- Two people re-parenting two projects into each other at the same instant
  can still produce a loop (the move route checks then writes, no lock). The
  sidebar shows looped projects safely at top level and "Move to" undoes it.
  Recommendation: record as a known edge, no locking. Raised to Ashley
  2026-10-17; she moved on to shape 2 without answering — CONFIRM at campaign
  close (lingerer vs. fix).

## Lingerers (explicitly approved)

(none)

## Open questions

- ~~Relay rooms carry project membership as a room tag~~ — resolved in shape 1:
  nothing changes; a room tag names a project by its name, and a sub-project
  is still just a name.
- ~~Spawning directly into a sub-project and scheduled tasks~~ — resolved in
  shape 1: spawning into a sub-project works (the birth step only checks the
  name's format); scheduled tasks can't target a project at all today, so
  there is nothing to confirm.
