---
name: app-development
description: |
  Builds a new app, or edits an existing one. Use when the user asks for an
  app, tool, tracker, dashboard, log, or webpage for a specific purpose, or
  asks to edit, tweak, or add features to an existing app.
distributed: true
---

# app-development

## What this skill builds

Apps live on your box, on disk. There are two kinds:

- **Sidebar apps** — shared on the box. The front-end client lists them as
  tiles in the user's sidebar (the Apps grid), for every user with access to
  the box. They stay until someone archives them.
- **Conversation apps** — belong to one conversation (you). They never get a
  sidebar tile. You hand one to the user by linking it in a message, which
  the chat renders as an **app chip**; the conversation's apps are also
  listed in the **Apps** tab of its identity modal. Whoever can read the
  conversation can use them. They are archived together with the
  conversation, unless the user moves one to the sidebar first.

Your job with this skill is to build one when the user asks — "throw
together a tool that tracks X", "make me a page that graphs Y", "give me a
dashboard for Z", "log every W" — or to edit an existing app when they ask
for changes to something you or another agent made before.

### Which kind to build

- **Tailored to the task you're working on** (a viewer for this
  investigation's data, a checklist for this migration, a picker for this
  decision) → **conversation app**.
- **A general-purpose tool, or something tied to your role** (one of the
  roles you hold) rather than this task, **or the user asked for a sidebar
  app** ("put it in my sidebar", "make me an app I can keep using") →
  **sidebar app**.
- **Ambiguous → ask** before building.

### Handing an app to the user

**Link the app in your message** — it renders as an app chip with the
app's icon and title. Clicking the chip opens the app; dragging it splits the
view so the app sits beside the conversation. The link is the app's pane
address:

    <app-parent>/apps/<host-id>/<slug>/pane/

with `<app-parent>` from `~/fleet/host/parent` and `<host-id>` from
`~/fleet/host/id` (read both at the time; `create-app.sh` prints the exact
link when it finishes). Write it as a Markdown link —
`[Tally board](https://…/apps/6/tally-board/pane/)` — so the chip is
labelled even before the app is known to the client.

- **Conversation apps:** the chip IS the handoff. Link it once the app works
  end to end and has its icon.
- **Sidebar apps:** the tile is the main way in; after publishing, tell the
  user the tile is there and name it. Linking a sidebar app is fine too — it
  gets the same chip.

Do NOT hand out any other URL for an app (serve URLs, `127.0.0.1:<port>`,
"open it at …"). On some clients — notably the iOS PWA — an app opened by a
bare URL renders incorrectly; the chip and the tile open it inside the app,
which works everywhere.

**Publishing a sidebar app (§ Making a new app step 9) is what makes the tile
appear and is deferred until the app is verified end-to-end** — otherwise a
half-built app flashes onto their sidebar and invites a click that hits a broken
page. If they need to see a work-in-progress sidebar app before it's done,
publish it anyway (rename `app.json.pending` → `app.json`) so it reaches them
as a tile. Conversation apps have no publish step: nothing appears anywhere
until you link the chip, so just don't link it before it works.

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

**Every sidebar app lives at `~/fleet/apps/<slug>/`** on the agent's box;
**every conversation app lives at `~/fleet/identities/<your-name>/apps/<slug>/`**
(inside your identity folder, so it travels with you). The folder is the app:
it holds the code, its own SQLite database, a tiny metadata file and (for
apps that may sleep) the `.may-sleep` marker. No shared registry, no per-app
database elsewhere on disk, no configuration outside the folder (the systemd
units are rendered from it — see § How an app is run).

**Slugs are unique across the whole box** — sidebar, conversation and
archived apps share one namespace (`create-app.sh` checks).

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
  `icon.webp`. New apps get one from `make-icon.sh` in step 8 of § Making a
  new app; if the file doesn't exist, the client falls back to a generic app
  glyph. Icons in another format must be converted to `.webp` before dropping
  in — one filename, no drift. Installing an icon links `static/icon.webp`
  to `../icon.webp` so the same file doubles as the browser tab favicon when the
  user opens the app in a new tab. The built output under `build/client/`
  holds a copy of the bytes, so a replaced icon needs a rebuild
  (`bun run build`) and restart (`systemctl --user restart app-<slug>`) —
  `make-icon.sh accept` does both.
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
(§ Making a new app step 9). This prevents a half-built app from flashing
onto their sidebar and inviting a click that hits a broken page.

For **editing** an existing app, this doesn't apply — its `app.json`
already exists (it's already on their sidebar). Only NEW sidebar apps go
through the pending flow. **Conversation apps get `app.json` straight
away** — they never show in the sidebar, and the title + description show
on their chip and in the Apps tab.

## Lifecycle — the helpers

Every generic step in an app's life is a bundled helper script alongside
this file. Where the work is app-specific (designing the schema, writing the
pages), the skill walks you through it in prose below. The helpers handle
everything else.

- **`bootstrap.sh`** — first-app-on-a-box setup. Idempotent. Installs Bun if
  missing, creates the three top-level folders, enables linger so systemd
  `--user` units survive logout. Run this once before creating your first
  app on any box.

- **`create-app.sh [--conversation] <slug> [title]`** — allocates the next
  free port in the 9501-9599 range, scaffolds the starter template, installs
  dependencies, installs the app's systemd units, starts it, verifies it
  answers. Without `--conversation`: a sidebar app in `~/fleet/apps/<slug>/`
  with `app.json.pending` (invisible until you publish), always-on. With
  `--conversation`: a conversation app in
  `~/fleet/identities/$FLEET_IDENTITY/apps/<slug>/` with `app.json` and the
  `.may-sleep` marker. `FLEET_IDENTITY` is already set to your identity name
  in every agent session (the supervisor launches you with it) — no need to
  export it. Slug must be kebab-case. Title is optional; defaults to
  a title-cased slug if omitted. Prints the app's link when done.

- **`promote-app.sh <slug>`** — moves one of your conversation apps to the
  sidebar: stops it, moves the folder (data, icon, marker and all) to
  `~/fleet/apps/<slug>/`, reinstalls its units on the SAME port, checks it
  answers. Rolls back on failure. See § Moving a conversation app to the
  sidebar.

- **`app-units.sh`** — the one place that knows how an app is run under
  systemd (see § How an app is run). The other helpers and the box's
  supervisor call it; you rarely need it directly. `app-units.sh find <slug>`
  prints an app's folder; `app-units.sh port <slug>` its public port.

- **`archive-app.sh <slug>`** — sidebar apps only. Stashes the app's units
  inside its folder, stops and removes them, moves `~/fleet/apps/<slug>/` to
  `~/fleet/apps-archive/<slug>/`. This is the default remove path. Users who
  ask to delete something sometimes change their minds. Conversation apps are
  never archived on their own — they go with the conversation.

- **Un-archive (agent gesture — no standalone script)** — inverse of
  archive. Drop an empty `.unarchive-requested` sentinel inside
  `~/fleet/apps-archive/<slug>/`. The box's `agent-supervisor` picks it
  up on its next reconcile tick (~15s), moves the folder back from
  `apps-archive/` to `apps/`, re-installs the systemd units from the
  stashed copies inside the folder, and starts the app. Same disk
  gesture pattern as archive from an agent's perspective.

- **`make-icon.sh`** — makes an icon in the house style (see step 8 of
  § Making a new app). `colors <slug>` lists the palette and which colors
  the other apps use; `draft <slug> <color> "<symbol>"` generates a draft
  and a preview; `accept <slug>` installs the draft, rebuilds and restarts.

- **`backup-app.sh <slug>`** — snapshots the app folder (sidebar or conversation) and the
  systemd unit file into `~/fleet/apps-backups/<slug>-<timestamp>/`. Restoring
  from a backup is a manual step; the backup is a safety net, not a formal
  lifecycle state.

## Making a new app — the recipe

0. **Pick the kind** — conversation app or sidebar app (§ Which kind to
   build). Ask if it's unclear.
1. **Bootstrap if needed.** If `~/fleet/apps/` doesn't exist, run
   `bootstrap.sh`. Skip if it already exists.
2. **Pick a slug** — kebab-case, meaningful in three months. `grocery-list`,
   not `app1`. It becomes the folder name and the systemd unit name.
3. **Pick a title** if you want one different from the slug. This is what
   the sidebar tile (or the chip and Apps tab) shows.
4. **Run the create helper:**

       bash ~/.claude/skills/app-development/create-app.sh <slug> "<title>"                 # sidebar app
       bash ~/.claude/skills/app-development/create-app.sh --conversation <slug> "<title>"  # conversation app

   That does the whole scaffold-plus-install cycle. Log tail from the helper
   tells you the assigned port, confirms the app answers and (for a
   conversation app) prints the link you'll hand over. `<app-dir>` below is
   the folder it reports — `~/fleet/apps/<slug>` or
   `~/fleet/identities/<you>/apps/<slug>`.
   **Conversation apps start with the `.may-sleep` marker. If the app will
   do anything on its own clock — timers, schedules, polling, background
   jobs, work that keeps going after a request finishes — delete the marker
   now** (§ Sleeping). Sidebar apps start always-on.
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
   - `README.md.pending` — the starter ships a template README as
     `.pending` so overwriting it is friction-free (no Read-before-Write).
     Replace the top `<replace with your app's name>` header + description
     paragraph with your app's actual purpose; keep the ops boilerplate
     below. Rename `README.md.pending` → `README.md` when you're done
     tweaking it (any time before step 9 is fine).
   - `app.json.pending` — fill in the `description` field. Leave the
     filename as `.pending` for now; it gets renamed at publish (step 9).
6. **Iterate.** See § Iteration workflow.
7. **Verify.** Once it looks right in dev mode, build the production output
   and restart the systemd unit:

       cd <app-dir>
       bun run build
       systemctl --user restart app-<slug>

   **Scan `bun run build` output for deprecation warnings before moving
   on.** SvelteKit and its ecosystem announce breaking changes here
   first; a warning about a deprecated config option is a functional
   regression waiting to happen (the option may already be silently
   ignored on the installed version, or removed in the next minor). If
   you see one, fix it before publishing — don't publish an app with a
   known deprecation in its config.

   Then confirm it's live: `curl -s -o /dev/null -w '%{http_code}\n'
   127.0.0.1:<port>/` should print 200 (this also wakes a sleeping app —
   `systemctl --user status app-<slug>` reads `inactive` while it's asleep,
   which is fine). Walk the golden path yourself — this is the last moment
   before it reaches the user. If anything is still broken, do NOT continue —
   the remaining steps (icon, handover) assume a working app.
8. **Make an icon.** Every app — sidebar tile or conversation-app chip — gets a visual mark;
   without one, the client falls back to a generic app glyph. The house
   style is one white, logo-like symbol — simple, not visually busy —
   centered on a flat background of the app's own color, the way icons on a
   phone home screen look. Each app having its own color is what lets the
   user find it at a glance. `make-icon.sh` produces this style: the image
   generator only draws the symbol, and the helper sizes it, centers it and
   puts it on the color, so every icon comes out the same way.

   This is the default. Anything the user asks for — a particular color, a
   different style, an icon of their own — wins.

   1. **Pick a color.** List the palette and what the other apps use:

          bash ~/.claude/skills/app-development/make-icon.sh colors <slug>

      Choose a free color that suits the app (green for shopping, teal for
      money, …). Only when every color is taken, reuse whichever fits best.
      When replacing an existing app's icon, keep its current color (the
      list marks it) unless the user wants a change — people find the app
      by its color.
   2. **Draft it.** Name the symbol in a few plain words — one object that
      says what the app is ("a shopping basket", "a stopwatch", "a bell"):

          bash ~/.claude/skills/app-development/make-icon.sh draft <slug> <color> "<symbol>"

   3. **Look at the preview before accepting.** Read the preview image the
      draft step prints — never accept a draft unseen. It passes only if the
      symbol reads clearly at the small size, says what the app is, has
      nothing extra (text, stray marks, a second object), and isn't thin or
      fussy. If it fails, reword the symbol and draft again — up to three
      drafts in total.
   4. **Accept it.** Installs it as `icon.webp`, links the favicon, rebuilds
      and restarts:

          bash ~/.claude/skills/app-development/make-icon.sh accept <slug>

   Rules:

   - **If no draft passes after three tries, or `image-gen` fails**
     (`content_blocked`, `provider_unavailable`, `not_configured`), ship
     without an icon — the client shows the generic glyph — and tell the
     user, so they can ask for another try or bring their own. Don't block
     publish on the icon, and don't accept a bad one: a poor icon gets
     learned and sticks.
   - **If the user brought their own icon**, use that instead — convert it
     with `convert <src> <app-dir>/icon.webp`, then
     `ln -sf ../icon.webp <app-dir>/static/icon.webp`, rebuild
     and restart.
   - **Replacing an existing app's icon** is the same steps; `accept`
     overwrites the old one.
9. **Hand it over.** Only once step 7 has actually passed.
   - **Sidebar app — publish.** This is the moment the tile appears on the
     user's sidebar:

         mv ~/fleet/apps/<slug>/app.json.pending ~/fleet/apps/<slug>/app.json

     The front-end client's next sweep picks it up. Tell the user the app is
     ready and name the tile ("your `Birthdays` tile is on the sidebar now").
   - **Conversation app — link the chip** (the link `create-app.sh` printed;
     § Handing an app to the user). Make sure `app.json`'s description is
     filled in — it shows on the chip and in the Apps tab.

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
    cd <app-dir>
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

1. **Find it.** `ls ~/fleet/apps/` for sidebar apps, `ls ~/fleet/identities/<you>/apps/`
   for your conversation apps; `bash ~/.claude/skills/app-development/app-units.sh find <slug>`
   prints any app's folder.
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

## Form actions — `use:enhance` by default

SvelteKit form actions default to a full-page POST + reload on every
submit. That's visibly jarring for anything the user does more than
once per page view — checking off a todo, snoozing an item,
incrementing a counter. **Enhance every `<form method="post">` with
`use:enhance` from `$app/forms`** so submits go through fetch and
SvelteKit re-runs `load()` in place.

```svelte
<script>
    import { enhance } from '$app/forms';
</script>

<form method="post" action="?/complete" use:enhance>
    <input type="hidden" name="id" value={t.id} />
    <button type="submit">✓</button>
</form>
```

**The one gotcha: `use:enhance` preserves local component state across
submits (full reload doesn't).** Any UI that was closing itself "for
free" on reload — an inline editor collapsing after save, an expanded
panel resetting — needs an explicit callback:

```svelte
<form
    method="post"
    action="?/edit"
    use:enhance={() => async ({ update, result }) => {
        await update();
        if (result.type === 'success') editingId = null;
    }}
>
```

Skip enhance only when the submit genuinely needs a full navigation
(auth state change, redirect to a different app).

## How an app is run — systemd units

`app-units.sh` renders every app's units from `templates/units/` and is the
only thing that installs, removes, stashes or restores them. Every app made
with this skill gets five user units, all named after its slug:

- `app-<slug>.socket` — holds the app's **public** port (9501-9599) open at
  all times, whether the app is running or asleep. The front-end client
  always talks to this port.
- `app-<slug>-relay.service` — started by the socket on a request; forwards
  traffic to the app's **private** port (public + 10000). Tied to the app:
  it stops when the app stops.
- `app-<slug>.service` — the app itself (`bun ./server.js` on the private
  port). `Restart=on-failure`: a crash comes back in about two seconds; a
  clean exit means "asleep" and stays stopped.
- `app-<slug>-marker.path` — starts the app whenever `.may-sleep` is added
  or removed.
- `app-<slug>-boot.service` — at boot, starts the app unless `.may-sleep`
  exists.

Apps created before this layout have a single always-on `app-<slug>.service`
on the public port. They keep working as they are and simply never sleep.

Key directives in the app unit and why they matter:

- `KillMode=control-group` + `KillSignal=SIGTERM` + `TimeoutStopSec=10` —
  kills the whole process tree on stop. Without this, a child spawned by
  Bun can outlive its parent and hold the port on restart.
- `Environment=HOST=127.0.0.1` + `Environment=PORT=<private port>` — the
  only runtime knobs. The app hardcodes nothing.
- `ExecStartPost` waits until the app answers on its private port, so the
  relay never forwards the first request after a wake to nobody.
- `StandardOutput=journal` + `SyslogIdentifier=app-<slug>` — logs go to the
  user's journal, viewable with `journalctl --user -u app-<slug> -f`.

Common commands:

- **Restart after code changes:** `systemctl --user restart app-<slug>`
- **Stop:** `systemctl --user stop app-<slug>` (the next request through the
  public port starts it again — the socket is still holding the address).
  systemd prints "Stopping 'app-<slug>.service', but its triggering units are
  still active: app-<slug>-marker.path" — that's expected and harmless; the
  marker watch only restarts the app when the marker changes.
- **Status:** `systemctl --user status app-<slug>` (`inactive` = asleep or
  stopped; `failed` = crash loop, look at the logs)
- **Tail logs:** `journalctl --user -u app-<slug> -f`
- **Public port:** `bash ~/.claude/skills/app-development/app-units.sh port <slug>`

If `systemctl --user` fails with `Failed to connect to bus`, your shell is
missing the user-bus env — prefix the command with
`XDG_RUNTIME_DIR=/run/user/$(id -u) DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus`.
The skill's scripts set these themselves.

Never `pkill bun` — it kills every app on the box.

## Sleeping — the `.may-sleep` marker

A `.may-sleep` file in the app's folder means **"this app has no background
work, so it may sleep."** The marker is the only switch — adding or removing
it is the whole gesture; nothing else to run.

- **With the marker:** after 10 minutes with no requests and no open
  connections, the app's own `server.js` shuts it down cleanly (asleep). The
  box keeps holding its address; the next request — a chip click, a click
  inside an already-open app — wakes it in about a tenth of a second. A
  reboot leaves it asleep until its first request.
- **Without the marker:** the app starts at boot and runs continuously.
- **Removing the marker wakes a sleeping app immediately**, and it stays up.
  Adding it lets the app fall asleep at its next idle stretch.

Defaults: conversation apps start with the marker; sidebar apps start
without it.

**Remove the marker if the app does anything on its own clock** — a timer, a
schedule, polling a feed, sending reminders, a background job, or work that
keeps going after the request that started it has returned. All of that stops
while the app sleeps. Live connections (a page streaming updates) keep it
awake, which is intended.

Rules:

- Keep everything in the database — anything held only in memory is lost
  when the app sleeps (the persistence rules below already say so).
- Don't remove the sleep logic from `server.js` or its idle-connection
  close (`keepAliveTimeout`); the box relies on them.
- Never wipe or re-create the app folder in a way that loses the marker
  (`rsync --delete` from elsewhere, deleting and re-scaffolding) — that
  silently turns a sleeping app always-on.
- Old apps (single-unit layout) can't sleep; the marker does nothing for them.

## Moving a conversation app to the sidebar

The user can ask for this from the app's top-bar menu or the Apps tab
(**Move to sidebar**). It reaches you as an event, not typed text:

    <task-notification>
    <summary>Move to sidebar — delivered by the app</summary>
    <event>[app <slug>] The user asked to move your conversation app "…" to the sidebar. …</event>
    </task-notification>

Do it, then tell the user in the conversation whether it worked:

    bash ~/.claude/skills/app-development/promote-app.sh <slug>

It keeps the app's name, address, data, icon and sleep setting, so chips and
open panes keep working; the app leaves your Apps tab and appears as a
sidebar tile within a few seconds. If the app does background work and still
has `.may-sleep`, remove the marker as part of the move. If the move fails,
the helper puts the app back where it was — say so and why.

## How the pane mounts your app — one rule to internalize

When the user opens your app through its tile, the front-end client
renders it in a proxied iframe. The iframe URL is a mount PREFIX under
the client's own origin — something like
`/apps/<hostId>/<slug>/pane/`. The proxy strips that prefix before
forwarding to your app's loopback port, so your route handlers see
`/foo` even when the browser URL is `/apps/3/videos/pane/foo`.

There is a SECOND mount context: right-clicking a tile offers "open in
new tab," which opens the app at its own subdomain
(`<host-id>-<port>.serve.<client-domain>`). That path doesn't strip the
prefix — your app sees the full `/apps/<hostId>/<slug>/pane/foo` URL.
Every URL your app emits has to work in BOTH.

**The starter handles both contexts for you** via a set of inert
scaffold files — you don't need to understand the plumbing to build an
app, but the ONE thing you do need to know is the rule for internal
URLs:

**Rule: prefix every internal URL your app emits with `PANE_BASE`.**

```svelte
<script>
    import { PANE_BASE } from '$lib/pane';
</script>

<a href="{PANE_BASE}/settings">Settings</a>
<img src="{PANE_BASE}/logo.svg" alt="" />
<video src="{PANE_BASE}/api/video/x.mp4" controls></video>
```

```ts
fetch(`${PANE_BASE}/api/foo`);
goto(`${PANE_BASE}/other-page`);
```

External URLs (`https://…`, `//example.com/…`) work as-is — no prefix.

**Why the prefix is required (the mechanism, for when it matters):** the
client's proxy injects `<base href="…/pane/">` into every HTML
response, which handles RELATIVE URLs correctly. But root-absolute URLs
(leading `/`) bypass `<base>` per URL spec — they resolve to the
document origin, which is the client's own root, not your app. So
`<a href="/settings">` navigates the iframe OUT of your app. Prefixing
with `PANE_BASE` gives the browser a URL that resolves to a path the
proxy recognizes and forwards to your app.

**Under the hood** (you shouldn't need to touch any of this — it's
already scaffolded and works):

- `src/lib/pane.ts` — exports `PANE_BASE` with the numeric hostId +
  slug baked at scaffold time (`create-app.sh` reads the numeric hostId
  from `~/fleet/host/id`, a distributor-written file — you
  never need to know the integer)
- `src/hooks.ts` — a universal `reroute` hook strips `PANE_BASE` from
  incoming request paths so both mount contexts land on the same
  handlers
- `src/hooks.server.ts` — rewrites SvelteKit's `/_app/` asset URLs +
  the `Link:` preload header to include the prefix
- `vite.config.ts` — a `pane-base-preloads` plugin prefixes the `/_app/`
  preload URLs Vite bakes into the built client JS (hooks.server.ts never
  sees served JS); without it, client JS fails to load in the pane and
  SvelteKit shows its 500 page
- `server.js` — custom Node entry that strips `PANE_BASE` at the HTTP
  layer for the standalone-tab context so adapter-node's static-file
  middleware finds files on disk
- `svelte.config.js` — `paths.relative = false` (matched pair with the
  transformPageChunk rewrite)
- `src/app.html` — `data-sveltekit-reload` forces full page reloads on
  every internal nav, sidestepping a SvelteKit-internal URIError in the
  client-router URL-parse path that would otherwise silently abort
  navigation

Do not edit any of these files unless you know exactly what you're
changing — they're a package.

## Authentication — the front-end client handles it, you don't

The user reaches the app through the front-end client they're using, which
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

Conversation apps are not archived on their own — they are archived with
the conversation (and come back if it is un-archived). `archive-app.sh`
refuses them.

    bash ~/.claude/skills/app-development/archive-app.sh <slug>

If the user later says "wait, I want that back":

    touch ~/fleet/apps-archive/<slug>/.unarchive-requested

The `agent-supervisor` picks the sentinel up on its next reconcile
tick (~15s) and reverses the archive (folder mv back, unit reinstall
from stash, `daemon-reload`, enable+start).

Only if the user explicitly says "delete it, I don't want it recoverable"
do you actually remove the folder from `apps-archive/`. Even then, mention
what you're doing — surprises here are worse than a moment of confirmation.

## Reflex triggers — when you catch yourself about to X, stop

- About to write a root-absolute URL (`<a href="/foo">`, `fetch("/api/…")`,
  `<img src="/logo.svg">`) inside your app → **stop.** Import
  `PANE_BASE` from `$lib/pane` and prefix it:
  `<a href="{PANE_BASE}/foo">`. Root-absolute URLs bypass the injected
  `<base>` tag per URL spec and navigate the iframe OUT of your app. See
  § How the pane mounts your app for the mechanism.
- About to reach for `localStorage`, `sessionStorage`, `IndexedDB`,
  `document.cookie`, or ANY other browser-side persistence → **stop.**
  Persistence goes in the SQLite database, accessed through your
  server routes / form actions. Client-side storage is per-browser,
  per-device, per-profile — it doesn't survive a user switching devices
  or clearing storage, and it silently diverges between browser tabs.
  Anything worth saving is worth saving server-side. (Read-only ephemeral
  UI state — a "sidebar collapsed" toggle, a "last-visited tab" hint —
  is the ONLY thing localStorage is acceptable for, and only if losing it
  is a shrug.)
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
  Archive it. Only hard-delete if they said explicitly "delete, don't
  archive".
- About to add a third field to `app.json` → **stop.** Two fields, forever.
  Everything else has a natural home elsewhere.
- About to build a portal-like page that lists apps → **stop.** The
  front-end client's sidebar is the portal now.
- About to hand the user a serve-URL, a `127.0.0.1:<port>`, or an "open
  it at …" link → **stop.** Link the app's pane address so it renders as an
  app chip (§ Handing an app to the user), or name the sidebar tile. On some
  clients (iOS PWA) an app opened by a bare URL renders incorrectly; the chip
  and the tile work everywhere.
- About to build a sidebar app for something tailored to the task at hand
  (or a conversation app for a general tool the user will keep using) →
  **stop.** Re-read § Which kind to build; ask if unsure.
- About to keep `.may-sleep` on an app with a timer, schedule, poller or
  background job → **stop.** Delete the marker — the work stops while the
  app sleeps.
- About to archive a conversation app on its own, or move one into
  `~/fleet/apps/` by hand → **stop.** It goes with the conversation; moving
  it to the sidebar is `promote-app.sh`, when the user asks.
- About to `mv app.json.pending app.json` for a new sidebar app before it
  actually works end-to-end → **stop.** Publishing early flashes a
  broken app onto their sidebar. Verify step 7 first.
- About to write `app.json` directly for a new sidebar app (skipping the
  pending file) → **stop.** Use the pending flow — the whole point is
  the app is invisible to the sidebar until you publish.

## Common questions

- **Where are the logs?** `journalctl --user -u app-<slug> -f`.
- **Where's the database?** `<app-dir>/db.sqlite` (`app-units.sh find <slug>`
  prints `<app-dir>`). Inspect with `sqlite3 <app-dir>/db.sqlite '.tables'`.
- **What port did my app get?**
  `bash ~/.claude/skills/app-development/app-units.sh port <slug>` prints the
  public port (the one Skynet and `curl` use; the app itself listens on
  public + 10000). Or
  check the create-app helper's output when you ran it.
- **How do I test locally without disturbing the running instance?** Stop
  the unit (`systemctl --user stop app-<slug>`), then `cd <app-dir>
  && bun run dev`, then restart the unit when done. Dev mode binds to a
  different port by default so you can even skip the stop step, but the
  cleaner story is stop-dev-restart.
- **How do I see what apps are on this box?** `ls ~/fleet/apps/` (sidebar)
  and `ls ~/fleet/identities/*/apps/` (conversation apps).
- **Why does `systemctl --user status app-<slug>` say inactive?** It's
  probably asleep (it has `.may-sleep` and nobody has used it for 10
  minutes). `curl 127.0.0.1:<port>/` wakes it. `failed` is different — a
  crash loop; read the logs.
- **Why isn't my new app showing up on the user's sidebar?** If it's a
  conversation app, it never will — link its chip. Otherwise, almost
  certainly because `app.json.pending` hasn't been renamed to `app.json`
  yet — the sweep gates on `app.json` existing. Verify the app works,
  then `mv app.json.pending app.json` (§ Making a new app step 9).
- **How do I see archived apps?** `ls ~/fleet/apps-archive/`.
- **How do I recover an archived app?**
  `touch ~/fleet/apps-archive/<slug>/.unarchive-requested` — the box's
  `agent-supervisor` picks it up on the next reconcile tick and reverses
  the archive.
- **What if create-app fails partway through?** The helper is not perfectly
  transactional; if it crashes mid-way, check the app folder and
  `~/.config/systemd/user/app-<slug>*`. Remove any partial state
  (`app-units.sh uninstall <slug>`, then the folder) before rerunning.
- **The port range is exhausted (99 apps on this box).** That's a lot of
  apps. Talk to the user about which ones can be archived; don't extend
  the range without a conversation.
