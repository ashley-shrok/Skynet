# Shape: the roles window — one window for every role, each role on its own, runbooks one step deeper

**Opened:** 2026-10-18
**Campaign:** apple-ux (shape 3 of 14)

## What this is

The roles list, the role modal, the new-role dialog and the runbook editor become **one window** that moves between views with a back control, the way the redesigned skills modal does. A **library** of roles leads into a **role's own view** (picture, name, a real one-line description, then its role file, runbooks and files); a **runbook** opens one level deeper inside the same window; **new role** and **archived roles** are views of it too. Roles gain a short user-written description, shown under the name and in the library.

## Shape

**One window, five views.** Library → role → runbook, plus new role and archived roles off the library. The back control always goes up exactly one level; Esc does the same; the X closes. Same on desktop and phone (phone: full screen).

**Library**
- Header: title "Roles", one short line on what roles are (hidden on a phone), a host switcher (only with more than one host), "New role", close.
- A search box (name and description).
- Sections, each a grouped list: **On every host** (shared roles, with a one-line note under the title) above **On <host>**.
- Each row: the role's picture on its colour, name, its description (two lines on a phone; nothing when it has none), how many agents hold it, a chevron. Clicking opens the role. No row menus — actions live in the role.
- **Archived roles** is a row at the bottom with a count; it opens the archived view. Hidden while searching or when there are none.

**Role view**
- Header row: "‹ Roles", a ⋯ menu, close.
- Under it: the large picture (tap to upload a new one), the name, then the **description** — the text, or faded italic "No description" when empty — with a small pencil; clicking it edits in place (Enter or clicking away saves, Esc cancels).
- A quiet line under that: "N agents hold this role · on <host>" (or "on every host"; "No agents hold this role" at zero).
- Then only the two cosmetic buttons: **Colour** (today's hue picker in a pop-over; the window re-tints as you drag, saves when it closes) and **Voice** (the existing voice list).
- Tabs: **Role file**, **Runbooks** (no count), **Files**, plus **Git** when the role's folder holds a repo.
  - Role file opens as formatted reading with an **Edit** button at the foot; editing shows the text with Cancel and Save. Shared roles say "Changes go to every host" in the foot.
  - Runbooks: a short note on what runbooks are, a grouped list (title-cased name, file count, chevron), and "New runbook" (asks for a name in the in-app dialog, creates it with a starter file, opens it). Empty: an empty state with the explanation and a "New runbook" button.
  - Files: the role folder's file browser (the role file itself stays on its own tab), in the kit look.
- ⋯ menu: **Start a conversation** (opens the new-conversation dialog with this role picked), **Make instance-wide…** / **Stop sharing…** (admins; today's promote and remove flows), **Archive role…** — one in-app confirm naming the agents that hold the role; for a shared role it's greyed out with "Stop sharing it first".

**Runbook view**
- Header: "‹ <role name>", the runbook's title-cased name with "Runbook" under it, a ⋯ menu (Add file…, Delete runbook…), close.
- The skills modal's editor: an "N files" toggle beside the current file's name that brings the file list down the side (on a phone, swaps to it), "Add file" at the bottom of the list, a delete-file button per file, Close and Save at the foot.
- A runbook with no files shows an empty state with its own "Add file" button.

**New role view**
- Header: "‹ Roles" (or back to where it came from), "New role", one short line, close.
- Picture first: a preview on the chosen colour; "Generate picture" (enabled once name and description are filled; shows three candidates to pick from; then "Regenerate") and "Upload…".
- Name, **Description** (sets the role's description and still starts the role file), Colour (the hue picker, random to begin with), Host (only with more than one host).
- Foot: Cancel and "Create role" (enabled once name, description and a picture are set).
- Creating from the library lands on the new role's view. Creating from the new-conversation dialog's "New role…" goes back to new conversation with the role picked, as today; cancelling there also goes back as today.

**Archived roles view**
- "‹ Roles", title, one line; dimmed rows (picture, name, description) each with an "Un-archive" button. Un-archiving keeps you there and the row shows it's on its way back.

**Opened from an agent's window:** clicking a role name in an agent's own window opens the roles window straight onto that role; "‹ Roles" still goes to the library; closing returns to the agent's window.

**Non-admins and shared roles:** view-only all the way down — no Edit, no description/colour/voice/picture changes, runbooks and files read-only, no sharing or archive actions. A plain line says only an admin can change it.

**Unsaved edits:** leaving the role file or a runbook with unsaved edits by any route asks "Discard your changes?" first.

## Philosophy

- Seeing all roles, looking after one role, and working in one runbook are different jobs; each gets its own view in one window, never a pile of windows that close each other.
- What a role IS (picture, name, description) is at the top; what it's made of (role file, runbooks, files) is underneath in tabs.
- The interactive cosmetics (colour, voice) are visibly separate from plain facts (agent count, where it lives).
- Apple's interfaces are the reference for how it behaves; the look stays Skynet's (look A, kit parts only), and it reads as a sibling of the skills modal.
- Nothing the four surfaces can do today is lost.

## Prior context

- Today: a roles list window (host dropdown on its own row, row ⋯ menus, archived strip at the bottom), a role modal (picture, name, colour/voice buttons, tabs), a new-role form (no Cancel; always hands off to new conversation), a runbook editor (lone trash button; empty runbook's "Add file" isn't on screen). Each closes the last and the way back is uneven.
- Tasting agreed with Ashley 2026-10-18 (`workspace/tastings/roles/roles-tasting.js` in the identity workspace) with her changes: a real description under the name (faded italic "No description" + pencil when empty), the agent count moved off the cosmetic buttons, no runbook count on the tab. Files tab look kept as tasted.
- The description field itself (stored in the role file, served by the API, writable) is being plumbed by anthem-box-maintainer-6; this shape builds the UI on it. Drafting descriptions for existing roles is separate, after deploy.
- Window sizes are deliberately not settled here — shape-modal-sizing walks every modal at the end.
- Runbook rename is not offered (nothing behind it today).

## What would make it wrong

- Any step opens a separate window, or back/close lands somewhere other than one level up / where you came from.
- The line under the name is the start of the role file instead of the role's own description, or an empty description shows nothing to click.
- The agent count or "every host" sits among the colour/voice buttons as if it were a control.
- The Runbooks tab shows a count.
- A non-admin can change anything about a shared role.
- An empty runbook leaves no visible way to add a file.
- Creating a role from the library dumps you into new conversation.
- Something the old four surfaces could do is gone (upload a picture, colour, voice, git view, file browser, promote/remove sharing, archive, un-archive, delete runbook, add/delete files, PDF/media viewing in runbooks).
