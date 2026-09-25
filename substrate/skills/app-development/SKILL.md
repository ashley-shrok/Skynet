---
name: app-development
description: |
  Builds a new app, or edits an existing one. Use when the user asks for an
  app, tool, tracker, dashboard, log, or webpage for a specific purpose, or
  asks to edit, tweak, or add features to an existing app.
---

# app-development

## What this skill builds

Apps live on your box, on disk, under a canonical location. The front-end
client the user is on auto-discovers them and lists them in her sidebar.
Every user sees the apps hosted on boxes she has access to, and only those
apps. Clicking a tile opens the app; dragging one into a split opens it as a
leaf; right-clicking gets an "open in new tab" affordance.

Your job with this skill is to build one such app when the user asks —
"throw together a tool that tracks X", "make me a page that graphs Y",
"give me a dashboard for Z", "log every W" — or to edit an existing app
when she asks for changes to something you or another agent made before.

**The sidebar tile IS the access path.** Users open apps through their
tile in the sidebar — click to open, drag into a split to open as a
leaf, right-click for "open in new tab". URLs to apps DO work (the
tile's "open in new tab" affordance is exactly a link to the app's
URL, and that's a valid path), but do NOT hand the URL out yourself.
On some clients — notably the iOS PWA — an app opened by URL renders
incorrectly, whereas opening through the tile works everywhere. When
you finish, tell the user the app is ready and name the tile; that's
the handoff.

**Publishing (§ Making a new app step 8) is what makes the tile appear
and is deferred until the app is verified end-to-end** — otherwise a
half-built app flashes onto her sidebar and invites a click that hits
a broken page. If she needs to see a work-in-progress version before
it's done, publish it anyway (rename `app.json.pending` → `app.json`)
so it reaches her as a tile — do NOT fall back to handing her a URL
as the WIP-access mechanism. The rule "tile, not URL" holds for
finished apps AND for WIP the user needs to poke at early.

## The stack — one canonical shape, not a menu

Every app uses the same stack. No branches, no "pick your framework". This
consistency is what lets a future agent open any app on any box and
immediately know where things are.

- **Runtime:** Bun.
- **Framework:** SvelteKit with Svelte 5.
- **Adapter:** `@sveltejs/adapter-node`, running its built output under Bun.
- **Styling:** Tailwind CSS.
- **Database:** SQLite via `bun:sqlite`, accessed through Drizzle ORM.
- **Migrations:** Drizzle Kit generates numbered SQL migration files from the
  TypeScript schema. Never hand-write migration SQL.

If you catch yourself reaching for React, Next.js, Express, Prisma, Postgres,
htmx, or a bundler other than Vite — stop. The stack is what the stack is.

## On-disk layout

**Every app lives at `~/fleet/apps/<slug>/`** on the agent's box. The folder
is the app: it holds the code, its own SQLite database, the systemd unit
template, and a tiny metadata file. No shared registry, no per-app database
elsewhere on disk, no configuration outside the folder.

Three top-level folders sit under `~/fleet/`:

- **`~/fleet/apps/`** — active apps. The front-end client's fleet sweep
  enumerates this folder to build the sidebar tile list.
- **`~/fleet/apps-archive/`** — retired apps. Same structure as `apps/` but
  ignored by the sweep. Where apps go when a user says "get rid of X".
- **`~/fleet/apps-backups/`** — safety snapshots taken before risky edits.
  Ignored by the sweep. Each snapshot is a full copy of an app folder plus a
  copy of its systemd unit, named `<slug>-<timestamp>/`.

`~/fleet/apps/`, `~/fleet/apps-archive/`, and `~/fleet/apps-backups/` are
created by `bootstrap.sh` on first use. If they don't exist yet, you haven't
run bootstrap.

## The metadata file — `app.json`

Inside every app folder sits `app.json`, holding exactly two fields:

```json
{
  "title": "Birthdays",
  "description": "Track birthdays and remind you a week ahead."
}
```

That's it. `title` is what shows on the sidebar tile; `description` is the
one-liner under it. Every other fact the client needs is derived from a
file that already has to exist:

- **Slug** — the folder name (`birthdays`).
- **Port** — the systemd unit file (grep for `PORT`).
- **Icon** — a conventional filename in the app folder. The client looks for
  `icon.webp`. If it doesn't exist, the client renders a generic app glyph.
  If an agent has an icon in another format, convert it to `.webp` before
  dropping it in — one filename, no drift.
- **Created-at** — the folder's filesystem timestamp.

Do NOT add fields to `app.json`. Two fields today, two fields forever. The
whole design of the metadata file is "only what has no natural home
elsewhere". Every added field is a new drift risk.

**`app.json` is also the sidebar-visibility switch.** The sweep only
emits a tile when `app.json` exists and parses. `create-app.sh` therefore
does NOT write `app.json` — it writes `app.json.pending` (same shape,
title pre-filled) and leaves it that way. The app is running under
systemd from the moment `create-app.sh` finishes, but the user cannot
see it. Renaming `app.json.pending` → `app.json` is the explicit
"publish" step, done ONLY when the app is complete and verified end-to-end
(§ Making a new app step 8). This prevents a half-built app from flashing
onto her sidebar and inviting a click that hits a broken page.

For **editing** an existing app, this doesn't apply — its `app.json`
already exists (it's already on her sidebar). Only NEW apps go through
the pending flow.

## Lifecycle — the five helpers

Every generic step in an app's life is a bundled helper script alongside
this file. Where the work is app-specific (designing the schema, writing the
pages), the skill walks you through it in prose below. The helpers handle
everything else.

- **`bootstrap.sh`** — first-app-on-a-box setup. Idempotent. Installs Bun if
  missing, creates the three top-level folders, enables linger so systemd
  `--user` units survive logout. Run this once before creating your first
  app on any box.

- **`create-app.sh <slug> [title]`** — allocates the next free port in the
  9501-9599 range, scaffolds the starter template into `~/fleet/apps/<slug>/`,
  installs dependencies, writes `app.json.pending` (the app stays invisible
  to the sidebar until you rename it to `app.json` at publish time),
  renders + installs the systemd unit, starts the service, verifies it's
  live. Slug must be kebab-case. Title is optional; defaults to a
  title-cased slug if omitted.

- **`archive-app.sh <slug>`** — stops the systemd unit, disables it, removes
  the unit file, runs `daemon-reload`, moves `~/fleet/apps/<slug>/` to
  `~/fleet/apps-archive/<slug>/`. This is the default remove path. Users who
  ask to delete something sometimes change their minds.

- **`restore-app.sh <slug>`** — inverse of archive. Moves the folder back
  from `apps-archive/` to `apps/`, re-renders + installs the systemd unit,
  starts the service. Use when the user changes her mind.

- **`backup-app.sh <slug>`** — snapshots `~/fleet/apps/<slug>/` and the
  systemd unit file into `~/fleet/apps-backups/<slug>-<timestamp>/`. Restoring
  from a backup is a manual step; the backup is a safety net, not a formal
  lifecycle state.

## Making a new app — the recipe

1. **Bootstrap if needed.** If `~/fleet/apps/` doesn't exist, run
   `bootstrap.sh`. Skip if it already exists.
2. **Pick a slug** — kebab-case, meaningful in three months. `grocery-list`,
   not `app1`. It becomes the folder name and the systemd unit name.
3. **Pick a title** if you want one different from the slug. This is what
   the sidebar tile shows.
4. **Run the create helper:**

       bash ~/.claude/skills/app-development/create-app.sh <slug> "<title>"

   That does the whole scaffold-plus-install cycle. Log tail from the helper
   tells you the assigned port and confirms the service is live.
5. **Edit the starter down to your app.** The starter is a working small
   app (a to-do list) with its initial migration already generated in
   `drizzle/`. When the service first boots, that migration runs and the
   starter's `todos` table gets created. Read the starter end-to-end first —
   the framework's structure IS the pattern you're following. Then edit:
   - `src/lib/server/db/schema.ts` — replace the starter table with your
     app's real schema. Change or remove `todos`; add whatever you need.
   - After the schema is settled, generate a new migration:
     `bun run db:generate` — Drizzle emits a new numbered migration file
     under `drizzle/`. Never hand-write migration SQL. On next restart the
     migration runs and your schema catches up.
   - If you're swapping the schema out entirely early on — before you've
     grown attached to any data — a cleaner move is to start fresh: stop
     the service, delete `db.sqlite*` and the shipped `drizzle/0000_*.sql`
     plus `drizzle/meta/`, then edit the schema and run `bun run db:generate`
     for a clean first migration. Avoids stacking "create todos" on top
     of "drop todos and create yours" in the migration history.
   - `src/routes/+page.svelte` — replace the starter page with your app's
     UI. Tailwind is loaded and configured; use it.
   - `src/routes/+page.server.ts` — replace the starter's load function
     and form actions with your app's real server logic.
   - `README.md` — write what the app is, in one paragraph. Aimed at a
     future agent who might edit it.
   - `app.json.pending` — fill in the `description` field. Leave the
     filename as `.pending` for now; it gets renamed at publish (step 8).
6. **Iterate.** See § Iteration workflow.
7. **Verify.** Once it looks right in dev mode, build the production output
   and restart the systemd unit:

       cd ~/fleet/apps/<slug>
       bun run build
       systemctl --user restart app-<slug>

   Then confirm it's live: `systemctl --user status app-<slug>` should read
   `active (running)`. Open the app yourself (dev mode or a local
   `curl 127.0.0.1:<port>`) and walk the golden path — this is the last
   moment before it goes on the user's sidebar. If anything is still
   broken, do NOT continue to step 8.
8. **Publish.** This is the moment the tile appears on the user's sidebar.
   Only do this once step 7 has actually passed:

       mv ~/fleet/apps/<slug>/app.json.pending ~/fleet/apps/<slug>/app.json

   The front-end client's next sweep picks it up. Tell the user the app
   is ready and name the tile ("your `Birthdays` tile is on the sidebar
   now") — do NOT hand her a URL (see § What this skill builds).

## Iteration workflow — dev mode vs prod

Two modes:

- **Production** — the app runs from its built output under systemd. Silent,
  restarts on crash, survives logout. This is what a user sees. `ExecStart`
  in the unit is `bun ./build/index.js`; the output was produced by
  `bun run build`.

- **Dev mode** — Vite dev server with hot module reload. Sub-second updates
  on file changes. This is what YOU use while iterating.

The rhythm:

    systemctl --user stop app-<slug>
    cd ~/fleet/apps/<slug>
    bun run dev
    # edit files; browser refreshes automatically
    # ctrl-c when done

    bun run build
    systemctl --user start app-<slug>

Don't leave the app in dev mode. Dev mode has no supervision — if it
crashes it stays down. Production mode runs under systemd with
`Restart=always`, which is what the user needs.

## Editing an existing app

If asked to modify an existing app:

1. **Find it.** `ls ~/fleet/apps/` for the list; the folder is the slug.
2. **Back it up FIRST.** Before any editing that could corrupt data or lose
   work:

       bash ~/.claude/skills/app-development/backup-app.sh <slug>

   The snapshot lands in `~/fleet/apps-backups/<slug>-<timestamp>/`. If the
   edit goes sideways, you can `cp -r` the snapshot back and restart the
   unit. Backing up costs seconds; not backing up costs the user's data.
3. **Read what's there.** Start with `README.md`, then `app.json`, then the
   Drizzle schema, then the routes. Get oriented before you change anything.
4. **Make the changes.** Use dev mode for iteration.
5. **If the schema changes,** generate a new migration:

       cd ~/fleet/apps/<slug>
       bun run db:generate

   Drizzle emits `drizzle/NNNN_<hash>_<name>.sql` — numbered forever
   forward. NEVER edit a migration that's already been applied. Migrations
   are additive and immutable.
6. **Build and restart** as in § Making a new app step 7.
7. **Update `README.md`** if the app's behavior changed enough to matter.

## Persistence — Drizzle + SQLite + numbered migrations

- One `db.sqlite` per app, in the app's own folder. Never shared.
- **WAL mode** and **foreign keys on** — both set at boot in the DB init.
- Schema is `src/lib/server/db/schema.ts` — TypeScript source of truth.
  Drizzle's `sqliteTable` builder defines each table.
- **Migrations** are generated by `bun run drizzle-kit generate` from the
  schema. Numbered `NNNN_<hash>_<name>.sql` files under `drizzle/`.
- Migrations run automatically at app boot via Drizzle's migrator. First run
  applies all migrations in order; subsequent runs apply only new ones.
- **Never edit an applied migration.** If you need a schema change, change
  the schema file and generate a new migration.
- **Type-safe queries.** `db.select().from(users).where(eq(users.id, id))`
  is fully typed by Drizzle. Prefer the query builder over raw SQL.

## Serving — SvelteKit + adapter-node + loopback binding

- SvelteKit's `+page.server.ts` and `+server.ts` handle server logic. Load
  functions for GET reads; form actions for form submissions; `+server.ts`
  for JSON endpoints when a route needs to be pure API.
- `@sveltejs/adapter-node` builds to `./build/index.js`. Bun runs the output
  directly — Bun implements enough Node APIs that adapter-node's output runs
  unchanged.
- **The app binds to `127.0.0.1`, not `0.0.0.0`, and not any external
  address.** `adapter-node` reads `HOST` and `PORT` from env; the systemd
  unit sets `HOST=127.0.0.1` and `PORT` to the allocated port. Loopback-only
  means the socket is only reachable from processes on the same box — the
  front-end client reaches the app through the transport it already uses to
  manage this box, so no external network exposure is needed. Never bind to
  `0.0.0.0` — that would expose the app to any network the box happens to
  be on.

## The systemd unit

The starter includes `app-SLUG.service.template` with substitution markers
`__SLUG__`, `__APP_DIR__`, `__HOST__`, `__PORT__`. The `create-app.sh`
helper renders it in place and installs the result to
`~/.config/systemd/user/app-<slug>.service`.

Key directives and why they matter:

- `Restart=always` + `RestartSec=2` — a crash comes back in about two
  seconds.
- `KillMode=control-group` + `KillSignal=SIGTERM` + `TimeoutStopSec=10` —
  kills the whole process tree on stop. Without this, a child spawned by
  Bun can outlive its parent and hold the port on restart.
- `Environment=HOST=127.0.0.1` + `Environment=PORT=<port>` — the only
  runtime knobs. The app hardcodes nothing.
- `StandardOutput=journal` + `SyslogIdentifier=app-<slug>` — logs go to the
  user's journal, viewable with `journalctl --user -u app-<slug> -f`.
- `WantedBy=default.target` + linger enabled = starts on user login,
  survives logout, comes back on reboot.

Common commands:

- **Restart after code changes:** `systemctl --user restart app-<slug>`
- **Stop:** `systemctl --user stop app-<slug>`
- **Status:** `systemctl --user status app-<slug>`
- **Tail logs:** `journalctl --user -u app-<slug> -f`

Never `pkill bun` — it kills every app on the box.

## Links inside the app — root-absolute paths break the pane

When the user opens your app through its tile, the front-end client
renders it in a proxied iframe pane mounted at a path prefix (something
like `/apps/<hostId>/<slug>/pane/`). To make relative URLs resolve
inside that prefix, the client's proxy injects `<base href="…/pane/">`
into your HTML's `<head>` — so `<a href="page">` and `fetch("api/foo")`
resolve into the app.

**The trap:** HTML `<base>` only affects RELATIVE URLs. Root-absolute
URLs (leading `/`) are resolved against the document's ORIGIN per URL
spec — they bypass `<base>` entirely. So `<a href="/settings">` navigates
the iframe back to the CLIENT's root, not into your app.

**Rule: never use a leading `/` on URLs that target your own app.**
Write them relative:

- `<a href="settings">` — not `<a href="/settings">`
- `fetch("api/foo")` — not `fetch("/api/foo")`
- `<img src="logo.svg">` — not `<img src="/logo.svg">`

Same rule for `<script src>`, `<link href>`, `<form action>`, and every
other URL-carrying attribute. If a URL targets your own app, no leading
slash. External URLs (`https://…`, `//example.com/…`) work as-is.

## Authentication — the front-end client handles it, you don't

The user reaches the app through the front-end client she's using, which
has already gated who can see which boxes and which apps on those boxes.
**From the app's perspective, every request that arrives is already
authorized.** You do not build a login form, you do not check session
cookies, you do not check API keys, you do not check any authorization
header. The client's edge is the security boundary; the app is downstream
of that boundary.

If you catch yourself about to write a login form or an auth middleware,
stop. That's not what these apps do.

## Desktop and mobile

Users hit these apps from both a desktop browser and a phone. Make them
usable on both.

- Include `<meta name="viewport" content="width=device-width,initial-scale=1" />`
  in `src/app.html`. The starter has it already.
- Use Tailwind's responsive utilities (`sm:`, `md:`, `lg:`). Design for
  narrow widths first, add larger-breakpoint refinements on top.
- Set a comfortable max-width on the main container (Tailwind's `max-w-2xl`
  or `max-w-3xl` is a good range) so lines don't run edge-to-edge on
  desktop.
- Prefer `rem`/`em` for spacing. Base font 16px or larger.

## Removing an app

**Archive by default.** Users who ask to delete something sometimes change
their minds. The archive path costs nothing and preserves the option.

    bash ~/.claude/skills/app-development/archive-app.sh <slug>

If the user later says "wait, I want that back":

    bash ~/.claude/skills/app-development/restore-app.sh <slug>

Only if the user explicitly says "delete it, I don't want it recoverable"
do you actually remove the folder from `apps-archive/`. Even then, mention
what you're doing — surprises here are worse than a moment of confirmation.

## Reflex triggers — when you catch yourself about to X, stop

- About to write `localStorage.setItem("data", …)` for anything that
  matters → **stop.** It goes in the SQLite database.
- About to `npm install express` or `bun add express` → **stop.**
  SvelteKit's server handlers are the HTTP layer.
- About to write a login form or wire up sessions → **stop.** The front-end
  client handles auth. Apps see already-authorized requests.
- About to bind to `0.0.0.0` "so it works everywhere" → **stop.** Bind to
  `127.0.0.1`. `0.0.0.0` exposes the app to any network the box happens to
  be on. The front-end client reaches the app through its own transport;
  the app never needs an externally-reachable socket.
- About to hand-write a migration SQL file → **stop.** Change
  `src/lib/server/db/schema.ts` and run `bun run drizzle-kit generate`.
- About to edit a migration that's already been applied → **stop.** Write
  a new schema change and generate a new migration instead.
- About to `pkill bun` or `killall bun` → **stop.** That kills every app on
  the box. `systemctl --user restart app-<slug>` is what you want.
- About to concatenate a value into a SQL string → **stop.** Use Drizzle's
  query builder, which parameterizes for you.
- About to edit an existing app without backing up first → **stop.** Run
  `backup-app.sh <slug>`. Costs seconds; buys you a rollback.
- About to hard-delete an app when the user said "get rid of it" → **stop.**
  Archive it. Only hard-delete if she said explicitly "delete, don't
  archive".
- About to add a third field to `app.json` → **stop.** Two fields, forever.
  Everything else has a natural home elsewhere.
- About to build a portal-like page that lists apps → **stop.** The
  front-end client's sidebar is the portal now.
- About to hand the user a URL, serve-URL, or "open it at …" link
  → **stop.** URLs work, but the tile is the entry point users are
  meant to use — on some clients (iOS PWA) opening by URL renders
  incorrectly, whereas the tile works everywhere. Name the tile in
  your handoff, not a URL. Same rule if you're forced to show a WIP
  version before it's finished: publish early so it reaches her as a
  tile — don't fall back to a URL.
- About to `mv app.json.pending app.json` for a new app before it
  actually works end-to-end → **stop.** Publishing early flashes a
  broken app onto her sidebar. Verify step 7 first.
- About to write `app.json` directly for a new app (skipping the
  pending file) → **stop.** Use the pending flow — the whole point is
  the app is invisible to the sidebar until you publish.

## Common questions

- **Where are the logs?** `journalctl --user -u app-<slug> -f`.
- **Where's the database?** `~/fleet/apps/<slug>/db.sqlite`. Inspect with
  `sqlite3 ~/fleet/apps/<slug>/db.sqlite '.tables'`.
- **What port did my app get?** Read the systemd unit's `PORT` env:
  `grep '^Environment=PORT' ~/.config/systemd/user/app-<slug>.service`. Or
  check the create-app helper's output when you ran it.
- **How do I test locally without disturbing the running instance?** Stop
  the unit (`systemctl --user stop app-<slug>`), then `cd ~/fleet/apps/<slug>
  && bun run dev`, then restart the unit when done. Dev mode binds to a
  different port by default so you can even skip the stop step, but the
  cleaner story is stop-dev-restart.
- **How do I see what apps are on this box?** `ls ~/fleet/apps/`.
- **Why isn't my new app showing up on the user's sidebar?** Almost
  certainly because `app.json.pending` hasn't been renamed to `app.json`
  yet — the sweep gates on `app.json` existing. Verify the app works,
  then `mv app.json.pending app.json` (§ Making a new app step 8).
- **How do I see archived apps?** `ls ~/fleet/apps-archive/`.
- **How do I recover an archived app?**
  `bash ~/.claude/skills/app-development/restore-app.sh <slug>`.
- **What if create-app fails partway through?** The helper is not perfectly
  transactional; if it crashes mid-way, check `~/fleet/apps/<slug>/` and
  `~/.config/systemd/user/app-<slug>.service`. Remove any partial state
  before rerunning.
- **The port range is exhausted (99 apps on this box).** That's a lot of
  apps. Talk to the user about which ones can be archived; don't extend
  the range without a conversation.
