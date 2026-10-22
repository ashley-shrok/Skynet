# Shape: the creation and search dialogs — new conversation, What's new, search, archived apps

**Opened:** 2026-10-22
**Campaign:** apple-ux (shape 9 of 14)

## What this is

Four small windows get the same pass as the rest of the app. The new-conversation dialog (pencil) shows its roles as a list right in the dialog — pictures, one-line descriptions, a check when picked — with the name always visible and pre-filled; admins switch between an agent and a plain shell at the top. What's new becomes a short branded sheet with one Continue. Search says what it searches and how many conversations it found. Archived apps shows Un-archive on every row.

## Shape

**New conversation (pencil)**
- Title "New conversation"; under it "An agent to chat with. Its roles shape what it knows and how it helps." (in Shell: "A terminal on one of your machines, with no agent in it.").
- Admins only: an **Agent / Shell** switch at the top, in place of the "Just a shell — no agent" tick-box. Anyone else never sees it.
- **Roles**: a list in the dialog instead of a drop-down. Grouped by machine — the machine's name as a heading **only when there is more than one machine**; with one machine, no heading. Each group starts with **No roles** ("A plain agent — give it roles later if you like."), then that machine's roles: picture, name ("· on every host" for a role kept on every host), its one-line description, a check when picked. Several roles can be picked; No roles is exclusive; a role from another machine moves the agent there (as today). A search box once there are more than eight roles; **New role…** at the bottom (goes to the new-role dialog and comes back with the picks, as today). The list scrolls inside the dialog.
- **Name**: always shown, pre-filled with the suggested name ("Suggested — change it if you like."); typing replaces it; the existing "already exists" checks stay. Before a role is picked (several machines): "Pick a role first". The "Choose a custom agent name" tick-box is gone.
- Shell (admins): the machine list with its search, Name (optional), Path — as today.
- Foot: **Cancel** and **Create** (Create waits until roles or No roles are picked; "Creating…" while the agent is being made, nothing closes meanwhile — as today). On a phone, a sheet with the buttons stacked.

**What's new**
- A sparkle tile, "What's new in <the instance's own name>", the notes as a grouped list (newest first), one full-width **Continue**. Continue, the X or Esc close it and mark the notes seen, as today.

**Search**
- Title "Search"; the box reads "Search every conversation".
- Before any search: "Search every conversation — What you, your agents and their tools said — archived conversations too. Type, then press Return."
- Once something new is typed: "Press Return to search." under the box (Return is still the only thing that searches).
- While searching: "Searching every conversation — this can take a few seconds…".
- Results: a count line ("12 conversations", "20+ conversations" when there's more to load), the result rows as today, Load more at the end.
- No results: "No results for "…"" with "Try fewer or different words."
- An error shows as a banner at the top of the results instead of a foot.

**Archived apps**
- Under the title: "Apps you've archived. Un-archive one to put it back in the sidebar."
- Each row: the app's picture or initial, its name, an **Un-archive** button (busy while it works; one at a time). Right-click a row still offers Un-archive. No ⋮ on rows.
- Nothing archived: "No archived apps — Apps you archive land here, ready to bring back."

## Philosophy

- Show the choices instead of hiding them in a drop-down; describe each one.
- Never ask the user to opt into something we can just pre-fill (the name).
- A plain-language line says what each window is for and what it's doing.
- Admin-only controls stay invisible to everyone else.
- An instance's own branding wins (What's new names the instance, not "Skynet").
- Apple's interfaces are the reference for behaviour; the look stays Skynet's (look A, kit parts only).
- Nothing these windows do today is lost.

## Prior context

- Today: the pencil opens "Create a new agent conversation" with a long description, a "Just a shell" tick-box (admins), a roles drop-down grouped by machine, a "Choose a custom agent name" tick-box that reveals the name field, and only Create. What's new is a bullet list with "Got it". Search is "Search conversations" with "Type a query and press Enter". Archived apps hides Un-archive behind a ⋮ on each row.
- Tasting with Ashley 2026-10-22 (real build over the live app, real roles and apps; `workspace/tastings/dialogs/` in the identity workspace): new conversation "looks good … awesome", What's new, search and archived apps "really good stuff". Her two notes: the Agent / Shell switch never shows for a non-admin; machine headings only when there is more than one machine.
- Most roles have no description yet (drafting them is separate pending work), so many rows show just a name for now.
- id skill: the pencil's dialog, What's new, search and archived apps are all non-admin visible → id-skill edits. One what's-new note for the whole campaign at its close.
- Window sizes are not settled here — shape-modal-sizing walks every modal at the end.

## What would make it wrong

- A non-admin seeing the Agent / Shell switch, or any way to open a plain shell.
- A machine heading in the roles list when there's only one machine.
- A name field hidden behind a tick-box, or a suggested name overwriting one the user typed.
- Losing anything the dialog does today: multi-role picks in order, No roles, a role from another machine moving the agent, New role… and back, the name checks, shell mode with machine and path, the locked "Creating…" state.
- Search firing on every keystroke instead of on Return.
- Un-archive reachable only through a hidden menu.
- "Skynet" hard-coded in What's new.

## Scope edges

- In: the new-conversation dialog, What's new, the search window, archived apps.
- Out: the sidebar's own search box (shape-sidebar); the search result rows' layout; writing role descriptions; what search or un-archive do on the server.
- Deferred: window sizes (shape-modal-sizing).
- Tempting but no: searching as you type; grouping search results; choosing an agent's picture or voice at creation.

## Handoff notes

- copper-box-maintainer-2, in-session after the tasting; the tasting code is the starting point (role list component, dialog changes, What's new, search, archived apps).
- Before building: rebase onto upstream's "runbooks become role skills" (f0452a0c) and carry role skills into the redesigned roles window — separate commit, shown to Ashley.
- Tests for all four windows rewritten around the new flows; id skill describes each change.
- The unused "new group conversation" (relay room) dialog is not opened anywhere — Ashley to say whether to delete it here.
- Local only — campaign shipping rule.

---

## Close-Out

**Closed:** 2026-10-22
**Overall verdict:** closed-hit (two small additions endorsed by Ashley)

### Shape features (conformance)

- **What this is** — present · all four windows redone as agreed.
- **New conversation** — present · title/description lines; admin-only Agent / Shell switch replacing the tick-box; roles as an in-dialog list grouped by machine, headings only with several machines; No roles first with its line; picture, name, "· on every host", description, check; several picks, No roles exclusive, other-machine move; search past eight roles; New role… at the bottom and back; name always shown and pre-filled ("Suggested — change it if you like."), typing wins, name checks kept, "Pick a role first"; shell mode as before; Cancel + Create, Create gating, locked Creating…; phone sheet with stacked buttons.
- **What's new** — present · sparkle tile, "What's new in <instance name>", grouped notes, full-width Continue; closing marks seen.
- **Search** — present · "Search", "Search every conversation", before-search text, "Press Return to search." hint, searching line, count line (N / N+), rows as today, Load more, no-results line, error banner at the top.
- **Archived apps** — present · subtitle, picture/initial, name, Un-archive button (busy, one at a time), right-click kept, no ⋮, empty state.
- **Philosophy** — present.
- **Prior context** — present · id skill describes all four windows; the campaign's single what's-new note waits for campaign close.
- **What would make it wrong: non-admin sees the switch or can open a shell** — present (not violated).
- **What would make it wrong: machine heading with one machine** — present (not violated).
- **What would make it wrong: name behind a tick-box / suggestion overwriting a typed name** — present (not violated).
- **What would make it wrong: losing anything the dialog does today** — present (not violated).
- **What would make it wrong: search on every keystroke** — present (not violated).
- **What would make it wrong: Un-archive only through a hidden menu** — present (not violated).
- **What would make it wrong: "Skynet" hard-coded in What's new** — present (not violated).
- **Scope edges** — present.

### Additions (in the result, not in the shape)

- The new-conversation window got bigger (room for the role list) and What's new smaller (a short sheet) ahead of the sizing pass — endorsed-as-drift
- Searching the role list hides the No roles rows, matches machine names too, and says "No matching roles" when nothing matches — endorsed-as-drift
- Roles-window changes alongside (role skills shown like skills, no machine on the facts line, the scheduled-tasks link) — asked for by Ashley during this session; logged in the campaign artifact

### Follow-ups

- The unused "new group conversation" dialog stays as is, not restyled and not removed — Ashley plans to come back to it later — deferred

### Notes

Settled by reading only.
