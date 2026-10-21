# Shape: project support for scheduled tasks

**Opened:** 2026-10-21

## What this is

A scheduled task can be given a project. Every conversation the task starts is
then born already filed in that project, so a project's recurring work files
itself instead of landing in the Conversations list. You set the project in the
scheduled tasks modal (the clock icon), and that modal is the only place this
shows up.

## Shape

- **The project choice in the task form.** Creating or editing a task now
  includes a Project choice. It starts at "No project" and lists every project
  on the task's machine, with sub-projects indented under their parents as in
  the sidebar. Switching the task's machine clears the choice back to "No
  project".
- **Filing at fire time.** When a task with a project fires, the conversation
  it starts is born in that project: shown only there, not in Conversations,
  not pinned. Its title keeps its leading ⏰ (or 📡). This covers every
  conversation a task starts: clock fires, sensor fires, and the
  "sensor broken" conversation.
- **The project on the clock list row.** Each task row shows its project as the
  full path from the top-level project down (for example "SKYNET › later"), so
  same-named sub-projects can't be confused.
- **A missing project.** At fire time the scheduler checks that the project
  still exists. If it doesn't, the conversation goes to Conversations as it
  would without a project, and the task keeps firing. The task keeps pointing at
  the missing project: its row says the project is missing, and its form shows
  that project as the current pick, marked missing. If the project comes back
  (for example, it's un-archived), filing resumes on its own.

## Philosophy

- A task's project only decides where its conversations are filed. It changes
  nothing about who can see them or what they do.
- Nothing depends on who is looking. Everyone who can see a task sees the same
  project list and the same project name.
- A missing project never stops a task from running. One unfiled conversation
  costs less than a missed run.
- Tasks with no project behave exactly as they do today.

## Prior context

Today a scheduled task has no idea projects exist; every conversation it starts
lands in Conversations and has to be filed by hand. The way new conversations
get born already supports starting one inside a project (agents use it when they
spawn peers), but the scheduler never passes a project. When a conversation is
born pointing at a project that no longer exists, nothing stops it, which is
why the scheduler has to check at fire time.

## What would make it wrong

- A task stops firing, or fails to fire, because its project is gone.
- A conversation is born pointing at a project that doesn't exist and ends up
  in a broken in-between state instead of Conversations.
- Saving an unrelated edit to a task silently clears or changes its project.
- Changing a task's project moves conversations it started earlier.
- Existing tasks with no project change behavior.
- Showing or hiding projects or project names differently depending on the
  user.

## Scope edges

- **In:** the Project choice in the task form, filing at fire time for every
  kind of fire, the project path on the clock list row, missing-project
  handling, and the matching update to the guide every agent reads about the
  app.
- **Out:** a "new scheduled task" entry in the project header menu; listing a
  project's tasks in the project modal or the sidebar; filing into Pinned;
  choosing a project per run; moving earlier conversations when the project
  changes; any per-user project visibility handling.

## Handoff notes

- Implementer: ridley-box-maintainer-2, in-session, on the shared branch.
- The scheduler is substrate code, so it reaches the fleet through the
  distributor, not hand edits.
- The agent-facing app guide must describe the new Project choice and row path
  in the same change.
- Close with `/close scheduled-task-projects`.

---

## Close-Out

**Closed:** 2026-10-21
**Overall verdict:** closed-hit

### Shape features (conformance)

- **Project choice in the task form** — present · Create and edit show a Project dropdown, starting at "No project", listing the machine's projects in sidebar order with sub-projects indented; switching machine clears it.
- **Filing at fire time (clock, sensor, sensor-broken)** — present · Every kind of fire adds the project only while it exists; the ⏰ / 📡 title marks are unchanged.
- **Project path on the clock list row** — present · The row chip shows the full top-down path joined with ›.
- **Missing project: still fires, goes to Conversations** — present · Checked at every fire; a gone project is left off and the fire goes ahead.
- **Missing project: task keeps pointing at it; row says missing** — present · The stored project is kept; the row shows "Project missing".
- **Missing project: form shows it as the current pick, marked missing** — present · Kept selected as "(missing)" with an explanatory line.
- **Missing project: filing resumes when it comes back** — present · Per-fire check plus kept slug.
- **What would make it wrong: task stops firing because its project is gone** — present · Guarded.
- **What would make it wrong: conversation born pointing at a nonexistent project** — present · Guarded for scheduled fires and Run now.
- **What would make it wrong: unrelated edit clears or changes the project** — present · Form sends the saved project back, even when missing or unreadable.
- **What would make it wrong: changing the project moves earlier conversations** — present · Nothing touches existing conversations.
- **What would make it wrong: tasks with no project change behavior** — present · Request built exactly as before; no chip.
- **What would make it wrong: projects shown differently per user** — present · Both list and path read projects unfiltered.
- **Matching update to the agent-facing app guide** — present · Dropdown, reset, chips, missing handling and fire-time check described.
- **Out-of-scope items absent** — present · No header-menu entry, no project-modal/sidebar listing, no Pinned, no per-run choice, no moving, no per-user handling.
- **Handoff: scheduler reaches the fleet via the distributor** — cannot-verify · Rollout, not build; change is in the distributed source.

### Additions (in the result, not in the shape)

- Run now also files into the project with the same missing check — endorsed-as-drift (covered by "every conversation a task starts").
- Presentation details: folder icon, green/amber chip colors, hover text, helper line under the dropdown, "Pick a host first", scheduler log line — endorsed-as-drift.

### Follow-ups

None.

### Notes

No divergence questions. Planning documents in the commit are process artifacts.
