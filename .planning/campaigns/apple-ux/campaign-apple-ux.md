# Campaign: a better skills modal, growing into Apple-grade UX across Skynet's modals

**Opened:** 2026-10-16
**Status:** in_progress
**Workspace:** .planning/campaigns/apple-ux/

## Concept

Skynet's modals are busy and inconsistent: settings hide in three-dots menus, pickers are dropdowns you can't browse, and every modal invents its own layout. This campaign takes Apple's interfaces as the reference for *how* things are laid out and behave — a sidebar list to pick from, grouped settings rows that show their current value, small checkmark menus, sheets for creating things, back-and-forth navigation (a navigation stack on phones), red for destructive actions and blue for adding — and applies it modal by modal, starting with the skills modal. It is not an Apple look-alike: the layout, the element types and the colour meanings come from Apple; the surface aesthetic (backgrounds, borders, type, corners) stays Skynet's own and is worked out deliberately. Alongside, admins get finer control over shared skills and roles: instead of "every host or nowhere", they pick the hosts a shared skill or role lives on, kept in sync across just those — or pick a deliberate "every host" that also covers hosts added later. Non-admins never see any of the sharing controls. Once the modals are done, the sidebar and the conversation view get the same pass.

## Success criteria

- Every modal in the app uses the same Apple-derived layout patterns and element types, and reads as one family.
- Colour carries meaning consistently: red only for destructive actions, blue for adding / the primary action.
- The aesthetic is recognisably Skynet's, not a copy of Apple's surfaces.
- Modals feel calm: the important settings are visible without digging, and nothing is cluttered with tags or decoration.
- Every modal works on a phone as a navigation stack (list → detail → deeper), with a clear way back and out.
- No capability is lost in any redesign, including read-only states (fleet-distributed skills; shared skills/roles for non-admins are view-only all the way into the editor).
- Admins can share a skill or role to a chosen set of hosts, kept in sync across exactly those, or to "every host" which also reaches hosts added later; picking all current hosts one by one does NOT auto-include future hosts. Non-admins see none of this.
- The id skill describes every non-admin-visible change as it ships (admin-only features stay out of it).

## Shapes

Starting order: foundation, skills, host targeting, then the remaining modals, then sidebar and conversation view last (Ashley: "save that until we've already gone through the rest").

- **[declared] shape-ux-foundation** — the shared building blocks (sidebar list, grouped rows with values, checkmark menus, sheets, navigation stack, semantic colours) and the Skynet-own aesthetic they wear; tasting the aesthetic against the existing modal shell is the heart of this shape — not started
- **[declared] shape-skills-modal** — the skills modal rebuilt on the foundation (see tasting-skills-apple.html), keeping fleet-distributed and instance-wide read-only behaviour — not started
- **[declared] shape-host-targeting** — admin-only: shared skills and roles target a chosen set of hosts or a permanent "every host"; sync machinery + the admin controls in both skills and roles modals — not started
- **[declared] shape-roles-modals** — roles list, role modal, new-role dialog, runbook editor — not started
- **[declared] shape-identity-modal** — agent modal (agent file, wake-ups + add-wake-up, files, git, desktop tabs) — not started
- **[declared] shape-project-modals** — project modal + new-project dialog — not started
- **[declared] shape-scheduled-tasks-modal** — scheduled tasks list + editor — not started
- **[declared] shape-preferences-modal** — preferences (and the feedback dialog) — not started
- **[declared] shape-admin-modals** — admin panel + admin user modal — not started
- **[declared] shape-creation-and-search-dialogs** — new conversation, new session, conversation search, archived apps — not started
- **[declared] shape-file-modal** — the editable file modal — not started
- **[declared] shape-sidebar** — the conversation list / sidebar, after all modals — not started
- **[declared] shape-conversation-view** — the chat view itself, last — not started

## Other work

- The version-mismatch lock modal — trivial; restyle in whichever shape lands the foundation — not started

## Lingerers (explicitly approved)

## Open questions

- What does the Skynet-own aesthetic look like wearing Apple's layout? (Ashley isn't sure the current modal background/border plus Apple-shaped components will look good — shape-ux-foundation tastes this.)
- Wording for the permanent "every host" option vs a hand-picked set that happens to include all hosts — shape-host-targeting.
- Does the shared-roles side already sync the same way as shared skills, or does host targeting need roles brought level first?

## Prior context

- Tastings: `tasting-skills-cards-rejected.html` (card library — Ashley: "too busy"), `tasting-skills-apple.html` (System Settings-style — Ashley liked the direction, but wants Apple's UX, not its visual skin).
- Platinum's e982457f + 3e748d80 (2026-10-16): admins see fleet-distributed skills read-only in the skills modal (own group, write routes 403, editor view-only, a save adding the distributed marking is refused). Admin-only, so not in the id skill.
