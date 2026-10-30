# Shape: "Shared with" on apps and scheduled tasks

**Opened:** 2026-10-30

## What this is

The second half of the sharing campaign. On a machine several people use, an
app in the sidebar and a scheduled task can each be limited to some of those
people, but today that list can only be seen or changed by editing the file on
disk. This puts the same "Shared with" control the agent, role and project
windows got in the first piece onto apps (a "Share…" item in the app's menu,
opening the list in a small window) and onto scheduled tasks (a "Shared with"
field under Project). It also settles who the conversations a task starts are
shared with.

## Shape

- **Apps.** A "Share…" item in an app's menu, wherever that menu appears: the
  sidebar icon and the bar over an open app. It opens a small window holding
  the same ticked list of everyone on the machine (you marked "you"). Only
  sidebar apps have it; an app an agent made for one conversation goes with
  its conversation and has no Share item. An app has a single list with
  nothing behind it, so there is no "share the role too" offer and nothing
  else is shared along with it.
- **Scheduled tasks — an existing task.** A "Shared with" field under Project
  in the task's view: the same button and list. Changes save straight away,
  the way the list does in every other window, and do not wait for the task's
  Save. Ticking someone on a task whose role is hidden from them offers to
  share the role too ("Share the Painter role with bo too?"), the same as on
  an agent, because otherwise every conversation the task starts would be
  hidden from them.
- **Scheduled tasks — a new task.** The same field in the new-task form,
  starting at "Everyone on this machine" (what a new task gets today). The
  choice is applied when the task is created.
- **Conversations a task starts.**
  - A limited task's conversations start shared with the task's people. This
    holds even when the task is filed in a limited project; anyone the
    project hides from sees the conversation in their Conversations section.
  - A task with no list, filed in a limited project, starts its
    conversations shared with that project's people (the same rule as an
    agent made inside a limited project).
  - A task with no list and no limited project starts conversations visible
    to everyone, as today.
  - A task with no roles follows the same rules — its conversations follow
    the task, not "private to its maker", since no person starts them.
  - Changing a task's list affects only conversations it starts from then on;
    ones it already started keep their own list and their own Shared with
    button.
- Everything else the control does carries over from the first piece: the
  last person can't be unticked, taking yourself off warns first, people no
  longer on the machine show greyed out, and machines with one person show
  none of this.

## Philosophy

Same control, same behaviour, everywhere — someone who has used it on an
agent already knows how it works on an app or a task. A task's list is the
most specific statement of who its conversations are for, so it wins over the
project's. The control tells who can see a thing from inside the thing; list
rows and app icons stay as they are.

## Prior context

- The first piece (closed) built the control, the "share the role too"
  offer, the born-inside-a-project rule, and the changes-as-add-or-remove
  rule so two people editing at once don't overwrite each other.
- Apps and scheduled tasks each already have their own single list on disk;
  an empty or missing list means everyone. The task window today keeps an
  on-disk list intact when saving but never shows it.
- Conversations a limited task starts already take on the task's list; a
  task with no list in a limited project currently starts open conversations.

## What would make it wrong

- Someone is shared on a task, but its conversations stay hidden from them
  because its role hides them, and nothing said so.
- Saving the task's other fields quietly undoes a sharing change, or a sharing
  change throws away unsaved edits to the rest of the task.
- A conversation app gets its own Share item, or an app shares anything beyond
  itself.
- Changing a task's list silently rewrites conversations it already started.
- A single-user machine shows any of this.
- The control looks or behaves differently here than in the agent, role and
  project windows.

## Scope edges

- **In:** the Share… item and window for sidebar apps; the Shared with field
  on existing and new scheduled tasks, with the share-the-role-too offer; who
  a task's conversations are shared with as described above; a brief mention
  in the agent guide.
- **Out:** conversation apps; a marker on task list rows or app icons;
  re-sharing conversations a task already started; changing who can see
  anything that isn't an app or a task.
- **Deferred to campaign close:** the What's-new note for the whole feature,
  the single deploy, the hand-off.

## Handoff notes

- Reuse the first piece's control, plan logic and route; this extends the kinds
  it handles to app and task. Closed shape:
  `.planning/shape-sharing-agents-roles-projects.closed.md`.
- Finish at committed, not pushed, not deployed (campaign rule).

---

## Close-Out

**Closed:** 2026-10-30
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · Share… on sidebar apps opens a small window with the ticked list; scheduled tasks have a Shared with field in the task view and the new-task form; who a task's conversations are shared with is settled when it fires.
- **Shape: Apps** — present · in the sidebar app's menu and the open app's bar menu, only on a multi-user machine and never for conversation apps; the change writes only the app.
- **Shape: Scheduled tasks — an existing task** — present · saves at once outside Save; the share-the-role-too offer is worded for the task's conversations; a line says when a role hides them.
- **Shape: Scheduled tasks — a new task** — present · starts at Everyone on this machine, written on Create; anyone the task's role hides is offered the role right after Create.
- **Shape: Conversations a task starts** — present · the task's list wins; no list in a limited project → the project's people; otherwise open; roleless follows the same; existing conversations untouched.
- **Shape: carries over from the first piece** — present after fix · the new-task form had no warning when you untick yourself; the user asked for it and it was added ("Leave yourself off?").
- **Philosophy** — present · same control everywhere; list rows and app icons unchanged.
- **Prior context** — present · builds on the first piece; a task's Save keeps the on-disk list and queues behind a sharing change.
- **What would make it wrong: shared on a task but its role hides its conversations, unexplained** — present · offered on tick and after Create; explained on the person's line.
- **What would make it wrong: Save undoes a sharing change, or a sharing change discards unsaved edits** — present.
- **What would make it wrong: a conversation app gets Share, or an app shares more than itself** — present.
- **What would make it wrong: changing a task's list rewrites conversations it already started** — present.
- **What would make it wrong: a single-user machine shows any of this** — present.
- **What would make it wrong: the control differs from the agent, role and project windows** — present after fix (same warning on the new-task form).
- **Scope edges** — present · nothing Out was built; What's-new, deploy and hand-off left for campaign close.

### Additions (in the result, not in the shape)

- Two earlier planning notes had personal and machine names replaced with "the user" and generic examples (the repo's no-personal-names check was failing on them) — endorsed-as-drift (the user: "Yes, keep them out").

### Follow-ups

None.

### Notes

Small wording that comes with the agreed features: the hint under the task field ("Conversations it starts are shared with the same people."), the app window's line ("Who sees this app in their sidebar."), and the take-yourself-off confirm saying a task leaves your scheduled tasks.

### Addendum — after the code review (2026-10-30)

- A task's Save and a sharing change now queue on the same lock across
  everyone's own copy of the machine, so a Save by one person can't undo
  another person's tick.
- If a task with no list is filed in a limited project and that project
  can't be read when the task fires, the run is refused with a failure
  saying who-should-see-it couldn't be read, rather than starting a
  conversation visible to everyone. (Tightens the agreed "project's people"
  rule; no other change in what's shared.) The same applies to an agent's
  spawn request filed in a project.
- A new task's people are checked only after the machine check, so nobody
  learns who uses a machine they haven't added.
- A creator who leaves themselves off a new task doesn't see it appear in
  their list.
- Agent-side check, read-only on a real two-person machine: every sidebar app
  and scheduled task read correctly; planning a task share with someone its
  role hides offered "Share both"; an app share wrote only the app.
