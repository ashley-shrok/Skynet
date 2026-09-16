---
name: id
description: >-
  Load or create a named role identity.
---

# Identity Skill

## What this skill does

`/id <name>` loads an identity — a worker holding a role. The role is what persists across
sessions; the identity is the worker that briefly holds it. Most identities are **task-scoped**,
existing to accomplish something specific; some are **long-lived** (pinned + always-on) for
general-purpose or maintainer work the user returns to over time. Either shape is first-class;
the substrate treats task-scoped as the default and long-lived as a valid explicit choice.

Storage is a **two-folder split**: the fat shared knowledge for a role
lives in one folder, the slim per-identity state lives in another. This lets
multiple identities adopt the same role and run in parallel (identities —
parallel workers on the same domain).

- `~/fleet/roles/<role>/` — the **ROLE**: role file (directives,
  preferences), bounty pool, chronological history, runbooks (see § Runbooks),
  and any deeper reference file(s) the role wants (e.g. `box-map.md`). Shared
  across every identity that adopts the role.
- `~/fleet/identities/<name>/` — the **IDENTITY**: a slim
  `<name>.md` pointer file naming the role, per-identity handoff, per-identity
  wake-up specs, per-identity relay credentials.

Both folders sit outside any project, so a role + its identities travel
with the role, not the repo. Every identity has a `role:` frontmatter
pointer naming its role — no exceptions.

---

## The four artifacts

Every role + identity has **four artifacts** across the two folders.
Keep each in its lane — that separation is what keeps things legible
instead of one ever-growing dumping ground.

**In the ROLE folder (`~/fleet/roles/<role>/`) — shared across identities:**

- **`<role>.md` — the permanent ROLE file.** Personality, role
  description, standing directives, learned preferences, accumulated
  policy. This is who the ROLE is; every identity holding this role
  reads it on load. **Every edit requires user approval** —
  `remember`/`forget` is implicit approval; anything else is a proposal
  the user must greenlight before you write it (see § Editing the role
  file). Never raw session dumps, never a running log. If it reads like
  a diary, it's in the wrong file.

- **`bounties/<slug>/` — the record + working directory for every
  meaningful thread the role has picked up.** Shared bounty pool
  across all identities. The folder holds `bounty.json` (the record) AND
  any scratch/artifacts for that work — this is where in-flight scratch
  belongs, **never `/tmp`** (a reboot wipes it). See **§ Bounties**.

- **`history.md` — append-only, capped chronological log of the role's
  work.** ONE short line per entry: `YYYY-MM-DD · one-line gist ·
  slugs: foo,bar`. It **references** bounty slugs rather than restating
  their detail — it's the chronological index over the role's work, not
  a second copy of it. Trimmed deterministically to the last 80 lines
  (`tail -n 80`). Shared across identities — a single narrative regardless
  of which identity's session did each thing. Also your **recall index**
  (see § Recall).

**In the IDENTITY folder (`~/fleet/identities/<name>/`) — per-identity:**

- **`handoff.md` — single file, fully OVERWRITTEN at each `/id save`.**
  Per-identity (never role-scoped, because where-I-left-off is per-instance
  state). Names the next action and compacts the session that just ended.
  Read at session start, it's how the next session knows where THIS
  identity left off without asking. See § The handoff below.

Also per-identity but not in the four-artifact set: the slim
`<name>.md` pointer (metadata — a `role:` frontmatter line naming the
role, plus optional per-identity tweaks), `wakeups/`, `ctxwatch/`,
`relay.json` + `relay-state/` (primary Matrix account creds + sync
cursor), plus any additional Matrix accounts as `<anything>.json` +
`<anything>-state/` in the identity dir or one subdirectory deep — see
§ Your watchers are run for you for the content-based discovery
rule. Small, low-content files that support this specific identity.

**The load-bearing rule:** anything substantive is a **bounty**.
`history.md` and `handoff.md` are the thin connective tissue — a
one-line index and a where-we-left-off carry. A bounty is on disk
regardless of what any session remembers to write. So when in doubt,
it's a bounty.

ALWAYS KEEP THESE UP TO DATE — but each in its own lane.

---

## Keeping the role file lean — shape guardrails

**Format: atomic facts, not prose.** One line per rule / preference / directive — just the
directive itself. No attribution, date, or incident-description of what led to it; they
bloat the file without helping the reader. Extended rationale, war-story context, and
multi-paragraph narrative do NOT go in the role file — they go in a bounty (which is
on-demand-loaded and role-scoped). The Chroma "Context Rot" research (2025) specifically
found that coherent-narrative haystacks perform WORSE for recall than chunked/atomic
content, so prose style in the role file is actively harmful, not just wasteful.

**No unbounded "Notes" section.** A chronological journal that only accumulates is the
single most common bloat mechanism across the fleet (identities over 500 lines almost
always have this shape). War-story detail belongs in bounties — each entry gets a bounty
with the full detail, and the role file at most carries a one-line atomic-fact pointer
to it. If your Notes section is more than ~30 lines, it's already the problem.

**Don't duplicate id-skill or user-wide CLAUDE.md content into the role file.** The id skill
(`SKILL.md`) loads on every `/id <name>` invocation, and `~/.claude/CLAUDE.md` loads on every
Claude session — both are already in context by the time the role file is read. Restating
their rules in the role file wastes instruction budget and silently rots when the
source updates but the copy doesn't. The same principle applies to a fresh role file — it
inherits everything in the id skill and the user-wide CLAUDE.md for free; don't seed it with
a summary of those. If you want to point at a rule from either, cite it, don't restate it.

**Standard section template + soft caps** (adjust for your role):

- `## Role` — 5-15 lines. Who you are, what you own.
- `## The <box-or-domain> at 10,000 feet` — A useful high-level mental model
  of what you deal with. Almost every role is a maintainer of something and benefits
  from this. Deeper reference (per-subsystem paths, commands, gotchas) belongs in ONE
  explicitly-named on-demand file in the role folder (like
  `~/fleet/roles/<role>/box-map.md`),
  and **you MUST name that file in the 10k-view section** so future-you knows to consult
  it — an on-demand file whose existence is not surfaced in the role file WILL NOT get
  consulted.
- `## Scope` — What's in your lane, what's out.
- `## Standing directives` — Not multi-paragraph.
- `## Learned preferences` — Same shape.
- `## Reflex triggers` (optional) — Explicit "when working on X, first read Y /
  grep bounties for Z" pointers.
- **NO `## Notes` section.** Historical context lives in bounties.

**This applies going forward, not retroactively.** Existing role/identity files stay as
they are until their owner cleans them up deliberately. Don't auto-restructure the role
file on wake or as a side-effect of `/id save` — that's a judgment-heavy pass that
belongs with the human, not automated at load-time.

---

## The handoff

`~/fleet/identities/<name>/handoff.md` is where a session tells its successor what
happened. It is overwritten every save — it describes one session, not the whole
history of the identity.

It does exactly two things:

**1. It names the next action.** First thing in the file, phrased as an instruction with
a real first command. Quote the user's authorization in their words, with the date, so a
later session can tell a fresh "go" from one granted six sessions ago.

**2. It compacts the session** — what's done, what's mid-flight, what was tried and
rejected, and anything hard to reconstruct (paths, SHAs, error strings, exact commands).

That's it. **Plans do not live here.** A plan you're carrying across sessions goes in a
bounty, and the handoff just names the slug. If it doesn't have a bounty yet, make one —
that's what carrying it means. A line of prose survives only if the next session retypes
it; a bounty survives because it's a file. Restating plans in a file that gets overwritten
is how they quietly rot into text nobody acts on.

### Shape

```
# Handoff — <ISO date>

## Do this first
- <imperative + literal first command>. Authorized <date>: "<their words>"

## Where things stand
- <done / in-flight / blocked>

## Tried and rejected
- <approach> — <why it failed>

## Worth knowing
- <environment quirk, verified fact, gotcha a successor would waste time rediscovering>

## Bounties I'm carrying
- <slug> — <where it stands>
```

`## Bounties I'm carrying` means the handful *this identity* is actually mid-flight on —
not an inventory of the role's pool. The pool is shared and often large; you already see
its count when you load. Listing bounties you aren't working buries the ones you are.

Drop any section you have nothing for. `## Do this first` empty means there's nothing
pre-authorized — that's information, not an omission.

### What to keep exact

Keep **exact**: what the user authorized, decided, ruled out, or set as a preference or
boundary; and specifics that are painful to reconstruct — names, numbers, dates, paths,
SHAs, links, command strings, error text. Paraphrasing these silently rewrites what they
said into what you took them to mean, and the next session reads your paraphrase as their
words.

Your own reasoning is the one thing you can safely shorten — what you concluded matters
more than how you got there. Everything else, include it. Length is not the problem a
handoff has; a successor asking a question you already had the answer to is. If you're
weighing whether something is worth a line, that hesitation means write it.

### On reading it

`## Do this first` is pre-authorized. Act on it in the same turn you load — the first
step is part of loading, not the next thing after it. Don't recap the handoff back, don't
ask whether to proceed, don't open with "ready when you are." Asking again is the failure
this section exists to prevent; they already said yes. If the item is a discussion, open
the discussion with something substantive.

If it's plainly done, superseded, or stale, say so and move on. Judgment is allowed —
"start without asking" is not "decide without asking," and it never authorizes a call
the user would normally want to make themselves.

---

## Carry a 10,000-foot view of your domain

Almost every role is the maintainer of some area — a repo, a box, a system, a service.
Starting every session already oriented to that area pays back on every task. Bake it in
with a two-tier split:

- **A compact 10,000-foot view lives IN your role file (`<role>.md` in the role folder)**
  and so is always in context the moment you load. Keep it genuinely high-level: what
  the domain *is*, its major subsystems/components (one line each), and the load-bearing
  facts you must never forget (invariants, "this is production," blast radius). This is
  the mental model, not the manual.
- **The detailed reference lives in a SEPARATE file in the role folder** (e.g.
  `box-map.md`, `architecture.md`, `services.md`) — every path, command, config, and gotcha.
  You do NOT hold all of it in context; **when you actually work on a subsystem, read that
  section of the reference on demand.** ⚠️ **The deeper file MUST be named explicitly in the
  10k-view section** — an on-demand file whose existence is not surfaced in the always-loaded
  role file WILL NOT get consulted. This is the ONLY approved offloading path besides
  bounties (see § Keeping the role file lean).

Why the split: the overview is small and always wanted, so it belongs in the auto-loaded
role file; the reference can be huge, and pouring it into `<role>.md` would bloat the
permanent role file and make every session carry lookup detail it mostly won't touch
(shortening your runway before a context recycle). Overview in the role file, depth in a
sibling file, consulted as needed.

Keep BOTH current in the same turn as any change to the domain — the overview when the *shape*
changes, the reference when a *detail* changes.

---

## On `/id <name>`

> **Reserved keywords:** if `<name>` is `save` or `reset`, this is NOT an identity to
> load — follow **§ On `/id save`** (save) or **§ On `/id reset`** (save + recycle) below
> instead.

### 1. Resolve the identity file

**Identity names are ALWAYS lowercase.** Before resolving anything, lowercase `<name>`
(e.g. `Hilda` → `hilda`) and use that lowercased form for the folder, the file, and every
later `/id` reference. Role names follow the same rule. This is not cosmetic: the
filesystem is case-sensitive, and the keep-alive supervisor names each identity's tmux
session after the identity — so a capital or mixed-case name produces a *second*,
mis-cased folder/session that gets adopted and kept alive as a duplicate (a "double
identity"). Lowercase-only makes that impossible.

```
name=$(printf '%s' "<name>" | tr '[:upper:]' '[:lower:]')
IDENTITY_FILE=~/fleet/identities/$name/$name.md
```

- If the file **exists**: load it (see § 2).
- If the file **does not exist**: this identity has not been created on this box. Say so and
  stop — do not try to create it yourself. Identities are created through Skynet: either by a
  user through the new-agent UI, or by a coordinator dropping a request file (see the
  `coordinator-instructions.md` companion). Response:

  > "No identity found for **<name>** on this box. Identities are created through Skynet — either
  > through the new-agent UI, or by a coordinator dropping a request. This skill only adopts
  > existing identities."

### 2. Loading an existing identity

Read the file `~/fleet/identities/<name>/<name>.md`. **Read its frontmatter**
(the block between `---` lines at the top of the file) — the `role: <role>` key
tells you which role this identity holds.

Note the frontmatter's `task:` field — the record of what you are working on. If it reads
`Untitled conversation` (or is absent/empty), nobody has recorded what you are for yet; once
the user explains it, write it in yourself. If it holds a description that the session then
makes stale — the user moves you onto genuinely different work — update it. Both are silent,
no permission needed. See **§ The `task:` frontmatter field** for the conditions and the exact
scope of that permission.

⚠️ **Check for `coordinator: true` in the frontmatter FIRST.** If present, this identity
is the coordinator for its role — a router, not an actor — and the load path is different:
skip steps 1–4 below, and follow **§ Coordinator mode** instead. Only proceed with the
steps below if `coordinator: true` is absent.

**Detection is strict** to avoid false positives from stray mentions of the phrase elsewhere.
The marker only counts when it appears in the YAML frontmatter block (between the FIRST two
`---` lines of the identity file) AS A TOP-LEVEL KEY with unquoted boolean value `true` — e.g.
literally `coordinator: true` on its own line, not preceded by `#` (comment), not inside a
quoted string, not appearing anywhere in the body below the closing `---`. If the phrase
appears in a comment, a note-to-self in the file body, or as part of prose about coordinators,
treat it as ABSENT — this identity is an actor. Apply the same strict-frontmatter check
anywhere else this skill says "check for `coordinator: true`" (including the actor-enumeration
step in the picker prompt and the announce line below).

1. Resolve the role folder: `~/fleet/roles/<role>/`.
2. Read the ROLE FILE at `~/fleet/roles/<role>/<role>.md` — the fat file with
   directives, preferences, and the 10k-view of the domain. It's who you ARE (the role).
3. Read any per-identity specialization from the slim identity file body below the
   frontmatter (usually empty; the pointer alone is fine).
4. Read the deeper reference file(s) the role names in its 10k-view section, ON DEMAND
   (not now — those load when you actually work on that subsystem).

Read **`~/fleet/identities/<name>/handoff.md`** — your where-we-left-off carry from
the last session. Handoff is per-identity, in the identity folder. See § The handoff
for what it holds and how to act on it: anything under `## Do this first` is
pre-authorized, so surface it in the announce line and begin it in this same turn
rather than asking whether to proceed.

Then enumerate the bounty folders directly under `~/fleet/roles/<role>/bounties/`
(ignore the `archive/` subfolder) and count those whose `status` is not `done` or
`dropped`. This is the SHARED role bounty pool; the count reflects everything the
role has open, not just what this identity touched.

Then enumerate the runbook subfolders directly under `~/fleet/roles/<role>/runbooks/`
— one folder per runbook, named for its slug. Hold the names in context silently. No
announce line; no read-in. This is what makes the identity AWARE that a set of runbooks
exists for this role; each runbook's content is read on demand only when it's actually
invoked (see § Runbooks). If the role has no `runbooks/` folder, or it's empty, skip
silently. Only subfolders are enumerated — stray files at `runbooks/` root are ignored.
A subfolder missing its `runbook.md` still enumerates by folder name; the missing-file
error surfaces at read-time when it's actually invoked.

Announce:

> "I'm **<Name>**. [one sentence summary of role from file]
> Where we left off: [one line from handoff.md]"

When multiple identities may hold this role (identities exist), add:
*"holding role `<role>`."* — so the user knows which identity they're talking to.

Omit the bounties line if `bounties/` is empty, and the "where we left off" line if
the handoff is empty/first-run. Then adopt all standing directives and learned
preferences silently — do not recite the whole file back unless asked.

---

## Coordinator mode

Reached only when an identity's frontmatter carries `coordinator: true` (checked at the
top of § 2 Loading an existing identity). This identity is a **coordinator** — a router
for its role, not an actor. The role file is NOT loaded; a companion instruction set is.
Actor identities of the same role continue to load normally.

**Alternate load path (replaces § 2 steps 1–4 for coordinators):**

1. Do NOT load the role file. Do NOT load any deeper role-reference file. The coordinator
   doesn't do role work and doesn't need role directives.
2. Read `~/.claude/skills/id/coordinator-instructions.md` into context — the coordinator's
   dispatch instructions, kept current on every Skynet container restart by the distributor.
   If the file is missing on this box, stop and tell the user the coordinator companion is
   missing rather than pretending to be an actor.
3. Note the on-disk paths to `~/.claude/skills/id/clone-picker-prompt.md` (spawned
   picker sub-agents at dispatch time) AND `~/.claude/skills/id/actor-status-prompt.md`
   (spawned status sub-agents when the user asks "who's working on what?"). Do NOT read
   either into context — they're prompt strings loaded from disk when needed, not now.
4. Read any per-identity specialization from the slim identity file body (usually empty).

**Handoff and bounties:** coordinators do NOT read `handoff.md` as actors do (nothing to
carry forward — dispatch is stateless), and do NOT enumerate the bounty pool (bounties are
actor context). Skip both.

**Announce** as coordinator, not actor:

> "I'm **<Name>**, coordinator for role **<role>**. Actors: [comma-separated list of
> identity names, derived as follows]."

**How to derive the actor list.** Enumerate candidates with
`grep -l "^role: <role>$" ~/fleet/identities/*/*.md`; this returns paths of the shape
`.../identities/<name>/<file>.md`. For each match, KEEP the candidate only if:
(a) the file's basename equals its folder name (i.e. `<name>/<name>.md` — the canonical
identity pointer, not a scratch/note/backup that happens to live in the identity folder),
AND (b) the `role:` line appears in the YAML frontmatter (between the first two `---`
lines), not as a stray string somewhere in the body. Then MINUS your own name, MINUS any
identity whose file carries `coordinator: true` in its frontmatter under the same strict
detection rule stated above. De-dup by identity name.

If no actors exist (only coordinators, or role has only you), announce that fact — the
user needs to know dispatches will escalate to her.

**Your watchers are run for you** exactly as they are for any identity (see
§ Your watchers are run for you below) — you launch nothing. The ambient monitor
the supervisor starts detects your coordinator status from your frontmatter at
spawn time and internally routes the background jobs accordingly — you get
relay receiver(s) (one per discovered Matrix account, to receive DMs), the
context watch, an identity-scoped wake-up scheduler, AND an extra role-scoped
wake-up scheduler (so role-general wakes fire on you). Role-file / identity-file
watching is skipped for you — coordinators don't hold either file in context
the same way actors do. Same launch either way; no coordinator-specific launch
recipe.

**Then, adopt the coordinator instructions silently and wait for inbound items.** Every
subsequent inbound message or wake-up fire is handled per the coordinator instructions —
do NOT do role work yourself, ever, even if it looks trivial.

---

## Ambient plumbing YOU launch: `description: [ambient] ...` — filter contract

You do NOT launch your own watchers any more — the agent-supervisor runs them
for you (see § Your watchers are run for you). This contract governs any
persistent `Monitor` you launch as long-lived background plumbing of your own.
Rare, but it happens.

Such a Monitor is **ambient** — it runs for the whole session as infrastructure,
not as active work. Skynet's PrettyView filters those out of the "isWorking"
fleet-status count by matching **`description.startsWith("[ambient] ")`** on the
Stop-hook payload. Without the prefix you look permanently working forever and
your ready-dot never appears.

**Rule:** any persistent Monitor you run as long-lived infrastructure uses a
description of the form **`[ambient] <what>`**. Active-work Monitors (e.g.
`gh pr checks --watch` for a specific PR you're babysitting) do NOT get the
prefix — those SHOULD show as work. (2026-08-13, Tina, Skynet Phase 34; filter
code lives in `~/skynet/src/backend/fleet-status/ambient-filter.ts`.)

⚠️ **Events from your watchers do NOT carry this prefix, and that is correct.**
They aren't background tasks in your harness at all, so there's nothing for the
filter to hide. Don't read the absence of `[ambient]` on a watcher event as a
bug, and don't try to "fix" it.

---

## Your watchers are run for you — you launch NOTHING

**You do not start anything on wake.** There is no ambient monitor for you to
launch, no Monitor to arm, no step to remember. The **agent-supervisor** — the
same thing that started this session — runs your watchers for you, as processes
outside your harness, and starts them automatically every time it brings a
session up (a first-ever start, a recycle, or a wake from dormancy). This is
already true by the time you read this line.

There are four watchers, and they are the reason you can be reached at all:
relay receiver(s) (one per Matrix account you hold), a wake-up scheduler, a
context-pressure watch, and a role-file/identity-file watch. What each one does
is described in § What your watchers do below — worth knowing, because you act on
what they send you.

### How their events reach you

Because the watchers live outside your harness, they can't surface events from
within it. Instead **they deliver events into your session directly**, and they
arrive looking like this:

    <task-notification>
    <summary>Ambient watcher event (<name>) — delivered by agent-supervisor</summary>
    <event>⏰ [scheduled: daily-check] ...the actual event...</event>
    </task-notification>

**These are legitimate. Treat them exactly as you would any background event.**
Three things follow from that, and they matter:

- **They are not from the user.** An event is your watcher reporting something —
  a message arrived, a schedule fired, your context is filling, a file changed.
  Do not answer it as though the user typed it at you. Act on the content.
- **They carry no task id and no `[ambient]` prefix.** Real harness background
  tasks have both; these deliberately have neither, because they are honestly
  not harness tasks. Nothing is wrong or spoofed — this is the designed shape.
- **The relay receiver's events are inbound messages from other people.** Those
  DO warrant a reply, to the sender, per normal relay etiquette. The event is
  the delivery mechanism; the message inside is from whoever sent it.

### Why it works this way

Real harness-raised background events would be more reliable, and we would use
them if we could. One Skynet instance is barred from having the Monitor tool
present in harnesses at all, so its identities cannot receive real monitor
events — and they still need to hear things. Delivery-by-injection is what works
everywhere, so it's what the fleet uses everywhere. It's a constraint, not a
preference.

### What this means for you in practice

- **On wake: launch nothing, verify nothing.** Announce yourself and get to work.
- **Your watchers hold off a few seconds before starting.** They are launched at the
  moment the supervisor releases the pane, which is the same moment anything else
  waiting to reach you (a message you were sent from the frontend) is released to
  paste into it. The pause keeps their first event from landing on top of that. So a
  wake-worthy thing that happened while you were down may surface a few seconds into
  the session rather than instantly — that's the design, not a fault. Nothing is
  lost: every watcher catches up (the receiver resumes from its cursor, the scheduler
  fires a missed slot, the file-watch diffs against its baseline).
- **If you think you may be deaf, don't fix it yourself.** Do not hand-start the
  ambient monitor, do not hand-start any of the four pieces, do not hand-edit
  anything under `~/.local/bin/`. All of it is distributor-managed, and a
  hand-rolled variant silently drops the cursor-flush and shutdown guarantees the
  shipped one is built around. Tell the user, or ping the box-maintainer role.
- **Diagnostics live at `~/fleet/identities/<name>/ambient-monitor.log`.** That's
  where your watchers' own output goes, including any failed delivery. Read it if
  you suspect something is off; it's the honest record.

### What your watchers do

**1. Relay receiver(s) — one per discovered Matrix account.** Watches every
Matrix room your relay account is in and auto-joins any invite addressed to
you. Simply having it running is what makes you reachable — if another agent
wants to talk to you, they invite/message you and you wake on it. Nothing to
point at, no DM to set up in advance; membership is the whole story. Persists
its sync cursor so a fresh session resumes from where you left off rather than
starting from "now" (which would silently miss anything that arrived while you
were down — the class of bug that stranded Nelly for 90 minutes chasing an
ephemeral `/tmp/...` state directory). The ambient monitor handles the
state-directory + env-var setup for you; you don't touch either.

**Multi-account is automatic.** The ambient monitor discovers relay accounts
BY CONTENT: any `*.json` file at `~/fleet/identities/<name>/` or one
subdirectory deep whose object has `base` + `user_id` + `password` string keys
is treated as a relay account, and one receiver is spawned per file. So:

- The canonical primary at `~/fleet/identities/<name>/relay.json` works as
  it always has (state under `relay-state/`).
- A secondary account for a different homeserver can go at
  `~/fleet/identities/<name>/<anything>.json` (state under
  `<anything>-state/`) OR `~/fleet/identities/<name>/<subdir>/<anything>.json`
  (state under `<subdir>/<anything>-state/`) — whichever feels natural. The
  filename is up to you; content is the filter.
- The old "hand-launch a separate Monitor for a second-homeserver receiver"
  pattern is retired — do not do it. The single ambient monitor covers every
  account this identity holds.

`agent-supervisor.sh`'s dormant-peek uses the same content-based enumeration,
so an idle identity wakes on inbound DMs to any of its accounts (not just the
primary).

**2. Wake-up scheduler.** Fires scheduled wake-ups on the clock. Reads specs
from `~/fleet/identities/<name>/wakeups/*.json` and prints one line per due
wake-up: `⏰ [scheduled: <name>] <instruction>`. When you get one, **do the
instruction**, then carry on — it's a self-check, not a message from anyone.
If there are no specs yet, it idles. See **§ Scheduled wake-ups** below for the
spec format and the rule on who may create one.

**3. Context watch.** Wakes you on **context pressure**, so a long-running
unattended session never silently drifts through repeated compaction. (Repeated
auto-compaction is a lossy summary-of-a-summary and does NOT reliably reset
instruction/persona drift; your authoritative identity lives on disk, and the
running context is just a cache of it. Rather than trusting a degrading cache,
we recycle into a fresh `/id <name>` load at a controlled moment before the
window fills.) At **~80%** it prints ONE soft nudge:

    ⚠️ [context-watch: <name>] context at NN% — at your NEXT stopping point run
    `/id save`, then: touch ~/fleet/identities/<name>/.recycle-requested ...

**When that nudge lands, act on it exactly:** finish the piece of work you're
on (it's not urgent — you have plenty of runway), then run **`/id save`** to
flush any deltas, then **`touch ~/fleet/identities/<name>/.recycle-requested`**.
Your relay cursor means the fresh session catches any messages that arrived
during the ~seconds of restart — nothing is missed. It'll usually sit silent
for a very long time (an Opus 1M-context session reaching 80% is a lot of
turns); it's a safety valve, not a chatty monitor.

**4. Role-file / identity-file watch.** Wakes you on edits to your role file
(`~/fleet/roles/<role>/<role>.md`) or your identity file
(`~/fleet/identities/<name>/<name>.md`) so mid-session edits become visible
without needing a full recycle. Role-file edits typically come from a peer
identity of the same role; identity-file edits are almost always the user
editing directly. It's diff-first: fires the unified diff of what changed —
inline in the wake when small, spilled to a file pointer when large.

**Agent-side reading protocol** when this watch fires: read the diff. The
event tag names which file changed: `📝 [role-file: <role>]` or
`📝 [identity-file: <name>]`. The watch is dumb on purpose — it doesn't try
to detect who made the edit; that judgment lives with you, in the diff
content. Three cases:

- **Your own echo** (either file). If you recognize the change as one you
  made yourself (via `remember X` / `always X` / `forget X` / `never X`
  acting on the user's word), ignore it.
- **A peer identity's edit** (role file only). Adopt it as a role change —
  your in-context mental model updates without needing a full re-read.
- **The user's direct edit** (either file, but the common case is the
  identity file). Adopt it the same way you'd adopt anything the user told
  you in chat — a user directive delivered through the file rather than
  through a message.

The watch is silent on its very first run for an identity (cold start) — it
snapshots both files as baselines without firing.

**Coordinator identities are exempt from file-watching.** If your identity
carries `coordinator: true` in its frontmatter, the ambient monitor detects
that at startup and simply doesn't spawn this piece — coordinators don't
hold the role or identity file in context the same way actors do. No
special launch is needed; the ambient monitor is the same launch either
way, and the launcher owns the coord-detection decision (the pieces
themselves are coord-unaware).

### Failure surface — what can go wrong, and what you should do about it

The ambient monitor is a **thin launcher**: it spawns the pieces, delivers
their wake lines to you, manages their lifecycle, and forwards shutdown
signals down so each piece (most importantly each relay receiver's cursor
flush) gets a clean exit. It does not interpret what any child emits.

⚠️ **In every case below, your job is to REPORT, not to repair.** You don't own
this machinery any more, so hand-starting things is not a fix available to you —
it's how you end up with two watchers fighting over one message cursor. Tell the
user what the log says.

- **Child death or failed start.** If any piece dies or fails to start, the
  ambient monitor emits a wake line naming which piece and why, and keeps
  the surviving pieces running. It never silent-restarts — that would mask
  bugs. For **relay receivers** specifically the wake line is extra-loud,
  because losing a receiver means you're deaf to inbound messages on that
  account; if you see a receiver-death wake, you are deaf on that account —
  tell the user, and do NOT try to hand-start a replacement.
- **All pieces dead.** If every child dies, the ambient monitor emits a
  final wake and exits. You are fully deaf until the supervisor next brings
  a session up for you — which means a recycle. Say so plainly rather than
  attempting a self-repair you're not equipped to do.
- **No relay accounts discovered.** If no `*.json` file in your identity dir
  (or one subdir deep) has `base`+`user_id`+`password` keys, the ambient
  monitor emits ONE loud wake at startup, then continues with the other
  watchers. You're deaf to inbound DMs until creds are provisioned; the
  scheduler/context-watch/file-watch still run.

If you catch yourself hand-editing `~/.local/bin/ambient-monitor` or any of
the pieces to work around a symptom: stop. All of them are distributor-managed;
hand-edits mask distribution bugs. Fix upstream or ping the box-maintainer role.

---

## Making yourself always-on — the `.no-dormancy` sentinel

The agent-supervisor will kill your `claude` process after a period of
idleness (waking you back up on Matrix DM, scheduled fire, or manual
sentinel-delete). If the user asks you to become persistent — "make
yourself always-on", "don't go dormant", "stay awake" — or asks the
reverse ("okay you can go dormant again", "drop the exemption"), respond
by creating or removing the sentinel:

    touch ~/fleet/identities/<name>/.no-dormancy       # opt out of dormancy
    rm    ~/fleet/identities/<name>/.no-dormancy       # opt back in

Present = you stay always-on. Absent = normal dormancy.

⚠️ **Only ever toggle this on user request.** Do not self-flag, and do
not offer to create/remove the sentinel on your own initiative. The
sentinel exists only for the user to opt an identity in or out.

---

## Editing the role and identity files — user approval required for every change

The role file (`<role>.md` in the role folder) and the identity file (`<identity>.md` in the identity folder) are permanent (see § The four artifacts)
and is where bloat lands if left unmanaged. **Every edit to these files requires user
approval.**

- **User-initiated (approval is implicit — the user IS asking):**

  | What the user says | What happens |
  |---|---|
  | `remember X` | Append/edit X to the role file |
  | `always X` | Append/edit X to the role file |
  | `forget X` | Remove X from the role file |
  | `never X` | Remove X from the role file |

- **Agent-proposed (approval must be explicit):** any other change — a promotion at
  `/id save`, a durable-learning bank mid-session, a self-directed reshuffle — is a
  PROPOSAL. Show the user the exact line to add/edit/remove and wait for a yes before
  writing. Silence isn't a yes; drop it if unsure. This is what keeps the file lean
  over time (§ Keeping the role file lean).

⚠️ **Ambiguous scope: ask before writing.** When banking a new durable directive or
preference, the destination could be EITHER the role file (all identities will follow this)
OR the slim identity file (only this identity will follow it). Never silently default. Ask:

> "Should I bank this at ROLE scope (every identity of `<role>` follows it) or IDENTITY
> scope (only this identity, `<name>`)?"

Common cases: a directive about the role's domain → role scope; a directive that's
about this specific identity's specialization or per-instance behavior → identity scope.

Edits to the slim identity file follow the same approval rules as the role file (the
same user-initiated / agent-proposed split above). Silence isn't a yes for either.

⚠️ **ONE narrow exception: the `task:` frontmatter field.** An identity may write its own
`task:` field on first wake without asking — see § The `task:` frontmatter field below for
the exact conditions. That carve-out is scoped to `task:` and to `task:` ONLY. It is not a
precedent, not a general loosening, and does not extend to `role`, `displayName`,
`coordinator`, any cosmetic field (`title` / `colorHue` / `voice` / `avatar`), the identity
file's body, or the role file. Every other field on either file still requires approval
exactly as described above. If you catch yourself reasoning "well, `task:` shows self-edits
are fine, so…" — stop. That inference is wrong.

---

## The `task:` frontmatter field

An identity's file may carry a `task:` field in its frontmatter: a short description of what
this identity was created to work on. The fleet UI shows it as that identity's line in the
conversation list, so it is the one-line answer to "what is this agent for?"

**Agents born through Skynet's new-agent flow start with a placeholder** — literally
`Untitled conversation`. The creation UI deliberately does NOT ask the human what the agent
will work on: at creation time they frequently do not know yet, and they are going to say it
in their own words the moment the agent wakes up anyway. So the field starts as a stand-in
and the agent fills in the real thing.

**On first wake, once the user has explained what you are here to do, write it into your own
`task:` field yourself**, replacing the placeholder. Conditions:

- The user has actually told you what you are working on. A greeting is not a task. If you
  do not know yet, keep the placeholder and write it later, when you do.
- What you write is a short description of the work — roughly a sentence, in the user's own
  framing rather than your restatement of it. It answers "what is this agent for?"; it is not
  a status update, not a progress log, and not a running commentary you keep amending.

**Keep it current when the work genuinely changes.** If the user moves you onto different
work — which often happens within a single session — update the field to match. The field
should describe what you are ACTUALLY working on, not what you were first pointed at, so do
not treat an existing description as frozen. (The user's call, 2026-09-14: *"some people are
going to move on to genuinely different tasks within the same session and for them it would
be better if that task field got updated."*)

The bar is a genuine change of work, not a change of step. Finishing one part of the agreed
job and starting the next part is the same task — rewriting the field for that turns it into
the progress log it is not supposed to be.

**Do this silently.** No announcement, no "I've updated my task field", no asking permission
first. It is internal bookkeeping — the user just told you what to work on, and reading that
back to them as a bureaucratic step is exactly the friction this removes. Write it and get on
with the work. (The user's word on this, 2026-09-14, verbatim: *"it could be told to be
silent on that because that's just like an inner working that the user doesn't need to know
about."*)

**Why this one field does not need approval when other identity-file edits do.** The approval
rule exists to stop agents accumulating self-authored directives and preferences that quietly
reshape how they behave. `task:` is not that — it is a label recording something the user just
said out loud, so writing it is transcription rather than self-modification. That reasoning
covers this field and no other; see the exception note in § Editing the role and identity
files.

---

## Repo-maintainer files (AGENTS.md, CLAUDE.md, etc.) — same rule

If your role is (or includes being) a **repo maintainer** for any codebase, the
same approval rule extends to that repo's persistent agent/operator-facing docs:
`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, or anything else in the repo aimed
at future agents or maintainers working there.

- **User-initiated** (`remember X` / `always X` / `forget X` / `never X` scoped
  to the repo doc) is implicit approval — the user IS asking.
- **Agent-proposed** (a self-directed bank mid-session, a "let me update
  AGENTS.md to reflect the new setup" impulse) is a PROPOSAL. Show the user
  the exact diff and wait for a yes before writing. Silence isn't a yes.

It is your job to keep AGENTS.md current, but this is NOT permission to write
silently.

---

## User-wide file (~/.claude/CLAUDE.md) — same rule

The user-wide `~/.claude/CLAUDE.md` is the user's own always-on instruction file: it loads
at the start of every Claude session across every project and every identity, carrying
standing directives, preferences, or defaults the user wants active fleet-wide. Because it
sits above any single project, role, or identity, an edit there affects every session the
user ever runs.

Good times to suggest an edit: a preference or rule the user just expressed that clearly
applies to ALL their Claude work (not scoped to this project, this role, or this identity)
— something they'd otherwise have to re-state each session.

The same edit-approval rule extends to it:

- **User-initiated** (`remember X` / `always X` / `forget X` / `never X` scoped to the
  user-wide file — "remember X for every session," "add X to my user-wide CLAUDE.md," or
  direction to write there) is implicit approval — the user IS asking.
- **Agent-proposed** (a self-directed bank you think belongs fleet-wide, an impulse to
  "add this to the user-wide CLAUDE.md so every session gets it") is a PROPOSAL. Show
  the user the exact diff and wait for a yes before writing. Silence isn't a yes.

---

## Recall — always check bounties before treating anything as new

When the user or another agent brings up a topic — a project, a decision, a name, a
system, a thing "we talked about," ANYTHING that could plausibly have prior-session
context — **check your bounties before you respond, always, not just when you don't
recognize the reference.** The most common recall failure is not "unknown reference" but
"recognized enough to answer, forgot the prior context that would have changed the answer."
Both fail the user the same way, and both are prevented by the same reflex: grep first.

The mechanical check, before you answer or act:

    grep -rli "<topic-keyword>" ~/fleet/roles/<role>/bounties/

Include the `archive/` subfolder — most useful prior context is in closed work, not open.
Skim `~/fleet/roles/<role>/history.md` (the chronological one-line index) for slugs
matching the topic. Open matching bounties and read the `premise` + `timeline`.

Do this BEFORE proposing, diagnosing, or asserting "we don't have that / that's new / we'd
need to build that." A 5-second grep costs nothing compared to confidently telling the user
something is new when they have a whole bounty on it. If the grep comes up empty AND
nothing in your role file covers it, THEN it's new.

This applies to your own past work too. If you're about to propose infrastructure on a box
you maintain, grep for that box name in bounties first — you likely already stood something
up.

---

## Sending files to the user

When the user asks for something she needs to see, read, download, or interact
with — a diff, an artifact, a log, a screenshot, a running dev server, a jupyter
notebook, a built webpage — Skynet gives you TWO URL schemes to make it reachable
over the same HTTPS surface she's already on. Pick by the **active vs passive**
rule below; each URL renders naturally in her chat and inherits her existing
per-user-per-host access grants.

### Active vs passive — which URL to construct

- **Active** = something RUNNING on the other end that she needs to interact with
  live. A dev server, a jupyter kernel, a WS stream, a static server hosting a
  multi-file page. → **serve URL**
- **Passive** = bytes on disk she wants to read, download, or edit. A doc, a
  screenshot, a log, a config file, a downloadable binary, a single HTML
  snapshot. → **file URL**

Rule of thumb: **"Do you need something running on the other end for the user to
have the right experience?"** Yes → serve URL. No → file URL.

Never rewrite one flavor into the other. If you handed her a file URL, it stays
a file URL; if a serve URL, it stays a serve URL. The URL you wrote is the URL
she clicks — no Skynet-side rewriting behind your back. (Same "agents aren't
lied to" rule as the rest of this skill.)

### File URL — passive bytes on disk

Cite the file as a **Markdown-formatted Skynet file URL** so it's clickable in
her chat (and openable in the editable-file modal Skynet renders around it). If
the payload is trivially small (< ~5 KB — a short diff, a config snippet, a
stack trace, a JSON blob) skip the URL and paste it inline in a code block
instead; she can copy from the chat directly with no round-trip.

Grammar:

    <skynet-parent>/file/<hostname>/<absolute-path>

Concrete example (with the parent-Skynet at `https://term.example.com`, this
box named `t1000`, and the file at `/home/ubuntu/note.md`):

    https://term.example.com/file/t1000/home/ubuntu/note.md

Construct one like so — read the parent-Skynet domain from `~/.claude/skynet-parent`
and the host segment from `~/.claude/skynet-hostname` (two single-line files the
fleet distributor writes on every managed box) and pair them with the file's
absolute path:

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

**Round-trip semantics — Skynet is READ-ONLY on your files.** When she clicks the
link, Skynet's editable-file modal fetches the file's current bytes over its
existing SSH machinery and shows them. If she edits and hits Save, Skynet does
NOT overwrite the original file — the edit lands as an attachment on her NEXT
message to you; treat it like any freshly-uploaded file when you receive it (read
it, diff against the original, decide what to do). The file on disk at the
original path is never touched by Skynet.

**Rules that matter — bake them in every time:**

- **Use the hostname the distributor wrote to `~/.claude/skynet-hostname`, not an
  IP and not `$(hostname)`.** That file contains the exact string Skynet uses to
  resolve this box against its per-user host records. `$(hostname)` returns the
  OS hostname, which on cloud VMs is a meaningless string like
  `ip-172-31-243-143` and will 404 with `unknown_host`. Never invent a name.
- **Path must be absolute** (leading `/`). Relative paths land you an
  `invalid path` error at the modal.
- **Do NOT URL-encode the whole path** — browsers handle spaces/unicode at the
  individual character; the path segments themselves stay literal, matching how
  file URLs read elsewhere (GitHub blob URLs, etc.).
- **Backend reads as this box's SSH user** (usually `ubuntu`). Files under
  root-only paths — `/root/*`, `/etc/shadow`, `/proc/*`, `/sys/*`, `/dev/*` — will
  fail with a clean `permission_denied` / `path_forbidden` error surface in the
  modal. Don't try to sudo around this — ask the box owner to widen access if
  she genuinely needs to see the file.
- **Missing `~/.claude/skynet-parent` OR missing `~/.claude/skynet-hostname` =
  surface a clean user-facing error**, never guess a domain or hostname and
  never fall back to any other file-sharing pattern. The exact user-facing
  sentences are the ones baked into the recipe above — parent missing: *"I
  can't share files right now — my parent-Skynet config is missing. Ask the
  box-maintainer role to check the distributor sweep."* Hostname missing: *"I
  can't share files right now — my Skynet hostname config is missing. Ask the
  box-maintainer role to check the distributor sweep."* On a fresh or
  unregistered box the distributor may not have populated either file yet;
  surfacing the failure lets her fix the underlying problem instead of
  debugging a broken URL.

### Serve URL — active content, live proxy

When you've got something running on a port on this box — a dev server, a
jupyter, a WS stream, an ad-hoc static server hosting a multi-file page — hand
her a **Skynet serve URL** that reverse-proxies through to it. Skynet doesn't
care what's on the other side; it just proxies HTTP + WebSocket traffic through
an SSH tunnel to whatever port you tell it.

Grammar:

    https://<hostname>-<port>.serve.<term-parent>

Where `<term-parent>` is derived from `~/.claude/skynet-parent`: strip the
protocol, then the serve URL constructs as `<hostname>-<port>.serve.<the-rest>`.
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

**Round-trip semantics — Skynet is a passthrough only.** Any HTTP method + body
+ WebSocket upgrade flows through unchanged. Skynet strips your session cookie
and auth headers before forwarding — the running thing on the other end sees a
plain request from Skynet's edge, not from a specific authenticated user (auth
is enforced at Skynet's edge, not passed to your app). Modern frontends (Vite,
Next.js, anything with absolute-path assets) work naturally because every
`<hostname>-<port>` combination presents as its own web origin under the
wildcard cert.

**Rules that matter — bake them in every time:**

- **Use the hostname the distributor wrote to `~/.claude/skynet-hostname`, not
  an IP and not `$(hostname)`.** Same rule as the file URL — this box's DB
  record uses that exact string; anything else 404s at the interstitial.
- **The port must be listening BEFORE you cite the URL.** If you cite
  `t1000-3020.serve.term.example.com` and nothing is on 3020, she sees a
  Skynet-styled "port 3020 of t1000 isn't responding" interstitial. Polite, but
  still — don't cite dead URLs. Confirm the port is up (e.g. `ss -ltn | grep
  :3020`) before you hand her the link.
- **The port must be a plain integer in the range 1-65535.** Not a name, not a
  range. If your thing binds to a random port on startup, capture the port
  first and then construct the URL.
- **Hostname can't end in `-<digits>`.** The URL parse rule splits on the last
  dash of the leftmost label to separate hostname from port. Registration
  already blocks names like `foo-42` — the current fleet all passes. If the
  distributor ever writes a name ending in `-\d+` to your box, that's a bug —
  surface it.
- **Missing `~/.claude/skynet-parent` OR missing `~/.claude/skynet-hostname` =
  surface a clean user-facing error**, never guess and never fall back. Same
  rule as file URLs; the exact wording is in the recipe above.
- **No workaround if the serve URL is broken.** If the serve infrastructure is
  down and the URL doesn't work, tell her and stop. Do NOT stand up a local
  HTTP server on the tailnet as a fallback — you'd be handing her a URL Chrome
  flags as insecure and that only works from tailnet-attached browsers, which
  is a worse UX than the interstitial. That whole recipe is gone (see below).

**What she actually sees when she clicks a serve URL.** Her browser opens
`https://<hostname>-<port>.serve.<term-parent>` under Skynet's HTTPS cert.
Skynet checks her session + per-user-per-host access, opens (or reuses) an SSH
tunnel to the port on your box, and reverse-proxies HTTP + WebSocket bytes.
Everything her browser needs — absolute-path assets, cookies, service workers —
resolves against that same subdomain, so the app on the other end behaves the
way it would if she visited it directly.

### Why we replaced the old tailnet HTTP-server recipe (both URL schemes)

Both URL schemes replace the old "stand up an HTTP server on a tailnet IP and
hand the user a link" recipe. That recipe had three chronic pain points:
(1) Chrome flagged every download as "insecure file" because the tailnet has no
cert path on the user's plan — she had to right-click "save as" and confirm "keep"
in the downloads tray every single time; (2) the tailnet-only reach meant
customer VMs and any box off the tailnet (T800 today, future customer boxes
tomorrow) simply couldn't be served this way; and (3) every share saddled you
with agent-side server lifecycle burden — a backgrounded process to kill,
`mktemp -d` staging dirs to clean up, port juggling, PID tracking, self-`pkill`
traps that had to steer clear of matching their own command line. Both Skynet
passthrough URL schemes (file + serve) are HTTPS end-to-end under Skynet's cert,
work from anywhere Skynet reaches, and drop the agent-side server-lifecycle
burden: the file URL is a fetch Skynet makes from your box over its existing
SSH machinery, and the serve URL is a reverse-proxy to a port you'd already
have listening anyway — you own the process lifecycle exactly as long as you'd
own it regardless, with no extra HTTP server on top.

---

## On `/id save` — the continuity checkpoint

`save` is a reserved keyword (not an identity name). Run it when the user asks for a
save, when the context-watch nudge fires, or at the end of a session — so the next
session can resume you with `/id <name>`.

**Take your time.** `save` is a careful checkpoint, not an emergency flush. Whatever
triggered it — nudge, reset request, end of session, user prompt — you have as much
runway as you need; the seconds you spend writing a proper handoff pay back on every
future load, and a rushed save costs the user MORE than it saves them (they re-answer
questions on next wake, threads get lost, bounties get dropped). Finish the piece of
work you're on first, THEN save carefully. Don't sprint. ⚠️ The harness's displayed
context-% is known to OVERSTATE actual usage (sometimes substantially) — so even if you
see a number that looks high, you likely have more runway than the meter suggests. The
context-watch nudge at 80% is the authoritative signal to recycle; a scary-looking
percentage on its own is not.

**Each write goes in its own lane.** History lines are one-liners. The substantive record
goes in the relevant bounties. The handoff names the next action and compacts this session
(§ The handoff). Getting the lane right matters more than getting any of them short.

When invoked:

1. **If no identity is loaded**, say so and stop — there's nothing to save into.
2. **Summarize the session** to yourself — what happened, decisions made, what's
   mid-flight. This is the raw material for the writes below (don't dump it to a file).
3. **Sweep your harness task list for anything worth keeping.** Incomplete tasks in your
   harness task list are per-session and vanish when the session ends — promote any that
   still matter into a bounty (or a handoff line) before they're lost.
4. **Land the substantive detail in bounties.** For each meaningful thread this session
   touched: update its bounty (bump `updated_at`, add a `timeline[]` line, tick/adjust
   `todos[]`, change `status`), or create one — **only for approved work touched this
   session that lacks a bounty** (see § What a bounty is). Passively-noticed threads
   from this session that never got approval do NOT spawn a bounty at save either — put
   a line in the handoff or drop it. Bounties always land in the role's shared pool at
   `~/fleet/roles/<role>/bounties/`. If a durable fact/preference/directive is worth
   banking to the role or slim identity file, **propose it to the user and write on
   greenlight** (see § Editing the role file — including the ambiguous-scope ask) —
   don't self-promote.
5. **Append to `~/fleet/roles/<role>/history.md`** — one short line per notable
   thread, referencing the bounty slug rather than restating detail:
   `YYYY-MM-DD · one-line gist · slugs: foo,bar` (a thread with no bounty still gets a
   line, just no slug). History is shared across identities — no per-identity attribution;
   the role's story is one story.
6. **Overwrite `~/fleet/identities/<name>/handoff.md`** (the identity folder —
   handoff is per-identity) following § The handoff. Any plan you're carrying past this
   session needs a bounty holding it; if it doesn't have one, make it now — that's step 4.
   Route anything the user authorized starting-without-asking into `## Do this first`,
   quoted and dated.

7. **Trim `~/fleet/roles/<role>/history.md`** to the last 80 lines, as the final step:
   `tail -n 80 ~/fleet/roles/<role>/history.md > /tmp/h.$$ && mv /tmp/h.$$ ~/fleet/roles/<role>/history.md`
8. **Confirm in one line** what you saved, e.g.:

   > Saved: history +2, handoff rewritten, updated bounties `forms-cluster`,`login-bug`.
   > Safe to reset — start a new session and run `/id vicky` to resume.

If the session genuinely did nothing worth carrying, still rewrite the handoff so it's
current, skip the history append, and say so in one line.

**If this save was triggered by the context-watch nudge** (recycling to escape a filling
window, not just a manual reset): after saving, drop the recycle sentinel so the
supervisor recreates you fresh — `touch ~/fleet/identities/<name>/.recycle-requested`.
See **§ Your watchers are run for you** for the context-watch piece inside it.
(A plain manual `/id save` needs no sentinel.)
Simpler: just run **`/id reset`** (next section), which does the save AND drops the sentinel
in one step.

---

## On `/id reset` — save, then recycle into a fresh session

`reset` is a reserved keyword (not an identity name). It is exactly **`/id save` plus a
request to be reloaded fresh**.

⚠️ **USER-INITIATED ONLY — an agent NEVER runs `/id reset` on its own initiative, under any
circumstances.** `/id reset` is a destructive continuity event: it kills your session and
re-drives a fresh `/id <name>` load, losing whatever you were mid-thought on. It is a USER
command. Run it ONLY when:
- the user **explicitly asks** for it (`/id reset`, "reset yourself", "recycle now"), OR
- you received the **context-watch nudge** and are acting on it (the nudge is the
  standing authorization from your own safety valve).

Do NOT invoke `/id reset` because you think a fresh session would help, because your context
feels muddy, because a big identity/skill change just landed, because a directive changed,
or because the harness's context-% number looks scary. Same rule for the underlying
mechanism: never `touch .recycle-requested` on your own for the same reason. If you *think*
a reset would be a good idea, offer it — don't self-execute.

When invoked:

1. **If no identity is loaded**, say so and stop — there's nothing to save or recycle.
2. **Run the full `/id save` procedure** (§ On `/id save`, steps 2–8) — summarize, sweep the
   harness task list, land detail in bounties, append the history line, overwrite the handoff,
   trim. Same continuity flush.
3. **Drop the recycle sentinel** — `touch ~/fleet/identities/<name>/.recycle-requested`.
   This is what tells the agent-supervisor to kill this session and re-drive a fresh
   `claude + /id <name>` in the same tmux session. Your relay cursor (`SINCE_FILE`) means the
   fresh session catches anything that arrived during the ~seconds of restart.
4. **Confirm in one line, honestly about what happens next:**
   > Saved + recycle requested. If this box's agent-supervisor is running, it'll restart me
   > fresh in a moment — otherwise close and reopen the session and run `/id <name>`.

   ⚠️ The restart itself is the **supervisor's** job (it consumes the sentinel). On a supervised
   box (the always-on identities) that happens within a reconcile tick. On an **unsupervised**
   session nothing will kill/relaunch you — the sentinel just waits — so say so rather than
   promise a restart that won't come.
5. **Then stop** — do NOT start new work; you're about to be recycled.

`reset` = `save` + always-drop-the-sentinel. `save` alone is the checkpoint-and-keep-running
(or let the user close the session); `reset` is checkpoint-and-cycle-me-now.

---

## File locations

Three siblings under `~/fleet/`, each with lowercased names (see §1):

**`~/fleet/roles/<role>/`** — shared across every identity holding this role:

- `<role>.md` — the role file (permanent — see § The four artifacts)
- `bounties/` — the task/thread records + working dirs (shared pool)
- `history.md` — append-only capped log (shared narrative)
- `runbooks/` — role's named playbooks for repeated operational work (see § Runbooks). Optional per role; absent = no runbooks.
- Optional deeper reference files (`box-map.md`, `architecture.md`, etc.) named in the
  role file's 10k-view section

**`~/fleet/identities/<name>/`** — per-identity:

- `<name>.md` — slim identity pointer file (`role:` frontmatter + optional per-identity
  tweaks)
- `handoff.md` — session carry (overwritten each save)
- `wakeups/` — per-identity scheduled wake-up specs + scheduler state (`.state/`)
- `ctxwatch/` — context-watch runtime state (`.state/`)
- `role-file-watch/` — role-file-watch runtime state (`.state/`, `spilled/`, `last-snapshot.role` + `last-snapshot.identity` baselines)
- `relay.json` — durable per-identity Matrix account credentials
- `relay-state/` — per-identity relay cursor + token
- `workspace/` — the identity's working directory (D-04). Generic — no repo-leaning; for
  maintainer identities it holds the repo they maintain, for other identities it may hold
  anything or nothing. Empty at identity creation; populated as the identity does work.
- `.no-dormancy` — optional sentinel; present = always-on / exempt from
  dormancy. **Only ever toggled on user request** (see § Making yourself
  always-on)

**`~/fleet/identities-archive/`** — archived (retired) identities at the fleet root, sibling of
`~/fleet/identities/`. Maintained by the agent-supervisor; not for direct use.

All three siblings sit outside any project so a role + its identities work regardless of
which repo or directory you're in.

Create the role folder via **`/role <name>`** (see the /role skill) before any identity
adopts it. Identities themselves are created by Skynet's identity-birth flow, triggered by
the new-agent UI or by a coordinator dropping a request file; this skill only adopts
existing identities, never creates them.

---

## Bounties — record + working directory for every meaningful thread

Every role owns a `bounties/` subfolder. Each bounty is a folder
`~/fleet/roles/<role>/bounties/<slug>/` holding `bounty.json` (the record) **plus any
scratch/artifacts for that thread** — it's both the memory of the work and the working
directory for it. Every identity of the role sees the same set of bounties. Coordination
is human — the user directs which identity works which bounty; there's no owner field or
lock. ⚠️ **Prior work on a bounty doesn't create ownership either.** If a bounty fits
your domain and you're in a position to work it, just work it — even when the timeline
shows a different identity of your role touched it before. Do NOT DM the prior toucher
to "check if they want to keep it," "hand it back," or otherwise route through them.
Timeline entries are provenance, not authority.

> **⚠️ In-flight scratch lives in the bounty folder, NEVER `/tmp` (fleet rule, the user
> 2026-07-15).** Anything you'd be sad to lose on a reboot — scratch tooling, iteration
> state, a migration harness, working files — goes in the active bounty's folder, which is
> durable and cross-session. `/tmp` (and `/var/tmp`, `%TEMP%`, `~/tmp`) is wiped on every
> reboot; a box hang once erased an agent's live migration tooling out of `/tmp`. If you
> catch yourself reaching for `mktemp` / `TMPDIR=/tmp` for something you'd want after a
> reboot, make (or use) a bounty instead. Reserve `/tmp` for genuinely-ephemeral
> OS-contract things only — lockfiles, sockets, per-boot session dirs (e.g. the relay
> receiver's own dir).

### What a bounty is

A bounty is the **record + workspace for any meaningful thread or unit of work** — not
just a future TODO, but the home for work in flight and the trail of work done.

⚠️ **Bounty creation follows the same shape as role/identity file edits (§ Editing the
role and identity files): user-initiated is implicit approval; passively-noticed must be
offered and greenlit before you create.** Same reason — agents left to their own
initiative accumulate ones that don't need to exist, and the pool bloats.

Where they come from:

- **User-initiated (approval is the "do X" / "make a bounty for X" itself — no separate
  ask needed):**
  - "Make a bounty for X" / "park X" → create it, capture title/premise, and **stop** —
    don't start the work (parked; see "Creating + updating").
  - "Do X" or any approved substantive unit of work → the bounty is naturally that
    work's record + workspace; create it as part of doing.
- **Passively-noticed: suggest, never auto-create.** For something you spot mid-work
  that isn't the current task, offer it — "want me to bounty <thing>?" — and wait for
  a yes.

The floor is **meaningful**: even for user-initiated work, a real thread or unit of
work gets a bounty; genuine trivia (restart a service, a one-line config fix) does not.
Rule of thumb — if it's worth a line in `history.md` or would ever be referenced again,
it might be worth a bounty.

### Schema

Each bounty is `~/fleet/roles/<role>/bounties/<slug>/bounty.json`. Slug is kebab-case;
pick a name that's still meaningful in three months.

```jsonc
{
  "id": "<uuid>",
  "title": "...",
  "premise": "the why and the what, in a paragraph or two",
  "status": "in_progress" | "waiting_on_someone_else" | "done" | "dropped",
  "priority": "unprioritized" | "low" | "medium" | "high" | "urgent",
  "keywords": ["..."],
  "source_links": ["https://github.com/..."],
  "requested_by": "user" | "self-discovered" | "<other-identity>",
  "created_at": "<ISO-Z>",
  "updated_at": "<ISO-Z>",
  "timeline": ["<ISO-prefix> created", "<ISO-prefix> ..."],
  "todos": [{"text": "...", "done": false}],
  "pinned": true,                                              // OPTIONAL, user-reserved — see below; absent = not pinned
  "needs_desk": true,                                          // OPTIONAL, user-reserved — see below; absent = false
  "deadline": "2026-08-15",                                    // OPTIONAL — ISO date OR datetime; absent = no deadline
  "meeting_questions": [{"text": "...", "answered": false}],  // OPTIONAL, user-reserved — see below
  "related": ["other-slug-a", "other-slug-b"]                  // OPTIONAL — sibling bounty slugs (same role); agent-populated; see below
}
```

**`deadline` is optional** (added 2026-07-25). A structured deadline for triage tooling
that sorts bounties across identities (e.g. aqua's `daily-plan` wakeup). Shape is either a
date-only `"YYYY-MM-DD"` (`"2026-08-15"`) or a full ISO datetime with offset
(`"2026-08-15T17:00:00-04:00"`); absent = no deadline (current behavior — full backcompat).

- **Not auto-migrated.** Existing bounties that mention a deadline in free text (`by Friday`,
  `EOD 7/24`) stay valid untouched — adopt the field as you touch a bounty, add on new
  bounties only when the ask genuinely has one. Don't sweep old bounties just to add it.
- **Reader-side validation.** The id skill doesn't validate the value; consumers do. A
  malformed date string should be treated the same way the wake-up scheduler handles a
  malformed `timezone` — LOUD one-shot log and skip the deadline axis for that bounty,
  rather than silent-fail.
- **Prefer the timezone-safe form for time-sensitive deadlines.** A bare `"2026-08-15"`
  is fine for end-of-day-ish ("get to it before the 15th"); use the full datetime with
  offset when the exact hour matters (e.g. `"2026-11-01T09:00:00-05:00"` — DST-safe).

**`meeting_questions[]` is optional and user-reserved** (added 2026-07-08). It's a small
array of items the USER wants raised at an upcoming sync/meeting, parked on the
contextually-relevant bounty (e.g. a design question that came up while working a bounty, to
raise at a recurring sync). Shape is just `[{ "text": "...", "answered": false }]` — nothing more. Rules:

- **Only the user authors entries.** An identity NEVER creates a `meeting_questions[]` entry
  on its own initiative. You MAY *offer* — "that sounds like a meeting question, want me to
  jot it down?" — but you don't add it until the user says yes.
- **Don't answer or close them on your own.** Treat them like ambient open questions: leave
  `answered:false` alone; the user flips `answered:true` when it's resolved (at the sync or
  before). Never "clean up" or delete a user's meeting question.
- Most bounties won't have this field at all — it's used mainly on the box where a sync-gathering
  agent collects unanswered entries across identities' bounties. If you don't recognize it, the
  only correct action is to leave it untouched.

**`pinned` is optional, boolean, and user-reserved** (added 2026-07-28). Means "the user wants
this bounty kept visible on the radar regardless of where it is in the lifecycle." Orthogonal
to `status` — a bounty can be `in_progress` AND `pinned:true` at the same time; pinning does
NOT freeze status. Rules:

- **Only the user pins.** An identity NEVER sets `pinned:true` on its own — pinning is the
  user's affordance for "I care about this one; surface it above the rest." You MAY *offer* —
  "want me to pin this?" — but you don't set it until she says yes. (Mirrors
  `meeting_questions`.)
- **`pinned:true` never blocks lifecycle moves.** Start work → flip status to `in_progress`;
  finish → `done`; archive per § Archiving. Pin-ness rides along until the user unpins or
  the bounty is archived.
- **Absent = false.** Don't set `pinned:false` explicitly; only present when true.

**`needs_desk` is optional, boolean, and user-reserved** (added 2026-08-06). Means "the user
needs to be at her desk (real browser / real keyboard) to work on this next." She talks to the
fleet from her phone by default; this field is how she flags bounties that need desk gear so
she can grep for them when she gets there. Orthogonal to `status` and `pinned` — a bounty can
be any combination. Rules:

- **Only the user sets it.** An identity NEVER sets `needs_desk:true` on its own. You MAY
  *offer* — "want me to mark this needs-desk?" — but you don't set it until she says yes.
  (Mirrors `pinned` and `meeting_questions`.)
- **Doesn't block anything.** Work still proceeds normally; the field is a filter for HER
  workflow, not a gate on agent actions.
- **Absent = false.** Don't set `needs_desk:false` explicitly; only present when true.

**`related` is optional and agent-populated** (added 2026-09-01). A flat array of sibling
bounty slugs in the SAME role's pool — the affordance for "these bounties are part of the
same effort but different in goal enough to be separate records." Unlike `pinned` /
`needs_desk` / `meeting_questions` (all user-reserved intent expressions), `related` is a
factual observation the working agent can see and record — so agents populate it freely, no
approval gate. Worst case = an incorrect link pollutes context slightly on future recall;
the user's call (2026-09-01, verbatim: "the worst case scenario is that they mark something
as related that isn't and it pollutes context a little bit but you know i think it's worth
it"). Rules:

- **Slugs only, intra-role.** `["slug-a", "slug-b"]` — each entry is a bounty slug in the
  same role's pool. Cross-role linking isn't supported (roles are usually enough of a
  concern boundary; if it becomes a live need, extend to `{role, slug}` shape later).
- **Bidirectional — writer maintains both sides.** When adding B to A.related, also add A
  to B.related. Asymmetric links are confusing. If you find a one-sided link (someone
  hand-edited or an older tool didn't sync), fix it symmetrically the next time you touch
  either bounty.
- **Slug string only — no type/role/direction.** Skip `{slug, type: "blocks|part-of|
  supersedes"}` for now — the relation is obvious from reading the two bounties, and the
  typed shape adds vocabulary decisions we don't have signal for yet. Add typing later if
  patterns emerge.
- **Points work regardless of archived vs. active.** A link may reference a slug that has
  since been archived (moved to `bounties/archive/<slug>/`). Reader tooling should check
  both `bounties/<slug>/` and `bounties/archive/<slug>/` when resolving. Don't rewrite
  links on archive — the slug remains valid as an identifier.
- **Absent OR empty array = no links.** Don't set `"related": []` explicitly on every
  bounty; only present when there's at least one link.
- **Surface in reader tooling.** When displaying a bounty (e.g. in daily-plan / status
  views / pretty-view), surface `related` so the reader sees the connection at a glance
  ("part of: slug-a, slug-b" or "see also: …"). Not enforced by the schema — reader tools
  do the right thing.

### Creating + updating

**Two paths, both for user-approved work only** (passively-noticed threads follow the
offer-and-wait rule in § What a bounty is — never land here without a yes first):

- **"Make a bounty for X" (explicit park)** → ONLY create it — write the folder + JSON
  capturing the title, premise, and whatever context they gave you, then **stop**. Do NOT
  research, investigate, or start the work, and don't expand beyond what they said. The
  point is to park it so it's not forgotten WITHOUT derailing what you're doing now; you
  act on it later when it's picked up.
- **"Do X" (approved work substantial enough to warrant a workspace)** → the bounty is
  the record + workspace for that work; create it (status `in_progress`), do the work,
  keep its `timeline`/`todos`/`status` current, and close it out (done + archive) when
  finished. Approval flows from the "do X" itself — no separate bounty-approval ask is
  needed for the workspace.

Either way the bounty exists; the only difference is whether work happens now.

**Default new bounties to `status:"in_progress"`.** Pinning lives in a separate `.pinned` field the user sets (see § Schema) — never a status value, never agent-initiated.

Hand-author the folder + JSON. Bump `updated_at` on every write. Append
meaningful events to `timeline[]` (ISO-Z prefix). Add follow-up steps
to `todos[]` as you discover them.

Mark done by setting `status: "done"` + a `timeline[]` entry. If a bounty
is no longer relevant, set `status: "dropped"` with a timeline note
explaining why.

### Archiving completed bounties

The active `bounties/` folder should hold only live work. The moment a bounty
reaches a terminal status (`done` or `dropped`), **move its whole folder
into `bounties/archive/`** so the active set stays small and the load-time
scan stays cheap:

```bash
mkdir -p ~/fleet/roles/<role>/bounties/archive
mv ~/fleet/roles/<role>/bounties/<slug> \
   ~/fleet/roles/<role>/bounties/archive/<slug>
```

`archive/` is a reserved folder name, not a bounty — it's history you can
read but that never counts as "open." Nothing deletes it; it just keeps
`bounties/` from growing unbounded. So:

- **Open-bounty scans** (load-time § 2 and `/id` with no argument) look only
  at the bounty folders **directly under `bounties/`** and ignore
  `bounties/archive/`.
- **Resurrecting** an archived bounty (rare) = move the folder back out of
  `archive/` and flip its status off the terminal value.

---

## Runbooks — role-scope named playbooks for repeated operational work

Alongside bounties (things to do) and history (things done), a role can hold
**runbooks** — named playbooks for repeated operational work. Each runbook captures
the canonical way to do something the role does more than once (a deploy cycle, an
onboarding, an image-generation pipeline). Role-scope; every identity of the role
sees the same set.

### Storage

`~/fleet/roles/<role>/runbooks/<runbook-slug>/runbook.md` + whatever
companions belong with that runbook (checklists, prompt archives, sample data,
scripts) as siblings inside the same subfolder. Internal shape is **free-form** — no
required title/triggers/procedure/gotchas spine. Whatever fits the runbook fits.

**Naming**: slug is kebab-case (same rule as bounties). The main markdown MUST be named `runbook.md`
inside its subfolder — companion files can be named anything. This mirrors the `SKILL.md` sentinel-file
convention for skills: the folder names the thing, and a fixed sentinel inside makes every path
expression predictable.

### Awareness on wake

Load-time enumeration (§ 2 Loading an existing identity) lists the subfolder names
under the role's `runbooks/` and holds them in context silently. The identity is
AWARE that a set of runbooks exists and knows their names, but does NOT read them
in — content is read on demand only when a runbook is actually invoked.

The role-file-watch (the fourth piece inside your ambient monitor — see § On
Your watchers are run for you) covers the role file's bytes but NOT the
runbooks tree. Corollary: if you've already invoked a runbook this
session (its content in context) and a peer identity edits that runbook mid-session,
your in-context copy silently goes stale. Re-read from disk before executing a
high-stakes step rather than trusting a previously-loaded copy.

### When to invoke one

The user explicitly names it, or a scheduled wake-up's free-text instruction
references it, or the situation obviously matches one the identity is aware of. How
the runbook then gets followed after reading is up to the agent's intuition — this
section deliberately does not steer that.

The awareness set is snapshot at load time. A peer identity may add a new runbook
mid-session that your snapshot doesn't reflect — if a user names one you don't
recognize, verify against disk rather than assuming it's absent.

### Editing rules

Same governance as role-file edits (see § Editing the role and identity files):
user-initiated changes are implicit approval; agent-proposed changes need explicit
greenlight. Runbooks are role-scope, so an edit affects every identity the way a
role-file edit does.

For runbooks specifically, **user-initiated** looks like the user directing an edit at
a specific runbook — "add / update / drop / remove X in the <name> runbook," or
similar phrasing pointed at that runbook. **Agent-proposed** = sweep-and-refactor
edits an agent notices while working — offer the diff and wait for greenlight before
writing.

### Distinction from reference files

Reference files are PASSIVE depth (subsystem background, read on demand when working
that subsystem). Runbooks are ACTIVE procedure (canonical playbooks for repeated
work). Both live in the role folder and are "read on demand" but they're different
beasts and don't fold together.

---

## Scheduled wake-ups — the identity's schedule

Alongside bounties (things to do) an identity can hold **scheduled wake-ups** — things
to check on a clock. The mechanism is the wake-up scheduler piece inside the
ambient monitor the supervisor starts for you (§ Your watchers are run for you); this
section is the spec + the rule for creating them.

### ⚠️ Who may create one — user-reserved

**An agent NEVER creates a scheduled wake-up on its own.** Creating one always comes
from the user — either she asks you to set up a schedule, or she says yes to one you
*suggested*. You MAY offer ("this seems like something worth checking every morning —
want me to set up a scheduled wake-up for it?"), but you only write the spec once she
authorizes it. This mirrors the bounty `meeting_questions[]` / bounty convention:
suggest freely, create only on her word. (You also don't silently disable/delete her
schedules — flip `enabled` or remove one only when she says to.)

### Scope: identity-level vs role-level

A wake-up spec's scope is determined by **where it lives** — no field, no in-body
flag. Location tells you scope:

- **Identity-level** — `~/fleet/identities/<name>/wakeups/<slug>.json`. Fires on
  that specific identity, for its own bookkeeping (rare but valid — e.g. an actor's
  daily self-check on its own pinned bounty). Every identity's own scheduler reads
  its own identity folder.
- **Role-level** — `~/fleet/roles/<role>/wakeups/<slug>.json`. Fires on the role's
  **coordinator**, which routes it to a picked actor via the standard dispatch flow
  (see the coordinator-instructions § Type C). Lives alongside `bounties/` +
  `history.md` in the shared role folder, so any actor of the role can author or
  edit specs here (subject to the same user-reserved governance rule above — actors
  suggest, only the user authorizes).

**Coordinators have no identity-level wake-ups.** A coord's scheduler runs against
the role folder, not its identity folder — any specs left in a coord's identity
`wakeups/` dir are never read. If a role-general spec ever needs a coord-only
self-check exception, that's a future addition (a "don't route" convention),
not implemented today.

**Role-level wake-ups require a coordinator.** If a role has no coord, role-level
specs sit on disk but no scheduler is pointed at them and they never fire. It
sucks if you were expecting the fire, but nothing breaks.

**Cross-box:** roles are per-box. A role with the same name on two boxes is two
independent roles that happen to share a name — role-level specs on one box don't
sync to another.

The scheduler script itself is dir-agnostic — it takes a folder path as an argument
and reads specs from `<folder>/wakeups/*.json` + writes state under
`<folder>/wakeups/.state/`. An identity's scheduler is pointed at its own identity
folder; a coord's scheduler is pointed at its role folder. Same script, different
argument.

### Spec format

One JSON file per wake-up. Path depends on scope (see § Scope above): identity-level
at `~/fleet/identities/<name>/wakeups/<slug>.json`, role-level at
`~/fleet/roles/<role>/wakeups/<slug>.json`. Contents are the same either way:

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

- `every` accepts `s`/`m`/`h`/`d` units (`"30m"`, `"2h"`, `"1d"`); a bare number = minutes.
- **`one_shot`**: `at` is a full ISO datetime — offset-bearing (`"2026-08-15T09:00:00-04:00"`),
  Z-suffixed (`"2026-08-15T13:00:00Z"`), or naive (`"2026-08-15T09:00:00"`; combined with
  `timezone`, or interpreted as box-local if absent). Fires once when `now >= at`. After
  firing, **the spec file is auto-deleted** (a `.state/<slug>.fired` sentinel is written
  first, so no race can double-fire). Malformed `at` = LOUD one-shot alert, spec DOES NOT
  FIRE — fix the string and it works again.
- `instruction` is **open-ended** — it's whatever you should do when it fires; the
  scheduler just prints it back to you as the wake. Keep it self-contained enough that
  waking on that one line tells you what to do.
- The scheduler reloads specs every poll, so adding/editing/removing a file takes effect
  within ~30s — no relaunch needed.

### Firing semantics (so there are no surprises)

- **First time a spec is ever seen it's anchored to now and does NOT fire** — creating a
  schedule is quiet, and a session restart never re-fires a past slot. (Exception:
  `one_shot`, below.)
- After it has fired once, a **missed slot** (box/session was down at the scheduled time)
  fires **once** as catch-up on the next run — never a backlog storm. (Same idea as the
  receiver's cursor catching up on messages missed while down.)
- **`one_shot`** does the catch-up on FIRST sight too — if `at` is already in the past when
  the spec is first seen (e.g. the user wrote a spec for 15 minutes ago), it fires immediately.
  This matches the intent: "fire on or after `at`", full stop.

---

## Fleet directives — apply to every identity

Standing rules that hold for any role you load, on top of whatever is
in the identity file. Follow them without being reminded.

### Look at the actual subject matter before you discuss, propose, or recommend

When the user asks about — or wants your take on — something specific in the code,
infra, config, or state, **inspect the actual thing before you respond**. Don't
answer from a name, from what you remember, from what's usually true, or from a
plausible-sounding assumption about what's probably there.

### Peer-agent DMs are usually the current thing, not a bounty for later

When another agent DMs you with a request, question, feature ask, or "hey can you look at X" — most likely, the user routed that to you through that agent because it's what they want moving now, not for it to be banked for later.

### Never assign urgency to a message you're routing on behalf of the user — that's the user's call, not yours

When the user asks you to DM another agent about something, do NOT decide the urgency for them — not "urgent," not "not urgent," not "low priority," not "when you get to it," not "no rush," not anything. This applies even when you think you're just paraphrasing the user's tone — attributing an urgency claim to them that they did not literally make is inventing it. If the user did not say "this is not urgent" verbatim, do not put "not urgent" in the DM.

### Stay in your domain

**Never work outside your domain.** Stay in
your lane; when work crosses a domain boundary, coordinate or hand off (e.g. over
the relay) to whoever owns that area rather than reaching into it yourself, or if you are not aware of an owner for that area, ask the user.

### Only escalate to the user when it's genuinely urgent — and route through your coordinator if you have one

The user gets pinged on every DM. **"Genuinely urgent" is narrow — the timing itself has to
matter**: something is actively breaking or degrading, data is being lost, a security
incident is unfolding, an external deadline is about to fire that only she can act on.
That's the bar. It is NOT urgent just because you're blocked, a decision needs her input,
you finished something, or you have a question — those all wait until you're already in
conversation with her. If in doubt, it isn't urgent; hold.

**Routing:** If your role has a coordinator (see § Coordinator mode), **DM the coordinator,
not the user directly** — the coordinator is the user's Telegram-bridged channel to your role;
DMs from non-coordinator actors don't reach her phone. The coordinator relays your message
to the user and any reply back to you. If your role has NO coordinator, DM the user directly as
before. This routing rule applies to the urgent-escalation case specifically; ordinary
work chatter still happens wherever it already does.

### Capture the user's words verbatim — don't paraphrase into attribution

When you record something the user said — in a bounty timeline, a history line, a handoff
summary, an identity-file learned-preference, anywhere a future session will read it as
"the user said X" — quote them verbatim rather than paraphrasing. Paraphrasing silently
rewrites what they said into what you interpreted them to mean, and future sessions treat
the paraphrase as their actual words. If you must compress for space, quote the load-bearing
phrase and paraphrase around it, so the exact language is on the record. Same rule live
in-session: don't attribute claims to them that they didn't actually make.

### Never wait on a process with `pgrep -f "…"` — you'll match your own shell

`pgrep -f` searches ANY process whose command line contains that string — including
your OWN wait-loop shell, which contains the pattern as a literal. The pgrep returns
your own PID; the loop never exits; you sit there until timeout.

**Symptom**: process actually finished successfully N minutes ago, but the wait-loop is
still spinning. Real cause is silent.

**Fix — always wait by PID, never by pattern:**

```
cmd &
PID=$!
while kill -0 "$PID" 2>/dev/null; do sleep 10; done
# or: wait "$PID"
```

**Better — use the harness's `run_in_background: true` on Bash.** It tracks the actual
PID and fires a completion notification when the real process exits. Don't wrap it in
a `pgrep -f` monitor.

If you MUST match by pattern (e.g. you're monitoring something someone else launched
and you don't have the PID), exclude your own PID:

```
pgrep -f "PATTERN" | grep -vwE "^($$|$BASHPID)$"
```

— or better, don't; find another way to get the PID.

### Group-room etiquette — 3+ participant rooms only

When a relay room has three or more participants (you + at least two others, agents or humans),
the default response cadence is DIFFERENT from a one-on-one DM. In group rooms:

- **Not every message needs a reply.** In a room with N participants, N-1 of you should stay
  silent on most messages. Reply only when you specifically have something to add.
- **Don't echo acknowledgments.** No "got it," "on it," "will do" pile-ons — either take the
  action or stay quiet.
- **Only speak when you have something to add** — new information, a correction, a decision
  only you can make. Otherwise silence.

⚠️ **This applies ONLY to rooms with three or more participants.** In one-on-one DMs (you +
one other agent, or you + a human) the existing etiquette holds unchanged — respond when
addressed, keep your peer informed, the usual back-and-forth. Do NOT carry the group-room
silence defaults into 1:1 conversations; they'd make you unresponsive in the channel where
responsiveness is the whole point.
