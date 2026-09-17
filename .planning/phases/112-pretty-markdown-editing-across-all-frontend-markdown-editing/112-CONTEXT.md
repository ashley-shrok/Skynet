# Phase 112: pretty-markdown-editing-across-all-frontend-markdown-editing - Context

**Gathered:** 2026-09-16
**Status:** Ready for planning
**Seeded from:** `shape-pretty-markdown-editing.md` (opened + agreed 2026-09-16 via `/build` → `/open`); no live discuss step re-elicited what the shape locked.

<domain>
## Phase Boundary

Replace the raw `<textarea>` used to edit markdown files anywhere in the frontend with a
WYSIWYG rich editor. Eight surfaces are in scope: the identity file tab, the role file
tab, the global-files tab, the skill-files tab (all four near-byte-identical clones of
each other today), plus the bounty premise field on `BountyCard`, the wake-up
instruction field on `AddWakeupDialog`, the `EditableFileModal` (delegates through
global-files), and the `RunbookEditorModal` (delegates through skill-files). On the two
surfaces that can open non-markdown content (`SkillFileTab`, `GlobalFileTab`), a
filename check gates behaviour: markdown files render in the pretty editor, everything
else keeps the existing plain textarea. Frontend-only work; the on-disk file-format
contract is unchanged.

</domain>

<decisions>
## Implementation Decisions

### Editor engine
- **D-01: MDXEditor is the chosen engine.** Locked on a 4-way tasting (MDXEditor vs.
  Milkdown / Crepe vs. BlockNote vs. Toast UI) at
  `/home/ubuntu/fleet/roles/box-maintainer/bounties/pretty-markdown-editing-in-frontend/tasting/`.
  MDXEditor was the only one of the four that preserves the top-of-file settings block
  ("frontmatter") through a body-only save — the other three destroy the fences and/or
  the keys. Round-trip diffs and DOM probes are in that folder.
- **D-02: Add `@mdxeditor/editor` (^4.2.5) as a dependency** and lazy-load it the same
  way `@uiw/react-codemirror` is lazy-loaded in `SSHAuthDialog.tsx` — the editor is
  heavy and only the file-editing surfaces need it.
- **D-03: MDXEditor plugin set (starting point):** `headingsPlugin`, `listsPlugin`,
  `quotePlugin`, `thematicBreakPlugin`, `linkPlugin` + `linkDialogPlugin`, `tablePlugin`,
  `codeBlockPlugin` + `codeMirrorPlugin` (for fenced-code syntax highlighting),
  `frontmatterPlugin`, `markdownShortcutPlugin`, and `toolbarPlugin` with an
  appropriate button set. Planner may adjust the set after research; frontmatter is
  the load-bearing plugin and stays.

### Frontmatter (settings block)
- **D-04: Frontmatter is handled via MDXEditor's built-in "Edit frontmatter" toolbar
  button.** Clicking it opens a dialog that populates from what's already in the file
  and lets the user edit keys/values as form fields. The pretty view for body prose
  does NOT show or fold the frontmatter into running text.
- **D-05: Preservation contract — a body-only edit MUST round-trip the frontmatter
  block untouched.** This is the one shape where byte-for-byte round-trip fidelity is
  required. Verified in the tasting: MDXEditor scored 0 lines rewritten on
  frontmatter when only body was edited; the three losers scored ~4–5. Tests must
  enforce this invariant.

### Filetype gate (mixed-content surfaces)
- **D-06: On `SkillFileTab` and `GlobalFileTab`, extension check decides the mode.**
  `.md` (case-insensitive) → pretty editor. Anything else (`.json`, `.sh`, `.txt`,
  no-extension, etc.) → the existing plain monospace textarea, kept exactly as it is
  today. Decision keyed off `state.data`'s file name — the backend already surfaces
  it via the tab's props.
- **D-07: One mode visible at a time.** No user-facing toggle to swap between pretty
  and raw. The gate is deterministic from the filename; a user who wants raw editing
  for a `.md` file is not a scenario we need to support.
- **D-08: The four file-tab surfaces reduce to ONE shared component.** The current
  near-byte-identical clones (`IdentityFileTab`, `RoleFileTab`, `GlobalFileTab`,
  `SkillFileTab`) become thin wrappers over a shared `MarkdownEditor` (or
  equivalent) component. Preserving the existing `TabState<T>` contract exported from
  `IdentityFileTab.tsx` is required — every downstream call site depends on it.

### Reformatting policy
- **D-09: Byte-for-byte prose fidelity is NOT required.** MDXEditor normalises
  emphasis characters (`*` vs `_`), list bullet characters, and indentation. That's
  fine — every markdown file this feature edits is consumed as context by an agent,
  and agents don't care about small formatting variations. The load-bearing user
  quote (2026-09-16, verbatim): *"reality is that any markdown file that someone
  would edit through the interface is going to be just ingested as context by an
  agent and while very perfectly tuned markdown files maybe a smidge better than an
  alternative the reality is that they just don't care that much."*
- **D-10: No back-end changes.** The on-disk file-format contract is unchanged.

### Dark-theme styling (Skynet-native)
- **D-11: MDXEditor ships light-mode defaults. Ship it dark, matching Skynet's
  chrome.** The editor's internal elements need force-styled to readable
  light-on-dark, and the toolbar needs to match Skynet's `--color-pv-*` tokens
  (`src/ui/index.css:117-146`) rather than MDXEditor's defaults.
- **D-12: Inline code (single backticks) and fenced code blocks (triple backticks)
  both need proper dark-theme styling and must be styled together.** They render as
  monospaced content; they cannot be white-on-white or dark-on-dark. Use the app's
  existing `--color-pv-code-*` tokens as the source of truth (same colours used for
  code in chat message bubbles and in the read-mode markdown preview today).
- **D-13: The frontmatter dialog's inputs also need dark-theme styling.** MDXEditor
  opens it as a Radix Dialog; its default styles need overriding to match Skynet.

### Testing
- **D-14: Round-trip test is required for the frontmatter preservation contract
  (D-05).** At minimum: load a file with frontmatter, edit only the body, save,
  assert the frontmatter fence + keys survive byte-identically. The tasting has
  Playwright-based examples that can inform the shape of this.
- **D-15: Filetype gate test is required for D-06.** Load `SkillFileTab` and
  `GlobalFileTab` with a `.md` file → asserts pretty editor renders. Load them with
  `.json` / `.sh` → asserts the plain textarea renders.
- **D-16: Existing vitest suites for the four file tabs are the natural regression
  boundary.** All must still pass after the refactor to the shared component.

### Claude's Discretion
- Naming and location of the new shared component (typical path:
  `src/ui/features/pretty-view/MarkdownEditor.tsx` or under a small subfolder if it
  splits into multiple files with its own CSS/theme).
- Exact toolbar button set within MDXEditor's plugin catalogue (D-03 lists the
  starting set; planner+executor may add/remove based on research).
- How the dark-theme CSS is packaged (a dedicated CSS file? Tailwind classes? A
  small `mdxeditor.dark.css` that ships alongside the component?).
- Test file structure — mirror the existing `.test.tsx` per-tab layout, or one
  consolidated test file for the shared component; either is fine.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase agreement (the load-bearing spec — read this first)
- `/home/ubuntu/fleet/roles/box-maintainer/bounties/pretty-markdown-editing-in-frontend/shape-pretty-markdown-editing.md`
  — The shape file agreed at `/open`. Locks the WHAT, the philosophy, the
  what-would-make-it-wrong list, and the scope edges. Every decision above traces
  back to a section here.

### Tasting evidence
- `/home/ubuntu/fleet/roles/box-maintainer/bounties/pretty-markdown-editing-in-frontend/tasting/`
  — The tasting harness. `README`ish material lives inline in the app. Key
  scripts to consult if a design question arises later:
  - `smoke.mjs` — automated round-trip per engine × sample; shows what saving
    would rewrite. Run against a live vite server at port 8901.
  - `frontmatter-check.mjs` — focused check of frontmatter survival per engine.
  - `probe.mjs` — captures visible text + rendered colour per engine (used to
    diagnose the dark-on-dark styling issue).

### Related open bounties
- `pretty-markdown-editing-in-frontend` — this phase's parent bounty. Closes out
  when this phase ships.
- `file-editing-in-identity-modal` — the earlier bounty that made the four file
  tabs editable but explicitly deferred the polish. Closes out alongside this
  phase per the shape's Vehicle Notes.
- `skills-editor-mirror-wide-hygiene-followups` — 5 mirror-shared code-hygiene
  items from the Phase 44 review of the skill-files editor. Some touch the same
  shared layer this phase refactors. Not required, but a natural moment for the
  planner to consider whether any come along for the ride.

### Codebase entry points (deeper file:line refs in `<code_context>` below)
- `src/ui/features/pretty-view/IdentityFileTab.tsx` — canonical shape of the
  four near-identical file tabs; exports the shared `TabState<T>` contract.
- `src/ui/features/pretty-view/RoleFileTab.tsx`,
  `src/ui/features/pretty-view/GlobalFileTab.tsx`,
  `src/ui/features/pretty-view/SkillFileTab.tsx` — the three siblings.
- `src/ui/index.css` §117-146 — the `--color-pv-*` palette tokens that D-11 and
  D-12 draw from. Never draw from Skynet's `--background` / `--foreground` for
  cross-surface styling (project directive; see role file § Palette authority).
- `src/ui/ssh/dialogs/SSHAuthDialog.tsx` + `src/ui/features/terminal/Terminal.tsx`
  — established pattern for lazy-loading a heavy editor dep (`@uiw/react-codemirror`
  is only pulled in when the SSH auth dialog opens). MDXEditor should follow the
  same pattern.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`TabState<T>` type** (`src/ui/features/pretty-view/IdentityFileTab.tsx:21-24`) —
  the shared discriminated-union `loading | error | ready` all four file tabs
  consume. The new shared component MUST accept this same shape or every call
  site changes.
- **`ChatMessage.tsx` markdown rendering pattern** — uses `react-markdown` +
  `remark-gfm` for READ-ONLY display. Same plugin ecosystem MDXEditor uses under
  the hood; consistency with chat-message rendering matters for cognitive
  continuity when users switch between reading a bubble and editing a file.
- **`@uiw/react-codemirror` lazy-load pattern** — SSHAuthDialog imports it at the
  module top of `SSHAuthDialog.tsx:13` but the DIALOG itself is lazy-loaded from
  `Terminal.tsx:34`. Same pattern applies to MDXEditor: lazy-load the whole
  editor wrapper, not the editor's own submodules.
- **Already-installed deps** (from `package.json`): `react-markdown@^10.1.0`,
  `remark-gfm@^4.0.1`, `@uiw/react-codemirror@^4.25.9`, `@monaco-editor/react@^4.7.0`,
  `@codemirror/*` (autocomplete, commands, search, theme-one-dark, view).
  Only NEW dep needed: `@mdxeditor/editor`.

### Established Patterns
- **Four near-identical clones** — the four file tabs use verbatim-copied CSS
  classes (`GlobalFileTab.tsx:102` comment: *"Textarea styling copied VERBATIM
  from RoleFileTab.tsx L134 per CONTEXT §specifics 'do NOT reinvent, it's
  tuned'"*). This phase is explicitly the moment to consolidate.
- **Save-handler shape variance** — `IdentityFileTab` and `RoleFileTab` take
  `onSave?: (contents: string) => Promise<void>` (simple); `GlobalFileTab` and
  `SkillFileTab` take `onSave: (content: string, expectedMtime: number) =>
  Promise<void>` (mtime for optimistic concurrency). The shared component must
  support both — likely a generic signature or two thin variants.
- **View-vs-edit modes** — `IdentityFileTab` and `RoleFileTab` have a
  read/edit toggle (view via `ReactMarkdown` preview, edit via textarea).
  `GlobalFileTab` and `SkillFileTab` are always-in-edit-mode. The shared
  component should support both — either through a `mode` prop or by having the
  view-mode toggle be an outer wrapper.
- **`onDraftChange`** — `GlobalFileTab.tsx:35` accepts an optional callback that
  fires when the draft diverges from or converges back to the fetched content;
  `EditableFileModal` uses it for a close-guard confirm prompt. Shared component
  must preserve this optional callback.

### Integration Points
- **`src/ui/features/pretty-view/`** — where the four file tabs and the new
  shared component all live.
- **`BountyCard.tsx:1050`** — the bounty premise `<Textarea>`. Wire the shared
  component into this call site.
- **`AddWakeupDialog.tsx:231`** — the wake-up instruction `<textarea>`. Wire the
  shared component into this call site.
- **`EditableFileModal.tsx`** and **`RunbookEditorModal.tsx`** — these delegate
  through `GlobalFileTab` and `SkillFileTab` respectively; once the shared
  component is in place, these ride along for free.
- **NO changes to** `PrettyView.tsx` (chat message rendering), the four
  `.test.tsx` file-tab test files' test intents (must still pass), any
  backend routes under `src/backend/database/routes/`, or any file-format
  contract on disk.

</code_context>

<specifics>
## Specific Ideas

- **Dark styling should match the existing `--color-pv-code-*` tokens
  1:1** — inline code and fenced code blocks in the pretty editor should look
  identical to inline code and fenced code blocks in chat message bubbles
  (`ChatMessage.tsx` read-mode rendering) so a user switching between reading
  and editing doesn't see a visual jump.
- **The tasting harness is durable** — kept in the bounty folder as long as the
  bounty is open, so it can be revisited if a design question comes up during
  implementation. Do NOT check the tasting into `src/` — it's not part of the
  shipped app.
- **The user's own words on why this is worth doing** (2026-09-09 verbatim):
  *"pretty markdown editing instead of raw in all the front end places that
  markdown can be edited"*. Everything else in this phase serves that sentence.

</specifics>

<deferred>
## Deferred Ideas

- **Pretty editor on plain-text bounty fields** (bounty title, todos, keywords,
  source links, meeting questions) — those are not markdown; their raw inputs are
  the correct control. Explicitly out of scope per shape file.
- **Undo/redo overlay, autosave visual feedback, keyboard-hint UI,
  drag-drop todo reorder, datetime deadline, rich premise editor, conflict
  UX** — the polish items the earlier `file-editing-in-identity-modal` bounty
  scratch-report deferred. Not this phase; a later polish pass after WYSIWYG
  lands.
- **WYSIWYG editing of code content inside fenced blocks** — code stays as
  monospaced non-rendered content. That's correct behaviour, not a gap.
- **Chat message rendering changes** — that surface uses read-only
  `react-markdown` and is already correct; unchanged.
- **Mirror-hygiene followups from Phase 44** — the 5 items in bounty
  `skills-editor-mirror-wide-hygiene-followups` touch the same shared file-tab
  layer but are orthogonal to this phase. The planner may fold any that
  naturally land in-path; anything that doesn't stays in that bounty.
- **The T800 D-07 CSRF regex-gap** — Cairo's finding from the sibling
  `serve-url-cors-deny-breaks-module-based-dev-servers` bounty. Orthogonal
  work, its own future bounty, awaiting the user's call on filing.

</deferred>

---

*Phase: 111-pretty-markdown-editing-across-all-frontend-markdown-editing*
*Context gathered: 2026-09-16*
