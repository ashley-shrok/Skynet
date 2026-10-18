# Shape: a better skills modal — see all my skills and who can use them at a glance, work on one skill on its own

**Opened:** 2026-10-18
**Campaign:** apple-ux (shape 2 of 13)

## What this is

The skills modal, rearranged on the foundation's kit into two views inside one modal. A **library** shows every skill you have, with two switches on each row: whether it's offered to **you** (your Skills button and /name) and whether **agents** can use it, so you can see and change that across all your skills without opening any of them. Clicking a skill moves the modal into that **skill's own view**, which opens straight onto its SKILL.md; the skill's other files stay tucked away until asked for. Alongside, shared skills ("shared to every host") become agent-only for non-admins: they disappear from a non-admin's skills modal and Skills button.

## Shape

**One modal, two views.** It opens on the library. Picking a skill replaces the library with that skill's view; a "‹ Skills" back control returns. Same on desktop and phone.

**Library view**
- Header: title "Skills", one short line saying what skills are, a host switcher (only when there's more than one host), "New skill", close.
- A search box (matches name and description) and a filter: All / You / Agents, each with a count of how many skills it covers — the counts are the "feel" for what's in your Skills button and what agents get.
- Sections, each a grouped list with "You" and "Agents" column labels over its rows:
  - **Shared to every host** — admins only. Real switches; a flip changes the shared copy, so it changes everywhere.
  - **Your skills** — everyone. Real switches.
  - **Fleet-distributed — read-only** — admins only. The note explaining what fleet-distributed means sits directly under the section title. Fixed marks (check / dash) instead of switches.
- Each row: name, one-line description (two lines on a phone), the You switch, the Agents switch, a chevron. Clicking the row (not a switch) opens the skill.
- A switch flip saves at once — there's no Save in the library.
- **At least one stays on.** Turning off a skill's last remaining switch is refused with a small nudge and a one-line note. A skill already set to "nobody" on disk shows both switches off and a quiet amber "Nobody can use this" under its name; flipping either on clears it.

**Skill view**
- Header: "‹ Skills", the skill's name and its description, a ⋯ menu (make it shared to every host / remove from every host / delete skill — what's there today, minus the two settings that moved out), close.
- Under the header, the two settings written out — "In my Skills button" and "Agents can use it" — with the same switches as the library. Read-only skills show a plain banner saying why and where to change it instead. Admins looking at a shared skill also see its sync status here.
- The editor fills the rest, opened on SKILL.md. Above it, a small "N files" button beside the current file's name; it starts collapsed every time a skill is opened. Opening it brings the file list down the side (grouped by folder, with a find box once there are more than ten files, and "Add file" at the bottom). On a phone the same button swaps the editor for the file list, and picking a file goes back to the editor.
- Close and Save at the foot, as in other editor modals. Read-only skills have no Save.

**New skill:** asks for a name in the in-app dialog, then lands in the new skill's view with SKILL.md open and the usual starter text; both switches on.

**Unsaved edits:** leaving by any route (back, Esc, the X, another file, switching host) asks "Discard your changes?" first. While SKILL.md has unsaved edits, the two switches in the skill view are dimmed with "Save or discard your edits first".

**Shared skills for non-admins:** invisible in the skills modal and left out of the Skills button, on every host. Their agents still use them.

## Philosophy

- Seeing all skills and working on one skill are different jobs; each gets its own view rather than sharing a cramped screen.
- The thing Ashley manages most — who can use which skill — is right on the surface, in bulk, never behind a menu.
- Most people only ever touch SKILL.md. The other files are available but out of the way.
- Apple's interfaces are the reference for how it behaves; the look stays Skynet's (look A from the foundation, kit parts only).
- Nothing the modal can do today is lost; it's rearranged.

## Prior context

- Today: two dropdowns (host, then skill), the skill's files down the left, the editor on the right; the two invocation settings, sharing and delete are in a ⋯ menu; small chips hint at the skill's state; a long explanation sits under the title.
- The foundation (closed) already moved this modal onto the kit; this shape is its layout.
- Tasting agreed with Ashley 2026-10-18 (`workspace/tastings/skills/skills-tasting.js` in the identity workspace), including her three changes: filter says "You", the fleet-distributed note under its section title, files collapsed by default.
- Fleet-distributed skills shown read-only to admins (Platinum's work) must stay intact.

## What would make it wrong

- Changing who can use a skill still takes opening it.
- The library's switches or counts disagree with what actually appears in the Skills button or what agents get.
- A non-admin can see a shared skill anywhere in Skynet — library, Skills button, or a skill view.
- A read-only skill (fleet-distributed, or shared for a non-admin if it were ever reached) can be changed, or an editable one looks locked.
- A skill can be switched to "nobody" from the modal.
- The skill view opens on a file list instead of SKILL.md, or the file list crowds the editor for a one-file skill.
- Files are shown as a strip of tabs.
- A typed edit is thrown away without asking.
- It reads as an Apple look-alike, or uses one-off parts instead of the kit.

## Scope edges

- **In:** the two-view layout; library sections, switches, search, filter with counts; the at-least-one rule and the "nobody" warning; the skill view with collapsed files; new-skill landing; unsaved-edit guards; phone drill-in; the list of skills bringing back both settings so the library needn't open every skill; shared skills hidden from non-admins in the modal and the Skills button; the id skill updated for the non-admin-visible parts.
- **Out:** choosing which hosts a shared skill reaches, and the wording of "every host" (shape-host-targeting); blocking a non-admin from typing /name for a shared skill by hand; shared roles (stay as they are — roles shapes).
- **Deferred:** none.
- **Tempting but no:** bulk actions (select many, flip all); editing descriptions inline in the library; a rendered preview of SKILL.md.

## Handoff notes

- Identity: copper-box-maintainer-2, inside campaign apple-ux. Work stays LOCAL on `feat/tab-title-from-tmux` — no push, no deploy until Ashley says (campaign shipping rule).
- Build only from kit parts; if a part is missing (e.g. a column-labelled list row), add it to the kit rather than one-off markup.
- The invocation settings today write SKILL.md's frontmatter; the at-least-one rule is enforced in the modal (the on-disk "nobody" state can still exist and must display).
- Admin-only parts (shared and fleet-distributed sections, sync status) stay out of the id skill; the library, switches, collapsed files and the non-admin Skills-button change go in.
