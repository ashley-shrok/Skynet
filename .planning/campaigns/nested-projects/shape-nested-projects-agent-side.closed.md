# Shape: Nested projects — what agents see

**Opened:** 2026-10-17

## What this is

Shape 2 of the nested-projects campaign. Shape 1 let a project sit inside
another; this shape makes agents understand that. An agent in a sub-project
reads its whole chain of projects when it loads (top ancestor first, its own
project last), keeps hearing about changes to every project file in that chain
while it runs, is told plainly when the chain itself is rearranged, and is
spared the constant member join/leave churn of busy ancestor projects. The
guidance every agent loads describes all of this.

## Shape

- **Reading at load.** The agent works out its chain by following parent lines
  upward from its own project, then reads the project files top-down: top
  ancestor first, own project last. For each project in the chain it also lists
  the names of the reference files in that project's folder (as it does for its
  own project today), opening them only when the work calls for it.
- **Nearer wins.** When projects at different levels disagree, the nearer one
  wins — own project over parent, parent over grandparent. The guidance states
  this in one line.
- **Broken chains stop where the sidebar stops.** Climbing ends at a missing or
  archived parent (the chain is whatever real projects were reached). If the
  agent's own project is caught in a loop, it is treated as top level and the
  agent reads only its own file. Projects hanging off a loop keep the chain up
  to the loop, exactly as the sidebar places them. What an agent believes about
  its chain always matches what Ashley sees in the sidebar.
- **Watching while running.** The change watcher covers the agent's own project
  file and every ancestor's.
  - Own project: notices exactly as today, member changes included.
  - Ancestor project: content changes are passed on, labeled with which
    ancestor they came from ("your parent project SKYNET's file changed"),
    same small-inline / large-pointer handling as other notices. Member-list
    lines are dropped from what's passed on; an edit that only touched the
    member list produces no notice at all.
- **Chain notices.** Whenever the chain changes — a parent line changes in any
  watched file, or an ancestor's file disappears — the watcher works the chain
  out again and gives one plain notice: the whole new chain top-down
  ("your project chain is now Ashley's work › SKYNET › Infra"), which project
  files are new and need reading, and which projects the agent is no longer
  under (drop their conventions). The same notice shape covers every kind of
  rearrangement at any level. A parent-line change in the agent's own project
  produces this chain notice instead of an ordinary file-edit notice.
- **Chain notices are never silenced as self-echo.** Ordinary content edits an
  agent made itself stay silent as today; a chain change is always told, even
  when the agent made it, because it likely hasn't read the new ancestor.
- **Guidance.** The guidance every agent loads describes the chain: how it is
  read at load and in what order, the nearer-wins rule, what ancestor notices
  and chain notices look like and what to do with them.

## Philosophy

The agent's picture of where it sits must match Ashley's sidebar, always —
same chain, same handling of broken links. Inheriting conventions from above is
the point; inheriting noise from above is not. Notices say what a change
means, not just that bytes changed. Nothing changes for an agent whose project
has no parent: it reads and hears exactly what it does today.

## Prior context

Shape 1 (closed) added the optional parent line, sidebar nesting, move,
archive-the-subtree, visibility inheritance, and the sidebar's broken-chain
rules. Today an agent reads only its own project file at load and lists that
folder; the watcher watches only the own project file and restarts itself only
when the agent's own project assignment changes. Member lists stay direct-only
and are rewritten automatically, so a parent with dozens of agents churns
often. Until this shape lands, agents in sub-projects behave as if the
sub-project were a flat project.

## What would make it wrong

- An agent believes it sits in a different chain from what the sidebar shows.
- Agents in sub-projects get a stream of notices every time someone joins or
  leaves a parent project.
- A rearrangement happens and the agent never learns about a new ancestor's
  conventions — or keeps following an ancestor it's no longer under.
- A loop or a missing parent makes the watcher spin, crash, or go quiet.
- Anything changes for an agent whose project is top level.
- A raw edit shows up where a plain "your chain changed" belongs, leaving the
  agent to puzzle out what it means.

## Scope edges

- **In:** load-time chain reading (files top-down, folder listings), the
  nearer-wins rule, the watcher covering ancestors, ancestor member-churn
  suppression, chain notices (including for self-made changes), the guidance
  text agents load.
- **Out:** watching project folders (not done today for the own project
  either); any change to the startup greeting; relay rooms (they have no
  files to read); anything in the app's interface; member lists becoming
  anything but direct-only.
- **Deferred:** nothing.

## Handoff notes

- Implementer: cosmos (box-maintainer), in the Skynet repo at
  `/home/ubuntu/fleet/identities/cosmos-box-maintainer-5/workspace/skynet/`.
- The watcher is the distributed substrate script for file changes; the
  guidance is the distributed id skill — both edited in the repo's substrate
  source, never the installed copies.
- Broken-chain rules must mirror shape 1's sidebar resolution (missing parent
  or loop member → top level; projects hanging off a loop keep their parent;
  a parent line of a bare null / true / false / number reads as no parent).
- Campaign artifact: `campaign-nested-projects.md` beside this file.

---

## Close-Out

**Closed:** 2026-10-17
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · Everything in the summary is in the material: chain reading at load, every ancestor's file watched, one chain notice on rearrangement, no ancestor member churn, guidance describes it.
- **Shape: Reading at load** — present · The guidance says to follow parent lines up and read top-down, top ancestor first and own project last. Each ancestor's folder is listed like the own one and opened on demand.
- **Shape: Nearer wins** — present · The guidance states it in one sentence: own over parent, parent over grandparent.
- **Shape: Broken chains stop where the sidebar stops** — present · The watcher uses the sidebar's rules for missing or archived parents, loops and projects hanging off a loop, and reads the parent value the same way as the shape-1 sweep.
- **Shape: Watching while running — own project** — present · Unchanged, member changes included. Only the parent line is held back, because it becomes a chain notice.
- **Shape: Watching while running — ancestor projects** — present · Labeled parent or ancestor, same inline/pointer handling. Member and parent lines are removed, and member-only edits are silent.
- **Shape: Chain notices** — present · The chain is re-worked after watched-file changes and ancestor folder moves or deletes. One notice gives the new chain, the files to read and the projects to drop; same shape at any level.
- **Shape: Chain notices are never silenced as self-echo** — present · The notice comes from comparing chains, independent of self-edit silencing.
- **Shape: Guidance** — present · Covers order, nearer-wins, ancestor notices, chain notices and what to do with them.
- **Philosophy** — present · The rules match the sidebar, notices say what a change means, and nothing changes for top-level projects.
- **Prior context (commitments)** — present · Member lists still direct-only. The old behavior is extended, not replaced.
- **Scope edges** — present · All In items present, no Out items done. Ancestor folders are watched only for being moved or deleted.
- **What would make it wrong: An agent believes it sits in a different chain from what the sidebar shows** — present · Same chain rules as the sidebar and the sweep.
- **What would make it wrong: Agents in sub-projects get a stream of notices every time someone joins or leaves a parent project** — present · Ancestor member lists are removed before comparing, and member-only edits produce no notice.
- **What would make it wrong: A rearrangement happens and the agent never learns about a new ancestor's conventions — or keeps following one it's no longer under** — present · The notice names the files to read and the projects to drop, and it also covers changes made while the watcher was down.
- **What would make it wrong: A loop or a missing parent makes the watcher spin, crash, or go quiet** — present · Loop guard, missing parent ends the chain, a vanished ancestor file isn't fatal, and the restart check is deterministic.
- **What would make it wrong: Anything changes for an agent whose project is top level** — present · No ancestor targets and no chain notice; own-project notices unchanged.
- **What would make it wrong: A raw edit shows up where a plain "your chain changed" belongs** — present · Parent lines are removed from diffs and reported only through the chain notice.

### Additions (in the result, not in the shape)

- The mid-session "you're now in project X" pointer also names the projects X sits inside and lists every chain file to read top-down — endorsed-as-drift (Ashley: "Agreed.")

### Follow-ups

None.

### Notes

The chain notice lists only new ancestors that have a project file, and it doesn't list their folders (the shape doesn't require that). The self-edit hook change is only a reworded comment. A new test script covers the shape's cases.

---

## Close-Out (re-check after code-review fixes)

**Closed:** 2026-10-17
**Overall verdict:** closed-hit

### Shape features (conformance)

- Every facet is present again: what this is, reading at load, nearer wins, broken chains, own-project and ancestor watching, chain notices, no self-echo silencing, guidance, philosophy, prior context, scope In and Out, and each failure mode. A periodic chain re-check now catches chain changes outside the watched files without watching any folder's contents.

### Additions (in the result, not in the shape)

- The mid-session "you're now in project X" pointer names X's chain and the files to read top-down — endorsed-as-drift (earlier close-out)
- Moving out of a sub-project, into another project or out of projects altogether, names the parent projects left so the agent drops their conventions. The guidance now says so too — endorsed-as-drift (Ashley: "Yes")

### Follow-ups

None.

### Notes

The settle wait, the per-project spill names and the hook comment are mechanism-only changes.
