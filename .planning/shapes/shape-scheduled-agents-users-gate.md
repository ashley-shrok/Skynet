# Shape: users-tagging gate on scheduled agents (a.k.a. global wakeups)

**Opened:** 2026-09-27
**Vehicle:** inline (tracked with harness tasks)

## What this is

Scheduled agents — the fleet-wide clock-scheduled specs that fire and spawn a
fresh identity — do not yet have a per-user visibility gate. Everyone with
access to the host a scheduled agent lives on sees every scheduled agent on
that host in Skynet's list. This closes the last unfinished type: projects,
identities, roles, and apps all already have a per-user gate driven by a
`users` list on their spec; scheduled agents get the same, patterned to match.

Alongside the code change, the user-wide operator note about tagging apps
(currently on the multi-user host thenasty's Claude preferences file) gets
extended to also mention scheduled agents, and gets propagated to any other
box that also hosts identities for more than one Skynet user.

## Shape

A scheduled agent's on-disk spec is a JSON file at a known path under the
host's fleet directory. Today the fleet-wide list is assembled by fanning out
over every managed host, reading each host's spec files, and returning the
aggregated set to whoever asked.

The change has three concepts:

- **The spec grows an optional users list.** A scheduled-agent spec on disk
  may now carry a `users` field: a list of Skynet usernames. Absent, missing,
  or empty means "no gate — visible to any user who can already reach the
  host." Present and populated means "only these users see it in the list."
  This is set by hand, on disk, exactly the way it is set for apps and
  projects — not through Skynet's write endpoints.

- **The list assembly reads that field and gates on it.** When the fleet-wide
  list is assembled, each row is filtered against the calling user's username
  using a small pure predicate — same shape as the equivalent predicates for
  projects, identities, roles, and apps: case-sensitive username match against
  the list, absent/empty falls open, an internal caller with no username
  bypasses the gate. Rows the caller isn't on simply do not appear in the
  response. The users field itself is stripped from every row before the
  response goes out — gate-only, never on the wire.

- **The write endpoints refuse to touch the users field.** Creating or
  editing a scheduled agent over HTTP is not a way to set its users list.
  If a client sends a `users` key in the payload, it is silently dropped
  before the spec lands on disk. Setting users is a disk-edit operation only.
  Write endpoints continue to gate on host access, not on the users list —
  matching how identity and identity-wakeup writes behave today.

Docs sweep: one paragraph in the user-wide operator instruction file on
thenasty currently tells you to tag any app you create with your identity's
users list. Extend that paragraph so it also tells you to do the same thing
for any scheduled agent you create. Then enumerate the other fleet hosts
that actually hold identities under more than one Skynet user, and add the
same paragraph to their equivalent user-wide instruction file.

## Philosophy

Sameness with the four existing gated types is the point. This is not a
place to design a new gate mechanism. The user's tagging list is a gate-only
concern, editable only on disk, honored at every place the resource surfaces
to a caller. Every one of the existing gated types already carries this
discipline; scheduled agents just weren't wired in yet. If a decision this
work faces is not obvious, the answer is "look at what apps did in the phase
that tagged them, and do the same thing here."

What would violate the spirit even if a test passed: a client learning it
can set a users list over HTTP; the field leaking onto the wire in a list
response; the write endpoints acquiring new gating that the other types
don't have; a wire-shape divergence that means a client which handles apps
correctly wouldn't handle scheduled agents correctly.

## Prior context

- Projects, identities, roles, and apps already have this exact discipline.
  Apps were the most recent addition; the shape here reads as "apps for
  scheduled agents."
- The scheduled-agent list is a pull-only HTTP fan-out, not a push-based
  subscription frame. That means there's exactly one emit site to gate, not
  two. Apps had to be careful because they emit through both a snapshot
  frame and a delta frame; scheduled agents don't have that complication.
- The substrate-side clock scheduler that actually fires scheduled agents
  does not read the users field. Firing is unaffected by tagging. The users
  list is purely about "who sees this in Skynet's UI."
- The write-endpoint surface for scheduled agents is broader than for apps
  or projects (which have no HTTP writes at all): create, full edit,
  toggle-enabled, delete. None of the existing gated types apply the users
  list to their equivalent write endpoints; only host access matters. Same
  posture applies here.
- The user-wide operator instruction file that lives on thenasty already
  carries a "tag your apps" paragraph. It's the template for what the
  scheduled-agents mention should look like. The docs sweep extends that
  paragraph, doesn't invent a new one.

## What would make it wrong

- If a client can set a users list via any HTTP write endpoint, this has
  missed the point. Setting users is a disk-edit-only operation, matching
  every other gated type.
- If the users list appears in any response body, this has missed the point.
  The field is gate-only; the strip discipline must hold at every emit site.
- If the falls-open rule inverts — i.e., absent or empty list makes a row
  invisible instead of visible — this has missed the point. Any of the four
  existing types' behavior is the reference answer.
- If comparison ever becomes case-insensitive, or normalizes whitespace, or
  otherwise diverges from the storage discipline used by the other four
  types, this has missed the point.
- If the docs sweep only touches thenasty and leaves other multi-user hosts
  telling operators "tag your apps" while silently omitting scheduled
  agents, this has missed the point — the user-facing note has to be
  wherever the underlying gate is real.

## Scope edges

**In:**
- Parse the users list from a scheduled agent's on-disk spec.
- Add a gate-only field to the row shape that carries scheduled-agent list
  data around inside the assembly.
- A new pure predicate function paralleling the ones for projects, apps,
  identities, roles — one file, unit-tested, no dependencies on the DB or
  the route layer.
- Wire that predicate into the list-assembly seam.
- Strip the field from every row before the response goes out.
- Add users-strip discipline to the create and full-edit write endpoints so
  a client can't sneak the field onto disk via HTTP.
- Test coverage: the new predicate as a pure unit; the list route gates as
  expected against a synthetic set of tagged and untagged rows; write
  endpoints drop a users payload without acknowledging it.
- Docs sweep: update the multi-user note on thenasty; identify and update
  the equivalent note on any other host that hosts identities for more than
  one Skynet user; matching text on all of them.

**Out:**
- Any UI to display or edit the users list. The list is set on disk.
- Any change to the substrate-side clock scheduler that fires scheduled
  agents. The scheduler doesn't care about users.
- Any change to the substrate-side spawn machinery that turns a fired
  scheduled agent into a running identity. Firing and tagging are
  orthogonal.
- Users-list gating on write endpoints. Host access remains the only gate
  on writes, mirroring identity and identity-wakeup writes today.
- Any subscription-frame gate work. There is no scheduled-agent
  subscription frame today; adding one would be a separate piece of work.

**Deferred:**
- Any surface that would let an operator manage the users list in Skynet's
  UI rather than by SSHing in and hand-editing the JSON. Not this work.
- A shared helper across the five predicate files. The pattern was
  deliberately duplicated per resource so a grep for the predicate name
  answers "did we cover every gate site?" — keep that discipline; don't
  refactor into a shared helper here.

**Tempting but no:**
- Being clever about the write endpoints — either by accepting a users
  payload with a special permission check, or by returning a distinct 403
  when a caller who isn't on the list tries to edit. Both add divergence
  from the existing types; keep the shape uniform.

## Vehicle notes

Inline execution, tracked via the harness tasks already set up. Work
proceeds carefully — atomic edits, scoped tests per touched paths, no
push-and-deploy until Ashley greenlights the ship separately. The docs
sweep is a follow-up ops task after code and tests are green; it operates
on peer boxes over SSH and belongs in the same session but not in the
code commits.

Reference implementations to mirror faithfully: whatever the most recent
apps-tagging work landed (parser, wire strip, gate predicate, list-emit
filter, test shape). If something is unclear here, that work is the answer.
