# Shape: better code/text editor on the frontend (non-markdown)

**Opened:** 2026-09-27
**Vehicle:** inline, tracked with harness tasks

## What this is

Every place in the app where someone edits a file that isn't a markdown
file, they currently land in a bare monospace text box — no syntax
colors, no line numbers, no bracket matching, nothing. This shape
replaces that bare box with a real code editor — the kind you get in
modern development tools — in the Dracula theme, for every non-markdown
file type the app currently opens. Markdown editing stays exactly as it
is; it already uses a proper editor.

## Shape

There's one shared editor concept that every file-edit surface in the
app funnels through. Today that shared editor asks a single question —
"is this a markdown file?" — and either shows the pretty markdown editor
or falls back to the plain text box.

After this change the shape is the same shared entry point, but the
fallback branch is no longer a plain text box; it's a real code editor.
Every consumer surface — the file tabs across the various sidebar
panels, the editable-file modal — picks up the improvement automatically
because they all go through the same shared entry point.

The code editor itself is a self-contained visual island in the Dracula
palette. Around it lives the app's normal chrome (dark background,
identity-hued focus border). The Dracula colors sit inside; the app
frame sits outside. That split is deliberate — the editor doesn't try
to match the app's identity colors, and the app's chrome doesn't try
to blend into Dracula.

Language coverage is broad — essentially every mainstream language the
underlying editor ecosystem ships support for (both its modern
first-class language packs and its compatibility layer that ports
everything from the previous generation). Detection is primarily by
file extension, plus a small list of well-known extensionless filenames
(Dockerfile, Makefile, Gemfile, .gitignore, .env, and similar). Unknown
extensions fall through to plain text — line numbers, undo, search,
generic bracket-matching still work, just no syntax coloring.

The whole code-editor system is packaged as a lazy-loaded piece — the
app pays nothing for it until the first non-markdown file is opened in
a session. On that first open, the whole thing loads at once (all
language support included in the single payload).

There's a single user-facing control in the top-right of the editor
pane — a soft-wrap toggle. Off by default; when the user flips it on,
the preference is remembered for that browser and stays on across
future sessions until they flip it back. Everything else about the
editor's default behavior is left at its sensible out-of-the-box
settings.

## Philosophy

The point is to give people a real code editor in every place they
currently get a plain text box — not to build a curated, limited-
features "code viewer" or a heavily-customized editor with our own
theme and toolbar. The editor that the wider development ecosystem
already ships is genuinely good; we're mounting it and stepping back.

The Dracula theme is deliberate: professional code editors are their
own colored islands. Users know how to read Dracula. Our job is to
house it well, not to blend it into the app's own palette or to invent
yet another color scheme.

Configurable surface stays small on purpose. Only the soft-wrap toggle
is exposed — because a meaningful fraction of users want it and a
meaningful fraction of users don't, and it's cheap to flip live. Every
other decision has a good default and doesn't need to be a user
setting.

Load-time cost is honest: the whole code-editor system loads lazily as
one payload, no per-file surprises after that.

## Prior context

The shared editor concept was introduced across the app to unify what
every file-edit surface uses. Today it does two things: for markdown
files, it lazy-loads a pretty markdown editor with its own toolbar and
preview affordances; for everything else, it renders a monospace text
box with the app's dark styling. The text-box branch has been the
least-loved part of the app for a while — YAML with no colors, Python
with no colors, config files with no line numbers, JSON with no bracket
matching.

Two prose-input fields (bounty premise, wake-up instruction) also go
through the same shared editor but with a synthetic markdown filename
— they stay on the markdown side and are not part of this change.

A tasting session on the box confirmed the direction. A standalone
prototype mounted the real code editor with the Dracula theme in a
Skynet-styled shell, next to the plain text box, across nine sample
filetypes. Ashley confirmed the direction and picked Dracula from a
lineup of ten themes. The prototype also surfaced a handful of gotchas
around dependency alignment when loading the editor's packages from a
CDN — the real implementation, built through the app's normal build
tool, does not have those gotchas.

## What would make it wrong

- If any surface that goes through the shared editor today ends up
  behaving worse than the plain text box did — content lost on save,
  cursor position lost on re-render, text jumping when saves complete
  — the change has missed the point.
- If the load-failure case (offline, network hiccup, server outage)
  leaves the user unable to edit their file, the change has missed
  the point. The plain text box was ugly but never failed to load.
- If opening a markdown file now goes through the code editor instead
  of the pretty markdown editor, the change has missed the point.
- If the app pays for the code editor's weight on first paint of the
  app (before the user has opened any non-markdown file), the change
  has missed the point.
- If the Dracula colors start bleeding into the app's chrome — the
  surrounding panels, buttons, badges — the change has missed the
  point. The editor is an island.
- If the soft-wrap toggle doesn't remember its state between sessions,
  the change has partially missed the point.

## Scope edges

**In**

- Every non-markdown file that currently mounts the shared editor gets
  the real code editor instead.
- Broad language coverage — essentially every mainstream language the
  editor ecosystem ships support for.
- Filename → language detection: primarily by extension, plus a small
  list of well-known extensionless filenames (Dockerfile, Makefile,
  Gemfile, .gitignore, .env, and similar; around 8-12 entries).
- The Dracula theme, fixed. No theme picker.
- Soft-wrap toggle in the editor's top-right corner, sticky per-browser
  via the browser's local storage, default off.
- Loading state that reserves layout with a low-opacity "loading…"
  placeholder while the bundle loads (matches how markdown currently
  loads).
- Graceful fallback to the plain text box if the bundle fails to load,
  plus a log so we can see it happened.
- Disabled state (during save round-trips) that dims the editor to
  about 60% and blocks input; Dracula colors stay put underneath.
- The default kit shipped with the editor: code folding, autocomplete
  (where the language pack supports it), multi-cursor, bracket auto-
  close and matching, undo/redo across the session, drag-select, built-
  in find-and-replace on Cmd/Ctrl-F.

**Out**

- Theme picker or any user-configurable theme.
- User-configurable settings beyond the soft-wrap toggle.
- Linting or inline error markers.
- Minimap.
- Custom keybindings.
- Any change to how markdown files are edited.
- Any change to the bounty-premise or wake-up-instruction prose fields.
- Any change to save semantics — parents still own their save handlers,
  the editor still emits a change event per keystroke.
- App-level (server-persisted) user preferences store — the wrap toggle
  uses browser-local storage, not a server-side preference.

**Deferred**

- Restyling the built-in find-and-replace panel to match Skynet's
  aesthetic more closely (kept as-is for this pass; can be revisited
  if it grates).
- Additional toggles in the editor corner (font size, line numbers off,
  etc.) — one control this pass; more only if usage suggests it.
- Renaming the shared editor concept to reflect its broader role
  (naming change is a ripple across every consumer; leaving it as-is
  for this pass is fine).

**Tempting but no**

- Auto-detecting the file's existing indentation (spaces vs tabs, and
  size) and matching it. Reasonable defaults per language are enough
  for this pass.
- A theme picker "just in case people want it." Dracula is the
  decision.

## Vehicle notes

Inline, tracked via the harness task list. Ashley wants to work
through it carefully, in the loop.

Identity holding the work: `dagger-box-maintainer-2`. Working tree at
`~/fleet/identities/dagger-box-maintainer-2/workspace/skynet/`,
branch `feat/tab-title-from-tmux` (fleet-shared feature branch;
`git pull --rebase` before every push per the multi-identity rule).

Tasting prototype (source of truth for the direction that was picked)
lives at
`~/fleet/identities/dagger-box-maintainer-2/workspace/editor-tasting/prototype.html`,
served on port 8905 (`https://Skynet-8905.serve.term.gigaashley.click/prototype.html`).
The prototype uses a CDN with careful dependency alignment; the real
implementation goes through the app's normal build tool so those
alignment concerns don't apply.

Close-out: `/close code-editor` when the work is done, to verify the
built result matches this shape.
