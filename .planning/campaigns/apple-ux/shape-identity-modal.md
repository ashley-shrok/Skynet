# Shape: the agent window — who the agent is on top, its wake-ups and git one level deeper in the same window

**Opened:** 2026-10-18
**Campaign:** apple-ux (shape 4 of 14)

## What this is

The agent's own window (opened from the task pill) is laid out as a sibling of the roles window. Who the agent is sits at the top: picture, name, roles, task, where it sits among projects, and its voice. What it's made of sits underneath in tabs: agent file, wake-ups, files, git, desktop. A wake-up, a new wake-up, a repo and a diff each open one level deeper inside the same window with a back control, instead of expanding inline or stacking a second window.

## Shape

**Top (every tab but Desktop)**
- Close X only — no Close button at the foot.
- Large picture (the agent's avatar, or its initial on its colour; grey for an agent with no roles and no colour). Not uploadable.
- Name.
- Roles line: every role the agent holds as a link, comma-separated; each opens the roles window on that role, and closing the roles window comes back to the agent's window. No roles → no roles line.
- Task line: the task text (faded italic "No task set" when empty) with a small pencil; clicking edits in place (Enter or clicking away saves, Esc cancels).
- Project line, quiet: where the agent sits among projects, top-level down, separated by "›" — "In SKYNET", or "In Morpheus 2 › M2 · Runs" for a sub-project. Plain text, not clickable. No host on it. Not in a project → no line.
- One cosmetic button: **Voice** (the voice name, or "Role's voice" when inheriting) — opens today's voice list in a pop-over.

**Tabs:** Agent file, Wake-ups, Files, plus Git when the workspace holds a repo and Desktop while the desktop runs (as today). No counts on tabs. The task pill's round buttons still open straight onto Desktop or Git.

**Agent file** — formatted reading with an **Edit** button at the foot; editing shows the text with Cancel and Save.

**Wake-ups**
- A short note on what wake-ups are (instructions that wake this agent on a clock or when a sensor sees something; they go when the agent is archived).
- A grouped list. Each row: a small icon for its kind (clock / sensor / one-time), name, then its schedule and "Last fired …" / "Never fired"; sensor rows show "Sensor" (or "Sensor · once"), the status chip and "N waiting" when held. An on/off switch on the row (saves at once) and a chevron. Off rows are dimmed.
- **New wake-up** under the list; an empty list shows an empty state with the explanation and the button (coordinators keep today's behaviour).
- The list keeps re-reading itself while showing, as today.

**Wake-up view (one level deeper)**
- Header: "‹ <agent name>", the wake-up's name with "Wake-up" under it, close.
- An **On** switch row (saves at once) with "Next: …" and "Last fired …" under it.
- Name (read-only, says it can't be changed).
- **When:** the schedule kinds as a segmented control (Daily / Weekly / Monthly / Yearly / Every… / Once) and every per-kind field today's editor has — times (add a time), days, every-N, window, start, ends — plus the time-zone note.
- Sensor wake-up: "When its sensor fires" (", once, then it retires" for a one-time sensor) and the sensor's details as a read-only list (status, how it runs, last ran / running since, last fired, waiting fires, last error lines when broken) instead of schedule fields.
- **Instruction.**
- A red **Delete wake-up…** at the bottom (in-app confirm).
- Foot: Cancel and Save (Save enabled once something changed).

**New wake-up view** — same form, blank, no On row and no delete; the name is editable; foot Cancel and Create (enabled once name, instruction and a valid schedule are set). Creating returns to the list.

**Files** — the workspace browser, in the same layout as the role's Files tab; everything it does today stays (folders, search, upload, new, rename, download, delete, opening files).

**Git**
- One repo: straight into it. Several repos: a list of repos first (branch, ahead/behind, changes), each one level deeper.
- Inside a repo: a summary card (repo, branch, how many commits aren't pushed / behind, refresh, check remote), then **Changes**, then **History**. Tapping a changed file or a commit goes one level deeper to its diff (a commit shows its files first). Everything else today's tab shows stays (stashes, remotes). Read-only.

**Desktop** — the window grows as today; the top shrinks to a small picture and the name so the desktop gets the room; under the desktop a quiet line ("View only — the agent is driving" / "You have the mouse and keyboard…") and **Take control** / **Hand back to agent**. Esc goes to the desktop while you hold it.

**Back / Esc / unsaved edits:** the back control and Esc go up exactly one level; Esc on the top level closes. Leaving the agent file editor or a wake-up with unsaved changes by any route (back, Esc, X, switching tabs) asks "Discard your changes?" first.

**Phone:** full screen; tabs scroll sideways; the same views.

## Philosophy

- What the agent IS is on top; what it's made of is in tabs; one item's detail is one level deeper in the same window — never a second window on top.
- The plain facts (roles, task, project line) are visibly separate from the one cosmetic control (voice).
- Apple's interfaces are the reference for behaviour; the look stays Skynet's (look A, kit parts only), a sibling of the skills and roles windows.
- Nothing the window does today is lost.

## Prior context

- Today: avatar, name, role links, task line with pencil, a voice chip in the corner; tabs Agent file / Wake-ups / Files (+ Git, Desktop); a Close button at the foot. Wake-ups expand inline to edit; "Add wakeup" stacks a second window.
- Tasting agreed with Ashley 2026-10-18 (`workspace/tastings/agent/agent-tasting.js` in the identity workspace, Copper's real data, stand-in wake-ups). Her one change: the "On Skynet · in SKYNET" line becomes the project lineage only, no host. Wake-ups one level deeper and the smaller top on Desktop were taken as tasted.
- Window sizes are not settled here (except Desktop growing, as today) — shape-modal-sizing walks every modal at the end.

## What would make it wrong

- Adding or editing a wake-up opens a second window, or back/Esc lands anywhere but one level up.
- The host shows on the project line, or a sub-project shows without its parents.
- Voice sits back in a corner chip, or the project line looks like a control.
- A Close button reappears at the foot.
- Flipping a wake-up's switch needs a Save, or unsaved form edits vanish without asking.
- Something the window could do is gone: task edit, voice, agent file edit, wake-up on/off / edit / delete / create with every schedule kind and option, sensor details and states, coordinator handling, file browsing/search/upload/new/rename/delete, any Git view (repo list, changes, history, diffs, stashes, remotes, check remote), desktop view and take control, the task pill's jump to Desktop/Git, the jump to roles.

## Scope edges

- In: the agent window and every view inside it, phone and desktop; the id skill's description of it.
- Out: the task pill and its menu (conversation view shape); the roles window (done); the scheduled-tasks editor (its own shape, even though it shares the schedule fields); window sizes (shape-modal-sizing).
- Tempting but no: agent picture upload (retired), renaming the agent here (Rename… lives on the pill), a ⋯ menu with archive/move.

## Handoff notes

- Identity: copper-box-maintainer-2, local only on `feat/tab-title-from-tmux`, not pushed (campaign shipping rule).
- Follow the roles window's build as the pattern (one window with views and a back control); the schedule fields are shared with the scheduled-tasks editor — change their layout without changing that editor's behaviour.
- Non-admin-visible change → id skill edit (agent window section and the wake-up wording).
