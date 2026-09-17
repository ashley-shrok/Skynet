# Shape: The `app-development` skill and the on-disk convention for apps in the fleet

**Opened:** 2026-09-17
**Vehicle:** inline

## What this is

The first-class-apps campaign is about making apps a durable concept in Skynet — same shape of concept as identities, discovered by the fleet-status sweep, visible in the sidebar. This shape delivers the piece that runs on each agent's box: the canonical location on disk where apps live, the process model each app follows, and the single skill every fleet agent uses to build one. Everything downstream — Skynet's sweep learning to enumerate them, the sidebar surface, the app-as-content-type — assumes this piece is in place.

An agent on any fleet box can respond to a user request like "throw together a tool that tracks X" or "make me a page that graphs Y" by following one canonical recipe. The recipe teaches the on-disk conventions, the stack, the process supervision, the iteration workflow, the archive-and-remove flow, and the reflexes that keep agents from reinventing things that already work.

## Shape

**Where apps live.** Under `~/fleet/apps/<slug>/` on the agent's box. The folder is the app: it holds the code, its own small database, its own static content, its own systemd unit template, and a tiny metadata file naming the two things the sidebar needs to render a tile. Alongside `~/fleet/apps/` sit two sibling folders: `~/fleet/apps-archive/` (where retired apps go instead of being deleted) and `~/fleet/apps-backups/` (where an agent snapshots an existing app before making changes that could break it).

**The metadata file.** `app.json` inside the app folder holds just two fields: the title the sidebar tile shows, and the one-line description under it. Every other fact Skynet needs is auto-derived from a file that already has to exist — the slug is the folder name, the port lives in the systemd unit, the icon is a conventional filename (`icon.webp` in the app folder, or a generic glyph if missing), the creation timestamp is the folder's own. Two-field metadata means agents almost can't make it drift.

**The stack.** Bun for runtime, SvelteKit for the app framework, Tailwind for styling, Drizzle for the database layer, SQLite as the actual store, `adapter-node` running under Bun as the production adapter. Every app looks the same shape — a SvelteKit project with a `src/routes/` for pages and endpoints, a Drizzle schema file, generated numbered migration files, and a small handful of config files at the root.

**Process model.** One process per app, one systemd `--user` unit per app, one port per app in the 9501-9599 range. Linger is enabled so the units survive logout. The port is owned by the unit file — the metadata file doesn't repeat it.

**Authentication.** The app builds none. Skynet's edge gates who can reach the app before the request ever hits the process; from the app's perspective every request that arrives is already authorized. The skill body says this in plain language so agents don't reflexively wire up a login form.

**The skill.** A single canonical skill called `app-development`, shipped by the substrate distributor to every managed box. Its description is locked verbatim: *"Builds a new app, or edits an existing one. Use when the user asks for an app, tool, tracker, dashboard, log, or webpage for a specific purpose, or asks to edit, tweak, or add features to an existing app."* One skill for both making and editing — the edit path is the same skill invoked a second time.

**Bundled helpers.** Where the work is generic and every agent has to do it the same way, the skill ships a helper script:

- `bootstrap.sh` — first-app-on-a-box: install Bun if missing, ensure tailscale is up, create the three top-level folders, enable linger. Idempotent.
- `create-app.sh <slug> [title]` — allocate the next free port in the range, scaffold the starter template, wire up dependencies, render + install the systemd unit, start the service, verify it's live.
- `archive-app.sh <slug>` — stop and disable the unit, remove the unit file, move the app folder into `apps-archive/`.
- `restore-app.sh <slug>` — inverse of archive.
- `backup-app.sh <slug>` — snapshot the app folder (and the unit file) into `apps-backups/<slug>-<timestamp>/` before making risky changes.

Where the work is app-specific — designing the actual app's schema, writing the pages, choosing what routes to expose — the skill body walks the agent through the moves in prose. No script to lean on because every app is different there.

**Starter template.** A real functioning small app inside the skill folder — probably a to-do list, mirroring the archive's demo. Agents copy it into `~/fleet/apps/<slug>/` and edit it down to their actual app. Everything wired up: SvelteKit skeleton, Tailwind configured, Drizzle schema with a starter table, first migration generated, systemd unit template with substitution markers.

**Iteration workflow.** Two modes:

- **In production**, the app runs from the built output under systemd. Silent, restarts on crash, survives logout.
- **While iterating**, the agent stops the systemd unit, runs the app in dev mode for hot-reloading, iterates until happy, builds the production output, restarts the systemd unit. The skill teaches this rhythm.

**Backup-before-editing.** The skill teaches agents to run `backup-app.sh <slug>` before editing an existing app in any way that could corrupt data or lose work. A reflex trigger, right in line with the other "when you catch yourself about to X, stop" reminders.

**Removal.** Archived by default. Only if the user explicitly says "delete" does an agent actually remove the folder; even then, archiving first and mentioning it beats surprising the user.

**Distribution.** The whole skill folder — SKILL.md, helpers, starter template — lives under Skynet's substrate directory and rides the substrate distributor's next sweep to every managed box.

## Philosophy

**The convention IS the API.** Skynet doesn't ask agents to register apps or hit an endpoint; agents write the disk, Skynet reads the disk. Everything downstream flows from that. This is the same model that already works for identities — no registry, no push, no schema — and applying it to apps is what makes the whole first-class-apps concept feel native rather than bolted on.

**One canonical stack, not a menu.** Every agent uses Bun + SvelteKit + Tailwind + Drizzle + SQLite. No "pick your framework" branch. Consistency is what lets a future agent open any app on any box and immediately know where things are.

**Zero drift by construction.** Every fact lives in exactly one place — the folder name IS the slug, the systemd unit IS the port authority, the README is documentation, the metadata file is only for what has no natural home elsewhere. Nothing to keep in sync.

**Archive, don't delete.** Users who ask to delete something sometimes change their minds. Archiving costs nothing and preserves the option.

**Skynet handles auth; apps don't.** The skill says this out loud in the reflex triggers, so agents don't reflexively add a login form.

**No build step in the archive was philosophical, and reversing it is also philosophical.** We're deliberately taking the tax (a Vite build, a `node_modules/` per app) in exchange for a modern component model, real reactivity, and HMR while iterating. Worth naming so we're eyes-open about the trade.

**The starter template is bigger than the archive's, and that's fine.** The framework's structure IS the pattern, and having 20+ files in front of the agent is arguably clearer than hiding conventions in shorter scaffolding.

## Prior context

The archived `web-app-development` skill (at `/tmp/apps-archive/web-app-development/` on this box) established the concept. It ran on Bun + native SQLite + plain HTML + a shared `registry.json` + a portal app on port 9500 that listed the others. This shape treats the archive as reference — takes the durable parts (Bun, per-app SQLite, per-app systemd unit, linger, numbered-migration pattern, port range) and reverses the parts that don't scale (plain HTML + vanilla JS, hand-written SQL migrations, shared registry file, portal app). The portal is deleted because Skynet's sidebar surface (shape 3 of this campaign) does that job now, and the tailnet-IP framing in the create step goes away because agents no longer hand users a direct URL.

The existing fleet-substrate distribution model already handles the shipping side: `substrate/skills/` in the Skynet repo contains skill folders that the distributor sweep pushes to every managed box on its own schedule. The new `app-development/` folder rides that machinery unchanged.

Identity folders under `~/fleet/identities/` and their `~/fleet/identities-archive/` sibling are the model for the `apps/` / `apps-archive/` / `apps-backups/` layout.

## What would make it wrong

- **An agent building auth into an app.** Skynet's edge already does that, and adding a second layer confuses the user and makes the tile harder to open cleanly. If a "log in" form ever appears in one of these apps, this has missed the point.
- **The metadata file getting bigger over time.** Two fields today; the temptation will be to add a third, then a fourth. Every added field is a new drift risk. Additions should be argued for from an actual need, not a guess.
- **Someone parsing the README for anything Skynet renders.** README is for the agent maintaining the app; it's not a source of truth for the tile. If the sidebar starts pulling text out of README, we've made drift possible again.
- **A shared registry file coming back.** The whole design turns on "disk is truth, no shadow copies." A `registry.json` at the parent level, or anything analogous, silently reintroduces the drift problem the archive had.
- **An app editing a migration that's already been applied.** Migrations are additive and forever; change the schema file and generate a new numbered file. If an applied migration gets edited, an agent restoring from backup or replaying migrations will end up in a divergent state.
- **A create step that hardcodes something the systemd unit or the app needs at runtime.** Every path in the unit is a substitution slot; every runtime knob comes from env; the create step just fills them in. If any part of the setup bakes in a specific box's IP or user, distribution breaks.
- **A silent hard-delete.** If a user says "get rid of this" and an agent skips archive, the option to recover is gone. Archive is the taught default.
- **Two agents on the same box creating apps at the same time both grabbing the same port.** Rare in practice, but the create helper needs to pick the port and immediately claim it (drop the systemd unit file with that port before the next agent can pick the same number) so the race is closed by the filesystem itself.
- **The starter template drifting from the skill body.** If SKILL.md says one thing and the starter shows another, the starter is what agents actually run. The two need to match, and updates to conventions should touch both in the same change.
- **An agent editing an existing app without backing up first.** If work gets lost or data gets corrupted mid-edit, and there's no snapshot, the user pays for it. The reflex is there for a reason.

## Scope edges

**In:**

- The new `app-development` skill file with the full skill body.
- The five bundled helper scripts (bootstrap / create / archive / restore / backup).
- The starter template as a working small app with all the framework pieces wired up.
- One entry in the substrate distributor's catalog registering the new skill folder.
- End-to-end verification on this box: create a real test app, walk the create → edit → backup → archive → restore → hard-delete flow, verify each step, remove the test app cleanly.

**Out (deferred to later shapes in this campaign):**

- Skynet's fleet-status sweep learning to enumerate `~/fleet/apps/*/` on managed boxes — shape 2.
- The read-only API endpoint that returns the fleet-wide app list — shape 2.
- The sidebar apps section rendering — shape 3.
- Apps as a leaf content type in the main pane — shape 4.
- The image-generation skill that would eventually produce app icons — Ashley handling separately, out of this campaign entirely.

**Tempting but no:**

- Prescribing a specific UI style beyond Tailwind + "make it usable on desktop and phone." Beyond that agents design each app.
- A metadata field for updated-at, version, author-email, tags, or anything else that can drift or duplicate another file's fact.
- A dev-mode-vs-prod-mode systemd unit — the unit only runs prod; dev mode is a foreground process when iterating.
- Support for multiple runtimes (only Bun).
- Support for other databases (only SQLite).
- Multi-app cross-references, shared state, or app-to-app communication — out of scope for this whole campaign.

## Vehicle notes

**Inline in this session.** Ashley explicitly wants to walk through the development one step at a time rather than delegate to a phase executor, because this work is skill-writing and fleet-substrate rather than straight app-code — an odd-one-out for the fleet's usual pattern. Approximately 1M tokens of context runway available on Opus 4.7.

**No plan mode, no /gsd:quick, no GSD phase.** All three delegate too much: plan mode adds a gate between us that we don't need, /gsd:quick and GSD phase dispatch to executors that would work autonomously. Inline is the shape of "we do this together."

**Working tree.** `~/skynet-vision` on branch `feat/tab-title-from-tmux`. Campaign artifact + this shape file committed to that branch. No branch dance needed.
