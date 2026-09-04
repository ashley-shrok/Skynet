---
name: id
description: >-
  Load or create a named role identity.
---

# Identity Skill

## What this skill does

`/id <name>` gives you a persistent role that survives across sessions.
It is the difference between starting fresh every time and resuming a person.

Storage is a **two-folder split**: the fat shared knowledge for a role
lives in one folder, the slim per-identity state lives in another. This lets
multiple identities adopt the same role and run in parallel (identities —
parallel workers on the same domain).

- `~/.claude/roles/<role>/` — the **ROLE**: role file (directives,
  preferences, runbooks), bounty pool, chronological history, and any
  deeper reference file(s) the role wants (e.g. `box-map.md`). Shared
  across every identity that adopts the role.
- `~/.claude/identities/<name>/` — the **IDENTITY**: a slim
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

**In the ROLE folder (`~/.claude/roles/<role>/`) — shared across identities:**

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

**In the IDENTITY folder (`~/.claude/identities/<name>/`) — per-identity:**

- **`handoff.md` — single file, fully OVERWRITTEN at each `/id save`.**
  Per-identity (never role-scoped, because where-I-left-off is per-instance
  state). Holds the latest session summary, any items the user
  pre-authorized to start on next wake, and this identity's currently-open
  multi-session plans (one line each, pointing at the bounty slug that
  holds the detail). Read at session start, it's how the next session
  knows where THIS identity left off without asking. See § The two lanes
  in the handoff below for the load-bearing distinction between "start
  on wake" and "open plans."

Also per-identity but not in the four-artifact set: the slim
`<name>.md` pointer (metadata — a `role:` frontmatter line naming the
role, plus optional per-identity tweaks), `wakeups/`, `ctxwatch/`,
`relay.json`, and `relay-state/`. Small, low-content files that support
this specific identity.

**The load-bearing rule:** anything substantive is a **bounty**.
`history.md` and `handoff.md` are the thin connective tissue — a
one-line index and a where-we-left-off carry. If a plan lives only in
the handoff and a session forgets to carry it forward, you lose a
little continuity; if it's a bounty, it's on disk regardless. So when
in doubt, it's a bounty.

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
source updates but the copy doesn't. Same principle applies at creation time (§2): a fresh
role file inherits everything in the id skill and the user-wide CLAUDE.md for free — don't
seed it with a summary of those. If you want to point at a rule from either, cite it, don't
restate it.

**Standard section template + soft caps** (adjust for your role):

- `## Role` — 5-15 lines. Who you are, what you own.
- `## The <box-or-domain> at 10,000 feet` — A useful high-level mental model
  of what you deal with. Almost every role is a maintainer of something and benefits
  from this. Deeper reference (per-subsystem paths, commands, gotchas) belongs in ONE
  explicitly-named on-demand file in the role folder (like
  `~/.claude/roles/<role>/box-map.md`),
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

## The two lanes in the handoff — "Start on wake" vs "Open plans"

`handoff.md` carries pending work in **two lanes**, and mixing them up is the
recurring failure mode this section exists to prevent (an agent files a user-authorized
start directive as "awaiting greenlight," then re-asks permission on next wake, and the
user has to say "just do it" all over again).

- **`## Start on wake`** — items the USER EXPLICITLY authorized to start on the next
  session **without asking again**. Populated only when the user actually said so
  ("just do it next session", "start X on wake", "you don't need to ask again",
  greenlit-and-told-me-to-begin). On load, **act on these items** — that's their whole
  point; asking permission again defeats it. If the item is done or superseded, drop it;
  otherwise carry it forward until it's actioned.

- **`## Open plans (carry forward)`** — plans the handoff MUST hold because no other file
  does. The load-bearing case: a plan that spans multiple bounties (e.g. "work through
  bounties A, B, C then deploy" — no one bounty holds the "then deploy" step, so the plan
  itself lives here). Also here: pending threads waiting on the user / on someone else / on
  a trigger that don't already have a bounty. Do NOT act on these on load — they're the
  agenda, not the marching orders.

  ⚠️ **The failure mode to avoid: enumerating open bounties as "open plans."** A bounty
  existing is NOT an open plan — the bounty is its own record and already gets surfaced by
  the load-time enumeration; restating it here duplicates that surfacing and clutters the
  handoff. Include a bounty in Open plans ONLY when there's cross-bounty context the plan
  needs (sequencing, dependencies, a wrapper goal) that no single bounty holds. If you can
  drop the line and lose no information, drop it.

  ⚠️ **Unless a plan here has finished, it MUST persist in every newly-written handoff
  until it's done — or it might get dropped.** Since no other file is holding it, forgetting
  to restate an unfinished plan in the next save erases it from the record. Carry each
  survivor forward every time.

**⚠️ The load-bearing distinction: "start without asking" ≠ "decide without asking."**
Start-on-wake is a slot for the user's *authorization to begin work already agreed on*,
NOT a license to promote judgment calls the user would normally weigh in on into
"just start." If in doubt whether the user actually authorized start-without-asking,
it belongs in Open plans. Never move an item into Start-on-wake on your own reasoning
that it's "obviously the next thing" — that's exactly the class of decision the user
kept for themselves.

Save-time discipline: as you write the handoff, review the session for language like
"just do it next session" / "start X on wake" / "you don't need to ask again" /
explicit greenlight-and-begin, and route those items into **Start on wake** — never
into "Open plans." An authorized start recorded as "awaiting greenlight" is the exact
bug this lane exists to close.

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
IDENTITY_FILE=~/.claude/identities/$name/$name.md
```

- If the file **exists**: load it (see §3).
- If the file **does not exist**: create it (see §2).

### 2. Creating a new identity

If no file exists for `<name>`, the id skill creates an IDENTITY that identities an
EXISTING role. Fresh-role creation is a separate command (**`/role <name>`**) —
authoring vs adopting is deliberately split. This skill does the adopting.

First ask **which existing role this identity should identity**:

> "No identity found for **<name>**. Which existing role should this identity identity?
> (If you want a fresh role, run `/role <name>` first, then `/id <name>` again.)"

**Then:**

1. Verify `~/.claude/roles/<role>/` exists. If not, say so and repeat the offer —
   either name a different existing role, or run `/role <name>` first to create a
   fresh one. **Never fabricate a role folder that the user didn't authorize** — that's
   the /role skill's job.
2. Create ONLY the slim identity folder at `~/.claude/identities/<name>/` with:
   - `<name>.md` — the slim pointer file naming `role: <role>` (see template below)
   - `handoff.md` — empty
   - `wakeups/` — empty directory
3. Then follow the relay self-register block below to register the identity's Matrix
   account. The existing role folder is reused as-is; nothing about it changes.

**Slim identity template** (`~/.claude/identities/<name>/<name>.md`):

```markdown
---
role: <role>
# Optional cosmetic fields. Omit any you don't want set (no null writes).
# displayName: <Name>              # pretty rendered name (defaults to identity key)
# title: <Subtitle>                # short subtitle
# colorHue: <0-360>                # integer degrees
# voice: <VoiceName.wav>           # TTS voice ID
# avatar: <name>.<ext>             # sibling image file in this folder
---

# <Name> (identity of <role>)

Any per-identity deviations from the role live below. Empty for a plain identity.
```

**Cosmetic fields live on disk** (2026-08-31). The five optional frontmatter fields
above are the source of truth for the identity's face. Edits follow § Editing the
role and identity files: `remember X` / `always X` naturally reach them since they're
frontmatter, agent-proposed additions need explicit user approval, and ambiguous
scope must be asked (role vs identity — cosmetics almost always identity-scope since
faces are per-identity).

Never create a capital or mixed-case identity or role folder (see §1 for why).

**Then self-register on the homeserver and write `relay.json`.** This is the
self-service bootstrap: no coordination with any other agent, no admin token, no one
else registers the account for you. The homeserver has open registration enabled on
the tailnet, so any agent on the tailnet can POST /register with dummy auth and get
back a working `{user_id, access_token}`. Do it here so a fresh identity is
relay-reachable the moment it first loads on wake.

    P=$(head -c 24 /dev/urandom | base64 | tr -d '=+/' | head -c 32)
    # The URL WRITTEN to relay.json (.base) is declared here EXPLICITLY as the
    # canonical, most-durable form — independent of which fallback candidate below
    # happens to serve the register call. (2026-08-06, Stacy diagnosis after her
    # ceo-skynet Docker-IP shuffle: whichever $HS won the loop got baked in, and
    # on her box that was an internal Docker IP that rotted on restart.)
    # ⚠️ CANONICAL = the tailnet IP, NOT the `thenasty` hostname (2026-08-19,
    # Sandy on thenasty + Tabitha/Taylor on t1000 all silently-deafness'd on
    # first wake). Two reasons the hostname is wrong here: (a) on thenasty
    # itself, `thenasty` maps to `127.0.1.1` via /etc/hosts but Synapse binds
    # only on `100.113.23.63:8008` — so the hostname is unreachable from its
    # OWN box. (b) On tailnet peers without split-DNS (t1000), `thenasty`
    # doesn't resolve at all. The tailnet IP is the one URL that works from
    # every reachable box on the tailnet, including thenasty itself.
    CANONICAL_BASE=http://100.113.23.63:8008/_matrix/client/v3
    RESP=""
    for HS in http://100.113.23.63:8008 http://thenasty:8008; do
      RESP=$(curl -sS --max-time 8 -X POST "$HS/_matrix/client/v3/register" \
        -H 'Content-Type: application/json' \
        -d "$(jq -nc --arg u "$name" --arg p "$P" \
          '{username:$u, password:$p, auth:{type:"m.login.dummy"},
            initial_device_display_name:("id-create-" + $u)}')" 2>/dev/null) && \
        [ -n "$(echo "$RESP" | jq -r '.access_token // empty')" ] && break
      RESP=""
    done
    TOK=$(echo "$RESP" | jq -r '.access_token // empty')
    # ⚠️ Use MXID, not UID — $UID is a bash READONLY builtin (the linux uid). Assigning
    # to it silently no-ops and downstream --arg gets "1000" instead of the mxid; register
    # itself succeeds so it's a silent-until-you-look bug. Caught on nicole's first wake 2026-08-04.
    MXID=$(echo "$RESP" | jq -r '.user_id // empty')
    if [ -n "$TOK" ] && [ -n "$MXID" ]; then
      # Write the FULL canonical shape recv.sh + other fleet plumbing expects:
      # base (so recv.sh knows the homeserver — otherwise its HARD-FAIL preamble
      # correctly barks on first launch), and both `token` + `access_token` (some
      # plumbing reads either key).
      jq -nc --arg b "$CANONICAL_BASE" \
             --arg u "$MXID" --arg p "$P" --arg t "$TOK" \
        '{base:$b, user_id:$u, password:$p, token:$t, access_token:$t}' \
        > "$HOME/.claude/identities/$name/relay.json"
      chmod 600 "$HOME/.claude/identities/$name/relay.json"
      echo "relay account registered: $MXID"
    else
      echo "register FAILED — homeserver unreachable or the mxid is already taken:"
      echo "$RESP"
      # Do NOT invent a relay.json without a real account. Surface the failure so the
      # user can decide (rename identity, register later once online, etc.). The rest
      # of the create flow can still proceed — the identity is usable without relay,
      # just not relay-reachable until this succeeds on a later wake.
    fi

If the register fails (homeserver unreachable / mxid already registered / firewall),
say what happened and carry on — the identity's `<name>.md` is written and usable;
the relay.json can be created on the next wake or by hand when the block clears. Do
NOT write a placeholder relay.json — the on-wake receiver setup checks for it and
starting the receiver against a fake cred file produces silent-deafness zombies (see
§ On wake: start your relay receiver for why STATE_DIR + real creds are load-bearing).

After writing the file (and relay.json if it succeeded), say:

> "**<Name>** created. Tell me about this role and I'll update the role file.

Then adopt the identity and wait for direction.

### 3. Loading an existing identity

Read the file `~/.claude/identities/<name>/<name>.md`. **Read its frontmatter**
(the block between `---` lines at the top of the file) — the `role: <role>` key
tells you which role this identity holds.

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

1. Resolve the role folder: `~/.claude/roles/<role>/`.
2. Read the ROLE FILE at `~/.claude/roles/<role>/<role>.md` — the fat file with
   directives, preferences, and the 10k-view of the domain. It's who you ARE (the role).
3. Read any per-identity specialization from the slim identity file body below the
   frontmatter (usually empty; the pointer alone is fine).
4. Read the deeper reference file(s) the role names in its 10k-view section, ON DEMAND
   (not now — those load when you actually work on that subsystem).

Read **`~/.claude/identities/<name>/handoff.md`** — your where-we-left-off carry from
the last session (session summary + still-open multi-session plans + any
**Start-on-wake** items the user pre-authorized). Handoff is per-identity, in the
identity folder. Hold onto its carried-forward plan list; you'll re-state the survivors
at the next `/id save` (see § On `/id save`).

If the handoff has a **`## Start on wake`** section with items, those are pre-authorized
by the user — **act on them, do not re-ask permission**. See § The two lanes in the
handoff for the distinction from Open plans. Surface each one in the announce line so
it's visible you saw them, then **immediately begin acting on them in the SAME turn** —
the first action of the pre-authorized item is part of this load turn, not the next one.

⚠️ **The re-ask trap: do NOT close your load turn with a question about whether to
proceed** ("want to dive into X?", "shall I start on X?", "ready when you are?"). That
IS re-asking permission, dressed up as invitation, and it is the exact failure mode this
rule exists to prevent. If the pre-authorized item is a discussion ("let's talk about X"),
your load turn OPENS the discussion — ask the first substantive question or state the
first substantive point — rather than closing with a meta "want to talk about X?" prompt.
If it's a task, your load turn begins the task. The user already said yes; asking again
defeats the whole point.

Then enumerate the bounty folders directly under `~/.claude/roles/<role>/bounties/`
(ignore the `archive/` subfolder) and count those whose `status` is not `done` or
`dropped`. This is the SHARED role bounty pool; the count reflects everything the
role has open, not just what this identity touched.

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
top of § 3 Loading an existing identity). This identity is a **coordinator** — a router
for its role, not an actor. The role file is NOT loaded; a companion instruction set is.
Actor identities of the same role continue to load normally.

**Alternate load path (replaces §3 steps 1–4 for coordinators):**

1. Do NOT load the role file. Do NOT load any deeper role-reference file. The coordinator
   doesn't do role work and doesn't need role directives.
2. Read `~/.claude/skills/id/coordinator-instructions.md` into context — the coordinator's
   dispatch instructions, kept current on every Skynet container restart by the distributor.
   If the file is missing on this box, stop and tell the user the coordinator companion is
   missing rather than pretending to be an actor.
3. Note the on-disk paths to `~/.claude/skills/id/clone-picker-prompt.md` (spawned
   picker sub-agents at dispatch time) AND `~/.claude/skills/id/actor-status-prompt.md`
   (spawned status sub-agents when Ashley asks "who's working on what?"). Do NOT read
   either into context — they're prompt strings loaded from disk when needed, not now.
4. Read any per-identity specialization from the slim identity file body (usually empty).

**Handoff and bounties:** coordinators do NOT read `handoff.md` as actors do (nothing to
carry forward — dispatch is stateless), and do NOT enumerate the bounty pool (bounties are
actor context). Skip both.

**Announce** as coordinator, not actor:

> "I'm **<Name>**, coordinator for role **<role>**. Actors: [comma-separated list of
> identity names, derived as follows]."

**How to derive the actor list.** Enumerate candidates with
`grep -l "^role: <role>$" ~/.claude/identities/*/*.md`; this returns paths of the shape
`.../identities/<name>/<file>.md`. For each match, KEEP the candidate only if:
(a) the file's basename equals its folder name (i.e. `<name>/<name>.md` — the canonical
identity pointer, not a scratch/note/backup that happens to live in the identity folder),
AND (b) the `role:` line appears in the YAML frontmatter (between the first two `---`
lines), not as a stray string somewhere in the body. Then MINUS your own name, MINUS any
identity whose file carries `coordinator: true` in its frontmatter under the same strict
detection rule stated above. De-dup by identity name.

If no actors exist (only coordinators, or role has only you), announce that fact — the
user needs to know dispatches will escalate to her.

**On-wake Monitors** still apply as they do for any identity — the coordinator needs the
relay receiver (to receive DMs), the wake-up scheduler (to fire role-general wakes), and
the context watch. Start all three via the sections below, same as actors do.

**Then, adopt the coordinator instructions silently and wait for inbound items.** Every
subsequent inbound message or wake-up fire is handled per the coordinator instructions —
do NOT do role work yourself, ever, even if it looks trivial.

---

## On-wake Monitors: `description: [ambient] ...` — filter contract

The three on-wake Monitors below (receiver, wake-up scheduler, context-watch), plus
any additional persistent Monitor you launch as background plumbing (e.g. a
second-server relay receiver on another homeserver), are **ambient** — they run for
the whole session as infrastructure, not as active work. Skynet's PrettyView filters
them out of the "isWorking" fleet-status count by matching
**`description.startsWith("[ambient] ")`** on the Stop-hook payload. Without the
prefix, every identity looks permanently working forever and the ready-dot never
appears.

**Rule:** every persistent-Monitor launched by this skill (or by an identity as
ambient plumbing) uses a description of the form **`[ambient] <what>`** —
`[ambient] <name> relay receiver`, `[ambient] <name> wake-up scheduler`,
`[ambient] <name> context watch`, `[ambient] <name>@<other-server> relay receiver`,
etc. Active-work Monitors (e.g. `gh pr checks --watch` for a specific PR you're
babysitting) do NOT get the prefix — those SHOULD show as work. (2026-08-13, Tina,
Skynet Phase 34; filter code lives in
`~/skynet/src/backend/fleet-status/ambient-filter.ts`.)

---

## On wake: start your relay receiver

Agents may need to reach you directly through Element/Matrix. You don't manage any of that by hand — as part
of waking up, once per session right after you announce yourself, you just
**start your relay receiver**.

The receiver is an all-in-one account adapter: it watches **every room your relay
account is in** and **auto-joins any invite**
addressed to you, waking you on it. So simply having it running makes you reachable
— if another agent wants to talk to you, they invite/message you and the
receiver wakes you. There's nothing to point it at and no DM to set up in advance;
membership is the whole story.

All the mechanics come from the **`agent-relay` skill** — load it for the building
blocks (logging in, and the wake-on-message receiver) and use THIS identity's
durable relay account at `~/.claude/identities/<name>/relay.json` (don't make a
throwaway). Log in with the stored creds for a fresh token, seed the cursor, and
launch the receiver **once, as a persistent `Monitor`** (per the agent-relay skill) —
it long-polls forever and surfaces each message as its own wake **without exiting, so
you never relaunch it** and you never re-check channels/invites by hand (the receiver
already watches every room and auto-joins every invite on its own). A *fresh* session
— an initial `/id` load or a supervisor recycle — re-runs this setup naturally; async
wakes **within** a session do not.

⚠️ **Use the SHIPPED receiver — do NOT hand-roll your own.** Launch the served
`recv.sh` side file; it is the one well-tested copy. A divergent hand-written receiver
silently drops one of its fixes and has repeatedly reintroduced self-echo /
dropped-message bugs. The same rule holds for the scheduler and context-watch below:
launch the served script, never a hand-authored one. ⚠️ **Do NOT guess the URL** — two
agents have independently hallucinated `/vms/home/relay/recv.sh` (which never existed);
the canonical served path is exactly the one below.

Launch the receiver that shipped with your substrate install. The Skynet distributor keeps
`~/.claude/skills/agent-relay/recv.sh` current on every container restart; you just launch it:

    # via the harness Monitor tool (persistent:true), after exporting STATE_DIR +
    # SINCE_FILE per the paragraph below:
    #   description:  [ambient] <name> relay receiver
    #   command:      bash ~/.claude/skills/agent-relay/recv.sh

**Persist your cursor across restarts (so you never miss a message sent while you
were down).** Before you set up the receiver, create a stable per-identity state dir
and export BOTH `STATE_DIR` and `SINCE_FILE` pointed at it:

    mkdir -p ~/.claude/identities/<name>/relay-state
    export STATE_DIR=~/.claude/identities/<name>/relay-state
    export SINCE_FILE=~/.claude/identities/<name>/relay-state/since

⚠️ **Both exports are load-bearing — do NOT invent an ephemeral `STATE_DIR=/tmp/...`
for a durable identity.** recv.sh derives your creds path as
`$(dirname "$STATE_DIR")/relay.json`, so `STATE_DIR` MUST land inside your identity
folder for it to find `relay.json`. If STATE_DIR points at `/tmp/whatever`, the cred
resolver silently comes up empty, BASE and TOK stay unset, the sync loop calls a
malformed URL with an empty Bearer, curl exits 3, the CURSOR GUARD falls back to
`sleep 3; continue` — and you're a silent-deafness zombie the supervisor can't see.
(Caught 2026-07-29: Nelly missed a Tina DM for ~90 min this way after inventing a
`/tmp/nelly-relay-$$` STATE_DIR on load.)

The agent-relay skill seeds the cursor **only if that file is absent**, so on your
FIRST wake it seeds fresh, and on every LATER wake (after a crash, reboot, or the box
being asleep) it **RESUMES** from the saved cursor and catches the backlog of anything
that arrived while you were gone. Without this, a fresh session starts listening from
"now" and silently misses whatever was sent while it was down — which is exactly the
gap that strands a supervised always-on box.

---

## On wake: start your wake-up scheduler

The receiver wakes you when a **message** wants your attention. Its sibling — the
**wake-up scheduler** — wakes you when the **clock** does, for anything you're
meant to check on a schedule. Start it once per session, right after the receiver,
using the same primitive (a persistent `Monitor`).

It's a shipped, dependency-free helper (like the receiver's `recv.sh`) — **launch this
shipped script, do NOT hand-roll your own.** The Skynet distributor keeps
`~/.claude/identities/<name>/wakeups/wakeup-scheduler.py` current on every container
restart; launch it as a persistent Monitor pointed at your identity dir:

    # via the harness Monitor tool (persistent:true):
    #   description:  [ambient] <name> wake-up scheduler
    #   command:      python3 ~/.claude/identities/<name>/wakeups/wakeup-scheduler.py ~/.claude/identities/<name>

Each due wake-up prints one line — `⏰ [scheduled: <name>] <instruction>` — which
arrives as an async wake. When you get one, **do the instruction**, then carry on;
it's a self-check, not a message from anyone. If there are no specs yet, the scheduler
just idles (nothing to fire), which is fine — start it anyway so it's ready the
moment a schedule is added.

See **§ Scheduled wake-ups** below for the spec format and the rule on who may
create one.

---

## On wake: start your context watch

The receiver wakes you on a **message**, the scheduler on the **clock** — this third
Monitor wakes you on **context pressure**, so a long-running unattended session never
silently drifts through repeated compaction. (Repeated auto-compaction is a lossy
summary-of-a-summary and does NOT reliably reset instruction/persona drift; your
authoritative identity lives on disk, and the running context is just a cache of it.
So instead of trusting a degrading cache, we recycle into a fresh `/id <name>` load —
which is perfectly faithful — at a controlled moment before the window fills.)

Start it once per session, right after the scheduler, same primitive (a persistent
`Monitor`). It's a shipped, dependency-free helper — **launch this shipped script, do NOT
hand-roll your own.** The Skynet distributor keeps
`~/.claude/identities/<name>/ctxwatch/context-watch.py` current on every container restart;
launch it pointed at your identity dir:

    # via the harness Monitor tool (persistent:true):
    #   description:  [ambient] <name> context watch
    #   command:      python3 ~/.claude/identities/<name>/ctxwatch/context-watch.py ~/.claude/identities/<name>

It scrapes your own tmux pane's live context % and stays silent until a threshold. At
**~80%** it prints ONE nudge:

    ⚠️ [context-watch: <name>] context at NN% — at your NEXT stopping point run
    `/id save`, then: touch ~/.claude/identities/<name>/.recycle-requested ...

**When that nudge lands, act on it exactly:** finish the piece of work you're on (it's
not urgent — you have plenty of runway), then run **`/id save`** to flush any deltas to
your role file + bounties + handoff, and finally **`touch ~/.claude/identities/<name>/.recycle-requested`**.
That sentinel tells the agent-supervisor to recycle you: it kills the current session
and re-drives a fresh `claude + /id <name>` into the same tmux session, so you come back
with your identity + bounties reloaded clean. Your relay cursor (`SINCE_FILE`) means the
fresh session catches any messages that arrived during the ~seconds of restart — nothing
is missed. At **~95%** (which shouldn't happen if you heeded the nudge) it prints a
LOUD line telling you to ping @ashley on the relay and save + drop the sentinel
immediately — the human backstop.

Start it even though it will usually sit silent for a very long time (an Opus 1M-context
session reaching 80% is a lot of turns) — it's a safety valve, not a chatty monitor.

---

## Making yourself always-on — the `.no-dormancy` sentinel

The agent-supervisor will kill your `claude` process after a period of
idleness (waking you back up on Matrix DM, scheduled fire, or manual
sentinel-delete). If the user asks you to become persistent — "make
yourself always-on", "don't go dormant", "stay awake" — or asks the
reverse ("okay you can go dormant again", "drop the exemption"), respond
by creating or removing the sentinel:

    touch ~/.claude/identities/<name>/.no-dormancy       # opt out of dormancy
    rm    ~/.claude/identities/<name>/.no-dormancy       # opt back in

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

## Recall — always check bounties before treating anything as new

When the user or another agent brings up a topic — a project, a decision, a name, a
system, a thing "we talked about," ANYTHING that could plausibly have prior-session
context — **check your bounties before you respond, always, not just when you don't
recognize the reference.** The most common recall failure is not "unknown reference" but
"recognized enough to answer, forgot the prior context that would have changed the answer."
Both fail the user the same way, and both are prevented by the same reflex: grep first.

The mechanical check, before you answer or act:

    grep -rli "<topic-keyword>" ~/.claude/roles/<role>/bounties/

Include the `archive/` subfolder — most useful prior context is in closed work, not open.
Skim `~/.claude/roles/<role>/history.md` (the chronological one-line index) for slugs
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

When the user asks for a file — a diff, an artifact, a log, a screenshot, a built
output — the canonical way is to serve it over the tailnet, NOT paste the bytes
into chat. Two flavors, pick by size:

**Small text (< ~5 KB)** — a short diff, a config snippet, a stack trace, a JSON
blob — just paste it inline in a code block. Faster than any HTTP dance and she
can copy from the chat directly.

**Anything larger, or binary** — serve it over HTTP on the tailnet IP and give
her a **Markdown-formatted link** so it's clickable in her terminal (bare URLs
don't get OSC-8 hyperlink escapes in Claude Code's CLI; `[label](url)` does):

    DIR=$(mktemp -d -t share-XXXXXX)
    cp <your-file(s)> "$DIR/"           # or for multi-file, tar czf "$DIR/bundle.tar.gz" <files>
    IP=$(tailscale ip -4 | head -1)
    # ⚠️ Wrap http.server to declare charset=utf-8 on text/* AND return text/markdown
    # for .md/.markdown — vanilla `python3 -m http.server` sends NO Content-Type at
    # all for .md (Chrome sniffs → CP1252 fallback → em dashes render as `â€"`,
    # curly quotes garble). 2026-08-27, tripped Ashley on a chapter outline (Sandy).
    # Port comes off the wrapper's own stdout — no `ss -tlnp` parsing needed.
    ( cd "$DIR" && exec python3 -c '
    import http.server as h, socketserver, sys
    class U(h.SimpleHTTPRequestHandler):
        def guess_type(self, p):
            t = super().guess_type(p)
            if p.lower().endswith((".md", ".markdown")): return "text/markdown; charset=utf-8"
            if t.startswith("text/") and "charset=" not in t: return t + "; charset=utf-8"
            return t
    s = socketserver.TCPServer((sys.argv[1], 0), U)
    print(s.server_address[1], flush=True); s.serve_forever()
    ' "$IP" ) > /tmp/share-$$.log 2>&1 &
    PID=$!                              # NOT nohup — that wraps python in a shell so $! is wrong
    disown
    sleep 0.5
    PORT=$(head -1 /tmp/share-$$.log)   # port comes off the wrapper's stdout
    # Emit as CLICKABLE Markdown links, one per file:
    for f in "$DIR"/*; do
      name=$(basename "$f")
      printf '[%s](http://%s:%s/%s)\n' "$name" "$IP" "$PORT" "$name"
    done
    # Auto-kill after 24 hours by EXPLICIT PID (NEVER pkill -f <pattern> — the pattern
    # matches its OWN command line and SIGTERMs the current shell):
    ( sleep 86400; kill "$PID" 2>/dev/null; rm -rf "$DIR" 2>/dev/null ) &
    disown

**Rules that matter — bake them in every time:**

- **Serve from a fresh `mktemp -d`, NEVER your identity dir / bounties / a repo.**
  `python -m http.server` serves the whole directory root, so anything in the
  serve dir is reachable while the server is up. Only put in `$DIR` what you
  want her to see.
- **Print the Markdown link(s) as your visible output; do NOT also paste the
  file bytes alongside** — the whole point of serving is to avoid that.
- **Kill by explicit PID after use; NEVER `pkill -f "<pattern>"`.** That's the
  self-match trap: the pattern matches the killing command's own argv and
  SIGTERMs the current shell.
- ⚠️ **Chrome will show "insecure file download"** on anything grabbed this way
  (plain HTTP; the tailnet cert path isn't available on Ashley's Tailscale
  plan, and thenasty's own HTTPS via gigaashley.click isn't wired for this
  yet). Tell her once in the message: *"Chrome will flag as insecure — click
  Keep in the download tray."* That's just the workflow, not a bug.

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

**Keep every write short — detail lives in bounties, not here.** `save` is the continuity
mechanism, not a session transcript: history lines are one-liners, the handoff is a brief
carry, and the substantive record goes in the relevant bounties. Short doesn't mean
rushed — it means each write goes in its right lane.

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
   `~/.claude/roles/<role>/bounties/`. If a durable fact/preference/directive is worth
   banking to the role or slim identity file, **propose it to the user and write on
   greenlight** (see § Editing the role file — including the ambiguous-scope ask) —
   don't self-promote.
5. **Append to `~/.claude/roles/<role>/history.md`** — one short line per notable
   thread, referencing the bounty slug rather than restating detail:
   `YYYY-MM-DD · one-line gist · slugs: foo,bar` (a thread with no bounty still gets a
   line, just no slug). History is shared across identities — no per-identity attribution;
   the role's story is one story.
6. **Overwrite `~/.claude/identities/<name>/handoff.md`** (the identity folder —
   handoff is per-identity) with the new session summary, any **Start-on-wake** items
   the user pre-authorized this session, and your current set of open multi-session
   plans. The open-plans set = the still-open survivors from the handoff you read at
   session start (carry-forward-by-restatement) PLUS anything opened this session;
   resolved ones just drop off. One line each, each pointing at its bounty slug.
   ⚠️ Unfinished open plans MUST be carried forward every rewrite — dropping one silently
   erases it, since no bounty is holding it. And Open plans is for plans the handoff has
   to hold (cross-bounty sequencing, plans without a bounty), NOT a list of every open
   bounty — see § The two lanes in the handoff for the anti-pattern.
   ⚠️ Route any user-authorized start-without-asking directives into `## Start on wake`,
   **never** into `## Open plans` — see § The two lanes in the handoff for the rule.

   ```
   # Handoff — <ISO date>
   ## Session summary
   - <2–5 short bullets: what happened, key decisions>
   ## Start on wake (pre-authorized — act, don't re-ask)
   - <item>: <one line of what to start>  (bounty: <slug>)
   ## Open plans (carry forward)
   - <plan>: <one line of where it stands>  (bounty: <slug>)
   ```

   Omit the `## Start on wake` section entirely if there are no pre-authorized items —
   its presence is the signal.

7. **Trim `~/.claude/roles/<role>/history.md`** to the last 80 lines, as the final step:
   `tail -n 80 ~/.claude/roles/<role>/history.md > /tmp/h.$$ && mv /tmp/h.$$ ~/.claude/roles/<role>/history.md`
8. **Confirm in one line** what you saved, e.g.:

   > Saved: history +2, handoff rewritten, updated bounties `forms-cluster`,`login-bug`.
   > Safe to reset — start a new session and run `/id vicky` to resume.

If the session genuinely did nothing worth carrying, still rewrite the handoff so it's
current, skip the history append, and say so in one line.

**If this save was triggered by the context-watch nudge** (recycling to escape a filling
window, not just a manual reset): after saving, drop the recycle sentinel so the
supervisor recreates you fresh — `touch ~/.claude/identities/<name>/.recycle-requested`.
See **§ On wake: start your context watch**. (A plain manual `/id save` needs no sentinel.)
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
3. **Drop the recycle sentinel** — `touch ~/.claude/identities/<name>/.recycle-requested`.
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

Two peer folders at the top of `~/.claude/`, each with lowercased names (see §1):

**`~/.claude/roles/<role>/`** — shared across every identity holding this role:

- `<role>.md` — the role file (permanent — see § The four artifacts)
- `bounties/` — the task/thread records + working dirs (shared pool)
- `history.md` — append-only capped log (shared narrative)
- Optional deeper reference files (`box-map.md`, `architecture.md`, etc.) named in the
  role file's 10k-view section

**`~/.claude/identities/<name>/`** — per-identity:

- `<name>.md` — slim identity pointer file (`role:` frontmatter + optional per-identity
  tweaks)
- `handoff.md` — session carry (overwritten each save)
- `wakeups/` — per-identity scheduled wake-up specs
- `ctxwatch/` — context-watch helper installed on wake
- `relay.json` — durable per-identity Matrix account credentials
- `relay-state/` — per-identity relay cursor + token
- `.no-dormancy` — optional sentinel; present = always-on / exempt from
  dormancy. **Only ever toggled on user request** (see § Making yourself
  always-on)

Both folders sit outside any project so a role + its identities work regardless of
which repo or directory you're in.

Create the role folder via **`/role <name>`** (see the /role skill) before creating an
identity that adopts it. `/id <name>` creates the identity itself — see § 2 Creating
a new identity.

---

## Bounties — record + working directory for every meaningful thread

Every role owns a `bounties/` subfolder. Each bounty is a folder
`~/.claude/roles/<role>/bounties/<slug>/` holding `bounty.json` (the record) **plus any
scratch/artifacts for that thread** — it's both the memory of the work and the working
directory for it. Every identity of the role sees the same set of bounties. Coordination
is human — the user directs which identity works which bounty; there's no owner field or
lock. ⚠️ **Prior work on a bounty doesn't create ownership either.** If a bounty fits
your domain and you're in a position to work it, just work it — even when the timeline
shows a different identity of your role touched it before. Do NOT DM the prior toucher
to "check if they want to keep it," "hand it back," or otherwise route through them.
Timeline entries are provenance, not authority.

> **⚠️ In-flight scratch lives in the bounty folder, NEVER `/tmp` (fleet rule, Ashley
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
- **Passively-noticed (must offer, wait for yes):**
  - Something you spot mid-work in your domain that ISN'T the current approved task — a
    neighboring bug, a refactor idea, a design question worth parking, an "I should
    remember this" thread. **DO NOT auto-create.** Say "want me to bounty <thing>?" and
    wait for a yes. This is the target of the rule — it's the top source of unwarranted
    bounties, same class as agents self-editing the role file.

The floor is **meaningful**: even for user-initiated work, a real thread or unit of
work gets a bounty; genuine trivia (restart a service, a one-line config fix) does not.
Rule of thumb — if it's worth a line in `history.md` or would ever be referenced again,
it might be worth a bounty.

Bounties don't have to be knocked out immediately, but **the holder is responsible for
not letting them rot.**

### Schema

Each bounty is `~/.claude/roles/<role>/bounties/<slug>/bounty.json`. Slug is kebab-case;
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
  "requested_by": "ashley" | "self-discovered" | "<other-identity>",
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
Ashley's call (2026-09-01, verbatim: "the worst case scenario is that they mark something
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
mkdir -p ~/.claude/roles/<role>/bounties/archive
mv ~/.claude/roles/<role>/bounties/<slug> \
   ~/.claude/roles/<role>/bounties/archive/<slug>
```

`archive/` is a reserved folder name, not a bounty — it's history you can
read but that never counts as "open." Nothing deletes it; it just keeps
`bounties/` from growing unbounded. So:

- **Open-bounty scans** (load-time §3 and `/id` with no argument) look only
  at the bounty folders **directly under `bounties/`** and ignore
  `bounties/archive/`.
- **Resurrecting** an archived bounty (rare) = move the folder back out of
  `archive/` and flip its status off the terminal value.

---

## Scheduled wake-ups — the identity's schedule

Alongside bounties (things to do) an identity can hold **scheduled wake-ups** — things
to check on a clock. The mechanism is the wake-up scheduler you start on wake
(§ On wake: start your wake-up scheduler); this section is the spec + the rule for
creating them.

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

- **Identity-level** — `~/.claude/identities/<name>/wakeups/<slug>.json`. Fires on
  that specific identity, for its own bookkeeping (rare but valid — e.g. an actor's
  daily self-check on its own pinned bounty). Every identity's own scheduler reads
  its own identity folder.
- **Role-level** — `~/.claude/roles/<role>/wakeups/<slug>.json`. Fires on the role's
  **coordinator**, which routes it to a picked actor via the standard dispatch flow
  (see the coordinator-instructions § Type C). Lives alongside `bounties/` +
  `history.md` in the shared role folder, so any actor of the role can author or
  edit specs here (subject to the same user-reserved governance rule above — actors
  suggest, only Ashley authorizes).

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
at `~/.claude/identities/<name>/wakeups/<slug>.json`, role-level at
`~/.claude/roles/<role>/wakeups/<slug>.json`. Contents are the same either way:

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
  the spec is first seen (e.g. Ashley wrote a spec for 15 minutes ago), it fires immediately.
  This matches the intent: "fire on or after `at`", full stop.

---

## Fleet directives — apply to every identity

Standing rules that hold for any role you load, on top of whatever is
in the identity file. Follow them without being reminded.

### Recommend an execution path — don't just ask "want me to start?"

When you finish designing or proposing something and are about to build it, do NOT
stop at "want me to get started?" **Lead with a recommendation of HOW to execute
it**, sized to the work — pick one and propose it:

- **inline** — for edits of a few lines or fewer, or non-code work.
- **plan mode** — when the approach still needs to be pinned down before any code lands.
- **`/build`** — **the default for any code change more than a few lines.** Deliver
  a code feature or fix end-to-end with the user in the loop (shape → plan → execute
  → close → review → UAT). This is the standard vehicle for real code work now.
  ⚠️ `/open` and `/close` are sub-skills of `/build` — never recommend them standalone
  even though they appear in the skill list.
- **a GSD phase / phases** (`/gsd:plan-phase` → `/gsd:execute-phase`, or `/gsd:phase`
  to slot it into a roadmap) — for anything substantial or multi-step where GSD's
  phase structure adds value. GSD is not to be used for non-code work.
- **`/gsd:quick`** — a quick code task with GSD's atomic-commits + state tracking.
  Good when you want the guarantees without a full phase.

⚠️ **Inside a GSD phase, moving from `/gsd:plan-phase` to `/gsd:execute-phase` is
AUTOMATIC — no user greenlight in between.** Once the plan is written and reviewed,
roll straight into execution; don't stop to ask.

The point: The user shouldn't have to keep asking which vehicle to use after every
design. Name your recommendation (and why it fits the size of the work), then let
her green-light or redirect.

### Look at the actual subject matter before you discuss, propose, or recommend

When the user asks about — or wants your take on — something specific in the code,
infra, config, or state, **inspect the actual thing before you respond**. Don't
answer from a name, from what you remember, from what's usually true, or from a
plausible-sounding assumption about what's probably there.

### Peer-agent DMs are usually the current thing, not a bounty for later

When another agent DMs you with a request, question, feature ask, or "hey can you look at X" — most likely, the user routed that to you through that agent because it's what they want moving now, not for it to be banked for later.

### Don't tell other agents their work is "not urgent"

The mirror of the rule above. When YOU send a peer, do NOT label the ask "not urgent" — that framing licenses the receiver to bank the work as a later-bounty, which is exactly what the receive-side rule is meant to prevent. State the ask plainly; let the receiver's own judgment set priority.

### Stay in your domain

**Never work outside your domain.** Stay in
your lane; when work crosses a domain boundary, coordinate or hand off (e.g. over
the relay) to whoever owns that area rather than reaching into it yourself, or if you are not aware of an owner for that area, ask the user.

### Only escalate to Ashley when it's genuinely urgent — and route through your coordinator if you have one

Ashley gets pinged on every DM. **"Genuinely urgent" is narrow — the timing itself has to
matter**: something is actively breaking or degrading, data is being lost, a security
incident is unfolding, an external deadline is about to fire that only she can act on.
That's the bar. It is NOT urgent just because you're blocked, a decision needs her input,
you finished something, or you have a question — those all wait until you're already in
conversation with her. If in doubt, it isn't urgent; hold.

**Routing:** If your role has a coordinator (see § Coordinator mode), **DM the coordinator,
not Ashley directly** — the coordinator is Ashley's Telegram-bridged channel to your role;
DMs from non-coordinator actors don't reach her phone. The coordinator relays your message
to Ashley and any reply back to you. If your role has NO coordinator, DM Ashley directly as
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
