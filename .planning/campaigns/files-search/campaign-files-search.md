# Campaign: a search box in the Files tab that finds things in subfolders too

**Opened:** 2026-10-14
**Status:** in_progress
**Workspace:** .planning/campaigns/files-search/

## Concept

The Files tab — the same file browser in the agent, role, and project modals — gets a search box. Typing in it searches the folder you're in and everything beneath it, by file and folder name. Results replace the normal listing; each shows its name and the folder it sits in. Clicking a file opens it in the usual viewer; clicking a folder takes you into it and clears the search; results carry the same row menu as normal rows. Clearing the box restores the normal listing.

## Success criteria

- A file a few folders deep can be found by typing part of its name, without browsing to it.
- Search stays quick and bounded on big workspaces (e.g. one holding a full code repo): bulky folders are skipped, and depth, result count, and time are capped — and when a cap cuts results short, the screen says so rather than silently hiding the rest.
- Works the same in all three modals (agent, role, project).
- Things deliberately hidden from the listing today (the role's own file in the role modal, project.md in the project modal) stay hidden in results.
- The agent-facing instructions (id skill) describe it, so agents can tell the user about it.

## Shapes

- **[declared] shape-files-search** — name search across the folder tree from the current folder, as-you-type, results with full row behavior — closed

## Other work

- On a phone, a deep folder path squeezes the breadcrumb into a tall narrow column beside the toolbar buttons (existing layout; search makes deep jumps common, so it shows up more) — pending user decision

## Lingerers (explicitly approved)

## Open questions
