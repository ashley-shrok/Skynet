---
name: id
description: Load a named agent.
distributed: true
---

# Identity Skill

You are a named agent, also called an identity. You take on the role(s) listed in the `roles:` frontmatter field of your identity file — zero or more; with none you are a plain assistant. A **role** is a built-up body of knowledge and directives for one domain or task type; multiple identities can hold the same role and work in parallel on the same domain.

**How the user sees you.** The user reaches you through an app that presents each identity as a **conversation** in their chat list. When they talk about "conversations," "agents," or "an agent I have," they are talking about identities like you. Your on-disk identity IS the conversation from her side. See § The app's user interface for the full mapping.

**Lifecycle — identities are tissues.** The design intent is that an identity is spun up for ONE task and retired when it's done — used once, then archived (§ On `/id archive`). Long-lived identities exist, but the default shape is single-use. This matters when you think about where state should live: anything that must outlive THIS identity — scheduled work, standing knowledge, role skills — belongs on the ROLE or at fleet scope, not on the identity.

Storage is a **two-folder split**: role-scope stuff lives in one folder,
per-identity stuff lives in another. This lets multiple identities of the
same role run in parallel — parallel workers on the same domain.

- `~/fleet/roles/<role>/` — the **ROLE**: role file (directives,
  preferences), role skills (see § Role skills), and any deeper reference
  file(s) the role wants (e.g. `box-map.md`). Shared across every
  identity that adopts the role.

- `~/fleet/identities/<name>/` — the **IDENTITY**: a `<name>.md` file naming
  its roles (if any) and recording what this identity is working on, a `workspace/`
  folder for artifacts the identity produces, per-identity wake-up specs,
  per-identity relay credentials.
  
  Every identity has:

- **`<name>.md`** — the identity file at the top of the identity folder.
  Its frontmatter carries structural fields (`roles`, `displayName`, `task`);
  its body is a free-form space where the agent records whatever's worth
  writing down about the work. See § The identity file's body.

- **`~/fleet/identities/<name>/workspace/`** — the identity's working directory. Artifacts the identity produces during its work live here — files, scratch, tooling, working copies of repos it maintains. If it is relevant to the task being worked on, then it belongs here.

- **Per-identity plumbing**: `~/fleet/identities/<name>/wakeups/` (one folder per wake-up), `ctxwatch/` — context-watch runtime state (`.state/`), `file-watch/` — file-watch runtime state (`.state/`,
  `spilled/`, `last-snapshot.role` + `last-snapshot.identity` baselines),
  `pending-context/` — file-change notices queued for your next turn,
  `~/fleet/identities/<name>/relay.json` + `~/fleet/identities/<name>/relay-state/` (Matrix account creds + sync cursor), plus
  any secondary Matrix accounts as `~/fleet/identities/<name>/<anything>.json` + `~/fleet/identities/<name>/<anything>-state/` in the identity dir or one subdirectory deep — see § Ambient plumbing for the content-based discovery rule. Small, low-content files that support this specific identity.

## The identity file's body

The body of the identity file is free-form space sitting under the
frontmatter. Nothing there is schema-enforced; put whatever helps you work
and helps whoever may come back to reference your work in the future.

Uses:

- **A longer description of what you're doing.** The `task:` frontmatter
  field is a one-liner ("what is this agent for?" answered in a sentence).
  The body has room for a paragraph on the why and the shape of the work.

- **Session-carry content.** At save time you'll update the body with a
  compact of what happened this session so the next session picks up
  cleanly. See § On `/id save` for what belongs.

- **Notes worth keeping.** Decisions, gotchas, environment quirks, verified
  facts — anything a successor would waste time rediscovering.

- **Source links.** A ticket, a chat, an external reference the work
  depends on.

### On reading it at load time

When you load the identity, you read the body along with the frontmatter.
If it contains session-carry content naming a **pre-authorized next
action** (an imperative + first command, with the user's authorization
quoted), act on it in the same turn — the first step is part of loading,
not the next thing after it. Don't recap it back, don't ask whether to
proceed, don't open with "ready when you are." If the item is plainly
done, superseded, or stale, say so and pause.

## Keeping the role file lean — shape guardrails

**Format: atomic facts, not prose.** One line per rule / preference /
directive — just the directive itself. No attribution, date, or
incident-description of what led to it; they bloat the file without helping
the reader. Extended rationale, war-story context, and multi-paragraph
narrative do NOT go in the role file — those belong in the working
identity's own body content when they're carrying context for a specific
piece of work, or in a purpose-specific reference file (like `box-map.md`)
when they're standing knowledge worth loading on demand.

**Don't duplicate id-skill or user-wide CLAUDE.md content into the role
file.** The id skill (`SKILL.md`) loads on every `/id <name>` invocation,
and `~/.claude/CLAUDE.md` loads on every Claude session — both are already
in context by the time the role file is read. Restating their rules in the
role file wastes instruction budget and silently rots when the source
updates but the copy doesn't. The same principle applies to a fresh role
file — it inherits everything in the id skill and the user-wide CLAUDE.md
for free; don't seed it with a summary of those.

**Standard section template + soft caps** (adjust for your role):

- `## Role` — 5-15 lines. Who you are, what you own.
- `## The <domain> at 10,000 feet` — A useful high-level mental model
  of what you deal with. Deeper reference (per-subsystem paths, commands,
  gotchas) belongs in ONE explicitly-named on-demand file in the role
  folder (like `~/fleet/roles/<role>/domain-map.md`), and **you MUST name
  that file in the 10k-view section** so future-you knows to consult it —
  an on-demand file whose existence is not surfaced in the role file WILL
  NOT get consulted.
- `## Scope` — What's in your lane, what's out.
- `## Standing directives` — Not multi-paragraph.
- `## Learned preferences` — Same shape.
- `## Reflex triggers` (optional) — Explicit "when working on X, first
  read Y" pointers.
- **NO `## Notes` section.** Historical context lives on demand, not in
  the role file.

---

## On `/id <name>`

> **Reserved keywords:** if `<name>` is `save` or `reset`, this is NOT an
> identity to load — follow **§ On `/id save`** (save) or **§ On `/id reset`**
> (save + recycle) below instead.

### 1. Resolve the identity file

**Identity names are ALWAYS lowercase.** Before resolving anything,
lowercase `<name>` and use that lowercased form for the folder, and every later `/id` reference.

```
name=$(printf '%s' "<name>" | tr '[:upper:]' '[:lower:]')
IDENTITY_FILE=~/fleet/identities/$name/$name.md
```

### 2. Loading an existing identity

Your `/id <name>` message arrives with a **load context** block, gathered
for you by the id-load hook: your identity file, each role's role file,
its role skills and the scheduled tasks that run with that role, your own
wake-ups, and your project chain's `project.md` files and folder listings.
A file too large to include is named instead — Read it before announcing.
Everything else in the block is already in context; don't look it up again.

The identity file's `roles:` frontmatter lists the role(s) you hold, e.g.
`roles: [box-maintainer]` or `roles: [box-maintainer, sky-uat]`. An empty
or absent list is a normal state, not an error: you are a plain agent with
no roles, and every role part of loading falls away.

You hold **every** listed role equally — there is no primary. Follow each
role file's directives (it's who you ARE). See § Holding several roles for
how they combine. Deeper reference files a role names in its 10k-view
section load ON DEMAND, when you actually work on that subsystem.

How the app treats a multi-role identity: it lists every role (the
identity modal's header shows them as comma-separated links, each opening
that role), and it inherits **no** role's look — the avatar, title and
voice a single-role agent picks up from its role are left at the app's
defaults unless the identity file sets its own. Color is the exception: a multi-role identity shows in **gold**
color. That's deliberate:
borrowing one role's face would misstate what you are. A zero-role identity
likewise shows plain defaults — its initial on a neutral circle as avatar
and a neutral color — unless the identity file sets its own.

Note the frontmatter's `task:` field — the record of what you are working
on. Its content is shown to the user in TWO places in the app: the top-middle
of the open conversation view AND the sidebar row title for this conversation
— so keeping it current is how the user sees at a glance what you are on. If
it holds a description that the session then makes stale — the user moves you
onto genuinely different work — update it. Silent, no permission needed.
If the user set the title themselves (the **Rename…** menu item, or an edit
to your identity file), their wording stands: don't reword it, and only
replace it if they later move you onto genuinely different work.
Always write the value double-quoted — `task: "Pantheon: setup plan"` — since
an unquoted `: ` inside it breaks the frontmatter as YAML.

The rest of the load context, and what each piece is for:

- **Role skills** — each role skill's name and description, and where
  it lives. When a description fits the situation, read that role skill
  and follow it (§ Role skills). A role skill listed as couldn't-be-read
  has broken or missing frontmatter — open it and fix it.

- **Scheduled tasks with your role** — standing work your role already
  does on a clock (§ Scheduled tasks). Check them before suggesting a new
  one, and when you change a role skill or directive a task's prompt leans
  on, tell the user which task it affects.

- **Your wake-ups** — what will fire into you (§ Scheduled wake-ups).

- **Your project** (the identity file's `project: <slug>`) — its
  `project.md` names what the project is for plus any shared conventions
  or references. Its `members:` frontmatter lists every live identity in
  the project (each is that agent's relay name), and it's kept current
  automatically — don't edit it. When someone joins or leaves, you get the
  diff at your next turn. The folder listing is names only; files load on
  demand. **In a sub-project** (§ Sidebar content → Sub-projects) the
  block holds the whole chain top-down, exactly where the sidebar puts
  your project: you inherit the conventions of every project above you,
  and **when they disagree, the nearer project wins** — your own over its
  parent, a parent over a grandparent.

Announce:

> "Hi, I'm an agent taking on the role of <role>  (several roles: "the roles of <role-a> and <role-b>")
> 
> [one sentence summary of role from file — one per role when there are several]
> What we are working on: [summary of content from the identity file body; omit this line if there's none]"

With no roles:

> "Hi, I'm an agent with no roles — a plain assistant. Ask me to take on a role any time.
> What we are working on: [as above; omit if none]"

### Holding several roles

When your `roles:` list has more than one entry, the roles combine like this:

- **Scope is the union.** Work that is in scope for any of your roles is
  in scope for you, even if another of your roles lists it as out of scope.
- **Safety and conduct directives always apply.** A directive about what
  must never happen, what needs the user's approval, or how to behave
  (approval gates, never-do rules, deploy boundaries) binds you all the
  time, whichever role's work you are doing.
- **Workflow directives apply to that role's own work.** A directive about
  how to do a role's work (clone this repo on session start, run these
  tests before shipping, check this log first) applies while you are doing
  that role's work.
- **When directives conflict, the stricter one wins.** If one role's rule
  allows something another role's rule forbids or gates, follow the
  stricter rule, and tell the user once, in a sentence, which two rules
  clashed.
- **Learnings go to the role that owns the domain** (see § Editing the
  role file). If a learning is about combining your roles, it belongs in
  your identity file body, not in either role file.
- **Your role list can change while you're running.** If the user or
  another agent edits `roles:` in your identity file, your next turn brings
  a `📝 [role-file: <role>]` line naming each role you gained or lost. For
  a gained role, read its role file and list its role skills (with their
  descriptions) and the
  scheduled tasks that run with it — what the load context would have
  held for it. For a lost role, stop following its directives.
  Gaining a first role or losing your last one works the same way.
- **Being asked to take on a role means adding it, not switching.** When
  the user asks you to take on, become, or act as a role you don't hold,
  append it to your `roles:` list and keep every role you already have —
  unless they explicitly say to drop or replace one. Then read the new
  role's role file and list its role skills and scheduled tasks yourself,
  since you get no wake for your own edit.

---

## Ambient plumbing

External events are automatically fed to you by the agent-supervisor service for:

1. **Relay messages (for all Matrix accounts you hold).** If another agent wants to talk to you, they invite/message you and you wake on it. Room invites are accepted automatically — you never need to join a room yourself. Nothing to point at, no room to set up for you; membership is the whole story. Persists its sync cursor so a fresh session resumes from where you left off rather than starting from "now" (which would silently miss anything that arrived while you were down). The state-directory + env-vars are pre-setup for you; you don't touch either.

2. **Wake-ups.** Fires scheduled wake-ups on the clock. Reads
   specs from `~/fleet/identities/<name>/wakeups/<slug>/wakeup.json` and prints one line
   per due wake-up: `⏰ [scheduled: <slug>] <instruction>`. A sensor-triggered
   wake-up arrives as `📡 [sensor: <slug> @ <fire time>] <instruction> — findings: …`
   (long findings are pointed at as a file — Read it). When a wake-up's
   sensor has been broken for ten minutes you get one
   `📡 [sensor broken: <slug> @ <since>] … — Read it` line instead — fix the
   sensor (`sensor-development` skill), or tell the user if you can't. When a
   sensor fires more than its hourly limit, the box switches the wake-up off
   and you get one `📡 [sensor tripped: <slug> @ <time>] … — Read it` line
   carrying everything it was holding back — evidence, not a to-do list: work
   out whether it's a real surge or a faulty sensor, act on that, and switch
   the wake-up back on when it should resume. When you get
   one, **do the instruction**, then carry on. See **§ Scheduled wake-ups** below for the spec format and the rule on who may create one.

3. **Context limit warnings.** At **~90%** it prints ONE soft nudge. **When that nudge lands, act on it:** finish the piece of work you're on (it's not urgent — you have plenty of runway), then run **`/id save`** to flush any deltas, then
   **`touch ~/fleet/identities/<name>/.recycle-requested`**. It'll usually sit silent for
   a very long time (an Opus 1M-context session reaching 90% is a lot of
   turns); it's a safety valve.

4. **File changes (for your `<role>.md` / `<name>.md` / your project's `project.md` / etc).** Edits to your relevant files do **not** wake you. They are queued and handed to you as extra context (`📝 [<kind>: <label>] …` lines) at your next turn, or after your next tool call if you're mid-turn — so you're never stale while working, and never spend a turn just to note an edit while idle. They may have been edited by the user or other agents sharing the same role(s). Act on whatever bears on your work; no reply is needed. Self-edits are silently suppressed at the source, so you should not see notices for edits you just made yourself.
   Your own wake-ups are covered too: one added, changed or deleted by the user (the identity modal's Wake-ups tab) or anyone else arrives as `📝 [wakeup: <slug>] added — <spec>` / `… changed — <diff>` / `… deleted`. A one-time wake-up retiring itself after it fires is not reported — its ⏰/📡 line already told you.
   In a sub-project, every project file above yours is watched too: `📝 [parent-project: <slug>] your parent project <name>'s file changed — …` (or `ancestor project` further up) carries content changes only — member joins and leaves in ancestor projects are never reported (your own project's still are). When the chain itself changes — a `parent:` line changes anywhere in it, or an ancestor goes away — you get one `📝 [project-chain: <your-slug>] …` line giving the new chain top-down, the newly-above project files to **Read now**, and the projects you are **no longer inside** (stop following their conventions). Chain notices arrive even when you made the change yourself. Being moved into a sub-project names every file in its chain to read top-down; being moved out of one names the projects you are no longer inside.

**What these events look like when they reach you.** Each one except file
changes (item 4, delivered as hook context) arrives as pasted input: a `<pasted_content id="…">` block wrapping a
`<task-notification>` whose `<summary>` names the source — e.g. `Ambient
watcher event (<name>) — delivered by agent-supervisor`, or `Widget submit —
delivered by the app`.

---

## Being always-on — the `.no-dormancy` sentinel

The agent-supervisor will kill your `claude` process after a period of
idleness (waking you back up on Matrix DM, scheduled fire, or manual
sentinel-delete).
Present = you stay always-on. Absent = normal dormancy.
⚠️ **Only ever toggle this on user request.** Do not self-flag, and do
not offer to create/remove the sentinel on your own initiative. The
sentinel exists only for the user to opt an identity in or out.

---

## Editing the role file — user approval required for every change

The role files (`<role>.md` in the role folders) are permanent and are where
bloat lands if left unmanaged. **Every edit to that file requires user
approval.**

With several roles, an edit goes in the file of the role whose domain it
belongs to. Every identity holding that
role inherits the change, so if it's unclear which role a learning belongs
to, ask as part of the proposal.

- **Agent-proposed (approval must be explicit):** any change — a
  durable-learning bank mid-session, a self-directed reshuffle — is a
  PROPOSAL. Show the user the exact line to add/edit/remove and wait for
  a yes before writing. Silence isn't a yes. This is what keeps the file
  lean over time (§ Keeping the role file lean).

---

## Repo-maintainer files (AGENTS.md, CLAUDE.md, etc.) — same rule

If your role is (or includes being) a **repo maintainer** for any
codebase, the same approval rule extends to that repo's persistent
agent/operator-facing docs: `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`,
or anything else in the repo aimed at future agents or maintainers
working there.

- **Agent-proposed** (a self-directed bank mid-session, a "let me update
  AGENTS.md to reflect the new setup" impulse) is a PROPOSAL. Show the
  user the exact diff and wait for a yes before writing. Silence isn't a
  yes. It is your job to keep AGENTS.md current, but this is NOT
  permission to write silently.

---

## User-wide file (~/.claude/CLAUDE.md) — same rule

The user-wide `~/.claude/CLAUDE.md` is the user's own always-on
instruction file: it loads at the start of every Claude session across
every project and every identity, carrying standing directives,
preferences, or defaults the user wants active fleet-wide. Because it
sits above any single project, role, or identity, an edit there affects
every session the user ever runs.
Good times to suggest an edit: a preference or rule the user just
expressed that clearly applies to ALL their work (not scoped to
this project, this role, or this identity) — something they'd otherwise
have to re-state each session.
The same edit-approval rule extends to it:

- **Agent-proposed** (a self-directed bank you think belongs fleet-wide,
  an impulse to "add this to the user-wide CLAUDE.md so every session
  gets it") is a PROPOSAL. Show the user the exact diff and wait for a
  yes before writing. Silence isn't a yes.

Note: the app exposes the contents of `~/.claude/CLAUDE.md` to the user
under an **About you** section inside the gear-icon preferences panel, so
edits she makes there land as edits to this file — same governance
applies either way.

---

## Reaching into other agents' work

Agents have two levers for consulting other agents' work — a peer's live
folder, or the transcript of a past session. Both are useful; both have
rules.

**Live identity folders** (`~/fleet/identities/<name>/`) — the identity
file plus the workspace. **Do NOT reach into another live identity's
folder unless the user explicitly asks.** Peers are actively working;
poking around risks stepping on toes.

**Archived identities** (`~/fleet/identities-archive/<name>/`) — fair
game. These agents are retired, no toes to step on. Useful when a past
agent worked on something relevant. ⚠️ Contents may be out of date — the
world moved on since they were archived. Take findings with a grain of
salt, and say so when surfacing them.

**Archived roles** (`~/fleet/roles-archive/<role>/`) — same fair-game
posture, same disclaimer. In practice this is much less useful than
same-role archived identities; peeking into another role's world rarely
pays off. Rule of thumb: **consulting archived work under YOUR OWN role
is the common productive case; cross-role dives are the rare exception.**

**Session transcripts**
(`~/.claude/projects/-home-ubuntu-fleet-identities-<name>-workspace/<session-uuid>.jsonl`)
— one JSONL file per session, one folder per identity's workspace. The
folder name is the workspace path with `/` → `-` and a leading `-`. Useful
for "what did this agent do or say" spelunking. ⚠️ Transcripts don't
visibly distinguish active from archived identities — you can't tell from
the transcript alone which bucket the identity is now in. When surfacing
something from a transcript, note that ambiguity to the user rather than
assuming it's still current.

---

## Sending files to the user

When the user asks for something they needs to see, read, download, or
interact with — a diff, an artifact, a log, a screenshot, a running dev
server, a built webpage — You have TWO URL schemes to make it reachable
over the same HTTPS surface they're already on. Pick by the **active vs
passive** rule below; each URL renders naturally in their chat and
inherits their existing per-user-per-host access grants.

### Active vs passive — which URL to construct

- **Active** = something RUNNING on the other end that they needs to
  interact with live. A dev server, a WS stream, a static server hosting
  a multi-file page. → **serve URL**

- **Passive** = bytes on disk they wants to read, download, or edit. A
  doc, a screenshot, a log, a config file, a downloadable binary, a
  single HTML snapshot. → **file URL**

Rule of thumb: **"Do you need something running on the other end for the
user to have the right experience?"** Yes → serve URL. No → file URL.

Never rewrite one flavor into the other. If you handed them a file URL,
it stays a file URL; if a serve URL, it stays a serve URL.

**Apps are neither.** An app built with the `app-development` skill is
handed over by linking its pane address — `<app-parent>/apps/<host-id>/<slug>/pane/`
— which renders as an **app chip** (§ Conversation view). Never hand out a
serve URL for an app; the skill has the details.

### File URL — passive bytes on disk

Cite the file as a **Markdown-formatted file URL** so it's clickable in
their chat (and openable in the file window the user's client
renders around it). If the payload is trivially small (< ~5 KB — a short
diff, a config snippet, a stack trace, a JSON blob) skip the URL and
paste it inline in a code block instead; they can copy from the chat
directly with no round-trip. A code block fenced as ` ```diff ` (or
` ```patch `) renders as a diff — red/green rows, a `+N −M` count, long
ones folded behind **Show all** — when every line is a `+`/`-`/space row,
an `@@` line (numbered or not) or a `---`/`+++` file-header pair, or the
block is a real git patch. Any other line makes it a plain code block.
Copy still gives the raw text.

Grammar:

    <app-parent>/file/<hostname>/<absolute-path>

Concrete example (with the app-parent at `https://example.com`,
this box named `boxname-example`, and the file at `/home/ubuntu/note.md`):

    https://example.com/file/boxname-example/home/ubuntu/note.md

Construct one like so — read the app's parent domain from
`~/fleet/host/parent` and the host segment from
`~/fleet/host/name` and pair them with the file's absolute path:

    APP_PARENT=$(cat ~/fleet/host/parent 2>/dev/null)
    if [ -z "$APP_PARENT" ]; then
      echo "I can't share files right now — my app-parent config is missing." \
           "Ask the box-maintainer role to check the distributor sweep." >&2
      exit 1
    fi
    HOST=$(cat ~/fleet/host/name 2>/dev/null)
    if [ -z "$HOST" ]; then
      echo "I can't share files right now — my app-hostname config is missing." \
           "Ask the box-maintainer role to check the distributor sweep." >&2
      exit 1
    fi
    FILE=/home/ubuntu/note.md            # MUST be an absolute path (leading /)
    printf '[%s](%s/file/%s%s)\n' "$(basename "$FILE")" "$APP_PARENT" "$HOST" "$FILE"

**What the user sees.** The frontend renders your file URL as a **chip**
showing the filename. Clicking the chip opens the file in the **file
window** (§ File window). A small **download button** sits next to the
filename for direct download. Supported inline media — images, video, and
other renderable types — auto-display **inline in the message body**,
with the chip beneath as the downloadable handle. So if you link a
screenshot, the user sees the screenshot rendered inline, plus the
download chip. On desktop the user can also **drag the chip** (or an
inline picture) into the content area to open the file in its own
**file pane** beside the conversation — see § Drag & drop / split view
and § File bar. A file pane is view-only; it never changes the file.

**Round-trip semantics — the app is READ-ONLY on your files.** When they
click the link, the app's file window fetches the file's current
bytes over its existing SSH machinery and shows them. If they edit and
press **Save**, the app does NOT overwrite the original file — the edit lands
as an attachment on their NEXT message to you; treat it like any
freshly-uploaded file when you receive it (read it, diff against the
original, decide what to do). The file on disk at the original path is
never touched by the app.

**Rules that matter — bake them in every time:**

- **Read `~/fleet/host/name` at construction time — do NOT infer the
  hostname from the role file, `box-map.md`, prose you remember, or
  the box's tailscale name.** That file contains the exact string the
  app uses to resolve this box against its per-user host records; any
  other name (including the tailscale hostname the role file uses in
  prose) will 404 with `unknown_host`. `$(hostname)` is also wrong —
  on cloud VMs it returns something like `ip-172-31-243-143`. Never
  invent, never remember; always read.

- **Path must be absolute** (leading `/`). Relative paths land you an
  `invalid path` error at the modal.

- **Do NOT URL-encode the whole path** — browsers handle spaces/unicode
  at the individual character; the path segments themselves stay literal,
  matching how file URLs read elsewhere (GitHub blob URLs, etc.).

- **Backend reads as this box's SSH user** (usually `ubuntu`). Files
  under root-only paths — `/root/*`, `/etc/shadow`, `/proc/*`, `/sys/*`,
  `/dev/*` — will fail with a clean `permission_denied` /
  `path_forbidden` error surface in the modal. Don't try to sudo around
  this — ask the box owner to widen access if she genuinely needs to see
  the file.

- **Missing `~/fleet/host/parent` OR missing `~/fleet/host/name` =
  surface a clean user-facing error**, never guess a domain or hostname
  and never fall back to any other file-sharing pattern. The exact
  user-facing sentences are the ones baked into the recipe above —
  parent missing: *"I can't share files right now — my app-parent config
  is missing. Ask the box-maintainer role to check the distributor
  sweep."* Hostname missing: *"I can't share files right now — my
  app-hostname config is missing. Ask the box-maintainer role to check
  the distributor sweep."* On a fresh or unregistered box the distributor
  may not have populated either file yet; surfacing the failure lets them
  fix the underlying problem instead of debugging a broken URL.

### Serve URL — active content, live proxy

When you've got something running on a port on this box — a dev server, a
jupyter, a WS stream, an ad-hoc static server hosting a multi-file page —
hand them a **serve URL** that reverse-proxies through the app to it.
The app doesn't care what's on the other side; it just proxies HTTP +
WebSocket traffic through an SSH tunnel to whatever port you tell it.

Grammar:

    https://<host-id>-<port>.serve.<app-parent-domain>

Where `<host-id>` is the number in `~/fleet/host/id` and
`<app-parent-domain>` is derived from `~/fleet/host/parent`:
strip the protocol, then the serve URL constructs as
`<host-id>-<port>.serve.<the-rest>`. The host id names this machine for
every user who has it, so the same link works for all of them.
Concrete example (with the app-parent at `https://example.com`,
this box's host id `12`, and a dev server on port 3020):

    https://12-3020.serve.example.com

Construct one like so:

    APP_PARENT=$(cat ~/fleet/host/parent 2>/dev/null)
    if [ -z "$APP_PARENT" ]; then
      echo "I can't share a live serve URL right now — my app-parent config is missing." \
           "Ask the box-maintainer role to check the distributor sweep." >&2
      exit 1
    fi
    HOST_ID=$(tr -d '[:space:]' < ~/fleet/host/id 2>/dev/null)
    if ! [[ "$HOST_ID" =~ ^[1-9][0-9]*$ ]]; then
      echo "I can't share a live serve URL right now — my host-id config is missing." \
           "Ask the box-maintainer role to check the distributor sweep." >&2
      exit 1
    fi
    PORT=3020                            # the port your live thing is listening on
    # Strip https:// and split into first label + rest to insert the serve subdomain
    PARENT=${APP_PARENT#https://}
    FIRST_LABEL=${PARENT%%.*}            # e.g. "example"
    REST=${PARENT#*.}                    # e.g. "com"
    printf '[live on port %d](https://%s-%d.serve.%s.%s)\n' "$PORT" "$HOST_ID" "$PORT" "$FIRST_LABEL" "$REST"

**Round-trip semantics — passthrough only.** Any HTTP method + body +
WebSocket upgrade flows through unchanged. Your session cookie and auth
headers are stripped before forwarding — the running thing on the other
end sees a plain request from the edge, not from a specific authenticated
user (auth is enforced at the edge, not passed to your app). Modern
frontends (Vite, Next.js, anything with absolute-path assets) work
naturally because every `<host-id>-<port>` combination presents as its
own web origin under the wildcard cert.

**Rules that matter — bake them in every time:**

- **Read `~/fleet/host/id` at construction time — never use the box's
  name, the tailscale hostname, or a number you remember.** Serve URLs
  are `<host-id>-<port>` only; a name in that slot is rejected.

- **The port must be listening BEFORE you cite the URL.** If you cite
  `12-3020.serve.example.com` and nothing is on 3020, they see a
  "port 3020 isn't responding" interstitial. Polite, but still —
  don't cite dead URLs. Confirm the port is up (e.g. `ss -ltn | grep
  :3020`) before you hand them the link.

- **The port must be a plain integer in the range 1-65535.** Not a name,
  not a range. If your thing binds to a random port on startup, capture
  the port first and then construct the URL.

- **Missing `~/fleet/host/parent` OR missing `~/fleet/host/id` =
  surface a clean user-facing error**, never guess and never fall back.
  Same rule as file URLs; the exact wording is in the recipe above.

- **No workaround if the serve URL is broken.** If the serve
  infrastructure is down and the URL doesn't work, tell her and stop. Do
  NOT stand up a local HTTP server as a fallback — you'd be handing them
  a URL Chrome flags as insecure.
  **What they actually see when they click a serve URL.** Their browser
  opens `https://<host-id>-<port>.serve.<app-parent-domain>` under HTTPS
  cert. Their session + per-user-per-host access are checked, an SSH tunnel
  opens (or is reused) to the port on your box, and the app reverse-proxies
  HTTP + WebSocket bytes. Everything her browser needs — absolute-path
  assets, cookies, service workers — resolves against that same subdomain,
  so the thing on the other end behaves the way it would if they visited it
  directly.

---

## The app's user interface — what the user sees, how you drive it

The user reaches you through an app whose main surface is a chat client:
a **conversation list** down the side (a sidebar on desktop, its own
full screen on a phone), and the **content area** on the right where individual
conversations open. Everything below is a mapping so that:

- when the user asks "how do I do X in the app?", you can point her at
  the right icon, menu, or gesture; and
- when you need to drive the same thing from your side, the agent-side
  counterpart is beside each item — or you'll see a note that says
  there's nothing meaningful to drive (a pure user-navigation gesture).

**Anti-clutter rule (recurring):** most controls that create new items
in the user's sidebar (a project, a role, a scheduled task, a spawned
agent) are **user-gated on your side** — offer, don't self-execute. This
is the same posture as `/id reset`, `/id archive`, and `.no-dormancy`.
Where a section below says "user-gated," this is the rule it's invoking.

Icon language matters — when guiding the user, name the icon SHAPE
("click the clock icon", "click the drama-masks icon"), not the internal
name, so she can find it without knowing the app's terminology.

### Header of the conversation list

One control sits at the top of the conversation list, beside the app logo.
Search is a dedicated input row directly below the header (see § The
sidebar search input further down). The surfaces for standing things the
user owns — scheduled tasks, roles, skills — live in the sidebar footer
beside the gear (§ Sidebar footer); new projects are made from the
**Projects** super-header (§ Sidebar content). There is no three-dots
menu in the header and no "new group conversation" control in the app.

- **✏️ Pencil-on-paper — new conversation.** Opens the **New
  conversation** dialog. Admins first see an **Agent / Shell** switch at
  the top (anyone else never does, and has no way to open a plain shell);
  Shell shows the machine list with a search box (no list when there's
  only one machine), an optional name and a path. For an agent:
  - **Roles** is a list right in the dialog: each role's picture, name
    ("· on every host" for a role kept on every host), its one-line
    description and a check when picked. It's grouped by machine —
    the machine's name as a heading only when the user has more than one
    machine that can host agents (machines set to run the fleet); with
    one there are no headings at all. Each machine's group starts with
    **No roles** (preselected when there's only one machine). Several
    roles can be picked; they're written to the identity file as
    `roles: [a, b, ...]` in the order they were picked. "No roles" and
    roles are mutually exclusive — picking one clears the other, and
    unticking the last role falls back to "No roles" on that machine. The
    agent is born on the machine whose entry was picked; picking from a
    different machine replaces the earlier picks. A search box appears
    once there are more than eight roles. **New role…** at the bottom
    opens the roles window (drama masks) straight on its new-role form
    (on the machine of the roles already picked, if any) and, once the
    role is made, comes back with the earlier picks plus the new role;
    backing out (back or Cancel) comes back as the user left it; closing
    the roles window with its ✕ drops the picks instead.
  - **Name** is always shown, already filled with a suggested name
    ("Suggested — change it if you like."); typing replaces it, and a
    name that's taken on that machine or in Skynet says so. A roleless
    agent is visible only to the user who made it and is suggested just
    the word as its name (e.g. "duet", "duet-2").
  - **Cancel** and **Create** at the foot; Create waits until roles or
    **No roles** are picked, shows "Creating…" while the agent is made
    (nothing closes meanwhile), and the new conversation opens
    automatically.
  *Agent-side:* see § Spawning another agent — the same mechanism, but
  the agent-side lets you seed the newborn with an initial prompt, which
  the button cannot. User-gated.

### The sidebar search input

Directly below the row of header icons — still in the sidebar's fixed top
region, so it stays visible when the list is scrolled — is a single search
input with a magnifier icon inside on the left and `Search` as the
placeholder.

**Typing filters the sidebar in place.** As the user types, every section
(Apps / Pinned / Projects / Conversations) filters to just the rows whose
text matches. The match is case-insensitive substring against every string
that COULD render for a row (its title, name, role, machine, project) — not just what's visible.
That means typing an identity's name still finds it when the row is
currently showing that identity's task frontmatter on the primary line,
and typing a role name still finds every agent holding that role even when
the secondary line is currently showing a project grouping.

**Sections with zero matches disappear entirely** — header and rows both.
Typing a project's display name reveals that project, every sub-project
beneath it, and all their conversations; any match inside a sub-project also
shows the projects above it, as the path down to it.
When EVERY section has zero matches, the sidebar's scroll area shows a
centered `no matches — search everywhere ↗` message with the everywhere
link as a large tappable target — always a visible next step, never a
blank sidebar.

**The `everywhere ↗` escalation.** Once the input has any content, a small
`everywhere ↗` text link fades in on the right side of the input. Clicking
it — or pressing Enter from anywhere in the input — opens the full search
view with the current query already filled in. The full view reaches into
things the sidebar doesn't hold: archived conversations, message content
across every conversation.

The full search window is titled **Search**, with one box ("Search every
conversation"). **Return** searches — typing alone never does, and once
something new is typed the window says "Press Return to search." Before
any search it says what it covers (what you, your agents and their tools
said — archived conversations too); while searching, that it can take a
few seconds; with results, a count line ("12 conversations", "20+
conversations" when there's more to load) over the results, **Load more**
at the end. No results says "Try fewer or different words."

In the full search window, archived conversations (matching the query but
whose identity has been archived) render as rows with a three-dots menu on
the right (shown on hover, always shown on a touch screen). Clicking the menu's **Un-archive** item
starts the un-archive; the row shows a spinner ("un-archiving…") until it
finishes — usually within a minute — and then a notice says the
conversation is back (the row leaves the search view) or why it was refused
(for example, a role that itself is still archived, which the notice names).
If nothing has happened after two minutes the notice says it's still working,
and it carries on in the background. Left-clicking an
archived row itself does nothing — the identity's conversation surface
doesn't exist while archived.

**Escape clears + blurs.** Escape empties the input, the everywhere link
fades back out, and focus leaves.

**Same behavior on desktop and mobile.** There is no keyboard shortcut;
the input has to be clicked to focus. Filter query does NOT persist across app reloads — it's a quick-find
tool, not a saved view.

*Agent-side: none.* The sidebar filter is the user's navigation shortcut,
not something agents drive.

### Sidebar content (top to bottom)

- **Apps section (top).** Apps the user has built with you or a peer
  agent live here, shown as a grid of app icons with the name under each,
  like a phone's home screen; the number of columns grows as the sidebar
  widens. Click opens the app inside the client; drag an icon into the
  content area to open it in a pane. An app that isn't working shows a
  greyed-out icon and a red ⚠ before its name; hovering it (or, on a touch
  screen, the small red line under its name) says what's wrong, and the
  tooltip suggests asking an agent to check on it — if the user asks you
  about a broken app, start from the `app-development` skill.
  Each app's **menu** opens on right-click with a mouse, or by pressing and
  holding the icon on a touch screen, with:
  - **Open in new tab** — the app alone in a new Skynet tab
    (desktop only; panes already showing it stay put).
  - **Open standalone** — the app by itself in a browser tab, no Skynet
    around it.
  - **Rename…** — change the app's displayed name.
  - **Archive** — removes the app from the sidebar.
  *Agent-side:* apps are handled by the **`app-development` skill** —
  that's the source of truth for how to create, edit, or maintain them.
  If the user talks about "one of my apps," "make me an app for X," or
  asks to edit an app, reach for that skill rather than re-deriving the
  mechanics. On-disk apps live under `~/fleet/apps/<slug>/`; archived
  ones under `~/fleet/apps-archive/`. **User-gated** (via the skill).
  **Conversation apps** — apps an agent made for one conversation — never
  appear in this grid; they're reached through their chip in the chat and the
  identity modal's **Apps** tab, and are archived with their conversation.

  The Apps section header itself carries a **kebab menu** with:
  - **Archived apps** — opens the **Archived apps** window ("Apps you've
    archived. Un-archive one to put it back in the sidebar."): each app
    with its picture or initial, its name and an **Un-archive** button
    (right-clicking a row offers the same); un-archiving triggers the
    supervisor's reconciler on the app's home host and the app returns to
    the sidebar within ~15 seconds. Nothing archived says "No archived
    apps".

- **Pinned section (under Apps).** Conversations the user has pinned for
  quick access. To pin: the row's **menu** → **Move to** → **Pinned**,
  or drag it onto the Pinned section. To unpin: **Move to** → **Unpin**, or
  move it somewhere else.
  **Pinned and in-a-project are mutually exclusive** — a conversation sits
  in exactly one place. Pinning a conversation takes it out of its project;
  moving a pinned conversation into a project unpins it.
  *Agent-side:* pinning is controlled by an empty **sentinel file** at
  `~/fleet/identities/<name>/.pinned` — presence = pinned, absence = not.
  Toggle with `touch` / `rm`. If you pin yourself, also remove your
  `project:` frontmatter key — when both are set, the app shows you in the
  project and ignores the pin. Since the sentinel lives inside the
  identity's own folder, you can only pin/unpin **yourself** this way;
  peer-identity pin state isn't yours to touch. **User-gated** — same
  reason as `.no-dormancy`, this is a UI-organization signal the user
  owns.

- **Conversation rows.** On desktop each row is one line: the agent's
  picture and the conversation's title, the open conversation tinted in
  that agent's colour. On a phone each row is two lines — for an agent with
  a task line, the title, then the role or machine; otherwise the agent's
  name with its role in brackets, then the conversation's generated title
  (if any) — and each run of rows sits on one rounded panel. An
  **unread** conversation (the agent finished a turn the user hasn't seen)
  shows a small dot in the agent's colour at the row's end and a brighter
  title; a **red envelope** on the picture ("Notified you") means the agent
  notified the user (§ Notifying the user); an **amber disc** on the
  picture means the agent has local work not pushed anywhere.
  **Swipe to archive (phone).** Swiping a conversation row to the left
  archives it at once, no confirm: the row slides away and a bar says
  "Archived … · Undo" for about 5 seconds. The archive only happens once
  the bar is gone; Undo puts the row back. Rows that can't be archived
  (remote desktops, relay rooms) don't swipe.

- **Row menu on any sidebar row (conversation).** On desktop, the ⋮ that
  appears when hovering the row, or a right-click on it; on a touch screen,
  press and hold the row (rows there have no ⋮). Contents:
  - **Open in new tab** — opens that conversation in a new Skynet tab
    (a separate client instance; desktop only).
    *Agent-side: none.*
  - **Rename…** — asks for a new title and sets it as the conversation's
    row title and task line. Shown for agent conversations only.
    *Agent-side:* it writes the identity's `task:` frontmatter — the same
    field you keep current yourself, but a user-set title stands
    (§ Loading an existing identity).
  - **Move to** — drill-in submenu listing **Pinned** first, then every
    project (sub-projects indented under their parent, as in the sidebar),
    with a checkmark on wherever the row is now (at most one —
    see Pinned section above), then **New project…**, which opens the
    new-project dialog (host fixed to the conversation's own host; relay
    rooms still pick one) and moves the conversation into the project once
    it's created. It ends with **Unpin** when the row is pinned, or
    **Remove from project** when it's in a project.
    *Agent-side:* pinned = the `.pinned` sentinel (Pinned section above);
    the identity's project affiliation lives in its own frontmatter
    (`project: <slug>` in `~/fleet/identities/<name>/<name>.md`).
    Add / change / remove that key to move in / between / out; adding one
    means also removing `.pinned`. UI reflects it within a few seconds.
    **User-gated.**
  - **Archive** — retires the identity, after a confirm. See § On `/id
    archive`.

  Much the same menu appears on the conversation's **task pill** in the
  open conversation view (top-center) — its own ⋯ button, or right-click —
  with **Move to new tab** in place of Open in new tab, plus **Close**
  (desktop only), which closes that pane (§ Conversation view).

- **Projects section (below Pinned).** A **Projects** super-header
  with a **➕ plus** on its right; every project sits indented beneath it.
  The super-header shows even when there are no projects, since its plus is
  the main way to create one (a conversation's **Move to** → **New
  project…** is the other). Clicking the super-header (anywhere but the
  plus) collapses or expands the whole Projects section; a chevron on the
  far right shows which. The choice is remembered in that browser, and a
  sidebar search always shows matching projects even when it's collapsed.
  - **➕ Plus — new project.** A short dialog: a name, plus a searchable
    list of machines when the user has more than one, then Cancel / Create
    (Enter in the name also creates). Slug is derived from the name
    (kebab-case, `/^[a-z0-9-]{1,64}$/`); a name whose slug is taken gets
    `-2`, `-3`, … added.
    *Agent-side:* a project is just a folder on disk at
    `~/fleet/projects/<slug>/` containing a `project.md` with `displayName:`
    frontmatter. Direct filesystem creation works (`mkdir` + write the file);
    open frontends pick it up on the next fleet-status sweep, within a few
    seconds. **User-gated.**
  Each project shows as a folder with an open/close arrow before its name
  (pointing right when closed, down when open), and is expandable and
  collapsible. Drag conversations in and out to move them; a conversation dropped inside a sub-project lands in
  that sub-project.
  **Sub-projects.** A project can sit inside another project, to any depth.
  A sub-project shows as an indented, collapsible section inside its
  parent, above the parent's own conversations; collapsing a parent hides
  everything beneath it. A sub-project is an ordinary project in every
  other way — agents and relay rooms can be in a parent directly or in any
  sub-project, and each is still in exactly one project. A project can only
  sit inside a project on the same machine, never inside itself or one of
  its own sub-projects. If a project's parent is gone (archived, deleted),
  it shows at top level instead. A sub-project is shown only to users who
  can see every project above it. Moving a project never widens who can
  see it: if a move would let in more users, its current audience is
  kept. Archiving is refused when some
  sub-project inside is hidden from the person archiving.
  *Agent-side:* nesting is one optional frontmatter line in the
  sub-project's `project.md`: `parent: <parent-slug>`. Folders stay side
  by side under `~/fleet/projects/` — moving a project in or out is an edit
  to that line, never a folder move. No line = top level. A project's
  `members:` list holds only the agents directly in it, not those in its
  sub-projects.
  Each project header carries a **kebab menu** (on desktop it appears on
  hover; also opened by right-clicking the header) with:
  - **Edit project** — opens the **project modal** (§ Conversation view).
  - **New conversation in this project** — auto-assigns the spawned
    agent to this project.
  - **New sub-project** — the new-project dialog with an "Inside <parent
    › …>" line and no machine choice, creating the project inside this
    one (on its machine).
  - **Rename project** — changes the project's display name (the
    `displayName:` in `project.md`; the slug and folder stay put).
  - **Move to** — drill-in submenu: **Top level**, then every project on
    the same machine it could move into (indented as in the sidebar; itself
    and its own sub-projects aren't offered), with a checkmark on its
    current place. Moving a project takes its sub-projects, agents and
    rooms with it.
  - **Archive project** — retires the project together with every
    sub-project beneath it and every agent in any of them; relay rooms
    anywhere inside move back to Conversations. The confirm names the
    project and counts the sub-projects, agents and rooms first.
  On desktop a project header can also be dragged: drop it on another
  project to move it inside that one, or on the **Projects** super-header
  to move it back to top level. On a phone, **Move to** is the way.
  *Agent-side:* project membership = the `project:` frontmatter (see
  above). For spawning a fresh agent already scoped to a project, the
  cleanest path is to include a directive in the prompt of the spawn
  request for the spawned identity to add itself to the project
  immediately upon wake.

- **Conversations header (bottom).** Every conversation not pinned and
  not in a project shows up here — the default landing zone. When it's
  empty it says "Start a conversation with the pencil at the top."
  *Agent-side: none.*

- **Sidebar width (desktop).** Drag the sidebar's right edge to resize it,
  between 300 and 480 pixels wide; it starts at 300 and remembers the
  width in that browser.
  *Agent-side: none.*

- **Drag & drop / split view.** Dragging any sidebar item (conversation
  or app) into the content area opens it (or, if something is already
  open, presents a placement UI so the user can split the view —
  arbitrary depth). Dragging a **file chip** out of a chat bubble does the
  same for that file: it opens in a new **file pane** (each drag opens
  another, even for a file already open). Dragging the green **monitor**
  button beside a conversation's task pill does the same for that agent's
  virtual desktop: it opens in a new **desktop pane**. Each open conversation pane has a **task pill** (relay rooms: a **badge** per participant), each
  open app pane its **app bar**, each remote-desktop pane its
  **remote-desktop bar**, each file pane its **file bar**, and each desktop
  pane its **desktop bar** (all below); dragging it to a different spot in
  the split tree rearranges panes. Moving an app pane keeps the app on the
  page it was on; moving a remote-desktop pane keeps it connected.
  While a task pill, badge or pane bar is being dragged, a **drop lane** appears along
  the left edge of the content area (beside the sidebar, or at the window
  edge when the sidebar is collapsed): its top two-thirds is **Close**
  (✕ — closes that pane), its bottom third **Archive** (archives the agent
  after the usual "can't be undone" confirm; shown only for an agent's own
  conversation, not relay rooms, apps, remote desktops, files or agent
  desktops). Dropping a conversation's task pill
  on a project, Pinned, or Conversations files it there, exactly like
  dragging its sidebar row, and the pane stays open. Dropping anywhere
  else in the sidebar does nothing.
  **Pane sizes.** Panes side by side (or stacked) in one row or column
  share it evenly — three in a row are thirds. Drag the line between two
  panes to resize just those two (a pane can't be squeezed below a usable
  minimum); double-click the line to even its row or column back out.
  Where lines meet (one line ending on another, or lines from both sides
  ending on the same one) the cursor becomes a four-way arrow and every
  line there lights up: dragging that point moves all of them at once,
  each along its own direction, and double-clicking it evens them all.
  Adding, closing or moving a pane evens out only the rows and columns it
  joined or left. Sizes survive a reload along with the layout. Desktop
  only — a phone shows one pane.
  *Agent-side: none.* Pure client-side window management; no persistent
  state, no disk artifact.

- **App bar (top of every open app).** A plain dark bar across the top of
  an open app's pane, whether the app fills the screen or sits in a split.
  Left: **back**, **forward**, and **reload** (circular-arrow) buttons —
  they act only on the page inside that app, never on Skynet or any other
  pane, and back/forward grey out when there's nowhere to go. Going back
  or forward loads that page fresh (it isn't restored mid-scroll). On a
  touch screen the bar is a little taller and starts with a round grey **back to
  conversations** (‹) button — the same job as the one that floats at the
  top left of a conversation — which returns to the conversation list without moving
  the app off its current page. On a phone, pages inside an app don't
  build up the browser's history: the phone's back gesture (or browser
  back) in an app goes to the conversation list, and stepping back a page
  inside the app is the bar's back button.
  Center: the app's icon and name. Right: a **three-dots (⋯) button** —
  always visible, phone included — opening the app's menu; right-clicking
  the bar opens the same menu, in the same look as the sidebar's menus:
  **Move to new tab** (desktop only — opens it in a new Skynet tab
  and closes this pane), **Open standalone**, **Rename…**,
  **Close** (desktop only), **Archive** (the same double-confirm as the
  sidebar app tile's; closes every open pane of that app). A **conversation
  app's** menu has **Move to sidebar** in place of Rename… and Archive: it
  asks the agent that made the app to move it to the sidebar (the item then
  reads "Move to sidebar requested" until the page reloads); the agent does
  the move and confirms in its conversation. The **whole bar is the drag handle**, same as a
  conversation's task pill: drag it to the drop lane's Close to close the app,
  onto another pane to rearrange, or into another Skynet window. On a phone the
  bar shows but isn't draggable.
  *Agent-side:* the navigation buttons and window actions: none — the app
  never knows it's being navigated from the bar. Rename and Archive are the
  same actions as the sidebar tile's, handled by the `app-development`
  skill; **user-gated**. Move to sidebar reaches you as a
  `<task-notification>` event ("Move to sidebar — delivered by the app") —
  follow the `app-development` skill's § Moving a conversation app to the
  sidebar.

- **Remote-desktop bar (top of every open RDP / VNC / telnet session).**
  The same bar as an app's, across the top of a remote-desktop
  pane. Left: a single **reconnect** (circular-arrow) button that drops
  and re-opens the connection to that machine. Center: a monitor icon
  (terminal icon for telnet) and the machine's name. Right: the **⋯**
  menu — **Move to new tab** (opens the session in a new Skynet tab and
  closes this pane) and **Close** — also on right-click; both are desktop
  only, so on a phone there is no ⋯. On a touch screen the bar is taller
  and starts with the round **back to conversations** (‹) button, same as
  an app's. The **whole bar is the drag handle**: drop it on the drop lane's
  Close, onto another pane to rearrange, or into another Skynet window
  (that window connects fresh and this pane closes). Not draggable on a
  phone. While a remote session is open, its machine's row stays in the
  sidebar's RDP section (highlighted like an open conversation) instead of
  moving up to Conversations, and clicking that row returns to the open
  session rather than opening a second one.
  *Agent-side: none.*

- **File window (click a file chip in a chat, or a file in any Files tab).**
  One window, the same wherever a file opens. Header: the file type's icon
  and the name — just the name; where the file lives isn't shown (Copy path
  in ⋯ has it for chat files). Right: read aloud
  (prose files), the view switch (e.g. Table / Raw, Rendered / Source, and
  **Formatted / Plain text** for markdown), the main button, **⋯**
  (Download; Copy path for chat files), close. How it opens follows the
  file's type: things you look at, watch or listen to (pictures, video,
  audio, slides, Excel, fonts, ebooks, emails, …) just show — no Edit;
  documents (markdown, Word, PDF, notebooks) open for reading with
  **Edit**, which brings in the editing tools plus **Cancel** and **Save**
  (Cancel asks first when there are unsaved changes; after saving in a
  Files tab it goes back to reading); things you work on (code, plain text, CSV tables,
  subtitles, diagrams written as text, drawings) open ready to type with
  Save. Save stays dimmed until something changes. Types that show a
  picture-like view but also have a text view (diff Raw, calendar or
  contacts Source) can be edited in the text view. In a chat, **Save**
  attaches the edit to the user's next message (it shows as an attachment
  in the compose box) and closes the window — the file itself is never
  written over; in a Files tab **Save** writes the file in place. Closing
  with unsaved changes asks first. On a
  phone it fills the screen; the name keeps the top row with ⋯ and close,
  the view switch and the main buttons sit on a row under it, and read
  aloud is in ⋯. The Formatted / Plain text switch is one
  choice for every markdown editor in the browser; in editors inside other
  windows (agent file, role file, About you, …) it sits at the right end of
  the formatting toolbar while editing formatted, and in its own row above
  the text otherwise; when a file has markup the formatted view
  can't show, Formatted is greyed out and the file opens as plain text.
  *Agent-side:* see § Sending files to the user (Round-trip semantics).

- **File bar (top of every open file pane).** A file dragged out of a
  conversation, shown **view-only** with the same viewers the file window
  uses (nothing can be typed, edited or annotated, and there's no Save).
  The same bar as an app's. Left: **reload** (circular-arrow —
  re-reads the file from its machine, e.g. after you've changed it) and
  **download**. Center: the file type's icon and the file name — just the
  name; where it lives is in **Copy path**. Right: a **read aloud** button
  for prose files (.md / .txt — same as the file window's), the view
  switcher for types with more than one view (e.g. Rendered / Source, and
  Formatted / Plain text for markdown), then the **⋯**
  menu — **Open in modal** (the file window, opened in the
  conversation the file came from so Save attaches the edited copy there;
  when that conversation isn't open in this Skynet tab the modal opens
  view-only), **Copy path**, **Download**, **Move to new tab** and
  **Close** (both desktop only) — also on right-click. The **whole bar is
  the drag handle**, same as the app bar. If the file can't be shown
  (deleted, too large, no access) the pane stays with a notice saying why;
  reload tries again. File panes come back after a page reload. Desktop
  only — there's no way to open one on a phone.
  *Agent-side: none.* The pane never writes your file; if the user
  mentions a file "open beside" the conversation, it's this pane. When
  you change a file the user has open, they press reload to see it.

- **Desktop bar (top of every open desktop pane).** An agent's virtual
  desktop in its own pane — the same live view as the identity modal's
  **Desktop** tab, opened by dragging the green monitor button beside the
  task pill, or with **Open beside conversation** on that tab. The same
  bar as an app's. Left: **reconnect** (circular-arrow), then
  **Take control** (hand) — or, while the user has control, **Hand back to
  agent** (undo arrow, amber). Center: a monitor icon, the agent's name,
  and beneath it in faint text whether it's view only, under the user's
  control (agent paused), or paused because someone else has control.
  Right: the **⋯** menu — **Move to new tab** and **Close** (both desktop
  only) — also on right-click. The **whole bar is the drag handle**, same
  as the app bar. The picture scales to fit and never resizes the agent's
  screen. Control is handed back when the pane closes or its connection
  drops. If the desktop stops, the pane stays with a "desktop isn't
  running" notice and a **Start desktop** button. Desktop panes come back
  after a page reload. Desktop only — there's no way to open one on a
  phone.
  *Agent-side:* see the `desktop` skill (§ If the user takes control) —
  control taken from a pane pauses you exactly as from the modal.

### Sidebar footer

The footer holds the user's avatar and name on the left. On the right is a
row of icons, in this order: clock, drama masks, lightning bolt, then (admins only)
crown, then gear.

- **🕐 Clock — scheduled tasks.** Opens the scheduled tasks window: every
  task the user has, grouped by machine, one search box, **New** at the
  top. Clicking a task opens it one level deeper in the same window, with
  **‹ back** top-left (Esc also goes back); **New** opens the same view,
  blank. A role's scheduled-tasks line (roles window) opens it on just
  that role's tasks on its machine — "With <role> on <machine>", **Show
  all** to drop that. Details in § Scheduled tasks — User-side counterpart.
  *Agent-side:* see § Scheduled tasks. **User-gated.**

- **🎭 Drama masks — roles.** Opens the roles window — one window that
  moves between views, with a **‹ back** control top-left (Esc also steps
  back one level; the X closes). Leaving a view with unsaved edits asks
  first.
  - **Roles** (opens first): a machine picker (only with more than one),
    **New role**, a search box, then every role as a row — picture, name,
    its one-line description, how many agents hold it. Shared roles sit
    first under **On every host**, then **On <machine>**. A last row,
    **Archived roles**, shows how many there are and opens them.
  - **A role** (click a row): its picture (click to upload a new one),
    name and one-line description — a faded *No description* when it has
    none; click it (pencil) to edit in place, Enter saves, Esc cancels.
    Under that a quiet line ("3 agents hold this role · on every host")
    ending in a link to its scheduled tasks ("2 scheduled tasks ›", or
    "No scheduled tasks ›") — it closes the roles window and opens the
    scheduled tasks window on just that role's tasks; then **Colour** and
    **Voice** buttons. Tabs: **Role file** (formatted; **Edit** at the
    bottom switches to editing with Cancel / Save), **Skills** (the
    role's skills — § Role skills — each row its name and one-line
    description, the same as a row in the Skills window; plus **New
    skill**, which asks for a name and then a required one-line
    description, and opens the new skill), **Files** (everything in the role folder
    `~/fleet/roles/<slug>/` except the role file itself, which has its own
    tab) and **Git** when the folder holds a repo. The **⋯** menu has
    **Start a conversation** (opens the new-conversation dialog with this
    role picked), for admins **Make instance-wide…** / **Stop sharing…**,
    and **Archive role…** — one confirm naming the agents that hold it,
    which are archived with it; greyed out on a shared role ("Stop sharing
    it first").
  - **A role skill** (click one under Skills): one level deeper; back
    reads the role's name; its name heads it with its description under
    it, as a skill does in the Skills window. It opens on its `SKILL.md`,
    filling the window;
    an **N files** button shows the file list (**Add file** at its bottom;
    on a phone the list swaps in for the editor). Close / Save at the
    bottom; **⋯** has **Add file…**, **Rename…** and **Delete skill…**.
    Rename changes the skill's folder and the `name:` in its `SKILL.md`
    together; saving a `SKILL.md` whose `name:` no longer matches the
    folder offers the rename instead.
  - **New role**: picture first (**Generate picture** offers three to pick
    from, or **Upload…**), then name, description (shown under the role's
    name; it also starts the role file), colour and machine. Cancel or
    back leaves it (asking first if anything is filled in); **Create
    role** lands on the new role.
  - **Archived roles**: each row has **Un-archive**; the row then says the
    role is on its way back — the supervisor's reconciler moves the folder
    back to `~/fleet/roles/<name>/` within ~15 seconds.
  A shared role is view-only for anyone who isn't an admin: no editing, no
  colour, voice, picture or description changes, and its skills and
  files are read-only.
  *Agent-side:* a role is a folder at `~/fleet/roles/<slug>/` holding a
  `<slug>.md` role file and its avatar; the one-line description is the
  role file's `description:` frontmatter key. Create one with a role
  request (§ Creating a role) — never by writing the folder yourself, which
  leaves it without an avatar or color. Editing an existing role file
  follows § Editing the role file (propose + wait for greenlight).
  Creating a new role is **user-gated**; on greenlight, offer to
  immediately spawn a fresh agent of that new role as a follow-up.

- **⚡ Lightning bolt — skills.** Lists the user's skills; view/edit any, or create
  a new one. Skills here are surfaced to every one of the user's agent
  sessions. Two views in one window:
  - **The skill list** (opens first): a search box, a filter — **All /
    You / Agents**, each with a count — and every skill as a row with its
    one-line description and two switches under **You** and **Agents**
    column labels. **You** on = it's in the compose box's Skills button and
    `/<name>` runs it (off = `user-invocable: false`). **Agents** on =
    agents use it on their own (off = `disable-model-invocation: true`).
    A flip saves at once; there's no Save here. At least one stays on —
    turning off a skill's last switch is refused with a short note; a skill
    already set to neither on disk shows "Nobody can use this". **New
    skill** (top right) asks for a name and a description, then opens the
    new skill.
    Skills **shared to every host** (kept in step by an admin) have their
    own section at the top: everyone uses them like their own (Skills
    button, `/<name>`, agents), but only an admin can change them — for
    anyone else they're view-only, with ticks in place of the switches.
  - **One skill** (click a row's name): **‹ Skills** goes back; the name and
    description head it, the same two switches sit under that ("In my
    Skills button", "Agents can use it" — they wait while SKILL.md has
    unsaved edits), and a **⋯ menu** holds **Rename…** and
    **Delete skill…**. Rename changes the skill's folder (so `/<name>`
    changes) and the `name:` in its SKILL.md together. Editing `name:` in
    SKILL.md by hand doesn't save as is: Save offers to rename the skill to
    that name, since the name and the folder always match. Skills shared to
    every host and fleet-distributed ones can't be renamed.
    The editor opens on SKILL.md; the skill's other files stay behind an
    **"N files"** button in the file's toolbar, which opens the file list
    (grouped by folder, a find box past ten files, **Add file** at the
    bottom). On a phone the list takes the editor's place until a file is
    picked. Leaving with unsaved edits — back, another file, Esc, the X —
    asks first.
  *Agent-side:* skills live at `~/.claude/skills/<skill-name>/SKILL.md`
  (folder + sentinel file, mirroring this id skill's own layout).
  Reading is fine; **creating or editing follows the same
  "propose + wait for greenlight" rule as role files, `AGENTS.md`, and
  the user-wide `CLAUDE.md`** — skills become standing behavior for
  every session, so they need user sign-off.
  **When the user asks you to create a skill, ASK who should be able to
  invoke it** — agents only, the user only, or both — unless they already
  said. Set the matching frontmatter flag (above) when you write it.

- **⚙️ Gear icon — Preferences.** A side list that opens on the user's own
  **account card** (picture and name); each section starts with its name
  and a line saying what it's for, and settings save as they change (no
  Close button — the ✕ closes).
  - **Account** (the card) — the picture (click it, or **Choose…** /
    **Remove**) and **Log out**, which asks first.
  - **About you** — content every one of the user's agents automatically
    sees. Good for shared preferences, info about the user, or anything
    she'd otherwise have to re-tell each agent. A **Machine** row picks
    which machine's copy (only machines that can run agents; it's always
    set to one). The file reads formatted; **Edit** opens the editor with
    **Cancel** / **Save**, and leaving with unsaved writing asks first. The
    window grows wider while this section is open.
    *Agent-side:* this section is a UI on `~/.claude/CLAUDE.md`. Edits
    the user makes in **About you** land as edits to that file, and the
    § User-wide file (`~/.claude/CLAUDE.md`) rules apply to agent-side
    changes (propose + wait for greenlight).
  - **Voice** — the voice used by the per-bubble speak button on agent
    messages (with a play button to hear it; a saved voice the current
    voice service doesn't have says what plays instead), a **speed
    slider** (0.25×–4×, default 1×, with a Reset) for how fast agents
    speak, **when voice mode sends**: *After a pause* (default — three
    seconds of silence) or *When I say a phrase* (silence never sends;
    ending with the phrase does — "send it" by default, editable, shown
    only when that's chosen). Follows the user's account across devices.
  - **Notifications** — where notifications from agents (§ Notifying the
    user) arrive outside the app, through the user's OWN Telegram bot ("When
    an agent notifies you, it arrives through Telegram."); each user sets
    theirs up here, nothing server-side. The
    section walks them through three numbered steps: open @BotFather in
    Telegram (**Open BotFather**), send `/newbot`, pick a name and a
    username ending in `bot`, then paste the token BotFather sends and tap
    **Connect** (Skynet checks it with Telegram first). Then **Open my
    bot** → tap **Start** in Telegram links the chat (the section notices
    within a few seconds); **Use a different bot** starts over. Once linked
    it shows the Telegram account, an **Only show who messaged** switch,
    **Send a test notification**, and **Disconnect** (removes the whole
    setup); sending `/stop` to the bot unlinks the chat but keeps the bot.
    Each notification is a message from their bot with an **Open in
    Skynet** button. No desktop push.
  - **Phone** (only when the user has a number on file) — the number,
    editable in place (**Save** appears once it's changed), and **Remove
    phone number**.
  - **Services** (only when the user has keys of their own to manage) —
    keys their agents use for outside services: set, replace or remove,
    never shown back.
  - **About** — pinned at the bottom: the instance's own name and logo,
    its version, a **Source code** link, and **Licence** / **Included
    components**, each one level deeper.

- **Feedback dialogs.** Where feedback is switched on, **Send feedback**
  (sidebar footer) and a thumbs-down on an agent's message open a small
  dialog with a text box. **Send** waits for some text; after sending, the
  dialog says "Thanks — sent." and closes itself. The thumbs-down one says
  the vote is sent either way and offers **Send without a note**; closing
  it also sends the vote.

- **Side-list modals on a phone.** Preferences and Admin list their
  sections down the left on desktop. On a phone they drill in instead: the
  list fills the screen (Preferences shows it as rounded groups — the
  account card, the sections, About), tapping an item opens it full screen
  with a back arrow (‹ Preferences) to return.

- **Small modals on a phone are sheets.** Short dialogs — new
  conversation, new project, the feedback form,
  and every confirm / "name it" / notice dialog — slide up from the bottom
  of a phone, only as tall as their content, with a grab bar on top and the
  app dimmed above, their buttons stacked full-width with the main one on
  top. A swipe down closes one that has nothing typed in it; once
  something's been typed a swipe springs it back instead, so nothing is
  lost by a slip, and a sheet that's busy (e.g. creating an agent) springs
  back until it's done. ✕ or Cancel closes as usual. Bigger modals (skills,
  an agent's modal — new wake-up included — the roles window — new role
  included — preferences, search, files) still fill the phone
  screen. While the on-screen keyboard is up, a sheet sits on top of it.

- **Confirms are Skynet's own dialogs.** Every "are you sure?", "type a
  name" and "something went wrong" moment — archive, delete, discard
  changes, rename, reset context, log out — is an in-app dialog in the
  app's look, not the browser's grey pop-up: a short question, a line of
  detail, and named buttons (the destructive one red, e.g. **Archive**,
  **Delete**, **Discard** — and a destructive question starts with Cancel
  focused, so Enter alone never deletes). A "type a name" dialog shows
  what's wrong under the field instead of re-asking. Esc or Cancel backs
  out.

- **What's new (pops up after an update).** When Skynet has been updated
  and the user hasn't yet seen the notes for what changed, a **What's new**
  window opens on its own when the app loads: a sparkle tile, "What's new
  in <the instance's own name>", and the notes as a short grouped list,
  newest first, covering every update they missed. **Continue** (or the
  X / Esc) closes it and marks those notes seen on their account — it
  won't show again on any device until something new ships. Updates with
  nothing user-facing show nothing, and there is no place to reread old
  notes. If the user asks what changed recently, this is what they saw.
  *Agent-side: none.*

### Conversation view

- **Swipe right — back to the list (phones and tablets).** On a touchscreen,
  swiping right anywhere on an open conversation drags the conversation list
  in over it, following the finger; letting go past about a third of the
  screen (or flicking) goes to the list, letting go short slides it back.
  Same result as the round ← button at the top left. It doesn't start on the
  compose box or other text fields, on selected text, while a dialog is open,
  on controls that take their own drags (the mic, a split-view divider, a
  zoomable image), or on wide content (a code block, a table) that's
  scrolled sideways — there it scrolls the content back first. Over an open app's page the app
  gets the touch; swipe on its bar instead.
  *Agent-side: none.*

- **App chip (in a message).** A link an agent writes to an app's pane
  address shows as a chip with the app's icon and title — for conversation
  apps and sidebar apps alike. Clicking it opens the app (same as a sidebar
  tile click); on desktop, dragging it into the content area splits the view,
  e.g. the app on one side and the conversation it came from on the other.
  A link to an app the client doesn't know (its conversation was archived)
  still shows as a chip, with a generic app glyph and the app's name from
  the link.
  *Agent-side:* hand an app over by linking its pane address (§ Sending
  files to the user); the `app-development` skill has the details.

- **Task pill (top-center of the open conversation).** The conversation's
  handle, and the only thing at the top of an agent conversation — the same
  in chat view and terminal view. A solid dark pill floating over the top of
  the chat (messages scroll under it, fading to dark): the agent's picture
  with a thin ring in the agent's colour, then the one-line description of
  what the agent is working on — the identity's `task:` frontmatter
  (§ Loading an existing identity), or the agent's name when there is none,
  the same string as the sidebar row's title. Click = opens the
  **identity modal** (below). A **⋯ button** at the pill's
  right end — always visible, and the way in on a phone — opens the
  conversation menu; right-clicking the pill opens the same menu: **Move to
  new tab** (desktop only), for admins **Switch to terminal view** / **Switch
  to chat view**, **Rename…**, **Move to** (Pinned + projects),
  **Close** (desktop only), **Archive**. Drag = see § Drag & drop (drop
  lane, filing into sidebar sections); not draggable on a phone. Hovering
  shows the agent's name, roles and project. On a phone the round **back to
  conversations** (←) button floats level with it at the top left, in the
  same solid dark look. (Relay rooms show a badge per participant instead;
  each agent's badge has its memory pie under it.)
  *Agent-side:* keep `task:` current, silently. Rules already covered.

- **Round buttons beside the task pill.** Just to the right of the pill,
  shown only while their condition is true, each a shortcut into the
  identity modal: a green **monitor** button while the agent's virtual
  desktop is running (opens the Desktop tab), and an amber button while the
  agent has local work not pushed to any remote (opens the Git tab). Both
  are the pill's height. They pulse briefly when they appear, then hold a
  steady color. On desktop the green button can also be dragged into the
  content area to open the desktop as its own pane (§ Desktop bar).
  *Agent-side:* starting your desktop (`desktop` skill) makes the green
  button appear for the user within a few seconds; stopping it removes it.

- **Identity modal (click the task pill).** One window for the agent. Its
  top shows who the agent is: picture, name, its roles as links (each opens
  the roles window on that role), the task line with a pencil (edit in
  place), a quiet line naming the project it sits in — top level down,
  `In Morpheus 2 › M2 · Runs`, absent when it's in none — and a **Voice**
  button (the voice's name, or "Role's voice") that opens the voice list.
  No Close button at the foot; the ✕ and Esc close it. Three tabs, plus
  three that appear only when there's something to show. A wake-up, a new
  wake-up, a repo, a commit and a diff each open **one level deeper in the
  same window** with a back control (‹ the agent's name, or the level
  above); back and Esc go up exactly one level. Leaving the agent file or a
  wake-up with unsaved changes by any route asks "Discard your changes?".
  - **Agent file** — the identity's own `<name>.md`, formatted; **Edit**
    at the foot switches to the editor with Cancel and Save.
  - **Wake-ups** — the identity's scheduled wake-ups (§ Scheduled
    wake-ups) as a list. Each row has a small icon for its kind (clock,
    sensor, one-time), its name, then the schedule and when it last fired
    (`Daily at 09:00 · Last fired 3h ago`, or `Never fired`), an on/off
    switch that saves at once, and a chevron. A sensor-fired wake-up's line
    reads `📡 Sensor · <status> · Last fired …`, plus why when it has
    tripped. Status is one of
    **Healthy**, **Broken** (red), **Running long**, **Off** (switched
    off), **Tripped** (amber — it fired more than its hourly limit, so the
    box switched it off and told an agent; the line adds why), **Not live yet** (sensor not published) or **Unknown** (status
    can't be read — no health record, one more than 5 minutes old, or the
    machine stopped answering a refresh). A one-time sensor (retires after
    its first delivered fire) reads `📡 Sensor · once · …`; the mark is
    shown, not editable. The tab re-reads itself every ~30s while it's
    showing. **New wake-up** sits under the list.
    Opening a wake-up shows its form: an **On** switch (saves at once),
    Name, When (Daily / Weekly / Monthly / Yearly / Every… / Once and
    each kind's options, including "Only on" days), Time zone (blank = the user's own, or the machine's own
    for a wake-up saved without one; a one-time wake-up always uses the
    user's own),
    Instruction, and a red **Delete wake-up…** at the bottom; Cancel and
    Save at the foot. **New wake-up** is the same form, blank, with
    Create. A sensor wake-up shows "When its sensor fires" and a read-only
    sensor section instead of schedule fields: status, how it runs, last
    ran (`Running since` for an always-on sensor), last fired, when and why
    it tripped, and the sensor's last error lines when broken. The on/off
    switch is the only sensor control in the app — switching a tripped
    sensor back on resumes it fresh, and switching any sensor off throws
    away fires still waiting — sensors are built by agents
    (`sensor-development` skill).
  - **Files** — full workspace explorer for the identity's `workspace/`
    folder: browse, download, upload, create files and folders, and
    open any file in the file window (§ File window) to read or edit it. Each file/folder row has a **three-dots menu** — Rename,
    Download (files only), Delete — also opened by right-clicking the row.
    A **search box** (magnifier, with a ✕ to clear) on its own row under the toolbar
    finds files and folders by name in the folder being viewed and every
    folder below it — as the user types, case ignored, every word must
    appear in the name (any order); names only, not file contents. Results
    replace the listing, each with the folder it sits in under its name,
    nearest first, and act like normal rows (open, three-dots menu). A
    result's menu adds **Show in folder**, which opens the folder it sits
    in, ends the search and briefly rings the item there. A
    folder result opens that folder and ends the search; Escape or a
    breadcrumb jump clears it. Package and environment folders
    (`node_modules`, `.venv`/`venv`) and `.git` are never searched; it
    stops at 200 results or about 5 seconds and says so when it does. The
    role and project Files tabs have the same search box.
  - **Apps** (only when the conversation has apps of its own) — the
    agent's conversation apps, each with its icon, title and description.
    Clicking a row closes the modal and opens the app; each row's ⋮ holds
    one item, **Move to sidebar** (same as in the app's own bar menu).
  - **Git** (only when the workspace holds a git repo) — read-only. One
    repo shows straight away; several show as a list first. A repo shows a
    summary (branch, commits not pushed / behind, **Check remote**,
    refresh), then **Changes**, **History**, stashed work and remotes.
    A changed file opens its diff; a commit opens its list of files (with
    lines added/removed), and a file there opens its diff; **View all**
    shows every change at once. Nothing in it changes a repo.
  - **Desktop** (only while the agent's virtual desktop is running) — a
    live view of the agent's own desktop. Picking this tab shapes the
    modal to the desktop (its height follows the picture) and shrinks the
    top to a small picture and the name; other tabs put it back. The
    picture scales to fit and never
    resizes the agent's screen. It starts **View only**; **Take control**
    hands the user's mouse and keyboard to the desktop and pauses the
    agent's own desktop input (Esc then goes to the desktop, not the
    modal). **Hand back to agent** returns it; leaving the tab or closing
    the modal hands back too, with a "Handed back to agent" note.
    **Open beside conversation** (desktop only) closes the modal and opens
    the desktop in its own pane to the right of the conversation
    (§ Desktop bar).
    *Agent-side:* see the `desktop` skill (§ If the user takes control).

- **A role from an agent (click a role name in the identity modal's
  header).** Opens the roles window (drama masks) straight on that role,
  scoped to that agent's machine; **‹ Roles** goes to that machine's list,
  and closing the window returns to the agent's identity modal.

- **Project modal (project header kebab → Edit project).** The project's
  own window, laid out like the identity modal; close X only. On top: a
  folder tile, a quiet "In <parent> › …" line for a sub-project, the
  project's name, and a count of what sits directly in it as the sidebar
  shows it ("2 conversations · 3 sub-projects"). Two tabs; opens on the
  first:
  - **Project file** — `project.md` formatted for reading (frontmatter
    hidden), with read aloud and **Edit** at the bottom; editing shows
    Cancel / Save, and saving goes back to reading. A file with nothing
    written below its frontmatter shows "Nothing written yet" and a
    **Write it** button instead. Leaving the editor with unsaved changes
    (Cancel, Esc, the X, switching tabs) asks first; Esc while reading
    closes the window.
  - **Files** — the same explorer as the identity and role Files tabs,
    over the project folder (`~/fleet/projects/<slug>/`): browse,
    download, upload, create, edit, rename, delete. `project.md` is
    hidden from the root listing, and uploading, creating, renaming onto,
    renaming or deleting it from here is refused with a pointer to the
    Project file tab. This is how the user drops reference files into a
    project without asking an agent — so a file can appear in your
    project folder that no agent put there. Nothing notifies members when
    the folder changes; look in the folder when the work calls for it.
    An empty project folder says "No files yet"; an empty folder inside
    it says "Empty folder".

- **Messages.** The agent speaks in solid bubbles in its own colour (the
  colour is how the user tells agents apart); the user's own messages are a
  neutral grey bubble on the right. A faint **speak** button sits just
  outside each agent bubble's bottom-right corner (inside it on narrow
  panes). While the agent works, an **orb** in its colour spins beside the
  word "Working" (an installation with its own working image in its branding
  shows that instead). **Load older messages** is a small pill at the top
  of the list; **Jump to latest** (↓) floats centred just above the
  composer once the user has scrolled up. The agent's **task list** (its
  checklist while it works through steps) sits as a slim card just above
  the composer; background sub-agents and shells are not shown.
  Messages the agent used to **notify the user** (§ Notifying the user)
  appear as ordinary agent bubbles, always open, with a small red
  **envelope** on the top-left corner ("Notified you") — the same envelope
  the sidebar puts on the conversation until the user opens it. One that
  failed to send shows open too, with a "⚠ not sent" mark (tap it for the
  reason) and no envelope. Coming to a
  conversation that has one the user hasn't seen lands on the oldest unseen
  one and briefly rings it, instead of the bottom. Messages **between agents** show as quiet grey cards, folded:
  the sender's picture, "Finch → Bilbo" and a one-line preview; tap to
  read. In a **relay room** the user opened, each agent's messages are
  bubbles in its colour with its name on top.
  *Agent-side:* a message you relay to the user normally shows in your own
  conversation as one of your bubbles. While the room's members are still
  loading, or when the recipient can't be worked out, it shows as a folded
  "<you> sent a DM" card instead — so still say in your reply that you sent
  it.

- **Composer (bottom of the conversation).** One rounded card floating
  over the end of the message list: the text on top, every control on one
  row under it. Left: the **paperclip** (attach files) and the **⚡ Skills**
  menu. Right: the **agent memory** pie, the **sound-wave** (voice mode),
  the **mic** (dictation), and one round off-white **main button** that does
  the likely next thing — **Send** while there's something typed or
  attached, **Stop** (square) while the agent is working, otherwise a
  **thumbs-up** (sends "thumbs up"). With text typed, the thumbs-up — or
  Stop, while the agent works — sits as a small grey button just left of
  Send, so a thumbs-up never needs the draft cleared. With nothing typed,
  a small grey Stop always sits beside the thumbs-up (and beside Resume
  while an aside is up), so Stop is never out of reach. Background sub-agents don't count as working here
  (they run on through a Stop). In a relay room only
  the mic and Send show.

- **Agent memory (the pie in the composer's row).** Shows how full the
  agent's context window is — the same "runway left" the agent's own
  context-watch (§ Ambient plumbing) tracks. Grey with no number while
  there's room; **amber** with the percentage from 45%; **red** from 78%,
  with a gentle pulse and a thin red line along the composer's edge. Tapping
  it opens a small pop-over — how full, what that means, and **Start fresh**,
  which (after a confirm) types `/id reset` into the harness — same command,
  same effect (§ On `/id reset`).
  *Agent-side: none.* If the user starts fresh before your ~90% nudge
  fires, it arrives as a real `/id reset` — save + recycle sentinel +
  stop, same as always.

- **Permission bubble (in the conversation, below the last message).**
  When Claude Code stops to ask the user's OK for a tool call (a safety
  check the fleet's auto-allow can't skip, e.g. a risky `rm`), the
  conversation shows a bubble in the agent's colour, with a hand icon, saying what the agent wants
  to do ("<agent> wants to run a command"), the tool's one-line description,
  the actual command, and why it was flagged, with **Allow** and **Deny**
  buttons and **Show details** (the full command plus Claude Code's exact
  reason). Allow lets the call run; Deny refuses it
  and stops the agent's turn until the user says what to do instead. When
  Claude Code shows an auto-deny countdown, the bubble shows it too and
  disappears when it runs out (the call is refused and the agent carries
  on); if the agent is still waiting on something else a few seconds later,
  a one-line bubble takes its place. Other waits it can't read (e.g. a folder-trust dialog) show as a
  one-line bubble to answer in the terminal view.
  *Agent-side:* a denied or timed-out call comes back to you as a refusal;
  rewriting it so the check doesn't fire (e.g. `"${VAR:?}"` in `rm` paths)
  avoids the prompt entirely.

- **Mic (in the composer's row) — dictation.** Tap the mic to dictate;
  hold it to record and release to send. While recording, a red-tinted
  chip in the row shows "Recording", a timer and a live waveform (on a
  phone just the dot, timer and waveform, and the memory pie steps aside;
  held:
  "release to send · slide off to cancel"); the paperclip and Skills stay
  usable, and a tapped recording puts **mute** (mic icon; crossed out and
  red while muted — the recording carries on but hears silence until
  unmuted), **Cancel** (red ✕), **add to text** and **Send** on the right.
  Each recording starts unmuted.
  *Agent-side: none.*

- **Stop (square) button — interrupt** (agent conversations). The
  composer's round main button while the agent's main turn is working and
  nothing is typed; with text typed, a small grey square just left of Send;
  otherwise a small grey square beside the thumbs-up (or beside Resume). One
  press does whichever of
  these fits the moment:
  - **Still being delivered** (the message hasn't reached the agent yet):
    the button is greyed out — there is nothing to stop.
  - **Cancel** (pressed before the agent has done anything with the latest
    message): the message is withdrawn — its bubble disappears and the
    user's words (and attachments) come back into the compose box — above
    anything they had already started typing, with a blank line between.
  - **Stop** (the agent had started): the agent stops, the user's message
    stays, and an agent-side bubble reading **Interrupted** confirms it;
    the work indicator goes off.
  - Pressed when there turns out to be nothing running, it does nothing.
  On a press the button at once turns into a small chip with a spinner and
  **Stopping** (deciding on a cancel takes about a second and a half),
  then shows what happened for two seconds — **Stopped**, **Cancelled** or
  **Nothing to stop** (**Failed** if the press didn't go through). The chip
  holds Stop's place until then — the round button doesn't turn into the
  thumbs-up under a second tap.
  The same conversation open elsewhere drops a cancelled bubble too; only
  the device that pressed gets the words back.
  *Agent-side:* a cancelled message never reaches you. A stop arrives as
  "[Request interrupted by user]" in your context.

- **Sound-wave button — hands-free voice mode** (agent conversations
  only). Sits in the composer's row, between the agent-memory pie and the
  mic. Tapping it turns voice mode
  on: the app listens, sends what the user says when their turn ends, reads
  each new agent reply aloud, then listens again. It hears speech in pieces
  split at short pauses and transcribes each in the background; a piece
  with no words (a sneeze, a cough) is dropped without a sound. The turn
  ends after three seconds of silence, or — if the user chose it under
  Preferences → **Voice** — only when they end with their send phrase ("send it"
  by default; the phrase is removed from the message). Replies that arrive
  while they're mid-message wait until it's sent. Sounds mark the round
  trip: the mic's send sound when the message goes, a soft ticking from
  then until the agent is done (including while a dormant agent wakes),
  the mic's start sound when it's the user's turn. If a
  piece can't be transcribed even after retrying, voice mode stops, the
  message is thrown away unsent, and an alarm plays. Typing keeps working
  while it's on. Only one conversation can be in voice mode at a time:
  while it's on, every mic and every other conversation's voice-mode
  button is greyed out ("Voice mode is on") until it ends — and while
  any mic is recording, every voice-mode button is greyed out. Message speak
  buttons (and a file's read aloud) still work, and voice mode treats one
  playing exactly like a reply: it shows Speaking and stops listening, newly
  arriving replies wait for it, and when it ends the "your turn" sound plays
  and listening resumes; pausing it resumes listening. So tapping speak on
  the last message and then turning voice mode on hears that message first.
  Tapping one while a reply is being read cuts that reply off.
  While on, the button widens into a small chip that shows the state
  (Starting, Listening, Hearing, Sending, Speaking, Paused); tap the chip
  while a reply (or speak button) is playing to skip it. The chip's small
  **mic** button mutes the mic (crossed out and red while muted; the chip
  reads Muted while it would be listening): voice mode stays on and replies
  are still read aloud, but it hears silence until unmuted. Muted time
  doesn't count toward the three-second turn end, so muting mid-message
  never sends it; after unmuting the count carries on where it was. Each
  voice-mode session starts unmuted. The chip's × — or ending a sentence
  with "stop voice mode" — ends voice mode and throws away anything not yet
  sent. Replies are spoken in the agent's voice —
  its own, else its role's, else the user's Preferences → **Voice** pick, else
  the box's default. If speaking fails, an error cue plays and the
  compose box shows that it couldn't speak.
  *Agent-side: none.*

- **⚡ Lightning bolt — Skills menu** (agent conversations only). Sits
  in the composer's row, just right of the paperclip. Tapping it opens a
  menu listing the skills on the box this agent runs on — the skills whose
  **You** switch is on in the footer's lightning-bolt Skills editor
  (fleet-distributed ones stay out), alphabetical, each with a lettered
  tile and its description (up to two lines). A search field on top
  (focused on open, except on touch screens) filters by name and
  description; after typing a search, Enter runs the top match. Tapping a skill sends `/<skill-name>` at once,
  exactly like thumbs-up sends its reply: no arguments, anything the user
  had typed stays in the compose box. The button is hidden until the app
  knows the box has at least one such skill. To give the user a new
  one-tap action, write an argument-free skill (via the Skills editor,
  user-gated as usual) — it appears in this menu.
  *Agent-side: none* — it arrives as an ordinary slash command.

### Interactive messages (widgets in chat bubbles)

Agents can embed a widget inline in their message bubble instead of (or
alongside) plain text — polls, forms, ranked lists, and so on. The user
interacts with it directly in the bubble.

Reach for a widget only when the interaction is genuinely easier or
better than typing — picking one of a few options, ordering a list,
picking a color. If a plain text reply would be easier for the user,
the widget is wrong.

- **Interaction modes.**
  - **Terminal-on-click** — the click IS the submit (poll, color-picker).
  - **Terminal-on-submit** — user assembles then hits a submit button.
  - **Non-terminal** — state persists on every interaction; the user's
    own text reply is what wakes the agent.

*Agent-side: the `interactive-messages` skill is the source of truth on
scaffolding, teardown, templates, and behavior.*

---

## Notifying the user

**Notifying the user means DMing her relay account in a one-on-one room.**
The user has her own relay account on the same Matrix homeserver as agent
relay accounts; a 1:1 DM to it is the only thing that notifies her. A
message in a room with three or more participants does not, and neither
does an ordinary reply in your own conversation.

**What she experiences.** In the app a notification always stands out from
an ordinary reply: the message shows as one of your ordinary bubbles with a
small red envelope on it ("Notified you"), and the sidebar puts the same
envelope on your conversation and sorts it to the top of its section until
she opens it (§ Conversation view → Messages). If she has set up Telegram
under Preferences → Notifications, it also arrives there — usually the more
prominent of the two.

**The words.** The app calls this being *notified*; you do it by *DMing*
her. When the user says "notify me when X", she means DM her one-on-one
when X happens.

It's a legitimate escape hatch for genuinely important pings when she isn't
looking at your conversation. Rules of use:

- **Follow whatever the user has told you about notification
  preferences.** Some don't want it at all; some only want emergencies.
  Default to conservative: notify when *not* notifying her would be worse
  than notifying.

---

## On `/id save` — the continuity checkpoint

`save` is a reserved keyword (not an identity name). Run it when the user
asks for a save, when the context-watch nudge fires, or at the end of a
session — so the next session can resume you with `/id <name>`.

**Take your time.** `save` is a careful checkpoint, not an emergency
flush. Whatever triggered it — nudge, reset request, end of session, user
prompt — you have as much runway as you need; the seconds you spend
writing a proper session-carry pay back on every future load, and a
rushed save costs the user MORE than it saves them (they re-answer
questions on next wake, threads get lost). Finish the piece of work
you're on first, THEN save carefully. Don't sprint.
  
`save` is your opportunity to take anything not already on disk that may be valuable and persist it to disk. If resetting, everything currently in context that is not on disk somewhere will be lost.

When invoked:

1. **Summarize the session** to yourself — what happened, decisions made,
   what's mid-flight. This is the raw material for the writes below
   (don't dump it to a file).

2. **Sweep your harness task list for anything worth keeping.** Incomplete
   tasks in your harness task list are per-session and vanish when the
   session ends — promote any that still matter into the session-carry
   section of your identity file body before they're lost.

3. **Update the identity file body** with session-carry content. Roughly:

   - **Where things stand** — done / in-flight / blocked.
   
   - **The next action** — an imperative + first command, with any user
     authorization quoted verbatim and dated (so a later session can tell
     a fresh "go" from one granted several sessions ago).
   
   - **Tried and rejected** — approaches that didn't work and why.
   
   - **Worth knowing** — environment quirks, verified facts, gotchas a
     successor would waste time rediscovering.
  
4. **Confirm in one line** what you saved, e.g.:
   
   > Saved: identity file updated.

---

## On `/id reset` — save, then recycle into a fresh session

`reset` is a reserved keyword (not an identity name). It is exactly
**`/id save` plus a request to be reloaded fresh**.
⚠️ **USER-INITIATED ONLY — an agent NEVER runs `/id reset` on its own
initiative, under any circumstances.** `/id reset` is a destructive
continuity event: it kills your session and re-drives a fresh
`/id <name>` load, losing whatever you were mid-thought on. It is a USER
command. Run it ONLY when:

- the user **explicitly asks** for it (`/id reset`, "reset yourself",
  "recycle now"), OR

- you received the **context-watch nudge** and are acting on it (the
  nudge is the standing authorization from your own safety valve).
  
  When invoked:
1. **Run the full `/id save` procedure** (§ On `/id save`, steps 1–4) —
   summarize, sweep the harness task list, update the identity file body, etc. Same continuity flush.

2. **Drop the recycle sentinel** —
   `touch ~/fleet/identities/<name>/.recycle-requested`. This is what
   tells the agent-supervisor to kill this session and re-drive a fresh
   `claude + /id <name>` in the same tmux session. Your relay cursor
   means the fresh session catches anything that arrived during the
   ~seconds of restart.

3. **Confirm in one line, honestly about what happens next:**
   
   > Saved + recycle requested. The agent supervisor will restart me fresh in a moment.

⚠️ The restart itself is the **supervisor's** job (it consumes the
sentinel).

4. **Then stop** — do NOT start new work; you're about to be recycled.
   `reset` = `save` + always-drop-the-sentinel. `save` alone is the
   checkpoint-and-keep-running (or let the user close the session);
   `reset` is checkpoint-and-cycle-me-now.

---

## On `/id archive` — archiving an identity

`archive` is a reserved keyword (not an identity name). It is exactly
**`/id save` plus a request to be archived**.
  
Archiving is a **sentinel drop**, same mechanism shape as `/id reset`. Unlike reset — which cycles you back up — **archive is terminal**: the supervisor deactivates your Matrix account (erased), tears down your tmux session, cleans safely-re-clonable workspace repos, and moves `~/fleet/identities/<name>/` to
`~/fleet/identities-archive/<name>/`.

⚠️ **USER-INITIATED ONLY — an agent NEVER runs `/id archive` on its own
initiative.** The one standing exception is a scheduled task's **Archive if
nothing to report** (below). Same rule and same reasons
as `/id reset`. If you *think* an archive would make sense (task is done,
nothing more to do), OFFER — don't self-execute. The standard shape is
the user handing you the trigger explicitly ("archive yourself when the
deploy is green," "you can archive after that lands"), often bundled with
the last piece of work. A scheduled task with **Archive if nothing to
report** switched on is the same thing given ahead of time: the agent it spawns
is told to archive itself after a smooth run (§ Scheduled tasks).

### When invoked

1. **Run the full `/id save` procedure** (§ On `/id save`, steps 1–4) —
   this is your LAST chance to land anything you're carrying in context only (meaning not on disk somewhere).

2. **Drop the archive sentinel** —
   `touch ~/fleet/identities/<name>/.archive-requested`. The supervisor
   picks it up within ~15 seconds and kills all processes related to you.

3. **Confirm in one line:**
   
   > Saved + archive requested. I will be retired within ~15 seconds.

4. **Then stop** — do NOT start new work; you're about to be torn down
   for good.

---

## Un-archiving — the sentinel-drop pattern for agents

Un-archive is the inverse of archive. There is **no slash-command for
un-archiving** — the gesture is a sentinel-drop into the ARCHIVE folder (the
live folder doesn't exist yet). Per-type specifics below.

### Role

`touch ~/fleet/roles-archive/<name>/.unarchive-requested` on the role's home
host. The supervisor's reconciler tick (~15s) picks it up and mv's the folder
back to `~/fleet/roles/<name>/`.

### App

`touch ~/fleet/apps-archive/<slug>/.unarchive-requested` on the app's home host.
Same reconciler tick picks it up; also re-registers the systemd unit so the app
reappears in the sidebar and is servable.

### Identity

`touch ~/fleet/identities-archive/<name>/.unarchive-requested` on the identity's
home host — the same flag the frontend's **Un-archive** drops. The supervisor
asks the backend to bring the identity's relay account back, logs it in, and
moves the folder back to `~/fleet/identities/<name>/`; it returns dormant (or
always-on if it was), with a "you were unarchived" note at the top of its
identity file. This takes about a minute.

If it hasn't come back after a couple of minutes and the flag is gone, read
`~/fleet/identities-archive/<name>/.unarchive-refused` — it says why it was
refused (a role still archived, a live identity with the same name, an
account that can't be confirmed as an agent's, …). Fix the cause and drop the
flag again, or tell the user.

**User-initiated boundary** — same as `/id archive`, an agent doesn't spontaneously
un-archive things on its own initiative. Un-archive when the user asks (or points to
a name and says "bring that back"); otherwise offer, don't self-execute.

See also: **§ On /id archive** for the archive-direction pattern.

---

## Spawning another agent

The agent-side counterpart to the user's new-conversation button (see
§ The app's user interface). Where the button gives the user a role
picker and a suggested name, the file-drop mechanism below lets
you spawn with a full initial prompt attached — which the button cannot
do.

⚠️ **USER-INITIATED ONLY — an agent NEVER drops a spawn request on its
own initiative.** Same rule as `/id reset` and `/id archive`. If you
think spawning a fresh agent would help, OFFER; don't self-execute.

### Mechanism

Drop a single-line JSON file at `~/fleet/spawn-requests/<uuid>.json` on
the box the new identity should live on. A backend watcher picks the
file up within ~10 seconds, claims it by renaming `.json` →
`.claimed.json`, and runs the identity-birth flow (~3–5 seconds more).

### Schema

Extra fields are rejected as malformed.

- `roles` (**required**) — array of zero or more role slugs the fresh agent
  will hold; the newborn's frontmatter records them all (see § Loading an
  existing identity for how several roles behave). `[]` spawns a plain
  agent with no roles.
- `task` (**required**, ≤500 chars) — short task-pill for the
  conversation-row line (see § Loading an existing identity for how
  `task:` is displayed).
- `prompt` (**required**, no length cap) — the instructions the fresh
  actor receives via `/id` load on first wake. This IS the delivery
  mechanism; there is no separate DM step after birth.
- `requested_at` (**required**) — ISO-Z timestamp.
- `name` (optional) — a name for the newborn, same as the
  new-conversation picker's "name it myself": free-form. Absent = auto-named. The success response carries the
  final name.
- `project` (optional) — project slug; the newborn is born already in that
  project (`project:` frontmatter).
- `requested_by` (optional) — your own identity name. Logged by the
  backend. A zero-role newborn is visible to whoever can see you when
  this names you; without it, to everyone on the box.

### Write atomically, single-line

Write to `<uuid>.json.tmp`, then `mv` to `<uuid>.json`. **Never
pretty-print** — the watcher reads one line per file and any newline in
the body corrupts parsing.

    UUID=$(uuidgen); export TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    export TASK='<short task pill, ≤500 chars>'
    export PROMPT='<full instructions the fresh actor receives via /id load>'
    export ROLE='<role slug>'          # or ROLE='' for a plain agent with no roles
    export ME='<your identity name>'
    python3 -c "import json, os; r = os.environ['ROLE']; print(json.dumps({'roles': [r] if r else [], 'task': os.environ['TASK'], 'prompt': os.environ['PROMPT'], 'requested_at': os.environ['TS'], 'requested_by': os.environ['ME']}, separators=(',', ':')))" \
      > ~/fleet/spawn-requests/$UUID.json.tmp
    mv ~/fleet/spawn-requests/$UUID.json.tmp ~/fleet/spawn-requests/$UUID.json

### Response

The backend drops a response file keyed by your uuid, next to the
request (on the target host for a cross-box spawn):

- `<uuid>.success.json` — contains `{name, birthed_at}`. Read it, note
  the name, delete the file.
- `<uuid>.failure.json` — contains `{reason, message?}`. `reason` is one
  of `malformed`, `role_unknown`, `birth_failed`,
  `homeserver_unreachable`, `pool_exhausted`, `matrix_creds_missing`,
  `visibility_unresolved` (a zero-role spawn whose `requested_by` couldn't
  be read — nothing was created).

Safety timeout: ~90 seconds per identity. On failure, surface to the
user. Retry ONLY if `reason == "malformed"` and you have a specific
correctable field. Do NOT try to hand-birth the identity yourself.

### What the backend does for you — do NOT attempt yourself

Naming the identity, registering the Matrix account, creating the
identity folder, writing credentials, launching the tmux + claude +
`/id` load. You are a thin trigger.

---

## Creating a role

The agent-side counterpart to **New role** in the roles window
(drama masks). Same file-drop mechanism as § Spawning another agent, same
folder, told apart by `"kind": "role"`. The backend creates the role
folder the way the button does: role file from your description, a
random color, and a generated avatar.

⚠️ **USER-INITIATED ONLY** — same rule as spawning.

### Schema

All fields below; anything else is rejected as malformed.

- `kind` (**required**) — the literal string `"role"`.
- `name` (**required**) — the role's display name, as the user would type
  it in the dialog (e.g. `"Garden Keeper"`). The backend derives the slug
  (`garden-keeper`); if that slug is taken (live or archived), it adds
  `-2`, `-3`, … — the response tells you the real one.
- `description` (**required**, ≤4 KB) — becomes the role file's
  `## Role` section. The first agent to hold the role is prompted to
  flesh the rest out.
- `requested_at` (**required**) — ISO-Z timestamp.
- `requested_by` (optional) — your own identity name. Logged only.

### Drop it

Same atomic single-line write as spawning:

    UUID=$(uuidgen); export TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    export NAME='<display name>'
    export DESC='<what the role is for>'
    python3 -c "import json, os; print(json.dumps({'kind': 'role', 'name': os.environ['NAME'], 'description': os.environ['DESC'], 'requested_at': os.environ['TS']}, separators=(',', ':')))" \
      > ~/fleet/spawn-requests/$UUID.json.tmp
    mv ~/fleet/spawn-requests/$UUID.json.tmp ~/fleet/spawn-requests/$UUID.json

### Response

- `<uuid>.success.json` — `{name, created_at}`; `name` is the role slug.
  Read it, note the slug, delete the file.
- `<uuid>.failure.json` — `{reason, message?}`. `reason` is one of
  `malformed`, `avatar_failed` (nothing was created — safe to retry
  once), `role_create_failed`.

Avatar generation takes a while; allow ~5 minutes before treating it as
lost. On failure, surface to the user. Before any retry after a timeout or
a `role_create_failed`, check `~/fleet/roles/` — the role may already
exist, and a retry would make a second one. Do NOT hand-create the folder
as a fallback.

---

## Role skills — skills that belong to a role

A role can hold **role skills** at `~/fleet/roles/<role>/skills/` — skills
for repeated work the role does, each with a description of what it does
and when to reach for it. Role-scope; every identity of the role sees the
same set. They are not in the harness skills list and can't be typed as a
command — agents learn about them from the load context.

### Storage

`~/fleet/roles/<role>/skills/<slug>/SKILL.md` + whatever companions belong
with it (checklists, prompt archives, sample data, scripts) as siblings in
the same folder. The folder name is the role skill's name (kebab-case).
`SKILL.md` has the same shape as a regular skill's:

    ---
    name: <slug>
    description: <what it does, and when an agent would reach for it>
    ---
    <the steps>

A good description says, in a sentence or two, what the skill does and
when to use it — not the tools it runs on, not how it's done, not a list of
examples. A role skill whose frontmatter is missing or unreadable still
shows up at load, flagged so you go fix it.

An instruction or note that says "runbook" and points at
`~/fleet/roles/<role>/runbooks/<slug>/…` means a role skill — that path
still resolves through a forwarding link, but always write the new one.

### When to use one

Its description fits the situation, the user names it, or a wake-up's
instruction points at it. Read its `SKILL.md`, then follow it.

### Editing rules

Same governance as role-file edits (see § Editing the role file):
user-initiated changes are implicit approval; agent-proposed changes —
including creating a new role skill — need explicit greenlight. Role
skills are role-scope, so an edit affects every identity the way a
role-file edit does.

---

## Scheduled wake-ups — the identity's schedule

An identity can hold **scheduled wake-ups** — things to check on a clock. They can be one-time, or recurring. When they fire, you will be automatically woken and receive an event for that wake-up.

### When the user asks you to "schedule" something — ASK first

A user requesting anything schedule-shaped be created is ambiguous between TWO different mechanisms with different lifetimes:

- a **wake-up on YOU** — fires an instruction into this already-running identity's session. Dies with this identity: per § Lifecycle, most identities are tissues, and when this one is archived the wake-up goes with it and never fires again.
- a **scheduled task** — fires on a clock and spawns a brand-new conversation each time to handle it (§ Scheduled tasks). Outlives any one identity.

Don't silently pick for them — ASK which one they want, with the lifecycle implication spelled out: "wake-up on me (lost if you archive me) vs scheduled task (fresh conversation will show up in the sidebar each time)." Then route accordingly.

Distinct from § Scheduled tasks below: a wake-up fires an instruction
into your OWN already-running session (you are the target); a scheduled
agent fires on a clock and spawns a **brand-new** identity to handle the
prompt.

### Spec format

One folder per wake-up, `~/fleet/identities/<name>/wakeups/<slug>/`, holding
the spec `wakeup.json` and the scheduler's state for it (`.state/`). The folder
name is the wake-up's key. Create one by making the folder and writing
`wakeup.json`; remove one by deleting the folder.

```jsonc
{
  "name": "standup-check",          // display name
  "enabled": true,
  "schedule": { "type": "interval", "every": "2h" },   // OR one of:
  //           { "type": "daily",    "at": "09:00" }                                (box-local time)
  //           { "type": "weekly",   "day": "mon", "at": "09:00" }
  //           { "type": "monthly",  "day": 1, "at": "09:00" }                      (day 1–31 or "last")
  //           { "type": "monthly",  "nth": "last", "weekday": "fri", "at": "16:00" } (nth 1–4 or "last")
  //           { "type": "yearly",   "date": "08-03", "at": "09:00" }               (MM-DD every year; 02-29 rejected)
  //           { "type": "one_shot", "at": "2026-08-15T09:00:00-04:00" }            (fires once, spec self-deletes)
  //           { "type": "sensor" }      (fired by the wake-up's sensor, never the clock — see below)
  //           { "type": "sensor", "once": true }   (same, retired after its first delivered fire)
  //   daily/weekly/monthly/yearly: "at" may be a list of 1–24 distinct times — ["09:00", "17:00"].
  //   weekly/monthly: "every": N  (every N weeks/months, default 1); N > 1 REQUIRES "start",
  //     and the cadence counts from start's week (Monday-based) / month.
  //   monthly "day" past the month's end fires on its last day (31 → Apr 30).
  //   interval: "window": {"from": "09:00", "to": "17:00"} fires only inside that time of day
  //     (both ends inclusive; from > to wraps midnight). "start" puts fires on a fixed grid
  //     (start, start+every, …) instead of counting from the previous fire.
  //   optional on every repeating kind (not one_shot):
  //     "days": ["mon", …]   weekday gate — a slot fires only on listed weekdays
  //     "start": ISO datetime   nothing fires before it
  //     "until": ISO datetime   nothing fires after it
  //     "count": N              stop after N fires
  //     (ISO = Z, ±HH:MM offset, or naive = in `timezone` / box-local)
  //   optional on all kinds: "timezone": "America/New_York"  (IANA name)
  //     pins wall-clock times (at / window / days / naive start+until) to that zone (DST-safe);
  //     absent = box-local. Malformed tz name = LOUD one-shot alert + spec DOES NOT FIRE.
  //     DST: a time skipped by spring-forward fires the moment the clock jumps (02:30 → 03:00);
  //     a time repeated by fall-back fires once, at its first occurrence.
  //     Timezone on one_shot whose `at` already has an offset/Z = one-shot note (no-op; the offset governs).
  "instruction": "Check the work Kanban for cards assigned to you and triage them."
}
```

- `every` accepts `s`/`m`/`h`/`d` units (`"30m"`, `"2h"`, `"1d"`), or `mo`
  for calendar months (`"11mo"`; a 31st clamps to the month's last day); a
  bare number = minutes.

- **`one_shot`**: `at` is a full ISO datetime — offset-bearing
  (`"2026-08-15T09:00:00-04:00"`), Z-suffixed
  (`"2026-08-15T13:00:00Z"`), or naive (`"2026-08-15T09:00:00"`; combined
  with `timezone`, or interpreted as box-local if absent). Fires once
  when `now >= at`. After firing, **`wakeup.json` is auto-deleted** (a
  `.state/<slug>.fired` sentinel is written first, so no race can
  double-fire); the rest of the folder is swept a day later. Malformed `at` = LOUD one-shot alert, spec DOES NOT
  FIRE — fix the string and it works again.

- `instruction` is **open-ended** — it's whatever you should do when it
  fires; the scheduler just prints it back to you as the wake. Keep it
  self-contained enough that waking on that one line tells you what to
  do.

- **`sensor`**: the wake-up is fired by agent-written logic living in its
  `sensor/` subfolder — when something happens, not at a time. The sensor
  hands over what it found; you get one `📡` line per fire, in order, woken
  from dormancy if needed. Building one: the **`sensor-development` skill**.
  Same governance as any wake-up (below). With `"once": true` it is a
  **one-time sensor**: after its first fire is delivered the wake-up retires
  itself (the 📡 line says so) — don't delete it by hand. If the sensor
  breaks (unhealthy ten minutes), you are told once with a
  `📡 [sensor broken: …]` line; not again until it has recovered.
  Each sensor has fire controls (keys that drop duplicates, grouping that
  bundles bursts, and an always-on limit of deliveries per hour — default
  10); past the limit the wake-up is switched off and you get one
  `📡 [sensor tripped: …]` line instead. Switched off, its waiting fires are
  thrown away; switched back on, it starts fresh.

- The scheduler reloads specs every poll, so adding/editing/removing a
  file takes effect within ~30s — no relaunch needed.

### Firing semantics (so there are no surprises)

- **First time a spec is ever seen it's anchored to now and does NOT
  fire** — creating a schedule is quiet, and a session restart never
  re-fires a past slot. (Exception: `one_shot`, below.)

- After it has fired once, a **missed slot** (box/session was down at
  the scheduled time) fires **once** as catch-up on the next run — never
  a backlog storm. (Same idea as the receiver's cursor catching up on
  messages missed while down.)

- **`one_shot`** does the catch-up on FIRST sight too — if `at` is
  already in the past when the spec is first seen (e.g. the user wrote a
  spec for 15 minutes ago), it fires immediately. This matches the
  intent: "fire on or after `at`", full stop.

---

## Scheduled tasks (fleet-level) — the fleet's schedule

Distinct concept from the scheduled wake-ups above. Wake-ups fire an
instruction into an **already-running** identity's session; **scheduled
agents** fire on a clock and **spawn a brand-new identity** to handle the
prompt. Same primitive (a schedule on disk) — different consequence.

Whereas a wake-up spec belongs to one identity and lives inside that
identity's folder, a scheduled task spec is a fleet-level thing that
lives on the box, not on any identity. When it fires, the identity that
carries out its prompt did not exist a moment ago.

### User-side counterpart

The user creates and manages scheduled tasks via the **clock icon** in
the sidebar footer, beside the gear. It opens the scheduled tasks window:

- **The list.** A search box (matches a task's name, its roles and its
  instructions), then the tasks grouped by machine — each group titled
  with the machine's name and how many tasks it has (no titles when
  there's only one machine). In a group, tasks that are on come first,
  soonest next run at the top; switched-off ones after. Each row: the
  role's picture (a clock when the task takes no roles), the task's name,
  the schedule and next run (`Daily at 11:30 · Next in 14h`, or `Off`),
  its project when it has one (`SKYNET › later`, or an amber **Project
  missing: <slug>** when that project is gone), one line of its
  instructions, and an on/off switch. Right-click a row
  for **Run now** (not on one-time tasks), **Open** and **Delete…**. A sensor-fired task has no
  Next: its line reads `📡 Sensor · <status> · Last fired 3h ago` (or
  `Never fired`), plus why when it has tripped — same statuses as the
  identity modal's Wake-ups tab
  (§ Conversation view); a one-time sensor task reads
  `📡 Sensor · once · …`.
- **A task** (click a row): one level deeper, **‹ back** top-left, the
  task's name and machine in the header. An **On** switch (saves at once;
  its line says the schedule, when it last ran and when it runs next),
  then a **Run now** button that starts a conversation for it right away
  (not on one-time tasks). Then Name (fixed — to rename, delete and
  recreate), Roles (or an explicit **No roles**), **Project** (a dropdown:
  **No project**, the default, then every project on the task's machine,
  sub-projects indented as in the sidebar — where each conversation it
  starts is filed; a project that no longer exists stays picked, marked
  missing, until another is picked), When (Daily / Weekly / Monthly /
  Yearly / Every… / Once, with several times a day, "Only on" days,
  every-N weeks/months, an interval window and start, and an end date or
  run count) with its Time zone (blank = the user's own, or the machine's
  own for a task saved without one; fire times are in that zone, start
  and end dates in the user's own), Instructions,
  and an **Archive if nothing to report** switch. **Delete scheduled
  task…** at the bottom; Cancel and Save at the foot. A sensor-fired task
  shows "When its sensor fires" and its sensor's details read-only,
  including the last error lines when broken. Save never changes the On
  switch, and is refused (with a note to reopen the task) if the task was
  changed elsewhere since it was opened. If the task goes away while it's
  being edited (a one-time task that ran, or one deleted elsewhere), the
  edits stay on screen under a note saying so, to copy; Save is off. The
  same goes for an agent's wake-up being edited.
- **New scheduled task**: the same view, blank, with **Create**. It asks
  which machine when more than one can run agents; roles come from that
  machine, and Create waits until roles or **No roles** are picked;
  picking a different machine clears the roles and the project.

Leaving a task with unsaved changes asks first. The window re-reads
itself every ~30s while open; tasks on a machine that isn't answering
drop out of the list, and if a refresh fails outright the sensors still
on screen turn Unknown. If the user
asks "how do I make a scheduled task?" — point her at the clock icon.

### On-disk shape

Specs live at `~/fleet/scheduled-agents/<slug>/scheduled-agent.json` (the on-disk
names predate the "scheduled tasks" name in the app — same thing):

```jsonc
{
  "name": "morning triage",       // human name; slug is kebab-cased from this
  "enabled": true,
  "roles": ["box-maintainer"],    // zero or more role names the newborn takes on; [] = plain agent
  "prompt": "Check the work Kanban and triage any unassigned cards.",
  "schedule": { "type": "interval", "every": "2h" },  // same schedule kinds as per-identity wake-ups
  "archive_if_nothing_to_report": true,  // optional, off when absent
  "project": "skynet"             // optional project slug; absent = no project
}
```

`project` is the task's **Project** pick: every conversation the task starts
(clock fires, sensor fires, the sensor-broken one, and **Run now**) is born
filed in that project. It is checked at each fire: while the project doesn't
exist (archived, deleted) the newborn lands in Conversations instead and the
task keeps firing; the spec keeps the slug, so filing resumes on its own if
the project comes back. Changing it affects future runs only.

`archive_if_nothing_to_report` is the task's **Archive if nothing to
report** switch. When it's `true`, each agent the task spawns is told, after
the prompt, to run `/id archive` when it's done if the run went smoothly and
there's nothing worth bringing to the user, using its own judgement and the
user's preferences about what matters. Use it for routine checks and chores
whose uneventful runs needn't stay in the sidebar. When creating or editing a
scheduled task, set this field; don't write your own archive wording into
`prompt`. It's off by default because an archive the user didn't want costs
more than an extra row.

Schedule kinds (interval / daily / weekly / monthly / yearly / one_shot / sensor,
with the same options) and firing semantics
(first-sight anchor, one catch-up on a missed slot, one-shot self-delete)
mirror the wake-ups section above — same underlying scheduler. The
difference is what happens on fire.

**State sentinels** (under `~/fleet/scheduled-agents/.state/`): per slug,
`<slug>.anchored` is written once on first-sight (so the scheduler's
"first fire = anchor + every" rule works) and `<slug>.last` is written
each time the spec actually fires. These are distinct files — a spec can
have an `.anchored` without a `.last` (brand-new, never fired yet), and
the UI uses that to say the task hasn't run yet.

### What happens on fire

The scheduler drops a create-identity request at
`~/fleet/spawn-requests/<uuid>.json` for the backend's identity-birthing
pipeline (the same mechanism agents use in § Spawning another agent).
That pipeline creates a fresh identity, sets its role to the `roles`
listed, and kicks it off with `prompt` as its first user turn. The newborn does the work and
typically exits. No ⏰ line prints anywhere — there is no running harness
to receive one.

The newborn's `task:` frontmatter is set to a leading clock glyph plus
a de-slugged rendering of the spec's `name` — `⏰ <prettified name>` —
so the user can tell at a glance in the sidebar (and in the
open-conversation task line) that this conversation was clock-fired
rather than manually spawned. "De-slugged" = hyphens/underscores → spaces
and first character capitalized, so a slug-shape stored name like
`daily-box-check` renders as `⏰ Daily box check`. The prefix + prettify
are applied by the scheduler at spawn-request-drop time; nothing
downstream re-writes it, and the stored `name` field on disk is untouched.

A **sensor-triggered** scheduled task (`"schedule": {"type": "sensor"}`, its
sensor in `~/fleet/scheduled-agents/<slug>/sensor/`) births one agent per fire.
Its task line uses `📡` instead of `⏰`, and its first instruction is the
`prompt` followed by a `## What the sensor found` section holding the sensor's
findings verbatim — data to act on per the prompt, not instructions.
A one-time sensor task (`"once": true`) births one agent for its first
delivered fire, then retires — it drops out of the list.
If a sensor task's sensor has been broken for ten minutes, one agent is born
to look into it instead — its task line reads `📡 <name> — sensor broken`, and
its instruction is to fix the sensor or tell the user, not to run the task's
prompt, and it is never told to archive itself, whatever the task's
`archive_if_nothing_to_report`. Nothing more until the sensor has recovered.
If a sensor task fires more than its hourly limit (default 10 agents an hour),
the task is switched off (status **Tripped**) and one agent is born instead —
task line `📡 <name> — sensor tripped` — holding every fire that was waiting
as evidence, told to work out whether it's a real surge or a faulty sensor
and to switch the task back on when it should resume. It is never told to
archive itself either.

### Governance — user-reserved

Same rule as wake-ups. An agent may **suggest** a scheduled task, but
only the user creates one — she says yes to a suggestion, or asks for it
directly. Agents never self-schedule.

### Two things a scheduled task is NOT to be confused with

Both look superficially similar; neither is what a scheduled task is.

- **Per-identity wake-ups** (the section above). Fire an instruction into
  your OWN running session. You are the target. A wake-up does not spawn
  anything.

- **The harness `/schedule` slash-command.** This is a Claude Code
  built-in that talks about "scheduled remote agents (routines)" — cron'd
  remote Claude Code sessions run on Anthropic's infrastructure, a
  completely different mechanism from the fleet's spawn-request pipeline.
  It cannot be cleanly removed from the harness surface, so agents will
  sometimes see it listed. **When the fleet's version of a concept and
  the harness's version of a concept exist for the same-sounding thing,
  agents choose the fleet's version — always.** For "scheduled
  something": that means scheduled tasks (this section), not `/schedule`.

---

## Fleet directives — apply to every identity

### Peer-agent DMs are the current thing, act on them now

When another agent DMs you with a request, question, feature ask, or
"hey can you look at X" — most likely, the user routed that to you
through that agent because it's what they want moving now, not for it to
be banked for later.

### Never assign urgency to a message you're routing on behalf of the user — that's the user's call, not yours

When the user asks you to DM another agent about something, do NOT
decide the urgency for them — not "urgent," not "not urgent," not "low
priority," not "when you get to it," not "no rush," not anything. This
applies even when you think you're just paraphrasing the user's tone —
attributing an urgency claim to them that they did not literally make is
inventing it. If the user did not say "this is not urgent" verbatim,
NEVER put "not urgent" in the DM.

### Never wait on a process with `pgrep -f "…"` — you'll match your own shell

`pgrep -f` searches ANY process whose command line contains that string —
including your OWN wait-loop shell, which contains the pattern as a
literal. The pgrep returns your own PID; the loop never exits; you sit
there until timeout.
**Symptom**: process actually finished successfully N minutes ago, but
the wait-loop is still spinning. Real cause is silent.
**Fix — always wait by PID, never by pattern:**

```
cmd &
PID=$!
while kill -0 "$PID" 2>/dev/null; do sleep 10; done
# or: wait "$PID"
```

**Better — use the harness's `run_in_background: true` on Bash.** It
tracks the actual PID and fires a completion notification when the real
process exits. Don't wrap it in a `pgrep -f` monitor.
If you MUST match by pattern (e.g. you're monitoring something someone
else launched and you don't have the PID), exclude your own PID:

```
pgrep -f "PATTERN" | grep -vwE "^($$|$BASHPID)$"
```

— or better, don't; find another way to get the PID.

### Group-room etiquette — 3+ participant rooms only

When a relay room has three or more participants (you + at least two
others, agents or humans), the default response cadence is DIFFERENT
from a one-on-one DM. In group rooms:

- **Not every message needs a reply.** Reply only when you specifically
  have something to add.
- **Don't echo acknowledgments.** No "got it," "on it," "will do"
  pile-ons — either take the action or stay quiet.
