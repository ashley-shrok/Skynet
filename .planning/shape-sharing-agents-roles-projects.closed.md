# Shape: Shared with — agents, roles and projects

**Opened:** 2026-10-30
**Campaign:** shared-host-sharing (shape 1 of 2)

## What this is

On a machine more than one person uses, every agent, role and project gets a
"Shared with" button showing who can see it, opening a ticked list of everyone
on that machine. Ticking and unticking people changes who sees the thing in
their sidebar, from the app, with no file editing — and when another list
(a role's, or what sits inside a project) would still keep it hidden, the
control offers to fix that too, so sharing actually makes the thing show up.

## Shape

**The control.** One button, the same everywhere: a people icon and a label
naming who can see it — "Only you", "You and Zoey", "You, Zoey and 2 others",
or "Everyone on this machine" for something that has never been limited.
Clicking it opens a list of everyone with access to that machine, the current
user first and marked "you", each with a tick. A tick takes effect straight
away, like the app's switches; a confirm appears only where the change reaches
further than the thing itself.

- Agent window: beside the Voice button.
- Role view: beside the Colour and Voice buttons.
- Project window: under the count line, with the hint "Also shares its
  sub-projects and the agents in them."
- Role view hint: "Agents with this role show up only for people it's shared
  with."

**Never limited.** A thing nobody has limited shows every person ticked and
the label "Everyone on this machine". The first untick writes the list out;
from then on it is always a list — ticking everyone back on keeps a fixed
list, so someone who joins the machine later doesn't see it.

**The last person can't be unticked** — an empty list would mean everyone.

**Taking yourself off** is allowed, after a warning that it will leave your
sidebar; once done the window closes and the thing is gone from your view.

**Agents.** Ticking someone who can't see the agent's role (or one of its
roles) asks "Share the <role> role with <person> too?" with **Share both** —
the alternative is sharing just the agent, which won't make it show up.
A person ticked on the agent but hidden by a role shows that on their line —
"Hidden by the <role> role" — with a **Share role** button. Unticking someone
on an agent touches only the agent.

**Roles.** Ticking someone on a role only stops the role hiding things from
them; it shares no agent. Unticking someone asks first and names the agents
holding the role that will disappear for them. Roles kept on every machine get
no button — they are meant for everyone, and only admins change them.

**Projects.** Ticking someone shares the project, every sub-project beneath
it, and every agent in any of them, plus the roles of those agents that the
person can't yet see — one confirm naming what it also shares. Unticking
someone takes them off that same set — including agents that were shared
with them separately before — after a confirm naming the sub-projects and
agents they will lose. Roles are never unshared by a project.

**Born inside a shared project.** A new agent or sub-project made inside a
project starts shared with the project's people (which includes whoever made
it). Moving an existing agent into a project leaves its list as it was.

**People who've lost access.** Someone on a list who no longer has access to
the machine shows at the bottom, greyed, "No longer on this machine", and can
be unticked. They don't count in the button's label.

**Single-user machines** show none of this: no button, no hint, no label.

**Who can change it.** Anyone who can see the thing.

## Philosophy

- Version one keeps the rule that you see an agent only if you can see the
  agent and every one of its roles. Sharing writes the person onto every list
  that would otherwise hide the thing, rather than redesigning that rule.
- Who-can-see is organization, not security. Machine access stays the only
  real boundary; this decides whose sidebar shows what.
- Nothing reaches further than the thing itself without saying so first.
- Wording names people by their usernames without pronouns, and fits any user
  on any instance.

## Prior context

Today the only way to see or change who sees an agent, role or project is to
edit its file on disk; the app never shows the lists at all. Things created
on a multi-user machine start out shared only with whoever made them. The
Cupid case on thenasty — an agent shared with Zoey whose role isn't — is the
kind of quiet hiding this removes. The look was tasted live on 2026-10-30 and
agreed ("this kicks ass. Let's go with it").

## What would make it wrong

- Someone is ticked and still can't see the thing, with nothing in the list
  saying why.
- A change hides or shares something beyond the thing being changed without a
  confirm naming it.
- A single-user machine shows any of this.
- A list ends up empty by accident, opening the thing to everyone.
- The lists leak to people outside the machine, or a hidden thing's name
  reaches someone it's hidden from.
- Wording assumes a particular person, pronoun or instance.

## Scope edges

- In: agents, roles (not ones kept on every machine), projects; the people
  list; share-the-role offer; project reach both ways; born-in-project
  sharing; people who've lost access.
- Out (shape 2): apps and scheduled tasks.
- Out: a "Share…" item in sidebar right-click menus — the window buttons are
  enough for now.
- Out: redesigning the agent-and-role rule; relay rooms in projects.
- Out: hand-fixing thenasty's role list (Ashley said to leave it).

## Handoff notes

Built by artemis-box-maintainer-4 in its Skynet tree. Tasting snippet:
workspace/tasting/share-tasting.js. Ends at committed, not pushed, not
deployed — the campaign deploys once at its close. The id skill gets a brief
mention of the button in each window.

---

## Close-Out

**Closed:** 2026-10-30
**Overall verdict:** closed-hit (after fixes — reviewer's first pass was closed-partial)

### Shape features (conformance)

- **The control** — present · one button in all three windows; people icon; "Only you" / "You and X" / "You, X and N others" / "Everyone on this machine"; you first, marked; ticks apply at once; confirms only where reach is wider.
- **Placement: agent window beside Voice** — present · not shown on archived agents (view-only window).
- **Placement: role view beside Colour and Voice, with hint** — present.
- **Placement: project window under the count line, with hint** — present.
- **Never limited** — present · all ticked; first untick writes a list; ticking everyone back keeps a fixed list.
- **The last person can't be unticked** — present · disabled in the list; server refuses empty lists.
- **Taking yourself off** — present · warning, then the window closes / role view goes back.
- **Agents: share-the-role offer** — present · "Share both"; roles kept on every machine never offered.
- **Agents: "Hidden by the <role> role" + Share role** — present.
- **Agents: unticking touches only the agent** — present.
- **Roles: ticking shares no agent** — present.
- **Roles: unticking names the agents that disappear** — present.
- **Roles kept on every machine get no button** — present.
- **Projects: ticking reaches sub-projects, agents and their roles, one confirm** — present.
- **Projects: unticking reaches the same set; roles never unshared** — present · with the exception below, endorsed.
- **Born inside a shared project** — present · after fix: a project with a list → creator plus its people; a project nobody limited → not limited either (Ashley: "Everyone, like its project").
- **People who've lost access** — present.
- **Single-user machines show none of this** — present.
- **Who can change it** — present · anyone who can see the thing.
- **Philosophy** — present · visibility rule unchanged; sharing writes the lists.
- **Scope edges** — present · apps, tasks, sidebar "Share…" not built; thenasty untouched.
- **Handoff: id skill mentions** — present.
- **What would make it wrong: ticked but still hidden, unexplained** — present.
- **What would make it wrong: reach without a naming confirm** — present.
- **What would make it wrong: single-user machine shows any of it** — present.
- **What would make it wrong: list empty by accident** — present.
- **What would make it wrong: hidden thing's name reaches someone it's hidden from** — present after fix · confirms named everything inside a project / holding a role regardless of the caller's view; now things hidden from the caller are counted ("1 more you can't see"), never named.
- **What would make it wrong: wording assumes a person, pronoun or instance** — present.

### Additions (in the result, not in the shape)

- Unsharing a project leaves someone on an agent inside where they're the only person on its list (an empty list would open it to everyone); the confirm says so and that it shows in their Conversations — endorsed-as-drift (Ashley worried it might vanish for them; it doesn't — an agent whose project is hidden shows in Conversations).
- Archived agents get no button — endorsed-as-drift (archived window is view-only).
- "Nobody on this machine" label when everyone listed has lost access — endorsed-as-drift.
- Take-yourself-off warning adds "Anyone it's still shared with can add you back." — endorsed-as-drift.

### Follow-ups

- Narrow confirm names to what the caller can see — done in this shape.

### Notes

Live read-only check against a real multi-user machine read 67 agents, 10 roles and 1 project in one pass each and planned correctly.

### Addendum — after the code review (2026-10-30)

Changes made from the unbiased code review, all within the shape unless noted:

- A change is now the person ticked or unticked, applied to the list as it is at that moment — two people changing the same list can't undo each other's ticks (and a project untick can't cascade someone else's earlier change).
- A sub-project hidden by a project above it says so on each person's line ("Hidden by the <project> project"), and one with no list of its own shows who the projects above let in — closes the "ticked but still hidden, unexplained" gap for projects.
- Roleless agents made inside a project stay visible only to whoever made it (Ashley, 2026-10-30: "Only whoever made it") — an exception to "born inside a shared project"; the born-in-project rule also never runs on a single-user machine.
- Safety: one write at a time per machine (not per host row); roles kept on every machine are locked when that list can't be read; files keep their final newline; a file with broken frontmatter is refused rather than silently left unchanged; the list reloads after a failed save; single-user machines are answered without connecting.
