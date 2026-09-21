# Shape: wake-ups redesign — global on-disk specs that birth a new identity per fire

**Opened:** 2026-09-20
**Vehicle:** GSD phases

## What this is

Wake-ups today bind a scheduled intent to a specific already-existing identity (or to a role's coordinator, which then routes to an actor). Firing wakes something with baggage from other things it's been doing — which fights the tissue-model philosophy where each identity exists to do one thing and then dies. This work moves wake-ups to a **global per-host concept**: a wake-up is a small on-disk spec (name, prompt, one or more roles, optional skills, schedule), and when it fires, a fresh identity is born on that host to carry out the prompt as its one job. The user manages wake-ups through a new modal in Skynet reached from the conversation-list header; agents on the same host read and write the same on-disk specs directly. Two paths in, one source of truth.

## Shape

**The spec.** A wake-up is a small on-disk file per host. It carries: a short **name** for scanning at a glance, a **prompt** the newborn agent receives as its first turn, **one or more roles** the newborn takes on, **optional skills** the newborn has ready, a **schedule** (daily / weekly / interval / one-shot, with the shape today's scheduler already supports — including timezone for DST-safe daily/weekly), and an **enabled** flag. Specs live at a global on-host path (mirroring the existing per-identity and per-role wake-up file conventions, at global scope this time). No database shadow — the on-disk file is the truth.

**Two paths in, one truth out.** The user creates, edits, disables, and deletes wake-ups through a modal in Skynet. Any agent on the same host reads and writes the same files directly (a script, a session, an editor). Both surfaces watch the same on-disk state; neither is authoritative over the other.

**How wake-ups fire.** The agent-supervisor already spawns a scheduler script per identity as an ambient watcher; the same script runs at a new scope for global wake-ups — session-independent, running whether or not any harness is up. When a spec's time arrives, the scheduler drops a create-identity request file for Skynet's backend to pick up. Skynet's backend already knows how to birth an identity from a request file (the coordinator's existing mechanism) — reuse it. The newborn identity is named by the existing clone-picker, takes on the spec's roles, has the spec's skills ready, and receives the spec's prompt as its first turn. When it's done, it's done; a recurring wake-up births a fresh newborn on the next fire, unrelated to the previous one.

**Naming falls out of the mechanism.** No new naming rule to invent — the clone-picker that coordinators already use for their birthing flow is exactly what this scheduler calls too.

**Continuity is the prompt author's job.** Recurring wake-ups on the tissue model mean each fire starts fresh. If a job wants continuity across fires (yesterday's run informs today's), the prompt says so — "read this file first," "log to this bounty," "check the last three lines of that log." The system provides no continuity affordance. The fleet's existing shared-knowledge mechanisms — role files, bounties, arbitrary scratch files — cover every case the wake-up subsystem would otherwise have to model.

**Per-session self-scheduling stays untouched.** The existing per-identity mechanism (a running session schedules a wake-up for itself an hour later — "check on this thing then") stays exactly as it is. That's a different pattern: it wakes the *running session*, not a fresh one. It's an authoring shortcut for something the running agent wants its future self to remember; it isn't a global wake-up in disguise. Both mechanisms coexist because they solve different problems.

**Per-role wake-ups sunset.** The pattern where a wake-up lives under a role and fires on the role's coordinator (who then routes it to an actor) is fully subsumed by the new global mechanism: a global wake-up with a role in its roles list does the exact same thing, cleaner. Migration converts existing per-role specs into global specs; the coordinator's per-role wake-up dispatch code and per-role scheduler spawn get removed.

**The Skynet UI.** A new icon button in the conversation-list header (alongside the existing search, new-conversation, project, roles, and global-files icons) opens a modal.

The modal has two states, same shell:

- **List view** — a filter bar (free-text search over name/prompt, plus filter dropdowns for role and skill), then a scrollable list. Each row shows the wake-up's name as a bold headline, a small dim line beneath with the schedule kind and next fire time, the prompt beneath that as muted body text, and a chip row for the roles and skills. On the right of each row: an enable toggle and a kebab menu (edit, delete). Footer surfaces the count and how many are enabled.

- **Create / edit form** — same modal shell, only the header title changes. Fields, in order: name, prompt, roles (chip picker), skills (chip picker, optional), schedule (segmented control for kind, with contextual detail fields — a time and timezone for daily, a day and time for weekly, an every-N interval for interval, an at-datetime for one-shot). Enabled is NOT in the form (list-view toggle is the only path); delete is NOT in the form (list-view kebab is the only path). Footer: Cancel (left), Save (right, primary).

**Tasting artifact:** prototype.html in the bounty folder — the modal shape above is settled from that iteration.

## Philosophy

**The tissue model, taken seriously.** An identity exists to do one thing and then dies. A wake-up that reaches into an existing identity to give it another thing to do violates that. The correct action for "at this time, this work needs to happen" is "at that time, a fresh identity is born to do this work." Everything else follows from that.

**Everything on disk.** The user's UI and the agents that share the box are two front-ends over the same on-disk state. Neither is authoritative; both simply read and write the files. This is why the user can ask an agent to set up a wake-up on her behalf, or open the modal and do it herself, and the two paths never diverge — there's no state anywhere except on disk. Any design that puts wake-up truth behind an API the agents don't share fails this principle.

**Reuse over invent.** Three mechanisms already exist and are load-bearing for this: the scheduler script the agent-supervisor spawns per identity, the coordinator's create-identity-from-request-file flow, and the clone-picker. This build combines them at a new scope. Nothing about the birthing pipeline, the picker, or the scheduler's schedule-format needs to be reinvented. If something feels like a new mechanism, first check whether an existing one already does it.

**Continuity is not the wake-up system's job.** Recurring wake-ups on the tissue model give you fresh eyes every time. If a job needs the previous run's context, the prompt names the file where that context lives. Building continuity into the wake-up system itself would either duplicate what shared-knowledge mechanisms already do, or worse, create a hidden state channel that competes with them.

**Two paths in, one truth out.** The user's UI and the agent's file access are equal citizens. Neither wins. The whole design collapses if the UI ever holds truth the agent can't see.

**Trim, don't accrete.** Skynet's direction has been to trim surfaces. This adds a modal only because there is no honest place to fit wake-up management into an existing surface — the concept is genuinely global and not scoped to any single conversation, identity, or host row. A modal reached from a header icon (the same pattern search, create-project, edit-roles, and edit-global-files already use) is the smallest addition that carries the feature.

## Prior context

**Current wake-up implementations.** Two file conventions exist today:

- **Per-identity**, at `~/fleet/identities/<name>/wakeups/*.json`. Fires on the running session of that identity — the scheduler prints an instruction line into the harness. This is the "wake myself later" pattern. This build does not touch it.
- **Per-role**, at `~/fleet/roles/<role>/wakeups/*.json`. Fires on the role's coordinator; the coordinator picks an actor identity to route the work to. This build subsumes it and removes it.

**The agent-supervisor's ambient watchers.** The supervisor already spawns per-identity watchers as processes outside any harness: a relay receiver, the wake-up scheduler, a context-pressure watch, a role-file/identity-file watch. The new global wake-up scheduler is the same wake-up scheduler script pointed at a global folder, spawned at a new session-independent scope. The script itself is already dir-agnostic — it takes a folder path and reads specs from `<folder>/wakeups/*.json`.

**Fire semantics that must survive the port.** The existing scheduler has three behaviors that this design assumes stay intact: (1) on first sight of a new spec, it anchors to now and does not fire — creating a schedule is quiet, and a session restart never re-fires a past slot; (2) a slot missed while the box was down fires exactly once as catch-up on next run, never a backlog storm; (3) one-shot specs anchored in the past on first sight fire immediately, and a `.state/<slug>.fired` sentinel prevents double-fire followed by spec self-deletion.

**Identity-birthing already exists.** Coordinators drop a request file that Skynet's backend consumes to create a new identity. That mechanism is what this build's fire path calls. Nothing in the birthing pipeline is new.

**Multi-role identities are on another track.** A separate line of work is bringing identities that carry more than one role and load skills into their context. This build assumes those primitives exist by ship time: the create-identity request file carries a `roles: [...]` list and a skills list, and the birthing machinery applies them. If that track hasn't landed when the wake-up work is ready to ship, the wake-up work waits — the two ship together.

**Skynet is chat-first, trimming surfaces.** The direction has been to remove top-level views, not add them. This work respects that by making the wake-up management a modal reached from a header icon button, following the same convention already established for search, create-project, edit-roles, and edit-global-files. No new top-level view.

**Skynet's in-memory database.** Skynet's DB is decrypted into RAM at startup; writes to it only touch RAM unless an explicit save is triggered. This is the reason wake-up specs live on disk with no DB shadow — files are simpler, agents can touch them without going through the app, and there's no in-memory-write-lost-on-restart risk. Any temptation to give wake-ups a DB table for indexing convenience should be resisted; the modal's list view is at a scale where a directory scan is fine.

**Tasting artifact.** A modal prototype (list view + create/edit form) matched to Skynet's existing modal chrome iterated live during the /open session and settled the modal shape captured above. Prototype lives at `~/fleet/roles/box-maintainer/bounties/wake-ups-redesign/prototype.html`.

## What would make it wrong

- A fired wake-up ever wakes an existing identity instead of birthing a fresh one. The tissue model is the whole point of the redesign; any code path that reaches into a running session for a global wake-up fire misses it entirely.
- Per-role wake-ups continue to work in parallel after migration. Coexistence with the mechanism this build replaces defeats the cleanup that's the whole reason per-role wake-ups are being sunset.
- The UI and the on-disk state ever drift out of sync. If the user creates a wake-up in the modal but an agent scanning the disk doesn't see it, or vice versa, the "two paths in, one truth out" premise is broken and every other guarantee weakens with it.
- The wake-up system quietly provides continuity between fires — carrying "last run" state, remembering prior outputs, inheriting anything at all. That's the prompt author's job through explicit shared-knowledge mechanisms; a hidden channel here creates a second source of truth that competes with the first.
- A recurring wake-up misfires because the box was down at the scheduled moment. The existing scheduler's "one catch-up fire on next boot" behavior must survive the port — no silent missed fires, no backlog storms.
- A one-shot wake-up fires more than once, or fails to self-delete after firing. The existing sentinel pattern must survive.
- A newborn identity begins its work before its roles and skills are actually applied. The birthing machinery has to complete constituting the identity before the prompt reaches it.
- The create/edit modal makes any field feel required that shouldn't be — a wake-up should be authorable without wrestling the schedule fields first, and skills are legitimately optional.
- Delete or enable-toggle affordances end up in the form. Both live on the list view (kebab and toggle respectively) and adding them to the form invites accidental destruction and confusion about where the source of truth is.
- The wake-up list degrades past ~50 items in a way that requires a rewrite to add virtualization. The design shouldn't preclude virtualization later, but at expected scale a plain scroll works and shouldn't be optimized preemptively.
- The modal is reachable only from one very specific screen state. It's global-to-the-host; it should open from wherever the conversation-list header is visible (i.e., always).
- A future agent looks at the on-disk specs and can't tell what the fields do without reading source. Field names must be self-explanatory to a reader coming in cold.

## Scope edges

**In:**
- Global on-disk wake-up spec convention (path and JSON shape mirroring existing per-identity/per-role conventions plus the new roles + skills + name fields).
- Agent-supervisor changes to spawn the wake-up scheduler script at a new session-independent global scope.
- Scheduler changes to drop a create-identity request file at fire time (instead of printing to a running session), pointing at the existing coordinator birthing endpoint.
- Skynet backend endpoints for the modal's CRUD (read the specs directory, create a spec, update a spec, delete a spec, toggle enabled) plus enumeration endpoints the pickers need (roles available on this host, skills available on this host).
- Skynet UI modal: header button, list view, create/edit form, filter bar, enable-toggle, kebab menu, delete flow from kebab.
- One-time migration of existing per-role wake-up specs into the new global convention.
- Removal of per-role wake-up scheduler spawn and per-role coordinator dispatch code.

**Out — assumed to arrive from other tracks:**
- The multi-role identity mechanism itself (identities carrying more than one role).
- The skill-loadout mechanism (what "skills preloaded" means at identity birth).

**Not touched:**
- Per-identity self-scheduled wake-ups — the "wake me later" pattern stays exactly as it is.
- The clone-picker.
- The coordinator's non-wake-up dispatch flows (only per-role wake-up dispatch goes away).
- Any other Skynet surface.

**Deferred / tempting but no:**
- Cross-host wake-ups. Per-host is the whole mental model; cross-host would need routing and identity portability neither of which exist.
- Wake-up templates or duplicate-and-edit. MVP ships without; if the pattern of "make five similar wake-ups" emerges, add it then.
- A history-of-past-fires view. Nice, not shipping in this arc.
- A persistent scratch location the wake-up subsystem provides for recurring fires. Rejected by the philosophy — that's the prompt author's job.
- User-facing notifications when a wake-up fires. The newborn identity appearing in the conversation list is the notification.
- Migration tooling for per-identity self-scheduled wake-ups. They aren't being subsumed; they stay in place.

## Vehicle notes

**Recommended phase split** (three phases, ship in order):

1. **Backend + fleet-substrate scheduler rework + per-role sunset + migration.** The on-disk spec convention, the global-scope scheduler spawned by agent-supervisor, the fire path that drops a create-request file, the migration of existing per-role wake-ups into the new global convention, and the removal of per-role wake-up dispatch code. This is the foundation; the UI has nothing to talk to without it.

2. **Skynet backend CRUD API.** The endpoints the modal calls (list, create, update, delete, toggle), plus the enumeration endpoints for the role and skill pickers. This is a thin layer over the on-disk specs — no DB tables, direct filesystem reads/writes with the standard file-mutation care the app uses elsewhere.

3. **Skynet UI modal.** The header button, list view, create/edit form, filters, enable-toggle, kebab menu, delete flow. Tasting artifact at `~/fleet/roles/box-maintainer/bounties/wake-ups-redesign/prototype.html` is the settled shape.

**Handoff pointers:**
- Bounty for this build: `~/fleet/roles/box-maintainer/bounties/wake-ups-redesign/` — holds the tasting prototype and this build's ongoing scratch.
- Multi-role identity work is a prerequisite for phase 1's fire path to actually work end-to-end; coordinate before starting phase 1 to confirm the request-file schema (roles list + skills list) it will produce is what the birthing machinery expects to receive.
- Container-mutation serialization applies to the deploy of phase 2 and phase 3 (they touch Skynet); phase 1 primarily touches fleet-substrate files distributed by the distributor and needs no container work beyond whatever coordinator-birthing endpoint updates phase 1 makes to Skynet's backend.
