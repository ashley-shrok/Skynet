# Campaign: a better skills modal, growing into Apple-grade UX across Skynet's modals

**Opened:** 2026-10-16
**Status:** in_progress
**Workspace:** .planning/campaigns/apple-ux/

## Concept

Redesign Skynet's modals with Apple's interfaces as the reference, starting with the skills modal and going modal by modal; after the modals, the sidebar and the conversation view get the same pass. Apple is the reference for the UX, not for the visual skin — the result should look like Skynet, not like Apple made it. Alongside, admins get finer control over where shared skills and roles live: a chosen set of hosts kept in sync, or a deliberate "every host" that also covers hosts added later. Non-admins never see the sharing controls.

### Standing rule for every design session in this campaign

Ashley, 2026-10-16: *"I want all future sessions during this campaign to be like it was this time, where all I did was reference Apple, and then you took that and did what you thought was right for it. And I would much prefer that rather than trying to derive the principles we think that their interfaces live by, and then having those derivations bias what gets created."*

So: this artifact deliberately does NOT list Apple design principles, and no session should write any into it, into a shape file, or into a prompt. Each design session takes "Apple's interfaces as the reference" and forms its own judgment. Earlier tastings in this folder are past attempts, not a spec.

## Success criteria

- Every modal in the app has been redesigned with Apple's interfaces as the reference, and Ashley is happy with each.
- The modals read as one family.
- The result looks like Skynet, not an Apple look-alike.
- Every modal works on a phone as well as on a desktop.
- No modal loses anything it can do today, including read-only states (fleet-distributed skills; shared roles for non-admins stay view-only all the way into the editor). Shared skills are invisible to non-admins and agent-only for them (Ashley, 2026-10-18).
- Admins can share a skill or role to a chosen set of hosts, kept in sync across exactly those, or to "every host", which also reaches hosts added later; ticking all of today's hosts one by one does NOT include future hosts. Non-admins see none of this.
- The id skill describes every non-admin-visible change as it ships (admin-only features stay out of it).
- After the modals, the sidebar and the conversation view have had the same pass.

## Shapes

Starting order: foundation, skills, then the remaining modals, then host targeting, then sidebar and conversation view last (Ashley: "save that until we've already gone through the rest"). Host targeting moved after the modals 2026-10-18 (Ashley: "we're just gonna have to end up redesigning the interface for it anyways") — its controls live in the skills and roles modals, so it waits until those are redesigned.

- **[declared] shape-ux-foundation** — look A + the shared kit, every modal moved onto it, in-app dialogs, phone sheets (see shape-ux-foundation.closed.md) — closed 2026-10-17
- **[declared] shape-skills-modal** — library + skill views, who-can-use switches in bulk, files collapsed; shared skills agent-only for non-admins (see shape-skills-modal.closed.md) — closed 2026-10-18
- **[declared] shape-roles-modals** — roles list, role modal, new-role dialog, runbook editor — not started
- **[declared] shape-identity-modal** — agent modal (agent file, wake-ups + add-wake-up, files, git, desktop tabs) — not started
- **[declared] shape-project-modals** — project modal + new-project dialog — not started
- **[declared] shape-scheduled-tasks-modal** — scheduled tasks list + editor — not started
- **[declared] shape-preferences-modal** — preferences (and the feedback dialog) — not started
- **[declared] shape-admin-modals** — admin panel + admin user modal — not started
- **[declared] shape-creation-and-search-dialogs** — new conversation, new session, conversation search, archived apps — not started
- **[declared] shape-file-modal** — the editable file modal — not started
- **[declared] shape-host-targeting** — admin-only: shared skills and roles target a chosen set of hosts or a permanent "every host"; sync machinery + the admin controls in both skills and roles modals — not started
- **[declared] shape-sidebar** — the conversation list / sidebar, after all modals — not started
- **[declared] shape-conversation-view** — the chat view itself, last — not started

### Shipping (Ashley, 2026-10-17)

"No point in deploying when tons of modals using the pieces aren't even done." The foundation stays local (committed, NOT pushed — a push would ride along on any peer's deploy) until enough of the per-modal layout shapes are done to ship together. Keep the local branch rebased on origin each session. Each push still needs Ashley's explicit go-ahead.

### Per-modal shapes after the foundation

The foundation already moved every modal onto the kit, so each remaining modal shape is now about that modal's own layout and arrangement only. They are small; group several per session if they fit.

## Other work

- The version-mismatch lock modal — trivial; restyle in whichever shape lands the foundation — done in shape-ux-foundation

- Remove the dead session finder (command palette) — handed to sparrow-box-maintainer-2 (Ashley, 2026-10-17); copper rebases onto its deletion
- Kit candidates raised during the foundation (pop-over panel for colour/voice pickers, link-styled button, usage meter, sortable column header) — pick up in the per-modal shapes that need them
- Unused sidebar-era row styles in the conversation-list stylesheet — clean up in shape-sidebar
- Markdown files show their Formatted / Plain text switch on its own row under the file toolbar (file viewer, everywhere) — look at it in shape-file-modal
- New-conversation roles dropdown (upstream's grouped multi-select, revived 2026-10-18 when the host step was dropped) is not on the kit yet — restyle in shape-creation-and-search-dialogs
- Shared-skill hiding for non-admins goes by name and lets skills show if the sync engine is down (logged) — revisit in shape-host-targeting alongside the sync machinery

## Lingerers (explicitly approved)

## Open questions

- ~~What does Skynet's own aesthetic look like on an Apple-referenced design?~~ Answered in shape-ux-foundation: look A (flat near-black, colour only on chosen/primary/focus).
- Wording for the permanent "every host" option vs a hand-picked set that happens to include all hosts — shape-host-targeting.
- ~~Does the shared-roles side already sync the same way as shared skills?~~ Yes — one engine for both (checked 2026-10-18).

## Prior context

- Tastings (past attempts, not a spec): `tasting-skills-cards-rejected.html` (Ashley: "too busy"), `tasting-skills-apple.html` (second attempt after "my layout goal is apple interfaces"; Ashley liked where it was going but wants Apple as the UX reference, not the visual skin).
- Platinum's e982457f + 3e748d80 (2026-10-16): admins see fleet-distributed skills read-only in the skills modal (own group, write routes 403, editor view-only, a save adding the distributed marking is refused). Admin-only, so not in the id skill.
