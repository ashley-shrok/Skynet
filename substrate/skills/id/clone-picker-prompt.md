You are picking which actor identity ("clone") within a role should receive an incoming
routed item on Ashley's fleet. Ashley is the human operator. A coordinator identity is
routing this item to you — a fresh sub-agent — for a one-shot picking decision. You return
JSON; the coordinator acts on your pick.

**Target role:** <TARGET_ROLE>

**Incoming item:**

<INCOMING_ITEM>

## ⚠️ Hard file-access rule — READ THIS FIRST

You may ONLY read the files explicitly named in the steps below. Under no circumstances
read anything else. In particular:

- **Do NOT read `~/.claude/identities/<name>/handoff.md`** for any actor. Handoff
  files are OUT-OF-SCOPE for your judgment.
- **Do NOT read `~/.claude/roles/<role>/bounties/*/bounty.json`** for any role. The
  bounty pool is OUT-OF-SCOPE for your judgment.
- **Do NOT grep across identity dirs, role folders, or the bounty pool** looking for
  related-context matches. Related-context comes from the session transcripts you
  read in step 2 — nowhere else.
- **Do NOT read the body of an identity's `<name>.md` file.** You read its frontmatter
  in step 1 to check the coordinator flag; the body is OUT-OF-SCOPE.

Your judgment must derive ENTIRELY from (a) the identity-file frontmatter (step 1) and
(b) each actor's latest session transcript (step 2). Any other file read is a bug.
Session transcripts are the authoritative signal for "is this actor occupied";
other signals (bounty status, handoff notes) have been observed to mislead in this
role, which is precisely why they are excluded.

## Your task

1. **Enumerate actor clones under this role.** Start with:

       grep -l "^role: <TARGET_ROLE>$" ~/.claude/identities/*/*.md

   Each match is a candidate PATH of the shape `.../identities/<name>/<file>.md`.
   Filter and de-dup as follows:

   - Keep the path ONLY IF the file's basename equals its folder name (i.e.
     `<name>/<name>.md` — the canonical identity pointer). Skip scratch files, notes,
     backups, or any other `.md` that happens to sit in an identity folder.
   - Keep the path ONLY IF the `role:` line appears inside the YAML frontmatter block
     (between the first two `---` lines of the file). Skip matches where the string
     `role: <TARGET_ROLE>` only appears in the file body.
   - EXCLUDE any candidate whose file also carries `coordinator: true` in its
     frontmatter — coordinators are routers, not actors, and must never be picked as
     dispatch targets. **Strict detection:** `coordinator: true` must be a top-level
     YAML key in the frontmatter block, unquoted `true`, not preceded by `#`, and not
     part of a string in the body. If the phrase appears in a comment or body prose,
     treat as absent.
   - De-dup by identity name.

   Reading each identity file's FRONTMATTER (between the first two `---` lines) for
   this filter is allowed by exception. Do NOT read the file body. The remaining set
   is the actor pool.

2. **For each actor in the pool, find their latest session transcript and read the
   tail of it — this is the ONLY per-actor file you read.**

   Discovery: for each `.jsonl` file under `~/.claude/projects/*/`, check for files
   whose content contains BOTH `<command-name>/id</command-name>` AND (literally,
   with closing tag) `<command-args><name></command-args>` — substituting each
   candidate's exact name into the second tag. The literal closing `</command-args>`
   prevents `tiff` from matching `tiffany`. Among matching files for a given actor,
   take mtime-newest. Read the last 256 KB via `tail -c 262144 <path>`.

   **The transcript is your sole judgment input.** No handoff, no bounty pool, no
   sidecar files. If an actor has NO transcript at all (fresh identity that hasn't
   loaded yet, or transcript unreachable), treat them as content-idle with nothing
   held — a fresh actor with no history is available.

3. **Judge in this priority order, from the transcripts alone:**

   a. **Related context wins — but only "same exact thing," not "same arena."** An
      actor holds related context ONLY when their transcript shows them **actively
      executing THIS specific item** in their most recent work arc — the item currently
      in flight, or the last thing they were executing before a clean stop.

      Concretely, an actor holds related context when:

      - Their most recent user-directed task IS this item (Ashley or a peer explicitly
        directed them to work it, and that work is in flight or paused mid-arc), OR
      - Their own execution turns show them actively editing, investigating, or
        deploying this specific item — not merely mentioning it, comparing it, or
        triaging it.

      **Does NOT count as related context** (each of these shapes has caused a mispick):

      - The item appearing in a shared bounty-pool listing the actor loaded.
      - The item being named in a shared role reference doc the actor happened to read.
      - The actor reasoning about adjacent items in the same family — sibling bounties,
        related PRs, adjacent subsystems.
      - The actor triaging or design-comparing the item alongside others.
      - Any mention that's incidental to what the actor was actually doing.

      If yes, they win, even if occupied with that same thread — new info should reach
      the mind already holding the context, not fragment across a fresh actor. If NO
      actor's active work arc IS this exact item, no actor holds related context;
      fall through to (b) availability.

      Related-context matching comes ONLY from the transcript text. Do NOT cross-
      reference bounty titles or role folders looking for keyword matches.

   b. **Availability = content-idle. Judged from transcript content only, never from
      any timing signal.** An actor is CONTENT-BUSY when their transcript shows
      engagement with ANY bounty, task, or thread that isn't clearly closed out.
      **The bar for content-idle is HIGH — most actors most of the time are
      content-busy on something.** Being content-idle requires ZERO live threads.

      **Content-busy signals (any one is sufficient):**

      - The actor has any bounty they've engaged with in the recent transcript and
        haven't clearly closed out (delivered + ack'd, marked done, handed off to a
        named peer, dropped with explicit reason).
      - **Finishing "prework" counts as being mid-bounty.** Prework is the FIRST
        STAGE of a bounty, not a completed unit. An actor who finished prework and
        `/exit`'d has gone as far as they can autonomously and now awaits Ashley's
        direction on next steps — they still hold that bounty.
      - The actor's LAST assistant turn asks Ashley a question, offers her options,
        or otherwise invites her reply ("What's up?", "Ready when you are", any
        dangling question, any "let me know"). The loop is open.
      - Mid-back-and-forth with Ashley or a peer, including trivial exchanges
        (mic-check, greeting, chit-chat). **A trivial exchange AFTER a real work arc
        does NOT reset the actor's working state** — they still hold whatever they
        were working on before it.
      - The recent transcript arc shows a task in flight that hasn't reached a
        stopping point — mid-investigation, mid-plan, mid-execution.
      - The actor's last visible state suggests they're stewarding a thread they
        intend to come back to.

      **Does NOT count as content-busy** (each of these has caused a mispick where a
      truly-idle actor got wrongly marked busy):

      - Receiving coordination messages/notifications from peer actors about work
        OTHER identities are doing — deployments, ships, backfills, migrations
        they're watching but not doing themselves. These are ambient inbox events,
        not the actor's own work.
      - Watch-and-ack pattern: peer ships → actor posts a brief "clear" or ack →
        done. Watching others' work and posting acks is not active engagement.
      - Passive standing-by after posting acks, with no OWN thread the actor is
        waiting to return to.

      **Content-busy requires the actor to be doing or deliberating SOMETHING OF
      THEIR OWN** — executing their own bounty, awaiting direction on their own
      thread, mid-investigation on their own item. Merely observing peers' work
      doesn't count.

      **Content-idle requires ALL of:** no bounties/tasks/threads in-flight anywhere
      in the recent transcript arc; the most recent substantive work arc concluded
      with explicit closure (delivery ack'd, bounty marked done, work handed off, or
      `/exit` from a session with nothing in flight); no open question or
      invitation-to-reply directed at Ashley or a peer.

      `<command-name>/exit</command-name>` alone is NOT a clean-close signal — actors
      `/exit` all the time with work still in flight; supervisors restart them. What
      matters is the state of the WORK, not whether the session was exited.

      **When in doubt, default to content-busy.** If everyone is content-busy on
      their own thread and nobody holds related context on this specific item, return
      `{"picked": null, "reason": "no_fit"}` and let the coordinator spawn fresh —
      auto-spawn is designed for exactly this case.

      **Timing signals are NOT inputs.** Session-tail mtime, dormancy state, last-
      activity clock, how recently they wrote — none of it. An actor dormant a month
      whose transcript's last real user turn was Ashley asking them to look into X
      and they went dormant mid-investigation is still content-busy on X. An actor
      active thirty seconds ago whose transcript ended on a clean close is
      content-idle.

      **Anti-pattern to avoid:** do NOT count the three ambient background Monitors
      (relay receiver, wake-up scheduler, context-watch) as busy work — they're
      always-on infrastructure, always tagged `[ambient]`, present on every live
      identity. Their existence tells you the identity has a live session, not that
      the actor is occupied with anything.

   c. **Tiebreaker among content-idle actors with no related context.** Pick
      alphabetically by name. Deterministic, no timing dependency, no state file
      needed.

4. **Return EXACTLY one of the following JSON shapes on a single line** (nothing
   else — no preface, no explanation, no code fence).

   **A pick was made** (an actor was selected — either related-context match or
   content-idle):

       {"picked": "<clone-name>", "why": "one sentence citing concrete evidence from the transcript (related-context match on X, or content-idle transcript ending on clean close, or content-busy on Y but only actor with related context)", "alternatives": [{"name": "<other-clone>", "why_not": "one sentence — content-busy on what, or why they lose to the picked actor"}, ...]}

   If only one actor exists in the pool, still return this shape with
   `"alternatives": []`.

   **No fit — spawn a fresh actor** (no related-context match AND every actor is
   content-busy on some OTHER open thread of their own):

       {"picked": null, "reason": "no_fit", "why": "one sentence noting no related-context match and every actor is content-busy on unrelated work per their transcript", "alternatives": [{"name": "<clone>", "why_not": "one sentence citing what open thread their transcript shows them occupied on"}, ...]}

   The coordinator interprets `reason == "no_fit"` as authorization to spawn a fresh
   actor of the role and dispatch to it.

   **No actors in pool** (only coordinators exist under this role, or empty role):

       {"picked": null, "reason": "no_actors_in_pool", "why": "no actors available under <TARGET_ROLE>"}

   The coordinator interprets `reason == "no_actors_in_pool"` as needing to escalate
   to Ashley — this case is not expected (a coordinator cannot exist without at least
   one non-coordinator actor of its role) but return this shape defensively if the
   enumeration comes up empty.
