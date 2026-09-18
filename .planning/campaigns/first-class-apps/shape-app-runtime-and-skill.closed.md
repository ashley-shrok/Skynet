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

---

## Close-Out

**Closed:** 2026-09-18
**Vehicle used:** inline
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · A single canonical skill that teaches agents to build a user-facing app on their box, following a fixed on-disk shape.
- **Shape: where apps live** — present · Apps live under a canonical top-level folder on the agent's box, with siblings for archive and safety snapshots.
- **Shape: metadata file** — present · Two-field metadata (title + description) inside each app folder; slug from folder name, port from the systemd unit, icon from a conventional filename, created-at from folder timestamp.
- **Shape: the stack** — present · Bun runtime, SvelteKit framework, Tailwind styling, Drizzle over SQLite, adapter-node in production. No menu.
- **Shape: process model** — present · One systemd `--user` unit per app, one port per app in the 9501-9599 range, linger enabled, port owned by the unit and not repeated in metadata.
- **Shape: authentication** — present · Skill says the app builds no auth; the edge upstream is the security boundary; reflex trigger warns against writing a login form.
- **Shape: the skill (name + locked description)** — present · Skill named `app-development`; description present verbatim as agreed.
- **Shape: bundled helpers** — present · All five present (bootstrap, create-app, archive-app, restore-app, backup-app) doing what the shape described.
- **Shape: starter template** — present · Working small to-do-list app with framework skeleton, Tailwind, Drizzle schema, initial migration pre-shipped in `drizzle/`, systemd unit template with substitution markers. (Fix applied post-review: the initial migration is now pre-generated in the template rather than generated at scaffold time.)
- **Shape: iteration workflow** — present · Two modes taught explicitly — production under systemd and dev-mode foreground with hot reload — plus the rhythm to move between them.
- **Shape: backup-before-editing** — present · Skill teaches snapshotting the app before risky edits; appears in reflex-trigger list.
- **Shape: removal — archive by default** — present · Archive is the taught default; hard-delete only on explicit user request, and even then mention what you're doing.
- **Shape: distribution** — present · Entire skill folder registered in the substrate distributor's catalog; rides the next sweep to every managed box.
- **Philosophy: the convention IS the API** — present · No registry, no registration endpoint — disk is the truth.
- **Philosophy: one canonical stack, not a menu** — present · Skill body explicitly forbids stack branching and calls out temptations.
- **Philosophy: zero drift by construction** — present · Every fact lives in one place; the folder name IS the slug, the unit IS the port authority, the metadata file only carries what has no natural home elsewhere.
- **Philosophy: archive, don't delete** — present · Archive is the taught reflex; hard-delete is the explicit exception.
- **Philosophy: edge handles auth; apps don't** — present · Called out in the skill body and reflex-trigger list.
- **Philosophy: build-step tax accepted deliberately** — present · Skill body implicitly accepts the tax by walking through the build and per-app dependency install.
- **Philosophy: starter is bigger than the archive's, and that's fine** — present · Starter ships as a full working small app across many files.
- **Prior context: reuse durable parts, reverse the parts that don't scale** — present · No portal, no shared registry, no hand-written SQL; per-app SQLite + per-app systemd unit + linger + port range + numbered-migration pattern retained.
- **Scope edges (in): new skill file with full body** — present.
- **Scope edges (in): five bundled helper scripts** — present.
- **Scope edges (in): starter template as working small app** — present.
- **Scope edges (in): substrate distributor catalog entry** — present · 26 rows registered (one per file, matching the byte-compare mechanism).
- **Scope edges (in): end-to-end verification on this box** — present · The full create → serve → POST persist → backup → archive → restore (same port, data preserved) → hard-delete flow was walked twice on this box during the session; the second walk verified the post-fix behavior. Ashley witnessed both.
- **Scope edges (out): sweep, sidebar, main-pane leaf, image-gen deferred** — present · None crept in.
- **Scope edges (tempting but no): no UI style prescribed beyond Tailwind + desktop-and-phone** — present.
- **Scope edges (tempting but no): no extra metadata fields** — present · Exactly title + description; reflex trigger against adding fields.
- **Scope edges (tempting but no): no dev-vs-prod systemd unit** — present · Only production unit; dev mode is foreground.
- **Scope edges (tempting but no): only Bun runtime** — present.
- **Scope edges (tempting but no): only SQLite database** — present.
- **Scope edges (tempting but no): no cross-app plumbing** — present.
- **What would make it wrong: an agent building auth into an app** — present · Dedicated section plus reflex trigger.
- **What would make it wrong: metadata file getting bigger over time** — present · Two-fields-forever rule + reflex trigger.
- **What would make it wrong: someone parsing the README for anything the client renders** — present · README framed as maintainer documentation; the metadata file is the source of truth for the tile.
- **What would make it wrong: a shared registry file coming back** — present · No registry file; reflex trigger against portal-like listings.
- **What would make it wrong: editing an already-applied migration** — present · Skill body and reflex triggers explicitly forbid this; workflow generates new numbered migrations on schema changes.
- **What would make it wrong: create step hardcoding IP/user/box-specific state** — present · Unit template uses substitution markers only; runtime knobs from env; nothing box-specific.
- **What would make it wrong: a silent hard-delete** — present · Archive is the taught default; hard-delete requires explicit user request and a mention.
- **What would make it wrong: two agents racing on the same port** — present · Create helper takes an exclusive lock, scans existing units, writes the new unit file under the lock — closing the race by the filesystem.
- **What would make it wrong: starter template drifting from the skill body** — present · Starter's structure and behavior match the skill body — Bun scripts, SvelteKit routes, Drizzle schema location, systemd unit template, viewport meta, Tailwind wiring.
- **What would make it wrong: editing an existing app without backing up first** — present · "Back it up FIRST" is step 2 of the edit recipe, plus a reflex trigger.

### Additions (in the result, not in the shape)

- Framework config disables the built-in same-origin check on form submissions — accepted-as-sanctioned-drift (in-the-spirit-of-shape: the auth story says the app trusts every arriving request; enforcing same-origin would reject proxied requests the client already gated).
- Archive step stashes a copy of the retired app's systemd unit file inside the archived folder so restore can bring it back on its original port — accepted-as-drift (natural consequence of preserving port stability across archive/restore, which the shape implies).
- Restore step refuses when the original port is now in use by another app on the box — accepted-as-drift (necessary corollary of the port-stashing choice above; hard-failing beats silent reallocation).
- Icon fallback chain widened to three formats — FIXED post-review (narrowed back to `icon.webp` only, matching the shape exactly).

### Follow-ups

- Pre-generated initial migration not shipped in the starter template (starter description said "first migration generated") — FIXED post-review (initial migration now ships in `templates/app-starter/drizzle/`; create-app.sh no longer runs the generate step).
- End-to-end verification "cannot-verify" from disk alone (folders empty) — RESOLVED (Ashley was in the session and witnessed the full E2E walk on this box, twice: once for the original commit and once for the post-fix commit).
- CSRF-check-disabled as a security-posture decision worth naming explicitly — endorsed as sanctioned drift; the trade is documented inline in the framework config file's comment and is in the spirit of the shape's auth story.

### Notes

Overall the material conforms strongly to the shape — the on-disk convention, the stack, the process model, the metadata contract, the five helpers, the skill body's reflex triggers, and the catalog registration are all present and match. The port-race guard uses exactly the pattern the shape called for (exclusive lock plus write-the-unit-under-the-lock). The reflex-trigger list is thorough and covers every failure mode the shape named. Three small design details that were made below the shape's resolution and are now recorded here as accepted-as-drift: the same-origin-check disable, the archive-stash-inside-folder mechanism, and the restore-refuses-on-port-collision behavior. Two divergences were fixed post-review to bring the material back into strict conformance: the icon fallback chain (narrowed) and the pre-generated initial migration (now ships in the template).
