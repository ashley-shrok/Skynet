# Shape: the new-agent panel should stop asking a person for things it already knows or the agent can write itself

**Opened:** 2026-09-14
**Vehicle:** inline (orchestrator, four atomic commits)

## What this is

The panel you fill in to create a new agent asks for more than it needs. It waits for a
role before it will suggest a name, it offers a name whose availability it checked against
the wrong authority, it makes you pick a role even when only one exists, and it asks you to
type what the agent will work on before you necessarily know. This narrows creation down to
almost nothing: the name suggested is one that is genuinely free on the machine the agent
will live on, it appears immediately without waiting on a role, a lone role selects itself,
and the "what will this work on" box is gone — creation writes a stand-in and the agent
replaces it later with what it was actually told to do.

Underneath there is a correctness fix that has to land for any of the name work to be real:
when the target machine is the same one the app runs on, the "does this agent already exist"
check looks in a location that moved some time ago. It finds nothing there, so it answers
"that name is free" every single time. Verified against the running system.

## Shape

Five moving pieces, one spine.

**Where availability is decided.** A name is usable if no agent by that name already has a
home on the target machine. That is the authority. Today the suggestion is checked against
the messaging system instead — it forms the chat address that agent would eventually get and
asks whether it is taken. That is a different question, and it can disagree with the real
one. The suggestion moves to asking the machine.

**The stale local check.** The "already exists on this machine" question has two branches:
one for remote machines, one for when the target is the machine the app itself runs on. The
remote branch is correct. The local branch points at where agent homes used to live. There
is already an agreed-upon way elsewhere in the system to resolve that location correctly,
including when the app is running in a container and the real directory is mounted in from
outside. The local branch adopts it.

**The role gate on names.** Nothing is suggested until a role is picked, and the only reason
is that forming a chat address needed a role. Names do not depend on roles — the pool of
names is one flat list, the same for every role. So once availability stops going through
the chat address, the gate has nothing holding it up and comes off. The name appears as soon
as a machine is chosen.

**A lone role picks itself.** When exactly one role is available, it is selected rather than
left empty behind a "choose one" prompt. The machine picker already behaves this way when
there is only one machine; this is the same courtesy.

**What the agent will work on.** The box is removed. Creation records a stand-in —
"Untitled conversation" — which is what shows as that agent's line in the conversation list
until it is replaced. On first wake, once the user has explained what the agent is for, the
agent writes that into its own record, replacing the stand-in. It does this silently: it is
an internal bookkeeping step, not something the user needs narrated back at them.

## Philosophy

Creation should be close to empty. Every field on that panel is a question asked at the
worst possible moment — before the work has started, before the person necessarily knows the
answer. Anything the system can resolve, it should resolve. Anything the agent will learn in
its first minute of conversation, the agent should write down itself.

The name suggestion should be trustworthy or absent. A confident wrong answer is worse than
no answer, which is what makes the stale local check a correctness issue rather than a
tidy-up: it does not fail loudly, it cheerfully approves names.

On the agent writing its own record: agents ask before editing their own permanent files,
and that rule is not being relaxed. This is one narrowly-carved exception for one field —
the record of what this agent was asked to do — because requiring permission to write down
an instruction just received is precisely the friction being removed. The carve-out must
read as being about that one field and nothing else, because the instruction it lives in
reaches every machine in the fleet.

Losing the chat-address availability check is acceptable and deliberate. It was
suggestion-quality polish, never the guarantee. The real guarantee is at creation time,
where existence on the machine is checked and a numeric suffix is appended if needed.

## Prior context

The name-suggestion behavior and the "what will this work on" box arrived together in an
earlier round of work on this panel. The machine picker was taught to hide itself and
self-select when only one machine exists in a later pass; roles never got the same
treatment. The location of agent homes was moved in an earlier change, and a sweep updated
the places that referenced the old spot — the local branch of the existence check was missed
by that sweep, and a sibling file that got it right is the model to follow.

Two points were settled before this opened and are not reopened here: the name pool is the
same regardless of role, and the chat-address availability probe is polish rather than a
guarantee.

From the operator's side today: you choose a machine, then wait — nothing suggests a name
until you have also chosen a role, even when there is only one role to choose. Then you are
asked to describe in a couple of lines what this agent will do, which you may not yet know,
and which you will say again in your own words the moment the agent wakes up.

## What would make it wrong

- A suggested name that is already in use on the target machine. The entire point of moving
  the check is that the suggestion becomes trustworthy.
- A name the person typed being overwritten by a suggestion. Suggestions yield to intent,
  always.
- The stand-in text surviving as an agent's visible line long after that agent has been
  told what it is doing. The replacement is the other half of removing the box; without it
  the change has traded a question for a permanent blank.
- The self-write permission carve-out reading broadly enough that a future agent takes it as
  license to edit other parts of its own record unprompted.
- The agent narrating the self-write. It is internal bookkeeping.
- Creation becoming slower or more fragile because availability now involves asking a
  machine. If the machine cannot be reached, the panel should still offer a name rather than
  stall or fail.
- A role being auto-selected in a way that fights the existing pre-fill or the guard that
  clears a role which does not exist on the chosen machine.

## Scope edges

**In:** the four named changes plus the stale-local-path fix. Availability of suggested names
sourced from the machine. Removal of the work-on box and the stand-in that replaces it. The
self-fill instruction, scoped to that one field.

**Out:** the panel's header area and its surrounding chrome — another identity is working
that surface in parallel. Anything about how roles themselves are created. The shape of the
name pool. The numeric-suffix behavior at creation time.

**Deferred:** the broader streamlining of the whole creation path, which is tracked
separately and whose timing is undecided.

**Tempting but no:** rewriting how availability is checked everywhere it is asked. Only the
suggestion path and the broken local branch are in scope. Also tempting: making the
stand-in cleverer by deriving something from the role. It is a stand-in with a short life;
leave it plain.

## Vehicle notes

Inline, done by the orchestrator rather than handed to an isolated worker. The reason is
that each part turns on context a fresh worker would not have: the role auto-selection has
to sit between two existing behaviors without disturbing either, the availability change is
a judgment about which authority is correct, and the self-fill instruction reaches every
machine in the fleet and has a required background document to read first. Briefing a
separate worker would cost more than doing it, and a missed constraint here fails quietly.

Four commits, each independently revertable:

1. Availability of suggested names moves to the machine; role becomes optional on that path.
2. The stale local existence check adopts the correct location. Standalone so it can be
   reverted on its own — it is a real bug independent of this work.
3. The panel: lone role self-selects, the role gate comes off the name, the work-on box is
   removed and the stand-in takes its place.
4. The self-fill instruction, scoped to the one field, silent.

Work stops at code committed with relevant tests passing. No pushing, no building, no
deploying — those are gated separately. The instruction file in commit 4 is distributed
fleet-wide from this repository; the copies installed on machines are never edited directly.
Its required background document is read before that commit is written. Once committed, the
change to that instruction is sent to the maintainer of the downstream deployment as a
patch, which is pre-authorized and needs no further approval.

---

## Close-Out

**Closed:** 2026-09-14
**Vehicle used:** inline (orchestrator), five atomic commits — four planned plus one review-fix
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · creation narrowed to name + role; both now resolve themselves where they can
- **Shape: where availability is decided** — present · the suggestion asks the target machine's agent homes instead of the messaging system
- **Shape: the stale local check** — present · local branch adopts the canonical resolver, honoring the container mount
- **Shape: the role gate on names** — present · gate removed; a name appears once a machine is known
- **Shape: a lone role picks itself** — present · single available role self-selects
- **Shape: what the agent will work on** — present · box removed, stand-in written, agent self-fills on wake
- **Philosophy** — present · every remaining question is one only the human can answer
- **Prior context** — present · followed the sibling that got the location right, rather than inventing a path
- **What would make it wrong: a suggested name already in use on the target machine** — present · authority moved to the machine, which is the same gate creation enforces
- **What would make it wrong: a typed name overwritten by a suggestion** — present · the no-clobber rule was preserved deliberately and is covered by tests
- **What would make it wrong: stand-in surviving long after the agent was told its job** — present · the self-fill instruction is the other half, and now also keeps the field current
- **What would make it wrong: carve-out read broadly enough to license other self-edits** — present · fenced to the one field, with an explicit "this inference is wrong" line
- **What would make it wrong: the agent narrating the self-write** — present · silence stated twice, with the user's own words on the record
- **What would make it wrong: creation slower or more fragile** — present · unreachable machine still yields a name; one round-trip replaced up-to-N
- **What would make it wrong: auto-select fighting the pre-fill or the stale-role guard** — present · composes with both; the interaction is tested in isolation
- **Scope edges** — present · panel header untouched (owned by a peer in parallel); pool shape and numeric-suffix behavior untouched; stand-in kept plain

### Additions (in the result, not in the shape)

- The instruction originally licensed the agent to silently rewrite its own task record on any later redirect — not agreed at open, and self-contradictory against a condition a few lines above it. — endorsed-as-drift (user chose to KEEP ongoing updates and drop the conflicting condition instead, so the field tracks current work; fixed in the follow-up commit)

### Follow-ups

- Two pre-existing lint errors and repo-wide prettier drift in files this work touched; not introduced here, and fixing them would reformat unrelated lines — accepted-as-drift
- Push, build, and deploy remain gated and unperformed — deferred
- The id-skill change still needs sending to the downstream deployment's maintainer as a patch (pre-authorized) — deferred

### Notes

The close-out review earned its keep: it caught a genuine self-contradiction inside the
fleet-wide instruction that no test could have surfaced, because both halves were prose and
each read fine alone. The user's resolution inverted the fix — rather than removing the
ongoing-update licence to match the shape, she removed the leave-it-alone condition, on the
grounds that people move onto genuinely different work mid-session and a stale label is worse
than a rewritten one. That makes the field describe current work rather than origin, which is
a slightly larger idea than the shape recorded; a guard was added so it does not slide into
the progress-log shape the same section warns against.

Worth carrying forward: several existing tests silently depended on hosts having exactly one
role, so the sole-role auto-select made them fail for reasons unrelated to what they guarded.
The fix was to make those fixtures multi-role and add dedicated single-role tests, rather than
weaken the assertions. One test also had to exclude the seeded role name from its fixture so
that an empty dropdown could only mean "never seeded" and not "seeded then cleared".
