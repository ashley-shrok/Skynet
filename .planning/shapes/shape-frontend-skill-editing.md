# Shape: skill editing on the front end, like is already available for the global files

**Opened:** 2026-08-18
**Vehicle:** GSD phase

## What this is

An editor surface for the skill files that live on a host, reached the same way the existing global-files editor is reached. From the same menu, you pick a host, then you pick which of that host's skills you want to work on, then you see the files inside that skill as a row of tabs and can edit them, delete them, add new files, or delete the whole skill. It behaves as a plain file editor on the host's disk — it does not know or care about how skills are distributed or self-updated between hosts.

## Shape

Two selectors at the top of the modal: the existing host dropdown that global files already has, and next to it a new skill dropdown that populates from whichever host is picked. Beneath, the same bottom-tab pattern the global-files editor uses today, but now each tab is a file inside the picked skill.

Files are listed flat regardless of any subfolders inside the skill — a file that lives in a subfolder shows up as a tab whose label is the path relative to the skill's root, so its location is still legible in the label. If a skill has more tabs than the tab bar can show, the tab bar becomes horizontally scrollable as a fallback. In practice this is expected to be rare.

Each tab opens into the same editor pane as global files. Text files are editable. Non-text files still appear as tabs — they aren't hidden — but where the editor would be, a placeholder says the file isn't text and cannot be edited.

Alongside editing: a way to add a new file to the currently-open skill, a way to delete a file (with a confirmation prompt), and a way to delete the currently-open skill. Adding a brand-new skill from scratch is out of scope for this cut.

## Philosophy

This is a plain file editor for a specific class of folder on a host — nothing more.

It deliberately does not know anything about how skills are distributed, self-updated, or synchronized between hosts. Some skills fetch a fresh copy from a central server every time they run; the editor is unaware of that and shouldn't care. If an edit gets overwritten later by a self-update, that is not this feature's problem. Same principle for any other lifecycle concern: this feature edits files where they are, on the host they're on.

It also deliberately isn't a file manager. It doesn't browse a host's entire filesystem, it doesn't move files between skills, it doesn't rename anything. It's scoped to "pick a skill, work on its files."

There are no protected files. If a file is visible in the tab bar, it's deletable (with a confirm). If a skill is visible in the skill dropdown, it's deletable. The user is trusted to know what she's touching; the editor's job is to be a fast tool, not a safety harness.

## Prior context

The global-files editor already exists on this frontend and is reached from a specific menu. That editor's shape — a modal with a host dropdown at the top and a row of file tabs at the bottom — is the direct model for this feature. This new surface is meant to sit as a sibling entry in the same menu, reuse the same modal chrome, and reuse the same editor pane. Almost nothing about the modal's look-and-feel is fresh design; the fresh work is the added skill dropdown and the fact that the tab bar's content is now scoped to a picked skill instead of a global set of files.

The trigger that motivates this is: making a quick adjustment to a skill on a host without leaving the frontend. That framing keeps the priority on a fast path from "I want to edit this skill" to "I'm editing this skill" — three selections at most (menu → host → skill), then a file tab.

## What would make it wrong

The user did not have a strong intuition for what shape of failure would sour her on this feature. The one implicit failure mode that follows from the "quick adjustment" trigger: any friction on the fast path — the modal taking a long time to enumerate skills on a host, the file list not opening promptly after picking a skill, edits not saving cleanly — undermines the whole reason for having it. Beyond that, no explicit failure modes were named.

## Scope edges

**In:**
- Pick a host (existing dropdown) → pick a skill (new dropdown) → see its files as tabs.
- Edit any text file inside the skill.
- View any non-text file, with a placeholder in place of the editor pane saying it isn't a text file.
- Add a new file to the currently-open skill.
- Delete a file inside the skill, with a confirmation prompt.
- Delete the currently-open skill.
- Files inside a skill's subfolders show up as flat tabs with path-relative labels.
- Fallback for many-tabs case: horizontal scroll on the tab bar.

**Out:**
- Creating a brand-new skill from scratch.
- Renaming skills or files.
- Moving files between skills.
- Any behavior tied to skill distribution or self-update.
- A tree view, drill-down navigation, or any richer intra-skill navigation than a flat tab bar.
- Guards on any specific file (no "you can't delete this one" logic).

**Deferred (tempting but no):**
- A richer navigation UI for skills with many nested files, beyond horizontal scroll.
- Pushing edits back to a source-of-truth host for distributed skills.

## Vehicle notes

Chosen vehicle: a full GSD phase. The feature is multi-step across both the backend (endpoints that enumerate skills on a host, enumerate files inside a skill, and read / write / create / delete those files) and the frontend (new menu entry alongside the global-files entry, skill dropdown alongside the host dropdown, tab bar populated per-skill, delete confirmations, new-file affordance, non-text placeholder). It's phase-shaped in size, so a phase entry is table stakes.

Handoff notes for the implementing agent:
- This is being done by identity `tiffany` at `~/skynet-tiffany/` on the `feat/tab-title-from-tmux` branch, per the box-maintainer directives.
- Reuse the existing global-files editor modal's chrome, host dropdown, tab bar, and editor pane. The skill dropdown is the one new top-level selector; the tab bar's contents are the one new fill-in.
- Tests should exercise the full user flow: pick host, pick skill, open a text tab, edit and save, open a non-text tab and see the placeholder, add a new file, delete a file (with confirm), delete a skill.
- Deploy handoff: as with all Skynet phases here, executor stops at code + commit + tests green. Container mutation (build + recreate) is orchestrator-managed with the coord-room BEFORE/AFTER post protocol.

`/close frontend-skill-editing` is how this arc closes at the end.
