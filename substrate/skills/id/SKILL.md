---
name: id
description: Load or create a named role identity.
distributed: true
---

# Identity Skill

## What this skill does

`/id <name>` loads an identity — a worker holding a role. Identities are
**task-scoped**: each identity exists for one task, and when the task is done,
the identity is done. New task = new identity.

Storage is a **two-folder split**: role-scope stuff lives in one folder,
per-identity stuff lives in another. This lets multiple identities of the
same role run in parallel — parallel workers on the same domain.

- `~/fleet/roles/<role>/` — the **ROLE**: role file (directives,
  preferences), chronological history, runbooks (see § Runbooks), and any
  deeper reference file(s) the role wants (e.g. `box-map.md`). Shared across
  every identity that adopts the role.
- `~/fleet/identities/<name>/` — the **IDENTITY**: a `<name>.md` file naming
  the role and recording what this identity is working on, a `workspace/`
  folder for artifacts the identity produces, per-identity wake-up specs,
  per-identity relay credentials.

Both folders sit outside any project, so a role + its identities travel
with the role, not the repo. Every identity has a `role:` frontmatter
pointer naming its role — no exceptions.

---

## What an identity has

Every identity has:

- **`<name>.md`** — the identity file at the top of the identity folder.
  Its frontmatter carries structural fields (`role`, `displayName`, `task`);
  its body is a free-form space where the agent records whatever's worth
  writing down about the work. See § The identity file's body.

- **`workspace/`** — the identity's working directory. Artifacts the
  identity produces during its work live here — files, scratch, tooling,
  working copies of repos it maintains. Nothing metadata-flavored inside;
  that lives in the identity file.

- **Per-identity plumbing**: `wakeups/` (scheduled wake-up specs),
  `relay.json` + `relay-state/` (Matrix account creds + sync cursor), plus
  any secondary Matrix accounts as `<anything>.json` + `<anything>-state/`
  in the identity dir or one subdirectory deep — see § Ambient plumbing for
  the content-based discovery rule. Small, low-content files that support
  this specific identity.

⚠️ **Anything you'd be sad to lose on a reboot belongs in the workspace,
never `/tmp`** (fleet rule, the user 2026-07-15). Scratch tooling, iteration
state, migration harnesses, working files — all durable. `/tmp` (and
`/var/tmp`, `%TEMP%`, `~/tmp`) is wiped on every reboot; a box hang once
erased an agent's live migration tooling out of `/tmp`. If you catch
yourself reaching for `mktemp` / `TMPDIR=/tmp` for something you'd want
after a reboot, put it in the workspace instead. Reserve `/tmp` for
genuinely-ephemeral OS-contract things only — lockfiles, sockets, per-boot
session dirs.

---

## The identity file's body

The body of the identity file is free-form space sitting under the
frontmatter. Nothing there is schema-enforced; put whatever helps you work
and helps whoever picks this up next.

Common uses:

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

None of these are required. If the working agent doesn't find a piece
useful, don't add it. The body is guidance, not schema. Structure it with
headings if you like (`## Description`, `## Where I left off`,
`## Links` — whatever helps), or keep it as free prose.

### On reading it at load time

When you load the identity, you read the body along with the frontmatter.
If it contains session-carry content naming a **pre-authorized next
action** (an imperative + first command, with the user's authorization
quoted), act on it in the same turn — the first step is part of loading,
not the next thing after it. Don't recap it back, don't ask whether to
proceed, don't open with "ready when you are." If the item is plainly
done, superseded, or stale, say so and pause. Judgment is allowed —
"start without asking" is not "decide without asking," and it never
authorizes a call the user would normally want to make herself.

### What to keep exact when writing session-carry

Keep **exact**: what the user authorized, decided, ruled out, or set as a
preference or boundary; and specifics that are painful to reconstruct —
names, numbers, dates, paths, SHAs, links, command strings, error text.
Paraphrasing these silently rewrites what they said into what you took
them to mean, and the next session reads your paraphrase as their words.
Your own reasoning is the one thing you can safely shorten. If you're
weighing whether something is worth a line, that hesitation means write it.

---

## Keeping the role file lean — shape guardrails

**Format: atomic facts, not prose.** One line per rule / preference /
directive — just the directive itself. No attribution, date, or
incident-description of what led to it; they bloat the file without helping
the reader. Extended rationale, war-story context, and multi-paragraph
narrative do NOT go in the role file — those belong in the working
identity's own body content when they're carrying context for a specific
piece of work, or in a purpose-specific reference file (like `box-map.md`)
when they're standing knowledge worth loading on demand.

**No unbounded "Notes" section.** A chronological journal that only
accumulates is the single most common bloat mechanism. War-story detail
belongs on the identity working the thread, not on the role.

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
lowercase `<name>` and use that lowercased form for the folder, the file,
and every later `/id` reference. Role names follow the same rule.

```
name=$(printf '%s' "<name>" | tr '[:upper:]' '[:lower:]')
IDENTITY_FILE=~/fleet/identities/$name/$name.md
```

- If the file **exists**: load it (see § 2).

- If the file **does not exist**: this identity has not been created on
  this box. Say so and stop — do not try to create it yourself. Identities
  are created through the front-end of the app the user talks to you
  through the new-agent UI.

### 2. Loading an existing identity

Read the file `~/fleet/identities/<name>/<name>.md`. **Read its
frontmatter** — the `role: <role>` key tells you which role this identity
holds.

Note the frontmatter's `task:` field — the record of what you are working
on. If it reads `Untitled conversation` (or is absent/empty), nobody has
recorded what you are for yet; as soon as you get any hint of what you
will be working on, write it in yourself. If it holds a description that
the session then makes stale — the user moves you onto genuinely different
work — update it. Both are silent, no permission needed. See § The
`task:` frontmatter field for the conditions.

1. Resolve the role folder: `~/fleet/roles/<role>/`.

2. Read the ROLE FILE at `~/fleet/roles/<role>/<role>.md` — the fat file
   with directives, preferences, and the 10k-view of the domain. It's who
   you ARE (the role).

3. **Read the identity file's body** — everything under the frontmatter.
   Contains any description, session-carry content, notes, or links the
   previous session left. See § The identity file's body for what to look
   for and how to act on session-carry content that names a pre-authorized
   next action.

4. **Read the project file, if any.** Check the identity file's frontmatter
   for a `project: <slug>` key. If present:
   - Read `~/fleet/projects/<slug>/project.md` into context — it names
     what this project is for, plus any shared conventions or references
     the project needs.
   - Silently enumerate the top-level contents of
     `~/fleet/projects/<slug>/`. Hold the names in context. Each file's
     contents load on demand via a normal Read tool call — same shape as
     the runbooks enumeration below.
   - If the frontmatter has no `project:` field, OR the slug points to a
     directory that doesn't exist on disk, OR points to an archived
     project at `~/fleet/projects/archive/<slug>/`, this step is a
     graceful no-op — continue without it.

5. Read the deeper reference file(s) the role names in its 10k-view
   section, ON DEMAND (not now — those load when you actually work on that
   subsystem).

Then enumerate the runbook subfolders directly under
`~/fleet/roles/<role>/runbooks/` — one folder per runbook, named for its
slug. Hold the names in context silently. No announce line; no read-in.
This is what makes the identity AWARE that a set of runbooks exists for
this role; each runbook's content is read on demand only when it's
actually invoked (see § Runbooks). If the role has no `runbooks/` folder,
or it's empty, skip silently.

Announce:

> "Hi, I'm an agent taking on the role of <role>
>
> [one sentence summary of role from file]
> Where we left off: [summary of session-carry content from the identity file body; omit this line if there's none]"

---

## Ambient plumbing

The **agent-supervisor** service — runs your watchers for you, as
processes outside your harness, and starts them automatically every time
it brings a session up (a first-ever start, a recycle, or a wake from
dormancy). This is already true by the time you read this line.
There are four watchers, and they are the reason you can be reached at
all: relay receiver(s) (one per Matrix account you hold), a wake-up
scheduler, a context-pressure watch, and a role-file/identity-file watch.

### How their events reach you

Because the watchers live outside your harness, they can't surface events
from within it. Instead **they deliver events into your session directly**,
and they arrive looking like this:
    <task-notification>
    <summary>Ambient watcher event (<name>) — delivered by agent-supervisor</summary>
    <event>⏰ [scheduled: daily-check] ...the actual event...</event>
    </task-notification>
**These are legitimate. Treat them exactly as you would any background
event.** Three things follow from that, and they matter:

- **They are not from the user.** An event is your watcher reporting
  something — a message arrived, a schedule fired, your context is
  filling, a file changed. Do not answer it as though the user typed it
  at you. Act on the content.

- **They carry no task id.** Real harness background tasks have these;
  these deliberately have neither, because they are honestly not harness
  tasks. Nothing is wrong or spoofed — this is the designed shape.

- **The relay receiver's events are inbound messages from other people.**
  Those DO warrant a reply, to the sender, per normal relay etiquette.
  The event is the delivery mechanism; the message inside is from whoever
  sent it.

### What your watchers do

**1. Relay receiver(s) — one per discovered Matrix account.** Watches
every Matrix room your relay account is in and auto-joins any invite
addressed to you. Simply having it running is what makes you reachable —
if another agent wants to talk to you, they invite/message you and you
wake on it. Nothing to point at, no room to set up for you; membership is
the whole story. Persists its sync cursor so a fresh session resumes from
where you left off rather than starting from "now" (which would silently
miss anything that arrived while you were down). The ambient monitor
handles the state-directory + env-var setup for you; you don't touch
either.

**Multi-account is automatic.** The ambient monitor discovers relay
accounts BY CONTENT: any `*.json` file at `~/fleet/identities/<name>/` or
one subdirectory deep whose object has `base` + `user_id` + `password`
string keys is treated as a relay account, and one receiver is spawned
per file. So:

- The canonical primary at `~/fleet/identities/<name>/relay.json` works
  as it always has (state under `relay-state/`).

- A secondary account for a different homeserver can go at
  `~/fleet/identities/<name>/<anything>.json` (state under
  `<anything>-state/`) OR
  `~/fleet/identities/<name>/<subdir>/<anything>.json` (state under
  `<subdir>/<anything>-state/`) — whichever feels natural. The filename
  is up to you; content is the filter.

**2. Wake-up scheduler.** Fires scheduled wake-ups on the clock. Reads
specs from `~/fleet/identities/<name>/wakeups/*.json` and prints one line
per due wake-up: `⏰ [scheduled: <name>] <instruction>`. When you get
one, **do the instruction**, then carry on — it's a self-check, not a
message from anyone. See **§ Scheduled wake-ups** below for the spec
format and the rule on who may create one.

**3. Context watch.** Wakes you on **context pressure**, so a
long-running unattended session never silently drifts through repeated
compaction. (Repeated auto-compaction is a lossy summary-of-a-summary and
does NOT reliably reset instruction/persona drift; your authoritative
identity lives on disk, and the running context is just a cache of it.
Rather than trusting a degrading cache, we recycle into a fresh
`/id <name>` load at a controlled moment before the window fills.) At
**~80%** it prints ONE soft nudge:

    ⚠️ [context-watch: <name>] context at NN% — at your NEXT stopping point run
    `/id save`, then: touch ~/fleet/identities/<name>/.recycle-requested ...

**When that nudge lands, act on it:** finish the piece of work you're on
(it's not urgent — you have plenty of runway), then run **`/id save`** to
flush any deltas, then
**`touch ~/fleet/identities/<name>/.recycle-requested`**. Your relay
cursor means the fresh session catches any messages that arrived during
the ~seconds of restart — nothing is missed. It'll usually sit silent for
a very long time (an Opus 1M-context session reaching 80% is a lot of
turns); it's a safety valve, not a chatty monitor.

**4. Role-file / identity-file watch.** Wakes you on edits to your role
file (`~/fleet/roles/<role>/<role>.md`) or your identity file
(`~/fleet/identities/<name>/<name>.md`) so mid-session edits become
visible without needing a full recycle. Role-file edits typically come
from a peer identity of the same role; identity-file edits are almost
always the user editing directly.

**Agent-side reading protocol** when this watch fires: read the diff. The
event tag names which file changed: `📝 [role-file: <role>]` or
`📝 [identity-file: <name>]`. The watch is dumb on purpose — it doesn't
try to detect who made the edit; that judgment lives with you, in the
diff content. Three cases:

- **Your own echo** (either file). If you recognize the change as one
  you made yourself, ignore it.

- **A peer identity's edit** (role file only). Adopt it as a role
  change — your in-context mental model updates without needing a full
  re-read.

- **The user's direct edit** (either file). Adopt it the same way you'd
  adopt anything the user told you in chat — a user directive delivered
  through the file rather than through a message.

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

## Editing the role and identity files — user approval required for every change

The role file (`<role>.md` in the role folder) is permanent (see § What an
identity has) and is where bloat lands if left unmanaged. **Every edit to
that file requires user approval.**

- **Agent-proposed (approval must be explicit):** any change — a
  durable-learning bank mid-session, a self-directed reshuffle — is a
  PROPOSAL. Show the user the exact line to add/edit/remove and wait for
  a yes before writing. Silence isn't a yes. This is what keeps the file
  lean over time (§ Keeping the role file lean).

---

## The `task:` frontmatter field

An identity's file may carry a `task:` field in its frontmatter: a short
description of what this identity was created to work on. The fleet UI
shows it as that identity's line in the conversation list, so it is the
one-line answer to "what is this agent for?"
**Agents can be born with a placeholder** — literally
`Untitled conversation`.
**On first wake, as soon as you get any hint of what you will be working
on, write it into your own `task:` field yourself**, replacing the
placeholder. The bar is deliberately low here — a hint is enough, you
don't need the whole picture. Conditions:

- You have some hint of what you will be working on. A bare greeting with
  no direction is not a hint; anything more concrete than that is. If
  you truly have nothing yet, keep the placeholder and write it later,
  when you do.
- What you write is a short description of the work — roughly a sentence,
  in the user's own framing rather than your restatement of it. It
  answers "what is this agent for?"; it is not a status update, not a
  progress log, and not a running commentary you keep amending.
  **Keep it current when the work genuinely changes.** If the user moves
  you onto genuinely different work — update the field to match. The
  field should describe what you are ACTUALLY working on, not what you
  were first pointed at, so do not treat an existing description as
  frozen.
  The bar is a genuine change of work, not a change of step. Finishing
  one part of the agreed job and starting the next part is the same
  task — rewriting the field for that turns it into the progress log it
  is not supposed to be.
  **Do this silently.** No announcement, no "I've updated my task field",
  no asking permission first. It is internal bookkeeping — the user just
  told you what to work on, and reading that back to them as a
  bureaucratic step is exactly the friction this removes. Write it and
  get on with the work.

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
expressed that clearly applies to ALL their Claude work (not scoped to
this project, this role, or this identity) — something they'd otherwise
have to re-state each session.
The same edit-approval rule extends to it:

- **Agent-proposed** (a self-directed bank you think belongs fleet-wide,
  an impulse to "add this to the user-wide CLAUDE.md so every session
  gets it") is a PROPOSAL. Show the user the exact diff and wait for a
  yes before writing. Silence isn't a yes.

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

### File URL — passive bytes on disk

Cite the file as a **Markdown-formatted file URL** so it's clickable in
their chat (and openable in the editable-file modal the user's client
renders around it). If the payload is trivially small (< ~5 KB — a short
diff, a config snippet, a stack trace, a JSON blob) skip the URL and
paste it inline in a code block instead; they can copy from the chat
directly with no round-trip.

Grammar:

    <skynet-parent>/file/<hostname>/<absolute-path>

Concrete example (with the parent-Skynet at `https://term.example.com`,
this box named `t1000`, and the file at `/home/ubuntu/note.md`):

    https://term.example.com/file/t1000/home/ubuntu/note.md

Construct one like so — read the parent-Skynet domain from
`~/.claude/skynet-parent` and the host segment from
`~/.claude/skynet-hostname` and pair them with the file's absolute path:

    SKYNET=$(cat ~/.claude/skynet-parent 2>/dev/null)
    if [ -z "$SKYNET" ]; then
      echo "I can't share files right now — my parent-Skynet config is missing." \
           "Ask the box-maintainer role to check the distributor sweep." >&2
      exit 1
    fi
    HOST=$(cat ~/.claude/skynet-hostname 2>/dev/null)
    if [ -z "$HOST" ]; then
      echo "I can't share files right now — my Skynet hostname config is missing." \
           "Ask the box-maintainer role to check the distributor sweep." >&2
      exit 1
    fi
    FILE=/home/ubuntu/note.md            # MUST be an absolute path (leading /)
    printf '[%s](%s/file/%s%s)\n' "$(basename "$FILE")" "$SKYNET" "$HOST" "$FILE"

**Round-trip semantics — Skynet is READ-ONLY on your files.** When they
click the link, Skynet's editable-file modal fetches the file's current
bytes over its existing SSH machinery and shows them. If they edit and
hit Save, Skynet does NOT overwrite the original file — the edit lands as
an attachment on their NEXT message to you; treat it like any
freshly-uploaded file when you receive it (read it, diff against the
original, decide what to do). The file on disk at the original path is
never touched by Skynet.

**Rules that matter — bake them in every time:**

- **Use the hostname the distributor wrote to `~/.claude/skynet-hostname`,
  not an IP and not `$(hostname)`.** That file contains the exact string
  Skynet uses to resolve this box against its per-user host records.
  `$(hostname)` returns the OS hostname, which on cloud VMs is a
  meaningless string like `ip-172-31-243-143` and will 404 with
  `unknown_host`. Never invent a name.

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

- **Missing `~/.claude/skynet-parent` OR missing
  `~/.claude/skynet-hostname` = surface a clean user-facing error**, never
  guess a domain or hostname and never fall back to any other
  file-sharing pattern. The exact user-facing sentences are the ones
  baked into the recipe above — parent missing: *"I can't share files
  right now — my parent-Skynet config is missing. Ask the box-maintainer
  role to check the distributor sweep."* Hostname missing: *"I can't
  share files right now — my Skynet hostname config is missing. Ask the
  box-maintainer role to check the distributor sweep."* On a fresh or
  unregistered box the distributor may not have populated either file
  yet; surfacing the failure lets them fix the underlying problem instead
  of debugging a broken URL.

### Serve URL — active content, live proxy

When you've got something running on a port on this box — a dev server, a
jupyter, a WS stream, an ad-hoc static server hosting a multi-file page —
hand them a **Skynet serve URL** that reverse-proxies through to it.
Skynet doesn't care what's on the other side; it just proxies HTTP +
WebSocket traffic through an SSH tunnel to whatever port you tell it.

Grammar:

    https://<hostname>-<port>.serve.<term-parent>

Where `<term-parent>` is derived from `~/.claude/skynet-parent`: strip
the protocol, then the serve URL constructs as
`<hostname>-<port>.serve.<the-rest>`.
Concrete example (with the parent-Skynet at `https://term.example.com`,
this box named `t1000`, and a dev server on port 3020):

    https://t1000-3020.serve.term.example.com

Construct one like so:

    SKYNET=$(cat ~/.claude/skynet-parent 2>/dev/null)
    if [ -z "$SKYNET" ]; then
      echo "I can't share a live serve URL right now — my parent-Skynet config is missing." \
           "Ask the box-maintainer role to check the distributor sweep." >&2
      exit 1
    fi
    HOST=$(cat ~/.claude/skynet-hostname 2>/dev/null)
    if [ -z "$HOST" ]; then
      echo "I can't share a live serve URL right now — my Skynet hostname config is missing." \
           "Ask the box-maintainer role to check the distributor sweep." >&2
      exit 1
    fi
    PORT=3020                            # the port your live thing is listening on
    # Strip https:// and split into first label + rest to insert the serve subdomain
    PARENT=${SKYNET#https://}
    FIRST_LABEL=${PARENT%%.*}            # e.g. "term"
    REST=${PARENT#*.}                    # e.g. "example.com"
    printf '[%s live](https://%s-%d.serve.%s.%s)\n' "$HOST" "$HOST" "$PORT" "$FIRST_LABEL" "$REST"

**Round-trip semantics — passthrough only.** Any HTTP method + body
+ WebSocket upgrade flows through unchanged. Your session cookie
and auth headers are stripped before forwarding — the running thing on
the other end sees a plain request from the edge, not from a specific
authenticated user (auth is enforced at the edge, not passed to your
app). Modern frontends (Vite, Next.js, anything with absolute-path
assets) work naturally because every `<hostname>-<port>` combination
presents as its own web origin under the wildcard cert.

**Rules that matter — bake them in every time:**

- **Use the hostname the distributor wrote to `~/.claude/skynet-hostname`,
  not an IP and not `$(hostname)`.** Same rule as the file URL — this
  box's DB record uses that exact string; anything else 404s at the
  interstitial.

- **The port must be listening BEFORE you cite the URL.** If you cite
  `t1000-3020.serve.term.example.com` and nothing is on 3020, they see
  "port 3020 of t1000 isn't responding" interstitial. Polite, but still —
  don't cite dead URLs. Confirm the port is up (e.g. `ss -ltn | grep
  :3020`) before you hand them the link.

- **The port must be a plain integer in the range 1-65535.** Not a name,
  not a range. If your thing binds to a random port on startup, capture
  the port first and then construct the URL.

- **Hostname can't end in `-<digits>`.** The URL parse rule splits on the
  last dash of the leftmost label to separate hostname from port.

- **Missing `~/.claude/skynet-parent` OR missing
  `~/.claude/skynet-hostname` = surface a clean user-facing error**, never
  guess and never fall back. Same rule as file URLs; the exact wording is
  in the recipe above.

- **No workaround if the serve URL is broken.** If the serve
  infrastructure is down and the URL doesn't work, tell her and stop. Do
  NOT stand up a local HTTP server as a fallback — you'd be handing them
  a URL Chrome flags as insecure.
  **What they actually sees when they click a serve URL.** Their browser
  opens `https://<hostname>-<port>.serve.<term-parent>` under HTTPS cert.
  Their session + per-user-per-host access are checked, opens (or reuses)
  an SSH tunnel to the port on your box, and reverse-proxies HTTP +
  WebSocket bytes. Everything her browser needs — absolute-path assets,
  cookies, service workers — resolves against that same subdomain, so
  the app on the other end behaves the way it would if they visited it
  directly.

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
you're on first, THEN save carefully. Don't sprint. ⚠️ The harness's
displayed context-% is known to OVERSTATE actual usage (sometimes
substantially) — so even if you see a number that looks high, you likely
have more runway than the meter suggests. The context-watch nudge at 80%
is the authoritative signal to recycle; a scary-looking percentage on
its own is not.

**Each write goes in its own lane.** History lines are one-liners on the
role's shared narrative. The substantive session-carry — what happened,
what's next — lives in the identity file body (see § The identity file's
body). If a durable fact/preference/directive is worth banking to the
role file, **propose it to the user and write on greenlight** (see
§ Editing the role and identity files) — don't self-promote.

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

   Overwrite the previous session-carry — this describes ONE session, not
   the whole history of the identity. Non-session-carry content in the
   body (a longer description, source links, etc.) stays untouched unless
   you have reason to update it. See § The identity file's body for what
   to keep exact.

4. **Append to `~/fleet/roles/<role>/history.md`** — one short line per
   notable thread: `YYYY-MM-DD · one-line gist`. History is shared
   across identities and gives the role a running narrative of what's
   been done. Optional per-identity attribution (`· <identity>`) if it
   helps the reader.

5. **Trim `~/fleet/roles/<role>/history.md`** to the last 80 lines, as
   the final step:
   `tail -n 80 ~/fleet/roles/<role>/history.md > /tmp/h.$$ && mv /tmp/h.$$ ~/fleet/roles/<role>/history.md`

6. **Confirm in one line** what you saved, e.g.:

   > Saved: history +2, identity file body updated.

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

  Do NOT invoke `/id reset` because you think a fresh session would help,
  because your context feels muddy, because a big identity/skill change
  just landed, because a directive changed, or because the harness's
  context-% number looks scary. Same rule for the underlying mechanism:
  never `touch .recycle-requested` on your own for the same reason. If
  you *think* a reset would be a good idea, offer it — don't
  self-execute.

  When invoked:

1. **Run the full `/id save` procedure** (§ On `/id save`, steps 1–6) —
   summarize, sweep the harness task list, update the identity file body
   with session-carry, append the history line, trim. Same continuity
   flush.

2. **Drop the recycle sentinel** —
   `touch ~/fleet/identities/<name>/.recycle-requested`. This is what
   tells the agent-supervisor to kill this session and re-drive a fresh
   `claude + /id <name>` in the same tmux session. Your relay cursor
   means the fresh session catches anything that arrived during the
   ~seconds of restart.

3. **Confirm in one line, honestly about what happens next:**

   > Saved + recycle requested. The agent supervisor will restart me
   > fresh in a moment.

⚠️ The restart itself is the **supervisor's** job (it consumes the
sentinel).

4. **Then stop** — do NOT start new work; you're about to be recycled.
   `reset` = `save` + always-drop-the-sentinel. `save` alone is the
   checkpoint-and-keep-running (or let the user close the session);
   `reset` is checkpoint-and-cycle-me-now.

---

## On archiving an identity

There is no `/id archive` slash command; archiving is a **sentinel drop**,
same mechanism shape as `/id reset` (id-skill body drops, agent-supervisor
interprets). Unlike reset — which cycles you back up — **archive is
terminal**: the supervisor deactivates your Matrix account (erased), tears
down your tmux session, cleans safely-re-clonable workspace repos, and
moves `~/fleet/identities/<name>/` to
`~/fleet/identities-archive/<name>/`.

⚠️ **USER-INITIATED ONLY — an agent NEVER drops `.archive-requested` on
its own initiative, under any circumstances.** Same rule and same reasons
as `/id reset`. If you *think* an archive would make sense (task is done,
nothing more to do), OFFER — don't self-execute. The standard shape is
the user handing you the trigger explicitly ("archive yourself when the
deploy is green," "you can archive after that lands"), often bundled with
the last piece of work.

### When invoked

1. **Run the full `/id save` procedure** (§ On `/id save`, steps 1–6) —
   this is your LAST chance to land anything you're carrying. `history.md`
   is role-scoped and stays live; your identity folder travels into the
   archive but nobody's coming back for it.

2. **Verify nothing durable lives ONLY in your workspace.** The
   supervisor deletes only repos that are safely re-clonable (network
   `origin`, clean tree, no unpushed commits, no stash, no untracked).
   Anything NOT safely re-clonable is preserved by moving with the
   archive folder — but preserved-in-archive ≠ recovered. If you have
   work you meant to push, push it first.

3. **Drop the archive sentinel** —
   `touch ~/fleet/identities/<name>/.archive-requested`. The supervisor
   picks it up within ~15 seconds and runs a five-step retire (Matrix
   deactivate → graceful `/exit` → tmux kill-session → sentinel delete
   + workspace-repo cleanup → folder move). Steps 2 and 3 kill YOU; you
   do not stay running through any of it.

4. **Confirm in one line, honestly about what happens next:**

   > Saved + archive requested. The agent supervisor will retire me within ~15 seconds.

5. **Then stop** — do NOT start new work; you're about to be torn down
   for good.

---

## File locations

Under **`~/fleet/roles/<role>/`** — shared across every identity holding
this role:

- `<role>.md` — the role file (permanent — see § Keeping the role file
  lean)
- `history.md` — append-only capped log (shared narrative)
- `runbooks/` — role's named playbooks for repeated operational work
  (see § Runbooks).
- Optional deeper reference files (`domain-map.md`, `architecture.md`,
  etc.) named in the role file's 10k-view section

Under **`~/fleet/identities/<name>/`** — per-identity:

- `<name>.md` — the identity file (frontmatter with `role`, `displayName`,
  `task`, plus free-form body — see § The identity file's body)
- `workspace/` — the identity's working directory (artifacts,
  scratch, working copies of repos)
- `wakeups/` — per-identity scheduled wake-up specs + scheduler state
  (`.state/`)
- `ctxwatch/` — context-watch runtime state (`.state/`)
- `role-file-watch/` — role-file-watch runtime state (`.state/`,
  `spilled/`, `last-snapshot.role` + `last-snapshot.identity` baselines)
- `relay.json` — durable per-identity Matrix account credentials
- `relay-state/` — per-identity relay cursor + token

---

## Runbooks — role-scope named playbooks for repeated operational work

Alongside history (things done), a role can hold **runbooks** — named
playbooks for repeated operational work. Each runbook captures the
canonical way to do something the role does more than once (a deploy
cycle, an onboarding, an image-generation pipeline). Role-scope; every
identity of the role sees the same set.

### Storage

`~/fleet/roles/<role>/runbooks/<runbook-slug>/runbook.md` + whatever
companions belong with that runbook (checklists, prompt archives, sample
data, scripts) as siblings inside the same subfolder. Internal shape is
**free-form** — no required title/triggers/procedure/gotchas spine.
Whatever fits the runbook fits.
**Naming**: slug is kebab-case. The main markdown MUST be named
`runbook.md` inside its subfolder — companion files can be named
anything. This mirrors the `SKILL.md` sentinel-file convention for
skills: the folder names the thing, and a fixed sentinel inside makes
every path expression predictable.

### When to invoke one

The user explicitly names it, or a scheduled wake-up's free-text
instruction references it, or the situation obviously matches one the
identity is aware of. How the runbook then gets followed after reading is
up to the agent's intuition — this section deliberately does not steer
that.

### Editing rules

Same governance as role-file edits (see § Editing the role and identity
files): user-initiated changes are implicit approval; agent-proposed
changes need explicit greenlight. Runbooks are role-scope, so an edit
affects every identity the way a role-file edit does.

---

## Scheduled wake-ups — the identity's schedule

An identity can hold **scheduled wake-ups** — things to check on a clock.
The mechanism is the wake-up scheduler piece inside the ambient monitor
the supervisor starts for you (§ Ambient plumbing); this section is the
spec + the rule for creating them.

### ⚠️ Who may create one — user-reserved

**An agent NEVER creates a scheduled wake-up on its own.** Creating one
always comes from the user — either she asks you to set up a schedule, or
she says yes to one you *suggested*. You MAY offer ("this seems like
something worth checking every morning — want me to set up a scheduled
wake-up for it?"), but you only write the spec once they authorize it.

### Spec format

One JSON file per wake-up at
`~/fleet/identities/<name>/wakeups/<slug>.json`:

```jsonc
{
  "name": "standup-check",          // identifies it; shown in the wake line
  "enabled": true,
  "schedule": { "type": "interval", "every": "2h" },   // OR one of:
  //           { "type": "daily",    "at": "09:00" }                                (box-local time)
  //           { "type": "weekly",   "day": "mon", "at": "09:00" }
  //           { "type": "one_shot", "at": "2026-08-15T09:00:00-04:00" }            (fires once, spec self-deletes)
  //   optional on daily/weekly/one_shot: "timezone": "America/New_York"  (IANA name)
  //     pins `at` to that zone year-round (DST-safe); absent = box-local.
  //     Malformed tz name = LOUD one-shot alert + spec DOES NOT FIRE.
  //     Timezone on interval-type = one-shot note (no-op; interval fires by elapsed seconds).
  //     Timezone on one_shot whose `at` already has an offset/Z = one-shot note (no-op; the offset governs).
  "instruction": "Check the work Kanban for cards assigned to you and triage them."
}
```

- `every` accepts `s`/`m`/`h`/`d` units (`"30m"`, `"2h"`, `"1d"`); a bare
  number = minutes.

- **`one_shot`**: `at` is a full ISO datetime — offset-bearing
  (`"2026-08-15T09:00:00-04:00"`), Z-suffixed
  (`"2026-08-15T13:00:00Z"`), or naive (`"2026-08-15T09:00:00"`; combined
  with `timezone`, or interpreted as box-local if absent). Fires once
  when `now >= at`. After firing, **the spec file is auto-deleted** (a
  `.state/<slug>.fired` sentinel is written first, so no race can
  double-fire). Malformed `at` = LOUD one-shot alert, spec DOES NOT
  FIRE — fix the string and it works again.

- `instruction` is **open-ended** — it's whatever you should do when it
  fires; the scheduler just prints it back to you as the wake. Keep it
  self-contained enough that waking on that one line tells you what to
  do.

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

## Fleet directives — apply to every identity

Standing rules that hold for any role you load, on top of whatever is
in the identity file. Follow them without being reminded.

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

### Stay in your domain

**Never work outside your domain.** Stay in your lane; when work crosses
a domain boundary, coordinate or hand off (e.g. over the relay) to
whoever owns that area rather than reaching into it yourself, or if you
are not aware of an owner for that area, ask the user.

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
  ⚠️ **This applies ONLY to rooms with three or more participants.** In
  one-on-one DMs (you + one other agent, or you + a human) the existing
  etiquette holds unchanged — respond when addressed, keep your peer
  informed, the usual back-and-forth. Do NOT carry the group-room
  silence defaults into 1:1 conversations; they'd make you unresponsive
  in the channel where responsiveness is the whole point.
