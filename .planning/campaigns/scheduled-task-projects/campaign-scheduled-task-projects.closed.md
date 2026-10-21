# Campaign: project support for scheduled tasks

**Opened:** 2026-10-21
**Status:** closed
**Closed:** 2026-10-21 — single shape closed; committed and pushed, deploy pending a separate greenlight.
**Workspace:** .planning/campaigns/scheduled-task-projects/

## Concept

A scheduled task can belong to a project, and every conversation it starts is
born inside that project, so a project's recurring work files itself instead of
piling up in the Conversations list. The whole interface for this lives in the
scheduled tasks modal (the clock icon): no project-header menu entry, and no
listing of tasks inside the project modal.

## Success criteria

- In the scheduled tasks modal, a task can be given a project, changed to a
  different one, or cleared, when creating or editing it.
- Each conversation a task with a project starts appears in that project from
  birth, with no manual filing.
- Tasks without a project behave exactly as they do today.
- A task whose project has gone away keeps running; its conversations land in
  Conversations, and the modal shows that the project is missing.

## Shapes

- **[declared] shape-scheduled-task-projects**: project picker in the
  scheduled tasks modal, plus the scheduler placing each conversation it starts
  into the project. Status: closed.

## Other work

## Lingerers (explicitly approved)

## Open questions
