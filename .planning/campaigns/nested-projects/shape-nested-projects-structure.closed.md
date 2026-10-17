# Shape: nested projects — structure

**Opened:** 2026-10-17

## What this is

Everything the user sees and does in the app to nest projects. A project can
name a parent project; the sidebar shows projects as a tree; the user can
create a sub-project, move a project under another (or back to top level) from
a menu or by dragging, and archive a project together with everything beneath
it. Visibility restrictions on a parent hold for its whole subtree. The id
skill describes all of it. Agents inside sub-projects behave exactly as today —
reading their ancestor chain is the next shape.

## Shape

- **The parent line.** A project file may name one parent project. No parent
  means top level. Folders stay side by side on disk; names and the rule for
  what a name may look like are unchanged. The parent travels with the project
  list to every open app, both on the periodic per-machine sweep and on the
  direct load at startup and after any project change. A parent name always
  resolves on the project's own machine.
- **Sidebar tree.** A sub-project renders as an indented, collapsible section
  inside its parent, at any depth, above the parent's own conversations.
  Sub-projects sort alphabetically, as top-level projects do. Collapsing a
  parent hides everything beneath it; each sub-project keeps its own collapsed
  state, so expanding the parent restores its children as they were left.
- **Create a sub-project.** The project menu gains "New sub-project", which
  opens the usual new-project dialog with the machine fixed to the parent's.
  A new sub-project starts private to its creator on a machine with several
  users, exactly like a new top-level project today.
- **Move a project.** The project menu gains "Move to": a "Top level" entry
  plus every eligible project, indented to mirror the tree; the project itself
  and its descendants are not offered. On desktop a project header can also be
  dragged: dropping anywhere in a project's section nests it there (the
  innermost section under the pointer wins), dropping on the Projects
  super-header returns it to top level, its own subtree never lights up as a
  target, and dropping on Pinned or Conversations does nothing. On a phone,
  "Move to" is the way. Moving a project carries its whole subtree — its
  sub-projects, agents, and rooms come with it.
- **Conversation "Move to".** The list of projects a conversation can move
  into is indented to mirror the tree, so siblings with similar names are
  distinguishable. Dragging a conversation lands it in the innermost project
  section under the pointer.
- **Archive takes the subtree.** Archiving a project archives every project
  beneath it and every agent in any of them; relay rooms anywhere in the
  subtree are released back to Conversations. The confirm names the project
  and states the counts first — sub-projects, agents, rooms — and says it
  cannot be undone. Counts, not lists of names.
- **Visibility inherits.** A project is shown to a user only if they can see
  it and every ancestor. A sub-project can narrow its audience, never widen
  it.
- **Guard rails.** The app refuses to place a project inside itself or its
  own descendant, or under a project on another machine. Which case applies to
  a project whose parent isn't shown is decided where every project is
  visible: if the parent is hidden from this user, the child is hidden too; if
  the parent is genuinely gone or archived, the child shows at top level for
  everyone who can see it. A hand-edited loop renders safely: every project
  caught in the loop shows at top level, with any genuine sub-projects still
  nested beneath it. Nothing rewrites the files and the sidebar shows no
  warning; the user fixes it with "Move to". Our side logs it.
- **Search.** Typing a project's name in the sidebar search shows that
  project, every project beneath it, and all their conversations, with its
  ancestors shown as the path down to it. Conversation matches work as today;
  a matching conversation shows inside its project and that project's
  ancestors.
- **The id skill** describes the parent line, the tree in the sidebar, the
  new menu items, dragging projects, subtree archive, visibility inheritance,
  and project-name search, so every agent can guide the user and drive the
  same things from its side.

## Philosophy

Nesting is an organizing layer over projects that otherwise stay exactly as
they are. A sub-project is an ordinary project that happens to name a parent;
everything that works on a project today works on a sub-project with no
special case. Moving things is a one-line change and never moves a folder or
breaks anything pointing at a project. When the tree is malformed, the app
degrades to showing things, never to losing them. Someone who never nests
sees no difference except that project names are searchable again.

## Prior context

Projects today are entirely flat: one section per project under a Projects
super-header, a project menu (open, new conversation, rename, archive),
conversations moved by menu or by drag, and on phones only by menu because
dragging doesn't work there. A project's visibility list only hides sidebar
rows — machine access is the real boundary. Archiving a project today takes
only its own agents and rooms, behind a fixed confirm with no counts, and
there is no way to un-archive a project from the app. Project-name search was
removed in September because, with flat projects, finding the header added
nothing over scrolling; the id skill still claims it works. Relay rooms point
at a project by name, spawning into a project checks only the name's format,
and scheduled tasks cannot target a project — so sub-projects need nothing new
in any of those.

## What would make it wrong

- A project vanishing from the sidebar because something about its parent
  went wrong.
- A loop, or a move, that leaves the tree in a state the user can't get out
  of from the sidebar.
- A sub-project leaking to someone who can't see its parent — including by
  being promoted to top level because its parent looked "missing" from that
  user's point of view.
- Archiving a parent taking more or less than its subtree, or doing it
  without saying how much first.
- A user who never nests noticing anything different besides name search.
- Phone users being unable to nest or un-nest a project.
- The id skill describing behavior the app doesn't have, or missing behavior
  it does.

## Scope edges

- **In:** everything in the Shape section, including restored project-name
  search and the indented "Move to" lists.
- **Out (next shape):** agents reading their ancestor chain at load, the file
  watcher covering ancestors, ancestor member-churn suppression.
- **Out:** un-archiving projects; the existing quirk where a relay room's
  project is matched by name on any machine; remembering collapse state per
  machine; changing who appears on a project's member list.

## Handoff notes

Built by the cosmos box-maintainer identity in its own Skynet tree, on the
shared branch. This shape is shape 1 of the nested-projects campaign; the
campaign artifact sits beside this file. The parent has to be carried through
every layer the project list passes through, because each layer today keeps
only the fields it names. Projects are told apart by machine plus name. Peers
recently replaced the open conversation's badge with a "task pill" and made
the Projects super-header collapsible; pull before starting. Any user-facing change ships with the matching id-skill edit.

---

## Close-Out

**Closed:** 2026-10-17
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · Parent line, sidebar tree, New sub-project, Move to plus drag, subtree archive, inherited visibility and id-skill text are all present; agent-side ancestor reading is untouched.
- **Shape: The parent line** — present · One optional parent line per project file, folders flat, name rules unchanged; carried on both the per-machine sweep and the direct load; resolved only on the same machine.
- **Shape: Sidebar tree** — present · Indented collapsible sub-project sections at any depth, above the parent's conversations; siblings alphabetical; per-project collapse state restores children as left.
- **Shape: Create a sub-project** — present · "New sub-project" opens the usual dialog locked to the parent's machine; private-first on multi-user machines as today.
- **Shape: Move a project** — present · "Move to" with Top level plus eligible same-machine projects, indented, excluding own subtree; desktop-only header drag, innermost wins, Projects super-header = top level, own subtree never lights, Pinned/Conversations ignore it.
- **Shape: Conversation Move to** — present · Indented tree order in both the sidebar row and the open-conversation menus; drops land in the innermost section.
- **Shape: Archive takes the subtree** — drifted · Archives the visible subtree, its agents, releases rooms, behind a confirm naming the project with counts and "can't be undone". A sub-project hidden from the archiving user is left standing (shows at top level for its own audience) — accepted by the user as the right behavior.
- **Shape: Visibility inherits** — present · Server-side tree check on both paths: shown only if the project and every ancestor pass.
- **Shape: Guard rails** — present · Server refuses self, descendant, missing and other-machine parents; hidden-vs-gone decided over the unfiltered list; loops render at top level with real children nested; no rewrite, no warning; loops logged.
- **Shape: Search** — present · Name match shows the project, its subtree and their conversations with ancestors as the path; conversation matches show inside their project and its ancestors.
- **Shape: The id skill** — present · Covers the parent line, tree, New sub-project, Move to, drag, phone path, subtree archive, visibility inheritance, name search.
- **Philosophy** — present · Ordinary projects with one extra line; moves never move folders; malformed trees degrade to top level.
- **Prior context** — present · Relay-room, spawn and scheduled-task paths untouched, as expected.
- **What would make it wrong: A project vanishing because something about its parent went wrong** — present · Missing, archived or looped parents resolve to top level.
- **What would make it wrong: A loop or move leaving the tree stuck** — present · Looped projects show at top level with a working Move to; self/own-subtree moves refused on both sides.
- **What would make it wrong: A sub-project leaking to someone who can't see its parent** — present · Ancestor walk over the unfiltered list; a hidden parent never looks missing.
- **What would make it wrong: Archiving a parent taking more or less than its subtree, or not saying how much first** — drifted · Counts shown first; sub-projects hidden from the archiving user are deliberately left standing (accepted).
- **What would make it wrong: A user who never nests noticing anything besides name search** — present · Flat users see the same order and sections.
- **What would make it wrong: Phone users unable to nest or un-nest** — present · Move to (with Top level) on every layout; drag off on mobile.
- **What would make it wrong: The id skill describing behavior the app lacks, or missing behavior it has** — present · Every claim matches the material.
- **Scope edges** — present · No agent ancestor reading, no watcher change, no member-list change, no un-archive, no per-machine collapse memory, no relay-room matching change.

### Additions (in the result, not in the shape)

None.

### Follow-ups

- Subtree archive skips sub-projects hidden from the archiving user; they survive at top level for their own audience — accepted-as-drift (user: a hidden sub-project is someone's deliberately private work; archiving it unseen and uncounted would be worse).

### Notes

The archive confirm leaves out a count when it is zero; a folder-move failure part-way stops and says how many sub-projects were archived; a failed move is undone with an alert.

### Post-close code review (2026-10-17)

An independent code review after the close found and fixed, all within the agreed shape:
- "Move to" judged the current place from the drawn tree, so a looped project (or one whose parent is gone) couldn't be returned to top level from the menu — on a phone, no way out of a loop. It now follows the parent the file names.
- Visibility for a hand-edited loop now matches how the sidebar draws it (loop members at top level), so a hidden loop partner no longer hides a visible one; a hidden partner's name is never sent to someone it's hidden from.
- The reload cache now keeps each project's parent (no flat flash then jump).
- The per-machine sweep now reads parents the same way the server does (bare null/true/numbers name no parent) and reads further into long project files.
- Nesting under, or moving, a project hidden from the caller is refused as "not found".
- Writing the parent line no longer mangles a hand-written multi-line display name or an unclosed frontmatter block.
- A dragged project passing from a lit ancestor into its own subtree now turns the ancestor's highlight off.
Not fixed: two people re-parenting two projects into each other at the same instant can still produce a loop; the sidebar shows it safely and "Move to" undoes it.
