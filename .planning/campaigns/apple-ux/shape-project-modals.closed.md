# Shape: the project window and the new-project dialog — siblings of the agent window

**Opened:** 2026-10-18
**Campaign:** apple-ux (shape 5 of 14)

## What this is

The project window (opened from a project's menu → Open project) is laid out like the agent window: what the project is sits on top, what it holds sits in tabs underneath. The new-project dialog (and its sub-project variant) becomes a short, plain form with Cancel and Create.

## Shape

**Project window — top**
- Close X only — no Close button at the foot.
- A folder tile in place of a picture (projects have no picture or colour).
- For a sub-project, a quiet line above the name with where it sits, top-level down, separated by "›" — "In SKYNET", or "In Morpheus 2 › M2 · Runs". Plain text, not clickable. A top-level project has no line.
- The project's name, large.
- A quiet count of what sits directly in it, as the sidebar shows it to this user: "2 conversations · 3 sub-projects" (the sub-project part only when there are some). Plain text.

**Tabs:** Project file, Files.

**Project file**
- Formatted reading of the file (without its settings block at the top).
- Foot: a read-aloud button on the left and **Edit** on the right; editing shows the file's text with **Cancel** and **Save** at the foot. Saving keeps the window open and returns to reading.
- Nothing written yet (the file holds only its settings block, or nothing): an empty state — "Nothing written yet", a line saying what the project file is for and that every agent in the project reads it when it starts, and a **Write it** button that opens the editor. No foot.

**Files** — the project folder's browser, as today (folders, search, upload, new, rename, download, delete, opening files; the project file hidden at the top level). An empty folder shows "No files yet" with a line saying every agent in the project can read what's put here.

**Unsaved edits:** leaving the editor with unsaved changes by any route (Cancel, Esc, X, switching tabs) asks "Discard your changes?" first. Esc in the editor leaves the editor; Esc while reading closes the window.

**New project dialog**
- Title "New project", with a short line under it on what a project is.
- **Name** field (focused).
- **Host**: a short list of the user's machines, tap one to tick it — only when there's more than one to choose from and the host isn't already fixed (as from a conversation's Move to → New project…). With one machine it's picked for you and not shown.
- Foot: **Cancel** and **Create** (enabled once there's a name and a host). Enter in the name field creates. Errors show in the dialog, which stays open.

**New sub-project dialog** — same, titled "New sub-project", with an "Inside <parent lineage>" line above the name, and no host (it lives with its parent).

**Phone:** both full screen; the same views.

## Philosophy

- What the project IS is on top; what it holds is in tabs — a sibling of the agent and roles windows.
- Reading comes first; editing is a deliberate step, the same as the agent file and role file.
- The plain facts on top (lineage, count) look like text, not controls.
- Apple's interfaces are the reference for behaviour; the look stays Skynet's (look A, kit parts only).
- Nothing either window does today is lost.

## Prior context

- Today: the window opens straight into an always-on editor with Save and Close at the foot and read-aloud in the header; tabs Project file / Files. The new-project dialog has a name, a searchable host picker and Create only.
- Tasting agreed with Ashley 2026-10-18 (`workspace/tastings/project/project-tasting.js` in the identity workspace, real SKYNET projects): "Nothing. This kicks ass."
- Window sizes are not settled here — shape-modal-sizing walks every modal at the end.

## What would make it wrong

- The window opens straight into the editor, or a Close button sits at the foot.
- The lineage or count line looks or behaves like a control, or a sub-project shows without its parents.
- An empty project file shows a blank editor or blank page instead of the empty state.
- Unsaved project-file edits vanish without asking.
- The new-project dialog asks for a host when there's only one, or when the host is already fixed, or a sub-project asks for one.
- Something either window could do is gone: read aloud, edit and save the project file, every Files action, creating a project on a chosen host, creating from Move to → New project… (then moving the conversation in), creating a sub-project.

## Scope edges

- In: the project window and both creation dialogs, phone and desktop; the id skill's description of them.
- Out: the project's menu in the sidebar (Rename, Move to, Archive — sidebar shape); window sizes (shape-modal-sizing).
- Tempting but no: renaming the project in the window (Rename lives on the menu); listing the project's conversations (the sidebar shows them); showing which machine the project is on; choosing a parent in the new-project dialog.

## Handoff notes

- Identity: copper-box-maintainer-2, local only on `feat/tab-title-from-tmux`, not pushed (campaign shipping rule).
- Follow the agent window's agent-file pattern (reading → Edit → Cancel/Save, edit baseline after first keypress) and its project-lineage helper.
- Non-admin-visible change → id skill edit (Project modal and new-project wording).

---

## Close-Out

**Closed:** 2026-10-18
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · project window laid out like the agent window; creation dialogs are short forms with Cancel and Create.
- **Project window — top** — present · X only, folder tile, quiet "In A › B" line for sub-projects only, large name, quiet count taken live from what the sidebar shows this user.
- **Tabs** — present · Project file and Files; opens on Project file.
- **Project file** — present · formatted reading without the settings block; read aloud left, Edit right; Cancel / Save while editing; Save returns to reading; empty state with Write it and no foot.
- **Files** — present · same browser, project file hidden at the top; empty top level says "No files yet".
- **Unsaved edits** — present · Cancel, Esc, X and tab switch all ask; Esc leaves the editor, Esc while reading closes.
- **New project dialog** — drifted (endorsed) · everything present; the machine choice keeps today's searchable picker (search box, online dots, user names) instead of a plain tick-list.
- **New sub-project dialog** — present · titled so, "Inside <full parent chain>", no host.
- **Phone** — drifted (endorsed) · project window full screen; the two creation dialogs are the kit's bottom sheet, like every short dialog since the foundation.
- **Philosophy** — present · reading first, plain-text facts, kit parts only, nothing lost.
- **Prior context** — present · always-on editor, foot Close and header read-aloud gone; dialog gained Cancel.
- **Scope edges** — present · no rename in the window, no conversation list, no machine shown, no parent chooser.
- **Handoff notes** — present · agent-file pattern and lineage helper followed; id skill updated.
- **What would make it wrong: window opens straight into the editor, or a Close button at the foot** — present · opens on reading; no foot Close.
- **What would make it wrong: lineage or count looks like a control, or a sub-project shows without its parents** — present · plain text, full chain.
- **What would make it wrong: an empty project file shows a blank editor or page** — present · empty state with Write it.
- **What would make it wrong: unsaved edits vanish without asking** — present · every route asks.
- **What would make it wrong: dialog asks for a host when there's one, when fixed, or for a sub-project** — present · hidden in all three.
- **What would make it wrong: something either window could do is gone** — present · read aloud, edit/save, every Files action, chosen host, Move to → New project…, sub-project all wired.

### Additions (in the result, not in the shape)

- Machine choice keeps a search box, online dots and user names (today's picker, same as the new-role dialog) — endorsed-as-drift

### Follow-ups

- Phone creation dialogs are a bottom sheet rather than full screen — accepted-as-drift (revisit in shape-modal-sizing if wanted)

### Notes

An empty project's count reads "0 conversations". The host help line, Files intro line and the "Inside" panel are word for word from the agreed tasting.
