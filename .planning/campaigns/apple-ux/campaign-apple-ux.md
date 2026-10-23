# Campaign: a better skills modal, growing into Apple-grade UX across Skynet's modals

**Opened:** 2026-10-16
**Status:** in_progress
**Workspace:** .planning/campaigns/apple-ux/

## Concept

Redesign Skynet's modals with Apple's interfaces as the reference, starting with the skills modal and going modal by modal; after the modals, the sidebar, the conversation view and the bar across the top of app / remote-desktop / file panes get the same pass — by then the whole interface has been visually reimagined (Ashley, 2026-10-23). Apple is the reference for the UX, not for the visual skin — the result should look like Skynet, not like Apple made it. Alongside, admins get finer control over where shared skills and roles live: a chosen set of hosts kept in sync, or a deliberate "every host" that also covers hosts added later. Non-admins never see the sharing controls.

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
- After the modals, the sidebar, the conversation view and the pane bar (apps, remote desktops, files) have had the same pass.

## Shapes

Starting order: foundation, skills, then the remaining modals, then host targeting, then sidebar and conversation view last (Ashley: "save that until we've already gone through the rest"). Host targeting moved after the modals 2026-10-18 (Ashley: "we're just gonna have to end up redesigning the interface for it anyways") — its controls live in the skills and roles modals, so it waits until those are redesigned.

- **[declared] shape-ux-foundation** — look A + the shared kit, every modal moved onto it, in-app dialogs, phone sheets (see shape-ux-foundation.closed.md) — closed 2026-10-17
- **[declared] shape-skills-modal** — library + skill views, who-can-use switches in bulk, files collapsed; shared skills agent-only for non-admins (see shape-skills-modal.closed.md) — closed 2026-10-18
- **[declared] shape-roles-modals** — roles list, role modal, new-role dialog, runbook editor become one window; roles gain a one-line description (see shape-roles-modals.closed.md) — closed 2026-10-18
- **[declared] shape-identity-modal** — agent window: who the agent is on top, wake-ups / new wake-up / git one level deeper in the same window (see shape-identity-modal.closed.md) — closed 2026-10-18
- **[declared] shape-project-modals** — project window like the agent window (folder tile, lineage, count; read → Edit), new-project dialogs with Cancel (see shape-project-modals.closed.md) — closed 2026-10-18
- **[declared] shape-scheduled-tasks-modal** — scheduled tasks list by machine, each task one level deeper, Run now a button; shared "When" section (see shape-scheduled-tasks-modal.closed.md) — closed 2026-10-21
- **[declared] shape-preferences-modal** — account-first Preferences (account card, section headers, save-as-you-go, About you read → Edit, branded About), self-confirming feedback dialogs (see shape-preferences-modal.closed.md) — closed 2026-10-21
- **[declared] shape-admin-modals** — Admin in the Preferences family; users and hosts one level deeper in the same window; hosts grouped by attention with reasons; instance file read → Edit (see shape-admin-modals.closed.md) — closed 2026-10-21
- **[declared] shape-creation-and-search-dialogs** — new-conversation dialog (role list, name pre-filled, admin Agent/Shell), What's new, search, archived apps (see shape-creation-and-search-dialogs.closed.md) — closed 2026-10-22
- **[declared] shape-file-modal** — one file window wherever a file opens (chat + Files tabs); opens by type (look at / read first with Edit / ready to work on); one header with view switches, Formatted / Plain text off its own row everywhere (see shape-file-modal.closed.md) — closed 2026-10-22
- **[discovered] shape-look-adjustments** — aesthetic adjustments to the look (how it looks, not layout). Ashley's pitch (2026-10-23): keep the readability, but the look is fully flat and fully neutral, which wears on her over long days — try light touches toward depth (things feel like real, pressable objects in a space; no see-through or blur — performance) and toward character (less boring, without undoing readability). Tasting built: `workspace/tastings/look/look-tasting.js` (real captured windows + twelve ideas at Off / Light / More, presets, colour slider; rebuild with `build.py`). Deferred to AFTER the campaign's deploy, next to modal sizing — Ashley wants to live with the redesigned windows before judging the ideas (Ashley, 2026-10-23: "can we shift this shape to the end of the process, actually post-deploy for the campaign, so I can use what's here a little bit more before I judge these?") — not started
- **[discovered] shape-modal-sizing** — once every modal is redesigned, Ashley walks through them all and says where each should size or expand (per tab where it helps, on screens with room), instead of tracking sizes shape by shape (Ashley, 2026-10-18) — deferred until after the campaign's deploy (the campaign still ships once, at the end, unless something needs testing on live): the preview desktop's screen is too small to judge sizes, so Ashley notes what needs it on her real screens (Ashley, 2026-10-23)
- ~~**[declared] shape-host-targeting**~~ — admin-only: shared skills and roles target a chosen set of hosts or a permanent "every host" — handed to olympus-box-maintainer-5 in the SKYNET project, on hold until Ashley talks to it (Ashley, 2026-10-23); no longer part of this campaign. Its admin controls will live in this campaign's skills and roles windows.
- **[declared] shape-sidebar** — the conversation list / sidebar, after all modals — not started
- **[discovered] shape-pane-bar** — the bar across the top of app, remote-desktop and file panes (one shared bar today), not the apps' own content (Ashley, 2026-10-23) — not started
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
- Markdown files show their Formatted / Plain text switch on its own row under the file toolbar (file viewer, everywhere) — look at it in shape-file-modal — done in shape-file-modal
- New-conversation roles dropdown (upstream's grouped multi-select, revived 2026-10-18 when the host step was dropped) is not on the kit yet — restyle in shape-creation-and-search-dialogs — done (now an in-dialog role list)
- The unused "new group conversation" (relay room) dialog — left as is; Ashley plans to come back to it later — deferred
- Role description field (frontmatter `description:`, replaces the `## Role`-derived text) plumbed through backend + API by anthem-box-maintainer-6 (spawned 2026-10-18 at Ashley's ask) — done, b1b842fb on origin
- Draft a one-line description for every existing role from its role file — after the roles-modals deploy (Ashley, 2026-10-18)
- Wake-up "Next: …" fire time — the agent window's wake-up view shows schedule + last fired only; showing the next fire needs the server to work it out the scheduler's way (Ashley, 2026-10-18) — not started
- Schedule-kind wording and order (Daily / Weekly / Monthly / Yearly / Every… / Once) — the control is shared with scheduled tasks; change both in shape-scheduled-tasks-modal — done in shape-scheduled-tasks-modal (and the "When" section is now one shared piece for both)
- The agent window's repo / commit / diff views open at the editor size (the rest stays at its old size) — settle in shape-modal-sizing — not started
- A wake-up's schedule line says "(box-local)" even when it carries a time zone (server-side description) — not started
- Long project lineages ("In A › B › C") cut off from the end, losing the nearest parent — consider trimming from the start (agent window, project window, new sub-project dialog) — not started
- The app's host list dropped the "can run agents" flag, so new scheduled tasks (and anything else filtering on it) saw no machines — found and fixed during shape-scheduled-tasks-modal
- What's-new note for the whole redesign — the role now asks for one per user-visible change; this campaign writes ONE note at campaign close (Ashley approves the exact text before it's committed) — not started
- Upstream's new "What's new" pop-up (a9261d84, 2026-10-21) is another window to bring onto the kit/family — fold into shape-creation-and-search-dialogs — done in shape-creation-and-search-dialogs
- Upstream gave the scheduled-task form a Project picker (146599d2) — carry it into the redesigned scheduled-tasks window at the next rebase — done at the 2026-10-21 rebase (Project dropdown in the task view, project line on the row, search matches it)
- Upstream's runbooks → role skills (f0452a0c) and the role → scheduled-tasks shortcut (7ff647c0) — carried into the roles window at the 2026-10-22 rebase (Skills tab, role-skill view on SKILL.md, "N scheduled tasks ›" opening the scheduled tasks window on that role) — done
- Role skills read like skills (Ashley, 2026-10-22): rows show name + description, a role skill's header its description; the role-skills list route now returns descriptions (backend — shows only once deployed) — done
- The role's facts line no longer names its machine (Ashley, 2026-10-22) — done
- Upstream's skill + runbook rename (2150579c, b971345c) — carried into the skills window's ⋮ menu and the runbook view's ⋯ menu at the 2026-10-21 rebase, in-app dialogs instead of browser pop-ups — done
- A Files-tab file window has no Copy path (it doesn't know the file's full path on its machine; chat files have it) — found in shape-file-modal (Ashley, 2026-10-22) — not started
- Shared-skill hiding for non-admins goes by name and lets skills show if the sync engine is down (logged) — revisit in shape-host-targeting alongside the sync machinery

## Lingerers (explicitly approved)

## Open questions

- ~~What does Skynet's own aesthetic look like on an Apple-referenced design?~~ Answered in shape-ux-foundation: look A (flat near-black, colour only on chosen/primary/focus).
- Wording for the permanent "every host" option vs a hand-picked set that happens to include all hosts — shape-host-targeting.
- ~~Does the shared-roles side already sync the same way as shared skills?~~ Yes — one engine for both (checked 2026-10-18).

## Prior context

- Tastings (past attempts, not a spec): `tasting-skills-cards-rejected.html` (Ashley: "too busy"), `tasting-skills-apple.html` (second attempt after "my layout goal is apple interfaces"; Ashley liked where it was going but wants Apple as the UX reference, not the visual skin).
- Platinum's e982457f + 3e748d80 (2026-10-16): admins see fleet-distributed skills read-only in the skills modal (own group, write routes 403, editor view-only, a save adding the distributed marking is refused). Admin-only, so not in the id skill.
