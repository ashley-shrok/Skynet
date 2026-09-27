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
filetypes. The user confirmed the direction and picked Dracula from a
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

Inline, tracked via the harness task list. The user wants to work
through it carefully, in the loop.

Identity holding the work: `dagger-box-maintainer-2`. Working tree at
`~/fleet/identities/dagger-box-maintainer-2/workspace/skynet/`,
branch `feat/tab-title-from-tmux` (fleet-shared feature branch;
`git pull --rebase` before every push per the multi-identity rule).

Tasting prototype (source of truth for the direction that was picked)
lives at
`~/fleet/identities/dagger-box-maintainer-2/workspace/editor-tasting/prototype.html`,
served on port 8905 (accessed via the box's Skynet serve URL for that
port). The prototype uses a CDN with careful dependency alignment; the
real implementation goes through the app's normal build tool so those
alignment concerns don't apply.

Close-out: `/close code-editor` when the work is done, to verify the
built result matches this shape.

---

## Close-Out

**Closed:** 2026-09-27
**Vehicle used:** inline, tracked with harness tasks
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · Non-markdown file-edit surfaces now mount a real code editor in Dracula, replacing the bare monospace text box; markdown editing left untouched.
- **Shape** — present · The shared entry point still gates on 'is this markdown?'; the non-markdown branch now routes to the code editor instead of a plain text box, so every consumer (file tabs, editable-file modal) picks it up automatically.
- **Dracula island / app chrome outside** — present · The editor sits in the Dracula palette inside; the surrounding shell keeps the app's rounded border and identity-hued focus ring.
- **Broad language coverage (modern + legacy-modes)** — present · Every mainstream language the editor ecosystem ships support for is wired up — first-class packs for JS/TS, JSON, YAML, Python, HTML/CSS, Java, C/C++, PHP, Rust, SQL, XML, Go, WebAssembly text; legacy-modes for C#, Kotlin, Swift, Ruby, PowerShell, Dockerfile, TOML, INI, Lua, Perl, Haskell, Clojure, Groovy, Erlang, Julia, R, OCaml, F#, Scheme, VB, CoffeeScript, Objective-C, Dart, and more.
- **Extension-primary detection + well-known extensionless filenames** — present · Two-phase resolver: well-known filenames first (11 entries — Dockerfile, Containerfile, Rakefile, Gemfile, Guardfile, .gitignore, .env, .bashrc, .zshrc, .profile, .bash_profile — within the 8-12 range), then extension.
- **Unknown extensions fall through to plain text** — present · Resolver returns null for unknown; the editor still mounts (line numbers, undo, search, generic bracket-matching from basicSetup) but with no syntax coloring.
- **Lazy-loaded single payload** — present · The whole code-editor module is behind a single dynamic import; nothing is paid for until the first non-markdown file opens in a session.
- **Soft-wrap toggle top-right, sticky per-browser, default off** — present · Toggle button in the top-right corner; state persists to browser-local storage; default off; live-toggle via a compartment so text and cursor survive.
- **Philosophy — mount the ecosystem editor and step back** — present · No custom theme or toolbar; only the wrap toggle exposed; every other decision left at the editor's out-of-the-box defaults.
- **Prior context — two prose fields stay on the markdown side** — present · Bounty premise and wake-up instruction fields pass synthetic '.md' filenames, so they route to the pretty markdown editor — unchanged by this pass.
- **What would make it wrong: content lost / cursor lost / text jumping on save** — present · Content-sync effect skips when the editor's doc already matches the incoming content; language and disabled changes go through compartments so no remount.
- **What would make it wrong: load-failure leaves user unable to edit** — present · An error boundary catches lazy-import failures and drops back to the raw textarea; a console log records the fallback.
- **What would make it wrong: markdown files routed through the code editor** — present · The gate on the shared entry point still routes '.md' to the pretty markdown editor; only the non-markdown branch changed.
- **What would make it wrong: code editor weight paid on first paint** — present · Lazy dynamic import + Suspense; the code-editor bundle is not part of first paint of the app.
- **What would make it wrong: Dracula bleeds into app chrome** — present · Dracula extension is scoped to the inner mount; the outer shell keeps the app's own border/focus styling.
- **What would make it wrong: soft-wrap toggle doesn't remember state** — present · Toggle writes to and reads from browser-local storage, with a round-trip test confirming persistence.
- **Scope IN: loading placeholder reserves layout** — present · A low-opacity 'Loading editor…' pane holds the layout while the bundle loads.
- **Scope IN: graceful fallback + log on bundle failure** — present · Error boundary + console.error identifying the filename.
- **Scope IN: disabled dims to ~60% and blocks input; Dracula stays underneath** — present · Outer shell adds opacity-60 when disabled; input is blocked via the editable-off compartment; Dracula colors remain.
- **Scope IN: default kit (folding, autocomplete, multi-cursor, bracket auto-close/match, undo/redo, drag-select, Cmd/Ctrl-F find-and-replace)** — present · The editor is wired up via basicSetup.
- **Scope OUT: theme picker / user-configurable theme** — present · Dracula is hard-wired; no picker.
- **Scope OUT: user-configurable settings beyond wrap toggle** — present · Only the wrap toggle is exposed.
- **Scope OUT: linting / inline error markers** — present · No linter or lint gutter extensions wired in.
- **Scope OUT: minimap** — present · No minimap.
- **Scope OUT: custom keybindings** — present · Only the indent-with-tab keymap is added — a standard ergonomic to make Tab indent rather than escape the editor; no bespoke bindings.
- **Scope OUT: any change to how markdown files are edited** — present · Markdown branch is untouched.
- **Scope OUT: any change to bounty-premise / wake-up prose fields** — present · Those fields still pass a synthetic '.md' filename and stay on the markdown side.
- **Scope OUT: no change to save semantics** — present · The editor emits on every keystroke through onChange; parents still own their save handlers.
- **Scope OUT: no server-persisted preferences store** — present · Wrap preference lives only in the browser's local storage.

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

Reviewer found no divergences from the shape in either direction — every commitment is present in the material and nothing has been added beyond the shape. No question needed to be brought to the user. The implementation split the code-editor mount into its own lazy child module and used CodeMirror 'compartments' for filename / disabled / wrap so that live changes reconfigure the extension in place without a remount — this is the mechanism that keeps text, cursor and undo history from being blown away on save round-trips or filename changes.
