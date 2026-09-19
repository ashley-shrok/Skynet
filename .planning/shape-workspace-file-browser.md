# Shape: workspace file browser

**Opened:** 2026-09-19
**Vehicle:** gsd phase

## What this is

A file-management surface embedded in the chat app that lets a user browse the working folder of whichever agent they are chatting with, no matter which host that agent lives on. Recursive tree, full ownership — read, edit, create, delete, rename, upload, download. Reached through the same modal that opens when the user clicks the agent's badge; appears as an additional section alongside the sections already in that modal.

The point of it existing at all: without it, the only way to see or change what is in an agent's working folder is to ask the agent to do it. A real file manager beats a conversation for that class of task.

## Shape

Opened via the agent's badge in the chat surround. The modal that appears has section tabs along the bottom edge; the workspace joins them as one more tab. Selecting it fills the modal body with the file view: a breadcrumb along the top, a column-labeled list of files and folders below, a toolbar with the usual actions (upload, new folder, new file). Clicking a folder descends into it. Clicking a text or markdown file swaps the whole tab body from list-mode to viewer-mode, with a back affordance to return to browsing — no second modal ever appears on top of this one. Clicking an image swaps in the same way, showing the image large. Right-click (or the hover-visible overflow) gives the per-row action menu.

The workspace lives on whichever host the agent lives on. The user does not have to think about that — the modal reads the workspace off the host transparently. Errors surface as banners at the top of the tab body when a specific operation fails; the tab header does NOT carry a persistent host chip (was in the pre-implementation shape, removed post-UAT — the enclosing modal already identifies the agent, so the chip was redundant chrome).

Every mutation the user makes reaches the filesystem directly. No signal is sent to the agent that the user did something. The next time the agent looks at its own working folder, it discovers the change.

The view is a snapshot. If the agent writes something while the tab is open, the user does not see it appear — a refresh button in the toolbar re-fetches on demand.

## Philosophy

**It is a plain file manager, not a co-pilot for one.** The stance is: give the user a familiar direct-manipulation surface into a folder, and get out of the way. Consumer-user register — the audience does not know what a shell is, and their fallback if this feels bad is "ask the agent," not a terminal. So obvious buttons, plain-English error copy, no jargon. Common needs must be present and unfussy; power-user affordances (multi-select, keyboard nav, search, syntax highlighting, git-diff, bulk operations, image thumbnails-in-list) are deliberately absent — not hidden behind a menu but simply not built.

**Direct, blind, trusting.** The user is treated as the owner of the folder — no confirmation prompts on ordinary actions, no rails against destructive ones beyond a single "are you sure" on any delete. No permission layer of its own: access rides on the existing per-host access model already in the app — if you can chat with the agent, you can browse its workspace.

**No modal stacking.** The app's existing convention is that a modal-inside-a-modal never happens — a new modal replaces the current one. The workspace preserves that convention even for the "open a file" action by swapping the tab body in place rather than layering a second modal on top. This is load-bearing to the stance — modal stacking is exactly the complexity that would make the surface feel technical instead of consumer.

**Reuse over reinvention.** The text-editing view, the markdown editor, and the modal chrome are all things the app already has. This feature contributes the surface + the wire path to the workspace on the host, and mounts existing pieces inside it.

## Prior context

The chat app already has a modal that opens when a user clicks an agent's identity badge. That modal is already section-tabbed along its bottom edge, currently carrying two or three sections about the agent depending on the user's role. The pattern for adding one more section is well established.

The app already has a modal for editing text files and a modal for editing markdown, both used elsewhere. It has a pattern for reaching over the network from the browser to a host that the app manages, with a full error-classification system for the failure modes (host unreachable, path forbidden, file too large, permission denied, and so on). This feature stands on that plumbing rather than inventing new plumbing.

The app is multi-tenant. Each user has some set of hosts assigned to them; agents live on hosts; access to an agent flows from access to the host it lives on. Nothing in this feature adds a new authorization concept.

A prototype was built during shaping and iterated with the user to lock the direction. The visual chrome was sampled from the app's existing surfaces so the taste-test would be faithful. The implementing agent should walk through it before drafting the plan — it is the settled visual and interaction target.

## What would make it wrong

- **The user opens it to do something normal and cannot do it.** They wanted to grab a file and download it, upload a new one, quickly fix a config — and one of those turns out to be a step they can't take without leaving the app. This is the failure mode the user explicitly named. The V1 surface must be complete enough for the ordinary needs, not just skeletal.
- **The user opens a file to look at it and loses the folder they were in.** If getting back to browsing requires reopening the modal and re-navigating to where they were, the surface has failed the "see what the agent is up to" use case that motivates it in the first place. This is exactly what the inline-swap-in-tab decision exists to prevent.
- **The surface feels like a developer tool.** Any element that requires knowing what a dotfile is, or a repo is, or a shell is, is a sign that the register drifted away from consumer. Error copy that names shell errors or file-mode octals or ambient developer jargon has drifted.
- **It leaks agent-vs-user causality.** The stance is blind — the agent is not told about user actions. If some code path ends up notifying the agent that the user just did something, the abstraction has broken. (Design-time constraint on how mutations flow, not something the user would ever perceive.)
- **Modal-on-modal ever appears.** If opening a file (or any workspace action) ever puts a second modal on top of the identity modal, the app's one-modal convention has been broken specifically for this feature — precisely what the inline-swap pattern exists to avoid.

## Scope edges

**In for V1:**
- Recursive browsing, one folder at a time, breadcrumb navigation.
- Column-based sortable list (name, size, modified) — sort applies within folder and file groups; folders stay above files.
- Upload via toolbar button and via drag-and-drop into the folder area.
- Create new folder, create new empty file.
- Rename, delete (both with a confirmation), download.
- Open text files and markdown files inline (tab-body swap), edit and save through the existing editors. Files with no extension (dotfiles like `.gitignore`, capitalised sentinels like `LICENSE`/`Makefile`/`Dockerfile`) open in the text editor too — treating them as binary would leave everyday config files unreachable.
- Confirm before discarding unsaved edits — hitting Back from an edited file (or navigating away) prompts once ("Discard unsaved changes?") rather than silently dropping the edit.
- Open image files inline (view-only, larger view of the image).
- Manual refresh button in the toolbar.

**Deliberately out (not built unless a real need surfaces later):**
- Search (name-based or content-based).
- Multi-select and bulk operations.
- Keyboard navigation beyond what browsers give for free.
- Syntax highlighting inside the text editor.
- Image thumbnails inline in the list (view-on-click covers the need).
- Copy/paste or drag-to-move across folders.
- Any git-aware view (diff, history, status).
- Folder-as-zip download.
- File counts on folder rows.
- Live subscription — no auto-refresh, no polling, no persistent connection. Manual refresh only.
- Hidden-file filtering. All files are shown; no smart "hide dotfiles" toggle, no ignore-list.

**Explicitly not part of this feature ever, because it violates the stance:**
- Any notification to the agent that the user acted. Blind is load-bearing.
- Any protected-path or protected-file logic that refuses to let the user delete something. A single generic confirm is the ceiling of "rails."
- Any second modal opened on top of the identity modal from within this feature.

## Vehicle notes

**Vehicle:** single GSD phase. Backend and frontend both — a workspace CRUD wire surface reaching the identity's working folder on whichever host the agent lives on, and a new section tab in the identity modal that consumes it. Splitting into two phases was considered and rejected: the wire contract couples them tightly, the total surface is modest, and there is no peer-parallelism gain because container mutations serialize at deploy anyway.

The implementing identity is a box-maintainer. The Skynet repo tree lives at the identity's own workspace path. The bounty carrying this arc lives at `~/fleet/roles/box-maintainer/bounties/workspace-file-browser/`. The prototype used during shaping is in that bounty folder — the implementer should walk through it before drafting the plan; it reflects the settled visual and interaction target down to the modal chrome, list style, sortable columns, drag-drop upload zone, and inline-swap file view.

Existing code the phase leans on: the modal that opens from the identity badge and its section-tab pattern, the text-file editor, the markdown editor, and the network path already used elsewhere to reach files on managed hosts with its error-classification system. This feature adds one new section-tab consumer and one new workspace-CRUD surface on top of that existing plumbing.

The `/close workspace-file-browser` call at the end of the build arc reads this file back and verifies the built result matches the agreement both ways.
